# Flow-CLD Technical Overview

## Document status

- **Primary notebook reviewed:** `flowclddebugging/Flow-CLD_fixed_v4.ipynb`
- **Application engine:** `backend/advanced_analysis.py`
- **Agent environment:** `backend/flowcld_env/`
- **Professor handoff:** `Flow-CLD Reinforcement Learning Work: Handoff to Sahil Shah`
- **Last reviewed:** July 13, 2026

This document explains what the current notebook does, how the application uses
that logic, which reinforcement-learning components now exist around it, and
what remains before the research system can be treated as validated.

## Simple understanding

Flow-CLD represents a system as a directed graph. Nodes represent quantities or
conditions. Edges represent causal influence. The notebook repeatedly updates
the graph to show how every node changes over time.

At each timestep, the notebook:

1. Carries part of each node's current value forward using retention.
2. Adds delayed influence from incoming edges.
3. Applies floors and ceilings to stock nodes.
4. Calculates formula-driven converter nodes.
5. Applies source and sink formulas.
6. Stores the new values and repeats.

The notebook can then ask several questions:

- Does the model settle, oscillate, collapse, or grow without constraint?
- Which nodes and feedback loops are structurally important?
- How sensitive is the model to retention, edge decay, and delay?
- How uncertain are the simulated paths when relationship confidence is low?
- Which parameter settings produce the best compromise between stability,
  activity, transmission, and non-collapse?

The reinforcement-learning layer reverses the normal workflow. Instead of only
asking what behavior a fixed graph produces, it asks which legal changes could
make the graph produce a requested behavior.

```text
Graph + parameters
        |
        v
Two-phase simulation
        |
        v
Time series + stability measurements
        |
        v
Score the result against an objective
        |
        v
Optimizer or agent proposes the next legal change
```

## 1. Current notebook responsibilities

The notebook currently combines five responsibilities in one executable cell.

| Responsibility | Current implementation |
|---|---|
| Model editing | `ipywidgets` rows for nodes and edges |
| Configuration loading | Embedded defaults or normalized `.loopy`/JSON data |
| Simulation | Delay-aware `simulate_two_phase` propagation |
| Analysis | Graph, distribution, DMD, stability, fan-chart, and parameter-space analysis |
| Optimization | Uniform global search followed by unique local refinement |

*Notes: These responsibilities work together, but their placement in one cell makes independent testing and reuse harder.*

## 2. Graph data model

The notebook converts UI rows or imported configuration into a NetworkX
`DiGraph`.

### Node attributes

| Attribute | Meaning |
|---|---|
| `start_amount` | Value at simulation time zero |
| `retention` | Fraction of the prior value carried into the next step |
| `floor` | Constant or expression-based lower bound |
| `ceiling` | Constant or expression-based upper bound |
| `formula` | Optional converter expression |
| `sink_formula` | Optional post-update sink expression |
| `source_formula` | Optional post-update source expression |

*Notes: Retention zero marks a converter. Positive retention marks a stock in the current engine.*

### Edge attributes

| Attribute | Meaning |
|---|---|
| `correlation` | Signed causal strength |
| `decay` | Fraction of causal transmission removed |
| `confidence` | Relationship certainty used by uncertainty simulations |
| `delay` | Discrete lag in timesteps |

*Notes: Deterministic mean simulation does not scale edge influence by confidence. Confidence controls Monte Carlo uncertainty.*

The deterministic edge coefficient is:

```text
effective edge factor = correlation * (1 - decay)
```

## 3. Configuration loading

The notebook supports:

- Embedded Python defaults.
- Dict-based JSON with common field aliases.
- Positional `.loopy` node and edge arrays.
- Numeric node IDs that map to labels.
- URL-decoded node names.
- Formula, bound, confidence, and delay defaults.

The loader normalizes incoming data to a graph specification and then populates
the same widget rows used by manual editing. This keeps one UI-to-graph path
inside the notebook.

The current positional importer still relies on index conventions and
heuristics. A named, versioned schema would be safer for long-term interchange.

## 4. Two-phase simulation engine

Let `x_i(t)` be the stored value of node `i` at timestep `t`. Let `r_i` be its
retention. Let `w_ji` be the effective factor on edge `j -> i`, and `d_ji` its
delay.

For ordinary stock nodes, the unbounded next value is approximately:

