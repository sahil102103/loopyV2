"""
Advanced CLD Analysis Engine
Extracted from Jupyter notebook - comprehensive two-phase simulation with stability analysis
"""

import math
import random
import re
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
from urllib.parse import unquote as _url_unquote

# ═══════════════════════════════════════════════════════════════════════════════
# CORE SIMULATION ENGINE (Two-Phase Propagation)
# ═══════════════════════════════════════════════════════════════════════════════

_PCT_HEX = re.compile(r"%[0-9A-Fa-f]{2}")


def _decode_expr(s):
    """
    Decode Loopy/fcld URL-encoded expression strings (formulas, sink/source, bounds).

    .loopy exports store expressions with percent-encoding, e.g.
        nxt%5B'Inflation'%5D   →   nxt['Inflation']
    Evaluating the encoded form makes Python parse `%5B` as modulo (`% 5`) then
    identifier `B` → SyntaxError: invalid decimal literal.

    Idempotent for already-decoded strings. Peels up to two layers because native
    FlowCLD serialize() double-encodes formula fields.
    """
    if s is None or not isinstance(s, str):
        return s
    out = s
    for _ in range(2):
        if not _PCT_HEX.search(out):
            break
        out = _url_unquote(out)
    return out


def _parse_num_or_expr(txt, fallback):
    """Parse a numeric value or expression string."""
    s = str(txt).strip()
    if s == "":
        return fallback
    try:
        return float(s)
    except ValueError:
        return s


def _eval_bound(bound, ctx, default):
    """Evaluate dynamic floor/ceiling bounds."""
    if isinstance(bound, (int, float)) and not math.isnan(bound):
        return float(bound)
    if isinstance(bound, str) and bound.strip():
        try:
            return float(eval(_decode_expr(bound), {}, ctx))
        except Exception:
            pass
    return default


def _edge_factor(e):
    """Calculate effective per-edge transfer factor."""
    corr = e.get("correlation", e.get("weight", 1.0) * e.get("polarity", 1.0))
    decay = e.get("decay", 0.0)
    return corr * (1.0 - decay)


def _apply_form(form, x):
    """
    Transform a source value through an edge's functional form before it is scaled
    by the edge factor. Every form maps 0 -> 0 so a quiescent system stays quiescent
    and the default ('linear') exactly reproduces the original additive behaviour.
    """
    if not form or form == "linear":
        return x
    if form == "tanh":            # saturating (soft clamp to ±1)
        return math.tanh(x)
    if form == "quadratic":       # sign-preserving square — accelerating influence
        return x * abs(x)
    if form == "cubic":
        return x ** 3
    if form == "relu":            # only positive influence passes
        return x if x > 0 else 0.0
    if form == "step":            # direction only (threshold at 0)
        return 1.0 if x > 0 else (-1.0 if x < 0 else 0.0)
    return x


def _edge_contribution(e, src_v):
    """Per-edge contribution: functional-form transform of the source, then scaled."""
    return _edge_factor(e) * _apply_form(e.get("functional_form", "linear"), src_v)


