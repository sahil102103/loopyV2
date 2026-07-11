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

function _backendBound(value, fallback) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    return isFinite(value) ? value : fallback;
}

function _escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function(character) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
}

function _showAnalysisError(containerId, error) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const message = document.createElement('div');
    message.className = 'error';
    message.textContent = 'Error: ' + (error && error.message ? error.message : 'Request failed');
    container.appendChild(message);
}

function triggerBackgroundAdvancedSim(iterations = 200) {
    if (!loopy.model.nodes.length || !loopy.model.edges.length) return;

    // Clear previous classifications immediately so stale rings don't persist
    _clearNodeClassifications();
    window.advancedSimStatus = 'running';
    _setSimBadge('running');

    let graphData;
    try {
        graphData = convertToAdvancedFormat(loopy.model.nodes, loopy.model.edges);
    } catch (error) {
        window.advancedSimStatus = 'error';
        _setSimBadge('error');
        if (typeof showToast === 'function') showToast(error.message, 'error', false);
        return;
    }

    window.advancedSimPromise = fetch(`${ADVANCED_API_URL}/simulation/two-phase`, {
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
    const labels = new Set();
    nodesToInclude.forEach(node => {
        const label = String(node.label ?? '').trim();
        if (!label) throw new Error('Every node needs a name before simulation can run.');
        if (labels.has(label)) throw new Error(`Node names must be unique before simulation: ${label}`);
        labels.add(label);
    });

    // Convert nodes
    const nodes = nodesToInclude.map(node => ({
        name: String(node.label).trim(),
        start_amount: node.init ?? 0.1,
        retention: node.retention ?? 1.0,  // matches notebook default (simulate_two_phase uses 1.0)
        floor: _backendBound(node.floor, '-Infinity'),
        ceiling: _backendBound(node.ceiling, 'Infinity'),
        ...(node.formula       && { formula:        node.formula }),
        ...(node.sinkFormula   && { sink_formula:   node.sinkFormula }),
        ...(node.sourceFormula && { source_formula: node.sourceFormula }),
        ...(node.pass && { pass: node.pass })
    }));

    const edges = edgesToInclude.map(edge => ({
        source: String(edge.from.label).trim(),
        target: String(edge.to.label).trim(),
        correlation: edge.strength,
        decay: edge.damper ?? 0,
        delay: edge.lag ?? 0,         // matches EDGE_DEFAULTS in notebook (no delay by default)
        confidence: edge.confidence ?? 0.8,
        functional_form: edge.functionalForm || 'linear'
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
        const response = await fetch(`${ADVANCED_API_URL}/simulation/two-phase`, {
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
        _showAnalysisError('advancedSimulationResults', error);
    } finally {
        clearTabLoading();
    }
}

// ── Interactive Chart.js helpers (raw series from backend → browser charts) ───

const TS_PALETTE = [
    '#4a7cff', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#3498db', '#e91e63', '#00bcd4',
    '#8bc34a', '#ff5722', '#607d8b', '#795548', '#673ab7',
    '#009688', '#cddc39', '#ff9800', '#3f51b5', '#f44336',
];

function _tsColor(i) {
    return TS_PALETTE[i % TS_PALETTE.length];
}

function _chartJsAvailable() {
    return typeof Chart !== 'undefined';
}

/** Rolling Z-score matching backend advanced_analysis.rolling_z (window min_periods=1). */
function _rollingZSeries(series, window) {
    window = window || 10;
    const out = [];
    for (let i = 0; i < series.length; i++) {
        const start = Math.max(0, i - window + 1);
        const slice = [];
        for (let j = start; j <= i; j++) {
            const v = series[j];
            if (v !== null && v !== undefined && isFinite(v)) slice.push(v);
        }
        if (!slice.length) { out.push(0); continue; }
        const mu = slice.reduce(function (a, b) { return a + b; }, 0) / slice.length;
        let varSum = 0;
        for (let k = 0; k < slice.length; k++) varSum += (slice[k] - mu) * (slice[k] - mu);
        const sd = Math.sqrt(varSum / slice.length) || 1e-12;
        const cur = series[i];
        out.push((cur === null || cur === undefined || !isFinite(cur)) ? 0 : (cur - mu) / sd);
    }
    return out;
}

function _hueByLabelMap() {
    const hueByLabel = {};
    if (window.loopy && loopy.model && loopy.model.nodes) {
        loopy.model.nodes.forEach(function (n) {
            if (n.label !== undefined) hueByLabel[String(n.label)] = n.hue;
        });
    }
    return hueByLabel;
}

function _colorForName(name, index, hueByLabel) {
    const hue = hueByLabel[name];
    if (typeof hue === 'number' && typeof convertNumToColor === 'function') {
        return convertNumToColor(hue)[1];
    }
    return _tsColor(index);
}

function _seriesToArrays(timeSeriesData, transform) {
    const names = Object.keys(timeSeriesData || {});
    let maxLen = 0;
    names.forEach(function (n) {
        const L = (timeSeriesData[n] || []).length;
        if (L > maxLen) maxLen = L;
    });
    const labels = [];
    for (let t = 0; t < maxLen; t++) labels.push(t);

    const hueByLabel = _hueByLabelMap();
    const full = {}; // name -> full y array
    names.forEach(function (name, i) {
        let y = (timeSeriesData[name] || []).map(function (v) {
            return (v === null || v === undefined) ? null : v;
        });
        // pad / trim to maxLen
        while (y.length < maxLen) y.push(null);
        if (y.length > maxLen) y = y.slice(0, maxLen);
        if (transform) y = transform(y, name);
        full[name] = y;
    });
    return { names: names, labels: labels, full: full, hueByLabel: hueByLabel, maxLen: maxLen };
}

function _destroyChart(chart) {
    if (chart && typeof chart.destroy === 'function') {
        try { chart.destroy(); } catch (e) { /* ignore */ }
    }
}

/**
 * Multi-series line chart from { nodeName: number[] }.
 * Uses Chart.js (same stack as Legacy Time Series). Range trim via sliders.
 */
function renderInteractiveTimeSeries(timeSeriesData, options) {
    options = options || {};
    const title = options.title || 'Time Series';
    const yTitle = options.yTitle || 'Node value';
    const transform = options.transform || null;
    const height = options.height || 420;

    const wrap = document.createElement('div');
    wrap.className = 'ts-interactive';

    const toolbar = document.createElement('div');
    toolbar.className = 'ts-toolbar';
    toolbar.innerHTML =
        '<span class="ts-hint">Hover for values · click legend to hide/show · trim range with sliders</span>' +
        '<div class="ts-toolbar-actions">' +
        '<button type="button" class="tv-text-btn ts-btn-all">Show all</button>' +
        '<button type="button" class="tv-text-btn ts-btn-none">Hide all</button>' +
        '<button type="button" class="tv-text-btn ts-btn-reset">Reset range</button>' +
        '</div>';
    wrap.appendChild(toolbar);

    if (title) {
        const h = document.createElement('div');
        h.className = 'ts-chart-title';
        h.textContent = title;
        wrap.appendChild(h);
    }

    if (!_chartJsAvailable()) {
        const err = document.createElement('p');
        err.className = 'ts-fallback';
        err.textContent = 'Chart.js not loaded — cannot render chart.';
        wrap.appendChild(err);
        return wrap;
    }

    const packed = _seriesToArrays(timeSeriesData, transform);
    if (!packed.names.length || packed.maxLen === 0) {
        const empty = document.createElement('p');
        empty.className = 'ts-fallback';
        empty.textContent = 'No time series data.';
        wrap.appendChild(empty);
        return wrap;
    }

    const chartWrap = document.createElement('div');
    chartWrap.className = 'ts-chart-wrap';
    chartWrap.style.height = height + 'px';
    const canvas = document.createElement('canvas');
    chartWrap.appendChild(canvas);
    wrap.appendChild(chartWrap);

    // Range trim sliders (same idea as Legacy Time Series)
    const rangeBar = document.createElement('div');
    rangeBar.className = 'ts-range-bar';
    rangeBar.innerHTML =
        '<label class="ts-range-label">Start <input type="range" class="ts-range-start" min="0" max="100" value="0"></label>' +
        '<label class="ts-range-label">End <input type="range" class="ts-range-end" min="0" max="100" value="100"></label>' +
        '<span class="ts-range-readout"></span>';
    wrap.appendChild(rangeBar);

    const startSlider = rangeBar.querySelector('.ts-range-start');
    const endSlider = rangeBar.querySelector('.ts-range-end');
    const readout = rangeBar.querySelector('.ts-range-readout');

    const datasets = packed.names.map(function (name, i) {
        const color = _colorForName(name, i, packed.hueByLabel);
        return {
            label: name,
            data: packed.full[name].slice(),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            fill: false,
            tension: 0.05,
            spanGaps: false,
        };
    });

    let chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: packed.labels.slice(),
            datasets: datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { display: false },
                legend: {
                    display: true,
                    position: 'top',
                    labels: { boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 11 } },
                },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            if (!items.length) return '';
                            return 't = ' + items[0].label;
                        },
                        label: function (ctx) {
                            const v = ctx.parsed.y;
                            const s = (v === null || v === undefined || !isFinite(v))
                                ? '—'
                                : (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.001)
                                    ? v.toExponential(3)
                                    : Number(v.toPrecision(6)).toString());
                            return ctx.dataset.label + ': ' + s;
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: 'Time step' },
                    ticks: { maxTicksLimit: 12, autoSkip: true },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                },
                y: {
                    title: { display: true, text: yTitle },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                },
            },
            animation: { duration: 0 },
        },
    });
    wrap._chart = chart;

    function applyRange() {
        let sPct = parseInt(startSlider.value, 10) || 0;
        let ePct = parseInt(endSlider.value, 10);
        if (!isFinite(ePct)) ePct = 100;
        if (sPct >= ePct) {
            if (startSlider === document.activeElement) {
                ePct = Math.min(100, sPct + 1);
                endSlider.value = String(ePct);
            } else {
                sPct = Math.max(0, ePct - 1);
                startSlider.value = String(sPct);
            }
        }
        const n = packed.maxLen;
        const startIndex = Math.min(n - 1, Math.floor(n * (sPct / 100)));
        const endIndex = Math.max(startIndex + 1, Math.ceil(n * (ePct / 100)));
        const sliceLabels = [];
        for (let t = startIndex; t < endIndex; t++) sliceLabels.push(t);
        chart.data.labels = sliceLabels;
        chart.data.datasets.forEach(function (ds, i) {
            const name = packed.names[i];
            ds.data = packed.full[name].slice(startIndex, endIndex);
        });
        readout.textContent = 't = ' + startIndex + ' … ' + (endIndex - 1) + '  (' + (endIndex - startIndex) + ' steps)';
        chart.update('none');
    }

    startSlider.addEventListener('input', applyRange);
    endSlider.addEventListener('input', applyRange);
    applyRange();

    toolbar.querySelector('.ts-btn-all').addEventListener('click', function () {
        chart.data.datasets.forEach(function (ds) { ds.hidden = false; });
        chart.update();
    });
    toolbar.querySelector('.ts-btn-none').addEventListener('click', function () {
        chart.data.datasets.forEach(function (ds) { ds.hidden = true; });
        chart.update();
    });
    toolbar.querySelector('.ts-btn-reset').addEventListener('click', function () {
        startSlider.value = '0';
        endSlider.value = '100';
        applyRange();
    });

    // Cleanup if the node is removed from DOM
    wrap._destroy = function () { _destroyChart(chart); wrap._chart = null; };

    return wrap;
}

