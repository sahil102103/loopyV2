"""Handoff-aligned objective values and transition rewards."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Mapping

import networkx as nx
import numpy as np

from .engine import EngineAdapter, EngineEvaluation, NotebookEngineAdapter
from .stability import NotebookSpectralAnalyzer
from .structural import RemoveEdgeAction, RemoveNodeAction, StructuralTransaction
from .types import EnvironmentObservation, NoOpAction, Objective, ObjectiveOrientation, ParameterAction


@dataclass(frozen=True)
class ObjectiveStateEvaluation:
    """One team's signed potential for a graph state."""

    potential: float
    components: Mapping[str, float]
    engine: EngineEvaluation


@dataclass(frozen=True)
class ObjectiveTransitionEvaluation:
    """Potential-based transition reward plus explicit action costs."""

    reward: float
    components: Mapping[str, float]
    after: ObjectiveStateEvaluation


@dataclass(frozen=True)
class ObjectiveWeightProfile:
    """Named, normalized weights for the team's stabilizer potential."""

    name: str
    canonical_health: float
    target_fit: float
    target_activity: float
    spectral_target_fit: float = 0.0

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("Objective weight profile name must be non-empty")
        values = self.as_dict()
        if any(not math.isfinite(value) or value < 0.0 for value in values.values()):
            raise ValueError("Objective weights must be non-negative finite numbers")
        if not math.isclose(sum(values.values()), 1.0, rel_tol=0.0, abs_tol=1e-9):
            raise ValueError("Objective weights must sum to 1")

    def as_dict(self) -> dict[str, float]:
        return {
            "canonical_health": float(self.canonical_health),
            "target_fit": float(self.target_fit),
            "target_activity": float(self.target_activity),
            "spectral_target_fit": float(self.spectral_target_fit),
        }

    def score(self, components: Mapping[str, float]) -> float:
        return float(sum(
            weight * float(components.get(component, 0.0))
            for component, weight in self.as_dict().items()
        ))

    def without(self, component: str) -> "ObjectiveWeightProfile":
        """Return a normalized leave-one-component-out ablation profile."""

        values = self.as_dict()
        if component not in values:
            raise ValueError(f"Unknown objective component: {component}")
        if values[component] <= 0.0:
            raise ValueError(f"Objective component is already inactive: {component}")
        values[component] = 0.0
        remaining = sum(values.values())
        if remaining <= 0.0:
            raise ValueError("Cannot ablate the only active objective component")
        normalized = {name: value / remaining for name, value in values.items()}
        return ObjectiveWeightProfile(
            name=f"{self.name}:without_{component}",
            **normalized,
        )


DEFAULT_OBJECTIVE_WEIGHTS = ObjectiveWeightProfile(
    name="current_65_25_10",
    canonical_health=0.65,
    target_fit=0.25,
    target_activity=0.10,
)

DEFAULT_SPECTRAL_OBJECTIVE_WEIGHTS = ObjectiveWeightProfile(
    name="current_spectral_45_15_10_30",
    canonical_health=0.45,
    target_fit=0.15,
    target_activity=0.10,
    spectral_target_fit=0.30,
)


