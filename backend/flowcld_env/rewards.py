"""Composable reward components for target-seeking FlowCLD episodes."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable, Protocol

import numpy as np

from .types import EnvironmentObservation, RewardEvaluation, TargetSpecification


@dataclass(frozen=True)
class RewardContext:
    observation: EnvironmentObservation
    target: TargetSpecification
    action_accepted: bool


class RewardComponent(Protocol):
    @property
    def name(self) -> str:
        """Stable component name included in logs and diagnostics."""

    def evaluate(self, context: RewardContext) -> float:
        """Return this component's signed reward contribution."""


@dataclass(frozen=True)
class TrajectoryMatchReward:
    """Negative mean normalized RMSE against requested node trajectories."""

    weight: float = 1.0
    name: str = "trajectory_match"

    def evaluate(self, context: RewardContext) -> float:
        errors: list[float] = []
        for node, desired_values in context.target.trajectories.items():
            actual_values = context.observation.history.get(node)
            if actual_values is None:
                errors.append(1.0)
                continue
            desired = np.asarray(tuple(desired_values), dtype=float)
            actual = np.asarray(tuple(actual_values[: len(desired)]), dtype=float)
            if desired.size == 0 or actual.size != desired.size or not np.all(np.isfinite(actual)):
                errors.append(1.0)
                continue
            scale = max(float(np.ptp(desired)), float(np.mean(np.abs(desired))), 1e-9)
            rmse = float(np.sqrt(np.mean((actual - desired) ** 2)))
            errors.append(rmse / scale)
        return -self.weight * (float(np.mean(errors)) if errors else 0.0)


@dataclass(frozen=True)
class BehaviorMatchReward:
    """Positive reward for matching requested notebook behavior classes."""

    weight: float = 0.5
    name: str = "behavior_match"

    def evaluate(self, context: RewardContext) -> float:
        requested = context.target.behaviors
        if not requested:
            return 0.0
        matches = sum(
            context.observation.classifications.get(node) == behavior
            for node, behavior in requested.items()
        )
        return self.weight * matches / len(requested)


@dataclass(frozen=True)
class StabilityPenalty:
    """Penalty for sustained late-window divergence.

    The notebook behavior classifier can label a zero-to-plateau response as
    ``Unconstrained`` because its early mean is near zero. Rewards must not
    optimize that startup artifact, so an unconstrained label is confirmed by
    positive exponential growth in the tail before it is penalized.
    """

    weight: float = 1.0
    growth_ratio: float = 3.0
    log_slope_threshold: float = 0.15
    name: str = "stability"

    def evaluate(self, context: RewardContext) -> float:
        histories = context.observation.history
        if not histories:
            return 0.0
        unstable = 0
        for node, series in histories.items():
            if context.observation.classifications.get(node) != "Unconstrained":
                continue
            values = np.asarray([value for value in series if value is not None], dtype=float)
            if values.size == 0 or not np.all(np.isfinite(values)):
                unstable += 1
                continue
            window = min(values.size, max(4, values.size // 4))
            tail = np.abs(values[-window:])
            if tail.size < 4:
                continue
            split = max(1, tail.size // 2)
            early_level = float(np.mean(tail[:split]))
            late_level = float(np.mean(tail[split:]))
            ratio = late_level / max(early_level, 1e-12)
            slope = float(np.polyfit(np.arange(tail.size), np.log(tail + 1e-12), 1)[0])
            if ratio >= self.growth_ratio and slope > self.log_slope_threshold:
                unstable += 1
        return -self.weight * unstable / len(histories)


@dataclass(frozen=True)
class ActivityPenalty:
    """Small penalty when non-targeted nodes have effectively no movement."""

    weight: float = 0.1
    relative_tolerance: float = 0.01
    name: str = "activity"

    def evaluate(self, context: RewardContext) -> float:
        inactive = 0
        considered = 0
        targeted = set(context.target.trajectories)
        for node, series in context.observation.history.items():
            if node in targeted:
                continue
            values = np.asarray([value for value in series if value is not None], dtype=float)
            if values.size == 0 or not np.all(np.isfinite(values)):
                inactive += 1
                considered += 1
                continue
            considered += 1
            scale = max(float(np.max(np.abs(values))), 1e-12)
            if float(np.ptp(values)) / scale < self.relative_tolerance:
                inactive += 1
        return -self.weight * inactive / considered if considered else 0.0


@dataclass(frozen=True)
class InvalidActionPenalty:
    """Fixed penalty for rejected or unauthorized actions."""

    weight: float = 1.0
    name: str = "invalid_action"

    def evaluate(self, context: RewardContext) -> float:
        return 0.0 if context.action_accepted else -abs(self.weight)


@dataclass(frozen=True)
class StructuralPreservationPenalty:
    """Soft penalty for shrinking a graph even when hard constraints permit it."""

    baseline_nodes: int
    baseline_edges: int
    weight: float = 0.5
    name: str = "structural_preservation"

    def __post_init__(self) -> None:
        if self.baseline_nodes < 1 or self.baseline_edges < 0:
            raise ValueError("Baseline graph counts are invalid")

    def evaluate(self, context: RewardContext) -> float:
        node_loss = max(0.0, 1.0 - len(context.observation.nodes) / self.baseline_nodes)
        edge_loss = (
            max(0.0, 1.0 - len(context.observation.edges) / self.baseline_edges)
            if self.baseline_edges
            else 0.0
        )
        return -self.weight * (0.5 * node_loss + 0.5 * edge_loss)


class RewardModel(Protocol):
    def evaluate(self, context: RewardContext) -> RewardEvaluation:
        """Evaluate all reward components."""


class CompositeRewardModel:
    """Open-ended composition of independently testable reward components."""

    def __init__(self, components: Iterable[RewardComponent] | None = None):
        selected = tuple(components) if components is not None else default_reward_components()
        names = [component.name for component in selected]
        if len(names) != len(set(names)):
            raise ValueError("Reward component names must be unique")
        self._components = selected

    @property
    def components(self) -> tuple[RewardComponent, ...]:
        return self._components

    def evaluate(self, context: RewardContext) -> RewardEvaluation:
        contributions = {
            component.name: float(component.evaluate(context)) for component in self._components
        }
        total = float(sum(contributions.values()))
        if not math.isfinite(total):
            raise ValueError("Reward model produced a non-finite result")
        return RewardEvaluation(total=total, components=contributions)


def default_reward_components() -> tuple[RewardComponent, ...]:
    """Return fresh default components for extension by specialized environments."""

    return (
        TrajectoryMatchReward(),
        BehaviorMatchReward(),
        StabilityPenalty(),
        ActivityPenalty(),
        InvalidActionPenalty(),
    )
