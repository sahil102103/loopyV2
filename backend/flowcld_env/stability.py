"""Direct linear-stability tools for bounded graph-balancing workflows.

The general team environment optimizes notebook behavior and trajectory
objectives. This module also provides deterministic planners for the narrower
case where the requested result is explicit: meet a maximum notebook spectral
radius without changing graph structure, edge polarity, or unrelated fields.
"""

from __future__ import annotations

import cmath
from dataclasses import dataclass
from itertools import product
import math
import warnings

import networkx as nx
import numpy as np
from scipy.optimize import minimize

from .types import MutationMode, ParameterAction, ParameterName

try:
    from simulation_engine import runtime_linear_transition_matrix
except ModuleNotFoundError:
    from backend.simulation_engine import runtime_linear_transition_matrix


class TwoNodeLoopValidationError(ValueError):
    """Raised when a graph is outside the supported starter-loop contract."""


class SpectralRadiusValidationError(ValueError):
    """Raised when the notebook transition matrix cannot be measured safely."""


@dataclass(frozen=True)
class SpectralTargetEvaluation:
    """Notebook spectral-radius measurement against a maximum target."""

    radius: float
    target: float
    excess: float
    fit: float
    met: bool


class NotebookSpectralAnalyzer:
    """Measure the signed transition matrix used by the notebook optimizer.

    The matrix has node retention on its diagonal and
    ``correlation * (1 - decay)`` at each directed edge position. This is the
    notebook's linear stability metric; delay, confidence, formulas, and
    clipping remain part of the separate full simulation score.
    """

    def transition_matrix(self, graph: nx.DiGraph) -> np.ndarray:
        if not isinstance(graph, nx.DiGraph) or not graph.nodes:
            raise SpectralRadiusValidationError(
                "Spectral radius requires a non-empty directed graph"
            )
        for node in graph.nodes:
            retention = self._finite(
                graph.nodes[node].get("retention", 0.0), "retention"
            )
            if not 0.0 <= retention <= 1.0:
                raise SpectralRadiusValidationError(
                    "Node retention must be between 0 and 1"
                )
        for source, target, data in graph.edges(data=True):
            self._finite(
                data.get(
                    "correlation",
                    data.get("weight", 1.0) * data.get("polarity", 1.0),
                ),
                "correlation",
            )
            decay = self._finite(data.get("decay", 0.0), "decay")
            if not 0.0 <= decay <= 1.0:
                raise SpectralRadiusValidationError(
                    "Edge decay must be between 0 and 1"
                )
        matrix, _ = runtime_linear_transition_matrix(graph)
        return matrix

    def spectral_radius(self, graph: nx.DiGraph) -> float:
        eigenvalues = np.linalg.eigvals(self.transition_matrix(graph))
        return float(np.max(np.abs(eigenvalues))) if eigenvalues.size else 0.0

    def evaluate_target(
        self,
        graph: nx.DiGraph,
        target: float,
    ) -> SpectralTargetEvaluation:
        target = self._finite(target, "target spectral radius")
        if not 0.0 < target < 1.0:
            raise SpectralRadiusValidationError(
                "Target spectral radius must be greater than 0 and less than 1"
            )
        radius = self.spectral_radius(graph)
        excess = max(0.0, radius - target)
        met = bool(radius <= target + 1e-12)
        # Values at or below the limit receive full credit. An unmet goal is
        # capped below that full-credit band, while the exponential term still
        # gives greedy and learned agents a useful gradient toward the boundary.
        fit = 1.0 if met else 0.8 * math.exp(-excess / max(0.1, target))
        return SpectralTargetEvaluation(
            radius=radius,
            target=target,
            excess=excess,
            fit=float(fit),
            met=met,
        )

    @staticmethod
    def _finite(value, field: str) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError) as error:
            raise SpectralRadiusValidationError(f"{field} must be numeric") from error
        if not math.isfinite(parsed):
            raise SpectralRadiusValidationError(f"{field} must be finite")
        return parsed


class GraphBalanceValidationError(ValueError):
    """Raised when a connected graph cannot be balanced within safe bounds."""


