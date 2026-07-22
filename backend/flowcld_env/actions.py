"""Role authorization and safe parameter mutation for FlowCLD graphs."""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Iterable, Mapping, Protocol

import networkx as nx

from .types import ActionSlot, MutationMode, NoOpAction, ParameterAction, ParameterName
from .structural import (
    AddEdgeAction,
    AddNodeAction,
    RemoveEdgeAction,
    RemoveNodeAction,
    StructuralActionKind,
    StructuralTransaction,
)


class ActionValidationError(ValueError):
    """Raised when an action cannot be safely applied to a graph."""


@dataclass(frozen=True)
class RoleDefinition:
    """Least-privilege parameter and target ownership for one role.

    ``None`` for a target collection means all targets of that kind. An empty
    collection means no targets. Parameter permissions and target ownership
    must both match for an action to be authorized.
    """

    name: str
    node_parameters: frozenset[ParameterName] = field(default_factory=frozenset)
    edge_parameters: frozenset[ParameterName] = field(default_factory=frozenset)
    structural_actions: frozenset[StructuralActionKind] = field(default_factory=frozenset)
    node_targets: frozenset[str] | None = field(default_factory=frozenset)
    edge_targets: frozenset[tuple[str, str]] | None = field(default_factory=frozenset)


class AuthorizationPolicy(Protocol):
    def is_authorized(self, role: str, action: object) -> bool:
        """Return whether ``role`` owns the requested parameter target."""


class RoleBasedAuthorizationPolicy:
    """Explicit deny-by-default role authorization."""

    _NODE_PARAMETERS = frozenset({ParameterName.START_AMOUNT, ParameterName.RETENTION})
    _EDGE_PARAMETERS = frozenset({
        ParameterName.DECAY,
        ParameterName.DELAY,
        ParameterName.CONFIDENCE,
        ParameterName.CORRELATION,
    })

    def __init__(self, roles: Iterable[RoleDefinition]):
        definitions = tuple(roles)
        role_map = {role.name: role for role in definitions}
        if len(role_map) != len(definitions):
            raise ValueError("Role names must be unique")
        if any(not name.strip() for name in role_map):
            raise ValueError("Role names cannot be empty")
        self._roles = role_map

    def is_authorized(self, role: str, action: object) -> bool:
        definition = self._roles.get(role)
        if definition is None:
            return False
        if isinstance(action, NoOpAction):
            return True
        if isinstance(action, StructuralTransaction):
            return all(self.is_authorized(role, edit) for edit in action.edits)
        if isinstance(action, (AddNodeAction, RemoveNodeAction)):
            return (
                action.kind in definition.structural_actions
                and (definition.node_targets is None or action.name in definition.node_targets)
            )
        if isinstance(action, (AddEdgeAction, RemoveEdgeAction)):
            edge = (action.source, action.target)
            return (
                action.kind in definition.structural_actions
                and (definition.edge_targets is None or edge in definition.edge_targets)
            )
        if not isinstance(action, ParameterAction):
            return False
        if action.parameter in self._NODE_PARAMETERS:
            return (
                isinstance(action.target, str)
                and action.parameter in definition.node_parameters
                and (definition.node_targets is None or action.target in definition.node_targets)
            )
        if action.parameter in self._EDGE_PARAMETERS:
            return (
                isinstance(action.target, tuple)
                and len(action.target) == 2
                and action.parameter in definition.edge_parameters
                and (definition.edge_targets is None or action.target in definition.edge_targets)
            )
        return False

    def allowed_structural_kinds(self, role: str) -> frozenset[StructuralActionKind]:
        definition = self._roles.get(role)
        return definition.structural_actions if definition else frozenset()


@dataclass(frozen=True)
class ParameterBounds:
    """Safety bounds for Stage 1 parameter actions."""

    start_amount: tuple[float, float] = (-1_000_000.0, 1_000_000.0)
    retention: tuple[float, float] = (0.0, 1.0)
    decay: tuple[float, float] = (0.0, 1.0)
    delay: tuple[int, int] = (0, 20)
    confidence: tuple[float, float] = (0.0, 1.0)
    correlation: tuple[float, float] = (-1.0, 1.0)


class GraphMutator(Protocol):
    def slots(self, graph: nx.DiGraph) -> tuple[ActionSlot, ...]:
        """Describe every parameter dimension available on ``graph``."""

    def is_graph_compatible(self, graph: nx.DiGraph, action: ParameterAction) -> bool:
        """Return whether an action target and parameter are structurally valid."""

    def current_value(self, graph: nx.DiGraph, action: ParameterAction) -> float:
        """Read the current value selected by an action."""

    def apply(self, graph: nx.DiGraph, action: ParameterAction) -> tuple[float, float]:
        """Validate and apply an action, returning ``(before, after)``."""


