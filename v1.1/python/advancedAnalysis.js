/**
 * Advanced Analysis Integration
 * 
 * Integrates the sophisticated Jupyter notebook backend algorithms
 * with the Loopy frontend.
 */

const ADVANCED_API_URL = CONFIG.API_URL;

// ── Background simulation state ───────────────────────────────────────────────
window.advancedSimStatus  = 'idle';   // 'idle' | 'running' | 'ready' | 'error'
window.advancedSimPromise = null;

function _setSimBadge(status) {
    const badge = document.getElementById('advSimBadge');
    if (!badge) return;
    const cfg = {
        idle:    { text: '',                 cls: '' },
        running: { text: 'sim: running',  cls: 'sim-badge--running' },
        ready:   { text: 'sim ready',     cls: 'sim-badge--ready' },
        error:   { text: 'sim failed',    cls: 'sim-badge--error' },
    }[status] || { text: '', cls: '' };
    badge.textContent   = cfg.text;
    badge.className     = `sim-badge ${cfg.cls}`;
    badge.style.display = status === 'idle' ? 'none' : 'inline-block';
}

/**
 * Kick off the advanced simulation in the background.
 * Called automatically when the user hits Play.
 */
function _applyClassificationsToNodes(classifications) {
    loopy.model.nodes.forEach(node => {
        node.classification = classifications[node.label] || null;
    });
    loopy.model.dirty();
}

function _clearNodeClassifications() {
    loopy.model.nodes.forEach(node => { node.classification = null; });
    loopy.model.dirty();
}

function triggerBackgroundAdvancedSim(iterations = 200) {
    if (!loopy.model.nodes.length || !loopy.model.edges.length) return;

    // Clear previous classifications immediately so stale rings don't persist
    _clearNodeClassifications();
    window.advancedSimStatus = 'running';
    _setSimBadge('running');

    const graphData = convertToAdvancedFormat(loopy.model.nodes, loopy.model.edges);

    window.advancedSimPromise = fetch(`${ADVANCED_API_URL}/advanced-simulation`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...graphData, iterations }),
    })
    .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
    .then(result => {
        if (result.time_series_data) window.advancedTimeSeries = result.time_series_data;
        if (result.classifications)  _applyClassificationsToNodes(result.classifications);
        window.advancedSimStatus = 'ready';
        _setSimBadge('ready');
    })
    .catch(err => {
        console.error('Background advanced sim error:', err);
        window.advancedSimStatus = 'error';
        _setSimBadge('error');
        if (typeof showToast === 'function') showToast(`Simulation failed: ${err.message}`, 'error', false);
    });
}

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
        start_amount: node.init ?? 0.1,
        retention: node.retention ?? 1.0,  // matches notebook default (simulate_two_phase uses 1.0)
        floor: isFinite(node.floor) ? node.floor : -999999,
        ceiling: isFinite(node.ceiling) ? node.ceiling : 999999,
        ...(node.formula       && { formula:        node.formula }),
        ...(node.sinkFormula   && { sink_formula:   node.sinkFormula }),
        ...(node.sourceFormula && { source_formula: node.sourceFormula }),
        ...(node.pass && { pass: node.pass })
    }));

    const edges = edgesToInclude.map(edge => ({
        source: edge.from.label,
        target: edge.to.label,
        correlation: edge.strength,
        decay: edge.damper ?? 0,
        delay: edge.lag ?? 0,         // matches EDGE_DEFAULTS in notebook (no delay by default)
        confidence: edge.confidence ?? 0.8
    }));

    return { nodes, edges };
}

/**
 * Run advanced two-phase simulation
 */
