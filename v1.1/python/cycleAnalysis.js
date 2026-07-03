const BACKEND_URL = CONFIG.API_URL;

// Warmup ping (re-enable for Render production)
// fetch(`${BACKEND_URL}/`).catch(() => {});

// ── Per-tab inline loading ────────────────────────────────────────────────────
let _tabLoadingTimer = null;

function showTabLoading(containerId, message = 'Loading') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<div class="tab-loading"><div class="spinner-ring"></div><span class="spinner-text">${message}</span></div>`;
    const textEl = el.querySelector('.spinner-text');
    const start = Date.now();
    clearInterval(_tabLoadingTimer);
    _tabLoadingTimer = setInterval(() => {
        if (!el.querySelector('.spinner-text')) { clearInterval(_tabLoadingTimer); return; }
        const elapsed = Math.floor((Date.now() - start) / 1000);
        if (elapsed >= 15)     textEl.textContent = `Backend is starting up... (${elapsed}s)`;
        else if (elapsed >= 5) textEl.textContent = `Still working... (${elapsed}s)`;
    }, 1000);
}

function clearTabLoading() {
    clearInterval(_tabLoadingTimer);
    _tabLoadingTimer = null;
}

// Global overlay — only kept for Stripe checkout redirect
function showLoadingSpinner() {
    const s = document.getElementById('loading-spinner');
    if (s) s.style.display = 'flex';
}
function hideLoadingSpinner() {
    const s = document.getElementById('loading-spinner');
    if (s) s.style.display = 'none';
}

// Global arrays (if you wish to keep them as globals)
let edgePairs = [];
let edgePolarities = [];
let edgeWeights = [];
let edgeDelays = [];
let edgeCertainties = [];
let duplicateLabels = [];
let variables = [];
let timeSeriesData = {};

let edgeNodesPairs = [];

// Utility for small async delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// Example function that updates edgePolarities asynchronously
// If your code does not need this small delay or logic, you can remove it.
const delayNodeAdding = async (from, to, label) => {
    await delay(2);
    const index = edgePairs.findIndex(pair => pair[0] === from.label && pair[1] === to.label);
    if (index !== -1 && edgePolarities[index] !== label) {
        edgePolarities[index] = label;
    }
};

// Store every [node.id, node.label] pair so we can detect duplicates
const addEdgeNodePair = (from, to) => {
    const edgeNodePair = [[from.id, from.label], [to.id, to.label]];
    edgeNodesPairs.push(edgeNodePair);
};

// Check if multiple different node IDs share the same label
// (Loopy can allow duplicate labels).
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

/**
 * loadInitialData
 * 
 * Gathers the latest state of nodes, edges, and time-series from Loopy.
 * Returns an object with all data needed by the backend.
 */
const loadInitialData = async () => {
    // Clear arrays from any previous runs (optional).
    edgePairs = [];
    edgePolarities = [];
    edgeWeights = [];
    edgeDelays = [];
    edgeCertainties = [];
    edgeNodesPairs = [];
    duplicateLabels = [];
    variables = [];

    // 1. Capture time series data if it exists in your Chart
    //    If no data, we alert the user.
    timeSeriesData =
      chart?.data?.datasets?.length
        ? chart.data.datasets.reduce((acc, dataset) => {
            acc[dataset.label] = [...dataset.data];
            return acc;
          }, {})
        : {};

    if (!Object.keys(timeSeriesData).length) {
        alert('Please run the diagram to access all tabs (no time series data found).');
        return null; 
    }

    // 2. Filter nodes & edges based on user selection or entire Loopy model
    const selectedNodes = loopy.multipleselect.getSelectedNodes(); // array of node.labels selected
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

    // 3. Collect variables (node labels)
    nodesToInclude.forEach(node => {
        variables.push(node.label);
    });

    // 4. Collect edge data
    for (const edge of edgesToInclude) {
        const node1 = edge.from;
        const node2 = edge.to;

        // Track the node info for detecting duplicate labels
        addEdgeNodePair(node1, node2);

        // Push edge attributes
        edgeWeights.push(edge.damper);
        edgeDelays.push(edge.lag);
        edgeCertainties.push(edge.confidence);

        // Delay-based labeling logic
        await delayNodeAdding(node1, node2, edge.label);

        // Build the edge pair if it’s not already present
        const edgePair = [node1.label, node2.label];
        const exists = edgePairs.some(pair =>
            pair[0] === edgePair[0] && pair[1] === edgePair[1]
        );
        if (!exists) {
            edgePairs.push(edgePair);
            edgePolarities.push(edge.strength); // e.g., '+' or '-'
        }
    }

    // 5. Find & store labels that appear on multiple node IDs
    findDuplicateLabels();

    // 6. OPTIONAL: If your backend expects passNodes, floors, ceilings, etc.,
    //    define them here or fetch them from your UI.
    //    For demonstration, let's define some empty placeholders.
    const passnodeList = loopy.model.nodes
    .filter(node => node.isPassNode)
    .map(node => node.label);

    const nodeFloors = loopy.model.nodes.reduce((acc, node) => {
        acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
        return acc;
    }, {});
    
    const nodeCeilings = loopy.model.nodes.reduce((acc, node) => {
        acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
        return acc;
    }, {});

    // 7. Return a single object containing everything the backend needs.
    //    The backend's route will read these fields to rebuild the graph.
    return {
        edges: edgePairs,            // array of [sourceLabel, targetLabel]
        edgeWeights,                 // array of numeric weights
        edgePolarities,              // array of '+' or '-' (etc.)
        edgeDelays,                  // array of numeric delays
        edgeCertainties,             // array of numeric certainties
        passNodes: passnodeList,                   // array of node labels that should be pass-nodes
        nodeFloors,                  // object with { [nodeLabel]: number }
        nodeCeilings,                // object with { [nodeLabel]: number }
        timeSeriesData,              // node -> array of numeric values
        variables,                   // node labels, if needed
        duplicateLabels,             // for debugging or special handling
    };
};

document.getElementById('cycleAnalysisTab').onclick = async () => {
    openPage('CycleAnalysis');
    showTabLoading('cycleTable', 'Analyzing cycles');
    await loadInitialData();

    const payload = {
        edges: edgePairs,
        edge_polarities: edgePolarities
    };

    try {
        const response = await fetch(`${BACKEND_URL}/cycle-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        document.getElementById("cycleTable").innerHTML = data.table;

        const duplicateNodesWithEdgesWarningId = document.getElementById("duplicateNodesWithEdgesWarning");
        duplicateNodesWithEdgesWarningId.innerHTML = 'Duplicate Nodes: ';
        duplicateLabels.forEach(label => {
            duplicateNodesWithEdgesWarningId.innerHTML += `<span>${label}; </span>`;
        });
    } catch (error) {
        console.error("Error fetching cycle analysis data:", error);
        document.getElementById("cycleTable").innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
};

