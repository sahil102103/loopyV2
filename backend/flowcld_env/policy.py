"""Serializable policies, training summaries, and resumable checkpoints."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .evaluation import ConfigurationEvaluation
from .types import MutationMode, ParameterAction, ParameterName


def _write_json(path: str | Path, payload: Mapping[str, Any]) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(destination)
    return destination


def _action_from_dict(payload: Mapping[str, Any]) -> ParameterAction:
    target_data = payload["target"]
    target = tuple(target_data) if isinstance(target_data, list) else str(target_data)
    return ParameterAction(
        parameter=ParameterName(payload["parameter"]),
        target=target,
        value=float(payload["value"]),
        mode=MutationMode(payload.get("mode", MutationMode.SET.value)),
    )


@dataclass(frozen=True)
class LearnedParameterPolicy:
    """Best complete parameter configuration learned by the Stage 2 agent."""

    role: str
    actions: tuple[ParameterAction, ...]
    reward: float
    seed: int
    algorithm: str = "cross_entropy"
    version: int = 1
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "algorithm": self.algorithm,
            "role": self.role,
            "reward": self.reward,
            "seed": self.seed,
            "actions": [action.to_dict() for action in self.actions],
            "metadata": dict(self.metadata),
        }

    def save(self, path: str | Path) -> Path:
        return _write_json(path, self.to_dict())

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "LearnedParameterPolicy":
        if int(payload.get("version", 0)) != 1:
            raise ValueError("Unsupported learned-policy version")
        return cls(
            role=str(payload["role"]),
            actions=tuple(_action_from_dict(action) for action in payload.get("actions", [])),
            reward=float(payload["reward"]),
            seed=int(payload["seed"]),
            algorithm=str(payload.get("algorithm", "cross_entropy")),
            version=1,
            metadata=dict(payload.get("metadata", {})),
        )

    @classmethod
    def load(cls, path: str | Path) -> "LearnedParameterPolicy":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


@dataclass(frozen=True)
class TrainingIteration:
    iteration: int
    best_reward: float
    mean_reward: float
    global_best_reward: float
    mean_std: float

    def to_dict(self) -> dict[str, float | int]:
        return {
            "iteration": self.iteration,
            "best_reward": self.best_reward,
            "mean_reward": self.mean_reward,
            "global_best_reward": self.global_best_reward,
            "mean_std": self.mean_std,
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "TrainingIteration":
        return cls(
            iteration=int(payload["iteration"]),
            best_reward=float(payload["best_reward"]),
            mean_reward=float(payload["mean_reward"]),
            global_best_reward=float(payload["global_best_reward"]),
            mean_std=float(payload["mean_std"]),
        )


@dataclass(frozen=True)
class OptimizerCheckpoint:
    """Complete state required to continue cross-entropy training."""

    signature: str
    iteration: int
    dimension_keys: tuple[str, ...]
    mean: tuple[float, ...]
    std: tuple[float, ...]
    best_values: tuple[float, ...]
    best_reward: float
    rng_state: Mapping[str, Any]
    history: tuple[TrainingIteration, ...]
    version: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "signature": self.signature,
            "iteration": self.iteration,
            "dimension_keys": list(self.dimension_keys),
            "mean": list(self.mean),
            "std": list(self.std),
            "best_values": list(self.best_values),
            "best_reward": self.best_reward,
            "rng_state": dict(self.rng_state),
            "history": [item.to_dict() for item in self.history],
        }

    def save(self, path: str | Path) -> Path:
        return _write_json(path, self.to_dict())

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "OptimizerCheckpoint":
        if int(payload.get("version", 0)) != 1:
            raise ValueError("Unsupported optimizer-checkpoint version")
        return cls(
            signature=str(payload["signature"]),
            iteration=int(payload["iteration"]),
            dimension_keys=tuple(str(key) for key in payload["dimension_keys"]),
            mean=tuple(float(value) for value in payload["mean"]),
            std=tuple(float(value) for value in payload["std"]),
            best_values=tuple(float(value) for value in payload["best_values"]),
            best_reward=float(payload["best_reward"]),
            rng_state=dict(payload["rng_state"]),
            history=tuple(TrainingIteration.from_dict(item) for item in payload.get("history", [])),
            version=1,
        )

    @classmethod
    def load(cls, path: str | Path) -> "OptimizerCheckpoint":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


@dataclass(frozen=True)
class SingleAgentOptimizationResult:
    policy: LearnedParameterPolicy
    baseline: ConfigurationEvaluation
    optimized: ConfigurationEvaluation
    history: Sequence[TrainingIteration]
    unique_evaluations: int

    @property
    def reward_improvement(self) -> float:
        return self.optimized.reward.total - self.baseline.reward.total

    def to_dict(self) -> dict[str, Any]:
        return {
            "policy": self.policy.to_dict(),
            "baseline_reward": self.baseline.reward.total,
            "optimized_reward": self.optimized.reward.total,
            "reward_improvement": self.reward_improvement,
            "reward_components": dict(self.optimized.reward.components),
            "classifications": dict(self.optimized.observation.classifications),
            "history": [item.to_dict() for item in self.history],
            "unique_evaluations": self.unique_evaluations,
        }
