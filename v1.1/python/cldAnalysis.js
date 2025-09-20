/**
 * CLD Analysis Tab Implementation
 * 
 * This file implements the CLD Analysis tab following the same pattern
 * as other analysis tabs in the system.
 */

// Global variables for CLD analysis
let cldAnalysisResults = {};
let cldTimeSeriesData = {};

// Utility functions (same as other analysis files)
function showLoadingSpinner() {
    document.getElementById('loading-spinner').style.display = 'block';
}

function hideLoadingSpinner() {
    document.getElementById('loading-spinner').style.display = 'none';
}

/**
 * Load initial data from Loopy model
 * Similar to loadInitialData in cycleAnalysis.js
 */
const loadCLDInitialData = async () => {
    try {
        // Clear previous data
        cldTimeSeriesData = {};
        cldAnalysisResults = {};

        // 1. Capture time series data if it exists in Chart
        cldTimeSeriesData = chart?.data?.datasets?.length
            ? chart.data.datasets.reduce((acc, dataset) => {
                acc[dataset.label] = [...dataset.data];
                return acc;
            }, {})
            : {};

        if (!Object.keys(cldTimeSeriesData).length) {
            alert('Please run the diagram to access CLD analysis (no time series data found).');
            return null;
        }

        // 2. Get selected nodes or all nodes
        const selectedNodes = loopy.multipleselect.getSelectedNodes();
        const hasSelection = selectedNodes.length > 0;

        const nodesToInclude = hasSelection
            ? loopy.model.nodes.filter(node => selectedNodes.includes(node.label))
            : loopy.model.nodes;

        const edgesToInclude = hasSelection
            ? loopy.model.edges.filter(edge =>
                selectedNodes.includes(edge.from.label) &&
                selectedNodes.includes(edge.to.label)
            )
            : loopy.model.edges;

        return {
            nodes: nodesToInclude,
            edges: edgesToInclude,
            timeSeriesData: cldTimeSeriesData,
            hasSelection
        };

    } catch (error) {
        console.error('Error loading CLD initial data:', error);
        throw error;
    }
};

/**
 * Update analysis status message
 */
function updateCLDAnalysisStatus(message, isError = false) {
    const statusElement = document.getElementById('cldAnalysisStatus');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = isError ? 'status-message error' : 'status-message';
    }
}

/**
 * Display behavior classification results
 */
function displayBehaviorResults(behavior) {
    const behaviorTable = document.getElementById('behaviorTable');
    if (!behaviorTable) return;

    let html = '<table border="1" style="border-collapse: collapse; width: 100%;">';
    html += '<tr><th>Node</th><th>Behavior</th><th>Confidence</th><th>Metrics</th></tr>';

    for (const [nodeId, classification] of Object.entries(behavior)) {
        const behaviorClass = classification.behavior.toLowerCase().replace(/\s+/g, '-');
        html += `<tr>
            <td>${nodeId}</td>
            <td><span class="behavior-${behaviorClass}" style="
                padding: 4px 8px; 
                border-radius: 4px; 
                color: white; 
                font-weight: bold;
                background: ${getBehaviorColor(classification.behavior)};
            ">${classification.behavior}</span></td>
            <td>${classification.confidence.toFixed(2)}</td>
            <td>Mean Z: ${classification.metrics.meanAbsZ.toFixed(2)}, Max Z: ${classification.metrics.maxAbsZ.toFixed(2)}</td>
        </tr>`;
    }

    html += '</table>';
    behaviorTable.innerHTML = html;
}

/**
 * Display system summary
 */
function displaySystemSummary(graphAnalysis, simulation) {
    const summaryContent = document.getElementById('summaryContent');
    if (!summaryContent) return;

    const nodeCount = Object.keys(simulation.history).length;
    const cycleCount = graphAnalysis.cycles.cycleCount;
    const hasCycles = graphAnalysis.cycles.hasCycles;

    summaryContent.innerHTML = `
        <div class="summary-stats">
            <p><strong>Nodes:</strong> ${nodeCount}</p>
            <p><strong>Simulation Steps:</strong> ${simulation.steps}</p>
            <p><strong>Feedback Cycles:</strong> ${cycleCount}</p>
            <p><strong>Has Cycles:</strong> ${hasCycles ? 'Yes' : 'No'}</p>
            <p><strong>Analysis Timestamp:</strong> ${new Date().toLocaleString()}</p>
        </div>
    `;
}

/**
 * Display recommendations
 */
function displayRecommendations(recommendations) {
    const recommendationsContent = document.getElementById('recommendationsContent');
    if (!recommendationsContent) return;

    if (!recommendations || recommendations.length === 0) {
        recommendationsContent.innerHTML = '<p>No specific recommendations at this time.</p>';
        return;
    }

    let html = '<ul>';
    recommendations.forEach(rec => {
        html += `<li>
            <strong>${rec.type.toUpperCase()}</strong> (${rec.priority} priority): 
            ${rec.message}
            ${rec.action ? `<br><em>Action: ${rec.action}</em>` : ''}
        </li>`;
    });
    html += '</ul>';

    recommendationsContent.innerHTML = html;
}