// Crisis Analysis Event Listener
document.getElementById('crisisAnalysisTab').addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPage('CrisisAnalysis');
    showTabLoading('crisisAnalysisPlots', 'Analyzing');

    try {
        await loadInitialData();

        if (Object.keys(timeSeriesData).length === 0) {
            throw new Error("No valid time series data to send.");
        }

        const response = await fetch(`${BACKEND_URL}/crisis-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ time_series_data: timeSeriesData, start_iteration: 0 })
        });

        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

        const blob = await response.blob();
        const container = document.getElementById('crisisAnalysisPlots');
        container.innerHTML = '';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.alt = "Crisis Analysis Plot";
        container.appendChild(img);
    } catch (error) {
        console.error("Error:", error);
        document.getElementById('crisisAnalysisPlots').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
});

// CLD Analysis is now integrated into existing analysis tabs
// No separate tab needed

// CLD analysis functions are now integrated into existing analysis tabs

document.getElementById('degreeCentralityTab').onclick = async () => {
    openPage('DegreeCentrality');
    showTabLoading('centralityTable', 'Analyzing');
    await loadInitialData();

    try {
        const response = await fetch(`${BACKEND_URL}/degree-centrality`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edges: edgePairs, edge_polarities: edgePolarities })
        });

        if (!response.ok) throw new Error(`Backend Error: ${response.statusText}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        document.getElementById("centralityTable").innerHTML = data.centrality_output;
    } catch (error) {
        console.error("Error fetching centrality data:", error);
        document.getElementById("centralityTable").innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
};

document.getElementById('visualAnalysisTab').onclick = async () => {
    openPage('VisualAnalysis');
    showTabLoading('visualAnalysisPlots', 'Analyzing');
    try {
        const data = await loadInitialData();

        if (!data || edgePairs.length === 0) {
            throw new Error("No edges found. Please create a graph with nodes and edges first.");
        }

        const response = await fetch(`${BACKEND_URL}/visual-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, edge_polarities: edgePolarities })
        });

        if (!response.ok) throw new Error(`Failed to fetch visual analysis: ${response.statusText}`);
        const result = await response.json();
        if (result.error) throw new Error(`Backend error: ${result.error}`);

        const plotsContainer = document.getElementById('visualAnalysisPlots');
        plotsContainer.innerHTML = '';

        if (!result.plots || result.plots.length === 0) {
            plotsContainer.innerHTML = '<div class="error">No plots were generated.</div>';
            return;
        }

        result.plots.forEach(dataUrl => {
            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = 'Visual Analysis Plot';
            img.style.maxWidth = '100%';
            plotsContainer.appendChild(img);
        });
    } catch (error) {
        console.error("Error fetching visual analysis:", error);
        document.getElementById('visualAnalysisPlots').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
};


// Correlation Analysis Event Listener
document.getElementById('correlationTab').addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPage('Correlation');
    showTabLoading('correlationPlot', 'Analyzing');

    try {
        await loadInitialData();

        if (edgePairs.length === 0) {
            throw new Error("No valid edges provided for correlation analysis.");
        }

        const response = await fetch(`${BACKEND_URL}/correlation-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edges: edgePairs, time_series_data: timeSeriesData })
        });

        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

        const container = document.getElementById('correlationPlot');
        container.innerHTML = '';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(await response.blob());
        img.alt = "Correlation Analysis Plot";
        container.appendChild(img);
    } catch (error) {
        console.error("Error fetching correlation analysis:", error);
        document.getElementById('correlationPlot').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
});


