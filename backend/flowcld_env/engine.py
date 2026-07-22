"""Injected adapter for the flagship notebook simulation and scoring engine."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping, Protocol

import networkx as nx


@dataclass(frozen=True)
class EngineEvaluation:
    """Canonical graph-health evaluation. Cost is lower-is-better."""

    cost: float
    health: float
    components: Mapping[str, Any]
    classifications: Mapping[str, str]


class EngineAdapter(Protocol):
    @property
    def presets(self) -> Mapping[str, Mapping[str, float]]:
        """Notebook score presets available to objectives."""

    def simulate(self, graph: nx.DiGraph, steps: int) -> Mapping[str, list[float | None]]:
        """Run the canonical two-phase simulation."""

    def classify(self, history: Mapping[str, list[float | None]]) -> Mapping[str, str]:
        """Classify simulation behavior using the canonical classifier."""

    def evaluate(self, graph: nx.DiGraph, *, preset: str, steps: int) -> EngineEvaluation:
        """Evaluate the current graph through the notebook scorer."""


class NotebookEngineAdapter:
    """Dependency-injected facade over notebook-derived engine functions."""

    _REQUIRED_NAMES = (
        "simulate_two_phase",
        "classify_behavior",
        "evaluate_config",
        "graph_state_config",
        "OPT_SCORE_PRESETS",
    )

    def __init__(
        self,
        *,
        simulate_two_phase: Callable[..., Mapping[str, list[float | None]]],
        classify_behavior: Callable[..., Mapping[str, str]],
        evaluate_config: Callable[..., Mapping[str, Any]],
        graph_state_config: Callable[[nx.DiGraph], Mapping[str, Any]],
        presets: Mapping[str, Mapping[str, float]],
    ):
        self._simulate = simulate_two_phase
        self._classify = classify_behavior
        self._evaluate = evaluate_config
        self._graph_state_config = graph_state_config
        self._presets = presets

    @classmethod
    def from_namespace(cls, namespace: Mapping[str, Any]) -> "NotebookEngineAdapter":
        missing = [name for name in cls._REQUIRED_NAMES if name not in namespace]
        if missing:
            raise ValueError(f"Notebook engine is missing required names: {', '.join(missing)}")
        return cls(
            simulate_two_phase=namespace["simulate_two_phase"],
            classify_behavior=namespace["classify_behavior"],
            evaluate_config=namespace["evaluate_config"],
            graph_state_config=namespace["graph_state_config"],
            presets=namespace["OPT_SCORE_PRESETS"],
        )

    @classmethod
    def default(cls) -> "NotebookEngineAdapter":
        try:
            import advanced_analysis as engine
        except ModuleNotFoundError:
            from backend import advanced_analysis as engine
        return cls.from_namespace(vars(engine))

    @property
    def presets(self) -> Mapping[str, Mapping[str, float]]:
        return self._presets

    def simulate(self, graph: nx.DiGraph, steps: int) -> Mapping[str, list[float | None]]:
        initial = {
            node: float(graph.nodes[node].get("start_amount", 0.0))
            for node in graph.nodes
        }
        return self._simulate(graph, initial, int(steps))

    def classify(self, history: Mapping[str, list[float | None]]) -> Mapping[str, str]:
        return self._classify(history)

    def evaluate(self, graph: nx.DiGraph, *, preset: str, steps: int) -> EngineEvaluation:
        if preset not in self._presets:
            raise ValueError(f"Unknown notebook score preset: {preset}")
        result = self._evaluate(
            graph,
            self._graph_state_config(graph),
            steps=int(steps),
            weights=dict(self._presets[preset]),
        )
        cost = float(result.get("total_score", result["score"]))
        # A bounded positive potential is suitable for gamma*Phi(s')-Phi(s).
        health = 1.0 / (1.0 + max(0.0, cost))
        return EngineEvaluation(
            cost=cost,
            health=health,
            components=dict(result.get("components", {})),
            classifications=dict(result.get("classifications", {})),
        )
