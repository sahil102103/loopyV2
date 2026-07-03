// coolwarm_r palette — 11 bins, bin 0 = best (lowest combo) = warm red,
// bin 10 = worst (highest combo) = cool blue  (matches notebook)
const RANK_PALETTE = [
    '#b40426', '#c93c35', '#d95847', '#e8765a', '#f5a073',
    '#f7e4d8',
    '#c5d4e8', '#9ab7d4', '#6e9bbf', '#4480b0', '#3b4cc0'
];

// The three swept parameters. Any can be assigned to X, Y, or Z.
const PARAMS = [
    { key: 'retention', label: 'Retention' },
    { key: 'decay',     label: 'Decay' },
    { key: 'delay',     label: 'Delay' }
];
const paramLabel = k => (PARAMS.find(p => p.key === k) || {}).label || k;

// Cached raw points from the last backend run (so axis re-assignment and
// slicing happen client-side with no re-computation).
let _paramPoints = null;
// Current axis assignment; Z is the hidden axis the slice slider moves through.
let _axes = { x: 'decay', y: 'delay', z: 'retention' };

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('generate3DParamSpace')?.addEventListener('click', generate3DParamSpace);
    document.getElementById('export3DResults')?.addEventListener('click', export3DResults);
    document.getElementById('reset3DParams')?.addEventListener('click', reset3DParams);
    initAxisSelects();

    const statusDiv = document.getElementById('pythonStatus');
    if (statusDiv) statusDiv.innerHTML = '';
});

// ── Axis assignment UI ────────────────────────────────────────────────
function initAxisSelects() {
    const selX = document.getElementById('axisX');
    const selY = document.getElementById('axisY');
    const selZ = document.getElementById('axisZ');
    if (!selX || !selY || !selZ) return;

    [selX, selY, selZ].forEach(sel => {
        sel.innerHTML = PARAMS.map(p => `<option value="${p.key}">${p.label}</option>`).join('');
    });
    selX.value = _axes.x;
    selY.value = _axes.y;
    selZ.value = _axes.z;

    [['axisX', selX], ['axisY', selY], ['axisZ', selZ]].forEach(([id, sel]) => {
        sel.addEventListener('change', () => {
            enforceDistinctAxes(sel);
            _axes = { x: selX.value, y: selY.value, z: selZ.value };
            if (_paramPoints) renderAll();
        });
    });
}

// Keep X/Y/Z a valid permutation: when a select collides with another,
// move the duplicate to whichever parameter is now unassigned.
function enforceDistinctAxes(changed) {
    const sels = [
        document.getElementById('axisX'),
        document.getElementById('axisY'),
        document.getElementById('axisZ')
    ];
    const values = sels.map(s => s.value);
    const missing = PARAMS.map(p => p.key).find(k => !values.includes(k));
    if (!missing) return;                       // already a valid permutation
    const dup = sels.find(s => s !== changed && s.value === changed.value);
    if (dup) dup.value = missing;
}

// ── Generate ──────────────────────────────────────────────────────────
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

        // Cache raw points — axis assignment + slicing are done client-side.
        _paramPoints = result.points;
        document.getElementById('sliceSection').style.display = 'block';
        renderAll();

        statusDiv.innerHTML = `<div class="success">Done — ${result.points.length} points computed.</div>`;

    } catch (error) {
        console.error('3D Parameter Space Error:', error);
        document.getElementById('paramSpace3DStatus').innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate 3D Map';
    }
}

// Re-render every view from the cached points + current axis assignment.
function renderAll() {
    if (!_paramPoints) return;
    render3DPlot(_paramPoints, document.getElementById('paramSpace3DPlot'), _axes);
    renderSliceView(_paramPoints, document.getElementById('paramSpace3DSlice'), _axes);
    renderSummaryTable(_paramPoints, document.getElementById('paramSpace3DTable'));
    var lbl = document.getElementById('sliceAxisLabel');
    if (lbl) lbl.textContent = paramLabel(_axes.z);
}

// ── 3D scatter (axes chosen by the user) ──────────────────────────────
function render3DPlot(points, container, axes) {
    const colors = points.map(p => RANK_PALETTE[Math.min(p.rank_bin ?? 5, 10)]);

    const allTrace = {
        type: 'scatter3d',
        mode: 'markers',
        name: 'All points',
        x: points.map(p => p[axes.x]),
        y: points.map(p => p[axes.y]),
        z: points.map(p => p[axes.z]),
        text: points.map(p =>
            `Ret: ${p.retention}  Decay: ${p.decay}  Delay: ${p.delay}<br>` +
            `Score: ${p.combo}  (bin ${p.rank_bin}/10)<br>` +
            `Eigen dist: ${p.dist}  Max Z: ${p.z}  Shape: ${p.shape}`
        ),
        hoverinfo: 'text',
        marker: { size: 4, color: colors, opacity: 0.80, line: { width: 0 } }
    };

    // Top-25 best points (lowest combo score)
    const top25 = points.slice().sort((a, b) => (a.combo ?? 0) - (b.combo ?? 0)).slice(0, 25);
    const topTrace = {
        type: 'scatter3d',
        mode: 'markers+text',
        name: 'Top 25',
        x: top25.map(p => p[axes.x]),
        y: top25.map(p => p[axes.y]),
        z: top25.map(p => p[axes.z]),
        text: top25.map((_, i) => `${i + 1}`),
        textposition: 'top center',
        hoverinfo: 'text',
        hovertext: top25.map((p, i) =>
            `#${i + 1}  Ret:${p.retention} Dec:${p.decay} Dly:${p.delay}<br>Score:${p.combo}`
        ),
        marker: { size: 7, symbol: 'diamond', color: 'black', line: { color: 'white', width: 1 } }
    };

    const layout = {
        scene: {
            xaxis: { title: paramLabel(axes.x) },
            yaxis: { title: paramLabel(axes.y) },
            zaxis: { title: paramLabel(axes.z) }
        },
        legend: { orientation: 'h', x: 0, y: 1.08 },
        margin: { l: 0, r: 0, t: 40, b: 0 },
        title: `Parameter Space — ${paramLabel(axes.x)} × ${paramLabel(axes.y)} × ${paramLabel(axes.z)} (color = score bin)`,
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor:  'rgba(0,0,0,0)',
        font: { color: '#ccc' }
    };

    Plotly.newPlot(container, [allTrace, topTrace], layout, { responsive: true });
}