/**
 * Display Monte Carlo results
 */
function displayMonteCarloResults(monteCarlo) {
    const visualizationContent = document.getElementById('visualizationContent');
    if (!visualizationContent) return;

    visualizationContent.innerHTML = `
        <h5>Monte Carlo Analysis</h5>
        <p><strong>Runs:</strong> ${monteCarlo.config.runs}</p>
        <p><strong>Fan Paths:</strong> ${monteCarlo.config.fanPaths}</p>
        <p><strong>Sigma Base:</strong> ${monteCarlo.config.sigmaBase}</p>
        <p>Uncertainty analysis completed. Results available for visualization and export.</p>
    `;
}

/**
 * Display parameter space results
 */
function displayParameterSpaceResults(parameterSpace) {
    const visualizationContent = document.getElementById('visualizationContent');
    if (!visualizationContent) return;

    const totalCombinations = parameterSpace.results.length;
    if (totalCombinations === 0) {
        visualizationContent.innerHTML = '<p>No parameter space results available.</p>';
        return;
    }

    const bestResult = parameterSpace.results.sort((a, b) => b.stability - a.stability)[0];

    visualizationContent.innerHTML = `
        <h5>Parameter Space Analysis</h5>
        <p><strong>Total Combinations:</strong> ${totalCombinations}</p>
        <p><strong>Best Parameters:</strong> Retention=${bestResult.retention.toFixed(2)}, Decay=${bestResult.decay.toFixed(2)}, Delay=${bestResult.delay}</p>
        <p><strong>Best Stability Score:</strong> ${bestResult.stability.toFixed(3)}</p>
    `;
}

/**
 * Helper function to get behavior colors
 */
function getBehaviorColor(behavior) {
    const colors = {
        'Overdamped': '#6c757d',
        'Optimal': '#28a745',
        'Unconstrained': '#dc3545',
        'Oscillatory': '#ffc107',
        'Damped Oscillatory': '#fd7e14',
        'Unknown': '#6c757d'
    };
    return colors[behavior] || colors['Unknown'];
}

/**
 * Export results as JSON
 */
function exportCLDResultsJSON() {
    if (!cldAnalysisResults || Object.keys(cldAnalysisResults).length === 0) {
        alert('No results to export. Run an analysis first.');
        return;
    }

    try {
        const jsonData = JSON.stringify(cldAnalysisResults, null, 2);
        downloadFile(jsonData, 'cld-analysis-results.json', 'application/json');
        updateCLDAnalysisStatus('Results exported as JSON successfully');
    } catch (error) {
        updateCLDAnalysisStatus('Export failed: ' + error.message, true);
    }
}

/**
 * Export results as CSV
 */
function exportCLDResultsCSV() {
    if (!cldAnalysisResults || Object.keys(cldAnalysisResults).length === 0) {
        alert('No results to export. Run an analysis first.');
        return;
    }

    try {
        const csvData = convertToCSV(cldAnalysisResults);
        downloadFile(csvData, 'cld-analysis-results.csv', 'text/csv');
        updateCLDAnalysisStatus('Results exported as CSV successfully');
    } catch (error) {
        updateCLDAnalysisStatus('Export failed: ' + error.message, true);
    }
}

/**
 * Convert results to CSV format
 */
function convertToCSV(results) {
    const lines = [];
    lines.push('Type,Node,Step,Value');

    if (results.simulation && results.simulation.history) {
        for (const [nodeId, series] of Object.entries(results.simulation.history)) {
            for (let i = 0; i < series.length; i++) {
                lines.push(`timeSeries,${nodeId},${i},${series[i]}`);
            }
        }
    }

    if (results.behavior) {
        lines.push('Type,Node,Behavior,Confidence');
        for (const [nodeId, classification] of Object.entries(results.behavior)) {
            lines.push(`behavior,${nodeId},${classification.behavior},${classification.confidence}`);
        }
    }

    return lines.join('\n');
}

/**
 * Download file helper
 */
function downloadFile(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// CLD Analysis Tab Event Listener
document.getElementById('cldAnalysisTab').addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    console.log("CLD Analysis clicked");

    showLoadingSpinner();
    updateCLDAnalysisStatus('Loading data...');

    try {
        // Load initial data
        const data = await loadCLDInitialData();
        if (!data) return;

        updateCLDAnalysisStatus('Data loaded successfully');

    } catch (error) {
        console.error('CLD Analysis error:', error);
        updateCLDAnalysisStatus('Failed to load data: ' + error.message, true);
    } finally {
        hideLoadingSpinner();
    }
});

