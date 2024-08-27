// async function loadAndExecutePythonScript(){
// 	let pyodide = await loadPyodide();
// 	await pyodide.loadPackage("micropip");
// 	const micropip = pyodide.pyimport("micropip");
// 	await micropip.install(
// 		[
// 			'numpy', 
// 			'pandas', 
// 			// 'igraph', 
// 			'networkx', 
// 			// 'scipy', 
// 			'scikit-learn', 
// 			'seaborn', 
// 			'matplotlib', 
// 			// 'statsmodels', 
// 			// 'os'
// 		]
// 	)

// 	pyodide.runPython(`
// 	# import igraph as ig
// 	import numpy as np
// 	import pandas as pd
// 	import networkx as nx
// 	from scipy.optimize import minimize
// 	import random
// 	# from collections import Counter
// 	# from itertools import combinations
// 	# from scipy.stats import multivariate_normal
// 	from sklearn.mixture import GaussianMixture
// 	# from sklearn.cluster import KMeans
// 	# from sklearn.metrics import silhouette_score
// 	import seaborn as sns
// 	import matplotlib.pyplot as plt
// 	# from sklearn.decomposition import PCA
// 	# from scipy.cluster.hierarchy import dendrogram, linkage
// 	# from sklearn.cluster import DBSCAN
// 	# from sklearn.ensemble import RandomForestRegressor
// 	# from sklearn.metrics import mean_squared_error
// 	# from sklearn.linear_model import Lasso
// 	# from sklearn.svm import SVC
// 	# from sklearn.model_selection import train_test_split
// 	# from scipy.spatial.distance import pdist
// 	# from scipy.cluster.hierarchy import cophenet
// 	# from sklearn.preprocessing import StandardScaler
// 	# from sklearn.model_selection import GridSearchCV
// 	# from sklearn.pipeline import Pipeline
// 	# from sklearn.metrics import roc_curve, auc
// 	# from scipy.signal import find_peaks
// 	from scipy.stats import norm
// 	# import statsmodels.api as sm
// 	from pathlib import Path
// 	import warnings
// 	import math
// 	# import matplotlib.colors as mcolors
// 	# from scipy.stats import zscore
// 	warnings.filterwarnings("ignore")
// 	`);

// 	if (selectedNodes.length == 0) {
//         loopy.model.nodes.forEach(node => {
 
//         })
//     } else {
//         selectedNodes.forEach(node => {

//         })
//     }
	
// 	pyodide.runPython(`
// 	edges = []
	
// 	edge_polarities = []

// 	variables = []

// 	G = nx.DiGraph()

// 	`);

// 	let edgePairs = [];
// 	let edgePolarities = [];
// 	let duplicateLabels = [];
// 	let variables = [];

// 	const delay = ms => new Promise(res => setTimeout(res, ms));

// 	const delayNodeAdding = async (from, to, label) => {
// 		await delay(2);
// 		const index = edgePairs.findIndex(pair => pair[0] === from.label && pair[1] === to.label);
// 		if (index !== -1 && edgePolarities[index] !== label) {
// 			edgePolarities[index] = label;
// 		}
// 	};

// 	let edgeNodesPairs = [];

// 	const addEdgeNodePair = (from, to) => {
// 		const edgeNodePair = [[from.id, from.label], [to.id, to.label]];
// 		edgeNodesPairs.push(edgeNodePair);
// 	};

// 	const findDuplicateLabels = () => {
// 		const labelMap = new Map();
// 		edgeNodesPairs.forEach(pair => {
// 			pair.forEach(node => {
// 				const [id, label] = node;
// 				if (labelMap.has(label)) {
// 					const existingIds = labelMap.get(label);
// 					if (!existingIds.includes(id)) {
// 						duplicateLabels.push(label);
// 						existingIds.push(id);
// 					}
// 				} else {
// 					labelMap.set(label, [id]);
// 				}
// 			});
// 		});
// 	};

// 	const loadInitialData = async() => {
// 		// Iterate through each edge in the loopy model
// 		variables = []

// 		// THIS MIGHT BREAK IF YOU HAVE 2 OF THE SAME NAMED NODES FOR SIMULATION TAB
// 		loopy.model.nodes.forEach(node => {   
// 			variables.push(node.label)
// 		})
// 		loopy.model.edges.forEach(edge => {
// 			const node1 = edge.from;
// 			const node2 = edge.to;
	
// 			// Add the nodes connected by this edge to the edgeNodesPairs array
// 			addEdgeNodePair(node1, node2);
	
// 			// Perform the 'something' logic for each edge
// 			delayNodeAdding(node1, node2, edge.label);
	
