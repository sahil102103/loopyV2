"""Multi-team coordination around the canonical FlowCLD environment.

This module owns team objectives and scoring only. Graph mutation, simulation,
authorization, and structural safety remain delegated to ``FlowCLDEnvironment``
and its injected collaborators.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Iterable, Mapping

import networkx as nx

from .actions import AuthorizationPolicy
from .candidates import (
    BoundedStructuralCandidateGenerator,
    StructuralCandidateGenerator,
)
from .environment import FlowCLDEnvironment
from .observations import ObservationBuilder
from .engine import EngineAdapter
from .objectives import ObjectiveEvaluator, ObjectiveStateEvaluation
from .rewards import CompositeRewardModel
from .structural import (
    AddEdgeAction,
    AddNodeAction,
    RemoveEdgeAction,
    RemoveNodeAction,
    StructuralMutator,
    StructuralTransaction,
)
from .types import (
    MutationMode,
    Objective,
    ObjectiveOrientation,
    NoOpAction,
    ParameterAction,
    ParameterName,
    RewardEvaluation,
    TargetSpecification,
    validate_target_specification,
)


TeamAction = (
    NoOpAction
    | ParameterAction
    | AddNodeAction
    | RemoveNodeAction
    | AddEdgeAction
    | RemoveEdgeAction
    | StructuralTransaction
)


def _required_text(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be non-empty")
    return value.strip()


@dataclass(frozen=True)
class TeamDefinition:
    """One participant, its role, objective, and influence on shared score."""

    team_id: str
    name: str
    role: str
    target: TargetSpecification
    weight: float = 1.0
    orientation: ObjectiveOrientation = ObjectiveOrientation.STABILIZE
    owned_nodes: frozenset[str] = frozenset()
    target_nodes: frozenset[str] = frozenset()
    preset: str = "balanced"
    gamma: float = 0.99
    parameter_move_cost: float = 0.01
    structural_move_cost: float = 0.05
    move_budget: int = 20
    structural_budget: int = 5
    min_live_nodes: int = 1
    goal_potential: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "team_id", _required_text(self.team_id, "team_id"))
        object.__setattr__(self, "name", _required_text(self.name, "Team name"))
        object.__setattr__(self, "role", _required_text(self.role, "Team role"))
        if not isinstance(self.target, TargetSpecification):
            raise TypeError("target must be a TargetSpecification")
        if not isinstance(self.orientation, ObjectiveOrientation):
            raise TypeError("orientation must be an ObjectiveOrientation")
        weight = float(self.weight)
        if not math.isfinite(weight) or weight <= 0.0:
            raise ValueError("Team weight must be a positive finite number")
        object.__setattr__(self, "weight", weight)
        # Objective centralizes validation of costs, budgets, and orientation.
        self.as_objective()

    def as_objective(self) -> Objective:
        return Objective(
            name=self.name,
            orientation=self.orientation,
            owned_nodes=frozenset(self.owned_nodes),
            target_nodes=frozenset(self.target_nodes),
            target=self.target,
            preset=self.preset,
            gamma=float(self.gamma),
            parameter_move_cost=float(self.parameter_move_cost),
            structural_move_cost=float(self.structural_move_cost),
            move_budget=int(self.move_budget),
            structural_budget=int(self.structural_budget),
            min_live_nodes=int(self.min_live_nodes),
            goal_potential=(
                None if self.goal_potential is None else float(self.goal_potential)
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.team_id,
            "name": self.name,
            "role": self.role,
            "weight": self.weight,
            "orientation": self.orientation.value,
            "owned_nodes": sorted(self.owned_nodes),
            "target_nodes": sorted(self.target_nodes),
            "preset": self.preset,
            "gamma": self.gamma,
            "parameter_move_cost": self.parameter_move_cost,
            "structural_move_cost": self.structural_move_cost,
            "move_budget": self.move_budget,
            "structural_budget": self.structural_budget,
            "min_live_nodes": self.min_live_nodes,
            "goal_potential": self.goal_potential,
            "objective": {
                "trajectories": {
                    node: list(values) for node, values in self.target.trajectories.items()
                },
                "behaviors": dict(self.target.behaviors),
                "spectral_radius": self.target.spectral_radius,
            },
        }


@dataclass(frozen=True)
class TeamMove:
    """A single team-owned action in the shared ordered session."""

    team_id: str
    action: TeamAction

    def __post_init__(self) -> None:
        object.__setattr__(self, "team_id", _required_text(self.team_id, "team_id"))
        if not isinstance(self.action, (
            NoOpAction,
            ParameterAction,
            AddNodeAction,
            RemoveNodeAction,
            AddEdgeAction,
            RemoveEdgeAction,
            StructuralTransaction,
        )):
            raise TypeError("action must be a supported parameter or structural action")


@dataclass(frozen=True)
class TeamMoveRecord:
    """Auditable shared-session result for one attempted move."""

    sequence: int
    team_id: str
    team_name: str
    role: str
    action: Mapping[str, Any]
    accepted: bool
    before: Any
    after: Any
    reason: str | None
    objective_rewards: Mapping[str, float]
    objective_components: Mapping[str, Mapping[str, float]]
    shared_reward: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "sequence": self.sequence,
            "team_id": self.team_id,
            "team_name": self.team_name,
            "role": self.role,
            "action": dict(self.action),
            "accepted": self.accepted,
            "before": self.before,
            "after": self.after,
            "reason": self.reason,
            "objective_rewards": dict(self.objective_rewards),
            "objective_components": {
                team_id: dict(components)
                for team_id, components in self.objective_components.items()
            },
            "shared_reward": self.shared_reward,
        }


class MultiTeamEnvironment:
    """Coordinate role-safe team moves over one shared graph environment."""

    def __init__(
        self,
        graph: nx.DiGraph,
        *,
        teams: Iterable[TeamDefinition],
        authorization_policy: AuthorizationPolicy,
        structural_mutator: StructuralMutator | None = None,
        observation_builder: ObservationBuilder | None = None,
        engine: EngineAdapter | None = None,
        objective_evaluator: ObjectiveEvaluator | None = None,
        structural_candidate_generator: StructuralCandidateGenerator | None = None,
        max_structural_candidates: int = 24,
        max_steps: int = 20,
    ):
        definitions = tuple(teams)
        if not definitions:
            raise ValueError("At least one team is required")
        team_map = {team.team_id: team for team in definitions}
        if len(team_map) != len(definitions):
            raise ValueError("Team IDs must be unique")
        roles = [team.role for team in definitions]
        if len(roles) != len(set(roles)):
            raise ValueError("Each team must have a unique role")
        for team in definitions:
            validate_target_specification(team.target, set(graph.nodes))
            team.as_objective().validate_for_graph(set(graph.nodes))
            if team.min_live_nodes > graph.number_of_nodes():
                raise ValueError(
                    f"Team {team.team_id} min_live_nodes exceeds the baseline graph"
                )
        if not isinstance(max_structural_candidates, int) or max_structural_candidates < 0:
            raise ValueError("max_structural_candidates must be a non-negative integer")

        self._teams = definitions
        self._team_map = team_map
        horizon = int(getattr(observation_builder, "horizon", 200))
        self._objective_evaluator = objective_evaluator or ObjectiveEvaluator(
            engine=engine, horizon=horizon
        )
        # The wrapped environment is the sole mutation boundary. Its own target
        # is deliberately empty; team targets are scored independently below.
        self._environment = FlowCLDEnvironment(
            graph,
            authorization_policy=authorization_policy,
            target=TargetSpecification(),
            structural_mutator=structural_mutator,
            observation_builder=observation_builder,
            reward_model=CompositeRewardModel(()),
            max_steps=max_steps,
        )
        self._structural_candidate_generator = (
            structural_candidate_generator or BoundedStructuralCandidateGenerator()
        )
        self._max_structural_candidates = max_structural_candidates
        self._records: list[TeamMoveRecord] = []
        self._cumulative_rewards = {team.team_id: 0.0 for team in definitions}
        self._initial_rewards: dict[str, RewardEvaluation] = {}
        self._current_rewards: dict[str, RewardEvaluation] = {}
        self._current_states: dict[str, ObjectiveStateEvaluation] = {}
        self._move_counts = {team.team_id: 0 for team in definitions}
        self._structural_counts = {team.team_id: 0 for team in definitions}

    @property
    def teams(self) -> tuple[TeamDefinition, ...]:
        return self._teams

    @property
    def graph_snapshot(self) -> nx.DiGraph:
        return self._environment.graph_snapshot

    @property
    def observation_snapshot(self):
        return self._environment.observation_snapshot

    @property
    def move_log(self) -> tuple[TeamMoveRecord, ...]:
        return tuple(self._records)

    @property
    def cumulative_rewards(self) -> Mapping[str, float]:
        return dict(self._cumulative_rewards)

    @property
    def initial_rewards(self) -> Mapping[str, RewardEvaluation]:
        return dict(self._initial_rewards)

    @property
    def current_rewards(self) -> Mapping[str, RewardEvaluation]:
        return dict(self._current_rewards)

    @property
    def move_counts(self) -> Mapping[str, int]:
        return dict(self._move_counts)

    def legal_parameter_moves(self, team_id: str) -> tuple[TeamAction, ...]:
        """Enumerate the legacy bounded parameter set, including no-op."""

        team = self._team_map.get(team_id)
        if team is None:
            raise ValueError(f"Unknown team: {team_id}")
        if self._move_counts[team_id] >= team.move_budget:
            return ()
        graph = self._environment.graph_snapshot
        moves: list[TeamAction] = [NoOpAction()]
        for slot in self._environment.action_space(team.role):
            if not slot["allowed"]:
                continue
            target = tuple(slot["target"]) if isinstance(slot["target"], list) else slot["target"]
            if isinstance(target, tuple):
                current = float(graph[target[0]][target[1]].get(slot["parameter"], 0.0))
            else:
                current = float(graph.nodes[target].get(slot["parameter"], 0.0))
            parameter = ParameterName(slot["parameter"])
            if parameter == ParameterName.CORRELATION:
                candidates = (-current,) if abs(current) > 1e-12 else (-0.25, 0.25)
            elif parameter == ParameterName.DELAY:
                candidates = (current - 1.0, current + 1.0)
            elif parameter == ParameterName.START_AMOUNT:
                step = max(0.1, abs(current) * 0.1)
                candidates = (current - step, current + step)
            elif parameter == ParameterName.RETENTION:
                candidates = [current - 0.1, current + 0.1]
                if team.target.spectral_radius is not None:
                    direction = (
                        -0.25
                        if team.orientation == ObjectiveOrientation.STABILIZE
                        else 0.25
                    )
                    candidates.append(current + direction)
            elif parameter == ParameterName.DECAY:
                candidates = [current - 0.1, current + 0.1]
                if team.target.spectral_radius is not None:
                    direction = (
                        0.25
                        if team.orientation == ObjectiveOrientation.STABILIZE
                        else -0.25
                    )
                    candidates.append(current + direction)
            else:
                candidates = (current - 0.1, current + 0.1)
            for value in candidates:
                bounded = min(float(slot["maximum"]), max(float(slot["minimum"]), value))
                if slot["integer"]:
                    bounded = float(round(bounded))
                if abs(bounded - current) <= 1e-12:
                    continue
                moves.append(ParameterAction(
                    parameter=parameter,
                    target=target,
                    value=bounded,
                    mode=MutationMode.SET,
                ))
        unique = {}
        for move in moves:
            key = str(move.to_dict())
            unique.setdefault(key, move)
        return tuple(unique.values())

    def legal_moves(self, team_id: str) -> tuple[TeamAction, ...]:
        """Return all bounded autonomous moves that pass current safety gates."""

        team = self._team_map.get(team_id)
        if team is None:
            raise ValueError(f"Unknown team: {team_id}")
        parameter_moves = list(self.legal_parameter_moves(team_id))
        if not parameter_moves or self._max_structural_candidates == 0:
            return tuple(parameter_moves)

        remaining_edits = max(
            0,
            team.structural_budget - self._structural_counts[team_id],
        )
        if remaining_edits == 0:
            return tuple(parameter_moves)

        generated = self._structural_candidate_generator.generate(
            self._environment.graph_snapshot,
            team.as_objective(),
            remaining_edits=remaining_edits,
        )
        legal_structural: list[TeamAction] = []
        for candidate in generated:
            if self._move_rejection(team, candidate) is not None:
                continue
            accepted, _ = self._environment.can_apply_structural(
                candidate,
                role=team.role,
            )
            if not accepted:
                continue
            legal_structural.append(candidate)
            if len(legal_structural) >= self._max_structural_candidates:
                break

        unique: dict[str, TeamAction] = {}
        for move in (*parameter_moves, *legal_structural):
            unique.setdefault(str(move.to_dict()), move)
        return tuple(unique.values())

    def preview_reward(self, move: TeamMove) -> float:
        """Score a legal candidate without mutating the shared graph."""

        team = self._team_map.get(move.team_id)
        if team is None:
            raise ValueError(f"Unknown team: {move.team_id}")
        preview = self._environment.preview(
            move.action,
            role=team.role,
            rejection_reason=self._move_rejection(team, move.action),
        )
        transition = self._objective_evaluator.evaluate_transition(
            before=self._current_states[team.team_id],
            after_graph=preview["graph"],
            after_observation=preview["observation"],
            objective=team.as_objective(),
            action=move.action,
            action_accepted=bool(preview["accepted"]),
            charge_action=True,
            before_value=preview["before"],
            after_value=preview["after"],
        )
        return transition.reward

    def select_move(self, team_id: str, policy) -> TeamMove:
        """Use the stable graph + Objective -> Move policy boundary."""

        team = self._team_map.get(team_id)
        if team is None:
            raise ValueError(f"Unknown team: {team_id}")
        legal_moves = self.legal_moves(team_id)
        if not legal_moves:
            raise RuntimeError(f"Team '{team.name}' has no remaining move budget")
        action = policy.select_move(
            self._environment.graph_snapshot,
            team.as_objective(),
            legal_moves,
            lambda candidate: self.preview_reward(TeamMove(team_id=team_id, action=candidate)),
        )
        return TeamMove(team_id=team_id, action=action)

    def reset(self, *, seed: int | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
        observation, info = self._environment.reset(seed=seed)
        self._records = []
        self._cumulative_rewards = {team.team_id: 0.0 for team in self._teams}
        self._move_counts = {team.team_id: 0 for team in self._teams}
        self._structural_counts = {team.team_id: 0 for team in self._teams}
        self._current_states = self._evaluate_states()
        self._current_rewards = {
            team_id: self._state_reward(state)
            for team_id, state in self._current_states.items()
        }
        self._initial_rewards = dict(self._current_rewards)
        return observation, {
            **info,
            "team_objectives": self._evaluations_to_dict(self._current_rewards),
            "shared_reward": self._shared_reward(self._current_rewards),
        }

    def step(
        self,
        move: TeamMove,
    ) -> tuple[dict[str, Any], float, bool, bool, dict[str, Any]]:
        if not isinstance(move, TeamMove):
            raise TypeError("move must be a TeamMove")
        team = self._team_map.get(move.team_id)
        if team is None:
            raise ValueError(f"Unknown team: {move.team_id}")

        rejection_reason = self._move_rejection(team, move.action)
        previous_states = dict(self._current_states)
        observation, _, terminated, truncated, base_info = self._environment.step(
            move.action,
            role=team.role,
            rejection_reason=rejection_reason,
        )
        action_record = base_info["action"]
        accepted = bool(action_record["accepted"])
        transitions = self._evaluate_transitions(
            previous_states=previous_states,
            actor_team_id=team.team_id,
            action=move.action,
            accepted=accepted,
            before_value=action_record.get("before"),
            after_value=action_record.get("after"),
        )
        self._current_rewards = {
            team_id: self._state_reward(state)
            for team_id, state in self._current_states.items()
        }
        for team_id, evaluation in transitions.items():
            self._cumulative_rewards[team_id] += evaluation.total
        self._move_counts[team.team_id] += 1
        if accepted and self._is_structural(move.action):
            self._structural_counts[team.team_id] += self._structural_units(move.action)
        shared_reward = self._shared_reward(transitions)
        record = TeamMoveRecord(
            sequence=int(action_record["sequence"]),
            team_id=team.team_id,
            team_name=team.name,
            role=team.role,
            action=action_record["action"],
            accepted=accepted,
            before=action_record.get("before"),
            after=action_record.get("after"),
            reason=action_record.get("reason"),
            objective_rewards={key: value.total for key, value in transitions.items()},
            objective_components={key: value.components for key, value in transitions.items()},
            shared_reward=shared_reward,
        )
        self._records.append(record)
        info = {
            "episode_id": base_info["episode_id"],
            "step": base_info["step"],
            "move": record.to_dict(),
            "team_objectives": self._evaluations_to_dict(self._current_rewards),
            "transition_rewards": self._evaluations_to_dict(transitions),
            "cumulative_rewards": dict(self._cumulative_rewards),
            "move_counts": dict(self._move_counts),
            "structural_counts": dict(self._structural_counts),
            "shared_reward": shared_reward,
        }
        return observation, shared_reward, terminated, truncated, info

    def _evaluate_states(self) -> dict[str, ObjectiveStateEvaluation]:
        observation = self._environment.observation_snapshot
        graph = self._environment.graph_snapshot
        return {
            team.team_id: self._objective_evaluator.evaluate_state(
                graph, observation, team.as_objective()
            )
            for team in self._teams
        }

    def _evaluate_transitions(
        self,
        *,
        previous_states: Mapping[str, ObjectiveStateEvaluation],
        actor_team_id: str,
        action: TeamAction,
        accepted: bool,
        before_value: Any,
        after_value: Any,
    ) -> dict[str, RewardEvaluation]:
        observation = self._environment.observation_snapshot
        graph = self._environment.graph_snapshot
        transitions = {}
        next_states = {}
        for team in self._teams:
            result = self._objective_evaluator.evaluate_transition(
                before=previous_states[team.team_id],
                after_graph=graph,
                after_observation=observation,
                objective=team.as_objective(),
                action=action,
                action_accepted=accepted if team.team_id == actor_team_id else True,
                charge_action=team.team_id == actor_team_id,
                before_value=before_value,
                after_value=after_value,
            )
            transitions[team.team_id] = RewardEvaluation(
                total=result.reward,
                components=result.components,
            )
            next_states[team.team_id] = result.after
        self._current_states = next_states
        return transitions

    def _move_rejection(self, team: TeamDefinition, action: TeamAction) -> str | None:
        if self._move_counts[team.team_id] >= team.move_budget:
            return f"Team '{team.name}' exhausted its move budget"
        if not self._is_structural(action):
            return None
        if self._structural_counts[team.team_id] + self._structural_units(action) > team.structural_budget:
            return f"Team '{team.name}' exhausted its structural-move budget"
        edits = action.edits if isinstance(action, StructuralTransaction) else (action,)
        removed = {
            edit.name for edit in edits
            if isinstance(edit, RemoveNodeAction) and edit.name in self._environment.graph_snapshot
        }
        if self._environment.graph_snapshot.number_of_nodes() - len(removed) < team.min_live_nodes:
            return f"Team '{team.name}' must retain at least {team.min_live_nodes} live nodes"
        return None

    @staticmethod
    def _is_structural(action: TeamAction) -> bool:
        return not isinstance(action, (NoOpAction, ParameterAction))

    @staticmethod
    def _structural_units(action: TeamAction) -> int:
        if isinstance(action, StructuralTransaction):
            return len(action.edits)
        return 1 if MultiTeamEnvironment._is_structural(action) else 0

    @staticmethod
    def _state_reward(state: ObjectiveStateEvaluation) -> RewardEvaluation:
        return RewardEvaluation(total=state.potential, components=state.components)

    def _shared_reward(self, evaluations: Mapping[str, RewardEvaluation]) -> float:
        weight_sum = sum(team.weight for team in self._teams)
        return float(sum(
            team.weight * evaluations[team.team_id].total for team in self._teams
        ) / weight_sum)

    @staticmethod
    def _evaluations_to_dict(
        evaluations: Mapping[str, RewardEvaluation],
    ) -> dict[str, dict[str, Any]]:
        return {
            team_id: {
                "reward": evaluation.total,
                "components": dict(evaluation.components),
            }
            for team_id, evaluation in evaluations.items()
        }
