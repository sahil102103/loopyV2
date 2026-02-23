/**********************************

MULTIPLE-SELECT

**********************************/

function MultipleSelect(loopy) {
    var self = this;
    self.loopy = loopy;
    var selectedNodes = [];
    var isDragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var dragNodeStartPositions = [];

    self.getSelectedNodes = function () {
        return selectedNodes;
    };

    self.clearSelection = function () {
        selectedNodes = [];
        loopy.model.dirty();
    };

    self.removeNode = function (node) {
        selectedNodes = selectedNodes.filter(function(n) { return n !== node; });
    };

    // Clear selection when switching away from multi-select tool
    subscribe("key/ink", function () { self.clearSelection(); });
    subscribe("key/drag", function () { self.clearSelection(); });
    subscribe("key/erase", function () { self.clearSelection(); });
    subscribe("key/label", function () { self.clearSelection(); });

    subscribe("mousedown", function () {
        if (self.loopy.mode !== Loopy.MODE_EDIT) return;
        if (self.loopy.tool !== Loopy.TOOL_MULTISELECT) return;

        var clickedNode = loopy.model.getNodeByPoint(Mouse.x, Mouse.y);
        if (clickedNode && selectedNodes.indexOf(clickedNode) !== -1) {
            // Start dragging the selected group
            isDragging = true;
            dragStartX = Mouse.x;
            dragStartY = Mouse.y;
            dragNodeStartPositions = selectedNodes.map(function(node) {
                return { node: node, x: node.x, y: node.y };
            });
        }
    });

    subscribe("mousemove", function () {
        if (self.loopy.mode !== Loopy.MODE_EDIT) return;
        if (self.loopy.tool !== Loopy.TOOL_MULTISELECT) return;

        if (isDragging && selectedNodes.length > 0) {
            var dx = Mouse.x - dragStartX;
            var dy = Mouse.y - dragStartY;
            for (var i = 0; i < dragNodeStartPositions.length; i++) {
                var entry = dragNodeStartPositions[i];
                entry.node.x = entry.x + dx;
                entry.node.y = entry.y + dy;
            }
            publish("model/changed");
            loopy.model.update();
        }
    });

    subscribe("mouseup", function () {
        if (self.loopy.mode !== Loopy.MODE_EDIT) return;
        if (self.loopy.tool !== Loopy.TOOL_MULTISELECT) return;

        if (isDragging) {
            isDragging = false;
            dragNodeStartPositions = [];
        }
    });

    subscribe("mouseclick", function () {
        if (self.loopy.mode !== Loopy.MODE_EDIT) return;
        if (self.loopy.tool !== Loopy.TOOL_MULTISELECT) return;

        var clickedNode = loopy.model.getNodeByPoint(Mouse.x, Mouse.y);
        if (!clickedNode) return;

        // Toggle node selection
        var idx = selectedNodes.indexOf(clickedNode);
        if (idx !== -1) {
            selectedNodes.splice(idx, 1);
        } else {
            selectedNodes.push(clickedNode);
        }
        loopy.model.dirty();
    });
}
