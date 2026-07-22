# Advanced Analysis API

The backend now includes advanced two-phase simulation capabilities extracted from your Jupyter notebook. These provide more accurate and sophisticated analysis compared to the original endpoints.

## New Endpoints

### 1. `/simulation/two-phase` (POST)

Runs the advanced two-phase propagation simulation with delay-aware dynamics.

**Request:**
```json
{
  "nodes": [
    {
      "name": "node1",
      "start_amount": 0.1,
      "retention": 0.9,
      "floor": -999999,
      "ceiling": 999999
    }
  ],
  "edges": [
    {
      "source": "node1",
      "target": "node2",
      "correlation": 0.5,
      "decay": 0.1,
      "delay": 2,
      "confidence": 0.8
    }
  ],
  "iterations": 200
}
```

**Response:**
```json
{
  "success": true,
  "time_series_data": {
    "node1": [0.1, 0.09, 0.081, ...],
    "node2": [0.0, 0.0, 0.05, ...]
  },
  "classifications": {
    "node1": "Optimal",
    "node2": "Over-damped"
  },
  "plots": {
    "time_series": "data:image/png;base64,iVBOR...",
    "z_scores": "data:image/png;base64,iVBOR..."
  }
}
```

**Classifications:**
- **Over-damped**: Node value dies out quickly (stable but unresponsive)
- **Optimal**: Good balance between stability and responsiveness
- **Unconstrained**: Node value grows exponentially (unstable)

### 2. `/parameter-maps/stability-sweep` (POST)

Generates a parameter space stability map by sweeping decay and delay values.

**Request:**
```json
{
  "nodes": [...],
  "edges": [...],
  "decay_range": [0.0, 1.0, 11],    // [min, max, steps]
  "delay_range": [0, 10, 11],       // [min, max, steps]
  "iterations": 200
}
```

**Response:**
```json
{
  "success": true,
  "stability_matrix": [[0.2, 0.6, 1.0, ...], ...],
  "decay_values": [0.0, 0.1, 0.2, ...],
  "delay_values": [0, 1, 2, ...],
  "plot": "data:image/png;base64,iVBOR..."
}
```

The stability_matrix values represent:
- **0.2**: Over-damped behavior
- **0.6**: Optimal behavior
- **1.0**: Unconstrained behavior

### 3. `/agent/structural-edits/preview` (POST)

Validates a Stage 3 structural transaction against the current graph. The
backend remains stateless and returns a private candidate for explicit browser
application.

```json
{
  "nodes": [{"name": "A", "start_amount": 0.1, "retention": 0.8}],
  "edges": [],
  "edits": [
    {"kind": "add_node", "name": "B", "start_amount": 0.1, "retention": 0.8},
    {"kind": "add_edge", "source": "A", "target": "B", "correlation": 0.6}
  ],
  "protected_nodes": [],
  "protected_edges": [],
  "required_paths": [],
  "iterations": 50,
  "seed": 42
}
```

An accepted response includes `transaction`, `summary`, `candidate`, reward
components, and the current structural action mask. Rejections return HTTP 200
with `accepted: false` and a constraint-specific `reason`; malformed requests
return HTTP 400.

## How to Convert Frontend Data

If you're using the existing Loopy frontend, you'll need to convert the data format:

```javascript
// Example conversion from Loopy format to advanced API format
function convertToAdvancedFormat(loopyModel) {
  const nodes = loopyModel.nodes.map(node => ({
    name: node.label,
    start_amount: node.init || 0.1,
    retention: 1.0 - (node.decay || 0.1),  // Convert decay to retention
    floor: node.floor !== undefined ? node.floor : -999999,
    ceiling: node.ceiling !== undefined ? node.ceiling : 999999
  }));
  
  const edges = loopyModel.edges.map(edge => ({
    source: edge.from,
    target: edge.to,
    correlation: edge.strength,  // Use your polarity * strength
    decay: edge.decay || 0.1,
    delay: edge.delay || 0,
    confidence: edge.certainty || 1.0
  }));
  
  return { nodes, edges, iterations: 200 };
}

// Call the API
async function runAdvancedSimulation(loopyModel) {
  const data = convertToAdvancedFormat(loopyModel);
  
  const response = await fetch('http://localhost:5000/simulation/two-phase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  
  const result = await response.json();
  
  // Display the plots
  document.getElementById('time-series-img').src = `data:image/png;base64,${result.plots.time_series}`;
  document.getElementById('z-scores-img').src = `data:image/png;base64,${result.plots.z_scores}`;
  
  // Show classifications
  console.log('Node classifications:', result.classifications);
  
  return result;
}
```

