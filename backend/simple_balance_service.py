"""HTTP adapter for deterministic two-node and connected-model balancing."""

from __future__ import annotations

import copy
from numbers import Integral
from typing import Any

try:
    from advanced_analysis import build_graph_from_payload
    from agent_payload import (
        AgentPayloadError,
        ensure_unique_edges,
        finite_number,
        graph_to_payload,
        nonnegative_integer,
    )
    from flowcld_env import (
        GraphBalancePlanner,
        GraphBalanceSettings,
        GraphBalanceValidationError,
        NotebookEngineAdapter,
        NotebookSpectralAnalyzer,
        ParameterName,
        TwoNodeBalancePlanner,
        TwoNodeBalanceSettings,
        TwoNodeLoopAnalyzer,
        TwoNodeLoopValidationError,
    )
    from team_service import run_team_session
except ModuleNotFoundError:
    from backend.advanced_analysis import build_graph_from_payload
    from backend.agent_payload import (
        AgentPayloadError,
        ensure_unique_edges,
        finite_number,
        graph_to_payload,
        nonnegative_integer,
    )
    from backend.flowcld_env import (
        GraphBalancePlanner,
        GraphBalanceSettings,
        GraphBalanceValidationError,
        NotebookEngineAdapter,
        NotebookSpectralAnalyzer,
        ParameterName,
        TwoNodeBalancePlanner,
        TwoNodeBalanceSettings,
        TwoNodeLoopAnalyzer,
        TwoNodeLoopValidationError,
    )
    from backend.team_service import run_team_session


class SimpleBalanceRequestError(AgentPayloadError):
    """Raised when a deterministic balance request is malformed or unsupported."""


def _horizon(payload: dict[str, Any]) -> int:
    try:
        value = nonnegative_integer(payload.get("iterations", 50), "iterations")
    except AgentPayloadError as error:
        raise SimpleBalanceRequestError(str(error)) from error
    if not 1 <= value <= 200:
        raise SimpleBalanceRequestError("iterations must be between 1 and 200")
    return value


def _seed(payload: dict[str, Any]) -> int:
    value = payload.get("seed", 42)
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise SimpleBalanceRequestError("seed must be an integer")
    return int(value)


def _target_radius(payload: dict[str, Any]) -> float:
    try:
        value = finite_number(
            payload.get("target_spectral_radius"),
            "target_spectral_radius",
            0.99,
        )
    except AgentPayloadError as error:
        raise SimpleBalanceRequestError(str(error)) from error
    if not 0.0 < value < 1.0:
        raise SimpleBalanceRequestError(
            "target_spectral_radius must be greater than 0 and less than 1"
        )
    return value


def _boolean(payload: dict[str, Any], field: str, default: bool) -> bool:
    value = payload.get(field, default)
    if not isinstance(value, bool):
        raise SimpleBalanceRequestError(f"{field} must be true or false")
    return value


def _bounded_float(
    payload: dict[str, Any],
    field: str,
    default: float,
    *,
    minimum: float,
    maximum: float,
    minimum_open: bool = False,
    maximum_open: bool = False,
) -> float:
    try:
        value = finite_number(payload.get(field), field, default)
    except AgentPayloadError as error:
        raise SimpleBalanceRequestError(str(error)) from error
    minimum_valid = value > minimum if minimum_open else value >= minimum
    maximum_valid = value < maximum if maximum_open else value <= maximum
    if not minimum_valid or not maximum_valid:
        left = "greater than" if minimum_open else "at least"
        right = "less than" if maximum_open else "at most"
        raise SimpleBalanceRequestError(
            f"{field} must be {left} {minimum} and {right} {maximum}"
        )
    return value


def _settings(payload: dict[str, Any]) -> GraphBalanceSettings:
    try:
        return GraphBalanceSettings(
            target_radius=_target_radius(payload),
            adjust_retention=_boolean(payload, "adjust_retention", True),
            adjust_decay=_boolean(payload, "adjust_decay", True),
            min_retention=_bounded_float(
                payload,
                "min_retention",
                0.10,
                minimum=0.0,
                maximum=1.0,
                minimum_open=True,
            ),
            max_decay=_bounded_float(
                payload,
                "max_decay",
                0.85,
                minimum=0.0,
                maximum=1.0,
                maximum_open=True,
            ),
            min_transmission_ratio=0.12,
        )
    except ValueError as error:
        raise SimpleBalanceRequestError(str(error)) from error


def _move(team_id: str, action) -> dict[str, Any]:
    return {
        "team_id": team_id,
        "action": {"kind": "parameter", **action.to_dict()},
    }


