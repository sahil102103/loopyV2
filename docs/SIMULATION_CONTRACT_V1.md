# FlowCLD Simulation Contract v1

**Contract identifier:** `flowcld.simulation.v1`
**Named model schema:** `flowcld.model.v1`

This contract is implemented by `backend/simulation_engine.py` and
`v1.1/js/Libraries/cldEngine.js`. Notebook code should import the Python engine
instead of maintaining a separate propagation copy. Positional `.loopy` files
remain compatibility inputs; new programmatic interchange should use the named
JSON schema in `docs/schemas/flowcld-model-v1.schema.json`.

## Runtime propagation

For an edge from `source` to `target`:

```text
contribution = correlation * (1 - decay) * functional_form(source_value)
```

Supported forms are `linear`, `tanh`, `quadratic` (`x * abs(x)`), `cubic`,
`relu`, and `step`. Confidence does not change deterministic propagation. It
controls Monte Carlo uncertainty.

At each timestep:

1. Add retained values and delayed edge contributions. Missing prehistory is
   zero.
2. Commit stock nodes (`retention > 0`) after optional process noise and bounds.
3. Evaluate converters (`retention == 0`) in graph insertion order, then apply
   optional process noise and bounds.
4. Multiply each enabled Sink factor, then each enabled Source factor.

Source and Sink expressions are dimensionless post-update multipliers. `1` is
neutral, `0.95` removes 5%, and `1.05` adds 5%. They are not additive flows.

## Formula language

Expressions use the constrained evaluator and may access `t`, `x`, `val`,
`Y0`, `history`, `raw`, `nxt`, `inputs`, `math`, and `np`. Lowercase `math` is
canonical. `Math` remains a compatibility alias for older browser-authored
models. Arbitrary Python or JavaScript execution is not allowed.

The portable expression dialect uses Python-style exponentiation (`x ** 2`)
and conditionals (`a if condition else b`). Canvas Play translates that narrow
syntax into its restricted math evaluator. Boolean results are normalized to
`1` or `0` in both engines.

Invalid converter formulas retain the converter's previous value. Invalid
Source/Sink formulas use factor `1`. Non-finite initial values, edge results,
noise results, final node values, and arithmetic overflow stop the simulation
with an explicit contract error instead of allowing corrupt trajectories.

## Matrix models

The codebase deliberately exposes three separately named matrices:

- **Runtime linear transition matrix:** actual retention on the diagonal and
  `correlation * (1 - decay)` at `[target, source]`. This is the spectral model
  used by graph balancing. It excludes delays, bounds, confidence, formulas,
  and nonlinear edge forms.
- **Uniform sweep transition matrix:** the notebook's legacy parameter-map
  convention, with diagonal `1 - decay_factor` and edges
  `decay_factor * correlation`. It is a sweep diagnostic, not the runtime
  transition matrix.
- **Legacy loop-through diagnostic matrix:** diagonal `1 - decay_factor` with
  unscaled edge correlations. It is retained for the original eigen-cloud
  diagnostic and is neither a runtime linearization nor the parameter sweep.

## Golden fixtures

Five fixtures under `backend/tests/simulation_contract/v1/` freeze trajectories
for linear stocks, delay prehistory, converter dependencies, dynamic bounds
with Source/Sink factors, and every supported edge functional form. Python and
browser tests compare every timestep to the same expected histories.
