"""Seed-matched policy evaluation for Stage 5 learning experiments."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping

import numpy as np

from .agents import AgentPolicy
from .learning import EnvironmentFactory, legal_agent_moves


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
                    environment.reset(seed=seed + episode)
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
