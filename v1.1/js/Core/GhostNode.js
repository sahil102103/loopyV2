function GhostNode(model, config, edge) {
    var self = this;
    self._CLASS_ = "GhostNode";

    self.loopy = loopy;
    self.model = model;
    self.config = config;
    self.edge = edge;

    // Inherit from Node
    Node.call(self, model, config);

    config.label = '';
    config.hue = "white";

    _configureProperties(self, config, {
        id: Node._getUID,
        x: 0,
        y: 0,
        init: Node.defaultValue,
        label: '',
        hue: Node.defaultHue,
        radius: Node.DEFAULT_RADIUS,
        floor: Node.DEFAULT_FLOOR,
        ceiling: Node.DEFAULT_CEIL,
        flow: Node.DEFAULT_FLOW,
        pass: Node.DEFAULT_PASSNODE,
    });

 

    // Set specific properties for ghost nodes
    self.radius = 10; // Example radius for visibility
    self.pass = true; // Set as a pass node

    // console.log(self)
    // console.log(edge)

    // console.log(self.edge)

    

    // console.log("Ghost Node Position: ", pos); // Debugging log
    // Edge reference
    // self.edge = edge;

    // Position ghost node at the center of the edge
    var startX = edge.from.x;
    var startY = edge.from.y;
    var endX = edge.to.x;
    var endY = edge.to.y;

    

    // self.x = (startX + endX) / 2;
    // self.y = (startY + endY) / 2;
    // for (let i = 0; i < 50; i++ ) {
    //     console.log(self.edge.labelX, self.edge.labelY)

    // }

    // self.x = edge.edgeLabelX;
    // self.y = edge.edgeLabelY;

    // Update the position using the getPositionAlongArrow method
    self.updatePosition = function(x, y) {
        // var pos = self.edge.getPositionAlongArrow(0.5);
        // console.log("Edge Midpoint: ", edge.midPointX, edge.midPointY);
        // console.log("Ghost Node Position: ", self.x, self.y);
        self.x = x;
        self.y = y;
        console.log("whyyyyyy")
        // config.x = edge.midPointX;
        // config.y = edge.midPointY;
        // Redraw or notify the board to update the visual representation
        // Example: redrawBoard();
    };

    // Draw method
    self.draw = function(ctx) {
        ctx.beginPath();
        ctx.arc(edge.labelX, edge.labelY, self.radius, 0, 2 * Math.PI);
        ctx.fillStyle = self.hue;
        ctx.fill();
        ctx.strokeStyle = 'black';
        ctx.stroke();
    };

    // Override isPointInNode to always return false
    self.isPointInNode = function(x, y) {
        return false;
    };

    // Method to get position along the edge
    self.getPositionAlongArrow = function(param) {
        return self.edge.getPositionAlongArrow(param);
    };
}
