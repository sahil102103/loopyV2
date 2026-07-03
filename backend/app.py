import os
import math
import random
import base64
import traceback
import re
from io import BytesIO

import numpy as np
import pandas as pd
import networkx as nx
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import stripe

from collections import defaultdict
from scipy.signal import find_peaks
from scipy.stats import norm
from sklearn.mixture import GaussianMixture
import matplotlib.colors as mcolors

from dotenv import load_dotenv
load_dotenv()

# Import advanced analysis module
from advanced_analysis import (
    run_advanced_simulation,
    run_stability_analysis,
    run_3d_param_space,
    run_fan_chart,
    run_parameter_optimization,
    simulate_two_phase,
    classify_behavior as classify_behavior_twophase,
    rolling_z as rolling_z_advanced,
    initialize_gmms,
    generate_gmm_samples
)



app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["https://loopy-v2.vercel.app", "http://127.0.0.1:5501", "http://localhost:5501", "http://127.0.0.1:3000", "http://localhost:3000"]}}, supports_credentials=True)




stripe.api_key = os.environ.get('STRIPE_API_KEY')



@app.route('/')
def index():
    # Access environment variables
    backendURL = os.environ.get('BACKEND_URL')
    db_url = os.environ.get('DATABASE_URL')
    return f"Secret Key: {backendURL}, DB URL: {db_url}"

#########################
#  Utility Functions    #
#########################

def create_graph(edges, edge_polarities):
    G = nx.DiGraph()
    for edge, polarity in zip(edges, edge_polarities):
        G.add_edge(*edge, polarity=polarity)
    return G

def blended_uniform_normal(mean, low, high, certainty, size=1000):
    max_variance = 1
    variance = (1 - certainty) * max_variance
    samples = []
    while len(samples) < size:
        uniform_sample = np.random.uniform(low, high)
        normal_sample = np.random.normal(mean, np.sqrt(variance))
        blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample
        if low <= blended_sample <= high:
            samples.append(blended_sample)
    return samples

def calculate_rolling_z_score(series, window=10):
    rolling_mean = series.rolling(window=window).mean()
    rolling_std = series.rolling(window=window).std()
    return (series - rolling_mean) / rolling_std

def classify_behavior(time_series_data):
    """Delegate to the advanced two-phase classifier for consistency."""
    return classify_behavior_twophase(time_series_data)

def stochastic_value_selection(mean, low, high, certainty):
    return blended_uniform_normal(mean, low, high, certainty, 1)[0]


def build_twophase_graph_from_legacy(data):
    """Convert legacy frontend format to a NetworkX graph for simulate_two_phase."""
    G = nx.DiGraph()
    edges = data.get('edges', [])
    weights = data.get('edgeWeights', [])
    polarities = data.get('edgePolarities', [])
    delays = data.get('edgeDelays', [])
    certainties = data.get('edgeCertainties', [])
    passnodeList = data.get('passNodes', data.get('passnodeList', []))
    floors = data.get('nodeFloors', {})
    ceilings = data.get('nodeCeilings', {})

    all_nodes = set()
    for src, tgt in edges:
        all_nodes.add(src)
        all_nodes.add(tgt)

    DEFAULT_BOUND = 1e6

    def _safe_bound(val, fallback):
        if val is None:
            return fallback
        try:
            v = float(val)
            return v if math.isfinite(v) else fallback
        except (ValueError, TypeError):
            return fallback

    for n in all_nodes:
        f = _safe_bound(floors.get(n), -DEFAULT_BOUND)
        c = _safe_bound(ceilings.get(n), DEFAULT_BOUND)
        G.add_node(n,
            start_amount=0.1,
            retention=0.0 if n in passnodeList else 1.0,
            floor=f,
            ceiling=c)

    for i, (src, tgt) in enumerate(edges):
        w = weights[i] if i < len(weights) else 1.0
        pol = polarities[i] if i < len(polarities) else 1
        if isinstance(pol, str):
            pol_sign = 1.0 if pol == '+' else -1.0
        else:
            pol_sign = 1.0 if pol > 0 else -1.0
        G.add_edge(src, tgt,
            correlation=w * pol_sign,
            decay=0.0,
            delay=delays[i] if i < len(delays) else 0,
            confidence=certainties[i] if i < len(certainties) else 1.0)

    return G


#########################
#  Global Variables     #
#########################

# Below are the previously undefined global variables.
# We'll initialize them to empty or minimal defaults here.
edges = []
edge_weights = []
edge_polarities = []
edge_delays = []
edge_certainties = []

