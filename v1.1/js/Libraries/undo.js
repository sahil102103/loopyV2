/**********************************
UNDO MANAGER!
**********************************/

// Define the UndoManager
function UndoManager() {
    this.historyStack = []; // Stores undo states
    this.redoStack = [];    // Stores redo states
}

// Save the current model state to history
UndoManager.prototype.saveState = function(model) {
    const stateSnapshot = {
        nodes: model.nodes.map(node => ({
            id: node.id,
            x: node.x,
            y: node.y,
            value: node.value,
            label: node.label,
            radius: node.radius,
            // Add other node properties as needed
        })),
        edges: model.edges.map(edge => ({
            id: edge.id,
            from: edge.from.id, // Save `from` node ID
            to: edge.to.id,     // Save `to` node ID
            arc: edge.arc,
            lag: edge.lag,
            strength: edge.strength,
            // Add other edge properties as needed
        })),
        labels: model.labels.map(label => ({
            id: label.id,
            text: label.text,
            x: label.x,
            y: label.y,
        })),
    };

    this.historyStack.push(stateSnapshot);
    this.redoStack = []; // Clear redo stack on new actions
};

// Restore a specific state to the model
UndoManager.prototype.restoreState = function(model, state) {
    // Restore nodes first
    model.nodes = state.nodes.map(config => new Node(model, config));

    // Restore edges after nodes
    model.edges = state.edges.map(config => {
        const edge = new Edge(model, config);
        edge.from = model.getNode(config.from); // Restore `from` node
        edge.to = model.getNode(config.to);     // Restore `to` node
        return edge;
    });

    // Restore labels
    model.labels = state.labels.map(config => new Label(model, config));

    model.update(); // Trigger a re-render
};

// Undo the last action
UndoManager.prototype.undo = function(model) {
    if (this.historyStack.length > 0) {
        const lastState = this.historyStack.pop();
        this.redoStack.push(this.createSnapshot(model)); // Save current state to redo stack
        this.restoreState(model, lastState);
    } else {
        console.warn("No actions to undo.");
    }
};

// Redo the last undone action
UndoManager.prototype.redo = function(model) {
    if (this.redoStack.length > 0) {
        const redoState = this.redoStack.pop();
        this.historyStack.push(this.createSnapshot(model)); // Save current state to undo stack
        this.restoreState(model, redoState);
    } else {
        console.warn("No actions to redo.");
    }
};

// Create a snapshot of the current state
UndoManager.prototype.createSnapshot = function(model) {
    return {
        nodes: model.nodes.map(node => ({
            id: node.id,
            x: node.x,
            y: node.y,
            value: node.value,
            label: node.label,
            radius: node.radius,
            // Add other node properties as needed
        })),
        edges: model.edges.map(edge => ({
            id: edge.id,
            from: edge.from.id, // Save `from` node ID
            to: edge.to.id,     // Save `to` node ID
            arc: edge.arc,
            lag: edge.lag,
            strength: edge.strength,
            // Add other edge properties as needed
        })),
        labels: model.labels.map(label => ({
            id: label.id,
            text: label.text,
            x: label.x,
            y: label.y,
        })),
    };
};

document.addEventListener('keydown', function(event) {
    // Check if the Ctrl key is pressed (Cmd key on Mac)
    const isCtrl = event.ctrlKey || event.metaKey;

    // Undo: Ctrl+Z or Cmd+Z
    if (isCtrl && event.key === 'z' && !event.shiftKey) {
        event.preventDefault(); // Prevent browser's default Undo
        if (window.undoManager && typeof loopy !== 'undefined') {
            undoManager.undo(loopy.model);
        } else {
            console.warn('UndoManager or model is not defined.');
        }
    }

    // Redo: Ctrl+Shift+Z or Cmd+Shift+Z
    if (isCtrl && event.key === 'z' && event.shiftKey) {
        event.preventDefault(); // Prevent browser's default Redo
        if (window.undoManager && typeof loopy !== 'undefined') {
            undoManager.redo(loopy.model);
        } else {
            console.warn('UndoManager or model is not defined.');
        }
    }
});

// Add to the global scope for accessibility
window.undoManager = new UndoManager();
