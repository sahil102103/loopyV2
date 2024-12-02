function UndoRedoCoordinator(loopy) {

    var self = this;
    self.undoManager = new UndoManager(loopy);
    self.redoManager = new RedoManager(loopy);

    // Keydown event for undo/redo
    self.handleKeydown = function(event) {
        const isCtrl = event.ctrlKey || event.metaKey;

        // Undo: Ctrl+Z or Cmd+Z
        if (isCtrl && event.key === 'z' && !event.shiftKey) {
            event.preventDefault();
            self.undoManager.undo(self.redoManager);
        }

        // Redo: Ctrl+Shift+Z or Cmd+Shift+Z
        if (isCtrl && event.key === 'z' && event.shiftKey) {
            event.preventDefault();
            self.redoManager.redo(self.undoManager);
        }
    };

    // Subscribe to events
    document.addEventListener('keydown', self.handleKeydown);
    subscribe("mousedown", function() {
        self.undoManager.saveState();
    });

}

// Initialize the UndoRedoCoordinator
// window.undoRedoCoordinator = new UndoRedoCoordinator(loopy);
