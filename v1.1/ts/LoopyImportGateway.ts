/// <reference path="./GraphModelGateway.ts" />

/**
 * Compatibility boundary for positional `.loopy` files.
 *
 * Both legacy/native and hacked fcld arrays are decoded into a complete named
 * graph candidate. Nothing in this module mutates the live Canvas model.
 */
namespace LoopyImportGateway {
    export type ImportFormat = "native" | "fcld";

    export interface ImportDefaults {
        nodeRetention: number;
        nodeRadius: number;
        edgeConfidence: number;
        edgeFunctionalForm: string;
    }

    export interface NodeConfig {
        id: number;
        x: number;
        y: number;
        init: number;
        label: string;
        hue: number;
        flow: number;
        pass: boolean;
        floor: GraphModelGateway.CanonicalBound;
        ceiling: GraphModelGateway.CanonicalBound;
        retention: number;
        formula: string | null;
        sinkFormula: string | null;
        sourceFormula: string | null;
        radius: number;
    }

    export interface EdgeConfig {
        from: number;
        to: number;
        arc: number;
        strength: number;
        damper: number;
        confidence: number;
        lag: number;
        rotation: number;
        functionalForm: string;
    }

    export interface LabelConfig {
        x: number;
        y: number;
        text: string;
    }

    export interface ImportCandidate {
        format: ImportFormat;
        graph: GraphModelGateway.CanonicalGraph;
        nodeConfigs: NodeConfig[];
        edgeConfigs: EdgeConfig[];
        labelConfigs: LabelConfig[];
        uid: number;
    }

    const DEFAULTS: ImportDefaults = {
        nodeRetention: 1,
        nodeRadius: 60,
        edgeConfidence: 0.5,
        edgeFunctionalForm: "linear",
    };

    function addIssue(
        issues: GraphModelGateway.ValidationIssue[],
        path: string,
        code: string,
        message: string,
    ): void {
        issues.push({ path, code, message });
    }

