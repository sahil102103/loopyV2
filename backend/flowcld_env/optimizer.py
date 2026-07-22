"""Bounded single-agent target optimization using cross-entropy search."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path
from typing import Mapping

import numpy as np

from .evaluation import ConfigurationEvaluation, ParameterConfigurationEvaluator
from .policy import (
    LearnedParameterPolicy,
    OptimizerCheckpoint,
    SingleAgentOptimizationResult,
    TrainingIteration,
)
from .types import ActionSlot, MutationMode, ParameterAction, ParameterName


DEFAULT_OPTIMIZED_PARAMETERS = frozenset({
    ParameterName.START_AMOUNT,
    ParameterName.RETENTION,
    ParameterName.DECAY,
    ParameterName.DELAY,
    ParameterName.CORRELATION,
})


@dataclass(frozen=True)
class SingleAgentTrainingSettings:
    """Hyperparameters and scope for bounded cross-entropy training."""

    iterations: int = 12
    population_size: int = 24
    elite_fraction: float = 0.2
    update_rate: float = 0.7
    initial_std_fraction: float = 0.2
    minimum_std_fraction: float = 0.01
    start_amount_radius: float = 1.0
    boundary_probes: bool = True
    seed: int = 42
    parameters: frozenset[ParameterName] = field(
        default_factory=lambda: DEFAULT_OPTIMIZED_PARAMETERS
    )
    selected_slot_keys: frozenset[str] | None = None
    bounds_overrides: Mapping[str, tuple[float, float]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.iterations < 1:
            raise ValueError("iterations must be positive")
        if self.population_size < 2:
            raise ValueError("population_size must be at least 2")
        if not 0.0 < self.elite_fraction <= 1.0:
            raise ValueError("elite_fraction must be in (0, 1]")
        if not 0.0 < self.update_rate <= 1.0:
            raise ValueError("update_rate must be in (0, 1]")
        if not 0.0 < self.initial_std_fraction <= 1.0:
            raise ValueError("initial_std_fraction must be in (0, 1]")
        if not 0.0 < self.minimum_std_fraction <= self.initial_std_fraction:
            raise ValueError("minimum_std_fraction must be positive and no larger than initial_std_fraction")
        if self.start_amount_radius <= 0:
            raise ValueError("start_amount_radius must be positive")
        if not self.parameters:
            raise ValueError("Select at least one parameter type")


@dataclass(frozen=True)
class SearchDimension:
    slot: ActionSlot
    initial: float
    minimum: float
    maximum: float

    def action(self, value: float) -> ParameterAction:
        selected = float(round(value)) if self.slot.integer else float(value)
        return ParameterAction(
            parameter=self.slot.parameter,
            target=self.slot.target,
            value=selected,
            mode=MutationMode.SET,
        )


class SingleAgentTargetOptimizer:
    """Learns a complete, reusable parameter policy for one authorized role."""

    def __init__(
        self,
        evaluator: ParameterConfigurationEvaluator,
        settings: SingleAgentTrainingSettings | None = None,
    ):
        self._evaluator = evaluator
        self._settings = settings or SingleAgentTrainingSettings()
        self._dimensions = self._build_dimensions()
        if not self._dimensions:
            raise ValueError("The selected role and scope expose no optimizable parameter dimensions")
        self._signature = self._training_signature()

    @property
    def dimensions(self) -> tuple[SearchDimension, ...]:
        return self._dimensions

    def train(
        self,
        *,
        checkpoint_path: str | Path | None = None,
        resume_from: str | Path | OptimizerCheckpoint | None = None,
    ) -> SingleAgentOptimizationResult:
        settings = self._settings
        lower = np.asarray([dimension.minimum for dimension in self._dimensions], dtype=float)
        upper = np.asarray([dimension.maximum for dimension in self._dimensions], dtype=float)
        widths = upper - lower
        integer_columns = np.asarray([dimension.slot.integer for dimension in self._dimensions])
        minimum_std = np.maximum(widths * settings.minimum_std_fraction, np.where(integer_columns, 0.5, 1e-9))

        rng = np.random.default_rng(settings.seed)
        mean = np.asarray([dimension.initial for dimension in self._dimensions], dtype=float)
        std = np.maximum(widths * settings.initial_std_fraction, minimum_std)
        best_values = mean.copy()
        baseline = self._evaluator.evaluate(())
        best_evaluation = self._evaluate_values(best_values)
        best_reward = best_evaluation.reward.total
        history: list[TrainingIteration] = []
        start_iteration = 0

        if resume_from is not None:
            checkpoint = (
                resume_from
                if isinstance(resume_from, OptimizerCheckpoint)
                else OptimizerCheckpoint.load(resume_from)
            )
            self._validate_checkpoint(checkpoint)
            mean = np.asarray(checkpoint.mean, dtype=float)
            std = np.asarray(checkpoint.std, dtype=float)
            best_values = np.asarray(checkpoint.best_values, dtype=float)
            best_reward = checkpoint.best_reward
            best_evaluation = self._evaluate_values(best_values)
            history = list(checkpoint.history)
            start_iteration = checkpoint.iteration + 1
            rng.bit_generator.state = dict(checkpoint.rng_state)

        cache: dict[tuple[float, ...], ConfigurationEvaluation] = {}

        def evaluate(values: np.ndarray) -> ConfigurationEvaluation:
            key = tuple(float(round(value, 12)) for value in values)
            if key not in cache:
                cache[key] = self._evaluate_values(values)
            return cache[key]

        elite_count = max(1, int(math.ceil(settings.population_size * settings.elite_fraction)))
        for iteration in range(start_iteration, settings.iterations):
            samples = rng.normal(mean, std, size=(settings.population_size, len(self._dimensions)))
            samples = np.clip(samples, lower, upper)
            samples[:, integer_columns] = np.rint(samples[:, integer_columns])
            samples[0] = mean
            if settings.population_size > 1:
                samples[1] = best_values
            if settings.boundary_probes:
                cursor = 2
                for column in range(len(self._dimensions)):
                    if cursor < settings.population_size:
                        samples[cursor] = mean
                        samples[cursor, column] = lower[column]
                        cursor += 1
                    if cursor < settings.population_size:
                        samples[cursor] = mean
                        samples[cursor, column] = upper[column]
                        cursor += 1
            samples = np.clip(samples, lower, upper)
            samples[:, integer_columns] = np.rint(samples[:, integer_columns])

            evaluations = [evaluate(sample) for sample in samples]
            rewards = np.asarray([item.reward.total for item in evaluations], dtype=float)
            elite_indices = np.argsort(rewards)[-elite_count:]
            elite_samples = samples[elite_indices]
            elite_mean = np.mean(elite_samples, axis=0)
            elite_std = np.std(elite_samples, axis=0)
            mean = (1.0 - settings.update_rate) * mean + settings.update_rate * elite_mean
            std = np.maximum(
                (1.0 - settings.update_rate) * std + settings.update_rate * elite_std,
                minimum_std,
            )
            mean = np.clip(mean, lower, upper)

            iteration_best_index = int(np.argmax(rewards))
            iteration_best_reward = float(rewards[iteration_best_index])
            if iteration_best_reward > best_reward:
                best_reward = iteration_best_reward
                best_values = samples[iteration_best_index].copy()
                best_evaluation = evaluations[iteration_best_index]

            history.append(TrainingIteration(
                iteration=iteration,
                best_reward=iteration_best_reward,
                mean_reward=float(np.mean(rewards)),
                global_best_reward=best_reward,
                mean_std=float(np.mean(std)),
            ))
            if checkpoint_path is not None:
                self._checkpoint(
                    iteration=iteration,
                    mean=mean,
                    std=std,
                    best_values=best_values,
                    best_reward=best_reward,
                    rng=rng,
                    history=history,
                ).save(checkpoint_path)

        actions = self._actions_for(best_values)
        # Re-evaluate from the immutable baseline for the final report, even if
        # the best candidate came from a resumed checkpoint.
        best_evaluation = self._evaluator.evaluate(actions)
        policy = LearnedParameterPolicy(
            role=self._evaluator.role,
            actions=actions,
            reward=best_evaluation.reward.total,
            seed=settings.seed,
            metadata={
                "iterations_completed": len(history),
                "population_size": settings.population_size,
                "dimensions": [dimension.slot.key for dimension in self._dimensions],
                "baseline_fingerprint": self._evaluator.baseline_fingerprint,
                "training_signature": self._signature,
            },
        )
        return SingleAgentOptimizationResult(
            policy=policy,
            baseline=baseline,
            optimized=best_evaluation,
            history=tuple(history),
            unique_evaluations=len(cache),
        )

    def _build_dimensions(self) -> tuple[SearchDimension, ...]:
        settings = self._settings
        dimensions: list[SearchDimension] = []
        for slot in self._evaluator.available_slots(settings.parameters):
            if settings.selected_slot_keys is not None and slot.key not in settings.selected_slot_keys:
                continue
            initial = self._evaluator.baseline_value(slot)
            minimum, maximum = float(slot.minimum), float(slot.maximum)
            if slot.parameter == ParameterName.START_AMOUNT and slot.key not in settings.bounds_overrides:
                radius = max(abs(initial) * settings.start_amount_radius, 1.0)
                minimum = max(minimum, initial - radius)
                maximum = min(maximum, initial + radius)
            if slot.key in settings.bounds_overrides:
                requested_min, requested_max = settings.bounds_overrides[slot.key]
                minimum = max(minimum, float(requested_min))
                maximum = min(maximum, float(requested_max))
            if not math.isfinite(minimum) or not math.isfinite(maximum) or minimum >= maximum:
                raise ValueError(f"Invalid search bounds for {slot.key}: ({minimum}, {maximum})")
            dimensions.append(SearchDimension(
                slot=slot,
                initial=float(np.clip(initial, minimum, maximum)),
                minimum=minimum,
                maximum=maximum,
            ))
        return tuple(dimensions)

    def _actions_for(self, values: np.ndarray) -> tuple[ParameterAction, ...]:
        return tuple(
            dimension.action(float(value)) for dimension, value in zip(self._dimensions, values)
        )

    def _evaluate_values(self, values: np.ndarray) -> ConfigurationEvaluation:
        evaluation = self._evaluator.evaluate(self._actions_for(values))
        if not evaluation.accepted:
            raise RuntimeError(f"Optimizer generated an invalid candidate: {evaluation.reason}")
        return evaluation

    def _training_signature(self) -> str:
        settings = self._settings
        payload = {
            "algorithm": "cross_entropy_v1",
            "role": self._evaluator.role,
            "evaluation": self._evaluator.evaluation_fingerprint,
            "target": {
                "trajectories": {
                    node: list(values) for node, values in self._evaluator.target.trajectories.items()
                },
                "behaviors": dict(self._evaluator.target.behaviors),
            },
            "dimensions": [
                {
                    "key": dimension.slot.key,
                    "minimum": dimension.minimum,
                    "maximum": dimension.maximum,
                    "integer": dimension.slot.integer,
                }
                for dimension in self._dimensions
            ],
            "population_size": settings.population_size,
            "elite_fraction": settings.elite_fraction,
            "update_rate": settings.update_rate,
            "initial_std_fraction": settings.initial_std_fraction,
            "minimum_std_fraction": settings.minimum_std_fraction,
            "boundary_probes": settings.boundary_probes,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def _validate_checkpoint(self, checkpoint: OptimizerCheckpoint) -> None:
        if checkpoint.signature != self._signature:
            raise ValueError("Checkpoint does not match this graph, target, role, or search space")
        expected_keys = tuple(dimension.slot.key for dimension in self._dimensions)
        if checkpoint.dimension_keys != expected_keys:
            raise ValueError("Checkpoint dimensions do not match the optimizer")
        if checkpoint.iteration >= self._settings.iterations:
            # This is valid: training is already complete for the requested run.
            return

    def _checkpoint(
        self,
        *,
        iteration: int,
        mean: np.ndarray,
        std: np.ndarray,
        best_values: np.ndarray,
        best_reward: float,
        rng: np.random.Generator,
        history: list[TrainingIteration],
    ) -> OptimizerCheckpoint:
        return OptimizerCheckpoint(
            signature=self._signature,
            iteration=iteration,
            dimension_keys=tuple(dimension.slot.key for dimension in self._dimensions),
            mean=tuple(float(value) for value in mean),
            std=tuple(float(value) for value in std),
            best_values=tuple(float(value) for value in best_values),
            best_reward=float(best_reward),
            rng_state=dict(rng.bit_generator.state),
            history=tuple(history),
        )