@dataclass(frozen=True)
class GraphBalanceSettings:
    """Search limits and anti-collapse bounds for connected graph balancing."""

    target_radius: float = 0.99
    adjust_retention: bool = True
    adjust_decay: bool = True
    min_retention: float = 0.10
    max_decay: float = 0.85
    min_transmission_ratio: float = 0.12
    retention_change_weight: float = 1.0
    decay_change_weight: float = 1.5
    max_adjustable_parameters: int = 160
    max_nodes: int = 120
    max_iterations: int = 120

    def __post_init__(self) -> None:
        if not 0.0 < self.target_radius < 1.0:
            raise ValueError("target_radius must be greater than 0 and less than 1")
        if not self.adjust_retention and not self.adjust_decay:
            raise ValueError("At least one adjustable parameter must be enabled")
        if not 0.0 < self.min_retention <= 1.0:
            raise ValueError("min_retention must be greater than 0 and at most 1")
        if not 0.0 <= self.max_decay < 1.0:
            raise ValueError("max_decay must be at least 0 and less than 1")
        if not 0.0 <= self.min_transmission_ratio <= 1.0:
            raise ValueError("min_transmission_ratio must be between 0 and 1")
        if self.retention_change_weight <= 0.0 or self.decay_change_weight <= 0.0:
            raise ValueError("Parameter change weights must be positive")
        if self.max_adjustable_parameters < 1:
            raise ValueError("max_adjustable_parameters must be positive")
        if self.max_nodes < 2:
            raise ValueError("max_nodes must be at least 2")
        if self.max_iterations < 1:
            raise ValueError("max_iterations must be positive")


