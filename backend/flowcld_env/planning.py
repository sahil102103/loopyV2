"""Bounded decision-time planning over the FlowCLD transition model."""

from __future__ import annotations

import copy
from dataclasses import dataclass
import json
import math
from typing import Callable, Protocol, Sequence

import networkx as nx

from .agents import StatelessPolicy
from .features import DecisionFeatureEncoder, MessagePassingFeatureEncoder
from .learning import LearningEnvironment, LinearActorCritic, legal_agent_moves
from .structural import (
    AddEdgeAction,
    AddNodeAction,
    RemoveEdgeAction,
    RemoveNodeAction,
    StructuralTransaction,
)
from .teams import TeamAction, TeamMove
from .types import NoOpAction, Objective, ParameterAction


@dataclass(frozen=True)
class PlannedTransition:
    reward: float
    next_graph: nx.DiGraph
    terminated: bool


class TransitionModel(Protocol):
    """Model interface required by the depth-limited planner."""

    def legal_moves(self, graph: nx.DiGraph) -> tuple[TeamAction, ...]: ...

    def step(self, graph: nx.DiGraph, action: TeamAction) -> PlannedTransition: ...


PlanningEnvironmentFactory = Callable[[nx.DiGraph], LearningEnvironment]


class EnvironmentTransitionModel:
    """Use fresh environment instances as a pure decision-time model."""

    def __init__(
        self,
        environment_factory: PlanningEnvironmentFactory,
        *,
        team_id: str,
        seed: int = 0,
    ):
        self.environment_factory = environment_factory
        self.team_id = str(team_id)
        self.seed = int(seed)

    def legal_moves(self, graph: nx.DiGraph) -> tuple[TeamAction, ...]:
        environment = self.environment_factory(nx.DiGraph(copy.deepcopy(graph)))
        environment.reset(seed=self.seed)
        return legal_agent_moves(environment, self.team_id)

    def step(self, graph: nx.DiGraph, action: TeamAction) -> PlannedTransition:
        environment = self.environment_factory(nx.DiGraph(copy.deepcopy(graph)))
        environment.reset(seed=self.seed)
        _, _, terminated, _, info = environment.step(TeamMove(
            team_id=self.team_id,
            action=action,
        ))
        reward_payload = info["transition_rewards"][self.team_id]
        reward = float(reward_payload.get("reward", reward_payload.get("total")))
        return PlannedTransition(
            reward=reward,
            next_graph=environment.graph_snapshot,
            terminated=bool(terminated),
        )