def simulate_two_phase(G: nx.DiGraph, init_vals: dict, steps: int):
    """
    Core two-phase propagation engine with delay awareness.
    
    Parameters:
    -----------
    G : nx.DiGraph
        Graph with node attributes: start_amount, retention, floor, ceiling
        Edge attributes: correlation, decay, delay, confidence
    init_vals : dict
        Initial values for each node
    steps : int
        Number of simulation steps
        
    Returns:
    --------
    hist : dict
        Time series history for each node
    """
    hist = {n: [init_vals.get(n, 0.0)] for n in G}
    converters = [n for n in G if G.nodes[n].get("retention", 1.0) == 0.0]
    # Decode once: .loopy / fcld formulas arrive URL-encoded (nxt%5B'x'%5D)
    formulas = {n: _decode_expr(G.nodes[n].get("formula")) for n in converters}
    
    # Gather sink & source settings
    sink_nodes = {n: _decode_expr(G.nodes[n]["sink_formula"])
                  for n in G if G.nodes[n].get("sink_formula") is not None}
    source_nodes = {n: _decode_expr(G.nodes[n]["source_formula"])
                    for n in G if G.nodes[n].get("source_formula") is not None}
    
    for t in range(steps):
        nxt = {n: 0.0 for n in G}
        
        # Phase A: retention + delayed inflows
        for n in G:
            ret = G.nodes[n].get("retention", 1.0)
            nxt[n] += ret * hist[n][t]
        
        for u, v, e in G.edges(data=True):
            delay_e = e.get("delay", 0)
            src_t = t - delay_e
            src_v = hist[u][src_t] if src_t >= 0 else 0.0
            nxt[v] += _edge_contribution(e, src_v)
        
        # Context for bound evaluation
        ctx_common = {
            "t": t,
            "history": hist,
            "raw": {k: hist[k][t] for k in G},
            "nxt": nxt,
            "math": math, "np": np,
        }
        
        # Phase B: commit stocks
        for n in G:
            ret = G.nodes[n].get("retention", 1.0)
            if ret > 0:  # stock-type node
                floor_b = _eval_bound(G.nodes[n].get("floor", -math.inf), ctx_common, -math.inf)
                ceil_b = _eval_bound(G.nodes[n].get("ceiling", math.inf), ctx_common, math.inf)
                val = float(np.clip(nxt[n], floor_b, ceil_b))
                hist[n].append(val)
            else:  # converter placeholder
                hist[n].append(None)
        
        # Phase C: evaluate converters
        for n in converters:
            inputs = {}
            for pred in G.predecessors(n):
                e = G[pred][n]
                delay_e = e.get("delay", 0)
                src_t = t + 1 - delay_e
                src_v = hist[pred][src_t] if src_t >= 0 else 0.0
                if src_v is None:
                    src_v = 0.0
                inputs[pred] = _edge_contribution(e, src_v)
            
            if formulas[n]:
                ctx = {
                    "t": t,
                    "inputs": inputs,
                    "history": hist,
                    "raw": {k: hist[k][t] for k in G},
                    "nxt": {k: hist[k][-1] for k in G},
                    "math": math, "np": np,
                }
                try:
                    val = float(eval(formulas[n], {}, ctx))
                except Exception as err:
                    print(f"⚠️ formula error @ '{n}': {err}")
                    val = hist[n][-2] if len(hist[n]) >= 2 else 0.0
            else:
                val = float(sum(inputs.values()))
            
            # Apply bounds to converters
            ctx_conv = {
                "t": t,
                "history": hist,
                "raw": {k: hist[k][t] for k in G},
                "nxt": {k: hist[k][-1] for k in G},
                "math": math, "np": np,
            }
            floor_b = _eval_bound(G.nodes[n].get("floor", -math.inf), ctx_conv, -math.inf)
            ceil_b = _eval_bound(G.nodes[n].get("ceiling", math.inf), ctx_conv, math.inf)
            hist[n][-1] = float(np.clip(val, floor_b, ceil_b))
        
        # Phase D: apply sink & source multipliers *after* updates
        # (multiplicative, matching the notebook source of truth)
        for n, expr in sink_nodes.items():
            try:
                ctx_sink = {"t": t, "x": hist[n][-1], "val": hist[n][-1],
                           "math": math, "np": np, "e": math.e}
                factor = float(eval(expr, {}, ctx_sink))
            except Exception as err:
                print(f"⚠️ sink error @ '{n}': {err} (using 1.0)")
                factor = 1.0
            hist[n][-1] *= factor

        for n, expr in source_nodes.items():
            try:
                ctx_src = {"t": t, "x": hist[n][-1], "val": hist[n][-1],
                          "math": math, "np": np, "e": math.e}
                factor = float(eval(expr, {}, ctx_src))
            except Exception as err:
                print(f"⚠️ source error @ '{n}': {err} (using 1.0)")
                factor = 1.0
            hist[n][-1] *= factor

    return hist


# ═══════════════════════════════════════════════════════════════════════════════
# STABILITY ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

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


