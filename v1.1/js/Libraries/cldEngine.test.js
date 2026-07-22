"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const CLDEngine = require("./cldEngine.js");

function linearGraph() {
    return {
        nodes: {
            A: { startAmount: 1, retention: 0.5 },
            B: { startAmount: 2, retention: 0.25 },
        },
        edges: [
            { from: "A", to: "B", correlation: 0.8, decay: 0.5, delay: 0 },
            { from: "B", to: "A", correlation: -0.2, decay: 0, delay: 0 },
        ],
    };
}

test("stateful Canvas steps equal the batch notebook-style simulation", () => {
    const engine = new CLDEngine();
    engine.initializeGraph(linearGraph());

    const batch = engine.simulateTwoPhase({ steps: 2 });
    const state = engine.createSimulationState();
    engine.stepTwoPhase(state);
    engine.stepTwoPhase(state);

    assert.deepEqual(state.history, batch.history);
    assert.ok(Math.abs(batch.history.A[1] - 0.1) < 1e-12);
    assert.ok(Math.abs(batch.history.A[2] + 0.13) < 1e-12);
    assert.ok(Math.abs(batch.history.B[1] - 0.9) < 1e-12);
    assert.ok(Math.abs(batch.history.B[2] - 0.265) < 1e-12);
});

test("stateful steps preserve delay history and accept a live node adjustment", () => {
    const engine = new CLDEngine();
    engine.initializeGraph({
        nodes: {
            Driver: { startAmount: 1, retention: 1 },
            Result: { startAmount: 0, retention: 0.5 },
        },
        edges: [
            { from: "Driver", to: "Result", correlation: 1, decay: 0, delay: 1 },
        ],
    });

    const state = engine.createSimulationState();
    engine.stepTwoPhase(state);
    assert.deepEqual(state.history.Result, [0, 0]);

    state.history.Driver[state.step] = 2;
    engine.stepTwoPhase(state);
    engine.stepTwoPhase(state);

    assert.deepEqual(state.history.Driver, [1, 2, 2, 2]);
    assert.deepEqual(state.history.Result, [0, 0, 1, 2.5]);
});

test("confidence does not randomize the deterministic mean path", () => {
    const graph = linearGraph();
    graph.edges.forEach((edge) => { edge.confidence = 0; });
    const engine = new CLDEngine();
    engine.initializeGraph(graph);

    const first = engine.simulateTwoPhase({ steps: 20 }).history;
    const second = engine.simulateTwoPhase({ steps: 20 }).history;

    assert.deepEqual(second, first);
});

test("runtime and uniform-sweep matrices keep their distinct semantics", () => {
    const engine = new CLDEngine();
    engine.initializeGraph({
        nodes: {
            A: { startAmount: 1, retention: 0.6 },
            B: { startAmount: 1, retention: 0.4 },
        },
        edges: [
            { from: "A", to: "B", correlation: 0.7, decay: 0.2, delay: 0 },
        ],
    });

    const runtime = engine.computeRuntimeLinearTransitionMatrix().matrix;
    const sweep = engine.computeUniformSweepTransitionMatrix(0.2).matrix;

    assert.ok(Math.abs(runtime[0][0] - 0.6) < 1e-12);
    assert.ok(Math.abs(runtime[1][0] - 0.56) < 1e-12);
    assert.ok(Math.abs(sweep[0][0] - 0.8) < 1e-12);
    assert.ok(Math.abs(sweep[1][0] - 0.14) < 1e-12);
});

test("browser engine matches every simulation-contract fixture timestep", async (t) => {
    const fixtureDir = path.join(
        __dirname, "../../../backend/tests/simulation_contract/v1"
    );
    const fixtureNames = fs.readdirSync(fixtureDir).filter(name => name.endsWith(".json")).sort();
    assert.equal(fixtureNames.length, 5);

    for (const fixtureName of fixtureNames) {
        await t.test(fixtureName, () => {
            const payload = JSON.parse(fs.readFileSync(path.join(fixtureDir, fixtureName), "utf8"));
            const graph = {
                nodes: Object.fromEntries(payload.nodes.map(node => [node.name, node])),
                edges: payload.edges,
            };
            const engine = new CLDEngine();
            engine.initializeGraph(graph);
            const actual = engine.simulateTwoPhase({ steps: payload.steps }).history;
            for (const [node, expected] of Object.entries(payload.expected_history)) {
                assert.equal(actual[node].length, expected.length);
                actual[node].forEach((value, index) => {
                    assert.ok(
                        Math.abs(value - expected[index]) <= 1e-12,
                        `${fixtureName} ${node}[${index}]: ${value} != ${expected[index]}`
                    );
                });
            }
        });
    }
});

test("browser Monte Carlo injects process noise without changing deterministic runs", () => {
    const engine = new CLDEngine();
    engine.initializeGraph({
        nodes: { A: { startAmount: 1, retention: 1 } },
        edges: [],
    });
    const deterministic = engine.simulateTwoPhase({ steps: 3 }).history.A;
    const fan = engine.simulateFanPaths({ runs: 3, steps: 3, sigmaBase: 0.25 });

    assert.deepEqual(deterministic, [1, 1, 1, 1]);
    assert.equal(fan.fanPaths.length, 3);
    assert.ok(fan.fanPaths.some(pathData =>
        pathData.A.some((value, index) => Math.abs(value - deterministic[index]) > 1e-12)
    ));
});

test("browser engine rejects non-finite overflow", () => {
    const engine = new CLDEngine();
    engine.initializeGraph({
        nodes: {
            A: { startAmount: 1e200, retention: 1 },
            B: { startAmount: 0, retention: 1 },
        },
        edges: [
            { from: "A", to: "B", correlation: 1, decay: 0, delay: 0, functionalForm: "cubic" },
        ],
    });
    assert.throws(() => engine.simulateTwoPhase({ steps: 1 }), /overflowed/);
});

test("unlimited bound sentinels bypass finite formula evaluation", () => {
    const engine = new CLDEngine();

    assert.equal(engine.evaluateBound("Infinity", -1), Infinity);
    assert.equal(engine.evaluateBound("+inf", -1), Infinity);
    assert.equal(engine.evaluateBound("-Infinity", 1), -Infinity);
    assert.equal(engine.evaluateBound("-inf", 1), -Infinity);
    assert.equal(engine.evaluateBound("2 + 3", 0), 5);
});
