"""N-step advantage actor-critic training for FlowCLD team policies."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence

import networkx as nx
import numpy as np

from .features import DecisionFeatureEncoder, EncodedDecision, MessagePassingFeatureEncoder
from .agents import AgentPolicy
from .teams import TeamAction, TeamDefinition, TeamMove
from .types import NoOpAction, Objective, ParameterAction, ParameterName


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = np.asarray(logits, dtype=float) - float(np.max(logits))
    weights = np.exp(np.clip(shifted, -60.0, 60.0))
    total = float(np.sum(weights))
    if not math.isfinite(total) or total <= 0.0:
        return np.full(len(weights), 1.0 / max(1, len(weights)), dtype=float)
    return weights / total


@dataclass(frozen=True)
class PolicyDecision:
    """One sampled action plus the features needed for an on-policy update."""

    action: TeamAction
    action_index: int
    encoded: EncodedDecision
    policy_features: np.ndarray
    probabilities: np.ndarray
    value: float


@dataclass(frozen=True)
class LearningTransition:
    state: np.ndarray
    policy_features: np.ndarray
    probabilities: np.ndarray
    action_index: int
    reward: float
    next_state: np.ndarray
    terminated: bool


@dataclass(frozen=True)
class ActorCriticUpdate:
    actor_loss: float
    critic_loss: float
    mean_advantage: float
    entropy: float


class LinearActorCritic:
    """Serializable actor and critic heads over an injected graph encoder.

    The model intentionally owns only learning parameters. Graph processing is
    delegated to ``DecisionFeatureEncoder``, which keeps model replacement and
    feature evolution independent from environment behavior.
    """

    VERSION = 1

    def __init__(
        self,
        *,
        state_size: int,
        action_size: int,
        seed: int = 0,
        policy_weights: Sequence[float] | None = None,
        value_weights: Sequence[float] | None = None,
    ):
        if state_size < 1 or action_size < 1:
            raise ValueError("feature sizes must be positive")
        self.state_size = int(state_size)
        self.action_size = int(action_size)
        self.policy_size = self.state_size + self.action_size
        rng = np.random.default_rng(seed)
        self.policy_weights = (
            np.asarray(policy_weights, dtype=float).copy()
            if policy_weights is not None
            else rng.normal(0.0, 0.01, self.policy_size)
        )
        self.value_weights = (
            np.asarray(value_weights, dtype=float).copy()
            if value_weights is not None
            else np.zeros(self.state_size, dtype=float)
        )
        if self.policy_weights.shape != (self.policy_size,):
            raise ValueError("policy weight shape does not match feature sizes")
        if self.value_weights.shape != (self.state_size,):
            raise ValueError("value weight shape does not match state size")
        if not np.isfinite(self.policy_weights).all() or not np.isfinite(self.value_weights).all():
            raise ValueError("model weights must be finite")

    def probabilities(self, policy_features: np.ndarray, *, temperature: float = 1.0) -> np.ndarray:
        if policy_features.ndim != 2 or policy_features.shape[1] != self.policy_size:
            raise ValueError("policy feature matrix has an incompatible shape")
        if not math.isfinite(temperature) or temperature <= 0.0:
            raise ValueError("temperature must be positive")
        return _softmax((policy_features @ self.policy_weights) / temperature)

    def value(self, state: np.ndarray) -> float:
        vector = np.asarray(state, dtype=float)
        if vector.shape != (self.state_size,):
            raise ValueError("state feature vector has an incompatible shape")
        return float(vector @ self.value_weights)

    def update(
        self,
        transitions: Sequence[LearningTransition],
        *,
        gamma: float,
        n_step: int,
        actor_learning_rate: float,
        critic_learning_rate: float,
        entropy_weight: float,
        gradient_clip: float,
        advantage_clip: float,
        use_critic: bool = True,
    ) -> ActorCriticUpdate:
        trajectory = tuple(transitions)
        if not trajectory:
            return ActorCriticUpdate(0.0, 0.0, 0.0, 0.0)
        if not 0.0 <= gamma <= 1.0:
            raise ValueError("gamma must be between 0 and 1")
        if n_step < 1:
            raise ValueError("n_step must be positive")

        actor_gradient = np.zeros_like(self.policy_weights)
        critic_gradient = np.zeros_like(self.value_weights)
        actor_losses: list[float] = []
        critic_losses: list[float] = []
        advantages: list[float] = []
        entropies: list[float] = []

        for index, transition in enumerate(trajectory):
            steps = len(trajectory) - index if not use_critic else min(n_step, len(trajectory) - index)
            target = 0.0
            discount = 1.0
            for offset in range(steps):
                target += discount * float(trajectory[index + offset].reward)
                discount *= gamma

            end_index = index + steps
            if use_critic and not trajectory[end_index - 1].terminated:
                bootstrap_state = (
                    trajectory[end_index].state
                    if end_index < len(trajectory)
                    else trajectory[-1].next_state
                )
                target += discount * self.value(bootstrap_state)

            baseline = self.value(transition.state) if use_critic else 0.0
            advantage = float(np.clip(target - baseline, -advantage_clip, advantage_clip))
            selected = transition.policy_features[transition.action_index]
            expected = transition.probabilities @ transition.policy_features
            actor_gradient += advantage * (selected - expected)
            selected_probability = max(1e-12, float(transition.probabilities[transition.action_index]))
            log_probabilities = np.log(np.maximum(transition.probabilities, 1e-12))
            entropy = float(-np.sum(transition.probabilities * log_probabilities))
            entropy_logit_gradient = -transition.probabilities * (log_probabilities + entropy)
            actor_gradient += float(entropy_weight) * (
                entropy_logit_gradient @ transition.policy_features
            )
            actor_losses.append(-math.log(selected_probability) * advantage - float(entropy_weight) * entropy)
            entropies.append(entropy)
            advantages.append(advantage)

            if use_critic:
                critic_gradient += advantage * transition.state
                critic_losses.append(0.5 * (target - baseline) ** 2)

        scale = 1.0 / len(trajectory)
        actor_gradient = self._clip(actor_gradient * scale, gradient_clip)
        self.policy_weights += float(actor_learning_rate) * actor_gradient
        if use_critic:
            critic_gradient = self._clip(critic_gradient * scale, gradient_clip)
            self.value_weights += float(critic_learning_rate) * critic_gradient

        return ActorCriticUpdate(
            actor_loss=float(np.mean(actor_losses)),
            critic_loss=float(np.mean(critic_losses)) if critic_losses else 0.0,
            mean_advantage=float(np.mean(advantages)),
            entropy=float(np.mean(entropies)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.VERSION,
            "model": "linear_actor_critic",
            "state_size": self.state_size,
            "action_size": self.action_size,
            "policy_weights": self.policy_weights.tolist(),
            "value_weights": self.value_weights.tolist(),
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "LinearActorCritic":
        if int(payload.get("version", 0)) != cls.VERSION:
            raise ValueError("Unsupported actor-critic checkpoint version")
        return cls(
            state_size=int(payload["state_size"]),
            action_size=int(payload["action_size"]),
            policy_weights=payload["policy_weights"],
            value_weights=payload["value_weights"],
        )

    def save(self, path: str | Path) -> Path:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True), encoding="utf-8")
        temporary.replace(destination)
        return destination

    @classmethod
    def load(cls, path: str | Path) -> "LinearActorCritic":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    @staticmethod
    def _clip(vector: np.ndarray, maximum_norm: float) -> np.ndarray:
        norm = float(np.linalg.norm(vector))
        if norm > maximum_norm > 0.0:
            return vector * (maximum_norm / norm)
        return vector


class ActorCriticAgent:
    """Drop-in learned policy for the existing ``AgentPolicy`` contract."""

    def __init__(
        self,
        model: LinearActorCritic,
        *,
        encoder: DecisionFeatureEncoder | None = None,
        seed: int = 0,
        deterministic: bool = False,
        temperature: float = 1.0,
        simulator_guard: bool = True,
        guard_top_k: int = 8,
        max_guard_candidates: int = 32,
    ):
        if guard_top_k < 1 or max_guard_candidates < 1:
            raise ValueError("Deployment guard limits must be positive")
        self.model = model
        self.encoder = encoder or MessagePassingFeatureEncoder()
        self._rng = np.random.default_rng(seed)
        self.deterministic = bool(deterministic)
        self.temperature = float(temperature)
        self.simulator_guard = bool(simulator_guard)
        self.guard_top_k = int(guard_top_k)
        self.max_guard_candidates = int(max_guard_candidates)

    def decide(
        self,
        graph: nx.DiGraph,
        objective: Objective,
        legal_moves: Sequence[TeamAction],
    ) -> PolicyDecision:
        moves = tuple(legal_moves)
        encoded = self.encoder.encode(graph, objective, moves)
        policy_features = self.encoder.policy_features(encoded)
        probabilities = self.model.probabilities(policy_features, temperature=self.temperature)
        action_index = (
            int(np.argmax(probabilities))
            if self.deterministic
            else int(self._rng.choice(len(moves), p=probabilities))
        )
        return PolicyDecision(
            action=moves[action_index],
            action_index=action_index,
            encoded=encoded,
            policy_features=policy_features,
            probabilities=probabilities,
            value=self.model.value(encoded.state),
        )

    def select_move(self, graph, objective, legal_moves, value_of):
        decision = self.decide(graph, objective, legal_moves)
        if not self.deterministic or not self.simulator_guard:
            return decision.action

        moves = tuple(legal_moves)
        selected_index = decision.action_index
        ranked_indices = list(np.argsort(-decision.probabilities))
        candidate_indices: list[int] = [selected_index]
        candidate_indices.extend(
            index for index, move in enumerate(moves)
            if isinstance(move, NoOpAction)
        )
        # Reserve policy-ranked representatives from every parameter family so
        # a dominant action kind cannot hide the adjustment needed after a
        # structural move changes the graph.
        for parameter in (
            ParameterName.RETENTION,
            ParameterName.DECAY,
            ParameterName.CORRELATION,
            ParameterName.DELAY,
            ParameterName.START_AMOUNT,
            ParameterName.CONFIDENCE,
        ):
            matching = [
                index for index in ranked_indices
                if isinstance(moves[index], ParameterAction)
                and moves[index].parameter == parameter
            ]
            candidate_indices.extend(matching[:2])
        # Structural proposals are sparse and consequential, so every bounded
        # one receives a simulator check before ordinary policy alternatives.
        candidate_indices.extend(
            index for index in ranked_indices
            if not isinstance(moves[index], (NoOpAction, ParameterAction))
        )
        candidate_indices.extend(ranked_indices[: self.guard_top_k])

        deduplicated = []
        seen = set()
        for index in candidate_indices:
            if index in seen:
                continue
            seen.add(index)
            deduplicated.append(index)
            if len(deduplicated) >= self.max_guard_candidates:
                break

        scored = []
        for index in deduplicated:
            move = moves[index]
            reward = float(value_of(move))
            stable_key = json.dumps(move.to_dict(), sort_keys=True, default=str)
            scored.append((reward, float(decision.probabilities[index]), stable_key, move))
        scored.sort(key=lambda item: (-item[0], -item[1], item[2]))
        return scored[0][3]


@dataclass(frozen=True)
class ActorCriticTrainingSettings:
    episodes: int = 20
    n_step: int = 5
    actor_learning_rate: float = 0.03
    critic_learning_rate: float = 0.08
    entropy_weight: float = 0.01
    temperature: float = 1.0
    gradient_clip: float = 5.0
    advantage_clip: float = 10.0
    reward_clip: float = 10.0
    seed: int = 42
    use_critic: bool = True

    def __post_init__(self) -> None:
        if not 1 <= int(self.episodes) <= 10000:
            raise ValueError("episodes must be between 1 and 10000")
        if not 1 <= int(self.n_step) <= 1000:
            raise ValueError("n_step must be between 1 and 1000")
        for field_name in (
            "actor_learning_rate", "temperature", "gradient_clip",
            "advantage_clip", "reward_clip",
        ):
            value = float(getattr(self, field_name))
            if not math.isfinite(value) or value <= 0.0:
                raise ValueError(f"{field_name} must be positive and finite")
        critic_rate = float(self.critic_learning_rate)
        if not math.isfinite(critic_rate) or critic_rate < 0.0:
            raise ValueError("critic_learning_rate must be finite and non-negative")
        entropy_weight = float(self.entropy_weight)
        if not math.isfinite(entropy_weight) or entropy_weight < 0.0:
            raise ValueError("entropy_weight must be finite and non-negative")
        if isinstance(self.seed, bool) or not isinstance(self.seed, int):
            raise ValueError("seed must be an integer")


@dataclass(frozen=True)
class TrainingEpisode:
    episode: int
    seed: int
    episode_return: float
    steps: int
    actor_loss: float
    critic_loss: float
    entropy: float

    def to_dict(self) -> dict[str, float | int]:
        return {
            "episode": self.episode,
            "seed": self.seed,
            "return": self.episode_return,
            "steps": self.steps,
            "actor_loss": self.actor_loss,
            "critic_loss": self.critic_loss,
            "entropy": self.entropy,
        }


@dataclass(frozen=True)
class ActorCriticTrainingResult:
    model: LinearActorCritic
    history: tuple[TrainingEpisode, ...]
    team_id: str
    algorithm: str
    settings: ActorCriticTrainingSettings

    @property
    def best_return(self) -> float:
        return max(item.episode_return for item in self.history)

    @property
    def final_return(self) -> float:
        return self.history[-1].episode_return

    def to_dict(self, *, include_model: bool = False) -> dict[str, Any]:
        payload = {
            "algorithm": self.algorithm,
            "team_id": self.team_id,
            "episodes": len(self.history),
            "n_step": self.settings.n_step,
            "best_return": self.best_return,
            "final_return": self.final_return,
            "history": [item.to_dict() for item in self.history],
        }
        if include_model:
            payload["checkpoint"] = self.model.to_dict()
        return payload


class LearningEnvironment(Protocol):
    """Minimal environment boundary required by on-policy training."""

    @property
    def teams(self) -> tuple[TeamDefinition, ...]: ...

    @property
    def graph_snapshot(self) -> nx.DiGraph: ...

    def reset(self, *, seed: int | None = None): ...

    def legal_moves(self, team_id: str) -> tuple[TeamAction, ...]: ...

    def legal_parameter_moves(self, team_id: str) -> tuple[TeamAction, ...]: ...

    def select_move(self, team_id: str, policy: AgentPolicy) -> TeamMove: ...

    def step(self, move: TeamMove): ...


def legal_agent_moves(
    environment: LearningEnvironment,
    team_id: str,
) -> tuple[TeamAction, ...]:
    """Read the unified action set with compatibility for parameter-only adapters."""

    provider = getattr(environment, "legal_moves", None)
    if callable(provider):
        return tuple(provider(team_id))
    return tuple(environment.legal_parameter_moves(team_id))


EnvironmentFactory = Callable[[], LearningEnvironment]
OpponentFactory = Callable[[int], AgentPolicy]


class ActorCriticTrainer:
    """Train one decentralized policy while all other teams remain frozen."""

    def __init__(
        self,
        settings: ActorCriticTrainingSettings | None = None,
        *,
        encoder: DecisionFeatureEncoder | None = None,
    ):
        self.settings = settings or ActorCriticTrainingSettings()
        self.encoder = encoder or MessagePassingFeatureEncoder()

    def train(
        self,
        environment_factory: EnvironmentFactory,
        *,
        team_id: str,
        model: LinearActorCritic | None = None,
        opponent_factories: Mapping[str, OpponentFactory] | None = None,
    ) -> ActorCriticTrainingResult:
        probe = environment_factory()
        probe.reset(seed=self.settings.seed)
        team = self._team(probe, team_id)
        legal = legal_agent_moves(probe, team_id)
        if not legal:
            raise ValueError(f"Team '{team_id}' has no legal autonomous moves")
        encoded = self.encoder.encode(probe.graph_snapshot, team.as_objective(), legal)
        actor = model or LinearActorCritic(
            state_size=len(encoded.state),
            action_size=encoded.actions.shape[1],
            seed=self.settings.seed,
        )
        agent = ActorCriticAgent(
            actor,
            encoder=self.encoder,
            seed=self.settings.seed,
            deterministic=False,
            temperature=self.settings.temperature,
        )

        history: list[TrainingEpisode] = []
        for episode in range(self.settings.episodes):
            episode_seed = self.settings.seed + episode
            environment = environment_factory()
            environment.reset(seed=episode_seed)
            team = self._team(environment, team_id)
            objective = team.as_objective()
            opponents = {
                opponent_id: factory(episode_seed)
                for opponent_id, factory in (opponent_factories or {}).items()
                if opponent_id != team_id
            }
            known_team_ids = {definition.team_id for definition in environment.teams}
            unknown_opponents = set(opponents) - known_team_ids
            if unknown_opponents:
                raise ValueError(f"Unknown opponent teams: {sorted(unknown_opponents)}")
            trajectory: list[LearningTransition] = []
            episode_return = 0.0

            while True:
                legal_moves = legal_agent_moves(environment, team_id)
                if not legal_moves:
                    break
                graph = environment.graph_snapshot
                decision = agent.decide(graph, objective, legal_moves)
                _, _, terminated, truncated, info = environment.step(TeamMove(
                    team_id=team_id,
                    action=decision.action,
                ))
                reward_payload = info["transition_rewards"][team_id]
                reward = float(reward_payload.get("reward", reward_payload.get("total")))
                episode_done = bool(terminated or truncated)
                for opponent_id, opponent in opponents.items():
                    if episode_done:
                        break
                    if not legal_agent_moves(environment, opponent_id):
                        continue
                    opponent_move = environment.select_move(opponent_id, opponent)
                    _, _, opponent_terminated, opponent_truncated, opponent_info = (
                        environment.step(opponent_move)
                    )
                    opponent_reward = opponent_info["transition_rewards"][team_id]
                    reward += float(opponent_reward.get("reward", opponent_reward.get("total")))
                    terminated = bool(terminated or opponent_terminated)
                    truncated = bool(truncated or opponent_truncated)
                    episode_done = bool(terminated or truncated)
                reward = float(np.clip(reward, -self.settings.reward_clip, self.settings.reward_clip))
                next_state = self.encoder.encode_state(environment.graph_snapshot, objective)
                trajectory.append(LearningTransition(
                    state=decision.encoded.state,
                    policy_features=decision.policy_features,
                    probabilities=decision.probabilities,
                    action_index=decision.action_index,
                    reward=reward,
                    next_state=next_state,
                    terminated=bool(terminated),
                ))
                episode_return += reward
                if terminated or truncated:
                    break

            update = actor.update(
                trajectory,
                gamma=objective.gamma,
                n_step=(self.settings.n_step if self.settings.use_critic else max(1, len(trajectory))),
                actor_learning_rate=self.settings.actor_learning_rate,
                critic_learning_rate=self.settings.critic_learning_rate,
                entropy_weight=self.settings.entropy_weight,
                gradient_clip=self.settings.gradient_clip,
                advantage_clip=self.settings.advantage_clip,
                use_critic=self.settings.use_critic,
            )
            history.append(TrainingEpisode(
                episode=episode + 1,
                seed=episode_seed,
                episode_return=episode_return,
                steps=len(trajectory),
                actor_loss=update.actor_loss,
                critic_loss=update.critic_loss,
                entropy=update.entropy,
            ))

        return ActorCriticTrainingResult(
            model=actor,
            history=tuple(history),
            team_id=team_id,
            algorithm=("n_step_actor_critic" if self.settings.use_critic else "reinforce"),
            settings=self.settings,
        )

    @staticmethod
    def _team(environment: LearningEnvironment, team_id: str):
        for team in environment.teams:
            if team.team_id == team_id:
                return team
        raise ValueError(f"Unknown team: {team_id}")