passnodeList = []
node_floors = {}
node_ceilings = {}

graph = nx.DiGraph()
signal_map = {}
time_series_data = {}
delay_buffers = {}
passnodes = set()


@app.route('/initialize-graph', methods=['POST'])
def initialize_graph_data():
    """
    Endpoint to receive all necessary graph info from the frontend and
    populate/update the global variables by calling `build_graph_from_data`.
    """
    data = request.json
    build_graph_from_data(data)
    return jsonify({"message": "Graph initialized successfully"}), 200

def build_graph_from_data(data):
    """
    Encapsulate all the logic needed to create the graph, signal map,
    time series data, and delay buffers from a given JSON `data`.
    """
    global graph, passnodes, signal_map, time_series_data, delay_buffers
    global node_floors, node_ceilings

    # Fetch each piece of data, or default if not provided
    edges = data.get('edges', [])
    edge_weights = data.get('edgeWeights', [])
    edge_polarities = data.get('edgePolarities', [])
    edge_delays = data.get('edgeDelays', [])
    edge_certainties = data.get('edgeCertainties', [])
    passnodeList = data.get('passnodeList', [])
    node_floors = data.get('nodeFloors', {})
    node_ceilings = data.get('nodeCeilings', {})


    # Rebuild the graph from scratch
    graph = nx.DiGraph()
    for i, (source, target) in enumerate(edges):
        w = edge_weights[i] if i < len(edge_weights) else 1.0
        pol = '+' if edge_polarities[i] > 0 else '-'
        d = edge_delays[i] if i < len(edge_delays) else 0
        c = edge_certainties[i] if i < len(edge_certainties) else 1.0
        print(pol)
        
        graph.add_edge(
            source, 
            target, 
            weight=w, 
            polarity=pol, 
            delay=d, 
            certainty=c
        )

    # Build the passnodes set
    passnodes = set(passnodeList)

    # Initialize empty signal_map and time_series_data for each node
    signal_map = {}
    time_series_data = {node: [] for node in graph.nodes()}

    # Initialize delay_buffers for each edge based on the 'delay'
    delay_buffers = {
        (u, v): [0] * graph[u][v]["delay"]
        for (u, v) in graph.edges()
    }

def initialize_signal_map():
    """
    Initialize the signal map with initial values for each node.
    Nodes in 'passnodes' get 0.0; other nodes get a random value between 0 and 1.
    """
    for node in graph.nodes:
        if node in passnodes:
            signal_map[node] = 0.0
        else:
            signal_map[node] = random.uniform(0, 1)
    return signal_map

def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
    """
    Update the signal map based on incoming signals from connected nodes,
    with optional system-wide delay.
    """
    new_signal_map = defaultdict(float)
    previous_signal_map = signal_map.copy()  # Store previous values for consistency

    for edge in graph.edges(data=True):
        predecessor = edge[0]
        node = edge[1]
        edge_data = edge[2]

        weight = edge_data["weight"]
        polarity = edge_data["polarity"]
        certainty = edge_data["certainty"]
        # print("everything: ", predecessor, node, edge_data, weight, polarity, certainty)

        # Set delay based on global or edge-specific delay, only if delay is being used
        delay = global_delay if global_delay is not None else edge_data["delay"]

        if use_delay:
            # Ensure delay buffer matches the current delay value
            if len(delay_buffers[(predecessor, node)]) != delay:
                delay_buffers[(predecessor, node)] = [0] * delay

            # Pop the oldest signal from the delay buffer
            delayed_signal = delay_buffers[(predecessor, node)].pop(0)
            if polarity == '+':
                polarity = 1.0
            else:
                polarity = -1.0

            # Calculate the incoming signal with delay
            incoming_signal = delayed_signal * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)
            # Push the current signal to the delay buffer for the next cycle
            delay_buffers[(predecessor, node)].append(previous_signal_map[predecessor])
        else:
            # Skip delay and use the current signal immediately
            incoming_signal = previous_signal_map[predecessor] * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)

        # Accumulate the incoming signal to the target node
        new_signal_map[node] += incoming_signal

    # Update each node's value in signal_map after all calculations
    for node in graph.nodes():
        floor_value = node_floors.get(node, float('-inf'))
        ciel_value = node_ceilings.get(node, float('inf'))

        # Ensure floor_value and ciel_value are valid numbers
        floor_value = floor_value if floor_value is not None else float('-inf')
        ciel_value = ciel_value if ciel_value is not None else float('inf')
		
        previous_value = float(previous_signal_map[node])
        new_value = float(new_signal_map[node])
        floor_value = float(floor_value)
        ciel_value = float(ciel_value)

        if node in passnodes:
            # For passnodes, the new signal is solely based on incoming signals
            signal_map[node] = max(floor_value, min(new_value, ciel_value))
        else:
            if not node_retention:
                signal_map[node] = max(floor_value, min(previous_value * decay_factor + new_value, ciel_value))
            else:
                signal_map[node] = max(floor_value, min(previous_value * node_retention + new_value, ciel_value))

    return signal_map

def simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=None, use_delay=True, node_retention=None):
    """Simulate signal transfer for a given number of iterations, with optional global delay."""
    initialize_signal_map()
    for _ in range(iterations):
        accumulate_signals(decay_factor, global_delay=delay, use_delay=use_delay, node_retention=node_retention)
        for node in graph.nodes():
            time_series_data[node].append(signal_map[node])


    return time_series_data


#########################
#  Route Definitions    #
#########################

# Route 1: Cycle Analysis
@app.route('/cycle-analysis', methods=['POST'])
def cycle_analysis():
    try:
        data = request.json
        edges = data.get('edges', [])
        edge_polarities = data.get('edge_polarities', [])

        G = create_graph(edges, edge_polarities)
        cycles = list(nx.simple_cycles(G))

        def cycle_polarity(cycle):
            polarity = '+'
            for i in range(len(cycle)):
                edge = (cycle[i], cycle[(i + 1) % len(cycle)])
                if G.edges[edge]['polarity'] == '-':
                    polarity = '-' if polarity == '+' else '+'
            return polarity

        node_cycles = {node: {'positive': 0, 'negative': 0} for node in G.nodes}
        for cycle in cycles:
            pol = cycle_polarity(cycle)
            for node in cycle:
                node_cycles[node]['positive' if pol == '+' else 'negative'] += 1

        # Generate table as HTML
        table = "<table border='1'><tr><th>Node</th><th>Positive Cycles</th><th>Negative Cycles</th><th>Total Cycles</th></tr>"
        for node, counts in node_cycles.items():
            table += f"<tr><td>{node}</td><td>{counts['positive']}</td><td>{counts['negative']}</td><td>{counts['positive'] + counts['negative']}</td></tr>"
        table += "</table>"

        return jsonify({'table': table})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Route 2: Crisis Analysis
@app.route('/crisis-analysis', methods=['POST'])
def crisis_analysis():
    try:
        data = request.json
        time_series_data = data.get("time_series_data", {})
        start_iteration = data.get("start_iteration", 0)

        n_nodes = len(time_series_data)
        fig, axes = plt.subplots(max(n_nodes, 1), 1, figsize=(10, 5 * max(n_nodes, 1)))
        if n_nodes == 1:
            axes = [axes]
        for idx, (node, values) in enumerate(time_series_data.items()):
            z_scores = rolling_z_advanced(values, window=10).values
            axes[idx].plot(range(start_iteration, len(z_scores)), z_scores[start_iteration:], color='red')
            axes[idx].set_title(f"Node {node}")
        plt.tight_layout()
        buf = BytesIO()
        plt.savefig(buf, format='png')
        plt.close()
        buf.seek(0)
        return send_file(buf, mimetype='image/png')
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Route 3: Degree Centrality
@app.route('/degree-centrality', methods=['POST'])
def degree_centrality():
    try:
        data = request.json
        G = create_graph(data['edges'], data['edge_polarities'])

        measures = {
            "Degree Centrality": nx.degree_centrality(G),
            "Betweenness Centrality": nx.betweenness_centrality(G),
            "Closeness Centrality": nx.closeness_centrality(G),
            "Eigenvector Centrality": nx.eigenvector_centrality(G, max_iter=1000)
        }

        # Generate HTML tables
        table = ""
        for title, centrality in measures.items():
            table += f"<h3>{title}</h3><table border='1'><tr><th>Node</th><th>Centrality</th></tr>"
            for node, value in sorted(centrality.items(), key=lambda x: x[1], reverse=True):
                table += f"<tr><td>{node}</td><td>{value:.4f}</td></tr>"
            table += "</table><br>"
        return jsonify({"centrality_output": table})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Route 4: Visual Analysis
