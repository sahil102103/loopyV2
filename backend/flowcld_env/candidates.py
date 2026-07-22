"""Bounded structural action proposals for autonomous FlowCLD agents.

The generator only proposes small, interpretable graph motifs. Authorization,
budgets, anti-collapse constraints, simulation, and reward scoring remain owned
by the environment. This keeps structural search replaceable without weakening
the canonical mutation boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Protocol

import networkx as nx

from .structural import (
    SUPPORTED_EDGE_FORMS,
    AddEdgeAction,
    AddNodeAction,
    RemoveEdgeAction,
    RemoveNodeAction,
    StructuralTransaction,
)
from .types import Objective


StructuralCandidate = (
    AddNodeAction
    | RemoveNodeAction
    | AddEdgeAction
    | RemoveEdgeAction
    | StructuralTransaction
)


class StructuralCandidateGenerator(Protocol):
    """Open proposal boundary consumed by ``MultiTeamEnvironment``."""

    def generate(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        *,
        remaining_edits: int,
    ) -> tuple[StructuralCandidate, ...]:
        """Return bounded candidate edits without mutating ``graph``."""


@dataclass(frozen=True)
class BoundedStructuralCandidateSettings:
    """Complexity limits and defaults for interpretable structural motifs."""

    max_ranked_edges: int = 4
    max_missing_edges: int = 8
    direct_edge_strength: float = 0.35
    mediator_retention: float = 0.0

    def __post_init__(self) -> None:
        if self.max_ranked_edges < 1 or self.max_missing_edges < 0:
            raise ValueError("Structural candidate limits must be non-negative")
        if not 0.0 < float(self.direct_edge_strength) <= 1.0:
            raise ValueError("direct_edge_strength must be greater than 0 and at most 1")
        if not 0.0 <= float(self.mediator_retention) <= 1.0:
            raise ValueError("mediator_retention must be between 0 and 1")


class BoundedStructuralCandidateGenerator:
    """Propose a small set of reversible, simulator-verifiable graph changes.

    The motifs are deliberately generic:

    * mediate an existing edge through one new node;
    * add an opposing parallel path through one new node;
    * remove an existing edge; and
    * add a missing signed edge.

    The environment subsequently removes every candidate that is unauthorized,
    over budget, or rejected by structural safety constraints.
    """

    def __init__(
        self,
        settings: BoundedStructuralCandidateSettings | None = None,
    ) -> None:
        self.settings = settings or BoundedStructuralCandidateSettings()

    def generate(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        *,
        remaining_edits: int,
    ) -> tuple[StructuralCandidate, ...]:
        if not isinstance(graph, nx.DiGraph) or not graph.nodes:
            return ()
        if remaining_edits < 1:
            return ()

        focus = (
            set(objective.owned_nodes)
            | set(objective.target_nodes)
            | set(objective.target.trajectories)
            | set(objective.target.behaviors)
        )
        ranked_edges = self._ranked_edges(graph, focus)
        new_name = self._next_node_name(graph)
        candidates: list[StructuralCandidate] = []

        for source, target in ranked_edges[: self.settings.max_ranked_edges]:
            edge = graph[source][target]
            if remaining_edits >= 4:
                candidates.extend((
                    self._mediated_replacement(
                        source, target, new_name, edge, oppose=False
                    ),
                    self._mediated_replacement(
                        source, target, new_name, edge, oppose=True
                    ),
                ))
            if remaining_edits >= 3:
                candidates.append(self._parallel_regulator(
                    source, target, new_name, edge
                ))

        if remaining_edits >= 1:
            candidates.extend(
                RemoveEdgeAction(str(source), str(target))
                for source, target in ranked_edges[: self.settings.max_ranked_edges]
            )
            candidates.extend(self._missing_edge_candidates(graph, focus))

        unique: dict[str, StructuralCandidate] = {}
        for candidate in candidates:
            unique.setdefault(repr(candidate.to_dict()), candidate)
        return tuple(unique.values())

    def _mediated_replacement(
        self,
        source: str,
        target: str,
        new_name: str,
        edge: dict,
        *,
        oppose: bool,
    ) -> StructuralTransaction:
        first, second = self._split_edge(edge, oppose=oppose)
        mode = "balancing" if oppose else "mediated"
        return StructuralTransaction(
            edits=(
                self._mediator_node(new_name),
                RemoveEdgeAction(str(source), str(target)),
                AddEdgeAction(str(source), new_name, **first),
                AddEdgeAction(new_name, str(target), **second),
            ),
            label=f"{mode} path: {source} -> {new_name} -> {target}",
        )

    def _parallel_regulator(
        self,
        source: str,
        target: str,
        new_name: str,
        edge: dict,
    ) -> StructuralTransaction:
        first, second = self._split_edge(edge, oppose=True)
        return StructuralTransaction(
            edits=(
                self._mediator_node(new_name),
                AddEdgeAction(str(source), new_name, **first),
                AddEdgeAction(new_name, str(target), **second),
            ),
            label=f"parallel balancing path: {source} -> {new_name} -> {target}",
        )

    def _mediator_node(self, name: str) -> AddNodeAction:
        return AddNodeAction(
            name=name,
            start_amount=0.0,
            retention=float(self.settings.mediator_retention),
        )

    @staticmethod
    def _split_edge(edge: dict, *, oppose: bool) -> tuple[dict, dict]:
        correlation = float(edge.get("correlation", 1.0))
        sign = -1.0 if correlation < 0.0 else 1.0
        magnitude = math.sqrt(min(1.0, abs(correlation)))
        first_correlation = magnitude
        second_correlation = sign * magnitude * (-1.0 if oppose else 1.0)
        decay = min(1.0, max(0.0, float(edge.get("decay", 0.0))))
        split_decay = 1.0 - math.sqrt(max(0.0, 1.0 - decay))
        delay = max(0, int(edge.get("delay", 0)))
        confidence = min(1.0, max(0.0, float(edge.get("confidence", 1.0))))
        form = str(edge.get("functional_form", "linear")).strip().lower()
        if form not in SUPPORTED_EDGE_FORMS:
            form = "linear"
        common = {
            "decay": split_decay,
            "confidence": confidence,
        }
        return (
            {
                **common,
                "correlation": first_correlation,
                "delay": delay // 2,
                "functional_form": form,
            },
            {
                **common,
                "correlation": second_correlation,
                "delay": delay - delay // 2,
                "functional_form": "linear",
            },
        )

    def _missing_edge_candidates(
        self,
        graph: nx.DiGraph,
        focus: set[str],
    ) -> tuple[AddEdgeAction, ...]:
        nodes = sorted(
            graph.nodes,
            key=lambda node: (
                -(1 if node in focus else 0),
                -(graph.in_degree(node) + graph.out_degree(node)),
                str(node),
            ),
        )
        missing: list[tuple[str, str]] = []
        for source in nodes:
            for target in nodes:
                if source == target or graph.has_edge(source, target):
                    continue
                missing.append((str(source), str(target)))
                if len(missing) >= self.settings.max_missing_edges:
                    break
            if len(missing) >= self.settings.max_missing_edges:
                break
        strength = float(self.settings.direct_edge_strength)
        return tuple(
            AddEdgeAction(source, target, correlation=polarity * strength, decay=0.1)
            for source, target in missing
            for polarity in (-1.0, 1.0)
        )

    def _ranked_edges(
        self,
        graph: nx.DiGraph,
        focus: set[str],
    ) -> tuple[tuple[str, str], ...]:
        def key(edge: tuple[str, str]) -> tuple[object, ...]:
            source, target = edge
            data = graph[source][target]
            effective = abs(float(data.get("correlation", 0.0))) * (
                1.0 - min(1.0, max(0.0, float(data.get("decay", 0.0))))
            )
            relevance = int(source in focus) + int(target in focus)
            degree = graph.in_degree(source) + graph.out_degree(source)
            degree += graph.in_degree(target) + graph.out_degree(target)
            return (-relevance, -effective, -degree, str(source), str(target))

        return tuple(sorted(graph.edges, key=key))

    @staticmethod
    def _next_node_name(graph: nx.DiGraph) -> str:
        existing = {str(node) for node in graph.nodes}
        single_letters = [name for name in existing if len(name) == 1 and name.isalpha()]
        uppercase = bool(single_letters) and all(name.isupper() for name in single_letters)
        alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if uppercase else "abcdefghijklmnopqrstuvwxyz"
        for name in alphabet:
            if name not in existing:
                return name
        index = 1
        while f"agent_node_{index}" in existing:
            index += 1
        return f"agent_node_{index}"
