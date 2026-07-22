/**********************************

TABLES VIEW

An alternate, spreadsheet-style editing surface for the model. It reads from and
writes to the SAME model that the Canvas uses (window.loopy.model) — there is no
separate table state. Candidate edits pass through GraphModelGateway before the
live Node/Edge objects are mutated, then publish "model/changed", exactly like
the Sidebar does, so the Canvas, autosave and undo all stay in sync.

Rendering strategy (avoids stealing focus while typing):
  • render() rebuilds the row bodies from the model. It is called when the Tables
    tab is opened (see openPage in Outputs.js) and after structural add/delete.
  • Inline scalar edits mutate the model and publish "model/changed" WITHOUT a
    re-render, so the input you are typing in keeps focus.
  • A "model/changed" subscriber re-renders live ONLY when the Tables tab is
    visible and focus is outside the table (e.g. an external change) — so canvas
    edits are reflected, but your own keystrokes are not clobbered.

**********************************/

(function () {
	"use strict";

	function model() {
		return window.loopy && window.loopy.model;
	}

	function _tablesVisible() {
		var el = document.getElementById("Tables");
		return el && el.style.display !== "none";
	}

	function _toast(msg, type) {
		if (typeof window.showToast === "function") window.showToast(msg, type || "error", true);
	}

	function _validationMessage(result, fallback) {
		if (typeof GraphModelGateway !== "undefined" && result && result.issues) {
			var detail = GraphModelGateway.formatIssues(result);
			if (detail) return detail;
		}
		return fallback || "The edit is not valid";
	}

	function _updateNode(node, patch) {
		if (typeof GraphModelGateway === "undefined") {
			_toast("The graph validation layer is unavailable. Reload the app and try again.");
			return false;
		}
		var result = GraphModelGateway.updateLiveNode(model(), node, patch);
		if (!result.ok) {
			_toast(_validationMessage(result, "Node edit is not valid"));
			return false;
		}
		return true;
	}

	function _updateEdge(edge, patch) {
		if (typeof GraphModelGateway === "undefined") {
			_toast("The graph validation layer is unavailable. Reload the app and try again.");
			return false;
		}
		var result = GraphModelGateway.updateLiveEdge(model(), edge, patch);
		if (!result.ok) {
			_toast(_validationMessage(result, "Edge edit is not valid"));
			return false;
		}
		return true;
	}

	// Mutation happened via the table: mark the model changed (canvas redraw +
	// debounced autosave are wired to this event elsewhere).
	function _commit() {
		publish("model/changed");
	}

	function _nodeLabel(n) {
		var l = (n && n.label !== undefined && n.label !== null) ? String(n.label) : "";
		return l.trim() === "" ? "(unnamed)" : l;
	}

	function _nextNodeLabel(m) {
		var base = "New node";
		if (m.isNodeLabelAvailable(base)) return base;
		for (var i = 2; i < 10000; i++) {
			var candidate = base + " " + i;
			if (m.isNodeLabelAvailable(candidate)) return candidate;
		}
		return base + " " + Date.now();
	}

	// ── numeric formatting / parsing ────────────────────────────────────────
	function _numStr(v) {
		if (v === undefined || v === null || (typeof v === "number" && !isFinite(v))) return "";
		return String(v);
	}

	// Floor/ceiling can legitimately be ±Infinity — shown as blank with a hint.
	function _boundStr(v) {
		if (v === Infinity || v === -Infinity) return "";
		if (v === undefined || v === null) return "";
		return String(v);
	}

	function _parseFinite(raw) {
		if (raw === "") return { ok: false };
		var n = Number(raw);
		return isFinite(n) ? { ok: true, value: n } : { ok: false };
	}

	function _parseInt0(raw) {
		if (raw === "") return { ok: false };
		var n = Number(raw);
		if (!isFinite(n) || n < 0) return { ok: false };
		return { ok: true, value: Math.round(n) };
	}

	function _parseUnitInterval(raw) {
		var result = _parseFinite(raw);
		if (!result.ok || result.value < 0 || result.value > 1) return { ok: false };
		return result;
	}

	function _parseFloor(raw) {
		var s = raw.trim().toLowerCase();
		if (s === "" ) return { ok: true, value: -Infinity };
		if (s === "-infinity" || s === "-inf") return { ok: true, value: -Infinity };
		if (s === "infinity" || s === "inf" || s === "+infinity") return { ok: true, value: Infinity };
		return _parseFinite(raw.trim());
	}

	function _parseCeil(raw) {
		var s = raw.trim().toLowerCase();
		if (s === "") return { ok: true, value: Infinity };
		if (s === "infinity" || s === "inf" || s === "+infinity") return { ok: true, value: Infinity };
		if (s === "-infinity" || s === "-inf") return { ok: true, value: -Infinity };
		return _parseFinite(raw.trim());
	}

	// ── generic cell builders ───────────────────────────────────────────────
	function _cell(row, child) {
		var td = document.createElement("td");
		if (child) td.appendChild(child);
		row.appendChild(td);
		return td;
	}

	function _flashInvalid(inp) {
		inp.classList.add("tv-invalid");
		setTimeout(function () { inp.classList.remove("tv-invalid"); }, 1000);
	}

	// A numeric text input with parse + revert-on-invalid.
	function _numInput(getVal, setVal, opts) {
		opts = opts || {};
		var display = opts.display || _numStr;
		var parse = opts.parse || _parseFinite;
		var inp = document.createElement("input");
		inp.type = "text";
		inp.className = "tv-input tv-num";
		if (opts.placeholder) inp.placeholder = opts.placeholder;
		inp.value = display(getVal());
		inp.addEventListener("change", function () {
			var res = parse(inp.value.trim());
			if (!res.ok) {
				inp.value = display(getVal());
				_flashInvalid(inp);
				_toast(opts.errMsg || "Enter a valid number");
				return;
			}
			if (setVal(res.value) === false) {
				inp.value = display(getVal());
				_flashInvalid(inp);
				return;
			}
			inp.value = display(getVal());
			_commit();
		});
		return inp;
	}

	// A free-text input (formulas). Empty string is stored as null.
	function _formulaInput(getVal, setVal) {
		var inp = document.createElement("input");
		inp.type = "text";
		inp.className = "tv-input tv-formula";
		inp.spellcheck = false;
		var v = getVal();
		inp.value = (v === undefined || v === null) ? "" : String(v);
		inp.addEventListener("change", function () {
			var t = inp.value;
			if (setVal(t.trim() === "" ? null : t) === false) {
				var current = getVal();
				inp.value = (current === undefined || current === null) ? "" : String(current);
				_flashInvalid(inp);
				return;
			}
			_commit();
		});
		return inp;
	}

	// Checkbox that enables/disables a formula-style property. Enabling seeds a
	// default (or keeps existing text) and enables the paired text input.
	function _toggleCell(row, getVal, setVal, textInput, defaultVal) {
		var td = document.createElement("td");
		td.className = "tv-toggle-cell";
		var cb = document.createElement("input");
		cb.type = "checkbox";
		cb.className = "tv-check";
		cb.checked = !!getVal();
		textInput.disabled = !cb.checked;
		cb.addEventListener("change", function () {
			if (cb.checked) {
				var existing = getVal();
				var seed = (existing !== undefined && existing !== null && String(existing) !== "")
					? existing : (defaultVal || "");
				if (setVal(seed === "" ? null : seed) === false) {
					cb.checked = false;
					textInput.disabled = true;
					return;
				}
				textInput.disabled = false;
				textInput.value = (seed === "" ? "" : String(seed));
				textInput.focus();
			} else {
				if (setVal(null) === false) {
					cb.checked = true;
					textInput.disabled = false;
					return;
				}
				textInput.value = "";
				textInput.disabled = true;
			}
			_commit();
		});
		td.appendChild(cb);
		row.appendChild(td);
		return cb;
	}

	// ── NODES table ─────────────────────────────────────────────────────────
	function _buildNodeRow(node) {
		var tr = document.createElement("tr");

		// Name (required — reverts to previous on blank)
		var nameInp = document.createElement("input");
		nameInp.type = "text";
		nameInp.className = "tv-input tv-name";
		nameInp.value = (node.label === undefined || node.label === null) ? "" : String(node.label);
		nameInp.addEventListener("change", function () {
			var v = nameInp.value;
			if (!_updateNode(node, { name: v.trim() })) {
				nameInp.value = (node.label === undefined || node.label === null) ? "" : String(node.label);
				_flashInvalid(nameInp);
				return;
			}
			nameInp.value = node.label;
			_refreshEndpointLabels(node.id, _nodeLabel(node));
			_commit();
		});
		_cell(tr, nameInp);

		// Start value
		_cell(tr, _numInput(
			function () { return node.init; },
			function (x) { return _updateNode(node, { start_amount: x }); },
			{ errMsg: "Start value must be a number" }
		));

		// Retention
		_cell(tr, _numInput(
			function () { return node.retention; },
			function (x) { return _updateNode(node, { retention: x }); },
			{ errMsg: "Retention must be a number" }
		));

		// Floor / Ceiling (±∞ shown as blank)
		_cell(tr, _numInput(
			function () { return node.floor; },
			function (x) { return _updateNode(node, { floor: x }); },
			{ display: _boundStr, parse: _parseFloor, placeholder: "−∞" }
		));
		_cell(tr, _numInput(
			function () { return node.ceiling; },
			function (x) { return _updateNode(node, { ceiling: x }); },
			{ display: _boundStr, parse: _parseCeil, placeholder: "+∞" }
		));

		// Formula enabled + formula text
		var formulaInp = _formulaInput(
			function () { return node.formula; },
			function (v) { return _updateNode(node, { formula: v }); }
		);
		formulaInp.placeholder = "e.g. 0.6 * nxt['X']";
		_toggleCell(tr, function () { return node.formula; },
			function (v) { return _updateNode(node, { formula: v }); }, formulaInp, "");
		_cell(tr, formulaInp);

		// Sink enabled + sink formula
		var sinkInp = _formulaInput(
			function () { return node.sinkFormula; },
			function (v) { return _updateNode(node, { sink_formula: v }); }
		);
		_toggleCell(tr, function () { return node.sinkFormula; },
			function (v) { return _updateNode(node, { sink_formula: v }); }, sinkInp, "0.95");
		_cell(tr, sinkInp);

		// Source enabled + source formula
		var srcInp = _formulaInput(
			function () { return node.sourceFormula; },
			function (v) { return _updateNode(node, { source_formula: v }); }
		);
		_toggleCell(tr, function () { return node.sourceFormula; },
			function (v) { return _updateNode(node, { source_formula: v }); }, srcInp, "1.05");
		_cell(tr, srcInp);

		// Delete
		var del = document.createElement("button");
		del.type = "button";
		del.className = "tv-del-btn";
		del.title = "Delete node";
		del.textContent = "✕";
		del.addEventListener("click", function () {
			model().removeNode(node);
			render();
		});
		var td = _cell(tr, del);
		td.className = "tv-actions";

		return tr;
	}

	// ── EDGES table ─────────────────────────────────────────────────────────
	// Resolve a node by id. HTML <select>.value is always a string; node.id is
	// usually a number. nodeByID keys are strings either way, but be defensive.
	function _nodeById(id) {
		var m = model();
		if (!m) return null;
		var n = m.getNode(id);
		if (n) return n;
		if (id !== undefined && id !== null && String(id) !== "") {
			n = m.getNode(Number(id));
			if (n) return n;
			n = m.getNode(String(id));
		}
		return n || null;
	}

	// Keep Node._UID strictly above every live node id so a newly added node
	// never reuses an id still present on the canvas. Duplicate option values
	// make <select> show the wrong endpoint while edge.from/to object refs
	// (and the canvas) stay correct — the bug that looked like "edges rewired".
	function _syncNodeUid() {
		var m = model();
		if (!m || typeof Node === "undefined") return;
		var max = 0;
		for (var i = 0; i < m.nodes.length; i++) {
			var id = Number(m.nodes[i].id);
			if (isFinite(id) && id > max) max = id;
		}
		if (!isFinite(Node._UID) || Node._UID < max) Node._UID = max;
	}

	function _nodeSelect(selectedId, onChange, placeholder) {
		var sel = document.createElement("select");
		sel.className = "tv-input tv-select tv-endpoint";
		var nodes = model().nodes;
		// Always compare/select as strings — option.value is a string, and a
		// failed === match leaves nothing selected so the browser shows the
		// *first* node for every edge (looks like mass reconnection).
		var selectedStr = (selectedId === undefined || selectedId === null) ? "" : String(selectedId);
		var found = false;
		if (placeholder) {
			var empty = document.createElement("option");
			empty.value = "";
			empty.textContent = placeholder;
			empty.disabled = true;
			empty.selected = selectedStr === "";
			sel.appendChild(empty);
		}
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			var idStr = String(n.id);
			var o = document.createElement("option");
			o.value = idStr;
			o.textContent = _nodeLabel(n);
			o.setAttribute("data-node-id", idStr);
			if (idStr === selectedStr) {
				o.selected = true;
				found = true;
			}
			sel.appendChild(o);
		}
		if (found) {
			// Force the select's value after building options (more reliable
			// across browsers than only setting option.selected).
			sel.value = selectedStr;
		} else if (selectedStr !== "" && nodes.length > 0) {
			// Dangling endpoint: don't silently retarget to nodes[0].
			var ph = document.createElement("option");
			ph.value = selectedStr;
			ph.textContent = "(missing node #" + selectedStr + ")";
			ph.selected = true;
			sel.insertBefore(ph, sel.firstChild);
			sel.value = selectedStr;
		}
		var lastEmitted = selectedStr;
		sel.addEventListener("change", function () {
			// Ignore no-ops (some browsers re-fire on rebuild/focus).
			if (String(sel.value) === String(lastEmitted)) return;
			lastEmitted = sel.value;
			onChange(sel.value);
		});
		return sel;
	}

	// Keep edge source/target dropdown labels current when a node is renamed,
	// without a full re-render.
	function _refreshEndpointLabels(nodeId, label) {
		var body = document.getElementById("tvEdgesBody");
		if (!body) return;
		var opts = body.querySelectorAll('option[data-node-id="' + String(nodeId).replace(/"/g, '\\"') + '"]');
		for (var i = 0; i < opts.length; i++) opts[i].textContent = label;
	}

	function _buildEdgeRow(edge) {
		var tr = document.createElement("tr");

		// Source / Target — bind by stable node id (stringified), not list index.
		_cell(tr, _nodeSelect(edge.from && edge.from.id, function (id) {
			var n = _nodeById(id);
			if (n && _updateEdge(edge, { source: _nodeLabel(n) })) {
				_commit();
			} else {
				render();
			}
		}));
		_cell(tr, _nodeSelect(edge.to && edge.to.id, function (id) {
			var n = _nodeById(id);
			if (n && _updateEdge(edge, { target: _nodeLabel(n) })) {
				_commit();
			} else {
				render();
			}
		}));

		// Correlation (strength)
		_cell(tr, _numInput(
			function () { return edge.strength; },
			function (x) { return _updateEdge(edge, { correlation: x }); },
			{ errMsg: "Correlation must be a number" }
		));
		// Decay (damper)
		_cell(tr, _numInput(
			function () { return edge.damper; },
			function (x) { return _updateEdge(edge, { decay: x }); },
			{ parse: _parseUnitInterval, errMsg: "Decay must be between 0 and 1" }
		));
		// Confidence
		_cell(tr, _numInput(
			function () { return edge.confidence; },
			function (x) { return _updateEdge(edge, { confidence: x }); },
			{ parse: _parseUnitInterval, errMsg: "Confidence must be between 0 and 1" }
		));
		// Delay (lag, integer ≥ 0)
		_cell(tr, _numInput(
			function () { return edge.lag; },
			function (x) { return _updateEdge(edge, { delay: x }); },
			{ parse: _parseInt0, errMsg: "Delay must be a whole number ≥ 0" }
		));

		// Delete
		var del = document.createElement("button");
		del.type = "button";
		del.className = "tv-del-btn";
		del.title = "Delete edge";
		del.textContent = "✕";
		del.addEventListener("click", function () {
			model().removeEdge(edge);
			render();
		});
		var td = _cell(tr, del);
		td.className = "tv-actions";

		return tr;
	}

	// A draft edge belongs to the table UI, not the model. This prevents a new
	// table row from silently creating a real connection between arbitrary nodes.
	var _draftEdge = null;
	function _buildDraftEdgeRow() {
		var tr = document.createElement("tr");
		tr.className = "tv-draft-edge";
		var choose = function (key) {
			return function (id) {
				_draftEdge[key] = id;
				if (!_draftEdge.from || !_draftEdge.to) return;
				var m = model();
				m.addEdge({ from: _draftEdge.from, to: _draftEdge.to });
				_draftEdge = null;
				render();
			};
		};
		_cell(tr, _nodeSelect(_draftEdge.from, choose("from"), "Select source"));
		_cell(tr, _nodeSelect(_draftEdge.to, choose("to"), "Select target"));
		var td = document.createElement("td");
		td.colSpan = 4;
		td.className = "tv-draft-hint";
		td.textContent = "Choose a source and target to create this edge.";
		tr.appendChild(td);
		var cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = "tv-del-btn";
		cancel.title = "Cancel new edge";
		cancel.textContent = "✕";
		cancel.addEventListener("click", function () { _draftEdge = null; render(); });
		var actions = _cell(tr, cancel);
		actions.className = "tv-actions";
		return tr;
	}

	function _emptyRow(colspan, text) {
		var tr = document.createElement("tr");
		var td = document.createElement("td");
		td.colSpan = colspan;
		td.className = "tv-empty";
		td.textContent = text;
		tr.appendChild(td);
		return tr;
	}

	// ── public: render both tables from the model ───────────────────────────
	var _rendering = false;
	function render() {
		var m = model();
		var nodesBody = document.getElementById("tvNodesBody");
		var edgesBody = document.getElementById("tvEdgesBody");
		if (!nodesBody || !edgesBody) return;

		_rendering = true;
		try {
			nodesBody.innerHTML = "";
			edgesBody.innerHTML = "";

			if (!m) {
				nodesBody.appendChild(_emptyRow(12, "Model not ready."));
				return;
			}

			if (m.nodes.length === 0) {
				nodesBody.appendChild(_emptyRow(12, "No nodes yet — click “+ Add node”."));
			} else {
				for (var i = 0; i < m.nodes.length; i++) {
					nodesBody.appendChild(_buildNodeRow(m.nodes[i]));
				}
			}

			if (m.edges.length === 0 && !_draftEdge) {
				edgesBody.appendChild(_emptyRow(7, "No edges yet — click “+ Add edge”."));
			} else {
				for (var j = 0; j < m.edges.length; j++) {
					edgesBody.appendChild(_buildEdgeRow(m.edges[j]));
				}
			}
			if (_draftEdge) edgesBody.appendChild(_buildDraftEdgeRow());

			var nc = document.getElementById("tvNodeCount");
			var ec = document.getElementById("tvEdgeCount");
			if (nc) nc.textContent = "(" + m.nodes.length + ")";
			if (ec) ec.textContent = "(" + m.edges.length + ")";
		} finally {
			_rendering = false;
		}
	}

	// ── public: structural operations (wired to the + buttons) ──────────────
	function addNode() {
		var m = model();
		if (!m) return;
		// Suppress the model/changed → render subscriber while we mutate; we
		// re-render once at the end with a consistent node list + edge selects.
		_rendering = true;
		var newNode = null;
		try {
			_syncNodeUid();
			var n = m.nodes.length;
			var x = 120 + (n % 6) * 150;
			var y = 120 + Math.floor(n / 6) * 130;
			newNode = m.addNode({ x: x, y: y, label: _nextNodeLabel(m) });
		} finally {
			_rendering = false;
		}
		_expandSection("nodes"); // don't hide the row we just added
		render();
		// Focus the new row's name field for immediate editing.
		var body = document.getElementById("tvNodesBody");
		if (body && body.lastElementChild) {
			var inp = body.lastElementChild.querySelector(".tv-name");
			if (inp) { inp.focus(); inp.select(); }
		}
		return newNode;
	}

	function addEdge() {
		var m = model();
		if (!m) return;
		if (m.nodes.length < 2) {
			_toast("Add at least two nodes before creating an edge");
			return;
		}
		_draftEdge = { from: "", to: "" };
		_expandSection("edges"); // don't hide the row we just added
		render();
		var body = document.getElementById("tvEdgesBody");
		if (body && body.lastElementChild) {
			var source = body.lastElementChild.querySelector(".tv-endpoint");
			if (source) source.focus();
		}
	}

	// ── collapse / expand + show-all (height cap) controls ──────────────────
	function _setCollapsed(section, collapsed) {
		if (!section) return;
		section.classList.toggle("tv-collapsed", collapsed);
		var chevron = section.querySelector(".tv-collapse-btn");
		if (chevron) chevron.setAttribute("aria-expanded", String(!collapsed));
	}

	function _sectionEl(name) {
		return document.querySelector('.tv-section[data-section="' + name + '"]');
	}

	function _expandSection(name) {
		_setCollapsed(_sectionEl(name), false);
	}

	function expandAll() {
		var secs = document.querySelectorAll(".tables-view .tv-section");
		for (var i = 0; i < secs.length; i++) _setCollapsed(secs[i], false);
	}

	function collapseAll() {
		var secs = document.querySelectorAll(".tables-view .tv-section");
		for (var i = 0; i < secs.length; i++) _setCollapsed(secs[i], true);
	}

	// Wire the static header controls once (markup lives in index.html).
	function _wireControls() {
		var secs = document.querySelectorAll(".tables-view .tv-section");
		for (var i = 0; i < secs.length; i++) {
			(function (section) {
				var titleGroup = section.querySelector(".tv-section-titlegroup");
				var toggle = function () {
					_setCollapsed(section, !section.classList.contains("tv-collapsed"));
				};
				if (titleGroup) {
					titleGroup.addEventListener("click", toggle);
					titleGroup.addEventListener("keydown", function (e) {
						if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
					});
				}
				var showAll = section.querySelector(".tv-showall-btn");
				var scroll = section.querySelector(".tv-scroll");
				if (showAll && scroll) {
					showAll.addEventListener("click", function () {
						var expanded = scroll.classList.toggle("tv-expanded");
						showAll.textContent = expanded ? "Scroll" : "Show all";
						showAll.classList.toggle("tv-active", expanded);
						// Expanding the height only helps if the section is open.
						if (expanded) _setCollapsed(section, false);
					});
				}
			})(secs[i]);
		}
	}

	// ── live sync: reflect external (canvas) changes when Tables is visible,
	//    but never clobber an input the user is currently editing ─────────────
	subscribe("model/changed", function () {
		if (_rendering) return;
		if (!_tablesVisible()) return;
		var active = document.activeElement;
		var root = document.getElementById("Tables");
		if (active && root && root.contains(active)) return; // user is editing here
		render();
	});

	window.tablesView = {
		render: render,
		addNode: addNode,
		addEdge: addEdge,
		expandAll: expandAll,
		collapseAll: collapseAll
	};

	// Wire the static collapse / show-all controls once the DOM is ready.
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", _wireControls);
	} else {
		_wireControls();
	}
})();
