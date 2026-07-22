"""Shared JSON adapters for the FlowCLD agent APIs.

HTTP services use these functions to translate untrusted JSON into the typed
Stage 1–4 domain objects. Keeping parsing here prevents each endpoint from
inventing a slightly different action or graph schema.
"""

from __future__ import annotations

import math
from numbers import Real
from typing import Any

import networkx as nx

try:
    from simulation_engine import MODEL_SCHEMA_VERSION
except ModuleNotFoundError:
    from backend.simulation_engine import MODEL_SCHEMA_VERSION

try:
    from flowcld_env import (
        AddEdgeAction,
        AddNodeAction,
        MutationMode,
        NoOpAction,
        ParameterAction,
        ParameterName,
        RemoveEdgeAction,
        RemoveNodeAction,
        StructuralActionKind,
        StructuralTransaction,
        TargetSpecification,
    )
except ModuleNotFoundError:
    from backend.flowcld_env import (
        AddEdgeAction,
        AddNodeAction,
        MutationMode,
        NoOpAction,
        ParameterAction,
        ParameterName,
        RemoveEdgeAction,
        RemoveNodeAction,
        StructuralActionKind,
        StructuralTransaction,
        TargetSpecification,
    )


class AgentPayloadError(ValueError):
    """Raised when an agent API request cannot be converted safely."""


