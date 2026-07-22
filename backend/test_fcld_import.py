"""
Regression test for importing fcld (.loopy) files.

Background
----------
fcld ("hacked FlowCLD") .loopy files carry extra data beyond the legacy
loopy array schema: per-node retention + value formulas, and per-edge
confidence / delay / functional-form. Their positional layout differs from
the legacy/native layout:

    fcld  node: [id,x,y,init,label,hue,flow,pass,floor,ceiling, RETENTION, VALUE_FORMULA, sink?, flag, radius]
    fcld  edge: [from,to,arc,strength, CONFIDENCE, DELAY, lx, ly, FORM, _]

    native node: [ ... ,floor,ceiling, FORMULA, sink, source, RETENTION, radius]
    native edge: [from,to,arc,strength, DAMPER(decay), LAG, lx, ly, FORM]

The old frontend parser read every file with the native indices, so for an
fcld file it (a) read each node's retention string as the value FORMULA and
its real formula as a sink formula, turning converters into inert stocks, and
(b) read each edge's CONFIDENCE (1.0) as DAMPER/decay, making edge_factor =
corr*(1-1) = 0. Result: nothing propagates and the simulation is a flat line.

`parse_fcld_edges/nodes` below mirror the fcld branch of
`v1.1/js/Core/Model.js` deserialize() — keep them in sync. This test asserts
the fcld file simulates with real dynamics (and that the old misparse is flat).
"""

import os
import json
import math
import urllib.parse

import numpy as np
import networkx as nx

from advanced_analysis import simulate_two_phase
from simulation_engine import SimulationContractError

FIXTURE = os.path.join(os.path.dirname(__file__), "tests", "fixtures", "toy_fcld.loopy")


# ── helpers (mirror the JS deserialize) ────────────────────────────────────
def _uq(s):
    return urllib.parse.unquote(s) if isinstance(s, str) else s


def _num(v, default=None):
    if v in (None, "", "None"):
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _bound(s, default):
    s = _uq(s)
    if s == "Infinity":
        return math.inf
    if s == "-Infinity":
        return -math.inf
    v = _num(s)
    return v if v is not None else default


def load_arrays():
    raw = open(FIXTURE).read().strip()
    data = json.loads(urllib.parse.unquote(raw))  # fcld uses real quotes; unquote %20 etc.
    return data[0], data[1]


def build_graph(nodes, edges, layout):
    """layout='fcld' (correct) or 'native' (the old, wrong interpretation)."""
    G = nx.DiGraph()
    id2name = {}
    for n in nodes:
        name = _uq(n[4])
        id2name[n[0]] = name
        if layout == "fcld":
            retention = _num(n[10], 0.0)
            formula = _uq(n[11]) or None
        else:  # native indices applied to an fcld array (the bug)
            formula = _uq(n[10]) or None          # actually the retention string
            retention = _num(n[13], 1.0)          # actually a flag (1)
        G.add_node(
            name,
            start_amount=float(n[3]),
            retention=retention,
            floor=_bound(n[8], -math.inf),
            ceiling=_bound(n[9], math.inf),
            formula=formula,
            sink_formula=(_uq(n[11]) or None) if layout == "native" else None,
            source_formula=None,
        )
    for e in edges:
        u, v = id2name[e[0]], id2name[e[1]]
        if layout == "fcld":
            decay, delay, conf = 0.0, int(e[5] or 0), _num(e[4], 1.0)
        else:  # confidence read as decay -> zeroes the edge
            decay, delay, conf = float(e[4]), (int(e[5]) if e[4] else 0), 1.0
        G.add_edge(
            u, v,
            correlation=float(e[3]), decay=decay, delay=delay, confidence=conf,
            functional_form=(e[8] if isinstance(e[8], str) else "linear"),
        )
    return G


def _run(G, steps=60):
    init = {n: G.nodes[n]["start_amount"] for n in G}
    hist = simulate_two_phase(G, init, steps)
    return {n: [v for v in hist[n] if v is not None] for n in G}


def _range(series):
    return (max(series) - min(series)) if series else 0.0


