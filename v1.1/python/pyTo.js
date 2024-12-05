async function loadAndExecutePythonScript(){
	const spinner = document.getElementById('loadingIndicator');
	const loadPythonPackages = document.getElementById('loadPythonPackages');
	const toDisplayWhenPyPackagesLoaded = document.getElementsByClassName('hidden');
	// Select all elements within the dropdown that have the 'hidden' class
	const hiddenElements = document.querySelectorAll('.dropdown.hidden, .dropdown.hidden *');


	function showLoadingSpinner() {
		document.getElementById('loading-spinner').style.display = 'block';
	}
	
	// Function to hide the loading spinner
	function hideLoadingSpinner() {
		document.getElementById('loading-spinner').style.display = 'none';
	}

	// Show spinner
	spinner.style.display = 'block';
	let pyodide = await loadPyodide();
	await pyodide.loadPackage("micropip");
	const micropip = pyodide.pyimport("micropip");
	await micropip.install(
		[
			'numpy', 
			'pandas', 
			// 'igraph', 
			'networkx', 
			'scipy', 
			'scikit-learn', 
			'seaborn', 
			'matplotlib', 
			// 'statsmodels', 
			// 'os'
		]
	)

	try {
		pyodide.runPython(`
			from collections import defaultdict
			import numpy as np
			import pandas as pd
			import networkx as nx
			from scipy.optimize import minimize
			import random
			# from collections import Counter
			# from itertools import combinations
			# from scipy.stats import multivariate_normal
			from sklearn.mixture import GaussianMixture
			# from sklearn.cluster import KMeans
			# from sklearn.metrics import silhouette_score
			import seaborn as sns
			import matplotlib.pyplot as plt
			# from sklearn.decomposition import PCA
			# from scipy.cluster.hierarchy import dendrogram, linkage
			# from sklearn.cluster import DBSCAN
			# from sklearn.ensemble import RandomForestRegressor
			# from sklearn.metrics import mean_squared_error
			# from sklearn.linear_model import Lasso
			# from sklearn.svm import SVC
			# from sklearn.model_selection import train_test_split
			# from scipy.spatial.distance import pdist
			# from scipy.cluster.hierarchy import cophenet
			# from sklearn.preprocessing import StandardScaler
			# from sklearn.model_selection import GridSearchCV
			# from sklearn.pipeline import Pipeline
			# from sklearn.metrics import roc_curve, auc
			from scipy.signal import find_peaks
			from scipy.stats import norm
			# import statsmodels.api as sm
			from pathlib import Path
			import warnings
			import math
			import matplotlib.colors as mcolors
			# from scipy.stats import zscore
			warnings.filterwarnings("ignore")
			`);
		
		
		pyodide.runPython(`
		edges = []
		edge_polarities = []
		edge_weights = []
		edge_delays = []
		edge_certainties = []
		time_series_data = {}
		variables = []
		G = nx.DiGraph()
		`);


		for (let i = 0; i < toDisplayWhenPyPackagesLoaded.length; i++) {
        	toDisplayWhenPyPackagesLoaded[i].classList.remove('hidden');
    	}
		// Remove the 'hidden' class from each selected element
		hiddenElements.forEach(element => {
			element.classList.remove('hidden');
		});

	} catch (error){
		console.error(error)
	}
	finally {
        // Hide spinner when the process completes or fails
		// researchTabs.classList.remove('hidden');
        spinner.style.display = 'none';
		loadPythonPackages.style.display = 'none';
	}



// We will use these dataset arrays along with time series data from other files
let edgePairs = [];
let edgePolarities = [];
let edgeWeights = [];
let edgeDelays = [];
let edgeCertainties = [];
let duplicateLabels = [];
let variables = [];
let timeSeriesData = {}


const delay = ms => new Promise(res => setTimeout(res, ms));

const delayNodeAdding = async (from, to, label) => {
    await delay(2);
    const index = edgePairs.findIndex(pair => pair[0] === from.label && pair[1] === to.label);
    if (index !== -1 && edgePolarities[index] !== label) {
        edgePolarities[index] = label;
    }
};

let edgeNodesPairs = [];

const addEdgeNodePair = (from, to) => {
    const edgeNodePair = [[from.id, from.label], [to.id, to.label]];
    edgeNodesPairs.push(edgeNodePair);
};

const findDuplicateLabels = () => {
    const labelMap = new Map();
    edgeNodesPairs.forEach(pair => {
        pair.forEach(node => {
            const [id, label] = node;
            if (labelMap.has(label)) {
                const existingIds = labelMap.get(label);
                if (!existingIds.includes(id)) {
                    duplicateLabels.push(label);
                    existingIds.push(id);
                }
            } else {
                labelMap.set(label, [id]);
            }
        });
    });
};

const loadInitialData = async () => {
    variables = [];

	timeSeriesData = chart.data.datasets.reduce((acc, dataset) => {
		acc[dataset.label] = [...dataset.data];
		return acc
	}, {})

    // Filter nodes and edges based on whether selectedNodes is populated
    const nodesToInclude = loopy.multipleselect.getSelectedNodes().length > 0 ? 
        loopy.model.nodes.filter(node => loopy.multipleselect.getSelectedNodes().includes(node.label)) : 
        loopy.model.nodes;

    const edgesToInclude = loopy.multipleselect.getSelectedNodes().length > 0 ? 
        loopy.model.edges.filter(edge => 
            loopy.multipleselect.getSelectedNodes().includes(edge.from.label) && loopy.multipleselect.getSelectedNodes().includes(edge.to.label)
        ) : 
        loopy.model.edges;

    nodesToInclude.forEach(node => {
        variables.push(node.label);
    });

    edgesToInclude.forEach(edge => {
        const node1 = edge.from;
        const node2 = edge.to;

        // Add the nodes connected by this edge to the edgeNodesPairs array, along with all of the attributes
        addEdgeNodePair(node1, node2);
		edgeWeights.push(edge.damper);
		edgeDelays.push(edge.lag);
		edgeCertainties.push(edge.confidence);


        // Perform the 'something' logic for each edge
        delayNodeAdding(node1, node2, edge.label);

        // Check for duplicate edge pairs
        const edgePair = [node1.label, node2.label];
        if (!edgePairs.some(pair => pair[0] === edgePair[0] && pair[1] === edgePair[1])) {
            edgePairs.push(edgePair);
            edgePolarities.push(edge.label);
        }
    });

    // Find and log duplicate labels
    findDuplicateLabels();

    pyodide.globals.set("edges", edgePairs);
    pyodide.globals.set("edge_polarities", edgePolarities);
    pyodide.globals.set("variables", variables);
	pyodide.globals.set("edge_weights", edgeWeights);
	pyodide.globals.set("edge_delays", edgeDelays);
	pyodide.globals.set("edge_certainties", edgeCertainties);
	pyodide.globals.set("time_series_data", timeSeriesData);
	
	
};






document.getElementById('crisisAnalysisTab').onclick = async () => {
	showLoadingSpinner();
    await loadInitialData();
    await pyodide.loadPackage(['numpy', 'matplotlib']); // Ensure necessary packages are loaded

    // Define and execute Python code asynchronously
    await pyodide.runPythonAsync(`
# Convert JavaScript time_series_data to Python object
time_series_data_py = time_series_data.to_py()

def calculate_rolling_z_scores(values):
    n = len(values)
    mean_t = np.zeros(n)
    var_t = np.zeros(n)
    z_scores = np.zeros(n)
    for t in range(n):
        if t == 0:
            mean_t[t] = values[t]
            var_t[t] = 0
            z_scores[t] = 0  # Z-score is undefined for the first value
        else:
            delta = values[t] - mean_t[t - 1]
            mean_t[t] = mean_t[t - 1] + delta / (t + 1)
            var_t[t] = var_t[t - 1] + delta * (values[t] - mean_t[t])
            if var_t[t] > 0 and t > 1:  # Avoid division by zero
                std_t = np.sqrt(var_t[t] / (t - 1))
                z_scores[t] = (values[t] - mean_t[t]) / std_t
            else:
                std_t = 0
                z_scores[t] = 0  # Variance is zero; Z-score is undefined
    return z_scores

def plot_rolling_z_scores_grid(results, start_iteration=0):
    num_nodes = len(results)
    num_cols = 3
    num_rows = (num_nodes + num_cols - 1) // num_cols

    fig, axes = plt.subplots(num_rows, num_cols, figsize=(15, 5 * num_rows), sharex=True, sharey=True)
    axes = axes.flatten()

    for idx, node in enumerate(results):
        node_results = np.array(results[node])
        z_scores = calculate_rolling_z_scores(node_results)
        z_scores_to_plot = z_scores[start_iteration:]
        x = range(start_iteration, len(z_scores))

        # Plot rolling z-scores for each node in its respective subplot
        axes[idx].plot(x, z_scores_to_plot, label='Rolling Z-Score', color='red')
        axes[idx].set_title(f'Node {node} (after iteration {start_iteration})')
        axes[idx].set_xlabel('Iteration (Quarter per tick)')
        axes[idx].set_ylabel('Z-Score')
        axes[idx].grid(True)

    for ax in axes[num_nodes:]:
        ax.axis('off')

    plt.tight_layout()
    filename = "/tmp/crisis_analysis_plot.png"
    plt.savefig(filename)

    return filename

# Call the plot function and return the saved filename
crisisAnalysisPlot = plot_rolling_z_scores_grid(time_series_data_py)
    `);

    // Retrieve and display the generated plot
    const crisisAnalysisPlot = pyodide.globals.get('crisisAnalysisPlot');
    const crisisAnalysisPlotsContainer = document.getElementById('crisisAnalysisPlots');
    crisisAnalysisPlotsContainer.innerHTML = ''; // Clear any previous plots

    // Read the saved image and display it
    let file = pyodide.FS.readFile(crisisAnalysisPlot, { encoding: 'binary' });
    let blob = new Blob([file], { type: 'image/png' });
    let url = URL.createObjectURL(blob);

    const img = document.createElement('img');
    img.src = url;
    crisisAnalysisPlotsContainer.appendChild(img);
	hideLoadingSpinner();
    openPage('CrisisAnalysis');
};


	document.getElementById('cycleAnalysisTab').onclick = async() => {
		showLoadingSpinner();
		await loadInitialData();
		pyodide.runPython(`
			edge_polarities = edge_polarities.to_py()
			edges = edges.to_py()
	
			for (node1, node2), polarity in zip(edges, edge_polarities):
				G.add_edge(node1, node2, polarity=polarity)
	
			cycles = list(nx.simple_cycles(G))
	
			def cycle_polarity(cycle):
				polarity = '+'
				for i in range(len(cycle)):
					edge = (cycle[i], cycle[(i + 1) % len(cycle)])
					actual_polarity = str(G.edges[edge]['polarity'])
					if (actual_polarity == "–"):
						polarity = '–' if polarity == '+' else '+'
				return polarity
	
			node_cycles = {node: {'positive': 0, 'negative': 0} for node in G.nodes}
			for cycle in cycles:
				pol = cycle_polarity(cycle)
				for node in cycle:
					if pol == '+':
						node_cycles[node]['positive'] += 1
					else:
						node_cycles[node]['negative'] += 1
	
			max_node_length = max([len(node) for node in G.nodes]) + 2
	
			header = f"<tr><th>{'Node'.ljust(max_node_length)}</th><th>{'Positive Cycles'.rjust(15)}</th><th>{'Negative Cycles'.rjust(15)}</th><th>{'Total Cycles'.rjust(15)}</th></tr>"
			table_rows = [header]
	
			for node, counts in node_cycles.items():
				total = counts['positive'] + counts['negative']
				row = f"<tr><td>{node.ljust(max_node_length)}</td><td>{str(counts['positive']).rjust(15)}</td><td>{str(counts['negative']).rjust(15)}</td><td>{str(total).rjust(15)}</td></tr>"
				table_rows.append(row)
	
			table = "".join(table_rows)
		`);

		document.getElementById("cycleTable").innerHTML = pyodide.globals.get('table');

		const duplicateNodesWithEdgesWarningId = document.getElementById("duplicateNodesWithEdgesWarning");
		duplicateNodesWithEdgesWarningId.innerHTML = 'Duplicate Nodes: ';
		duplicateLabels.forEach(label => {
			duplicateNodesWithEdgesWarningId.innerHTML += `<span>${label}; </span>`;
		});
		hideLoadingSpinner();
		openPage('CycleAnalysis');
	};

	document.getElementById('degreeCentralityTab').onclick = async() => {
		showLoadingSpinner();
		await loadInitialData();
	
		pyodide.runPython(`
			def create_graph(edges, edge_polarities):
				G = nx.DiGraph()
				for edge, polarity in zip(edges, edge_polarities):
					G.add_edge(*edge, polarity=polarity)
				return G

			def plot_graph(G):
				plt.figure(figsize=(15, 10))
				pos = nx.spring_layout(G, k=0.15, iterations=20)
				edge_colors = ['green' if G[u][v]['polarity'] == '+' else 'red' for u, v in G.edges()]
				nx.draw(G, pos, with_labels=True, node_color='lightblue', node_size=3000, edge_color=edge_colors, font_size=10, arrowsize=20)
				plt.show()

			def calculate_centrality_measures(G):
				measures = {
					"Degree Centrality": nx.degree_centrality(G),
					"Betweenness Centrality": nx.betweenness_centrality(G),
					"Closeness Centrality": nx.closeness_centrality(G),
					"Eigenvector Centrality": nx.eigenvector_centrality(G, max_iter=1000)
				}
				return measures

			def centrality_table_to_html(title, centrality_dict):
				output = f"<h3>{title}</h3>"
				output += "<table border='1' cellpadding='5'><tr><th>Node</th><th>Centrality</th></tr>"
				sorted_centralities = sorted(centrality_dict.items(), key=lambda x: x[1], reverse=True)
				for node, centrality in sorted_centralities:
					output += f"<tr><td>{node}</td><td>{centrality:.4f}</td></tr>"
				output += "</table><br>"
				return output

			def main(G):
				centrality_output = ""
				centrality_measures = calculate_centrality_measures(G)
				for title, centrality_dict in centrality_measures.items():
					centrality_output += centrality_table_to_html(title, centrality_dict)
				return centrality_output

			G = create_graph(edges, edge_polarities)
			centrality_output = main(G)
		`);
		document.getElementById("centralityTable").innerHTML = pyodide.globals.get('centrality_output');
		hideLoadingSpinner();
		openPage('DegreeCentrality');
	};

	document.getElementById('visualAnalysisTab').onclick = async() => {
		showLoadingSpinner();
		await loadInitialData();
		pyodide.runPython(`
			def initialize_graph_and_simulate():
				random.seed(42)
				G = nx.DiGraph()
				for (node1, node2), polarity in zip(edges, edge_polarities):
					G.add_edge(node1, node2, polarity=polarity)
				cycles = list(nx.simple_cycles(G))
				initial_node_values = {node: random.uniform(-1, 1) for node in G.nodes()}
				results = simulate_network(G, cycles, initial_node_values)
				return results

			def simulate_network(G, cycles, initial_node_values):
				results = {node: [] for node in G.nodes()}
				for _ in range(1000):
					node_values = initial_node_values.copy()
					random.shuffle(cycles)
					for cycle in cycles:
						polarity = cycle_polarity(G, cycle)
						change = random.uniform(0.5, 1) if polarity == '+' else random.uniform(-1, -0.5)
						for node in cycle:
							node_values[node] += change
							node_values[node] = modified_sigmoid(node_values[node])
					for node in node_values:
						results[node].append(node_values[node])
				return results

			def cycle_polarity(G, cycle):
				polarity = '+'
				for i in range(len(cycle)):
					edge = (cycle[i], cycle[(i + 1) % len(cycle)])
					if G.edges[edge]['polarity'] == '-':
						polarity = '-' if polarity == '+' else '+'
				return polarity

			def modified_sigmoid(x):
				return 2 / (1 + math.exp(-x)) - 1

			def plot_results_for_all_nodes(results):
				visualAnalysisPlots = []

				for node, data in results.items():
					data = np.array(data).reshape(-1, 1)
					gmm = GaussianMixture(n_components=2, random_state=0)
					gmm.fit(data)
					x = np.linspace(data.min(), data.max(), 1000)
					pdf = np.exp(gmm.score_samples(x.reshape(-1, 1)))
					responsibilities = gmm.predict_proba(x.reshape(-1, 1))
					pdf_individual = responsibilities * pdf[:, np.newaxis]

					plt.figure()
					plt.hist(data, bins=30, density=True, alpha=0.6, color='gray', label=f'Histogram of {node}')
					plt.plot(x, pdf, '-k', label='Overall PDF')
					plt.fill_between(x, pdf_individual[:, 0].flatten(), alpha=0.5, color='red', label='Component 1 PDF')
					plt.fill_between(x, pdf_individual[:, 1].flatten(), alpha=0.5, color='blue', label='Component 2 PDF')
					plt.xlabel('Values')
					plt.ylabel('Density')
					plt.title(f'Bimodal GMM Fit for {node}')
					plt.legend()
					plt.savefig(f"{node}_plot.png")
					visualAnalysisPlots.append(f"{node}_plot.png")
				return visualAnalysisPlots

			results = initialize_graph_and_simulate()
			visualAnalysisPlots = plot_results_for_all_nodes(results)
		`);

		const visualAnalysisPlots = pyodide.globals.get('visualAnalysisPlots').toJs();
		const plotsContainer = document.getElementById('visualAnalysisPlots');
		plotsContainer.innerHTML = '';

		// displayPlots()
		visualAnalysisPlots.forEach(plot => {
			let file = pyodide.FS.readFile(plot, { encoding: 'binary' });
			let blob = new Blob([file], { type: 'image/png' });
			let url = URL.createObjectURL(blob);
			
			const img = document.createElement('img');
			img.src = url;
			plotsContainer.appendChild(img);
		});
		hideLoadingSpinner();
		openPage('VisualAnalysis');
	}
	

	
	document.getElementById('simulationTab').onclick = async() => {
		showLoadingSpinner();
		await loadInitialData();
		pyodide.runPython(`
df = pd.DataFrame(time_series_data)
simulationPlot = ''
# Generate example data for each variable
np.random.seed(42)
# data = pd.DataFrame({var: np.random.rand(100) for var in variables})
data = df


# Initialize GMM Parameters for each variable
def initialize_gmms(data, n_components=2):
    gmms = {}
    for col in data.columns:
        gmm = GaussianMixture(n_components=n_components, random_state=42)
        gmm.fit(data[[col]])
        gmms[col] = gmm
    return gmms

gmms = initialize_gmms(data)

def calculate_peak_values_and_densities(gmm):
    peak_values_and_densities = {}
    for var, gmm_component in gmm.items():
        # Extracting the means and covariances for each component
        means = gmm_component.means_.flatten()
        covariances = gmm_component.covariances_.flatten()
        
        # Calculating the peak value (probability density) for each component
        peak_density_values = []
        for mean, cov in zip(means, covariances):
            # Calculate the probability density at the mean, which is the peak density for a Gaussian distribution
            peak_density = norm.pdf(mean, loc=mean, scale=np.sqrt(cov))
            peak_density_values.append((mean, peak_density))
            
        peak_values_and_densities[var] = peak_density_values
    return peak_values_and_densities

# Calculate the peak density values and their corresponding x-axis values for each GMM component
gmm_peak_values_and_densities = calculate_peak_values_and_densities(gmms)

# Corrected variable for visualization
fig, axs = plt.subplots(len(gmm_peak_values_and_densities), 1, figsize=(10, len(gmm_peak_values_and_densities) * 5))

for i, (variable, peaks) in enumerate(gmm_peak_values_and_densities.items()):
    ax = axs[i] if len(gmm_peak_values_and_densities) > 1 else axs
    
    # Plot synthetic data for comparison (if available) or original data to visualize distribution
    sns.histplot(data[variable], bins=20, kde=True, ax=ax, color="skyblue", label="Data Distribution")
    
    # Mark peaks on the plot
    for mean, density in peaks:
        ax.axvline(x=mean, color='red', linestyle='--', label=f'Peak at {mean:.2f}')
    
    ax.set_title(f'{variable}')
    ax.legend()
    
# Calculate the peak differences for each variable
peak_differences = {}
for variable, peaks in gmm_peak_values_and_densities.items():
    if len(peaks) > 1:
        # Assuming there are at least two peaks, calculate the difference between the first two peaks' x-values (means)
        diff = abs(peaks[0][0] - peaks[1][0])
        peak_differences[variable] = diff
    else:
        # If there's only one peak (or none), set the difference to None or 0
        peak_differences[variable] = None

plt.tight_layout()
plt.savefig("simulation.png")
simulationPlot = "simulation.png"

    `);

    const simulationPlots = pyodide.globals.get('simulationPlot');
    const plotsContainer = document.getElementById('simulationPlots');
    plotsContainer.innerHTML = '';

	let file = pyodide.FS.readFile(simulationPlots, { encoding: 'binary' });
	let blob = new Blob([file], { type: 'image/png' });
	let url = URL.createObjectURL(blob);

	const img = document.createElement('img');
	img.src = url;
	plotsContainer.appendChild(img);
	

	hideLoadingSpinner();
    openPage('Simulation1');
}





document.getElementById('simulation2Tab').onclick = async() => {
	showLoadingSpinner();
	await loadInitialData();
	pyodide.runPython(`
np.random.seed(42)
data = pd.DataFrame({var: np.random.rand(100) for var in variables})

def initialize_gmms(data, n_components=2):
    gmms = {}
    for col in data.columns:
        gmm = GaussianMixture(n_components=n_components, random_state=42)
        gmm.fit(data[[col]])
        gmms[col] = gmm
    return gmms

gmms = initialize_gmms(data)


#Generate Synthetic Data
def generate_synthetic_data(gmms, n_samples=100):
	synthetic_data = pd.DataFrame()
	for col, gmm in gmms.items():
		samples, _ = gmm.sample(n_samples)
		synthetic_data[col] = samples.flatten()
	return synthetic_data


#Concatenate the GMM means into a single one-dimensional array
initial_gmm_params = np.concatenate([gmm.means_.flatten() for gmm in gmms.values()])

synthetic_data = generate_synthetic_data(gmms)

def simulation2results():
	simulation2Plots = []
	for i, var in enumerate(variables, 1):
		plt.figure()  # Adjust the size of the entire plot grid
		sns.histplot(data[var], color="skyblue", label='Original', kde=True, stat="density", linewidth=0)
		sns.histplot(synthetic_data[var], color="orange", label='Synthetic', kde=True, stat="density", linewidth=0, alpha=0.5)
		plt.title(var)
		legend = plt.legend()
		plt.savefig(f"{var}_simulation2.png")
		simulation2Plots.append(f"{var}_simulation2.png")
	return simulation2Plots


simulation2Plots = simulation2results()
`);

const simulation2Plots = pyodide.globals.get('simulation2Plots').toJs();
const plotsContainer = document.getElementById('simulationPlots2');
plotsContainer.innerHTML = '';

simulation2Plots.forEach(node => {
	let file = pyodide.FS.readFile(node, { encoding: 'binary' });
	let blob = new Blob([file], { type: 'image/png' });
	let url = URL.createObjectURL(blob);
	
	const img = document.createElement('img');
	img.src = url;
	plotsContainer.appendChild(img);
})


openPage('Simulation2');
}


document.getElementById('boxPlotTab').onclick = async() => {
	showLoadingSpinner();
	await loadInitialData();
	pyodide.runPython(`
boxplots = []

np.random.seed(42)
data = pd.DataFrame({var: np.random.rand(100) for var in variables})

def initialize_gmms(data, n_components=2):
    gmms = {}
    for col in data.columns:
        gmm = GaussianMixture(n_components=n_components, random_state=42)
        gmm.fit(data[[col]])
        gmms[col] = gmm
    return gmms

gmms = initialize_gmms(data)

# Generate Synthetic Data
def generate_synthetic_data(gmms, n_samples=100):
	synthetic_data = pd.DataFrame()
	for col, gmm in gmms.items():
		samples, _ = gmm.sample(n_samples)
		synthetic_data[col] = samples.flatten()
	return synthetic_data

# Concatenate the GMM means into a single one-dimensional array
initial_gmm_params = np.concatenate([gmm.means_.flatten() for gmm in gmms.values()])

synthetic_data = generate_synthetic_data(gmms)


def plotresultsforboxplots():
	boxplots = []
	for i, variable in enumerate(variables, 1):
		plt.figure()
		data_column = data[variable]
		
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
		plt.savefig(f"{variable}_boxPlot.png")
		boxplots.append(f"{variable}_boxPlot.png")
	return boxplots

boxplots = plotresultsforboxplots()

`);

const boxPlots = pyodide.globals.get('boxplots').toJs();
const plotsContainer = document.getElementById('boxPlots');
plotsContainer.innerHTML = '';

boxPlots.forEach(node => {
	let file = pyodide.FS.readFile(node, { encoding: 'binary' });
	let blob = new Blob([file], { type: 'image/png' });
	let url = URL.createObjectURL(blob);
	
	const img = document.createElement('img');
	img.src = url;
	plotsContainer.appendChild(img);
})


hideLoadingSpinner();
openPage('BoxPlot');
}




document.getElementById('violinPlotTab').onclick = async() => {
	showLoadingSpinner();
	await loadInitialData();
	pyodide.runPython(`

violinplots = []

np.random.seed(42)
data = pd.DataFrame({var: np.random.rand(100) for var in variables})

def initialize_gmms(data, n_components=2):
    gmms = {}
    for col in data.columns:
        gmm = GaussianMixture(n_components=n_components, random_state=42)
        gmm.fit(data[[col]])
        gmms[col] = gmm
    return gmms

gmms = initialize_gmms(data)

# Generate Synthetic Data
def generate_synthetic_data(gmms, n_samples=100):
	synthetic_data = pd.DataFrame()
	for col, gmm in gmms.items():
		samples, _ = gmm.sample(n_samples)
		synthetic_data[col] = samples.flatten()
	return synthetic_data


# Concatenate the GMM means into a single one-dimensional array
initial_gmm_params = np.concatenate([gmm.means_.flatten() for gmm in gmms.values()])

synthetic_data = generate_synthetic_data(gmms)


def violinplotforallnodes():
	violinplots = []
	for i, var in enumerate(variables, 1):
		plt.figure()  # Adjust figure size as necessary
		sns.violinplot(data=[data[var], synthetic_data[var]], palette=["skyblue", "lightgreen"])
		plt.xticks([0, 1], ['Original', 'Synthetic'])
		plt.title(var)
		plt.savefig(f"{var}_violinPlot.png")
		violinplots.append(f"{var}_violinPlot.png")

	return violinplots


violinplots = violinplotforallnodes()
`);

const violinPlots = pyodide.globals.get('violinplots');
const plotsContainer = document.getElementById('violinPlots');
plotsContainer.innerHTML = '';


violinPlots.forEach(node => {
	let file = pyodide.FS.readFile(node, { encoding: 'binary' });
	let blob = new Blob([file], { type: 'image/png' });
	let url = URL.createObjectURL(blob);
	
	const img = document.createElement('img');
	img.src = url;
	plotsContainer.appendChild(img);
})

hideLoadingSpinner();
openPage('ViolinPlot');
}



	document.getElementById('randomSeedsTab').onclick = async() => {
		showLoadingSpinner();
		await loadInitialData();
		pyodide.runPython(`
G = nx.DiGraph()
for (node1, node2), polarity in zip(edges, edge_polarities):
	G.add_edge(node1, node2, polarity=polarity)
randomSeedCharts = []

overall_results = {node: [] for node in G.nodes()}

# Number of outer loops
num_outer_loops = 1000

# Number of inner simulations per loop
num_simulations = 100

# Function to create the directed graph
def create_graph():
    G = nx.DiGraph()
    for (node1, node2), polarity in zip(edges, edge_polarities):
        G.add_edge(node1, node2, polarity=polarity)
    return G

# Function to determine the polarity of a cycle
def cycle_polarity(G, cycle):
    polarity = '+'
    for i in range(len(cycle)):
        edge = (cycle[i], cycle[(i + 1) % len(cycle)])
        if G.edges[edge]['polarity'] == '-':
            polarity = '-' if polarity == '+' else '+'
    return polarity

# Function to run the simulation for a given seed
def run_simulation(seed):
	random.seed(seed)
	G = create_graph()
	cycles = list(nx.simple_cycles(G))
	initial_node_values = {node: random.uniform(-1, 1) for node in G.nodes()}
	overall_results = {node: [] for node in G.nodes()}
	num_outer_loops = 1000
	num_simulations = 100
	current_values = initial_node_values

	for outer_loop in range(num_outer_loops):
		results = {node: [] for node in G.nodes()}
		for _ in range(num_simulations):
			node_values = current_values.copy()
			random.shuffle(cycles)
			for cycle in cycles:
				pol = cycle_polarity(G, cycle)
				if pol == '+':
					change = random.normalvariate(0.01, 0.5)
				else:
					change = random.normalvariate(-0.01, 0.5)
				for node in cycle:
					node_values[node] += change
			for node in node_values:
				results[node].append(node_values[node])
		mean_values = {node: np.mean(values) for node, values in results.items()}
		current_values = mean_values
		for node in overall_results:
			overall_results[node].extend(results[node])
	return overall_results

# Function to create the combined fan chart
def create_combined_fan_chart(results_list, node, num_outer_loops, num_simulations):
	plt.figure(figsize=(12, 9))
	x = range(num_outer_loops)
	colors = ['blue', 'green', 'red', 'purple', 'orange', 'cyan', 'magenta', 'yellow', 'brown', 'pink']
	for idx, results in enumerate(results_list):
		node_results = np.array(results[node])
		percentiles = np.percentile(node_results.reshape(num_outer_loops, num_simulations), [5, 25, 50, 75, 95], axis=1)
		plt.plot(x, percentiles[2], label=f'Median (Seed {idx+1})', color=colors[idx])
		plt.fill_between(x, percentiles[1], percentiles[3], color=colors[idx], alpha=0.3, label=f'25th-75th percentile (Seed {idx+1})')
		plt.fill_between(x, percentiles[0], percentiles[4], color=colors[idx], alpha=0.1, label=f'5th-95th percentile (Seed {idx+1})')
	# Customize the plot
	plt.xlabel('Outer Loop Iteration')
	plt.ylabel('Value')
	plt.title(f'Combined Fan Chart for {node} Node')
	plt.legend()
	plt.grid(True)
	plt.savefig(f"{node}_randomSeedPlot.png")
	randomSeedCharts.append(f"{node}_randomSeedPlot.png")

# Run the simulation for 5 different seeds and store the results
seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
results_list = [run_simulation(seed) for seed in seeds]

# Create the combined fan chart for each node
for node in G.nodes():
	create_combined_fan_chart(results_list, node, num_outer_loops, num_simulations)

    `);

    const randomSeedsPlots = pyodide.globals.get('randomSeedCharts').toJs();
    const plotsContainer = document.getElementById('randomSeedsPlots');
    plotsContainer.innerHTML = '';

    randomSeedsPlots.forEach(plot => {
        let file = pyodide.FS.readFile(plot, { encoding: 'binary' });
        let blob = new Blob([file], { type: 'image/png' });
        let url = URL.createObjectURL(blob);

        const img = document.createElement('img');
        img.src = url;
        plotsContainer.appendChild(img);
    });
	hideLoadingSpinner();
    openPage('RandomSeeds');
}


	document.getElementById('correlationTab').onclick = async() => {
		showLoadingSpinner();
		await loadInitialData();
		pyodide.runPython(`
plt.figure(figsize=(12, 8))

G = nx.DiGraph(edges)
correlationPlot = ''

# Initialize all nodes with a baseline value (e.g., 1)
for node in G.nodes():
	G.nodes[node]['value'] = 1

# Random seed for reproducibility
np.random.seed(0)

# Assume a hypothetical dataset for each node in the graph
time_points = 50  # Number of time points or observations
data = {node: np.random.rand(time_points) for node in G.nodes()}
df = pd.DataFrame(data)

correlation_matrix = df.corr()

# Generate a heatmap using seaborn
heatmap = sns.heatmap(correlation_matrix, annot=True, cmap='coolwarm', center=0)
plt.savefig("corr.png")
correlationPlot = "corr.png"
    `);

    const correlationPlot = pyodide.globals.get('correlationPlot');
    const plotsContainer = document.getElementById('correlationPlot');
    plotsContainer.innerHTML = '';

    let file = pyodide.FS.readFile(correlationPlot, { encoding: 'binary' });
    let blob = new Blob([file], { type: 'image/png' });
    let url = URL.createObjectURL(blob);

    const img = document.createElement('img');
    img.src = url;
    plotsContainer.appendChild(img);
	hideLoadingSpinner();
    openPage('Correlation');
}

document.getElementById("stabilityMapTab").onclick = async () => {
    showLoadingSpinner();
    await loadInitialData();
	function updateProgressBar(percentage) {
		const progressBar = document.getElementById('progressBar');
		progressBar.style.width = percentage + '%';
		progressBar.textContent = percentage + '%';
	  }

    try {
		// Retrieve values from input fields
		const decayMin = parseFloat(document.getElementById("decayMin").value);
		const decayMax = parseFloat(document.getElementById("decayMax").value);
		const decaySteps = parseInt(document.getElementById("decaySteps").value);

		const delayMin = parseFloat(document.getElementById("delayMin").value);
		const delayMax = parseFloat(document.getElementById("delayMax").value);
		const delaySteps = parseInt(document.getElementById("delaySteps").value);
		// window.updateProgressBar = updateProgressBar;

		// Construct ranges
		const decayRange = [decayMin, decayMax, decaySteps];
		const delayRange = [delayMin, delayMax, delaySteps];

		// Assuming you have a way to determine pass nodes in your application
		const passnodeList = loopy.model.nodes
		.filter(node => node.isPassNode)
		.map(node => node.label);

		const node_floors = loopy.model.nodes.reduce((acc, node) => {
			acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
			return acc;
		}, {});
		
		const node_ceilings = loopy.model.nodes.reduce((acc, node) => {
			acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
			return acc;
		}, {});


        // Pass decayRange and delayRange to Python
        pyodide.globals.set("decayRange", decayRange);
        pyodide.globals.set("delayRange", delayRange);
		pyodide.globals.set("passnodeList", passnodeList);

		pyodide.globals.set("node_floors", pyodide.toPy(node_floors));
		pyodide.globals.set("node_ceilings", pyodide.toPy(node_ceilings));
        await pyodide.runPythonAsync(`
import js
import asyncio

async def allow_dom_update():
    await asyncio.sleep(0)

async def blended_uniform_normal(mean, low, high, certainty, size=1000):
    max_variance = 1  # Set maximum variance for when certainty is 0
    variance = (1 - certainty) * max_variance  # Variance decreases as certainty increases

    samples = []

    # Continue generating until we get the required number of valid samples
    while len(samples) < size:
        # Generate a mixture of uniform and normal samples
        uniform_sample = np.random.uniform(low=low, high=high)
        normal_sample = np.random.normal(loc=mean, scale=np.sqrt(variance))

        # Blend the two samples based on certainty
        blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample

        # Accept the sample only if it is within the specified range
        if low <= blended_sample <= high:
          samples.append(blended_sample)

    return samples

# Define the classification function
async def calculate_rolling_z_score(time_series, window=10):
    """Calculate the rolling z-score for a time series."""
    rolling_mean = time_series.rolling(window=window).mean()
    rolling_std = time_series.rolling(window=window).std()
    z_score = (time_series - rolling_mean) / rolling_std
    return z_score

async def classify_behavior(time_series_data):
    """Classify the behavior of each node's time series into 'Over-damped', 'Optimal', or 'Unconstrained'."""
    classifications = {}
    for node, series in time_series_data.items():
        # Convert the series to a DataFrame for ease of processing
        df = pd.DataFrame(series, columns=[node])

        # Calculate rolling z-score
        rolling_z_score = calculate_rolling_z_score(df[node])

        # Check for periodic peaks
        peaks, _ = find_peaks(df[node], height=0.05, distance=10)  # Adding a minimum distance for peak detection
        num_peaks = len(peaks)
        
        # Calculate average rolling z-score
        avg_z_score = rolling_z_score.abs().mean()

        # Classification logic with refined criteria
        if num_peaks > 8 and avg_z_score > 1.2:
            classifications[node] = "Unconstrained"
        elif 0.5 < avg_z_score < 1.2 and 3 <= num_peaks <= 8:
            classifications[node] = "Optimal"
        else:
            classifications[node] = "Over-damped"
    
    return classifications


async def stochastic_value_selection(mean, low, high, certainty):
  return blended_uniform_normal(mean, low, high, certainty, 1)[0]

# Create a directed graph using NetworkX
graph = nx.DiGraph()

# Add edges along with their weights, polarities, and delays
for i, (source, target) in enumerate(edges):
    graph.add_edge(source, target, weight=edge_weights[i], polarity=edge_polarities[i], delay=edge_delays[i], certainty=edge_certainties[i])

# Initialize signal_map with current node values
signal_map = {}
time_series_data = {node: [] for node in graph.nodes}
passnodes = set(passnodeList)

# Initialize delay buffers for each edge
delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}

async def initialize_signal_map():
    """Initialize the signal map with initial values for each node."""
    for node in graph.nodes:
        if node in passnodes:
            signal_map[node] = 0.0
        else:
            signal_map[node] = random.uniform(0, 1)
    return signal_map

# Retrieve decay and delay ranges from JavaScript
decay_min, decay_max, decay_steps = decayRange
delay_min, delay_max, delay_steps = delayRange

# Generate ranges for decay factors and delays
decay_factors = np.linspace(decay_min, decay_max, int(decay_steps))
delays = np.linspace(delay_min, delay_max, int(delay_steps))

total_steps = decay_steps * delay_steps
step_counter = 0

async def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
    global step_counter
    """Update the signal map based on incoming signals from connected nodes, with optional system-wide delay."""
    new_signal_map = defaultdict(float)
    previous_signal_map = signal_map.copy()  # Store previous values for consistency

    for edge in graph.edges(data=True):
        predecessor = edge[0]
        node = edge[1]
        edge_data = edge[2]
        weight = edge_data['weight']
        polarity = edge_data['polarity']
        certainty = edge_data['certainty']

        # Set delay based on global or edge-specific delay, only if delay is being used
        delay = global_delay if global_delay is not None else edge_data['delay']

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

#    step_counter += 1
#    progress = (step_counter/total_steps) * 100
#    js.updateProgressBar(progress)
#    await asyncio.sleep(0)

    return signal_map

async def simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=None, use_delay=True, node_retention=None):
    """Simulate signal transfer for a given number of iterations, with optional global delay."""
    initialize_signal_map()
    for _ in range(iterations):
        accumulate_signals(decay_factor, global_delay=delay, use_delay=use_delay, node_retention=node_retention)
        await asyncio.sleep(0)
        for node in graph.nodes():
            time_series_data[node].append(signal_map[node])

    return time_series_data


# Initialize stability matrix
stability_matrix = np.zeros((len(delays), len(decay_factors)))

async def main_simulation():
    stability_matrix = np.zeros((len(delays), len(decay_factors)))

    for i, delay in enumerate(delays):
        for j, decay in enumerate(decay_factors):
            # Simulate signal transfer for each combination of decay and delay
            signal_map = {}
            time_series_data = {node: [] for node in graph.nodes}
            delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}

            time_series_data = await simulate_signal_transfer(
                iterations=100,
                decay_factor=decay,
                delay=int(delay),
                use_delay=True
            )

            # Classify node behavior
            classification = await classify_behavior(time_series_data)

            # Update stability matrix
            if "Unconstrained" in classification.values():
                stability_matrix[i, j] = 1.0
            elif "Optimal" in classification.values():
                stability_matrix[i, j] = 0.6
            else:
                stability_matrix[i, j] = 0.2

    return stability_matrix



        `);

		await pyodide.runPythonAsync(`
from __main__ import main_simulation
async def main():
    stability_matrix = await main_simulation()
    # Plot and save the stability map
    plt.figure(figsize=(10, 6))
    cmap = plt.cm.coolwarm
    norm = mcolors.Normalize(vmin=0, vmax=1)
    plt.imshow(stability_matrix, cmap=cmap, norm=norm, extent=[decay_min, decay_max, delay_min, delay_max], origin="lower", aspect="auto")
    plt.colorbar(label="Stability Measure")
    plt.xlabel("Decay Parameter")
    plt.ylabel("Delay Parameter")
    plt.title("Stability Map")
    plt.savefig("stability_map.png")
			`);

		await pyodide.runPythonAsync("await main()");


        // Retrieve and display plot
        const plotPath = "stability_map.png";
        const file = pyodide.FS.readFile(plotPath, { encoding: "binary" });
        const blob = new Blob([file], { type: "image/png" });
        const url = URL.createObjectURL(blob);

        const img = document.createElement("img");
        img.src = url;

        const plotsContainer = document.getElementById("stabilityMapPlot");
        plotsContainer.innerHTML = ""; // Clear existing content
        plotsContainer.appendChild(img);

    } catch (error) {
        console.error("Error generating stability map:", error);
        alert("An error occurred. Check console for details.");
    } finally {
        hideLoadingSpinner();
        openPage("StabilityMap");
    }
};


document.getElementById("updateStabilityMap").onclick = async() => {
    showLoadingSpinner();
    await loadInitialData();

    try {
		// Retrieve values from input fields
		const decayMin = parseFloat(document.getElementById("decayMin").value);
		const decayMax = parseFloat(document.getElementById("decayMax").value);
		const decaySteps = parseInt(document.getElementById("decaySteps").value);

		const delayMin = parseFloat(document.getElementById("delayMin").value);
		const delayMax = parseFloat(document.getElementById("delayMax").value);
		const delaySteps = parseInt(document.getElementById("delaySteps").value);

		// Construct ranges
		const decayRange = [decayMin, decayMax, decaySteps];
		const delayRange = [delayMin, delayMax, delaySteps];

		const passnodeList = loopy.model.nodes
		.filter(node => node.isPassNode)
		.map(node => node.label);

		const node_floors = loopy.model.nodes.reduce((acc, node) => {
			acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
			return acc;
		}, {});
		
		const node_ceilings = loopy.model.nodes.reduce((acc, node) => {
			acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
			return acc;
		}, {});


        // Pass decayRange and delayRange to Python
        pyodide.globals.set("decayRange", decayRange);
        pyodide.globals.set("delayRange", delayRange);
		pyodide.globals.set("passnodeList", passnodeList);

		pyodide.globals.set("node_floors", pyodide.toPy(node_floors));
		pyodide.globals.set("node_ceilings", pyodide.toPy(node_ceilings));
        await pyodide.runPythonAsync(`

def blended_uniform_normal(mean, low, high, certainty, size=1000):
    max_variance = 1  # Set maximum variance for when certainty is 0
    variance = (1 - certainty) * max_variance  # Variance decreases as certainty increases

    samples = []

    # Continue generating until we get the required number of valid samples
    while len(samples) < size:
        # Generate a mixture of uniform and normal samples
        uniform_sample = np.random.uniform(low=low, high=high)
        normal_sample = np.random.normal(loc=mean, scale=np.sqrt(variance))

        # Blend the two samples based on certainty
        blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample

        # Accept the sample only if it is within the specified range
        if low <= blended_sample <= high:
          samples.append(blended_sample)

    return samples

# Define the classification function
def calculate_rolling_z_score(time_series, window=10):
    """Calculate the rolling z-score for a time series."""
    rolling_mean = time_series.rolling(window=window).mean()
    rolling_std = time_series.rolling(window=window).std()
    z_score = (time_series - rolling_mean) / rolling_std
    return z_score

def classify_behavior(time_series_data):
    """Classify the behavior of each node's time series into 'Over-damped', 'Optimal', or 'Unconstrained'."""
    classifications = {}
    for node, series in time_series_data.items():
        # Convert the series to a DataFrame for ease of processing
        df = pd.DataFrame(series, columns=[node])

        # Calculate rolling z-score
        rolling_z_score = calculate_rolling_z_score(df[node])

        # Check for periodic peaks
        peaks, _ = find_peaks(df[node], height=0.05, distance=10)  # Adding a minimum distance for peak detection
        num_peaks = len(peaks)
        
        # Calculate average rolling z-score
        avg_z_score = rolling_z_score.abs().mean()

        # Classification logic with refined criteria
        if num_peaks > 8 and avg_z_score > 1.2:
            classifications[node] = "Unconstrained"
        elif 0.5 < avg_z_score < 1.2 and 3 <= num_peaks <= 8:
            classifications[node] = "Optimal"
        else:
            classifications[node] = "Over-damped"
    
    return classifications


def stochastic_value_selection(mean, low, high, certainty):
  return blended_uniform_normal(mean, low, high, certainty, 1)[0]

# Create a directed graph using NetworkX
graph = nx.DiGraph()

# Add edges along with their weights, polarities, and delays
for i, (source, target) in enumerate(edges):
    graph.add_edge(source, target, weight=edge_weights[i], polarity=edge_polarities[i], delay=edge_delays[i], certainty=edge_certainties[i])

# Initialize signal_map with current node values
signal_map = {}
time_series_data = {node: [] for node in graph.nodes}
passnodes = set(passnodeList)

# Initialize delay buffers for each edge
delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}

def initialize_signal_map():
    """Initialize the signal map with initial values for each node."""
    for node in graph.nodes:
        if node in passnodes:
            signal_map[node] = 0.0
        else:
            signal_map[node] = random.uniform(0, 1)
    return signal_map

def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
    """Update the signal map based on incoming signals from connected nodes, with optional system-wide delay."""
    new_signal_map = defaultdict(float)
    previous_signal_map = signal_map.copy()  # Store previous values for consistency

    for edge in graph.edges(data=True):
        predecessor = edge[0]
        node = edge[1]
        edge_data = edge[2]
        weight = edge_data['weight']
        polarity = edge_data['polarity']
        certainty = edge_data['certainty']

        # Set delay based on global or edge-specific delay, only if delay is being used
        delay = global_delay if global_delay is not None else edge_data['delay']

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

    print("passes step 5")

    return signal_map

def simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=None, use_delay=True, node_retention=None):
    """Simulate signal transfer for a given number of iterations, with optional global delay."""
    initialize_signal_map()
    for _ in range(iterations):
        accumulate_signals(decay_factor, global_delay=delay, use_delay=use_delay, node_retention=node_retention)
        for node in graph.nodes():
            time_series_data[node].append(signal_map[node])

    return time_series_data

# Retrieve decay and delay ranges from JavaScript
decay_min, decay_max, decay_steps = decayRange
delay_min, delay_max, delay_steps = delayRange

# Generate ranges for decay factors and delays
decay_factors = np.linspace(decay_min, decay_max, int(decay_steps))
delays = np.linspace(delay_min, delay_max, int(delay_steps))

# Initialize stability matrix
stability_matrix = np.zeros((len(delays), len(decay_factors)))

# Main simulation loop
for i, delay in enumerate(delays):
    for j, decay in enumerate(decay_factors):
        # Simulate signal transfer for each combination of decay and delay
        signal_map = {}
        time_series_data = {node: [] for node in graph.nodes}
        delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges} 
        time_series_data = simulate_signal_transfer(iterations=100, decay_factor=decay, delay=int(delay), use_delay=True)
        
        # Classify node behavior
        classification = classify_behavior(time_series_data)

        # Update stability matrix
        if "Unconstrained" in classification.values():
            stability_matrix[i, j] = 1.0
        elif "Optimal" in classification.values():
            stability_matrix[i, j] = 0.6
        else:
            stability_matrix[i, j] = 0.2

# Plot stability map
plt.figure(figsize=(10, 6))
cmap = plt.cm.coolwarm
norm = mcolors.Normalize(vmin=0, vmax=1)
plt.imshow(stability_matrix, cmap=cmap, norm=norm, extent=[decay_min, decay_max, delay_min, delay_max], origin="lower", aspect="auto")
plt.colorbar(label="Stability Measure")
plt.xlabel("Decay Parameter")
plt.ylabel("Delay Parameter")
plt.title("Stability Map")
plt.savefig("stability_map.png")
        `);

        // Retrieve and display plot
        const plotPath = "stability_map.png";
        const file = pyodide.FS.readFile(plotPath, { encoding: "binary" });
        const blob = new Blob([file], { type: "image/png" });
        const url = URL.createObjectURL(blob);

        const img = document.createElement("img");
        img.src = url;

        const plotsContainer = document.getElementById("stabilityMapPlot");
        plotsContainer.innerHTML = ""; // Clear existing content
        plotsContainer.appendChild(img);

    } catch (error) {
        console.error("Error generating stability map:", error);
        alert("An error occurred. Check console for details.");
    } finally {
        hideLoadingSpinner();
        openPage("StabilityMap");
    }
}
// window.updateProgressBar = function(percentage) {
// 	const progressBar = document.getElementById('progressBar');
// 	progressBar.style.width = percentage + '%';
// 	progressBar.textContent = percentage + '%';
// }

document.getElementById("generateDecayRetention").onclick = async() => {
    showLoadingSpinner();

    await loadInitialData();

    try {
		// updateProgressBar(5);
		// Retrieve values from input fields
		const decayMin = parseFloat(document.getElementById("decayMin").value);
		const decayMax = parseFloat(document.getElementById("decayMax").value);
		const decaySteps = parseInt(document.getElementById("decaySteps").value);

		const retentionMin = parseFloat(document.getElementById("nodeRetentionMin").value);
		const retentionMax = parseFloat(document.getElementById("nodeRetentionMax").value);
		const retentionSteps = parseInt(document.getElementById("nodeRetentionSteps").value);

		// Construct ranges
		const decayRange = [decayMin, decayMax, decaySteps];
		const retentionRange = [retentionMin, retentionMax, retentionSteps];

		const passnodeList = loopy.model.nodes
		.filter(node => node.isPassNode)
		.map(node => node.label);

		const node_floors = loopy.model.nodes.reduce((acc, node) => {
			acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
			return acc;
		}, {});
		
		const node_ceilings = loopy.model.nodes.reduce((acc, node) => {
			acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
			return acc;
		}, {});


        // Pass decayRange and delayRange to Python
        pyodide.globals.set("decayRange", decayRange);
        pyodide.globals.set("retentionRange", retentionRange);
		pyodide.globals.set("passnodeList", passnodeList);

		pyodide.globals.set("node_floors", pyodide.toPy(node_floors));
		pyodide.globals.set("node_ceilings", pyodide.toPy(node_ceilings));
        await pyodide.runPythonAsync(`
from time import sleep
import js  # pyodide's JavaScript bridge

def blended_uniform_normal(mean, low, high, certainty, size=1000):
    max_variance = 1  # Set maximum variance for when certainty is 0
    variance = (1 - certainty) * max_variance  # Variance decreases as certainty increases

    samples = []

    # Continue generating until we get the required number of valid samples
    while len(samples) < size:
        # Generate a mixture of uniform and normal samples
        uniform_sample = np.random.uniform(low=low, high=high)
        normal_sample = np.random.normal(loc=mean, scale=np.sqrt(variance))

        # Blend the two samples based on certainty
        blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample

        # Accept the sample only if it is within the specified range
        if low <= blended_sample <= high:
          samples.append(blended_sample)

    return samples

# Define the classification function
def calculate_rolling_z_score(time_series, window=10):
    """Calculate the rolling z-score for a time series."""
    rolling_mean = time_series.rolling(window=window).mean()
    rolling_std = time_series.rolling(window=window).std()
    z_score = (time_series - rolling_mean) / rolling_std
    return z_score

def classify_behavior(time_series_data):
    """Classify the behavior of each node's time series into 'Over-damped', 'Optimal', or 'Unconstrained'."""
    classifications = {}
    for node, series in time_series_data.items():
        # Convert the series to a DataFrame for ease of processing
        df = pd.DataFrame(series, columns=[node])

        # Calculate rolling z-score
        rolling_z_score = calculate_rolling_z_score(df[node])

        # Check for periodic peaks
        peaks, _ = find_peaks(df[node], height=0.05, distance=10)  # Adding a minimum distance for peak detection
        num_peaks = len(peaks)
        
        # Calculate average rolling z-score
        avg_z_score = rolling_z_score.abs().mean()

        # Classification logic with refined criteria
        if num_peaks > 8 and avg_z_score > 1.2:
            classifications[node] = "Unconstrained"
        elif 0.5 < avg_z_score < 1.2 and 3 <= num_peaks <= 8:
            classifications[node] = "Optimal"
        else:
            classifications[node] = "Over-damped"
    
    return classifications


def stochastic_value_selection(mean, low, high, certainty):
  return blended_uniform_normal(mean, low, high, certainty, 1)[0]

# Create a directed graph using NetworkX
graph = nx.DiGraph()

# Add edges along with their weights, polarities, and delays
for i, (source, target) in enumerate(edges):
    graph.add_edge(source, target, weight=edge_weights[i], polarity=edge_polarities[i], delay=edge_delays[i], certainty=edge_certainties[i])

# Initialize signal_map with current node values
signal_map = {}
time_series_data = {node: [] for node in graph.nodes}
passnodes = set(passnodeList)

# Initialize delay buffers for each edge
delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}

def initialize_signal_map():
    """Initialize the signal map with initial values for each node."""
    for node in graph.nodes:
        if node in passnodes:
            signal_map[node] = 0.0
        else:
            signal_map[node] = random.uniform(0, 1)
    return signal_map



# Retrieve decay and delay ranges from JavaScript
decay_min, decay_max, decay_steps = decayRange
retention_min, retention_max, retention_steps = retentionRange

# Generate ranges for decay factors and delays
decay_factors = np.linspace(decay_min, decay_max, int(decay_steps))
retentions = np.linspace(retention_min, retention_max, int(retention_steps))

total_steps = decay_steps * retention_steps
step_counter = 0

def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
    """Update the signal map based on incoming signals from connected nodes, with optional system-wide delay."""
    global step_counter
    new_signal_map = defaultdict(float)
    previous_signal_map = signal_map.copy()  # Store previous values for consistency

    for edge in graph.edges(data=True):
        predecessor = edge[0]
        node = edge[1]
        edge_data = edge[2]
        weight = edge_data['weight']
        polarity = edge_data['polarity']
        certainty = edge_data['certainty']

        # Set delay based on global or edge-specific delay, only if delay is being used
        delay = global_delay if global_delay is not None else edge_data['delay']

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
		    # Pop the oldest signal from the delay buffer
            if polarity == '+':
                polarity = 1.0
            else:
                polarity = -1.0
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

#    step_counter += 1
#    progress = (step_counter/total_steps) * 100
#    js.updateProgressBar(progress)

    return signal_map

def simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=None, use_delay=True, node_retention=None):
    """Simulate signal transfer for a given number of iterations, with optional global delay."""
    initialize_signal_map()
    for _ in range(iterations):
        accumulate_signals(decay_factor, global_delay=delay, use_delay=use_delay, node_retention=node_retention)
        for node in graph.nodes():
            time_series_data[node].append(signal_map[node])

    return time_series_data

# Initialize stability matrix
stability_matrix = np.zeros((len(retentions), len(decay_factors)))

# Main simulation loop
for i, delay in enumerate(delays):
    for j, retention in enumerate(retentions):
        # Simulate signal transfer for each combination of decay and delay
        signal_map = {}
        time_series_data = {node: [] for node in graph.nodes}
        delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges} 
        time_series_data = simulate_signal_transfer(iterations=100, decay_factor=decay, delay=1, use_delay=False, node_retention=retention)
        
        # Classify node behavior
        classification = classify_behavior(time_series_data)

        # Update stability matrix
        if "Unconstrained" in classification.values():
            stability_matrix[i, j] = 1.0
        elif "Optimal" in classification.values():
            stability_matrix[i, j] = 0.6
        else:
            stability_matrix[i, j] = 0.2

# Plot stability map
plt.figure(figsize=(10, 6))
cmap = plt.cm.coolwarm
norm = mcolors.Normalize(vmin=0, vmax=1)
plt.imshow(stability_matrix, cmap=cmap, norm=norm, extent=[decay_min, decay_max, retention_min, retention_max], origin="lower", aspect="auto")
plt.colorbar(label="Stability Measure")
plt.xlabel("Node Retention Parameter")
plt.ylabel("Decay Parameter")
plt.title("Stability Map")
plt.savefig("stability_map.png")
        `);


		  

        // Retrieve and display plot
        const plotPath = "stability_map.png";
        const file = pyodide.FS.readFile(plotPath, { encoding: "binary" });
        const blob = new Blob([file], { type: "image/png" });
        const url = URL.createObjectURL(blob);

        const img = document.createElement("img");
        img.src = url;

        const plotsContainer = document.getElementById("stabilityMapPlot");
        plotsContainer.innerHTML = ""; // Clear existing content
        plotsContainer.appendChild(img);

    } catch (error) {
        console.error("Error generating stability map:", error);
        alert("An error occurred. Check console for details.");
    } finally {
        hideLoadingSpinner();
        openPage("StabilityMap");
    }
}

document.getElementById("generateRetentionDelay").onclick = async() => {
    showLoadingSpinner();
    await loadInitialData();

    try {
		const retentionMin = parseFloat(document.getElementById("nodeRetentionMin").value);
		const retentionMax = parseFloat(document.getElementById("nodeRetentionMax").value);
		const retentionSteps = parseInt(document.getElementById("nodeRetentionSteps").value);


		const delayMin = parseFloat(document.getElementById("delayMin").value);
		const delayMax = parseFloat(document.getElementById("delayMax").value);
		const delaySteps = parseInt(document.getElementById("delaySteps").value);

		// Construct ranges
		const retentionRange = [retentionMin, retentionMax, retentionSteps];
		const delayRange = [delayMin, delayMax, delaySteps];

		const passnodeList = loopy.model.nodes
		.filter(node => node.isPassNode)
		.map(node => node.label);

		const node_floors = loopy.model.nodes.reduce((acc, node) => {
			acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
			return acc;
		}, {});
		
		const node_ceilings = loopy.model.nodes.reduce((acc, node) => {
			acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
			return acc;
		}, {});


        // Pass decayRange and delayRange to Python
        pyodide.globals.set("retentionRange", retentionRange);
        pyodide.globals.set("delayRange", delayRange);
		pyodide.globals.set("passnodeList", passnodeList);

		pyodide.globals.set("node_floors", pyodide.toPy(node_floors));
		pyodide.globals.set("node_ceilings", pyodide.toPy(node_ceilings));
        await pyodide.runPythonAsync(`

def blended_uniform_normal(mean, low, high, certainty, size=1000):
    max_variance = 1  # Set maximum variance for when certainty is 0
    variance = (1 - certainty) * max_variance  # Variance decreases as certainty increases

    samples = []

    # Continue generating until we get the required number of valid samples
    while len(samples) < size:
        # Generate a mixture of uniform and normal samples
        uniform_sample = np.random.uniform(low=low, high=high)
        normal_sample = np.random.normal(loc=mean, scale=np.sqrt(variance))

        # Blend the two samples based on certainty
        blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample

        # Accept the sample only if it is within the specified range
        if low <= blended_sample <= high:
          samples.append(blended_sample)

    return samples

# Define the classification function
def calculate_rolling_z_score(time_series, window=10):
    """Calculate the rolling z-score for a time series."""
    rolling_mean = time_series.rolling(window=window).mean()
    rolling_std = time_series.rolling(window=window).std()
    z_score = (time_series - rolling_mean) / rolling_std
    return z_score

def classify_behavior(time_series_data):
    """Classify the behavior of each node's time series into 'Over-damped', 'Optimal', or 'Unconstrained'."""
    classifications = {}
    for node, series in time_series_data.items():
        # Convert the series to a DataFrame for ease of processing
        df = pd.DataFrame(series, columns=[node])

        # Calculate rolling z-score
        rolling_z_score = calculate_rolling_z_score(df[node])

        # Check for periodic peaks
        peaks, _ = find_peaks(df[node], height=0.05, distance=10)  # Adding a minimum distance for peak detection
        num_peaks = len(peaks)
        
        # Calculate average rolling z-score
        avg_z_score = rolling_z_score.abs().mean()

        # Classification logic with refined criteria
        if num_peaks > 8 and avg_z_score > 1.2:
            classifications[node] = "Unconstrained"
        elif 0.5 < avg_z_score < 1.2 and 3 <= num_peaks <= 8:
            classifications[node] = "Optimal"
        else:
            classifications[node] = "Over-damped"
    
    return classifications


def stochastic_value_selection(mean, low, high, certainty):
  return blended_uniform_normal(mean, low, high, certainty, 1)[0]

# Create a directed graph using NetworkX
graph = nx.DiGraph()

# Add edges along with their weights, polarities, and delays
for i, (source, target) in enumerate(edges):
    graph.add_edge(source, target, weight=edge_weights[i], polarity=edge_polarities[i], delay=edge_delays[i], certainty=edge_certainties[i])

# Initialize signal_map with current node values
signal_map = {}
time_series_data = {node: [] for node in graph.nodes}
passnodes = set(passnodeList)

# Initialize delay buffers for each edge
delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}

def initialize_signal_map():
    """Initialize the signal map with initial values for each node."""
    for node in graph.nodes:
        if node in passnodes:
            signal_map[node] = 0.0
        else:
            signal_map[node] = random.uniform(0, 1)
    return signal_map

def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
    """Update the signal map based on incoming signals from connected nodes, with optional system-wide delay."""
    new_signal_map = defaultdict(float)
    previous_signal_map = signal_map.copy()  # Store previous values for consistency

    for edge in graph.edges(data=True):
        predecessor = edge[0]
        node = edge[1]
        edge_data = edge[2]
        weight = edge_data['weight']
        polarity = edge_data['polarity']
        certainty = edge_data['certainty']

        # Set delay based on global or edge-specific delay, only if delay is being used
        delay = global_delay if global_delay is not None else edge_data['delay']

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

# Retrieve decay and delay ranges from JavaScript
retention_min, retention_max, retention_steps = retentionRange
delay_min, delay_max, delay_steps = delayRange

# Generate ranges for decay factors and delays
retention_factors = np.linspace(retention_min, retention_max, int(retention_steps))
delays = np.linspace(delay_min, delay_max, int(delay_steps))

# Initialize stability matrix
stability_matrix = np.zeros((len(delays), len(decay_factors)))

# Main simulation loop
for i, delay in enumerate(delays):
    for j, retention in enumerate(retention_factors):
        # Simulate signal transfer for each combination of decay and delay
        signal_map = {}
        time_series_data = {node: [] for node in graph.nodes}
        delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges} 
        time_series_data = simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=int(delay), use_delay=True, node_retention=retention)
        
        # Classify node behavior
        classification = classify_behavior(time_series_data)

        # Update stability matrix
        if "Unconstrained" in classification.values():
            stability_matrix[i, j] = 1.0
        elif "Optimal" in classification.values():
            stability_matrix[i, j] = 0.6
        else:
            stability_matrix[i, j] = 0.2

# Plot stability map
plt.figure(figsize=(10, 6))
cmap = plt.cm.coolwarm
norm = mcolors.Normalize(vmin=0, vmax=1)
plt.imshow(stability_matrix, cmap=cmap, norm=norm, extent=[retention_min, retention_max, delay_min, delay_max], origin="lower", aspect="auto")
plt.colorbar(label="Stability Measure")
plt.xlabel("Retention Parameter")
plt.ylabel("Delay Parameter")
plt.title("Stability Map")
plt.savefig("stability_map.png")
        `);

        // Retrieve and display plot
        const plotPath = "stability_map.png";
        const file = pyodide.FS.readFile(plotPath, { encoding: "binary" });
        const blob = new Blob([file], { type: "image/png" });
        const url = URL.createObjectURL(blob);

        const img = document.createElement("img");
        img.src = url;

        const plotsContainer = document.getElementById("stabilityMapPlot");
        plotsContainer.innerHTML = ""; // Clear existing content
        plotsContainer.appendChild(img);

    } catch (error) {
        console.error("Error generating stability map:", error);
        alert("An error occurred. Check console for details.");
    } finally {
        hideLoadingSpinner();
        openPage("StabilityMap");
    }
}



}
