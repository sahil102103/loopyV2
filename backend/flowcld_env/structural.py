"""Atomic structural graph edits and independently composable safety rules."""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from enum import Enum
import math
from numbers import Integral
from typing import Any, Iterable, Protocol

import networkx as nx


SUPPORTED_EDGE_FORMS = frozenset({"linear", "tanh", "quadratic", "cubic", "relu", "step"})


class StructuralActionKind(str, Enum):
    ADD_NODE = "add_node"
    REMOVE_NODE = "remove_node"
    ADD_EDGE = "add_edge"
    REMOVE_EDGE = "remove_edge"


class StructuralValidationError(ValueError):
    """Raised when a structural transaction is malformed or unsafe."""


def _nonempty_name(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty name")
    return value.strip()


def _optional_formula(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError(f"{field_name} must be plain text or None")
    return value.strip() or None


def _json_bound(value: float) -> float | str:
    if value == math.inf:
        return "Infinity"
    if value == -math.inf:
        return "-Infinity"
    return value


@dataclass(frozen=True)
class AddNodeAction:
    name: str
    start_amount: float = 0.0
    retention: float = 1.0
    floor: float = -math.inf
    ceiling: float = math.inf
    formula: str | None = None
    sink_formula: str | None = None
    source_formula: str | None = None
    kind: StructuralActionKind = field(default=StructuralActionKind.ADD_NODE, init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", _nonempty_name(self.name, "Node name"))
        for field_name in ("start_amount", "retention"):
            value = float(getattr(self, field_name))
            if not math.isfinite(value):
                raise ValueError(f"{field_name} must be finite")
            object.__setattr__(self, field_name, value)
        for field_name in ("floor", "ceiling"):
            value = float(getattr(self, field_name))
            if math.isnan(value):
                raise ValueError(f"{field_name} cannot be NaN")
            object.__setattr__(self, field_name, value)
        for field_name in ("formula", "sink_formula", "source_formula"):
            object.__setattr__(self, field_name, _optional_formula(getattr(self, field_name), field_name))
        if not 0.0 <= self.retention <= 1.0:
            raise ValueError("retention must be between 0 and 1")
        if self.floor > self.ceiling:
            raise ValueError("floor cannot exceed ceiling")
        if self.formula and self.retention != 0.0:
            raise ValueError("Formula converter nodes must have retention 0")

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "name": self.name,
            "start_amount": self.start_amount,
            "retention": self.retention,
            "floor": _json_bound(self.floor),
            "ceiling": _json_bound(self.ceiling),
            "formula": self.formula,
            "sink_formula": self.sink_formula,
            "source_formula": self.source_formula,
        }


@dataclass(frozen=True)
class RemoveNodeAction:
    name: str
    kind: StructuralActionKind = field(default=StructuralActionKind.REMOVE_NODE, init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", _nonempty_name(self.name, "Node name"))

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind.value, "name": self.name}


@dataclass(frozen=True)
class AddEdgeAction:
    source: str
    target: str
    correlation: float = 1.0
    decay: float = 0.0
    delay: int = 0
    confidence: float = 1.0
    functional_form: str = "linear"
    kind: StructuralActionKind = field(default=StructuralActionKind.ADD_EDGE, init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", _nonempty_name(self.source, "Edge source"))
        object.__setattr__(self, "target", _nonempty_name(self.target, "Edge target"))
        for field_name in ("correlation", "decay", "confidence"):
            value = float(getattr(self, field_name))
            if not math.isfinite(value):
                raise ValueError(f"{field_name} must be finite")
            object.__setattr__(self, field_name, value)
        if not 0.0 <= self.decay <= 1.0:
            raise ValueError("decay must be between 0 and 1")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        if isinstance(self.delay, bool) or not isinstance(self.delay, Integral) or self.delay < 0:
            raise ValueError("delay must be a non-negative integer")
        object.__setattr__(self, "delay", int(self.delay))
        form = str(self.functional_form).strip().lower()
        if form not in SUPPORTED_EDGE_FORMS:
            raise ValueError(f"Unsupported functional form: {form}")
        object.__setattr__(self, "functional_form", form)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "source": self.source,
            "target": self.target,
            "correlation": self.correlation,
            "decay": self.decay,
            "delay": self.delay,
            "confidence": self.confidence,
            "functional_form": self.functional_form,
        }


@dataclass(frozen=True)
class RemoveEdgeAction:
    source: str
    target: str
    kind: StructuralActionKind = field(default=StructuralActionKind.REMOVE_EDGE, init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", _nonempty_name(self.source, "Edge source"))
        object.__setattr__(self, "target", _nonempty_name(self.target, "Edge target"))

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind.value, "source": self.source, "target": self.target}


StructuralEdit = AddNodeAction | RemoveNodeAction | AddEdgeAction | RemoveEdgeAction


@dataclass(frozen=True)
class StructuralTransaction:
    """A set of structural edits that succeeds or fails as one unit."""

    edits: tuple[StructuralEdit, ...]
    label: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "edits", tuple(self.edits))
        if not self.edits:
            raise ValueError("A structural transaction needs at least one edit")
        if any(not isinstance(edit, (AddNodeAction, RemoveNodeAction, AddEdgeAction, RemoveEdgeAction)) for edit in self.edits):
            raise TypeError("Structural transactions may only contain structural edits")

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "structural_transaction",
            "label": self.label,
            "edits": [edit.to_dict() for edit in self.edits],
        }


