/**
 * CLD Signal Propagation Engine
 * 
 * A comprehensive JavaScript module for simulating and analyzing 
 * Causal Loop Diagram (CLD) signal propagation with advanced features
 * including two-phase simulation, behavior classification, uncertainty
 * analysis, and parameter space exploration.
 * 
 * @author Refactored from existing implementation
 * @version 2.0
 */

class CLDEngine {
    constructor(options = {}) {
        this.config = {
            // Simulation parameters
            defaultSteps: 100,
            defaultWindow: 10,
            defaultSigmaBase: 0.1,
            
            // Behavior classification thresholds
            flatTolerance: 0.05,
            extremeTolerance: 2.0,
            oscillationTolerance: 3,
            
            // Stability analysis
            stabilityTolerance: 0.10,
            
            // Monte Carlo parameters
            defaultMonteCarloRuns: 1000,
            defaultFanPaths: 10,
            
            // Parameter space analysis
            defaultGridSize: 20,
            
            ...options
        };
        
        this.graph = null;
        this.simulationHistory = [];
        this.analysisResults = {};
    }

    /**
     * Initialize the engine with a graph structure
     * @param {Object} graph - Graph with nodes and edges
     */
    initializeGraph(graph) {
        this.graph = this.validateAndNormalizeGraph(graph);
        this.simulationHistory = [];
        this.analysisResults = {};
    }

    /**
     * Validate and normalize graph structure to ensure all required properties
     * @param {Object} graph - Input graph
     * @returns {Object} Normalized graph
     */
    validateAndNormalizeGraph(graph) {
        const normalized = {
            nodes: {},
            edges: []
        };

        // Validate and normalize nodes
        for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
            normalized.nodes[nodeId] = {
                id: nodeId,
                startAmount: this.safeEvaluate(node.startAmount, 0.0),
                retention: this.safeEvaluate(node.retention, 1.0),
                floor: this.safeEvaluate(node.floor, -Infinity),
                ceiling: this.safeEvaluate(node.ceiling, Infinity),
                formula: node.formula || null,
                sinkFormula: node.sinkFormula || null,
                sourceFormula: node.sourceFormula || null,
                ...node
            };
        }

        // Validate and normalize edges
        for (const edge of graph.edges || []) {
            normalized.edges.push({
                from: edge.from,
                to: edge.to,
                correlation: this.safeEvaluate(edge.correlation, 1.0),
                decay: this.safeEvaluate(edge.decay, 0.0),
                confidence: this.safeEvaluate(edge.confidence, 1.0),
                delay: this.safeEvaluate(edge.delay, 0),
                ...edge
            });
        }

