"""Interpretable online epsilon-greedy learning for FlowCLD actions."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence

import networkx as nx
import numpy as np

from .agents import AgentPolicy, PolicyTransition
from .learning import EnvironmentFactory, OpponentFactory, legal_agent_moves
from .structural import (
    AddEdgeAction,
    AddNodeAction,
    RemoveEdgeAction,
    RemoveNodeAction,
    StructuralTransaction,
)
from .teams import TeamAction, TeamMove
from .types import MutationMode, NoOpAction, Objective, ParameterAction, ParameterName


def _stable_action_id(action: TeamAction) -> str:
    return json.dumps(action.to_dict(), sort_keys=True, separators=(",", ":"), default=str)


def _parameter_direction(graph: nx.DiGraph, action: ParameterAction) -> str:
    if action.mode == MutationMode.DELTA:
        delta = float(action.value)
        return "increase" if delta > 0.0 else ("decrease" if delta < 0.0 else "hold")
    try:
        if isinstance(action.target, tuple):
            source, target = action.target
            current = float(graph[source][target].get(action.parameter.value, 0.0))
        else:
            current = float(graph.nodes[action.target].get(action.parameter.value, 0.0))
    except (KeyError, TypeError, ValueError):
        current = 0.0
    proposed = float(action.value)
    if (
        action.parameter == ParameterName.CORRELATION
        and abs(current) > 1e-12
        and current * proposed < 0.0
    ):
        return "flip_sign"
    delta = proposed - current
    return "increase" if delta > 1e-12 else ("decrease" if delta < -1e-12 else "hold")


def action_abstraction_key(
    graph: nx.DiGraph,
    objective: Objective,
    action: TeamAction,
) -> str:
    """Return a compact action family shared across targets and graph sizes.

    Raw node names, edge names, and floating-point values are deliberately
    excluded. This keeps the table small and lets preferences transfer between
    repeated decisions and compatible graphs.
    """

    orientation = objective.orientation.value
    if isinstance(action, NoOpAction):
        family = "no_op"
    elif isinstance(action, ParameterAction):
        scope = "edge" if isinstance(action.target, tuple) else "node"
        family = ":".join((
            "parameter",
            action.parameter.value,
            scope,
            _parameter_direction(graph, action),
        ))
    elif isinstance(action, StructuralTransaction):
        kinds = sorted(edit.kind.value for edit in action.edits)
        family = "structural_transaction:" + "+".join(kinds)
    elif isinstance(action, (AddNodeAction, RemoveNodeAction, AddEdgeAction, RemoveEdgeAction)):
        family = "structural:" + action.kind.value
    else:  # Defensive boundary for future action classes.
        family = "action:" + type(action).__name__
    return f"{orientation}|{family}"


@dataclass(frozen=True)
class EpsilonGreedySettings:
    epsilon: float = 0.25
    epsilon_min: float = 0.02
    epsilon_decay: float = 0.98
    learning_rate: float | None = None
    seed: int = 42

    def __post_init__(self) -> None:
        for name in ("epsilon", "epsilon_min", "epsilon_decay"):
            value = float(getattr(self, name))
            if not math.isfinite(value):
                raise ValueError(f"{name} must be finite")
        if not 0.0 <= self.epsilon <= 1.0:
            raise ValueError("epsilon must be between 0 and 1")
        if not 0.0 <= self.epsilon_min <= self.epsilon:
            raise ValueError("epsilon_min must be between 0 and epsilon")
        if not 0.0 < self.epsilon_decay <= 1.0:
            raise ValueError("epsilon_decay must be greater than 0 and at most 1")
        if self.learning_rate is not None:
            rate = float(self.learning_rate)
            if not math.isfinite(rate) or not 0.0 < rate <= 1.0:
                raise ValueError("learning_rate must be in (0, 1] or None")
        if isinstance(self.seed, bool) or not isinstance(self.seed, int):
            raise ValueError("seed must be an integer")


class EpsilonGreedyPolicy:
    """Tabular contextual-bandit baseline over interpretable action families.

    During training, exploration is uniform over legal actions. Exploitation
    compares learned action-family values only; candidate-preview rewards are
    never consulted. Evaluation forces epsilon to zero and disables updates.
    """

    VERSION = 1

    def __init__(self, settings: EpsilonGreedySettings | None = None):
        self.settings = settings or EpsilonGreedySettings()
        self._values: dict[str, float] = {}
        self._counts: dict[str, int] = {}
        self._epsilon = float(self.settings.epsilon)
        self._updates = 0
        self._training = False
        self._rng = np.random.default_rng(self.settings.seed)

    @property
    def epsilon(self) -> float:
        return self._epsilon

    @property
    def values(self) -> Mapping[str, float]:
        return dict(self._values)

    @property
    def counts(self) -> Mapping[str, int]:
        return dict(self._counts)

    @property
    def training(self) -> bool:
        return self._training

    def reset(self, *, seed: int | None = None, training: bool = False) -> None:
        selected_seed = self.settings.seed if seed is None else seed
        if isinstance(selected_seed, bool) or not isinstance(selected_seed, int):
            raise ValueError("seed must be an integer")
        self._rng = np.random.default_rng(selected_seed)
        self._training = bool(training)

    def select_move(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
        value_of,
    ) -> TeamAction:
        del value_of  # Preview scores are intentionally separate from learned values.
        ordered = sorted(tuple(legal_moves), key=_stable_action_id)
        if not ordered:
            raise ValueError("EpsilonGreedyPolicy requires at least one legal move")
        if self._training and self._rng.random() < self._epsilon:
            return ordered[int(self._rng.integers(0, len(ordered)))]

        estimates = [
            float(self._values.get(action_abstraction_key(graph, objective, move), 0.0))
            for move in ordered
        ]
        maximum = max(estimates)
        tied = [index for index, value in enumerate(estimates) if math.isclose(
            value, maximum, rel_tol=0.0, abs_tol=1e-12
        )]
        selected = tied[int(self._rng.integers(0, len(tied)))]
        return ordered[selected]

    def update(self, transition: PolicyTransition) -> None:
        if not self._training:
            return
        reward = float(transition.reward)
        if not math.isfinite(reward):
            raise ValueError("transition reward must be finite")
        key = action_abstraction_key(
            transition.graph, transition.objective, transition.action
        )
        count = self._counts.get(key, 0) + 1
        old_value = self._values.get(key, 0.0)
        alpha = (
            1.0 / count
            if self.settings.learning_rate is None
            else float(self.settings.learning_rate)
        )
        self._counts[key] = count
        self._values[key] = float(old_value + alpha * (reward - old_value))
        self._updates += 1
        self._epsilon = max(
            float(self.settings.epsilon_min),
            float(self._epsilon * self.settings.epsilon_decay),
        )

    def state_dict(self) -> Mapping[str, Any]:
        return {
            "version": self.VERSION,
            "policy": "epsilon_greedy_action_values",
            "action_key_version": 1,
            "settings": {
                "epsilon": self.settings.epsilon,
                "epsilon_min": self.settings.epsilon_min,
                "epsilon_decay": self.settings.epsilon_decay,
                "learning_rate": self.settings.learning_rate,
                "seed": self.settings.seed,
            },
            "epsilon_current": self._epsilon,
            "updates": self._updates,
            "values": dict(sorted(self._values.items())),
            "counts": dict(sorted(self._counts.items())),
            "rng_state": self._rng.bit_generator.state,
        }

    def load_state_dict(self, payload: Mapping[str, Any]) -> None:
        if int(payload.get("version", 0)) != self.VERSION:
            raise ValueError("Unsupported epsilon-greedy checkpoint version")
        if payload.get("policy") != "epsilon_greedy_action_values":
            raise ValueError("Checkpoint does not contain an epsilon-greedy policy")
        settings = EpsilonGreedySettings(**dict(payload["settings"]))
        values = {str(key): float(value) for key, value in dict(payload.get("values", {})).items()}
        counts = {str(key): int(value) for key, value in dict(payload.get("counts", {})).items()}
        if any(not math.isfinite(value) for value in values.values()):
            raise ValueError("Learned values must be finite")
        if any(value < 0 for value in counts.values()) or set(values) != set(counts):
            raise ValueError("Learned values and visit counts must have matching keys")
        epsilon_current = float(payload.get("epsilon_current", settings.epsilon))
        if not settings.epsilon_min <= epsilon_current <= settings.epsilon:
            raise ValueError("Checkpoint epsilon is outside its configured bounds")
        self.settings = settings
        self._values = values
        self._counts = counts
        self._epsilon = epsilon_current
        self._updates = int(payload.get("updates", sum(counts.values())))
        self._training = False
        self._rng = np.random.default_rng(settings.seed)
        if "rng_state" in payload:
            self._rng.bit_generator.state = dict(payload["rng_state"])

    def save(self, path: str | Path) -> Path:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_text(
            json.dumps(self.state_dict(), indent=2, sort_keys=True), encoding="utf-8"
        )
        temporary.replace(destination)
        return destination

    @classmethod
    def load(cls, path: str | Path) -> "EpsilonGreedyPolicy":
        policy = cls()
        policy.load_state_dict(json.loads(Path(path).read_text(encoding="utf-8")))
        return policy


@dataclass(frozen=True)
class EpsilonGreedyTrainingSettings:
    episodes: int = 50
    seed: int = 42

    def __post_init__(self) -> None:
        if not 1 <= int(self.episodes) <= 10000:
            raise ValueError("episodes must be between 1 and 10000")
        if isinstance(self.seed, bool) or not isinstance(self.seed, int):
            raise ValueError("seed must be an integer")


@dataclass(frozen=True)
class EpsilonGreedyEpisode:
    episode: int
    seed: int
    episode_return: float
    steps: int

    def to_dict(self) -> dict[str, float | int]:
        return {
            "episode": self.episode,
            "seed": self.seed,
            "return": self.episode_return,
            "steps": self.steps,
        }


@dataclass(frozen=True)
class EpsilonGreedyTrainingResult:
    policy: EpsilonGreedyPolicy
    history: tuple[EpsilonGreedyEpisode, ...]
    team_id: str

    def to_dict(self, *, include_checkpoint: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "algorithm": "epsilon_greedy_action_values",
            "team_id": self.team_id,
            "episodes": len(self.history),
            "best_return": max(item.episode_return for item in self.history),
            "final_return": self.history[-1].episode_return,
            "epsilon_final": self.policy.epsilon,
            "history": [item.to_dict() for item in self.history],
            "learned_values": dict(sorted(self.policy.values.items())),
            "visit_counts": dict(sorted(self.policy.counts.items())),
        }
        if include_checkpoint:
            payload["checkpoint"] = self.policy.state_dict()
        return payload


class EpsilonGreedyTrainer:
    """Train one team online while reusing the existing environment lifecycle."""

    def __init__(self, settings: EpsilonGreedyTrainingSettings | None = None):
        self.settings = settings or EpsilonGreedyTrainingSettings()

    def train(
        self,
        environment_factory: EnvironmentFactory,
        *,
        team_id: str,
        policy: EpsilonGreedyPolicy | None = None,
        opponent_factories: Mapping[str, OpponentFactory] | None = None,
    ) -> EpsilonGreedyTrainingResult:
        learner = policy or EpsilonGreedyPolicy(EpsilonGreedySettings(seed=self.settings.seed))
        history: list[EpsilonGreedyEpisode] = []
        for episode in range(self.settings.episodes):
            episode_seed = self.settings.seed + episode
            environment = environment_factory()
            environment.reset(seed=episode_seed)
            learner.reset(seed=episode_seed, training=True)
            team = self._team(environment, team_id)
            objective = team.as_objective()
            opponents = {
                opponent_id: factory(episode_seed)
                for opponent_id, factory in (opponent_factories or {}).items()
                if opponent_id != team_id
            }
            episode_return = 0.0
            steps = 0
            while True:
                if not legal_agent_moves(environment, team_id):
                    break
                graph = environment.graph_snapshot
                move = environment.select_move(team_id, learner)
                _, _, terminated, truncated, info = environment.step(move)
                reward_payload = info["transition_rewards"][team_id]
                reward = float(reward_payload.get("reward", reward_payload.get("total")))
                accepted = bool(info.get("move", {}).get("accepted", True))
                done = bool(terminated or truncated)

                for opponent_id, opponent in opponents.items():
                    if done or not legal_agent_moves(environment, opponent_id):
                        continue
                    resetter = getattr(opponent, "reset", None)
                    if steps == 0 and callable(resetter):
                        resetter(seed=episode_seed, training=False)
                    opponent_move = environment.select_move(opponent_id, opponent)
                    _, _, opponent_terminated, opponent_truncated, opponent_info = environment.step(
                        opponent_move
                    )
                    opponent_reward = opponent_info["transition_rewards"][team_id]
                    reward += float(opponent_reward.get("reward", opponent_reward.get("total")))
                    done = bool(
                        done or opponent_terminated or opponent_truncated
                    )

                learner.update(PolicyTransition(
                    graph=graph,
                    objective=objective,
                    action=move.action,
                    reward=reward,
                    next_graph=environment.graph_snapshot,
                    done=done,
                    accepted=accepted,
                    context={"team_id": team_id, "episode": episode + 1},
                ))
                episode_return += reward
                steps += 1
                if done:
                    break
            history.append(EpsilonGreedyEpisode(
                episode=episode + 1,
                seed=episode_seed,
                episode_return=episode_return,
                steps=steps,
            ))
        learner.reset(seed=self.settings.seed, training=False)
        return EpsilonGreedyTrainingResult(
            policy=learner,
            history=tuple(history),
            team_id=team_id,
        )

    @staticmethod
    def _team(environment, team_id: str):
        for team in environment.teams:
            if team.team_id == team_id:
                return team
        raise ValueError(f"Unknown team: {team_id}")
