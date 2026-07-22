# Meeting Summary: FlowCLD Reward Validation

## The question

Before we make the agents more capable, we need to know whether the score they
optimize matches expert judgment. The study asks whether FlowCLD ranks stable
and disruptive outcomes in the same order as domain experts.

## What Dr. Oet receives

- Five short blinded scenarios and 34 candidate outcomes.
- Consistent trajectory plots and graph summaries.
- Stability, activity, transmission, and target-fit diagnostics.
- Two rankings per scenario: first the outcome itself, then whether the change
  was worth its intervention cost.

Candidate IDs are random-looking and stable. The packet does not identify the
method that generated a candidate and does not show the current composite
reward. Review time is approximately 45-75 minutes.

## What we learn

We compare the rankings with the current reward using Spearman correlation and
pairwise agreement. We also examine reviewer agreement, stabilizer and
disruptor cases separately, remove reward components one at a time, and compare
the existing binary activity check with more sensitive continuous diagnostics.

The result remains exploratory until real experts complete the packet and agree
that the scenarios and thresholds represent the research question. The default
thresholds are proposed review gates, not a claim of validation.

## Decision requested in the meeting

1. Confirm that each team role, target, protected constraint, and desirable
   behavior is stated correctly.
2. Confirm whether the five scenarios expose the important tradeoffs.
3. Complete or assign the blinded rankings.
4. Agree on what level of rank agreement is sufficient before reward revision
   or larger four-team experiments.

The next engineering decision should follow those rankings. We should not add
another RL algorithm based only on the existing small policy benchmark.
