"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Gateway = require("./GraphModelGateway.js");

test("keeps the typed contract aligned with the versioned JSON schema", () => {
    const schemaPath = path.resolve(
        __dirname,
        "../../../docs/schemas/flowcld-model-v1.schema.json",
    );
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    assert.equal(schema.properties.schema_version.const, Gateway.SCHEMA_VERSION);
    assert.deepEqual(
        schema.properties.edges.items.properties.functional_form.enum,
        Array.from(Gateway.EDGE_FORMS),
    );
});

function validGraph() {
    return {
        schema_version: "flowcld.model.v1",
        nodes: [
            { name: "A", start_amount: 1, retention: 1, floor: "-Infinity", ceiling: "Infinity" },
            { name: "B", start_amount: 0.5, retention: 0.8, floor: 0, ceiling: 10 },
        ],
        edges: [
            { source: "A", target: "B", correlation: 0.8, decay: 0.2, confidence: 0.9, delay: 1, functional_form: "linear" },
        ],
    };
}

function liveModel() {
    const a = { label: "A", init: 1, value: 1, retention: 1, floor: -Infinity, ceiling: Infinity, formula: null, sinkFormula: null, sourceFormula: null, pass: false };
    const b = { label: "B", init: 0.5, value: 0.5, retention: 0.8, floor: 0, ceiling: 10, formula: null, sinkFormula: null, sourceFormula: null, pass: false };
    return {
        nodes: [a, b],
        edges: [{ from: a, to: b, strength: 0.8, damper: 0.2, confidence: 0.9, lag: 1, functionalForm: "linear" }],
    };
}

test("validates and normalizes the named model contract", () => {
    const result = Gateway.validateGraph(validGraph());
    assert.equal(result.ok, true);
    assert.equal(result.value.schema_version, "flowcld.model.v1");
    assert.equal(result.value.edges[0].functional_form, "linear");
});

test("rejects duplicate names, missing endpoints, and invalid numeric ranges", () => {
    const graph = validGraph();
    graph.nodes[1].name = "A";
    graph.edges[0].target = "Missing";
    graph.edges[0].decay = 2;
    graph.edges[0].delay = 0.5;
    const result = Gateway.validateGraph(graph);
    assert.equal(result.ok, false);
    assert.deepEqual(
        new Set(result.issues.map((issue) => issue.code)),
        new Set(["duplicate_node", "missing_node", "decay_range", "delay_range"]),
    );
});

test("converts the live Canvas model without creating a second state store", () => {
    const model = liveModel();
    const result = Gateway.validateLiveModel(model);
    assert.equal(result.ok, true);
    assert.equal(result.value.nodes[0].floor, "-Infinity");
    assert.equal(result.value.nodes[0].ceiling, "Infinity");
    assert.equal(result.value.edges[0].source, "A");
});

test("validates node edits before mutating the live object", () => {
    const model = liveModel();
    const duplicate = Gateway.updateLiveNode(model, model.nodes[1], { name: "A" });
    assert.equal(duplicate.ok, false);
    assert.equal(model.nodes[1].label, "B");

    const accepted = Gateway.updateLiveNode(model, model.nodes[1], { name: "Demand", retention: 0 });
    assert.equal(accepted.ok, true);
    assert.equal(model.nodes[1].label, "Demand");
    assert.equal(model.nodes[1].retention, 0);
    assert.equal(model.edges[0].to.label, "Demand");
});

test("validates edge edits before mutating endpoints or parameters", () => {
    const model = liveModel();
    const invalid = Gateway.updateLiveEdge(model, model.edges[0], { confidence: -0.1 });
    assert.equal(invalid.ok, false);
    assert.equal(model.edges[0].confidence, 0.9);

    const accepted = Gateway.updateLiveEdge(model, model.edges[0], {
        source: "B",
        target: "A",
        confidence: 1,
        delay: 2,
    });
    assert.equal(accepted.ok, true);
    assert.equal(model.edges[0].from.label, "B");
    assert.equal(model.edges[0].to.label, "A");
    assert.equal(model.edges[0].delay, undefined);
    assert.equal(model.edges[0].lag, 2);
});

test("requires explicit schema versions except at compatibility boundaries", () => {
    const graph = validGraph();
    delete graph.schema_version;
    assert.equal(Gateway.validateGraph(graph).ok, false);
    assert.equal(Gateway.validateGraph(graph, { allowMissingSchema: true }).ok, true);
});