@app.route('/visual-analysis', methods=['POST'])
def visual_analysis():
    try:
        data = request.json

        G = build_twophase_graph_from_legacy(data)
        init_vals = {n: random.uniform(-1, 1) for n in G.nodes()}
        hist = simulate_two_phase(G, init_vals, 200)

        plot_images = []

        for idx, (node, values) in enumerate(hist.items()):
            clean = [float(v) for v in values if v is not None and np.isfinite(float(v))]
            if len(clean) == 0:
                clean = [0.0]
            plt.figure()
            plt.hist(clean, bins=30, alpha=0.6)
            plt.title(f"Node {node} Value Distribution")
            buf = BytesIO()
            plt.savefig(buf, format='png')
            plt.close()
            buf.seek(0)
            encoded = base64.b64encode(buf.read()).decode('utf-8')
            plot_images.append(f"data:image/png;base64,{encoded}")

        return jsonify({"plots": plot_images})
    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e), "traceback": error_trace}), 500


@app.route('/correlation-analysis', methods=['POST'])
def correlation_analysis():
    try:
        data = request.json
        time_series_data = data.get("time_series_data", {})

        if not time_series_data:
            return jsonify({"error": "No time series data provided. Please run the diagram first."}), 400

        min_len = min(len(v) for v in time_series_data.values())
        node_data = {node: values[:min_len] for node, values in time_series_data.items()}

        df = pd.DataFrame(node_data)
        correlation_matrix = df.corr()

        plt.figure(figsize=(10, 8))
        sns.heatmap(
            correlation_matrix,
            annot=True,
            fmt=".2f",
            cmap='coolwarm',
            center=0,
            vmin=-1, vmax=1,
            square=True,
            linewidths=0.5
        )
        plt.title("Correlation Analysis Heatmap")
        plt.tight_layout()

        buf = BytesIO()
        plt.savefig(buf, format='png')
        plt.close()
        buf.seek(0)
        return send_file(buf, mimetype='image/png')

    except Exception as e:
        print(f"Error in correlation-analysis: {e}")  # Log the error
        return jsonify({"error": str(e)}), 500
    

@app.route("/generate-stability-map", methods=["POST"])
def generate_stability_map():
    try:
        data = request.json
        G = build_twophase_graph_from_legacy(data)

        decay_min, decay_max, decay_steps = data["decayRange"]
        delay_min, delay_max, delay_steps = data["delayRange"]

        decay_factors = np.linspace(decay_min, decay_max, decay_steps)
        delays = np.linspace(delay_min, delay_max, delay_steps)

        stability_matrix = np.zeros((len(delays), len(decay_factors)))

        for i, delay_val in enumerate(delays):
            for j, decay_val in enumerate(decay_factors):
                G_tmp = G.copy()
                nx.set_edge_attributes(G_tmp, float(decay_val), 'decay')
                nx.set_edge_attributes(G_tmp, int(delay_val), 'delay')
                init_vals = {n: G_tmp.nodes[n]['start_amount'] for n in G_tmp.nodes}
                hist = simulate_two_phase(G_tmp, init_vals, 100)
                classification = classify_behavior(hist)
                if "Unconstrained" in classification.values():
                    stability_matrix[i, j] = 1.0
                elif "Optimal" in classification.values():
                    stability_matrix[i, j] = 0.6
                elif "Over-damped" in classification.values():
                    stability_matrix[i, j] = 0.2

        if np.isnan(stability_matrix).any() or np.isinf(stability_matrix).any():
            return jsonify({"error": "Stability matrix contains invalid values."}), 500

        return jsonify({
            "matrix": np.round(stability_matrix, 3).tolist(),
            "x": np.round(decay_factors, 4).tolist(),
            "y": np.round(delays, 4).tolist(),
            "x_label": "Decay Factor",
            "y_label": "Delay",
            "title": "Stability Map",
            "vmin": 0.0,
            "vmax": 1.0,
        })
    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e)}), 500
    

