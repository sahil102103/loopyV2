/**********************************

NODE!

**********************************/

Node.COLORS = {
    0: "#e71d43", // crimson
    1: "#ff0000", // red
    2: "#ff3700", // red-orange
    3: "#ff6e00", // orange
    4: "#ffa500", // light orange
    5: "#ffc300", // light yellow-orange
    6: "#ffe100", // yellow-orange
    7: "#ffff00", // yellow
    8: "#aad500", // light green
    9: "#55aa00", // green
    10: "#008000", // dark green
    11: "#005555", // teal
    12: "#002baa", // blue
    13: "#0000ff", // bright blue
    14: "#1900d5", // indigo
    15: "#3200ac", // dark indigo
    16: "#4b0082", // dark violet
    17: "#812ba6", // violet
    18: "#b857ca", // light violet
    19: "#d03a87"  // magenta
};


Node.defaultValue = 0.4;
Node.defaultHue = 0;

Node.DEFAULT_RADIUS = 60;
Node.DEFAULT_FLOOR = Number.NEGATIVE_INFINITY;
Node.DEFAULT_CEIL = Number.POSITIVE_INFINITY;
Node.DEFAULT_FLOW = 0;

var selectedNodes = [];

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
		floor: Node.DEFAULT_FLOOR,
		ceiling: Node.DEFAULT_CEIL,
		flow: Node.DEFAULT_FLOW
	});
	// Value: from 0 to 1
	self.value = self.init;
	// TODO: ACTUALLY VISUALIZE AN INFINITE RANGE
	self.bound = function(){ // bound ONLY when changing value.
		/*var buffer = 1.2;
		if(self.value<-buffer) self.value=-buffer;
		if(self.value>1+buffer) self.value=1+buffer;*/
	};

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



	var _listenerMouseDownNotPlaying = subscribe("mousedown", function() {
		if(_controlsPressedWhenNotInPlay) {
			onmousedown = (event) => {
				if (event.shiftKey) {
					if (selectedNodes.includes(self)) {
						selectedNodes = selectedNodes.filter(node => node !== self);
					} else {
						selectedNodes.push(self);
					}
				};
			}
		}
    });


    var _listenerMouseDown = subscribe("mousedown", function() {

        if(self.loopy.mode!=Loopy.MODE_PLAY) return; // ONLY WHEN PLAYING
        if(_controlsSelected) _controlsPressed = true;

		// IF YOU CLICKED ME...
        if(_controlsPressed) {
			var delta = _controlsDirection * 0.33;
			self.value += delta;
			console.log(self.value)
			self.sendSignal({ delta: delta });
			if (self.value > self.ceiling) {
				self.value = Math.min(self.ceiling, self.value)
			} else if (self.value < self.floor) {
				self.value = Math.max(self.floor, self.value)
			}

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
		for(var i=0; i<myEdges.length; i++){
			myEdges[i].addSignal(signal);
		}
	};

	var tick = 1

	self.takeSignal = function(signal) {
		// Change value
		// self.value += self.flow
		self.value += signal.delta;

		if (self.value > self.ceiling) {
			self.value = Math.min(self.ceiling, self.value)
		} else if (self.value < self.floor) {
			self.value = Math.max(self.floor, self.value)
		}
	
		// Propagate signal
		self.sendSignal(signal);

		// Update the time series chart for each node
		if (chart && (selectedNodes.length == 0)) {
			chart.data.labels.push(tick);
			tick++
			for (let i = 0; i < model.nodes.length; i++) {
				updateTimeSeriesChart(model.nodes[i].value, i);
			}
		} else if (chart && selectedNodes) {
			chart.data.labels.push(tick);
			tick++
			for (let i = 0; i < selectedNodes.length; i++) {
				updateTimeSeriesChart(selectedNodes[i].value, i);
			}
		}
		_offsetVel -= 6 * (signal.delta/Math.abs(signal.delta));

	}
	

	//////////////////////////////////////
	// UPDATE & DRAW /////////////////////
	//////////////////////////////////////

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
		if(_offset>40) _offset=40
		if(_offset<-40) _offset=-40;
		_offsetVel += _offsetAcc;
		_offsetVel *= _offsetDamp;
		_offsetAcc = (_offsetGoto-_offset)*_offsetHookes;

	};

	// Draw
	var _circleRadius = 0;
	self.draw = function(ctx){

		// Retina
		var x = self.x*2;
		var y = self.y*2;
		var r = self.radius*2;
		var color = Node.COLORS[self.hue];
		var flow = (self.flow != 0)

		// Translate!
		ctx.save();
		ctx.translate(x,y+_offset);
		
		// DRAW HIGHLIGHT???
		if (self.loopy.sidebar.currentPage.target == self){
			ctx.beginPath();
			ctx.arc(0, 0, r+40, 0, Math.TAU, false);
			ctx.fillStyle = HIGHLIGHT_COLOR;
			ctx.fill();
		}

		// DRAW HIGHLIGHT???
		if (selectedNodes.includes(self)){
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
		var _circleRadiusGoto = r*_value; // radius
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

		// Kill Listeners!
		unsubscribe("mousemove",_listenerMouseMove);
		unsubscribe("mousedown",_listenerMouseDown);
		unsubscribe("mousedown",_listenerMouseDownNotPlaying);
		unsubscribe("mouseup",_listenerMouseUp);
		unsubscribe("model/reset",_listenerReset);

		// Remove from parent!
		model.removeNode(self);

		// Remove from selected nodes
		selectedNodes = selectedNodes.filter(node => node !== self);

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
