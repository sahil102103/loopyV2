"""Observation construction backed by the canonical two-phase simulator."""

from __future__ import annotations

from typing import Protocol

import networkx as nx

from .engine import EngineAdapter, NotebookEngineAdapter
from .types import EnvironmentObservation


class ObservationBuilder(Protocol):
    def build(
        self,
        graph: nx.DiGraph,
        *,
        episode_id: int,
        step: int,
        seed: int | None,
    ) -> EnvironmentObservation:
        """Build one immutable environment observation."""


class SimulationObservationBuilder:
    """Runs the notebook-derived engine and exposes JSON-friendly state."""

    def __init__(self, horizon: int = 200, engine: EngineAdapter | None = None):
        if not isinstance(horizon, int) or horizon < 1:
            raise ValueError("horizon must be a positive integer")
        self._horizon = horizon
        self._engine = engine or NotebookEngineAdapter.default()

    @property
    def horizon(self) -> int:
        return self._horizon

    def build(
        self,
        graph: nx.DiGraph,
        *,
        episode_id: int,
        step: int,
        seed: int | None,
    ) -> EnvironmentObservation:
        history = self._engine.simulate(graph, self._horizon)
        classifications = self._engine.classify(history)

        node_parameters = {
            str(node): {
                "start_amount": float(graph.nodes[node].get("start_amount", 0.0)),
                "retention": float(graph.nodes[node].get("retention", 1.0)),
            }
            for node in graph.nodes
        }
        edge_parameters = {
            f"{source}->{target}": {
                "decay": float(data.get("decay", 0.0)),
                "delay": int(data.get("delay", 0)),
                "confidence": float(data.get("confidence", 1.0)),
                "correlation": float(data.get("correlation", 1.0)),
            }
            for source, target, data in graph.edges(data=True)
        }
        immutable_history = {
            str(node): tuple(None if value is None else float(value) for value in series)
            for node, series in history.items()
        }
        return EnvironmentObservation(
            episode_id=episode_id,
            step=step,
            seed=seed,
            history=immutable_history,
            classifications=dict(classifications),
            nodes=tuple(str(node) for node in graph.nodes),
            edges=tuple((str(source), str(target)) for source, target in graph.edges),
            node_parameters=node_parameters,
            edge_parameters=edge_parameters,
        )
