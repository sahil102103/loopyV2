# Epsilon-Greedy Policy Baseline

## Status and scope

This is a transparent engineering baseline for the existing FlowCLD
environment. It does not add a simulator, reward function, candidate generator,
or structural mutator. It is not a claim that the current reward has been
scientifically validated.

The browser continues to offer the existing Team Workspace strategies. The
new strategy is intentionally available through the backend configuration and
Python policy API first, so it can be evaluated before adding more product UI.

## Policy contract

`AgentPolicy` has five framework-independent operations:

1. `select_move(...)` chooses one action from the environment's legal moves.
2. `update(PolicyTransition)` observes one action that was actually attempted.
3. `reset(seed=..., training=...)` separates training from evaluation behavior.
4. `state_dict()` emits JSON-compatible state.
5. `load_state_dict(...)` restores compatible state.

Random, greedy, no-op, actor-critic, planning decorators, and epsilon-greedy
continue to use the same graph plus objective plus legal-moves boundary. The
epsilon learner ignores the `value_of` preview callback. A preview can guide
the explicit greedy baseline, but it cannot update learned action values.

## Learning rule

Each legal move maps to an interpretable key containing the objective
orientation and an action family. Examples:

- `stabilize|no_op`
- `stabilize|parameter:retention:node:decrease`
- `disrupt|parameter:correlation:edge:flip_sign`
- `stabilize|structural_transaction:add_edge+add_edge+add_node`

Raw node names, edge names, and numeric values are omitted so the table remains
bounded and can transfer across compatible graph instances. This compression
also means the baseline cannot learn that one named node is a better target
than another within the same action family.

For action-family `a`, the default update is the incremental sample mean:

```text
N(a) <- N(a) + 1
alpha <- 1 / N(a)
Q(a) <- Q(a) + alpha * (reward - Q(a))
```

An optional constant learning rate replaces `1 / N(a)`. In training mode, a
uniform legal action is selected with probability epsilon; otherwise a
highest-value family is selected. Epsilon decays after each update and stops at
the configured floor. Ties are sorted and resolved by a seeded random generator.

This is a contextual bandit, not Q-learning or SARSA. It learns observed
one-transition returns and does not bootstrap from the next state. Rejected
actions are valid learning evidence because the real environment returns their
invalid-action penalty. Only the acting learner is updated.

## Reproducible comparison

Run from `backend/`:

```bash
python run_policy_baseline_benchmark.py \
  --training-episodes 40 \
  --seeds 101,211,307 \
  --output /tmp/flowcld-policy-baseline.json
```

The comparison uses the same graph, candidate generator, safety rules,
simulation horizon, reward, action costs, episode horizon, and evaluation seeds
for no-op, random, greedy preview, untrained epsilon-greedy, trained
epsilon-greedy, and actor-critic. Actor-critic's deployment preview guard is
disabled for this comparison. Each learned method receives 40 training
episodes with the same scenario seed; there is no per-method tuning.

The July 22, 2026 reference run produced these mean cumulative rewards over
three evaluation seeds:

Values are mean +/- population standard deviation.

| Scenario | No-op | Random | Greedy | Epsilon untrained | Epsilon trained | Actor-critic |
|---|---:|---:|---:|---:|---:|---:|
| Stabilizer | -0.0145 +/- 0 | -0.0651 +/- 0.0127 | -0.0145 +/- 0 | -0.0571 +/- 0.0066 | -0.0145 +/- 0 | -0.2932 +/- 0 |
| Disruptor | 0.0145 +/- 0 | -0.0356 +/- 0.0161 | 0.0145 +/- 0 | -0.0250 +/- 0.0049 | 0.0145 +/- 0 | -0.0215 +/- 0 |
| Spectral/activity tension | -0.0101 +/- 0 | -0.0751 +/- 0.0832 | 0.1332 +/- 0 | 0.0137 +/- 0.0576 | -0.0101 +/- 0 | 0.0554 +/- 0 |
| Bounded structural | -0.0105 +/- 0 | -0.0278 +/- 0.0466 | 0.1489 +/- 0 | -0.0130 +/- 0.0813 | 0.1487 +/- 0.0003 | 0.1489 +/- 0 |

Additional observations from that run:

- Trained epsilon-greedy selected one accepted edge removal per structural
  episode, met the spectral target in all three seeds, and nearly matched the
  greedy and actor-critic scores.
- In the stabilizer and disruptor fixtures it learned no-op as the best
  abstract action. That tied greedy but did not improve over no-op.
- In the difficult spectral/activity fixture, no evaluated policy met the
  target spectral radius. Trained epsilon-greedy again chose no-op; greedy had
  the highest return. The binary activity metric remained 1.0, showing that it
  is too coarse to measure gradual signal weakening in this fixture.
- All evaluation actions were legal, so the rejected-action rate was zero.

The full JSON also reports final potential, target fit, target activity,
canonical health, spectral success, rejected-action rate, structural edit
count, action cost, runtime, and action-family frequency for every seed.

## Research-question answers

- **Different from random:** yes. The trained table converged to no-op in three
  cases and edge removal in the structural case; its action frequencies and
  variance differ from random exploration.
- **Better than untrained epsilon:** yes in three of four cases, most clearly in
  the structural case. It was worse in the spectral/activity case.
- **Better than random:** yes in all four reference cases by mean cumulative
  reward.
- **Better than greedy:** no. It tied greedy in two cases, nearly tied it in the
  structural case, and lost clearly in the spectral/activity case.
- **Compared with actor-critic:** epsilon was better in the stabilizer and
  disruptor cases, worse in the spectral/activity case, and nearly tied in the
  structural case. These tiny fixtures do not establish general superiority.
- **Target activity:** all policies retained binary activity in this run. The
  metric did not reveal gradual weakening and needs refinement before it can
  support an anti-collapse claim.
- **Useful structural actions:** yes. The learned structural-family value led
  to one accepted edge removal per evaluation seed and 100% spectral success.
- **Interpretability:** yes at the action-family level because every value and
  count has a readable key. It cannot explain which same-family target is best.
- **Transfer:** evaluation seeds were unseen during training. Cross-seed
  transfer worked in the structural case; transfer to unseen graph structures
  was not tested and should not be claimed.
- **Team Workspace exposure:** not yet. Retain it as a backend experiment until
  reward validation and broader graph evaluation show value beyond greedy.

## Conclusion

The implementation is correct enough to serve as an auditable baseline: it
learns only from real transitions, is deterministic under fixed seeds, survives
checkpoint round trips, and can discover a useful structural action family.
The controlled result does **not** show broad superiority over greedy or no-op.
It instead exposes two current limits: coarse action abstraction cannot select
among same-family targets, and the present reward often makes holding position
competitive. Reward validation and a more sensitive activity measure should
precede claims that this learner improves strategic outcomes.

Mesa was not integrated because FlowCLD already provides the environment and
transition lifecycle. Repast4Py was not integrated because no distributed
scaling bottleneck has been demonstrated. Neither framework is needed for this
policy boundary or benchmark.
