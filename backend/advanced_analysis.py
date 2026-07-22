"""
Advanced CLD Analysis Engine
Extracted from Jupyter notebook - comprehensive two-phase simulation with stability analysis
"""

import copy
import math
import random
import time
import numpy as np
import pandas as pd
import networkx as nx
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.signal import find_peaks
from scipy.stats import norm, rankdata, gaussian_kde
from sklearn.mixture import GaussianMixture
from io import BytesIO
import base64
try:
    from dmd_analysis import dmd_from_history
    from simulation_engine import (
        MODEL_SCHEMA_VERSION,
        SUPPORTED_EDGE_FORMS,
        MultiplicativeGaussianNoise,
        apply_edge_form as _apply_form,
        decode_expression as _decode_expr,
        edge_contribution as _edge_contribution,
        edge_factor as _edge_factor,
        evaluate_bound as _eval_bound,
        legacy_loop_transition_matrix,
        runtime_linear_transition_matrix,
        simulate_two_phase,
        uniform_sweep_transition_matrix,
    )
except ModuleNotFoundError:  # Supports package-style imports in repository-level tests.
    from backend.dmd_analysis import dmd_from_history
    from backend.simulation_engine import (
        MODEL_SCHEMA_VERSION,
        SUPPORTED_EDGE_FORMS,
        MultiplicativeGaussianNoise,
        apply_edge_form as _apply_form,
        decode_expression as _decode_expr,
        edge_contribution as _edge_contribution,
        edge_factor as _edge_factor,
        evaluate_bound as _eval_bound,
        legacy_loop_transition_matrix,
        runtime_linear_transition_matrix,
        simulate_two_phase,
        uniform_sweep_transition_matrix,
    )

# ═══════════════════════════════════════════════════════════════════════════════
# CORE SIMULATION ENGINE (Two-Phase Propagation)
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# STABILITY ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════


def _dmd_from_hist(hist, node_order=None, *, r=10, dt_quarters=1.0, center=True):
    """Notebook-compatible facade over the shared warning-free DMD module."""

    return dmd_from_history(
        hist,
        node_order,
        rank=r,
        dt_quarters=dt_quarters,
        center=center,
    )

def rolling_z(series, window=10):
    """Calculate rolling Z-scores."""
    s = pd.Series(series)
    mu = s.rolling(window, min_periods=1).mean()
    sd = s.rolling(window, min_periods=1).std(ddof=0).replace(0, 1e-12)
    return ((s - mu) / sd).fillna(0)


def classify_behavior(hist_dict, damp_tol=1e-3, range_rel_tol=0.01, 
                      growth_ratio=300.0, slope_thresh=0.2):
    """
    Classify node behavior as Over-damped, Optimal, or Unconstrained.
    
    Returns:
    --------
    dict mapping node names to classification strings
    """
    classifications = {}
    
    for node, series in hist_dict.items():
        values = np.asarray([v for v in series if v is not None], dtype=float)
        if values.size == 0:
            classifications[node] = "Over-damped"
            continue
        
        final_abs = abs(values[-1])
        max_abs = np.max(np.abs(values))
        abs_range = values.max() - values.min()
        rel_range = abs_range / (max_abs + 1e-12)
        
        # Over-damped tests
        if (final_abs < damp_tol) or (rel_range < range_rel_tol):
            classifications[node] = "Over-damped"
            continue
        
        # Unconstrained tests
        early_len = max(1, len(values) // 5)
        early_mean = np.mean(np.abs(values[:early_len]))
        growth_fact = final_abs / (early_mean + 1e-12)
        
        abs_vals = np.abs(values) + 1e-12
        log_vals = np.log(abs_vals)
        slope = np.polyfit(np.arange(len(values)), log_vals, deg=1)[0]
        
        if (growth_fact >= growth_ratio) and (slope > slope_thresh):
            classifications[node] = "Unconstrained"
        else:
            classifications[node] = "Optimal"
    
    return classifications


def compute_uniform_sweep_transition_matrix(graph, decay_factor, passnodes=None):
    """Build the notebook's legacy uniform parameter-sweep matrix."""

    return uniform_sweep_transition_matrix(
        graph, decay_factor, passnodes=set(passnodes or ())
    )


def compute_legacy_loop_transition_matrix(graph, decay_factor, passnodes=None):
    """Build the notebook loop-through diagnostic matrix."""

    return legacy_loop_transition_matrix(
        graph, decay_factor, passnodes=set(passnodes or ())
    )


def compute_adjacency_matrix(graph, decay_factor, passnodes=None):
    """Compatibility alias for :func:`compute_legacy_loop_transition_matrix`."""

    return compute_legacy_loop_transition_matrix(graph, decay_factor, passnodes)


def compute_adjacency_matrix_stability(graph, decay_factor, passnodes=None):
    """Compatibility alias for :func:`compute_uniform_sweep_transition_matrix`."""

    return compute_uniform_sweep_transition_matrix(graph, decay_factor, passnodes)


def analyze_eigenvalues_stability(A):
    """Analyze eigenvalues for stability."""
    eigvals = np.linalg.eigvals(A)
    mags = np.abs(eigvals)
    max_mag = mags.max()
    avg_mag = mags.mean()
    dist_metric = abs(1 - avg_mag)
    return eigvals, dist_metric, max_mag


DIST_TOL = 0.10  # within 10% of unit circle → "stable"


def compute_shape_penalty(z_series, flat_tol=0.05, extreme_tol=2.0, oscillation_tol=3):
    """
    Penalise undesirable Z-score shapes:
      - Flat (mean |Z| near 0)
      - Extreme divergence (max |Z| > extreme_tol)
      - Excessive zero-crossings
    """
    z = np.asarray(z_series, dtype=float)
    penalty = 0.0
    if np.mean(np.abs(z)) < flat_tol:
        penalty += 2.0
    max_abs_z = np.max(np.abs(z))
    if max_abs_z > extreme_tol:
        penalty += (max_abs_z - extreme_tol)
    zero_crossings = int(np.sum(np.diff(np.sign(z)) != 0))
    if zero_crossings > oscillation_tol:
        penalty += (zero_crossings - oscillation_tol) * 0.5
    return penalty


def simulate_with_stability(G, decay_vals, delays, *, ret_val=None,
                             iters=100, use_delay=True, z_window=10):
    """
    Sweep (decay × delay) for a fixed retention slice.

    For each cell:
      - eigenvalue dist_metric via compute_adjacency_matrix_stability
      - max rolling-Z across all nodes via simulate_two_phase

    Returns
    -------
    dist_grid      : np.ndarray  (len(delays), len(decay_vals))
    zscore_grid    : np.ndarray  same shape
    raw_series_map : dict  (delay_int, decay_float) → list[np.ndarray]
    """
    dist_grid      = np.zeros((len(delays), len(decay_vals)))
    zscore_grid    = np.zeros_like(dist_grid)
    raw_series_map = {}

    # Pass 1 — calibrate penalty for unstable points
    stable_distances = []
    for decay in decay_vals:
        A, _ = compute_uniform_sweep_transition_matrix(G, float(decay))
        _, dist_metric, _ = analyze_eigenvalues_stability(A)
        if dist_metric < DIST_TOL:
            stable_distances.append(dist_metric)
    penalty_metric = max(stable_distances) + 0.1 if stable_distances else 1.0

    # Pass 2 — eigenvalue dist + signal simulation
    for i, delay in enumerate(delays):
        for j, decay in enumerate(decay_vals):
            A, _ = compute_uniform_sweep_transition_matrix(G, float(decay))
            _, dist_metric, _ = analyze_eigenvalues_stability(A)
            dist_grid[i, j] = dist_metric if dist_metric < DIST_TOL else penalty_metric

            G_sim = G.copy()
            eff_ret = float(ret_val) if ret_val is not None else (1.0 - float(decay))
            for n in G_sim.nodes:
                G_sim.nodes[n]['retention'] = eff_ret
            nx.set_edge_attributes(G_sim, int(delay) if use_delay else 0, 'delay')

            init_vals = {n: G_sim.nodes[n].get('start_amount', 0.0) for n in G_sim.nodes}
            hist = simulate_two_phase(G_sim, init_vals, iters)

            z_maxes, series_arrays = [], []
            for series in hist.values():
                clean = np.asarray([v for v in series if v is not None], dtype=float)
                if clean.size > 0:
                    z = rolling_z(clean.tolist(), window=z_window)
                    z_maxes.append(float(np.abs(z).max()))
                    series_arrays.append(clean)
            zscore_grid[i, j] = max(z_maxes) if z_maxes else 0.0
            raw_series_map[(int(delay), float(decay))] = series_arrays

    return dist_grid, zscore_grid, raw_series_map


# ═══════════════════════════════════════════════════════════════════════════════
# GMM ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def initialize_gmms(df, n_components=2):
    """Initialize Gaussian Mixture Models for each variable."""
    gmms = {}
    for col in df.columns:
        gmm = GaussianMixture(n_components=n_components, random_state=42)
        gmm.fit(df[[col]])
        gmms[col] = gmm
    return gmms


def generate_gmm_samples(gmms, n_samples=100):
    """Generate synthetic samples from GMMs."""
    synth = pd.DataFrame()
    for col, g in gmms.items():
        s, _ = g.sample(n_samples)
        synth[col] = s.flatten()
    return synth


# ═══════════════════════════════════════════════════════════════════════════════
# PLOTTING UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def plot_to_base64(fig):
    """Convert matplotlib figure to base64 string."""
    buf = BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)
    return img_base64


