(function (root, factory) {
    "use strict";

    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.TeamRolePresets = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    var presets = [
        {
            key: "custom",
            label: "Custom",
            title: "Manual settings",
            description: "Keep the current form values and configure the team yourself.",
            settings: null,
        },
        {
            key: "green",
            label: "Green",
            title: "Cooperative growth",
            description: "Protects active, sustainable behavior with conservative, non-destructive authority.",
            settings: {
                name: "Green Cooperation",
                orientation: "stabilize",
                objectiveMode: "behavior",
                objectiveBehavior: "Optimal",
                objectiveSpectralRadius: 0.97,
                weight: 1,
                scorePreset: "balanced",
                gamma: 0.99,
                parameterCost: 0.02,
                structuralCost: 0.04,
                moveBudget: 16,
                structuralBudget: 3,
                minimumLiveRatio: 0.75,
                permissionScope: "all",
                nodeParameters: ["start_amount", "retention"],
                edgeParameters: ["decay", "delay", "confidence"],
                structuralActions: ["add_node", "add_edge"],
            },
        },
        {
            key: "blue",
            label: "Blue",
            title: "Resilient defense",
            description: "Prioritizes stability and recovery, with broad repair authority but no node deletion.",
            settings: {
                name: "Blue Resilience",
                orientation: "stabilize",
                objectiveMode: "behavior",
                objectiveBehavior: "Optimal",
                objectiveSpectralRadius: 0.95,
                weight: 1,
                scorePreset: "stability_first",
                gamma: 0.99,
                parameterCost: 0.02,
                structuralCost: 0.03,
                moveBudget: 20,
                structuralBudget: 4,
                minimumLiveRatio: 0.75,
                permissionScope: "all",
                nodeParameters: ["start_amount", "retention"],
                edgeParameters: ["correlation", "decay", "delay", "confidence"],
                structuralActions: ["add_node", "add_edge", "remove_edge"],
            },
        },
        {
            key: "red",
            label: "Red",
            title: "Competitive pressure",
            description: "Applies bounded pressure to a selected opponent through parameters and adjacent edges.",
            settings: {
                name: "Red Competition",
                orientation: "disrupt",
                objectiveMode: "behavior",
                objectiveBehavior: "Optimal",
                objectiveSpectralRadius: null,
                weight: 1,
                scorePreset: "responsive",
                gamma: 0.96,
                parameterCost: 0.04,
                structuralCost: 0.18,
                moveBudget: 12,
                structuralBudget: 2,
                minimumLiveRatio: 0.65,
                permissionScope: "objective",
                nodeParameters: ["start_amount", "retention"],
                edgeParameters: ["correlation", "decay", "delay", "confidence"],
                structuralActions: ["add_edge", "remove_edge"],
            },
        },
        {
            key: "black",
            label: "Black",
            title: "Bounded disruption",
            description: "Tests fragmentation or collapse pressure under high costs, a tight budget, and anti-collapse limits.",
            settings: {
                name: "Black Disruption",
                orientation: "disrupt",
                objectiveMode: "behavior",
                objectiveBehavior: "Optimal",
                objectiveSpectralRadius: 0.95,
                weight: 1,
                scorePreset: "stability_first",
                gamma: 0.9,
                parameterCost: 0.08,
                structuralCost: 0.35,
                moveBudget: 8,
                structuralBudget: 1,
                minimumLiveRatio: 0.5,
                permissionScope: "objective",
                nodeParameters: ["start_amount", "retention"],
                edgeParameters: ["correlation", "decay", "delay", "confidence"],
                structuralActions: ["add_edge", "remove_edge", "remove_node"],
            },
        },
    ];

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function list() {
        return clone(presets);
    }

    function get(key) {
        var match = presets.find(function (preset) { return preset.key === key; });
        return clone(match || presets[0]);
    }

    function toggle(currentKey, requestedKey) {
        var requested = get(requestedKey).key;
        if (requested !== "custom" && requested === currentKey) return "custom";
        return requested;
    }

    function minimumLiveNodes(key, nodeCount) {
        var count = Math.max(0, Math.floor(Number(nodeCount) || 0));
        var preset = get(key);
        if (!preset.settings || count === 0) return count > 0 ? 1 : 0;
        return Math.max(1, Math.min(count, Math.ceil(count * preset.settings.minimumLiveRatio)));
    }

    return Object.freeze({
        list: list,
        get: get,
        toggle: toggle,
        minimumLiveNodes: minimumLiveNodes,
    });
});
