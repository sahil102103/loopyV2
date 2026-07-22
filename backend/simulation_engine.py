"""Canonical FlowCLD two-phase simulation contract.

This module is the reusable propagation boundary for the notebook-derived
backend, agent environments, and parity fixtures.  The browser implements the
same contract in ``v1.1/js/Libraries/cldEngine.js``.

Contract ``flowcld.simulation.v1``:

* edge contribution = ``correlation * (1 - decay) * form(source_value)``;
* delayed edges use zero prehistory;
* retention-zero nodes are converters and are evaluated in graph insertion
  order after stock nodes are committed;
* dynamic bounds are applied before source/sink factors;
* sink then source expressions return multiplicative post-update factors;
* deterministic propagation is the default and process noise is injected
  through a small strategy interface.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Callable, Mapping, Protocol
from urllib.parse import unquote as _url_unquote

import networkx as nx
import numpy as np

try:
    from formula_evaluator import FormulaEvaluationError, evaluate_formula
except ModuleNotFoundError:  # Repository-level package imports.
    from backend.formula_evaluator import FormulaEvaluationError, evaluate_formula


SIMULATION_CONTRACT_VERSION = "flowcld.simulation.v1"
MODEL_SCHEMA_VERSION = "flowcld.model.v1"
SUPPORTED_EDGE_FORMS = frozenset({
    "linear", "tanh", "quadratic", "cubic", "relu", "step",
})

_PCT_HEX = re.compile(r"%[0-9A-Fa-f]{2}")


class SimulationContractError(ValueError):
    """Raised when a graph cannot be evaluated under the canonical contract."""


class ProcessNoise(Protocol):
    """Inject stochastic process behavior without duplicating propagation."""

    def apply(self, *, node: str, phase: str, value: float, t: int) -> float:
        """Return a noisy replacement for one just-computed node value."""


@dataclass
class MultiplicativeGaussianNoise:
    """Per-node ``value * (1 + Normal(0, sigma))`` process noise."""

    sigma_map: Mapping[str, float]
    rng: np.random.Generator

    def apply(self, *, node: str, phase: str, value: float, t: int) -> float:
        del phase, t
        sigma = _finite(self.sigma_map.get(node, 0.0), f"Noise sigma for {node}")
        if sigma < 0.0:
            raise SimulationContractError(f"Noise sigma for {node} must be non-negative")
        if sigma <= 0.0:
            return value
        return value * (1.0 + float(self.rng.normal(0.0, sigma)))


FormulaErrorHandler = Callable[[str, str, FormulaEvaluationError], None]


def decode_expression(value):
    """Peel up to two URL-encoding layers from imported expressions."""

    if value is None or not isinstance(value, str):
        return value
    decoded = value
    for _ in range(2):
        if not _PCT_HEX.search(decoded):
            break
        decoded = _url_unquote(decoded)
    return decoded


def apply_edge_form(form: str | None, value: float) -> float:
    """Apply a named, zero-preserving edge transform."""

    selected = str(form or "linear").strip().lower()
    if selected not in SUPPORTED_EDGE_FORMS:
        raise SimulationContractError(f"Unsupported edge functional form: {selected}")
    try:
        if selected == "linear":
            result = value
        elif selected == "tanh":
            result = math.tanh(value)
        elif selected == "quadratic":
            result = value * abs(value)
        elif selected == "cubic":
            result = value ** 3
        elif selected == "relu":
            result = value if value > 0.0 else 0.0
        else:  # step
            result = 1.0 if value > 0.0 else (-1.0 if value < 0.0 else 0.0)
    except (ArithmeticError, OverflowError) as error:
        raise SimulationContractError(
            f"Edge functional form '{selected}' overflowed"
        ) from error
    return _finite(result, f"Edge functional form '{selected}' result")


def edge_factor(edge: Mapping) -> float:
    """Return the deterministic signed linear edge coefficient."""

    correlation = edge.get(
        "correlation",
        edge.get("weight", 1.0) * edge.get("polarity", 1.0),
    )
    decay = _finite(edge.get("decay", edge.get("damper", 0.0)), "Edge decay")
    if not 0.0 <= decay <= 1.0:
        raise SimulationContractError("Edge decay must be between 0 and 1")
    return _finite(correlation, "Edge correlation") * (1.0 - decay)


def edge_contribution(edge: Mapping, source_value: float) -> float:
    """Transform the source value, then apply correlation and decay."""

    form = edge.get("functional_form", edge.get("functionalForm", "linear"))
    return _finite(
        edge_factor(edge) * apply_edge_form(form, _finite(source_value, "Edge source value")),
        "Edge contribution",
    )


def evaluate_bound(bound, context: Mapping, default: float) -> float:
    """Evaluate a numeric or formula bound through the constrained evaluator."""

    return _evaluate_bound(bound, context, default)


def runtime_linear_transition_matrix(
    graph: nx.DiGraph,
    *,
    node_retention_map: Mapping | None = None,
    edge_decay_map: Mapping | None = None,
    passnodes: set[str] | None = None,
) -> tuple[np.ndarray, list[str]]:
    """Return the delay-free linear spectral model of the runtime engine.

    The matrix uses actual node retention on the diagonal and actual linear
    edge factors at ``[target, source]``.  Delays, bounds, confidence,
    source/sink formulas, and nonlinear edge forms are intentionally excluded.
    """

    nodes = list(graph.nodes)
    index = {node: position for position, node in enumerate(nodes)}
    matrix = np.zeros((len(nodes), len(nodes)), dtype=float)
    selected_passnodes = {str(node) for node in (passnodes or ())}
    for node in nodes:
        retention = graph.nodes[node].get("retention", 0.0)
        if node_retention_map is not None:
            retention = node_retention_map.get(
                node, node_retention_map.get(str(node), retention)
            )
        matrix[index[node], index[node]] = (
            0.0 if str(node) in selected_passnodes
            else _finite(retention, f"Retention for {node}")
        )
    for source, target, data in graph.edges(data=True):
        if edge_decay_map is None:
            coefficient = edge_factor(data)
        else:
            edge_key = (str(source), str(target))
            decay = edge_decay_map.get(
                (source, target), edge_decay_map.get(edge_key, data.get("decay", 0.0))
            )
            correlation = data.get(
                "correlation",
                data.get("weight", 1.0) * data.get("polarity", 1.0),
            )
            coefficient = _finite(correlation, "Edge correlation") * (
                1.0 - _finite(decay, "Edge decay")
            )
        matrix[index[target], index[source]] += coefficient
    return matrix, nodes


def legacy_loop_transition_matrix(
    graph: nx.DiGraph,
    decay_factor: float,
    *,
    passnodes: set[str] | None = None,
) -> tuple[np.ndarray, list[str]]:
    """Return the notebook loop-through diagnostic matrix.

    This legacy diagnostic sets the diagonal to ``1 - decay_factor`` but leaves
    edge correlations unscaled. It is deliberately separate from both runtime
    linearization and the uniform stability sweep.
    """

    decay = _unit_interval(decay_factor, "Loop diagnostic decay factor")
    selected_passnodes = {str(node) for node in (passnodes or ())}
    nodes = list(graph.nodes)
    index = {node: position for position, node in enumerate(nodes)}
    matrix = np.zeros((len(nodes), len(nodes)), dtype=float)
    for node in nodes:
        matrix[index[node], index[node]] = (
            0.0 if str(node) in selected_passnodes else 1.0 - decay
        )
    for source, target, data in graph.edges(data=True):
        correlation = data.get(
            "correlation",
            data.get("weight", 1.0) * data.get("polarity", 1.0),
        )
        matrix[index[target], index[source]] += _finite(
            correlation, "Edge correlation"
        )
    return matrix, nodes


def uniform_sweep_transition_matrix(
    graph: nx.DiGraph,
    decay_factor: float,
    *,
    passnodes: set[str] | None = None,
) -> tuple[np.ndarray, list[str]]:
    """Return the notebook's legacy uniform parameter-sweep matrix.

    This is not the runtime linearization. It sets every diagonal to
    ``1 - decay_factor`` and scales each signed correlation by
    ``decay_factor``. The explicit name prevents it being mistaken for runtime
    propagation semantics.
    """

    decay = _unit_interval(decay_factor, "Uniform sweep decay factor")
    selected_passnodes = set(passnodes or ())
    nodes = list(graph.nodes)
    index = {node: position for position, node in enumerate(nodes)}
    matrix = np.zeros((len(nodes), len(nodes)), dtype=float)
    for node in nodes:
        matrix[index[node], index[node]] = (
            0.0 if node in selected_passnodes else 1.0 - decay
        )
    for source, target, data in graph.edges(data=True):
        correlation = _finite(
            data.get(
                "correlation",
                data.get("weight", 1.0) * data.get("polarity", 1.0),
            ),
            "Edge correlation",
        )
        matrix[index[target], index[source]] += decay * correlation
    return matrix, nodes


def simulate_two_phase(
    graph: nx.DiGraph,
    init_vals: Mapping[str, float],
    steps: int,
    *,
    noise: ProcessNoise | Callable[..., float] | None = None,
    on_formula_error: FormulaErrorHandler | None = None,
) -> dict[str, list[float | None]]:
    """Run the canonical delay-aware four-phase propagation engine."""

    if not isinstance(graph, nx.DiGraph) or not graph.nodes:
        raise SimulationContractError("Simulation requires a non-empty directed graph")
    if isinstance(steps, bool) or not isinstance(steps, (int, np.integer)) or steps < 0:
        raise SimulationContractError("Simulation steps must be a non-negative integer")

    retentions = {
        node: _finite(
            graph.nodes[node].get("retention", 1.0), f"Retention for {node}"
        )
        for node in graph
    }
    invalid_retentions = [node for node, value in retentions.items() if value < 0.0]
    if invalid_retentions:
        raise SimulationContractError(
            "Node retention must be non-negative: "
            + ", ".join(str(node) for node in invalid_retentions)
        )

    histories: dict[str, list[float | None]] = {
        node: [_finite(init_vals.get(node, 0.0), f"Initial value for {node}")]
        for node in graph
    }
    converters = [
        node for node in graph if retentions[node] == 0.0
    ]
    formulas = {
        node: decode_expression(graph.nodes[node].get("formula"))
        for node in converters
    }
    sink_nodes = {
        node: decode_expression(data.get("sink_formula"))
        for node, data in graph.nodes(data=True)
        if data.get("sink_formula") not in (None, "")
    }
    source_nodes = {
        node: decode_expression(data.get("source_formula"))
        for node, data in graph.nodes(data=True)
        if data.get("source_formula") not in (None, "")
    }

    for t in range(int(steps)):
        raw = {
            node: _finite(histories[node][t], f"Value for {node} at step {t}")
            for node in graph
        }

        # Phase A: retention plus delayed edge inflows. Prehistory is zero.
        nxt = {
            node: _finite(
                retentions[node] * raw[node],
                f"Retained value for {node}",
            )
            for node in graph
        }
        for source, target, edge in graph.edges(data=True):
            delay = _delay_steps(edge.get("delay", edge.get("lag", 0)))
            source_t = t - delay
            source_value = histories[source][source_t] if source_t >= 0 else 0.0
            if source_value is None:
                source_value = 0.0
            nxt[target] = _finite(
                nxt[target] + edge_contribution(edge, source_value),
                f"Unbounded next value for {target}",
            )

        common_context = {
            "t": t,
            "history": histories,
            "raw": raw,
            "nxt": nxt,
        }

        # Phase B: stock values are noised, bounded, and committed.
        for node in graph:
            retention = retentions[node]
            if retention > 0.0:
                value = _apply_noise(noise, node=node, phase="stock", value=nxt[node], t=t)
                histories[node].append(_bounded_value(graph, node, value, common_context))
            else:
                histories[node].append(None)

        # Phase C: converters use committed stock/current converter values.
        for node in converters:
            inputs = {}
            for predecessor in graph.predecessors(node):
                edge = graph[predecessor][node]
                delay = _delay_steps(edge.get("delay", edge.get("lag", 0)))
                source_t = t + 1 - delay
                source_value = histories[predecessor][source_t] if source_t >= 0 else 0.0
                if source_value is None:
                    source_value = 0.0
                inputs[predecessor] = edge_contribution(edge, source_value)

            committed = {name: histories[name][-1] for name in graph}
            previous = _finite(histories[node][-2], f"Previous value for {node}")
            expression = formulas[node]
            if expression:
                context = {
                    "t": t,
                    "x": previous,
                    "val": previous,
                    "Y0": histories[node][0],
                    "inputs": inputs,
                    "history": histories,
                    "raw": raw,
                    "nxt": committed,
                }
                try:
                    value = evaluate_formula(expression, context)
                except FormulaEvaluationError as error:
                    _report_formula_error(on_formula_error, node, "formula", error)
                    value = previous
            else:
                value = float(sum(inputs.values()))
            value = _apply_noise(noise, node=node, phase="converter", value=value, t=t)
            converter_context = {
                "t": t,
                "history": histories,
                "raw": raw,
                "nxt": {name: histories[name][-1] for name in graph},
            }
            histories[node][-1] = _bounded_value(
                graph, node, value, converter_context
            )

        # Phase D: sink then source expressions are multiplicative factors.
        for node, expression in sink_nodes.items():
            histories[node][-1] = _apply_factor(
                histories, raw, node, expression, "sink", t, on_formula_error
            )
        for node, expression in source_nodes.items():
            histories[node][-1] = _apply_factor(
                histories, raw, node, expression, "source", t, on_formula_error
            )

    return histories


def _bounded_value(graph, node, value, context) -> float:
    value = _finite(value, f"Computed value for {node}")
    floor = _evaluate_bound(
        graph.nodes[node].get("floor", -math.inf), context, -math.inf
    )
    ceiling = _evaluate_bound(
        graph.nodes[node].get("ceiling", math.inf), context, math.inf
    )
    if floor > ceiling:
        raise SimulationContractError(f"Floor exceeds ceiling for node {node}")
    return _finite(min(ceiling, max(floor, value)), f"Bounded value for {node}")


def _evaluate_bound(bound, context, default) -> float:
    if isinstance(bound, (int, float, np.number)) and not math.isnan(float(bound)):
        return float(bound)
    if isinstance(bound, str) and bound.strip():
        normalized = bound.strip().lower()
        if normalized in {"infinity", "+infinity", "inf", "+inf"}:
            return math.inf
        if normalized in {"-infinity", "-inf"}:
            return -math.inf
        try:
            return evaluate_formula(decode_expression(bound), context)
        except FormulaEvaluationError:
            return default
    return default


def _apply_factor(
    histories,
    raw,
    node,
    expression,
    kind,
    t,
    on_formula_error,
) -> float:
    current = _finite(histories[node][-1], f"Current value for {node}")
    context = {
        "t": t,
        "x": current,
        "val": current,
        "Y0": histories[node][0],
        "history": histories,
        "raw": raw,
        "nxt": {name: histories[name][-1] for name in histories},
    }
    try:
        factor = evaluate_formula(expression, context)
    except FormulaEvaluationError as error:
        _report_formula_error(on_formula_error, node, kind, error)
        factor = 1.0
    return _finite(current * factor, f"{kind.title()} result for {node}")


def _apply_noise(noise, *, node, phase, value, t) -> float:
    value = _finite(value, f"Pre-noise value for {node}")
    if noise is None:
        return value
    if hasattr(noise, "apply"):
        result = noise.apply(node=node, phase=phase, value=value, t=t)
    else:
        result = noise(node=node, phase=phase, value=value, t=t)
    return _finite(result, f"Noisy value for {node}")


def _delay_steps(value) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise SimulationContractError("Edge delay must be numeric") from error
    if not math.isfinite(number) or number < 0.0 or not number.is_integer():
        raise SimulationContractError("Edge delay must be a non-negative integer")
    return int(number)


def _finite(value, field: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as error:
        raise SimulationContractError(f"{field} must be numeric") from error
    if not math.isfinite(parsed):
        raise SimulationContractError(f"{field} must be finite")
    return parsed


def _unit_interval(value, field: str) -> float:
    parsed = _finite(value, field)
    if not 0.0 <= parsed <= 1.0:
        raise SimulationContractError(f"{field} must be between 0 and 1")
    return parsed


def _report_formula_error(handler, node, kind, error) -> None:
    if handler is not None:
        handler(str(node), kind, error)
