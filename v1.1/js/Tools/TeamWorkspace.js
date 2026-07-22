/**********************************

STAGE 5 TEAM WORKSPACE

Team definitions and queued moves are session drafts. Every run starts from the
current loopy.model graph, and Canvas replay writes frames through Model's own
restore boundary. There is no second persistent graph state.

**********************************/

(function (global) {
    "use strict";

    var teams = [];
    var moves = [];
    var result = null;
    var sourceFingerprint = null;
    var resultApplied = false;
    var applyingReplay = false;
    var replay = null;
    var teamCounter = 1;
    var activeRolePreset = "custom";

    function model() {
        return global.loopy && global.loopy.model;
    }

    function element(id) {
        return document.getElementById(id);
    }

    function toast(message, type) {
        if (typeof global.showToast === "function") global.showToast(message, type || "error", false);
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
        });
    }

    function currentGraphData() {
        var current = model();
        if (!current) throw new Error("The model is not ready");
        if (typeof convertToAdvancedFormat !== "function") throw new Error("The graph converter is unavailable");
        return convertToAdvancedFormat(current.nodes, current.edges);
    }

    function fingerprint(graph) {
        return JSON.stringify(graph);
    }

    async function postSession(payload) {
        var response = await fetch(CONFIG.API_URL + "/agent/team-sessions/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        var body = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(body.error || "Team session failed");
        return body;
    }

    async function postModelBalance(payload) {
        var response = await fetch(CONFIG.API_URL + "/agent/model-balance/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        var body = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(body.error || "Model balance failed");
        return body;
    }

    function acceptResult(body, graph) {
        result = body;
        sourceFingerprint = fingerprint(graph);
        resultApplied = false;
        renderResults();
    }

    function validateBalanceGraph(graph) {
        if (graph.nodes.length < 2 || graph.edges.length < 1) {
            throw new Error("Model balance requires at least two nodes and one edge");
        }
        var names = graph.nodes.map(function (node) { return String(node.name || "").trim(); });
        if (names.some(function (name) { return !name; }) || new Set(names).size !== names.length) {
            throw new Error("Every node needs a distinct name before balancing");
        }
    }

    function labels() {
        var current = model();
        return current ? current.nodes.map(function (node) { return String(node.label).trim(); }) : [];
    }

    function edgePairs() {
        var current = model();
        return current ? current.edges.map(function (edge) {
            return [String(edge.from.label).trim(), String(edge.to.label).trim()];
        }) : [];
    }

    function setOptions(select, values, labeler, valueMaker, placeholder) {
        if (!select) return;
        var previous = select.value;
        select.innerHTML = "";
        if (placeholder) {
            var empty = document.createElement("option");
            empty.value = "";
            empty.textContent = placeholder;
            select.appendChild(empty);
        }
        values.forEach(function (value) {
            var option = document.createElement("option");
            option.value = valueMaker ? valueMaker(value) : String(value);
            option.textContent = labeler ? labeler(value) : String(value);
            select.appendChild(option);
        });
        if (Array.prototype.some.call(select.options, function (option) { return option.value === previous; })) {
            select.value = previous;
        }
    }

    function slug(value) {
        var base = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (!base) base = "team";
        var candidate = base;
        while (teams.some(function (team) { return team.id === candidate; })) {
            candidate = base + "-" + teamCounter++;
        }
        return candidate;
    }

    function checkedValues(selector, attribute) {
        return Array.prototype.filter.call(document.querySelectorAll(selector), function (input) {
            return input.checked;
        }).map(function (input) { return input.getAttribute(attribute); });
    }

    function setCheckedValues(selector, attribute, selected) {
        Array.prototype.forEach.call(document.querySelectorAll(selector), function (input) {
            input.checked = selected.indexOf(input.getAttribute(attribute)) >= 0;
        });
    }

    function toggleObjectiveFields() {
        var trajectory = element("tmObjectiveMode").value === "trajectory";
        element("tmBehaviorField").hidden = trajectory;
        element("tmTrajectoryField").hidden = !trajectory;
    }

    function rolePresetCatalog() {
        return global.TeamRolePresets || null;
    }

    function renderRolePresetSelection(message) {
        Array.prototype.forEach.call(document.querySelectorAll("[data-tm-role-preset]"), function (button) {
            var selected = button.getAttribute("data-tm-role-preset") === activeRolePreset;
            button.classList.toggle("is-active", selected);
            button.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        var summary = element("tmRolePresetSummary");
        var catalog = rolePresetCatalog();
        if (!summary || !catalog) return;
        var preset = catalog.get(activeRolePreset);
        summary.textContent = message || (preset.label + ": " + preset.description + (
            preset.key === "red" || preset.key === "black"
                ? " The disrupt orientation reverses the healthy target score."
                : ""
        ));
    }

    function renderRolePresets() {
        var container = element("tmRolePresetButtons");
        var catalog = rolePresetCatalog();
        if (!container) return;
        if (!catalog) {
            container.hidden = true;
            element("tmRolePresetSummary").textContent = "Role presets are unavailable. Manual team settings still work.";
            return;
        }
        container.innerHTML = catalog.list().map(function (preset) {
            return '<button type="button" class="tm-role-preset tm-role-preset--' + escapeHtml(preset.key) + '" ' +
                'data-tm-role-preset="' + escapeHtml(preset.key) + '" aria-pressed="false" title="' + escapeHtml(preset.description) + '">' +
                '<span class="tm-role-preset-swatch" aria-hidden="true"></span>' +
                '<span class="tm-role-preset-copy"><strong>' + escapeHtml(preset.label) + '</strong><small>' + escapeHtml(preset.title) + '</small></span>' +
                '</button>';
        }).join("");
        Array.prototype.forEach.call(container.querySelectorAll("[data-tm-role-preset]"), function (button) {
            button.addEventListener("click", function () {
                var requested = button.getAttribute("data-tm-role-preset");
                var next = catalog.toggle(activeRolePreset, requested);
                var toggledOff = next === "custom" && requested === activeRolePreset && requested !== "custom";
                activeRolePreset = next;
                if (next !== "custom") applyRolePreset(next);
                renderRolePresetSelection(toggledOff
                    ? "Preset off. Your current form values were preserved for manual editing."
                    : null);
            });
        });
        renderRolePresetSelection();
    }

    function applyRolePreset(key) {
        var catalog = rolePresetCatalog();
        var preset = catalog && catalog.get(key);
        if (!preset || !preset.settings) return;
        var settings = preset.settings;
        element("tmTeamName").value = settings.name;
        element("tmTeamOrientation").value = settings.orientation;
        element("tmObjectiveMode").value = settings.objectiveMode;
        element("tmObjectiveBehavior").value = settings.objectiveBehavior;
        element("tmObjectiveSpectralRadius").value = settings.objectiveSpectralRadius == null
            ? ""
            : String(settings.objectiveSpectralRadius);
        element("tmTeamWeight").value = String(settings.weight);
        element("tmTeamPreset").value = settings.scorePreset;
        element("tmGamma").value = String(settings.gamma);
        element("tmParameterCost").value = String(settings.parameterCost);
        element("tmStructuralCost").value = String(settings.structuralCost);
        element("tmMoveBudget").value = String(settings.moveBudget);
        element("tmStructuralBudget").value = String(settings.structuralBudget);
        element("tmMinLiveNodes").value = String(catalog.minimumLiveNodes(key, labels().length));
        element("tmPermissionScope").value = settings.permissionScope;
        setCheckedValues("[data-tm-node-param]", "data-tm-node-param", settings.nodeParameters);
        setCheckedValues("[data-tm-edge-param]", "data-tm-edge-param", settings.edgeParameters);
        setCheckedValues("[data-tm-structural]", "data-tm-structural", settings.structuralActions);
        toggleObjectiveFields();
    }

    function parseTrajectory(value) {
        var parts = String(value).split(",").map(function (part) { return part.trim(); }).filter(Boolean);
        if (!parts.length) throw new Error("Enter at least one trajectory value");
        var values = parts.map(Number);
        if (values.some(function (number) { return !isFinite(number); })) {
            throw new Error("Trajectory values must be finite numbers separated by commas");
        }
        return values;
    }

    function addTeam() {
        try {
            var name = String(element("tmTeamName").value || "").trim();
            var orientation = element("tmTeamOrientation").value;
            var ownedNode = element("tmOwnedNode").value;
            var objectiveNode = element("tmObjectiveNode").value;
            var mode = element("tmObjectiveMode").value;
            var weight = Number(element("tmTeamWeight").value);
            if (!name) throw new Error("Enter a team name");
            if (!ownedNode) throw new Error("Select an owned node");
            if (!objectiveNode) throw new Error("Select an objective node");
            if (!isFinite(weight) || weight <= 0) throw new Error("Team weight must be positive");
            var gamma = Number(element("tmGamma").value);
            var parameterCost = Number(element("tmParameterCost").value);
            var structuralCost = Number(element("tmStructuralCost").value);
            var moveBudget = Number(element("tmMoveBudget").value);
            var structuralBudget = Number(element("tmStructuralBudget").value);
            var minLiveNodes = Number(element("tmMinLiveNodes").value);
            if (!isFinite(gamma) || gamma < 0 || gamma > 1) throw new Error("Future weight must be between 0 and 1");
            if (!isFinite(parameterCost) || parameterCost < 0 || !isFinite(structuralCost) || structuralCost < 0) throw new Error("Move costs cannot be negative");
            if (!Number.isInteger(moveBudget) || moveBudget < 1) throw new Error("Move budget must be a positive integer");
            if (!Number.isInteger(structuralBudget) || structuralBudget < 0) throw new Error("Structural budget must be a non-negative integer");
            if (!Number.isInteger(minLiveNodes) || minLiveNodes < 1 || minLiveNodes > labels().length) throw new Error("Minimum live nodes must fit the current model");
            var objective = { trajectories: {}, behaviors: {} };
            if (mode === "trajectory") {
                objective.trajectories[objectiveNode] = parseTrajectory(element("tmObjectiveTrajectory").value);
            } else {
                objective.behaviors[objectiveNode] = element("tmObjectiveBehavior").value;
            }
            var spectralText = String(element("tmObjectiveSpectralRadius").value || "").trim();
            if (spectralText) {
                var spectralRadius = Number(spectralText);
                if (!isFinite(spectralRadius) || spectralRadius <= 0 || spectralRadius >= 1) {
                    throw new Error("Maximum spectral radius must be greater than 0 and less than 1");
                }
                objective.spectral_radius = spectralRadius;
            }
            var scope = element("tmPermissionScope").value;
            var adjacent = edgePairs().filter(function (pair) {
                return pair[0] === objectiveNode || pair[1] === objectiveNode;
            });
            var teamDraft = {
                id: slug(name),
                name: name,
                weight: weight,
                orientation: orientation,
                owned_nodes: [ownedNode],
                target_nodes: [objectiveNode],
                preset: element("tmTeamPreset").value,
                gamma: gamma,
                parameter_move_cost: parameterCost,
                structural_move_cost: structuralCost,
                move_budget: moveBudget,
                structural_budget: structuralBudget,
                min_live_nodes: minLiveNodes,
                objective: objective,
                objectiveNode: objectiveNode,
                permissions: {
                    node_parameters: checkedValues("[data-tm-node-param]", "data-tm-node-param"),
                    edge_parameters: checkedValues("[data-tm-edge-param]", "data-tm-edge-param"),
                    structural_actions: checkedValues("[data-tm-structural]", "data-tm-structural"),
                    node_targets: scope === "all" ? null : [objectiveNode],
                    edge_targets: scope === "all" ? null : adjacent,
                },
            };
            if (!global.TeamRequestGateway) throw new Error("Team validation is unavailable");
            var teamValidation = global.TeamRequestGateway.validateTeamDefinition(teamDraft, currentGraphData());
            if (!teamValidation.ok || !teamValidation.value) {
                throw new Error("Team is invalid: " + global.TeamRequestGateway.formatIssues(teamValidation));
            }
            var validatedTeam = teamValidation.value;
            validatedTeam.scenario_role = activeRolePreset;
            validatedTeam.objectiveNode = objectiveNode;
            teams.push(validatedTeam);
            element("tmTeamName").value = "";
            render();
        } catch (error) {
            toast(error.message);
        }
    }

    function objectiveSummary(team) {
        var spectral = team.objective.spectral_radius == null
            ? ""
            : " / rho <= " + Number(team.objective.spectral_radius).toFixed(3);
        var trajectories = Object.keys(team.objective.trajectories || {});
        if (trajectories.length) {
            var node = trajectories[0];
            return node + ": trajectory (" + team.objective.trajectories[node].length + " points)" + spectral;
        }
        var behaviors = Object.keys(team.objective.behaviors || {});
        return (behaviors.length ? behaviors[0] + ": " + team.objective.behaviors[behaviors[0]] : "No node objective") + spectral;
    }

    function permissionSummary(team) {
        var permissions = team.permissions;
        var count = permissions.node_parameters.length + permissions.edge_parameters.length + permissions.structural_actions.length;
        return count + " action" + (count === 1 ? "" : "s") + (permissions.node_targets === null ? ", all targets" : ", focused");
    }

    function roleBadge(team) {
        var key = team.scenario_role || "custom";
        if (key === "custom") return "";
        var catalog = rolePresetCatalog();
        var label = catalog ? catalog.get(key).label : key;
        return '<span class="tm-team-role tm-team-role--' + escapeHtml(key) + '">' + escapeHtml(label) + '</span>';
    }

    function renderTeams() {
        var body = element("tmTeamsBody");
        if (!body) return;
        body.innerHTML = teams.length ? teams.map(function (team) {
            return '<tr><td><strong>' + escapeHtml(team.name) + '</strong>' + roleBadge(team) + '<small>' + escapeHtml(team.id) + '</small></td>' +
                '<td>' + escapeHtml(team.orientation) + '</td>' +
                '<td>' + escapeHtml(objectiveSummary(team)) + '</td>' +
                '<td>' + team.weight.toFixed(2) + '</td>' +
                '<td>' + escapeHtml(permissionSummary(team)) + '</td>' +
                '<td><button type="button" class="tm-remove-button" data-remove-team="' + escapeHtml(team.id) + '" title="Delete team" aria-label="Delete team">&times;</button></td></tr>';
        }).join("") : '<tr><td colspan="6" class="tm-empty">No teams added</td></tr>';
        element("tmTeamCount").textContent = String(teams.length);
        Array.prototype.forEach.call(body.querySelectorAll("[data-remove-team]"), function (button) {
            button.addEventListener("click", function () {
                var id = button.getAttribute("data-remove-team");
                teams = teams.filter(function (team) { return team.id !== id; });
                moves = moves.filter(function (move) { return move.team_id !== id; });
                invalidateResult();
                render();
            });
        });
    }

    function actionSummary(action) {
        if (action.kind === "no_op") return "No change";
        if (action.kind === "structural_transaction") {
            return (action.label || "Structural transaction") + " (" + action.edits.length + " edits)";
        }
        var target = Array.isArray(action.target) ? action.target.join(" -> ") : action.target;
        return action.parameter + " / " + target + " / " + action.mode + " " + action.value;
    }

    function renderMoves() {
        var queue = element("tmMoveQueue");
        if (!queue) return;
        queue.innerHTML = moves.length ? moves.map(function (move, index) {
            var team = teams.find(function (candidate) { return candidate.id === move.team_id; });
            return '<div class="tm-move-row"><span class="tm-move-sequence">' + (index + 1) + '</span>' +
                '<strong>' + escapeHtml(team ? team.name : move.team_id) + '</strong>' +
                '<span>' + escapeHtml(actionSummary(move.action)) + '</span>' +
                '<button type="button" class="tm-remove-button" data-remove-move="' + index + '" title="Delete move" aria-label="Delete move">&times;</button></div>';
        }).join("") : '<div class="tm-empty">No moves queued</div>';
        element("tmMoveCount").textContent = String(moves.length);
        Array.prototype.forEach.call(queue.querySelectorAll("[data-remove-move]"), function (button) {
            button.addEventListener("click", function () {
                moves.splice(Number(button.getAttribute("data-remove-move")), 1);
                invalidateResult();
                renderMoves();
            });
        });
    }

    function selectedMoveTeam() {
        var id = element("tmMoveTeam").value;
        return teams.find(function (team) { return team.id === id; });
    }

    function renderMoveTargets() {
        var parameter = element("tmMoveParameter").value;
        var team = selectedMoveTeam();
        var target = element("tmMoveTarget");
        var isNode = parameter === "start_amount" || parameter === "retention";
        var values = isNode ? labels() : edgePairs();
        if (team) {
            var scope = isNode ? team.permissions.node_targets : team.permissions.edge_targets;
            if (scope !== null) {
                values = values.filter(function (value) {
                    return isNode ? scope.indexOf(value) >= 0 : scope.some(function (pair) {
                        return pair[0] === value[0] && pair[1] === value[1];
                    });
                });
            }
        }
        setOptions(
            target,
            values,
            isNode ? null : function (pair) { return pair.join(" -> "); },
            isNode ? null : function (pair) { return JSON.stringify(pair); },
            values.length ? null : "No permitted targets"
        );
    }

    function renderSelectors() {
        setOptions(element("tmObjectiveNode"), labels(), null, null, "Select node");
        setOptions(element("tmOwnedNode"), labels(), null, null, "Select node");
        setOptions(
            element("tmMoveTeam"),
            teams,
            function (team) { return team.name; },
            function (team) { return team.id; },
            teams.length ? null : "Add a team first"
        );
        setOptions(
            element("tmLearnerTeam"),
            teams,
            function (team) { return team.name; },
            function (team) { return team.id; },
            teams.length ? null : "Add a team first"
        );
        renderMoveTargets();
        var pending = global.structuralEditor ? global.structuralEditor.pendingEdits() : [];
        element("tmStructuralCount").textContent = pending.length ? pending.length + " pending edit" + (pending.length === 1 ? "" : "s") : "No pending controlled edits";
        var nodeCount = labels().length;
        element("tmMinLiveNodes").max = String(Math.max(1, nodeCount));
        if (Number(element("tmMinLiveNodes").value) > nodeCount && nodeCount > 0) {
            element("tmMinLiveNodes").value = String(nodeCount);
        }
    }

    function toggleLearningFields() {
        var learned = element("tmAgentStrategy").value === "actor_critic";
        Array.prototype.forEach.call(document.querySelectorAll(".tm-learning-field"), function (field) {
            field.hidden = !learned;
        });
    }

    function queueMove() {
        try {
            var team = selectedMoveTeam();
            if (!team) throw new Error("Add and select a team first");
            var kind = element("tmMoveKind").value;
            var action;
            if (kind === "structural_transaction") {
                var edits = global.structuralEditor ? global.structuralEditor.pendingEdits() : [];
                if (!edits.length) throw new Error("Queue edits in Controlled Edits first");
                var unauthorized = edits.find(function (edit) {
                    return team.permissions.structural_actions.indexOf(edit.kind) < 0;
                });
                if (unauthorized) throw new Error(team.name + " cannot perform " + unauthorized.kind);
                action = { kind: "structural_transaction", label: team.name + " transaction", edits: edits };
            } else {
                var parameter = element("tmMoveParameter").value;
                var isNode = parameter === "start_amount" || parameter === "retention";
                var allowed = isNode ? team.permissions.node_parameters : team.permissions.edge_parameters;
                if (allowed.indexOf(parameter) < 0) throw new Error(team.name + " cannot change " + parameter);
                var rawTarget = element("tmMoveTarget").value;
                if (!rawTarget) throw new Error("Select a move target");
                var value = Number(element("tmMoveValue").value);
                if (!isFinite(value)) throw new Error("Move value must be finite");
                if (parameter === "delay" && !Number.isInteger(value)) throw new Error("Delay must be an integer");
                action = {
                    kind: "parameter",
                    parameter: parameter,
                    target: isNode ? rawTarget : JSON.parse(rawTarget),
                    value: value,
                    mode: element("tmMoveMode").value,
                };
            }
            moves.push({ team_id: team.id, action: action });
            invalidateResult();
            renderMoves();
        } catch (error) {
            toast(error.message);
        }
    }

    function invalidateResult() {
        result = null;
        sourceFingerprint = null;
        resultApplied = false;
        var container = element("tmResults");
        if (container) container.hidden = true;
    }

    async function runSession() {
        var button = element("tmRunSession");
        try {
            if (!teams.length) throw new Error("Add at least one team");
            var graph = currentGraphData();
            var iterations = Number(element("tmIterations").value);
            var agentTurns = Number(element("tmAgentTurns").value);
            var strategy = element("tmAgentStrategy").value;
            if (!Number.isInteger(iterations) || iterations < 1 || iterations > 200) {
                throw new Error("Iterations must be an integer from 1 to 200");
            }
            if (!Number.isInteger(agentTurns) || agentTurns < 0 || agentTurns > 100) {
                throw new Error("Agent turns must be an integer from 0 to 100");
            }
            var learning = {};
            if (strategy === "actor_critic") {
                learning = {
                    learner_team_id: element("tmLearnerTeam").value,
                    training_episodes: Number(element("tmTrainingEpisodes").value),
                    training_steps: Number(element("tmTrainingSteps").value),
                    n_step: Number(element("tmNStep").value),
                    opponent_mode: element("tmOpponentMode").value,
                    planning_depth: Number(element("tmPlanningDepth").value),
                    evaluation_seeds: Number(element("tmEvaluationSeeds").value),
                    actor_learning_rate: Number(element("tmActorLearningRate").value),
                    critic_learning_rate: Number(element("tmCriticLearningRate").value),
                    training_temperature: Number(element("tmTrainingTemperature").value),
                };
                if (!learning.learner_team_id) throw new Error("Select a learner team");
                if (!Number.isInteger(learning.training_episodes) || learning.training_episodes < 1 || learning.training_episodes > 200) throw new Error("Practice rounds must be from 1 to 200");
                if (!Number.isInteger(learning.training_steps) || learning.training_steps < 1 || learning.training_steps > 50) throw new Error("Moves per round must be from 1 to 50");
                if (!Number.isInteger(learning.n_step) || learning.n_step < 1 || learning.n_step > 50) throw new Error("Learning window must be from 1 to 50");
                if (!Number.isInteger(learning.planning_depth) || learning.planning_depth < 1 || learning.planning_depth > 3) throw new Error("Planning depth must be from 1 to 3");
                if (!Number.isInteger(learning.evaluation_seeds) || learning.evaluation_seeds < 0 || learning.evaluation_seeds > 5) throw new Error("Comparison seeds must be from 0 to 5");
                if (!isFinite(learning.actor_learning_rate) || learning.actor_learning_rate <= 0) throw new Error("Actor rate must be positive");
                if (!isFinite(learning.critic_learning_rate) || learning.critic_learning_rate < 0) throw new Error("Critic rate cannot be negative");
                if (!isFinite(learning.training_temperature) || learning.training_temperature <= 0) throw new Error("Exploration must be positive");
            }
            button.disabled = true;
            button.textContent = "Running...";
            var safety = global.structuralEditor && global.structuralEditor.safetyConfig
                ? global.structuralEditor.safetyConfig()
                : { protected_nodes: [], protected_edges: [], required_paths: [] };
            if (!global.TeamRequestGateway) throw new Error("Team session validation is unavailable");
            var requestPayload = {
                request_schema_version: global.TeamRequestGateway.SCHEMA_VERSION,
                schema_version: graph.schema_version,
                nodes: graph.nodes,
                edges: graph.edges,
                teams: teams.map(function (team) {
                    return {
                        id: team.id,
                        name: team.name,
                        weight: team.weight,
                        orientation: team.orientation,
                        owned_nodes: team.owned_nodes,
                        target_nodes: team.target_nodes,
                        preset: team.preset,
                        gamma: team.gamma,
                        parameter_move_cost: team.parameter_move_cost,
                        structural_move_cost: team.structural_move_cost,
                        move_budget: team.move_budget,
                        structural_budget: team.structural_budget,
                        min_live_nodes: team.min_live_nodes,
                        objective: team.objective,
                        permissions: team.permissions,
                    };
                }),
                moves: moves,
                agent_strategy: strategy,
                learner_team_id: learning.learner_team_id,
                training_episodes: learning.training_episodes,
                training_steps: learning.training_steps,
                n_step: learning.n_step,
                opponent_mode: learning.opponent_mode,
                planning_depth: learning.planning_depth,
                evaluation_seeds: learning.evaluation_seeds,
                actor_learning_rate: learning.actor_learning_rate,
                critic_learning_rate: learning.critic_learning_rate,
                training_temperature: learning.training_temperature,
                agent_turns: agentTurns,
                protected_nodes: safety.protected_nodes,
                protected_edges: safety.protected_edges,
                required_paths: safety.required_paths,
                iterations: iterations,
                seed: 42,
            };
            var requestValidation = global.TeamRequestGateway.validateTeamSessionRequest(requestPayload);
            if (!requestValidation.ok || !requestValidation.value) {
                throw new Error("Session is invalid: " + global.TeamRequestGateway.formatIssues(requestValidation));
            }
            var body = await postSession(requestValidation.value);
            acceptResult(body, graph);
        } catch (error) {
            toast(error.message);
        } finally {
            button.disabled = false;
            button.textContent = "Run session";
        }
    }

    function finalResultFrame() {
        if (!result || !result.frames || !result.frames.length) return null;
        return result.frames[result.frames.length - 1];
    }

    function resultChangesGraph() {
        return !!(result && result.baseline && result.final &&
            fingerprint(result.baseline) !== fingerprint(result.final));
    }

    function applyFinalToCanvas(options) {
        options = options || {};
        if (!result || !result.final) throw new Error("Run a team session first");
        if (replay) throw new Error("Exit the active replay before applying the final graph directly");
        if (!global.GraphStateAdapter) throw new Error("Canvas graph updates are unavailable");
        if (fingerprint(currentGraphData()) !== sourceFingerprint) {
            throw new Error("The Canvas changed after this session. Run the session again before applying it.");
        }
        if (!resultChangesGraph()) throw new Error("The session did not propose any parameter changes");
        if (resultApplied) throw new Error("This final graph is already applied");

        var currentModel = model();
        var lastFrame = finalResultFrame() || {};
        applyingReplay = true;
        try {
            GraphStateAdapter.commitFrame(currentModel, {
                graph: result.final,
                classifications: lastFrame.classifications || {},
            });
            sourceFingerprint = fingerprint(currentGraphData());
            resultApplied = true;
            if (typeof publish === "function") publish("model/changed");
            renderResults();
            toast(options.message || "Final agent parameters applied to the Canvas", "success");
            if (options.openCanvas !== false && typeof openPage === "function") openPage("Canvas");
        } finally {
            applyingReplay = false;
        }
    }

    async function runSimpleBalance() {
        var button = element("tmRunSimpleBalance");
        var status = element("tmSimpleBalanceStatus");
        try {
            var graph = currentGraphData();
            validateBalanceGraph(graph);
            var targetRadius = Number(element("tmSimpleTargetRadius").value);
            if (!isFinite(targetRadius) || targetRadius <= 0 || targetRadius >= 1) {
                throw new Error("Maximum spectral radius must be greater than 0 and less than 1");
            }
            var adjustRetention = element("tmBalanceRetention").checked;
            var adjustDecay = element("tmBalanceDecay").checked;
            if (!adjustRetention && !adjustDecay) throw new Error("Enable retention, decay, or both");
            var minRetention = Number(element("tmBalanceMinRetention").value);
            var maxDecay = Number(element("tmBalanceMaxDecay").value);
            if (!isFinite(minRetention) || minRetention <= 0 || minRetention > 1) {
                throw new Error("Minimum retention must be greater than 0 and at most 1");
            }
            if (!isFinite(maxDecay) || maxDecay < 0 || maxDecay >= 1) {
                throw new Error("Maximum decay must be at least 0 and less than 1");
            }

            button.disabled = true;
            button.textContent = "Finding...";
            status.textContent = "Searching influential nodes and edges for a bounded plan that reaches rho <= " + targetRadius.toFixed(3) + "...";
            var iterations = Math.max(30, Number(element("tmIterations").value) || 50);
            var body = await postModelBalance({
                nodes: graph.nodes,
                edges: graph.edges,
                iterations: Math.min(200, iterations),
                seed: 42,
                target_spectral_radius: targetRadius,
                adjust_retention: adjustRetention,
                adjust_decay: adjustDecay,
                min_retention: minRetention,
                max_decay: maxDecay,
            });
            var balance = body.model_balance || body.simple_balance;
            if (!balance) throw new Error("The balance response did not include planner diagnostics");
            var initialRadius = Number(balance.initial_spectral_radius);
            var finalRadius = Number(balance.final_spectral_radius);
            acceptResult(body, graph);

            if (finalRadius > targetRadius + 1e-9) {
                status.textContent = "The planner improved the radius from " + initialRadius.toFixed(3) + " to " + finalRadius.toFixed(3) + ", but did not reach the " + targetRadius.toFixed(3) + " target. Canvas was not changed.";
                toast("No changes applied because the model did not reach its target");
                return;
            }
            if (!resultChangesGraph()) {
                status.textContent = "This model already meets the target (spectral radius " + finalRadius.toFixed(3) + " <= " + targetRadius.toFixed(3) + ").";
                toast("The current model already meets the target", "success");
                return;
            }
            if (balance.requires_explicit_apply) {
                status.textContent = "Preview ready: spectral radius " + initialRadius.toFixed(3) + " -> " + finalRadius.toFixed(3) + ". Review the changes below, then select Apply final to Canvas.";
                toast("Balance preview ready", "success");
            } else {
                status.textContent = "Target met: spectral radius " + initialRadius.toFixed(3) + " -> " + finalRadius.toFixed(3) + " (target " + targetRadius.toFixed(3) + "). Final parameters applied to Canvas.";
                applyFinalToCanvas({
                    message: "Two-node loop balanced and applied to Canvas (" + initialRadius.toFixed(3) + " -> " + finalRadius.toFixed(3) + ")",
                });
            }
        } catch (error) {
            status.textContent = error.message;
            toast(error.message);
        } finally {
            button.disabled = false;
            button.textContent = "Find balance";
        }
    }

    function formatScore(value) {
        return Number(value).toFixed(4);
    }

    function renderResults() {
        var container = element("tmResults");
        if (!container || !result) return;
        container.hidden = false;
        var balance = result.model_balance || result.simple_balance;
        var changesGraph = resultChangesGraph();
        var strategy = balance ? "direct stability planner" : (result.agent_strategy === "actor_critic" ? "learned" : "greedy");
        var summary = result.accepted_moves + " accepted / " + result.rejected_moves + " rejected / " + result.agent_turns + " agent turns / " + strategy + " / session " + result.session_id;
        if (balance) {
            summary += " / spectral radius " + Number(balance.initial_spectral_radius).toFixed(3) + " -> " + Number(balance.final_spectral_radius).toFixed(3);
        } else {
            var spectralTeams = result.teams.filter(function (team) {
                var components = team.final_components || {};
                return isFinite(Number(components.spectral_radius)) && isFinite(Number(components.spectral_target));
            });
            if (spectralTeams.length === 1) {
                var spectral = spectralTeams[0].final_components;
                summary += " / spectral radius " + Number(spectral.spectral_radius).toFixed(3) +
                    " vs " + Number(spectral.spectral_target).toFixed(3) +
                    (Number(spectral.spectral_target_met) === 1 ? " (target met)" : " (target missed)");
            } else if (spectralTeams.length > 1) {
                var metCount = spectralTeams.filter(function (team) {
                    return Number(team.final_components.spectral_target_met) === 1;
                }).length;
                summary += " / " + metCount + " of " + spectralTeams.length + " spectral targets met";
            }
            if (!changesGraph) summary += " / returned to starting graph";
        }
        element("tmResultSummary").textContent = summary;
        var applyButton = element("tmApplyFinal");
        applyButton.disabled = resultApplied || !changesGraph;
        applyButton.textContent = resultApplied
            ? "Applied to Canvas"
            : (changesGraph ? "Apply final to Canvas" : "No final change to apply");
        applyButton.title = changesGraph
            ? "Apply the session's final graph to Canvas"
            : "The session's final graph matches the graph it started from";
        element("tmScoresBody").innerHTML = result.teams.map(function (team) {
            return '<tr><td><strong>' + escapeHtml(team.name) + '</strong></td><td>' + formatScore(team.initial_reward) + '</td><td>' + formatScore(team.final_reward) + '</td><td>' + formatScore(team.cumulative_reward) + '</td></tr>';
        }).join("");
        element("tmLogBody").innerHTML = result.move_log.length ? result.move_log.map(function (move) {
            return '<tr><td>' + move.sequence + '</td><td>' + escapeHtml(move.team_name) + '</td><td>' + escapeHtml(actionSummary(move.action)) + '</td>' +
                '<td><span class="tm-status tm-status--' + (move.accepted ? "accepted" : "rejected") + '">' + (move.accepted ? "Accepted" : "Rejected") + '</span></td>' +
                '<td>' + formatScore(move.shared_reward) + '</td><td>' + escapeHtml(move.reason || "") + '</td></tr>';
        }).join("") : '<tr><td colspan="6" class="tm-empty">Baseline evaluation only</td></tr>';
        renderBalancePreview(balance);
        renderLearningResults();
    }

    function renderBalancePreview(balance) {
        var section = element("tmBalancePreview");
        section.hidden = !balance;
        if (!balance) return;
        var notebook = balance.notebook_validation || {};
        var finalNotebook = notebook.final || {};
        var components = finalNotebook.components || {};
        var priority = (balance.prioritized_nodes || []).join(", ") || "none";
        element("tmBalancePreviewSummary").textContent =
            "Target " + Number(balance.target_spectral_radius).toFixed(3) +
            " / final transmission " + Number(balance.transmission_ratio).toFixed(3) +
            " / notebook health " + Number(finalNotebook.health || 0).toFixed(3) +
            " / active tail " + Number(components.active_tail_ratio || 0).toFixed(3) +
            " / prioritized nodes: " + priority;
        var warningList = balance.warnings || [];
        var warningBox = element("tmBalanceWarnings");
        warningBox.hidden = !warningList.length;
        warningBox.innerHTML = warningList.map(function (warning) {
            return "<div>" + escapeHtml(warning) + "</div>";
        }).join("");
        var changes = balance.changes || [];
        element("tmBalanceChangesBody").innerHTML = changes.length ? changes.map(function (change) {
            var target = Array.isArray(change.target) ? change.target.join(" -> ") : change.target;
            return "<tr><td>" + escapeHtml(change.parameter) + "</td><td>" + escapeHtml(target) +
                "</td><td>" + Number(change.before).toFixed(4) + "</td><td>" + Number(change.after).toFixed(4) + "</td></tr>";
        }).join("") : '<tr><td colspan="4" class="tm-empty">No parameter changes needed</td></tr>';
    }

    function renderLearningResults() {
        var section = element("tmLearningResults");
        var learning = result && result.learning;
        section.hidden = !learning;
        if (!learning) return;
        var leagueCopy = learning.league && learning.league.exploitability
            ? " / exploitability proxy " + formatScore(learning.league.exploitability.nash_conv_proxy)
            : "";
        element("tmLearningSummary").textContent = learning.episodes + " practice rounds / best return " + formatScore(learning.best_return) + " / final return " + formatScore(learning.final_return) + " / planning depth " + learning.planning_depth + " / " + learning.opponent_mode.replace("frozen_", "") + " opponents" + leagueCopy + " / checkpoint " + learning.checkpoint_id;
        var benchmark = learning.benchmark && learning.benchmark.curves;
        element("tmBenchmarkBody").innerHTML = benchmark ? Object.keys(benchmark).map(function (name) {
            return '<tr><td>' + escapeHtml(name) + '</td><td>' + formatScore(benchmark[name].overall_mean) + '</td></tr>';
        }).join("") : '<tr><td colspan="2" class="tm-empty">Comparison disabled</td></tr>';
        var curve = element("tmLearningCurve");
        if (global.Plotly && learning.history && learning.history.length) {
            global.Plotly.react(curve, [{
                x: learning.history.map(function (item) { return item.episode; }),
                y: learning.history.map(function (item) { return item.return; }),
                mode: "lines+markers",
                name: "Episode return",
                line: { color: "#2f68e5", width: 2 },
                marker: { size: 4 },
            }], {
                margin: { l: 48, r: 12, t: 18, b: 42 },
                height: 260,
                paper_bgcolor: "transparent",
                plot_bgcolor: "transparent",
                xaxis: { title: "Practice round", fixedrange: true },
                yaxis: { title: "Return", fixedrange: true },
                showlegend: false,
            }, { displayModeBar: false, responsive: true });
        } else {
            curve.textContent = "Learning curve unavailable";
        }
    }

    function replayDetail(frame) {
        if (!frame.move) return { title: "Baseline", detail: "Initial shared score " + formatScore(frame.shared_reward) };
        var move = frame.move;
        return {
            title: "Move " + move.sequence + " of " + result.move_log.length,
            detail: move.team_name + " / " + actionSummary(move.action) + " / " + (move.accepted ? "accepted" : "rejected"),
        };
    }

    function showReplayFrame(index) {
        if (!replay) return;
        index = Math.max(0, Math.min(index, result.frames.length - 1));
        applyingReplay = true;
        try {
            GraphStateAdapter.applyFrame(model(), result.frames[index], replay.context);
            replay.index = index;
            element("tmReplaySlider").value = String(index);
            var copy = replayDetail(result.frames[index]);
            element("tmReplayStep").textContent = copy.title;
            element("tmReplayDetail").textContent = copy.detail;
        } finally {
            applyingReplay = false;
        }
    }

    function stopPlayback() {
        if (replay && replay.timer) {
            clearInterval(replay.timer);
            replay.timer = null;
        }
        element("tmReplayPlay").innerHTML = "&#9654;";
        element("tmReplayPlay").title = "Play replay";
    }

    function startReplay() {
        try {
            if (!result || !result.frames || !result.frames.length) throw new Error("Run a team session first");
            if (fingerprint(currentGraphData()) !== sourceFingerprint) {
                throw new Error("The Canvas changed after this session. Run the session again before replaying it.");
            }
            if (!global.GraphStateAdapter) throw new Error("Canvas replay is unavailable");
            replay = { context: GraphStateAdapter.createContext(model()), index: 0, timer: null };
            element("teamReplayBar").hidden = false;
            element("tmReplaySlider").max = String(result.frames.length - 1);
            if (typeof openPage === "function") openPage("Canvas");
            showReplayFrame(0);
        } catch (error) {
            toast(error.message);
        }
    }

    function exitReplay(keepFinal) {
        if (!replay) return;
        stopPlayback();
        applyingReplay = true;
        try {
            if (keepFinal) {
                showReplayFrame(result.frames.length - 1);
                if (typeof model().saveState === "function") model().saveState();
                sourceFingerprint = fingerprint(currentGraphData());
                toast("Final team-session state kept on the Canvas", "success");
            } else {
                GraphStateAdapter.restoreBaseline(model(), replay.context);
            }
            if (typeof publish === "function") publish("model/changed");
        } finally {
            applyingReplay = false;
            replay = null;
            element("teamReplayBar").hidden = true;
        }
    }

    function togglePlayback() {
        if (!replay) return;
        if (replay.timer) {
            stopPlayback();
            return;
        }
        element("tmReplayPlay").innerHTML = "&#10074;&#10074;";
        element("tmReplayPlay").title = "Pause replay";
        replay.timer = setInterval(function () {
            if (!replay || replay.index >= result.frames.length - 1) {
                stopPlayback();
                return;
            }
            showReplayFrame(replay.index + 1);
        }, 1100);
    }

    function render() {
        var current = model();
        if (!current) return;
        element("tmGraphSummary").textContent = current.nodes.length + " nodes / " + current.edges.length + " edges";
        renderSelectors();
        renderTeams();
        renderMoves();
        toggleLearningFields();
        if (result) renderResults();
    }

    function bind() {
		var helpToggle = element("tmHelpToggle");
		var helpClose = element("tmHelpClose");
		var helpPanel = element("tmHelpPanel");
		function setHelpOpen(open) {
			helpPanel.hidden = !open;
			helpToggle.setAttribute("aria-expanded", open ? "true" : "false");
			helpToggle.classList.toggle("is-active", open);
		}
		helpToggle.addEventListener("click", function () { setHelpOpen(helpPanel.hidden); });
		helpClose.addEventListener("click", function () {
			setHelpOpen(false);
			helpToggle.focus();
		});
        renderRolePresets();
        element("tmAddTeam").addEventListener("click", addTeam);
        element("tmQueueMove").addEventListener("click", queueMove);
        element("tmClearMoves").addEventListener("click", function () { moves = []; invalidateResult(); renderMoves(); });
        element("tmRunSession").addEventListener("click", runSession);
        element("tmRunSimpleBalance").addEventListener("click", runSimpleBalance);
        element("tmAgentStrategy").addEventListener("change", toggleLearningFields);
        element("tmStartReplay").addEventListener("click", startReplay);
        element("tmApplyFinal").addEventListener("click", function () {
            try {
                applyFinalToCanvas();
            } catch (error) {
                toast(error.message);
            }
        });
        element("tmObjectiveMode").addEventListener("change", toggleObjectiveFields);
        element("tmMoveKind").addEventListener("change", function () {
            var structural = this.value === "structural_transaction";
            element("tmParameterFields").hidden = structural;
            element("tmStructuralFields").hidden = !structural;
            renderSelectors();
        });
        element("tmMoveParameter").addEventListener("change", renderMoveTargets);
        element("tmMoveTeam").addEventListener("change", renderMoveTargets);
        element("tmOpenControlledEdits").addEventListener("click", function () {
            if (typeof openPage === "function") openPage("StructuralEdits");
        });
        element("tmReplayPrevious").addEventListener("click", function () { if (replay) showReplayFrame(replay.index - 1); });
        element("tmReplayNext").addEventListener("click", function () { if (replay) showReplayFrame(replay.index + 1); });
        element("tmReplayPlay").addEventListener("click", togglePlayback);
        element("tmReplaySlider").addEventListener("input", function () { showReplayFrame(Number(this.value)); });
        element("tmReplayExit").addEventListener("click", function () { exitReplay(false); });
        element("tmReplayKeep").addEventListener("click", function () { exitReplay(true); });
    }

    if (typeof subscribe === "function") {
        subscribe("model/changed", function () {
            if (applyingReplay) return;
            if (result && sourceFingerprint && fingerprint(currentGraphData()) !== sourceFingerprint) invalidateResult();
            var page = element("TeamSessions");
            if (page && page.style.display === "block") render();
        });
    }

    document.addEventListener("DOMContentLoaded", bind);

    global.teamWorkspace = {
        render: render,
        teams: function () { return teams.slice(); },
        moves: function () { return moves.slice(); },
        activeRolePreset: function () { return activeRolePreset; },
        applyFinal: applyFinalToCanvas,
        runSimpleBalance: runSimpleBalance,
    };
})(typeof window !== "undefined" ? window : this);
