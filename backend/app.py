import os
import math
import random
import base64
import traceback
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



app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

stripe.api_key = 'sk_test_51QY9jPD0q75cxrZOPTBljKMlpDort35Y1EUIdO6GG3gqx3Bee9kOnUzvCfAnNJAjfXXhK0tcdeH4YVx8Xfm6r5So00Eal3kb6r'


# # Load variables from .env file

# app = Flask(__name__)

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

def modified_sigmoid(x):
    return 2 / (1 + math.exp(-x)) - 1

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
    classifications = {}
    for node, series in time_series_data.items():
        df = pd.DataFrame(series, columns=[node])
        z_score = calculate_rolling_z_score(df[node])
        peaks, _ = find_peaks(df[node], height=0.05, distance=10)
        avg_z = z_score.abs().mean()
        if len(peaks) > 8 and avg_z > 1.2:
            classifications[node] = "Unconstrained"
        elif 0.5 < avg_z < 1.2 and 3 <= len(peaks) <= 8:
            classifications[node] = "Optimal"
        else:
            classifications[node] = "Over-damped"
    return classifications

def stochastic_value_selection(mean, low, high, certainty):
    return blended_uniform_normal(mean, low, high, certainty, 1)[0]


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

        def calculate_rolling_z_scores(values):
            n = len(values)
            mean_t, var_t, z_scores = np.zeros(n), np.zeros(n), np.zeros(n)
            for t in range(1, n):
                delta = values[t] - mean_t[t - 1]
                mean_t[t] = mean_t[t - 1] + delta / (t + 1)
                var_t[t] = var_t[t - 1] + delta * (values[t] - mean_t[t])
                if var_t[t] > 0:
                    z_scores[t] = (values[t] - mean_t[t]) / np.sqrt(var_t[t] / t)
            return z_scores

        fig, axes = plt.subplots(len(time_series_data), 1, figsize=(10, 5 * len(time_series_data)))
        for idx, (node, values) in enumerate(time_series_data.items()):
            z_scores = calculate_rolling_z_scores(values)
            axes[idx].plot(range(start_iteration, len(z_scores)), z_scores[start_iteration:], color='red')
            axes[idx].set_title(f"Node {node}")
        plt.tight_layout()
        plt.savefig("crisis_analysis.png")
        plt.close()

        return send_file("crisis_analysis.png", mimetype='image/png')
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
        edges = data.get("edges", [])
        edge_polarities = data.get("edge_polarities", [])

        G = create_graph(edges, edge_polarities)
        cycles = list(nx.simple_cycles(G))
        node_values = {node: random.uniform(-1, 1) for node in G.nodes()}

        def simulate_node_values():
            results = {node: [] for node in G.nodes()}
            for _ in range(1000):
                random.shuffle(cycles)
                for cycle in cycles:
                    polarity = '+' if random.choice([True, False]) else '-'
                    change = random.uniform(0.5, 1) if polarity == '+' else random.uniform(-1, -0.5)
                    for node in cycle:
                        node_values[node] += change
                        node_values[node] = modified_sigmoid(node_values[node])
                for node in node_values:
                    results[node].append(node_values[node])
            return results

        results = simulate_node_values()
        plot_files = []
        os.makedirs('plots', exist_ok=True)

        for node, values in results.items():
            plt.figure()
            plt.hist(values, bins=30, alpha=0.6)
            plt.title(f"Node {node} Value Distribution")
            filename = f"plots/{node}_visual.png"
            plt.savefig(filename)
            plt.close()
            plot_files.append(filename)

        return jsonify({"plots": plot_files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/get-plot/<path:filename>', methods=['GET'])
def get_plot(filename):
    return send_file(filename, mimetype='image/png')


@app.route('/correlation-analysis', methods=['POST'])
def correlation_analysis():
    try:
        # Extract data from the request
        data = request.json
        edges = data.get("edges", [])
        time_points = data.get("time_points", 50)  # Default 50 time points

        # Ensure edges are provided
        if not edges:
            return jsonify({"error": "No edges provided for correlation analysis."}), 400

        # Create a directed graph
        G = nx.DiGraph(edges)

        # Ensure the graph has nodes
        if not G.nodes():
            return jsonify({"error": "Graph has no nodes to analyze."}), 400

        # Generate synthetic time series data for each node
        np.random.seed(0)  # For reproducibility
        node_data = {node: np.random.rand(time_points) for node in G.nodes()}

        # Create a dataframe for correlation analysis
        df = pd.DataFrame(node_data)
        correlation_matrix = df.corr()

        # Plot the heatmap
        plt.figure(figsize=(12, 8))
        sns.heatmap(correlation_matrix, annot=True, cmap='coolwarm', center=0)
        plt.title("Correlation Analysis Heatmap")
        
        # Save the plot
        output_file = "correlation_analysis.png"
        plt.savefig(output_file)
        plt.close()

        # Send the file to the frontend
        return send_file(output_file, mimetype='image/png')

    except Exception as e:
        print(f"Error in correlation-analysis: {e}")  # Log the error
        return jsonify({"error": str(e)}), 500
    

@app.route("/generate-stability-map", methods=["POST"])
def generate_stability_map():
    try:
        data = request.json
        build_graph_from_data(data)

        decay_min, decay_max, decay_steps = data["decayRange"]
        delay_min, delay_max, delay_steps = data["delayRange"]


        decay_factors = np.linspace(decay_min, decay_max, decay_steps)
        delays = np.linspace(delay_min, delay_max, delay_steps)
        pass_nodes = set(data["passNodes"])

        stability_matrix = np.zeros((len(delays), len(decay_factors)))

        for i, delay in enumerate(delays):
            for j, decay in enumerate(decay_factors):
                signal_map = {}
                time_series_data = {node: [] for node in graph.nodes}
                delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges} 
                time_series_data = simulate_signal_transfer(iterations=100, decay_factor=decay, delay=int(delay), use_delay=True)
                classification = classify_behavior(time_series_data)
                # print(classification)
                if "Unconstrained" in classification.values():
                    stability_matrix[i, j] = 1.0
                elif "Optimal" in classification.values():
                    stability_matrix[i, j] = 0.6
                elif "Over-damped" in classification.values():
                    stability_matrix[i, j] = 0.2

        if np.isnan(stability_matrix).any() or np.isinf(stability_matrix).any():
            return jsonify({"error": "Stability matrix contains invalid values."}), 500

        plt.figure(figsize=(10, 6))
        plt.imshow(
            stability_matrix, cmap="coolwarm", 
            extent=[decay_min, decay_max, delay_min, delay_max],
            origin="lower", aspect="auto",
            vmin=0.0,        # Force the minimum color scale to 0
            vmax=1.0         # Force the maximum color scale to 1
        )
        plt.colorbar(label="Stability Measure")
        plt.xlabel("Decay Factor")
        plt.ylabel("Delay")
        plt.title("Stability Map")
        file_path = "stability_map.png"
        plt.savefig(file_path)
        plt.close()

        return send_file(file_path, mimetype="image/png")
    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e)}), 500
    

