# Reward Validation Protocol

**Study schema:** `flowcld.reward-study.v1`

This protocol validates the existing FlowCLD team objective. It does not train
or add an RL algorithm. Results remain exploratory until domain experts provide
the target scope, ranks, and acceptance thresholds.

## Current reward being tested

For objectives without a spectral target, the stabilizer potential is:

```text
0.65 * canonical_health + 0.25 * target_fit + 0.10 * target_activity
```

For an objective with a spectral target, it is:

```text
0.45 * canonical_health + 0.15 * target_fit
+ 0.10 * target_activity + 0.30 * spectral_target_fit
```

A disruptor receives the negative of the same stabilizer potential. Transition
rewards then apply potential-based shaping and subtract move costs. The expert
rank for a disruptor study must therefore describe what is best for that
disruptor, not what is best for the overall system.

## Required blinded workflow

1. Define one team's owned nodes, target subgraph, intended trajectories or
   behavior, and orientation with domain experts.
2. Freeze candidate graph outcomes and their complete simulation histories.
3. Hide all reward scores and algorithm labels from reviewers.
4. Have experts rank the outcomes for that team's stated objective. Rank `1` is
   best; equal ranks are allowed for ties.
5. Agree on minimum Spearman correlation, pairwise agreement, and sample count
   before calculating reward agreement.
6. Run `RewardValidationStudy` on the frozen outcomes.
7. Review the baseline and every leave-one-component-out ablation. A component
   that prevents collapse should materially reduce agreement when removed from
   a study containing plausible collapse outcomes.
8. Revise weights or objective definitions, then validate on a held-out outcome
   set. Do not tune and report performance on the same rankings.

The original programmatic template remains at
`docs/reward-validation/expert-ranking-template.json`. For an actual review,
use the reproducible packet in `docs/reward-study-v1/` and the workflow in
`docs/EXPERT_REWARD_VALIDATION_GUIDE.md`. That packet separates outcome
desirability from transition-cost desirability and keeps provenance and model
scores in a private answer key.

From `backend/`, regenerate and verify the packet with:

```bash
python run_reward_expert_study.py generate --output ../docs/reward-study-v1
python run_reward_expert_study.py validate --study ../docs/reward-study-v1 --rankings completed.csv
python run_reward_expert_study.py analyze --study ../docs/reward-study-v1 --rankings completed.csv --output analysis
```

The generated study uses schema `flowcld.expert-reward-study.v1`; completed CSV
rankings use `flowcld.expert-ranking.v1`. The validator rejects unknown IDs,
missing candidates, duplicate rows, malformed confidence values, and
non-dense ties.

## Programmatic use

```python
from flowcld_env import (
    Objective,
    RankedGraphOutcome,
    RewardValidationStudy,
    RewardValidationThresholds,
)

thresholds = RewardValidationThresholds(
    minimum_spearman=agreed_spearman,
    minimum_pairwise_agreement=agreed_pairwise,
    minimum_outcomes=agreed_sample_count,
)
report = RewardValidationStudy(horizon=200).run(
    ranked_graph_outcomes,
    objective,
    thresholds,
)
report_data = report.to_dict()
```

The report preserves each outcome's raw health, fit, activity, and spectral-fit
components, the resulting score, rank-agreement metrics, and all ablations. It
is explicitly labeled `exploratory_diagnostic`; passing the declared thresholds
does not by itself certify a broader research claim.

## What still requires experts

The software cannot decide whether a target subgraph represents the intended
geoeconomic objective, whether a disruption is meaningful rather than arbitrary
damage, or what agreement threshold is scientifically sufficient. Action costs,
structural penalties, and minimum-activity constraints also require separately
ranked transition examples. Those decisions must be recorded before large-scale
four-team training is treated as research-reportable.

The current packet includes parameter and bounded structural contrasts, but it
does not contain enough expert-approved node-removal, edge-removal, or invalid
action examples to calibrate every individual penalty. Those terms remain
explicit follow-up work rather than validated conclusions.
