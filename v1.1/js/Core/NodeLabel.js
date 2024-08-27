// function NodeLabel(node, config) {
//     var self = this;
//     self._CLASS_ = "NodeLabel";

//     // // Position of the label
//     self.textX = node.x; // Initial position based on the node
//     self.textY = node.y;

//     self.config = config;
//     self.node = node;


//     _configureProperties(self, config, {
//         textX: node.x, // Initial position based on the node
//         textY: node.y,
//     })

//     // console.log(self)

//     // Mouse event listeners for dragging the label
//     var _isDraggingLabel = false;
//     var _offsetXLabel = 0;
//     var _offsetYLabel = 0;

//     var _listenerMouseMoveLabel = subscribe("mousemove", function(){
//         if (_isDraggingLabel) {
//             self.textX = Mouse.x + _offsetXLabel;
//             self.textY = Mouse.y + _offsetYLabel;
//         }
//     });

//     var _listenerMouseDownLabel = subscribe("mousedown", function(){
//         if (self.isPointInText(Mouse.x, Mouse.y)) {
//             _isDraggingLabel = true;
//             _offsetXLabel = self.textX - Mouse.x;
//             _offsetYLabel = self.textY - Mouse.y;
//         }
//     });

//     var _listenerMouseUpLabel = subscribe("mouseup", function(){
//         _isDraggingLabel = false;
//     });

//     self.recenterText = function() {
//         self.textX = node.x;
//         self.textY = node.y;
//     };

//     var textWidth;

//     // Draw the label
//     self.draw = function(ctx){
//         ctx.save();
//         ctx.translate(self.textX * 2, self.textY * 2);
//         ctx.fillStyle = "#000";
//         ctx.font = "30px sans-serif";
//         ctx.textAlign = "center";
//         ctx.textBaseline = "middle";
//         textWidth = ctx.measureText(node.label).width;
//         ctx.fillText(self.node.label, 0, 0); // Draw the label at its own position
//         ctx.restore();
//     };

//     self.isPointInText = function(x, y){
//         var textHeight = 40; // approximate height
//         return x > self.textX - textWidth / 2 &&
//                x < self.textX + textWidth / 2 &&
//                y > self.textY - textHeight / 2 &&
//                y < self.textY + textHeight / 2;
//     };

//     self.kill = function(){
//         unsubscribe("mousemove", _listenerMouseMoveLabel);
//         unsubscribe("mousedown", _listenerMouseDownLabel);
//         unsubscribe("mouseup", _listenerMouseUpLabel);
//     };
// }