def create_time_series_plot(hist_dict, title="Node Values Over Time"):
    """Create time series plot from simulation history."""
    fig, ax = plt.subplots(figsize=(14, 8))
    
    for node, series in hist_dict.items():
        clean_series = [v for v in series if v is not None]
        ax.plot(clean_series, label=node, linewidth=2)
    
    ax.set_xlabel("Time Step", fontsize=12)
    ax.set_ylabel("Value", fontsize=12)
    ax.set_title(title, fontsize=14)
    ax.legend(frameon=True, loc='best')
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    
    return fig


def create_rolling_z_plot(hist_dict, window=10, title="Rolling Z-Scores"):
    """Create rolling Z-score plot."""
    fig, ax = plt.subplots(figsize=(14, 8))
    
    for node, series in hist_dict.items():
        clean_series = [v for v in series if v is not None]
        z_scores = rolling_z(clean_series, window=window)
        ax.plot(z_scores, label=node, linewidth=2)
    
    ax.axhline(0, color='black', linewidth=0.8, linestyle='-')
    ax.axhline(1, color='gray', linewidth=0.8, linestyle='--')
    ax.axhline(-1, color='gray', linewidth=0.8, linestyle='--')
    ax.set_xlabel("Time Step", fontsize=12)
    ax.set_ylabel("Z-Score", fontsize=12)
    ax.set_title(title, fontsize=14)
    ax.legend(frameon=True, loc='best')
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    
    return fig


def create_stability_heatmap(decay_values, delay_values, stability_matrix):
    """Create stability parameter space heatmap."""
    fig, ax = plt.subplots(figsize=(12, 8))
    
    im = ax.imshow(
        stability_matrix,
        cmap='coolwarm',
        origin='lower',
        aspect='auto',
        extent=[min(decay_values), max(decay_values), 
                min(delay_values), max(delay_values)],
        vmin=0.0, vmax=1.0
    )
    
    ax.set_xlabel("Decay Factor", fontsize=12)
    ax.set_ylabel("Delay (time steps)", fontsize=12)
    ax.set_title("Stability Map (Behavior Classification)", fontsize=14)
    
    cbar = plt.colorbar(im, ax=ax)
    cbar.set_label("Classification", fontsize=11)
    cbar.set_ticks([0.2, 0.6, 1.0])
    cbar.set_ticklabels(['Over-damped', 'Optimal', 'Unconstrained'])
    
    plt.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════════════════════════
# HIGH-LEVEL ANALYSIS FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════


class GraphValidationError(ValueError):
    """A user-correctable graph payload error."""


_EDGE_FORMS = set(SUPPORTED_EDGE_FORMS)
_DEFAULT_GRAPH_VALUES = {
    "start_amount": 0.1,
    "retention": 1.0,
    "decay": 0.0,
    "confidence": 1.0,
}


def _first_present(data, keys, default=None):
    for key in keys:
        value = data.get(key)
        if value is not None and value != "":
            return value
    return default


def _finite_number(value, field, default):
    if value is None or value == "":
        return float(default)
    if isinstance(value, bool):
        raise GraphValidationError(f"{field} must be numeric")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise GraphValidationError(f"{field} must be numeric") from error
    if not math.isfinite(number):
        raise GraphValidationError(f"{field} must be finite")
    return number


def _nonnegative_int(value, field, default=0):
    number = _finite_number(value, field, default)
    if number < 0 or not number.is_integer():
        raise GraphValidationError(f"{field} must be a whole number greater than or equal to zero")
    return int(number)


def _bound_value(value, field, default):
    if value is None or value == "":
        return default
    if isinstance(value, str):
        text = value.strip()
        if text.lower() in {"-infinity", "-inf"}:
            return -math.inf
        if text.lower() in {"infinity", "+infinity", "inf", "+inf"}:
            return math.inf
        try:
            number = float(text)
        except ValueError:
            # A dynamic bound is evaluated later by the restricted expression evaluator.
            return text
    else:
        try:
            number = float(value)
        except (TypeError, ValueError) as error:
            raise GraphValidationError(f"{field} must be numeric or a formula") from error
    if math.isnan(number):
        raise GraphValidationError(f"{field} cannot be NaN")
    return number


def _formula_value(value, field):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise GraphValidationError(f"{field} must be text")
    return value.strip() or None