// 			// Check for duplicate edge pairs
// 			const edgePair = [node1.label, node2.label];
// 			if (!edgePairs.some(pair => pair[0] === edgePair[0] && pair[1] === edgePair[1])) {
// 				edgePairs.push(edgePair);
// 				edgePolarities.push(edge.label);
// 			}
// 		});
	
// 		// Find and log duplicate labels
// 		findDuplicateLabels();
	
// 		pyodide.globals.set("edges", edgePairs);
// 		pyodide.globals.set("edge_polarities", edgePolarities);
// 		pyodide.globals.set("variables", variables)
// 	};




// 	document.getElementById('crisisAnalysisTab').onclick = async () => {
// 		await loadInitialData();

// 		pyodide.runPython(`
// overall_results = {node: [] for node in G.nodes()}

// crisisAnalysisPlots = []

// G = nx.DiGraph()
// for (node1, node2), polarity in zip(edges, edge_polarities):
// 	G.add_edge(node1, node2, polarity=polarity)

// # Find all simple cycles in the graph
// cycles = list(nx.simple_cycles(G))

// baseline_value = 0
// # Dictionary to hold the results
// overall_results = {node: [] for node in G.nodes()}

// # Number of outer loops and inner simulations
// num_outer_loops = 300
// num_simulations = 10

// initial_node_values = {node: random.uniform(-1, 1) for node in G.nodes()}

// # Start with initial values
// current_values = initial_node_values.copy()

// def apply_changes_with_reversion(node_values, cycle):
// 	for i in range(len(cycle)):
// 		node1 = cycle[i]
// 		node2 = cycle[(i + 1) % len(cycle)]
// 		polarity = G.edges[node1, node2]['polarity']
		
// 		# Compute the random influence
// 		if polarity == '+':
// 			influence = random.normalvariate(0.1, 0.05)  # Positive influence
// 		else:
// 			influence = random.normalvariate(-0.1, 0.05)  # Negative influence
		
// 		# Calculate the difference from the baseline
// 		difference = baseline_value - node_values[node2]
		
// 		# Apply the mean reversion component
// 		reversion = 0.05 * difference
		
// 		# Apply the total change
// 		node_values[node2] += influence + reversion

// # Run multiple outer loops
// for outer_loop in range(num_outer_loops):
// 	results = {node: [] for node in G.nodes()}
// 	# Run the simulation loops
// 	for _ in range(num_simulations):
// 		node_values = current_values.copy()  # Start with current values
// 		random.shuffle(cycles)  # Shuffle cycles randomly each time
// 		for cycle in cycles:
// 			apply_changes_with_reversion(node_values, cycle)
// 		for node in node_values:
// 			results[node].append(node_values[node])  # Store results after each simulation
// 	# Calculate the mean values for each node
// 	mean_values = {node: np.mean(values) for node, values in results.items()}
// 	# Use the mean values as the starting point for the next outer loop
// 	current_values = mean_values.copy()
// 	# Append the results of the current outer loop to the overall results
// 	for node in overall_results:
// 		overall_results[node].extend(results[node])


// # Function to calculate rolling standardized z-score
// def calculate_rolling_z_scores(values):
// 	rolling_mean = np.array([np.mean(values[:i + 1]) for i in range(len(values))])
// 	rolling_std = np.array([np.std(values[:i + 1]) for i in range(len(values))])
// 	z_scores = (values - rolling_mean) / rolling_std
// 	return z_scores

// # Function to detrend data for linear time
// def detrend(values):
// 	x = np.arange(len(values))
// 	coeffs = np.polyfit(x, values, 1)
// 	trend = np.polyval(coeffs, x)
// 	detrended_values = values - trend
// 	return detrended_values

// def plot_rolling_z_scores(node, results, num_outer_loops, num_simulations, start_iteration=10):
// 	node_results = np.array(results[node])

// 	# Calculate percentiles for each outer loop
// 	percentiles = np.percentile(node_results.reshape(num_outer_loops, num_simulations), [5, 25, 50, 75, 95], axis=1)

// 	# Calculate rolling z-scores
// 	mean_values = percentiles[2]
// 	detrended_values = detrend(mean_values)
// 	z_scores = calculate_rolling_z_scores(detrended_values)

// 	# Plot only after the start_iteration
// 	z_scores_to_plot = z_scores[start_iteration:]
// 	x = range(start_iteration, len(z_scores))
// 	plt.figure(figsize=(12, 6))

// 	# Plot the rolling z-scores
// 	plt.plot(x, z_scores_to_plot, label='Rolling Z-Score', color='red')

