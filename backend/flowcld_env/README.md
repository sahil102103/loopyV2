# FlowCLD Agent Environment and Baselines

`flowcld_env` is a parameter and structural target-seeking environment around the
canonical notebook-derived simulation and scoring engine. It intentionally has
no Gymnasium dependency, but its `reset` and `step` return values follow the
Gymnasium API shape so an adapter can be added without changing this package.

## Responsibilities

- `actions.py`: role ownership, action masks, parameter bounds, graph mutation
- `engine.py`: injected notebook source-of-truth adapter
- `objectives.py`: stabilize/disrupt potentials, PBRS transitions, move costs
- `reward_validation.py`: blinded expert-rank comparison and reward ablations
- `agents.py`: framework-independent policy lifecycle plus stateless baselines
- `epsilon_greedy.py`: serializable epsilon-greedy action-value baseline
- `features.py`: fixed-width signed graph and legal-action encoding
- `learning.py`: serializable actor/value heads and n-step actor-critic training
- `benchmark.py`: seed-matched policy curves and detailed outcome metrics
- `candidates.py`: bounded autonomous structural motifs before safety filtering
- `planning.py`: bounded policy/critic-guided lookahead through fresh environments
- `league.py`: frozen policy profiles and an empirical NashConv proxy
- `observations.py`: simulation rollout and observation construction
- `rewards.py`: independent, composable reward components
- `environment.py`: episode lifecycle and move-log orchestration
- `evaluation.py`: atomic one-rollout evaluation of complete configurations
- `optimizer.py`: bounded cross-entropy single-agent training
- `policy.py`: learned policies, training summaries, and resumable checkpoints
- `structural.py`: atomic structural transactions and composable safety constraints
- `teams.py`: multi-team objectives, weighted scoring, and shared move records
- `types.py`: immutable contracts shared by those components

The environment reuses `simulate_two_phase`, `classify_behavior`,
`evaluate_config`, `score_components_to_total`, `OPT_SCORE_PRESETS`, and
`OPT_DEFAULT_BOUNDS` from `advanced_analysis.py`, which is kept in sync with the
flagship notebook. `NotebookEngineAdapter.from_namespace()` also supports direct
notebook injection without coupling policy code to a module import.

The current code supplies the R0 environment, the M1 greedy baseline,
controlled and autonomously proposed structural transactions, multi-team replay infrastructure, and the R1
n-step actor-critic baseline. The cross-entropy optimizer remains a non-RL search
baseline. The current planner is depth-limited and the league harness evaluates frozen
profiles. Full MCTS, reciprocity, centralized critics, PSRO, and population
self-play training remain later research milestones.

## Transparent epsilon-greedy baseline

All agents use the same `AgentPolicy` lifecycle: select from current legal
moves, optionally observe a committed `PolicyTransition`, reset episode-local
state, and serialize or restore policy state. Candidate previews are not
transitions. The epsilon-greedy policy therefore updates only after an action
has passed through the existing environment and received the acting team's
actual reward.

The policy is a contextual-bandit baseline over bounded, readable action
families such as `stabilize|parameter:retention:node:decrease` and
`stabilize|structural_transaction:add_edge+add_node`. It stores a visit count
and incremental mean reward for each family. Training explores with a decaying
epsilon; evaluation fixes epsilon to zero and disables updates. This is not
Q-learning: it does not bootstrap a next-state value.

```python
from flowcld_env import (
    EpsilonGreedyPolicy,
    EpsilonGreedySettings,
    EpsilonGreedyTrainer,
    EpsilonGreedyTrainingSettings,
)

policy = EpsilonGreedyPolicy(EpsilonGreedySettings(seed=42))
result = EpsilonGreedyTrainer(
    EpsilonGreedyTrainingSettings(episodes=40, seed=42)
).train(environment_factory, team_id="blue", policy=policy)
result.policy.save("models/blue-epsilon-greedy.json")
```

The Team Session backend accepts `agent_strategy: "epsilon_greedy"` with
`learner_team_id`, `training_episodes`, `training_steps`, `epsilon`,
`epsilon_min`, `epsilon_decay`, and optional `epsilon_learning_rate`. It does
not use the actor-critic simulator guard, so its deployed choices expose the
learned table directly. The browser does not yet expose this experimental
strategy as a Team Workspace control.

## Parameter-search baseline

`SingleAgentTargetOptimizer` searches for a complete bounded parameter configuration with a
cross-entropy search distribution. It evaluates each complete configuration in
one simulation rollout, supports deterministic seeds, and can save/resume a
checkpoint. Confidence is excluded by default because the deterministic
two-phase simulator does not use confidence; it can be selected explicitly for
a future uncertainty-aware reward model.

```python
from flowcld_env import (
    ParameterConfigurationEvaluator,
    SingleAgentTargetOptimizer,
    SingleAgentTrainingSettings,
    TargetSpecification,
)

evaluator = ParameterConfigurationEvaluator.from_payload(
    graph_payload,
    role="household",
    authorization_policy=policy,
    target=TargetSpecification(trajectories={"Income": desired_income}),
)
optimizer = SingleAgentTargetOptimizer(
    evaluator,
    SingleAgentTrainingSettings(iterations=12, population_size=24, seed=42),
)
result = optimizer.train(checkpoint_path="models/income-agent-checkpoint.json")
result.policy.save("models/income-agent-policy.json")
```

The `models/` directory is ignored by Git in this repository, so policy and
checkpoint artifacts remain local unless intentionally moved elsewhere.

