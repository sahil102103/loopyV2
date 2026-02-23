/**********************************

DRAGGER + PAN

**********************************/

function Dragger(loopy){

	var self = this;
	self.loopy = loopy;

	// Dragging anything?
	self.dragging = null;
	self.offsetX = 0;
	self.offsetY = 0;

	// Panning state (uses raw CSS coords since panning changes the transform)
	var isPanning = false;
	var panStartRawX = 0;
	var panStartRawY = 0;
	var panStartOffsetX = 0;
	var panStartOffsetY = 0;

	// Spacebar held = temporary pan mode
	var spaceHeld = false;
	window.addEventListener("keydown", function(e) {
		if (e.code === "Space" && !spaceHeld) {
			spaceHeld = true;
			document.getElementById("canvasses").style.cursor = "grab";
		}
	});
	window.addEventListener("keyup", function(e) {
		if (e.code === "Space") {
			spaceHeld = false;
			if (!isPanning) {
				document.getElementById("canvasses").style.cursor = "";
			}
		}
	});

	function startPan() {
		isPanning = true;
		panStartRawX = Mouse.rawX;
		panStartRawY = Mouse.rawY;
		panStartOffsetX = loopy.offsetX;
		panStartOffsetY = loopy.offsetY;
		document.getElementById("canvasses").style.cursor = "grabbing";
	}

	subscribe("mousedown", function(event){

		// Middle-mouse button always pans (button === 1)
		// handled separately via native listener below

		// Spacebar + click = pan
		if (spaceHeld) {
			startPan();
			return;
		}

		// Pan tool — always pan
		if (self.loopy.mode==Loopy.MODE_EDIT && self.loopy.tool==Loopy.TOOL_PAN) {
			startPan();
			return;
		}

		// ONLY WHEN EDITING w DRAG
		if(self.loopy.mode!=Loopy.MODE_EDIT) return;
		if(self.loopy.tool!=Loopy.TOOL_DRAG) return;

		// Any node under here? If so, start dragging!
		var dragNode = loopy.model.getNodeByPoint(Mouse.x, Mouse.y);
		if(dragNode){
			self.dragging = dragNode;
			self.offsetX = Mouse.x - dragNode.x;
			self.offsetY = Mouse.y - dragNode.y;
			loopy.sidebar.edit(dragNode);
			return;
		}

		// Any label under here? If so, start dragging!
		var dragLabel = loopy.model.getLabelByPoint(Mouse.x, Mouse.y);
		if(dragLabel){
			self.dragging = dragLabel;
			self.offsetX = Mouse.x - dragLabel.x;
			self.offsetY = Mouse.y - dragLabel.y;
			loopy.sidebar.edit(dragLabel);
			return;
		}

		// Any edge under here? If so, start dragging!
		var dragEdge = loopy.model.getEdgeByPoint(Mouse.x, Mouse.y);
		if(dragEdge){
			self.dragging = dragEdge;
			self.offsetX = Mouse.x - dragEdge.labelX;
			self.offsetY = Mouse.y - dragEdge.labelY;
			loopy.sidebar.edit(dragEdge);
			return;
		}

		// Nothing under cursor — pan the canvas
		startPan();

	});

	subscribe("mousemove", function(){

		// Panning takes priority
		if (isPanning) {
			// Use raw (CSS) coords: offset is in retina space, so multiply delta by 2
			var dx = (Mouse.rawX - panStartRawX) * 2;
			var dy = (Mouse.rawY - panStartRawY) * 2;
			loopy.offsetX = panStartOffsetX + dx;
			loopy.offsetY = panStartOffsetY + dy;
			loopy.model.offsetX = loopy.offsetX;
			loopy.model.offsetY = loopy.offsetY;
			loopy.model.dirty();
			return;
		}

		// ONLY WHEN EDITING w DRAG
		if(self.loopy.mode!=Loopy.MODE_EDIT) return;
		if(self.loopy.tool!=Loopy.TOOL_DRAG) return;

		// If you're dragging a NODE, move it around!
		if(self.dragging && self.dragging._CLASS_=="Node"){
			publish("model/changed");
			var node = self.dragging;
			node.x = Mouse.x - self.offsetX;
			node.y = Mouse.y - self.offsetY;
			loopy.model.update();
		}

		// If you're dragging an EDGE, move it around!
		if(self.dragging && self.dragging._CLASS_=="Edge"){
			publish("model/changed");
			var edge = self.dragging;
			var labelX = Mouse.x - self.offsetX;
			var labelY = Mouse.y - self.offsetY;

			if(edge.from!=edge.to){
				var fx=edge.from.x, fy=edge.from.y, tx=edge.to.x, ty=edge.to.y;
				var dx=tx-fx, dy=ty-fy;
				var a = Math.atan2(dy,dx);
				var points = [[labelX,labelY]];
				var translated = _translatePoints(points, -fx, -fy);
				var rotated = _rotatePoints(translated, -a);
				var newLabelPoint = rotated[0];
				edge.arc = -newLabelPoint[1];
			}else{
				var dx = labelX - edge.from.x,
					dy = labelY - edge.from.y;
				var a = Math.atan2(dy,dx);
				var mag = Math.sqrt(dx*dx + dy*dy);
				var minimum = edge.from.radius+25;
				if(mag<minimum) mag=minimum;
				edge.arc = mag;
				edge.rotation = a*(360/Math.TAU)+90;
			}
			loopy.model.update();
		}

		// If you're dragging a LABEL, move it around!
		if(self.dragging && self.dragging._CLASS_=="Label"){
			publish("model/changed");
			var label = self.dragging;
			label.x = Mouse.x - self.offsetX;
			label.y = Mouse.y - self.offsetY;
			loopy.model.update();
		}

	});

	subscribe("mouseup", function(){

		if (isPanning) {
			isPanning = false;
			if (spaceHeld) {
				document.getElementById("canvasses").style.cursor = "grab";
			} else if (loopy.tool !== Loopy.TOOL_PAN) {
				document.getElementById("canvasses").style.cursor = "";
			}
			return;
		}

		// ONLY WHEN EDITING w DRAG
		if(self.loopy.mode!=Loopy.MODE_EDIT) return;
		if(self.loopy.tool!=Loopy.TOOL_DRAG) return;

		self.dragging = null;
		self.offsetX = 0;
		self.offsetY = 0;

	});

	// Middle-mouse button panning (works with any tool)
	var canvasses = document.getElementById("canvasses");
	canvasses.addEventListener("mousedown", function(e) {
		if (e.button === 1) {
			e.preventDefault();
			startPan();
		}
	});
	canvasses.addEventListener("auxclick", function(e) {
		if (e.button === 1) e.preventDefault();
	});

}
