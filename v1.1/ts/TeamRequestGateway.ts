/// <reference path="./GraphModelGateway.ts" />

/** Typed, runtime-validated contract for the Stage 4/5 team-session API. */
namespace TeamRequestGateway {
    export const SCHEMA_VERSION = "flowcld.team-session.v1" as const;
    export const ORIENTATIONS = ["stabilize", "disrupt"] as const;
    export const BEHAVIORS = ["Over-damped", "Optimal", "Unconstrained"] as const;
    export const SCORE_PRESETS = ["balanced", "stability_first", "responsive"] as const;
    export const NODE_PARAMETERS = ["start_amount", "retention"] as const;
    export const EDGE_PARAMETERS = ["decay", "delay", "confidence", "correlation"] as const;
    export const STRUCTURAL_ACTIONS = ["add_node", "remove_node", "add_edge", "remove_edge"] as const;
    export const MUTATION_MODES = ["set", "delta"] as const;
    export const AGENT_STRATEGIES = ["greedy", "epsilon_greedy", "actor_critic"] as const;
    export const OPPONENT_MODES = ["hold", "random", "greedy"] as const;

    export type Orientation = typeof ORIENTATIONS[number];
    export type Behavior = typeof BEHAVIORS[number];
    export type ScorePreset = typeof SCORE_PRESETS[number];
    export type NodeParameter = typeof NODE_PARAMETERS[number];
    export type EdgeParameter = typeof EDGE_PARAMETERS[number];
    export type ParameterName = NodeParameter | EdgeParameter;
    export type StructuralActionKind = typeof STRUCTURAL_ACTIONS[number];
    export type MutationMode = typeof MUTATION_MODES[number];
    export type AgentStrategy = typeof AGENT_STRATEGIES[number];
    export type OpponentMode = typeof OPPONENT_MODES[number];
    export type EdgePair = [string, string];
    export type StructuralBound = number | "-Infinity" | "Infinity";

    export interface TargetSpecification {
        trajectories: Record<string, number[]>;
        behaviors: Record<string, Behavior>;
        spectral_radius?: number;
    }

    export interface TeamPermissions {
        node_parameters: NodeParameter[];
        edge_parameters: EdgeParameter[];
        structural_actions: StructuralActionKind[];
        node_targets: string[] | null;
        edge_targets: EdgePair[] | null;
    }

    export interface TeamDefinition {
        id: string;
        name: string;
        weight: number;
        orientation: Orientation;
        owned_nodes: string[];
        target_nodes: string[];
        preset: ScorePreset;
        gamma: number;
        parameter_move_cost: number;
        structural_move_cost: number;
        move_budget: number;
        structural_budget: number;
        min_live_nodes: number;
        goal_potential?: number;
        objective: TargetSpecification;
        permissions: TeamPermissions;
    }

    export interface NoOpAction {
        kind: "no_op";
        reason: string;
    }

    export interface ParameterAction {
        kind: "parameter";
        parameter: ParameterName;
        target: string | EdgePair;
        value: number;
        mode: MutationMode;
    }

    export interface AddNodeAction {
        kind: "add_node";
        name: string;
        start_amount: number;
        retention: number;
        floor: StructuralBound;
        ceiling: StructuralBound;
        formula?: string;
        sink_formula?: string;
        source_formula?: string;
    }

    export interface RemoveNodeAction {
        kind: "remove_node";
        name: string;
    }

    export interface AddEdgeAction {
        kind: "add_edge";
        source: string;
        target: string;
        correlation: number;
        decay: number;
        confidence: number;
        delay: number;
        functional_form: GraphModelGateway.EdgeFunctionalForm;
    }

    export interface RemoveEdgeAction {
        kind: "remove_edge";
        source: string;
        target: string;
    }

    export type StructuralEdit = AddNodeAction | RemoveNodeAction | AddEdgeAction | RemoveEdgeAction;

    export interface StructuralTransactionAction {
        kind: "structural_transaction";
        label?: string;
        edits: StructuralEdit[];
    }

