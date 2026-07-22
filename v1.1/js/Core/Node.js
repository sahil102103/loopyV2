/**********************************

NODE!

**********************************/

Node.COLORS = {
    0: "#f55a73", // distinguishable lighter crimson
    1: "#ff6666", // distinguishable lighter red
    2: "#ff7040",  // distinguishable lighter red-orange
    3: "#ff8533", // lighter orange
    4: "#ffb733", // lighter light orange
    5: "#ffcf33", // lighter light yellow-orange
    6: "#ffe733", // lighter yellow-orange
    7: "#ffff33", // lighter yellow
    8: "#c3e633", // lighter light green
    9: "#77cc33", // lighter green
    10: "#33a033", // lighter dark green
    11: "#4ca3a3", // lighter teal (unchanged)
    12: "#4d74d9", // distinguishable medium blue
    13: "#6666ff", // distinguishable bright blue
    14: "#7a5cff", // distinguishable indigo
    15: "#8c6be6", // distinguishable dark indigo
    16: "#9f71d4", // distinguishable dark violet
    17: "#b589e6",  // distinguishable violet
    18: "#cf77e1", // lighter light violet
    19: "#e060a0"  // lighter magenta
};



Node.defaultValue = 0.4;
Node.defaultHue = 0;

Node.DEFAULT_RADIUS = 60;
Node.DEFAULT_RETENTION = 1;
Node.DEFAULT_FLOOR = -Infinity;
Node.DEFAULT_CEIL = Infinity;
Node.DEFAULT_FLOW = 0;
Node.DEFAULT_PASSNODE = false;


// var selectedNodes = [];

// // Initialize an empty array to store action history
// let actionHistory = [];

// // Function to add a node
// function addNode(nodeConfig) {
//     // Create the node
//     let newNode = new Node(model, nodeConfig);
//     model.addNode(newNode);

//     // Record the action in history
//     actionHistory.push({
//         action: 'add',
//         node: newNode
//     });
// }