def _apply_actions(graph, actions):
    planned = copy.deepcopy(graph)
    for action in actions:
        if action.parameter is ParameterName.RETENTION:
            planned.nodes[action.target]["retention"] = float(action.value)
        elif action.parameter is ParameterName.DECAY:
            source, target = action.target
            planned[source][target]["decay"] = float(action.value)
    return planned


def _transmission_ratio(graph) -> float:
    correlations = []
    transmissions = []
    for _, _, data in graph.edges(data=True):
        correlation = abs(float(data.get("correlation", 1.0)))
        correlations.append(correlation)
        transmissions.append(
            correlation * (1.0 - float(data.get("decay", 0.0)))
        )
    denominator = sum(correlations)
    return float(sum(transmissions) / denominator) if denominator > 1e-12 else 1.0


def _change_log(graph, actions) -> list[dict[str, Any]]:
    changes = []
    for action in actions:
        if action.parameter is ParameterName.RETENTION:
            before = float(graph.nodes[action.target].get("retention", 0.0))
            target = action.target
        else:
            source, destination = action.target
            before = float(graph[source][destination].get("decay", 0.0))
            target = [source, destination]
        changes.append({
            "parameter": action.parameter.value,
            "target": target,
            "before": before,
            "after": float(action.value),
        })
    return changes


_NOTEBOOK_COMPONENTS = (
    "lam_max",
    "transmission_ratio",
    "dead_ratio",
    "active_terminal_ratio",
    "active_tail_ratio",
    "late_drift",
    "late_up_pen",
    "flatline_pen",
    "overflow_pen",
)


def _notebook_report(evaluation) -> dict[str, Any]:
    components = {
        name: float(evaluation.components.get(name, 0.0))
        for name in _NOTEBOOK_COMPONENTS
    }
    return {
        "cost": float(evaluation.cost),
        "health": float(evaluation.health),
        "components": components,
        "classifications": dict(evaluation.classifications),
    }