    export type TeamAction = NoOpAction | ParameterAction | StructuralEdit | StructuralTransactionAction;

    export interface TeamMove {
        team_id: string;
        action: TeamAction;
    }

    export interface TeamSessionRequest {
        request_schema_version: typeof SCHEMA_VERSION;
        schema_version: typeof GraphModelGateway.SCHEMA_VERSION;
        nodes: GraphModelGateway.CanonicalNode[];
        edges: GraphModelGateway.CanonicalEdge[];
        teams: TeamDefinition[];
        moves: TeamMove[];
        agent_strategy: AgentStrategy;
        agent_turns: number;
        protected_nodes: string[];
        protected_edges: EdgePair[];
        required_paths: EdgePair[];
        iterations: number;
        seed: number;
        learner_team_id?: string;
        training_episodes?: number;
        training_steps?: number;
        n_step?: number;
        opponent_mode?: OpponentMode;
        planning_depth?: number;
        evaluation_seeds?: number;
        actor_learning_rate?: number;
        critic_learning_rate?: number;
        training_temperature?: number;
        epsilon?: number;
        epsilon_min?: number;
        epsilon_decay?: number;
        epsilon_learning_rate?: number;
    }

    const orientationSet: ReadonlySet<string> = new Set(ORIENTATIONS);
    const behaviorSet: ReadonlySet<string> = new Set(BEHAVIORS);
    const presetSet: ReadonlySet<string> = new Set(SCORE_PRESETS);
    const nodeParameterSet: ReadonlySet<string> = new Set(NODE_PARAMETERS);
    const edgeParameterSet: ReadonlySet<string> = new Set(EDGE_PARAMETERS);
    const structuralSet: ReadonlySet<string> = new Set(STRUCTURAL_ACTIONS);
    const mutationModeSet: ReadonlySet<string> = new Set(MUTATION_MODES);
    const strategySet: ReadonlySet<string> = new Set(AGENT_STRATEGIES);
    const opponentModeSet: ReadonlySet<string> = new Set(OPPONENT_MODES);
    const edgeFormSet: ReadonlySet<string> = new Set(GraphModelGateway.EDGE_FORMS);

    function isRecord(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function addIssue(
        issues: GraphModelGateway.ValidationIssue[],
        path: string,
        code: string,
        message: string,
    ): void {
        issues.push({ path, code, message });
    }

    function requiredText(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): string {
        if (typeof value !== "string" || value.trim() === "") {
            addIssue(issues, path, "required_text", "Must be a non-empty string");
            return "";
        }
        return value.trim();
    }

    function optionalText(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): string | undefined {
        if (value === undefined || value === null || value === "") return undefined;
        if (typeof value !== "string") {
            addIssue(issues, path, "plain_text", "Must be plain text");
            return undefined;
        }
        return value.trim() || undefined;
    }

    function finiteNumber(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
        fallback?: number,
    ): number {
        if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
        if (typeof value !== "number" || !Number.isFinite(value)) {
            addIssue(issues, path, "finite_number", "Must be a finite number");
            return fallback ?? 0;
        }
        return value;
    }

    function integer(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
        minimum: number,
        maximum: number,
        fallback?: number,
    ): number {
        const parsed = finiteNumber(value, path, issues, fallback);
        if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
            addIssue(issues, path, "integer_range", `Must be an integer from ${minimum} to ${maximum}`);
            return fallback ?? minimum;
        }
        return parsed;
    }

    function enumText<T extends string>(
        value: unknown,
        path: string,
        allowed: ReadonlySet<string>,
        allowedValues: readonly T[],
        issues: GraphModelGateway.ValidationIssue[],
        fallback: T,
    ): T {
        const normalized = typeof value === "string" ? value.trim() : "";
        if (!allowed.has(normalized)) {
            addIssue(issues, path, "enum", `Must be one of: ${allowedValues.join(", ")}`);
            return fallback;
        }
        return normalized as T;
    }

    function edgeKey(source: string, target: string): string {
        return `${source}\u0000${target}`;
    }

