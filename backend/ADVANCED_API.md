# Advanced Analysis API

The backend now includes advanced two-phase simulation capabilities extracted from your Jupyter notebook. These provide more accurate and sophisticated analysis compared to the original endpoints.

## New Endpoints

### 1. `/advanced-simulation` (POST)

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

### 2. `/advanced-stability-map` (POST)

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
  
  const response = await fetch('http://localhost:5000/advanced-simulation', {
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
curl -X POST http://localhost:5000/advanced-simulation \
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

## Next Steps

1. **Update your frontend** to call these new endpoints
2. **Keep old endpoints** for backward compatibility
3. **Add loading indicators** for long-running stability maps
4. **Cache results** if running the same analysis multiple times


