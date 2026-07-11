/*
 * Restricted browser evaluator for notebook-style FlowCLD expressions.
 *
 * Formula text comes from models, including imported files.  Keep it inside
 * mathjs with a small context instead of evaluating it as JavaScript.
 */
(function () {
    "use strict";

    var BLOCKED_WORDS = /\b(?:import|createUnit|evaluate|parse|simplify|derivative|resolve|help|typed|factory|constructor|prototype|__proto__|globalThis|window|document|Function|eval|new|function|class|while|for)\b/i;
    var ASSIGNMENT = /(^|[^<>=!])=(?!=)/;

    var safeMath = Object.freeze({
        abs: Math.abs,
        ceil: Math.ceil,
        cos: Math.cos,
        exp: Math.exp,
        floor: Math.floor,
        log: Math.log,
        log10: Math.log10 || function (x) { return Math.log(x) / Math.LN10; },
        max: Math.max,
        min: Math.min,
        pow: Math.pow,
        round: Math.round,
        sin: Math.sin,
        sqrt: Math.sqrt,
        tan: Math.tan,
        tanh: Math.tanh || function (x) {
            var positive = Math.exp(x);
            var negative = Math.exp(-x);
            return (positive - negative) / (positive + negative);
        },
        e: Math.E,
        pi: Math.PI,
        tau: Math.PI * 2
    });

    var safeNp = Object.freeze({
        abs: Math.abs,
        ceil: Math.ceil,
        clip: function (value, low, high) { return Math.max(low, Math.min(high, value)); },
        cos: Math.cos,
        exp: Math.exp,
        floor: Math.floor,
        log: Math.log,
        log10: safeMath.log10,
        maximum: Math.max,
        minimum: Math.min,
        power: Math.pow,
        sin: Math.sin,
        sqrt: Math.sqrt,
        tan: Math.tan,
        tanh: safeMath.tanh
    });

    function copyMap(value) {
        // mathjs expects a normal object scope. Filter prototype keys rather
        // than using a null-prototype object, which mathjs cannot inspect.
        var result = {};
        if (!value || typeof value !== "object") return result;
        Object.keys(value).forEach(function (key) {
            if (key !== "__proto__" && key !== "prototype" && key !== "constructor") {
                result[key] = value[key];
            }
        });
        return result;
    }

    function validate(expression) {
        if (typeof expression !== "string" || expression.trim() === "") {
            throw new Error("Formula is empty");
        }
        if (expression.length > 4000) {
            throw new Error("Formula is too long");
        }
        if (/[;{}\\`]/.test(expression) || ASSIGNMENT.test(expression) || BLOCKED_WORDS.test(expression)) {
            throw new Error("Formula contains unsupported syntax");
        }
    }

    function scopeFor(context) {
        context = context || {};
        var scope = {};
        scope.t = context.t === undefined ? 0 : context.t;
        scope.x = context.x === undefined ? 0 : context.x;
        scope.val = context.val === undefined ? scope.x : context.val;
        scope.Y0 = context.Y0 === undefined ? 0 : context.Y0;
        scope.e = context.e === undefined ? Math.E : context.e;
        scope.raw = copyMap(context.raw);
        scope.nxt = copyMap(context.nxt);
        scope.inputs = copyMap(context.inputs);
        scope.history = copyMap(context.history);
        scope.math = safeMath;
        scope.np = safeNp;
        return scope;
    }

    function evaluate(expression, context) {
        validate(expression);
        if (typeof math === "undefined" || typeof math.evaluate !== "function") {
            throw new Error("Formula evaluator is unavailable");
        }
        var result = math.evaluate(expression, scopeFor(context));
        if (typeof result !== "number" || !isFinite(result)) {
            throw new Error("Formula must return a finite number");
        }
        return result;
    }

    window.FormulaEvaluator = Object.freeze({ evaluate: evaluate });
})();
