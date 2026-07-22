"""HTTP-facing adapter for controlled Stage 3 structural transactions.

The domain environment remains independent from Flask. This module only turns
JSON values into structural value objects and serializes the validated graph
back to the browser.
"""

from __future__ import annotations

from numbers import Integral
from typing import Any, Iterable

import networkx as nx

try:
    from agent_payload import (
        AgentPayloadError,
        as_list,
        ensure_unique_edges,
        graph_to_payload,
        names,
        nonnegative_integer,
        pairs,
        plain_text,
        structural_edit_from_payload,
    )
    from advanced_analysis import build_graph_from_payload
    from flowcld_env import (
        FlowCLDEnvironment,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        StructuralActionKind,
        StructuralConstraintSet,
        StructuralGraphMutator,
        StructuralTransaction,
    )
except ModuleNotFoundError:  # Repository-level package imports.
    from backend.agent_payload import (
        AgentPayloadError,
        as_list,
        ensure_unique_edges,
        graph_to_payload,
        names,
        nonnegative_integer,
        pairs,
        plain_text,
        structural_edit_from_payload,
    )
    from backend.advanced_analysis import build_graph_from_payload
    from backend.flowcld_env import (
        FlowCLDEnvironment,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        StructuralActionKind,
        StructuralConstraintSet,
        StructuralGraphMutator,
        StructuralTransaction,
    )


DESIGNER_ROLE = "model-designer"
StructuralRequestError = AgentPayloadError


def _validate_references(
    graph: nx.DiGraph,
    protected_nodes: Iterable[str],
    protected_edges: Iterable[tuple[str, str]],
    required_paths: Iterable[tuple[str, str]],
) -> None:
    nodes = set(graph.nodes)
    edges = set(graph.edges)
    unknown_nodes = set(protected_nodes) - nodes
    if unknown_nodes:
        raise StructuralRequestError(f"Protected nodes do not exist: {sorted(unknown_nodes)}")
    unknown_edges = set(protected_edges) - edges
    if unknown_edges:
        raise StructuralRequestError(f"Protected edges do not exist: {sorted(unknown_edges)}")
    unknown_path_nodes = {node for path in required_paths for node in path} - nodes
    if unknown_path_nodes:
        raise StructuralRequestError(f"Required paths reference unknown nodes: {sorted(unknown_path_nodes)}")


def preview_structural_transaction(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate one atomic Stage 3 transaction and return its private candidate."""

    if not isinstance(payload, dict):
        raise StructuralRequestError("Request body must be a JSON object")
    graph_data = {"nodes": payload.get("nodes", []), "edges": payload.get("edges", [])}
    ensure_unique_edges(graph_data)
    graph = build_graph_from_payload(graph_data)

    edits = tuple(structural_edit_from_payload(raw) for raw in as_list(payload.get("edits"), "edits"))
    try:
        transaction = StructuralTransaction(edits, label=plain_text(payload.get("label"), "label"))
    except (TypeError, ValueError) as error:
        raise StructuralRequestError(str(error)) from error

    protected_nodes = names(payload.get("protected_nodes"), "protected_nodes")
    protected_edges = pairs(payload.get("protected_edges"), "protected_edges")
    required_paths = pairs(payload.get("required_paths"), "required_paths")
    _validate_references(graph, protected_nodes, protected_edges, required_paths)

    horizon = nonnegative_integer(payload.get("iterations", 50), "iterations")
    if not 1 <= horizon <= 200:
        raise StructuralRequestError("iterations must be between 1 and 200")
    seed = payload.get("seed", 42)
    if isinstance(seed, bool) or not isinstance(seed, Integral):
        raise StructuralRequestError("seed must be an integer")

    policy = RoleBasedAuthorizationPolicy((RoleDefinition(
        name=DESIGNER_ROLE,
        structural_actions=frozenset(StructuralActionKind),
        node_targets=None,
        edge_targets=None,
    ),))
    constraints = StructuralConstraintSet.conservative(
        protected_nodes=protected_nodes,
        protected_edges=protected_edges,
        required_paths=required_paths,
    )
    environment = FlowCLDEnvironment(
        graph,
        authorization_policy=policy,
        structural_mutator=StructuralGraphMutator(graph, constraints),
        observation_builder=SimulationObservationBuilder(horizon=horizon),
        max_steps=1,
    )
    environment.reset(seed=int(seed))
    observation, reward, _, _, info = environment.step(transaction, role=DESIGNER_ROLE)
    action = info["action"]
    accepted = bool(action["accepted"])
    return {
        "success": True,
        "accepted": accepted,
        "reason": action.get("reason"),
        "reward": float(reward),
        "reward_components": dict(info["reward_components"]),
        "summary": action.get("after"),
        "transaction": transaction.to_dict(),
        "candidate": graph_to_payload(environment.graph_snapshot),
        "classifications": observation.get("classifications", {}),
        "structural_action_mask": info["structural_action_mask"],
    }