    function uniqueStrings(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): string[] {
        if (!Array.isArray(value)) {
            addIssue(issues, path, "string_array", "Must be an array of names");
            return [];
        }
        const result: string[] = [];
        value.forEach((item, index) => {
            const name = requiredText(item, `${path}[${index}]`, issues);
            if (name && !result.includes(name)) result.push(name);
        });
        return result;
    }

    function pair(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): EdgePair {
        if (!Array.isArray(value) || value.length !== 2) {
            addIssue(issues, path, "edge_pair", "Must contain exactly two node names");
            return ["", ""];
        }
        return [
            requiredText(value[0], `${path}[0]`, issues),
            requiredText(value[1], `${path}[1]`, issues),
        ];
    }

    function pairs(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): EdgePair[] {
        if (!Array.isArray(value)) {
            addIssue(issues, path, "edge_pair_array", "Must be an array of node pairs");
            return [];
        }
        return value.map((item, index) => pair(item, `${path}[${index}]`, issues));
    }

    function enumArray<T extends string>(
        value: unknown,
        path: string,
        allowed: ReadonlySet<string>,
        allowedValues: readonly T[],
        issues: GraphModelGateway.ValidationIssue[],
    ): T[] {
        if (!Array.isArray(value)) {
            addIssue(issues, path, "enum_array", "Must be an array");
            return [];
        }
        const result: T[] = [];
        value.forEach((item, index) => {
            const parsed = enumText(item, `${path}[${index}]`, allowed, allowedValues, issues, allowedValues[0]);
            if (allowed.has(String(item).trim()) && !result.includes(parsed)) result.push(parsed);
        });
        return result;
    }

    function requireKnownNodes(
        names: readonly string[],
        path: string,
        knownNodes: ReadonlySet<string>,
        issues: GraphModelGateway.ValidationIssue[],
    ): void {
        names.forEach((name, index) => {
            if (name && !knownNodes.has(name)) {
                addIssue(issues, `${path}[${index}]`, "missing_node", `Unknown node: ${name}`);
            }
        });
    }

    function normalizeObjective(
        value: unknown,
        path: string,
        knownNodes: ReadonlySet<string>,
        issues: GraphModelGateway.ValidationIssue[],
    ): TargetSpecification {
        if (!isRecord(value)) {
            addIssue(issues, path, "objective_object", "Objective must be an object");
            value = {};
        }
        const raw = value as Record<string, unknown>;
        const trajectoriesRaw = isRecord(raw.trajectories) ? raw.trajectories : {};
        const behaviorsRaw = isRecord(raw.behaviors) ? raw.behaviors : {};
        if (raw.trajectories !== undefined && !isRecord(raw.trajectories)) {
            addIssue(issues, `${path}.trajectories`, "trajectory_object", "Trajectories must be an object keyed by node");
        }
        if (raw.behaviors !== undefined && !isRecord(raw.behaviors)) {
            addIssue(issues, `${path}.behaviors`, "behavior_object", "Behaviors must be an object keyed by node");
        }
        const trajectories: Record<string, number[]> = {};
        Object.keys(trajectoriesRaw).forEach((rawName) => {
            const name = rawName.trim();
            const nodePath = `${path}.trajectories.${rawName}`;
            if (!name || !knownNodes.has(name)) addIssue(issues, nodePath, "missing_node", `Unknown objective node: ${rawName}`);
            const values = trajectoriesRaw[rawName];
            if (!Array.isArray(values) || values.length === 0) {
                addIssue(issues, nodePath, "trajectory", "Trajectory must be a non-empty numeric array");
                return;
            }
            trajectories[name] = values.map((item, index) => finiteNumber(item, `${nodePath}[${index}]`, issues));
        });
        const behaviors: Record<string, Behavior> = {};
        Object.keys(behaviorsRaw).forEach((rawName) => {
            const name = rawName.trim();
            const nodePath = `${path}.behaviors.${rawName}`;
            if (!name || !knownNodes.has(name)) addIssue(issues, nodePath, "missing_node", `Unknown objective node: ${rawName}`);
            behaviors[name] = enumText(
                behaviorsRaw[rawName], nodePath, behaviorSet, BEHAVIORS, issues, "Optimal",
            );
        });
        const objective: TargetSpecification = { trajectories, behaviors };
        if (raw.spectral_radius !== undefined && raw.spectral_radius !== null && raw.spectral_radius !== "") {
            const radius = finiteNumber(raw.spectral_radius, `${path}.spectral_radius`, issues);
            if (radius <= 0 || radius >= 1) {
                addIssue(issues, `${path}.spectral_radius`, "spectral_radius", "Must be greater than 0 and less than 1");
            }
            objective.spectral_radius = radius;
        }
        return objective;
    }