// Quick Analysis Button
document.getElementById('runQuickAnalysis').addEventListener('click', async () => {
    showLoadingSpinner();
    updateCLDAnalysisStatus('Running quick analysis...');

    try {
        const steps = parseInt(document.getElementById('analysisSteps')?.value || 50);
        
        if (!loopy || !loopy.model) {
            throw new Error('Loopy model not available');
        }

        const results = await loopy.model.runCompleteCLDAnalysis({
            steps: steps,
            monteCarloRuns: 100, // Smaller for quick analysis
            gridSize: 5
        });

        cldAnalysisResults = results;

        // Display results
        if (results.behavior) {
            displayBehaviorResults(results.behavior);
        }

        if (results.graphAnalysis) {
            displaySystemSummary(results.graphAnalysis, results.simulation);
        }

        updateCLDAnalysisStatus('Quick analysis completed successfully');

    } catch (error) {
        console.error('Quick analysis error:', error);
        updateCLDAnalysisStatus('Quick analysis failed: ' + error.message, true);
    } finally {
        hideLoadingSpinner();
    }
});

// Full Analysis Button
document.getElementById('runFullAnalysis').addEventListener('click', async () => {
    showLoadingSpinner();
    updateCLDAnalysisStatus('Running full analysis...');

    try {
        const steps = parseInt(document.getElementById('analysisSteps')?.value || 100);
        const monteCarloRuns = parseInt(document.getElementById('monteCarloRuns')?.value || 500);
        const gridSize = parseInt(document.getElementById('gridSize')?.value || 10);

        if (!loopy || !loopy.model) {
            throw new Error('Loopy model not available');
        }

        const results = await loopy.model.runCompleteCLDAnalysis({
            steps,
            monteCarloRuns,
            gridSize
        });

        cldAnalysisResults = results;

        // Display all results
        if (results.behavior) {
            displayBehaviorResults(results.behavior);
        }

        if (results.graphAnalysis) {
            displaySystemSummary(results.graphAnalysis, results.simulation);
        }

        if (results.monteCarlo) {
            displayMonteCarloResults(results.monteCarlo);
        }

        if (results.parameterSpace) {
            displayParameterSpaceResults(results.parameterSpace);
        }

        // Generate recommendations
        try {
            if (typeof CLDEngineExample !== 'undefined') {
                const example = new CLDEngineExample();
                const report = example.generateReport(results);
                if (report.recommendations) {
                    displayRecommendations(report.recommendations);
                }
            }
        } catch (recError) {
            console.warn('Could not generate recommendations:', recError);
        }

        updateCLDAnalysisStatus('Full analysis completed successfully');

    } catch (error) {
        console.error('Full analysis error:', error);
        updateCLDAnalysisStatus('Full analysis failed: ' + error.message, true);
    } finally {
        hideLoadingSpinner();
    }
});

// Monte Carlo Button
document.getElementById('runMonteCarlo').addEventListener('click', async () => {
    showLoadingSpinner();
    updateCLDAnalysisStatus('Running Monte Carlo analysis...');

    try {
        const steps = parseInt(document.getElementById('analysisSteps')?.value || 100);
        const monteCarloRuns = parseInt(document.getElementById('monteCarloRuns')?.value || 500);

        if (!loopy || !loopy.model) {
            throw new Error('Loopy model not available');
        }

        const results = await loopy.model.runMonteCarloAnalysis({
            runs: monteCarloRuns,
            fanPaths: 10,
            steps: steps
        });

        cldAnalysisResults.monteCarlo = results;
        displayMonteCarloResults(results);

        updateCLDAnalysisStatus('Monte Carlo analysis completed successfully');

    } catch (error) {
        console.error('Monte Carlo analysis error:', error);
        updateCLDAnalysisStatus('Monte Carlo analysis failed: ' + error.message, true);
    } finally {
        hideLoadingSpinner();
    }
});

// Parameter Space Button
document.getElementById('runParameterSpace').addEventListener('click', async () => {
    showLoadingSpinner();
    updateCLDAnalysisStatus('Running parameter space analysis...');

    try {
        const steps = parseInt(document.getElementById('analysisSteps')?.value || 100);
        const gridSize = parseInt(document.getElementById('gridSize')?.value || 10);

        if (!loopy || !loopy.model) {
            throw new Error('Loopy model not available');
        }

        const results = await loopy.model.runParameterSpaceAnalysis({
            gridSize: gridSize,
            steps: steps
        });

        cldAnalysisResults.parameterSpace = results;
        displayParameterSpaceResults(results);

        updateCLDAnalysisStatus('Parameter space analysis completed successfully');

    } catch (error) {
        console.error('Parameter space analysis error:', error);
        updateCLDAnalysisStatus('Parameter space analysis failed: ' + error.message, true);
    } finally {
        hideLoadingSpinner();
    }
});

// Export Results Button
document.getElementById('exportResults').addEventListener('click', () => {
    if (!cldAnalysisResults || Object.keys(cldAnalysisResults).length === 0) {
        alert('No results to export. Run an analysis first.');
        return;
    }

    // Show export options
    const exportFormat = confirm('Click OK for JSON export, Cancel for CSV export') ? 'json' : 'csv';
    
    if (exportFormat === 'json') {
        exportCLDResultsJSON();
    } else {
        exportCLDResultsCSV();
    }
});

console.log('CLD Analysis tab event listeners initialized');