@app.route("/generate-decay-retention-map", methods=["POST"])
def generate_decay_retention_map():
    try:
        data = request.json
        G = build_twophase_graph_from_legacy(data)

        decay_min, decay_max, decay_steps = data["decayRange"]
        retention_min, retention_max, retention_steps = data["retentionRange"]

        decay_factors = np.linspace(decay_min, decay_max, decay_steps)
        retentions = np.linspace(retention_min, retention_max, retention_steps)
        stability_matrix = np.zeros((len(retentions), len(decay_factors)))

        for i, retention_val in enumerate(retentions):
            for j, decay_val in enumerate(decay_factors):
                G_tmp = G.copy()
                nx.set_edge_attributes(G_tmp, float(decay_val), 'decay')
                nx.set_edge_attributes(G_tmp, 1, 'delay')
                nx.set_node_attributes(G_tmp, float(retention_val), 'retention')
                init_vals = {n: G_tmp.nodes[n]['start_amount'] for n in G_tmp.nodes}
                hist = simulate_two_phase(G_tmp, init_vals, 100)
                classification = classify_behavior(hist)
                if "Unconstrained" in classification.values():
                    stability_matrix[i, j] = 1.0
                elif "Optimal" in classification.values():
                    stability_matrix[i, j] = 0.6
                elif "Over-damped" in classification.values():
                    stability_matrix[i, j] = 0.2

        return jsonify({
            "matrix": np.round(stability_matrix, 3).tolist(),
            "x": np.round(decay_factors, 4).tolist(),
            "y": np.round(retentions, 4).tolist(),
            "x_label": "Decay Factor",
            "y_label": "Retention Parameter",
            "title": "Decay-Retention Stability Map",
            "vmin": 0.0,
            "vmax": 1.0,
        })
    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e)}), 500


@app.route("/generate-retention-delay-map", methods=["POST"])
def generate_retention_delay_map():
    try:
        data = request.json
        G = build_twophase_graph_from_legacy(data)

        retention_min, retention_max, retention_steps = data["retentionRange"]
        delay_min, delay_max, delay_steps = data["delayRange"]

        retentions = np.linspace(retention_min, retention_max, retention_steps)
        delays = np.linspace(delay_min, delay_max, delay_steps)

        stability_matrix = np.zeros((len(delays), len(retentions)))

        for i, d_val in enumerate(delays):
            for j, r_val in enumerate(retentions):
                G_tmp = G.copy()
                nx.set_edge_attributes(G_tmp, 0.0, 'decay')
                nx.set_edge_attributes(G_tmp, int(round(d_val)), 'delay')
                nx.set_node_attributes(G_tmp, float(r_val), 'retention')
                init_vals = {n: G_tmp.nodes[n]['start_amount'] for n in G_tmp.nodes}
                hist = simulate_two_phase(G_tmp, init_vals, 100)
                classification = classify_behavior(hist)
                if "Unconstrained" in classification.values():
                    stability_matrix[i, j] = 1.0
                elif "Optimal" in classification.values():
                    stability_matrix[i, j] = 0.6
                else:
                    stability_matrix[i, j] = 0.2

        return jsonify({
            "matrix": np.round(stability_matrix, 3).tolist(),
            "x": np.round(retentions, 4).tolist(),
            "y": np.round(delays, 4).tolist(),
            "x_label": "Retention Parameter",
            "y_label": "Delay Parameter",
            "title": "Retention-Delay Stability Map",
            "vmin": 0.0,
            "vmax": 1.0,
        })

    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e)}), 500


@app.route('/create-checkout-session', methods=['POST'])
def create_checkout_session():
    try:
        data = request.json
        amount = data.get('amount', 2000)  # Default to $20.00 if not provided

        session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[
                {
                    'price_data': {
                        'currency': 'usd',
                        'product_data': {
                            'name': 'Custom Payment',
                        },
                        'unit_amount': amount,
                    },
                    'quantity': 1,
                },
            ],
            mode='payment',
            success_url='https://loopy-v2.vercel.app/v1.1/success.html',
            cancel_url='https://loopy-v2.vercel.app/v1.1/cancel.html',
        )
        return jsonify({'id': session.id})
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/simulation', methods=['POST'])
def run_simulation():
    try:
        # Log incoming data
        data = request.json.get('time_series_data')
        if not data:
            return jsonify({"error": "No time series data provided"}), 400
        if not isinstance(data, dict):  # Ensure it's a dictionary of time series
            return jsonify({"error": "Invalid data format"}), 400
        
        # Get time series data from the frontend
        data = request.json.get('time_series_data')

        if not data:
            return jsonify({"error": "No time series data provided"}), 400

        df = pd.DataFrame(data)
        np.random.seed(42)

        # Initialize GMM Parameters for each variable
        def initialize_gmms(data, n_components=2):
            gmms = {}
            for col in data.columns:
                gmm = GaussianMixture(n_components=n_components, random_state=42)
                gmm.fit(data[[col]])
                gmms[col] = gmm
            return gmms

        gmms = initialize_gmms(df)

        def calculate_peak_values_and_densities(gmm):
            peak_values_and_densities = {}
            for var, gmm_component in gmm.items():
                means = gmm_component.means_.flatten()
                covariances = gmm_component.covariances_.flatten()
                peak_density_values = [
                    (mean, norm.pdf(mean, loc=mean, scale=np.sqrt(cov)))
                    for mean, cov in zip(means, covariances)
                ]
                peak_values_and_densities[var] = peak_density_values
            return peak_values_and_densities

        gmm_peak_values_and_densities = calculate_peak_values_and_densities(gmms)

        # Generate the plots
        fig, axs = plt.subplots(len(gmm_peak_values_and_densities), 1, figsize=(10, len(gmm_peak_values_and_densities) * 5))
        for i, (variable, peaks) in enumerate(gmm_peak_values_and_densities.items()):
            ax = axs[i] if len(gmm_peak_values_and_densities) > 1 else axs
            sns.histplot(df[variable], bins=20, kde=True, ax=ax, color="skyblue", label="Data Distribution")
            for mean, density in peaks:
                ax.axvline(x=mean, color='red', linestyle='--', label=f'Peak at {mean:.2f}')
            ax.set_title(f'{variable}')
            ax.legend()

        plt.tight_layout()

        # Save the plot as an image file
        buf = BytesIO()
        plt.savefig(buf, format='png')
        plt.close()
        buf.seek(0)
        return send_file(buf, mimetype='image/png')
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        # Clean up the file after sending
        if os.path.exists("simulation.png"):
            os.remove("simulation.png")


