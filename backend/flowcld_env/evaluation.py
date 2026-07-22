"""Atomic one-rollout evaluation of a single-agent parameter policy."""

from __future__ import annotations

import copy
from dataclasses import dataclass
import hashlib
import json
from typing import Any, Iterable

import networkx as nx

try:
    from advanced_analysis import build_graph_from_payload
except ModuleNotFoundError:
    from backend.advanced_analysis import build_graph_from_payload

from .actions import (
    ActionValidationError,
    AuthorizationPolicy,
    GraphMutator,
    GraphParameterMutator,
)
from .observations import ObservationBuilder, SimulationObservationBuilder
from .rewards import CompositeRewardModel, RewardContext, RewardModel
from .types import (
    ActionSlot,
    EnvironmentObservation,
    ParameterAction,
    ParameterName,
    RewardEvaluation,
    TargetSpecification,
    validate_target_specification,
)


@dataclass(frozen=True)
class ConfigurationEvaluation:
    """Result of applying and evaluating one complete parameter policy."""

    accepted: bool
    reward: RewardEvaluation
    observation: EnvironmentObservation
    reason: str | None = None


class ParameterConfigurationEvaluator:
    """Evaluates complete configurations with one simulation rollout.

    Candidate actions are applied to a private baseline copy. If any action is
    unauthorized or invalid, the complete candidate is rejected and evaluated
    against an unchanged baseline, so partial policies can never leak through.
    """

    def __init__(
        self,
        graph: nx.DiGraph,
        *,
        role: str,
        authorization_policy: AuthorizationPolicy,
        target: TargetSpecification,
        mutator: GraphMutator | None = None,
        observation_builder: ObservationBuilder | None = None,
        reward_model: RewardModel | None = None,
    ):
        if not isinstance(graph, nx.DiGraph) or not graph.nodes:
            raise ValueError("graph must be a non-empty networkx.DiGraph")
        if not isinstance(role, str) or not role.strip():
            raise ValueError("role must be a non-empty name")
        self._baseline_graph = nx.freeze(copy.deepcopy(graph))
        self._role = role
        self._authorization_policy = authorization_policy
        self._target = target
        self._mutator = mutator or GraphParameterMutator()
        self._observation_builder = observation_builder or SimulationObservationBuilder()
        self._reward_model = reward_model or CompositeRewardModel()
        validate_target_specification(target, set(self._baseline_graph.nodes))
        horizon = getattr(self._observation_builder, "horizon", None)
        if horizon is not None:
            for node, values in target.trajectories.items():
                if len(tuple(values)) > int(horizon) + 1:
                    raise ValueError(
                        f"Target trajectory for {node} exceeds the simulation horizon ({horizon + 1} values)"
                    )

    @classmethod
    def from_payload(cls, graph_data: dict[str, Any], **kwargs: Any) -> "ParameterConfigurationEvaluator":
        return cls(build_graph_from_payload(graph_data), **kwargs)

    @property
    def role(self) -> str:
        return self._role

    @property
    def target(self) -> TargetSpecification:
        return self._target

    @property
    def baseline_fingerprint(self) -> str:
        """Stable identity used to prevent checkpoint/model mismatches."""

        payload = {
            "nodes": [
                (str(node), dict(sorted(self._baseline_graph.nodes[node].items())))
                for node in sorted(self._baseline_graph.nodes, key=str)
            ],
            "edges": [
                (str(source), str(target), dict(sorted(data.items())))
                for source, target, data in sorted(
                    self._baseline_graph.edges(data=True),
                    key=lambda item: (str(item[0]), str(item[1])),
                )
            ],
        }
        encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    @property
    def evaluation_fingerprint(self) -> str:
        """Identity of graph plus rollout/reward semantics for checkpoints."""

        reward_components = getattr(self._reward_model, "components", ())
        payload = {
            "baseline": self.baseline_fingerprint,
            "observation_builder": type(self._observation_builder).__qualname__,
            "horizon": getattr(self._observation_builder, "horizon", None),
            "reward_model": type(self._reward_model).__qualname__,
            "reward_components": [repr(component) for component in reward_components],
            "mutator": type(self._mutator).__qualname__,
        }
        encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def available_slots(
        self,
        parameters: Iterable[ParameterName] | None = None,
    ) -> tuple[ActionSlot, ...]:
        selected = set(parameters) if parameters is not None else None
        graph = nx.DiGraph(copy.deepcopy(self._baseline_graph))
        allowed: list[ActionSlot] = []
        for slot in self._mutator.slots(graph):
            if selected is not None and slot.parameter not in selected:
                continue
            probe = ParameterAction(parameter=slot.parameter, target=slot.target, value=0.0)
            if (
                self._authorization_policy.is_authorized(self._role, probe)
                and self._mutator.is_graph_compatible(graph, probe)
            ):
                allowed.append(slot)
        return tuple(allowed)

    def baseline_value(self, slot: ActionSlot) -> float:
        graph = nx.DiGraph(copy.deepcopy(self._baseline_graph))
        probe = ParameterAction(parameter=slot.parameter, target=slot.target, value=0.0)
        return self._mutator.current_value(graph, probe)

    def evaluate(self, actions: Iterable[ParameterAction]) -> ConfigurationEvaluation:
        candidate_actions = tuple(actions)
        working_graph = nx.DiGraph(copy.deepcopy(self._baseline_graph))
        accepted = True
        reason: str | None = None
        seen: set[tuple[ParameterName, str | tuple[str, str]]] = set()

        for action in candidate_actions:
            action_key = (action.parameter, action.target)
            if action_key in seen:
                accepted = False
                reason = f"Duplicate parameter action: {action.parameter.value} on {action.target}"
                break
            seen.add(action_key)
            if not self._authorization_policy.is_authorized(self._role, action):
                accepted = False
                reason = f"Role '{self._role}' is not authorized for this action"
                break
            try:
                self._mutator.apply(working_graph, action)
            except ActionValidationError as error:
                accepted = False
                reason = str(error)
                break

        if not accepted:
            working_graph = nx.DiGraph(copy.deepcopy(self._baseline_graph))

        observation = self._observation_builder.build(
            working_graph,
            episode_id=0,
            step=1 if candidate_actions else 0,
            seed=None,
        )
        reward = self._reward_model.evaluate(RewardContext(
            observation=observation,
            target=self._target,
            action_accepted=accepted,
        ))
        return ConfigurationEvaluation(
            accepted=accepted,
            reward=reward,
            observation=observation,
            reason=reason,
        )
