# Frontend Model Validation Boundary

The Canvas `Model` remains FlowCLD's only live graph state. TypeScript is being
introduced incrementally at graph boundaries; this is not a framework rewrite
and does not create a second store.

## Current boundary

`v1.1/ts/GraphModelGateway.ts` defines the typed `flowcld.model.v1` contract and
performs runtime validation for:

- named nodes and unique labels,
- finite start, retention, correlation, decay, confidence, and delay values,
- floor/ceiling types and static ordering,
- plain-text optional formulas,
- supported edge functional forms, and
- edge endpoints that reference existing nodes.

The gateway currently protects:

1. Canvas-to-simulation conversion,
2. advanced-analysis API request serialization,
3. backend-frame replay onto the Canvas, and
4. inline Nodes/Edges table edits.

`v1.1/ts/LoopyImportGateway.ts` is the compatibility adapter for positional
`.loopy` files. It detects the native and fcld layouts, decodes the complete
file into a named candidate, and delegates graph validation to
`GraphModelGateway`. `Model.deserialize()` does not clear the Canvas until the
candidate is valid, and restores the prior snapshot if committing the candidate
unexpectedly fails.

`v1.1/ts/TeamRequestGateway.ts` defines the versioned
`flowcld.team-session.v1` request contract. It validates team objectives,
permissions, numeric settings, learning settings, safety references, and move
shapes before transport. Authorization and structural acceptance remain in the
backend environment because rejected legal-shape moves are part of the audited
session result.

Candidate table edits are validated before the corresponding live `Node` or
`Edge` object is mutated. The Tables view still publishes the existing
`model/changed` event after successful edits, so Canvas, Tables, undo, and
autosave continue to observe one model.

The Flask backend independently validates requests in
`advanced_analysis.build_graph_from_payload`; browser validation is never the
only trust boundary.

## Build and test

```bash
npm ci
npm run build:frontend-types
npm run test:frontend
```

The TypeScript build emits tracked static-browser artifacts under
`v1.1/js/Validation/`. CI rebuilds them and fails if generated files differ
from their TypeScript sources.

## Next migration targets

- Convert `TablesView` and API clients to TypeScript after their boundaries are
  stable.
- Migrate Canvas rendering classes only when tests demonstrate a concrete
  benefit; they do not need to move merely to make the boundary typed.