class ObjectiveEvaluator:
    """Combines canonical notebook health with localized target fit."""

    def __init__(
        self,
        engine: EngineAdapter | None = None,
        *,
        horizon: int = 200,
        spectral_analyzer: NotebookSpectralAnalyzer | None = None,
        weights: ObjectiveWeightProfile = DEFAULT_OBJECTIVE_WEIGHTS,
        spectral_weights: ObjectiveWeightProfile = DEFAULT_SPECTRAL_OBJECTIVE_WEIGHTS,
    ):
        if horizon < 1:
            raise ValueError("horizon must be positive")
        self._engine = engine or NotebookEngineAdapter.default()
        self._horizon = int(horizon)
        self._spectral_analyzer = spectral_analyzer or NotebookSpectralAnalyzer()
        self._weights = weights
        self._spectral_weights = spectral_weights
        self._engine_cache: dict[tuple[Any, ...], EngineEvaluation] = {}

    def weights_for(self, objective: Objective) -> ObjectiveWeightProfile:
        """Return the exact profile used for this objective contract."""

        return (
            self._spectral_weights
            if objective.target.spectral_radius is not None
            else self._weights
        )

    def evaluate_state(
        self,
        graph: nx.DiGraph,
        observation: EnvironmentObservation,
        objective: Objective,
    ) -> ObjectiveStateEvaluation:
        engine_evaluation = self._engine_evaluation(graph, objective.preset)
        target_fit = self._target_fit(observation, objective)
        activity = self._localized_activity(observation, objective)
        spectral_evaluation = None
        if objective.target.spectral_radius is not None:
            spectral_evaluation = self._spectral_analyzer.evaluate_target(
                graph, objective.target.spectral_radius
            )
        raw_components = {
            "canonical_health": float(engine_evaluation.health),
            "target_fit": float(target_fit),
            "target_activity": float(activity),
            "spectral_target_fit": (
                float(spectral_evaluation.fit) if spectral_evaluation is not None else 0.0
            ),
        }
        weight_profile = self.weights_for(objective)
        stabilizer_potential = weight_profile.score(raw_components)
        orientation_sign = (
            1.0 if objective.orientation == ObjectiveOrientation.STABILIZE else -1.0
        )
        potential = orientation_sign * stabilizer_potential
        components = {
            "canonical_cost": engine_evaluation.cost,
            **raw_components,
            **{
                f"weight_{name}": value
                for name, value in weight_profile.as_dict().items()
            },
            "orientation_sign": orientation_sign,
            "potential": potential,
        }
        if spectral_evaluation is not None:
            components.update({
                "spectral_radius": spectral_evaluation.radius,
                "spectral_target": spectral_evaluation.target,
                "spectral_excess": spectral_evaluation.excess,
                "spectral_target_fit": spectral_evaluation.fit,
                "spectral_target_met": float(spectral_evaluation.met),
            })
        return ObjectiveStateEvaluation(
            potential=float(potential),
            components=components,
            engine=engine_evaluation,
        )

    def _engine_evaluation(self, graph: nx.DiGraph, preset: str) -> EngineEvaluation:
        node_state = tuple(sorted(
            (
                str(node),
                float(data.get("start_amount", 0.0)),
                float(data.get("retention", 0.0)),
                repr(data.get("floor", float("-inf"))),
                repr(data.get("ceiling", float("inf"))),
                str(data.get("formula") or ""),
                str(data.get("sink_formula") or ""),
                str(data.get("source_formula") or ""),
            )
            for node, data in graph.nodes(data=True)
        ))
        edge_state = tuple(sorted(
            (
                str(source), str(target),
                float(data.get("correlation", 1.0)),
                float(data.get("decay", 0.0)),
                int(data.get("delay", 0)),
                float(data.get("confidence", 1.0)),
                str(data.get("functional_form", "linear")),
            )
            for source, target, data in graph.edges(data=True)
        ))
        key = (preset, self._horizon, node_state, edge_state)
        cached = self._engine_cache.get(key)
        if cached is not None:
            return cached
        evaluation = self._engine.evaluate(graph, preset=preset, steps=self._horizon)
        if len(self._engine_cache) >= 512:
            self._engine_cache.pop(next(iter(self._engine_cache)))
        self._engine_cache[key] = evaluation
        return evaluation

    def evaluate_transition(
        self,
        *,
        before: ObjectiveStateEvaluation,
        after_graph: nx.DiGraph,
        after_observation: EnvironmentObservation,
        objective: Objective,
        action: Any,
        action_accepted: bool,
        charge_action: bool = True,
        before_value: Any = None,
        after_value: Any = None,
    ) -> ObjectiveTransitionEvaluation:
        after = self.evaluate_state(after_graph, after_observation, objective)
        shaping = objective.gamma * after.potential - before.potential
        action_cost = self._action_cost(
            objective, action, before_value=before_value, after_value=after_value
        ) if action_accepted and charge_action else 0.0
        invalid_penalty = 0.0 if action_accepted or not charge_action else -1.0
        reward = shaping - action_cost + invalid_penalty
        return ObjectiveTransitionEvaluation(
            reward=float(reward),
            components={
                **after.components,
                "potential_shaping": float(shaping),
                "action_cost": -float(action_cost),
                "invalid_action": invalid_penalty,
            },
            after=after,
        )

    def action_cost(
        self,
        objective: Objective,
        action: Any,
        *,
        before_value: Any = None,
        after_value: Any = None,
    ) -> float:
        """Expose the canonical transition cost for validation studies."""

        return self._action_cost(
            objective,
            action,
            before_value=before_value,
            after_value=after_value,
        )

    @staticmethod
    def _target_fit(observation: EnvironmentObservation, objective: Objective) -> float:
        scores = []
        for node, desired_values in objective.target.trajectories.items():
            actual_values = observation.history.get(node)
            desired = np.asarray(tuple(desired_values), dtype=float)
            if actual_values is None or not desired.size:
                scores.append(0.0)
                continue
            actual = np.asarray(tuple(actual_values[: desired.size]), dtype=float)
            if actual.size != desired.size or not np.all(np.isfinite(actual)):
                scores.append(0.0)
                continue
            scale = max(float(np.ptp(desired)), float(np.mean(np.abs(desired))), 1e-9)
            normalized_rmse = float(np.sqrt(np.mean((actual - desired) ** 2))) / scale
            scores.append(float(math.exp(-normalized_rmse)))
        for node, desired_behavior in objective.target.behaviors.items():
            scores.append(float(observation.classifications.get(node) == desired_behavior))
        return float(np.mean(scores)) if scores else 1.0

    @staticmethod
    def _localized_activity(
        observation: EnvironmentObservation,
        objective: Objective,
    ) -> float:
        selected = set(objective.target_nodes)
        if not selected:
            selected = set(objective.target.trajectories) | set(objective.target.behaviors)
        if not selected:
            selected = set(observation.nodes)
        active = []
        for node in selected:
            values = np.asarray([
                value for value in observation.history.get(node, ()) if value is not None
            ], dtype=float)
            active.append(float(values.size > 0 and np.all(np.isfinite(values)) and abs(values[-1]) > 1e-8))
        return float(np.mean(active)) if active else 0.0

    @staticmethod
    def _action_cost(
        objective: Objective,
        action: Any,
        *,
        before_value: Any,
        after_value: Any,
    ) -> float:
        if isinstance(action, NoOpAction):
            return 0.0
        if isinstance(action, StructuralTransaction):
            edit_count = max(1, len(action.edits))
            removed_edges = sum(isinstance(edit, RemoveEdgeAction) for edit in action.edits)
            removed_nodes = sum(isinstance(edit, RemoveNodeAction) for edit in action.edits)
            # Structural cost is transaction-level. A mild linear complexity
            # surcharge keeps useful atomic motifs competitive while charging
            # node deletion more heavily than reversible edge replacement.
            complexity = 1.0 + 0.15 * (edit_count - 1)
            destructive = 0.25 * removed_edges + 1.0 * removed_nodes
            return float(objective.structural_move_cost) * (complexity + destructive)
        if not isinstance(action, ParameterAction):
            multiplier = 2.0 if isinstance(action, RemoveNodeAction) else (
                1.25 if isinstance(action, RemoveEdgeAction) else 1.0
            )
            return float(objective.structural_move_cost) * multiplier
        base = float(objective.parameter_move_cost)
        try:
            before = float(before_value)
            after = float(after_value)
            relative_change = abs(after - before) / max(1.0, abs(before))
        except (TypeError, ValueError):
            relative_change = abs(float(action.value))
        # Convex but capped so a single malformed scale cannot dominate an episode.
        amplitude = min(4.0, relative_change)
        return base * (1.0 + amplitude * amplitude)
