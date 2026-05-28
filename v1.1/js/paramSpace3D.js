// coolwarm_r palette — 11 bins, bin 0 = best (lowest combo) = warm red,
// bin 10 = worst (highest combo) = cool blue  (matches notebook)
const RANK_PALETTE = [
    '#b40426', '#c93c35', '#d95847', '#e8765a', '#f5a073',
    '#f7e4d8',
    '#c5d4e8', '#9ab7d4', '#6e9bbf', '#4480b0', '#3b4cc0'
];

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
        statusDiv.innerHTML = `<div class="loading">Running ${totalPoints} simulations on the backend…</div>`;

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
        generateBtn.textContent = 'Generate 3D Map';
    }
}

function render3DPlot(points, container) {
    const colors = points.map(p => RANK_PALETTE[Math.min(p.rank_bin ?? 5, 10)]);

    const allTrace = {
        type: 'scatter3d',
        mode: 'markers',
        name: 'All points',
        x: points.map(p => p.retention),
        y: points.map(p => p.decay),
        z: points.map(p => p.delay),
        text: points.map(p =>
            `Ret: ${p.retention}  Decay: ${p.decay}  Delay: ${p.delay}<br>` +
            `Score: ${p.combo}  (bin ${p.rank_bin}/10)<br>` +
            `Eigen dist: ${p.dist}  Max Z: ${p.z}  Shape: ${p.shape}`
        ),
        hoverinfo: 'text',
        marker: { size: 4, color: colors, opacity: 0.80, line: { width: 0 } }
    };

    // Top-25 best points (lowest rank_bin)
    const top25 = points.slice().sort((a, b) => (a.combo ?? 0) - (b.combo ?? 0)).slice(0, 25);
    const topTrace = {
        type: 'scatter3d',
        mode: 'markers+text',
        name: 'Top 25',
        x: top25.map(p => p.retention),
        y: top25.map(p => p.decay),
        z: top25.map(p => p.delay),
        text: top25.map((_, i) => `${i + 1}`),
        textposition: 'top center',
        hoverinfo: 'text',
        hovertext: top25.map(p =>
            `#${top25.indexOf(p)+1}  Ret:${p.retention} Dec:${p.decay} Dly:${p.delay}<br>Score:${p.combo}`
        ),
        marker: { size: 7, symbol: 'diamond', color: 'black', line: { color: 'white', width: 1 } }
    };

    const layout = {
        scene: {
            xaxis: { title: 'Retention' },
            yaxis: { title: 'Decay' },
            zaxis: { title: 'Delay' }
        },
        legend: { orientation: 'h', x: 0, y: 1.08 },
        margin: { l: 0, r: 0, t: 40, b: 0 },
        title: 'Parameter Space — Retention × Decay × Delay (color = score bin)',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor:  'rgba(0,0,0,0)',
        font: { color: '#ccc' }
    };

    Plotly.newPlot(container, [allTrace, topTrace], layout, { responsive: true });
}

function renderSummaryTable(points, container) {
    // Top-10 table
    const top10 = points.slice().sort((a, b) => (a.combo ?? 0) - (b.combo ?? 0)).slice(0, 10);

    const rows = top10.map((p, i) => {
        const swatch = `<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${RANK_PALETTE[Math.min(p.rank_bin ?? 5, 10)]};margin-right:6px;vertical-align:middle"></span>`;
        return `<tr>
            <td style="padding:4px 10px">${i + 1}</td>
            <td style="padding:4px 10px">${swatch}${p.rank_bin}/10</td>
            <td style="padding:4px 10px">${p.retention}</td>
            <td style="padding:4px 10px">${p.decay}</td>
            <td style="padding:4px 10px">${p.delay}</td>
            <td style="padding:4px 10px">${p.combo}</td>
            <td style="padding:4px 10px">${p.dist}</td>
            <td style="padding:4px 10px">${p.z}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <h4 style="margin-top:16px">Top 10 Configurations (lowest score = best)</h4>
        <table style="border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:1px solid #555">
                <th style="padding:4px 10px">#</th>
                <th style="padding:4px 10px">Bin</th>
                <th style="padding:4px 10px">Retention</th>
                <th style="padding:4px 10px">Decay</th>
                <th style="padding:4px 10px">Delay</th>
                <th style="padding:4px 10px">Score</th>
                <th style="padding:4px 10px">Eigen dist</th>
                <th style="padding:4px 10px">Max Z</th>
            </tr></thead>
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
