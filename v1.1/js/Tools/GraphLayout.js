/**********************************

GRAPH LAYOUT

Auto-arrange canvas nodes so causal links are easier to read.
Pure client-side (no backend). Supports:
  • force  — spring layout (default): related nodes cluster, edges shorten
  • circle — even ring (good overview of whole system)
  • grid   — compact rectangular packing

Usage:
  GraphLayout.apply(loopy.model, { mode: "force" });
  GraphLayout.apply(loopy.model, { mode: "circle" });

**********************************/

(function (global) {
	"use strict";

	var DEFAULTS = {
		mode: "force",
		iterations: 280,
		// Ideal edge length scales with graph size
		idealEdge: null,
		// Extra padding around final bounding box before center/fit
		padding: 80,
		// Soften existing edge curves a bit so layout isn’t hidden by wild arcs
		normalizeArcs: true,
		// Fit viewport after layout
		fitView: true,
	};

	function _nodes(model) {
		return (model && model.nodes) ? model.nodes.slice() : [];
	}

	function _edges(model) {
		return (model && model.edges) ? model.edges : [];
	}

	// Undirected adjacency for layout forces (CLDs are directed but layout is undirected).
	function _adjacency(nodes, edges) {
		var idx = {};
		nodes.forEach(function (n, i) { idx[n.id] = i; });
		var links = [];
		edges.forEach(function (e) {
			if (!e.from || !e.to) return;
			var a = idx[e.from.id];
			var b = idx[e.to.id];
			if (a === undefined || b === undefined || a === b) return;
			links.push([a, b]);
		});
		return { idx: idx, links: links };
	}

	// Connected components (for packing separate islands side by side).
	function _components(n, links) {
		var adj = [];
		for (var i = 0; i < n; i++) adj[i] = [];
		links.forEach(function (ab) {
			adj[ab[0]].push(ab[1]);
			adj[ab[1]].push(ab[0]);
		});
		var seen = new Array(n);
		var comps = [];
		for (var s = 0; s < n; s++) {
			if (seen[s]) continue;
			var stack = [s];
			var comp = [];
			seen[s] = true;
			while (stack.length) {
				var u = stack.pop();
				comp.push(u);
				adj[u].forEach(function (v) {
					if (!seen[v]) { seen[v] = true; stack.push(v); }
				});
			}
			comps.push(comp);
		}
		return comps;
	}

	/**
	 * Fruchterman–Reingold style force layout on a subset of nodes.
	 * positions: Array of {x,y} length n (mutated).
	 * nodeIndices: which indices participate (component).
	 * links: full-graph links as [i,j] pairs (filtered to component).
	 */
	function _forceComponent(positions, nodeIndices, links, opts) {
		var set = {};
		nodeIndices.forEach(function (i) { set[i] = true; });
		var localLinks = links.filter(function (ab) {
			return set[ab[0]] && set[ab[1]];
		});
		var m = nodeIndices.length;
		if (m === 0) return;
		if (m === 1) {
			positions[nodeIndices[0]].x = 0;
			positions[nodeIndices[0]].y = 0;
			return;
		}

		var area = Math.max(400, m * 140) * Math.max(400, m * 140);
		var k = opts.idealEdge || Math.sqrt(area / m);
		var t = k * 2.5; // temperature
		var dt = t / (opts.iterations + 1);

		// Seed: small jitter around current (or circle if collapsed)
		var cx = 0, cy = 0;
		nodeIndices.forEach(function (i) {
			cx += positions[i].x;
			cy += positions[i].y;
		});
		cx /= m; cy /= m;
		var spread = 0;
		nodeIndices.forEach(function (i) {
			spread += Math.hypot(positions[i].x - cx, positions[i].y - cy);
		});
		if (spread < k * 0.5) {
			// Nearly stacked → start on a circle so forces have room
			nodeIndices.forEach(function (i, li) {
				var ang = (li / m) * Math.PI * 2 - Math.PI / 2;
				positions[i].x = Math.cos(ang) * k * 1.2;
				positions[i].y = Math.sin(ang) * k * 1.2;
			});
		}

		for (var iter = 0; iter < opts.iterations; iter++) {
			// Displacement accumulators
			var dx = new Array(positions.length);
			var dy = new Array(positions.length);
			for (var z = 0; z < positions.length; z++) { dx[z] = 0; dy[z] = 0; }

			// Repulsion: all pairs in component (O(m²) — fine for CLD sizes)
			for (var a = 0; a < m; a++) {
				for (var b = a + 1; b < m; b++) {
					var i = nodeIndices[a];
					var j = nodeIndices[b];
					var vx = positions[i].x - positions[j].x;
					var vy = positions[i].y - positions[j].y;
					var dist = Math.sqrt(vx * vx + vy * vy) || 0.01;
					var force = (k * k) / dist;
					var fx = (vx / dist) * force;
					var fy = (vy / dist) * force;
					dx[i] += fx; dy[i] += fy;
					dx[j] -= fx; dy[j] -= fy;
				}
			}

			// Attraction along edges
			localLinks.forEach(function (ab) {
				var i = ab[0], j = ab[1];
				var vx = positions[i].x - positions[j].x;
				var vy = positions[i].y - positions[j].y;
				var dist = Math.sqrt(vx * vx + vy * vy) || 0.01;
				var force = (dist * dist) / k;
				var fx = (vx / dist) * force;
				var fy = (vy / dist) * force;
				dx[i] -= fx; dy[i] -= fy;
				dx[j] += fx; dy[j] += fy;
			});

			// Apply with temperature cap
			nodeIndices.forEach(function (i) {
				var disp = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.01;
				var cap = Math.min(disp, t);
				positions[i].x += (dx[i] / disp) * cap;
				positions[i].y += (dy[i] / disp) * cap;
			});

			t = Math.max(t - dt, k * 0.02);
		}

		// Recenter component at origin
		var sx = 0, sy = 0;
		nodeIndices.forEach(function (i) {
			sx += positions[i].x;
			sy += positions[i].y;
		});
		sx /= m; sy /= m;
		nodeIndices.forEach(function (i) {
			positions[i].x -= sx;
			positions[i].y -= sy;
		});
	}

	function _packComponents(positions, comps, gap) {
		if (comps.length <= 1) return;
		// Place components left-to-right by size
		var ordered = comps.slice().sort(function (a, b) { return b.length - a.length; });
		var cursorX = 0;
		ordered.forEach(function (comp) {
			var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
			comp.forEach(function (i) {
				minX = Math.min(minX, positions[i].x);
				maxX = Math.max(maxX, positions[i].x);
				minY = Math.min(minY, positions[i].y);
				maxY = Math.max(maxY, positions[i].y);
			});
			var w = maxX - minX;
			var h = maxY - minY;
			var ox = cursorX - minX;
			var oy = - (minY + maxY) / 2;
			comp.forEach(function (i) {
				positions[i].x += ox;
				positions[i].y += oy;
			});
			cursorX += w + gap;
		});
		// Recenter whole graph
		var sx = 0, sy = 0, n = 0;
		positions.forEach(function (p) {
			sx += p.x; sy += p.y; n++;
		});
		if (n) {
			sx /= n; sy /= n;
			positions.forEach(function (p) {
				p.x -= sx;
				p.y -= sy;
			});
		}
	}

	function _circleLayout(positions, nodes) {
		var n = nodes.length;
		if (n === 0) return;
		var radius = Math.max(180, n * 55);
		for (var i = 0; i < n; i++) {
			var ang = (i / n) * Math.PI * 2 - Math.PI / 2;
			positions[i].x = Math.cos(ang) * radius;
			positions[i].y = Math.sin(ang) * radius;
		}
	}

	function _gridLayout(positions, nodes) {
		var n = nodes.length;
		if (n === 0) return;
		var cols = Math.ceil(Math.sqrt(n));
		var spacing = 180;
		var rows = Math.ceil(n / cols);
		var ox = -((cols - 1) * spacing) / 2;
		var oy = -((rows - 1) * spacing) / 2;
		for (var i = 0; i < n; i++) {
			positions[i].x = ox + (i % cols) * spacing;
			positions[i].y = oy + Math.floor(i / cols) * spacing;
		}
	}

	function _normalizeArcs(edges) {
		edges.forEach(function (e, i) {
			// Keep modest curvature; alternate sides so parallel edges separate
			var base = 80 + (i % 5) * 12;
			if (e.from === e.to || (e.from && e.to && e.from.id === e.to.id)) {
				e.arc = Math.max(e.arc || 100, 120);
			} else {
				e.arc = (i % 2 === 0 ? 1 : -1) * base;
			}
		});
	}

	/**
	 * Apply layout to a live Loopy model.
	 * @param {object} model  loopy.model
	 * @param {object} options  { mode, iterations, fitView, normalizeArcs }
	 * @returns {{ mode, nodeCount }}
	 */
	function apply(model, options) {
		options = Object.assign({}, DEFAULTS, options || {});
		if (!model) throw new Error("No model");
		var nodes = _nodes(model);
		if (nodes.length === 0) return { mode: options.mode, nodeCount: 0 };

		// Undo snapshot before moving anything
		if (typeof model.saveState === "function" && !model.restoringState) {
			model.saveState();
		}

		var positions = nodes.map(function (n) {
			return { x: n.x || 0, y: n.y || 0 };
		});
		var adj = _adjacency(nodes, _edges(model));

		var mode = (options.mode || "force").toLowerCase();
		if (mode === "circle") {
			_circleLayout(positions, nodes);
		} else if (mode === "grid") {
			_gridLayout(positions, nodes);
		} else {
			// force (default)
			var comps = _components(nodes.length, adj.links);
			comps.forEach(function (comp) {
				_forceComponent(positions, comp, adj.links, options);
			});
			_packComponents(positions, comps, options.padding || 80);
		}

		// Write back
		nodes.forEach(function (n, i) {
			n.x = Math.round(positions[i].x);
			n.y = Math.round(positions[i].y);
		});

		if (options.normalizeArcs) {
			_normalizeArcs(_edges(model));
		}

		if (typeof publish === "function") publish("model/changed");
		if (typeof model.dirty === "function") model.dirty();
		if (typeof model.update === "function") model.update();

		if (options.fitView && typeof model.center === "function") {
			// center(true) fits scale; sync model.scale with loopy.offsetScale
			model.center(true);
			if (model.loopy) {
				model.scale = model.loopy.offsetScale;
				model.offsetX = model.loopy.offsetX;
				model.offsetY = model.loopy.offsetY;
			}
			if (typeof model.dirty === "function") model.dirty();
		}

		// Second undo frame so "undo" goes back to pre-layout
		if (typeof model.saveState === "function" && !model.restoringState) {
			model.saveState();
		}

		return { mode: mode, nodeCount: nodes.length };
	}

	var GraphLayout = {
		apply: apply,
		modes: ["force", "circle", "grid"],
		DEFAULTS: DEFAULTS,
	};

	global.GraphLayout = GraphLayout;
})(typeof window !== "undefined" ? window : this);