/**
 * Fan chart from backend bands { node: { p5,p25,p50,p75,p95 } } via Chart.js.
 * Node picker + filled percentile bands.
 */
function renderInteractiveFanChart(bands, options) {
    options = options || {};
    const wrap = document.createElement('div');
    wrap.className = 'ts-interactive fan-interactive';

    if (!_chartJsAvailable()) {
        wrap.innerHTML = '<p class="ts-fallback">Chart.js not loaded.</p>';
        return wrap;
    }

    const nodes = Object.keys(bands || {});
    if (!nodes.length) {
        wrap.innerHTML = '<p class="ts-fallback">No fan-chart bands.</p>';
        return wrap;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'ts-toolbar';
    const left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const label = document.createElement('label');
    label.className = 'ts-hint';
    label.textContent = 'Node:';
    const select = document.createElement('select');
    select.className = 'tv-input tv-select';
    nodes.forEach(function (n, i) {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = n;
        if (i === 0) o.selected = true;
        select.appendChild(o);
    });
    left.appendChild(label);
    left.appendChild(select);
    const hint = document.createElement('span');
    hint.className = 'ts-hint';
    hint.textContent = 'Bands: 5–95% and 25–75% · line = median · hover for values';
    toolbar.appendChild(left);
    toolbar.appendChild(hint);
    wrap.appendChild(toolbar);

    const chartWrap = document.createElement('div');
    chartWrap.className = 'ts-chart-wrap';
    chartWrap.style.height = '440px';
    const canvas = document.createElement('canvas');
    chartWrap.appendChild(canvas);
    wrap.appendChild(chartWrap);

    let chart = null;

    function buildDatasets(node, idx) {
        const b = bands[node] || {};
        const p5 = b.p5 || [];
        const p25 = b.p25 || [];
        const p50 = b.p50 || [];
        const p75 = b.p75 || [];
        const p95 = b.p95 || [];
        const color = _tsColor(idx);
        // Chart.js fill: '-1' fills to previous dataset → outer then inner band
        return [
            {
                label: '_p5',
                data: p5,
                borderColor: 'transparent',
                backgroundColor: 'transparent',
                pointRadius: 0,
                fill: false,
                tension: 0,
            },
            {
                label: '5–95%',
                data: p95,
                borderColor: 'transparent',
                backgroundColor: 'rgba(74, 124, 255, 0.14)',
                pointRadius: 0,
                fill: '-1',
                tension: 0,
            },
            {
                label: '_p25',
                data: p25,
                borderColor: 'transparent',
                backgroundColor: 'transparent',
                pointRadius: 0,
                fill: false,
                tension: 0,
            },
            {
                label: '25–75%',
                data: p75,
                borderColor: 'transparent',
                backgroundColor: 'rgba(74, 124, 255, 0.30)',
                pointRadius: 0,
                fill: '-1',
                tension: 0,
            },
            {
                label: 'Median',
                data: p50,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 2.5,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: false,
                tension: 0.05,
            },
        ];
    }

    function draw(node) {
        const b = bands[node];
        if (!b || !b.p50) return;
        const labels = b.p50.map(function (_, t) { return t; });
        const idx = nodes.indexOf(node);
        const datasets = buildDatasets(node, idx < 0 ? 0 : idx);

        if (chart) {
            chart.data.labels = labels;
            chart.data.datasets = datasets;
            chart.options.plugins.title.text = node + ' — uncertainty bands';
            chart.update('none');
            return;
        }

        chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    title: {
                        display: true,
                        text: node + ' — uncertainty bands',
                        font: { size: 14 },
                    },
                    legend: {
                        display: true,
                        labels: {
                            filter: function (item) {
                                // hide internal helper series
                                return item.text && item.text.charAt(0) !== '_';
                            },
                            boxWidth: 12,
                            font: { size: 11 },
                        },
                    },
                    tooltip: {
                        filter: function (item) {
                            return item.dataset.label && item.dataset.label.charAt(0) !== '_';
                        },
                        callbacks: {
                            title: function (items) {
                                return items.length ? 't = ' + items[0].label : '';
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Time step' },
                        ticks: { maxTicksLimit: 12 },
                        grid: { color: 'rgba(0,0,0,0.06)' },
                    },
                    y: {
                        title: { display: true, text: 'Value' },
                        grid: { color: 'rgba(0,0,0,0.06)' },
                    },
                },
                animation: { duration: 0 },
            },
        });
        wrap._chart = chart;
    }

    draw(nodes[0]);
    select.addEventListener('change', function () { draw(select.value); });
    wrap._destroy = function () { _destroyChart(chart); wrap._chart = null; };
    return wrap;
}

