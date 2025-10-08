/**
 * CLD Engine Integration Script
 * 
 * This script provides easy integration between the CLD Engine and the existing
 * Loopy system. It can be included in your HTML to add advanced analysis capabilities.
 */

/**
 * LoopyCLDIntegration class for integrating CLD Engine with Loopy
 */
class LoopyCLDIntegration {
    constructor(loopyInstance) {
        this.loopy = loopyInstance;
        this.cldEngine = null;
    }

    /**
     * Initialize CLD Engine with current model
     */
    async initializeCLDEngine() {
        if (!this.cldEngine) {
            this.cldEngine = new CLDEngine();
        }
        
        // Get current graph from Loopy
        const graph = this.getCurrentGraph();
        if (graph && graph.nodes && graph.nodes.length > 0) {
            this.cldEngine.initializeGraph(graph);
            return true;
        }
        return false;
    }

    /**
     * Get current graph from Loopy model
     */
    getCurrentGraph() {
        if (!this.loopy || !this.loopy.model) {
            return null;
        }
        
        const model = this.loopy.model;
        const nodes = [];
        const edges = [];
        
        // Convert Loopy nodes to CLD format
        for (const nodeId in model.nodes) {
            const node = model.nodes[nodeId];
            nodes.push({
                id: nodeId,
                startAmount: node.init || node.value || 0.5,
                retention: node.retention || 0.9,
                floor: node.floor !== undefined ? node.floor : -Infinity,
                ceiling: node.ceiling !== undefined ? node.ceiling : Infinity,
                formula: node.formula || null,
                sinkFormula: node.sinkFormula || null,
                sourceFormula: node.sourceFormula || null
            });
        }
        
        // Convert Loopy edges to CLD format
        for (const edgeId in model.edges) {
            const edge = model.edges[edgeId];
            edges.push({
                from: edge.from.id,
                to: edge.to.id,
                correlation: edge.strength || 1.0,
                decay: edge.decay || 0.1,
                confidence: edge.confidence || 1.0,
                delay: edge.delay || 0
            });
        }
        
        return { nodes, edges };
    }

    /**
     * Analyze current model
     */
    async analyzeCurrentModel(options = {}) {
        const initialized = await this.initializeCLDEngine();
        if (!initialized) {
            throw new Error('Failed to initialize CLD Engine with current model');
        }
        
        // Run simulation
        const simulation = this.cldEngine.simulateTwoPhase({
            steps: options.steps || 100
        });
        
        // Classify behavior
        const behavior = this.cldEngine.classifyBehavior(simulation.history);
        
        return {
            simulation,
            behavior,
            history: simulation.history
        };
    }
}

// Integration function to add CLD Engine capabilities to existing Loopy
function integrateCLDEngine(loopyInstance) {
    if (!loopyInstance) {
        console.error('Loopy instance not provided');
        return null;
    }

    // Create integration instance
    const integration = new LoopyCLDIntegration(loopyInstance);
    
    // Add analysis methods to the loopy instance
    loopyInstance.cldAnalysis = {
        /**
         * Run complete analysis on current model
         */
        async analyze(options = {}) {
            try {
                const results = await integration.analyzeCurrentModel(options);
                console.log('CLD Analysis completed:', results);
                return results;
            } catch (error) {
                console.error('CLD Analysis failed:', error);
                throw error;
            }
        },

        /**
         * Run quick behavior analysis
         */
        async quickAnalysis(steps = 50) {
            try {
                const results = await integration.analyzeCurrentModel({
                    steps,
                    monteCarloRuns: 100,
                    gridSize: 5
                });
                return {
                    behavior: results.behavior,
                    summary: results.graphAnalysis.cycles
                };
            } catch (error) {
                console.error('Quick analysis failed:', error);
                throw error;
            }
        },

        /**
         * Update model with analysis insights
         */
        updateWithInsights(results, options = {}) {
            try {
                integration.updateModelWithInsights(results, options);
                console.log('Model updated with analysis insights');
            } catch (error) {
                console.error('Failed to update model:', error);
                throw error;
            }
        },

        /**
         * Export analysis results
         */
        exportResults(results, format = 'json') {
            try {
                const example = new CLDEngineExample();
                return example.exportResults(results, format);
            } catch (error) {
                console.error('Export failed:', error);
                throw error;
            }
        },

        /**
         * Get visualization data for charts
         */
        getVisualizationData(results) {
            try {
                const example = new CLDEngineExample();
                return example.createVisualizationData(results);
            } catch (error) {
                console.error('Failed to create visualization data:', error);
                throw error;
            }
        }
    };

    // Example loading functionality removed to prevent canvas clearing issues

    // Add analysis UI helpers
    loopyInstance.cldUI = {
        /**
         * Show analysis results in a modal
         */
        showResults(results) {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            const content = document.createElement('div');
            content.style.cssText = `
                background: white;
                padding: 20px;
                border-radius: 8px;
                max-width: 80%;
                max-height: 80%;
                overflow: auto;
            `;

            content.innerHTML = `
                <h2>CLD Analysis Results</h2>
                <div id="analysis-content">
                    <h3>Behavior Classification</h3>
                    <div id="behavior-results"></div>
                    <h3>System Summary</h3>
                    <div id="system-summary"></div>
                </div>
                <button onclick="this.parentElement.parentElement.remove()">Close</button>
            `;

            // Populate results
            if (results.behavior) {
                const behaviorDiv = content.querySelector('#behavior-results');
                behaviorDiv.innerHTML = Object.entries(results.behavior)
                    .map(([node, classification]) => 
                        `<p><strong>${node}</strong>: ${classification.behavior} (confidence: ${classification.confidence.toFixed(2)})</p>`
                    ).join('');
            }

            if (results.graphAnalysis) {
                const summaryDiv = content.querySelector('#system-summary');
                summaryDiv.innerHTML = `
                    <p>Nodes: ${Object.keys(results.simulation.history).length}</p>
                    <p>Cycles: ${results.graphAnalysis.cycles.cycleCount}</p>
                    <p>Has Cycles: ${results.graphAnalysis.cycles.hasCycles ? 'Yes' : 'No'}</p>
                `;
            }

            modal.appendChild(content);
            document.body.appendChild(modal);
        },

        /**
         * Create analysis button in the UI
         */
        addAnalysisButton() {
            const button = document.createElement('button');
            button.textContent = 'CLD Analysis';
            button.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                z-index: 1000;
                padding: 10px 15px;
                background: #007bff;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            `;

            button.onclick = async () => {
                try {
                    button.textContent = 'Analyzing...';
                    button.disabled = true;
                    
                    const results = await loopyInstance.cldAnalysis.analyze();
                    loopyInstance.cldUI.showResults(results);
                } catch (error) {
                    alert('Analysis failed: ' + error.message);
                } finally {
                    button.textContent = 'CLD Analysis';
                    button.disabled = false;
                }
            };

            document.body.appendChild(button);
        }
    };

    // CLD Engine is now integrated directly into existing analysis tabs
    console.log('CLD Engine integrated into existing analysis tabs');

    console.log('CLD Engine integrated successfully with Loopy');
    return integration;
}

// CLD Analysis is now integrated directly into existing tabs
// No separate tab setup needed

// CLD Engine integration is now complete and embedded in existing analysis tabs

// Auto-integration if loopy is available
if (typeof window !== 'undefined' && window.loopy) {
    console.log('Auto-integrating CLD Engine with existing Loopy instance');
    integrateCLDEngine(window.loopy);
}

// Export integration function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { integrateCLDEngine };
} else if (typeof window !== 'undefined') {
    window.integrateCLDEngine = integrateCLDEngine;
}