@dataclass(frozen=True)
class StructuralMutationSummary:
    nodes_before: int
    nodes_after: int
    edges_before: int
    edges_after: int
    added_nodes: tuple[str, ...]
    removed_nodes: tuple[str, ...]
    added_edges: tuple[tuple[str, str], ...]
    removed_edges: tuple[tuple[str, str], ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes_before": self.nodes_before,
            "nodes_after": self.nodes_after,
            "edges_before": self.edges_before,
            "edges_after": self.edges_after,
            "added_nodes": list(self.added_nodes),
            "removed_nodes": list(self.removed_nodes),
            "added_edges": [list(edge) for edge in self.added_edges],
            "removed_edges": [list(edge) for edge in self.removed_edges],
        }


class StructuralConstraint(Protocol):
    @property
    def name(self) -> str:
        """Stable diagnostic name."""

    def violation(
        self,
        baseline: nx.DiGraph,
        before: nx.DiGraph,
        candidate: nx.DiGraph,
        transaction: StructuralTransaction,
    ) -> str | None:
        """Return a violation message or ``None``."""


@dataclass(frozen=True)
class GraphSizeConstraint:
    min_nodes: int = 1
    max_nodes: int = 100
    max_edges: int = 500
    name: str = "graph_size"

    def violation(self, baseline, before, candidate, transaction) -> str | None:
        if candidate.number_of_nodes() < self.min_nodes:
            return f"Graph must retain at least {self.min_nodes} node(s)"
        if candidate.number_of_nodes() > self.max_nodes:
            return f"Graph cannot exceed {self.max_nodes} nodes"
        if candidate.number_of_edges() > self.max_edges:
            return f"Graph cannot exceed {self.max_edges} edges"
        return None


@dataclass(frozen=True)
class BaselineRetentionConstraint:
    min_node_fraction: float = 0.5
    min_edge_fraction: float = 0.25
    name: str = "baseline_retention"

    def __post_init__(self) -> None:
        if not 0.0 <= self.min_node_fraction <= 1.0:
            raise ValueError("min_node_fraction must be between 0 and 1")
        if not 0.0 <= self.min_edge_fraction <= 1.0:
            raise ValueError("min_edge_fraction must be between 0 and 1")

    def violation(self, baseline, before, candidate, transaction) -> str | None:
        min_nodes = max(1, math.ceil(baseline.number_of_nodes() * self.min_node_fraction))
        min_edges = math.ceil(baseline.number_of_edges() * self.min_edge_fraction)
        if candidate.number_of_nodes() < min_nodes:
            return f"Anti-collapse rule requires at least {min_nodes} baseline nodes"
        if candidate.number_of_edges() < min_edges:
            return f"Anti-collapse rule requires at least {min_edges} baseline edges"
        return None