class GraphParameterMutator:
    """Validates and applies only the bounded parameter actions in Stage 1."""

    _NODE_ATTRIBUTES: Mapping[ParameterName, str] = {
        ParameterName.START_AMOUNT: "start_amount",
        ParameterName.RETENTION: "retention",
    }
    _EDGE_ATTRIBUTES: Mapping[ParameterName, str] = {
        ParameterName.DECAY: "decay",
        ParameterName.DELAY: "delay",
        ParameterName.CONFIDENCE: "confidence",
        ParameterName.CORRELATION: "correlation",
    }

    def __init__(self, bounds: ParameterBounds | None = None):
        self._bounds = bounds or ParameterBounds()

    def slots(self, graph: nx.DiGraph) -> tuple[ActionSlot, ...]:
        slots: list[ActionSlot] = []
        for node in graph.nodes:
            slots.append(self._slot(ParameterName.START_AMOUNT, node))
            slots.append(self._slot(ParameterName.RETENTION, node))
        for source, target in graph.edges:
            edge = (str(source), str(target))
            slots.extend((
                self._slot(ParameterName.DECAY, edge),
                self._slot(ParameterName.DELAY, edge),
                self._slot(ParameterName.CONFIDENCE, edge),
                self._slot(ParameterName.CORRELATION, edge),
            ))
        return tuple(slots)

    def is_graph_compatible(self, graph: nx.DiGraph, action: ParameterAction) -> bool:
        try:
            self._validate_target(graph, action)
        except ActionValidationError:
            return False
        if action.parameter == ParameterName.RETENTION:
            node_data = graph.nodes[action.target]
            if node_data.get("formula"):
                return False
        return True

    def current_value(self, graph: nx.DiGraph, action: ParameterAction) -> float:
        self._validate_target(graph, action)
        attribute = self._attribute(action.parameter)
        if isinstance(action.target, str):
            return float(graph.nodes[action.target].get(attribute, 0.0))
        source, target = action.target
        return float(graph[source][target].get(attribute, 0.0))

    def apply(self, graph: nx.DiGraph, action: ParameterAction) -> tuple[float, float]:
        self._validate_target(graph, action)
        if not math.isfinite(float(action.value)):
            raise ActionValidationError("Action value must be finite")

        before = self.current_value(graph, action)
        requested = float(action.value) if action.mode == MutationMode.SET else before + float(action.value)
        lower, upper, integer = self._range(action.parameter)
        if integer and not requested.is_integer():
            raise ActionValidationError(f"{action.parameter.value} must resolve to an integer")
        if requested < lower or requested > upper:
            raise ActionValidationError(
                f"{action.parameter.value} must stay between {lower:g} and {upper:g}"
            )
        if action.parameter == ParameterName.RETENTION and isinstance(action.target, str):
            if graph.nodes[action.target].get("formula") and requested != 0.0:
                raise ActionValidationError("Formula converter retention must remain 0")

        after: float | int = int(requested) if integer else requested
        attribute = self._attribute(action.parameter)
        if isinstance(action.target, str):
            graph.nodes[action.target][attribute] = after
        else:
            source, target = action.target
            graph[source][target][attribute] = after
        return before, float(after)

    def _validate_target(self, graph: nx.DiGraph, action: ParameterAction) -> None:
        if action.parameter in self._NODE_ATTRIBUTES:
            if not isinstance(action.target, str):
                raise ActionValidationError(f"{action.parameter.value} requires a node target")
            if action.target not in graph.nodes:
                raise ActionValidationError(f"Unknown node target: {action.target}")
            return
        if action.parameter in self._EDGE_ATTRIBUTES:
            if not isinstance(action.target, tuple) or len(action.target) != 2:
                raise ActionValidationError(f"{action.parameter.value} requires an edge target")
            if not graph.has_edge(*action.target):
                raise ActionValidationError(f"Unknown edge target: {action.target}")
            return
        raise ActionValidationError(f"Unsupported parameter: {action.parameter}")

    def _slot(self, parameter: ParameterName, target: str | tuple[str, str]) -> ActionSlot:
        lower, upper, integer = self._range(parameter)
        if isinstance(target, tuple):
            target_key = f"{target[0]}->{target[1]}"
            prefix = "edge"
        else:
            target_key = target
            prefix = "node"
        return ActionSlot(
            key=f"{prefix}:{target_key}:{parameter.value}",
            parameter=parameter,
            target=target,
            minimum=lower,
            maximum=upper,
            integer=integer,
        )

    def _attribute(self, parameter: ParameterName) -> str:
        try:
            return self._NODE_ATTRIBUTES.get(parameter) or self._EDGE_ATTRIBUTES[parameter]
        except KeyError as error:
            raise ActionValidationError(f"Unsupported parameter: {parameter}") from error

    def _range(self, parameter: ParameterName) -> tuple[float, float, bool]:
        ranges = {
            ParameterName.START_AMOUNT: (*self._bounds.start_amount, False),
            ParameterName.RETENTION: (*self._bounds.retention, False),
            ParameterName.DECAY: (*self._bounds.decay, False),
            ParameterName.DELAY: (*self._bounds.delay, True),
            ParameterName.CONFIDENCE: (*self._bounds.confidence, False),
            ParameterName.CORRELATION: (*self._bounds.correlation, False),
        }
        return ranges[parameter]