    function finiteNumber(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
        fallback?: number,
    ): number {
        if (value === undefined || value === null || value === "") {
            if (fallback !== undefined) return fallback;
            addIssue(issues, path, "finite_number", "Must be a finite number");
            return 0;
        }
        const parsed = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(parsed)) {
            addIssue(issues, path, "finite_number", "Must be a finite number");
            return fallback ?? 0;
        }
        return parsed;
    }

    function nonnegativeInteger(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
        fallback?: number,
    ): number {
        const parsed = finiteNumber(value, path, issues, fallback);
        if (!Number.isInteger(parsed) || parsed < 0) {
            addIssue(issues, path, "nonnegative_integer", "Must be a non-negative integer");
            return fallback ?? 0;
        }
        return parsed;
    }

    function decodeText(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
        rounds: number,
    ): string {
        if (value === undefined || value === null) return "";
        let decoded = String(value);
        for (let index = 0; index < rounds; index += 1) {
            if (!/%[0-9A-Fa-f]{2}/.test(decoded)) break;
            try {
                decoded = decodeURIComponent(decoded);
            } catch (_error) {
                addIssue(issues, path, "uri_encoding", "Contains invalid percent encoding");
                break;
            }
        }
        return decoded;
    }

    function optionalFormula(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): string | null {
        if (value === undefined || value === null || value === "") return null;
        if (typeof value !== "string") {
            addIssue(issues, path, "formula_text", "Formula must be plain text");
            return null;
        }
        const decoded = decodeText(value, path, issues, 2);
        return decoded.trim() === "" ? null : decoded;
    }

    function bound(
        value: unknown,
        fallback: "-Infinity" | "Infinity",
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): GraphModelGateway.CanonicalBound {
        if (value === undefined || value === null || value === "") return fallback;
        if (typeof value === "number") {
            if (Number.isFinite(value)) return value;
            if (value === Infinity) return "Infinity";
            if (value === -Infinity) return "-Infinity";
            addIssue(issues, path, "bound", "Bound cannot be NaN");
            return fallback;
        }
        if (typeof value !== "string") {
            addIssue(issues, path, "bound", "Bound must be numeric or expression text");
            return fallback;
        }
        const decoded = decodeText(value, path, issues, 2).trim();
        if (decoded === "") return fallback;
        const normalized = decoded.toLowerCase();
        if (["infinity", "+infinity", "inf", "+inf"].includes(normalized)) return "Infinity";
        if (["-infinity", "-inf"].includes(normalized)) return "-Infinity";
        const parsed = Number(decoded);
        return Number.isFinite(parsed) ? parsed : decoded;
    }

    function liveBound(value: GraphModelGateway.CanonicalBound): GraphModelGateway.CanonicalBound {
        if (value === "Infinity") return Infinity;
        if (value === "-Infinity") return -Infinity;
        return value;
    }

    function parseDocument(
        input: unknown,
        issues: GraphModelGateway.ValidationIssue[],
    ): unknown[] | null {
        if (typeof input !== "string" || input.trim() === "") {
            addIssue(issues, "$", "file_text", "The .loopy file must contain text");
            return null;
        }
        const source = input.trim();
        let parsed: unknown;
        try {
            parsed = JSON.parse(source);
        } catch (_rawError) {
            try {
                parsed = JSON.parse(decodeURIComponent(source));
            } catch (_decodedError) {
                addIssue(issues, "$", "invalid_json", "The .loopy file is not valid positional JSON");
                return null;
            }
        }
        if (!Array.isArray(parsed)) {
            addIssue(issues, "$", "positional_document", "The .loopy document must be an array");
            return null;
        }
        return parsed;
    }

    function isNumeric(value: unknown): boolean {
        if (typeof value === "number") return Number.isFinite(value);
        return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
    }

    function detectFormat(nodes: unknown[]): ImportFormat {
        const fcldCount = nodes.filter((node) => (
            Array.isArray(node) && node.length >= 15 && isNumeric(node[10])
        )).length;
        return nodes.length > 0 && fcldCount > nodes.length / 2 ? "fcld" : "native";
    }

    export function parse(
        input: unknown,
        suppliedDefaults: Partial<ImportDefaults> = {},
    ): GraphModelGateway.ValidationResult<ImportCandidate> {
        const issues: GraphModelGateway.ValidationIssue[] = [];
        const data = parseDocument(input, issues);
        if (!data) return { ok: false, value: null, issues };

        if (!Array.isArray(data[0])) addIssue(issues, "nodes", "node_array", "Nodes must be an array");
        if (!Array.isArray(data[1])) addIssue(issues, "edges", "edge_array", "Edges must be an array");
        if (data[2] !== undefined && !Array.isArray(data[2])) {
            addIssue(issues, "labels", "label_array", "Labels must be an array");
        }
        if (issues.length) return { ok: false, value: null, issues };

        const defaults: ImportDefaults = { ...DEFAULTS, ...suppliedDefaults };
        const rawNodes = data[0] as unknown[];
        const rawEdges = data[1] as unknown[];
        const rawLabels = (data[2] ?? []) as unknown[];
        const format = detectFormat(rawNodes);
        const nodeConfigs: NodeConfig[] = [];
        const canonicalNodes: unknown[] = [];
        const idToName = new Map<number, string>();

        rawNodes.forEach((rawNode, index) => {
            const path = `nodes[${index}]`;
            if (!Array.isArray(rawNode) || rawNode.length < 5) {
                addIssue(issues, path, "node_tuple", "Node must contain at least id, position, start value, and label");
                return;
            }
            const id = nonnegativeInteger(rawNode[0], `${path}[0]`, issues);
            if (idToName.has(id)) addIssue(issues, `${path}[0]`, "duplicate_node_id", `Duplicate node id: ${id}`);
            const label = decodeText(rawNode[4], `${path}[4]`, issues, 1);
            const floor = bound(rawNode[8], "-Infinity", `${path}[8]`, issues);
            const ceiling = bound(rawNode[9], "Infinity", `${path}[9]`, issues);
            const formulaIndex = format === "fcld" ? 11 : 10;
            const retentionIndex = format === "fcld" ? 10 : 13;
            const formula = optionalFormula(rawNode[formulaIndex], `${path}[${formulaIndex}]`, issues);
            const sinkFormula = optionalFormula(rawNode[11 + (format === "fcld" ? 1 : 0)], `${path}.sink`, issues);
            const sourceFormula = format === "native"
                ? optionalFormula(rawNode[12], `${path}[12]`, issues)
                : null;
            const config: NodeConfig = {
                id,
                x: finiteNumber(rawNode[1], `${path}[1]`, issues, 0),
                y: finiteNumber(rawNode[2], `${path}[2]`, issues, 0),
                init: finiteNumber(rawNode[3], `${path}[3]`, issues, 0),
                label,
                hue: finiteNumber(rawNode[5], `${path}[5]`, issues, 0),
                flow: finiteNumber(rawNode[6], `${path}[6]`, issues, 0),
                pass: rawNode[7] === 1 || rawNode[7] === "1" || rawNode[7] === true,
                floor: liveBound(floor),
                ceiling: liveBound(ceiling),
                retention: finiteNumber(rawNode[retentionIndex], `${path}[${retentionIndex}]`, issues, defaults.nodeRetention),
                formula,
                sinkFormula,
                sourceFormula,
                radius: finiteNumber(rawNode[14], `${path}[14]`, issues, defaults.nodeRadius),
            };
            if (config.radius <= 0) addIssue(issues, `${path}[14]`, "radius_range", "Radius must be positive");
            nodeConfigs.push(config);
            canonicalNodes.push({
                name: label,
                start_amount: config.init,
                retention: config.retention,
                floor,
                ceiling,
                formula: formula ?? undefined,
                sink_formula: sinkFormula ?? undefined,
                source_formula: sourceFormula ?? undefined,
                pass: config.pass,
            });
            idToName.set(id, label);
        });

        const edgeConfigs: EdgeConfig[] = [];
        const canonicalEdges: unknown[] = [];
        rawEdges.forEach((rawEdge, index) => {
            const path = `edges[${index}]`;
            if (!Array.isArray(rawEdge) || rawEdge.length < 4) {
                addIssue(issues, path, "edge_tuple", "Edge must contain source, target, arc, and strength");
                return;
            }
            const from = nonnegativeInteger(rawEdge[0], `${path}[0]`, issues);
            const to = nonnegativeInteger(rawEdge[1], `${path}[1]`, issues);
            const source = idToName.get(from);
            const target = idToName.get(to);
            if (source === undefined) addIssue(issues, `${path}[0]`, "missing_node_id", `Unknown source node id: ${from}`);
            if (target === undefined) addIssue(issues, `${path}[1]`, "missing_node_id", `Unknown target node id: ${to}`);
            const decay = format === "fcld"
                ? 0
                : finiteNumber(rawEdge[4], `${path}[4]`, issues, 0);
            const confidence = format === "fcld"
                ? finiteNumber(rawEdge[4], `${path}[4]`, issues, defaults.edgeConfidence)
                : defaults.edgeConfidence;
            const delay = nonnegativeInteger(rawEdge[5], `${path}[5]`, issues, 0);
            // Before edge functional forms were introduced, native `.loopy`
            // tuples stored rotation at index 8. Numeric values in that slot
            // therefore describe legacy geometry, not an edge transform.
            const hasLegacyRotation = isNumeric(rawEdge[8]);
            const functionalForm = hasLegacyRotation
                || rawEdge[8] === undefined
                || rawEdge[8] === null
                || rawEdge[8] === ""
                ? defaults.edgeFunctionalForm
                : decodeText(rawEdge[8], `${path}[8]`, issues, 1).trim().toLowerCase();
            const config: EdgeConfig = {
                from,
                to,
                arc: finiteNumber(rawEdge[2], `${path}[2]`, issues, 100),
                strength: finiteNumber(rawEdge[3], `${path}[3]`, issues, 1),
                damper: decay,
                confidence,
                lag: delay,
                rotation: hasLegacyRotation
                    ? finiteNumber(rawEdge[8], `${path}[8]`, issues, 0)
                    : finiteNumber(rawEdge[9], `${path}[9]`, issues, 0),
                functionalForm,
            };
            edgeConfigs.push(config);
            canonicalEdges.push({
                source: source ?? "",
                target: target ?? "",
                correlation: config.strength,
                decay,
                confidence,
                delay,
                functional_form: functionalForm,
            });
        });

        const labelConfigs: LabelConfig[] = [];
        rawLabels.forEach((rawLabel, index) => {
            const path = `labels[${index}]`;
            if (!Array.isArray(rawLabel) || rawLabel.length < 3) {
                addIssue(issues, path, "label_tuple", "Label must contain x, y, and text");
                return;
            }
            labelConfigs.push({
                x: finiteNumber(rawLabel[0], `${path}[0]`, issues, 0),
                y: finiteNumber(rawLabel[1], `${path}[1]`, issues, 0),
                text: decodeText(rawLabel[2], `${path}[2]`, issues, 1),
            });
        });

        const graphValidation = GraphModelGateway.validateGraph({
            schema_version: GraphModelGateway.SCHEMA_VERSION,
            nodes: canonicalNodes,
            edges: canonicalEdges,
        });
        issues.push(...graphValidation.issues);
        if (!graphValidation.ok || !graphValidation.value || issues.length) {
            return { ok: false, value: null, issues };
        }

        graphValidation.value.nodes.forEach((node, index) => {
            const config = nodeConfigs[index];
            config.label = node.name;
            config.init = node.start_amount;
            config.retention = node.retention;
            config.floor = liveBound(node.floor);
            config.ceiling = liveBound(node.ceiling);
            config.formula = node.formula ?? null;
            config.sinkFormula = node.sink_formula ?? null;
            config.sourceFormula = node.source_formula ?? null;
        });

        const maxNodeId = nodeConfigs.reduce((maximum, node) => Math.max(maximum, node.id), 0);
        const uid = data[3] === undefined
            ? maxNodeId
            : nonnegativeInteger(data[3], "uid", issues, maxNodeId);
        if (issues.length) return { ok: false, value: null, issues };

        return {
            ok: true,
            issues: [],
            value: {
                format,
                graph: graphValidation.value,
                nodeConfigs,
                edgeConfigs,
                labelConfigs,
                uid: Math.max(uid, maxNodeId),
            },
        };
    }

    export function formatIssues(
        resultOrIssues: GraphModelGateway.ValidationResult<unknown> | readonly GraphModelGateway.ValidationIssue[],
    ): string {
        return GraphModelGateway.formatIssues(resultOrIssues);
    }
}

declare var module: { exports: unknown } | undefined;
if (typeof module !== "undefined" && module.exports) {
    module.exports = LoopyImportGateway;
}