async function runAdvancedSimulation() {
    showTabLoading('advancedSimulationResults', 'Running simulation');
    
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

        // Cache time series + apply classifications to canvas nodes
        if (result.time_series_data) {
            window.advancedTimeSeries = result.time_series_data;
            window.advancedSimStatus  = 'ready';
            _setSimBadge('ready');
        }
        if (result.classifications) {
            _applyClassificationsToNodes(result.classifications);
        }

        // Display results
        displayAdvancedSimulationResults(result);

    } catch (error) {
        console.error('Advanced Simulation Error:', error);
        document.getElementById('advancedSimulationResults').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
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
    title.textContent = 'Simulation Results';
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
 * Run Monte Carlo fan chart simulation
 */
async function runFanChart() {
    showTabLoading('fanChartResults', 'Running Monte Carlo simulations...');
    try {
        const graphData = convertToAdvancedFormat(loopy.model.nodes, loopy.model.edges);
        const nSims = parseInt(document.getElementById('fanChartSims')?.value) || 200;
        const iterations = parseInt(document.getElementById('simIterations')?.value) || 200;

        const response = await fetch(`${ADVANCED_API_URL}/fan-chart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...graphData, iterations, n_sims: nSims, sigma_base: 0.25 })
        });

        if (!response.ok) throw new Error(`Backend error: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Fan chart failed');

        displayFanChartResults(result, 'fanChartResults');
    } catch (error) {
        console.error('Fan Chart Error:', error);
        document.getElementById('fanChartResults').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
}

function displayFanChartResults(result, containerId = 'fanChartResults') {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const info = document.createElement('p');
    info.style.cssText = 'font-size:13px;color:#999;margin:8px 0 16px';
    info.textContent = `${result.n_sims} simulations — shaded bands show 5–95% and 25–75% confidence intervals`;
    container.appendChild(info);

    const img = document.createElement('img');
    img.src = `data:image/png;base64,${result.plot}`;
    img.alt = 'Fan Chart';
    img.style.cssText = 'max-width:100%;border-radius:6px;border:1px solid #333';
    container.appendChild(img);
}

/**
 * Run two-stage parameter optimization
 */
async function runParameterOptimization() {
    showTabLoading('optimizationResults', 'Running parameter search...');
    try {
        const graphData = convertToAdvancedFormat(loopy.model.nodes, loopy.model.edges);
        const iterations = parseInt(document.getElementById('simIterations')?.value) || 200;

        const response = await fetch(`${ADVANCED_API_URL}/optimize-parameters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...graphData, iterations, max_refine_iters: 150 })
        });

        if (!response.ok) throw new Error(`Backend error: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Optimization failed');

        displayOptimizationResults(result);
    } catch (error) {
        console.error('Optimization Error:', error);
        document.getElementById('optimizationResults').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
}

const BEHAVIOR_COLORS_OPT = { 'Optimal': '#155724', 'Over-damped': '#856404', 'Unconstrained': '#721c24' };

function displayOptimizationResults(result) {
    const container = document.getElementById('optimizationResults');
    container.innerHTML = '';

    const th = s => `<th style="padding:8px 10px;text-align:left;color:#aaa">${s}</th>`;

    // ── Global Optimization ───────────────────────────────────────────────────
    const globalRows = result.top_configs.map(cfg => {
        const classEntries = Object.entries(cfg.classifications)
            .map(([node, cls]) => {
                const bg = BEHAVIOR_COLORS_OPT[cls] || '#333';
                return `<span style="background:${bg};color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;margin:2px;display:inline-block">${node}: ${cls}</span>`;
            }).join('');
        return `<tr style="border-bottom:1px solid #2a2a2a">
            <td style="padding:8px 10px;text-align:center;font-weight:700">${cfg.rank}</td>
            <td style="padding:8px 10px;font-family:monospace">${cfg.score.toFixed(4)}</td>
            <td style="padding:8px 10px;font-family:monospace">${cfg.config.retention.toFixed(2)}</td>
            <td style="padding:8px 10px;font-family:monospace">${cfg.config.decay.toFixed(2)}</td>
            <td style="padding:8px 10px;font-family:monospace">${cfg.config.delay}</td>
            <td style="padding:8px 10px">${classEntries}</td>
        </tr>`;
    }).join('');

    // ── Individual (per-node) Optimization ───────────────────────────────────
    let individualSection = '';
    if (result.node_best) {
        const nodeRows = Object.entries(result.node_best).map(([nodeName, info]) => {
            const allBeh = Object.entries(info.all_behaviors)
                .map(([n, cls]) => {
                    const bg = BEHAVIOR_COLORS_OPT[cls] || '#333';
                    return `<span style="background:${bg};color:#fff;padding:2px 5px;border-radius:3px;font-size:10px;margin:1px;display:inline-block">${n}: ${cls}</span>`;
                }).join('');
            const nodeBg = BEHAVIOR_COLORS_OPT[info.behavior] || '#333';
            return `<tr style="border-bottom:1px solid #2a2a2a">
                <td style="padding:8px 10px;font-weight:600">${nodeName}</td>
                <td style="padding:8px 10px"><span style="background:${nodeBg};color:#fff;padding:2px 8px;border-radius:3px;font-size:11px">${info.behavior}</span></td>
                <td style="padding:8px 10px;font-family:monospace">${info.config.retention.toFixed(2)}</td>
                <td style="padding:8px 10px;font-family:monospace">${info.config.decay.toFixed(2)}</td>
                <td style="padding:8px 10px;font-family:monospace">${info.config.delay}</td>
                <td style="padding:8px 10px;font-family:monospace">${info.score.toFixed(4)}</td>
                <td style="padding:8px 10px">${allBeh}</td>
            </tr>`;
        }).join('');

        individualSection = `
            <h4 style="margin:24px 0 8px;font-size:14px">Individual Node Optimization</h4>
            <p style="font-size:12px;color:#999;margin:0 0 10px">Best parameter config for each node to achieve Optimal behavior.</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="border-bottom:1px solid #444">
                    ${th('Node')}${th('Best Behavior')}${th('Retention')}${th('Decay')}${th('Delay')}${th('Score')}${th('All Node Behaviors')}
                </tr></thead>
                <tbody>${nodeRows}</tbody>
            </table>`;
    }

    container.innerHTML = `
        <h4 style="margin:0 0 8px;font-size:14px">Global Optimization</h4>
        <p style="font-size:12px;color:#999;margin:0 0 10px">
            Grid search + simulated annealing across all nodes — lower score is better.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="border-bottom:1px solid #444">
                ${th('Rank')}${th('Score')}${th('Retention')}${th('Decay')}${th('Delay')}${th('Node Behaviors')}
            </tr></thead>
            <tbody>${globalRows}</tbody>
        </table>
        ${individualSection}`;
}

// Attach event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    const advSimBtn = document.getElementById('runAdvancedSimulation');
    if (advSimBtn) advSimBtn.onclick = runAdvancedSimulation;

    const fanChartBtn = document.getElementById('runFanChart');
    if (fanChartBtn) fanChartBtn.onclick = runFanChart;

    const optimizeBtn = document.getElementById('runOptimization');
    if (optimizeBtn) optimizeBtn.onclick = runParameterOptimization;
});

console.log('Advanced Analysis module loaded');


