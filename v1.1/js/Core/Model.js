// import undoManager from './undo.js';

/**********************************

MODEL!

**********************************/

function Model(loopy){

	var self = this;
	self.loopy = loopy;
	// undoManager = Undo(loopy)

	// Properties
	self.speed = 0.05;

	// Create canvas & context
	var canvas = _createCanvas();
	var ctx = canvas.getContext("2d");
	self.canvas = canvas;
	self.context = ctx;

    // Initialize scale and position for panning and zooming
    self.scale = 1;
    self.offsetX = 0;
    self.offsetY = 0;
    self.minScale = 0.1;
    self.maxScale = 5.0;
    
    // Initialize sync with Loopy object
    loopy.offsetScale = self.scale;
    loopy.offsetX = self.offsetX;
    loopy.offsetY = self.offsetY;

	// Update canvas size on window resize
	// function resizeCanvas() {
	// 	// self.update();
	// }

    // window.addEventListener('resize', resizeCanvas);
    // resizeCanvas();


    // Handle zoom with scroll, centered on the viewport
    canvas.addEventListener('wheel', function(event) {
        event.preventDefault();
        const zoomSpeed = 0.1;
        const scaleDelta = event.deltaY > 0 ? 1 - zoomSpeed : 1 + zoomSpeed;

        var newScale = self.scale * scaleDelta;
        if (newScale >= self.minScale && newScale <= self.maxScale) {
            // Zoom around the center of the canvas
            var cx = canvas.width / 2;
            var cy = canvas.height / 2;
            loopy.offsetX = cx - scaleDelta * (cx - loopy.offsetX);
            loopy.offsetY = cy - scaleDelta * (cy - loopy.offsetY);
            self.offsetX = loopy.offsetX;
            self.offsetY = loopy.offsetY;

            self.scale = newScale;
            loopy.offsetScale = self.scale;
            self.dirty();
        }
    });

	self.restoringState = false;
	// Inside Loopy or Model initialization
	self.undoStack = [];
	self.redoStack = [];

	// Save the current state of the model
	self.saveState = function () {
		const serializedState = {
			nodes: self.nodes.map(node => ({
				id: node.id,
				x: node.x,
				y: node.y,
				init: node.init,
				value: node.value,
				label: node.label,
				hue: node.hue,
				radius: node.radius,
				flow: node.flow,
				pass: node.pass,
				floor: node.floor,
				ceiling: node.ceiling,
			})),
			edges: self.edges.map(edge => ({
				id: edge.id,
				from: edge.from.id,
				to: edge.to.id,
				arc: edge.arc,
				rotation: edge.rotation,
				lag: edge.lag,
				strength: edge.strength,
				damper: edge.damper,
			})),
			labels: self.labels.map(label => ({
				id: label.id,
				text: label.text,
				x: label.x,
				y: label.y,
			})),
			nodeUID: Node._UID,
		};

		self.undoStack.push(serializedState);
		self.redoStack = [];
	};
	
	

	// Restore a state
	self.restoreState = function (state) {
		self.restoringState = true;

		self.clear();

		// Restore UID counter so future nodes don't collide
		if (state.nodeUID !== undefined) {
			Node._UID = state.nodeUID;
		}

		// Recreate nodes (addNode handles nodeByID registration)
		state.nodes.forEach(function(node) {
			self.addNode(node);
		});

		// Recreate edges — from/to are now IDs, which Edge constructor resolves via model.getNode()
		state.edges.forEach(function(edge) {
			self.addEdge({
				from: edge.from,
				to: edge.to,
				arc: edge.arc,
				rotation: edge.rotation,
				lag: edge.lag,
				strength: edge.strength,
				damper: edge.damper,
			});
		});

		// Recreate labels
		state.labels.forEach(function(label) {
			self.addLabel(label);
		});

		self.update();

		self.restoringState = false;
	};


	// Combined subscription for model changes
	subscribe("model/changed", function () {
		// self.saveState(); // Save the new state
		self.dirty(); // Mark canvas as dirty for redraw
	});
	

	// Handle model reset
	subscribe("model/reset", function () {
		self.saveState();
	});

	// Undo functionality
	self.undo = function () {
		if (self.undoStack.length > 1) { // Keep at least the initial state
			const currentState = self.undoStack.pop(); // Remove current state
			self.redoStack.push(currentState); // Save it to redo stack
			const previousState = self.undoStack[self.undoStack.length - 1]; // Get previous state
			self.restoreState(previousState);
		}
	};

	// Redo functionality
	self.redo = function () {		
		if (self.redoStack.length > 0) {
			const nextState = self.redoStack.pop(); // Get the next state
			self.undoStack.push(nextState); // Save current state to undo stack
			self.restoreState(nextState);
		}
	};





	///////////////////
	// NODES //////////
	///////////////////
	// Nodes
	self.nodes = [];
	self.nodeByID = {};
	self.getNode = function(id){
		return self.nodeByID[id];
	};
	// self.nodeLabels = [];

	// Add Node
	self.addNode = function(config){

		// Model's been changed (only if not restoring state)!
		if (!self.restoringState) {
			publish("model/changed");
		}

		// Save state before adding the new node
		// window.undoRedoCoordinator.undoManager.saveState();

		// Add Node
		var node = new Node(self, config);

		
		self.nodeByID[node.id] = node;
		self.nodes.push(node);
		self.update();

		if (!self.restoringState) {
			self.saveState()
		}
		return node;

	};

	// Remove Node
	self.removeNode = function(node){

		// Model's been changed!
		publish("model/changed");

		// Save state before deleting the node
		// window.undoRedoCoordinator.saveState(self);

		// Remove from array
		self.nodes.splice(self.nodes.indexOf(node), 1);
		// self.nodeLabels.splice(self.nodeLabels.indexOf(node),1);


		// Remove from object
		delete self.nodeByID[node.id];

		// Remove all associated TO and FROM edges
		for(var i=0; i<self.edges.length; i++){
			var edge = self.edges[i];
			if(edge.to==node || edge.from==node){
				edge.kill();
				i--; // move index back, coz it's been killed
			}
		}
		if (!self.restoringState) {
			self.saveState()
		}
		
	};


	///////////////////
	// EDGES //////////
	///////////////////

	// Edges
	self.edges = [];
	self.edgeByID = {};
	self.getEdge = function(id){
		return self.edgeByID[id];
	};

	// Add edge
	self.addEdge = function(config){

		// Model's been changed (only if not restoring state)!
		if (!self.restoringState) {
			publish("model/changed");
		}
		// Save state before adding the new edge
		// undoManager.saveState(self);

		// Add Edge
		var edge = new Edge(self, config);
		self.edgeByID[edge.id] = edge;
		self.edges.push(edge);
	
		// var ghostNode = new GhostNode(self, {}, edge);
		// console.log(ghostNode.edge)
		// console.log(ghostNode.x)
		// edge.ghostNode = ghostNode;
		// self.addNode(ghostNode);
	
		self.update();
		if (!self.restoringState) {
			self.saveState()
		}
	
		return edge;
	};

	// Remove edge
	self.removeEdge = function(edge){

		// Save state before deleting the edge
		// undoManager.saveState(self);
		// Model's been changed!
		publish("model/changed");

		// Remove edge
		self.edges.splice(self.edges.indexOf(edge),1);

		if (!self.restoringState) {
			self.saveState()
		}

	};

	// Get all edges with start node
	self.getEdgesByStartNode = function(startNode){
		return self.edges.filter(function(edge){
			return(edge.from==startNode);
		});
	};




	///////////////////
	// LABELS /////////
	///////////////////

	// Labels
	self.labels = [];

	// Remove label
	self.addLabel = function(config){


		// Model's been changed (only if not restoring state)!
		if (!self.restoringState) {
			publish("model/changed");
		}

		// Add label
		var label = new Label(self,config);
		self.labels.push(label);
		self.update();
		// Temporarily disable state saving for labels to fix canvas clearing issue
		// if (!self.restoringState) {
		//	self.saveState()
		// }
		return label;
	};

	// Remove label
	self.removeLabel = function(label){

		// Model's been changed!
		publish("model/changed");

		// Remove label
		self.labels.splice(self.labels.indexOf(label),1);
		if (!self.restoringState) {
			self.saveState()
		}
		
	};



	// Save initial blank state so the very first action can be undone
	self.saveState();

	///////////////////
	// UPDATE & DRAW //
	///////////////////

	var _canvasDirty = false;

	self.dirty = function(){
		_canvasDirty = true;
	};

	self.update = function(){

		// Update edges first
		for(var i=0;i<self.edges.length;i++) self.edges[i].update(self.speed);

		// Phase 1: Compute next value for all nodes
		for(var i=0;i<self.nodes.length;i++) if (typeof self.nodes[i].computeNextValue === 'function') self.nodes[i].computeNextValue(self.speed);

		// Phase 2: Assign nextValue to value for all nodes
		for(var i=0;i<self.nodes.length;i++) {
			if (typeof self.nodes[i].nextValue !== 'undefined') {
				self.nodes[i].value = self.nodes[i].nextValue;
			}
			// Optionally, clean up nextValue
			delete self.nodes[i].nextValue;
		}

		// Dirty!
		_canvasDirty = true;

	};

	// SHOULD WE DRAW?
	var drawCountdownFull = 60; // two-second buffer!
	var drawCountdown = drawCountdownFull; 
	
	// ONLY IF MOUSE MOVE / CLICK
	subscribe("mousemove", function(){ drawCountdown=drawCountdownFull; });
	subscribe("mousedown", function(){ drawCountdown=drawCountdownFull; });

	// OR INFO CHANGED
	subscribe("model/changed", function(){
		
		if(self.loopy.mode==Loopy.MODE_EDIT) drawCountdown=drawCountdownFull;
	});

	// OR RESIZE or RESET
	subscribe("resize",function(){ drawCountdown=drawCountdownFull; });
	subscribe("model/reset",function(){ drawCountdown=drawCountdownFull; });
	subscribe("loopy/mode",function(){
		if(loopy.mode==Loopy.MODE_PLAY){
			drawCountdown=drawCountdownFull*2;
		}else{
			drawCountdown=drawCountdownFull;
		}
	});

	self.draw = function() {
        if (!_canvasDirty) return;
        _canvasDirty = false;

        // Clear!
        ctx.clearRect(0, 0, self.canvas.width, self.canvas.height);

        // Apply transformations for panning and zooming
        ctx.save();
        ctx.translate(loopy.offsetX, loopy.offsetY);
        ctx.scale(loopy.offsetScale, loopy.offsetScale);

        // Draw labels THEN edges THEN nodes
        for (var i = 0; i < self.labels.length; i++) self.labels[i].draw(ctx);
        for (var i = 0; i < self.edges.length; i++) self.edges[i].draw(ctx);
        for (var i = 0; i < self.nodes.length; i++) self.nodes[i].draw(ctx);

        ctx.restore();
    };

    // Zoom methods — all zoom around the canvas center
    self.zoomIn = function() {
        var newScale = self.scale * 1.2;
        if (newScale <= self.maxScale) {
            var scaleDelta = 1.2;
            var cx = canvas.width / 2;
            var cy = canvas.height / 2;
            loopy.offsetX = cx - scaleDelta * (cx - loopy.offsetX);
            loopy.offsetY = cy - scaleDelta * (cy - loopy.offsetY);
            self.offsetX = loopy.offsetX;
            self.offsetY = loopy.offsetY;

            self.scale = newScale;
            loopy.offsetScale = self.scale;
            self.dirty();
        }
    };

    self.zoomOut = function() {
        var newScale = self.scale / 1.2;
        if (newScale >= self.minScale) {
            var scaleDelta = 1 / 1.2;
            var cx = canvas.width / 2;
            var cy = canvas.height / 2;
            loopy.offsetX = cx - scaleDelta * (cx - loopy.offsetX);
            loopy.offsetY = cy - scaleDelta * (cy - loopy.offsetY);
            self.offsetX = loopy.offsetX;
            self.offsetY = loopy.offsetY;

            self.scale = newScale;
            loopy.offsetScale = self.scale;
            self.dirty();
        }
    };

    self.resetZoom = function() {
        self.scale = 1;
        self.offsetX = 0;
        self.offsetY = 0;
        loopy.offsetScale = self.scale;
        loopy.offsetX = self.offsetX;
        loopy.offsetY = self.offsetY;
        self.dirty();
    };

    // Sync zoom state with Loopy object
    self.syncZoomState = function() {
        loopy.offsetScale = self.scale;
        loopy.offsetX = self.offsetX;
        loopy.offsetY = self.offsetY;
    };

    self.setZoom = function(scale) {
        if (scale >= self.minScale && scale <= self.maxScale) {
            self.scale = scale;
            // Sync with Loopy object for mouse coordinates
            loopy.offsetScale = self.scale;
            self.dirty();
        }
    };




	//////////////////////////////
	// SERIALIZE & DE-SERIALIZE //
	//////////////////////////////

	self.serialize = function(){

		var data = [];
		// 0 - nodes
		// 1 - edges
		// 2 - labels
		// 3 - UID

		// Nodes
		var nodes = [];
		for(var i=0;i<self.nodes.length;i++){
			var node = self.nodes[i];

			// 0 - id
			// 1 - x
			// 2 - y
			// 3 - init value
			// 4 - label
			// 5 - hue
			// 6 - flow
			// 7 - pass
			// 8 - floor
			// 9 - ceiling
			nodes.push([
				node.id,
				Math.round(node.x),
				Math.round(node.y),
				node.init,
				encodeURIComponent(encodeURIComponent(node.label)),
				node.hue,
				node.flow,
				node.pass ? 1 : 0,
				encodeURIComponent(node.floor),
				node.ceiling
			]);
		}
		data.push(nodes);

		// Edges
		var edges = [];
		for(var i=0;i<self.edges.length;i++){
			var edge = self.edges[i];
			// 0 - from
			// 1 - to
			// 2 - arc
			// 3 - strength
			// 4 - lag
			// 5 - labelX
			// 6 - labelY
			// 5 - rotation (optional)
			var dataEdge = [
				edge.from.id,
				edge.to.id,
				Math.round(edge.arc),
				edge.strength,
				edge.damper,
				edge.lag,
				edge.edgeLabelX,
				edge.edgeLabelY
			];
			if(dataEdge.f==dataEdge.t){
				dataEdge.push(Math.round(edge.rotation));
			}
			edges.push(dataEdge);
		}
		data.push(edges);

		// Labels
		var labels = [];
		for(var i=0;i<self.labels.length;i++){
			var label = self.labels[i];
			// 0 - x
			// 1 - y
			// 2 - text
			labels.push([
				Math.round(label.x),
				Math.round(label.y),
				encodeURIComponent(encodeURIComponent(label.text))
			]);
		}
		data.push(labels);

		// META.
		data.push(Node._UID);

		// Return as string!
		var dataString = JSON.stringify(data);
		dataString = dataString.replace(/"/gi, "%22"); // and ONLY URIENCODE THE QUOTES
		dataString = dataString.substr(0, dataString.length-1) + "%5D";// also replace THE LAST CHARACTER
		return dataString;

	};

	self.deserialize = function(dataString){

		self.clear();

		var data = JSON.parse(dataString);

		// Get from array!
		var nodes = data[0];
		var edges = data[1];
		var labels = data[2];
		var UID = data[3];

		// Nodes
		for(var i=0;i<nodes.length;i++){
			var node = nodes[i];

			self.addNode({
				id: node[0],
				x: node[1],
				y: node[2],
				init: node[3],
				label: decodeURIComponent(node[4]),
				hue: node[5],
				flow: node[6],
				pass: node[7] === 1,
				floor: Number(node[8]),
				ceiling: node[9],
			});
		}

		// Edges
		for(var i=0;i<edges.length;i++){
			var edge = edges[i];
			var edgeConfig = {
				from: edge[0],
				to: edge[1],
				arc: edge[2],
				strength: edge[3],
				damper: edge[4]
			};
			if(edge[4]) edgeConfig.lag = edge[5];
			if(edge[5]) edgeConfig.rotation=edge[6];
			self.addEdge(edgeConfig);
		}

		// Labels
		for(var i=0;i<labels.length;i++){
			var label = labels[i];
			self.addLabel({
				x: label[0],
				y: label[1],
				text: decodeURIComponent(label[2])
			});
		}

		// META.
		Node._UID = UID;

	};

	self.clear = function(){

		// Just kill ALL nodes.
		while(self.nodes.length>0){
			self.nodes[0].kill();
		}

		// Just kill ALL labels.
		while(self.labels.length>0){
			self.labels[0].kill();
		}
	};

	/////////////////////
	// CLD ANALYSIS /////
	/////////////////////

	// Initialize CLD Engine for this model
	self.cldEngine = null;
	self.cldHistory = {};
	self.cldAnalysisResults = {};

	// Initialize CLD Engine
	self.initCLDEngine = function() {
		if (typeof CLDEngine !== 'undefined' && !self.cldEngine) {
			try {
				self.cldEngine = new CLDEngine();
				// Only initialize graph if we have nodes and edges
				if (self.nodes.length > 0 || self.edges.length > 0) {
					self.cldEngine.initializeGraph(self.toCLDGraph());
				}
			} catch (error) {
				console.warn('CLD Engine initialization failed:', error);
				self.cldEngine = null;
			}
		} else if (!self.cldEngine) {
			console.warn('CLD Engine not available');
		}
	};

	// Convert current model to CLD Engine format
	self.toCLDGraph = function() {
		const graph = {
			nodes: {},
			edges: []
		};

		// Convert nodes
		for (const node of self.nodes) {
			graph.nodes[node.id] = {
				startAmount: node.init || node.value || 0.5,
				retention: node.retention || 1.0,
				floor: node.floor !== undefined ? node.floor : -Infinity,
				ceiling: node.ceiling !== undefined ? node.ceiling : Infinity,
				formula: node.formula || null,
				sinkFormula: node.sinkFormula || null,
				sourceFormula: node.sourceFormula || null
			};
		}

		// Convert edges
		for (const edge of self.edges) {
			graph.edges.push({
				from: edge.from.id,
				to: edge.to.id,
				correlation: edge.strength || 1.0,
				decay: edge.damper || 0.0,
				confidence: edge.confidence || 1.0,
				delay: edge.lag || 0
			});
		}

		return graph;
	};

	// Run CLD simulation
	self.runCLDSimulation = function(options = {}) {
		if (!self.cldEngine) {
			self.initCLDEngine();
		}

		if (!self.cldEngine) {
			throw new Error('CLD Engine not available');
		}

		const config = {
			steps: options.steps || 100,
			initialValues: options.initialValues || {},
			...options
		};

		// Update engine with current model state
		self.cldEngine.initializeGraph(self.toCLDGraph());

		// Run simulation
		const results = self.cldEngine.simulateTwoPhase(config);
		self.cldHistory = results.history;

		return results;
	};

	// Classify behavior using CLD Engine
	self.classifyBehavior = function(options = {}) {
		if (!self.cldEngine) {
			self.initCLDEngine();
		}

		if (!self.cldEngine || !self.cldHistory) {
			// Run simulation first if no history
			self.runCLDSimulation(options);
		}

		if (!self.cldEngine) {
			throw new Error('CLD Engine not available');
		}

		const behavior = self.cldEngine.classifyBehavior(self.cldHistory, options);
		self.cldAnalysisResults.behavior = behavior;

		return behavior;
	};

	// Run Monte Carlo analysis
	self.runMonteCarloAnalysis = function(options = {}) {
		if (!self.cldEngine) {
			self.initCLDEngine();
		}

		if (!self.cldEngine) {
			throw new Error('CLD Engine not available');
		}

		const config = {
			runs: options.runs || 500,
			fanPaths: options.fanPaths || 10,
			sigmaBase: options.sigmaBase || 0.1,
			steps: options.steps || 100,
			...options
		};

		// Update engine with current model state
		self.cldEngine.initializeGraph(self.toCLDGraph());

		// Run Monte Carlo
		const results = self.cldEngine.simulateFanPaths(config);
		self.cldAnalysisResults.monteCarlo = results;

		return results;
	};

	// Run parameter space analysis
	self.runParameterSpaceAnalysis = function(options = {}) {
		if (!self.cldEngine) {
			self.initCLDEngine();
		}

		if (!self.cldEngine) {
			throw new Error('CLD Engine not available');
		}

		const config = {
			retentionRange: options.retentionRange || [0.5, 1.0],
			decayRange: options.decayRange || [0.0, 0.3],
			delayRange: options.delayRange || [0, 5],
			gridSize: options.gridSize || 10,
			steps: options.steps || 100,
			...options
		};

		// Update engine with current model state
		self.cldEngine.initializeGraph(self.toCLDGraph());

		// Run parameter space analysis
		const results = self.cldEngine.analyzeParameterSpace(config);
		self.cldAnalysisResults.parameterSpace = results;

		return results;
	};

	// Get graph analysis (centrality, cycles, etc.)
	self.getGraphAnalysis = function() {
		if (!self.cldEngine) {
			self.initCLDEngine();
		}

		if (!self.cldEngine) {
			throw new Error('CLD Engine not available');
		}

		// Update engine with current model state
		self.cldEngine.initializeGraph(self.toCLDGraph());

		const analysis = {
			centrality: self.cldEngine.calculateCentrality('degree'),
			adjacencyMatrix: self.cldEngine.generateAdjacencyMatrix(),
			cycles: self.cldEngine.detectFeedbackCycles()
		};

		self.cldAnalysisResults.graphAnalysis = analysis;

		return analysis;
	};

	// Run complete CLD analysis
	self.runCompleteCLDAnalysis = function(options = {}) {
		if (!self.cldEngine) {
			self.initCLDEngine();
		}

		if (!self.cldEngine) {
			throw new Error('CLD Engine not available');
		}

		const config = {
			steps: options.steps || 100,
			monteCarloRuns: options.monteCarloRuns || 500,
			gridSize: options.gridSize || 10,
			...options
		};

		// Update engine with current model state
		self.cldEngine.initializeGraph(self.toCLDGraph());

		// Run all analyses
		const simulation = self.runCLDSimulation({ steps: config.steps });
		const behavior = self.classifyBehavior();
		const monteCarlo = self.runMonteCarloAnalysis({ 
			runs: config.monteCarloRuns,
			steps: config.steps 
		});
		const parameterSpace = self.runParameterSpaceAnalysis({ 
			gridSize: config.gridSize,
			steps: config.steps 
		});
		const graphAnalysis = self.getGraphAnalysis();

		const results = {
			simulation,
			behavior,
			monteCarlo,
			parameterSpace,
			graphAnalysis,
			metadata: {
				timestamp: new Date().toISOString(),
				nodeCount: self.nodes.length,
				edgeCount: self.edges.length
			}
		};

		self.cldAnalysisResults = results;

		return results;
	};

	// Get CLD analysis results
	self.getCLDAnalysisResults = function() {
		return self.cldAnalysisResults;
	};

	// Export CLD results
	self.exportCLDResults = function(format = 'json') {
		if (!self.cldAnalysisResults || Object.keys(self.cldAnalysisResults).length === 0) {
			throw new Error('No CLD analysis results to export. Run analysis first.');
		}

		if (format === 'json') {
			return JSON.stringify(self.cldAnalysisResults, null, 2);
		} else if (format === 'csv') {
			// Convert to CSV format
			const lines = [];
			lines.push('Type,Node,Step,Value');
			
			if (self.cldAnalysisResults.simulation && self.cldAnalysisResults.simulation.history) {
				for (const [nodeId, series] of Object.entries(self.cldAnalysisResults.simulation.history)) {
					for (let i = 0; i < series.length; i++) {
						lines.push(`timeSeries,${nodeId},${i},${series[i]}`);
					}
				}
			}

			if (self.cldAnalysisResults.behavior) {
				lines.push('Type,Node,Behavior,Confidence');
				for (const [nodeId, classification] of Object.entries(self.cldAnalysisResults.behavior)) {
					lines.push(`behavior,${nodeId},${classification.behavior},${classification.confidence}`);
				}
			}

			return lines.join('\n');
		}

		return self.cldAnalysisResults;
	};



	//////////////////////
	// AUTO-SAVE /////////
	//////////////////////

	var AUTO_SAVE_KEY = 'flowcld_autosave';
	var AUTO_SAVE_TS_KEY = 'flowcld_autosave_ts';
	var AUTO_SAVE_VIEW_KEY = 'flowcld_autosave_view';
	var AUTO_SAVE_DEBOUNCE_MS = 3000;
	var AUTO_SAVE_INTERVAL_MS = 30000;
	var _autoSaveTimer = null;

	self.autoSave = function() {
		try {
			var data = self.serialize();
			localStorage.setItem(AUTO_SAVE_KEY, data);
			localStorage.setItem(AUTO_SAVE_TS_KEY, Date.now().toString());
			localStorage.setItem(AUTO_SAVE_VIEW_KEY, JSON.stringify({
				scale: self.scale,
				offsetX: loopy.offsetX,
				offsetY: loopy.offsetY
			}));
		} catch(e) {
			console.warn('Auto-save failed:', e);
		}
	};

	self.loadAutoSave = function() {
		try {
			return localStorage.getItem(AUTO_SAVE_KEY);
		} catch(e) {
			console.warn('Failed to load auto-save:', e);
			return null;
		}
	};

	self.loadAutoSaveView = function() {
		try {
			var raw = localStorage.getItem(AUTO_SAVE_VIEW_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch(e) { return null; }
	};

	self.clearAutoSave = function() {
		try {
			localStorage.removeItem(AUTO_SAVE_KEY);
			localStorage.removeItem(AUTO_SAVE_TS_KEY);
			localStorage.removeItem(AUTO_SAVE_VIEW_KEY);
		} catch(e) { /* ignore */ }
	};

	self.getAutoSaveTimestamp = function() {
		try {
			var ts = localStorage.getItem(AUTO_SAVE_TS_KEY);
			return ts ? new Date(parseInt(ts)) : null;
		} catch(e) { return null; }
	};

	// Debounced auto-save on model change
	subscribe("model/changed", function() {
		if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
		_autoSaveTimer = setTimeout(function() {
			if (self.nodes.length > 0 || self.edges.length > 0) {
				self.autoSave();
			}
		}, AUTO_SAVE_DEBOUNCE_MS);
	});

	// Periodic auto-save as safety net
	setInterval(function() {
		if (self.nodes.length > 0 || self.edges.length > 0) {
			self.autoSave();
		}
	}, AUTO_SAVE_INTERVAL_MS);

	// Save before page unload
	window.addEventListener('beforeunload', function() {
		if (self.nodes.length > 0 || self.edges.length > 0) {
			self.autoSave();
		}
	});

	////////////////////
	// HELPER METHODS //
	////////////////////

	self.getNodeByPoint = function(x,y,buffer){
		var result;
		for(var i=self.nodes.length-1; i>=0; i--){ // top-down
			var node = self.nodes[i];
			if(node.isPointInNode(x,y,buffer)) return node;
		}
		return null;
	};

	self.getEdgeByPoint = function(x, y, wholeArrow){
		// TODO: wholeArrow option?
		var result;
		for(var i=self.edges.length-1; i>=0; i--){ // top-down
			var edge = self.edges[i];
			if(edge.isPointOnLabel(x,y)) return edge;
		}
		return null;
	};

	self.getLabelByPoint = function(x, y){
		var result;
		for(var i=self.labels.length-1; i>=0; i--){ // top-down
			var label = self.labels[i];
			if(label.isPointInLabel(x,y)) return label;
		}
		return null;
	};

	// Click to edit!
	subscribe("mouseclick",function(){

		// ONLY WHEN EDITING (and NOT erase)
		if(self.loopy.mode!=Loopy.MODE_EDIT) return;
		if(self.loopy.tool==Loopy.TOOL_ERASE) return;

		// Did you click on a node? If so, edit THAT node.
		var clickedNode = self.getNodeByPoint(Mouse.x, Mouse.y);
		if(clickedNode){
			loopy.sidebar.edit(clickedNode);
			return;
		}

		// Did you click on a label? If so, edit THAT label.
		var clickedLabel = self.getLabelByPoint(Mouse.x, Mouse.y);
		if(clickedLabel){
			loopy.sidebar.edit(clickedLabel);
			return;
		}

		// Did you click on an edge label? If so, edit THAT edge.
		var clickedEdge = self.getEdgeByPoint(Mouse.x, Mouse.y);
		if(clickedEdge){
			loopy.sidebar.edit(clickedEdge);
			return;
		}

		// If the tool LABEL? If so, TRY TO CREATE LABEL.
		if(self.loopy.tool==Loopy.TOOL_LABEL){
			loopy.label.tryMakingLabel();
			return;
		}

		// Otherwise, go to main Edit page.
		loopy.sidebar.showPage("Edit");

	});

	// Centering & Scaling
	self.getBounds = function(){

		// If no nodes & no labels, forget it.
		if(self.nodes.length==0 && self.labels.length==0) return;

		// Get bounds of ALL objects...
		var left = Infinity;
		var top = Infinity;
		var right = -Infinity;
		var bottom = -Infinity;
		var _testObjects = function(objects){
			for(var i=0; i<objects.length; i++){
				var obj = objects[i];
				var bounds = obj.getBoundingBox();
				if(left>bounds.left) left=bounds.left;
				if(top>bounds.top) top=bounds.top;
				if(right<bounds.right) right=bounds.right;
				if(bottom<bounds.bottom) bottom=bounds.bottom;
			}
		};
		_testObjects(self.nodes);
		_testObjects(self.edges);
		_testObjects(self.labels);

		// Return
		return {
			left:left,
			top:top,
			right:right,
			bottom:bottom
		};

	};
	self.center = function(andScale){

		// If no nodes & no labels, forget it.
		if(self.nodes.length==0 && self.labels.length==0) return;

		// Get bounds of ALL objects...
		var bounds = self.getBounds();
		var left = bounds.left;
		var top = bounds.top;
		var right = bounds.right;
		var bottom = bounds.bottom;

		// Re-center!
		var canvasses = document.getElementById("canvasses");
		var fitWidth = canvasses.clientWidth - _PADDING - _PADDING;
		var fitHeight = canvasses.clientHeight - _PADDING_BOTTOM - _PADDING;
		var cx = (left+right)/2;
		var cy = (top+bottom)/2;
		loopy.offsetX = (_PADDING+fitWidth)/2 - cx;
		loopy.offsetY = (_PADDING+fitHeight)/2 - cy;

		// SCALE.
		if(andScale){

			var w = right-left;
			var h = bottom-top;

			// Wider or taller than screen?
			var modelRatio = w/h;
			var screenRatio = fitWidth/fitHeight;
			var scaleRatio;
			if(modelRatio > screenRatio){
				// wider...
				scaleRatio = fitWidth/w;
			}else{
				// taller...
				scaleRatio = fitHeight/h;
			}

			// Loopy, then!
			loopy.offsetScale = scaleRatio;

		}

	};

}