/**
 * Display advanced simulation results
 */
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
    if (result.classifications) {
        const classSection = document.createElement('div');
        classSection.className = 'ts-classifications';
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

            const nodeName = document.createElement('strong');
            nodeName.textContent = node;
            item.appendChild(nodeName);
            item.appendChild(document.createTextNode(': ' + classification));
            classificationsList.appendChild(item);
        }
        classSection.appendChild(classificationsList);
        container.appendChild(classSection);
    }

    // Interactive time series (from numeric data — not the static PNG)
    if (result.time_series_data && Object.keys(result.time_series_data).length) {
        const plotSection = document.createElement('div');
        plotSection.style.marginBottom = '24px';

        const plotTitle = document.createElement('h4');
        plotTitle.textContent = 'Time Series (Two-Phase Dynamics)';
        plotSection.appendChild(plotTitle);

        plotSection.appendChild(renderInteractiveTimeSeries(result.time_series_data, {
            title: 'Node values over time',
            yTitle: 'Value',
            height: 480,
        }));
        container.appendChild(plotSection);

        // Rolling Z-scores from the same raw series (client-side)
        const zSection = document.createElement('div');
        zSection.style.marginBottom = '24px';
        const zTitle = document.createElement('h4');
        zTitle.textContent = 'Rolling Z-Scores (Stability)';
        zSection.appendChild(zTitle);

        zSection.appendChild(renderInteractiveTimeSeries(result.time_series_data, {
            title: 'Rolling Z-scores (window = 10)',
            yTitle: 'Z-score',
            height: 400,
            transform: function (series) { return _rollingZSeries(series, 10); },
        }));
        container.appendChild(zSection);
    } else {
        const miss = document.createElement('p');
        miss.className = 'ts-fallback';
        miss.textContent = 'No time_series_data in response — cannot build Chart.js view.';
        container.appendChild(miss);
    }

    // Download button
    if (result.time_series_data) {
        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = 'Download Time Series Data (CSV)';
        downloadBtn.className = 'button';
        downloadBtn.style.marginTop = '10px';
        downloadBtn.onclick = function () { downloadTimeSeriesCSV(result.time_series_data); };
        container.appendChild(downloadBtn);
    }
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
        const noiseFloor = parseFloat(document.getElementById('fanChartNoise')?.value) || 0;

        const response = await fetch(`${ADVANCED_API_URL}/simulation/monte-carlo-fan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...graphData, iterations, n_sims: nSims, sigma_base: 0.25, noise_floor: noiseFloor })
        });

        if (!response.ok) throw new Error(`Backend error: ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Fan chart failed');

        displayFanChartResults(result, 'fanChartResults');
    } catch (error) {
        console.error('Fan Chart Error:', error);
        _showAnalysisError('fanChartResults', error);
    } finally {
        clearTabLoading();
    }
}