@app.route("/generate-decay-retention-map", methods=["POST"])
def generate_decay_retention_map():
    try:
        data = request.json
        build_graph_from_data(data)

        decay_min, decay_max, decay_steps = data["decayRange"]
        retention_min, retention_max, retention_steps = data["retentionRange"]

        decay_factors = np.linspace(decay_min, decay_max, decay_steps)
        retentions = np.linspace(retention_min, retention_max, retention_steps)
        stability_matrix = np.zeros((len(retentions), len(decay_factors)))
        pass_nodes = set(data["passNodes"])

        for i, retention in enumerate(retentions):
            for j, decay_factor in enumerate(decay_factors):
                time_series_data = {}
                time_series_data = simulate_signal_transfer(
                    iterations=100, decay_factor=decay_factor, delay=1, use_delay=True,
                    node_retention=retention
                )
                classification = classify_behavior(time_series_data)
                if "Unconstrained" in classification.values():
                    stability_matrix[i, j] = 1.0
                elif "Optimal" in classification.values():
                    stability_matrix[i, j] = 0.6
                elif "Over-damped" in classification.values():
                    stability_matrix[i, j] = 0.2

        plt.figure(figsize=(10, 6))
        plt.imshow(
            stability_matrix, cmap="coolwarm",
            extent=[decay_min, decay_max, retention_min, retention_max],
            origin="lower", aspect="auto",
            vmin=0.0,        # Force the minimum color scale to 0
            vmax=1.0         # Force the maximum color scale to 1
        )
        plt.colorbar(label="Stability Measure")
        plt.xlabel("Decay Factor")
        plt.ylabel("Retention Parameter")
        plt.title("Decay-Retention Stability Map")
        file_path = "decay_retention_map.png"
        plt.savefig(file_path)
        plt.close()

        return send_file(file_path, mimetype="image/png")
    except Exception as e:
        error_trace = traceback.format_exc()
        print(error_trace)
        return jsonify({"error": str(e)}), 500


