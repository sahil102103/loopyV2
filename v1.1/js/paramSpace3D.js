/**
 * 3D Parameter Space Analysis Module
 * Implements the 3D parameter space visualization from the Jupyter notebook
 */

class ParamSpace3D {
    constructor() {
        this.isInitialized = false;
        this.currentResults = null;
        this.cldEngineReady = false;
        this.setupEventListeners();
        this.waitForCLDEngine();
    }

    waitForCLDEngine() {
        // Check if CLD Engine is available
        if (typeof CLDEngine !== 'undefined') {
            this.cldEngineReady = true;
            this.updateButtonStates();
            return;
        }
        
        // Show loading state
        this.updateButtonStates();
        
        // Wait for CLD Engine to be available
        const checkInterval = setInterval(() => {
            if (typeof CLDEngine !== 'undefined') {
                this.cldEngineReady = true;
                console.log('3D Parameter Space: CLD Engine is ready');
                this.updateButtonStates();
                clearInterval(checkInterval);
            }
        }, 100);
        
        // Timeout after 5 seconds
        setTimeout(() => {
            if (!this.cldEngineReady) {
                console.warn('3D Parameter Space: CLD Engine not available, using fallback');
                this.cldEngineReady = true; // Allow fallback mode
                this.updateButtonStates();
                clearInterval(checkInterval);
            }
        }, 5000);
    }

    updateButtonStates() {
        const generateBtn = document.getElementById('generate3DParamSpace');
        const statusDiv = document.getElementById('pythonStatus');
        
        if (generateBtn) {
            if (this.cldEngineReady) {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate 3D Parameter Space';
                generateBtn.title = 'Ready to generate 3D parameter space analysis';
            } else {
                generateBtn.disabled = true;
                generateBtn.textContent = 'Loading Analysis Engine...';
                generateBtn.title = 'Please wait for analysis engine to initialize';
            }
        }
        
        if (statusDiv) {
            if (this.cldEngineReady) {
                statusDiv.innerHTML = '<div class="success">Analysis engine ready!</div>';
            } else {
                statusDiv.innerHTML = '<div class="loading">Initializing analysis engine...</div>';
            }
        }
    }

