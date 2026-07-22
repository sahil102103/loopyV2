"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const TeamRolePresets = require("./TeamRolePresets.js");

test("exposes the handoff role set with cooperative and adversarial orientations", () => {
    const presets = Object.fromEntries(TeamRolePresets.list().map((preset) => [preset.key, preset]));

    assert.deepEqual(Object.keys(presets), ["custom", "green", "blue", "red", "black"]);
    assert.equal(presets.green.settings.orientation, "stabilize");
    assert.equal(presets.blue.settings.orientation, "stabilize");
    assert.equal(presets.red.settings.orientation, "disrupt");
    assert.equal(presets.black.settings.orientation, "disrupt");
    assert.equal(presets.red.settings.objectiveBehavior, "Optimal");
    assert.equal(presets.black.settings.objectiveBehavior, "Optimal");
});

test("keeps the black disruptor bounded more tightly than red competition", () => {
    const red = TeamRolePresets.get("red").settings;
    const black = TeamRolePresets.get("black").settings;

    assert.ok(black.parameterCost > red.parameterCost);
    assert.ok(black.structuralCost > red.structuralCost);
    assert.ok(black.moveBudget < red.moveBudget);
    assert.ok(black.structuralBudget < red.structuralBudget);
    assert.ok(black.minimumLiveRatio >= 0.5);
});

test("gives cooperative presets enough budget for one atomic mediator motif", () => {
    const green = TeamRolePresets.get("green").settings;
    const blue = TeamRolePresets.get("blue").settings;

    assert.ok(green.structuralBudget >= 3);
    assert.ok(blue.structuralBudget >= 4);
    assert.ok(green.structuralActions.includes("add_node"));
    assert.ok(green.structuralActions.includes("add_edge"));
    assert.ok(blue.structuralActions.includes("remove_edge"));
});

test("toggles an active role off without mutating the preset catalog", () => {
    assert.equal(TeamRolePresets.toggle("green", "green"), "custom");
    assert.equal(TeamRolePresets.toggle("green", "blue"), "blue");

    const editable = TeamRolePresets.get("blue");
    editable.settings.nodeParameters.length = 0;
    assert.ok(TeamRolePresets.get("blue").settings.nodeParameters.length > 0);
});

test("derives a role-safe live-node floor from the current shared graph", () => {
    assert.equal(TeamRolePresets.minimumLiveNodes("green", 10), 8);
    assert.equal(TeamRolePresets.minimumLiveNodes("black", 10), 5);
    assert.equal(TeamRolePresets.minimumLiveNodes("black", 2), 1);
    assert.equal(TeamRolePresets.minimumLiveNodes("custom", 10), 1);
});
