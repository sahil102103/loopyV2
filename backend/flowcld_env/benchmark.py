"""Seed-matched policy evaluation for Stage 5 learning experiments."""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any, Callable, Mapping

import numpy as np

from .agents import AgentPolicy
from .learning import EnvironmentFactory, legal_agent_moves
from .structural import StructuralTransaction
from .types import NoOpAction, ParameterAction


AgentFactory = Callable[[int], AgentPolicy]


@dataclass(frozen=True)
class EvaluationCurve:
    name: str
    episode_mean: tuple[float, ...]
    episode_std: tuple[float, ...]
    returns_by_seed: tuple[tuple[float, ...], ...]

    @property
    def overall_mean(self) -> float:
        values = np.asarray(self.returns_by_seed, dtype=float)
        return float(np.mean(values)) if values.size else 0.0

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "overall_mean": self.overall_mean,
            "episode_mean": list(self.episode_mean),
            "episode_std": list(self.episode_std),
            "returns_by_seed": [list(values) for values in self.returns_by_seed],
        }


@dataclass(frozen=True)
class PolicyBenchmarkResult:
    seeds: tuple[int, ...]
    episodes: int
    curves: Mapping[str, EvaluationCurve]

    def to_dict(self) -> dict:
        return {
            "seeds": list(self.seeds),
            "episodes": self.episodes,
            "curves": {name: curve.to_dict() for name, curve in self.curves.items()},
        }


class PolicyEvaluationHarness:
    """Run policies under identical boards, objectives, seeds, and horizons."""

    def __init__(
        self,
        environment_factory: EnvironmentFactory,
        *,
        team_id: str,
        seeds: tuple[int, ...] = (11, 23, 37),
        episodes: int = 3,
    ):
        if not seeds or any(isinstance(seed, bool) or not isinstance(seed, int) for seed in seeds):
            raise ValueError("seeds must contain integers")
        if episodes < 1:
            raise ValueError("episodes must be positive")
        self.environment_factory = environment_factory
        self.team_id = str(team_id)
        self.seeds = tuple(seeds)
        self.episodes = int(episodes)

    def run(self, agents: Mapping[str, AgentFactory]) -> PolicyBenchmarkResult:
        if not agents:
            raise ValueError("At least one agent factory is required")
        curves = {}
        for name, agent_factory in agents.items():
            per_seed: list[tuple[float, ...]] = []
            for seed in self.seeds:
                agent = agent_factory(seed)
                episode_returns = []
                for episode in range(self.episodes):
                    environment = self.environment_factory()
                    episode_seed = seed + episode
                    environment.reset(seed=episode_seed)
                    resetter = getattr(agent, "reset", None)
                    if callable(resetter):
                        resetter(seed=episode_seed, training=False)
                    total = 0.0
                    while True:
                        legal = legal_agent_moves(environment, self.team_id)
                        if not legal:
                            break
                        move = environment.select_move(self.team_id, agent)
                        _, _, terminated, truncated, info = environment.step(move)
                        reward_payload = info["transition_rewards"][self.team_id]
                        total += float(reward_payload.get("reward", reward_payload.get("total")))
                        if terminated or truncated:
                            break
                    episode_returns.append(total)
                per_seed.append(tuple(episode_returns))
            values = np.asarray(per_seed, dtype=float)
            curves[name] = EvaluationCurve(
                name=name,
                episode_mean=tuple(float(value) for value in np.mean(values, axis=0)),
                episode_std=tuple(float(value) for value in np.std(values, axis=0)),
                returns_by_seed=tuple(per_seed),
            )
        return PolicyBenchmarkResult(
            seeds=self.seeds,
            episodes=self.episodes,
            curves=curves,
        )


@dataclass(frozen=True)
class PolicyEpisodeMetrics:
    cumulative_reward: float
    final_potential: float
    target_fit: float
    target_activity: float
    canonical_health: float
    spectral_target_success: float | None
    rejected_action_rate: float
    structural_edit_count: int
    action_cost: float
    runtime_seconds: float
    action_frequencies: Mapping[str, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "cumulative_reward": self.cumulative_reward,
            "final_potential": self.final_potential,
            "target_fit": self.target_fit,
            "target_activity": self.target_activity,
            "canonical_health": self.canonical_health,
            "spectral_target_success": self.spectral_target_success,
            "rejected_action_rate": self.rejected_action_rate,
            "structural_edit_count": self.structural_edit_count,
            "action_cost": self.action_cost,
            "runtime_seconds": self.runtime_seconds,
            "action_frequencies": dict(self.action_frequencies),
        }