// 	# Customize the plot
// 	plt.xlabel('Outer Loop Iteration')
// 	plt.ylabel('Z-Score')
// 	plt.title(f'Rolling Z-Scores for {node} Node (after iteration {start_iteration})')
// 	legend = plt.legend()
// 	plt.grid(True)
// 	plt.savefig(f"{node}_crisisAnalysisPlot.png")
// 	crisisAnalysisPlots.append(f"{node}_crisisAnalysisPlot.png")


// # Compute the average results across all seeds
// # average_results = compute_average_results(results_list, num_outer_loops)

// # Create the average fan chart for each node
// for node in G.nodes():
//     plot_rolling_z_scores(node, overall_results, num_outer_loops, num_simulations)

// 		`);


// 	document.getElementById('cycleAnalysisTab').onclick = async() => {
// 		await loadInitialData();
// 		pyodide.runPython(`
// 			edge_polarities = edge_polarities.to_py()
// 			edges = edges.to_py()
	
// 			for (node1, node2), polarity in zip(edges, edge_polarities):
// 				G.add_edge(node1, node2, polarity=polarity)
	
// 			cycles = list(nx.simple_cycles(G))
	
// 			def cycle_polarity(cycle):
// 				polarity = '+'
// 				for i in range(len(cycle)):
// 					edge = (cycle[i], cycle[(i + 1) % len(cycle)])
// 					actual_polarity = str(G.edges[edge]['polarity'])
// 					if (actual_polarity == "–"):
// 						polarity = '–' if polarity == '+' else '+'
// 				return polarity
	
// 			node_cycles = {node: {'positive': 0, 'negative': 0} for node in G.nodes}
// 			for cycle in cycles:
// 				pol = cycle_polarity(cycle)
// 				for node in cycle:
// 					if pol == '+':
// 						node_cycles[node]['positive'] += 1
// 					else:
// 						node_cycles[node]['negative'] += 1
	
// 			max_node_length = max([len(node) for node in G.nodes]) + 2
	
// 			header = f"<tr><th>{'Node'.ljust(max_node_length)}</th><th>{'Positive Cycles'.rjust(15)}</th><th>{'Negative Cycles'.rjust(15)}</th><th>{'Total Cycles'.rjust(15)}</th></tr>"
// 			table_rows = [header]
	
// 			for node, counts in node_cycles.items():
// 				total = counts['positive'] + counts['negative']
// 				row = f"<tr><td>{node.ljust(max_node_length)}</td><td>{str(counts['positive']).rjust(15)}</td><td>{str(counts['negative']).rjust(15)}</td><td>{str(total).rjust(15)}</td></tr>"
// 				table_rows.append(row)
	
// 			table = "".join(table_rows)
// 		`);

// 		document.getElementById("cycleTable").innerHTML = pyodide.globals.get('table');

// 		const duplicateNodesWithEdgesWarningId = document.getElementById("duplicateNodesWithEdgesWarning");
// 		duplicateNodesWithEdgesWarningId.innerHTML = 'Duplicate Nodes: ';
// 		duplicateLabels.forEach(label => {
// 			duplicateNodesWithEdgesWarningId.innerHTML += `<span>${label}; </span>`;
// 		});
	
// 		openPage('CycleAnalysis');
// 	};

// 	document.getElementById('degreeCentralityTab').onclick = async() => {
// 		await loadInitialData();
	
// 		pyodide.runPython(`
// 			def create_graph(edges, edge_polarities):
// 				G = nx.DiGraph()
// 				for edge, polarity in zip(edges, edge_polarities):
// 					G.add_edge(*edge, polarity=polarity)
// 				return G

// 			def plot_graph(G):
// 				plt.figure(figsize=(15, 10))
// 				pos = nx.spring_layout(G, k=0.15, iterations=20)
// 				edge_colors = ['green' if G[u][v]['polarity'] == '+' else 'red' for u, v in G.edges()]
// 				nx.draw(G, pos, with_labels=True, node_color='lightblue', node_size=3000, edge_color=edge_colors, font_size=10, arrowsize=20)
// 				plt.show()

// 			def calculate_centrality_measures(G):
// 				measures = {
// 					"Degree Centrality": nx.degree_centrality(G),
// 					"Betweenness Centrality": nx.betweenness_centrality(G),
// 					"Closeness Centrality": nx.closeness_centrality(G),
// 					"Eigenvector Centrality": nx.eigenvector_centrality(G, max_iter=1000)
// 				}
// 				return measures

// 			def centrality_table_to_html(title, centrality_dict):
// 				output = f"<h3>{title}</h3>"
// 				output += "<table border='1' cellpadding='5'><tr><th>Node</th><th>Centrality</th></tr>"
// 				sorted_centralities = sorted(centrality_dict.items(), key=lambda x: x[1], reverse=True)
// 				for node, centrality in sorted_centralities:
// 					output += f"<tr><td>{node}</td><td>{centrality:.4f}</td></tr>"
// 				output += "</table><br>"
// 				return output