@dataclass(frozen=True)
class ProtectedElementsConstraint:
    protected_nodes: frozenset[str] = field(default_factory=frozenset)
    protected_edges: frozenset[tuple[str, str]] = field(default_factory=frozenset)
    name: str = "protected_elements"

    def violation(self, baseline, before, candidate, transaction) -> str | None:
        missing_nodes = self.protected_nodes - set(candidate.nodes)
        if missing_nodes:
            return f"Protected nodes cannot be removed: {sorted(missing_nodes)}"
        missing_edges = self.protected_edges - set(candidate.edges)
        if missing_edges:
            return f"Protected edges cannot be removed: {sorted(missing_edges)}"
        return None


@dataclass(frozen=True)
class ComponentIntegrityConstraint:
    prevent_component_growth: bool = True
    prevent_new_isolates: bool = True
    name: str = "component_integrity"

    def violation(self, baseline, before, candidate, transaction) -> str | None:
        if not candidate.nodes:
            return "Graph cannot be empty"
        if self.prevent_component_growth:
            baseline_components = nx.number_weakly_connected_components(baseline)
            candidate_components = nx.number_weakly_connected_components(candidate)
            if candidate_components > baseline_components:
                return "Structural edit would fragment the graph into more components"
        if self.prevent_new_isolates:
            baseline_isolates = set(nx.isolates(baseline))
            new_isolates = set(nx.isolates(candidate)) - baseline_isolates
            if new_isolates:
                return f"Structural edit would create isolated nodes: {sorted(new_isolates)}"
        return None


@dataclass(frozen=True)
class NoNewSelfLoopsConstraint:
    """Preserve existing self-loops but reject newly introduced ones."""

    name: str = "no_new_self_loops"

    def violation(self, baseline, before, candidate, transaction) -> str | None:
        baseline_loops = set(nx.selfloop_edges(baseline))
        new_loops = set(nx.selfloop_edges(candidate)) - baseline_loops
        if new_loops:
            return f"Structural edit would add self-loops: {sorted(new_loops)}"
        return None


@dataclass(frozen=True)
class RequiredReachabilityConstraint:
    paths: frozenset[tuple[str, str]] = field(default_factory=frozenset)
    name: str = "required_reachability"

    def violation(self, baseline, before, candidate, transaction) -> str | None:
        for source, target in self.paths:
            if source not in candidate or target not in candidate or not nx.has_path(candidate, source, target):
                return f"Required causal path must remain reachable: {source} -> {target}"
        return None


class StructuralConstraintSet:
    """Open-ended composition of hard structural safety constraints."""

    def __init__(self, constraints: Iterable[StructuralConstraint]):
        selected = tuple(constraints)
        names = [constraint.name for constraint in selected]
        if len(names) != len(set(names)):
            raise ValueError("Structural constraint names must be unique")
        self._constraints = selected

    @classmethod
    def conservative(
        cls,
        *,
        protected_nodes: Iterable[str] = (),
        protected_edges: Iterable[tuple[str, str]] = (),
        required_paths: Iterable[tuple[str, str]] = (),
    ) -> "StructuralConstraintSet":
        return cls((
            GraphSizeConstraint(),
            BaselineRetentionConstraint(),
            ProtectedElementsConstraint(
                protected_nodes=frozenset(protected_nodes),
                protected_edges=frozenset(protected_edges),
            ),
            ComponentIntegrityConstraint(),
            NoNewSelfLoopsConstraint(),
            RequiredReachabilityConstraint(paths=frozenset(required_paths)),
        ))

    @property
    def constraints(self) -> tuple[StructuralConstraint, ...]:
        return self._constraints

    def violations(
        self,
        baseline: nx.DiGraph,
        before: nx.DiGraph,
        candidate: nx.DiGraph,
        transaction: StructuralTransaction,
    ) -> tuple[str, ...]:
        messages = []
        for constraint in self._constraints:
            message = constraint.violation(baseline, before, candidate, transaction)
            if message:
                messages.append(f"{constraint.name}: {message}")
        return tuple(messages)