def run_simple_balance(payload: dict[str, Any]) -> dict[str, Any]:
    """Plan spectral stabilization, then execute it through Team Workspace."""

    if not isinstance(payload, dict):
        raise SimpleBalanceRequestError("Request body must be a JSON object")
    graph_data = {
        "nodes": payload.get("nodes", []),
        "edges": payload.get("edges", []),
    }
    try:
        ensure_unique_edges(graph_data)
    except AgentPayloadError as error:
        raise SimpleBalanceRequestError(str(error)) from error
    graph = build_graph_from_payload(graph_data)
    settings = _settings(payload)
    edge_correlations = [
        float(data.get("correlation", 1.0))
        for _, _, data in graph.edges(data=True)
    ]
    exact_two_node = (
        graph.number_of_nodes() == 2
        and graph.number_of_edges() == 2
        and settings.adjust_retention
        and settings.adjust_decay
        and any(value > 0.0 for value in edge_correlations)
        and any(value < 0.0 for value in edge_correlations)
    )
    try:
        if exact_two_node:
            two_node_analyzer = TwoNodeLoopAnalyzer()
            two_node_planner = TwoNodeBalancePlanner(
                analyzer=two_node_analyzer,
                settings=TwoNodeBalanceSettings(
                    target_radius=settings.target_radius,
                    min_retention=settings.min_retention,
                    max_decay=settings.max_decay,
                ),
            )
            exact_plan = two_node_planner.plan(graph)
            actions = exact_plan.actions
            initial_radius = exact_plan.initial_radius
            projected_radius = exact_plan.final_radius
            planner_name = "two_node_linear_stability"
            prioritized_nodes = list(exact_plan.loop.nodes)
            warnings = []
            intervention_cost = sum(
                (
                    settings.retention_change_weight
                    if action.parameter is ParameterName.RETENTION
                    else settings.decay_change_weight
                ) * (
                    float(action.value) - (
                        float(graph.nodes[action.target].get("retention", 0.0))
                        if action.parameter is ParameterName.RETENTION
                        else float(graph[action.target[0]][action.target[1]].get("decay", 0.0))
                    )
                ) ** 2
                for action in actions
            )
            required_transmission = min(_transmission_ratio(graph), 0.12)
        else:
            graph_plan = GraphBalancePlanner(settings=settings).plan(graph)
            actions = graph_plan.actions
            initial_radius = graph_plan.initial_radius
            projected_radius = graph_plan.final_radius
            planner_name = "connected_graph_spectral_balance"
            prioritized_nodes = list(graph_plan.prioritized_nodes)
            warnings = list(graph_plan.warnings)
            intervention_cost = graph_plan.intervention_cost
            required_transmission = graph_plan.required_transmission_ratio
    except (TwoNodeLoopValidationError, GraphBalanceValidationError) as error:
        raise SimpleBalanceRequestError(str(error)) from error

    planned_graph = _apply_actions(graph, actions)
    planned_transmission = _transmission_ratio(planned_graph)
    if planned_transmission + 1e-9 < required_transmission:
        raise RuntimeError("The planned balance would violate the transmission safeguard")

    horizon = _horizon(payload)
    engine = NotebookEngineAdapter.default()
    try:
        baseline_notebook = engine.evaluate(graph, preset="balanced", steps=horizon)
        planned_notebook = engine.evaluate(
            planned_graph, preset="balanced", steps=horizon
        )
    except (TypeError, ValueError, RuntimeError) as error:
        raise SimpleBalanceRequestError(
            f"The notebook simulation could not validate this balance plan: {error}"
        ) from error

    team_id = "model-balancer"
    node_names = [str(node) for node in graph.nodes]
    edge_names = [[str(source), str(target)] for source, target in graph.edges]
    behaviors = {node: "Optimal" for node in node_names}
    session_payload = {
        "nodes": graph_data["nodes"],
        "edges": graph_data["edges"],
        "teams": [{
            "id": team_id,
            "name": "Model balancer",
            "weight": 1.0,
            "orientation": "stabilize",
            "owned_nodes": node_names,
            "target_nodes": node_names,
            "preset": "balanced",
            "gamma": 1.0,
            "parameter_move_cost": 0.0,
            "structural_move_cost": 0.0,
            "move_budget": max(1, len(actions)),
            "structural_budget": 0,
            "min_live_nodes": 2,
            "objective": {
                "trajectories": {},
                "behaviors": behaviors,
                "spectral_radius": settings.target_radius,
            },
            "permissions": {
                "node_parameters": ["retention"] if settings.adjust_retention else [],
                "edge_parameters": ["decay"] if settings.adjust_decay else [],
                "structural_actions": [],
                "node_targets": node_names,
                "edge_targets": edge_names,
            },
        }],
        "moves": [_move(team_id, action) for action in actions],
        "agent_strategy": "greedy",
        "agent_turns": 0,
        "iterations": horizon,
        "seed": _seed(payload),
        "protected_nodes": node_names,
        "protected_edges": edge_names,
    }
    result = run_team_session(session_payload)

    final_graph = build_graph_from_payload(result["final"])
    final_radius = NotebookSpectralAnalyzer().spectral_radius(final_graph)
    if final_radius > settings.target_radius + 1e-9:
        raise RuntimeError(
            "The executed balance plan did not meet its projected stability target"
        )
    final_notebook = engine.evaluate(final_graph, preset="balanced", steps=horizon)
    balance_metadata = {
        "planner": planner_name,
        "criterion": "spectral_radius",
        "target_spectral_radius": settings.target_radius,
        "initial_spectral_radius": initial_radius,
        "projected_spectral_radius": projected_radius,
        "final_spectral_radius": final_radius,
        "stable": final_radius < 1.0,
        "target_met": final_radius <= settings.target_radius + 1e-9,
        "requires_explicit_apply": graph.number_of_nodes() > 2,
        "adjusted_parameters": {
            "retention": settings.adjust_retention,
            "decay": settings.adjust_decay,
        },
        "bounds": {
            "minimum_retention": settings.min_retention,
            "maximum_decay": settings.max_decay,
            "minimum_transmission_ratio": required_transmission,
        },
        "transmission_ratio": _transmission_ratio(final_graph),
        "intervention_cost": float(intervention_cost),
        "prioritized_nodes": prioritized_nodes,
        "warnings": warnings,
        "notebook_validation": {
            "baseline": _notebook_report(baseline_notebook),
            "planned": _notebook_report(planned_notebook),
            "final": _notebook_report(final_notebook),
        },
        "planned_actions": [
            {"kind": "parameter", **action.to_dict()}
            for action in actions
        ],
        "changes": _change_log(graph, actions),
        "structure_preserved": (
            set(graph.nodes) == set(final_graph.nodes)
            and set(graph.edges) == set(final_graph.edges)
        ),
    }
    result["model_balance"] = balance_metadata
    if exact_two_node:
        result["simple_balance"] = balance_metadata
    # This makes the intended final graph explicit even when the input was
    # accepted with sparse optional attributes.
    result["baseline"] = graph_to_payload(graph)
    return result