// 			def main(G):
// 				centrality_output = ""
// 				centrality_measures = calculate_centrality_measures(G)
// 				for title, centrality_dict in centrality_measures.items():
// 					centrality_output += centrality_table_to_html(title, centrality_dict)
// 				return centrality_output

// 			G = create_graph(edges, edge_polarities)
// 			centrality_output = main(G)
// 		`);
// 		document.getElementById("centralityTable").innerHTML = pyodide.globals.get('centrality_output');
	
// 		openPage('DegreeCentrality');
// 	};

// 	document.getElementById('visualAnalysisTab').onclick = async() => {
// 		await loadInitialData();
// 		pyodide.runPython(`
// 			def initialize_graph_and_simulate():
// 				random.seed(42)
// 				G = nx.DiGraph()
// 				for (node1, node2), polarity in zip(edges, edge_polarities):
// 					G.add_edge(node1, node2, polarity=polarity)
// 				cycles = list(nx.simple_cycles(G))
// 				initial_node_values = {node: random.uniform(-1, 1) for node in G.nodes()}
// 				results = simulate_network(G, cycles, initial_node_values)
// 				return results

// 			def simulate_network(G, cycles, initial_node_values):
// 				results = {node: [] for node in G.nodes()}
// 				for _ in range(1000):
// 					node_values = initial_node_values.copy()
// 					random.shuffle(cycles)
// 					for cycle in cycles:
// 						polarity = cycle_polarity(G, cycle)
// 						change = random.uniform(0.5, 1) if polarity == '+' else random.uniform(-1, -0.5)
// 						for node in cycle:
// 							node_values[node] += change
// 							node_values[node] = modified_sigmoid(node_values[node])
// 					for node in node_values:
// 						results[node].append(node_values[node])
// 				return results

// 			def cycle_polarity(G, cycle):
// 				polarity = '+'
// 				for i in range(len(cycle)):
// 					edge = (cycle[i], cycle[(i + 1) % len(cycle)])
// 					if G.edges[edge]['polarity'] == '-':
// 						polarity = '-' if polarity == '+' else '+'
// 				return polarity

// 			def modified_sigmoid(x):
// 				return 2 / (1 + math.exp(-x)) - 1

// 			def plot_results_for_all_nodes(results):
// 				visualAnalysisPlots = []

// 				for node, data in results.items():
// 					data = np.array(data).reshape(-1, 1)
// 					gmm = GaussianMixture(n_components=2, random_state=0)
// 					gmm.fit(data)
// 					x = np.linspace(data.min(), data.max(), 1000)
// 					pdf = np.exp(gmm.score_samples(x.reshape(-1, 1)))
// 					responsibilities = gmm.predict_proba(x.reshape(-1, 1))
// 					pdf_individual = responsibilities * pdf[:, np.newaxis]

// 					plt.figure()
// 					plt.hist(data, bins=30, density=True, alpha=0.6, color='gray', label=f'Histogram of {node}')
// 					plt.plot(x, pdf, '-k', label='Overall PDF')
// 					plt.fill_between(x, pdf_individual[:, 0].flatten(), alpha=0.5, color='red', label='Component 1 PDF')
// 					plt.fill_between(x, pdf_individual[:, 1].flatten(), alpha=0.5, color='blue', label='Component 2 PDF')
// 					plt.xlabel('Values')
// 					plt.ylabel('Density')
// 					plt.title(f'Bimodal GMM Fit for {node}')
// 					plt.legend()
// 					plt.savefig(f"{node}_plot.png")
// 					visualAnalysisPlots.append(f"{node}_plot.png")
// 				return visualAnalysisPlots

// 			results = initialize_graph_and_simulate()
// 			visualAnalysisPlots = plot_results_for_all_nodes(results)
// 		`);

// 		const visualAnalysisPlots = pyodide.globals.get('visualAnalysisPlots').toJs();
// 		const plotsContainer = document.getElementById('visualAnalysisPlots');
// 		plotsContainer.innerHTML = '';

// 		// displayPlots()
// 		visualAnalysisPlots.forEach(plot => {
// 			let file = pyodide.FS.readFile(plot, { encoding: 'binary' });
// 			let blob = new Blob([file], { type: 'image/png' });
// 			let url = URL.createObjectURL(blob);
			
// 			const img = document.createElement('img');
// 			img.src = url;
// 			plotsContainer.appendChild(img);
// 		});
	