def compute_adjacency_matrix_stability(graph, decay_factor, passnodes=None):
    """Build adjacency matrix for stability analysis."""
    if passnodes is None:
        passnodes = set()
    
    nodes = list(graph.nodes)
    idx = {n: i for i, n in enumerate(nodes)}
    A = np.zeros((len(nodes), len(nodes)))
    
    retention = 1.0 - decay_factor
    for n in nodes:
        A[idx[n], idx[n]] = 0.0 if n in passnodes else retention
    
    for u, v, d in graph.edges(data=True):
        corr = d.get("correlation", 1.0)
        A[idx[v], idx[u]] += decay_factor * corr
    
    return A, nodes


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
        A, _ = compute_adjacency_matrix_stability(G, float(decay))
        _, dist_metric, _ = analyze_eigenvalues_stability(A)
        if dist_metric < DIST_TOL:
            stable_distances.append(dist_metric)
    penalty_metric = max(stable_distances) + 0.1 if stable_distances else 1.0

    # Pass 2 — eigenvalue dist + signal simulation
    for i, delay in enumerate(delays):
        for j, decay in enumerate(decay_vals):
            A, _ = compute_adjacency_matrix_stability(G, float(decay))
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
    # Build NetworkX graph
    G = nx.DiGraph()
    
    # Add nodes
    for node_data in graph_data.get('nodes', []):
        name = node_data.get('name') or node_data.get('id') or node_data.get('label')
        if not name:
            continue
        G.add_node(name,
                   start_amount=node_data.get('start_amount', 0.1),
                   retention=0.0 if node_data.get('pass') else node_data.get('retention', 0.9),
                   floor=node_data.get('floor', -math.inf),
                   ceiling=node_data.get('ceiling', math.inf),
                   formula=node_data.get('formula'),
                   sink_formula=node_data.get('sink_formula', node_data.get('sinkFormula')),
                   source_formula=node_data.get('source_formula', node_data.get('sourceFormula')))

    # Add edges
    for edge_data in graph_data.get('edges', []):
        u = edge_data.get('source', edge_data.get('from', edge_data.get('src')))
        v = edge_data.get('target', edge_data.get('to', edge_data.get('tgt')))
        if u is None or v is None:
            continue
        G.add_edge(u, v,
                   correlation=edge_data.get('correlation', 1.0),
                   decay=edge_data.get('decay', 0.0),
                   delay=edge_data.get('delay', 0),
                   confidence=edge_data.get('confidence', edge_data.get('certainty', 1.0)),
                   functional_form=edge_data.get('functional_form', 'linear'))
    
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
    # Build graph
    G = nx.DiGraph()
    for node_data in graph_data.get('nodes', []):
        name = node_data.get('name') or node_data.get('id') or node_data.get('label')
        if not name:
            continue
        G.add_node(name,
                   start_amount=node_data.get('start_amount', 0.1),
                   retention=0.0 if node_data.get('pass') else node_data.get('retention', 0.9),
                   floor=node_data.get('floor', -math.inf),
                   ceiling=node_data.get('ceiling', math.inf),
                   formula=node_data.get('formula'),
                   sink_formula=node_data.get('sink_formula', node_data.get('sinkFormula')),
                   source_formula=node_data.get('source_formula', node_data.get('sourceFormula')))

    for edge_data in graph_data.get('edges', []):
        u = edge_data.get('source', edge_data.get('from', edge_data.get('src')))
        v = edge_data.get('target', edge_data.get('to', edge_data.get('tgt')))
        if u is None or v is None:
            continue
        G.add_edge(u, v,
                   correlation=edge_data.get('correlation', 1.0),
                   decay=0.0,  # Will be varied
                   delay=0,    # Will be varied
                   confidence=edge_data.get('confidence', edge_data.get('certainty', 1.0)),
                   functional_form=edge_data.get('functional_form', 'linear'))
    
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
    G = nx.DiGraph()
    for node_data in graph_data.get('nodes', []):
        name = node_data.get('name') or node_data.get('id') or node_data.get('label')
        if not name:
            continue
        G.add_node(name,
                   start_amount=node_data.get('start_amount', 0.1),
                   retention=0.0 if node_data.get('pass') else node_data.get('retention', 0.9),
                   floor=node_data.get('floor', -math.inf),
                   ceiling=node_data.get('ceiling', math.inf),
                   formula=node_data.get('formula'),
                   sink_formula=node_data.get('sink_formula'),
                   source_formula=node_data.get('source_formula'))
    for edge_data in graph_data.get('edges', []):
        u = edge_data.get('source', edge_data.get('from', edge_data.get('src')))
        v = edge_data.get('target', edge_data.get('to', edge_data.get('tgt')))
        if u is None or v is None:
            continue
        G.add_edge(u, v,
                   correlation=edge_data.get('correlation', 1.0),
                   decay=edge_data.get('decay', 0.0),
                   delay=0,
                   confidence=edge_data.get('confidence', edge_data.get('certainty', 1.0)),
                   functional_form=edge_data.get('functional_form', 'linear'))

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
    """
    Faithful copy of simulate_two_phase with one addition: after each node's value
    is committed it is multiplied by (1 + N(0, sigma_map[n])), so the shock enters
    the next step's raw[]/nxt[] context and propagates through the formulas. This is
    what gives formula-driven (converter) nodes real spread in the fan chart, since
    converters ignore edge perturbations. Delay handling, functional forms, dynamic
    bounds and multiplicative sink/source are unchanged from simulate_two_phase.
    """
    if rng is None:
        rng = np.random.default_rng()
    if sigma_map is None:
        sigma_map = {n: 0.0 for n in G}

    def _shock(n):
        s = sigma_map.get(n, 0.0)
        return (1.0 + float(rng.normal(0.0, s))) if s > 0.0 else 1.0

    hist = {n: [init_vals.get(n, 0.0)] for n in G}
    converters = [n for n in G if G.nodes[n].get("retention", 1.0) == 0.0]
    formulas = {n: _decode_expr(G.nodes[n].get("formula")) for n in converters}
    sink_nodes = {n: _decode_expr(G.nodes[n]["sink_formula"])
                  for n in G if G.nodes[n].get("sink_formula") is not None}
    source_nodes = {n: _decode_expr(G.nodes[n]["source_formula"])
                    for n in G if G.nodes[n].get("source_formula") is not None}

    for t in range(steps):
        nxt = {n: 0.0 for n in G}
        for n in G:
            ret = G.nodes[n].get("retention", 1.0)
            nxt[n] += ret * hist[n][t]
        for u, v, e in G.edges(data=True):
            delay_e = e.get("delay", 0)
            src_t = t - delay_e
            src_v = hist[u][src_t] if src_t >= 0 else 0.0
            nxt[v] += _edge_contribution(e, src_v)

        ctx_common = {"t": t, "history": hist, "raw": {k: hist[k][t] for k in G},
                      "nxt": nxt, "math": math, "np": np}

        # Phase B — stocks get noise then clip
        for n in G:
            ret = G.nodes[n].get("retention", 1.0)
            if ret > 0:
                floor_b = _eval_bound(G.nodes[n].get("floor", -math.inf), ctx_common, -math.inf)
                ceil_b = _eval_bound(G.nodes[n].get("ceiling", math.inf), ctx_common, math.inf)
                val = float(nxt[n]) * _shock(n)
                hist[n].append(float(np.clip(val, floor_b, ceil_b)))
            else:
                hist[n].append(None)

        # Phase C — converters: eval formula, apply noise, then clip
        for n in converters:
            inputs = {}
            for pred in G.predecessors(n):
                e = G[pred][n]
                delay_e = e.get("delay", 0)
                src_t = t + 1 - delay_e
                src_v = hist[pred][src_t] if src_t >= 0 else 0.0
                if src_v is None:
                    src_v = 0.0
                inputs[pred] = _edge_contribution(e, src_v)

            if formulas[n]:
                ctx = {"t": t, "inputs": inputs, "history": hist,
                       "raw": {k: hist[k][t] for k in G},
                       "nxt": {k: hist[k][-1] for k in G},
                       "math": math, "np": np}
                try:
                    val = float(eval(formulas[n], {}, ctx))
                except Exception as err:
                    print(f"⚠️ formula error @ '{n}': {err}")
                    val = hist[n][-2] if len(hist[n]) >= 2 else 0.0
            else:
                val = float(sum(inputs.values()))

            val *= _shock(n)
            ctx_conv = {"t": t, "history": hist, "raw": {k: hist[k][t] for k in G},
                        "nxt": {k: hist[k][-1] for k in G}, "math": math, "np": np}
            floor_b = _eval_bound(G.nodes[n].get("floor", -math.inf), ctx_conv, -math.inf)
            ceil_b = _eval_bound(G.nodes[n].get("ceiling", math.inf), ctx_conv, math.inf)
            hist[n][-1] = float(np.clip(val, floor_b, ceil_b))

        # Phase D — multiplicative sink/source (matches simulate_two_phase)
        for n, expr in sink_nodes.items():
            try:
                factor = float(eval(expr, {}, {"t": t, "x": hist[n][-1], "val": hist[n][-1],
                                               "math": math, "np": np, "e": math.e}))
            except Exception:
                factor = 1.0
            hist[n][-1] *= factor
        for n, expr in source_nodes.items():
            try:
                factor = float(eval(expr, {}, {"t": t, "x": hist[n][-1], "val": hist[n][-1],
                                               "math": math, "np": np, "e": math.e}))
            except Exception:
                factor = 1.0
            hist[n][-1] *= factor

    return hist


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
    G = nx.DiGraph()
    for node_data in graph_data.get('nodes', []):
        name = node_data.get('name') or node_data.get('id') or node_data.get('label')
        if not name:
            continue
        G.add_node(name,
                   start_amount=node_data.get('start_amount', 0.0),
                   retention=0.0 if node_data.get('pass') else node_data.get('retention', 1.0),
                   floor=node_data.get('floor', -math.inf),
                   ceiling=node_data.get('ceiling', math.inf),
                   formula=node_data.get('formula'),
                   sink_formula=node_data.get('sink_formula'),
                   source_formula=node_data.get('source_formula'))
    for edge_data in graph_data.get('edges', []):
        u = edge_data.get('source', edge_data.get('from'))
        v = edge_data.get('target', edge_data.get('to'))
        if u is None or v is None:
            continue
        G.add_edge(u, v,
                   correlation=edge_data.get('correlation', 1.0),
                   decay=edge_data.get('decay', 0.6),
                   delay=edge_data.get('delay', 0),
                   confidence=edge_data.get('confidence', 0.8),
                   functional_form=edge_data.get('functional_form', 'linear'))

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