@app.route('/simulation2', methods=['POST'])
def simulation2():
    try:
        # Get time series data from the request
        data = request.json.get('time_series_data', {})
        if not data:
            return jsonify({'error': 'No time series data provided'}), 400

        df = pd.DataFrame(data)

        # Step 1: Initialize GMMs for each variable
        def initialize_gmms(data, n_components=2):
            gmms = {}
            for col in data.columns:
                gmm = GaussianMixture(n_components=n_components, random_state=42)
                gmm.fit(data[[col]])
                gmms[col] = gmm
            return gmms

        gmms = initialize_gmms(df)

        # Step 2: Generate synthetic data
        def generate_synthetic_data(gmms, n_samples=100):
            synthetic_data = pd.DataFrame()
            for col, gmm in gmms.items():
                samples, _ = gmm.sample(n_samples)
                synthetic_data[col] = samples.flatten()
            return synthetic_data

        synthetic_data = generate_synthetic_data(gmms)

        # Step 3: Generate plots comparing original and synthetic data
        plot_data = []
        for var in df.columns:
            plt.figure()
            sns.histplot(df[var], color="skyblue", label='Original', kde=True, stat="density", linewidth=0)
            sns.histplot(synthetic_data[var], color="orange", label='Synthetic', kde=True, stat="density", linewidth=0, alpha=0.5)
            plt.title(var)
            plt.legend()

            # Save the plot to a BytesIO object
            plot_buffer = BytesIO()
            plt.savefig(plot_buffer, format='png')
            plt.close()
            plot_buffer.seek(0)

            encoded_plot = base64.b64encode(plot_buffer.getvalue()).decode('utf-8')
            plot_data.append({'variable': var, 'plot': encoded_plot})

        # Return the encoded plots
        return jsonify({'plots': plot_data})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════════════
# ADVANCED ANALYSIS ENDPOINTS (from Jupyter notebook)
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/advanced-simulation', methods=['POST'])
def advanced_simulation():
    """
    Run advanced two-phase simulation with full stability analysis.
    
    Expected JSON:
    {
        "nodes": [
            {"name": "node1", "start_amount": 0.1, "retention": 0.9, "floor": -inf, "ceiling": inf},
            ...
        ],
        "edges": [
            {"source": "node1", "target": "node2", "correlation": 0.5, "decay": 0.1, "delay": 1, "confidence": 0.8},
            ...
        ],
        "iterations": 200
    }
    
    Returns:
    {
        "time_series_data": {...},
        "classifications": {...},
        "plots": {
            "time_series": "base64...",
            "z_scores": "base64..."
        }
    }
    """
    try:
        data = request.json
        iterations = data.get('iterations', 200)
        
        result = run_advanced_simulation(data, iterations=iterations)
        return jsonify(result), 200
        
    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e), "trace": error_trace}), 500


@app.route('/advanced-stability-map', methods=['POST'])
def advanced_stability_map():
    """
    Generate advanced stability parameter space map.
    
    Expected JSON:
    {
        "nodes": [...],
        "edges": [...],
        "decay_range": [min, max, steps],
        "delay_range": [min, max, steps],
        "iterations": 200
    }
    
    Returns:
    {
        "stability_matrix": [[...]],
        "decay_values": [...],
        "delay_values": [...],
        "plot": "base64..."
    }
    """
    try:
        data = request.json
        decay_range = data.get('decay_range', [0.0, 1.0, 11])
        delay_range = data.get('delay_range', [0, 10, 11])
        iterations = data.get('iterations', 200)
        
        result = run_stability_analysis(
            data,
            decay_range=decay_range,
            delay_range=delay_range,
            iterations=iterations
        )
        return jsonify(result), 200
        
    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e), "trace": error_trace}), 500


