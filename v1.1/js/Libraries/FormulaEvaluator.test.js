"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const FormulaEvaluator = require("./FormulaEvaluator.js");


test("browser evaluator accepts the canonical notebook expression dialect", () => {
    const context = {
        t: 1,
        x: 0,
        Y0: 3,
        nxt: { "Policy (Rate)": 4 },
        raw: { A: 1 },
    };
    const cases = [
        ["2 ** 3", 8],
        ["1 if t > 0 else 0", 1],
        ["10 + (1 if t > 0 else 0)", 11],
        ["nxt['Policy (Rate)'] if t >= 0 else Y0", 4],
        ["nxt['Demand for class=Goods']", 7],
        ["x == 0 or 10 / x > 1", 1],
        ["not (x > 0)", 1],
        ["Math.E", Math.E],
        ["math.pi", Math.PI],
    ];
    for (const [expression, expected] of cases) {
        context.nxt["Demand for class=Goods"] = 7;
        assert.ok(
            Math.abs(FormulaEvaluator.evaluate(expression, context) - expected) < 1e-12,
            expression
        );
    }
});


test("browser evaluator rejects executable and non-finite expressions", () => {
    assert.throws(
        () => FormulaEvaluator.evaluate("globalThis.alert(1)"),
        /unsupported syntax/
    );
    assert.throws(
        () => FormulaEvaluator.evaluate("math.exp(10000)"),
        /finite number/
    );
});