```text
nxt_i = r_i * x_i(t) + sum_j[x_j(t - d_ji) * w_ji]
```

The current implementation proceeds in four phases.

### Phase A: retention and delayed inflows

- Initialize every `nxt` value to zero.
- Add retained current value for every node.
- Add delayed incoming edge contributions.
- Use zero when an edge requests history before time zero.

### Phase B: commit stock nodes

- Nodes with retention greater than zero are treated as stocks.
- Dynamic floor and ceiling expressions are evaluated.
- `numpy.clip` applies the resulting bounds.
- Converter nodes receive a temporary `None` placeholder.

### Phase C: evaluate converter nodes

- Nodes with retention zero are treated as converters.
- Delay-aware predecessor inputs are collected.
- A converter formula can access `t`, `inputs`, `history`, `raw`, `nxt`,
  `math`, and `numpy`.
- Without a formula, the converter equals the sum of its effective inputs.
- Converter bounds are evaluated after the formula.
- Formula failure falls back to the previous converter value.

### Phase D: source and sink handling

The canonical contract evaluates source and sink expressions after stock and
converter updates and multiplies the node's value by each resulting factor.
Sink is applied first, then Source. Formula errors use a neutral factor of
`1.0`. The notebook runtime bindings, backend, Canvas engine, Tables guidance,
and Formula Editor now use this same behavior.

## 5. Simulation outputs

The primary run produces a history dictionary:

```text
node name -> [initial value, step 1 value, ..., final value]
```

The notebook renders this as an interactive Plotly chart with pan, zoom, hover,
and legend isolation. It also saves HTML and image outputs to a user-selected
folder.

## 6. Dynamic Mode Decomposition

Dynamic Mode Decomposition, or DMD, approximates a linear operator that maps
one multivariate timestep to the next. The notebook:

1. Builds a node-by-time matrix.
2. Fills converter placeholders forward and backward.
3. Optionally mean-centers each node.
4. Forms consecutive snapshot matrices `X1` and `X2`.
5. Uses truncated singular value decomposition.
6. Computes discrete DMD eigenvalues and modes.
7. Converts eigenvalues to continuous-time rates and oscillation periods.

The notebook imports the reusable `backend/dmd_analysis.py` implementation,
which uses a principal complex logarithm for DMD eigenvalues.
This correctly handles negative discrete eigenvalues. Zero eigenvalues are
represented as infinitely decaying modes, and non-oscillatory modes receive no
finite period. This replaced the earlier real-log and eager-division warnings.

## 7. Graph and distribution analysis

The analysis callback currently provides:

- Directed feedback-cycle enumeration and polarity.
- Node participation counts across positive and negative cycles.
- Degree, betweenness, closeness, and eigenvector centrality.
- A PyVis network export.
- Synthetic correlation heatmaps.
- Per-node Gaussian mixture models.
- KDE modes for original and synthetic distributions.
- Suggested starting values based on mixture-component certainty.
- CSV exports for selected diagnostics.

The GMM and synthetic-correlation sections operate on generated random data in
the current notebook. They are diagnostics and demonstrations, not inference
from observed banking data unless real observations are supplied separately.

## 8. Stability and behavior analysis

The notebook uses several related measurements.

### Eigenvalue measurements

Adjacency-like matrices are built and their eigenvalues are compared with the
unit circle. Maximum eigenvalue magnitude is used as a conventional linear
stability indicator in some plots. Other maps use an average-magnitude distance
metric.

### Rolling Z scores

Each time series is standardized against a rolling mean and standard deviation.
The maximum absolute rolling Z score identifies large local deviations.

### Behavior classification

Nodes are classified as:

- **Over-damped:** near zero or nearly flat.
- **Unconstrained:** extreme growth plus a positive logarithmic slope.
- **Optimal:** neither of the above.

### Shape penalties

The combined maps penalize:

- Flat signals.
- Extreme rolling Z values.
- Excessive zero crossings.
- Near-total edge decay.

The distinct matrix conventions are now explicit: the runtime linear matrix
uses actual retention and `correlation * (1 - decay)`; the uniform sweep matrix
uses `1 - decay_factor` and `decay_factor * correlation`; and the legacy
loop-through diagnostic uses `1 - decay_factor` with unscaled correlations.
Only the first is the delay-free linear spectral model of runtime propagation.

## 9. Monte Carlo fan charts