@dataclass(frozen=True)
class GraphBalancePlan:
    """A parameter-only graph plan plus diagnostics needed by the UI."""

    initial_radius: float
    final_radius: float
    actions: tuple[ParameterAction, ...]
    intervention_cost: float
    transmission_ratio: float
    required_transmission_ratio: float
    prioritized_nodes: tuple[str, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class _BalanceSlot:
    parameter: ParameterName
    target: str | tuple[str, str]
    start: float
    extreme: float
    influence: float
    cost_weight: float


class GraphBalancePlanner:
    """Find a bounded minimum-change plan for a connected directed graph.

    The optimizer uses the notebook transition matrix exactly. Retention may
    only decrease and decay may only increase, subject to user-selected bounds.
    Change costs are lower for more influential nodes/edges, which keeps the
    search practical on larger graphs while retaining a deterministic result.
    """

    def __init__(
        self,
        analyzer: NotebookSpectralAnalyzer | None = None,
        settings: GraphBalanceSettings | None = None,
    ) -> None:
        self._analyzer = analyzer or NotebookSpectralAnalyzer()
        self._settings = settings or GraphBalanceSettings()

    @property
    def settings(self) -> GraphBalanceSettings:
        return self._settings

    def plan(self, graph: nx.DiGraph) -> GraphBalancePlan:
        plan_warnings = self._validate_graph(graph)
        initial_radius = self._analyzer.spectral_radius(graph)
        node_influence, edge_influence = self._influence_scores(graph)
        prioritized_nodes = tuple(
            str(node) for node, _ in sorted(
                node_influence.items(), key=lambda item: (-item[1], str(item[0]))
            )[:8]
        )
        baseline_transmission = self._transmission_ratio(graph)
        required_transmission = min(
            baseline_transmission,
            self._settings.min_transmission_ratio,
        )
        if initial_radius <= self._settings.target_radius + 1e-12:
            return GraphBalancePlan(
                initial_radius=initial_radius,
                final_radius=initial_radius,
                actions=(),
                intervention_cost=0.0,
                transmission_ratio=baseline_transmission,
                required_transmission_ratio=required_transmission,
                prioritized_nodes=prioritized_nodes,
                warnings=plan_warnings,
            )

        slots = self._build_slots(graph, node_influence, edge_influence)
        if not slots:
            raise GraphBalanceValidationError(
                "The target is not met and no enabled parameters can move within the safety bounds"
            )
        if len(slots) > self._settings.max_adjustable_parameters:
            slots = tuple(sorted(
                slots,
                key=lambda slot: (-slot.influence, slot.parameter.value, str(slot.target)),
            )[:self._settings.max_adjustable_parameters])
            plan_warnings = (*plan_warnings,
                f"Search limited to the {len(slots)} most influential adjustable parameters.",
            )

        matrix = self._analyzer.transition_matrix(graph)
        nodes = list(graph.nodes)
        node_index = {node: position for position, node in enumerate(nodes)}
        edge_data = {
            (str(source), str(target)): (
                abs(float(data.get("correlation", 1.0))),
                float(data.get("decay", 0.0)),
            )
            for source, target, data in graph.edges(data=True)
        }
        original = np.asarray([slot.start for slot in slots], dtype=float)
        extreme = np.asarray([slot.extreme for slot in slots], dtype=float)
        lower = np.minimum(original, extreme)
        upper = np.maximum(original, extreme)
        bounds = list(zip(lower, upper))
        weights = np.asarray([slot.cost_weight for slot in slots], dtype=float)

        def candidate_matrix(values: np.ndarray) -> np.ndarray:
            candidate = matrix.copy()
            for slot, value in zip(slots, values):
                if slot.parameter is ParameterName.RETENTION:
                    position = node_index[slot.target]
                    candidate[position, position] += float(value) - slot.start
                else:
                    source, target = slot.target
                    data = graph[source][target]
                    correlation = float(data.get("correlation", 1.0))
                    candidate[node_index[target], node_index[source]] -= (
                        correlation * (float(value) - slot.start)
                    )
            return candidate

        def radius(values: np.ndarray) -> float:
            eigenvalues = np.linalg.eigvals(candidate_matrix(values))
            return float(np.max(np.abs(eigenvalues))) if eigenvalues.size else 0.0

        def transmission(values: np.ndarray) -> float:
            decays = {edge: decay for edge, (_, decay) in edge_data.items()}
            for slot, value in zip(slots, values):
                if slot.parameter is ParameterName.DECAY:
                    decays[slot.target] = float(value)
            denominator = sum(correlation for correlation, _ in edge_data.values())
            if denominator <= 1e-12:
                return 1.0
            numerator = sum(
                edge_data[edge][0] * (1.0 - decay)
                for edge, decay in decays.items()
            )
            return float(numerator / denominator)

        def intervention_cost(values: np.ndarray) -> float:
            changes = values - original
            return float(np.sum(weights * changes * changes))

        starts = self._starting_points(original, extreme, slots)
        feasible: list[tuple[tuple, np.ndarray, float, float]] = []
        best_radius = initial_radius

        def consider(values) -> None:
            nonlocal best_radius
            clipped = np.clip(np.asarray(values, dtype=float), lower, upper)
            candidate_radius = radius(clipped)
            candidate_transmission = transmission(clipped)
            best_radius = min(best_radius, candidate_radius)
            if (
                candidate_radius <= self._settings.target_radius + 1e-9
                and candidate_transmission + 1e-9 >= required_transmission
            ):
                changed_count = int(np.sum(np.abs(clipped - original) > 1e-7))
                key = (
                    round(intervention_cost(clipped), 12),
                    changed_count,
                    round(abs(self._settings.target_radius - candidate_radius), 12),
                    tuple(np.round(clipped, 10)),
                )
                feasible.append((key, clipped.copy(), candidate_radius, candidate_transmission))

        for start in starts:
            consider(start)
            constraints = [
                {"type": "ineq", "fun": lambda values: self._settings.target_radius - radius(values)},
                {"type": "ineq", "fun": lambda values: transmission(values) - required_transmission},
            ]
            try:
                with warnings.catch_warnings():
                    warnings.filterwarnings(
                        "ignore",
                        message="Values in x were outside bounds during a minimize step",
                        category=RuntimeWarning,
                    )
                    optimized = minimize(
                        intervention_cost,
                        np.asarray(start, dtype=float),
                        method="SLSQP",
                        bounds=bounds,
                        constraints=constraints,
                        options={
                            "maxiter": self._settings.max_iterations,
                            "ftol": 1e-10,
                            "disp": False,
                        },
                    )
                consider(optimized.x)
            except (FloatingPointError, ValueError, np.linalg.LinAlgError):
                continue

        if not feasible:
            raise GraphBalanceValidationError(
                "No plan met the target within the selected retention, decay, and "
                f"transmission bounds. Best spectral radius found: {best_radius:.3f}."
            )

        _, selected, final_radius, final_transmission = min(
            feasible, key=lambda item: item[0]
        )
        rounded = np.round(selected, 8)
        if (
            radius(rounded) <= self._settings.target_radius + 1e-9
            and transmission(rounded) + 1e-9 >= required_transmission
        ):
            selected = rounded
            final_radius = radius(selected)
            final_transmission = transmission(selected)

        actions = []
        for slot, value in zip(slots, selected):
            if abs(float(value) - slot.start) <= 1e-7:
                continue
            actions.append(ParameterAction(
                parameter=slot.parameter,
                target=slot.target,
                value=float(value),
                mode=MutationMode.SET,
            ))
        return GraphBalancePlan(
            initial_radius=initial_radius,
            final_radius=final_radius,
            actions=tuple(actions),
            intervention_cost=intervention_cost(selected),
            transmission_ratio=final_transmission,
            required_transmission_ratio=required_transmission,
            prioritized_nodes=prioritized_nodes,
            warnings=plan_warnings,
        )

    def _validate_graph(self, graph: nx.DiGraph) -> tuple[str, ...]:
        if not isinstance(graph, nx.DiGraph) or graph.number_of_nodes() < 2:
            raise GraphBalanceValidationError(
                "Model balance requires a directed graph with at least two nodes"
            )
        if graph.number_of_nodes() > self._settings.max_nodes:
            raise GraphBalanceValidationError(
                f"Model balance currently supports up to {self._settings.max_nodes} nodes"
            )
        if not graph.number_of_edges():
            raise GraphBalanceValidationError("Model balance requires at least one edge")
        if not nx.is_weakly_connected(graph):
            raise GraphBalanceValidationError(
                "Model balance requires one connected graph; balance disconnected components separately"
            )
        warnings = []
        if any(
            graph.nodes[node].get(field)
            for node in graph.nodes
            for field in ("formula", "sink_formula", "source_formula")
        ):
            warnings.append(
                "Node formulas, sources, and sinks are preserved and checked by the full notebook simulation; they are not part of the linear spectral matrix."
            )
        if any(int(data.get("delay", 0)) != 0 for _, _, data in graph.edges(data=True)):
            warnings.append(
                "Edge delays are preserved and checked by the full notebook simulation; the notebook spectral matrix itself is delay-free."
            )
        for node in graph.nodes:
            retention = self._finite(
                graph.nodes[node].get("retention", 0.0), "Node retention"
            )
            if not 0.0 <= retention <= 1.0:
                raise GraphBalanceValidationError(
                    "Every node retention must be between 0 and 1"
                )
        for _, _, data in graph.edges(data=True):
            functional_form = str(data.get("functional_form", "linear")).strip().lower()
            if functional_form not in {"", "linear"}:
                raise GraphBalanceValidationError(
                    "Deterministic model balance currently supports linear edges only"
                )
            self._finite(data.get("correlation", 1.0), "Edge correlation")
            decay = self._finite(data.get("decay", 0.0), "Edge decay")
            if not 0.0 <= decay <= 1.0:
                raise GraphBalanceValidationError(
                    "Every edge decay must be between 0 and 1"
                )
        return tuple(warnings)

    def _build_slots(
        self,
        graph: nx.DiGraph,
        node_influence: dict,
        edge_influence: dict,
    ) -> tuple[_BalanceSlot, ...]:
        slots = []
        if self._settings.adjust_retention:
            for node in graph.nodes:
                start = float(graph.nodes[node].get("retention", 0.0))
                extreme = min(start, self._settings.min_retention)
                if start <= 0.0 or abs(start - extreme) <= 1e-12:
                    continue
                influence = float(node_influence.get(node, 0.0))
                slots.append(_BalanceSlot(
                    parameter=ParameterName.RETENTION,
                    target=str(node),
                    start=start,
                    extreme=extreme,
                    influence=influence,
                    cost_weight=self._settings.retention_change_weight * (1.5 - influence),
                ))
        if self._settings.adjust_decay:
            for source, target, data in graph.edges(data=True):
                start = float(data.get("decay", 0.0))
                extreme = max(start, self._settings.max_decay)
                if abs(start - extreme) <= 1e-12:
                    continue
                edge = (str(source), str(target))
                influence = float(edge_influence.get((source, target), 0.0))
                slots.append(_BalanceSlot(
                    parameter=ParameterName.DECAY,
                    target=edge,
                    start=start,
                    extreme=extreme,
                    influence=influence,
                    cost_weight=self._settings.decay_change_weight * (1.5 - influence),
                ))
        return tuple(slots)

    @staticmethod
    def _starting_points(
        original: np.ndarray,
        extreme: np.ndarray,
        slots: tuple[_BalanceSlot, ...],
    ) -> tuple[np.ndarray, ...]:
        starts = [original.copy(), extreme.copy()]
        starts.extend(
            original + alpha * (extreme - original)
            for alpha in (0.25, 0.50, 0.75)
        )
        order = sorted(
            range(len(slots)),
            key=lambda index: (-slots[index].influence, slots[index].parameter.value, str(slots[index].target)),
        )
        for fraction in (0.25, 0.50, 0.75):
            count = max(1, math.ceil(len(order) * fraction))
            candidate = original.copy()
            candidate[order[:count]] = extreme[order[:count]]
            starts.append(candidate)
        unique = []
        seen = set()
        for start in starts:
            key = tuple(np.round(start, 12))
            if key not in seen:
                unique.append(start)
                seen.add(key)
        return tuple(unique)

    @staticmethod
    def _influence_scores(graph: nx.DiGraph) -> tuple[dict, dict]:
        node_raw = {node: 0.0 for node in graph.nodes}
        edge_raw = {}
        for source, target, data in graph.edges(data=True):
            coefficient = abs(float(data.get("correlation", 1.0))) * (
                1.0 - float(data.get("decay", 0.0))
            )
            edge_raw[(source, target)] = coefficient
            node_raw[source] += coefficient
            node_raw[target] += coefficient
        node_scale = max(node_raw.values(), default=0.0)
        node_scores = {
            node: (value / node_scale if node_scale > 1e-12 else 0.0)
            for node, value in node_raw.items()
        }
        weighted_edges = {
            edge: value * (
                0.5 + 0.25 * node_scores[edge[0]] + 0.25 * node_scores[edge[1]]
            )
            for edge, value in edge_raw.items()
        }
        edge_scale = max(weighted_edges.values(), default=0.0)
        edge_scores = {
            edge: (value / edge_scale if edge_scale > 1e-12 else 0.0)
            for edge, value in weighted_edges.items()
        }
        return node_scores, edge_scores

    @staticmethod
    def _transmission_ratio(graph: nx.DiGraph) -> float:
        correlations = []
        transmissions = []
        for _, _, data in graph.edges(data=True):
            correlation = abs(float(data.get("correlation", 1.0)))
            correlations.append(correlation)
            transmissions.append(correlation * (1.0 - float(data.get("decay", 0.0))))
        denominator = sum(correlations)
        return float(sum(transmissions) / denominator) if denominator > 1e-12 else 1.0

    @staticmethod
    def _finite(value, field: str) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError) as error:
            raise GraphBalanceValidationError(f"{field} must be numeric") from error
        if not math.isfinite(parsed):
            raise GraphBalanceValidationError(f"{field} must be finite")
        return parsed


