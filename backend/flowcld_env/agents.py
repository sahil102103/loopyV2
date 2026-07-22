"""Stable agent contract and deterministic one-ply handoff baseline."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Callable, Mapping, Protocol, Sequence

import networkx as nx
import numpy as np

from .stability import GraphBalancePlanner, GraphBalanceSettings, GraphBalanceValidationError
from .teams import TeamAction
from .types import NoOpAction, Objective, ObjectiveOrientation, ParameterAction, ParameterName


class AgentPolicy(Protocol):
    """Framework-independent policy boundary used by FlowCLD runners."""

    def select_move(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
        value_of: Callable[[TeamAction], float],
    ) -> TeamAction:
        """Select one move without mutating the graph."""

    def update(self, transition: "PolicyTransition") -> None:
        """Observe one committed environment transition."""

    def reset(self, *, seed: int | None = None, training: bool = False) -> None:
        """Reset episode-local state without discarding learned parameters."""

    def state_dict(self) -> Mapping[str, Any]:
        """Return JSON-compatible policy state."""

    def load_state_dict(self, payload: Mapping[str, Any]) -> None:
        """Restore policy state produced by ``state_dict``."""


@dataclass(frozen=True)
class PolicyTransition:
    """One real transition supplied to an online-learning policy.

    Candidate previews never create this value. ``graph`` and ``next_graph``
    are environment snapshots from immediately before and after the committed
    action, and ``reward`` is the acting team's transition reward.
    """

    graph: nx.DiGraph
    objective: Objective
    action: TeamAction
    reward: float
    next_graph: nx.DiGraph
    done: bool
    accepted: bool
    context: Mapping[str, Any]


class StatelessPolicy:
    """Default lifecycle for policies that do not learn online."""

    def update(self, transition: PolicyTransition) -> None:
        del transition

    def reset(self, *, seed: int | None = None, training: bool = False) -> None:
        del seed, training

    def state_dict(self) -> Mapping[str, Any]:
        return {"version": 1, "policy": type(self).__name__, "trainable": False}

    def load_state_dict(self, payload: Mapping[str, Any]) -> None:
        if int(payload.get("version", 0)) != 1:
            raise ValueError("Unsupported policy state version")


@dataclass(frozen=True)
class GreedyAgent(StatelessPolicy):
    """One-ply deterministic baseline required before learned policies."""

    tolerance: float = 1e-12

    def select_move(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
        value_of: Callable[[TeamAction], float],
    ) -> TeamAction:
        del graph, objective  # Inputs remain part of the drop-in policy contract.
        if not legal_moves:
            raise ValueError("GreedyAgent requires at least one legal move")
        ranked = []
        for move in legal_moves:
            value = float(value_of(move))
            stable_key = json.dumps(move.to_dict(), sort_keys=True, default=str)
            ranked.append((value, stable_key, move))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        return ranked[0][2]


class RandomAgent(StatelessPolicy):
    """Seeded uniform baseline for Stage 5 evaluation."""

    def __init__(self, seed: int = 0):
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise ValueError("seed must be an integer")
        self._rng = np.random.default_rng(seed)

    def reset(self, *, seed: int | None = None, training: bool = False) -> None:
        del training
        if seed is not None:
            if isinstance(seed, bool) or not isinstance(seed, int):
                raise ValueError("seed must be an integer")
            self._rng = np.random.default_rng(seed)

    def state_dict(self) -> Mapping[str, Any]:
        return {
            "version": 1,
            "policy": type(self).__name__,
            "trainable": False,
            "rng_state": self._rng.bit_generator.state,
        }

    def load_state_dict(self, payload: Mapping[str, Any]) -> None:
        super().load_state_dict(payload)
        if "rng_state" in payload:
            self._rng.bit_generator.state = dict(payload["rng_state"])

    def select_move(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
        value_of: Callable[[TeamAction], float],
    ) -> TeamAction:
        del graph, objective, value_of
        if not legal_moves:
            raise ValueError("RandomAgent requires at least one legal move")
        return legal_moves[int(self._rng.integers(0, len(legal_moves)))]


class NoOpAgent(StatelessPolicy):
    """Frozen policy used when an opponent intentionally holds position."""

    def select_move(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
        value_of: Callable[[TeamAction], float],
    ) -> TeamAction:
        del graph, objective, value_of
        for move in legal_moves:
            if isinstance(move, NoOpAction):
                return move
        if not legal_moves:
            raise ValueError("NoOpAgent requires at least one legal move")
        return legal_moves[0]


class SpectralTargetGuardAgent(StatelessPolicy):
    """Complete stalled stabilizer moves toward an explicit spectral target.

    The wrapped policy remains responsible for proposing structural or
    parameter actions. When it would hold position (or do worse than holding)
    while a spectral target is unmet, this decorator asks the existing bounded
    notebook-matrix planner for a direction and returns the nearest currently
    legal parameter step. It never bypasses the environment action set.
    """

    def __init__(self, policy: AgentPolicy, *, tolerance: float = 1e-12):
        self.policy = policy
        self.tolerance = float(tolerance)

    def update(self, transition: PolicyTransition) -> None:
        updater = getattr(self.policy, "update", None)
        if callable(updater):
            updater(transition)

    def reset(self, *, seed: int | None = None, training: bool = False) -> None:
        resetter = getattr(self.policy, "reset", None)
        if callable(resetter):
            resetter(seed=seed, training=training)

    def state_dict(self) -> Mapping[str, Any]:
        provider = getattr(self.policy, "state_dict", None)
        return {
            "version": 1,
            "policy": type(self).__name__,
            "wrapped": provider() if callable(provider) else {},
        }

    def load_state_dict(self, payload: Mapping[str, Any]) -> None:
        super().load_state_dict(payload)
        loader = getattr(self.policy, "load_state_dict", None)
        if callable(loader):
            loader(payload.get("wrapped", {}))

    def select_move(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
        value_of: Callable[[TeamAction], float],
    ) -> TeamAction:
        moves = tuple(legal_moves)
        proposal = self.policy.select_move(graph, objective, moves, value_of)
        if (
            objective.orientation != ObjectiveOrientation.STABILIZE
            or objective.target.spectral_radius is None
        ):
            return proposal
        no_op = next((move for move in moves if isinstance(move, NoOpAction)), None)
        if no_op is None:
            return proposal
        if not isinstance(proposal, (NoOpAction, ParameterAction)):
            if float(value_of(proposal)) > float(value_of(no_op)) + self.tolerance:
                return proposal
        planned = self._next_planned_step(graph, objective, moves)
        return planned or proposal

    @staticmethod
    def _next_planned_step(
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
    ) -> ParameterAction | None:
        parameter_moves = tuple(
            move for move in legal_moves if isinstance(move, ParameterAction)
        )
        adjust_retention = any(
            move.parameter == ParameterName.RETENTION for move in parameter_moves
        )
        adjust_decay = any(
            move.parameter == ParameterName.DECAY for move in parameter_moves
        )
        if not adjust_retention and not adjust_decay:
            return None
        try:
            plan = GraphBalancePlanner(settings=GraphBalanceSettings(
                target_radius=float(objective.target.spectral_radius),
                adjust_retention=adjust_retention,
                adjust_decay=adjust_decay,
            )).plan(graph)
        except (GraphBalanceValidationError, TypeError, ValueError):
            return None

        for desired in plan.actions:
            compatible = [
                move for move in parameter_moves
                if move.parameter == desired.parameter and move.target == desired.target
            ]
            if not compatible:
                continue
            current = SpectralTargetGuardAgent._current_value(graph, desired)
            direction = float(desired.value) - current
            directional = [
                move for move in compatible
                if direction == 0.0
                or (float(move.value) - current) * direction > 0.0
            ]
            if not directional:
                continue
            return min(
                directional,
                key=lambda move: (
                    abs(float(move.value) - float(desired.value)),
                    str(move.target),
                ),
            )
        return None

    @staticmethod
    def _current_value(graph: nx.DiGraph, action: ParameterAction) -> float:
        if isinstance(action.target, tuple):
            source, target = action.target
            return float(graph[source][target].get(action.parameter.value, 0.0))
        return float(graph.nodes[action.target].get(action.parameter.value, 0.0))