// 		openPage('VisualAnalysis');
// 	}
	
// 		const crisisAnalysisPlots = pyodide.globals.get('crisisAnalysisPlots').toJs();
// 		const crisisAnalysisPlotsContainer = document.getElementById('crisisAnalysisPlots');
// 		crisisAnalysisPlotsContainer.innerHTML = '';
// 		crisisAnalysisPlots.forEach(plot => {
// 			let file = pyodide.FS.readFile(plot, { encoding: 'binary' });
// 			let blob = new Blob([file], { type: 'image/png' });
// 			let url = URL.createObjectURL(blob);
			
// 			const img = document.createElement('img');
// 			img.src = url;
// 			crisisAnalysisPlotsContainer.appendChild(img);
// 		});
	
// 		openPage('CrisisAnalysis');
// 	}

	
// 	document.getElementById('simulationTab').onclick = async() => {
// 		await loadInitialData();
// 		pyodide.runPython(`
// simulationPlot = ''
// # Generate example data for each variable
// np.random.seed(42)
// data = pd.DataFrame({var: np.random.rand(100) for var in variables})

// def initialize_gmms(data, n_components=2):
//     gmms = {}
//     for col in data.columns:
//         gmm = GaussianMixture(n_components=n_components, random_state=42)
//         gmm.fit(data[[col]])
//         gmms[col] = gmm
//     return gmms

// gmms = initialize_gmms(data)


// # Initialize GMM Parameters for each variable
// def initialize_gmms(data, n_components=2):
//     gmms = {}
//     for col in data.columns:
//         gmm = GaussianMixture(n_components=n_components, random_state=42)
//         gmm.fit(data[[col]])
//         gmms[col] = gmm
//     return gmms

// gmms = initialize_gmms(data)

// def calculate_peak_values_and_densities(gmm):
//     peak_values_and_densities = {}
//     for var, gmm_component in gmm.items():
//         # Extracting the means and covariances for each component
//         means = gmm_component.means_.flatten()
//         covariances = gmm_component.covariances_.flatten()
        
//         # Calculating the peak value (probability density) for each component
//         peak_density_values = []
//         for mean, cov in zip(means, covariances):
//             # Calculate the probability density at the mean, which is the peak density for a Gaussian distribution
//             peak_density = norm.pdf(mean, loc=mean, scale=np.sqrt(cov))
//             peak_density_values.append((mean, peak_density))
            
//         peak_values_and_densities[var] = peak_density_values
//     return peak_values_and_densities

// # Calculate the peak density values and their corresponding x-axis values for each GMM component
// gmm_peak_values_and_densities = calculate_peak_values_and_densities(gmms)

// # Corrected variable for visualization
// fig, axs = plt.subplots(len(gmm_peak_values_and_densities), 1, figsize=(10, len(gmm_peak_values_and_densities) * 5))

// for i, (variable, peaks) in enumerate(gmm_peak_values_and_densities.items()):
//     ax = axs[i] if len(gmm_peak_values_and_densities) > 1 else axs
    
//     # Plot synthetic data for comparison (if available) or original data to visualize distribution
//     sns.histplot(data[variable], bins=20, kde=True, ax=ax, color="skyblue", label="Data Distribution")
    
//     # Mark peaks on the plot
//     for mean, density in peaks:
//         ax.axvline(x=mean, color='red', linestyle='--', label=f'Peak at {mean:.2f}')
    
//     ax.set_title(f'{variable}')
//     ax.legend()
    
// # Calculate the peak differences for each variable
// peak_differences = {}
// for variable, peaks in gmm_peak_values_and_densities.items():
//     if len(peaks) > 1:
//         # Assuming there are at least two peaks, calculate the difference between the first two peaks' x-values (means)
//         diff = abs(peaks[0][0] - peaks[1][0])
//         peak_differences[variable] = diff
//     else:
//         # If there's only one peak (or none), set the difference to None or 0
//         peak_differences[variable] = None

// plt.tight_layout()
// plt.savefig("simulation.png")
// simulationPlot = "simulation.png"

//     `);

//     const simulationPlots = pyodide.globals.get('simulationPlot');
//     const plotsContainer = document.getElementById('simulationPlots');
//     plotsContainer.innerHTML = '';

// 	let file = pyodide.FS.readFile(simulationPlots, { encoding: 'binary' });
// 	let blob = new Blob([file], { type: 'image/png' });
// 	let url = URL.createObjectURL(blob);

// 	const img = document.createElement('img');
// 	img.src = url;
// 	plotsContainer.appendChild(img);
	


//     openPage('Simulation1');
// }