function Node(model, config){
	

	var self = this;
	self._CLASS_ = "Node";

	// Mah Parents!
	self.loopy = model.loopy;
	self.model = model;
	self.config = config;

	// Default values...
	_configureProperties(self, config, {
		id: Node._getUID,
		x: 0,
		y: 0,
		init: Node.defaultValue, // initial value!
		label: '?',
		hue: Node.defaultHue,
		radius: Node.DEFAULT_RADIUS,
		retention: Node.DEFAULT_RETENTION,
		floor: Node.DEFAULT_FLOOR,
		ceiling: Node.DEFAULT_CEIL,
		flow: Node.DEFAULT_FLOW,
		pass: Node.DEFAULT_PASSNODE,
	});
	// Value: from 0 to 1
	self.value = self.init;
	// TODO: ACTUALLY VISUALIZE AN INFINITE RANGE
	self.bound = function(){ // bound ONLY when changing value.
		/*var buffer = 1.2;
		if(self.value<-buffer) self.value=-buffer;
		if(self.value>1+buffer) self.value=1+buffer;*/
	};

	// Add formula properties
	self.formula = config.formula || null;
	self.sinkFormula = config.sinkFormula || null;
	self.sourceFormula = config.sourceFormula || null;

	function _formulaContext(){
		var values = {};
		if (self.model && self.model.nodes) {
			self.model.nodes.forEach(function(node) {
				values[node.label] = node.value;
			});
		}
		return {
			t: (typeof tick !== 'undefined') ? tick : 0,
			x: self.value,
			val: self.value,
			Y0: self.init,
			raw: values,
			nxt: values,
			inputs: {}
		};
	}

	function _evaluateFormula(){
		if (typeof FormulaEvaluator === 'undefined') {
			throw new Error('Formula evaluator is unavailable');
		}
		return FormulaEvaluator.evaluate(self.formula, _formulaContext());
	}

	// MOUSE.
	var _controlsVisible = false;
	var _controlsAlpha = 0;
	var _controlsDirection = 0;
	var _controlsSelected = false;
	var _controlsPressed = false;	
	var _controlsPressedWhenNotInPlay = false

	var _listenerMouseMove = subscribe("mousemove", function(){

		_controlsPressedWhenNotInPlay = self.isPointInNode(Mouse.x, Mouse.y);

		// ONLY WHEN PLAYING
		if(self.loopy.mode!=Loopy.MODE_PLAY) return;

		// If moused over this, show it, or not.
		_controlsSelected = self.isPointInNode(Mouse.x, Mouse.y);
		if(_controlsSelected){
			_controlsVisible = true;
			self.loopy.showPlayTutorial = false;
			_controlsDirection = (Mouse.y<self.y) ? 1 : -1;
		}else{
			_controlsVisible = false;
			_controlsDirection = 0;
		}

	});

	// var _listenerMouseDownNotPlaying = subscribe("mousedown", function() {
	// 	if(_controlsPressedWhenNotInPlay) {
	// 		onmousedown = (event) => {
	// 			if (event.shiftKey) {
	// 				if (selectedNodes.includes(self)) {
	// 					selectedNodes = selectedNodes.filter(node => node !== self);
	// 				} else {
	// 					selectedNodes.push(self);
	// 				}
	// 			};
	// 		}
	// 	}
    // });

	var _listenerDoubleClick = subscribe("dblclick", function() {
		if (self.isPointInNode(Mouse.x, Mouse.y)) {
			if (self.loopy.mode!=Loopy.MODE_PLAY) {
				tick = 1
				loopy.setMode(Loopy.MODE_PLAY)
			}
			self.sendSignal({
				delta: self.value // You can modify this delta value as needed
			});
		}
	});

    var _listenerMouseDown = subscribe("mousedown", function() {

        if(self.loopy.mode!=Loopy.MODE_PLAY) return; // ONLY WHEN PLAYING
        if(_controlsSelected) _controlsPressed = true;

		// IF YOU CLICKED ME...
        if(_controlsPressed) {
			var delta = _controlsDirection * 0.1
			self.value += delta;
			// delta += 
			// delta += self.flow
			self.sendSignal({ delta: delta });
			// if (self.value > self.ceiling) {
			// 	self.value = Math.min(self.ceiling, self.value)
			// } else if (self.value < self.floor) {
			// 	self.value = Math.max(self.floor, self.value)
			// }

		} 
    });

	var _listenerMouseUp = subscribe("mouseup",function(){
		if (self.loopy.mode!=Loopy.MODE_PLAY) return; // ONLY WHEN PLAYING
		_controlsPressed = false;
	});
	var _listenerReset = subscribe("model/reset", function(){
		self.value = self.init;
	});

	//////////////////////////////////////
	// SIGNALS ///////////////////////////
	//////////////////////////////////////

	var shiftIndex = 0;
	self.sendSignal = function(signal){
		var myEdges = self.model.getEdgesByStartNode(self);
		myEdges = _shiftArray(myEdges, shiftIndex);
		shiftIndex = (shiftIndex+1)%myEdges.length;
		for (var i=0; i<myEdges.length; i++) {
			myEdges[i].addSignal(signal);
		}
	};


	self.takeSignal = function(signal) {
		// Signal arrivals are visual only. Model.update commits one synchronized
		// notebook step for every node, independent of arrow arrival order.
		if (signal.delta && isFinite(signal.delta)) {
			_offsetVel -= 6 * (signal.delta / Math.abs(signal.delta));
		}
	}
	

	//////////////////////////////////////
	// UPDATE & DRAW /////////////////////
	//////////////////////////////////////

	// Compute next value for two-phase update
	self.computeNextValue = function(speed) {
		var _isPlaying = (self.loopy.mode==Loopy.MODE_PLAY);

		if (self.loopy.mode==Loopy.MODE_EDIT){
			self.nextValue = self.init;
			return;
		}

		// Formula-based update (if formula is present and in play mode)
		if (_isPlaying && self.formula) {
			try {
				var result = _evaluateFormula();
				if (!isNaN(result) && isFinite(result)) {
					self.nextValue = result;
					if (self.nextValue > self.ceiling) self.nextValue = Math.min(self.ceiling, self.nextValue);
					if (self.nextValue < self.floor) self.nextValue = Math.max(self.floor, self.nextValue);
				}
			} catch (e) {
				if (typeof showToast === 'function') showToast('Formula error on "' + self.label + '": ' + e.message, 'error');
				console.error('Formula evaluation error for node', self.label, ':', e);
			}
			return;
		}

		// For non-formula nodes, default to current value (or you can implement edge-based logic here if needed)
		self.nextValue = self.value;
	};

	// Update!
	var _offset = 0;
	var _offsetGoto = 0;
	var _offsetVel = 0;
	var _offsetAcc = 0;
	var _offsetDamp = 0.3;
	var _offsetHookes = 0.8;
	self.update = function(speed){

		// When actually playing the simulation...
		var _isPlaying = (self.loopy.mode==Loopy.MODE_PLAY);

		// Otherwise, value = initValue exactly
		if (self.loopy.mode==Loopy.MODE_EDIT){
			self.value = self.init;
		}

		// Formula values are committed by Model.update's synchronized compute
		// phase. Re-evaluating here would advance converter nodes twice per step.

		// updateNodeData();

		// Cursor!
		if(_controlsSelected) Mouse.showCursor("pointer");

		// Keep value within bounds!
		self.bound();

		// Visually & vertically bump the node
		var gotoAlpha = (_controlsVisible || self.loopy.showPlayTutorial) ? 1 : 0;
		_controlsAlpha = _controlsAlpha*0.5 + gotoAlpha*0.5;
		if(_isPlaying && _controlsPressed){
			_offsetGoto = -_controlsDirection*20; // by 20 pixels
			// _offsetGoto = _controlsDirection*0.2; // by scale +/- 0.1
		}else{
			_offsetGoto = 0;
		}
		_offset += _offsetVel;
		if (!isFinite(_offset)) _offset = 0;
		if (_offset > 40)  _offset =  40;
		if (_offset < -40) _offset = -40;
		_offsetVel += _offsetAcc;
		_offsetVel *= _offsetDamp;
		_offsetAcc = (_offsetGoto-_offset)*_offsetHookes;

	};

	// Draw
	var _circleRadius = 0;
	self.draw = function(ctx){
		// console.log(self)

		// Retina
		var x = self.x*2;
		var y = self.y*2;
		var r = self.radius*2;
		var color = Node.COLORS[self.hue];
		var flow = (self.flow != 0)

		// Translate!
		ctx.save();
		ctx.translate(x,y+_offset);
		
		// Classification ring (set by Python simulation)
		if (self.classification) {
			var _classRingColors = {
				'Optimal':       'rgba(46, 204, 113, 0.45)',
				'Over-damped':   'rgba(52, 152, 219, 0.45)',
				'Unconstrained': 'rgba(231, 76, 60, 0.45)',
			};
			var _ringColor = _classRingColors[self.classification];
			if (_ringColor) {
				ctx.beginPath();
				ctx.arc(0, 0, r + 26, 0, Math.TAU, false);
				ctx.fillStyle = _ringColor;
				ctx.fill();
			}
		}

		// DRAW HIGHLIGHT???
		if (self.loopy.sidebar.currentPage.target == self){
			ctx.beginPath();
			ctx.arc(0, 0, r+40, 0, Math.TAU, false);
			ctx.fillStyle = HIGHLIGHT_COLOR;
			ctx.fill();
		}

		// DRAW HIGHLIGHT???
		if (loopy.multipleselect.getSelectedNodes().includes(self)){
			ctx.beginPath();
			ctx.arc(0, 0, r+50, 0, Math.TAU, false);
			ctx.fillStyle = MULTIPLE_HIGHLIGHT_COLOR;
			ctx.fill();
		}

		
		// White-gray bubble with colored border
		ctx.beginPath();
		ctx.arc(0, 0, r-2, 0, Math.TAU, false);
		ctx.fillStyle = "#fff";
		ctx.fill();
		ctx.lineWidth = 6;
		ctx.strokeStyle = color;
		ctx.stroke();

		if (flow) {
			ctx.beginPath();
			ctx.arc(0, 0, r - 2, 0, Math.TAU, false);
			ctx.fillStyle = "#fff";
			ctx.fill();
			ctx.lineWidth = 6 + (self.flow * 5);
			ctx.strokeStyle = color;
			ctx.stroke();
		}
		
		// Circle radius
		// var _circleRadiusGoto = r*(self.value+1);
		// _circleRadius = _circleRadius*0.75 + _circleRadiusGoto*0.25;

		// RADIUS IS (ATAN) of VALUE?!?!?!
		var _r = Math.atan(self.value*5);
		_r = _r/(Math.PI/2);
		_r = (_r+1)/2;

		// INFINITE RANGE FOR RADIUS
		// linear from 0 to 1, asymptotic otherwise.
		var _value;
		if(self.value>=0 && self.value<=1){
			// (0,1) -> (0.1, 0.9)
			_value = 0.1 + 0.8*self.value;
		}else{
			if(self.value<0){
				// asymptotically approach 0, starting at 0.1
				_value = (1/(Math.abs(self.value)+1))*0.1;
			}
			if(self.value>1){
				// asymptotically approach 1, starting at 0.9
				_value = 1 - (1/self.value)*0.1;
			}
		}

		// Colored bubble
		ctx.beginPath();
		var _circleRadiusGoto = r * _value; // radius
		_circleRadius = _circleRadius*0.8 + _circleRadiusGoto*0.2;
		ctx.arc(0, 0, _circleRadius, 0, Math.TAU, false);
		ctx.fillStyle = color;
		ctx.fill();

		// Text!
		var fontsize = 40;
		ctx.font = "normal "+fontsize+"px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#000";
		var width = ctx.measureText(self.label).width;
		while(width > r*2 - 30){ // -30 for buffer. HACK: HARD-CODED.
			fontsize -= 1;
			ctx.font = "normal "+fontsize+"px sans-serif";
			width = ctx.measureText(self.label).width;
		}
		ctx.fillText(self.label, 0, 0);

		// WOBBLE CONTROLS
		var cl = 40;
		var cy = 0;
		if(self.loopy.showPlayTutorial && self.loopy.wobbleControls>0){
			var wobble = self.loopy.wobbleControls*(Math.TAU/30);
			cy = Math.abs(Math.sin(wobble))*10;
		}

		// Controls!
		ctx.globalAlpha = _controlsAlpha;
		ctx.strokeStyle = "rgba(0,0,0,0.8)";
		// top arrow
		ctx.beginPath();
		ctx.moveTo(-cl,-cy-cl);
		ctx.lineTo(0,-cy-cl*2);
		ctx.lineTo(cl,-cy-cl);
		ctx.lineWidth = (_controlsDirection>0) ? 10: 3;
		if(self.loopy.showPlayTutorial) ctx.lineWidth=6;
		ctx.stroke();
		// bottom arrow
		ctx.beginPath();
		ctx.moveTo(-cl,cy+cl);
		ctx.lineTo(0,cy+cl*2);
		ctx.lineTo(cl,cy+cl);
		ctx.lineWidth = (_controlsDirection<0) ? 10: 3;
		if(self.loopy.showPlayTutorial) ctx.lineWidth=6;
		ctx.stroke();

		// Restore
		ctx.restore();

	};

	//////////////////////////////////////
	// KILL NODE /////////////////////////
	//////////////////////////////////////

	self.kill = function(){

		// undoManager.saveState(loopy.model);

		// Kill Listeners!
		unsubscribe("mousemove",_listenerMouseMove);
		unsubscribe("mousedown",_listenerMouseDown);
		// unsubscribe("mousedown",_listenerMouseDownNotPlaying);
		unsubscribe("mouseup",_listenerMouseUp);
		unsubscribe("model/reset",_listenerReset);
		unsubscribe("dblclick", _listenerDoubleClick);

		// Remove from parent!
		model.removeNode(self);

		// Remove from selected nodes
		loopy.multipleselect.removeNode(self);

		// Killed!
		publish("kill",[self]);

	};

	//////////////////////////////////////
	// HELPER METHODS ////////////////////
	//////////////////////////////////////

	self.isPointInNode = function(x, y, buffer){
		buffer = buffer || 0;
		return _isPointInCircle(x, y, self.x, self.y, self.radius+buffer);
	};

	// For centering and scaling
	self.getBoundingBox = function(){
		return {
			left: self.x - self.radius,
			top: self.y - self.radius,
			right: self.x + self.radius,
			bottom: self.y + self.radius
		};
	};

}

////////////////////////////
// Unique ID identifiers! //
////////////////////////////

Node._UID = 0;
Node._getUID = function(){
	Node._UID++;
	return Node._UID;
};