@dataclass(frozen=True)
class TwoNodeLoop:
    """Validated node and edge ordering for a reciprocal balancing loop."""

    nodes: tuple[str, str]
    edges: tuple[tuple[str, str], tuple[str, str]]


@dataclass(frozen=True)
class TwoNodeBalanceSettings:
    """Safety and search settings for a direct two-node balance plan."""

    target_radius: float = 0.99
    step: float = 0.05
    min_retention: float = 0.10
    max_decay: float = 0.90
    decay_change_weight: float = 1.50

    def __post_init__(self) -> None:
        if not 0.0 < self.target_radius < 1.0:
            raise ValueError("target_radius must be between 0 and 1")
        if not 0.0 < self.step <= 1.0:
            raise ValueError("step must be between 0 and 1")
        if not 0.0 < self.min_retention <= 1.0:
            raise ValueError("min_retention must be between 0 and 1")
        if not 0.0 <= self.max_decay < 1.0:
            raise ValueError("max_decay must be at least 0 and less than 1")
        if self.decay_change_weight <= 0.0:
            raise ValueError("decay_change_weight must be positive")


@dataclass(frozen=True)
class TwoNodeBalancePlan:
    """A bounded parameter-only plan and its projected stability result."""

    loop: TwoNodeLoop
    initial_radius: float
    final_radius: float
    actions: tuple[ParameterAction, ...]


