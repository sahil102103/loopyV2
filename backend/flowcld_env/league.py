"""Frozen-policy league evaluation and empirical exploitability estimates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np

from .agents import AgentPolicy
from .learning import EnvironmentFactory, OpponentFactory, legal_agent_moves


@dataclass(frozen=True)
class PolicyProfile:
    """One fixed policy assignment for every team in an evaluation game."""

    name: str
    agent_factories: Mapping[str, OpponentFactory]

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("Policy profile name must be non-empty")
        if not self.agent_factories:
            raise ValueError("Policy profile requires at least one team policy")


@dataclass(frozen=True)
class LeagueProfileResult:
    name: str
    team_mean_returns: Mapping[str, float]
    team_std_returns: Mapping[str, float]
    returns_by_seed: Mapping[str, tuple[float, ...]]
    mean_completed_rounds: float

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "team_mean_returns": dict(self.team_mean_returns),
            "team_std_returns": dict(self.team_std_returns),
            "returns_by_seed": {
                team_id: list(values) for team_id, values in self.returns_by_seed.items()
            },
            "mean_completed_rounds": self.mean_completed_rounds,
        }


@dataclass(frozen=True)
class ExploitabilityEstimate:
    baseline_profile: str
    deviation_gains: Mapping[str, float]
    nash_conv_proxy: float

    def to_dict(self) -> dict:
        return {
            "baseline_profile": self.baseline_profile,
            "deviation_gains": dict(self.deviation_gains),
            "nash_conv_proxy": self.nash_conv_proxy,
        }


@dataclass(frozen=True)
class LeagueEvaluationResult:
    seeds: tuple[int, ...]
    rounds: int
    profiles: Mapping[str, LeagueProfileResult]
    exploitability: ExploitabilityEstimate | None = None

    def to_dict(self) -> dict:
        return {
            "seeds": list(self.seeds),
            "rounds": self.rounds,
            "profiles": {
                name: result.to_dict() for name, result in self.profiles.items()
            },
            "exploitability": (
                self.exploitability.to_dict() if self.exploitability is not None else None
            ),
        }


class LeagueEvaluationHarness:
    """Evaluate fixed decentralized policies on identical multi-team seeds."""

    def __init__(
        self,
        environment_factory: EnvironmentFactory,
        *,
        seeds: tuple[int, ...] = (11, 23, 37),
        rounds: int = 5,
    ):
        if not seeds or any(isinstance(seed, bool) or not isinstance(seed, int) for seed in seeds):
            raise ValueError("seeds must contain integers")
        if rounds < 1:
            raise ValueError("rounds must be positive")
        self.environment_factory = environment_factory
        self.seeds = tuple(seeds)
        self.rounds = int(rounds)

    def run(
        self,
        profiles: tuple[PolicyProfile, ...],
        *,
        baseline_profile: str | None = None,
        unilateral_deviations: Mapping[str, OpponentFactory] | None = None,
    ) -> LeagueEvaluationResult:
        if not profiles:
            raise ValueError("At least one policy profile is required")
        names = [profile.name for profile in profiles]
        if len(names) != len(set(names)):
            raise ValueError("Policy profile names must be unique")
        results = {profile.name: self._run_profile(profile) for profile in profiles}
        exploitability = None
        if baseline_profile is not None:
            if baseline_profile not in results:
                raise ValueError(f"Unknown baseline profile: {baseline_profile}")
            baseline = next(profile for profile in profiles if profile.name == baseline_profile)
            gains = {}
            for team_id, deviation_factory in (unilateral_deviations or {}).items():
                if team_id not in baseline.agent_factories:
                    raise ValueError(f"Unknown deviating team: {team_id}")
                deviated_factories = dict(baseline.agent_factories)
                deviated_factories[team_id] = deviation_factory
                deviated = self._run_profile(PolicyProfile(
                    name=f"{baseline_profile}:{team_id}:deviation",
                    agent_factories=deviated_factories,
                ))
                gains[team_id] = (
                    deviated.team_mean_returns[team_id]
                    - results[baseline_profile].team_mean_returns[team_id]
                )
            exploitability = ExploitabilityEstimate(
                baseline_profile=baseline_profile,
                deviation_gains=gains,
                nash_conv_proxy=float(sum(max(0.0, gain) for gain in gains.values())),
            )
        return LeagueEvaluationResult(
            seeds=self.seeds,
            rounds=self.rounds,
            profiles=results,
            exploitability=exploitability,
        )

    def _run_profile(self, profile: PolicyProfile) -> LeagueProfileResult:
        returns: dict[str, list[float]] = {}
        completed_rounds: list[int] = []
        for seed in self.seeds:
            environment = self.environment_factory()
            environment.reset(seed=seed)
            team_ids = tuple(team.team_id for team in environment.teams)
            missing = set(team_ids) - set(profile.agent_factories)
            extra = set(profile.agent_factories) - set(team_ids)
            if missing or extra:
                raise ValueError(
                    f"Profile '{profile.name}' team mismatch; missing={sorted(missing)}, extra={sorted(extra)}"
                )
            agents: dict[str, AgentPolicy] = {
                team_id: profile.agent_factories[team_id](seed + index)
                for index, team_id in enumerate(team_ids)
            }
            for index, team_id in enumerate(team_ids):
                resetter = getattr(agents[team_id], "reset", None)
                if callable(resetter):
                    resetter(seed=seed + index, training=False)
            totals = {team_id: 0.0 for team_id in team_ids}
            rounds_done = 0
            finished = False
            for _ in range(self.rounds):
                for team_id in team_ids:
                    if not legal_agent_moves(environment, team_id):
                        continue
                    move = environment.select_move(team_id, agents[team_id])
                    _, _, terminated, truncated, info = environment.step(move)
                    for scored_team, payload in info["transition_rewards"].items():
                        totals[scored_team] += float(payload.get("reward", payload.get("total")))
                    if terminated or truncated:
                        finished = True
                        break
                rounds_done += 1
                if finished:
                    break
            completed_rounds.append(rounds_done)
            for team_id, total in totals.items():
                returns.setdefault(team_id, []).append(total)

        return LeagueProfileResult(
            name=profile.name,
            team_mean_returns={
                team_id: float(np.mean(values)) for team_id, values in returns.items()
            },
            team_std_returns={
                team_id: float(np.std(values)) for team_id, values in returns.items()
            },
            returns_by_seed={
                team_id: tuple(float(value) for value in values)
                for team_id, values in returns.items()
            },
            mean_completed_rounds=float(np.mean(completed_rounds)),
        )
