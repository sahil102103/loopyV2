/**********************************

STAGE 3 CONTROLLED STRUCTURAL EDITOR

The queue contains only a proposed transaction. Graph state continues to live
in loopy.model. The backend evaluates the proposal on a private copy; this
module replays it into the live model only after an accepted preview and an
explicit Apply action.

**********************************/

(function (global) {
    "use strict";

    var pending = [];
    var requiredPaths = [];
    var preview = null;
    var previewFingerprint = null;
    var applying = false;
    var selectedKind = "add_node";

    function model() {
        return global.loopy && global.loopy.model;
    }

    function toast(message, type) {
        if (typeof global.showToast === "function") {
            global.showToast(message, type || "error", false);
        }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
        });
    }

    function currentGraphData() {
        var m = model();
        if (!m) throw new Error("The model is not ready");
        if (typeof convertToAdvancedFormat !== "function") {
            throw new Error("The graph converter is unavailable");
        }
        return convertToAdvancedFormat(m.nodes, m.edges);
    }

    function graphFingerprint(graphData) {
        return JSON.stringify(graphData);
    }

    function nodeLabels() {
        var m = model();
        return m ? m.nodes.map(function (node) { return String(node.label).trim(); }) : [];
    }

    function edgePairs() {
        var m = model();
        return m ? m.edges.map(function (edge) {
            return [String(edge.from.label).trim(), String(edge.to.label).trim()];
        }) : [];
    }

    function pairKey(pair) {
        return JSON.stringify(pair);
    }

    function projectedState() {
        var labels = nodeLabels();
        var edges = edgePairs();
        pending.forEach(function (edit) {
            if (edit.kind === "add_node") {
                labels.push(edit.name);
            } else if (edit.kind === "remove_node") {
                labels = labels.filter(function (label) { return label !== edit.name; });
                edges = edges.filter(function (edge) { return edge[0] !== edit.name && edge[1] !== edit.name; });
            } else if (edit.kind === "add_edge") {
                edges.push([edit.source, edit.target]);
            } else if (edit.kind === "remove_edge") {
                var removeKey = pairKey([edit.source, edit.target]);
                edges = edges.filter(function (edge) { return pairKey(edge) !== removeKey; });
            }
        });
        return { labels: labels, edges: edges };
    }

    function optionMarkup(values, placeholder) {
        var html = placeholder ? '<option value="">' + escapeHtml(placeholder) + "</option>" : "";
        values.forEach(function (value) {
            html += '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + "</option>";
        });
        return html;
    }

    function edgeOptionMarkup(edges, placeholder) {
        var html = placeholder ? '<option value="">' + escapeHtml(placeholder) + "</option>" : "";
        edges.forEach(function (edge) {
            html += '<option value="' + escapeHtml(pairKey(edge)) + '">' +
                escapeHtml(edge[0] + " -> " + edge[1]) + "</option>";
        });
        return html;
    }

    function renderActionFields() {
        var container = document.getElementById("seActionFields");
        if (!container) return;
        var kind = selectedKind;
        var projected = projectedState();

        if (kind === "add_node") {
            container.innerHTML =
                '<div class="se-field-grid">' +
                    '<label class="se-field"><span>Name</span><input id="seNodeName" type="text" maxlength="120"></label>' +
                    '<label class="se-field"><span>Start value</span><input id="seNodeStart" type="number" value="0.1" step="any"></label>' +
                    '<label class="se-field"><span>Retention</span><input id="seNodeRetention" type="number" value="0.7" min="0" max="1" step="any"></label>' +
                    '<label class="se-field"><span>Floor</span><input id="seNodeFloor" type="text" placeholder="-Infinity"></label>' +
                    '<label class="se-field"><span>Ceiling</span><input id="seNodeCeiling" type="text" placeholder="Infinity"></label>' +
                "</div>" +
                '<details class="se-formula-settings">' +
                    '<summary>Node formulas</summary>' +
                    formulaRow("Formula", "seFormulaEnabled", "seNodeFormula") +
                    formulaRow("Sink", "seSinkEnabled", "seNodeSink") +
                    formulaRow("Source", "seSourceEnabled", "seNodeSource") +
                "</details>";
            wireFormulaToggles();
            return;
        }

        if (kind === "remove_node") {
            container.innerHTML =
                '<div class="se-field-grid se-field-grid--two">' +
                    '<label class="se-field"><span>Node</span><select id="seRemoveNode">' +
                        optionMarkup(projected.labels, "Select node") +
                    "</select></label>" +
                "</div>";
            return;
        }

        if (kind === "add_edge") {
            container.innerHTML =
                '<div class="se-field-grid">' +
                    '<label class="se-field"><span>Source</span><select id="seEdgeSource">' + optionMarkup(projected.labels, "Select source") + "</select></label>" +
                    '<label class="se-field"><span>Target</span><select id="seEdgeTarget">' + optionMarkup(projected.labels, "Select target") + "</select></label>" +
                    '<label class="se-field"><span>Correlation</span><input id="seEdgeCorrelation" type="number" value="1" step="any"></label>' +
                    '<label class="se-field"><span>Decay</span><input id="seEdgeDecay" type="number" value="0" min="0" max="1" step="any"></label>' +
                    '<label class="se-field"><span>Confidence</span><input id="seEdgeConfidence" type="number" value="1" min="0" max="1" step="any"></label>' +
                    '<label class="se-field"><span>Delay</span><input id="seEdgeDelay" type="number" value="0" min="0" step="1"></label>' +
                    '<label class="se-field"><span>Functional form</span><select id="seEdgeForm">' +
                        '<option value="linear">Linear</option><option value="tanh">Tanh</option>' +
                        '<option value="quadratic">Quadratic</option><option value="cubic">Cubic</option>' +
                        '<option value="relu">ReLU</option><option value="step">Step</option>' +
                    "</select></label>" +
                "</div>";
            return;
        }

        container.innerHTML =
            '<div class="se-field-grid se-field-grid--two">' +
                '<label class="se-field"><span>Edge</span><select id="seRemoveEdge">' +
                    edgeOptionMarkup(projected.edges, "Select edge") +
                "</select></label>" +
            "</div>";
    }

    function formulaRow(label, checkboxId, inputId) {
        return '<div class="se-formula-row">' +
            '<label><input id="' + checkboxId + '" type="checkbox"> ' + escapeHtml(label) + "</label>" +
            '<input id="' + inputId + '" type="text" disabled autocomplete="off">' +
        "</div>";
    }

    function wireFormulaToggles() {
        [
            ["seFormulaEnabled", "seNodeFormula"],
            ["seSinkEnabled", "seNodeSink"],
            ["seSourceEnabled", "seNodeSource"],
        ].forEach(function (ids) {
            var toggle = document.getElementById(ids[0]);
            var input = document.getElementById(ids[1]);
            if (!toggle || !input) return;
            toggle.addEventListener("change", function () {
                input.disabled = !toggle.checked;
                if (toggle.checked) input.focus();
            });
        });
    }

    function inputValue(id) {
        var input = document.getElementById(id);
        return input ? input.value.trim() : "";
    }

    function numberValue(id, label, defaultValue) {
        var raw = inputValue(id);
        if (!raw && defaultValue !== undefined) return defaultValue;
        var value = Number(raw);
        if (!isFinite(value)) throw new Error(label + " must be numeric");
        return value;
    }

    function checkedFormula(toggleId, inputId) {
        var toggle = document.getElementById(toggleId);
        if (!toggle || !toggle.checked) return null;
        var value = inputValue(inputId);
        if (!value) throw new Error("Enabled formula fields cannot be empty");
        return value;
    }

    function actionFromForm() {
        var kind = selectedKind;
        var projected = projectedState();
        if (kind === "add_node") {
            var name = inputValue("seNodeName");
            if (!name) throw new Error("Node name is required");
            if (projected.labels.indexOf(name) !== -1) throw new Error("Node already exists: " + name);
            var retention = numberValue("seNodeRetention", "Retention", 0.7);
            var formula = checkedFormula("seFormulaEnabled", "seNodeFormula");
            if (retention < 0 || retention > 1) throw new Error("Retention must be between 0 and 1");
            if (formula && retention !== 0) throw new Error("Formula converter nodes must have retention 0");
            return {
                kind: kind,
                name: name,
                start_amount: numberValue("seNodeStart", "Start value", 0.1),
                retention: retention,
                floor: inputValue("seNodeFloor"),
                ceiling: inputValue("seNodeCeiling"),
                formula: formula,
                sink_formula: checkedFormula("seSinkEnabled", "seNodeSink"),
                source_formula: checkedFormula("seSourceEnabled", "seNodeSource"),
            };
        }
        if (kind === "remove_node") {
            var removeName = inputValue("seRemoveNode");
            if (!removeName) throw new Error("Select a node to remove");
            return { kind: kind, name: removeName };
        }
        if (kind === "add_edge") {
            var source = inputValue("seEdgeSource");
            var target = inputValue("seEdgeTarget");
            if (!source || !target) throw new Error("Select both edge endpoints");
            if (source === target) throw new Error("New self-loops are not allowed");
            if (projected.edges.some(function (edge) { return edge[0] === source && edge[1] === target; })) {
                throw new Error("Edge already exists: " + source + " -> " + target);
            }
            var decay = numberValue("seEdgeDecay", "Decay", 0);
            var confidence = numberValue("seEdgeConfidence", "Confidence", 1);
            var delay = numberValue("seEdgeDelay", "Delay", 0);
            if (decay < 0 || decay > 1) throw new Error("Decay must be between 0 and 1");
            if (confidence < 0 || confidence > 1) throw new Error("Confidence must be between 0 and 1");
            if (delay < 0 || Math.floor(delay) !== delay) throw new Error("Delay must be a non-negative integer");
            return {
                kind: kind,
                source: source,
                target: target,
                correlation: numberValue("seEdgeCorrelation", "Correlation", 1),
                decay: decay,
                confidence: confidence,
                delay: delay,
                functional_form: inputValue("seEdgeForm") || "linear",
            };
        }
        var pairRaw = inputValue("seRemoveEdge");
        if (!pairRaw) throw new Error("Select an edge to remove");
        var pair = JSON.parse(pairRaw);
        return { kind: kind, source: pair[0], target: pair[1] };
    }

    function kindLabel(kind) {
        return {
            add_node: "Add node",
            remove_node: "Remove node",
            add_edge: "Add edge",
            remove_edge: "Remove edge",
        }[kind] || kind;
    }

    function describeEdit(edit) {
        if (edit.kind === "add_node") return edit.name + " (start " + edit.start_amount + ", retention " + edit.retention + ")";
        if (edit.kind === "remove_node") return edit.name;
        if (edit.kind === "add_edge") return edit.source + " -> " + edit.target + " (corr " + edit.correlation + ")";
        return edit.source + " -> " + edit.target;
    }

    function renderQueue() {
        var container = document.getElementById("seQueue");
        var count = document.getElementById("seQueueCount");
        if (!container || !count) return;
        count.textContent = pending.length;
        container.innerHTML = "";
        if (!pending.length) {
            var empty = document.createElement("div");
            empty.className = "se-empty";
            empty.textContent = "No pending edits";
            container.appendChild(empty);
            return;
        }
        pending.forEach(function (edit, index) {
            var row = document.createElement("div");
            row.className = "se-queue-row";
            var kind = document.createElement("span");
            kind.className = "se-queue-kind";
            kind.textContent = kindLabel(edit.kind);
            var detail = document.createElement("span");
            detail.className = "se-queue-detail";
            detail.textContent = describeEdit(edit);
            var remove = document.createElement("button");
            remove.type = "button";
            remove.className = "se-remove-button";
            remove.title = "Remove pending edit";
            remove.setAttribute("aria-label", "Remove pending edit");
            remove.textContent = "x";
            remove.addEventListener("click", function () {
                pending.splice(index, 1);
                invalidatePreview();
                render();
            });
            row.appendChild(kind);
            row.appendChild(detail);
            row.appendChild(remove);
            container.appendChild(row);
        });
    }

    function selectedValues(select) {
        if (!select) return [];
        return Array.prototype.map.call(select.selectedOptions, function (option) { return option.value; });
    }

    function replaceOptions(select, values, edgeMode) {
        if (!select) return;
        var selected = selectedValues(select);
        select.innerHTML = edgeMode ? edgeOptionMarkup(values) : optionMarkup(values);
        Array.prototype.forEach.call(select.options, function (option) {
            option.selected = selected.indexOf(option.value) !== -1;
        });
    }

    function renderSafetyOptions() {
        var labels = nodeLabels();
        var edges = edgePairs();
        replaceOptions(document.getElementById("seProtectedNodes"), labels, false);
        replaceOptions(document.getElementById("seProtectedEdges"), edges, true);

        var source = document.getElementById("sePathSource");
        var target = document.getElementById("sePathTarget");
        var oldSource = source ? source.value : "";
        var oldTarget = target ? target.value : "";
        if (source) source.innerHTML = optionMarkup(labels, "Source");
        if (target) target.innerHTML = optionMarkup(labels, "Target");
        if (source && labels.indexOf(oldSource) !== -1) source.value = oldSource;
        if (target && labels.indexOf(oldTarget) !== -1) target.value = oldTarget;

        requiredPaths = requiredPaths.filter(function (path) {
            return labels.indexOf(path[0]) !== -1 && labels.indexOf(path[1]) !== -1;
        });
    }

    function renderPaths() {
        var container = document.getElementById("sePathList");
        if (!container) return;
        container.innerHTML = "";
        if (!requiredPaths.length) {
            var empty = document.createElement("div");
            empty.className = "se-empty";
            empty.textContent = "No required paths";
            container.appendChild(empty);
            return;
        }
        requiredPaths.forEach(function (path, index) {
            var row = document.createElement("div");
            row.className = "se-path-item";
            var label = document.createElement("span");
            label.textContent = path[0] + " -> " + path[1];
            var remove = document.createElement("button");
            remove.type = "button";
            remove.className = "se-remove-button";
            remove.title = "Remove required path";
            remove.setAttribute("aria-label", "Remove required path");
            remove.textContent = "x";
            remove.addEventListener("click", function () {
                requiredPaths.splice(index, 1);
                invalidatePreview();
                renderPaths();
            });
            row.appendChild(label);
            row.appendChild(remove);
            container.appendChild(row);
        });
    }

    function renderSummary() {
        var summary = document.getElementById("seGraphSummary");
        var m = model();
        if (summary && m) summary.textContent = m.nodes.length + " nodes / " + m.edges.length + " edges";
    }

    function invalidatePreview() {
        preview = null;
        previewFingerprint = null;
        var result = document.getElementById("seResult");
        if (result) {
            result.hidden = true;
            result.innerHTML = "";
        }
    }

    function render() {
        if (!model()) {
            var summary = document.getElementById("seGraphSummary");
            if (summary) summary.textContent = "Model unavailable";
            return;
        }
        renderSummary();
        renderActionFields();
        renderQueue();
        renderSafetyOptions();
        renderPaths();
    }

    function queueEdit() {
        try {
            pending.push(actionFromForm());
            invalidatePreview();
            render();
        } catch (error) {
            toast(error.message);
        }
    }

    function protectedEdges() {
        return selectedValues(document.getElementById("seProtectedEdges")).map(function (value) {
            return JSON.parse(value);
        });
    }

    async function checkTransaction() {
        if (!pending.length) {
            toast("Queue at least one edit before checking the transaction");
            return;
        }
        var button = document.getElementById("seCheckTransaction");
        var originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Checking...";
        try {
            var graphData = currentGraphData();
            var response = await fetch(CONFIG.API_URL + "/agent/structural-edits/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.assign({}, graphData, {
                    edits: pending,
                    protected_nodes: selectedValues(document.getElementById("seProtectedNodes")),
                    protected_edges: protectedEdges(),
                    required_paths: requiredPaths,
                    iterations: 50,
                    seed: 42,
                })),
            });
            var result = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(result.error || "Structural preview failed");
            preview = result;
            previewFingerprint = graphFingerprint(graphData);
            renderResult();
        } catch (error) {
            invalidatePreview();
            toast(error.message);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    function metric(label, value) {
        var item = document.createElement("span");
        item.textContent = label + ": " + value;
        return item;
    }

    function renderResult() {
        var container = document.getElementById("seResult");
        if (!container || !preview) return;
        container.hidden = false;
        container.innerHTML = "";

        var heading = document.createElement("div");
        heading.className = "se-result-heading";
        var title = document.createElement("h3");
        title.textContent = "Transaction check";
        var status = document.createElement("span");
        status.className = "se-result-status " + (preview.accepted ? "se-result-status--accepted" : "se-result-status--rejected");
        status.textContent = preview.accepted ? "Accepted" : "Rejected";
        heading.appendChild(title);
        heading.appendChild(status);
        container.appendChild(heading);

        if (preview.reason) {
            var reason = document.createElement("p");
            reason.className = "se-result-reason";
            reason.textContent = preview.reason;
            container.appendChild(reason);
        }

        var metrics = document.createElement("div");
        metrics.className = "se-result-metrics";
        metrics.appendChild(metric("Reward", Number(preview.reward || 0).toFixed(3)));
        if (preview.summary) {
            metrics.appendChild(metric("Nodes", preview.summary.nodes_before + " -> " + preview.summary.nodes_after));
            metrics.appendChild(metric("Edges", preview.summary.edges_before + " -> " + preview.summary.edges_after));
        }
        var preservation = preview.reward_components && preview.reward_components.structural_preservation;
        if (preservation !== undefined) metrics.appendChild(metric("Preservation", Number(preservation).toFixed(3)));
        container.appendChild(metrics);

        if (preview.accepted) {
            var actions = document.createElement("div");
            actions.className = "se-apply-row";
            var apply = document.createElement("button");
            apply.type = "button";
            apply.className = "button";
            apply.textContent = "Apply to Canvas";
            apply.addEventListener("click", applyPreview);
            actions.appendChild(apply);
            container.appendChild(actions);
        }
    }

    function findNode(label) {
        var m = model();
        for (var i = 0; i < m.nodes.length; i++) {
            if (String(m.nodes[i].label).trim() === label) return m.nodes[i];
        }
        return null;
    }

    function findEdge(source, target) {
        var m = model();
        for (var i = 0; i < m.edges.length; i++) {
            if (String(m.edges[i].from.label).trim() === source && String(m.edges[i].to.label).trim() === target) {
                return m.edges[i];
            }
        }
        return null;
    }

    function validateReplay(edits) {
        var labels = new Set(nodeLabels());
        var edges = new Set(edgePairs().map(pairKey));
        edits.forEach(function (edit) {
            if (edit.kind === "add_node") {
                if (labels.has(edit.name)) throw new Error("Node already exists: " + edit.name);
                labels.add(edit.name);
                return;
            }
            if (edit.kind === "remove_node") {
                if (!labels.has(edit.name)) throw new Error("Node no longer exists: " + edit.name);
                labels.delete(edit.name);
                Array.from(edges).forEach(function (key) {
                    var pair = JSON.parse(key);
                    if (pair[0] === edit.name || pair[1] === edit.name) edges.delete(key);
                });
                return;
            }
            var key = pairKey([edit.source, edit.target]);
            if (edit.kind === "add_edge") {
                if (!labels.has(edit.source) || !labels.has(edit.target)) throw new Error("Edge endpoint no longer exists");
                if (edges.has(key)) throw new Error("Edge already exists: " + edit.source + " -> " + edit.target);
                edges.add(key);
            } else {
                if (!edges.has(key)) throw new Error("Edge no longer exists: " + edit.source + " -> " + edit.target);
                edges.delete(key);
            }
        });
    }

    function parseBound(value, fallback) {
        if (value === "Infinity") return Infinity;
        if (value === "-Infinity") return -Infinity;
        if (value === null || value === undefined || value === "") return fallback;
        return Number(value);
    }

    function captureState(m) {
        return {
            nodes: m.nodes.map(function (node) {
                return {
                    id: node.id, x: node.x, y: node.y, init: node.init, value: node.value,
                    label: node.label, hue: node.hue, radius: node.radius, retention: node.retention,
                    flow: node.flow, pass: node.pass, floor: node.floor, ceiling: node.ceiling,
                    formula: node.formula, sinkFormula: node.sinkFormula, sourceFormula: node.sourceFormula,
                };
            }),
            edges: m.edges.map(function (edge) {
                return {
                    id: edge.id, from: edge.from.id, to: edge.to.id, arc: edge.arc,
                    rotation: edge.rotation, lag: edge.lag, strength: edge.strength,
                    damper: edge.damper, confidence: edge.confidence,
                    functionalForm: edge.functionalForm, strengthMultiplier: edge.strengthMultiplier,
                    radius: edge.radius,
                };
            }),
            labels: m.labels.map(function (label) { return { id: label.id, text: label.text, x: label.x, y: label.y }; }),
            nodeUID: Node._UID,
        };
    }

    function replayEdit(edit) {
        var m = model();
        if (edit.kind === "add_node") {
            var index = m.nodes.length;
            m.addNode({
                x: 120 + (index % 6) * 150,
                y: 120 + Math.floor(index / 6) * 130,
                label: edit.name,
                init: edit.start_amount,
                retention: edit.retention,
                floor: parseBound(edit.floor, -Infinity),
                ceiling: parseBound(edit.ceiling, Infinity),
                formula: edit.formula,
                sinkFormula: edit.sink_formula,
                sourceFormula: edit.source_formula,
            });
            return;
        }
        if (edit.kind === "remove_node") {
            var node = findNode(edit.name);
            var associatedEdgeIds = m.edges.filter(function (candidate) {
                return candidate.from === node || candidate.to === node;
            }).map(function (candidate) { return candidate.id; });
            node.kill();
            associatedEdgeIds.forEach(function (id) { delete m.edgeByID[id]; });
            return;
        }
        if (edit.kind === "add_edge") {
            var source = findNode(edit.source);
            var target = findNode(edit.target);
            m.addEdge({
                from: source.id,
                to: target.id,
                strength: edit.correlation,
                damper: edit.decay,
                confidence: edit.confidence,
                lag: edit.delay,
                functionalForm: edit.functional_form,
            });
            return;
        }
        var edge = findEdge(edit.source, edit.target);
        var edgeId = edge.id;
        edge.kill();
        delete m.edgeByID[edgeId];
    }

    function applyPreview() {
        try {
            if (!preview || !preview.accepted) throw new Error("Check the transaction before applying it");
            var currentFingerprint = graphFingerprint(currentGraphData());
            if (currentFingerprint !== previewFingerprint) {
                invalidatePreview();
                throw new Error("The model changed after this check. Check the transaction again.");
            }
            var edits = preview.transaction.edits;
            validateReplay(edits);
            var m = model();
            var rollback = captureState(m);
            var wasRestoring = m.restoringState;
            applying = true;
            m.restoringState = true;
            try {
                edits.forEach(replayEdit);
            } catch (error) {
                m.restoreState(rollback);
                throw error;
            } finally {
                m.restoringState = wasRestoring;
            }
            m.update();
            m.dirty();
            if (!wasRestoring && typeof m.saveState === "function") m.saveState();
            if (typeof publish === "function") publish("model/changed");
            applying = false;

            pending = [];
            requiredPaths = requiredPaths.filter(function (path) {
                return findNode(path[0]) && findNode(path[1]);
            });
            invalidatePreview();
            render();
            toast("Controlled edits applied to the Canvas", "success");
            if (typeof openPage === "function") openPage("Canvas");
        } catch (error) {
            applying = false;
            toast(error.message);
        }
    }

    function addRequiredPath() {
        var source = inputValue("sePathSource");
        var target = inputValue("sePathTarget");
        if (!source || !target) {
            toast("Select both required-path endpoints");
            return;
        }
        if (source === target) {
            toast("A required path needs two different nodes");
            return;
        }
        var key = pairKey([source, target]);
        if (requiredPaths.some(function (path) { return pairKey(path) === key; })) {
            toast("That required path is already listed");
            return;
        }
        requiredPaths.push([source, target]);
        invalidatePreview();
        renderPaths();
    }

    function bind() {
        var helpToggle = document.getElementById("seHelpToggle");
        var helpClose = document.getElementById("seHelpClose");
        var helpPanel = document.getElementById("seHelpPanel");
        function setHelpOpen(open) {
            helpPanel.hidden = !open;
            helpToggle.setAttribute("aria-expanded", open ? "true" : "false");
            helpToggle.classList.toggle("is-active", open);
        }
        helpToggle.addEventListener("click", function () { setHelpOpen(helpPanel.hidden); });
        helpClose.addEventListener("click", function () {
            setHelpOpen(false);
            helpToggle.focus();
        });
        var queue = document.getElementById("seQueueEdit");
        var clear = document.getElementById("seClearQueue");
        var check = document.getElementById("seCheckTransaction");
        var addPath = document.getElementById("seAddPath");
        var protectedNodes = document.getElementById("seProtectedNodes");
        var protectedEdgesControl = document.getElementById("seProtectedEdges");
        var kindButtons = document.querySelectorAll("#seActionKind [data-kind]");
        Array.prototype.forEach.call(kindButtons, function (button) {
            button.addEventListener("click", function () {
                selectedKind = button.getAttribute("data-kind");
                Array.prototype.forEach.call(kindButtons, function (candidate) {
                    candidate.classList.toggle("active", candidate === button);
                });
                renderActionFields();
            });
        });
        if (queue) queue.addEventListener("click", queueEdit);
        if (clear) clear.addEventListener("click", function () { pending = []; invalidatePreview(); render(); });
        if (check) check.addEventListener("click", checkTransaction);
        if (addPath) addPath.addEventListener("click", addRequiredPath);
        if (protectedNodes) protectedNodes.addEventListener("change", invalidatePreview);
        if (protectedEdgesControl) protectedEdgesControl.addEventListener("change", invalidatePreview);
    }

    if (typeof subscribe === "function") {
        subscribe("model/changed", function () {
            if (applying) return;
            invalidatePreview();
            var page = document.getElementById("StructuralEdits");
            if (page && page.style.display === "block") render();
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        bind();
    });

    global.structuralEditor = {
        render: render,
        pendingEdits: function () { return pending.slice(); },
        safetyConfig: function () {
            return {
                protected_nodes: selectedValues(document.getElementById("seProtectedNodes")),
                protected_edges: protectedEdges(),
                required_paths: requiredPaths.map(function (path) { return path.slice(); }),
            };
        },
    };
})(typeof window !== "undefined" ? window : this);