def build_graph_from_payload(graph_data, *, defaults=None):
    """Build the canonical NetworkX model used by all notebook-derived APIs."""
    if not isinstance(graph_data, dict):
        raise GraphValidationError("Request body must be a JSON object")
    schema_version = graph_data.get("schema_version")
    if schema_version not in (None, "", MODEL_SCHEMA_VERSION):
        raise GraphValidationError(
            f"Unsupported model schema version: {schema_version}"
        )
    graph_defaults = dict(_DEFAULT_GRAPH_VALUES)
    if defaults:
        graph_defaults.update(defaults)
    nodes_data = graph_data.get("nodes", [])
    edges_data = graph_data.get("edges", [])
    if not isinstance(nodes_data, list) or not isinstance(edges_data, list):
        raise GraphValidationError("nodes and edges must be arrays")

    graph = nx.DiGraph(schema_version=MODEL_SCHEMA_VERSION)
    names = set()
    for index, node_data in enumerate(nodes_data, start=1):
        if not isinstance(node_data, dict):
            raise GraphValidationError(f"Node {index} must be an object")
        raw_name = _first_present(node_data, ("name", "label", "id"))
        name = str(raw_name).strip() if raw_name is not None else ""
        if not name:
            raise GraphValidationError(f"Node {index} needs a name")
        if name in names:
            raise GraphValidationError(f"Node names must be unique: {name}")
        names.add(name)

        retention = 0.0 if node_data.get("pass") else _finite_number(
            _first_present(node_data, ("retention", "ret")), f"Retention for {name}", graph_defaults["retention"]
        )
        graph.add_node(
            name,
            start_amount=_finite_number(
                _first_present(node_data, ("start_amount", "startAmount", "start", "initial", "init", "value")),
                f"Start value for {name}",
                graph_defaults["start_amount"],
            ),
            retention=retention,
            floor=_bound_value(_first_present(node_data, ("floor", "min", "lower", "lower_bound")), f"Floor for {name}", -math.inf),
            ceiling=_bound_value(_first_present(node_data, ("ceiling", "ceil", "max", "upper", "upper_bound")), f"Ceiling for {name}", math.inf),
            formula=_formula_value(_first_present(node_data, ("formula", "expression", "expr")), f"Formula for {name}"),
            sink_formula=_formula_value(_first_present(node_data, ("sink_formula", "sinkFormula")), f"Sink formula for {name}"),
            source_formula=_formula_value(_first_present(node_data, ("source_formula", "sourceFormula")), f"Source formula for {name}"),
        )

    for index, edge_data in enumerate(edges_data, start=1):
        if not isinstance(edge_data, dict):
            raise GraphValidationError(f"Edge {index} must be an object")
        source = _first_present(edge_data, ("source", "from", "src", "u"))
        target = _first_present(edge_data, ("target", "to", "tgt", "v"))
        source = str(source).strip() if source is not None else ""
        target = str(target).strip() if target is not None else ""
        if not source or not target:
            raise GraphValidationError(f"Edge {index} needs both a source and target")
        if source not in names or target not in names:
            raise GraphValidationError(f"Edge {index} references a node that does not exist")

        form = str(_first_present(edge_data, ("functional_form", "functionalForm"), "linear")).strip().lower()
        if form not in _EDGE_FORMS:
            raise GraphValidationError(f"Edge {index} has an unsupported functional form")
        decay = _finite_number(
            _first_present(edge_data, ("decay", "damper")),
            f"Decay for edge {index}",
            graph_defaults["decay"],
        )
        confidence = _finite_number(
            _first_present(edge_data, ("confidence", "certainty")),
            f"Confidence for edge {index}",
            graph_defaults["confidence"],
        )
        if not 0.0 <= decay <= 1.0:
            raise GraphValidationError(f"Decay for edge {index} must be between 0 and 1")
        if not 0.0 <= confidence <= 1.0:
            raise GraphValidationError(f"Confidence for edge {index} must be between 0 and 1")

        graph.add_edge(
            source,
            target,
            correlation=_finite_number(_first_present(edge_data, ("correlation", "corr", "strength", "weight")), f"Correlation for edge {index}", 1.0),
            decay=decay,
            delay=_nonnegative_int(_first_present(edge_data, ("delay", "lag")), f"Delay for edge {index}"),
            confidence=confidence,
            functional_form=form,
        )

    if not graph.nodes:
        raise GraphValidationError("Add at least one named node before running analysis")
    return graph

def run_advanced_simulation(graph_data, iterations=200):
    """
    Run advanced two-phase simulation.
    
    Parameters:
    -----------
    graph_data : dict
        Contains: nodes (list of dicts), edges (list of dicts)
    iterations : int
        Number of simulation steps
        
    Returns:
    --------
    dict with simulation results and plots
    """
    G = build_graph_from_payload(graph_data, defaults={"retention": 0.9})
    
    # Initial values
    init_vals = {n: G.nodes[n]['start_amount'] for n in G.nodes}
    
    # Run simulation
    hist = simulate_two_phase(G, init_vals, iterations)
    
    # Classify behavior
    classifications = classify_behavior(hist)
    
    # Create plots
    time_series_fig = create_time_series_plot(hist, "Advanced Two-Phase Simulation")
    z_score_fig = create_rolling_z_plot(hist, window=10)
    
    # Convert to base64
    time_series_b64 = plot_to_base64(time_series_fig)
    z_score_b64 = plot_to_base64(z_score_fig)
    
    # Prepare time series data for frontend
    time_series_data = {}
    for node, series in hist.items():
        time_series_data[node] = [float(v) if v is not None else None for v in series]
    
    return {
        "success": True,
        "time_series_data": time_series_data,
        "classifications": classifications,
        "plots": {
            "time_series": time_series_b64,
            "z_scores": z_score_b64
        }
    }


def run_stability_analysis(graph_data, decay_range, delay_range, iterations=200):
    """
    Run parameter space stability analysis.
    
    Parameters:
    -----------
    graph_data : dict
        Graph structure
    decay_range : list
        [min, max, steps] for decay factor
    delay_range : list
        [min, max, steps] for delay
    iterations : int
        Simulation iterations per point
        
    Returns:
    --------
    dict with stability results
    """
    G = build_graph_from_payload(graph_data, defaults={"retention": 0.9})
    
    # Create parameter grids
    decay_min, decay_max, decay_steps = decay_range
    delay_min, delay_max, delay_steps = delay_range
    
    decay_values = np.linspace(decay_min, decay_max, int(decay_steps))
    delay_values = np.linspace(delay_min, delay_max, int(delay_steps), dtype=int)
    
    stability_matrix = np.zeros((len(delay_values), len(decay_values)))

    # Run sweep
    for i, delay in enumerate(delay_values):
        for j, decay in enumerate(decay_values):
            # Update graph
            G_temp = G.copy()
            nx.set_edge_attributes(G_temp, float(decay), 'decay')
            nx.set_edge_attributes(G_temp, int(delay), 'delay')

            # Simulate
            init_vals = {n: G_temp.nodes[n]['start_amount'] for n in G_temp.nodes}
            hist = simulate_two_phase(G_temp, init_vals, iterations)

            # Classify
            classification = classify_behavior(hist)

            if "Unconstrained" in classification.values():
                stability_matrix[i, j] = 1.0
            elif "Optimal" in classification.values():
                stability_matrix[i, j] = 0.6
            else:
                stability_matrix[i, j] = 0.2

    # Create heatmap
    heatmap_fig = create_stability_heatmap(decay_values, delay_values, stability_matrix)
    heatmap_b64 = plot_to_base64(heatmap_fig)

    return {
        "success": True,
        "stability_matrix": stability_matrix.tolist(),
        "decay_values": decay_values.tolist(),
        "delay_values": delay_values.tolist(),
        "plot": heatmap_b64
    }


