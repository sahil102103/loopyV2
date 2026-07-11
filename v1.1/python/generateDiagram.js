/**********************************************************************
 Diagram Generator

 Turns a natural-language description into a causal loop diagram built
 directly on the canvas. Supports multiple LLM providers (OpenAI,
 Anthropic, Google) — the user picks a model and supplies that provider's
 API key. The model returns STRUCTURED JSON (not a hand-encoded URL); we
 validate it and construct the model deterministically via the model API,
 so a malformed/edge-case response can't corrupt the app.
 **********************************************************************/

(function () {
    "use strict";

    // ---- provider + model catalog ---------------------------------------
    // Curated, current "most capable" + economical options per provider
    // (verified June 2026). Each entry: provider, model id, display label.
    var MODELS = [
        { provider: "anthropic", id: "claude-opus-4-8",   label: "Claude Opus 4.8 — most capable" },
        { provider: "anthropic", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — balanced" },
        { provider: "anthropic", id: "claude-haiku-4-5",  label: "Claude Haiku 4.5 — fast & economical" },
        { provider: "openai",    id: "gpt-5.5",           label: "GPT-5.5 — most capable" },
        { provider: "openai",    id: "gpt-4o",            label: "GPT-4o — strong & balanced" },
        { provider: "openai",    id: "gpt-4o-mini",       label: "GPT-4o mini — fast & economical" },
        { provider: "google",    id: "gemini-3.5-flash",  label: "Gemini 3.5 Flash — most capable" }
    ];

    var PROVIDERS = {
        openai:    { name: "OpenAI",    keyLabel: "OpenAI API Key",    keyPlaceholder: "sk-…",      store: "flowcld_key_openai" },
        anthropic: { name: "Anthropic", keyLabel: "Anthropic API Key", keyPlaceholder: "sk-ant-…",  store: "flowcld_key_anthropic" },
        google:    { name: "Google AI", keyLabel: "Google AI API Key", keyPlaceholder: "AIza…",     store: "flowcld_key_google" }
    };

    var MODEL_STORAGE = "flowcld_diagram_model";
    var DEFAULT_MODEL = "claude-opus-4-8";

    // Diagram-provider keys were previously retained across browser sessions.
    // Clear those legacy values immediately; new keys live only in sessionStorage.
    Object.keys(PROVIDERS).forEach(function (provider) {
        try { localStorage.removeItem(PROVIDERS[provider].store); } catch (e) { /* Storage is optional. */ }
    });

    function rememberKey(storageKey, apiKey) {
        try {
            // Keys used to be persisted in localStorage. Remove any legacy copy
            // and retain the current key only for this browser tab.
            localStorage.removeItem(storageKey);
            sessionStorage.setItem(storageKey, apiKey);
        } catch (e) { /* Browser storage is optional. */ }
    }

    function sessionKey(storageKey) {
        try { return sessionStorage.getItem(storageKey) || ""; } catch (e) { return ""; }
    }

    function providerOf(modelId) {
        for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === modelId) return MODELS[i].provider;
        return "openai";
    }

    // ---- small helpers ---------------------------------------------------

    function $(id) { return document.getElementById(id); }

    function setStatus(msg, kind) {
        var el = $("genStatus");
        if (!el) return;
        el.className = "gen-status" + (kind ? " " + kind : "");
        el.textContent = msg;
    }

    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

    function toNumber(v, fallback) {
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    // Strip ```json fences / stray prose and parse the first JSON object.
    function parseModelJSON(text) {
        if (typeof text !== "string" || !text.trim()) throw new Error("The model returned an empty response.");
        var s = text.trim();
        s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        try {
            return JSON.parse(s);
        } catch (e) {
            var start = s.indexOf("{");
            var end = s.lastIndexOf("}");
            if (start !== -1 && end > start) {
                return JSON.parse(s.substring(start, end + 1));
            }
            throw new Error("Could not parse the model's response as JSON.");
        }
    }

    // ---- prompt ----------------------------------------------------------

    var SYSTEM_PROMPT = [
        "You convert a natural-language description of a system into a causal loop diagram.",
        "Return ONLY a JSON object (no prose, no markdown) with this exact shape:",
        "{",
        '  "nodes": [{"id": 1, "label": "Short Name", "init": 0.5, "hue": 0}],',
        '  "edges": [{"from": 1, "to": 2, "strength": 1}]',
        "}",
        "Rules:",
        "- nodes: 2 to 12 concise variables drawn from the description. id = unique integer. label = short (1-3 words). init = a number from 0 to 1 (use 0.5 if unsure). hue = integer 0-19 for color variety.",
        "- edges: causal links between nodes. from/to reference node ids. strength = +1 when the source INCREASES the target and -1 when it DECREASES it; use decimals between -1 and 1 for weaker effects.",
        "- Infer reasonable relationships from common knowledge when they are not explicit. Prefer a connected graph and include feedback loops where they make sense.",
        "- Output strictly valid JSON only."
    ].join("\n");

    // ---- provider calls --------------------------------------------------

    async function readError(response, providerName) {
        var msg = "";
        try {
            var e = await response.json();
            msg = (e.error && (e.error.message || e.error.status)) ||
                  (e.error ? JSON.stringify(e.error) : "");
        } catch (err) { /* ignore */ }
        if (response.status === 401 || response.status === 403) return "Invalid or unauthorized " + providerName + " API key.";
        if (response.status === 429) return providerName + " rate limit or quota exceeded — try again shortly.";
        return msg || (providerName + " request failed (HTTP " + response.status + ").");
    }

    // Returns the raw text content from the model (expected to be JSON).
    async function callLLM(modelId, apiKey, systemPrompt, userPrompt) {
        var provider = providerOf(modelId);

        if (provider === "openai") {
            var r = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
                body: JSON.stringify({
                    model: modelId,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt }
                    ],
                    response_format: { type: "json_object" },
                    max_completion_tokens: 4096
                })
            });
            if (!r.ok) throw new Error(await readError(r, "OpenAI"));
            var d = await r.json();
            return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
        }

        if (provider === "anthropic") {
            var ra = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    // Required for direct browser (CORS) calls to the Anthropic API.
                    "anthropic-dangerous-direct-browser-access": "true"
                },
                body: JSON.stringify({
                    model: modelId,
                    max_tokens: 2048,
                    system: systemPrompt,
                    messages: [{ role: "user", content: userPrompt }]
                })
            });
            if (!ra.ok) throw new Error(await readError(ra, "Anthropic"));
            var da = await ra.json();
            var blocks = da.content || [];
            for (var i = 0; i < blocks.length; i++) {
                if (blocks[i].type === "text") return blocks[i].text || "";
            }
            return "";
        }

        if (provider === "google") {
            var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
                encodeURIComponent(modelId) + ":generateContent?key=" + encodeURIComponent(apiKey);
            var rg = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });
            if (!rg.ok) throw new Error(await readError(rg, "Google AI"));
            var dg = await rg.json();
            var parts = (dg.candidates && dg.candidates[0] && dg.candidates[0].content && dg.candidates[0].content.parts) || [];
            return parts.map(function (p) { return p.text || ""; }).join("");
        }

        throw new Error("Unknown provider for model: " + modelId);
    }

    // ---- validation ------------------------------------------------------

    function validateGraph(raw) {
        if (!raw || typeof raw !== "object") throw new Error("Response was not an object.");
        var rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
        var rawEdges = Array.isArray(raw.edges) ? raw.edges : [];

        if (rawNodes.length === 0) throw new Error("The model returned no nodes.");

        var nodes = [];
        var idSet = {};
        rawNodes.forEach(function (n, i) {
            if (!n || typeof n !== "object") return;
            var id = (n.id !== undefined && n.id !== null) ? String(n.id) : ("auto_" + i);
            if (idSet[id]) id = id + "_" + i;
            idSet[id] = true;
            var label = (n.label === undefined || n.label === null || String(n.label).trim() === "")
                ? ("Node " + (i + 1)) : String(n.label).trim();
            nodes.push({
                _id: id,
                label: label.slice(0, 40),
                init: clamp(toNumber(n.init, 0.5), 0, 1),
                hue: Math.round(clamp(toNumber(n.hue, i * 3), 0, 19))
            });
        });

        if (nodes.length === 0) throw new Error("No valid nodes in the response.");

        var validIds = {};
        nodes.forEach(function (n) { validIds[n._id] = true; });

        var edges = [];
        rawEdges.forEach(function (e) {
            if (!e || typeof e !== "object") return;
            var from = String(e.from);
            var to = String(e.to);
            if (!validIds[from] || !validIds[to]) return;   // drop dangling edges
            edges.push({
                from: from,
                to: to,
                strength: clamp(toNumber(e.strength, 1), -1, 1)
            });
        });

        return { nodes: nodes, edges: edges };
    }

    // ---- build the diagram on the canvas --------------------------------

    function buildDiagram(graph, replace) {
        var model = window.loopy && window.loopy.model;
        if (!model) throw new Error("App is not ready yet — try again in a moment.");

        if (replace) model.clear();

        var n = graph.nodes.length;
        var radius = Math.max(180, n * 55);
        var idMap = {};

        graph.nodes.forEach(function (nd, i) {
            var x = 0, y = 0;
            if (n > 1) {
                var ang = (i / n) * 2 * Math.PI - Math.PI / 2;
                x = Math.round(Math.cos(ang) * radius);
                y = Math.round(Math.sin(ang) * radius);
            }
            var node = model.addNode({ x: x, y: y, label: nd.label, init: nd.init, hue: nd.hue });
            idMap[nd._id] = node;
        });

        var edgeCount = 0;
        graph.edges.forEach(function (e) {
            var from = idMap[e.from], to = idMap[e.to];
            if (!from || !to) return;
            model.addEdge({ from: from.id, to: to.id, strength: e.strength });
            edgeCount++;
        });

        // Show the canvas first, then fit the view after layout settles.
        if (typeof openPage === "function") openPage("Canvas");
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                fitView(radius);
                model.dirty();
            });
        });

        return { nodes: graph.nodes.length, edges: edgeCount };
    }

    // Center the (origin-centered) circle layout in the visible canvas and
    // scale to fit. Node coords/offsets live in the canvas BUFFER space (a 2x
    // retina buffer), so we measure with canvas.width/height and reserve chrome
    // in buffer pixels. Offsets are set directly (model.center() can leave them
    // unset depending on timing).
    function fitView(radius) {
        var loopy = window.loopy;
        if (!loopy || !loopy.model) return;
        var canvas = loopy.model.canvas;
        var canvasses = document.getElementById("canvasses");

        var BW = (canvas && canvas.width)  || ((canvasses && canvasses.clientWidth)  || 800) * 2;
        var BH = (canvas && canvas.height) || ((canvasses && canvasses.clientHeight) || 600) * 2;

        var topReserve = 110, bottomReserve = 240, leftReserve = 120, rightReserve = 60;
        var half = radius + 90;

        var fitW = Math.max(240, BW - leftReserve - rightReserve);
        var fitH = Math.max(240, BH - topReserve - bottomReserve);
        var scale = Math.min(1, Math.min(fitW, fitH) / (half * 2));

        var cx = leftReserve + (BW - leftReserve - rightReserve) / 2;
        var cy = topReserve + (BH - topReserve - bottomReserve) / 2;

        loopy.offsetScale = scale;
        loopy.offsetX = cx;
        loopy.offsetY = cy;
        loopy.model.scale = scale;
        loopy.model.offsetX = cx;
        loopy.model.offsetY = cy;
        if (typeof loopy.model.syncZoomState === "function") loopy.model.syncZoomState();
    }

    // ---- main action -----------------------------------------------------

    async function generate() {
        var modelId = ($("genModel") && $("genModel").value) || DEFAULT_MODEL;
        var provider = providerOf(modelId);
        var providerInfo = PROVIDERS[provider];
        var description = ($("description").value || "").trim();
        var apiKey = ($("apiKeyDiagramGenerator").value || "").trim();
        var replace = $("genReplace") ? $("genReplace").checked : true;

        if (!description) { setStatus("Please enter a description.", "warn"); return; }
        if (!apiKey) { setStatus("Please enter your " + providerInfo.name + " API key.", "warn"); return; }

        // Remember the model choice and the per-provider key for this session only.
        try {
            localStorage.setItem(MODEL_STORAGE, modelId);
            rememberKey(providerInfo.store, apiKey);
        } catch (e) { /* ignore */ }

        var btn = $("generateDiagramButton");
        if (btn) btn.disabled = true;
        setStatus('Generating with ' + providerInfo.name + '…', "loading");

        try {
            var content = await callLLM(modelId, apiKey, SYSTEM_PROMPT, description);
            var raw = parseModelJSON(content);
            var graph = validateGraph(raw);
            var result = buildDiagram(graph, replace);

            setStatus("✓ Created " + result.nodes + " node" + (result.nodes === 1 ? "" : "s") +
                " and " + result.edges + " connection" + (result.edges === 1 ? "" : "s") +
                ". Switched to the Canvas.", "ok");
        } catch (error) {
            console.error("Generate Diagram error:", error);
            setStatus("Error: " + (error.message || error), "error");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ---- wire up UI ------------------------------------------------------

    // Reflect the selected model's provider in the API key field, and load that
    // provider's saved key.
    function onModelChange() {
        var modelId = ($("genModel") && $("genModel").value) || DEFAULT_MODEL;
        var info = PROVIDERS[providerOf(modelId)];
        var label = $("genKeyLabel"), input = $("apiKeyDiagramGenerator");
        if (label) label.textContent = info.keyLabel;
        if (input) {
            input.placeholder = info.keyPlaceholder;
            var saved = "";
            saved = sessionKey(info.store);
            input.value = saved;
        }
    }

    function buildModelOptions() {
        var sel = $("genModel");
        if (!sel) return;
        sel.innerHTML = "";
        var groups = {};
        MODELS.forEach(function (m) {
            var provName = PROVIDERS[m.provider].name;
            if (!groups[provName]) {
                var og = document.createElement("optgroup");
                og.label = provName;
                sel.appendChild(og);
                groups[provName] = og;
            }
            var opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent = m.label;
            groups[provName].appendChild(opt);
        });
    }

    function init() {
        var btn = $("generateDiagramButton");
        if (!btn) return;            // tab not present
        buildModelOptions();

        // Restore saved model choice
        try {
            var savedModel = localStorage.getItem(MODEL_STORAGE);
            if (savedModel && providerOf(savedModel) && $("genModel")) {
                // only if it's a known model
                for (var i = 0; i < MODELS.length; i++) {
                    if (MODELS[i].id === savedModel) { $("genModel").value = savedModel; break; }
                }
            } else if ($("genModel")) {
                $("genModel").value = DEFAULT_MODEL;
            }
        } catch (e) {}

        onModelChange();   // sync key field to the selected provider
        if ($("genModel")) $("genModel").addEventListener("change", onModelChange);

        btn.addEventListener("click", generate);

        // Example chips fill the description box
        var chips = document.querySelectorAll(".gen-chip");
        for (var j = 0; j < chips.length; j++) {
            chips[j].addEventListener("click", function () {
                $("description").value = this.getAttribute("data-prompt") || this.textContent;
                $("description").focus();
            });
        }

        // Cmd/Ctrl+Enter to generate from the textarea
        var ta = $("description");
        if (ta) {
            ta.addEventListener("keydown", function (e) {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