class DepthLimitedPlanningAgent(StatelessPolicy):
    """Learned policy prior plus critic-backed lookahead through the simulator."""

    def __init__(
        self,
        model: LinearActorCritic,
        transition_model: TransitionModel,
        *,
        encoder: DecisionFeatureEncoder | None = None,
        depth: int = 2,
        branch_width: int = 4,
        prior_weight: float = 0.01,
    ):
        if not 1 <= int(depth) <= 5:
            raise ValueError("planning depth must be between 1 and 5")
        if not 1 <= int(branch_width) <= 20:
            raise ValueError("branch width must be between 1 and 20")
        if not math.isfinite(prior_weight) or prior_weight < 0.0:
            raise ValueError("prior_weight must be finite and non-negative")
        self.model = model
        self.transition_model = transition_model
        self.encoder = encoder or MessagePassingFeatureEncoder()
        self.depth = int(depth)
        self.branch_width = int(branch_width)
        self.prior_weight = float(prior_weight)

    def state_dict(self):
        return {
            "version": 1,
            "policy": type(self).__name__,
            "model": self.model.to_dict(),
            "depth": self.depth,
            "branch_width": self.branch_width,
            "prior_weight": self.prior_weight,
        }

    def load_state_dict(self, payload) -> None:
        if int(payload.get("version", 0)) != 1:
            raise ValueError("Unsupported planning-agent state version")
        self.model = LinearActorCritic.from_dict(payload["model"])
        self.depth = int(payload.get("depth", self.depth))
        self.branch_width = int(payload.get("branch_width", self.branch_width))
        self.prior_weight = float(payload.get("prior_weight", self.prior_weight))

    def select_move(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
        value_of,
    ) -> TeamAction:
        del value_of
        moves = tuple(legal_moves)
        if not moves:
            raise ValueError("DepthLimitedPlanningAgent requires legal moves")
        ranked = self._ranked_moves(graph, objective, moves)
        candidates = self._branch_candidates(ranked, objective)
        scored = []
        for prior, stable_key, action in candidates:
            transition = self.transition_model.step(graph, action)
            score = transition.reward + self.prior_weight * math.log(max(prior, 1e-12))
            if not transition.terminated:
                score += objective.gamma * self._continuation_value(
                    transition.next_graph, objective, self.depth - 1
                )
            scored.append((score, stable_key, action))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return scored[0][2]

    def _continuation_value(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        depth: int,
    ) -> float:
        if depth <= 0:
            return self.model.value(self.encoder.encode_state(graph, objective))
        legal = self.transition_model.legal_moves(graph)
        if not legal:
            return self.model.value(self.encoder.encode_state(graph, objective))
        best = -math.inf
        ranked = self._ranked_moves(graph, objective, legal)
        for prior, _, action in self._branch_candidates(ranked, objective):
            transition = self.transition_model.step(graph, action)
            value = transition.reward + self.prior_weight * math.log(max(prior, 1e-12))
            if not transition.terminated:
                value += objective.gamma * self._continuation_value(
                    transition.next_graph, objective, depth - 1
                )
            best = max(best, value)
        return best

    def _ranked_moves(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
    ) -> list[tuple[float, str, TeamAction]]:
        moves = tuple(legal_moves)
        encoded = self.encoder.encode(graph, objective, moves)
        probabilities = self.model.probabilities(self.encoder.policy_features(encoded))
        ranked = [
            (
                float(probabilities[index]),
                json.dumps(move.to_dict(), sort_keys=True, default=str),
                move,
            )
            for index, move in enumerate(moves)
        ]
        ranked.sort(key=lambda item: (-item[0], item[1]))
        return ranked

    def _branch_candidates(
        self,
        ranked: Sequence[tuple[float, str, TeamAction]],
        objective: Objective,
    ) -> list[tuple[float, str, TeamAction]]:
        """Keep policy preference while preserving action-family coverage."""

        if objective.target.spectral_radius is None:
            return list(ranked[: self.branch_width])
        priorities = (
            "structural_transaction",
            "remove_edge",
            "retention",
            "decay",
            "correlation",
            "no_op",
            "add_edge",
            "start_amount",
            "delay",
            "confidence",
            "add_node",
            "remove_node",
        )
        selected: list[tuple[float, str, TeamAction]] = []
        selected_keys = set()
        for family in priorities:
            quota = 2 if family == "structural_transaction" else 1
            matches = [item for item in ranked if self._action_family(item[2]) == family]
            for item in matches[:quota]:
                if item[1] in selected_keys:
                    continue
                selected.append(item)
                selected_keys.add(item[1])
                if len(selected) >= self.branch_width:
                    return selected
        for item in ranked:
            if item[1] in selected_keys:
                continue
            selected.append(item)
            if len(selected) >= self.branch_width:
                break
        return selected

    @staticmethod
    def _action_family(action: TeamAction) -> str:
        if isinstance(action, NoOpAction):
            return "no_op"
        if isinstance(action, ParameterAction):
            return action.parameter.value
        if isinstance(action, StructuralTransaction):
            return "structural_transaction"
        if isinstance(action, AddNodeAction):
            return "add_node"
        if isinstance(action, RemoveNodeAction):
            return "remove_node"
        if isinstance(action, AddEdgeAction):
            return "add_edge"
        if isinstance(action, RemoveEdgeAction):
            return "remove_edge"
        raise TypeError(f"Unsupported action type: {type(action).__name__}")
