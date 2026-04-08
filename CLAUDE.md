# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LoopyV2 (FlowCLD) is a systems dynamics and causal loop diagram (CLD) visualization tool. Users draw feedback loop diagrams on a canvas, then run simulations and advanced analyses via a Python backend.

## Development Commands

### Backend (Flask, Python)
```bash
cd backend
pip install -r requirements.txt
python app.py          # Flask dev server on port 5000
python test_advanced_api.py  # Run tests
```

### Frontend (v1.1 — primary app)
```bash
cd v1.1
python -m http.server 5501
# Visit http://localhost:5501/
```

## Architecture

### Two frontends

- **`v1.1/`** — The primary, production-ready app. Vanilla JS, no framework, canvas-based. Served via any static HTTP server.
- **`frontend/`** — An abandoned webpack scaffold. Its `src/index.js` is boilerplate only (no real app logic). Ignore it; all meaningful frontend code is in `v1.1/`.

### Core data flow

1. User draws nodes + edges on canvas in `v1.1/`
2. Model state lives in `js/Core/Model.js` (nodes, edges, labels)
3. Basic simulation runs entirely in-browser via `js/Libraries/cldEngine.js`
4. Advanced analyses POST the model JSON to the Flask backend
5. Backend returns time-series data + base64-encoded Matplotlib plots
6. Results rendered in `js/Out/Outputs.js`

### Backend (`backend/`)

- **`app.py`** — Main Flask app with ~18 API endpoints. CORS is configured for `localhost:5501`, `localhost:3000`, and the production Vercel domain.
- **`advanced_analysis.py`** — The simulation engine (ported from Jupyter notebooks). Implements two-phase signal propagation with delay-aware temporal lookback, retention/decay modeling, floor/ceiling constraints, and rolling Z-score stability classification.

Key endpoints:
| Endpoint | Purpose |
|---|---|
| `/advanced-simulation` | Two-phase high-fidelity simulation |
| `/advanced-stability-map` | Parameter space sweep |
| `/cycle-analysis` | Feedback loop detection |
| `/crisis-analysis` | Crisis detection |
| `/generate-stability-map` | Stability maps |
| `/generate-decay-retention-map` | Decay/retention maps |
| `/random-seeds` | Sensitivity analysis |
| `/create-checkout-session` | Stripe payment |

### Frontend module layout (`v1.1/js/`)

- **`Core/`** — `Loopy.js` (app controller), `Model.js`, `Node.js`, `Edge.js`
- **`Tools/`** — UI tools: `Toolbar.js`, `Sidebar.js`, `PlayControls.js`, `SavedModels.js`, `Undo/Redo`
- **`Libraries/`** — `cldEngine.js` (in-browser simulation), `cldEngineIntegration.js` (backend bridge), `minpubsub.js` (pub/sub event bus), `math.js`, `helpers.js`
- **`python/`** — Per-analysis JS modules that call backend endpoints: `advancedAnalysis.js`, `cldAnalysis.js`, `cycleAnalysis.js`, `crisisAnalysis.js`, etc.
- **`Out/Outputs.js`** — Renders all analysis results/plots in the UI

### Event system

Components communicate via `minpubsub.js` (publish/subscribe). Avoid direct coupling between `Core/`, `Tools/`, and `python/` modules — use pub/sub instead.

### Model persistence

Save/load is handled via Firebase (authentication + storage) in `v1.1/firebase.js` and `js/Tools/SavedModels.js`.

## CORS & environment

The backend CORS allowlist is hardcoded in `app.py` (lines ~43–48). When adding new origins, update that list. The Stripe API key is currently hardcoded in `app.py` — move it to an environment variable before any production changes.

## Deployment

- Frontend deploys to Vercel (static)
- Backend deploys to Vercel Python runtime; routes configured in `backend/vercel.json`