class TwoNodeLoopAnalyzer:
    """Validate and measure the notebook transition matrix for two stocks."""

    def describe(self, graph: nx.DiGraph) -> TwoNodeLoop:
        if graph.number_of_nodes() != 2 or graph.number_of_edges() != 2:
            raise TwoNodeLoopValidationError(
                "Simple balance requires exactly two nodes and two edges"
            )
        nodes = tuple(str(node) for node in graph.nodes)
        if len(set(nodes)) != 2 or any(not node.strip() for node in nodes):
            raise TwoNodeLoopValidationError("Both nodes need distinct names")

        forward = (nodes[0], nodes[1])
        reverse = (nodes[1], nodes[0])
        if not graph.has_edge(*forward) or not graph.has_edge(*reverse):
            raise TwoNodeLoopValidationError(
                "The two edges must connect the nodes in opposite directions"
            )

        for node in nodes:
            data = graph.nodes[node]
            retention = self._finite(data.get("retention", 1.0), "retention")
            if retention <= 0.0 or retention > 1.0:
                raise TwoNodeLoopValidationError(
                    "Simple balance supports stock-node retention above 0 and at most 1"
                )
            if data.get("formula") or data.get("sink_formula") or data.get("source_formula"):
                raise TwoNodeLoopValidationError(
                    "Simple balance supports stock nodes without formulas, sources, or sinks"
                )

        correlations = []
        for edge in (forward, reverse):
            data = graph[edge[0]][edge[1]]
            functional_form = str(data.get("functional_form", "linear")).strip().lower()
            if functional_form not in {"", "linear"}:
                raise TwoNodeLoopValidationError(
                    "Simple balance supports linear edges only"
                )
            if abs(self._finite(data.get("delay", 0), "delay")) > 1e-12:
                raise TwoNodeLoopValidationError(
                    "Set both edge delays to 0 for the simple balance test"
                )
            decay = self._finite(data.get("decay", 0.0), "decay")
            if not 0.0 <= decay <= 1.0:
                raise TwoNodeLoopValidationError(
                    "Both edge decay values must be between 0 and 1"
                )
            correlations.append(
                self._finite(data.get("correlation", 1.0), "correlation")
            )
        if correlations[0] * correlations[1] >= 0.0:
            raise TwoNodeLoopValidationError(
                "A balancing loop needs one positive edge and one negative edge"
            )
        return TwoNodeLoop(nodes=nodes, edges=(forward, reverse))

    def spectral_radius(
        self,
        graph: nx.DiGraph,
        loop: TwoNodeLoop | None = None,
    ) -> float:
        selected = loop or self.describe(graph)
        retentions = tuple(
            float(graph.nodes[node].get("retention", 1.0))
            for node in selected.nodes
        )
        coefficients = tuple(
            float(graph[source][target].get("correlation", 1.0))
            * (1.0 - float(graph[source][target].get("decay", 0.0)))
            for source, target in selected.edges
        )
        return self.radius_from_values(retentions, coefficients)

    @staticmethod
    def radius_from_values(
        retentions: tuple[float, float],
        coefficients: tuple[float, float],
    ) -> float:
        """Return max |lambda| for [[r0, c10], [c01, r1]]."""

        r0, r1 = retentions
        c01, c10 = coefficients
        trace = r0 + r1
        determinant = r0 * r1 - c01 * c10
        root = cmath.sqrt(complex(trace * trace - 4.0 * determinant, 0.0))
        eigenvalues = ((trace + root) / 2.0, (trace - root) / 2.0)
        return float(max(abs(value) for value in eigenvalues))

    @staticmethod
    def _finite(value, field: str) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError) as error:
            raise TwoNodeLoopValidationError(f"{field} must be numeric") from error
        if not math.isfinite(parsed):
            raise TwoNodeLoopValidationError(f"{field} must be finite")
        return parsed