// document.getElementById('simulation2Tab').onclick = async() => {
// 	await loadInitialData();
// 	pyodide.runPython(`
// np.random.seed(42)
// data = pd.DataFrame({var: np.random.rand(100) for var in variables})

// def initialize_gmms(data, n_components=2):
//     gmms = {}
//     for col in data.columns:
//         gmm = GaussianMixture(n_components=n_components, random_state=42)
//         gmm.fit(data[[col]])
//         gmms[col] = gmm
//     return gmms

// gmms = initialize_gmms(data)


// #Generate Synthetic Data
// def generate_synthetic_data(gmms, n_samples=100):
// 	synthetic_data = pd.DataFrame()
// 	for col, gmm in gmms.items():
// 		samples, _ = gmm.sample(n_samples)
// 		synthetic_data[col] = samples.flatten()
// 	return synthetic_data


// #Concatenate the GMM means into a single one-dimensional array
// initial_gmm_params = np.concatenate([gmm.means_.flatten() for gmm in gmms.values()])

// synthetic_data = generate_synthetic_data(gmms)

// def simulation2results():
// 	simulation2Plots = []
// 	for i, var in enumerate(variables, 1):
// 		plt.figure()  # Adjust the size of the entire plot grid
// 		sns.histplot(data[var], color="skyblue", label='Original', kde=True, stat="density", linewidth=0)
// 		sns.histplot(synthetic_data[var], color="orange", label='Synthetic', kde=True, stat="density", linewidth=0, alpha=0.5)
// 		plt.title(var)
// 		legend = plt.legend()
// 		plt.savefig(f"{var}_simulation2.png")
// 		simulation2Plots.append(f"{var}_simulation2.png")
// 	return simulation2Plots


// simulation2Plots = simulation2results()
// `);

// const simulation2Plots = pyodide.globals.get('simulation2Plots').toJs();
// const plotsContainer = document.getElementById('simulationPlots2');
// plotsContainer.innerHTML = '';

// console.log(simulation2Plots)
// simulation2Plots.forEach(node => {
// 	let file = pyodide.FS.readFile(node, { encoding: 'binary' });
// 	let blob = new Blob([file], { type: 'image/png' });
// 	let url = URL.createObjectURL(blob);
	
// 	const img = document.createElement('img');
// 	img.src = url;
// 	plotsContainer.appendChild(img);
// })


// openPage('Simulation2');
// }


// document.getElementById('boxPlotTab').onclick = async() => {
// 	await loadInitialData();
// 	pyodide.runPython(`
// boxplots = []

// np.random.seed(42)
// data = pd.DataFrame({var: np.random.rand(100) for var in variables})

// def initialize_gmms(data, n_components=2):
//     gmms = {}
//     for col in data.columns:
//         gmm = GaussianMixture(n_components=n_components, random_state=42)
//         gmm.fit(data[[col]])
//         gmms[col] = gmm
//     return gmms

// gmms = initialize_gmms(data)

// # Generate Synthetic Data
// def generate_synthetic_data(gmms, n_samples=100):
// 	synthetic_data = pd.DataFrame()
// 	for col, gmm in gmms.items():
// 		samples, _ = gmm.sample(n_samples)
// 		synthetic_data[col] = samples.flatten()
// 	return synthetic_data

// # Concatenate the GMM means into a single one-dimensional array
// initial_gmm_params = np.concatenate([gmm.means_.flatten() for gmm in gmms.values()])

// synthetic_data = generate_synthetic_data(gmms)


// def plotresultsforboxplots():
// 	boxplots = []
// 	for i, variable in enumerate(variables, 1):
// 		plt.figure()
// 		data_column = data[variable]
		
// 		# Calculate summary statistics
// 		summary_stats = data_column.describe()
		
// 		# Plot boxplot
// 		sns.boxplot(data=data_column, width=0.3, palette=["lightgreen"], fliersize=5)
		
// 		# Plot mean
// 		mean_val = data_column.mean()
// 		plt.scatter(x=0, y=mean_val, color='red', zorder=5, label=f'Mean: {mean_val:.2f}')
		
// 		# Standard deviation lines
// 		std_val = data_column.std()
// 		plt.axhline(y=mean_val + std_val, linestyle='--', color='purple', label=f'+Std Dev: {std_val:.2f}')
// 		plt.axhline(y=mean_val - std_val, linestyle='--', color='purple', label=f'-Std Dev: {std_val:.2f}')
		
// 		# Min and Max annotations
// 		plt.text(x=0.35, y=summary_stats['min'], s=f"Min: {summary_stats['min']:.2f}", verticalalignment='center')
// 		plt.text(x=0.35, y=summary_stats['max'], s=f"Max: {summary_stats['max']:.2f}", verticalalignment='center')
		