    function normalizePermissions(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): TeamPermissions {
        if (!isRecord(value)) {
            addIssue(issues, path, "permissions_object", "Permissions must be an object");
            value = {};
        }
        const raw = value as Record<string, unknown>;
        let nodeTargets: string[] | null = null;
        if (raw.node_targets !== undefined && raw.node_targets !== null) {
            nodeTargets = uniqueStrings(raw.node_targets, `${path}.node_targets`, issues);
        }
        let edgeTargets: EdgePair[] | null = null;
        if (raw.edge_targets !== undefined && raw.edge_targets !== null) {
            edgeTargets = pairs(raw.edge_targets, `${path}.edge_targets`, issues);
        }
        return {
            node_parameters: enumArray(raw.node_parameters ?? [], `${path}.node_parameters`, nodeParameterSet, NODE_PARAMETERS, issues),
            edge_parameters: enumArray(raw.edge_parameters ?? [], `${path}.edge_parameters`, edgeParameterSet, EDGE_PARAMETERS, issues),
            structural_actions: enumArray(raw.structural_actions ?? [], `${path}.structural_actions`, structuralSet, STRUCTURAL_ACTIONS, issues),
            node_targets: nodeTargets,
            edge_targets: edgeTargets,
        };
    }

    function normalizeTeam(
        value: unknown,
        index: number,
        graph: GraphModelGateway.CanonicalGraph,
        issues: GraphModelGateway.ValidationIssue[],
    ): TeamDefinition {
        const path = `teams[${index}]`;
        if (!isRecord(value)) {
            addIssue(issues, path, "team_object", "Team must be an object");
            value = {};
        }
        const raw = value as Record<string, unknown>;
        const knownNodes = new Set(graph.nodes.map((node) => node.name));
        const ownedNodes = uniqueStrings(raw.owned_nodes ?? [], `${path}.owned_nodes`, issues);
        const targetNodes = uniqueStrings(raw.target_nodes ?? [], `${path}.target_nodes`, issues);
        requireKnownNodes(ownedNodes, `${path}.owned_nodes`, knownNodes, issues);
        requireKnownNodes(targetNodes, `${path}.target_nodes`, knownNodes, issues);
        const weight = finiteNumber(raw.weight, `${path}.weight`, issues, 1);
        if (weight <= 0) addIssue(issues, `${path}.weight`, "positive", "Weight must be positive");
        const gamma = finiteNumber(raw.gamma, `${path}.gamma`, issues, 0.99);
        if (gamma < 0 || gamma > 1) addIssue(issues, `${path}.gamma`, "gamma_range", "Gamma must be between 0 and 1");
        const parameterCost = finiteNumber(raw.parameter_move_cost, `${path}.parameter_move_cost`, issues, 0.01);
        const structuralCost = finiteNumber(raw.structural_move_cost, `${path}.structural_move_cost`, issues, 0.05);
        if (parameterCost < 0) addIssue(issues, `${path}.parameter_move_cost`, "nonnegative", "Cost cannot be negative");
        if (structuralCost < 0) addIssue(issues, `${path}.structural_move_cost`, "nonnegative", "Cost cannot be negative");
        const moveBudget = integer(raw.move_budget, `${path}.move_budget`, issues, 1, Number.MAX_SAFE_INTEGER, 20);
        const structuralBudget = integer(raw.structural_budget, `${path}.structural_budget`, issues, 0, Number.MAX_SAFE_INTEGER, 5);
        const minLiveNodes = integer(raw.min_live_nodes, `${path}.min_live_nodes`, issues, 1, graph.nodes.length, 1);
        const team: TeamDefinition = {
            id: requiredText(raw.id, `${path}.id`, issues),
            name: requiredText(raw.name ?? raw.id, `${path}.name`, issues),
            weight,
            orientation: enumText(raw.orientation ?? "stabilize", `${path}.orientation`, orientationSet, ORIENTATIONS, issues, "stabilize"),
            owned_nodes: ownedNodes,
            target_nodes: targetNodes,
            preset: enumText(raw.preset ?? "balanced", `${path}.preset`, presetSet, SCORE_PRESETS, issues, "balanced"),
            gamma,
            parameter_move_cost: parameterCost,
            structural_move_cost: structuralCost,
            move_budget: moveBudget,
            structural_budget: structuralBudget,
            min_live_nodes: minLiveNodes,
            objective: normalizeObjective(raw.objective ?? {}, `${path}.objective`, knownNodes, issues),
            permissions: normalizePermissions(raw.permissions ?? {}, `${path}.permissions`, issues),
        };
        if (raw.goal_potential !== undefined && raw.goal_potential !== null && raw.goal_potential !== "") {
            team.goal_potential = finiteNumber(raw.goal_potential, `${path}.goal_potential`, issues);
        }
        return team;
    }