// Discrete 11-bin colorscale (hard steps) matching RANK_PALETTE, for zmin=0,zmax=10.
function binColorscale() {
    const cs = [];
    for (let i = 0; i < 11; i++) {
        const lo = Math.max(0, (i - 0.5) / 10);
        const hi = Math.min(1, (i + 0.5) / 10);
        cs.push([lo, RANK_PALETTE[i]]);
        cs.push([hi, RANK_PALETTE[i]]);
    }
    return cs;
}

// ── 2D slice view: a dense heatmap per hidden-axis (Z) value + slider ──
function renderSliceView(points, container, axes) {
    const xKey = axes.x, yKey = axes.y, zKey = axes.z;
    const xVals = Array.from(new Set(points.map(p => p[xKey]))).sort((a, b) => a - b);
    const yVals = Array.from(new Set(points.map(p => p[yKey]))).sort((a, b) => a - b);
    const zVals = Array.from(new Set(points.map(p => p[zKey]))).sort((a, b) => a - b);
    const xIdx = new Map(xVals.map((v, i) => [v, i]));
    const yIdx = new Map(yVals.map((v, i) => [v, i]));
    const colorscale = binColorscale();
    // category labels → uniform, contiguous cells (no sparse gaps)
    const xCats = xVals.map(String), yCats = yVals.map(String);

    const heatmapTrace = zv => {
        const Z = yVals.map(() => xVals.map(() => null));
        const T = yVals.map(() => xVals.map(() => ''));
        for (const p of points) {
            if (p[zKey] !== zv) continue;
            const xi = xIdx.get(p[xKey]), yi = yIdx.get(p[yKey]);
            if (xi == null || yi == null) continue;
            Z[yi][xi] = p.rank_bin;
            T[yi][xi] = `${paramLabel(xKey)}: ${p[xKey]}<br>${paramLabel(yKey)}: ${p[yKey]}<br>` +
                        `Score: ${p.combo}  (bin ${p.rank_bin}/10)`;
        }
        return {
            type: 'heatmap',
            x: xCats, y: yCats, z: Z,
            zmin: 0, zmax: 10, colorscale, showscale: true,
            xgap: 1, ygap: 1,
            colorbar: { title: 'Score bin', thickness: 12, tickvals: [0, 2, 4, 6, 8, 10], len: 0.9 },
            text: T, hoverinfo: 'text', hovertemplate: '%{text}<extra></extra>'
        };
    };

    const frames = zVals.map(zv => ({ name: String(zv), data: [heatmapTrace(zv)] }));
    const steps = zVals.map(zv => ({
        label: String(zv),
        method: 'animate',
        args: [[String(zv)], { mode: 'immediate', frame: { duration: 0, redraw: true }, transition: { duration: 0 } }]
    }));

    const layout = {
        title: `${paramLabel(xKey)} × ${paramLabel(yKey)} slice  (color = score bin)`,
        xaxis: { title: paramLabel(xKey), type: 'category' },
        yaxis: { title: paramLabel(yKey), type: 'category' },
        margin: { l: 55, r: 10, t: 40, b: 80 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor:  'rgba(0,0,0,0)',
        font: { color: '#ccc' },
        sliders: [{
            active: 0,
            currentvalue: { prefix: `${paramLabel(zKey)} = `, font: { size: 13 } },
            pad: { t: 40 },
            steps
        }],
        updatemenus: [{
            type: 'buttons', showactive: false, direction: 'left',
            x: 0, y: -0.04, xanchor: 'left', yanchor: 'top', pad: { t: 0, r: 10 },
            buttons: [
                { label: '▶ Play', method: 'animate', args: [null, { mode: 'immediate', fromcurrent: true, frame: { duration: 600, redraw: true }, transition: { duration: 0 } }] },
                { label: '⏸ Pause', method: 'animate', args: [[null], { mode: 'immediate', frame: { duration: 0, redraw: false }, transition: { duration: 0 } }] }
            ]
        }]
    };

    Plotly.newPlot(container, frames.length ? frames[0].data : [heatmapTrace(zVals[0])], layout, { responsive: true })
        .then(() => { if (frames.length) Plotly.addFrames(container, frames); });
}

// ── Summary table (top-10 by score) ───────────────────────────────────
function renderSummaryTable(points, container) {
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