@app.route("/generate-retention-delay-map", methods=["POST"])
def generate_retention_delay_map():
    try:
        data = request.json
        build_graph_from_data(data)

        # Parse the ranges for retention and delay
        retention_min, retention_max, retention_steps = data["retentionRange"]
        delay_min, delay_max, delay_steps = data["delayRange"]

        # Convert passNodes list to a set
        pass_nodes = set(data.get("passNodes", []))


        # Create a grid of retention and delay values
        retentions = np.linspace(retention_min, retention_max, retention_steps)
        delays = np.linspace(delay_min, delay_max, delay_steps)

        # Initialize a 2D matrix [delay_index, retention_index]
        stability_matrix = np.zeros((len(delays), len(retentions)))

        # For each (delay, retention) pair, simulate signals and classify
        for i, d_val in enumerate(delays):
            for j, r_val in enumerate(retentions):
                global signal_map
                # Reset the signal_map and time_series_data for each simulation
                signal_map = {}
                time_series_data = {node: [] for node in graph.nodes}
                delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}  # Reset delay buffers

                # Run the local simulation
                time_series_data = simulate_signal_transfer(
                    iterations=100, decay_factor=0.9, delay=round(d_val), use_delay=True,
                    node_retention=r_val
                )
                # Classify
                classification = classify_behavior(time_series_data)

                # Assign a numeric value based on classification
                if "Unconstrained" in classification.values():
                    stability_matrix[i, j] = 1.0
                elif "Optimal" in classification.values():
                    stability_matrix[i, j] = 0.6
                else:
                    stability_matrix[i, j] = 0.2

        # Plot the resulting stability matrix
        plt.figure(figsize=(10, 6))
        plt.imshow(
            stability_matrix, cmap="coolwarm",
            extent=[retention_min, retention_max, delay_min, delay_max],
            origin="lower", aspect="auto",
            vmin=0.0,        # Force the minimum color scale to 0
            vmax=1.0         # Force the maximum color scale to 1
        )
        plt.colorbar(label="Stability Measure")
        plt.xlabel("Retention Parameter")
        plt.ylabel("Delay Parameter")
        plt.title("Retention-Delay Stability Map")

        file_path = "retention_delay_map.png"
        plt.savefig(file_path)
        plt.close()

        return send_file(file_path, mimetype="image/png")

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
        output_path = "simulation.png"
        plt.savefig(output_path)
        plt.close()

        return send_file(output_path, mimetype='image/png')
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
        edges = data.get("edges", [])
        edge_polarities = data.get("edge_polarities", [])

        if not edges or not edge_polarities:
            return jsonify({"error": "Edges and edge polarities are required"}), 400

        # Create the graph
        G = nx.DiGraph()
        for (node1, node2), polarity in zip(edges, edge_polarities):
            G.add_edge(node1, node2, polarity=polarity)

        # Simulation parameters
        num_outer_loops = 1000
        num_simulations = 100
        seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

        # Function to determine the polarity of a cycle
        def cycle_polarity(graph, cycle):
            polarity = '+'
            for i in range(len(cycle)):
                edge = (cycle[i], cycle[(i + 1) % len(cycle)])
                if graph.edges[edge]['polarity'] == '-':
                    polarity = '-' if polarity == '+' else '+'
            return polarity

        # Function to run the simulation for a given seed
        def run_simulation(seed):
            random.seed(seed)
            cycles = list(nx.simple_cycles(G))
            initial_node_values = {node: random.uniform(-1, 1) for node in G.nodes()}
            overall_results = {node: [] for node in G.nodes()}
            current_values = initial_node_values.copy()

            for _ in range(num_outer_loops):
                results = {node: [] for node in G.nodes()}
                for _ in range(num_simulations):
                    node_values = current_values.copy()
                    random.shuffle(cycles)
                    for cycle in cycles:
                        pol = cycle_polarity(G, cycle)
                        change = random.normalvariate(0.01, 0.5) if pol == '+' else random.normalvariate(-0.01, 0.5)
                        for node in cycle:
                            node_values[node] += change
                    for node in node_values:
                        results[node].append(node_values[node])
                mean_values = {node: np.mean(values) for node, values in results.items()}
                current_values = mean_values
                for node in overall_results:
                    overall_results[node].extend(results[node])
            return overall_results

        # Run simulation for each seed
        results_list = [run_simulation(seed) for seed in seeds]

        # Create plots and encode them as Base64
        def create_combined_fan_chart(results_list, node):
            plt.figure(figsize=(12, 9))
            x = range(num_outer_loops)
            colors = ['blue', 'green', 'red', 'purple', 'orange', 'cyan', 'magenta', 'yellow', 'brown', 'pink']

            for idx, results in enumerate(results_list):
                node_results = np.array(results[node])
                node_results = node_results[:num_outer_loops * num_simulations].reshape(num_outer_loops, num_simulations)
                percentiles = np.percentile(node_results, [5, 25, 50, 75, 95], axis=1)
                plt.plot(x, percentiles[2], label=f'Median (Seed {idx+1})', color=colors[idx])
                plt.fill_between(x, percentiles[1], percentiles[3], color=colors[idx], alpha=0.3)
                plt.fill_between(x, percentiles[0], percentiles[4], color=colors[idx], alpha=0.1)

            plt.xlabel('Outer Loop Iteration')
            plt.ylabel('Value')
            plt.title(f'Combined Fan Chart for {node} Node')
            plt.legend()
            plt.grid(True)

            filename = f"plots/{node}_randomSeedPlot.png"
            plt.savefig(filename)
            plt.close()
            
            # Encode the plot as Base64
            with open(filename, 'rb') as file:
                encoded = base64.b64encode(file.read()).decode('utf-8')
            return {"filename": filename, "data": encoded}

        plot_data = [create_combined_fan_chart(results_list, node) for node in G.nodes()]
        return jsonify(plot_data)

    except Exception as e:
        error_trace = traceback.format_exc()
        return jsonify({"error": str(e)}), 500
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