Fan charts combine two uncertainty mechanisms:

1. Resample edge correlation according to edge confidence.
2. Add per-step multiplicative process noise to every node.

High-confidence relationships produce narrow bands. Low-confidence
relationships produce wider bands and may permit sign changes. The output shows
median, interquartile, and 5th-to-95th percentile paths.

Deterministic and Monte Carlo paths now use the same propagation function. The
Monte Carlo path injects a noise strategy and correlation samples without
duplicating the four simulation phases.

## 10. Parameter-space analysis

The notebook sweeps combinations of:

- Uniform node retention.
- Uniform edge decay.
- Uniform edge delay.

It produces:

- Behavior-classification maps.
- Eigen-distance and rolling-Z maps.
- Combined penalty heatmaps.
- Retention-versus-decay maps.
- Retention-versus-delay maps.
- A 3D retention, decay, and delay point cloud.
- Slider-based 2D slices through the 3D parameter space.

The 3D function returns a table of raw points and ranks configurations into 11
color bins. The application now follows the same raw-data approach for
client-side visualization rather than sending rendered 2D images.

## 11. Parameter optimizer

The notebook optimizer is not reinforcement learning. It is a two-stage search
over parameter configurations.

### Phase 1: global uniform search

- Apply one retention to eligible nodes.
- Apply one decay and delay to every edge.
- Evaluate a grid or random sample.
- Rank candidates by composite score.

### Phase 2: unique local refinement

- Convert several top uniform candidates to per-node and per-edge maps.
- Adjust high-degree nodes and high-correlation edges first.
- Use coarse, medium, and fine step schedules.
- Optionally accept worse moves through simulated annealing.
- Refine several Phase 1 seeds rather than only one.

Lower optimizer score is better. The score combines notebook stability metrics
with explicit protections against solutions that merely turn the model off.

| Score group | Purpose |
|---|---|
| Eigen and behavior | Penalize instability and undesirable behavior classes |
| Rolling Z and shape | Penalize extreme, flat, or excessively oscillatory paths |
| Survival | Penalize dead nodes and weak terminal or late-window activity |
| Drift and overflow | Penalize continued late movement and numerical explosion |
| Transmission | Penalize excessive decay and weak effective edge influence |
| Concentration | Penalize terminal outcomes dominated by a few nodes |
| Parameter barriers | Discourage retention, decay, or eigenvalues from hugging boundaries |
| Action time | Optional runtime penalty, currently zero in the presets |

*Notes: Balanced, stability-first, and responsive presets change the relative weights without changing the component definitions.*

## 12. Relationship to the application and RL layer

The notebook itself does not train an RL policy. The application wraps its
simulation and scoring concepts in separable backend services.

| Layer | Current application responsibility |
|---|---|
| Notebook adapter | Calls canonical simulation and optimizer scoring |
| Environment | Applies one authorized action, simulates, scores, and logs it |
| Objective evaluator | Combines notebook health, target fit, and target activity |
| Controlled Edits | Validates structural transactions before Canvas mutation |
| Team Workspace | Coordinates role-based objectives on one shared graph |
| Greedy policy | Selects the best immediate legal move |
| Epsilon-greedy policy | Learns incremental rewards for interpretable action families from committed transitions |
| Actor-critic policy | Learns action preferences and a future-value baseline |
| Deployment goal guard | Simulator-checks learned choices and completes stalled spectral targets with legal planner steps |
| Planner | Performs bounded simulator-based lookahead |
| Evaluation harness | Compares random, greedy, and learned policies on matched seeds |
| League harness | Measures fixed policy profiles and unilateral deviation gains |

*Notes: Only one team currently learns at a time. Other teams remain frozen during training.*

The learned policy uses graph-aware fixed-width features, a lightweight linear
actor, and a linear critic. It is an implementation baseline. It is not yet a
full deep graph neural network policy.

## 13. Current implementation status

The following foundation is present in the codebase:

- Notebook-backed two-phase simulation adapter.
- Target trajectory and target behavior objectives.
- Parameter actions with bounds and role permissions.
- Structural transactions with anti-collapse constraints and bounded autonomous proposals.
- Single-agent bounded optimization.
- Multi-team turn coordination and Canvas replay.
- N-step actor-critic training.
- Serializable epsilon-greedy action-value training with train/evaluation separation.
- Frozen hold, random, and greedy opponents.
- Depth-limited planning.
- Seed-matched random, greedy, and learned benchmarks.
- Fixed-policy league evaluation and an empirical NashConv-style proxy.

