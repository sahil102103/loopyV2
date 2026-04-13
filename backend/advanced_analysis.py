"""
Advanced CLD Analysis Engine
Extracted from Jupyter notebook - comprehensive two-phase simulation with stability analysis
"""

import math
import random
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

# ═══════════════════════════════════════════════════════════════════════════════
# CORE SIMULATION ENGINE (Two-Phase Propagation)
# ═══════════════════════════════════════════════════════════════════════════════

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
            return float(eval(bound, {}, ctx))
        except Exception:
            pass
    return default


def _edge_factor(e):
    """Calculate effective per-edge transfer factor."""
    corr = e.get("correlation", e.get("weight", 1.0) * e.get("polarity", 1.0))
    decay = e.get("decay", 0.0)
    return corr * (1.0 - decay)


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
    formulas = {n: G.nodes[n].get("formula") for n in converters}
    
    # Gather sink & source settings
    sink_nodes = {n: G.nodes[n].get("sink_formula") 
                  for n in G if "sink_formula" in G.nodes[n]}
    source_nodes = {n: G.nodes[n].get("source_formula") 
                    for n in G if "source_formula" in G.nodes[n]}
    
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
            nxt[v] += src_v * _edge_factor(e)
        
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
                inputs[pred] = src_v * _edge_factor(e)
            
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
        
        # Phase D: apply sink & source multipliers
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
                   retention=node_data.get('retention', 0.9),
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
                   confidence=edge_data.get('confidence', edge_data.get('certainty', 1.0)))
    
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
                   retention=node_data.get('retention', 0.9),
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
                   confidence=edge_data.get('confidence', edge_data.get('certainty', 1.0)))
    
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


def run_3d_param_space(graph_data, retention_range, decay_range, delay_range, iterations=100):
    """
    Sweep retention × decay × delay and return a flat list of scored points
    for 3D visualization on the frontend.

    Returns:
    --------
    dict with:
        points: list of {retention, decay, delay, score, behavior}
        retention_values, decay_values, delay_values
    """
    # Build base graph
    G = nx.DiGraph()
    for node_data in graph_data.get('nodes', []):
        name = node_data.get('name') or node_data.get('id') or node_data.get('label')
        if not name:
            continue
        G.add_node(name,
                   start_amount=node_data.get('start_amount', 0.1),
                   retention=node_data.get('retention', 0.9),
                   floor=node_data.get('floor', -math.inf),
                   ceiling=node_data.get('ceiling', math.inf))

    for edge_data in graph_data.get('edges', []):
        u = edge_data.get('source', edge_data.get('from', edge_data.get('src')))
        v = edge_data.get('target', edge_data.get('to', edge_data.get('tgt')))
        if u is None or v is None:
            continue
        G.add_edge(u, v,
                   correlation=edge_data.get('correlation', 1.0),
                   decay=0.0,
                   delay=0,
                   confidence=edge_data.get('confidence', edge_data.get('certainty', 1.0)))

    retention_values = np.linspace(retention_range[0], retention_range[1], int(retention_range[2]))
    decay_values     = np.linspace(decay_range[0],     decay_range[1],     int(decay_range[2]))
    delay_values     = np.linspace(delay_range[0],     delay_range[1],     int(delay_range[2]), dtype=int)

    BEHAVIOR_SCORE = {"Unconstrained": 1.0, "Optimal": 0.6, "Over-damped": 0.2}

    points = []
    for retention in retention_values:
        for decay in decay_values:
            for delay in delay_values:
                G_temp = G.copy()
                for n in G_temp.nodes:
                    G_temp.nodes[n]['retention'] = float(retention)
                nx.set_edge_attributes(G_temp, float(decay), 'decay')
                nx.set_edge_attributes(G_temp, int(delay),   'delay')

                init_vals = {n: G_temp.nodes[n]['start_amount'] for n in G_temp.nodes}
                try:
                    hist = simulate_two_phase(G_temp, init_vals, iterations)
                    classification = classify_behavior(hist)
                    behaviors = list(classification.values())
                    if "Unconstrained" in behaviors:
                        behavior, score = "Unconstrained", 1.0
                    elif "Optimal" in behaviors:
                        behavior, score = "Optimal", 0.6
                    else:
                        behavior, score = "Over-damped", 0.2
                except Exception:
                    behavior, score = "Error", 0.0

                points.append({
                    "retention": round(float(retention), 3),
                    "decay":     round(float(decay),     3),
                    "delay":     int(delay),
                    "score":     score,
                    "behavior":  behavior
                })

    return {
        "success": True,
        "points":           points,
        "retention_values": retention_values.tolist(),
        "decay_values":     decay_values.tolist(),
        "delay_values":     delay_values.tolist()
    }