## Stage 3 controlled structural edits

Structural edits use `StructuralTransaction`, which applies an ordered group of
node/edge additions and removals to a private graph copy. The candidate commits
only when every edit is role-authorized and every safety constraint passes.

The conservative default rules:

- protect all nodes named in target trajectories or behavior objectives;
- retain at least 50% of baseline nodes and 25% of baseline edges;
- prevent graph fragmentation and newly isolated nodes;
- reject newly introduced self-loops;
- enforce graph size limits; and
- optionally preserve protected edges and required causal paths.

```python
from flowcld_env import AddEdgeAction, AddNodeAction, StructuralTransaction

transaction = StructuralTransaction((
    AddNodeAction("New factor", start_amount=0.1, retention=0.8),
    AddEdgeAction("Existing factor", "New factor", correlation=0.6),
))
observation, reward, terminated, truncated, info = environment.step(
    transaction,
    role="model-designer",
)
```

Single isolated-node additions fail, while the node-plus-edge transaction above
can pass atomically. Custom rules implement the `StructuralConstraint` protocol
and can be supplied through `StructuralConstraintSet` without changing the
environment or mutator.

The app exposes this path through **Structure -> Controlled Edits**. The
`/agent/structural-edits/preview` endpoint evaluates a transaction on a private
copy; the browser applies it to the shared Canvas model only after acceptance.

## Stage 4 multi-team sessions

`MultiTeamEnvironment` wraps one `FlowCLDEnvironment`. Each team declares a
stabilize or disrupt orientation, ownership and target scope, notebook score
preset, gamma, move costs, budgets, and a live-node floor. Rewards use
`gamma * Phi(next) - Phi(current)` and disruptors receive the sign-flipped
stabilizer potential over the same target scope. The Team Workspace
uses the resulting immutable move log and graph snapshots for reversible Canvas
replay; no independent graph is stored by the team UI. Manual moves remain
available, and agent turns use the same `graph + Objective -> Move` contract for
both deterministic greedy and learned policies.

## Stage 5 learned policy

`ActorCriticTrainer` trains one decentralized team at a time while all other teams
remain frozen. This follows the handoff guard against training every bloc from
scratch in one non-stationary loop. The trainer uses the objective's documented
gamma, n-step bootstrapped targets, `target - value(state)` advantages, a separate
critic regression head, entropy-supported exploration, bounded rewards, and
gradient clipping. Setting `use_critic=False` keeps a plain Monte Carlo
REINFORCE baseline available for matched experiments.

`MessagePassingFeatureEncoder` performs two signed propagation rounds before
pooling the variable-size graph into a fixed context. It also encodes every current
parameter and structural action type. The default autonomous move generator combines
bounded parameter changes with a capped set of interpretable structural motifs:
mediated paths, opposing parallel paths, missing signed edges, and edge removal.
Every proposal still passes role permissions, edit budgets, and the Stage 3 safety
constraints before a policy can select it.

```python
from flowcld_env import ActorCriticTrainer, ActorCriticTrainingSettings

trainer = ActorCriticTrainer(ActorCriticTrainingSettings(
    episodes=40,
    n_step=5,
    seed=42,
))
result = trainer.train(environment_factory, team_id="blue")
result.model.save("models/blue-actor-critic.json")
```

`PolicyEvaluationHarness` runs random, greedy, and learned policies on identical
boards and seeds. It returns per-episode means, standard deviations, and raw seed
returns. Team Workspace exposes this as optional comparison runs and renders the
training return curve without creating a second graph state.

`DepthLimitedPlanningAgent` combines the learned policy prior, critic value, and
fresh simulator transitions for bounded lookahead. Depth and branch width are hard
limited to prevent accidental exponential work in the request path.

Final deterministic deployment uses a simulator-scored policy shortlist. For a
stabilizer with an explicit spectral target, `SpectralTargetGuardAgent` preserves
an improving structural proposal and uses the existing bounded graph planner one
legal retention/decay step at a time if the learned policy would otherwise stall.
This is a disclosed hybrid safety baseline, not evidence that the linear actor
alone learned a general structural-design policy.

Training may place the learner against frozen hold, random, or greedy opponent
policies. `LeagueEvaluationHarness` evaluates fixed multi-team profiles over shared
seeds and reports unilateral-deviation gains plus a NashConv-style empirical proxy.
This is a certification baseline, not PSRO or a Nash-equilibrium proof.

## Minimal example

```python
from flowcld_env import (
    FlowCLDEnvironment,
    MutationMode,
    ParameterAction,
    ParameterName,
    RoleBasedAuthorizationPolicy,
    RoleDefinition,
    TargetSpecification,
)

policy = RoleBasedAuthorizationPolicy([
    RoleDefinition(
        name="household",
        node_parameters=frozenset({ParameterName.START_AMOUNT}),
        node_targets=frozenset({"Income"}),
    ),
])

environment = FlowCLDEnvironment.from_payload(
    graph_payload,
    authorization_policy=policy,
    target=TargetSpecification(trajectories={"Income": desired_income}),
    max_steps=20,
)

observation, info = environment.reset(seed=42)
observation, reward, terminated, truncated, info = environment.step(
    ParameterAction(
        parameter=ParameterName.START_AMOUNT,
        target="Income",
        value=5.0,
        mode=MutationMode.DELTA,
    ),
    role="household",
)
```

Use `environment.action_mask(role)` before selecting an action. Rejected actions
do not mutate the graph, receive the `invalid_action` penalty, consume one move,
and remain visible in `environment.move_log`.