// Generate all 3 stability maps in parallel (Decay vs Delay, Decay vs Retention, Retention vs Delay)
document.getElementById("generateAllStabilityMaps").onclick = async () => {
    showTabLoading('stabilityMapPlot', 'Generating maps');
    const data = await loadInitialData();
    if (!data) { clearTabLoading(); return; }

    const decayMin      = parseFloat(document.getElementById("decayMin").value);
    const decayMax      = parseFloat(document.getElementById("decayMax").value);
    const decaySteps    = parseInt(document.getElementById("decaySteps").value);
    const delayMin      = parseFloat(document.getElementById("delayMin").value);
    const delayMax      = parseFloat(document.getElementById("delayMax").value);
    const delaySteps    = parseInt(document.getElementById("delaySteps").value);
    const retentionMin  = parseFloat(document.getElementById("nodeRetentionMin").value);
    const retentionMax  = parseFloat(document.getElementById("nodeRetentionMax").value);
    const retentionSteps = parseInt(document.getElementById("nodeRetentionSteps").value);

    const decayRange     = [decayMin, decayMax, decaySteps];
    const delayRange     = [delayMin, delayMax, delaySteps];
    const retentionRange = [retentionMin, retentionMax, retentionSteps];

    const fetchMap = (endpoint, payload, label) =>
        fetch(`${BACKEND_URL}/${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }).then(async r => {
            if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
            const data = await r.json();
            if (data && data.error) throw new Error(`${label}: ${data.error}`);
            return { label, data };
        });

    try {
        const results = await Promise.all([
            fetchMap("generate-stability-map",       { ...data, decayRange, delayRange },               "Decay vs Delay"),
            fetchMap("generate-decay-retention-map", { ...data, decayRange, retentionRange },             "Decay vs Retention"),
            fetchMap("generate-retention-delay-map", { ...data, retentionRange, delayRange },             "Retention vs Delay"),
        ]);

        const container = document.getElementById("stabilityMapPlot");
        container.innerHTML = "";
        container.style.display = "flex";
        container.style.flexWrap = "wrap";
        container.style.gap = "12px";

        for (const { label, data } of results) {
            const wrap = document.createElement("div");
            wrap.style.flex = "1 1 30%";
            wrap.style.minWidth = "300px";

            const title = document.createElement("div");
            title.textContent = label;
            title.style.fontWeight = "bold";
            title.style.textAlign = "center";
            title.style.marginBottom = "4px";

            // Plot the raw stability matrix client-side (no server-rendered image).
            const plotDiv = document.createElement("div");
            plotDiv.style.width = "100%";
            plotDiv.style.height = "300px";

            wrap.appendChild(title);
            wrap.appendChild(plotDiv);
            container.appendChild(wrap);

            Plotly.newPlot(plotDiv, [{
                z: data.matrix,
                x: data.x,
                y: data.y,
                type: "heatmap",
                colorscale: "RdBu",
                reversescale: true,           // low = blue, high = red (matches old coolwarm)
                zmin: data.vmin,
                zmax: data.vmax,
                colorbar: { title: "Stability", thickness: 12 },
                hovertemplate: `${data.x_label}: %{x}<br>${data.y_label}: %{y}<br>Stability: %{z}<extra></extra>`
            }], {
                margin: { l: 55, r: 10, t: 8, b: 45 },
                xaxis: { title: data.x_label },
                yaxis: { title: data.y_label },
                font: { size: 11 }
            }, { responsive: true, displaylogo: false });
        }
    } catch (error) {
        console.error("Error generating stability maps:", error);
        document.getElementById("stabilityMapPlot").innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
};

document.getElementById('boxPlotTab').onclick = async () => {
    if (!window.advancedSimPromise) {
        alert('Please run the diagram first (Play button).');
        return;
    }
    openPage('BoxPlot');
    showTabLoading('boxPlots', window.advancedSimStatus === 'running' ? 'Waiting for simulation...' : 'Fetching plots');
    await window.advancedSimPromise;
    if (window.advancedSimStatus === 'error') {
        document.getElementById('boxPlots').innerHTML = '<div class="error">Simulation failed. Please try again.</div>';
        clearTabLoading();
        return;
    }
    try {
        const response = await fetch(`${BACKEND_URL}/boxplots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ time_series_data: window.advancedTimeSeries }),
        });
        if (!response.ok) throw new Error('Failed to fetch boxplots');

        const { plots } = await response.json();
        const plotsContainer = document.getElementById('boxPlots');
        plotsContainer.innerHTML = '';
        plots.forEach((plot) => {
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${plot.plot}`;
            img.alt = `Boxplot for ${plot.variable}`;
            plotsContainer.appendChild(img);
        });
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('boxPlots').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
};

document.getElementById('violinPlotTab').onclick = async () => {
    if (!window.advancedSimPromise) {
        alert('Please run the diagram first (Play button).');
        return;
    }
    openPage('ViolinPlot');
    showTabLoading('violinPlots', window.advancedSimStatus === 'running' ? 'Waiting for simulation...' : 'Fetching plots');
    await window.advancedSimPromise;
    if (window.advancedSimStatus === 'error') {
        document.getElementById('violinPlots').innerHTML = '<div class="error">Simulation failed. Please try again.</div>';
        clearTabLoading();
        return;
    }
    try {
        const response = await fetch(`${BACKEND_URL}/violinplots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ time_series_data: window.advancedTimeSeries }),
        });
        if (!response.ok) throw new Error('Failed to fetch violin plots');

        const { plots } = await response.json();
        const plotsContainer = document.getElementById('violinPlots');
        plotsContainer.innerHTML = '';
        plots.forEach((plot) => {
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${plot.plot}`;
            img.alt = `Violin Plot for ${plot.variable}`;
            plotsContainer.appendChild(img);
        });
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('violinPlots').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
};



document.getElementById('randomSeedsTab').onclick = async () => {
    openPage('RandomSeeds');
    showTabLoading('randomSeedsPlots', 'Analyzing');
    await loadInitialData();

    try {
        const response = await fetch(`${BACKEND_URL}/random-seeds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edges: edgePairs, edge_polarities: edgePolarities })
        });

        if (!response.ok) throw new Error('Failed to fetch random seeds plots');

        const plotData = await response.json();
        const plotsContainer = document.getElementById('randomSeedsPlots');
        plotsContainer.innerHTML = '';

        plotData.forEach(plot => {
            const img = document.createElement('img');
            const binary = atob(plot.data);
            const array = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
            img.src = URL.createObjectURL(new Blob([array], { type: 'image/png' }));
            img.alt = plot.filename;
            plotsContainer.appendChild(img);
        });
    } catch (error) {
        console.error('Error:', error.message);
        document.getElementById('randomSeedsPlots').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        clearTabLoading();
    }
};