// 		plt.xticks([0], [variable])
// 		plt.title(variable)
// 		plt.legend()
// 		plt.savefig(f"{variable}_boxPlot.png")
// 		boxplots.append(f"{variable}_boxPlot.png")
// 	return boxplots

// boxplots = plotresultsforboxplots()

// `);

// const boxPlots = pyodide.globals.get('boxplots').toJs();
// const plotsContainer = document.getElementById('boxPlots');
// plotsContainer.innerHTML = '';

// console.log(boxPlots)
// boxPlots.forEach(node => {
// 	let file = pyodide.FS.readFile(node, { encoding: 'binary' });
// 	let blob = new Blob([file], { type: 'image/png' });
// 	let url = URL.createObjectURL(blob);
	
// 	const img = document.createElement('img');
// 	img.src = url;
// 	plotsContainer.appendChild(img);
// })



// openPage('BoxPlot');
// }




// document.getElementById('violinPlotTab').onclick = async() => {
// 	await loadInitialData();
// 	pyodide.runPython(`

// violinplots = []

// np.random.seed(42)
// data = pd.DataFrame({var: np.random.rand(100) for var in variables})

// def initialize_gmms(data, n_components=2):
//     gmms = {}
//     for col in data.columns:
//         gmm = GaussianMixture(n_components=n_components, random_state=42)
//         gmm.fit(data[[col]])
//         gmms[col] = gmm
//     return gmms

// gmms = initialize_gmms(data)

// # Generate Synthetic Data
// def generate_synthetic_data(gmms, n_samples=100):
// 	synthetic_data = pd.DataFrame()
// 	for col, gmm in gmms.items():
// 		samples, _ = gmm.sample(n_samples)
// 		synthetic_data[col] = samples.flatten()
// 	return synthetic_data


// # Concatenate the GMM means into a single one-dimensional array
// initial_gmm_params = np.concatenate([gmm.means_.flatten() for gmm in gmms.values()])

// synthetic_data = generate_synthetic_data(gmms)


// def violinplotforallnodes():
// 	violinplots = []
// 	for i, var in enumerate(variables, 1):
// 		plt.figure()  # Adjust figure size as necessary
// 		sns.violinplot(data=[data[var], synthetic_data[var]], palette=["skyblue", "lightgreen"])
// 		plt.xticks([0, 1], ['Original', 'Synthetic'])
// 		plt.title(var)
// 		plt.savefig(f"{var}_violinPlot.png")
// 		violinplots.append(f"{var}_violinPlot.png")

// 	return violinplots


// violinplots = violinplotforallnodes()
// `);

// const violinPlots = pyodide.globals.get('violinplots');
// const plotsContainer = document.getElementById('violinPlots');
// plotsContainer.innerHTML = '';

// console.log(violinPlots)

// violinPlots.forEach(node => {
// 	let file = pyodide.FS.readFile(node, { encoding: 'binary' });
// 	let blob = new Blob([file], { type: 'image/png' });
// 	let url = URL.createObjectURL(blob);
	
// 	const img = document.createElement('img');
// 	img.src = url;
// 	plotsContainer.appendChild(img);
// })


// openPage('ViolinPlot');
// }



// 	document.getElementById('randomSeedsTab').onclick = async() => {
// 		await loadInitialData();
// 		pyodide.runPython(`
// G = nx.DiGraph()
// for (node1, node2), polarity in zip(edges, edge_polarities):
// 	G.add_edge(node1, node2, polarity=polarity)
// randomSeedCharts = []

// overall_results = {node: [] for node in G.nodes()}

// # Number of outer loops
// num_outer_loops = 1000

// # Number of inner simulations per loop
// num_simulations = 100

// # Function to create the directed graph
// def create_graph():
//     G = nx.DiGraph()
//     for (node1, node2), polarity in zip(edges, edge_polarities):
//         G.add_edge(node1, node2, polarity=polarity)
//     return G

// # Function to determine the polarity of a cycle
// def cycle_polarity(G, cycle):
//     polarity = '+'
//     for i in range(len(cycle)):
//         edge = (cycle[i], cycle[(i + 1) % len(cycle)])
//         if G.edges[edge]['polarity'] == '-':
//             polarity = '-' if polarity == '+' else '+'
//     return polarity

// # Function to run the simulation for a given seed
// def run_simulation(seed):
// 	random.seed(seed)
// 	G = create_graph()
// 	cycles = list(nx.simple_cycles(G))
// 	initial_node_values = {node: random.uniform(-1, 1) for node in G.nodes()}
// 	overall_results = {node: [] for node in G.nodes()}
// 	num_outer_loops = 1000
// 	num_simulations = 100
// 	current_values = initial_node_values