@app.route('/param-space-3d', methods=['POST'])
def param_space_3d():
    """
    Sweep retention × decay × delay and return a point cloud for 3D visualization.

    Expected JSON:
    {
        "nodes": [...],
        "edges": [...],
        "retention_range": [min, max, steps],
        "decay_range":     [min, max, steps],
        "delay_range":     [min, max, steps],
        "iterations":      100
    }
    """
    try:
        data = request.json
        result = run_3d_param_space(
            data,
            retention_range=data.get('retention_range', [0.0, 1.0, 3]),
            decay_range=data.get('decay_range',     [0.0, 1.0, 5]),
            delay_range=data.get('delay_range',     [0,   10,  5]),
            iterations=data.get('iterations', 100)
        )
        return jsonify(result), 200
    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e), "trace": error_trace}), 500


@app.route('/boxplots', methods=['POST'])
def generate_boxplots():
    try:
        # Get time series data from the request
        data = request.json.get('time_series_data', {})
        if not data:
            return jsonify({'error': 'No time series data provided'}), 400

        df = pd.DataFrame(data)

        # Generate boxplots for each variable
        plot_data = []
        for variable in df.columns:
            plt.figure()

            # Extract data for the variable
            data_column = df[variable]

            # Calculate summary statistics
            summary_stats = data_column.describe()

            # Plot boxplot
            sns.boxplot(data=data_column, width=0.3, palette=["lightgreen"], fliersize=5)

            # Plot mean
            mean_val = data_column.mean()
            plt.scatter(x=0, y=mean_val, color='red', zorder=5, label=f'Mean: {mean_val:.2f}')

            # Standard deviation lines
            std_val = data_column.std()
            plt.axhline(y=mean_val + std_val, linestyle='--', color='purple', label=f'+Std Dev: {std_val:.2f}')
            plt.axhline(y=mean_val - std_val, linestyle='--', color='purple', label=f'-Std Dev: {std_val:.2f}')

            # Min and Max annotations
            plt.text(x=0.35, y=summary_stats['min'], s=f"Min: {summary_stats['min']:.2f}", verticalalignment='center')
            plt.text(x=0.35, y=summary_stats['max'], s=f"Max: {summary_stats['max']:.2f}", verticalalignment='center')

            plt.xticks([0], [variable])
            plt.title(variable)
            plt.legend()

            # Save the plot to a BytesIO object
            plot_buffer = BytesIO()
            plt.savefig(plot_buffer, format='png')
            plt.close()
            plot_buffer.seek(0)

            encoded_plot = base64.b64encode(plot_buffer.getvalue()).decode('utf-8')
            plot_data.append({'variable': variable, 'plot': encoded_plot})

        # Return the encoded plots
        return jsonify({'plots': plot_data})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/violinplots', methods=['POST'])
def generate_violin_plots():
    try:
        # Get time series data from the request
        data = request.json.get('time_series_data', {})
        if not data:
            return jsonify({'error': 'No time series data provided'}), 400

        df = pd.DataFrame(data)

        # Step 1: Initialize GMMs for each variable
        def initialize_gmms(data, n_components=2):
            gmms = {}
            for col in data.columns:
                gmm = GaussianMixture(n_components=n_components, random_state=42)
                gmm.fit(data[[col]])
                gmms[col] = gmm
            return gmms

        gmms = initialize_gmms(df)

        # Step 2: Generate synthetic data
        def generate_synthetic_data(gmms, n_samples=100):
            synthetic_data = pd.DataFrame()
            for col, gmm in gmms.items():
                samples, _ = gmm.sample(n_samples)
                synthetic_data[col] = samples.flatten()
            return synthetic_data

        synthetic_data = generate_synthetic_data(gmms)

        # Step 3: Generate violin plots
        plots = []

        for var in df.columns:
            plt.figure()

            # Create a DataFrame to combine original and synthetic data for violin plotting
            combined_data = pd.DataFrame({
                'Value': list(df[var]) + list(synthetic_data[var]),
                'Type': ['Original'] * len(df[var]) + ['Synthetic'] * len(synthetic_data[var])
            })

            sns.violinplot(x='Type', y='Value', data=combined_data, palette=["skyblue", "lightgreen"])
            plt.title(f'Violin Plot - {var}')

            # Save the plot to a BytesIO buffer
            buffer = BytesIO()
            plt.savefig(buffer, format='png')
            plt.close()
            buffer.seek(0)

            # Encode the plot in Base64
            encoded_plot = base64.b64encode(buffer.read()).decode('utf-8')
            plots.append({'variable': var, 'plot': encoded_plot})

        # Return the encoded plots
        return jsonify({'plots': plots})

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    