The app's Stage 5 label refers to this software foundation. It does not mean the
professor's final four-team geoeconomics research milestone is validated.

## 14. Left to do

### Completed parity foundation

1. `flowcld.simulation.v1` defines multiplicative Sink and Source factors,
   delay/prehistory behavior, converter ordering, bounds, error handling, and
   edge functional forms.
2. The notebook runtime, backend, Canvas engine, import path, and help text use
   that contract.
3. Runtime linear, uniform sweep, and legacy loop-through matrices have distinct
   names and documented purposes.
4. Five versioned fixtures compare every Python and browser timestep. The
   notebook binds to the same Python function, so it does not maintain a second
   runtime propagation implementation.

### Priority B: make the notebook testable and maintainable

1. Loading, plotting, and optimization callbacks still need extraction from the
   notebook's original all-in-one cell. Simulation and DMD are reusable modules.
2. Deterministic and noisy propagation now share one engine with injectable
   process noise.
3. The active notebook and backend path use the constrained formula evaluator.
   The legacy definitions remain in the notebook cell for compatibility but are
   rebound to the safe implementation after setup.
4. Focused tests cover delays, converter dependencies, dynamic bounds, formulas,
   DMD rank-zero input, and non-finite/overflow behavior.
5. Per-node notebook plots still need one shared Monte Carlo path cache.
6. Global state still needs removal from parameter sweeps and plotting callbacks.
7. `flowcld.model.v1` is the named interchange schema. Positional `.loopy`
   parsing remains a compatibility adapter.

### Priority C: validate the reward scientifically

1. `RewardValidationStudy` now compares the current named weight profiles with
   blinded expert ranks using Spearman and pairwise agreement.
2. Leave-one-component-out ablations are implemented for health, fit, activity,
   and spectral fit.
3. Domain experts still need to define each target subgraph, rank candidate
   outcomes, and set acceptance thresholds before scores are calculated.
4. Disruptor studies must establish that preferred outcomes represent meaningful
   adversarial behavior rather than arbitrary damage.
5. Action costs, structural penalties, and minimum-activity rules still require
   separately ranked transition examples and calibration.

### Priority D: complete the research-grade RL work

1. Define the real red, blue, black, and green team ownership, permissions, and
   objectives for the geoeconomics graphs.
2. Train and evaluate on multiple graphs rather than one model instance.
3. Report distributions across seeds, confidence intervals, and failure cases.
4. Replace or compare the linear policy with a true graph neural network when
   graph scale justifies it.
5. Compare the current capped structural-motif generator with a learned decomposed
   endpoint policy before expanding add-edge search on large graphs.
6. Add persistent, versioned policy checkpoints if learned policies must be
   reused outside one request. Keep private model artifacts local by default.
7. Implement and separately validate MCTS or Dyna planning before claiming those
   capabilities.
8. Implement frozen-policy populations and PSRO before making equilibrium or
   population self-play claims.
9. Evaluate reciprocity, coalition behavior, and adversarial robustness on the
   intended four-team setting.

### Priority E: product and operations

1. Add progress reporting and cancellation for long optimization and training
   requests.
2. Add saved team/objective templates for the intended classroom scenarios.
3. Add end-to-end browser tests for Canvas replay and accepted structural edits.
4. Validate production timeout, CORS, memory, and concurrency behavior under
   realistic training loads.
5. Document which outputs are exploratory diagnostics and which are suitable for
   research reporting.

## 15. Recommended next milestone

The next milestone should be a parity and reward-validation package, not another
learning algorithm.

1. Five representative model fixtures are frozen.
2. Source, Sink, and edge-functional-form semantics are resolved in contract v1.
3. Notebook, backend, and browser runtime parity is enforced through shared
   functions and the golden timestep fixtures.
4. Domain experts must now rank candidate outcomes using the blinded template.
5. Run those ranks through the reward-validation and ablation report, then revise
   and revalidate the objective if it misses predeclared thresholds.
6. Only then scale actor-critic training to the four-team geoeconomics setting.

This sequence reduces the main research risk: building an increasingly capable
agent that optimizes a score which does not represent the intended dynamics.