// 	for outer_loop in range(num_outer_loops):
// 		results = {node: [] for node in G.nodes()}
// 		for _ in range(num_simulations):
// 			node_values = current_values.copy()
// 			random.shuffle(cycles)
// 			for cycle in cycles:
// 				pol = cycle_polarity(G, cycle)
// 				if pol == '+':
// 					change = random.normalvariate(0.01, 0.5)
// 				else:
// 					change = random.normalvariate(-0.01, 0.5)
// 				for node in cycle:
// 					node_values[node] += change
// 			for node in node_values:
// 				results[node].append(node_values[node])
// 		mean_values = {node: np.mean(values) for node, values in results.items()}
// 		current_values = mean_values
// 		for node in overall_results:
// 			overall_results[node].extend(results[node])
// 	return overall_results

// # Function to create the combined fan chart
// def create_combined_fan_chart(results_list, node, num_outer_loops, num_simulations):
// 	plt.figure(figsize=(12, 9))
// 	x = range(num_outer_loops)
// 	colors = ['blue', 'green', 'red', 'purple', 'orange', 'cyan', 'magenta', 'yellow', 'brown', 'pink']
// 	for idx, results in enumerate(results_list):
// 		node_results = np.array(results[node])
// 		percentiles = np.percentile(node_results.reshape(num_outer_loops, num_simulations), [5, 25, 50, 75, 95], axis=1)
// 		plt.plot(x, percentiles[2], label=f'Median (Seed {idx+1})', color=colors[idx])
// 		plt.fill_between(x, percentiles[1], percentiles[3], color=colors[idx], alpha=0.3, label=f'25th-75th percentile (Seed {idx+1})')
// 		plt.fill_between(x, percentiles[0], percentiles[4], color=colors[idx], alpha=0.1, label=f'5th-95th percentile (Seed {idx+1})')
// 	# Customize the plot
// 	plt.xlabel('Outer Loop Iteration')
// 	plt.ylabel('Value')
// 	plt.title(f'Combined Fan Chart for {node} Node')
// 	plt.legend()
// 	plt.grid(True)
// 	plt.savefig(f"{node}_randomSeedPlot.png")
// 	randomSeedCharts.append(f"{node}_randomSeedPlot.png")

// # Run the simulation for 5 different seeds and store the results
// seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
// results_list = [run_simulation(seed) for seed in seeds]

// # Create the combined fan chart for each node
// for node in G.nodes():
// 	create_combined_fan_chart(results_list, node, num_outer_loops, num_simulations)

//     `);

//     const randomSeedsPlots = pyodide.globals.get('randomSeedCharts').toJs();
//     const plotsContainer = document.getElementById('randomSeedsPlots');
//     plotsContainer.innerHTML = '';

//     randomSeedsPlots.forEach(plot => {
//         let file = pyodide.FS.readFile(plot, { encoding: 'binary' });
//         let blob = new Blob([file], { type: 'image/png' });
//         let url = URL.createObjectURL(blob);

//         const img = document.createElement('img');
//         img.src = url;
//         plotsContainer.appendChild(img);
//     });

//     openPage('RandomSeeds');
// }


// 	document.getElementById('correlationTab').onclick = async() => {
// 		await loadInitialData();
// 		pyodide.runPython(`
// plt.figure()

// G = nx.DiGraph(edges)
// correlationPlot = ''

// # Initialize all nodes with a baseline value (e.g., 1)
// for node in G.nodes():
// 	G.nodes[node]['value'] = 1

// # Random seed for reproducibility
// np.random.seed(0)

// # Assume a hypothetical dataset for each node in the graph
// time_points = 50  # Number of time points or observations
// data = {node: np.random.rand(time_points) for node in G.nodes()}
// df = pd.DataFrame(data)

// correlation_matrix = df.corr()

// # Generate a heatmap using seaborn
// heatmap = sns.heatmap(correlation_matrix, annot=True, cmap='coolwarm', center=0)
// plt.savefig("corr.png")
// correlationPlot = "corr.png"
//     `);

//     const correlationPlot = pyodide.globals.get('correlationPlot');
//     const plotsContainer = document.getElementById('correlationPlot');
//     plotsContainer.innerHTML = '';

//     let file = pyodide.FS.readFile(correlationPlot, { encoding: 'binary' });
//     let blob = new Blob([file], { type: 'image/png' });
//     let url = URL.createObjectURL(blob);

//     const img = document.createElement('img');
//     img.src = url;
//     plotsContainer.appendChild(img);

//     openPage('Correlation');
// }

// }
