/**
 * Advanced Analysis Integration
 * 
 * Integrates the sophisticated Jupyter notebook backend algorithms
 * with the Loopy frontend.
 */

const ADVANCED_API_URL = 'https://loopyv2-640o.onrender.com';

/**
 * Convert Loopy graph data to advanced backend format
 * @param {Array} nodesToInclude - Filtered nodes from Loopy model
 * @param {Array} edgesToInclude - Filtered edges from Loopy model
 * @returns {Object} - Formatted data for advanced backend
 */
function convertToAdvancedFormat(nodesToInclude, edgesToInclude) {
    // Convert nodes
    const nodes = nodesToInclude.map(node => ({
        name: node.label,
        start_amount: node.init || 0.1,
        retention: node.retention || 0.3,  // Default from your notebook
        floor: isFinite(node.floor) ? node.floor : -999999,
        ceiling: isFinite(node.ceiling) ? node.ceiling : 999999,
        // Pass through additional properties if needed
        ...(node.formula && { formula: node.formula }),
        ...(node.pass && { pass: node.pass })
    }));

    // Convert edges
    const edges = edgesToInclude.map(edge => {
        // Determine correlation (strength with sign)
        const correlation = edge.strength;
        
        return {
            source: edge.from.label,
            target: edge.to.label,
            correlation: correlation,
            decay: edge.damper || 0.165,  // Edge decay (damper in your code)
            delay: edge.lag || 4,          // Edge delay (lag in your code)
            confidence: edge.confidence || 0.8
        };
    });

    return { nodes, edges };
}

/**
 * Run advanced two-phase simulation
 */
