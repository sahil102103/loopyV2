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
        tau: Math.PI * 2,
        E: Math.E,
        PI: Math.PI
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

    function outsideQuotedText(expression) {
        var output = "";
        var quote = null;
        var escaped = false;
        for (var index = 0; index < expression.length; index++) {
            var char = expression[index];
            if (quote) {
                output += " ";
                if (escaped) escaped = false;
                else if (char === "\\") escaped = true;
                else if (char === quote) quote = null;
            } else if (char === "'" || char === '"') {
                quote = char;
                output += " ";
            } else {
                output += char;
            }
        }
        return output;
    }

    function validate(expression) {
        if (typeof expression !== "string" || expression.trim() === "") {
            throw new Error("Formula is empty");
        }
        if (expression.length > 4000) {
            throw new Error("Formula is too long");
        }
        var executableText = outsideQuotedText(expression);
        if (/[;{}\\`]/.test(executableText) || ASSIGNMENT.test(executableText) || BLOCKED_WORDS.test(executableText)) {
            throw new Error("Formula contains unsupported syntax");
        }
    }

    function rewritePythonTokens(expression) {
        var output = "";
        var quote = null;
        var escaped = false;
        for (var index = 0; index < expression.length; index++) {
            var char = expression[index];
            if (quote) {
                output += char;
                if (escaped) escaped = false;
                else if (char === "\\") escaped = true;
                else if (char === quote) quote = null;
                continue;
            }
            if (char === "'" || char === '"') {
                quote = char;
                output += char;
                continue;
            }
            if (char === "*" && expression[index + 1] === "*") {
                output += "^";
                index++;
                continue;
            }
            var identifier = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
            if (identifier) {
                var token = identifier[0];
                output += token === "True" ? "true" : (token === "False" ? "false" : token);
                index += token.length - 1;
                continue;
            }
            output += char;
        }
        return output;
    }

    function matchingParen(expression, start) {
        var depth = 0;
        var quote = null;
        var escaped = false;
        for (var index = start; index < expression.length; index++) {
            var char = expression[index];
            if (quote) {
                if (escaped) escaped = false;
                else if (char === "\\") escaped = true;
                else if (char === quote) quote = null;
                continue;
            }
            if (char === "'" || char === '"') quote = char;
            else if (char === "(") depth++;
            else if (char === ")" && --depth === 0) return index;
        }
        return -1;
    }

    function conditionalKeywords(expression) {
        var depth = 0;
        var quote = null;
        var escaped = false;
        var ifPosition = -1;
        for (var index = 0; index < expression.length;) {
            var char = expression[index];
            if (quote) {
                if (escaped) escaped = false;
                else if (char === "\\") escaped = true;
                else if (char === quote) quote = null;
                index++;
                continue;
            }
            if (char === "'" || char === '"') {
                quote = char;
                index++;
                continue;
            }
            if (char === "(" || char === "[" || char === "{") depth++;
            else if (char === ")" || char === "]" || char === "}") depth--;
            if (depth === 0 && /[A-Za-z_]/.test(char)) {
                var match = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
                var token = match[0];
                if (token === "if" && ifPosition < 0) ifPosition = index;
                else if (token === "else" && ifPosition >= 0) {
                    return { ifPosition: ifPosition, elsePosition: index };
                }
                index += token.length;
                continue;
            }
            index++;
        }
        return null;
    }

    function translateConditional(expression) {
        var rebuilt = "";
        var quote = null;
        var escaped = false;
        for (var index = 0; index < expression.length; index++) {
            var char = expression[index];
            if (quote) {
                rebuilt += char;
                if (escaped) escaped = false;
                else if (char === "\\") escaped = true;
                else if (char === quote) quote = null;
                continue;
            }
            if (char === "'" || char === '"') {
                quote = char;
                rebuilt += char;
                continue;
            }
            if (expression[index] !== "(") {
                rebuilt += char;
                continue;
            }
            var end = matchingParen(expression, index);
            if (end < 0) {
                rebuilt += expression.slice(index);
                break;
            }
            rebuilt += "(" + translateConditional(expression.slice(index + 1, end)) + ")";
            index = end;
        }
        var keywords = conditionalKeywords(rebuilt);
        if (!keywords) return rebuilt;
        var whenTrue = rebuilt.slice(0, keywords.ifPosition).trim();
        var condition = rebuilt.slice(keywords.ifPosition + 2, keywords.elsePosition).trim();
        var whenFalse = rebuilt.slice(keywords.elsePosition + 4).trim();
        if (!whenTrue || !condition || !whenFalse) return rebuilt;
        return "((" + translateConditional(condition) + ") ? (" +
            translateConditional(whenTrue) + ") : (" +
            translateConditional(whenFalse) + "))";
    }

    function normalizeExpression(expression) {
        return translateConditional(rewritePythonTokens(expression));
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
        scope.Math = safeMath; // legacy browser-authored formulas
        scope.np = safeNp;
        return scope;
    }

    function evaluate(expression, context) {
        validate(expression);
        var normalized = normalizeExpression(expression);
        var mathLibrary = typeof math !== "undefined" ? math : null;
        if (!mathLibrary && typeof require === "function") {
            mathLibrary = require("./math.js");
        }
        if (!mathLibrary || typeof mathLibrary.evaluate !== "function") {
            throw new Error("Formula evaluator is unavailable");
        }
        var result = mathLibrary.evaluate(normalized, scopeFor(context));
        if (typeof result === "boolean") result = result ? 1 : 0;
        if (typeof result !== "number" || !isFinite(result)) {
            throw new Error("Formula must return a finite number");
        }
        return result;
    }

    var evaluator = Object.freeze({ evaluate: evaluate });
    if (typeof module !== "undefined" && module.exports) {
        module.exports = evaluator;
    } else if (typeof window !== "undefined") {
        window.FormulaEvaluator = evaluator;
    }
})();
