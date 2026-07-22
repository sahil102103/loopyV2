"""Graph-aware, fixed-width features for learned FlowCLD policies.

The encoder is deliberately independent of a learning library. It converts a
variable-size NetworkX graph and variable-size legal move set into stable NumPy
arrays. A policy can therefore change from a linear baseline to a neural model
without changing the environment or action contracts.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Protocol, Sequence

import networkx as nx
import numpy as np

from .stability import NotebookSpectralAnalyzer
from .structural import (
    AddEdgeAction,
    AddNodeAction,
    RemoveEdgeAction,
    RemoveNodeAction,
    StructuralTransaction,
)
from .teams import TeamAction
from .types import NoOpAction, Objective, ObjectiveOrientation, ParameterAction, ParameterName


@dataclass(frozen=True)
class EncodedDecision:
    """Features for one state and all currently legal actions."""

    state: np.ndarray
    actions: np.ndarray

    def __post_init__(self) -> None:
        if self.state.ndim != 1:
            raise ValueError("state features must be one-dimensional")
        if self.actions.ndim != 2:
            raise ValueError("action features must be two-dimensional")
        if not np.isfinite(self.state).all() or not np.isfinite(self.actions).all():
            raise ValueError("encoded features must be finite")


class DecisionFeatureEncoder(Protocol):
    """Open interface consumed by policies and trainers."""

    @property
    def state_size(self) -> int:
        """Number of state features."""

    @property
    def action_size(self) -> int:
        """Number of per-action features."""

    def encode_state(self, graph: nx.DiGraph, objective: Objective) -> np.ndarray:
        """Encode one graph position."""

    def encode(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
    ) -> EncodedDecision:
        """Encode one graph position and its legal move set."""

    def policy_features(self, decision: EncodedDecision) -> np.ndarray:
        """Join state and action features for an actor head."""


class MessagePassingFeatureEncoder:
    """Small deterministic graph encoder with two signed message-passing rounds.

    This is the dependency-light Stage 5 baseline. It preserves graph topology,
    signed transmission, team ownership, and objective scope before pooling to a
    fixed-width context. The actor and critic remain trainable and replaceable.
    """

    VERSION = 3
    _NODE_WIDTH = 6
    _GLOBAL_WIDTH = 15
    _POOLED_WIDTH = _NODE_WIDTH * 3
    _ACTION_KINDS = (
        "no_op",
        "start_amount",
        "retention",
        "correlation",
        "decay",
        "delay",
        "confidence",
        "add_node",
        "remove_node",
        "add_edge",
        "remove_edge",
        "structural_transaction",
    )
    _ACTION_NUMERIC_WIDTH = 8

    @property
    def state_size(self) -> int:
        return self._GLOBAL_WIDTH + self._POOLED_WIDTH

    @property
    def action_size(self) -> int:
        return len(self._ACTION_KINDS) + self._ACTION_NUMERIC_WIDTH

    def encode_state(self, graph: nx.DiGraph, objective: Objective) -> np.ndarray:
        if not isinstance(graph, nx.DiGraph) or not graph.nodes:
            raise ValueError("graph must be a non-empty networkx.DiGraph")
        nodes = sorted(graph.nodes, key=str)
        index = {node: position for position, node in enumerate(nodes)}
        count = max(1, len(nodes))
        edge_count = graph.number_of_edges()
        owned = set(objective.owned_nodes)
        targeted = set(objective.target_nodes) | set(objective.target.trajectories) | set(objective.target.behaviors)

        features = np.zeros((count, self._NODE_WIDTH), dtype=float)
        for node in nodes:
            row = index[node]
            data = graph.nodes[node]
            features[row] = (
                self._squash(data.get("start_amount", 0.0)),
                self._unit(data.get("retention", 0.0)),
                graph.in_degree(node) / count,
                graph.out_degree(node) / count,
                1.0 if node in owned else 0.0,
                1.0 if node in targeted else 0.0,
            )

        hidden = features
        for _ in range(2):
            messages = np.zeros_like(hidden)
            weights = np.zeros(count, dtype=float)
            for source, target, data in graph.edges(data=True):
                coefficient = float(data.get("correlation", 0.0)) * (
                    1.0 - self._unit(data.get("decay", 0.0))
                )
                target_index = index[target]
                messages[target_index] += coefficient * hidden[index[source]]
                weights[target_index] += abs(coefficient)
            divisor = np.maximum(1.0, weights)[:, None]
            hidden = np.tanh(0.5 * hidden + messages / divisor)

        pooled = np.concatenate((
            np.mean(hidden, axis=0),
            np.std(hidden, axis=0),
            np.max(np.abs(hidden), axis=0),
        ))
        possible_edges = max(1, count * max(1, count - 1))
        correlations = [float(data.get("correlation", 0.0)) for _, _, data in graph.edges(data=True)]
        decays = [self._unit(data.get("decay", 0.0)) for _, _, data in graph.edges(data=True)]
        delays = [max(0.0, float(data.get("delay", 0.0))) for _, _, data in graph.edges(data=True)]
        spectral_target = objective.target.spectral_radius
        if spectral_target is None:
            spectral_features = (0.0, 0.0, 0.0)
        else:
            current_radius = NotebookSpectralAnalyzer().spectral_radius(graph)
            normalized_gap = (current_radius - spectral_target) / max(0.1, spectral_target)
            spectral_features = (
                1.0,
                float(spectral_target),
                math.tanh(normalized_gap),
            )
        global_features = np.asarray((
            1.0,
            min(1.0, count / 100.0),
            min(1.0, edge_count / 500.0),
            min(1.0, edge_count / possible_edges),
            min(1.0, nx.number_weakly_connected_components(graph) / count),
            len(owned & set(nodes)) / count,
            len(targeted & set(nodes)) / count,
            1.0 if objective.orientation == ObjectiveOrientation.STABILIZE else -1.0,
            self._mean_abs(correlations),
            self._mean(decays),
            self._squash(self._mean(delays)),
            self._squash(objective.gamma),
            *spectral_features,
        ), dtype=float)
        return np.concatenate((global_features, pooled))

    def encode(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
    ) -> EncodedDecision:
        moves = tuple(legal_moves)
        if not moves:
            raise ValueError("legal_moves cannot be empty")
        state = self.encode_state(graph, objective)
        actions = np.vstack([
            self._encode_action(graph, objective, move) for move in moves
        ])
        return EncodedDecision(state=state, actions=actions)

    def policy_features(self, decision: EncodedDecision) -> np.ndarray:
        """Join shared state context to each action row for a linear actor."""

        repeated = np.repeat(decision.state[None, :], decision.actions.shape[0], axis=0)
        return np.concatenate((repeated, decision.actions), axis=1)

    def _encode_action(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        action: TeamAction,
    ) -> np.ndarray:
        kind = self._action_kind(action)
        one_hot = np.zeros(len(self._ACTION_KINDS), dtype=float)
        one_hot[self._ACTION_KINDS.index(kind)] = 1.0

        current = 0.0
        proposed = 0.0
        source_owned = 0.0
        target_owned = 0.0
        source_targeted = 0.0
        target_targeted = 0.0
        structural_size = 0.0
        destructive = 0.0
        owned = set(objective.owned_nodes)
        targeted = set(objective.target_nodes) | set(objective.target.trajectories) | set(objective.target.behaviors)

        if isinstance(action, ParameterAction):
            proposed = float(action.value)
            if isinstance(action.target, tuple):
                source, target = action.target
                if graph.has_edge(source, target):
                    current = float(graph[source][target].get(action.parameter.value, 0.0))
                source_owned = float(source in owned)
                target_owned = float(target in owned)
                source_targeted = float(source in targeted)
                target_targeted = float(target in targeted)
            else:
                node = action.target
                if node in graph:
                    current = float(graph.nodes[node].get(action.parameter.value, 0.0))
                source_owned = target_owned = float(node in owned)
                source_targeted = target_targeted = float(node in targeted)
        elif isinstance(action, AddNodeAction):
            proposed = float(action.start_amount)
            structural_size = 1.0
        elif isinstance(action, RemoveNodeAction):
            source_owned = target_owned = float(action.name in owned)
            source_targeted = target_targeted = float(action.name in targeted)
            structural_size = 1.0
            destructive = 1.0
        elif isinstance(action, (AddEdgeAction, RemoveEdgeAction)):
            source_owned = float(action.source in owned)
            target_owned = float(action.target in owned)
            source_targeted = float(action.source in targeted)
            target_targeted = float(action.target in targeted)
            structural_size = 1.0
            destructive = float(isinstance(action, RemoveEdgeAction))
            if isinstance(action, AddEdgeAction):
                proposed = float(action.correlation)
        elif isinstance(action, StructuralTransaction):
            structural_size = min(1.0, len(action.edits) / 10.0)
            destructive = float(any(isinstance(edit, (RemoveNodeAction, RemoveEdgeAction)) for edit in action.edits))
            added_correlations = []
            removed_correlations = []
            includes_new_node = any(isinstance(edit, AddNodeAction) for edit in action.edits)
            for edit in action.edits:
                if isinstance(edit, (AddEdgeAction, RemoveEdgeAction)):
                    source_owned = max(source_owned, float(edit.source in owned))
                    target_owned = max(target_owned, float(edit.target in owned))
                    source_targeted = max(source_targeted, float(edit.source in targeted))
                    target_targeted = max(target_targeted, float(edit.target in targeted))
                if isinstance(edit, AddEdgeAction):
                    added_correlations.append(float(edit.correlation))
                elif isinstance(edit, RemoveEdgeAction) and graph.has_edge(edit.source, edit.target):
                    removed_correlations.append(float(
                        graph[edit.source][edit.target].get("correlation", 0.0)
                    ))
                elif isinstance(edit, RemoveNodeAction):
                    source_owned = max(source_owned, float(edit.name in owned))
                    target_owned = max(target_owned, float(edit.name in owned))
                    source_targeted = max(source_targeted, float(edit.name in targeted))
                    target_targeted = max(target_targeted, float(edit.name in targeted))
            current = self._mean(removed_correlations)
            if includes_new_node and len(added_correlations) == 2:
                proposed = float(np.prod(added_correlations))
            else:
                proposed = self._mean(added_correlations)

        numeric = np.asarray((
            self._squash(current),
            self._squash(proposed),
            self._squash(proposed - current),
            source_owned,
            target_owned,
            max(source_targeted, target_targeted),
            structural_size,
            destructive,
        ), dtype=float)
        return np.concatenate((one_hot, numeric))

    @staticmethod
    def _action_kind(action: TeamAction) -> str:
        if isinstance(action, NoOpAction):
            return "no_op"
        if isinstance(action, ParameterAction):
            return action.parameter.value
        if isinstance(action, AddNodeAction):
            return "add_node"
        if isinstance(action, RemoveNodeAction):
            return "remove_node"
        if isinstance(action, AddEdgeAction):
            return "add_edge"
        if isinstance(action, RemoveEdgeAction):
            return "remove_edge"
        if isinstance(action, StructuralTransaction):
            return "structural_transaction"
        raise TypeError(f"Unsupported action type: {type(action).__name__}")

    @staticmethod
    def _unit(value: object) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.0
        return min(1.0, max(0.0, number)) if math.isfinite(number) else 0.0

    @staticmethod
    def _squash(value: object) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.0
        return math.tanh(number) if math.isfinite(number) else 0.0

    @staticmethod
    def _mean(values: Sequence[float]) -> float:
        return float(np.mean(values)) if values else 0.0

    @classmethod
    def _mean_abs(cls, values: Sequence[float]) -> float:
        return cls._squash(float(np.mean(np.abs(values)))) if values else 0.0
