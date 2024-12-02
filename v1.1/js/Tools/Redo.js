function Redo(loopy) {
    
    var self = this;
    self.loopy = loopy;
    self.redoStack = [];

    // Save the current model state
    self.saveState = function(model) {
        const stateSnapshot = self.createSnapshot(model);
        self.redoStack.push(stateSnapshot);
    };

    // Redo the last undone action
    self.redo = function(undoManager) {
        if (self.redoStack.length > 0) {
            const redoState = self.redoStack.pop();
            undoManager.saveState(self.loopy.model); // Save current state to undo stack
            self.restoreState(redoState);
        } else {
            console.warn("No actions to redo.");
        }
    };

    // Restore a specific state to the model
    self.restoreState = function(state) {
        const model = self.loopy.model;

        // Restore nodes
        model.nodes = state.nodes.map(config => new Node(model, config));

        // Restore edges
        model.edges = state.edges.map(config => {
            const edge = new Edge(model, config);
            edge.from = model.getNode(config.from);
            edge.to = model.getNode(config.to);
            return edge;
        });

        // Restore labels
        model.labels = state.labels.map(config => new Label(model, config));

        model.update(); // Trigger a re-render
    };

    // Create a snapshot of the current state
    self.createSnapshot = function(model) {
        return {
            nodes: model.nodes.map(node => ({
                id: node.id,
                x: node.x,
                y: node.y,
                value: node.value,
                label: node.label,
                radius: node.radius,
            })),
            edges: model.edges.map(edge => ({
                id: edge.id,
                from: edge.from.id,
                to: edge.to.id,
                arc: edge.arc,
                lag: edge.lag,
                strength: edge.strength,
            })),
            labels: model.labels.map(label => ({
                id: label.id,
                text: label.text,
                x: label.x,
                y: label.y,
            })),
        };
    };
}
