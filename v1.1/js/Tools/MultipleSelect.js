/**********************************

MULTIPLE-SELECT

**********************************/

function MultipleSelect(loopy) {
    var self = this;
    self.loopy = loopy;
    var selectedNodes = [];

    self.multipleSelect = function (clickedNode) {
        if (self.loopy.mode !== Loopy.MODE_EDIT || self.loopy.tool !== Loopy.TOOL_MULTISELECT) return;

        // Toggle node selection
        if (selectedNodes.includes(clickedNode)) {
            selectedNodes = selectedNodes.filter(node => node !== clickedNode);
        } else {
            selectedNodes.push(clickedNode);
        }
    };

    self.getSelectedNodes = function () {
        return selectedNodes;
    };

    subscribe("mouseclick", function (data) {
        // Check if a node is clicked
        var clickedNode = loopy.model.getNodeByPoint(Mouse.x, Mouse.y);
        if (clickedNode) self.multipleSelect(clickedNode);
    });
}