def apply_config_to_graph(G_base, cfg):
    """Apply a uniform config {retention, decay, delay} to a copy of the graph."""
    G = G_base.copy()
    for n in G.nodes:
        G.nodes[n]['retention'] = float(cfg.get('retention', G.nodes[n].get('retention', 1.0)))
    for u, v in G.edges:
        G[u][v]['decay'] = float(cfg.get('decay', G[u][v].get('decay', 0.6)))
        G[u][v]['delay'] = int(cfg.get('delay', G[u][v].get('delay', 0)))
    return G


def evaluate_config(G_base, cfg, *, steps=200, z_window=10):
    """
    Score a parameter configuration. Lower score = better.

    Components:
      overdamped_ratio  — fraction of nodes that converge to zero (penalty: mild)
      unconstrained_pen — fraction of nodes that diverge (penalty: severe)
      z_stability       — mean rolling-Z magnitude (reward for staying near 0)
    """
    G = apply_config_to_graph(G_base, cfg)
    init_vals = {n: G.nodes[n].get('start_amount', 0.0) for n in G.nodes}
    hist = simulate_two_phase(G, init_vals, steps)
    classifications = classify_behavior(hist)

    n_total = max(len(classifications), 1)
    n_over = sum(1 for c in classifications.values() if c == 'Over-damped')
    n_unc  = sum(1 for c in classifications.values() if c == 'Unconstrained')

    z_scores = []
    for node, series in hist.items():
        clean = [v for v in series if v is not None]
        if len(clean) > z_window:
            z_scores.append(float(np.mean(np.abs(rolling_z(clean, z_window)))))

    z_pen = np.mean(z_scores) if z_scores else 1.0

    score = (n_over * 0.3 + n_unc * 1.0) / n_total + min(z_pen * 0.1, 0.3)

    return {
        'score': round(score, 4),
        'config': cfg,
        'classifications': classifications,
        'components': {
            'overdamped_ratio':   round(n_over / n_total, 3),
            'unconstrained_ratio': round(n_unc  / n_total, 3),
            'z_stability':        round(z_pen, 3),
        }
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
    G = nx.DiGraph()
    for node_data in graph_data.get('nodes', []):
        name = node_data.get('name') or node_data.get('id') or node_data.get('label')
        if not name:
            continue
        G.add_node(name,
                   start_amount=node_data.get('start_amount', 0.0),
                   retention=0.0 if node_data.get('pass') else node_data.get('retention', 1.0),
                   floor=node_data.get('floor', -math.inf),
                   ceiling=node_data.get('ceiling', math.inf))
    for edge_data in graph_data.get('edges', []):
        u = edge_data.get('source', edge_data.get('from'))
        v = edge_data.get('target', edge_data.get('to'))
        if u is None or v is None:
            continue
        G.add_edge(u, v,
                   correlation=edge_data.get('correlation', 1.0),
                   decay=edge_data.get('decay', 0.6),
                   delay=edge_data.get('delay', 0),
                   confidence=edge_data.get('confidence', 0.8),
                   functional_form=edge_data.get('functional_form', 'linear'))

    if not G.nodes:
        return {"success": False, "error": "Empty graph"}

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