## Key Differences from Original Endpoints

| Feature | Original | Advanced |
|---------|----------|----------|
| **Propagation** | Simple accumulation | Two-phase (stocks + converters) |
| **Delays** | Buffer-based | Delay-aware lookback |
| **Stability** | Basic classification | Rolling Z-scores + eigenvalue analysis |
| **Accuracy** | Approximate | High-fidelity from notebook |
| **Convergence** | May diverge | Better bounded behavior |

## Running the Backend

The backend is already running (started earlier). The new endpoints are available immediately:

```bash
# Backend is running at:
http://localhost:5000

# Test it:
curl -X POST http://localhost:5000/simulation/two-phase \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [
      {"name": "A", "start_amount": 0.5, "retention": 0.9},
      {"name": "B", "start_amount": 0.3, "retention": 0.85}
    ],
    "edges": [
      {"source": "A", "target": "B", "correlation": 0.7, "decay": 0.1, "delay": 2, "confidence": 1.0}
    ],
    "iterations": 100
  }'
```

## Performance Notes

- **Advanced simulation**: ~1-5 seconds for 200 iterations with 10-20 nodes
- **Stability map**: Can take 30-60 seconds for 11×11 grid (121 simulations)
- Consider reducing `iterations` or grid resolution for faster results during development

## Implementation Notes

- The production frontend calls the descriptive endpoint paths listed here.
- Long-running simulation and parameter-map actions expose loading states.
- Controlled structural edits are previewed server-side and applied only to the
  existing Canvas model after acceptance.

## Stage 5 Team Sessions and Learned Policies

### Deterministic connected-model balance

`POST /agent/model-balance/run` creates a bounded parameter-only plan for a
connected directed graph. The request accepts `target_spectral_radius`,
`adjust_retention`, `adjust_decay`, `min_retention`, and `max_decay` in addition
to the normal graph and simulation fields. The legacy
`POST /agent/simple-balance/run` path remains available for the two-node starter.

The planner uses the notebook transition matrix, prioritizes influential nodes
and edges, preserves graph structure and edge correlation, and enforces a
minimum effective-transmission ratio. Its response contains `model_balance`
diagnostics, notebook baseline/final evaluations, warnings for delayed or
formula-driven models, and a before/after change table. Plans with more than two
nodes are previews and require an explicit Canvas apply action in the browser.

`POST /agent/team-sessions/run` evaluates role-safe team moves against one shared
graph. Each team supplies its stabilize/disrupt orientation, owned and target
nodes, notebook score preset, gamma, move costs, move budgets, live-node floor,
trajectory and/or behavior target, weight, and explicit permissions.
Browser requests identify this DTO with
`request_schema_version: "flowcld.team-session.v1"` and the embedded named graph
with `schema_version: "flowcld.model.v1"`. The backend still accepts an omitted
team-session version for older clients, but rejects unsupported explicit
versions.

`moves` remains an optional ordered manual sequence. `agent_turns` selects
additional moves automatically. `agent_strategy` may be `greedy` or
`actor_critic`. The autonomous action space includes bounded parameter changes,
correlation/polarity flips, and an explicit no-op.

For `actor_critic`, send `learner_team_id`, `training_episodes`, `training_steps`,
`n_step`, `actor_learning_rate`, `critic_learning_rate`, and
`training_temperature`. `opponent_mode` may be `hold`, `random`, or `greedy`, and
`planning_depth` may be 1 to 3. Only the selected team learns. Other teams remain
frozen during training and retain greedy policies during the replay session. Optional
`evaluation_seeds` from 0 to 5 runs seed-matched random, greedy, and learned
comparisons. The response adds a `learning` object containing the return curve,
loss diagnostics, checkpoint digest, optional benchmark means and bands, frozen
league profiles, unilateral-deviation gains, and an empirical NashConv proxy.

The response contains per-team initial, final, and cumulative scores; an
accepted/rejected move log with named reward components; a weighted shared
score after every move; canonical Canvas replay frames; and a deterministic
digest for the complete replay sequence.

The endpoint is stateless. Replay frames are applied only by the browser to the
existing Canvas model, and users can exit replay without retaining changes.
