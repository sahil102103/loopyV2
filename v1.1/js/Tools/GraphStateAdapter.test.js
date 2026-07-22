"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

global.Node = {
    _UID: 2,
    DEFAULT_RADIUS: 50,
    DEFAULT_FLOW: 0,
    DEFAULT_PASSNODE: false,
};
global.Edge = { radius: 15 };
global.GraphModelGateway = require("../Validation/GraphModelGateway.js");

const { GraphStateAdapter } = require("./GraphStateAdapter.js");

function modelFixture() {
    const model = {
        nodes: [
            { id: 1, x: 100, y: 100, init: 1, value: 1, label: "A", hue: 0, radius: 50, retention: 1, flow: 0, pass: false, floor: -Infinity, ceiling: Infinity, formula: null, sinkFormula: null, sourceFormula: null },
            { id: 2, x: 300, y: 100, init: 0.5, value: 0.5, label: "B", hue: 1, radius: 50, retention: 1, flow: 0, pass: false, floor: -Infinity, ceiling: Infinity, formula: null, sinkFormula: null, sourceFormula: null },
        ],
        edges: [],
        labels: [],
        dirtyCalls: 0,
        saveCalls: 0,
        dirty() { this.dirtyCalls += 1; },
        saveState() { this.saveCalls += 1; },
        restoreState(state) {
            this.nodes = state.nodes.map((node) => ({ ...node }));
            const byId = Object.fromEntries(this.nodes.map((node) => [node.id, node]));
            this.edges = state.edges.map((edge) => ({
                ...edge,
                from: byId[edge.from],
                to: byId[edge.to],
            }));
            this.labels = state.labels.map((label) => ({ ...label }));
        },
    };
    model.edges = [
        { id: 1, from: model.nodes[0], to: model.nodes[1], arc: 100, rotation: 0, lag: 0, strength: 0.8, damper: 0, confidence: 1, functionalForm: "linear", strengthMultiplier: 1, radius: 15 },
        { id: 2, from: model.nodes[1], to: model.nodes[0], arc: -100, rotation: 0, lag: 0, strength: -0.8, damper: 0, confidence: 1, functionalForm: "linear", strengthMultiplier: 1, radius: 15 },
    ];
    return model;
}

function finalGraph() {
    return {
        nodes: [
            { name: "A", start_amount: 1, retention: 0.9, floor: "-Infinity", ceiling: "Infinity" },
            { name: "B", start_amount: 0.5, retention: 0.8, floor: "-Infinity", ceiling: "Infinity" },
        ],
        edges: [
            { source: "A", target: "B", correlation: 0.8, decay: 0.6, confidence: 1, delay: 0, functional_form: "linear" },
            { source: "B", target: "A", correlation: -0.8, decay: 0, confidence: 1, delay: 0, functional_form: "linear" },
        ],
    };
}

function structurallyEditedGraph() {
    const graph = finalGraph();
    graph.nodes.push({
        name: "C", start_amount: 0, retention: 0,
        floor: "-Infinity", ceiling: "Infinity",
    });
    graph.edges = [
        { source: "A", target: "C", correlation: 0.8, decay: 0, confidence: 1, delay: 0, functional_form: "linear" },
        { source: "C", target: "B", correlation: -0.8, decay: 0, confidence: 1, delay: 0, functional_form: "linear" },
        graph.edges[1],
    ];
    return graph;
}

test("commits a balanced backend frame to the live Canvas model", () => {
    const model = modelFixture();

    const context = GraphStateAdapter.commitFrame(model, {
        graph: finalGraph(),
        classifications: { A: "Optimal", B: "Optimal" },
    });

    assert.equal(model.nodes.length, 2);
    assert.equal(model.edges.length, 2);
    assert.equal(model.nodes.find((node) => node.label === "A").retention, 0.9);
    assert.equal(model.nodes.find((node) => node.label === "B").retention, 0.8);
    assert.equal(model.edges.find((edge) => edge.from.label === "A").damper, 0.6);
    assert.equal(model.nodes[0].classification, "Optimal");
    assert.equal(model.dirtyCalls, 1);
    assert.equal(model.saveCalls, 2);

    GraphStateAdapter.restoreBaseline(model, context);
    assert.equal(model.nodes.find((node) => node.label === "A").retention, 1);
    assert.equal(model.nodes.find((node) => node.label === "B").retention, 1);
    assert.equal(model.edges.find((edge) => edge.from.label === "A").damper, 0);
});

test("restores the Canvas baseline when a committed frame is invalid", () => {
    const model = modelFixture();
    const malformed = finalGraph();
    malformed.edges[0].target = "Missing";

    assert.throws(
        () => GraphStateAdapter.commitFrame(model, { graph: malformed }),
        /Unknown target node/,
    );
    assert.equal(model.nodes.find((node) => node.label === "A").retention, 1);
    assert.equal(model.nodes.find((node) => node.label === "B").retention, 1);
    assert.equal(model.edges.find((edge) => edge.from.label === "A").damper, 0);
    assert.equal(model.saveCalls, 1);
});

test("commits an autonomously added mediator node and its edges to Canvas", () => {
    const model = modelFixture();

    GraphStateAdapter.commitFrame(model, {
        graph: structurallyEditedGraph(),
        classifications: { A: "Optimal", B: "Optimal", C: "Optimal" },
    });

    assert.equal(model.nodes.length, 3);
    assert.equal(model.nodes.find((node) => node.label === "C").retention, 0);
    assert.ok(model.edges.some((edge) => edge.from.label === "A" && edge.to.label === "C"));
    assert.ok(model.edges.some((edge) => edge.from.label === "C" && edge.to.label === "B"));
});
