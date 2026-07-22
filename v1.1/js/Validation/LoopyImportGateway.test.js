"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

global.GraphModelGateway = require("./GraphModelGateway.js");
const Gateway = require("./LoopyImportGateway.js");

function nativeDocument() {
    return [
        [
            [1, 20, 30, 1, "A%20Node", 2, 0, 0, "-Infinity", "Infinity", "", "", "", 0.8, 70],
            [2, 180, 30, 0, "B", 4, 0, 0, "0", "10", "nxt%5B'A%20Node'%5D", "", "", 0, 60],
        ],
        [[1, 2, 90, 0.75, 0.2, 3, null, null, "tanh", 45]],
        [[10, 15, "A%20note"]],
        2,
    ];
}

test("parses the native positional layout into a validated named candidate", () => {
    const result = Gateway.parse(JSON.stringify(nativeDocument()), { edgeConfidence: 0.5 });
    assert.equal(result.ok, true, Gateway.formatIssues(result));
    assert.equal(result.value.format, "native");
    assert.equal(result.value.graph.nodes[0].name, "A Node");
    assert.equal(result.value.graph.nodes[0].retention, 0.8);
    assert.equal(result.value.graph.nodes[1].formula, "nxt['A Node']");
    assert.equal(result.value.graph.edges[0].decay, 0.2);
    assert.equal(result.value.graph.edges[0].delay, 3);
    assert.equal(result.value.graph.edges[0].confidence, 0.5);
    assert.equal(result.value.edgeConfigs[0].rotation, 45);
    assert.equal(result.value.labelConfigs[0].text, "A note");
});

test("parses the fcld fixture without treating confidence as decay", () => {
    const fixture = path.resolve(__dirname, "../../../backend/tests/fixtures/toy_fcld.loopy");
    const result = Gateway.parse(fs.readFileSync(fixture, "utf8"));
    assert.equal(result.ok, true, Gateway.formatIssues(result));
    assert.equal(result.value.format, "fcld");
    assert.equal(result.value.graph.nodes.length, 10);
    assert.equal(result.value.graph.edges.length, 15);
    const consumption = result.value.graph.nodes.find((node) => node.name === "Consumption");
    assert.equal(consumption.retention, 0);
    assert.match(consumption.formula, /nxt\['Income'\]/);
    assert.ok(result.value.graph.edges.every((edge) => edge.decay === 0));
    assert.ok(result.value.graph.edges.every((edge) => edge.confidence === 1));
});

test("supports old native files that predate retention and display-size fields", () => {
    const legacy = [[
        [1, 0, 0, 0.4, "A", 0, 0, 0],
        [2, 100, 0, 0.4, "B", 1, 0, 0],
    ], [[1, 2, 100, -1]], [], 2];
    const result = Gateway.parse(JSON.stringify(legacy), {
        nodeRetention: 1,
        nodeRadius: 60,
        edgeConfidence: 0.5,
    });
    assert.equal(result.ok, true, Gateway.formatIssues(result));
    assert.equal(result.value.graph.nodes[0].retention, 1);
    assert.equal(result.value.nodeConfigs[0].radius, 60);
    assert.equal(result.value.graph.edges[0].decay, 0);
});

test("treats numeric edge slot 8 as legacy rotation, not a functional form", () => {
    const legacy = [[
        [1, 0, 0, 0.4, "A", 0, 0, 0, "-Infinity", "Infinity"],
        [2, 100, 0, 0.4, "B", 1, 0, 0, "-Infinity", "Infinity"],
    ], [
        [1, 2, 100, 0.8, 0.25, 2, null, null, 0],
        [2, 1, -100, -0.8, 0, 0, null, null, "45"],
    ], [], 2];

    const result = Gateway.parse(JSON.stringify(legacy));
    assert.equal(result.ok, true, Gateway.formatIssues(result));
    assert.deepEqual(
        result.value.graph.edges.map((edge) => edge.functional_form),
        ["linear", "linear"],
    );
    assert.deepEqual(
        result.value.edgeConfigs.map((edge) => edge.rotation),
        [0, 45],
    );
});

test("rejects malformed endpoints and non-finite numeric fields", () => {
    const document = nativeDocument();
    document[0][0][3] = "not-a-number";
    document[1][0][1] = 999;
    const result = Gateway.parse(JSON.stringify(document));
    assert.equal(result.ok, false);
    const codes = new Set(result.issues.map((issue) => issue.code));
    assert.ok(codes.has("finite_number"));
    assert.ok(codes.has("missing_node_id"));
});

test("does not coerce empty required IDs to node zero", () => {
    const document = nativeDocument();
    document[0][0][0] = null;
    const result = Gateway.parse(JSON.stringify(document));
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.path === "nodes[0][0]"));
});

test("the Model validates a complete candidate before clearing the Canvas", () => {
    const modelSource = fs.readFileSync(
        path.resolve(__dirname, "../Core/Model.js"),
        "utf8",
    );
    const start = modelSource.indexOf("self.deserialize = function(dataString)");
    const end = modelSource.indexOf("self.clear = function()", start);
    const body = modelSource.slice(start, end);
    assert.ok(body.indexOf("LoopyImportGateway.parse") >= 0);
    assert.ok(body.indexOf("LoopyImportGateway.parse") < body.indexOf("self.clear();"));
    assert.ok(body.includes("self.restoreState(previousState)"));
});
