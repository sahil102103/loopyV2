"use strict";
/**
 * Typed boundary around the live Canvas model.
 *
 * The Canvas Model remains the sole mutable state owner. This facade creates
 * canonical `flowcld.model.v1` snapshots, validates external graph data, and
 * validates candidate edits before applying them to live Node/Edge objects.
 */
var GraphModelGateway;
(function (GraphModelGateway) {
    GraphModelGateway.SCHEMA_VERSION = "flowcld.model.v1";
    GraphModelGateway.EDGE_FORMS = [
        "linear",
        "tanh",
        "quadratic",
        "cubic",
        "relu",
        "step",
    ];
    const EDGE_FORM_SET = new Set(GraphModelGateway.EDGE_FORMS);
    function isRecord(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }
    function addIssue(issues, path, code, message) {
        issues.push({ path, code, message });
    }
    function finiteNumber(value, path, issues) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            addIssue(issues, path, "finite_number", "Must be a finite number");
            return 0;
        }
        return value;
    }
    function requiredText(value, path, issues) {
        if (typeof value !== "string" || value.trim() === "") {
            addIssue(issues, path, "required_text", "Must be a non-empty string");
            return "";
        }
        return value.trim();
    }
    function optionalFormula(value, path, issues) {
        if (value === undefined || value === null || value === "")
            return undefined;
        if (typeof value !== "string") {
            addIssue(issues, path, "formula_text", "Formula must be plain text or null");
            return undefined;
        }
        return value;
    }
    function canonicalBound(value, fallback, path, issues) {
        if (value === undefined || value === null || value === "")
            return fallback;
        if (typeof value === "number") {
            if (Number.isFinite(value))
                return value;
            if (value === Infinity)
                return "Infinity";
            if (value === -Infinity)
                return "-Infinity";
            addIssue(issues, path, "bound", "Bound cannot be NaN");
            return fallback;
        }
        if (typeof value === "string" && value.trim() !== "")
            return value.trim();
        addIssue(issues, path, "bound", "Bound must be a number or expression string");
        return fallback;
    }
    function staticBoundValue(value) {
        if (typeof value === "number")
            return value;
        const normalized = value.trim().toLowerCase();
        if (["infinity", "+infinity", "inf", "+inf"].includes(normalized))
            return Infinity;
        if (["-infinity", "-inf"].includes(normalized))
            return -Infinity;
        if (normalized !== "") {
            const parsed = Number(normalized);
            if (Number.isFinite(parsed))
                return parsed;
        }
        return null;
    }
    function normalizeNode(value, index, issues) {
        const path = `nodes[${index}]`;
        if (!isRecord(value)) {
            addIssue(issues, path, "node_object", "Node must be an object");
            return {
                name: "",
                start_amount: 0,
                retention: 0,
                floor: "-Infinity",
                ceiling: "Infinity",
            };
        }
        const floor = canonicalBound(value.floor, "-Infinity", `${path}.floor`, issues);
        const ceiling = canonicalBound(value.ceiling, "Infinity", `${path}.ceiling`, issues);
        const floorValue = staticBoundValue(floor);
        const ceilingValue = staticBoundValue(ceiling);
        if (floorValue !== null && ceilingValue !== null && floorValue > ceilingValue) {
            addIssue(issues, path, "bound_order", "Floor cannot be greater than ceiling");
        }
        const node = {
            name: requiredText(value.name, `${path}.name`, issues),
            start_amount: finiteNumber(value.start_amount, `${path}.start_amount`, issues),
            retention: finiteNumber(value.retention, `${path}.retention`, issues),
            floor,
            ceiling,
        };
        if (node.retention < 0) {
            addIssue(issues, `${path}.retention`, "retention_range", "Retention cannot be negative");
        }
        const formula = optionalFormula(value.formula, `${path}.formula`, issues);
        const sinkFormula = optionalFormula(value.sink_formula, `${path}.sink_formula`, issues);
        const sourceFormula = optionalFormula(value.source_formula, `${path}.source_formula`, issues);
        if (formula !== undefined)
            node.formula = formula;
        if (sinkFormula !== undefined)
            node.sink_formula = sinkFormula;
        if (sourceFormula !== undefined)
            node.source_formula = sourceFormula;
        if (value.pass !== undefined) {
            if (typeof value.pass !== "boolean") {
                addIssue(issues, `${path}.pass`, "boolean", "Pass must be true or false");
            }
            else {
                node.pass = value.pass;
            }
        }
        return node;
    }
    function normalizeEdge(value, index, nodeNames, issues) {
        const path = `edges[${index}]`;
        if (!isRecord(value)) {
            addIssue(issues, path, "edge_object", "Edge must be an object");
            return {
                source: "",
                target: "",
                correlation: 0,
                decay: 0,
                confidence: 0,
                delay: 0,
                functional_form: "linear",
            };
        }
        const source = requiredText(value.source, `${path}.source`, issues);
        const target = requiredText(value.target, `${path}.target`, issues);
        if (source && !nodeNames.has(source)) {
            addIssue(issues, `${path}.source`, "missing_node", `Unknown source node: ${source}`);
        }
        if (target && !nodeNames.has(target)) {
            addIssue(issues, `${path}.target`, "missing_node", `Unknown target node: ${target}`);
        }
        const decay = finiteNumber(value.decay, `${path}.decay`, issues);
        if (decay < 0 || decay > 1) {
            addIssue(issues, `${path}.decay`, "decay_range", "Decay must be between 0 and 1");
        }
        const confidence = finiteNumber(value.confidence, `${path}.confidence`, issues);
        if (confidence < 0 || confidence > 1) {
            addIssue(issues, `${path}.confidence`, "confidence_range", "Confidence must be between 0 and 1");
        }
        const delay = finiteNumber(value.delay, `${path}.delay`, issues);
        if (!Number.isInteger(delay) || delay < 0) {
            addIssue(issues, `${path}.delay`, "delay_range", "Delay must be a non-negative integer");
        }
        const rawForm = value.functional_form === undefined ? "linear" : value.functional_form;
        const form = typeof rawForm === "string" ? rawForm.trim().toLowerCase() : "";
        if (!EDGE_FORM_SET.has(form)) {
            addIssue(issues, `${path}.functional_form`, "functional_form", `Functional form must be one of: ${GraphModelGateway.EDGE_FORMS.join(", ")}`);
        }
        return {
            source,
            target,
            correlation: finiteNumber(value.correlation, `${path}.correlation`, issues),
            decay,
            confidence,
            delay,
            functional_form: EDGE_FORM_SET.has(form) ? form : "linear",
        };
    }
    function validateGraph(input, options = {}) {
        const issues = [];
        if (!isRecord(input)) {
            addIssue(issues, "$", "graph_object", "Graph must be an object");
            return { ok: false, value: null, issues };
        }
        const schema = input.schema_version;
        if (schema === undefined && !options.allowMissingSchema) {
            addIssue(issues, "schema_version", "schema_required", `Expected ${GraphModelGateway.SCHEMA_VERSION}`);
        }
        else if (schema !== undefined && schema !== GraphModelGateway.SCHEMA_VERSION) {
            addIssue(issues, "schema_version", "schema_version", `Unsupported schema: ${String(schema)}`);
        }
        if (!Array.isArray(input.nodes)) {
            addIssue(issues, "nodes", "node_array", "Nodes must be an array");
        }
        if (!Array.isArray(input.edges)) {
            addIssue(issues, "edges", "edge_array", "Edges must be an array");
        }
        const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
        const nodes = rawNodes.map((node, index) => normalizeNode(node, index, issues));
        const nodeNames = new Set();
        nodes.forEach((node, index) => {
            if (node.name && nodeNames.has(node.name)) {
                addIssue(issues, `nodes[${index}].name`, "duplicate_node", `Duplicate node name: ${node.name}`);
            }
            if (node.name)
                nodeNames.add(node.name);
        });
        const rawEdges = Array.isArray(input.edges) ? input.edges : [];
        const edges = rawEdges.map((edge, index) => normalizeEdge(edge, index, nodeNames, issues));
        const graph = { schema_version: GraphModelGateway.SCHEMA_VERSION, nodes, edges };
        return { ok: issues.length === 0, value: issues.length === 0 ? graph : null, issues };
    }
    GraphModelGateway.validateGraph = validateGraph;
    function liveBound(value, fallback) {
        if (value === Infinity)
            return "Infinity";
        if (value === -Infinity)
            return "-Infinity";
        return value === undefined || value === null || value === "" ? fallback : value;
    }
    function liveFormula(value) {
        return value === undefined || value === null || value === "" ? undefined : value;
    }
    function fromLiveSelection(nodes, edges) {
        const graph = {
            schema_version: GraphModelGateway.SCHEMA_VERSION,
            nodes: nodes.map((node) => ({
                name: node.label,
                start_amount: node.init,
                retention: node.retention,
                floor: liveBound(node.floor, "-Infinity"),
                ceiling: liveBound(node.ceiling, "Infinity"),
                formula: liveFormula(node.formula),
                sink_formula: liveFormula(node.sinkFormula),
                source_formula: liveFormula(node.sourceFormula),
                pass: node.pass === undefined ? undefined : Boolean(node.pass),
            })),
            edges: edges.map((edge) => {
                var _a, _b;
                return ({
                    source: (_a = edge.from) === null || _a === void 0 ? void 0 : _a.label,
                    target: (_b = edge.to) === null || _b === void 0 ? void 0 : _b.label,
                    correlation: edge.strength,
                    decay: edge.damper,
                    confidence: edge.confidence,
                    delay: edge.lag,
                    functional_form: edge.functionalForm === undefined ? "linear" : edge.functionalForm,
                });
            }),
        };
        return validateGraph(graph);
    }
    GraphModelGateway.fromLiveSelection = fromLiveSelection;
    function validateLiveModel(model) {
        return fromLiveSelection(model.nodes, model.edges);
    }
    GraphModelGateway.validateLiveModel = validateLiveModel;
    function boundForLiveModel(value) {
        if (typeof value !== "string")
            return value;
        const normalized = value.trim().toLowerCase();
        if (["infinity", "+infinity", "inf", "+inf"].includes(normalized))
            return Infinity;
        if (["-infinity", "-inf"].includes(normalized))
            return -Infinity;
        return value;
    }
    function updateLiveNode(model, liveNode, patch) {
        var _a, _b, _c;
        const snapshot = validateLiveModel(model);
        if (!snapshot.ok || !snapshot.value)
            return snapshot;
        const index = model.nodes.indexOf(liveNode);
        if (index < 0) {
            return {
                ok: false,
                value: null,
                issues: [{ path: "node", code: "missing_live_node", message: "Node is not part of the live model" }],
            };
        }
        const candidate = {
            schema_version: GraphModelGateway.SCHEMA_VERSION,
            nodes: snapshot.value.nodes.map((node) => ({ ...node })),
            edges: snapshot.value.edges.map((edge) => ({ ...edge })),
        };
        const previousName = candidate.nodes[index].name;
        candidate.nodes[index] = { ...candidate.nodes[index], ...patch };
        if (patch.name !== undefined && patch.name !== previousName) {
            candidate.edges.forEach((edge) => {
                if (edge.source === previousName)
                    edge.source = patch.name;
                if (edge.target === previousName)
                    edge.target = patch.name;
            });
        }
        const validation = validateGraph(candidate);
        if (!validation.ok || !validation.value)
            return validation;
        const node = validation.value.nodes[index];
        if (patch.name !== undefined)
            liveNode.label = node.name;
        if (patch.start_amount !== undefined) {
            liveNode.init = node.start_amount;
            if (liveNode.value === undefined)
                liveNode.value = node.start_amount;
        }
        if (patch.retention !== undefined)
            liveNode.retention = node.retention;
        if (patch.floor !== undefined)
            liveNode.floor = boundForLiveModel(node.floor);
        if (patch.ceiling !== undefined)
            liveNode.ceiling = boundForLiveModel(node.ceiling);
        if (Object.prototype.hasOwnProperty.call(patch, "formula"))
            liveNode.formula = (_a = node.formula) !== null && _a !== void 0 ? _a : null;
        if (Object.prototype.hasOwnProperty.call(patch, "sink_formula"))
            liveNode.sinkFormula = (_b = node.sink_formula) !== null && _b !== void 0 ? _b : null;
        if (Object.prototype.hasOwnProperty.call(patch, "source_formula"))
            liveNode.sourceFormula = (_c = node.source_formula) !== null && _c !== void 0 ? _c : null;
        if (patch.pass !== undefined)
            liveNode.pass = Boolean(node.pass);
        return validation;
    }
    GraphModelGateway.updateLiveNode = updateLiveNode;
    function updateLiveEdge(model, liveEdge, patch) {
        const snapshot = validateLiveModel(model);
        if (!snapshot.ok || !snapshot.value)
            return snapshot;
        const index = model.edges.indexOf(liveEdge);
        if (index < 0) {
            return {
                ok: false,
                value: null,
                issues: [{ path: "edge", code: "missing_live_edge", message: "Edge is not part of the live model" }],
            };
        }
        const candidate = {
            schema_version: GraphModelGateway.SCHEMA_VERSION,
            nodes: snapshot.value.nodes.map((node) => ({ ...node })),
            edges: snapshot.value.edges.map((edge) => ({ ...edge })),
        };
        candidate.edges[index] = { ...candidate.edges[index], ...patch };
        const validation = validateGraph(candidate);
        if (!validation.ok || !validation.value)
            return validation;
        const edge = validation.value.edges[index];
        if (patch.source !== undefined) {
            liveEdge.from = model.nodes.find((node) => String(node.label).trim() === edge.source);
        }
        if (patch.target !== undefined) {
            liveEdge.to = model.nodes.find((node) => String(node.label).trim() === edge.target);
        }
        if (patch.correlation !== undefined)
            liveEdge.strength = edge.correlation;
        if (patch.decay !== undefined)
            liveEdge.damper = edge.decay;
        if (patch.confidence !== undefined)
            liveEdge.confidence = edge.confidence;
        if (patch.delay !== undefined)
            liveEdge.lag = edge.delay;
        if (patch.functional_form !== undefined)
            liveEdge.functionalForm = edge.functional_form;
        return validation;
    }
    GraphModelGateway.updateLiveEdge = updateLiveEdge;
    function formatIssues(resultOrIssues) {
        const issues = "issues" in resultOrIssues
            ? resultOrIssues.issues
            : resultOrIssues;
        return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    }
    GraphModelGateway.formatIssues = formatIssues;
})(GraphModelGateway || (GraphModelGateway = {}));
if (typeof module !== "undefined" && module.exports) {
    module.exports = GraphModelGateway;
}