    setupEventListeners() {
        // Generate 3D Parameter Space button
        const generateBtn = document.getElementById('generate3DParamSpace');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.generate3DParamSpace());
        }

        // Export Results button
        const exportBtn = document.getElementById('export3DResults');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportResults());
        }

        // Reset Parameters button
        const resetBtn = document.getElementById('reset3DParams');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetToDefaults());
        }
    }

    async generate3DParamSpace() {
        const statusDiv = document.getElementById('paramSpace3DStatus');
        const plotsDiv = document.getElementById('paramSpace3DPlots');
        const tableDiv = document.getElementById('paramSpace3DTable');
        const generateBtn = document.getElementById('generate3DParamSpace');

        try {
            // Disable button and show loading status
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';
            statusDiv.innerHTML = '<div class="loading">Generating 3D Parameter Space Analysis...</div>';
            plotsDiv.innerHTML = '';
            tableDiv.innerHTML = '';

            // Get parameters from UI
            const params = this.getParameters();
            
            // Validate parameters
            if (!this.validateParameters(params)) {
                throw new Error('Invalid parameters. Please check your input values.');
            }

            // Check if CLD Engine is ready
            if (!this.cldEngineReady) {
                throw new Error('Analysis engine is not ready. Please wait for initialization.');
            }

            // Update status with progress
            statusDiv.innerHTML = '<div class="loading">Preparing analysis parameters...</div>';

            // Run the 3D parameter space analysis
            const results = await this.run3DParamSpaceAnalysis(params);
            this.currentResults = results;

            // Update status
            statusDiv.innerHTML = '<div class="loading">Rendering visualizations...</div>';

            // Display results
            this.displayResults(results);
            
            statusDiv.innerHTML = '<div class="success">3D Parameter Space Analysis completed successfully!</div>';

        } catch (error) {
            console.error('Error in 3D Parameter Space Analysis:', error);
            statusDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        } finally {
            // Re-enable button
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate 3D Parameter Space';
        }
    }

    getParameters() {
        return {
            retention: {
                min: parseFloat(document.getElementById('retentionMin').value),
                max: parseFloat(document.getElementById('retentionMax').value),
                steps: parseInt(document.getElementById('retentionSteps').value)
            },
            decay: {
                min: parseFloat(document.getElementById('decayMin3D').value),
                max: parseFloat(document.getElementById('decayMax3D').value),
                steps: parseInt(document.getElementById('decaySteps3D').value)
            },
            delay: {
                min: parseInt(document.getElementById('delayMin3D').value),
                max: parseInt(document.getElementById('delayMax3D').value),
                steps: parseInt(document.getElementById('delaySteps3D').value)
            },
            simulation: {
                iterations: parseInt(document.getElementById('iterations3D').value),
                zWindow: parseInt(document.getElementById('zWindow3D').value)
            },
            weights: {
                distance: parseFloat(document.getElementById('weightDist3D').value),
                zScore: parseFloat(document.getElementById('weightZ3D').value),
                shape: parseFloat(document.getElementById('weightShape3D').value)
            }
        };
    }

    validateParameters(params) {
        // Check retention range
        if (params.retention.min < 0 || params.retention.max > 1 || params.retention.min >= params.retention.max) {
            return false;
        }
        
        // Check decay range
        if (params.decay.min < 0 || params.decay.max > 1 || params.decay.min >= params.decay.max) {
            return false;
        }
        
        // Check delay range
        if (params.delay.min < 0 || params.delay.max < params.delay.min) {
            return false;
        }
        
        // Check steps
        if (params.retention.steps < 2 || params.decay.steps < 2 || params.delay.steps < 2) {
            return false;
        }
        
        // Check weights sum to 1
        const weightSum = params.weights.distance + params.weights.zScore + params.weights.shape;
        if (Math.abs(weightSum - 1.0) > 0.01) {
            return false;
        }
        
        return true;
    }

    async run3DParamSpaceAnalysis(params) {
        // Generate parameter grids
        const retentionVals = this.linspace(params.retention.min, params.retention.max, params.retention.steps);
        const decayVals = this.linspace(params.decay.min, params.decay.max, params.decay.steps);
        const delayVals = this.linspace(params.delay.min, params.delay.max, params.delay.steps);

        // Get current graph from the main application
        const graph = this.getCurrentGraph();
        if (!graph || !graph.nodes || graph.nodes.length === 0) {
            throw new Error('No graph available. Please create a graph first.');
        }

        // Check if we have enough nodes and edges for meaningful analysis
        if (graph.nodes.length < 2) {
            throw new Error('Graph must have at least 2 nodes for parameter space analysis.');
        }

        // Run the Python-style stack-of-2D-maps analysis
        const results = await this.runStackOf2DMapsAnalysis(params, retentionVals, decayVals, delayVals, graph);
        
        return {
            retentionVals,
            decayVals,
            delayVals,
            results: results,
            parameters: params
        };
    }

    /**
     * Python-style stack-of-2D-maps approach for 3D parameter space analysis
     * This is much more efficient than the nested loop approach
     */
    async runStackOf2DMapsAnalysis(params, retentionVals, decayVals, delayVals, graph) {
        const results = [];
        const totalRetentionSteps = retentionVals.length;
        
        console.log(`Running stack-of-2D-maps analysis: ${totalRetentionSteps} retention slices`);
        
        // For each retention value, run a full 2D analysis across decay and delay
        for (let rIdx = 0; rIdx < retentionVals.length; rIdx++) {
            const retention = retentionVals[rIdx];
            
            // Update progress
            const progress = ((rIdx + 1) / totalRetentionSteps) * 100;
            const statusDiv = document.getElementById('paramSpace3DStatus');
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="loading">Processing retention slice ${rIdx + 1}/${totalRetentionSteps} (${progress.toFixed(1)}%)...</div>`;
            }
            
            console.log(`Processing retention slice ${rIdx + 1}/${totalRetentionSteps}: retention=${retention}`);
            
            // Run 2D analysis for this retention value
            const sliceResults = await this.run2DSliceAnalysis(params, retention, decayVals, delayVals, graph);
            results.push(...sliceResults);
        }
        
        return results;
    }

    /**
     * Run 2D analysis for a single retention value
     */
    async run2DSliceAnalysis(params, retention, decayVals, delayVals, graph) {
        const results = [];
        const totalCombinations = decayVals.length * delayVals.length;
        let currentCombination = 0;
        
        // Create CLD Engine instance for this slice
        const cldEngine = new CLDEngine();
        
        for (const decay of decayVals) {
            for (const delay of delayVals) {
                currentCombination++;
                
                try {
                    // Create modified graph with current parameters
                    const modifiedGraph = this.createModifiedGraph(graph, retention, decay, delay);
                    
                    // Initialize CLD Engine with modified graph
                    cldEngine.initializeGraph(modifiedGraph);
                    
                    // Run simulation
                    const simulation = cldEngine.simulateTwoPhase({
                        steps: params.simulation.iterations || 100
                    });
                    
                    // Compute stability metrics using the new methods
                    const { matrix } = cldEngine.computeAdjacencyMatrixStability(decay);
                    const { distanceMetric, maxMagnitude } = cldEngine.analyzeEigenvaluesStability(matrix);
                    
                    // Compute Z-score metrics
                    let maxZScore = 0;
                    let avgShapePenalty = 0;
                    let nodeCount = 0;
                    
                    for (const [nodeId, series] of Object.entries(simulation.history)) {
                        if (series.length >= params.simulation.zWindow) {
                            const zScores = cldEngine.rollingZ(series, params.simulation.zWindow);
                            const maxAbsZ = Math.max(...zScores.map(z => Math.abs(z)));
                            maxZScore = Math.max(maxZScore, maxAbsZ);
                            
                            const shapePenalty = cldEngine.computeShapePenalty(zScores);
                            avgShapePenalty += shapePenalty;
                            nodeCount++;
                        }
                    }
                    
                    avgShapePenalty = nodeCount > 0 ? avgShapePenalty / nodeCount : 0;
                    
                    // Flatness penalty
                    const flatPenalty = maxZScore < 0.05 ? 2.0 : 0.0;
                    
                    // Combined score (matching Python implementation)
                    const combinedScore = (
                        params.weights.distance * distanceMetric +
                        params.weights.zScore * maxZScore +
                        params.weights.shape * avgShapePenalty +
                        flatPenalty
                    );
                    
                    // Classify behavior
                    const behavior = cldEngine.classifyBehavior(simulation.history);
                    
                    results.push({
                        retention,
                        decay,
                        delay,
                        metrics: {
                            distance: distanceMetric,
                            zScore: maxZScore,
                            shape: avgShapePenalty,
                            flat: flatPenalty,
                            combined: combinedScore
                        },
                        behavior,
                        simulation: simulation.history,
                        maxMagnitude
                    });
                    
                } catch (error) {
                    console.warn(`Error processing combination retention=${retention}, decay=${decay}, delay=${delay}:`, error);
                    // Continue with next combination
                }
            }
        }
        
        return results;
    }

    async runCLDEngineAnalysis(params, retentionVals, decayVals, delayVals, graph) {
        const results = [];
        const totalCombinations = retentionVals.length * decayVals.length * delayVals.length;
        let currentCombination = 0;
        
        for (const retention of retentionVals) {
            for (const decay of decayVals) {
                for (const delay of delayVals) {
                    currentCombination++;
                    
                    // Update progress
                    const progress = (currentCombination / totalCombinations) * 100;
                    const statusDiv = document.getElementById('paramSpace3DStatus');
                    if (statusDiv) {
                        statusDiv.innerHTML = `<div class="loading">Analyzing parameter combination ${currentCombination}/${totalCombinations} (${progress.toFixed(1)}%)...</div>`;
                    }

                    try {
                        // Create modified graph with current parameters
                        const modifiedGraph = this.createModifiedGraph(graph, retention, decay, delay);
                        
                        // Debug: Log parameter values being used
                        console.log(`Parameter combination ${currentCombination}: retention=${retention}, decay=${decay}, delay=${delay}`);
                        
                        // Create NEW CLD Engine instance for each parameter combination
                        // This prevents state persistence between simulations
                        const cldEngine = new CLDEngine();
                        
                        // Initialize CLD Engine with modified graph
                        cldEngine.initializeGraph(modifiedGraph);
                        
                        // Run simulation
                        const simulation = cldEngine.simulateTwoPhase({
                            steps: params.iterations || 100
                        });
                        
                        // Classify behavior
                        const behavior = cldEngine.classifyBehavior(simulation.history);
                        
                        // Calculate stability score
                        const stability = this.calculateStabilityScore(behavior, simulation.history);
                        
                        // Calculate distance metric
                        const distance = this.calculateDistanceMetric(simulation.history, params);
                        
                        // Calculate Z-score metric
                        const zScore = this.calculateZScoreMetric(simulation.history, params);
                        
                        // Calculate shape metric
                        const shape = this.calculateShapeMetric(simulation.history, params);
                        
                        // Combined score
                        const combinedScore = (
                            params.weights.distance * distance +
                            params.weights.zScore * zScore +
                            params.weights.shape * shape
                        );

                        results.push({
                            retention,
                            decay,
                            delay,
                            stability,
                            behavior: behavior,
                            simulation: simulation.history,
                            metrics: {
                                distance,
                                zScore,
                                shape,
                                combinedScore
                            }
                        });
                        
                    } catch (error) {
                        console.warn(`Analysis failed for retention=${retention}, decay=${decay}, delay=${delay}:`, error);
                        // Add failed result
                        results.push({
                            retention,
                            decay,
                            delay,
                            stability: 0,
                            behavior: { error: error.message },
                            simulation: null,
                            metrics: {
                                distance: 0,
                                zScore: 0,
                                shape: 0,
                                combinedScore: 0
                            }
                        });
                    }
                }
            }
        }

        return results;
    }

    createModifiedGraph(originalGraph, retention, decay, delay) {
        // Convert Loopy graph to CLD Engine format with modified parameters
        const modifiedGraph = {
            nodes: {},
            edges: []
        };

        // Convert nodes with modified retention
        // Handle both array format (from getCurrentGraph) and object format
        const nodes = Array.isArray(originalGraph.nodes) ? originalGraph.nodes : Object.values(originalGraph.nodes);
        for (const node of nodes) {
            modifiedGraph.nodes[node.id] = {
                startAmount: node.start_amount || node.init || node.value || 0.5,
                retention: retention, // Use parameter value
                floor: node.floor !== undefined ? node.floor : -Infinity,
                ceiling: node.ceiling !== undefined ? node.ceiling : Infinity,
                formula: node.formula || null,
                sinkFormula: node.sinkFormula || null,
                sourceFormula: node.sourceFormula || null
            };
        }
        
        // Debug: Log first node to verify retention is applied
        const firstNodeId = Object.keys(modifiedGraph.nodes)[0];
        if (firstNodeId) {
            console.log(`Node ${firstNodeId} retention set to: ${modifiedGraph.nodes[firstNodeId].retention}`);
        }

        // Convert edges with modified decay and delay
        // Handle both array format (from getCurrentGraph) and object format
        const edges = Array.isArray(originalGraph.edges) ? originalGraph.edges : originalGraph.edges;
        for (const edge of edges) {
            // Handle different edge formats
            const fromId = edge.from?.id || edge.from;
            const toId = edge.to?.id || edge.to;
            
            if (fromId && toId) {
                modifiedGraph.edges.push({
                    from: fromId,
                    to: toId,
                    correlation: edge.strength || 1.0,
                    decay: decay, // Use parameter value
                    confidence: edge.confidence || 1.0,
                    delay: delay // Use parameter value
                });
            }
        }
        
        // Debug: Log first edge to verify decay and delay are applied
        if (modifiedGraph.edges.length > 0) {
            const firstEdge = modifiedGraph.edges[0];
            console.log(`Edge ${firstEdge.from}->${firstEdge.to}: decay=${firstEdge.decay}, delay=${firstEdge.delay}`);
        }

        return modifiedGraph;
    }

    calculateStabilityScore(behavior, history) {
        // Calculate stability based on behavior classification
        let stability = 0;
        
        for (const [nodeId, classification] of Object.entries(behavior)) {
            switch (classification.behavior) {
                case 'Optimal':
                    stability += 1.0;
                    break;
                case 'Overdamped':
                    stability += 0.7;
                    break;
                case 'Damped Oscillatory':
                    stability += 0.5;
                    break;
                case 'Oscillatory':
                    stability += 0.3;
                    break;
                case 'Unconstrained':
                    stability += 0.1;
                    break;
                default:
                    stability += 0.2;
            }
        }
        
        return stability / Object.keys(behavior).length;
    }

    calculateDistanceMetric(history, params) {
        // Calculate distance metric based on final vs initial values
        let totalDistance = 0;
        let nodeCount = 0;
        
        for (const [nodeId, series] of Object.entries(history)) {
            if (series.length > 0) {
                const initial = series[0];
                const final = series[series.length - 1];
                const distance = Math.abs(final - initial);
                totalDistance += distance;
                nodeCount++;
            }
        }
        
        return nodeCount > 0 ? totalDistance / nodeCount : 0;
    }

    calculateZScoreMetric(history, params) {
        // Calculate Z-score metric based on rolling Z-scores
        let totalZScore = 0;
        let nodeCount = 0;
        
        for (const [nodeId, series] of Object.entries(history)) {
            if (series.length >= params.simulation.zWindow) {
                const zScores = this.calculateRollingZScores(series, params.simulation.zWindow);
                const maxZScore = Math.max(...zScores.map(Math.abs));
                totalZScore += maxZScore;
                nodeCount++;
            }
        }
        
        return nodeCount > 0 ? totalZScore / nodeCount : 0;
    }

    calculateShapeMetric(history, params) {
        // Calculate shape metric based on curve characteristics
        let totalShape = 0;
        let nodeCount = 0;
        
        for (const [nodeId, series] of Object.entries(history)) {
            if (series.length > 1) {
                const shape = this.calculateCurveShape(series);
                totalShape += shape;
                nodeCount++;
            }
        }
        
        return nodeCount > 0 ? totalShape / nodeCount : 0;
    }

    calculateRollingZScores(series, window) {
        const zScores = [];
        
        for (let i = window; i < series.length; i++) {
            const windowData = series.slice(i - window, i);
            const mean = windowData.reduce((a, b) => a + b, 0) / window;
            const variance = windowData.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window;
            const stdDev = Math.sqrt(variance);
            
            if (stdDev > 0) {
                zScores.push((series[i] - mean) / stdDev);
            } else {
                zScores.push(0);
            }
        }
        
        return zScores;
    }

    calculateCurveShape(series) {
        // Calculate curve shape characteristics
        if (series.length < 3) return 0;
        
        let curvature = 0;
        for (let i = 1; i < series.length - 1; i++) {
            const prev = series[i - 1];
            const curr = series[i];
            const next = series[i + 1];
            
            // Calculate second derivative approximation
            const secondDeriv = next - 2 * curr + prev;
            curvature += Math.abs(secondDeriv);
        }
        
        return curvature / (series.length - 2);
    }

    generatePythonCode(params, retentionVals, decayVals, delayVals, graph) {
        return `
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from scipy.stats import rankdata
import json

# Convert graph to NetworkX format
import networkx as nx

# Create the graph
G = nx.DiGraph()

# Add nodes
for node in ${JSON.stringify(graph.nodes)}:
    G.add_node(node, start_amount=0.1, retention=0.3, floor=-np.inf, ceiling=np.inf)

# Add edges
edges = ${JSON.stringify(graph.edges)}
for edge in edges:
    G.add_edge(edge[0], edge[1], 
               correlation=edge[2] if len(edge) > 2 else 1.0,
               decay=0.165, confidence=0.8, delay=4)

# Parameter grids
retention_vals = np.array(${JSON.stringify(retentionVals)})
decay_vals = np.array(${JSON.stringify(decayVals)})
delay_vals = np.array(${JSON.stringify(delayVals)}, dtype=int)

# Simulation parameters
iterations = ${params.simulation.iterations}
z_window = ${params.simulation.zWindow}
weight_dist = ${params.weights.distance}
weight_z = ${params.weights.zScore}
weight_shape = ${params.weights.shape}

# Helper functions (simplified versions from the notebook)
def simulate_two_phase(G, init_vals, steps):
    hist = {n: [init_vals.get(n, 0.0)] for n in G}
    
    for t in range(steps):
        nxt = {n: 0.0 for n in G}
        
        # Phase A - retention + delayed inflows
        for n in G:
            ret = G.nodes[n].get("retention", 1.0)
            nxt[n] += ret * hist[n][t]
        
        for u, v, e in G.edges(data=True):
            delay_e = e.get("delay", 0)
            src_t = t - delay_e
            src_v = hist[u][src_t] if src_t >= 0 else 0.0
            corr = e.get("correlation", 1.0)
            decay = e.get("decay", 0.0)
            nxt[v] += src_v * corr * (1.0 - decay)
        
        # Phase B - commit values
        for n in G:
            hist[n].append(nxt[n])
    
    return hist

def rolling_z(series, window=10):
    s = pd.Series(series)
    mu = s.rolling(window, min_periods=1).mean()
    sd = s.rolling(window, min_periods=1).std(ddof=0).replace(0, 1e-12)
    return ((s - mu) / sd).fillna(0)

def compute_shape_penalty(z_series, flat_tol=0.05, extreme_tol=2.0, oscillation_tol=3):
    penalty = 0.0
    
    mean_abs_z = np.mean(np.abs(z_series))
    if mean_abs_z < flat_tol:
        penalty += 2.0
    
    max_abs_z = np.max(np.abs(z_series))
    if max_abs_z > extreme_tol:
        penalty += (max_abs_z - extreme_tol)
    
    zero_crossings = np.sum(np.diff(np.sign(z_series)) != 0)
    if zero_crossings > oscillation_tol:
        penalty += (zero_crossings - oscillation_tol) * 0.5
    
    return penalty

def compute_adjacency_matrix_stability(graph, decay_factor):
    nodes = list(graph.nodes)
    idx = {n: i for i, n in enumerate(nodes)}
    A = np.zeros((len(nodes), len(nodes)))
    
    retention = 1.0 - decay_factor
    for n in nodes:
        A[idx[n], idx[n]] = retention
    
    for u, v, d in graph.edges(data=True):
        corr = d.get("correlation", 1.0)
        A[idx[v], idx[u]] += decay_factor * corr
    
    return A, nodes

def analyze_eigenvalues_stability(A):
    eigvals = np.linalg.eigvals(A)
    mags = np.abs(eigvals)
    max_mag = mags.max()
    avg_mag = mags.mean()
    dist_metric = abs(1 - avg_mag)
    return eigvals, dist_metric, max_mag

def is_stable(dist, tol=0.10):
    return dist < tol

# Main analysis loop
rows = []
dist_tol = 0.10

for r_i, ret in enumerate(retention_vals):
    print(f"Processing retention slice {r_i+1}/{len(retention_vals)} (ret={ret:.2f})")
    
    for i, delay in enumerate(delay_vals):
        for j, decay in enumerate(decay_vals):
            # Create modified graph
            G_mod = G.copy()
            
            # Set retention
            for n in G_mod.nodes:
                G_mod.nodes[n]["retention"] = ret
            
            # Set decay and delay
            for u, v in G_mod.edges:
                G_mod[u][v]["decay"] = decay
                G_mod[u][v]["delay"] = int(delay)
            
            # Eigenvalue analysis
            A, _ = compute_adjacency_matrix_stability(G_mod, decay)
            _, dist_metric, max_mag = analyze_eigenvalues_stability(A)
            
            # Stability penalty
            penalty_metric = 1.0
            if not is_stable(dist_metric, dist_tol):
                dist_metric = penalty_metric
            
            # Run simulation
            init_vals = {n: G_mod.nodes[n]["start_amount"] for n in G_mod}
            hist = simulate_two_phase(G_mod, init_vals, iterations)
            
            # Calculate Z-scores and shape penalties
            max_abs_z = 0
            avg_shape_penalty = 0
            node_count = 0
            
            for node, series in hist.items():
                z_series = rolling_z(series, window=z_window)
                max_abs_z = max(max_abs_z, np.max(np.abs(z_series)))
                avg_shape_penalty += compute_shape_penalty(z_series)
                node_count += 1
            
            if node_count > 0:
                avg_shape_penalty /= node_count
            
            # Flatness penalty
            flat_penalty = 2.0 if max_abs_z < 0.05 else 0.0
            
            # Combined score
            combo = (weight_dist * dist_metric + 
                    weight_z * max_abs_z + 
                    weight_shape * avg_shape_penalty + 
                    flat_penalty)
            
            rows.append({
                "decay": float(decay),
                "delay": int(delay),
                "ret": float(ret),
                "combo": combo,
                "dist": dist_metric,
                "z": max_abs_z,
                "shape": avg_shape_penalty,
                "flat": flat_penalty
            })

# Create DataFrame
df = pd.DataFrame(rows)

# Rank into 11 discrete bins
r = rankdata(df["combo"].to_numpy(), method="min") - 1
df["rank_bin"] = (r * 10 / max(r.max(), 1)).astype(int)

# Color palette (coolwarm_r)
colors = ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', 
          '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061']
df["color"] = [colors[min(b, 10)] for b in df["rank_bin"]]

# Get top results
top_k = 25
top = df.nsmallest(top_k, "combo").copy()

# Create 3D scatter plot
fig3d = go.Figure()
fig3d.add_trace(go.Scatter3d(
    x=df["decay"], y=df["delay"], z=df["ret"],
    mode="markers",
    marker=dict(size=3, color=df["color"]),
    name="all",
    hovertemplate="Decay: %{x}<br>Delay: %{y}<br>Retention: %{z}<br>Score: %{customdata}<extra></extra>",
    customdata=df["combo"]
))

fig3d.add_trace(go.Scatter3d(
    x=top["decay"], y=top["delay"], z=top["ret"],
    mode="markers+text",
    text=[f"{i+1}" for i in range(len(top))],
    textposition="top center",
    marker=dict(size=6, symbol="diamond", color="black", line=dict(width=1)),
    name=f"best {top_k}",
    hovertemplate="Decay: %{x}<br>Delay: %{y}<br>Retention: %{z}<br>Rank: %{text}<extra></extra>"
))

fig3d.update_layout(
    scene=dict(
        xaxis_title="Decay Factor",
        yaxis_title="Delay (timesteps)",
        zaxis_title="Retention"
    ),
    title="3D Parameter Space Analysis",
    legend=dict(orientation="h", x=0, y=1.1)
)

# Create 2D slice plot
df2 = df.copy()
df2["rank_bin_str"] = df2["rank_bin"].astype(str)
color_map = {str(i): colors[i] for i in range(11)}

fig2d = px.scatter(
    df2,
    x="decay", y="ret",
    animation_frame="delay",
    color="rank_bin_str",
    color_discrete_map=color_map,
    hover_data=["combo", "dist", "z", "shape", "flat"],
    title="2D Parameter Slices (Decay × Retention) - Delay Animation"
)

fig2d.update_layout(xaxis_title="Decay Factor", yaxis_title="Retention")

# Return results
{
    "dataframe": df.to_dict('records'),
    "top_results": top.to_dict('records'),
    "fig3d": fig3d.to_dict(),
    "fig2d": fig2d.to_dict(),
    "parameters": {
        "retention_vals": retention_vals.tolist(),
        "decay_vals": decay_vals.tolist(),
        "delay_vals": delay_vals.tolist(),
        "iterations": iterations,
        "z_window": z_window,
        "weights": {"distance": weight_dist, "z_score": weight_z, "shape": weight_shape}
    }
}
`;
    }

    getCurrentGraph() {
        // Get the current graph from the main Loopy application
        if (window.loopy && window.loopy.model) {
            const model = window.loopy.model;
            const nodes = [];
            const edges = [];
            
            // Extract nodes (model.nodes is an array)
            for (const node of model.nodes) {
                nodes.push({
                    id: node.id,
                    name: node.label || node.id,
                    start_amount: node.init || node.value || 0.1,
                    retention: node.retention || 0.3,
                    floor: node.floor,
                    ceiling: node.ceiling,
                    formula: node.formula
                });
            }
            
            // Extract edges (model.edges is an array)
            for (const edge of model.edges) {
                if (edge.from && edge.to) {
                    edges.push({
                        from: edge.from.id,
                        to: edge.to.id,
                        strength: edge.strength || 1.0,
                        damper: edge.damper || 0.0,
                        lag: edge.lag || 0,
                        confidence: edge.confidence || 1.0
                    });
                }
            }
            
            return { nodes, edges };
        }
        
        return null;
    }

    displayResults(results) {
        const plotsDiv = document.getElementById('paramSpace3DPlots');
        const tableDiv = document.getElementById('paramSpace3DTable');
        
        if (!results || !results.results || !Array.isArray(results.results)) {
            plotsDiv.innerHTML = '<div class="error">No results to display</div>';
            return;
        }

        // Apply ranking and binning system (matching Python implementation)
        const rankedResults = this.applyRankingAndBinning(results.results);
        
        // Create 3D scatter plot data with ranked results
        const plotData = this.create3DPlotData(rankedResults);
        
        // Display 3D plot
        const plot3DHTML = `
            <div class="plot-container">
                <h3>3D Parameter Space Visualization</h3>
                <div id="plot3d" style="width: 100%; height: 600px;"></div>
            </div>
        `;
        
        // Display summary statistics
        const summaryHTML = `
            <div class="summary-container">
                <h3>Analysis Summary</h3>
                <div class="summary-stats">
                    <p><strong>Total Combinations:</strong> ${results.results.length}</p>
                    <p><strong>Best Combined Score:</strong> ${Math.min(...results.results.map(r => r.metrics?.combined || r.stability || 0)).toFixed(3)}</p>
                    <p><strong>Worst Combined Score:</strong> ${Math.max(...results.results.map(r => r.metrics?.combined || r.stability || 0)).toFixed(3)}</p>
                    <p><strong>Average Combined Score:</strong> ${(results.results.reduce((sum, r) => sum + (r.metrics?.combined || r.stability || 0), 0) / results.results.length).toFixed(3)}</p>
                    <p><strong>Excellent Bin:</strong> ${results.results.filter(r => r.bin === 'excellent').length} combinations</p>
                    <p><strong>Very Good Bin:</strong> ${results.results.filter(r => r.bin === 'very_good').length} combinations</p>
                    <p><strong>Good Bin:</strong> ${results.results.filter(r => r.bin === 'good').length} combinations</p>
                    <p><strong>Fair Bin:</strong> ${results.results.filter(r => r.bin === 'fair').length} combinations</p>
                    <p><strong>Poor Bin:</strong> ${results.results.filter(r => r.bin === 'poor').length} combinations</p>
                </div>
            </div>
        `;
        
        // Add animated 2D slices visualization
        const slicesHTML = `
            <div class="slices-container">
                <h3>Animated 2D Slices</h3>
                <div class="slice-controls">
                    <label>Retention Slice:</label>
                    <input type="range" id="retentionSlice" min="0" max="${results.retentionVals.length - 1}" value="0" step="1">
                    <span id="retentionValue">${results.retentionVals[0].toFixed(3)}</span>
                </div>
                <div id="slicePlot" style="width: 100%; height: 400px;"></div>
            </div>
        `;
        
        plotsDiv.innerHTML = plot3DHTML + summaryHTML + slicesHTML;
        
        // Render 3D plot using Plotly
        if (typeof Plotly !== 'undefined') {
            const layout = {
                title: '3D Parameter Space Analysis (Python-style Ranking)',
                scene: {
                    xaxis: { title: 'Retention' },
                    yaxis: { title: 'Decay' },
                    zaxis: { title: 'Delay' }
                },
                width: 800,
                height: 600
            };
            
            Plotly.newPlot('plot3d', [plotData], layout, {responsive: true});
            
            // Initialize animated slices
            this.initializeAnimatedSlices(rankedResults, results);
        }
        
        // Display top results table
        this.displayTopResultsTable(results.results, tableDiv);
    }

    /**
     * Apply ranking and binning system to match Python implementation
     * @param {Array} results - Raw analysis results
     * @returns {Array} Ranked and binned results
     */
    applyRankingAndBinning(results) {
        if (!results || results.length === 0) {
            return results;
        }
        
        // Extract combined scores for ranking (use metrics.combined if available, otherwise stability)
        const scores = results.map(r => r.metrics?.combined || r.stability || 0);
        
        // Sort by combined score (lower is better for stability)
        const sortedIndices = results.map((_, i) => i)
            .sort((a, b) => scores[a] - scores[b]);
        
        // Apply ranking (1 = best, N = worst)
        const rankedResults = results.map((result, index) => {
            const rank = sortedIndices.indexOf(index) + 1;
            const percentile = (rank / results.length) * 100;
            
            // Determine bin based on percentile
            let bin = 'excellent';
            if (percentile > 80) bin = 'poor';
            else if (percentile > 60) bin = 'fair';
            else if (percentile > 40) bin = 'good';
            else if (percentile > 20) bin = 'very_good';
            
            return {
                ...result,
                rank,
                percentile,
                bin,
                // Normalize scores for visualization
                normalizedScore: this.normalizeScore(result.metrics?.combined || result.stability || 0, scores)
            };
        });
        
        console.log(`Applied ranking: ${rankedResults.length} results ranked`);
        console.log(`Score range: ${Math.min(...scores).toFixed(3)} to ${Math.max(...scores).toFixed(3)}`);
        
        return rankedResults;
    }

    /**
     * Normalize score for visualization (0-1 scale)
     * @param {number} score - Raw score
     * @param {Array} allScores - All scores for min-max normalization
     * @returns {number} Normalized score
     */
    normalizeScore(score, allScores) {
        const minScore = Math.min(...allScores);
        const maxScore = Math.max(...allScores);
        const range = maxScore - minScore;
        
        if (range === 0) return 0.5; // All scores are the same
        
        return (score - minScore) / range;
    }

    create3DPlotData(results) {
        // Use the ranked results (already sorted by rank)
        const sortedResults = results.sort((a, b) => a.rank - b.rank);
        
        // Create color mapping based on bins
        const binColors = {
            'excellent': '#00ff00',    // Green
            'very_good': '#80ff00',    // Light green
            'good': '#ffff00',         // Yellow
            'fair': '#ff8000',         // Orange
            'poor': '#ff0000'          // Red
        };
        
        const colors = sortedResults.map(r => binColors[r.bin] || '#808080');
        
        return {
            x: sortedResults.map(r => r.retention),
            y: sortedResults.map(r => r.decay),
            z: sortedResults.map(r => r.delay),
            mode: 'markers',
            type: 'scatter3d',
            marker: {
                size: 8,
                color: colors,
                opacity: 0.8
            },
            text: sortedResults.map(r => {
                const metrics = r.metrics || {};
                return `Retention: ${r.retention.toFixed(3)}<br>` +
                       `Decay: ${r.decay.toFixed(3)}<br>` +
                       `Delay: ${r.delay.toFixed(3)}<br>` +
                       `Rank: ${r.rank}/${results.length}<br>` +
                       `Percentile: ${r.percentile.toFixed(1)}%<br>` +
                       `Bin: ${r.bin}<br>` +
                       `Distance: ${metrics.distance?.toFixed(3) || 'N/A'}<br>` +
                       `Z-Score: ${metrics.zScore?.toFixed(3) || 'N/A'}<br>` +
                       `Shape: ${metrics.shape?.toFixed(3) || 'N/A'}<br>` +
                       `Combined: ${metrics.combined?.toFixed(3) || r.stability?.toFixed(3) || 'N/A'}`;
            }),
            hovertemplate: '%{text}<extra></extra>'
        };
    }

    /**
     * Initialize animated 2D slices visualization
     * @param {Array} rankedResults - Ranked analysis results
     * @param {Object} results - Full results object with parameter values
     */
    initializeAnimatedSlices(rankedResults, results) {
        const slider = document.getElementById('retentionSlice');
        const valueSpan = document.getElementById('retentionValue');
        const plotDiv = document.getElementById('slicePlot');
        
        if (!slider || !valueSpan || !plotDiv) {
            console.warn('Animated slices elements not found');
            return;
        }
        
        // Create initial slice
        this.updateSlicePlot(rankedResults, results, 0);
        
        // Add event listener for slider
        slider.addEventListener('input', (e) => {
            const sliceIndex = parseInt(e.target.value);
            this.updateSlicePlot(rankedResults, results, sliceIndex);
        });
        
        // Auto-animate option
        const autoAnimateBtn = document.createElement('button');
        autoAnimateBtn.textContent = 'Auto Animate';
        autoAnimateBtn.style.marginLeft = '10px';
        autoAnimateBtn.addEventListener('click', () => {
            this.startAutoAnimation(rankedResults, results, slider, valueSpan);
        });
        
        slider.parentNode.appendChild(autoAnimateBtn);
    }

    /**
     * Update the 2D slice plot for a specific retention value
     * @param {Array} rankedResults - Ranked analysis results
     * @param {Object} results - Full results object
     * @param {number} sliceIndex - Index of the retention slice
     */
    updateSlicePlot(rankedResults, results, sliceIndex) {
        const retentionValue = results.retentionVals[sliceIndex];
        const valueSpan = document.getElementById('retentionValue');
        
        if (valueSpan) {
            valueSpan.textContent = retentionValue.toFixed(3);
        }
        
        // Filter results for this retention slice
        const sliceResults = rankedResults.filter(r => 
            Math.abs(r.retention - retentionValue) < 1e-6
        );
        
        if (sliceResults.length === 0) {
            console.warn(`No results found for retention slice ${sliceIndex}`);
            return;
        }
        
        // Create bin colors
        const binColors = {
            'excellent': '#00ff00',
            'very_good': '#80ff00',
            'good': '#ffff00',
            'fair': '#ff8000',
            'poor': '#ff0000'
        };
        
        const colors = sliceResults.map(r => binColors[r.bin] || '#808080');
        
        // Create 2D scatter plot data
        const plotData = {
            x: sliceResults.map(r => r.decay),
            y: sliceResults.map(r => r.delay),
            mode: 'markers',
            type: 'scatter',
            marker: {
                size: 12,
                color: colors,
                opacity: 0.8,
                line: {
                    color: 'rgba(0,0,0,0.3)',
                    width: 1
                }
            },
            text: sliceResults.map(r => {
                const metrics = r.metrics || {};
                return `Decay: ${r.decay.toFixed(3)}<br>` +
                       `Delay: ${r.delay.toFixed(3)}<br>` +
                       `Rank: ${r.rank}/${rankedResults.length}<br>` +
                       `Bin: ${r.bin}<br>` +
                       `Combined: ${metrics.combined?.toFixed(3) || r.stability?.toFixed(3) || 'N/A'}`;
            }),
            hovertemplate: '%{text}<extra></extra>',
            name: `Retention = ${retentionValue.toFixed(3)}`
        };
        
        const layout = {
            title: `2D Slice: Retention = ${retentionValue.toFixed(3)}`,
            xaxis: { title: 'Decay' },
            yaxis: { title: 'Delay' },
            width: 600,
            height: 400
        };
        
        Plotly.newPlot('slicePlot', [plotData], layout, {responsive: true});
    }

    /**
     * Start auto-animation of 2D slices
     * @param {Array} rankedResults - Ranked analysis results
     * @param {Object} results - Full results object
     * @param {HTMLElement} slider - Slider element
     * @param {HTMLElement} valueSpan - Value display element
     */
    startAutoAnimation(rankedResults, results, slider, valueSpan) {
        let currentIndex = 0;
        const maxIndex = results.retentionVals.length - 1;
        
        const animate = () => {
            slider.value = currentIndex;
            this.updateSlicePlot(rankedResults, results, currentIndex);
            
            currentIndex = (currentIndex + 1) % results.retentionVals.length;
            
            setTimeout(animate, 1000); // 1 second per frame
        };
        
        animate();
    }

    displayTopResultsTable(topResults, container) {
        if (!topResults || !Array.isArray(topResults) || topResults.length === 0) return;
        
        // Sort results by stability score (best first) and take top 25
        const sortedResults = topResults.sort((a, b) => b.stability - a.stability).slice(0, 25);
        
        const tableHTML = `
            <div class="results-table">
                <h3>Top 25 Parameter Combinations</h3>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Retention</th>
                            <th>Decay</th>
                            <th>Delay</th>
                            <th>Stability Score</th>
                            <th>Distance</th>
                            <th>Z-Score</th>
                            <th>Shape</th>
                            <th>Combined Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedResults.map((result, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${result.retention.toFixed(3)}</td>
                                <td>${result.decay.toFixed(3)}</td>
                                <td>${result.delay}</td>
                                <td>${result.stability.toFixed(3)}</td>
                                <td>${result.metrics.distance.toFixed(3)}</td>
                                <td>${result.metrics.zScore.toFixed(3)}</td>
                                <td>${result.metrics.shape.toFixed(3)}</td>
                                <td>${result.metrics.combinedScore.toFixed(3)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        container.innerHTML = tableHTML;
    }

    exportResults() {
        if (!this.currentResults) {
            alert('No results to export. Please run the analysis first.');
            return;
        }
        
        // Export as JSON
        const dataStr = JSON.stringify(this.currentResults, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = 'param_space_3d_results.json';
        link.click();
    }

    resetToDefaults() {
        // Reset all parameters to default values
        document.getElementById('retentionMin').value = '0.0';
        document.getElementById('retentionMax').value = '1.0';
        document.getElementById('retentionSteps').value = '11';
        
        document.getElementById('decayMin3D').value = '0.0';
        document.getElementById('decayMax3D').value = '1.0';
        document.getElementById('decaySteps3D').value = '11';
        
        document.getElementById('delayMin3D').value = '0';
        document.getElementById('delayMax3D').value = '10';
        document.getElementById('delaySteps3D').value = '11';
        
        document.getElementById('iterations3D').value = '400';
        document.getElementById('zWindow3D').value = '10';
        
        document.getElementById('weightDist3D').value = '0.5';
        document.getElementById('weightZ3D').value = '0.3';
        document.getElementById('weightShape3D').value = '0.2';
    }

    linspace(start, stop, num) {
        const step = (stop - start) / (num - 1);
        return Array.from({length: num}, (_, i) => start + i * step);
    }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        initParamSpace3D();
    });
} else {
    initParamSpace3D();
}

// Initialize ParamSpace3D when CLD Engine is available
function initParamSpace3D() {
    if (typeof CLDEngine !== 'undefined') {
        window.paramSpace3D = new ParamSpace3D();
        console.log('3D Parameter Space initialized successfully');
    } else {
        console.log('Waiting for CLD Engine to be available...');
        setTimeout(initParamSpace3D, 100);
    }
}
