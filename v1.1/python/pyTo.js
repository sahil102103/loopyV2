async function loadAndExecutePythonScript(){

	const toDisplayWhenPyPackagesLoaded = document.getElementsByClassName('hidden');
	const hiddenElements = document.querySelectorAll('.dropdown.hidden, .dropdown.hidden *');


	for (let i = 0; i < toDisplayWhenPyPackagesLoaded.length; i++) {
		toDisplayWhenPyPackagesLoaded[i].classList.remove('hidden');
	}
	// Remove the 'hidden' class from each selected element
	hiddenElements.forEach(element => {
		element.classList.remove('hidden');
	});

	// spinner.style.display = 'none';
	loadPythonPackages.style.display = 'none';




// 	document.getElementById('randomSeedsTab').onclick = async() => {
// 		showLoadingSpinner();
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
// 	hideLoadingSpinner();
//     openPage('RandomSeeds');
// }

false


// 	document.getElementById('correlationTab').onclick = async() => {
// 		showLoadingSpinner();
// 		await loadInitialData();
// 		pyodide.runPython(`
// plt.figure(figsize=(12, 8))

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
// 	hideLoadingSpinner();
//     openPage('Correlation');
// }

// document.getElementById("stabilityMapTab").onclick = async () => {
//     showLoadingSpinner();
//     await loadInitialData();

//     try {
// 		// Retrieve values from input fields
// 		const decayMin = parseFloat(document.getElementById("decayMin").value);
// 		const decayMax = parseFloat(document.getElementById("decayMax").value);
// 		const decaySteps = parseInt(document.getElementById("decaySteps").value);

// 		const delayMin = parseFloat(document.getElementById("delayMin").value);
// 		const delayMax = parseFloat(document.getElementById("delayMax").value);
// 		const delaySteps = parseInt(document.getElementById("delaySteps").value);
// 		// window.updateProgressBar = updateProgressBar;

// 		// Construct ranges
// 		const decayRange = [decayMin, decayMax, decaySteps];
// 		const delayRange = [delayMin, delayMax, delaySteps];

// 		// Assuming you have a way to determine pass nodes in your application
// 		const passnodeList = loopy.model.nodes
// 		.filter(node => node.isPassNode)
// 		.map(node => node.label);

// 		const node_floors = loopy.model.nodes.reduce((acc, node) => {
// 			acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
// 			return acc;
// 		}, {});
		
// 		const node_ceilings = loopy.model.nodes.reduce((acc, node) => {
// 			acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
// 			return acc;
// 		}, {});


//         // Pass decayRange and delayRange to Python
//         pyodide.globals.set("decayRange", decayRange);
//         pyodide.globals.set("delayRange", delayRange);
// 		pyodide.globals.set("passnodeList", passnodeList);

// 		pyodide.globals.set("node_floors", pyodide.toPy(node_floors));
// 		pyodide.globals.set("node_ceilings", pyodide.toPy(node_ceilings));
//         await pyodide.runPythonAsync(`
// 			def blended_uniform_normal(mean, low, high, certainty, size=1000):
// 				max_variance = 1  # Set maximum variance for when certainty is 0
// 				variance = (1 - certainty) * max_variance  # Variance decreases as certainty increases
			
// 				samples = []
			
// 				# Continue generating until we get the required number of valid samples
// 				while len(samples) < size:
// 					# Generate a mixture of uniform and normal samples
// 					uniform_sample = np.random.uniform(low=low, high=high)
// 					normal_sample = np.random.normal(loc=mean, scale=np.sqrt(variance))
			
// 					# Blend the two samples based on certainty
// 					blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample
			
// 					# Accept the sample only if it is within the specified range
// 					if low <= blended_sample <= high:
// 					  samples.append(blended_sample)
			
// 				return samples
			
// 			# Define the classification function
// 			def calculate_rolling_z_score(time_series, window=10):
// 				"""Calculate the rolling z-score for a time series."""
// 				rolling_mean = time_series.rolling(window=window).mean()
// 				rolling_std = time_series.rolling(window=window).std()
// 				z_score = (time_series - rolling_mean) / rolling_std
// 				return z_score
			
// 			def classify_behavior(time_series_data):
// 				"""Classify the behavior of each node's time series into 'Over-damped', 'Optimal', or 'Unconstrained'."""
// 				classifications = {}
// 				for node, series in time_series_data.items():
// 					# Convert the series to a DataFrame for ease of processing
// 					df = pd.DataFrame(series, columns=[node])
			
// 					# Calculate rolling z-score
// 					rolling_z_score = calculate_rolling_z_score(df[node])
			
// 					# Check for periodic peaks
// 					peaks, _ = find_peaks(df[node], height=0.05, distance=10)  # Adding a minimum distance for peak detection
// 					num_peaks = len(peaks)
					
// 					# Calculate average rolling z-score
// 					avg_z_score = rolling_z_score.abs().mean()
			
// 					# Classification logic with refined criteria
// 					if num_peaks > 8 and avg_z_score > 1.2:
// 						classifications[node] = "Unconstrained"
// 					elif 0.5 < avg_z_score < 1.2 and 3 <= num_peaks <= 8:
// 						classifications[node] = "Optimal"
// 					else:
// 						classifications[node] = "Over-damped"
				
// 				return classifications
			
			
// 			def stochastic_value_selection(mean, low, high, certainty):
// 			  return blended_uniform_normal(mean, low, high, certainty, 1)[0]
			
// 			# Create a directed graph using NetworkX
// 			graph = nx.DiGraph()
			
// 			# Add edges along with their weights, polarities, and delays
// 			for i, (source, target) in enumerate(edges):
// 				graph.add_edge(source, target, weight=edge_weights[i], polarity=edge_polarities[i], delay=edge_delays[i], certainty=edge_certainties[i])
			
// 			# Initialize signal_map with current node values
// 			signal_map = {}
// 			time_series_data = {node: [] for node in graph.nodes}
// 			passnodes = set(passnodeList)
			
// 			# Initialize delay buffers for each edge
// 			delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}
			
// 			def initialize_signal_map():
// 				"""Initialize the signal map with initial values for each node."""
// 				for node in graph.nodes:
// 					if node in passnodes:
// 						signal_map[node] = 0.0
// 					else:
// 						signal_map[node] = random.uniform(0, 1)
// 				return signal_map
			
// 			def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
// 				"""Update the signal map based on incoming signals from connected nodes, with optional system-wide delay."""
// 				new_signal_map = defaultdict(float)
// 				previous_signal_map = signal_map.copy()  # Store previous values for consistency
			
// 				for edge in graph.edges(data=True):
// 					predecessor = edge[0]
// 					node = edge[1]
// 					edge_data = edge[2]
// 					weight = edge_data['weight']
// 					polarity = edge_data['polarity']
// 					certainty = edge_data['certainty']
			
// 					# Set delay based on global or edge-specific delay, only if delay is being used
// 					delay = global_delay if global_delay is not None else edge_data['delay']
			
// 					if use_delay:
// 						# Ensure delay buffer matches the current delay value
// 						if len(delay_buffers[(predecessor, node)]) != delay:
// 							delay_buffers[(predecessor, node)] = [0] * delay
			
// 						# Pop the oldest signal from the delay buffer
// 						delayed_signal = delay_buffers[(predecessor, node)].pop(0)
// 						if polarity == '+':
// 							polarity = 1.0
// 						else:
// 							polarity = -1.0
			
// 						# Calculate the incoming signal with delay
// 						incoming_signal = delayed_signal * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)
// 						# Push the current signal to the delay buffer for the next cycle
// 						delay_buffers[(predecessor, node)].append(previous_signal_map[predecessor])
// 					else:
// 						# Skip delay and use the current signal immediately
// 						incoming_signal = previous_signal_map[predecessor] * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)
			
			
// 					# Accumulate the incoming signal to the target node
// 					new_signal_map[node] += incoming_signal
			
// 				# Update each node's value in signal_map after all calculations
// 				for node in graph.nodes():
// 					floor_value = node_floors.get(node, float('-inf'))
// 					ciel_value = node_ceilings.get(node, float('inf'))
			
// 					# Ensure floor_value and ciel_value are valid numbers
// 					floor_value = floor_value if floor_value is not None else float('-inf')
// 					ciel_value = ciel_value if ciel_value is not None else float('inf')
					
// 					previous_value = float(previous_signal_map[node])
// 					new_value = float(new_signal_map[node])
// 					floor_value = float(floor_value)
// 					ciel_value = float(ciel_value)
			
// 					if node in passnodes:
// 						# For passnodes, the new signal is solely based on incoming signals
// 						signal_map[node] = max(floor_value, min(new_value, ciel_value))
// 					else:
// 						if not node_retention:
// 							signal_map[node] = max(floor_value, min(previous_value * decay_factor + new_value, ciel_value))
// 						else:
// 							signal_map[node] = max(floor_value, min(previous_value * node_retention + new_value, ciel_value))
			
// 				print("passes step 5")
			
// 				return signal_map
			
// 			def simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=None, use_delay=True, node_retention=None):
// 				"""Simulate signal transfer for a given number of iterations, with optional global delay."""
// 				initialize_signal_map()
// 				for _ in range(iterations):
// 					accumulate_signals(decay_factor, global_delay=delay, use_delay=use_delay, node_retention=node_retention)
// 					for node in graph.nodes():
// 						time_series_data[node].append(signal_map[node])
			
// 				return time_series_data
			
// 			# Retrieve decay and delay ranges from JavaScript
// 			decay_min, decay_max, decay_steps = decayRange
// 			delay_min, delay_max, delay_steps = delayRange
			
// 			# Generate ranges for decay factors and delays
// 			decay_factors = np.linspace(decay_min, decay_max, int(decay_steps))
// 			delays = np.linspace(delay_min, delay_max, int(delay_steps))
			
// 			# Initialize stability matrix
// 			stability_matrix = np.zeros((len(delays), len(decay_factors)))
			
// 			# Main simulation loop
// 			for i, delay in enumerate(delays):
// 				for j, decay in enumerate(decay_factors):
// 					# Simulate signal transfer for each combination of decay and delay
// 					signal_map = {}
// 					time_series_data = {node: [] for node in graph.nodes}
// 					delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges} 
// 					time_series_data = simulate_signal_transfer(iterations=100, decay_factor=decay, delay=int(delay), use_delay=True)
					
// 					# Classify node behavior
// 					classification = classify_behavior(time_series_data)
			
// 					# Update stability matrix
// 					if "Unconstrained" in classification.values():
// 						stability_matrix[i, j] = 1.0
// 					elif "Optimal" in classification.values():
// 						stability_matrix[i, j] = 0.6
// 					else:
// 						stability_matrix[i, j] = 0.2
			
// 			# Plot stability map
// 			plt.figure(figsize=(10, 6))
// 			cmap = plt.cm.coolwarm
// 			norm = mcolors.Normalize(vmin=0, vmax=1)
// 			plt.imshow(stability_matrix, cmap=cmap, norm=norm, extent=[decay_min, decay_max, delay_min, delay_max], origin="lower", aspect="auto")
// 			plt.colorbar(label="Stability Measure")
// 			plt.xlabel("Decay Parameter")
// 			plt.ylabel("Delay Parameter")
// 			plt.title("Stability Map")
// 			plt.savefig("stability_map.png")
// 					`);



//         // Retrieve and display plot
//         const plotPath = "stability_map.png";
//         const file = pyodide.FS.readFile(plotPath, { encoding: "binary" });
//         const blob = new Blob([file], { type: "image/png" });
//         const url = URL.createObjectURL(blob);

//         const img = document.createElement("img");
//         img.src = url;

//         const plotsContainer = document.getElementById("stabilityMapPlot");
//         plotsContainer.innerHTML = ""; // Clear existing content
//         plotsContainer.appendChild(img);

//     } catch (error) {
//         console.error("Error generating stability map:", error);
//         alert("An error occurred. Check console for details.");
//     } finally {
//         hideLoadingSpinner();
//         openPage("StabilityMap");
//     }
// };
false

// document.getElementById("updateStabilityMap").onclick = async() => {
//     showLoadingSpinner();
//     await loadInitialData();

//     try {
// 		// Retrieve values from input fields
// 		const decayMin = parseFloat(document.getElementById("decayMin").value);
// 		const decayMax = parseFloat(document.getElementById("decayMax").value);
// 		const decaySteps = parseInt(document.getElementById("decaySteps").value);

// 		const delayMin = parseFloat(document.getElementById("delayMin").value);
// 		const delayMax = parseFloat(document.getElementById("delayMax").value);
// 		const delaySteps = parseInt(document.getElementById("delaySteps").value);

// 		// Construct ranges
// 		const decayRange = [decayMin, decayMax, decaySteps];
// 		const delayRange = [delayMin, delayMax, delaySteps];

// 		const passnodeList = loopy.model.nodes
// 		.filter(node => node.isPassNode)
// 		.map(node => node.label);

// 		const node_floors = loopy.model.nodes.reduce((acc, node) => {
// 			acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
// 			return acc;
// 		}, {});
		
// 		const node_ceilings = loopy.model.nodes.reduce((acc, node) => {
// 			acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
// 			return acc;
// 		}, {});


//         // Pass decayRange and delayRange to Python
//         pyodide.globals.set("decayRange", decayRange);
//         pyodide.globals.set("delayRange", delayRange);
// 		pyodide.globals.set("passnodeList", passnodeList);

// 		pyodide.globals.set("node_floors", pyodide.toPy(node_floors));
// 		pyodide.globals.set("node_ceilings", pyodide.toPy(node_ceilings));
//         await pyodide.runPythonAsync(`

// def blended_uniform_normal(mean, low, high, certainty, size=1000):
//     max_variance = 1  # Set maximum variance for when certainty is 0
//     variance = (1 - certainty) * max_variance  # Variance decreases as certainty increases

//     samples = []

//     # Continue generating until we get the required number of valid samples
//     while len(samples) < size:
//         # Generate a mixture of uniform and normal samples
//         uniform_sample = np.random.uniform(low=low, high=high)
//         normal_sample = np.random.normal(loc=mean, scale=np.sqrt(variance))

//         # Blend the two samples based on certainty
//         blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample

//         # Accept the sample only if it is within the specified range
//         if low <= blended_sample <= high:
//           samples.append(blended_sample)

//     return samples

// # Define the classification function
// def calculate_rolling_z_score(time_series, window=10):
//     """Calculate the rolling z-score for a time series."""
//     rolling_mean = time_series.rolling(window=window).mean()
//     rolling_std = time_series.rolling(window=window).std()
//     z_score = (time_series - rolling_mean) / rolling_std
//     return z_score

// def classify_behavior(time_series_data):
//     """Classify the behavior of each node's time series into 'Over-damped', 'Optimal', or 'Unconstrained'."""
//     classifications = {}
//     for node, series in time_series_data.items():
//         # Convert the series to a DataFrame for ease of processing
//         df = pd.DataFrame(series, columns=[node])

//         # Calculate rolling z-score
//         rolling_z_score = calculate_rolling_z_score(df[node])

//         # Check for periodic peaks
//         peaks, _ = find_peaks(df[node], height=0.05, distance=10)  # Adding a minimum distance for peak detection
//         num_peaks = len(peaks)
        
//         # Calculate average rolling z-score
//         avg_z_score = rolling_z_score.abs().mean()

//         # Classification logic with refined criteria
//         if num_peaks > 8 and avg_z_score > 1.2:
//             classifications[node] = "Unconstrained"
//         elif 0.5 < avg_z_score < 1.2 and 3 <= num_peaks <= 8:
//             classifications[node] = "Optimal"
//         else:
//             classifications[node] = "Over-damped"
    
//     return classifications


// def stochastic_value_selection(mean, low, high, certainty):
//   return blended_uniform_normal(mean, low, high, certainty, 1)[0]

// # Create a directed graph using NetworkX
// graph = nx.DiGraph()

// # Add edges along with their weights, polarities, and delays
// for i, (source, target) in enumerate(edges):
//     graph.add_edge(source, target, weight=edge_weights[i], polarity=edge_polarities[i], delay=edge_delays[i], certainty=edge_certainties[i])

// # Initialize signal_map with current node values
// signal_map = {}
// time_series_data = {node: [] for node in graph.nodes}
// passnodes = set(passnodeList)

// # Initialize delay buffers for each edge
// delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}

// def initialize_signal_map():
//     """Initialize the signal map with initial values for each node."""
//     for node in graph.nodes:
//         if node in passnodes:
//             signal_map[node] = 0.0
//         else:
//             signal_map[node] = random.uniform(0, 1)
//     return signal_map

// def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
//     """Update the signal map based on incoming signals from connected nodes, with optional system-wide delay."""
//     new_signal_map = defaultdict(float)
//     previous_signal_map = signal_map.copy()  # Store previous values for consistency

//     for edge in graph.edges(data=True):
//         predecessor = edge[0]
//         node = edge[1]
//         edge_data = edge[2]
//         weight = edge_data['weight']
//         polarity = edge_data['polarity']
//         certainty = edge_data['certainty']

//         # Set delay based on global or edge-specific delay, only if delay is being used
//         delay = global_delay if global_delay is not None else edge_data['delay']

//         if use_delay:
//             # Ensure delay buffer matches the current delay value
//             if len(delay_buffers[(predecessor, node)]) != delay:
//                 delay_buffers[(predecessor, node)] = [0] * delay

//             # Pop the oldest signal from the delay buffer
//             delayed_signal = delay_buffers[(predecessor, node)].pop(0)
//             if polarity == '+':
//                 polarity = 1.0
//             else:
//                 polarity = -1.0

//             # Calculate the incoming signal with delay
//             incoming_signal = delayed_signal * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)
//             # Push the current signal to the delay buffer for the next cycle
//             delay_buffers[(predecessor, node)].append(previous_signal_map[predecessor])
//         else:
//             # Skip delay and use the current signal immediately
//             incoming_signal = previous_signal_map[predecessor] * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)


//         # Accumulate the incoming signal to the target node
//         new_signal_map[node] += incoming_signal

//     # Update each node's value in signal_map after all calculations
//     for node in graph.nodes():
//         floor_value = node_floors.get(node, float('-inf'))
//         ciel_value = node_ceilings.get(node, float('inf'))

//         # Ensure floor_value and ciel_value are valid numbers
//         floor_value = floor_value if floor_value is not None else float('-inf')
//         ciel_value = ciel_value if ciel_value is not None else float('inf')
		
//         previous_value = float(previous_signal_map[node])
//         new_value = float(new_signal_map[node])
//         floor_value = float(floor_value)
//         ciel_value = float(ciel_value)

//         if node in passnodes:
//             # For passnodes, the new signal is solely based on incoming signals
//             signal_map[node] = max(floor_value, min(new_value, ciel_value))
//         else:
//             if not node_retention:
//                 signal_map[node] = max(floor_value, min(previous_value * decay_factor + new_value, ciel_value))
//             else:
//                 signal_map[node] = max(floor_value, min(previous_value * node_retention + new_value, ciel_value))

//     print("passes step 5")

//     return signal_map

// def simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=None, use_delay=True, node_retention=None):
//     """Simulate signal transfer for a given number of iterations, with optional global delay."""
//     initialize_signal_map()
//     for _ in range(iterations):
//         accumulate_signals(decay_factor, global_delay=delay, use_delay=use_delay, node_retention=node_retention)
//         for node in graph.nodes():
//             time_series_data[node].append(signal_map[node])

//     return time_series_data

// # Retrieve decay and delay ranges from JavaScript
// decay_min, decay_max, decay_steps = decayRange
// delay_min, delay_max, delay_steps = delayRange

// # Generate ranges for decay factors and delays
// decay_factors = np.linspace(decay_min, decay_max, int(decay_steps))
// delays = np.linspace(delay_min, delay_max, int(delay_steps))

// # Initialize stability matrix
// stability_matrix = np.zeros((len(delays), len(decay_factors)))

// # Main simulation loop
// for i, delay in enumerate(delays):
//     for j, decay in enumerate(decay_factors):
//         # Simulate signal transfer for each combination of decay and delay
//         signal_map = {}
//         time_series_data = {node: [] for node in graph.nodes}
//         delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges} 
//         time_series_data = simulate_signal_transfer(iterations=100, decay_factor=decay, delay=int(delay), use_delay=True)
        
//         # Classify node behavior
//         classification = classify_behavior(time_series_data)

//         # Update stability matrix
//         if "Unconstrained" in classification.values():
//             stability_matrix[i, j] = 1.0
//         elif "Optimal" in classification.values():
//             stability_matrix[i, j] = 0.6
//         else:
//             stability_matrix[i, j] = 0.2

// # Plot stability map
// plt.figure(figsize=(10, 6))
// cmap = plt.cm.coolwarm
// norm = mcolors.Normalize(vmin=0, vmax=1)
// plt.imshow(stability_matrix, cmap=cmap, norm=norm, extent=[decay_min, decay_max, delay_min, delay_max], origin="lower", aspect="auto")
// plt.colorbar(label="Stability Measure")
// plt.xlabel("Decay Parameter")
// plt.ylabel("Delay Parameter")
// plt.title("Stability Map")
// plt.savefig("stability_map.png")
//         `);

//         // Retrieve and display plot
//         const plotPath = "stability_map.png";
//         const file = pyodide.FS.readFile(plotPath, { encoding: "binary" });
//         const blob = new Blob([file], { type: "image/png" });
//         const url = URL.createObjectURL(blob);

//         const img = document.createElement("img");
//         img.src = url;

//         const plotsContainer = document.getElementById("stabilityMapPlot");
//         plotsContainer.innerHTML = ""; // Clear existing content
//         plotsContainer.appendChild(img);

//     } catch (error) {
//         console.error("Error generating stability map:", error);
//         alert("An error occurred. Check console for details.");
//     } finally {
//         hideLoadingSpinner();
//         openPage("StabilityMap");
//     }
// }
false

// document.getElementById("generateDecayRetention").onclick = async() => {
//     showLoadingSpinner();

//     await loadInitialData();

//     try {
// 		// updateProgressBar(5);
// 		// Retrieve values from input fields
// 		const decayMin = parseFloat(document.getElementById("decayMin").value);
// 		const decayMax = parseFloat(document.getElementById("decayMax").value);
// 		const decaySteps = parseInt(document.getElementById("decaySteps").value);

// 		const retentionMin = parseFloat(document.getElementById("nodeRetentionMin").value);
// 		const retentionMax = parseFloat(document.getElementById("nodeRetentionMax").value);
// 		const retentionSteps = parseInt(document.getElementById("nodeRetentionSteps").value);

// 		// Construct ranges
// 		const decayRange = [decayMin, decayMax, decaySteps];
// 		const retentionRange = [retentionMin, retentionMax, retentionSteps];

// 		const passnodeList = loopy.model.nodes
// 		.filter(node => node.isPassNode)
// 		.map(node => node.label);

// 		const node_floors = loopy.model.nodes.reduce((acc, node) => {
// 			acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
// 			return acc;
// 		}, {});
		
// 		const node_ceilings = loopy.model.nodes.reduce((acc, node) => {
// 			acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
// 			return acc;
// 		}, {});


//         // Pass decayRange and delayRange to Python
//         pyodide.globals.set("decayRange", decayRange);
//         pyodide.globals.set("retentionRange", retentionRange);
// 		pyodide.globals.set("passnodeList", passnodeList);

// 		pyodide.globals.set("node_floors", pyodide.toPy(node_floors));
// 		pyodide.globals.set("node_ceilings", pyodide.toPy(node_ceilings));
//         await pyodide.runPythonAsync(`
// from time import sleep
// import js  # pyodide's JavaScript bridge

// def blended_uniform_normal(mean, low, high, certainty, size=1000):
//     max_variance = 1  # Set maximum variance for when certainty is 0
//     variance = (1 - certainty) * max_variance  # Variance decreases as certainty increases

//     samples = []

//     # Continue generating until we get the required number of valid samples
//     while len(samples) < size:
//         # Generate a mixture of uniform and normal samples
//         uniform_sample = np.random.uniform(low=low, high=high)
//         normal_sample = np.random.normal(loc=mean, scale=np.sqrt(variance))

//         # Blend the two samples based on certainty
//         blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample

//         # Accept the sample only if it is within the specified range
//         if low <= blended_sample <= high:
//           samples.append(blended_sample)

//     return samples

// # Define the classification function
// def calculate_rolling_z_score(time_series, window=10):
//     """Calculate the rolling z-score for a time series."""
//     rolling_mean = time_series.rolling(window=window).mean()
//     rolling_std = time_series.rolling(window=window).std()
//     z_score = (time_series - rolling_mean) / rolling_std
//     return z_score

// def classify_behavior(time_series_data):
//     """Classify the behavior of each node's time series into 'Over-damped', 'Optimal', or 'Unconstrained'."""
//     classifications = {}
//     for node, series in time_series_data.items():
//         # Convert the series to a DataFrame for ease of processing
//         df = pd.DataFrame(series, columns=[node])

//         # Calculate rolling z-score
//         rolling_z_score = calculate_rolling_z_score(df[node])

//         # Check for periodic peaks
//         peaks, _ = find_peaks(df[node], height=0.05, distance=10)  # Adding a minimum distance for peak detection
//         num_peaks = len(peaks)
        
//         # Calculate average rolling z-score
//         avg_z_score = rolling_z_score.abs().mean()

//         # Classification logic with refined criteria
//         if num_peaks > 8 and avg_z_score > 1.2:
//             classifications[node] = "Unconstrained"
//         elif 0.5 < avg_z_score < 1.2 and 3 <= num_peaks <= 8:
//             classifications[node] = "Optimal"
//         else:
//             classifications[node] = "Over-damped"
    
//     return classifications


// def stochastic_value_selection(mean, low, high, certainty):
//   return blended_uniform_normal(mean, low, high, certainty, 1)[0]

// # Create a directed graph using NetworkX
// graph = nx.DiGraph()

// # Add edges along with their weights, polarities, and delays
// for i, (source, target) in enumerate(edges):
//     graph.add_edge(source, target, weight=edge_weights[i], polarity=edge_polarities[i], delay=edge_delays[i], certainty=edge_certainties[i])

// # Initialize signal_map with current node values
// signal_map = {}
// time_series_data = {node: [] for node in graph.nodes}
// passnodes = set(passnodeList)

// # Initialize delay buffers for each edge
// delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}

// def initialize_signal_map():
//     """Initialize the signal map with initial values for each node."""
//     for node in graph.nodes:
//         if node in passnodes:
//             signal_map[node] = 0.0
//         else:
//             signal_map[node] = random.uniform(0, 1)
//     return signal_map



// # Retrieve decay and delay ranges from JavaScript
// decay_min, decay_max, decay_steps = decayRange
// retention_min, retention_max, retention_steps = retentionRange

// # Generate ranges for decay factors and delays
// decay_factors = np.linspace(decay_min, decay_max, int(decay_steps))
// retentions = np.linspace(retention_min, retention_max, int(retention_steps))

// total_steps = decay_steps * retention_steps
// step_counter = 0

// def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
//     """Update the signal map based on incoming signals from connected nodes, with optional system-wide delay."""
//     global step_counter
//     new_signal_map = defaultdict(float)
//     previous_signal_map = signal_map.copy()  # Store previous values for consistency

//     for edge in graph.edges(data=True):
//         predecessor = edge[0]
//         node = edge[1]
//         edge_data = edge[2]
//         weight = edge_data['weight']
//         polarity = edge_data['polarity']
//         certainty = edge_data['certainty']

//         # Set delay based on global or edge-specific delay, only if delay is being used
//         delay = global_delay if global_delay is not None else edge_data['delay']

//         if use_delay:
//             # Ensure delay buffer matches the current delay value
//             if len(delay_buffers[(predecessor, node)]) != delay:
//                 delay_buffers[(predecessor, node)] = [0] * delay

//             # Pop the oldest signal from the delay buffer
//             delayed_signal = delay_buffers[(predecessor, node)].pop(0)
//             if polarity == '+':
//                 polarity = 1.0
//             else:
//                 polarity = -1.0

//             # Calculate the incoming signal with delay
//             incoming_signal = delayed_signal * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)
//             # Push the current signal to the delay buffer for the next cycle
//             delay_buffers[(predecessor, node)].append(previous_signal_map[predecessor])
//         else:
// 		    # Pop the oldest signal from the delay buffer
//             if polarity == '+':
//                 polarity = 1.0
//             else:
//                 polarity = -1.0
//             # Skip delay and use the current signal immediately
//             incoming_signal = previous_signal_map[predecessor] * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)


//         # Accumulate the incoming signal to the target node
//         new_signal_map[node] += incoming_signal

//     # Update each node's value in signal_map after all calculations
//     for node in graph.nodes():
//         floor_value = node_floors.get(node, float('-inf'))
//         ciel_value = node_ceilings.get(node, float('inf'))

//         # Ensure floor_value and ciel_value are valid numbers
//         floor_value = floor_value if floor_value is not None else float('-inf')
//         ciel_value = ciel_value if ciel_value is not None else float('inf')
		
//         previous_value = float(previous_signal_map[node])
//         new_value = float(new_signal_map[node])
//         floor_value = float(floor_value)
//         ciel_value = float(ciel_value)

//         if node in passnodes:
//             # For passnodes, the new signal is solely based on incoming signals
//             signal_map[node] = max(floor_value, min(new_value, ciel_value))
//         else:
//             if not node_retention:
//                 signal_map[node] = max(floor_value, min(previous_value * decay_factor + new_value, ciel_value))
//             else:
//                 signal_map[node] = max(floor_value, min(previous_value * node_retention + new_value, ciel_value))

// #    step_counter += 1
// #    progress = (step_counter/total_steps) * 100
// #    js.updateProgressBar(progress)

//     return signal_map

// def simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=None, use_delay=True, node_retention=None):
//     """Simulate signal transfer for a given number of iterations, with optional global delay."""
//     initialize_signal_map()
//     for _ in range(iterations):
//         accumulate_signals(decay_factor, global_delay=delay, use_delay=use_delay, node_retention=node_retention)
//         for node in graph.nodes():
//             time_series_data[node].append(signal_map[node])

//     return time_series_data

// # Initialize stability matrix
// stability_matrix = np.zeros((len(retentions), len(decay_factors)))

// # Main simulation loop
// for i, delay in enumerate(delays):
//     for j, retention in enumerate(retentions):
//         # Simulate signal transfer for each combination of decay and delay
//         signal_map = {}
//         time_series_data = {node: [] for node in graph.nodes}
//         delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges} 
//         time_series_data = simulate_signal_transfer(iterations=100, decay_factor=decay, delay=1, use_delay=False, node_retention=retention)
        
//         # Classify node behavior
//         classification = classify_behavior(time_series_data)

//         # Update stability matrix
//         if "Unconstrained" in classification.values():
//             stability_matrix[i, j] = 1.0
//         elif "Optimal" in classification.values():
//             stability_matrix[i, j] = 0.6
//         else:
//             stability_matrix[i, j] = 0.2

// # Plot stability map
// plt.figure(figsize=(10, 6))
// cmap = plt.cm.coolwarm
// norm = mcolors.Normalize(vmin=0, vmax=1)
// plt.imshow(stability_matrix, cmap=cmap, norm=norm, extent=[decay_min, decay_max, retention_min, retention_max], origin="lower", aspect="auto")
// plt.colorbar(label="Stability Measure")
// plt.xlabel("Node Retention Parameter")
// plt.ylabel("Decay Parameter")
// plt.title("Stability Map")
// plt.savefig("stability_map.png")
//         `);


		  

//         // Retrieve and display plot
//         const plotPath = "stability_map.png";
//         const file = pyodide.FS.readFile(plotPath, { encoding: "binary" });
//         const blob = new Blob([file], { type: "image/png" });
//         const url = URL.createObjectURL(blob);

//         const img = document.createElement("img");
//         img.src = url;

//         const plotsContainer = document.getElementById("stabilityMapPlot");
//         plotsContainer.innerHTML = ""; // Clear existing content
//         plotsContainer.appendChild(img);

//     } catch (error) {
//         console.error("Error generating stability map:", error);
//         alert("An error occurred. Check console for details.");
//     } finally {
//         hideLoadingSpinner();
//         openPage("StabilityMap");
//     }
// }
false
// document.getElementById("generateRetentionDelay").onclick = async() => {
//     showLoadingSpinner();
//     await loadInitialData();

//     try {
// 		const retentionMin = parseFloat(document.getElementById("nodeRetentionMin").value);
// 		const retentionMax = parseFloat(document.getElementById("nodeRetentionMax").value);
// 		const retentionSteps = parseInt(document.getElementById("nodeRetentionSteps").value);


// 		const delayMin = parseFloat(document.getElementById("delayMin").value);
// 		const delayMax = parseFloat(document.getElementById("delayMax").value);
// 		const delaySteps = parseInt(document.getElementById("delaySteps").value);

// 		// Construct ranges
// 		const retentionRange = [retentionMin, retentionMax, retentionSteps];
// 		const delayRange = [delayMin, delayMax, delaySteps];

// 		const passnodeList = loopy.model.nodes
// 		.filter(node => node.isPassNode)
// 		.map(node => node.label);

// 		const node_floors = loopy.model.nodes.reduce((acc, node) => {
// 			acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
// 			return acc;
// 		}, {});
		
// 		const node_ceilings = loopy.model.nodes.reduce((acc, node) => {
// 			acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
// 			return acc;
// 		}, {});


//         // Pass decayRange and delayRange to Python
//         pyodide.globals.set("retentionRange", retentionRange);
//         pyodide.globals.set("delayRange", delayRange);
// 		pyodide.globals.set("passnodeList", passnodeList);

// 		pyodide.globals.set("node_floors", pyodide.toPy(node_floors));
// 		pyodide.globals.set("node_ceilings", pyodide.toPy(node_ceilings));
//         await pyodide.runPythonAsync(`

// def blended_uniform_normal(mean, low, high, certainty, size=1000):
//     max_variance = 1  # Set maximum variance for when certainty is 0
//     variance = (1 - certainty) * max_variance  # Variance decreases as certainty increases

//     samples = []

//     # Continue generating until we get the required number of valid samples
//     while len(samples) < size:
//         # Generate a mixture of uniform and normal samples
//         uniform_sample = np.random.uniform(low=low, high=high)
//         normal_sample = np.random.normal(loc=mean, scale=np.sqrt(variance))

//         # Blend the two samples based on certainty
//         blended_sample = (1 - certainty) * uniform_sample + certainty * normal_sample

//         # Accept the sample only if it is within the specified range
//         if low <= blended_sample <= high:
//           samples.append(blended_sample)

//     return samples

// # Define the classification function
// def calculate_rolling_z_score(time_series, window=10):
//     """Calculate the rolling z-score for a time series."""
//     rolling_mean = time_series.rolling(window=window).mean()
//     rolling_std = time_series.rolling(window=window).std()
//     z_score = (time_series - rolling_mean) / rolling_std
//     return z_score

// def classify_behavior(time_series_data):
//     """Classify the behavior of each node's time series into 'Over-damped', 'Optimal', or 'Unconstrained'."""
//     classifications = {}
//     for node, series in time_series_data.items():
//         # Convert the series to a DataFrame for ease of processing
//         df = pd.DataFrame(series, columns=[node])

//         # Calculate rolling z-score
//         rolling_z_score = calculate_rolling_z_score(df[node])

//         # Check for periodic peaks
//         peaks, _ = find_peaks(df[node], height=0.05, distance=10)  # Adding a minimum distance for peak detection
//         num_peaks = len(peaks)
        
//         # Calculate average rolling z-score
//         avg_z_score = rolling_z_score.abs().mean()

//         # Classification logic with refined criteria
//         if num_peaks > 8 and avg_z_score > 1.2:
//             classifications[node] = "Unconstrained"
//         elif 0.5 < avg_z_score < 1.2 and 3 <= num_peaks <= 8:
//             classifications[node] = "Optimal"
//         else:
//             classifications[node] = "Over-damped"
    
//     return classifications


// def stochastic_value_selection(mean, low, high, certainty):
//   return blended_uniform_normal(mean, low, high, certainty, 1)[0]

// # Create a directed graph using NetworkX
// graph = nx.DiGraph()

// # Add edges along with their weights, polarities, and delays
// for i, (source, target) in enumerate(edges):
//     graph.add_edge(source, target, weight=edge_weights[i], polarity=edge_polarities[i], delay=edge_delays[i], certainty=edge_certainties[i])

// # Initialize signal_map with current node values
// signal_map = {}
// time_series_data = {node: [] for node in graph.nodes}
// passnodes = set(passnodeList)

// # Initialize delay buffers for each edge
// delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges}

// def initialize_signal_map():
//     """Initialize the signal map with initial values for each node."""
//     for node in graph.nodes:
//         if node in passnodes:
//             signal_map[node] = 0.0
//         else:
//             signal_map[node] = random.uniform(0, 1)
//     return signal_map

// def accumulate_signals(decay_factor=0.9, global_delay=None, use_delay=True, node_retention=None):
//     """Update the signal map based on incoming signals from connected nodes, with optional system-wide delay."""
//     new_signal_map = defaultdict(float)
//     previous_signal_map = signal_map.copy()  # Store previous values for consistency

//     for edge in graph.edges(data=True):
//         predecessor = edge[0]
//         node = edge[1]
//         edge_data = edge[2]
//         weight = edge_data['weight']
//         polarity = edge_data['polarity']
//         certainty = edge_data['certainty']

//         # Set delay based on global or edge-specific delay, only if delay is being used
//         delay = global_delay if global_delay is not None else edge_data['delay']

//         if use_delay:
//             # Ensure delay buffer matches the current delay value
//             if len(delay_buffers[(predecessor, node)]) != delay:
//                 delay_buffers[(predecessor, node)] = [0] * delay

//             # Pop the oldest signal from the delay buffer
//             delayed_signal = delay_buffers[(predecessor, node)].pop(0)
//             if polarity == '+':
//                 polarity = 1.0
//             else:
//                 polarity = -1.0

//             # Calculate the incoming signal with delay
//             incoming_signal = delayed_signal * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)
//             # Push the current signal to the delay buffer for the next cycle
//             delay_buffers[(predecessor, node)].append(previous_signal_map[predecessor])
//         else:
//             # Skip delay and use the current signal immediately
//             incoming_signal = previous_signal_map[predecessor] * decay_factor * weight * stochastic_value_selection(polarity, -1, 1, certainty)


//         # Accumulate the incoming signal to the target node
//         new_signal_map[node] += incoming_signal

//     # Update each node's value in signal_map after all calculations
//     for node in graph.nodes():
//         floor_value = node_floors.get(node, float('-inf'))
//         ciel_value = node_ceilings.get(node, float('inf'))

//         # Ensure floor_value and ciel_value are valid numbers
//         floor_value = floor_value if floor_value is not None else float('-inf')
//         ciel_value = ciel_value if ciel_value is not None else float('inf')
		
//         previous_value = float(previous_signal_map[node])
//         new_value = float(new_signal_map[node])
//         floor_value = float(floor_value)
//         ciel_value = float(ciel_value)

//         if node in passnodes:
//             # For passnodes, the new signal is solely based on incoming signals
//             signal_map[node] = max(floor_value, min(new_value, ciel_value))
//         else:
//             if not node_retention:
//                 signal_map[node] = max(floor_value, min(previous_value * decay_factor + new_value, ciel_value))
//             else:
//                 signal_map[node] = max(floor_value, min(previous_value * node_retention + new_value, ciel_value))

//     return signal_map

// def simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=None, use_delay=True, node_retention=None):
//     """Simulate signal transfer for a given number of iterations, with optional global delay."""
//     initialize_signal_map()
//     for _ in range(iterations):
//         accumulate_signals(decay_factor, global_delay=delay, use_delay=use_delay, node_retention=node_retention)
//         for node in graph.nodes():
//             time_series_data[node].append(signal_map[node])

//     return time_series_data

// # Retrieve decay and delay ranges from JavaScript
// retention_min, retention_max, retention_steps = retentionRange
// delay_min, delay_max, delay_steps = delayRange

// # Generate ranges for decay factors and delays
// retention_factors = np.linspace(retention_min, retention_max, int(retention_steps))
// delays = np.linspace(delay_min, delay_max, int(delay_steps))

// # Initialize stability matrix
// stability_matrix = np.zeros((len(delays), len(decay_factors)))

// # Main simulation loop
// for i, delay in enumerate(delays):
//     for j, retention in enumerate(retention_factors):
//         # Simulate signal transfer for each combination of decay and delay
//         signal_map = {}
//         time_series_data = {node: [] for node in graph.nodes}
//         delay_buffers = {(edge[0], edge[1]): [0] * graph.edges[edge]['delay'] for edge in graph.edges} 
//         time_series_data = simulate_signal_transfer(iterations=100, decay_factor=0.9, delay=int(delay), use_delay=True, node_retention=retention)
        
//         # Classify node behavior
//         classification = classify_behavior(time_series_data)

//         # Update stability matrix
//         if "Unconstrained" in classification.values():
//             stability_matrix[i, j] = 1.0
//         elif "Optimal" in classification.values():
//             stability_matrix[i, j] = 0.6
//         else:
//             stability_matrix[i, j] = 0.2

// # Plot stability map
// plt.figure(figsize=(10, 6))
// cmap = plt.cm.coolwarm
// norm = mcolors.Normalize(vmin=0, vmax=1)
// plt.imshow(stability_matrix, cmap=cmap, norm=norm, extent=[retention_min, retention_max, delay_min, delay_max], origin="lower", aspect="auto")
// plt.colorbar(label="Stability Measure")
// plt.xlabel("Retention Parameter")
// plt.ylabel("Delay Parameter")
// plt.title("Stability Map")
// plt.savefig("stability_map.png")
//         `);

//         // Retrieve and display plot
//         const plotPath = "stability_map.png";
//         const file = pyodide.FS.readFile(plotPath, { encoding: "binary" });
//         const blob = new Blob([file], { type: "image/png" });
//         const url = URL.createObjectURL(blob);

//         const img = document.createElement("img");
//         img.src = url;

//         const plotsContainer = document.getElementById("stabilityMapPlot");
//         plotsContainer.innerHTML = ""; // Clear existing content
//         plotsContainer.appendChild(img);

//     } catch (error) {
//         console.error("Error generating stability map:", error);
//         alert("An error occurred. Check console for details.");
//     } finally {
//         hideLoadingSpinner();
//         openPage("StabilityMap");
//     }
// }



}