async function runAdvancedSimulation() {
    showLoadingSpinner();
    
    try {
        // Get selected nodes or all nodes
        const selectedNodes = loopy.multipleselect.getSelectedNodes();
        const hasSelection = selectedNodes.length > 0;
        
        const nodesToInclude = hasSelection
            ? loopy.model.nodes.filter(node => selectedNodes.includes(node))
            : loopy.model.nodes;
        
        const edgesToInclude = hasSelection
            ? loopy.model.edges.filter(edge =>
                selectedNodes.includes(edge.from) && selectedNodes.includes(edge.to)
              )
            : loopy.model.edges;

        // Convert to advanced format
        const graphData = convertToAdvancedFormat(nodesToInclude, edgesToInclude);
        
        // Get iterations from UI input (if exists) or use default
        const iterations = parseInt(document.getElementById('advancedIterations')?.value) || 200;
        
        const requestData = {
            ...graphData,
            iterations: iterations
        };

        console.log('Advanced Simulation Request:', requestData);

        // Call advanced backend
        const response = await fetch(`${ADVANCED_API_URL}/advanced-simulation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        
        console.log('Advanced Simulation Result:', result);

        // Display results
        displayAdvancedSimulationResults(result);

    } catch (error) {
        console.error('Advanced Simulation Error:', error);
        alert(`Failed to run advanced simulation:\n${error.message}`);
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Display advanced simulation results
 */
function displayAdvancedSimulationResults(result) {
    const container = document.getElementById('advancedSimulationResults');
    if (!container) {
        console.warn('advancedSimulationResults container not found');
        return;
    }

    container.innerHTML = '';

    // Add title
    const title = document.createElement('h3');
    title.textContent = 'Advanced Two-Phase Simulation Results';
    title.style.marginTop = '20px';
    container.appendChild(title);

    // Display behavior classifications
    const classSection = document.createElement('div');
    classSection.style.marginBottom = '20px';
    
    const classTitle = document.createElement('h4');
    classTitle.textContent = 'Node Behavior Classifications:';
    classSection.appendChild(classTitle);

    const classificationsList = document.createElement('ul');
    classificationsList.style.listStyle = 'none';
    classificationsList.style.padding = '0';
    
    for (const [node, classification] of Object.entries(result.classifications)) {
        const item = document.createElement('li');
        item.style.padding = '5px 10px';
        item.style.marginBottom = '5px';
        item.style.borderRadius = '4px';
        
        // Color code by classification
        if (classification === 'Optimal') {
            item.style.backgroundColor = '#d4edda';
            item.style.color = '#155724';
        } else if (classification === 'Over-damped') {
            item.style.backgroundColor = '#fff3cd';
            item.style.color = '#856404';
        } else if (classification === 'Unconstrained') {
            item.style.backgroundColor = '#f8d7da';
            item.style.color = '#721c24';
        }
        
        item.innerHTML = `<strong>${node}</strong>: ${classification}`;
        classificationsList.appendChild(item);
    }
    classSection.appendChild(classificationsList);
    container.appendChild(classSection);

    // Display time series plot
    if (result.plots && result.plots.time_series) {
        const plotSection = document.createElement('div');
        plotSection.style.marginBottom = '20px';
        
        const plotTitle = document.createElement('h4');
        plotTitle.textContent = 'Time Series (Two-Phase Dynamics):';
        plotSection.appendChild(plotTitle);
        
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${result.plots.time_series}`;
        img.alt = 'Advanced Time Series';
        img.style.maxWidth = '100%';
        img.style.border = '1px solid #ddd';
        img.style.borderRadius = '4px';
        plotSection.appendChild(img);
        
        container.appendChild(plotSection);
    }

    // Display Z-scores plot
    if (result.plots && result.plots.z_scores) {
        const zScoreSection = document.createElement('div');
        zScoreSection.style.marginBottom = '20px';
        
        const zScoreTitle = document.createElement('h4');
        zScoreTitle.textContent = 'Rolling Z-Scores (Stability Analysis):';
        zScoreSection.appendChild(zScoreTitle);
        
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${result.plots.z_scores}`;
        img.alt = 'Z-Scores';
        img.style.maxWidth = '100%';
        img.style.border = '1px solid #ddd';
        img.style.borderRadius = '4px';
        zScoreSection.appendChild(img);
        
        container.appendChild(zScoreSection);
    }

    // Add download button for time series data
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Time Series Data (CSV)';
    downloadBtn.className = 'button';
    downloadBtn.style.marginTop = '10px';
    downloadBtn.onclick = () => downloadTimeSeriesCSV(result.time_series_data);
    container.appendChild(downloadBtn);
}

/**
 * Run advanced stability map analysis
 */
async function runAdvancedStabilityMap() {
    showLoadingSpinner();
    
    try {
        const selectedNodes = loopy.multipleselect.getSelectedNodes();
        const hasSelection = selectedNodes.length > 0;
        
        const nodesToInclude = hasSelection
            ? loopy.model.nodes.filter(node => selectedNodes.includes(node))
            : loopy.model.nodes;
        
        const edgesToInclude = hasSelection
            ? loopy.model.edges.filter(edge =>
                selectedNodes.includes(edge.from) && selectedNodes.includes(edge.to)
              )
            : loopy.model.edges;

        const graphData = convertToAdvancedFormat(nodesToInclude, edgesToInclude);
        
        // Get parameter ranges from UI
        const decayMin = parseFloat(document.getElementById('advDecayMin')?.value) || 0.0;
        const decayMax = parseFloat(document.getElementById('advDecayMax')?.value) || 1.0;
        const decaySteps = parseInt(document.getElementById('advDecaySteps')?.value) || 11;
        
        const delayMin = parseInt(document.getElementById('advDelayMin')?.value) || 0;
        const delayMax = parseInt(document.getElementById('advDelayMax')?.value) || 10;
        const delaySteps = parseInt(document.getElementById('advDelaySteps')?.value) || 11;
        
        const iterations = parseInt(document.getElementById('advMapIterations')?.value) || 100;

        const requestData = {
            ...graphData,
            decay_range: [decayMin, decayMax, decaySteps],
            delay_range: [delayMin, delayMax, delaySteps],
            iterations: iterations
        };

        console.log('Advanced Stability Map Request:', requestData);
        console.log('Note: This may take 30-60 seconds for full 11x11 grid...');

        const response = await fetch(`${ADVANCED_API_URL}/advanced-stability-map`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        
        console.log('Advanced Stability Map Result received');

        // Display the stability map
        displayAdvancedStabilityMap(result);

    } catch (error) {
        console.error('Advanced Stability Map Error:', error);
        alert(`Failed to generate stability map:\n${error.message}`);
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Display advanced stability map results
 */
function displayAdvancedStabilityMap(result) {
    const container = document.getElementById('advancedStabilityMapResults');
    if (!container) {
        console.warn('advancedStabilityMapResults container not found');
        return;
    }

    container.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = 'Advanced Parameter Space Stability Map';
    title.style.marginTop = '20px';
    container.appendChild(title);

    // Display the heatmap
    if (result.plot) {
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${result.plot}`;
        img.alt = 'Advanced Stability Map';
        img.style.maxWidth = '100%';
        img.style.border = '1px solid #ddd';
        img.style.borderRadius = '4px';
        container.appendChild(img);
    }

    // Add info text
    const info = document.createElement('p');
    info.style.marginTop = '15px';
    info.style.fontSize = '14px';
    info.style.color = '#666';
    info.innerHTML = `
        <strong>Map Guide:</strong><br>
        🔵 Blue (0.2) = Over-damped: Stable but sluggish<br>
        ⚪ White (0.6) = Optimal: Good balance<br>
        🔴 Red (1.0) = Unconstrained: Unstable/divergent<br>
        <br>
        Grid: ${result.delay_values.length} delay values × ${result.decay_values.length} decay values
    `;
    container.appendChild(info);

    // Add download button
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Stability Matrix (CSV)';
    downloadBtn.className = 'button';
    downloadBtn.style.marginTop = '10px';
    downloadBtn.onclick = () => downloadStabilityMatrixCSV(result);
    container.appendChild(downloadBtn);
}

/**
 * Download time series data as CSV
 */
function downloadTimeSeriesCSV(timeSeriesData) {
    const rows = [];
    const nodes = Object.keys(timeSeriesData);
    const maxLength = Math.max(...nodes.map(n => timeSeriesData[n].length));
    
    // Header
    rows.push(['Time Step', ...nodes].join(','));
    
    // Data rows
    for (let i = 0; i < maxLength; i++) {
        const row = [i];
        for (const node of nodes) {
            const value = timeSeriesData[node][i];
            row.push(value !== null && value !== undefined ? value : '');
        }
        rows.push(row.join(','));
    }
    
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'advanced_time_series.csv';
    a.click();
    
    URL.revokeObjectURL(url);
}

/**
 * Download stability matrix as CSV
 */
function downloadStabilityMatrixCSV(result) {
    const rows = [];
    const matrix = result.stability_matrix;
    const decayVals = result.decay_values;
    const delayVals = result.delay_values;
    
    // Header: decay values
    rows.push(['Delay \\ Decay', ...decayVals.map(v => v.toFixed(2))].join(','));
    
    // Data rows: each delay with its row of values
    for (let i = 0; i < matrix.length; i++) {
        rows.push([delayVals[i], ...matrix[i].map(v => v.toFixed(3))].join(','));
    }
    
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'advanced_stability_map.csv';
    a.click();
    
    URL.revokeObjectURL(url);
}

// Attach event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Advanced Simulation button
    const advSimBtn = document.getElementById('runAdvancedSimulation');
    if (advSimBtn) {
        advSimBtn.onclick = runAdvancedSimulation;
    }
    
    // Advanced Stability Map button
    const advMapBtn = document.getElementById('runAdvancedStabilityMap');
    if (advMapBtn) {
        advMapBtn.onclick = runAdvancedStabilityMap;
    }
});

console.log('✅ Advanced Analysis module loaded');