function displayFanChartResults(result, containerId = 'fanChartResults') {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const info = document.createElement('p');
    info.className = 'ts-hint';
    info.style.margin = '8px 0 16px';
    info.textContent = (result.n_sims || '') + ' simulations — Chart.js bands from raw percentile data (5–95% / 25–75% / median)';
    container.appendChild(info);

    if (result.bands && Object.keys(result.bands).length) {
        container.appendChild(renderInteractiveFanChart(result.bands, {
            title: 'Fan Chart — ' + (result.n_sims || '') + ' Monte Carlo paths',
        }));
    } else {
        const miss = document.createElement('p');
        miss.className = 'ts-fallback';
        miss.textContent = 'No bands data in response — cannot build Chart.js fan chart.';
        container.appendChild(miss);
    }
}

/**
 * Run two-stage parameter optimization
 */
async function runParameterOptimization() {
    showTabLoading('optimizationResults', 'Running parameter search...');
    try {
        const graphData = convertToAdvancedFormat(loopy.model.nodes, loopy.model.edges);
        const iterations = parseInt(document.getElementById('simIterations')?.value) || 200;

        const response = await fetch(`${ADVANCED_API_URL}/optimization/parameter-search`, {
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
        _showAnalysisError('optimizationResults', error);
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
                return `<span style="background:${bg};color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;margin:2px;display:inline-block">${_escapeHtml(node)}: ${_escapeHtml(cls)}</span>`;
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
                    return `<span style="background:${bg};color:#fff;padding:2px 5px;border-radius:3px;font-size:10px;margin:1px;display:inline-block">${_escapeHtml(n)}: ${_escapeHtml(cls)}</span>`;
                }).join('');
            const nodeBg = BEHAVIOR_COLORS_OPT[info.behavior] || '#333';
            return `<tr style="border-bottom:1px solid #2a2a2a">
                <td style="padding:8px 10px;font-weight:600">${_escapeHtml(nodeName)}</td>
                <td style="padding:8px 10px"><span style="background:${nodeBg};color:#fff;padding:2px 8px;border-radius:3px;font-size:11px">${_escapeHtml(info.behavior)}</span></td>
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