def as_list(value: Any, field: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise AgentPayloadError(f"{field} must be an array")
    return value


def required_name(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AgentPayloadError(f"{field} must be a non-empty name")
    return value.strip()


def finite_number(value: Any, field: str, default: float | None = None) -> float:
    if (value is None or value == "") and default is not None:
        return float(default)
    if isinstance(value, bool) or not isinstance(value, (Real, str)):
        raise AgentPayloadError(f"{field} must be numeric")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise AgentPayloadError(f"{field} must be numeric") from error
    if not math.isfinite(number):
        raise AgentPayloadError(f"{field} must be finite")
    return number


def numeric_bound(value: Any, field: str, default: float) -> float:
    if value is None or value == "":
        return default
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"infinity", "+infinity", "inf", "+inf"}:
            return math.inf
        if normalized in {"-infinity", "-inf"}:
            return -math.inf
    if isinstance(value, bool):
        raise AgentPayloadError(f"{field} must be numeric or Infinity")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise AgentPayloadError(f"{field} must be numeric or Infinity") from error
    if math.isnan(number):
        raise AgentPayloadError(f"{field} cannot be NaN")
    return number


def nonnegative_integer(value: Any, field: str, default: int = 0) -> int:
    if value is None or value == "":
        return int(default)
    if isinstance(value, bool):
        raise AgentPayloadError(f"{field} must be a non-negative integer")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise AgentPayloadError(f"{field} must be a non-negative integer") from error
    if not math.isfinite(number) or number < 0 or not number.is_integer():
        raise AgentPayloadError(f"{field} must be a non-negative integer")
    return int(number)


def plain_text(value: Any, field: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise AgentPayloadError(f"{field} must be plain text")
    return value.strip() or None


def names(value: Any, field: str) -> tuple[str, ...]:
    return tuple(required_name(item, field) for item in as_list(value, field))


def pairs(value: Any, field: str) -> tuple[tuple[str, str], ...]:
    parsed = []
    for index, raw in enumerate(as_list(value, field), start=1):
        if not isinstance(raw, (list, tuple)) or len(raw) != 2:
            raise AgentPayloadError(f"{field} item {index} must contain two node names")
        parsed.append((
            required_name(raw[0], f"{field} source"),
            required_name(raw[1], f"{field} target"),
        ))
    return tuple(parsed)


def ensure_unique_edges(graph_data: dict[str, Any]) -> None:
    seen: set[tuple[str, str]] = set()
    for edge in graph_data.get("edges", []):
        if not isinstance(edge, dict):
            continue
        source = edge.get("source", edge.get("from"))
        target = edge.get("target", edge.get("to"))
        pair = (str(source).strip(), str(target).strip())
        if pair in seen:
            raise AgentPayloadError(
                f"Agent edits require unique directed edges; duplicate found: {pair[0]} -> {pair[1]}"
            )
        seen.add(pair)


def structural_edit_from_payload(raw: Any):
    if not isinstance(raw, dict):
        raise AgentPayloadError("Every structural edit must be an object")
    kind = raw.get("kind")
    try:
        if kind == StructuralActionKind.ADD_NODE.value:
            return AddNodeAction(
                name=required_name(raw.get("name"), "Node name"),
                start_amount=finite_number(raw.get("start_amount"), "start_amount", 0.0),
                retention=finite_number(raw.get("retention"), "retention", 1.0),
                floor=numeric_bound(raw.get("floor"), "floor", -math.inf),
                ceiling=numeric_bound(raw.get("ceiling"), "ceiling", math.inf),
                formula=plain_text(raw.get("formula"), "formula"),
                sink_formula=plain_text(raw.get("sink_formula"), "sink_formula"),
                source_formula=plain_text(raw.get("source_formula"), "source_formula"),
            )
        if kind == StructuralActionKind.REMOVE_NODE.value:
            return RemoveNodeAction(required_name(raw.get("name"), "Node name"))
        if kind == StructuralActionKind.ADD_EDGE.value:
            return AddEdgeAction(
                source=required_name(raw.get("source"), "Edge source"),
                target=required_name(raw.get("target"), "Edge target"),
                correlation=finite_number(raw.get("correlation"), "correlation", 1.0),
                decay=finite_number(raw.get("decay"), "decay", 0.0),
                delay=nonnegative_integer(raw.get("delay"), "delay"),
                confidence=finite_number(raw.get("confidence"), "confidence", 1.0),
                functional_form=str(raw.get("functional_form") or "linear"),
            )
        if kind == StructuralActionKind.REMOVE_EDGE.value:
            return RemoveEdgeAction(
                required_name(raw.get("source"), "Edge source"),
                required_name(raw.get("target"), "Edge target"),
            )
    except (TypeError, ValueError) as error:
        raise AgentPayloadError(str(error)) from error
    raise AgentPayloadError(f"Unsupported structural edit kind: {kind}")


def structural_transaction_from_payload(raw: Any) -> StructuralTransaction:
    if not isinstance(raw, dict):
        raise AgentPayloadError("Structural transaction must be an object")
    raw_edits = as_list(raw.get("edits"), "edits")
    edits = tuple(structural_edit_from_payload(edit) for edit in raw_edits)
    try:
        return StructuralTransaction(edits, label=plain_text(raw.get("label"), "label"))
    except (TypeError, ValueError) as error:
        raise AgentPayloadError(str(error)) from error


def parameter_action_from_payload(raw: Any) -> ParameterAction:
    if not isinstance(raw, dict):
        raise AgentPayloadError("Parameter action must be an object")
    try:
        parameter = ParameterName(raw.get("parameter"))
        mode = MutationMode(raw.get("mode", MutationMode.DELTA.value))
    except ValueError as error:
        raise AgentPayloadError(str(error)) from error
    raw_target = raw.get("target")
    target: str | tuple[str, str]
    if parameter in {ParameterName.START_AMOUNT, ParameterName.RETENTION}:
        target = required_name(raw_target, "Node target")
    else:
        if not isinstance(raw_target, (list, tuple)) or len(raw_target) != 2:
            raise AgentPayloadError(f"{parameter.value} requires a two-node edge target")
        target = (
            required_name(raw_target[0], "Edge source"),
            required_name(raw_target[1], "Edge target"),
        )
    try:
        return ParameterAction(
            parameter=parameter,
            target=target,
            value=finite_number(raw.get("value"), "Action value"),
            mode=mode,
        )
    except (TypeError, ValueError) as error:
        raise AgentPayloadError(str(error)) from error


def no_op_action_from_payload(raw: Any) -> NoOpAction:
    if not isinstance(raw, dict):
        raise AgentPayloadError("No-op action must be an object")
    reason = raw.get("reason", "No improving legal move")
    if not isinstance(reason, str):
        raise AgentPayloadError("No-op reason must be plain text")
    return NoOpAction(reason=reason.strip() or "No improving legal move")


def target_specification_from_payload(raw: Any) -> TargetSpecification:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise AgentPayloadError("objective must be an object")
    trajectories_raw = raw.get("trajectories", {})
    behaviors_raw = raw.get("behaviors", {})
    if not isinstance(trajectories_raw, dict) or not isinstance(behaviors_raw, dict):
        raise AgentPayloadError("Objective trajectories and behaviors must be objects")
    trajectories: dict[str, tuple[float, ...]] = {}
    for node, values in trajectories_raw.items():
        name = required_name(node, "Objective node")
        if not isinstance(values, (list, tuple)) or not values:
            raise AgentPayloadError(f"Trajectory for {name} must be a non-empty array")
        trajectories[name] = tuple(
            finite_number(value, f"Trajectory value for {name}") for value in values
        )
    behaviors = {
        required_name(node, "Objective node"): required_name(value, "Behavior")
        for node, value in behaviors_raw.items()
    }
    spectral_raw = raw.get("spectral_radius")
    spectral_radius = (
        None
        if spectral_raw in (None, "")
        else finite_number(spectral_raw, "Target spectral radius")
    )
    if spectral_radius is not None and not 0.0 < spectral_radius < 1.0:
        raise AgentPayloadError(
            "Target spectral radius must be greater than 0 and less than 1"
        )
    return TargetSpecification(
        trajectories=trajectories,
        behaviors=behaviors,
        spectral_radius=spectral_radius,
    )


def _json_bound(value: Any) -> Any:
    if value == math.inf:
        return "Infinity"
    if value == -math.inf:
        return "-Infinity"
    return value


def graph_to_payload(graph: nx.DiGraph) -> dict[str, Any]:
    """Serialize the canonical graph without introducing UI-only state."""

    nodes = []
    for name, data in graph.nodes(data=True):
        nodes.append({
            "name": str(name),
            "start_amount": float(data.get("start_amount", 0.0)),
            "retention": float(data.get("retention", 1.0)),
            "floor": _json_bound(data.get("floor", -math.inf)),
            "ceiling": _json_bound(data.get("ceiling", math.inf)),
            "formula": data.get("formula"),
            "sink_formula": data.get("sink_formula"),
            "source_formula": data.get("source_formula"),
        })
    edges = []
    for source, target, data in graph.edges(data=True):
        edges.append({
            "source": str(source),
            "target": str(target),
            "correlation": float(data.get("correlation", 1.0)),
            "decay": float(data.get("decay", 0.0)),
            "confidence": float(data.get("confidence", 1.0)),
            "delay": int(data.get("delay", 0)),
            "functional_form": data.get("functional_form", "linear"),
        })
    return {
        "schema_version": MODEL_SCHEMA_VERSION,
        "nodes": nodes,
        "edges": edges,
    }
