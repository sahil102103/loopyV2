/**********************************

GRAPH STATE ADAPTER

Converts backend graph snapshots into temporary Model.restoreState payloads.
The Canvas model remains the only live graph state; this adapter only preserves
visual metadata while a deterministic replay frame is being shown.

**********************************/

(function (global) {
    "use strict";

    function copy(value) {
        if (Array.isArray(value)) return value.map(copy);
        if (value && typeof value === "object") {
            var result = {};
            Object.keys(value).forEach(function (key) { result[key] = copy(value[key]); });
            return result;
        }
        return value;
    }

    function capture(model) {
        return {
            nodes: model.nodes.map(function (node) {
                return {
                    id: node.id,
                    x: node.x,
                    y: node.y,
                    init: node.init,
                    value: node.value,
                    label: node.label,
                    hue: node.hue,
                    radius: node.radius,
                    retention: node.retention,
                    flow: node.flow,
                    pass: node.pass,
                    floor: node.floor,
                    ceiling: node.ceiling,
                    formula: node.formula,
                    sinkFormula: node.sinkFormula,
                    sourceFormula: node.sourceFormula,
                };
            }),
            edges: model.edges.map(function (edge) {
                return {
                    id: edge.id,
                    from: edge.from.id,
                    to: edge.to.id,
                    arc: edge.arc,
                    rotation: edge.rotation,
                    lag: edge.lag,
                    strength: edge.strength,
                    damper: edge.damper,
                    confidence: edge.confidence,
                    functionalForm: edge.functionalForm,
                    strengthMultiplier: edge.strengthMultiplier,
                    radius: edge.radius,
                };
            }),
            labels: model.labels.map(function (label) {
                return { id: label.id, text: label.text, x: label.x, y: label.y };
            }),
            nodeUID: Node._UID,
        };
    }

    function createContext(model) {
        var baseline = capture(model);
        var nodeById = {};
        var nodeVisuals = {};
        var edgeVisuals = {};
        var maxNodeId = 0;
        baseline.nodes.forEach(function (node) {
            nodeById[node.id] = node;
            nodeVisuals[String(node.label).trim()] = copy(node);
            if (typeof node.id === "number") maxNodeId = Math.max(maxNodeId, node.id);
        });
        baseline.edges.forEach(function (edge) {
            var from = nodeById[edge.from];
            var to = nodeById[edge.to];
            if (from && to) edgeVisuals[String(from.label).trim() + "\n" + String(to.label).trim()] = copy(edge);
        });
        return {
            baseline: baseline,
            nodeVisuals: nodeVisuals,
            edgeVisuals: edgeVisuals,
            nextNodeId: Math.max(maxNodeId, Number(baseline.nodeUID) || 0) + 1,
        };
    }

    function visualForNode(context, name, index) {
        if (!context.nodeVisuals[name]) {
            context.nodeVisuals[name] = {
                id: context.nextNodeId++,
                x: 130 + (index % 6) * 155,
                y: 130 + Math.floor(index / 6) * 135,
                hue: index % 20,
                radius: Node.DEFAULT_RADIUS,
                flow: Node.DEFAULT_FLOW,
                pass: Node.DEFAULT_PASSNODE,
            };
        }
        return context.nodeVisuals[name];
    }

    function stateFromGraph(graph, context) {
        if (typeof GraphModelGateway === "undefined") {
            throw new Error("The graph validation layer is unavailable");
        }
        var validation = GraphModelGateway.validateGraph(graph, { allowMissingSchema: true });
        if (!validation.ok || !validation.value) {
            throw new Error("Replay frame is invalid: " + GraphModelGateway.formatIssues(validation));
        }
        graph = validation.value;
        var ids = {};
        var maxId = 0;
        var nodes = graph.nodes.map(function (node, index) {
            var name = String(node.name || "").trim();
            if (!name) throw new Error("Replay frame contains an unnamed node");
            var visual = visualForNode(context, name, index);
            ids[name] = visual.id;
            if (typeof visual.id === "number") maxId = Math.max(maxId, visual.id);
            return {
                id: visual.id,
                x: visual.x,
                y: visual.y,
                init: Number(node.start_amount),
                value: Number(node.start_amount),
                label: name,
                hue: visual.hue,
                radius: visual.radius,
                retention: Number(node.retention),
                flow: visual.flow || 0,
                pass: !!visual.pass,
                floor: node.floor === undefined ? -Infinity : node.floor,
                ceiling: node.ceiling === undefined ? Infinity : node.ceiling,
                formula: node.formula || null,
                sinkFormula: node.sink_formula || null,
                sourceFormula: node.source_formula || null,
            };
        });
        var edges = graph.edges.map(function (edge) {
            var source = String(edge.source || "").trim();
            var target = String(edge.target || "").trim();
            if (ids[source] === undefined || ids[target] === undefined) {
                throw new Error("Replay edge references a missing node");
            }
            var visual = context.edgeVisuals[source + "\n" + target] || {};
            return {
                from: ids[source],
                to: ids[target],
                arc: visual.arc === undefined ? 100 : visual.arc,
                rotation: visual.rotation || 0,
                lag: Number(edge.delay || 0),
                strength: Number(edge.correlation),
                damper: Number(edge.decay || 0),
                confidence: edge.confidence === undefined ? 1 : Number(edge.confidence),
                functionalForm: edge.functional_form || "linear",
                strengthMultiplier: visual.strengthMultiplier === undefined ? 1 : visual.strengthMultiplier,
                radius: visual.radius === undefined ? Edge.radius : visual.radius,
            };
        });
        return {
            nodes: nodes,
            edges: edges,
            labels: copy(context.baseline.labels),
            nodeUID: Math.max(maxId, context.nextNodeId - 1),
        };
    }

    function applyFrame(model, frame, context) {
        var state = stateFromGraph(frame.graph, context);
        model.restoreState(copy(state));
        var classifications = frame.classifications || {};
        model.nodes.forEach(function (node) {
            node.classification = classifications[String(node.label).trim()] || null;
        });
        model.dirty();
    }

    function restoreBaseline(model, context) {
        model.restoreState(copy(context.baseline));
        model.dirty();
    }

    function commitFrame(model, frame) {
        var context = createContext(model);
        if (typeof model.saveState === "function") model.saveState();
        try {
            applyFrame(model, frame, context);
            if (typeof model.saveState === "function") model.saveState();
            return context;
        } catch (error) {
            restoreBaseline(model, context);
            throw error;
        }
    }

    global.GraphStateAdapter = {
        capture: capture,
        createContext: createContext,
        applyFrame: applyFrame,
        commitFrame: commitFrame,
        restoreBaseline: restoreBaseline,
    };
})(typeof window !== "undefined" ? window : this);