class TwoNodeBalancePlanner:
    """Find the smallest bounded parameter change meeting a direct rho target."""

    def __init__(
        self,
        analyzer: TwoNodeLoopAnalyzer | None = None,
        settings: TwoNodeBalanceSettings | None = None,
    ) -> None:
        self._analyzer = analyzer or TwoNodeLoopAnalyzer()
        self._settings = settings or TwoNodeBalanceSettings()

    @property
    def settings(self) -> TwoNodeBalanceSettings:
        return self._settings

    def plan(self, graph: nx.DiGraph) -> TwoNodeBalancePlan:
        loop = self._analyzer.describe(graph)
        initial_radius = self._analyzer.spectral_radius(graph, loop)
        if initial_radius <= self._settings.target_radius:
            return TwoNodeBalancePlan(loop, initial_radius, initial_radius, ())

        initial_retentions = tuple(
            float(graph.nodes[node].get("retention", 1.0))
            for node in loop.nodes
        )
        initial_decays = tuple(
            float(graph[source][target].get("decay", 0.0))
            for source, target in loop.edges
        )
        correlations = tuple(
            float(graph[source][target].get("correlation", 1.0))
            for source, target in loop.edges
        )

        retention_options = tuple(
            self._descending_values(value, self._settings.min_retention)
            for value in initial_retentions
        )
        decay_options = tuple(
            self._ascending_values(value, max(value, self._settings.max_decay))
            for value in initial_decays
        )

        best = None
        for r0, r1, d0, d1 in product(
            retention_options[0],
            retention_options[1],
            decay_options[0],
            decay_options[1],
        ):
            coefficients = (
                correlations[0] * (1.0 - d0),
                correlations[1] * (1.0 - d1),
            )
            radius = self._analyzer.radius_from_values((r0, r1), coefficients)
            if radius > self._settings.target_radius + 1e-12:
                continue
            retention_changes = (
                initial_retentions[0] - r0,
                initial_retentions[1] - r1,
            )
            decay_changes = (
                d0 - initial_decays[0],
                d1 - initial_decays[1],
            )
            change_cost = sum(value * value for value in retention_changes)
            change_cost += self._settings.decay_change_weight * sum(
                value * value for value in decay_changes
            )
            imbalance = abs(retention_changes[0] - retention_changes[1])
            imbalance += abs(decay_changes[0] - decay_changes[1])
            changed_count = sum(
                abs(value) > 1e-12
                for value in (*retention_changes, *decay_changes)
            )
            score = (
                round(change_cost, 12),
                round(imbalance, 12),
                round(self._settings.target_radius - radius, 12),
                changed_count,
                r0,
                r1,
                d0,
                d1,
            )
            if best is None or score < best[0]:
                best = (score, radius, (r0, r1), (d0, d1))

        if best is None:
            raise TwoNodeLoopValidationError(
                "No stable plan was found within the retention and decay safety bounds"
            )

        _, final_radius, final_retentions, final_decays = best
        actions = []
        for node, before, after in zip(loop.nodes, initial_retentions, final_retentions):
            if abs(after - before) > 1e-12:
                actions.append(ParameterAction(
                    parameter=ParameterName.RETENTION,
                    target=node,
                    value=after,
                    mode=MutationMode.SET,
                ))
        for edge, before, after in zip(loop.edges, initial_decays, final_decays):
            if abs(after - before) > 1e-12:
                actions.append(ParameterAction(
                    parameter=ParameterName.DECAY,
                    target=edge,
                    value=after,
                    mode=MutationMode.SET,
                ))
        return TwoNodeBalancePlan(
            loop=loop,
            initial_radius=initial_radius,
            final_radius=final_radius,
            actions=tuple(actions),
        )

    def _descending_values(self, start: float, floor: float) -> tuple[float, ...]:
        minimum = min(start, floor)
        return self._stepped_values(start, minimum, -self._settings.step)

    def _ascending_values(self, start: float, ceiling: float) -> tuple[float, ...]:
        maximum = min(1.0, max(start, ceiling))
        return self._stepped_values(start, maximum, self._settings.step)

    @staticmethod
    def _stepped_values(start: float, stop: float, step: float) -> tuple[float, ...]:
        values = [round(float(start), 10)]
        current = float(start)
        if step > 0.0:
            while current + step < stop - 1e-12:
                current += step
                values.append(round(current, 10))
        else:
            while current + step > stop + 1e-12:
                current += step
                values.append(round(current, 10))
        rounded_stop = round(float(stop), 10)
        if abs(values[-1] - rounded_stop) > 1e-12:
            values.append(rounded_stop)
        return tuple(values)
