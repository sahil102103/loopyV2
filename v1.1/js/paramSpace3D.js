const BEHAVIOR_COLORS = {
    'Optimal':       '#2ecc71',
    'Over-damped':   '#3498db',
    'Unconstrained': '#e74c3c',
    'Error':         '#95a5a6'
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('generate3DParamSpace')?.addEventListener('click', generate3DParamSpace);
    document.getElementById('export3DResults')?.addEventListener('click', export3DResults);
    document.getElementById('reset3DParams')?.addEventListener('click', reset3DParams);

    const statusDiv = document.getElementById('pythonStatus');
    if (statusDiv) statusDiv.innerHTML = '';
});

async function generate3DParamSpace() {
    const generateBtn = document.getElementById('generate3DParamSpace');
    const statusDiv   = document.getElementById('paramSpace3DStatus');
    const plotDiv     = document.getElementById('paramSpace3DPlot');
    const tableDiv    = document.getElementById('paramSpace3DTable');

    try {
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';
        plotDiv.innerHTML = '';
        tableDiv.innerHTML = '';

        if (!loopy.model.nodes.length || !loopy.model.edges.length) {
            throw new Error('Please create a graph with nodes and edges first.');
        }

        const graphData = convertToAdvancedFormat(loopy.model.nodes, loopy.model.edges);

        const retentionMin   = parseFloat(document.getElementById('retentionMin').value);
        const retentionMax   = parseFloat(document.getElementById('retentionMax').value);
        const retentionSteps = parseInt(document.getElementById('retentionSteps').value);
        const decayMin       = parseFloat(document.getElementById('decayMin3D').value);
        const decayMax       = parseFloat(document.getElementById('decayMax3D').value);
        const decaySteps     = parseInt(document.getElementById('decaySteps3D').value);
        const delayMin       = parseInt(document.getElementById('delayMin3D').value);
        const delayMax       = parseInt(document.getElementById('delayMax3D').value);
        const delaySteps     = parseInt(document.getElementById('delaySteps3D').value);
        const iterations     = parseInt(document.getElementById('iterations3D').value);

        const totalPoints = retentionSteps * decaySteps * delaySteps;
        statusDiv.innerHTML = `<div class="loading">Running ${totalPoints} simulations on the backend...</div>`;

        const response = await fetch(`${ADVANCED_API_URL}/param-space-3d`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...graphData,
                retention_range: [retentionMin, retentionMax, retentionSteps],
                decay_range:     [decayMin,     decayMax,     decaySteps],
                delay_range:     [delayMin,     delayMax,     delaySteps],
                iterations
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Backend error: ${response.status} — ${err}`);
        }

        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Unknown backend error');

        render3DPlot(result.points, plotDiv);
        renderSummaryTable(result.points, tableDiv);

        statusDiv.innerHTML = `<div class="success">Done — ${result.points.length} points computed.</div>`;

    } catch (error) {
        console.error('3D Parameter Space Error:', error);
        document.getElementById('paramSpace3DStatus').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate 3D Parameter Space';
    }
}

function render3DPlot(points, container) {
    // Group points by behavior class for separate colored traces
    const groups = {};
    points.forEach(p => {
        if (!groups[p.behavior]) groups[p.behavior] = { x: [], y: [], z: [], text: [] };
        groups[p.behavior].x.push(p.retention);
        groups[p.behavior].y.push(p.decay);
        groups[p.behavior].z.push(p.delay);
        groups[p.behavior].text.push(
            `Behavior: ${p.behavior}<br>Retention: ${p.retention}<br>Decay: ${p.decay}<br>Delay: ${p.delay}`
        );
    });

    const traces = Object.entries(groups).map(([behavior, data]) => ({
        type: 'scatter3d',
        mode: 'markers',
        name: behavior,
        x: data.x,
        y: data.y,
        z: data.z,
        text: data.text,
        hoverinfo: 'text',
        marker: {
            size: 6,
            color: BEHAVIOR_COLORS[behavior] || '#aaa',
            opacity: 0.85,
            line: { width: 0 }
        }
    }));

    const layout = {
        scene: {
            xaxis: { title: 'Retention' },
            yaxis: { title: 'Decay' },
            zaxis: { title: 'Delay' }
        },
        legend: { title: { text: 'Behavior' } },
        margin: { l: 0, r: 0, t: 40, b: 0 },
        title: 'Parameter Space: Retention × Decay × Delay',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor:  'rgba(0,0,0,0)',
        font: { color: '#ccc' }
    };

    Plotly.newPlot(container, traces, layout, { responsive: true });
}

function renderSummaryTable(points, container) {
    const counts = {};
    points.forEach(p => { counts[p.behavior] = (counts[p.behavior] || 0) + 1; });
    const total = points.length;

    const rows = Object.entries(counts)
        .map(([b, n]) => `<tr>
            <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${BEHAVIOR_COLORS[b] || '#aaa'};margin-right:6px"></span>${b}</td>
            <td>${n}</td>
            <td>${((n / total) * 100).toFixed(1)}%</td>
        </tr>`)
        .join('');

    container.innerHTML = `
        <table style="margin-top:16px;border-collapse:collapse;font-size:13px;">
            <thead><tr><th style="padding:6px 12px;text-align:left">Behavior</th><th style="padding:6px 12px">Points</th><th style="padding:6px 12px">Share</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function export3DResults() {
    Plotly.downloadImage(document.getElementById('paramSpace3DPlot'), {
        format: 'png',
        filename: 'param_space_3d',
        width: 1200,
        height: 800
    });
}

function reset3DParams() {
    document.getElementById('retentionMin').value   = '0.0';
    document.getElementById('retentionMax').value   = '1.0';
    document.getElementById('retentionSteps').value = '3';
    document.getElementById('decayMin3D').value     = '0.0';
    document.getElementById('decayMax3D').value     = '1.0';
    document.getElementById('decaySteps3D').value   = '5';
    document.getElementById('delayMin3D').value     = '0';
    document.getElementById('delayMax3D').value     = '10';
    document.getElementById('delaySteps3D').value   = '5';
    document.getElementById('iterations3D').value   = '100';
}
