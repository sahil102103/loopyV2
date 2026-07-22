"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

global.GraphModelGateway = require("./GraphModelGateway.js");
const Gateway = require("./TeamRequestGateway.js");

function graph() {
    return {
        schema_version: "flowcld.model.v1",
        nodes: [
            { name: "A", start_amount: 1, retention: 0.8, floor: "-Infinity", ceiling: "Infinity" },
            { name: "B", start_amount: 0.5, retention: 0.7, floor: 0, ceiling: 10 },
        ],
        edges: [
            { source: "A", target: "B", correlation: 0.5, decay: 0.1, confidence: 0.9, delay: 0, functional_form: "linear" },
        ],
    };
}

function team(id = "blue") {
    return {
        id,
        name: "Blue team",
        weight: 1,
        orientation: "stabilize",
        owned_nodes: ["A"],
        target_nodes: ["B"],
        preset: "balanced",
        gamma: 0.99,
        parameter_move_cost: 0.01,
        structural_move_cost: 0.05,
        move_budget: 20,
        structural_budget: 5,
        min_live_nodes: 1,
        objective: { trajectories: {}, behaviors: { B: "Optimal" }, spectral_radius: 0.95 },
        permissions: {
            node_parameters: ["retention"],
            edge_parameters: ["decay"],
            structural_actions: ["add_node", "add_edge"],
            node_targets: null,
            edge_targets: null,
        },
    };
}

function request() {
    const model = graph();
    return {
        request_schema_version: "flowcld.team-session.v1",
        schema_version: model.schema_version,
        nodes: model.nodes,
        edges: model.edges,
        teams: [team()],
        moves: [{
            team_id: "blue",
            action: { kind: "parameter", parameter: "retention", target: "A", value: -0.1, mode: "delta" },
        }],
        agent_strategy: "greedy",
        agent_turns: 2,
        protected_nodes: ["A"],
        protected_edges: [["A", "B"]],
        required_paths: [["A", "B"]],
        iterations: 30,
        seed: 42,
    };
}

test("validates and normalizes a team definition against the canonical graph", () => {
    const result = Gateway.validateTeamDefinition(team(), graph());
    assert.equal(result.ok, true, Gateway.formatIssues(result));
    assert.equal(result.value.objective.behaviors.B, "Optimal");
    assert.deepEqual(result.value.permissions.edge_parameters, ["decay"]);
});

test("rejects unknown objective nodes, unsupported behaviors, and invalid budgets", () => {
    const value = team();
    value.objective = { trajectories: {}, behaviors: { Missing: "Chaotic" } };
    value.min_live_nodes = 5;
    const result = Gateway.validateTeamDefinition(value, graph());
    assert.equal(result.ok, false);
    const codes = new Set(result.issues.map((issue) => issue.code));
    assert.ok(codes.has("missing_node"));
    assert.ok(codes.has("enum"));
    assert.ok(codes.has("integer_range"));
});

test("validates the full greedy session DTO and keeps the model schema explicit", () => {
    const result = Gateway.validateTeamSessionRequest(request());
    assert.equal(result.ok, true, Gateway.formatIssues(result));
    assert.equal(result.value.request_schema_version, "flowcld.team-session.v1");
    assert.equal(result.value.schema_version, "flowcld.model.v1");
    assert.equal(result.value.agent_strategy, "greedy");
    assert.equal(result.value.training_episodes, undefined);
});

test("keeps authorization decisions in the environment so rejected moves remain auditable", () => {
    const value = request();
    value.moves[0].action = {
        kind: "parameter",
        parameter: "correlation",
        target: ["A", "B"],
        value: 0.2,
        mode: "set",
    };
    const result = Gateway.validateTeamSessionRequest(value);
    assert.equal(result.ok, true, Gateway.formatIssues(result));
});

test("rejects duplicate teams, invalid safety references, and malformed moves", () => {
    const value = request();
    value.teams.push(team("blue"));
    value.protected_edges = [["B", "A"]];
    value.moves[0].action.value = Infinity;
    const result = Gateway.validateTeamSessionRequest(value);
    assert.equal(result.ok, false);
    const codes = new Set(result.issues.map((issue) => issue.code));
    assert.ok(codes.has("duplicate_team"));
    assert.ok(codes.has("missing_edge"));
    assert.ok(codes.has("finite_number"));
});

test("validates actor-critic limits and learner references", () => {
    const value = request();
    Object.assign(value, {
        agent_strategy: "actor_critic",
        learner_team_id: "missing",
        training_episodes: 201,
        training_steps: 0,
        n_step: 2,
        opponent_mode: "unknown",
        planning_depth: 4,
        evaluation_seeds: 6,
        actor_learning_rate: 0,
        critic_learning_rate: -1,
        training_temperature: 0,
    });
    const result = Gateway.validateTeamSessionRequest(value);
    assert.equal(result.ok, false);
    assert.ok(result.issues.length >= 8);
});

test("rejects malformed structural edit values before transport", () => {
    const value = request();
    value.moves = [{
        team_id: "blue",
        action: {
            kind: "structural_transaction",
            edits: [{ kind: "add_node", name: "C", retention: 0.5, formula: "nxt['A']" }],
        },
    }];
    const result = Gateway.validateTeamSessionRequest(value);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "converter_retention"));
});

test("requires the versioned team-session boundary", () => {
    const value = request();
    delete value.request_schema_version;
    const result = Gateway.validateTeamSessionRequest(value);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.path === "request_schema_version"));
});