class StructuralMutator(Protocol):
    def apply(
        self,
        graph: nx.DiGraph,
        transaction: StructuralTransaction,
    ) -> tuple[nx.DiGraph, StructuralMutationSummary]:
        """Return a validated candidate graph and mutation summary."""


class StructuralGraphMutator:
    """Applies ordered edits to a copy and commits only valid transactions."""

    def __init__(
        self,
        baseline_graph: nx.DiGraph,
        constraints: StructuralConstraintSet | None = None,
    ):
        self._baseline = nx.freeze(copy.deepcopy(baseline_graph))
        self._constraints = constraints or StructuralConstraintSet.conservative()

    @property
    def constraints(self) -> StructuralConstraintSet:
        return self._constraints

    def apply(
        self,
        graph: nx.DiGraph,
        transaction: StructuralTransaction,
    ) -> tuple[nx.DiGraph, StructuralMutationSummary]:
        if not isinstance(transaction, StructuralTransaction):
            raise TypeError("transaction must be a StructuralTransaction")
        candidate = nx.DiGraph(copy.deepcopy(graph))
        for edit in transaction.edits:
            self._apply_edit(candidate, edit)

        violations = self._constraints.violations(self._baseline, graph, candidate, transaction)
        if violations:
            raise StructuralValidationError("; ".join(violations))
        return candidate, self._summary(graph, candidate)

    def can_apply(self, graph: nx.DiGraph, transaction: StructuralTransaction) -> tuple[bool, str | None]:
        try:
            self.apply(graph, transaction)
            return True, None
        except (StructuralValidationError, ValueError, TypeError) as error:
            return False, str(error)

    def _apply_edit(self, graph: nx.DiGraph, edit: StructuralEdit) -> None:
        if isinstance(edit, AddNodeAction):
            if edit.name in graph:
                raise StructuralValidationError(f"Node already exists: {edit.name}")
            graph.add_node(
                edit.name,
                start_amount=edit.start_amount,
                retention=edit.retention,
                floor=edit.floor,
                ceiling=edit.ceiling,
                formula=edit.formula,
                sink_formula=edit.sink_formula,
                source_formula=edit.source_formula,
            )
            return
        if isinstance(edit, RemoveNodeAction):
            if edit.name not in graph:
                raise StructuralValidationError(f"Unknown node: {edit.name}")
            graph.remove_node(edit.name)
            return
        if isinstance(edit, AddEdgeAction):
            if edit.source not in graph or edit.target not in graph:
                raise StructuralValidationError("Both edge endpoints must exist in the transaction candidate")
            if graph.has_edge(edit.source, edit.target):
                raise StructuralValidationError(f"Edge already exists: {edit.source} -> {edit.target}")
            graph.add_edge(
                edit.source,
                edit.target,
                correlation=edit.correlation,
                decay=edit.decay,
                delay=edit.delay,
                confidence=edit.confidence,
                functional_form=edit.functional_form,
            )
            return
        if isinstance(edit, RemoveEdgeAction):
            if not graph.has_edge(edit.source, edit.target):
                raise StructuralValidationError(f"Unknown edge: {edit.source} -> {edit.target}")
            graph.remove_edge(edit.source, edit.target)
            return
        raise TypeError(f"Unsupported structural edit: {type(edit).__name__}")

    @staticmethod
    def _summary(before: nx.DiGraph, after: nx.DiGraph) -> StructuralMutationSummary:
        before_nodes, after_nodes = set(before.nodes), set(after.nodes)
        before_edges, after_edges = set(before.edges), set(after.edges)
        return StructuralMutationSummary(
            nodes_before=len(before_nodes),
            nodes_after=len(after_nodes),
            edges_before=len(before_edges),
            edges_after=len(after_edges),
            added_nodes=tuple(sorted(after_nodes - before_nodes)),
            removed_nodes=tuple(sorted(before_nodes - after_nodes)),
            added_edges=tuple(sorted(after_edges - before_edges)),
            removed_edges=tuple(sorted(before_edges - after_edges)),
        )
