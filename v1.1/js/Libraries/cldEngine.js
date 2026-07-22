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

        const nodesInput = graph?.nodes || {};
        const nodeEntries = Array.isArray(nodesInput)
            ? nodesInput.map((node, idx) => [node?.id ?? node?.name ?? String(idx), node || {}])
            : Object.entries(nodesInput);

        // Validate and normalize nodes
        for (const [nodeIdRaw, node] of nodeEntries) {
            const nodeId = String(nodeIdRaw);
            const floorValue = node.floor ?? node.min ?? node.lower ?? node.lower_bound ?? -Infinity;
            const ceilingValue = node.ceiling ?? node.ceil ?? node.max ?? node.upper ?? node.upper_bound ?? Infinity;
            const formulaValue = node.formula ?? node.expression ?? node.expr ?? null;
            const sinkFormulaValue = node.sinkFormula ?? node.sink_formula ?? node.f_sink ?? null;
            const sourceFormulaValue = node.sourceFormula ?? node.source_formula ?? node.f_source ?? null;

            const retention = this.safeEvaluate(node.retention ?? node.ret, 1.0);
            if (retention < 0) throw new Error(`Retention for "${nodeId}" cannot be negative`);
            normalized.nodes[nodeId] = {
                ...node,
                id: nodeId,
                startAmount: this.safeEvaluate(
                    node.startAmount ?? node.start_amount ?? node.start ?? node.initial ?? node.init ?? node.value,
                    0.0
                ),
                retention,
                floor: floorValue,
                ceiling: ceilingValue,
                formula: (typeof formulaValue === 'string' && formulaValue.trim()) ? formulaValue.trim() : null,
                sinkFormula: (typeof sinkFormulaValue === 'string' && sinkFormulaValue.trim()) ? sinkFormulaValue.trim() : null,
                sourceFormula: (typeof sourceFormulaValue === 'string' && sourceFormulaValue.trim()) ? sourceFormulaValue.trim() : null
            };
        }

        const edgesInput = graph?.edges || [];
        // Validate and normalize edges
        for (const edge of edgesInput) {
            const from = edge.from ?? edge.source ?? edge.src ?? edge.u;
            const to = edge.to ?? edge.target ?? edge.tgt ?? edge.v;
            if (from === undefined || to === undefined) {
                continue;
            }
            let correlation = edge.correlation ?? edge.corr ?? edge.strength;
            if (correlation === undefined || correlation === null) {
                const weight = edge.weight ?? edge.w;
                const polarity = edge.polarity ?? edge.sign;
                if (weight !== undefined && weight !== null && polarity !== undefined && polarity !== null) {
                    correlation = this.safeEvaluate(weight, 0) * this.safeEvaluate(polarity, 1);
                } else if (weight !== undefined && weight !== null) {
                    correlation = this.safeEvaluate(weight, 0);
                } else {
                    correlation = 1.0;
                }
            }

            const decay = this.safeEvaluate(edge.decay ?? edge.damper, 0.0);
            const confidence = this.safeEvaluate(edge.confidence ?? edge.certainty, 1.0);
            const delay = this.safeEvaluate(edge.delay ?? edge.lag, 0);
            const functionalForm = String(edge.functionalForm ?? edge.functional_form ?? 'linear').trim().toLowerCase();
            if (decay < 0 || decay > 1) throw new Error('Edge decay must be between 0 and 1');
            if (confidence < 0 || confidence > 1) throw new Error('Edge confidence must be between 0 and 1');
            if (delay < 0 || !Number.isInteger(delay)) throw new Error('Edge delay must be a non-negative integer');
            if (!['linear', 'tanh', 'quadratic', 'cubic', 'relu', 'step'].includes(functionalForm)) {
                throw new Error(`Unsupported edge functional form: ${functionalForm}`);
            }
            normalized.edges.push({
                ...edge,
                from: String(from),
                to: String(to),
                correlation: this.safeEvaluate(correlation, 1.0),
                decay,
                confidence,
                delay,
                functionalForm
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
    safeEvaluate(value, defaultValue = 0, ctx = {}) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        
        if (typeof value === 'string') {
            try {
                const t = ctx.t !== undefined ? ctx.t : 0;
                const x = ctx.x !== undefined ? ctx.x : 0;
                const val = x;
                const history = ctx.history || {};
                const raw = ctx.raw || {};
                const nxt = ctx.nxt || {};
                const inputs = ctx.inputs || {};
                const evaluator = typeof FormulaEvaluator !== 'undefined'
                    ? FormulaEvaluator
                    : (typeof require === 'function' ? require('./FormulaEvaluator.js') : null);
                if (!evaluator) {
                    throw new Error('Formula evaluator is unavailable');
                }
                const result = evaluator.evaluate(value, {
                    t, x, val, Y0: ctx.Y0, history, raw, nxt, inputs
                });
                return typeof result === 'number' && Number.isFinite(result) ? result : defaultValue;
            } catch (e) {
                if (typeof showToast === 'function') showToast(`Expression error: "${value}" — ${e.message}`, 'error');
                console.error(`Failed to evaluate expression: ${value}`, e);
                return defaultValue;
            }
        }
        
        return defaultValue;
    }

    getNumpyLikeHelpers() {
        return {
            exp: Math.exp,
            log: Math.log,
            sqrt: Math.sqrt,
            abs: Math.abs,
            sin: Math.sin,
            cos: Math.cos,
            tan: Math.tan,
            min: Math.min,
            max: Math.max,
            floor: Math.floor,
            ceil: Math.ceil,
            pow: Math.pow
        };
    }

    applyEdgeForm(form, value) {
        if (!Number.isFinite(value)) throw new Error('Edge source value must be finite');
        const selected = String(form || 'linear').trim().toLowerCase();
        let result;
        switch (selected) {
            case 'tanh': result = Math.tanh(value); break;
            case 'quadratic': result = value * Math.abs(value); break;
            case 'cubic': result = value * value * value; break;
            case 'relu': result = value > 0 ? value : 0; break;
            case 'step': result = value > 0 ? 1 : (value < 0 ? -1 : 0); break;
            case 'linear': result = value; break;
            default: throw new Error(`Unsupported edge functional form: ${selected}`);
        }
        if (!Number.isFinite(result)) throw new Error(`Edge functional form "${selected}" overflowed`);
        return result;
    }

    edgeContribution(edge, value) {
        const result = edge.correlation * (1.0 - edge.decay) * this.applyEdgeForm(edge.functionalForm, value);
        if (!Number.isFinite(result)) throw new Error('Edge contribution must be finite');
        return result;
    }

    applyProcessNoise(noise, nodeId, phase, value, t) {
        if (!Number.isFinite(value)) throw new Error(`Computed value for "${nodeId}" must be finite`);
        if (typeof noise !== 'function') return value;
        const result = noise({ nodeId, phase, value, t });
        if (!Number.isFinite(result)) throw new Error(`Noisy value for "${nodeId}" must be finite`);
        return result;
    }

    evaluateBound(bound, defaultValue, ctx = {}) {
        if (typeof bound === 'number' && !Number.isNaN(bound)) {
            return bound;
        }
        if (typeof bound === 'string' && bound.trim()) {
            const normalized = bound.trim().toLowerCase();
            if (['infinity', '+infinity', 'inf', '+inf'].includes(normalized)) {
                return Infinity;
            }
            if (['-infinity', '-inf'].includes(normalized)) {
                return -Infinity;
            }
            const result = this.safeEvaluate(bound, defaultValue, ctx);
            return Number.isFinite(result) ? result : defaultValue;
        }
        return defaultValue;
    }

    /**
     * Four-phase simulation engine matching the Python simulate_two_phase.
     * Phase A: retention + delayed inflows
     * Phase B: commit stock nodes (retention > 0) with bounds; converters get null placeholder
     * Phase C: evaluate converter nodes (retention === 0)
     * Phase D: apply sink/source multipliers
     * @param {Object} options - Simulation options
     * @returns {Object} Simulation results
     */
    createSimulationState(initialValues = {}) {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }
        return {
            history: this.initializeHistory(initialValues),
            step: 0
        };
    }

    /**
     * Advance an existing simulation by one synchronized notebook step.
     * The state object is intentionally reusable so Canvas Play can preserve
     * delay history while still accepting direct changes to current node values.
     */
    stepTwoPhase(state, options = {}) {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }
        if (!state || !state.history || !Number.isInteger(state.step) || state.step < 0) {
            throw new Error('A valid simulation state is required');
        }

        const config = {
            applyBounds: options.applyBounds !== false,
            applyFormulas: options.applyFormulas !== false,
            processNoise: options.processNoise
        };
        const history = state.history;
        const t = state.step;
        const nodeEntries = Object.entries(this.graph.nodes);

        for (const [nodeId] of nodeEntries) {
            if (!Array.isArray(history[nodeId]) || history[nodeId].length <= t) {
                throw new Error(`Simulation history is missing step ${t} for node "${nodeId}"`);
            }
        }

        const raw = Object.fromEntries(
            Object.entries(history).map(([nodeId, series]) => [nodeId, series[t]])
        );
        for (const [nodeId, value] of Object.entries(raw)) {
            if (!Number.isFinite(value)) throw new Error(`Value for "${nodeId}" at step ${t} must be finite`);
        }
        const converters = nodeEntries
            .filter(([, node]) => node.retention === 0)
            .map(([nodeId]) => nodeId);

        // Phase A: retention + delayed inflows
        const nxt = {};
        for (const [nodeId, node] of nodeEntries) {
            nxt[nodeId] = node.retention * history[nodeId][t];
        }
        for (const edge of this.graph.edges) {
            if (!this.graph.nodes[edge.from] || !this.graph.nodes[edge.to]) continue;
            const delayE = Math.max(0, Math.floor(edge.delay));
            const srcT = t - delayE;
            const srcV = (srcT >= 0 && history[edge.from][srcT] !== undefined)
                ? (history[edge.from][srcT] === null ? 0 : history[edge.from][srcT])
                : 0;
            nxt[edge.to] = (nxt[edge.to] || 0) + this.edgeContribution(edge, srcV);
            if (!Number.isFinite(nxt[edge.to])) throw new Error(`Unbounded next value for "${edge.to}" must be finite`);
        }

        // Phase B: commit stocks; converters receive a placeholder.
        for (const [nodeId, node] of nodeEntries) {
            if (node.retention > 0) {
                let value = this.applyProcessNoise(
                    config.processNoise, nodeId, 'stock', nxt[nodeId], t
                );
                if (config.applyBounds) {
                    value = this.evaluateBounds(value, node.floor, node.ceiling, {
                        t, history, raw, nxt
                    });
                }
                history[nodeId].push(value);
            } else {
                history[nodeId].push(null);
            }
        }

        // Phase C: evaluate converters from the just-committed stock values.
        for (const nodeId of converters) {
            const node = this.graph.nodes[nodeId];
            const inputs = {};
            for (const edge of this.graph.edges) {
                if (edge.to !== nodeId) continue;
                const delayE = Math.max(0, Math.floor(edge.delay));
                const srcT = t + 1 - delayE;
                let srcV = (srcT >= 0 && history[edge.from][srcT] !== undefined)
                    ? history[edge.from][srcT] : 0;
                if (srcV === null) srcV = 0;
                inputs[edge.from] = this.edgeContribution(edge, srcV);
            }

            const committed = Object.fromEntries(
                Object.entries(history).map(([id, series]) => [id, series[series.length - 1]])
            );
            let value;
            if (config.applyFormulas && node.formula) {
                const previousValue = history[nodeId].length >= 2
                    ? (history[nodeId][history[nodeId].length - 2] ?? 0)
                    : 0;
                value = this.evaluateFormula(
                    node.formula,
                    previousValue,
                    t,
                    nodeId,
                    history,
                    { inputs, raw, nxt: committed, Y0: history[nodeId][0] }
                );
            } else {
                value = Object.values(inputs).reduce((sum, input) => sum + input, 0);
            }
            value = this.applyProcessNoise(
                config.processNoise, nodeId, 'converter', value, t
            );
            if (config.applyBounds) {
                value = this.evaluateBounds(value, node.floor, node.ceiling, {
                    t, history, raw, nxt: committed
                });
            }
            history[nodeId][history[nodeId].length - 1] = value;
        }

        // Phase D: apply notebook-compatible sink/source multipliers.
        for (const [nodeId, node] of nodeEntries) {
            if (node.sinkFormula) {
                const currentValue = history[nodeId][history[nodeId].length - 1];
                const committed = Object.fromEntries(
                    Object.entries(history).map(([id, series]) => [id, series[series.length - 1]])
                );
                const factor = this.safeEvaluate(node.sinkFormula, 1.0, {
                    t, x: currentValue, val: currentValue, Y0: history[nodeId][0],
                    history, raw, nxt: committed
                });
                const result = currentValue * factor;
                if (!Number.isFinite(result)) throw new Error(`Sink result for "${nodeId}" must be finite`);
                history[nodeId][history[nodeId].length - 1] = result;
            }
            if (node.sourceFormula) {
                const currentValue = history[nodeId][history[nodeId].length - 1];
                const committed = Object.fromEntries(
                    Object.entries(history).map(([id, series]) => [id, series[series.length - 1]])
                );
                const factor = this.safeEvaluate(node.sourceFormula, 1.0, {
                    t, x: currentValue, val: currentValue, Y0: history[nodeId][0],
                    history, raw, nxt: committed
                });
                const result = currentValue * factor;
                if (!Number.isFinite(result)) throw new Error(`Source result for "${nodeId}" must be finite`);
                history[nodeId][history[nodeId].length - 1] = result;
            }
        }

        state.step = t + 1;
        return {
            history,
            step: state.step,
            values: Object.fromEntries(
                Object.entries(history).map(([nodeId, series]) => [nodeId, series[series.length - 1]])
            )
        };
    }

    simulateTwoPhase(options = {}) {
        if (!this.graph) {
            throw new Error('Graph not initialized. Call initializeGraph() first.');
        }

        const requestedSteps = options.steps === undefined
            ? this.config.defaultSteps
            : Number(options.steps);
        const config = {
            ...options,
            steps: Math.max(0, Math.floor(Number.isFinite(requestedSteps) ? requestedSteps : 0)),
            initialValues: options.initialValues || {},
            applyBounds: options.applyBounds !== false,
            applyFormulas: options.applyFormulas !== false
        };
        const state = this.createSimulationState(config.initialValues);
        for (let step = 0; step < config.steps; step++) {
            this.stepTwoPhase(state, config);
        }

        return {
            history: state.history,
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
     * Evaluate formula with context from the current simulation history
     * @param {string} formula - Formula expression
     * @param {number} currentValue - Current node value
     * @param {number} t - Time step
     * @param {string} nodeId - Node identifier
     * @param {Object} history - Current simulation history
     * @returns {number} Evaluated result
     */
    evaluateFormula(formula, currentValue, t, nodeId, history, extraContext = {}) {
        try {
            const raw = extraContext.raw || {};
            const nxt = extraContext.nxt || {};
            const inputs = extraContext.inputs || {};
            return this.safeEvaluate(formula, currentValue, {
                t,
                x: currentValue,
                val: currentValue,
                Y0: extraContext.Y0 === undefined ? history[nodeId][0] : extraContext.Y0,
                raw,
                nxt,
                inputs,
                history
            });
        } catch (e) {
            if (typeof showToast === 'function') showToast(`Formula error (node "${nodeId}"): ${e.message}`, 'error');
            console.error(`Formula evaluation failed for node ${nodeId}:`, e);
            return currentValue;
        }
    }

    /**
     * Evaluate bounds for a value
     * @param {number} value - Input value
     * @param {number} floor - Minimum value
     * @param {number} ceiling - Maximum value
     * @returns {number} Bounded value
     */
    evaluateBounds(value, floor, ceiling, ctx = {}) {
        if (!Number.isFinite(value)) throw new Error('Computed node value must be finite');
        const floorValue = this.evaluateBound(floor, -Infinity, ctx);
        const ceilingValue = this.evaluateBound(ceiling, Infinity, ctx);
        if (floorValue > ceilingValue) throw new Error('Node floor cannot exceed its ceiling');
        if (floorValue !== -Infinity && value < floorValue) {
            return floorValue;
        }
        if (ceilingValue !== Infinity && value > ceilingValue) {
            return ceilingValue;
        }
        return value;
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
     * Classify behavior patterns in time series.
     * Aligned with Python classify_behavior: uses final_abs, rel_range,
     * growth_ratio, and log-slope to map to Over-damped / Optimal / Unconstrained.
     * @param {Object} history - Simulation history
     * @param {Object} options - Classification options
     * @returns {Object} Behavior classifications
     */
    classifyBehavior(history, options = {}) {
        const config = {
            dampTol: options.dampTol || 1e-3,
            rangeRelTol: options.rangeRelTol || 0.01,
            growthRatio: options.growthRatio || 300.0,
            slopeThresh: options.slopeThresh || 0.2,
            ...options
        };

        const classifications = {};

        for (const [nodeId, series] of Object.entries(history)) {
            classifications[nodeId] = this.analyzeBehaviorPattern(series, config);
        }

        return classifications;
    }

    /**
     * Analyze behavior pattern for a single time series.
     * Matches Python classify_behavior logic.
     * @param {Array} series - Time series data
     * @param {Object} config - Classification configuration
     * @returns {Object} Behavior analysis
     */
    analyzeBehaviorPattern(series, config) {
        const values = series.filter(v => v !== null && v !== undefined);
        if (values.length === 0) {
            return { behavior: 'Over-damped', confidence: 1.0, metrics: {} };
        }

        const finalAbs = Math.abs(values[values.length - 1]);
        const absValues = values.map(v => Math.abs(v));
        const maxAbs = Math.max(...absValues);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const absRange = maxVal - minVal;
        const relRange = absRange / (maxAbs + 1e-12);

        if (finalAbs < config.dampTol || relRange < config.rangeRelTol) {
            return {
                behavior: 'Over-damped',
                confidence: 0.9,
                metrics: { finalAbs, relRange, growthFact: 0, slope: 0 }
            };
        }

        const earlyLen = Math.max(1, Math.floor(values.length / 5));
        const earlySlice = absValues.slice(0, earlyLen);
        const earlyMean = earlySlice.reduce((s, v) => s + v, 0) / earlySlice.length;
        const growthFact = finalAbs / (earlyMean + 1e-12);

        const logVals = absValues.map(v => Math.log(v + 1e-12));
        const n = logVals.length;
        const xMean = (n - 1) / 2;
        const yMean = logVals.reduce((s, v) => s + v, 0) / n;
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) {
            num += (i - xMean) * (logVals[i] - yMean);
            den += (i - xMean) * (i - xMean);
        }
        const slope = den !== 0 ? num / den : 0;

        let behavior, confidence;
        if (growthFact >= config.growthRatio && slope > config.slopeThresh) {
            behavior = 'Unconstrained';
            confidence = 0.85;
        } else {
            behavior = 'Optimal';
            confidence = 0.8;
        }

        return {
            behavior,
            confidence,
            metrics: { finalAbs, relRange, growthFact, slope }
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

    nodeFanSigma(fanSigma = 0.25, driverConfidence = 0.90) {
        const sigma = {};
        for (const nodeId of Object.keys(this.graph.nodes)) {
            const inbound = this.graph.edges.filter(edge => edge.to === nodeId);
            const confidence = inbound.length
                ? inbound.reduce((sum, edge) => sum + Number(edge.confidence ?? 1), 0) / inbound.length
                : Number(driverConfidence);
            const bounded = Math.max(0, Math.min(1, confidence));
            sigma[nodeId] = Math.max(0, Number(fanSigma) * (1 - bounded));
        }
        return sigma;
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
        const originalGraph = this.graph;
        const sigmaMap = this.nodeFanSigma(config.sigmaBase, options.driverConfidence ?? 0.90);
        const processNoise = options.processNoise || (({ nodeId, value }) => {
            const sigma = sigmaMap[nodeId] || 0;
            return sigma > 0 ? value * (1 + this.gaussianRandom() * sigma) : value;
        });

        try {
            for (let run = 0; run < config.runs; run++) {
                const perturbedGraph = this.perturbGraphByConfidence(config.sigmaBase);
                this.graph = perturbedGraph;
                const result = this.simulateTwoPhase({
                    ...options,
                    steps: config.steps,
                    processNoise
                });
                fanPaths.push(result.history);
            }
        } finally {
            this.graph = originalGraph;
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

        // Perturb only edge correlations using confidence/certainty semantics.
        for (const edge of perturbedGraph.edges) {
            const corr0 = Number(edge.correlation ?? 1.0);
            const confRaw = edge.confidence ?? edge.certainty ?? 1.0;
            const c = Math.max(0, Math.min(1, Number(confRaw)));

            let newCorr;
            if (c >= 1 - 1e-12) {
                newCorr = corr0;
            } else if (c <= 1e-12) {
                newCorr = -1 + Math.random() * 2;
            } else if (Math.random() < c) {
                newCorr = corr0;
            } else {
                const sigma = Math.max(1e-6, sigmaBase * (1 - c));
                newCorr = corr0 + this.gaussianRandom() * sigma;
                newCorr = Math.max(-1, Math.min(1, newCorr));
            }

            edge.correlation = newCorr;
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
     * Legacy notebook parameter-sweep matrix. This is intentionally distinct
     * from the runtime linear transition matrix below.
     */
    computeUniformSweepTransitionMatrix(decayFactor) {
        const nodes = Object.keys(this.graph.nodes);
        const nodeIndex = {};
        nodes.forEach((node, i) => {
            nodeIndex[node] = i;
        });
        
        const matrix = Array(nodes.length).fill().map(() => Array(nodes.length).fill(0));
        
        // Self-decay (diagonal)
        const retention = 1.0 - decayFactor;
        for (let i = 0; i < nodes.length; i++) {
            matrix[i][i] = retention;
        }
        
        // Directed edges
        for (const edge of this.graph.edges) {
            const fromIdx = nodeIndex[edge.from];
            const toIdx = nodeIndex[edge.to];
            if (fromIdx !== undefined && toIdx !== undefined) {
                const correlation = edge.correlation ?? 1.0;
                matrix[toIdx][fromIdx] += decayFactor * correlation;
            }
        }
        
        return { matrix, nodes };
    }

    computeAdjacencyMatrixStability(decayFactor) {
        return this.computeUniformSweepTransitionMatrix(decayFactor);
    }

    /**
     * Delay-free linear spectral model of runtime propagation. It uses actual
     * retention and correlation*(1-decay), while intentionally excluding
     * delays, bounds, confidence, source/sink formulas, and nonlinear forms.
     */
    computeRuntimeLinearTransitionMatrix() {
        const nodes = Object.keys(this.graph.nodes);
        const index = Object.fromEntries(nodes.map((node, position) => [node, position]));
        const matrix = Array.from({ length: nodes.length }, () => Array(nodes.length).fill(0));
        for (const node of nodes) {
            matrix[index[node]][index[node]] = this.graph.nodes[node].retention;
        }
        for (const edge of this.graph.edges) {
            matrix[index[edge.to]][index[edge.from]] += edge.correlation * (1 - edge.decay);
        }
        return { matrix, nodes };
    }

    /**
     * Analyze eigenvalues for stability
     * @param {Array} matrix - Adjacency matrix
     * @returns {Object} {eigenvalues, distanceMetric, maxMagnitude}
     */
    analyzeEigenvaluesStability(matrix) {
        // Simple eigenvalue approximation for JavaScript
        // For more accurate results, consider using a proper linear algebra library
        const n = matrix.length;
        const eigenvalues = [];
        
        // For small matrices, use characteristic polynomial
        if (n <= 3) {
            eigenvalues.push(...this.computeEigenvaluesSimple(matrix));
        } else {
            // For larger matrices, use power iteration approximation
            eigenvalues.push(...this.computeEigenvaluesApproximate(matrix));
        }
        
        const magnitudes = eigenvalues.map(e => {
            if (typeof e === 'number') {
                return Math.abs(e);
            } else if (e && typeof e === 'object' && 'real' in e && 'imag' in e) {
                // Complex number: magnitude = sqrt(real^2 + imag^2)
                return Math.sqrt(e.real * e.real + e.imag * e.imag);
            } else {
                return 0;
            }
        });
        const maxMagnitude = Math.max(...magnitudes);
        const avgMagnitude = magnitudes.reduce((sum, mag) => sum + mag, 0) / magnitudes.length;
        const distanceMetric = Math.abs(1 - avgMagnitude);
        
        return {
            eigenvalues,
            distanceMetric,
            maxMagnitude
        };
    }

    /**
     * Simple eigenvalue computation for small matrices
     * @param {Array} matrix - 2x2 or 3x3 matrix
     * @returns {Array} Eigenvalues
     */
    computeEigenvaluesSimple(matrix) {
        const n = matrix.length;
        if (n === 1) {
            return [matrix[0][0]];
        } else if (n === 2) {
            const a = matrix[0][0];
            const b = matrix[0][1];
            const c = matrix[1][0];
            const d = matrix[1][1];
            
            const trace = a + d;
            const det = a * d - b * c;
            const discriminant = trace * trace - 4 * det;
            
            if (discriminant >= 0) {
                const sqrtDisc = Math.sqrt(discriminant);
                return [(trace + sqrtDisc) / 2, (trace - sqrtDisc) / 2];
            } else {
                const real = trace / 2;
                const imag = Math.sqrt(-discriminant) / 2;
                // Return complex eigenvalues as objects with real and imaginary parts
                return [
                    { real: real, imag: imag },
                    { real: real, imag: -imag }
                ];
            }
        } else if (n === 3) {
            // For 3x3, use Cardano's method
            return this.computeEigenvalues3x3(matrix);
        }
        return [];
    }

    /**
     * Approximate eigenvalue computation using power iteration
     * @param {Array} matrix - Square matrix
     * @returns {Array} Approximate eigenvalues
     */
    computeEigenvaluesApproximate(matrix) {
        const n = matrix.length;
        const eigenvalues = [];
        
        // Power iteration for dominant eigenvalue
        let vector = Array(n).fill(1);
        for (let iter = 0; iter < 100; iter++) {
            const newVector = this.matrixVectorMultiply(matrix, vector);
            const norm = Math.sqrt(newVector.reduce((sum, val) => sum + val * val, 0));
            if (norm < 1e-10) break;
            
            vector = newVector.map(val => val / norm);
        }
        
        // Estimate eigenvalue from final vector
        const eigenvector = vector;
        const Av = this.matrixVectorMultiply(matrix, eigenvector);
        const eigenvalue = Av.reduce((sum, val, i) => sum + val * eigenvector[i], 0);
        eigenvalues.push(eigenvalue);
        
        return eigenvalues;
    }

    /**
     * Matrix-vector multiplication
     * @param {Array} matrix - Square matrix
     * @param {Array} vector - Vector
     * @returns {Array} Result vector
     */
    matrixVectorMultiply(matrix, vector) {
        return matrix.map(row => 
            row.reduce((sum, val, i) => sum + val * vector[i], 0)
        );
    }

    /**
     * Compute eigenvalues for 3x3 matrix using Cardano's method
     * @param {Array} matrix - 3x3 matrix
     * @returns {Array} Eigenvalues
     */
    computeEigenvalues3x3(matrix) {
        // Characteristic polynomial: λ³ + a₂λ² + a₁λ + a₀ = 0
        const a = matrix[0][0];
        const b = matrix[0][1];
        const c = matrix[0][2];
        const d = matrix[1][0];
        const e = matrix[1][1];
        const f = matrix[1][2];
        const g = matrix[2][0];
        const h = matrix[2][1];
        const i = matrix[2][2];
        
        const trace = a + e + i;
        const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        
        // Simplified: assume one real eigenvalue and two complex conjugates
        // This is a rough approximation
        const realEigenvalue = trace / 3;
        const complexMagnitude = Math.sqrt(Math.abs(det) / Math.abs(realEigenvalue));
        
        return [realEigenvalue, complexMagnitude, -complexMagnitude];
    }

    /**
     * Compute shape penalty for Z-score series
     * @param {Array} zSeries - Z-score series
     * @param {Object} options - Penalty options
     * @returns {number} Shape penalty
     */
    computeShapePenalty(zSeries, options = {}) {
        const {
            flatTol = 0.05,
            extremeTol = 2.0,
            oscillationTol = 3
        } = options;
        
        let penalty = 0.0;
        
        // Flat penalty (average absolute Z near 0)
        const meanAbsZ = zSeries.reduce((sum, z) => sum + Math.abs(z), 0) / zSeries.length;
        if (meanAbsZ < flatTol) {
            penalty += 2.0;
        }
        
        // Extreme divergence penalty
        const maxAbsZ = Math.max(...zSeries.map(z => Math.abs(z)));
        if (maxAbsZ > extremeTol) {
            penalty += (maxAbsZ - extremeTol);
        }
        
        // Oscillation penalty (crossing through 0)
        let zeroCrossings = 0;
        for (let i = 1; i < zSeries.length; i++) {
            if ((zSeries[i-1] > 0 && zSeries[i] < 0) || (zSeries[i-1] < 0 && zSeries[i] > 0)) {
                zeroCrossings++;
            }
        }
        if (zeroCrossings > oscillationTol) {
            penalty += (zeroCrossings - oscillationTol) * 0.5;
        }
        
        return penalty;
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
            zWindow: options.zWindow || 10,
            weights: {
                distance: options.weights?.distance || 0.5,
                zScore: options.weights?.zScore || 0.3,
                shape: options.weights?.shape || 0.2
            },
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
                    // Create modified graph with current parameters
                    const modifiedGraph = this.createModifiedGraph(retention, decay, delay);
                    
                    // Initialize new engine instance
                    const tempEngine = new CLDEngine(this.config);
                    tempEngine.initializeGraph(modifiedGraph);
                    
                    // Run simulation
                    const simulation = tempEngine.simulateTwoPhase({
                        steps: config.steps
                    });
                    
                    // Compute stability metrics
                    const { matrix } = tempEngine.computeUniformSweepTransitionMatrix(decay);
                    const { distanceMetric, maxMagnitude } = tempEngine.analyzeEigenvaluesStability(matrix);
                    
                    // Compute Z-score metrics
                    let maxZScore = 0;
                    let avgShapePenalty = 0;
                    let nodeCount = 0;
                    
                    for (const [nodeId, series] of Object.entries(simulation.history)) {
                        if (series.length >= config.zWindow) {
                            const zScores = tempEngine.rollingZ(series, config.zWindow);
                            const maxAbsZ = Math.max(...zScores.map(z => Math.abs(z)));
                            maxZScore = Math.max(maxZScore, maxAbsZ);
                            
                            const shapePenalty = tempEngine.computeShapePenalty(zScores);
                            avgShapePenalty += shapePenalty;
                            nodeCount++;
                        }
                    }
                    
                    avgShapePenalty = nodeCount > 0 ? avgShapePenalty / nodeCount : 0;
                    
                    // Flatness penalty
                    const flatPenalty = maxZScore < 0.05 ? 2.0 : 0.0;
                    
                    // Combined score
                    const combinedScore = (
                        config.weights.distance * distanceMetric +
                        config.weights.zScore * maxZScore +
                        config.weights.shape * avgShapePenalty +
                        flatPenalty
                    );
                    
                    // Classify behavior
                    const behavior = tempEngine.classifyBehavior(simulation.history);
                    
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
                case 'Optimal':
                    score += 1.0;
                    break;
                case 'Over-damped':
                    score += 0.5;
                    break;
                case 'Unconstrained':
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
    generateTopologyAdjacencyMatrix() {
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

    generateAdjacencyMatrix() {
        return this.generateTopologyAdjacencyMatrix();
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
