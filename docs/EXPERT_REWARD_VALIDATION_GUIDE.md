# FlowCLD Blinded Expert Reward Study

## Purpose

FlowCLD can only optimize what its reward measures. Before expanding the
learning system, domain experts need to confirm that the current score orders
complete graph outcomes the same way they do. This study tests that question;
it does not test which policy is best and does not train a policy.

The frozen study covers five contrasts:

1. stabilizing while preserving useful target activity;
2. objective-relevant disruption versus arbitrary damage;
3. spectral stability versus signal extinction;
4. bounded structural edits;
5. a stable homogeneous graph that gradually approaches zero.

## Files and blinding

Give reviewers only:

- `reward-study-v1/expert_review_packet.md`;
- the `reward-study-v1/plots/` directory;
- a separate copy of `reward-study-v1/ranking_template.csv` for each reviewer.

Do not give reviewers `answer_key.json`. It contains candidate provenance,
actions, current model scores, and weights for later analysis. Expert-facing
files use deterministic opaque `SCN-*` and `OUT-*` identifiers and do not name
candidate-generation policies or display composite reward values.

The packet is deterministic for schema version, seed, horizon, and source code.
The default packet uses seed `20260722` and horizon `40`.

## What the expert judges

Each scenario has two distinct tasks:

- **Task A, outcome desirability:** rank the resulting trajectories and graph
  state without considering intervention effort.
- **Task B, transition desirability:** rank whether the result justified the
  required parameter and structural changes.

For each task, rank `1` as best. Genuine ties share a dense rank, such as
`1, 1, 2`; do not use competition ranks such as `1, 1, 3`. Mark candidates that
are unacceptable even if they still receive a relative rank. Enter confidence
from `1` (low) to `5` (high), and briefly state the main reason.

A full review contains 68 judgments across 34 outcomes and normally takes
about 45-75 minutes. Reviewers may complete one scenario at a time, but the
final CSV must contain every row.

## Commands

Run from `backend/` with dependencies from `requirements.txt` installed:

```bash
python run_reward_expert_study.py generate \
  --output ../docs/reward-study-v1 \
  --seed 20260722 \
  --horizon 40

python run_reward_expert_study.py validate \
  --study ../docs/reward-study-v1 \
  --rankings /path/to/completed-rankings.csv

python run_reward_expert_study.py analyze \
  --study ../docs/reward-study-v1 \
  --rankings /path/to/completed-rankings.csv \
  --output /path/to/analysis
```

The validator requires exact columns and complete coverage for each expert. It
rejects unknown IDs, missing or duplicate rows, invalid booleans, out-of-range
confidence, and invalid tie sequences. Multiple experts can be concatenated
into one CSV when each uses a distinct non-personal `expert_id`.

## Analysis and interpretation

The report includes scenario and cross-scenario tie-aware Spearman correlation,
pairwise agreement, per-expert results, inter-rater agreement, stabilizer versus
disruptor summaries, confidence-weighted sensitivity, current-component
ablations, continuous activity comparisons, and high-score outcomes rejected
by at least half of experts.

The continuous activity fields are candidate diagnostics, not reward changes:
final magnitude, tail mean, integrated activity, time above a relative
threshold, similarity to baseline activity, and late-window minimum. They use
absolute magnitudes, safe zero baselines, bounded preservation scores, and an
explosion guard.

Recommended starting thresholds are Spearman `0.60`, pairwise agreement `0.70`,
and at least four outcomes per comparison. These are predeclared review gates,
not scientifically validated constants. Real rankings, inter-rater review, and
domain approval are required before setting a validation status.

Consider changing a reward weight or activity metric when disagreement is
consistent across experts and held-out outcomes, an ablation materially
improves agreement, or a continuous activity metric distinguishes accepted
damping from expert-rejected collapse. Re-run the study on held-out outcomes
after changes; do not tune and claim success on the same rankings.

The current four policy benchmark fixtures are engineering smoke tests. They
are too few, too synthetic, and not expert-ranked, so they cannot support a
policy-performance or research claim.

## Limits

This package does not fabricate expert responses. It also does not yet fully
calibrate node-removal, edge-removal, and invalid-action penalties; additional
expert-approved transition examples are required for those terms. No learning
algorithm, Team Workspace control, GIS feature, or simulation contract is
changed by this study.
