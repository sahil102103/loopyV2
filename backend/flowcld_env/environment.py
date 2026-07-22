"""Gymnasium-shaped orchestration for parameter and structural FlowCLD episodes."""

from __future__ import annotations

import copy
from typing import Any

import networkx as nx
import numpy as np

try:
    from advanced_analysis import build_graph_from_payload
except ModuleNotFoundError:  # Repository-level package imports.
    from backend.advanced_analysis import build_graph_from_payload

from .actions import (
    ActionValidationError,
    AuthorizationPolicy,
    GraphMutator,
    GraphParameterMutator,
)
from .observations import ObservationBuilder, SimulationObservationBuilder
from .objectives import ObjectiveEvaluator, ObjectiveStateEvaluation
from .rewards import (
    CompositeRewardModel,
    RewardContext,
    RewardModel,
    StructuralPreservationPenalty,
    default_reward_components,
)
from .structural import (
    AddEdgeAction,
    AddNodeAction,
    RemoveEdgeAction,
    RemoveNodeAction,
    StructuralConstraintSet,
    StructuralGraphMutator,
    StructuralMutator,
    StructuralTransaction,
    StructuralValidationError,
)
from .types import (
    EnvironmentObservation,
    MoveRecord,
    ParameterAction,
    NoOpAction,
    Objective,
    RewardEvaluation,
    TargetSpecification,
    validate_target_specification,
)