@app.route('/random-seeds', methods=['POST'])
def random_seeds():
    try:
        data = request.json
        G = build_twophase_graph_from_legacy(data)

        if G.number_of_nodes() == 0:
            return jsonify({"error": "Graph has no nodes"}), 400

        steps = 200
        seeds = list(range(1, 11))

        def _perturb_graph(G_base, sigma=0.1, seed_val=None):
            """Perturb edge correlations by a small Gaussian noise."""
            rng = random.Random(seed_val)
            G_p = G_base.copy()
            for u, v, e in G_p.edges(data=True):
                corr = e.get('correlation', 1.0)
                noise = rng.gauss(0, sigma)
                G_p[u][v]['correlation'] = corr + noise
            return G_p

        def run_seed_simulation(seed_val):
            random.seed(seed_val)
            init_vals = {n: random.uniform(0, 0.2) for n in G.nodes()}
            G_p = _perturb_graph(G, sigma=0.05, seed_val=seed_val)
            hist = simulate_two_phase(G_p, init_vals, steps)
            return hist

        results_list = [run_seed_simulation(s) for s in seeds]

        colors = ['blue', 'green', 'red', 'purple', 'orange', 'cyan', 'magenta', 'yellow', 'brown', 'pink']

        def create_combined_fan_chart(node):
            plt.figure(figsize=(12, 9))
            x = range(steps + 1)
            for idx, hist in enumerate(results_list):
                values = [v if v is not None else 0.0 for v in hist[node]]
                plt.plot(x, values, label=f'Seed {seeds[idx]}', color=colors[idx % len(colors)], alpha=0.7)
            plt.xlabel('Time Step')
            plt.ylabel('Value')
            plt.title(f'Random Seeds Fan Chart for {node}')
            plt.legend()
            plt.grid(True)

            buf = BytesIO()
            plt.savefig(buf, format='png')
            plt.close()
            buf.seek(0)
            encoded = base64.b64encode(buf.read()).decode('utf-8')
            return {"data": encoded}

        plot_data = [create_combined_fan_chart(node) for node in G.nodes()]
        return jsonify(plot_data)

    except Exception as e:
        error_trace = traceback.format_exc()
        return jsonify({"error": str(e)}), 500
@app.route('/fan-chart', methods=['POST'])
def fan_chart():
    """
    Monte Carlo fan chart — runs n_sims perturbed simulations and returns
    percentile bands (5/25/50/75/95) per node plus a matplotlib plot.

    Expected JSON:
    {
        "nodes": [...], "edges": [...],
        "iterations": 200,
        "n_sims": 200,
        "sigma_base": 0.25,
        "noise_floor": 0.0
    }
    """
    try:
        data = request.json
        result = run_fan_chart(
            data,
            iterations=data.get('iterations', 200),
            n_sims=data.get('n_sims', 200),
            sigma_base=data.get('sigma_base', 0.25),
            noise_floor=data.get('noise_floor', 0.0)
        )
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


@app.route('/optimize-parameters', methods=['POST'])
def optimize_parameters():
    """
    Two-stage parameter optimization: grid search + simulated annealing.
    Returns top-5 (retention, decay, delay) configurations by score.

    Expected JSON:
    {
        "nodes": [...], "edges": [...],
        "ret_vals": [0.0, 0.25, 0.5, 0.75, 1.0],   (optional)
        "decay_vals": [0.0, 0.25, 0.5, 0.75, 1.0], (optional)
        "delay_vals": [0, 2, 4, 6, 8, 10],          (optional)
        "iterations": 200,
        "max_refine_iters": 150
    }
    """
    try:
        data = request.json
        result = run_parameter_optimization(
            data,
            ret_vals=data.get('ret_vals'),
            decay_vals=data.get('decay_vals'),
            delay_vals=data.get('delay_vals'),
            steps=data.get('iterations', 200),
            max_refine_iters=data.get('max_refine_iters', 150)
        )
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