@dataclass(frozen=True)
class DetailedPolicySummary:
    name: str
    episodes: tuple[PolicyEpisodeMetrics, ...]

    def metric(self, name: str) -> tuple[float, float]:
        values = [
            float(getattr(episode, name))
            for episode in self.episodes
            if getattr(episode, name) is not None
        ]
        if not values:
            return 0.0, 0.0
        return float(np.mean(values)), float(np.std(values))

    def to_dict(self) -> dict[str, Any]:
        metric_names = (
            "cumulative_reward", "final_potential", "target_fit", "target_activity",
            "canonical_health", "spectral_target_success",
            "rejected_action_rate", "structural_edit_count", "action_cost",
            "runtime_seconds",
        )
        frequencies: dict[str, int] = {}
        for episode in self.episodes:
            for family, count in episode.action_frequencies.items():
                frequencies[family] = frequencies.get(family, 0) + int(count)
        return {
            "name": self.name,
            "metrics": {
                metric: {"mean": self.metric(metric)[0], "std": self.metric(metric)[1]}
                for metric in metric_names
            },
            "action_frequencies": dict(sorted(frequencies.items())),
            "episodes": [episode.to_dict() for episode in self.episodes],
        }


@dataclass(frozen=True)
class DetailedPolicyBenchmarkResult:
    seeds: tuple[int, ...]
    policies: Mapping[str, DetailedPolicySummary]

    def to_dict(self) -> dict[str, Any]:
        return {
            "seeds": list(self.seeds),
            "policies": {
                name: summary.to_dict() for name, summary in self.policies.items()
            },
        }


class DetailedPolicyEvaluationHarness:
    """Collect auditable policy metrics without changing environment behavior."""

    def __init__(
        self,
        environment_factory: EnvironmentFactory,
        *,
        team_id: str,
        seeds: tuple[int, ...] = (101, 211, 307),
    ):
        if not seeds or any(isinstance(seed, bool) or not isinstance(seed, int) for seed in seeds):
            raise ValueError("seeds must contain integers")
        self.environment_factory = environment_factory
        self.team_id = str(team_id)
        self.seeds = tuple(seeds)

    def run(self, agents: Mapping[str, AgentFactory]) -> DetailedPolicyBenchmarkResult:
        summaries = {}
        for name, factory in agents.items():
            episodes = []
            for seed in self.seeds:
                environment = self.environment_factory()
                environment.reset(seed=seed)
                agent = factory(seed)
                resetter = getattr(agent, "reset", None)
                if callable(resetter):
                    resetter(seed=seed, training=False)
                rejected = 0
                attempted = 0
                structural_edits = 0
                action_cost = 0.0
                frequencies: dict[str, int] = {}
                started = time.perf_counter()
                while True:
                    if not legal_agent_moves(environment, self.team_id):
                        break
                    move = environment.select_move(self.team_id, agent)
                    family = self._action_family(move.action)
                    frequencies[family] = frequencies.get(family, 0) + 1
                    _, _, terminated, truncated, info = environment.step(move)
                    attempted += 1
                    accepted = bool(info.get("move", {}).get("accepted", True))
                    rejected += int(not accepted)
                    if accepted:
                        structural_edits += self._structural_units(move.action)
                    reward_payload = info["transition_rewards"][self.team_id]
                    components = reward_payload.get("components", {})
                    action_cost += max(0.0, -float(components.get("action_cost", 0.0)))
                    if terminated or truncated:
                        break
                runtime = time.perf_counter() - started
                current = environment.current_rewards[self.team_id]
                components = current.components
                episodes.append(PolicyEpisodeMetrics(
                    cumulative_reward=float(environment.cumulative_rewards[self.team_id]),
                    final_potential=float(current.total),
                    target_fit=float(components.get("target_fit", 0.0)),
                    target_activity=float(components.get("target_activity", 0.0)),
                    canonical_health=float(components.get("canonical_health", 0.0)),
                    spectral_target_success=(
                        float(components["spectral_target_met"])
                        if "spectral_target_met" in components else None
                    ),
                    rejected_action_rate=(rejected / attempted if attempted else 0.0),
                    structural_edit_count=structural_edits,
                    action_cost=action_cost,
                    runtime_seconds=runtime,
                    action_frequencies=frequencies,
                ))
            summaries[name] = DetailedPolicySummary(name=name, episodes=tuple(episodes))
        return DetailedPolicyBenchmarkResult(seeds=self.seeds, policies=summaries)

    @staticmethod
    def _action_family(action) -> str:
        if isinstance(action, NoOpAction):
            return "no_op"
        if isinstance(action, ParameterAction):
            return f"parameter:{action.parameter.value}"
        if isinstance(action, StructuralTransaction):
            kinds = "+".join(sorted(edit.kind.value for edit in action.edits))
            return f"structural_transaction:{kinds}"
        kind = getattr(action, "kind", None)
        return f"structural:{getattr(kind, 'value', type(action).__name__)}"

    @staticmethod
    def _structural_units(action) -> int:
        if isinstance(action, (NoOpAction, ParameterAction)):
            return 0
        if isinstance(action, StructuralTransaction):
            return len(action.edits)
        return 1