    function structuralBound(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
        fallback: "-Infinity" | "Infinity",
    ): StructuralBound {
        if (value === undefined || value === null || value === "") return fallback;
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["infinity", "+infinity", "inf", "+inf"].includes(normalized)) return "Infinity";
            if (["-infinity", "-inf"].includes(normalized)) return "-Infinity";
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
        addIssue(issues, path, "numeric_bound", "Structural bounds must be numeric or Infinity");
        return fallback;
    }

    function normalizeStructuralEdit(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): StructuralEdit {
        if (!isRecord(value)) {
            addIssue(issues, path, "structural_edit", "Structural edit must be an object");
            value = {};
        }
        const raw = value as Record<string, unknown>;
        const kind = enumText(raw.kind, `${path}.kind`, structuralSet, STRUCTURAL_ACTIONS, issues, "add_node");
        if (kind === "add_node") {
            const name = requiredText(raw.name, `${path}.name`, issues);
            const retention = finiteNumber(raw.retention, `${path}.retention`, issues, 1);
            if (retention < 0 || retention > 1) addIssue(issues, `${path}.retention`, "retention_range", "Retention must be between 0 and 1");
            const formula = optionalText(raw.formula, `${path}.formula`, issues);
            if (formula && retention !== 0) addIssue(issues, `${path}.retention`, "converter_retention", "Formula converter retention must be 0");
            const floor = structuralBound(raw.floor, `${path}.floor`, issues, "-Infinity");
            const ceiling = structuralBound(raw.ceiling, `${path}.ceiling`, issues, "Infinity");
            const floorNumber = floor === "-Infinity" ? -Infinity : Number(floor);
            const ceilingNumber = ceiling === "Infinity" ? Infinity : Number(ceiling);
            if (floorNumber > ceilingNumber) addIssue(issues, path, "bound_order", "Floor cannot exceed ceiling");
            const edit: AddNodeAction = {
                kind,
                name,
                start_amount: finiteNumber(raw.start_amount, `${path}.start_amount`, issues, 0),
                retention,
                floor,
                ceiling,
            };
            if (formula !== undefined) edit.formula = formula;
            const sinkFormula = optionalText(raw.sink_formula, `${path}.sink_formula`, issues);
            const sourceFormula = optionalText(raw.source_formula, `${path}.source_formula`, issues);
            if (sinkFormula !== undefined) edit.sink_formula = sinkFormula;
            if (sourceFormula !== undefined) edit.source_formula = sourceFormula;
            return edit;
        }
        if (kind === "remove_node") {
            const name = requiredText(raw.name, `${path}.name`, issues);
            return { kind, name };
        }
        const source = requiredText(raw.source, `${path}.source`, issues);
        const target = requiredText(raw.target, `${path}.target`, issues);
        if (kind === "add_edge") {
            const decay = finiteNumber(raw.decay, `${path}.decay`, issues, 0);
            const confidence = finiteNumber(raw.confidence, `${path}.confidence`, issues, 1);
            if (decay < 0 || decay > 1) addIssue(issues, `${path}.decay`, "decay_range", "Decay must be between 0 and 1");
            if (confidence < 0 || confidence > 1) addIssue(issues, `${path}.confidence`, "confidence_range", "Confidence must be between 0 and 1");
            const edit: AddEdgeAction = {
                kind,
                source,
                target,
                correlation: finiteNumber(raw.correlation, `${path}.correlation`, issues, 1),
                decay,
                confidence,
                delay: integer(raw.delay, `${path}.delay`, issues, 0, Number.MAX_SAFE_INTEGER, 0),
                functional_form: enumText(
                    raw.functional_form ?? "linear", `${path}.functional_form`, edgeFormSet,
                    GraphModelGateway.EDGE_FORMS, issues, "linear",
                ),
            };
            return edit;
        }
        return { kind: "remove_edge", source, target };
    }

    function normalizeAction(
        value: unknown,
        path: string,
        issues: GraphModelGateway.ValidationIssue[],
    ): TeamAction {
        if (!isRecord(value)) {
            addIssue(issues, path, "action_object", "Action must be an object");
            return { kind: "no_op", reason: "Invalid action" };
        }
        const rawKind = value.kind;
        if (rawKind === "no_op") {
            return { kind: "no_op", reason: optionalText(value.reason, `${path}.reason`, issues) ?? "No improving legal move" };
        }
        if (rawKind === "parameter" || (rawKind === undefined && value.parameter !== undefined)) {
            const parameter = enumText(
                value.parameter, `${path}.parameter`, new Set([...NODE_PARAMETERS, ...EDGE_PARAMETERS]),
                [...NODE_PARAMETERS, ...EDGE_PARAMETERS], issues, "start_amount",
            );
            const target = nodeParameterSet.has(parameter)
                ? requiredText(value.target, `${path}.target`, issues)
                : pair(value.target, `${path}.target`, issues);
            const actionValue = finiteNumber(value.value, `${path}.value`, issues);
            if (parameter === "delay" && !Number.isInteger(actionValue)) {
                addIssue(issues, `${path}.value`, "delay_integer", "Delay changes must be integers");
            }
            return {
                kind: "parameter",
                parameter,
                target,
                value: actionValue,
                mode: enumText(value.mode ?? "delta", `${path}.mode`, mutationModeSet, MUTATION_MODES, issues, "delta"),
            };
        }
        if (rawKind === "structural_transaction") {
            if (!Array.isArray(value.edits) || value.edits.length === 0) {
                addIssue(issues, `${path}.edits`, "structural_edits", "Transaction needs at least one structural edit");
            }
            const edits = Array.isArray(value.edits)
                ? value.edits.map((edit, index) => normalizeStructuralEdit(edit, `${path}.edits[${index}]`, issues))
                : [];
            const transaction: StructuralTransactionAction = { kind: "structural_transaction", edits };
            const label = optionalText(value.label, `${path}.label`, issues);
            if (label !== undefined) transaction.label = label;
            return transaction;
        }
        return normalizeStructuralEdit(value, path, issues);
    }

    function graphResult(input: unknown): GraphModelGateway.ValidationResult<GraphModelGateway.CanonicalGraph> {
        return GraphModelGateway.validateGraph(input);
    }

    export function validateTeamDefinition(
        input: unknown,
        graphInput: unknown,
    ): GraphModelGateway.ValidationResult<TeamDefinition> {
        const graphValidation = graphResult(graphInput);
        if (!graphValidation.ok || !graphValidation.value) {
            return { ok: false, value: null, issues: graphValidation.issues };
        }
        const issues: GraphModelGateway.ValidationIssue[] = [];
        const team = normalizeTeam(input, 0, graphValidation.value, issues);
        return { ok: issues.length === 0, value: issues.length === 0 ? team : null, issues };
    }

    export function validateTeamSessionRequest(
        input: unknown,
    ): GraphModelGateway.ValidationResult<TeamSessionRequest> {
        const issues: GraphModelGateway.ValidationIssue[] = [];
        if (!isRecord(input)) {
            addIssue(issues, "$", "request_object", "Team session request must be an object");
            return { ok: false, value: null, issues };
        }
        if (input.request_schema_version !== SCHEMA_VERSION) {
            addIssue(issues, "request_schema_version", "schema_version", `Expected ${SCHEMA_VERSION}`);
        }
        const graphValidation = graphResult({
            schema_version: input.schema_version,
            nodes: input.nodes,
            edges: input.edges,
        });
        if (!graphValidation.ok || !graphValidation.value) {
            graphValidation.issues.forEach((issue) => addIssue(issues, `graph.${issue.path}`, issue.code, issue.message));
            return { ok: false, value: null, issues };
        }
        const graph = graphValidation.value;
        if (!Array.isArray(input.teams) || input.teams.length === 0) {
            addIssue(issues, "teams", "team_array", "At least one team is required");
        }
        const teams = (Array.isArray(input.teams) ? input.teams : []).map((team, index) => (
            normalizeTeam(team, index, graph, issues)
        ));
        const teamById = new Map<string, TeamDefinition>();
        teams.forEach((team, index) => {
            if (team.id && teamById.has(team.id)) addIssue(issues, `teams[${index}].id`, "duplicate_team", `Duplicate team id: ${team.id}`);
            if (team.id) teamById.set(team.id, team);
        });

        if (!Array.isArray(input.moves)) addIssue(issues, "moves", "move_array", "Moves must be an array");
        const rawMoves = Array.isArray(input.moves) ? input.moves : [];
        if (rawMoves.length > 100) addIssue(issues, "moves", "move_limit", "A session cannot exceed 100 queued moves");
        const moves: TeamMove[] = rawMoves.map((rawMove, index) => {
            const path = `moves[${index}]`;
            if (!isRecord(rawMove)) {
                addIssue(issues, path, "move_object", "Move must be an object");
                return { team_id: "", action: { kind: "no_op", reason: "Invalid move" } };
            }
            const teamId = requiredText(rawMove.team_id, `${path}.team_id`, issues);
            const team = teamById.get(teamId);
            if (!team) addIssue(issues, `${path}.team_id`, "missing_team", `Unknown team: ${teamId}`);
            const action = normalizeAction(rawMove.action, `${path}.action`, issues);
            return { team_id: teamId, action };
        });

        const knownNodes = new Set(graph.nodes.map((node) => node.name));
        const knownEdges = new Set(graph.edges.map((edge) => edgeKey(edge.source, edge.target)));
        const protectedNodes = uniqueStrings(input.protected_nodes ?? [], "protected_nodes", issues);
        requireKnownNodes(protectedNodes, "protected_nodes", knownNodes, issues);
        const protectedEdges = pairs(input.protected_edges ?? [], "protected_edges", issues);
        protectedEdges.forEach((edge, index) => {
            requireKnownNodes(edge, `protected_edges[${index}]`, knownNodes, issues);
            if (!knownEdges.has(edgeKey(edge[0], edge[1]))) addIssue(issues, `protected_edges[${index}]`, "missing_edge", `Unknown edge: ${edge[0]} -> ${edge[1]}`);
        });
        const requiredPaths = pairs(input.required_paths ?? [], "required_paths", issues);
        requiredPaths.forEach((pathValue, index) => requireKnownNodes(pathValue, `required_paths[${index}]`, knownNodes, issues));

        const strategy = enumText(input.agent_strategy ?? "greedy", "agent_strategy", strategySet, AGENT_STRATEGIES, issues, "greedy");
        const request: TeamSessionRequest = {
            request_schema_version: SCHEMA_VERSION,
            schema_version: GraphModelGateway.SCHEMA_VERSION,
            nodes: graph.nodes,
            edges: graph.edges,
            teams,
            moves,
            agent_strategy: strategy,
            agent_turns: integer(input.agent_turns, "agent_turns", issues, 0, 100, 0),
            protected_nodes: protectedNodes,
            protected_edges: protectedEdges,
            required_paths: requiredPaths,
            iterations: integer(input.iterations, "iterations", issues, 1, 200, 50),
            seed: integer(input.seed, "seed", issues, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 42),
        };
        if (strategy !== "greedy") {
            const learner = requiredText(input.learner_team_id, "learner_team_id", issues);
            if (learner && !teamById.has(learner)) addIssue(issues, "learner_team_id", "missing_team", `Unknown learner team: ${learner}`);
            request.learner_team_id = learner;
            request.training_episodes = integer(input.training_episodes, "training_episodes", issues, 1, 200, 20);
            request.training_steps = integer(input.training_steps, "training_steps", issues, 1, 50, 8);
            request.opponent_mode = enumText(input.opponent_mode ?? "hold", "opponent_mode", opponentModeSet, OPPONENT_MODES, issues, "hold");
            request.evaluation_seeds = integer(input.evaluation_seeds, "evaluation_seeds", issues, 0, 5, 0);
        }
        if (strategy === "actor_critic") {
            request.n_step = integer(input.n_step, "n_step", issues, 1, 50, 5);
            request.planning_depth = integer(input.planning_depth, "planning_depth", issues, 1, 3, 1);
            request.actor_learning_rate = finiteNumber(input.actor_learning_rate, "actor_learning_rate", issues, 0.03);
            request.critic_learning_rate = finiteNumber(input.critic_learning_rate, "critic_learning_rate", issues, 0.08);
            request.training_temperature = finiteNumber(input.training_temperature, "training_temperature", issues, 1);
            if (request.actor_learning_rate <= 0) addIssue(issues, "actor_learning_rate", "positive", "Actor rate must be positive");
            if (request.critic_learning_rate < 0) addIssue(issues, "critic_learning_rate", "nonnegative", "Critic rate cannot be negative");
            if (request.training_temperature <= 0) addIssue(issues, "training_temperature", "positive", "Exploration temperature must be positive");
        }
        if (strategy === "epsilon_greedy") {
            request.epsilon = finiteNumber(input.epsilon, "epsilon", issues, 0.25);
            request.epsilon_min = finiteNumber(input.epsilon_min, "epsilon_min", issues, 0.02);
            request.epsilon_decay = finiteNumber(input.epsilon_decay, "epsilon_decay", issues, 0.98);
            if (request.epsilon < 0 || request.epsilon > 1) addIssue(issues, "epsilon", "epsilon_range", "Initial exploration must be between 0 and 1");
            if (request.epsilon_min < 0 || request.epsilon_min > request.epsilon) addIssue(issues, "epsilon_min", "epsilon_min_range", "Minimum exploration must be between 0 and initial exploration");
            if (request.epsilon_decay <= 0 || request.epsilon_decay > 1) addIssue(issues, "epsilon_decay", "epsilon_decay_range", "Exploration decay must be greater than 0 and at most 1");
            if (input.epsilon_learning_rate !== undefined && input.epsilon_learning_rate !== null && input.epsilon_learning_rate !== "") {
                request.epsilon_learning_rate = finiteNumber(input.epsilon_learning_rate, "epsilon_learning_rate", issues);
                if (request.epsilon_learning_rate <= 0 || request.epsilon_learning_rate > 1) addIssue(issues, "epsilon_learning_rate", "epsilon_learning_rate_range", "Learning rate must be greater than 0 and at most 1");
            }
        }
        return { ok: issues.length === 0, value: issues.length === 0 ? request : null, issues };
    }

    export function formatIssues(
        resultOrIssues: GraphModelGateway.ValidationResult<unknown> | readonly GraphModelGateway.ValidationIssue[],
    ): string {
        return GraphModelGateway.formatIssues(resultOrIssues);
    }
}

declare var module: { exports: unknown } | undefined;
if (typeof module !== "undefined" && module.exports) {
    module.exports = TeamRequestGateway;
}