def run_3d_param_space(graph_data, retention_range, decay_range, delay_range,
                        iterations=100, w_dist=0.5, w_z=0.3, w_shape=0.2, z_window=10):
    """
    Sweep retention × decay × delay using one simulate_with_stability call per
    retention slice (matches notebook's paramspace_3d_stack_of_2d).

    Scoring per cell:
        combo = w_dist * eigen_dist + w_z * max_rolling_z
                + w_shape * avg_shape_penalty + flat_penalty

    Points are ranked into 11 bins (0 = best/lowest combo, 10 = worst).
    """
    G = build_graph_from_payload(graph_data, defaults={"retention": 0.9})

    retention_values = np.linspace(retention_range[0], retention_range[1], int(retention_range[2]))
    decay_values     = np.linspace(decay_range[0],     decay_range[1],     int(decay_range[2]))
    delay_values     = np.linspace(delay_range[0],     delay_range[1],     int(delay_range[2]), dtype=int)

    rows = []
    for r_i, ret in enumerate(retention_values, 1):
        print(f"  3D slice {r_i}/{len(retention_values)}  (ret={ret:.2f})")
        dist_grid, z_grid, raw_map = simulate_with_stability(
            G,
            decay_vals=decay_values.tolist(),
            delays=delay_values.tolist(),
            ret_val=float(ret),
            iters=iterations,
            use_delay=True,
            z_window=z_window
        )
        for i, delay in enumerate(delay_values):
            for j, decay in enumerate(decay_values):
                series_list = raw_map.get((int(delay), float(decay)), [])
                shape_pens = [
                    compute_shape_penalty(rolling_z(s.tolist(), window=z_window))
                    for s in series_list
                ]
                avg_shape = float(np.mean(shape_pens)) if shape_pens else 0.0
                avg_abs_z = abs(float(z_grid[i, j]))
                flat_pen  = 2.0 if avg_abs_z < 0.05 else 0.0
                combo = (w_dist  * float(dist_grid[i, j]) +
                         w_z     * float(z_grid[i, j])    +
                         w_shape * avg_shape               +
                         flat_pen)
                rows.append({
                    "retention": round(float(ret),   3),
                    "decay":     round(float(decay), 3),
                    "delay":     int(delay),
                    "combo":     round(combo, 4),
                    "dist":      round(float(dist_grid[i, j]), 4),
                    "z":         round(float(z_grid[i, j]),    4),
                    "shape":     round(avg_shape, 4),
                })

    if not rows:
        return {"success": False, "error": "No points computed"}

    # Rank into 11 bins: 0 = best (lowest combo), 10 = worst
    combos   = np.array([r["combo"] for r in rows])
    ranks    = rankdata(combos, method="min") - 1
    max_rank = max(ranks.max(), 1)
    rank_bins = (ranks * 10 / max_rank).astype(int)

    for r, bin_ in zip(rows, rank_bins):
        r["rank_bin"] = int(bin_)

    return {
        "success":          True,
        "points":           rows,
        "retention_values": retention_values.tolist(),
        "decay_values":     decay_values.tolist(),
        "delay_values":     delay_values.tolist(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MONTE CARLO UNCERTAINTY (Fan Chart)
# ═══════════════════════════════════════════════════════════════════════════════

def _node_fan_sigma(G, *, fan_sigma=0.25, driver_conf=0.90):
    """
    Per-node per-step process-noise std: fan_sigma * (1 - mean inbound confidence).
    Nodes with no inbound edges (exogenous drivers) use driver_conf. High-confidence
    relationships give tight bands; low-confidence relationships widen them.
    """
    sig = {}
    for n in G.nodes:
        preds = list(G.predecessors(n))
        if preds:
            cs = [float(G[p][n].get("confidence", G[p][n].get("certainty", 1.0)))
                  for p in preds]
            c = float(np.mean(cs))
        else:
            c = float(driver_conf)
        c = 0.0 if c < 0.0 else (1.0 if c > 1.0 else c)
        sig[n] = max(0.0, float(fan_sigma) * (1.0 - c))
    return sig


def simulate_two_phase_noisy(G, init_vals, steps, *, sigma_map=None, rng=None):
    """Compatibility wrapper over the canonical engine with injected noise."""
    if rng is None:
        rng = np.random.default_rng()
    if sigma_map is None:
        sigma_map = {n: 0.0 for n in G}
    return simulate_two_phase(
        G,
        init_vals,
        steps,
        noise=MultiplicativeGaussianNoise(sigma_map=sigma_map, rng=rng),
    )


def _perturb_graph_by_confidence(G_in, *, sigma_base=0.25, noise_floor=0.0, rng=None):
    """
    Resample each edge's correlation using certainty-driven logic:
      c = 1.0  → keep exact correlation (deterministic)
      c = 0.0  → Uniform[-1, 1] (total ignorance)
      0 < c < 1:
          with prob c:       keep corr unchanged
          with prob (1-c):   sample Normal(corr, sigma_base*(1-c)), clipped to [-1,1]

    `noise_floor` adds an independent Gaussian jitter to EVERY edge regardless of
    confidence. This guarantees spread across Monte Carlo runs (so bimodal outcome
    distributions can emerge) even when all edges are fully confident (c = 1.0).
    """
    if rng is None:
        rng = np.random.default_rng()
    G = G_in.copy()
    for u, v, d in G.edges(data=True):
        corr0 = float(d.get('correlation', 1.0))
        c = float(d.get('confidence', d.get('certainty', 1.0)))
        c = max(0.0, min(1.0, c))

        if c >= 1.0 - 1e-12:
            new_corr = corr0
        elif c <= 1e-12:
            new_corr = float(rng.uniform(-1.0, 1.0))
        else:
            if rng.random() < c:
                new_corr = corr0
            else:
                sigma = max(1e-6, sigma_base * (1.0 - c))
                new_corr = float(np.clip(rng.normal(loc=corr0, scale=sigma), -1.0, 1.0))

        if noise_floor > 0.0:
            new_corr = float(np.clip(new_corr + rng.normal(0.0, noise_floor), -1.0, 1.0))

        d['correlation'] = new_corr
    return G


def simulate_fan_paths(G_ref, steps, *, n_sims=200, sigma_base=0.25, noise_floor=0.0, seed=42):
    """
    Monte-Carlo envelope for node values.

    Two independent sources of variation are combined (matching the notebook) so the
    fan is non-degenerate for both leaky-stock models (driven by inbound edges) and
    formula-driven models (converters that ignore edges):
      1. each edge's 'correlation' is resampled by its confidence/certainty, and
      2. each node receives per-step multiplicative process noise whose scale is
         sigma_base * (1 - mean inbound-edge confidence).
    `noise_floor` additionally jitters every edge regardless of confidence.

    Returns dict: {node: np.ndarray(n_sims × T)}
    """
    rng = np.random.default_rng(seed)
    init_vals = {n: G_ref.nodes[n].get('start_amount', 0.0) for n in G_ref.nodes}
    sigma_map = _node_fan_sigma(G_ref, fan_sigma=sigma_base)
    paths = {n: [] for n in G_ref.nodes}

    for _ in range(n_sims):
        Gs = _perturb_graph_by_confidence(G_ref, sigma_base=sigma_base, noise_floor=noise_floor, rng=rng)
        hist = simulate_two_phase_noisy(Gs, init_vals, steps, sigma_map=sigma_map, rng=rng)
        for n in G_ref.nodes:
            arr = np.asarray([v for v in hist[n] if v is not None], dtype=float)
            paths[n].append(arr)

    return {n: np.vstack(lst) for n, lst in paths.items() if lst}


def run_fan_chart(graph_data, iterations=200, n_sims=200, sigma_base=0.25, noise_floor=0.0):
    """
    Run Monte Carlo fan chart simulation.

    Returns percentile bands (5/25/50/75/95) per node as JSON arrays,
    plus a base64 matplotlib plot.
    """
    G = build_graph_from_payload(
        graph_data,
        defaults={"start_amount": 0.0, "retention": 1.0, "decay": 0.6, "confidence": 0.8},
    )

    mc = simulate_fan_paths(G, iterations, n_sims=n_sims, sigma_base=sigma_base, noise_floor=noise_floor)
    if not mc:
        return {"success": False, "error": "All simulations failed"}

    nodes = list(G.nodes)
    percentiles = [5, 25, 50, 75, 95]
    bands = {}
    for node in nodes:
        arr = mc.get(node)
        if arr is None or arr.size == 0:
            continue
        bands[node] = {f"p{p}": np.percentile(arr, p, axis=0).tolist() for p in percentiles}

    # Build matplotlib fan chart
    n_nodes = len(nodes)
    cols = min(3, n_nodes)
    rows = math.ceil(n_nodes / cols)
    fig, axes = plt.subplots(rows, cols, figsize=(6 * cols, 4 * rows), squeeze=False)
    fig.patch.set_facecolor('#1a1a2e')

    for idx, node in enumerate(nodes):
        ax = axes[idx // cols][idx % cols]
        ax.set_facecolor('#16213e')
        if node not in bands:
            ax.set_visible(False)
            continue
        b = bands[node]
        steps_arr = np.arange(len(b['p50']))
        ax.fill_between(steps_arr, b['p5'],  b['p95'], alpha=0.15, color='#4a7cff', label='5-95%')
        ax.fill_between(steps_arr, b['p25'], b['p75'], alpha=0.30, color='#4a7cff', label='25-75%')
        ax.plot(steps_arr, b['p50'], color='#4a7cff', linewidth=2, label='Median')
        ax.set_title(node, color='#ccc', fontsize=11)
        ax.tick_params(colors='#999')
        for spine in ax.spines.values():
            spine.set_edgecolor('#444')
        ax.grid(True, alpha=0.2, color='#555')

    # Hide unused axes
    for idx in range(n_nodes, rows * cols):
        axes[idx // cols][idx % cols].set_visible(False)

    plt.suptitle(f'Fan Chart — {n_sims} Monte Carlo paths', color='#ccc', fontsize=13)
    plt.tight_layout()
    plot_b64 = plot_to_base64(fig)

    actual_sims = next(iter(mc.values())).shape[0] if mc else 0
    return {"success": True, "bands": bands, "plot": plot_b64, "n_sims": actual_sims}


# ═══════════════════════════════════════════════════════════════════════════════
# PARAMETER OPTIMIZATION
# ═══════════════════════════════════════════════════════════════════════════════

# These presets and bounds mirror the flagship notebook. Agent and optimizer
# code should depend on this canonical contract instead of maintaining another
# approximation of system health.
OPT_SCORE_PRESETS = {
    "balanced": {
        "w_dist": 0.20, "w_z": 0.15, "w_shape": 0.10, "w_beh": 0.20,
        "w_unstable": 1.00, "w_dead": 30.0, "w_drift": 8.0,
        "w_late_up": 10.0, "w_dominance": 6.0, "w_overflow": 10.0,
        "w_flatline": 12.0, "w_decay_barrier": 8.0, "w_transmission": 12.0,
        "w_terminal_weak": 18.0, "w_tail_weak": 18.0,
        "w_retention_barrier": 4.0, "w_edge_near_one": 4.0,
        "w_lam_boundary": 2.0, "w_time": 0.0,
        "P_unstable": 60.0, "P_lam": 60.0,
        "P_unconstrained": 12.0, "P_overdamped": 2.0,
    },
    "stability_first": {
        "w_dist": 0.10, "w_z": 0.10, "w_shape": 0.05, "w_beh": 0.25,
        "w_unstable": 1.50, "w_dead": 45.0, "w_drift": 12.0,
        "w_late_up": 14.0, "w_dominance": 8.0, "w_overflow": 16.0,
        "w_flatline": 15.0, "w_decay_barrier": 10.0, "w_transmission": 15.0,
        "w_terminal_weak": 24.0, "w_tail_weak": 24.0,
        "w_retention_barrier": 6.0, "w_edge_near_one": 6.0,
        "w_lam_boundary": 3.0, "w_time": 0.0,
        "P_unstable": 90.0, "P_lam": 90.0,
        "P_unconstrained": 20.0, "P_overdamped": 4.0,
    },
    "responsive": {
        "w_dist": 0.15, "w_z": 0.30, "w_shape": 0.20, "w_beh": 0.20,
        "w_unstable": 1.00, "w_dead": 20.0, "w_drift": 6.0,
        "w_late_up": 8.0, "w_dominance": 4.0, "w_overflow": 8.0,
        "w_flatline": 10.0, "w_decay_barrier": 8.0, "w_transmission": 10.0,
        "w_terminal_weak": 14.0, "w_tail_weak": 14.0,
        "w_retention_barrier": 3.0, "w_edge_near_one": 3.0,
        "w_lam_boundary": 1.5, "w_time": 0.0,
        "P_unstable": 50.0, "P_lam": 50.0,
        "P_unconstrained": 10.0, "P_overdamped": 1.0,
    },
}

OPT_DEFAULT_BOUNDS = {
    "node_retention": (0.0, 1.0),
    "edge_decay": (0.0, 1.0),
    "edge_delay": (0, 20),
    "edge_confidence": (0.0, 1.0),
    "edge_correlation": (-1.0, 1.0),
}


def _clamp(value, lower, upper):
    return min(upper, max(lower, value))


def _edge_key(source, target):
    return str(source), str(target)


def graph_state_config(graph):
    """Return the notebook's unique-config shape for an existing graph state."""

    return {
        "mode": "unique",
        "node_retention_map": {
            str(node): float(graph.nodes[node].get("retention", 0.0))
            for node in graph.nodes
        },
        "node_start_amount_map": {
            str(node): float(graph.nodes[node].get("start_amount", 0.0))
            for node in graph.nodes
        },
        "edge_decay_map": {
            _edge_key(source, target): float(data.get("decay", 0.0))
            for source, target, data in graph.edges(data=True)
        },
        "edge_delay_map": {
            _edge_key(source, target): int(data.get("delay", 0))
            for source, target, data in graph.edges(data=True)
        },
        "edge_confidence_map": {
            _edge_key(source, target): float(data.get("confidence", 1.0))
            for source, target, data in graph.edges(data=True)
        },
        "edge_correlation_map": {
            _edge_key(source, target): float(data.get("correlation", 1.0))
            for source, target, data in graph.edges(data=True)
        },
    }


def compute_runtime_linear_transition_matrix(
    graph, *, node_retention_map=None, edge_decay_map=None, passnodes=None
):
    """Build the delay-free linear spectral model of runtime propagation."""

    return runtime_linear_transition_matrix(
        graph,
        node_retention_map=node_retention_map,
        edge_decay_map=edge_decay_map,
        passnodes=set(passnodes or ()),
    )


def compute_adjacency_matrix_stability_unique(
    graph, *, node_retention_map=None, edge_decay_map=None, passnodes=None
):
    """Compatibility alias for :func:`compute_runtime_linear_transition_matrix`."""

    return compute_runtime_linear_transition_matrix(
        graph,
        node_retention_map=node_retention_map,
        edge_decay_map=edge_decay_map,
        passnodes=passnodes,
    )


def _compute_hist_stability_metrics(hist, init_vals):
    """Notebook stabilization metrics, kept independent of optimizer policy."""

    starts = np.asarray([abs(float(value)) for value in init_vals.values()], dtype=float)
    start_scale = max(1e-6, float(np.median(starts)) if starts.size else 1.0)
    dead = 0
    late_drifts = []
    total_variation = []
    standard_deviation = []
    terminal_weak = []
    tail_weak = []
    active_terminal = []
    active_tail = []
    late_up = []
    terminal_values = []
    max_abs = 0.0

    for node, series in hist.items():
        values = np.asarray([np.nan if value is None else float(value) for value in series])
        values = values[np.isfinite(values)]
        if not values.size:
            dead += 1
            terminal_weak.append(1.0)
            tail_weak.append(1.0)
            active_terminal.append(0.0)
            active_tail.append(0.0)
            late_up.append(0.0)
            terminal_values.append(0.0)
            continue

        final = float(values[-1])
        final_abs = abs(final)
        terminal_values.append(final_abs)
        dead += int(final_abs <= 1e-8)
        max_abs = max(max_abs, float(np.max(np.abs(values))))
        window = max(4, int(len(values) * 0.25))
        tail = values[-window:]
        if tail.size >= 2:
            late_drifts.append(float(np.mean(np.abs(np.diff(tail)))))
        total_variation.append(
            float(np.sum(np.abs(np.diff(values))) / start_scale) if values.size >= 2 else 0.0
        )
        standard_deviation.append(float(np.std(values) / start_scale))

        node_scale = max(1e-6, abs(float(init_vals.get(node, start_scale))))
        final_ratio = final_abs / node_scale
        tail_ratio = float(np.mean(np.abs(tail))) / node_scale
        terminal_weak.append(min(1.0, max(0.0, (0.15 - final_ratio) / 0.15)))
        tail_weak.append(min(1.0, max(0.0, (0.18 - tail_ratio) / 0.18)))
        active_terminal.append(float(final_ratio >= 0.15))
        active_tail.append(float(tail_ratio >= 0.18))

        if tail.size >= 4:
            half = max(2, tail.size // 2)
            rise = max(0.0, float(np.mean(tail[-half:]) - np.mean(tail[:half]))) / node_scale
            try:
                slope = float(np.polyfit(np.arange(tail.size), tail, 1)[0])
            except Exception:
                slope = 0.0
            slope = max(0.0, slope * max(1.0, tail.size - 1.0)) / node_scale
            late_up.append(max(rise, slope))
        else:
            late_up.append(0.0)

    count = max(1, len(hist))
    motion = 0.5 * (
        (float(np.mean(total_variation)) if total_variation else 0.0)
        + (float(np.mean(standard_deviation)) if standard_deviation else 0.0)
    )
    late_up_values = np.asarray(late_up, dtype=float)
    late_up_mean = float(np.mean(late_up_values)) if late_up_values.size else 0.0
    top_count = min(3, late_up_values.size)
    late_up_top = (
        float(np.mean(np.sort(late_up_values)[-top_count:])) if top_count else 0.0
    )
    late_up_penalty = (
        0.5 * max(0.0, (late_up_mean - 0.02) / 0.02)
        + 0.5 * max(0.0, (late_up_top - 0.05) / 0.05)
    )
    terminal_array = np.asarray(terminal_values, dtype=float)
    shares = terminal_array / max(1e-12, float(np.sum(terminal_array)))
    max_share = float(np.max(shares)) if shares.size else 0.0
    top_three_share = float(np.sum(np.sort(shares)[-min(3, shares.size):])) if shares.size else 0.0
    dominance_penalty = (
        0.5 * max(0.0, (max_share - 0.25) / 0.75)
        + 0.5 * max(0.0, (top_three_share - 0.60) / 0.40)
    )
    overflow_threshold = 100.0 * start_scale
    return {
        "alive_ratio": float((count - dead) / count),
        "dead_ratio": float(dead / count),
        "late_drift": float(np.mean(late_drifts) / start_scale) if late_drifts else 0.0,
        "late_up_mean": late_up_mean,
        "late_up_topk": late_up_top,
        "late_up_pen": late_up_penalty,
        "max_abs": max_abs,
        "overflow_pen": (
            float(math.log1p(max_abs / overflow_threshold))
            if max_abs > overflow_threshold else 0.0
        ),
        "flatline_pen": min(1.0, max(0.0, (0.05 - motion) / 0.05)),
        "motion_metric": motion,
        "terminal_weak_pen": float(np.mean(terminal_weak)) if terminal_weak else 0.0,
        "tail_weak_pen": float(np.mean(tail_weak)) if tail_weak else 0.0,
        "active_terminal_ratio": float(np.mean(active_terminal)) if active_terminal else 0.0,
        "active_tail_ratio": float(np.mean(active_tail)) if active_tail else 0.0,
        "max_terminal_share": max_share,
        "top3_terminal_share": top_three_share,
        "dominance_pen": dominance_penalty,
    }


def _compute_graph_activation_metrics(graph):
    correlations = []
    transmissions = []
    decays = []
    for _, _, data in graph.edges(data=True):
        correlation = abs(float(data.get("correlation", 1.0)))
        decay = float(data.get("decay", 0.0))
        correlations.append(correlation)
        transmissions.append(correlation * (1.0 - decay))
        decays.append(decay)
    if not correlations:
        return {
            "mean_decay": 0.0, "transmission_ratio": 1.0,
            "decay_barrier_pen": 0.0, "transmission_pen": 0.0,
            "near_one_decay_excess_mean": 0.0, "near_one_decay_frac": 0.0,
            "edge_near_one_pen": 0.0,
        }
    decay_values = np.asarray(decays, dtype=float)
    mean_decay = float(np.mean(decay_values))
    transmission_ratio = float(np.mean(transmissions)) / max(1e-12, float(np.mean(correlations)))
    transmission_ratio = float(np.clip(transmission_ratio, 0.0, 1.0))
    near_one_excess = np.clip((decay_values - 0.95) / 0.05, 0.0, None)
    near_one_mean = float(np.mean(near_one_excess))
    near_one_fraction = float(np.mean(decay_values >= 0.99))
    return {
        "mean_decay": mean_decay,
        "transmission_ratio": transmission_ratio,
        "decay_barrier_pen": float(np.clip((mean_decay - 0.90) / 0.10, 0.0, 1.0)),
        "transmission_pen": float(np.clip((0.12 - transmission_ratio) / 0.12, 0.0, 1.0)),
        "near_one_decay_excess_mean": near_one_mean,
        "near_one_decay_frac": near_one_fraction,
        "edge_near_one_pen": 0.5 * near_one_mean + 0.5 * near_one_fraction,
    }


def _compute_parameter_barrier_metrics(graph, lam_max):
    retentions = np.asarray([
        float(graph.nodes[node].get("retention", 0.0)) for node in graph.nodes
    ], dtype=float)
    if retentions.size:
        excess = np.clip((retentions - 0.95) / 0.05, 0.0, None)
        excess_mean = float(np.mean(excess))
        near_one_fraction = float(np.mean(retentions >= 0.99))
    else:
        excess_mean = 0.0
        near_one_fraction = 0.0
    return {
        "ret_excess_mean": excess_mean,
        "ret_near_one_frac": near_one_fraction,
        "retention_barrier_pen": 0.5 * excess_mean + 0.5 * near_one_fraction,
        "lam_boundary_pen": max(0.0, (float(lam_max) - 0.992) / 0.008),
    }


def score_components_to_total(components, weights):
    """Canonical notebook weighted score. Lower is healthier."""

    pairs = (
        ("w_dist", "dist"), ("w_z", "z_max"), ("w_shape", "shape_mean"),
        ("w_beh", "behavior_pen"), ("w_unstable", "unstable_pen"),
        ("w_dead", "dead_ratio"), ("w_drift", "late_drift"),
        ("w_late_up", "late_up_pen"), ("w_dominance", "dominance_pen"),
        ("w_overflow", "overflow_pen"), ("w_flatline", "flatline_pen"),
        ("w_decay_barrier", "decay_barrier_pen"),
        ("w_transmission", "transmission_pen"),
        ("w_terminal_weak", "terminal_weak_pen"),
        ("w_tail_weak", "tail_weak_pen"),
        ("w_retention_barrier", "retention_barrier_pen"),
        ("w_edge_near_one", "edge_near_one_pen"),
        ("w_lam_boundary", "lam_boundary_pen"), ("w_time", "runtime_s"),
    )
    return float(sum(
        float(weights.get(weight_name, 0.0)) * float(components.get(component_name, 0.0))
        for weight_name, component_name in pairs
    ))

def apply_config_to_graph(G_base, cfg, *, bounds=None, node_group_of=None, edge_group_of=None):
    """Apply notebook uniform/unique configs while accepting the legacy shape."""

    del node_group_of, edge_group_of  # Grouped optimization remains a notebook concern.
    bounds = bounds or OPT_DEFAULT_BOUNDS
    graph = copy.deepcopy(G_base)
    mode = cfg.get("mode")
    if mode is None:
        mode = "legacy_uniform"

    if mode in {"uniform", "legacy_uniform"}:
        retention = cfg.get("ret", cfg.get("retention"))
        decay = cfg.get("decay")
        delay = cfg.get("delay")
        for node in graph.nodes:
            if graph.nodes[node].get("formula"):
                graph.nodes[node]["retention"] = 0.0
            elif retention is not None and (
                mode == "legacy_uniform"
                or float(graph.nodes[node].get("retention", 1.0)) < 1.0 - 1e-9
            ):
                graph.nodes[node]["retention"] = _clamp(
                    float(retention), *bounds["node_retention"]
                )
        for source, target in graph.edges:
            if decay is not None:
                graph[source][target]["decay"] = _clamp(
                    float(decay), *bounds["edge_decay"]
                )
            if delay is not None:
                graph[source][target]["delay"] = int(_clamp(
                    int(delay), *bounds["edge_delay"]
                ))
        return graph

    if mode != "unique":
        raise ValueError(f"Unsupported optimizer config mode: {mode}")

    maps = {
        "retention": cfg.get("node_retention_map", {}),
        "start_amount": cfg.get("node_start_amount_map", {}),
        "decay": cfg.get("edge_decay_map", {}),
        "delay": cfg.get("edge_delay_map", {}),
        "confidence": cfg.get("edge_confidence_map", {}),
        "correlation": cfg.get("edge_correlation_map", {}),
    }
    for node in graph.nodes:
        key = str(node)
        if graph.nodes[node].get("formula"):
            graph.nodes[node]["retention"] = 0.0
        elif key in maps["retention"]:
            graph.nodes[node]["retention"] = _clamp(
                float(maps["retention"][key]), *bounds["node_retention"]
            )
        if key in maps["start_amount"]:
            graph.nodes[node]["start_amount"] = float(maps["start_amount"][key])
    for source, target in graph.edges:
        key = _edge_key(source, target)
        if key in maps["decay"]:
            graph[source][target]["decay"] = _clamp(
                float(maps["decay"][key]), *bounds["edge_decay"]
            )
        if key in maps["delay"]:
            graph[source][target]["delay"] = int(_clamp(
                int(maps["delay"][key]), *bounds["edge_delay"]
            ))
        if key in maps["confidence"]:
            graph[source][target]["confidence"] = _clamp(
                float(maps["confidence"][key]), *bounds["edge_confidence"]
            )
        if key in maps["correlation"]:
            graph[source][target]["correlation"] = _clamp(
                float(maps["correlation"][key]), *bounds["edge_correlation"]
            )
    return graph


def evaluate_config(
    G_base,
    cfg,
    *,
    steps=200,
    z_window=10,
    weights=None,
    bounds=None,
    node_group_of=None,
    edge_group_of=None,
    quiet=True,
    fast_fail_unstable=False,
):
    """Evaluate a graph with the flagship notebook's multi-component score."""

    del quiet  # Formula errors retain the simulator's established diagnostics.
    weights = weights or OPT_SCORE_PRESETS["balanced"]
    started = time.time()
    graph = apply_config_to_graph(
        G_base, cfg, bounds=bounds, node_group_of=node_group_of,
        edge_group_of=edge_group_of,
    )
    matrix, _ = compute_runtime_linear_transition_matrix(graph)
    _, dist_metric, lam_max = analyze_eigenvalues_stability(matrix)
    unstable = bool(lam_max > 1.0)
    unstable_penalty = (
        float(weights["P_unstable"] + weights["P_lam"] * max(0.0, lam_max - 1.0))
        if unstable else 0.0
    )
    activation = _compute_graph_activation_metrics(graph)
    barriers = _compute_parameter_barrier_metrics(graph, lam_max)

    if fast_fail_unstable and unstable:
        components = {
            "dist": float(dist_metric), "lam_max": float(lam_max),
            "z_max": 1e6, "shape_mean": 1e6,
            "behavior_pen": float(weights["P_unconstrained"]),
            "unstable_pen": unstable_penalty, "dead_ratio": 1.0,
            "late_drift": 1e3, "late_up_pen": 1e3,
            "dominance_pen": 1.0, "overflow_pen": 1e3,
            "flatline_pen": 0.0, "terminal_weak_pen": 1.0,
            "tail_weak_pen": 1.0, "runtime_s": time.time() - started,
            **activation, **barriers,
        }
        classifications = {}
    else:
        initial_values = {
            node: float(graph.nodes[node].get("start_amount", 0.0))
            for node in graph.nodes
        }
        history = simulate_two_phase(graph, initial_values, int(steps))
        classifications = classify_behavior(history)
        z_max = 0.0
        shape_values = []
        for series in history.values():
            clean = np.asarray([value for value in series if value is not None], dtype=float)
            if not clean.size:
                continue
            z_values = np.asarray(rolling_z(clean, window=int(z_window)), dtype=float)
            z_max = max(z_max, float(np.max(np.abs(z_values))))
            shape_values.append(float(compute_shape_penalty(z_values)))
        behavior_penalty = 0.0
        if "Unconstrained" in classifications.values():
            behavior_penalty += float(weights["P_unconstrained"])
        if "Over-damped" in classifications.values():
            behavior_penalty += float(weights["P_overdamped"])
        stability = _compute_hist_stability_metrics(history, initial_values)
        components = {
            "dist": float(dist_metric), "lam_max": float(lam_max),
            "z_max": z_max,
            "shape_mean": float(np.mean(shape_values)) if shape_values else 0.0,
            "behavior_pen": behavior_penalty,
            "unstable_pen": unstable_penalty,
            "runtime_s": time.time() - started,
            "unstable": unstable,
            "any_unconstrained": "Unconstrained" in classifications.values(),
            "any_overdamped": "Over-damped" in classifications.values(),
            **stability, **activation, **barriers,
        }

    total = score_components_to_total(components, weights)
    return {
        "total_score": float(total),
        "score": float(total),
        "config": copy.deepcopy(cfg),
        "config_snapshot": copy.deepcopy(cfg),
        "classifications": classifications,
        "components": components,
    }


def global_search_uniform(G_base, *, ret_vals=None, decay_vals=None, delay_vals=None,
                           steps=200, z_window=10, topk=5):
    """Grid search over uniform retention × decay × delay configurations."""
    if ret_vals   is None: ret_vals   = np.linspace(0.0, 1.0, 5).tolist()
    if decay_vals is None: decay_vals = np.linspace(0.0, 1.0, 5).tolist()
    if delay_vals is None: delay_vals = list(range(0, 11, 2))

    results = []
    for ret in ret_vals:
        for decay in decay_vals:
            for delay in delay_vals:
                cfg = {'retention': float(ret), 'decay': float(decay), 'delay': int(delay)}
                try:
                    results.append(evaluate_config(G_base, cfg, steps=steps, z_window=z_window))
                except Exception:
                    pass

    results.sort(key=lambda x: x['score'])
    return results[:topk]


def local_refine_unique(G_base, seed_cfg, *, steps=200, z_window=10, topk=5,
                         max_iters=150, step_ret=0.05, step_decay=0.05, step_delay=1):
    """
    Simulated annealing refinement around a seed uniform config.
    Explores the neighbourhood of the best grid-search result.
    """
    rng = np.random.default_rng(42)
    current = evaluate_config(G_base, seed_cfg, steps=steps, z_window=z_window)
    seen = [current]
    best_score = current['score']
    T = 1.0
    T_min = 0.05
    alpha = (T_min / T) ** (1 / max_iters)

    for _ in range(max_iters):
        cfg = dict(seed_cfg)
        delta_r = rng.choice([-step_ret, 0.0, step_ret])
        delta_d = rng.choice([-step_decay, 0.0, step_decay])
        delta_l = rng.choice([-step_delay, 0, step_delay])
        cfg['retention'] = float(np.clip(cfg['retention'] + delta_r, 0.0, 1.0))
        cfg['decay']     = float(np.clip(cfg['decay']     + delta_d, 0.0, 1.0))
        cfg['delay']     = int(np.clip(cfg['delay']       + delta_l, 0,   10))

        try:
            result = evaluate_config(G_base, cfg, steps=steps, z_window=z_window)
            diff = result['score'] - best_score
            if diff < 0 or rng.random() < math.exp(-diff / max(T, 1e-8)):
                seed_cfg = cfg
                best_score = result['score']
                seen.append(result)
        except Exception:
            pass
        T *= alpha

    seen.sort(key=lambda x: x['score'])
    # Deduplicate by config string
    deduped, seen_keys = [], set()
    for r in seen:
        key = str(r['config'])
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(r)
    return deduped[:topk]


def run_parameter_optimization(graph_data, ret_vals=None, decay_vals=None, delay_vals=None,
                                steps=200, max_refine_iters=150):
    """
    Two-stage parameter optimization:
      1. Global grid search over uniform configs
      2. Simulated annealing refinement around the best result

    Returns top-5 configurations with scores and classifications.
    """
    G = build_graph_from_payload(
        graph_data,
        defaults={"start_amount": 0.0, "retention": 1.0, "decay": 0.6, "confidence": 0.8},
    )

    # Resolve the sweep grids once so Stage 1 and the per-node search agree.
    _ret   = ret_vals   or np.linspace(0.0, 1.0, 5).tolist()
    _decay = decay_vals or np.linspace(0.0, 1.0, 5).tolist()
    _delay = delay_vals or list(range(0, 11, 2))

    # Stage 1: global grid search — computed ONCE and reused for both the top-5
    # ranking and the per-node search below (previously the full grid was
    # evaluated twice, which roughly doubled the runtime).
    full_grid = global_search_uniform(
        G, ret_vals=_ret, decay_vals=_decay, delay_vals=_delay,
        steps=steps, topk=len(_ret) * len(_decay) * len(_delay)
    )

    if not full_grid:
        return {"success": False, "error": "Grid search produced no results"}

    grid_results = full_grid[:3]

    # Stage 2: local refinement around best grid result
    refined = local_refine_unique(
        G, grid_results[0]['config'],
        steps=steps,
        max_iters=max_refine_iters,
        topk=5
    )

    # Merge grid + refined, re-sort, deduplicate
    combined = grid_results + refined
    combined.sort(key=lambda x: x['score'])
    deduped, seen_keys = [], set()
    for r in combined:
        key = str(r['config'])
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(r)

    top5 = deduped[:5]

    # Serialize (remove hist to keep payload small)
    serialized = []
    for rank, r in enumerate(top5, 1):
        serialized.append({
            'rank': rank,
            'score': r['score'],
            'config': r['config'],
            'classifications': r['classifications'],
            'components': r.get('components', {}),
        })

    # Per-node individual optimization:
    # For each node, find the parameter config where that node achieves "Optimal"
    # and has the lowest combined score. Uses the same grid results.
    all_grid = full_grid or grid_results

    node_best = {}
    for node_name in G.nodes:
        candidates = [r for r in all_grid if r['classifications'].get(node_name) == 'Optimal']
        if not candidates:
            candidates = all_grid  # fallback: best available
        best = min(candidates, key=lambda r: r['score'])
        node_best[node_name] = {
            'config': best['config'],
            'score': best['score'],
            'behavior': best['classifications'].get(node_name, 'Unknown'),
            'all_behaviors': best['classifications'],
        }

    return {"success": True, "top_configs": serialized, "node_best": node_best}