# ── tests ──────────────────────────────────────────────────────────────────
def test_fcld_parses_edges_and_nodes():
    nodes, edges = load_arrays()
    assert len(nodes) == 10 and len(edges) == 15
    G = build_graph(nodes, edges, "fcld")
    # converters keep their real value formulas; a stock keeps retention
    assert G.nodes["Consumption"]["retention"] == 0.0
    assert "nxt['Income']" in (G.nodes["Consumption"]["formula"] or "")
    assert G.nodes["Income"]["retention"] == 1.0
    # edges are not decay-zeroed (confidence must not be read as decay)
    for _, _, d in G.edges(data=True):
        assert d["decay"] == 0.0
        assert abs(d["correlation"]) == 1.0


def test_encoded_formulas_eval_without_decimal_literal_error(capsys=None):
    """
    .loopy formula fields are percent-encoded. Evaluating them raw yields
    SyntaxError: invalid decimal literal (Python parses %5B as modulo-5 + 'B').
    simulate_two_phase must decode before eval.
    """
    from advanced_analysis import simulate_two_phase, _decode_expr
    import json

    # Load WITHOUT unquoting the file so formulas stay encoded on the nodes
    raw = open(FIXTURE).read().strip()
    data = json.loads(raw)
    nodes, edges = data[0], data[1]

    encoded = nodes[2][11]  # Inflation
    assert "%5B" in encoded, "fixture formula should still be URL-encoded"
    assert "[" in _decode_expr(encoded)

    G = nx.DiGraph()
    id2name = {}
    for n in nodes:
        name = _uq(n[4])
        id2name[n[0]] = name
        G.add_node(
            name,
            start_amount=float(n[3]),
            retention=_num(n[10], 0.0),
            floor=_bound(n[8], -math.inf),
            ceiling=_bound(n[9], math.inf),
            formula=n[11] if isinstance(n[11], str) and n[11].strip() else None,  # still encoded
        )
    for e in edges:
        G.add_edge(
            id2name[e[0]], id2name[e[1]],
            correlation=float(e[3]), decay=0.0, delay=int(e[5] or 0),
            confidence=_num(e[4], 1.0),
        )
    init = {n: G.nodes[n]["start_amount"] for n in G}
    hist = simulate_two_phase(G, init, 5)
    # Converters should have real numbers, not None placeholders left behind
    assert hist["Inflation"][1] is not None
    assert isinstance(hist["Consumption"][1], float)


def test_fcld_simulation_is_not_flat():
    nodes, edges = load_arrays()
    series = _run(build_graph(nodes, edges, "fcld"))
    moving = [n for n, s in series.items() if _range(s) > 1e-6]
    assert len(moving) >= 3, f"expected real dynamics, only {moving} moved"


def test_income_shock_moves_downstream():
    nodes, edges = load_arrays()
    G = build_graph(nodes, edges, "fcld")
    base = _run(G)

    # Shock: raise Income's level; Consumption = 0.6 * Income must follow.
    G.nodes["Income"]["start_amount"] += 50.0
    shocked = _run(G)

    assert abs(base["Consumption"][-1] - shocked["Consumption"][-1]) > 1e-6, \
        "income shock did not propagate to Consumption"


def test_old_native_misparse_is_rejected_or_flat_regression():
    """Wrong schema interpretation must never look like valid dynamics."""
    nodes, edges = load_arrays()
    try:
        series = _run(build_graph(nodes, edges, "native"))
    except SimulationContractError:
        return
    moving = [n for n, s in series.items() if _range(s) > 1e-6]
    assert moving == [], f"native misparse should be flat, but {moving} moved"


if __name__ == "__main__":
    for fn in [
        test_fcld_parses_edges_and_nodes,
        test_encoded_formulas_eval_without_decimal_literal_error,
        test_fcld_simulation_is_not_flat,
        test_income_shock_moves_downstream,
        test_old_native_misparse_is_rejected_or_flat_regression,
    ]:
        fn()
        print(f"✅ {fn.__name__}")
    print("\nAll fcld import regression tests passed.")