class FlowCLDEnvironment:
    """Target-seeking graph environment around ``simulate_two_phase``.

    The class coordinates injected policies and services; it does not contain
    authorization, graph mutation, simulation, or reward formulas itself. The
    return signatures follow Gymnasium conventions:

    ``reset() -> (observation, info)``
    ``step()  -> (observation, reward, terminated, truncated, info)``
    """

    def __init__(
        self,
        graph: nx.DiGraph,
        *,
        authorization_policy: AuthorizationPolicy,
        target: TargetSpecification | None = None,
        objective: Objective | None = None,
        mutator: GraphMutator | None = None,
        structural_mutator: StructuralMutator | None = None,
        observation_builder: ObservationBuilder | None = None,
        reward_model: RewardModel | None = None,
        objective_evaluator: ObjectiveEvaluator | None = None,
        max_steps: int = 20,
    ):
        if not isinstance(graph, nx.DiGraph) or not graph.nodes:
            raise ValueError("graph must be a non-empty networkx.DiGraph")
        if not isinstance(max_steps, int) or max_steps < 1:
            raise ValueError("max_steps must be a positive integer")

        baseline = copy.deepcopy(graph)
        self._baseline_graph = nx.freeze(baseline)
        self._authorization_policy = authorization_policy
        if target is not None and objective is not None and target != objective.target:
            raise ValueError("target and objective.target cannot disagree")
        self._objective = objective
        self._target = objective.target if objective is not None else (target or TargetSpecification())
        self._mutator = mutator or GraphParameterMutator()
        protected_target_nodes = set(self._target.trajectories) | set(self._target.behaviors)
        self._structural_mutator = structural_mutator or StructuralGraphMutator(
            self._baseline_graph,
            StructuralConstraintSet.conservative(protected_nodes=protected_target_nodes),
        )
        self._observation_builder = observation_builder or SimulationObservationBuilder()
        horizon = int(getattr(self._observation_builder, "horizon", 200))
        self._objective_evaluator = objective_evaluator or ObjectiveEvaluator(horizon=horizon)
        self._reward_model = reward_model or CompositeRewardModel((*default_reward_components(),
            StructuralPreservationPenalty(
                baseline_nodes=self._baseline_graph.number_of_nodes(),
                baseline_edges=self._baseline_graph.number_of_edges(),
            ),
        ))
        self._max_steps = max_steps
        validate_target_specification(self._target, set(self._baseline_graph.nodes))
        if self._objective is not None:
            self._objective.validate_for_graph(set(self._baseline_graph.nodes))

        self._graph: nx.DiGraph | None = None
        self._observation: EnvironmentObservation | None = None
        self._episode_id = 0
        self._step = 0
        self._seed: int | None = None
        self._rng = np.random.default_rng()
        self._move_log: list[MoveRecord] = []
        self._episode_logs: list[tuple[MoveRecord, ...]] = []
        self._episode_closed = False
        self._objective_state: ObjectiveStateEvaluation | None = None

    @classmethod
    def from_payload(cls, graph_data: dict[str, Any], **kwargs: Any) -> "FlowCLDEnvironment":
        """Build an environment through the backend's canonical graph validator."""

        return cls(build_graph_from_payload(graph_data), **kwargs)

    @property
    def baseline_graph(self) -> nx.DiGraph:
        """Return a defensive, frozen copy of the immutable episode baseline."""

        return nx.freeze(copy.deepcopy(self._baseline_graph))

    @property
    def graph_snapshot(self) -> nx.DiGraph:
        """Return a defensive copy of the current graph."""

        self._require_reset()
        return copy.deepcopy(self._graph)

    @property
    def observation_snapshot(self) -> EnvironmentObservation:
        """Return the current immutable observation value object.

        Coordinators such as the multi-team environment use this read-only
        boundary to evaluate additional objectives without rebuilding or
        mutating the graph.
        """

        self._require_reset()
        return copy.deepcopy(self._observation)

    @property
    def move_log(self) -> tuple[MoveRecord, ...]:
        return tuple(self._move_log)

    @property
    def episode_logs(self) -> tuple[tuple[MoveRecord, ...], ...]:
        archived = list(self._episode_logs)
        if self._episode_id:
            archived.append(tuple(self._move_log))
        return tuple(archived)

    def reset(self, *, seed: int | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
        """Restore the baseline graph and start a deterministic new episode."""

        if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool)):
            raise ValueError("seed must be an integer or None")
        if self._episode_id:
            self._episode_logs.append(tuple(self._move_log))

        self._episode_id += 1
        self._step = 0
        self._seed = seed
        self._rng = np.random.default_rng(seed)
        self._graph = nx.DiGraph(copy.deepcopy(self._baseline_graph))
        self._move_log = []
        self._episode_closed = False
        self._observation = self._build_observation()
        self._objective_state = (
            self._objective_evaluator.evaluate_state(
                self._graph, self._observation, self._objective
            )
            if self._objective is not None else None
        )
        info = {
            "episode_id": self._episode_id,
            "seed": seed,
            "max_steps": self._max_steps,
            "objective_potential": (
                self._objective_state.potential if self._objective_state is not None else None
            ),
        }
        return self._observation.to_dict(), info

    def step(
        self,
        action: NoOpAction | ParameterAction | AddNodeAction | RemoveNodeAction | AddEdgeAction | RemoveEdgeAction | StructuralTransaction,
        *,
        role: str,
        rejection_reason: str | None = None,
    ) -> tuple[dict[str, Any], float, bool, bool, dict[str, Any]]:
        """Attempt one role-authorized mutation, then simulate and score it."""

        self._require_reset()
        if self._episode_closed:
            raise RuntimeError("Episode is finished; call reset() before stepping again")
        previous_objective_state = self._objective_state
        if rejection_reason is not None:
            before, after, accepted, reason = None, None, False, str(rejection_reason)
        elif isinstance(action, NoOpAction):
            before, after, accepted, reason = None, None, True, action.reason
        elif isinstance(action, ParameterAction):
            before, after, accepted, reason = self._apply_parameter_action(action, role)
        elif isinstance(action, (AddNodeAction, RemoveNodeAction, AddEdgeAction, RemoveEdgeAction, StructuralTransaction)):
            before, after, accepted, reason = self._apply_structural_action(action, role)
        else:
            raise TypeError("action must be a parameter action or structural edit/transaction")

        self._step += 1
        self._observation = self._build_observation()
        if self._objective is not None:
            transition = self._objective_evaluator.evaluate_transition(
                before=previous_objective_state,
                after_graph=self._graph,
                after_observation=self._observation,
                objective=self._objective,
                action=action,
                action_accepted=accepted,
                before_value=before,
                after_value=after,
            )
            self._objective_state = transition.after
            reward = RewardEvaluation(
                total=transition.reward,
                components=transition.components,
            )
        else:
            reward = self._reward_model.evaluate(RewardContext(
                observation=self._observation,
                target=self._target,
                action_accepted=accepted,
            ))

        # Parameter-only Stage 1 episodes have no terminal state beyond their
        # configured move budget. A future task-specific adapter may add a
        # target-success terminal condition without changing this environment.
        terminated = bool(
            self._objective is not None
            and self._objective.goal_potential is not None
            and self._objective_state.potential >= self._objective.goal_potential
        )
        truncated = self._step >= self._max_steps
        self._episode_closed = terminated or truncated

        record = MoveRecord(
            episode_id=self._episode_id,
            sequence=self._step,
            role=role,
            action=action,
            accepted=accepted,
            before=before,
            after=after,
            reward=reward.total,
            reward_components=reward.components,
            reason=reason,
        )
        self._move_log.append(record)

        info = {
            "episode_id": self._episode_id,
            "step": self._step,
            "action": record.to_dict(),
            "reward_components": dict(reward.components),
            "action_mask": self.action_mask(role),
            "structural_action_mask": self.structural_action_mask(role),
        }
        return self._observation.to_dict(), reward.total, terminated, truncated, info

    def action_mask(self, role: str) -> dict[str, bool]:
        """Return a stable mask over every parameter dimension in the graph."""

        self._require_reset()
        mask: dict[str, bool] = {}
        for slot in self._mutator.slots(self._graph):
            probe = ParameterAction(parameter=slot.parameter, target=slot.target, value=0.0)
            mask[slot.key] = (
                self._authorization_policy.is_authorized(role, probe)
                and self._mutator.is_graph_compatible(self._graph, probe)
            )
        return mask

    def preview(
        self,
        action: NoOpAction | ParameterAction | AddNodeAction | RemoveNodeAction | AddEdgeAction | RemoveEdgeAction | StructuralTransaction,
        *,
        role: str,
        rejection_reason: str | None = None,
    ) -> dict[str, Any]:
        """Evaluate one candidate on a private graph copy without logging it."""

        self._require_reset()
        candidate = nx.DiGraph(copy.deepcopy(self._graph))
        before: Any = None
        after: Any = None
        accepted = rejection_reason is None
        reason = rejection_reason
        if accepted and isinstance(action, NoOpAction):
            reason = action.reason
        elif accepted and isinstance(action, ParameterAction):
            if self._mutator.is_graph_compatible(candidate, action):
                before = self._mutator.current_value(candidate, action)
            if not self._authorization_policy.is_authorized(role, action):
                accepted = False
                reason = f"Role '{role}' is not authorized for this action"
            else:
                try:
                    before, after = self._mutator.apply(candidate, action)
                except ActionValidationError as error:
                    accepted = False
                    reason = str(error)
        elif accepted:
            transaction = action if isinstance(action, StructuralTransaction) else StructuralTransaction((action,))
            if not self._authorization_policy.is_authorized(role, transaction):
                accepted = False
                reason = f"Role '{role}' is not authorized for this structural transaction"
            else:
                try:
                    candidate, summary = self._structural_mutator.apply(candidate, transaction)
                    before = {
                        "nodes": self._graph.number_of_nodes(),
                        "edges": self._graph.number_of_edges(),
                    }
                    after = summary.to_dict()
                except StructuralValidationError as error:
                    accepted = False
                    reason = str(error)
        if not accepted:
            candidate = nx.DiGraph(copy.deepcopy(self._graph))
        observation = self._observation_builder.build(
            candidate,
            episode_id=self._episode_id,
            step=self._step + 1,
            seed=self._seed,
        )
        return {
            "graph": candidate,
            "observation": observation,
            "accepted": accepted,
            "reason": reason,
            "before": before,
            "after": after,
        }

    def action_space(self, role: str) -> tuple[dict[str, Any], ...]:
        """Return mask, bounds, and type metadata for each action dimension."""

        self._require_reset()
        mask = self.action_mask(role)
        return tuple(slot.to_dict(allowed=mask[slot.key]) for slot in self._mutator.slots(self._graph))

    def structural_action_mask(self, role: str) -> dict[str, Any]:
        """Describe authorized and currently safe destructive structural actions."""

        self._require_reset()
        kinds_provider = getattr(self._authorization_policy, "allowed_structural_kinds", None)
        allowed_kinds = kinds_provider(role) if kinds_provider else frozenset()
        kind_mask = {kind.value: kind in allowed_kinds for kind in (
            AddNodeAction.kind,
            RemoveNodeAction.kind,
            AddEdgeAction.kind,
            RemoveEdgeAction.kind,
        )}
        removable_nodes = {}
        for node in self._graph.nodes:
            action = RemoveNodeAction(str(node))
            transaction = StructuralTransaction((action,))
            safe, _ = self._can_apply_structural(transaction)
            removable_nodes[str(node)] = (
                self._authorization_policy.is_authorized(role, action) and safe
            )
        removable_edges = {}
        for source, target in self._graph.edges:
            action = RemoveEdgeAction(str(source), str(target))
            transaction = StructuralTransaction((action,))
            safe, _ = self._can_apply_structural(transaction)
            removable_edges[f"{source}->{target}"] = (
                self._authorization_policy.is_authorized(role, action) and safe
            )
        return {
            "kinds": kind_mask,
            "removable_nodes": removable_nodes,
            "removable_edges": removable_edges,
        }

    def can_apply_structural(
        self,
        action: AddNodeAction | RemoveNodeAction | AddEdgeAction | RemoveEdgeAction | StructuralTransaction,
        *,
        role: str,
    ) -> tuple[bool, str | None]:
        """Check authorization and hard constraints without simulating or logging."""

        if not isinstance(action, (
            AddNodeAction,
            RemoveNodeAction,
            AddEdgeAction,
            RemoveEdgeAction,
            StructuralTransaction,
        )):
            raise TypeError("action must be a structural edit or transaction")
        transaction = (
            action if isinstance(action, StructuralTransaction)
            else StructuralTransaction((action,))
        )
        if not self._authorization_policy.is_authorized(role, transaction):
            return False, f"Role '{role}' is not authorized for this structural transaction"
        return self._can_apply_structural(transaction)

    def _apply_parameter_action(
        self,
        action: ParameterAction,
        role: str,
    ) -> tuple[float | None, float | None, bool, str | None]:
        before: float | None = None
        if self._mutator.is_graph_compatible(self._graph, action):
            before = self._mutator.current_value(self._graph, action)
        if not self._authorization_policy.is_authorized(role, action):
            return before, None, False, f"Role '{role}' is not authorized for this action"
        try:
            before, after = self._mutator.apply(self._graph, action)
            return before, after, True, None
        except ActionValidationError as error:
            return before, None, False, str(error)

    def _apply_structural_action(
        self,
        action: AddNodeAction | RemoveNodeAction | AddEdgeAction | RemoveEdgeAction | StructuralTransaction,
        role: str,
    ) -> tuple[dict[str, int], dict[str, Any] | None, bool, str | None]:
        transaction = action if isinstance(action, StructuralTransaction) else StructuralTransaction((action,))
        before = {
            "nodes": self._graph.number_of_nodes(),
            "edges": self._graph.number_of_edges(),
        }
        if not self._authorization_policy.is_authorized(role, transaction):
            return before, None, False, f"Role '{role}' is not authorized for this structural transaction"
        try:
            candidate, summary = self._structural_mutator.apply(self._graph, transaction)
            self._graph = candidate
            return before, summary.to_dict(), True, None
        except StructuralValidationError as error:
            return before, None, False, str(error)

    def _can_apply_structural(self, transaction: StructuralTransaction) -> tuple[bool, str | None]:
        checker = getattr(self._structural_mutator, "can_apply", None)
        if checker:
            return checker(self._graph, transaction)
        try:
            self._structural_mutator.apply(self._graph, transaction)
            return True, None
        except (StructuralValidationError, ValueError, TypeError) as error:
            return False, str(error)

    def _build_observation(self) -> EnvironmentObservation:
        return self._observation_builder.build(
            self._graph,
            episode_id=self._episode_id,
            step=self._step,
            seed=self._seed,
        )

    def _require_reset(self) -> None:
        if self._graph is None:
            raise RuntimeError("Call reset() before using the environment")