        return normalized;
    }

    /**
     * Safely evaluate numeric or expression-based values
     * @param {*} value - Value to evaluate
     * @param {*} defaultValue - Default if evaluation fails
     * @returns {number} Evaluated numeric value
     */
    safeEvaluate(value, defaultValue = 0) {
        if (typeof value === 'number' && !isNaN(value)) {
            return value;
        }
        
        if (typeof value === 'string') {
            try {
                // Simple expression evaluation (extend as needed)
                const result = eval(value);
                return typeof result === 'number' && !isNaN(result) ? result : defaultValue;
            } catch (e) {
                console.warn(`Failed to evaluate expression: ${value}`, e);
                return defaultValue;
            }
        }
        
        return defaultValue;
    }

    /**
     * Two-phase simulation engine
     * @param {Object} options - Simulation options
     * @returns {Object} Simulation results
     */
    simulateTwoPhase(options = {}) {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }

        const config = {
            steps: options.steps || this.config.defaultSteps,
            initialValues: options.initialValues || {},
            applyBounds: options.applyBounds !== false,
            applyFormulas: options.applyFormulas !== false,
            ...options
        };

        const history = this.initializeHistory(config.initialValues);
        
        for (let t = 0; t < config.steps; t++) {
            const nextValues = this.computePhaseA(history, t, config);
            const finalValues = this.computePhaseB(nextValues, t, config);
            this.commitValues(history, finalValues);
        }

        return {
            history,
            steps: config.steps,
            config,
            metadata: {
                timestamp: new Date().toISOString(),
                nodeCount: Object.keys(this.graph.nodes).length,
                edgeCount: this.graph.edges.length
            }
        };
    }

    /**
     * Initialize simulation history with starting values
     * @param {Object} initialValues - Initial values for nodes
     * @returns {Object} History object
     */
    initializeHistory(initialValues = {}) {
        const history = {};
        
        for (const [nodeId, node] of Object.entries(this.graph.nodes)) {
            const startValue = initialValues[nodeId] !== undefined 
                ? initialValues[nodeId] 
                : node.startAmount;
            
            history[nodeId] = [startValue];
        }
        
        return history;
    }

    /**
     * Phase A: Retention + Delayed Inflows
     * @param {Object} history - Current simulation history
     * @param {number} t - Current time step
     * @param {Object} config - Simulation configuration
     * @returns {Object} Next values after Phase A
     */
    computePhaseA(history, t, config) {
        const nextValues = {};
        
        // Apply retention to current values
        for (const [nodeId, node] of Object.entries(this.graph.nodes)) {
            const currentValue = history[nodeId][t];
            const retention = node.retention;
            nextValues[nodeId] = currentValue * retention;
        }
        
        // Add delayed inflows from edges
        for (const edge of this.graph.edges) {
            const sourceNode = this.graph.nodes[edge.from];
            const targetNode = this.graph.nodes[edge.to];
            
            if (!sourceNode || !targetNode) continue;
            
            const delay = Math.max(0, Math.floor(edge.delay));
            const sourceTime = t - delay;
            
            if (sourceTime >= 0 && history[edge.from][sourceTime] !== undefined) {
                const sourceValue = history[edge.from][sourceTime];
                const correlation = edge.correlation;
                const decay = edge.decay;
                
                const inflow = sourceValue * correlation * (1.0 - decay);
                nextValues[edge.to] = (nextValues[edge.to] || 0) + inflow;
            }
        }
        
        return nextValues;
    }

    /**
     * Phase B: Apply bounds and formulas
     * @param {Object} nextValues - Values from Phase A
     * @param {number} t - Current time step
     * @param {Object} config - Simulation configuration
     * @returns {Object} Final values after Phase B
     */
    computePhaseB(nextValues, t, config) {
        const finalValues = {};
        
        for (const [nodeId, node] of Object.entries(this.graph.nodes)) {
            let value = nextValues[nodeId] || 0;
            
            // Apply formulas if enabled
            if (config.applyFormulas && node.formula) {
                value = this.evaluateFormula(node.formula, value, t, nodeId);
            }
            
            // Apply bounds if enabled
            if (config.applyBounds) {
                value = this.evaluateBounds(value, node.floor, node.ceiling);
            }
            
            finalValues[nodeId] = value;
        }
        
        return finalValues;
    }

    /**
     * Evaluate formula with context
     * @param {string} formula - Formula expression
     * @param {number} currentValue - Current node value
     * @param {number} t - Time step
     * @param {string} nodeId - Node identifier
     * @returns {number} Evaluated result
     */
    evaluateFormula(formula, currentValue, t, nodeId) {
        try {
            // Create evaluation context
            const context = {
                t: t,
                value: currentValue,
                nodeId: nodeId,
                // Add other node values if needed
                ...this.getNodeContext(t)
            };
            
            // Simple formula evaluation (extend for more complex expressions)
            const result = eval(formula.replace(/\bvalue\b/g, 'context.value')
                                      .replace(/\bt\b/g, 'context.t'));
            
            return typeof result === 'number' && !isNaN(result) ? result : currentValue;
        } catch (e) {
            console.warn(`Formula evaluation failed for node ${nodeId}:`, e);
            return currentValue;
        }
    }

    /**
     * Get node context for formula evaluation
     * @param {number} t - Time step
     * @returns {Object} Node context
     */
    getNodeContext(t) {
        const context = {};
        
        for (const [nodeId, history] of Object.entries(this.simulationHistory[0] || {})) {
            if (history[t] !== undefined) {
                context[nodeId] = history[t];
            }
        }
        
        return context;
    }

    /**
     * Evaluate bounds for a value
     * @param {number} value - Input value
     * @param {number} floor - Minimum value
     * @param {number} ceiling - Maximum value
     * @returns {number} Bounded value
     */
    evaluateBounds(value, floor, ceiling) {
        if (floor !== -Infinity && value < floor) {
            return floor;
        }
        if (ceiling !== Infinity && value > ceiling) {
            return ceiling;
        }
        return value;
    }

    /**
     * Commit values to history
     * @param {Object} history - Simulation history
     * @param {Object} values - Values to commit
     */
    commitValues(history, values) {
        for (const [nodeId, value] of Object.entries(values)) {
            if (history[nodeId]) {
                history[nodeId].push(value);
            }
        }
    }

    /**
     * Calculate rolling Z-scores for time series
     * @param {Array} series - Time series data
     * @param {number} window - Rolling window size
     * @returns {Array} Rolling Z-scores
     */
    rollingZ(series, window = this.config.defaultWindow) {
        if (!Array.isArray(series) || series.length === 0) {
            return [];
        }
        
        const zScores = [];
        
        for (let i = 0; i < series.length; i++) {
            const start = Math.max(0, i - window + 1);
            const windowData = series.slice(start, i + 1);
            
            const mean = windowData.reduce((sum, val) => sum + val, 0) / windowData.length;
            const variance = windowData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / windowData.length;
            const stdDev = Math.sqrt(variance) || 1e-12; // Avoid division by zero
            
            zScores.push((series[i] - mean) / stdDev);
        }
        
        return zScores;
    }

    /**
     * Calculate slope of time series
     * @param {Array} series - Time series data
     * @param {number} window - Window for slope calculation
     * @returns {Array} Slope values
     */
    calculateSlope(series, window = 5) {
        if (!Array.isArray(series) || series.length < 2) {
            return [];
        }
        
        const slopes = [0]; // First point has no slope
        
        for (let i = 1; i < series.length; i++) {
            const start = Math.max(0, i - window + 1);
            const end = i + 1;
            const windowData = series.slice(start, end);
            
            if (windowData.length < 2) {
                slopes.push(0);
                continue;
            }
            
            // Simple linear regression slope
            const n = windowData.length;
            const xSum = (n * (n - 1)) / 2; // Sum of indices
            const ySum = windowData.reduce((sum, val) => sum + val, 0);
            const xySum = windowData.reduce((sum, val, idx) => sum + val * idx, 0);
            const xSquaredSum = (n * (n - 1) * (2 * n - 1)) / 6; // Sum of squared indices
            
            const slope = (n * xySum - xSum * ySum) / (n * xSquaredSum - xSum * xSum);
            slopes.push(isNaN(slope) ? 0 : slope);
        }
        
        return slopes;
    }

    /**
     * Classify behavior patterns in time series
     * @param {Object} history - Simulation history
     * @param {Object} options - Classification options
     * @returns {Object} Behavior classifications
     */
    classifyBehavior(history, options = {}) {
        const config = {
            flatTolerance: options.flatTolerance || this.config.flatTolerance,
            extremeTolerance: options.extremeTolerance || this.config.extremeTolerance,
            oscillationTolerance: options.oscillationTolerance || this.config.oscillationTolerance,
            ...options
        };
        
        const classifications = {};
        
        for (const [nodeId, series] of Object.entries(history)) {
            const zScores = this.rollingZ(series);
            const slopes = this.calculateSlope(series);
            
            const classification = this.analyzeBehaviorPattern(
                series, zScores, slopes, config
            );
            
            classifications[nodeId] = classification;
        }
        
        return classifications;
    }

    /**
     * Analyze behavior pattern for a single time series
     * @param {Array} series - Time series data
     * @param {Array} zScores - Rolling Z-scores
     * @param {Array} slopes - Slope values
     * @param {Object} config - Classification configuration
     * @returns {Object} Behavior analysis
     */
    analyzeBehaviorPattern(series, zScores, slopes, config) {
        const meanAbsZ = zScores.reduce((sum, z) => sum + Math.abs(z), 0) / zScores.length;
        const maxAbsZ = Math.max(...zScores.map(z => Math.abs(z)));
        
        // Count zero crossings (oscillation indicator)
        const zeroCrossings = this.countZeroCrossings(zScores);
        
        // Analyze slope patterns
        const slopeVariance = this.calculateVariance(slopes);
        const slopeSignChanges = this.countSignChanges(slopes);
        
        // Classification logic
        let behavior = 'unknown';
        let confidence = 0;
        
        if (meanAbsZ < config.flatTolerance) {
            behavior = 'overdamped';
            confidence = 0.9;
        } else if (maxAbsZ > config.extremeTolerance) {
            behavior = 'unconstrained';
            confidence = 0.8;
        } else if (zeroCrossings > config.oscillationTolerance) {
            if (slopeVariance > 0.1 && slopeSignChanges > zeroCrossings * 0.5) {
                behavior = 'oscillatory';
                confidence = 0.7;
            } else {
                behavior = 'damped_oscillatory';
                confidence = 0.6;
            }
        } else if (meanAbsZ >= 0.5 && meanAbsZ <= 1.2) {
            behavior = 'optimal';
            confidence = 0.8;
        } else {
            behavior = 'transitional';
            confidence = 0.5;
        }
        
        return {
            behavior,
            confidence,
            metrics: {
                meanAbsZ,
                maxAbsZ,
                zeroCrossings,
                slopeVariance,
                slopeSignChanges
            }
        };
    }

    /**
     * Count zero crossings in a series
     * @param {Array} series - Input series
     * @returns {number} Number of zero crossings
     */
    countZeroCrossings(series) {
        let crossings = 0;
        for (let i = 1; i < series.length; i++) {
            if ((series[i-1] >= 0 && series[i] < 0) || (series[i-1] < 0 && series[i] >= 0)) {
                crossings++;
            }
        }
        return crossings;
    }

    /**
     * Count sign changes in a series
     * @param {Array} series - Input series
     * @returns {number} Number of sign changes
     */
    countSignChanges(series) {
        let changes = 0;
        for (let i = 1; i < series.length; i++) {
            if ((series[i-1] > 0 && series[i] < 0) || (series[i-1] < 0 && series[i] > 0)) {
                changes++;
            }
        }
        return changes;
    }

    /**
     * Calculate variance of a series
     * @param {Array} series - Input series
     * @returns {number} Variance
     */
    calculateVariance(series) {
        if (series.length === 0) return 0;
        
        const mean = series.reduce((sum, val) => sum + val, 0) / series.length;
        const variance = series.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / series.length;
        
        return variance;
    }

    /**
     * Monte Carlo simulation with fan paths
     * @param {Object} options - Simulation options
     * @returns {Object} Monte Carlo results
     */
    simulateFanPaths(options = {}) {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }

        const config = {
            runs: options.runs || this.config.defaultMonteCarloRuns,
            fanPaths: options.fanPaths || this.config.defaultFanPaths,
            sigmaBase: options.sigmaBase || this.config.defaultSigmaBase,
            steps: options.steps || this.config.defaultSteps,
            ...options
        };

        const fanPaths = [];
        
        for (let run = 0; run < config.runs; run++) {
            const perturbedGraph = this.perturbGraphByConfidence(config.sigmaBase);
            const result = this.simulateTwoPhase({
                ...options,
                steps: config.steps
            });
            
            fanPaths.push(result.history);
        }

        return {
            fanPaths,
            statistics: this.calculateFanStatistics(fanPaths),
            config,
            metadata: {
                timestamp: new Date().toISOString(),
                runCount: config.runs
            }
        };
    }

    /**
     * Perturb graph parameters based on confidence
     * @param {number} sigmaBase - Base perturbation strength
     * @returns {Object} Perturbed graph
     */
    perturbGraphByConfidence(sigmaBase) {
        const perturbedGraph = JSON.parse(JSON.stringify(this.graph)); // Deep copy
        
        // Perturb node parameters
        for (const [nodeId, node] of Object.entries(perturbedGraph.nodes)) {
            // Add small random perturbations to retention
            const retentionPerturbation = this.gaussianRandom() * sigmaBase * 0.1;
            node.retention = Math.max(0, Math.min(1, node.retention + retentionPerturbation));
        }
        
        // Perturb edge parameters
        for (const edge of perturbedGraph.edges) {
            // Perturb correlation based on confidence
            const correlationPerturbation = this.gaussianRandom() * sigmaBase * (1 - edge.confidence);
            edge.correlation = Math.max(-1, Math.min(1, edge.correlation + correlationPerturbation));
            
            // Perturb decay
            const decayPerturbation = this.gaussianRandom() * sigmaBase * 0.05;
            edge.decay = Math.max(0, Math.min(1, edge.decay + decayPerturbation));
            
            // Perturb delay (integer values)
            const delayPerturbation = Math.round(this.gaussianRandom() * sigmaBase * 2);
            edge.delay = Math.max(0, edge.delay + delayPerturbation);
        }
        
        return perturbedGraph;
    }

    /**
     * Generate Gaussian random number using Box-Muller transform
     * @returns {number} Gaussian random number
     */
    gaussianRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random(); // Converting [0,1) to (0,1)
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    /**
     * Calculate statistics for fan paths
     * @param {Array} fanPaths - Array of simulation histories
     * @returns {Object} Statistical summary
     */
    calculateFanStatistics(fanPaths) {
        if (fanPaths.length === 0) return {};
        
        const nodeIds = Object.keys(fanPaths[0]);
        const statistics = {};
        
        for (const nodeId of nodeIds) {
            const nodeStats = {
                mean: [],
                std: [],
                percentiles: {
                    p5: [], p25: [], p50: [], p75: [], p95: []
                }
            };
            
            const maxLength = Math.max(...fanPaths.map(path => path[nodeId].length));
            
            for (let t = 0; t < maxLength; t++) {
                const valuesAtTime = fanPaths
                    .map(path => path[nodeId][t])
                    .filter(val => val !== undefined);
                
                if (valuesAtTime.length > 0) {
                    const mean = valuesAtTime.reduce((sum, val) => sum + val, 0) / valuesAtTime.length;
                    const variance = valuesAtTime.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / valuesAtTime.length;
                    const std = Math.sqrt(variance);
                    
                    nodeStats.mean.push(mean);
                    nodeStats.std.push(std);
                    
                    // Calculate percentiles
                    const sorted = [...valuesAtTime].sort((a, b) => a - b);
                    nodeStats.percentiles.p5.push(this.percentile(sorted, 5));
                    nodeStats.percentiles.p25.push(this.percentile(sorted, 25));
                    nodeStats.percentiles.p50.push(this.percentile(sorted, 50));
                    nodeStats.percentiles.p75.push(this.percentile(sorted, 75));
                    nodeStats.percentiles.p95.push(this.percentile(sorted, 95));
                }
            }
            
            statistics[nodeId] = nodeStats;
        }
        
        return statistics;
    }

    /**
     * Calculate percentile of sorted array
     * @param {Array} sorted - Sorted array
     * @param {number} p - Percentile (0-100)
     * @returns {number} Percentile value
     */
    percentile(sorted, p) {
        if (sorted.length === 0) return 0;
        if (sorted.length === 1) return sorted[0];
        
        const index = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index - lower;
        
        if (upper >= sorted.length) return sorted[sorted.length - 1];
        
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    }

    /**
     * Parameter space analysis
     * @param {Object} options - Analysis options
     * @returns {Object} Parameter space results
     */
    analyzeParameterSpace(options = {}) {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }

        const config = {
            retentionRange: options.retentionRange || [0.1, 1.0],
            decayRange: options.decayRange || [0.0, 0.5],
            delayRange: options.delayRange || [0, 10],
            gridSize: options.gridSize || this.config.defaultGridSize,
            steps: options.steps || this.config.defaultSteps,
            ...options
        };

        const results = [];
        
        // Generate parameter grid
        const retentionValues = this.linspace(config.retentionRange[0], config.retentionRange[1], config.gridSize);
        const decayValues = this.linspace(config.decayRange[0], config.decayRange[1], config.gridSize);
        const delayValues = this.linspace(config.delayRange[0], config.delayRange[1], config.gridSize);
        
        for (const retention of retentionValues) {
            for (const decay of decayValues) {
                for (const delay of delayValues) {
                    const modifiedGraph = this.createModifiedGraph(retention, decay, delay);
                    const tempEngine = new CLDEngine(this.config);
                    tempEngine.initializeGraph(modifiedGraph);
                    
                    const simulation = tempEngine.simulateTwoPhase({
                        steps: config.steps
                    });
                    
                    const behavior = tempEngine.classifyBehavior(simulation.history);
                    const stability = this.calculateStabilityScore(behavior);
                    
                    results.push({
                        retention,
                        decay,
                        delay,
                        stability,
                        behavior,
                        simulation: simulation.history
                    });
                }
            }
        }
        
        return {
            results,
            parameterRanges: {
                retention: config.retentionRange,
                decay: config.decayRange,
                delay: config.delayRange
            },
            gridSize: config.gridSize,
            metadata: {
                timestamp: new Date().toISOString(),
                totalCombinations: results.length
            }
        };
    }

    /**
     * Create modified graph with specific parameters
     * @param {number} retention - Retention value
     * @param {number} decay - Decay value
     * @param {number} delay - Delay value
     * @returns {Object} Modified graph
     */
    createModifiedGraph(retention, decay, delay) {
        const modifiedGraph = JSON.parse(JSON.stringify(this.graph));
        
        // Set retention for all nodes
        for (const node of Object.values(modifiedGraph.nodes)) {
            node.retention = retention;
        }
        
        // Set decay and delay for all edges
        for (const edge of modifiedGraph.edges) {
            edge.decay = decay;
            edge.delay = Math.round(delay);
        }
        
        return modifiedGraph;
    }

    /**
     * Calculate stability score from behavior classification
     * @param {Object} behavior - Behavior classification results
     * @returns {number} Stability score (0-1, higher is more stable)
     */
    calculateStabilityScore(behavior) {
        const behaviors = Object.values(behavior);
        let score = 0;
        
        for (const b of behaviors) {
            switch (b.behavior) {
                case 'optimal':
                    score += 1.0;
                    break;
                case 'damped_oscillatory':
                    score += 0.7;
                    break;
                case 'overdamped':
                    score += 0.5;
                    break;
                case 'oscillatory':
                    score += 0.3;
                    break;
                case 'unconstrained':
                    score += 0.1;
                    break;
                default:
                    score += 0.2;
            }
        }
        
        return score / behaviors.length;
    }

    /**
     * Generate linear space array
     * @param {number} start - Start value
     * @param {number} end - End value
     * @param {number} count - Number of points
     * @returns {Array} Linear space array
     */
    linspace(start, end, count) {
        const step = (end - start) / (count - 1);
        return Array.from({ length: count }, (_, i) => start + i * step);
    }

    /**
     * Graph utilities - Calculate centrality measures
     * @param {string} type - Type of centrality ('degree', 'betweenness', 'closeness')
     * @returns {Object} Centrality measures
     */
    calculateCentrality(type = 'degree') {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }

        const centrality = {};
        const nodeIds = Object.keys(this.graph.nodes);
        
        switch (type) {
            case 'degree':
                return this.calculateDegreeCentrality();
            case 'betweenness':
                return this.calculateBetweennessCentrality();
            case 'closeness':
                return this.calculateClosenessCentrality();
            default:
                throw new Error(`Unknown centrality type: ${type}`);
        }
    }

    /**
     * Calculate degree centrality
     * @returns {Object} Degree centrality measures
     */
    calculateDegreeCentrality() {
        const centrality = {};
        const nodeIds = Object.keys(this.graph.nodes);
        
        for (const nodeId of nodeIds) {
            const inDegree = this.graph.edges.filter(edge => edge.to === nodeId).length;
            const outDegree = this.graph.edges.filter(edge => edge.from === nodeId).length;
            const totalDegree = inDegree + outDegree;
            
            centrality[nodeId] = {
                inDegree,
                outDegree,
                totalDegree,
                normalizedInDegree: inDegree / (nodeIds.length - 1),
                normalizedOutDegree: outDegree / (nodeIds.length - 1),
                normalizedTotalDegree: totalDegree / (2 * (nodeIds.length - 1))
            };
        }
        
        return centrality;
    }

    /**
     * Calculate betweenness centrality (simplified)
     * @returns {Object} Betweenness centrality measures
     */
    calculateBetweennessCentrality() {
        // Simplified implementation - in practice, use proper shortest path algorithms
        const centrality = {};
        const nodeIds = Object.keys(this.graph.nodes);
        
        for (const nodeId of nodeIds) {
            centrality[nodeId] = {
                betweenness: 0, // Placeholder - implement proper algorithm
                normalizedBetweenness: 0
            };
        }
        
        return centrality;
    }

    /**
     * Calculate closeness centrality (simplified)
     * @returns {Object} Closeness centrality measures
     */
    calculateClosenessCentrality() {
        // Simplified implementation - in practice, use proper shortest path algorithms
        const centrality = {};
        const nodeIds = Object.keys(this.graph.nodes);
        
        for (const nodeId of nodeIds) {
            centrality[nodeId] = {
                closeness: 0, // Placeholder - implement proper algorithm
                normalizedCloseness: 0
            };
        }
        
        return centrality;
    }

    /**
     * Generate adjacency matrix
     * @returns {Object} Adjacency matrix and metadata
     */
    generateAdjacencyMatrix() {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }

        const nodeIds = Object.keys(this.graph.nodes);
        const matrix = Array(nodeIds.length).fill().map(() => Array(nodeIds.length).fill(0));
        
        // Fill adjacency matrix
        for (const edge of this.graph.edges) {
            const fromIndex = nodeIds.indexOf(edge.from);
            const toIndex = nodeIds.indexOf(edge.to);
            
            if (fromIndex !== -1 && toIndex !== -1) {
                matrix[fromIndex][toIndex] = edge.correlation;
            }
        }
        
        return {
            matrix,
            nodeIds,
            metadata: {
                size: nodeIds.length,
                edgeCount: this.graph.edges.length,
                density: this.graph.edges.length / (nodeIds.length * (nodeIds.length - 1))
            }
        };
    }

    /**
     * Detect feedback cycles
     * @returns {Object} Cycle detection results
     */
    detectFeedbackCycles() {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }

        const cycles = [];
        const visited = new Set();
        const recursionStack = new Set();
        
        const nodeIds = Object.keys(this.graph.nodes);
        
        for (const nodeId of nodeIds) {
            if (!visited.has(nodeId)) {
                this.dfsCycleDetection(nodeId, visited, recursionStack, [], cycles);
            }
        }
        
        return {
            cycles,
            cycleCount: cycles.length,
            hasCycles: cycles.length > 0,
            metadata: {
                timestamp: new Date().toISOString(),
                nodeCount: nodeIds.length
            }
        };
    }

    /**
     * Depth-first search for cycle detection
     * @param {string} nodeId - Current node
     * @param {Set} visited - Visited nodes
     * @param {Set} recursionStack - Recursion stack
     * @param {Array} path - Current path
     * @param {Array} cycles - Found cycles
     */
    dfsCycleDetection(nodeId, visited, recursionStack, path, cycles) {
        visited.add(nodeId);
        recursionStack.add(nodeId);
        path.push(nodeId);
        
        // Find outgoing edges
        const outgoingEdges = this.graph.edges.filter(edge => edge.from === nodeId);
        
        for (const edge of outgoingEdges) {
            const targetNode = edge.to;
            
            if (!visited.has(targetNode)) {
                this.dfsCycleDetection(targetNode, visited, recursionStack, path, cycles);
            } else if (recursionStack.has(targetNode)) {
                // Found a cycle
                const cycleStart = path.indexOf(targetNode);
                const cycle = path.slice(cycleStart);
                cycles.push([...cycle, targetNode]); // Complete the cycle
            }
        }
        
        recursionStack.delete(nodeId);
        path.pop();
    }

    /**
     * Export simulation results for visualization
     * @param {Object} results - Simulation results
     * @param {Object} options - Export options
     * @returns {Object} Export data
     */
    exportResults(results, options = {}) {
        const config = {
            format: options.format || 'json',
            includeMetadata: options.includeMetadata !== false,
            ...options
        };
        
        const exportData = {
            results,
            metadata: config.includeMetadata ? {
                timestamp: new Date().toISOString(),
                engineVersion: '2.0',
                config: this.config
            } : undefined
        };
        
        if (config.format === 'csv') {
            return this.convertToCSV(exportData);
        }
        
        return exportData;
    }

    /**
     * Convert results to CSV format
     * @param {Object} data - Data to convert
     * @returns {string} CSV string
     */
    convertToCSV(data) {
        // Simplified CSV conversion - extend as needed
        const lines = [];
        lines.push('timestamp,node,step,value');
        
        if (data.results.history) {
            for (const [nodeId, series] of Object.entries(data.results.history)) {
                for (let i = 0; i < series.length; i++) {
                    lines.push(`${data.metadata.timestamp},${nodeId},${i},${series[i]}`);
                }
            }
        }
        
        return lines.join('\n');
    }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CLDEngine;
} else if (typeof window !== 'undefined') {
    window.CLDEngine = CLDEngine;
}
