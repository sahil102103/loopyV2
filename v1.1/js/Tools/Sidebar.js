/**********************************

SIDEBAR CODE

**********************************/

////////////////////////////////////////////////////////////////////////////////////////////
// SHOW AND HIDE ///////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////
document.getElementById('sidebar-toggle').addEventListener('click', function() {
    var sidebar = document.getElementById('sidebar');
    var toggle = document.getElementById('sidebar-toggle');
    var canvasses = document.getElementById('canvasses');
    var isOpen = !sidebar.classList.contains('collapsed');
    if (isOpen) {
        sidebar.classList.add('collapsed');
        toggle.style.right = '8px';
        canvasses.setAttribute('fullscreen', 'yes');
    } else {
        sidebar.classList.remove('collapsed');
        toggle.style.right = '308px';
        canvasses.removeAttribute('fullscreen');
    }
    // Resize the canvas to fill the new available space
    setTimeout(function() {
        publish("resize");
        if (window.loopy && window.loopy.model) {
            window.loopy.model.dirty();
        }
    }, 350);
});


function Sidebar(loopy){

	var self = this;
	PageUI.call(self, document.getElementById("sidebar"));

	// Edit
	self.edit = function(object){
		if (!object || !object._CLASS_) {
			console.warn('Sidebar.edit: Invalid object provided');
			return;
		}
		
		self.showPage(object._CLASS_);
		
		if (self.currentPage && typeof self.currentPage.edit === 'function') {
			self.currentPage.edit(object);
		} else {
			console.warn('Sidebar.edit: No current page or edit method available for', object._CLASS_);
		}
	};

	// Go back to main when the thing you're editing is killed
	subscribe("kill",function(object){
		if(self.currentPage.target==object){
			self.showPage("Edit");
		}
	});


	////////////////////////////////////////////////////////////////////////////////////////////
	// ACTUAL PAGES ////////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////////////

	// Node!
	(function(){
		var page = new SidebarPage();
		page.addComponent(new ComponentButton({
			header: true,
			label: "back to top",
			onclick: function(){
				self.showPage("Edit");
			}
		}));
		page.addComponent(new ComponentHTML({
			html: `<br><h3>Node</h3>`
		}))
		page.addComponent("label", new ComponentInput({
			label: "Name:",
			id: "label",
		}));

		page.addComponent("hue", new ComponentSlider({
			bg: "colors2",
			label: "Color:",
			options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
			oninput: function(value){
				Node.defaultHue = value;
			}
		}));
		page.addComponent("init", new ComponentSlider({
			bg: "initial",
			label: "Start Amount:",
			options: [0, 0.1, 0.2, 0.3, 0.4, 0.5, .6, .7, .8, .9, 1],
			//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
			oninput: function(value){
				Node.defaultValue = value;
			}
		}));
		page.addComponent("radius", new ComponentSlider({
			bg: "radius",
			label: "Border Radius:",
			options: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
			oninput: function(value){
				Node.DEFAULT_RADIUS = value;
			}
		}));
		page.onedit = function() {
			// Set color of Slider
			var node = page.target;
			var color = Node.COLORS[node.hue];
			page.getComponent("init").setBGColor(color);
		
			// Update the existing title component
			var titleElement = page.dom.querySelector("h3"); // Assumes <h3> is used for the title
			if (titleElement) {
				titleElement.innerHTML = `Node (${node.label || "Unnamed"})`;
			}
		
			// Focus on the name field IF IT'S "" or "?"
			var name = node.label;
			if (name == "" || name == "?") page.getComponent("label").select();
		};


		page.addComponent("retention", new ComponentSlider({
			bg: "lag",
			label: "Node Retention:",
			options: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
			//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
			oninput: function(value){
				Node.DEFAULT_RETENTION = value;
			}
		}));

		page.addComponent("floor", new ComponentInput({
			label: "Floor:",
			id: 'floor'
		}));

		page.addComponent("ceiling", new ComponentInput({
			label: "Ceiling:",
			id: 'ceiling'
		}));

		page.addComponent("pass", new ComponentCheckbox({
			label: 'Pass Node: ',
			id: 'pass',
			value: Node.DEFAULT_PASSNODE,
			onclick: function (value) {
				Node.DEFAULT_PASSNODE = value;
			}
		}))

		// Quick source/sink toggles — set a default constant inflow/outflow without
		// writing an expression. Refine via "Functional Form / Source / Sink…".
		page.addComponent(new ComponentFormulaToggle({
			label: 'Source (constant inflow): ',
			prop: 'sourceFormula',
			defaultFormula: '0.05'
		}));
		page.addComponent(new ComponentFormulaToggle({
			label: 'Sink (constant outflow): ',
			prop: 'sinkFormula',
			defaultFormula: '0.05'
		}));

		page.addComponent(new ComponentHTML({
			html: "<span style='font-size:11px;color:var(--text-secondary)'>Open the editor below for custom Value / Source / Sink expressions.</span>"
		}));
		page.addComponent(new ComponentButton({
			label: "Functional Form / Source / Sink…",
			onclick: function(node){
				publish("modal", ["formula_editor"]);
				// Store the current node for the modal to access
				window.currentFormulaNode = node;
			}
		}));
		self.addPage("Node", page);
	})();
	

	// Edge!
	(function(){
		var page = new SidebarPage();
		page.addComponent(new ComponentButton({
			header: true,
			label: "back to top",
			onclick: function(){
				self.showPage("Edit");
			}
		}));
		page.addComponent(new ComponentHTML({
			html: `<br><h3>Edge</h3>`
		}));

		page.addComponent("strength", new ComponentSlider({
			bg: "strength",
			label: "Correlation:",
			options:[1.00, 0.90, 0.80, 0.70, 0.60, 0.50, 0.40, 0.30, 
				0.20, 0.10, -0.10, -0.20, -0.30, -0.40, -0.50, -0.60, 
				-0.70, -0.80, -0.90, -1.00],
			oninput: function(value){
				Edge.defaultStrength = value;
			}
		}));
		page.addComponent("damper", new ComponentSlider({
			bg: "lag",
			label: "Decay:",
			options:[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0],
			oninput: function(value){
				Edge.damper = value;
			}
		}));

		page.addComponent("confidence", new ComponentSlider({
			bg: "lag",
			label: "Confidence:",
			options:[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0],
			oninput: function(value){
				Edge.defaultStrengthMultiplier = value;
			}
		}));


		page.addComponent("lag", new ComponentSlider({
			bg: "lag",
			label: "Propogation Delay:",
			options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
			oninput: function (value) {
				Edge.defaultLag = value;
			}

		}));


		page.addComponent("functionalForm", new ComponentSelect({
			label: "Functional Form:",
			options: [
				{ value: "linear",    text: "Linear (default)" },
				{ value: "tanh",      text: "Saturating (tanh)" },
				{ value: "quadratic", text: "Accelerating (x·|x|)" },
				{ value: "relu",      text: "Positive only (ReLU)" },
				{ value: "step",      text: "Threshold (sign)" }
			],
			oninput: function(value){
				Edge.defaultFunctionalForm = value;
			}
		}));

		page.addComponent("signal", new ComponentCheckbox({
			label: 'Show Signal: ',
			id: 'signal',
			value: Edge.DEFAULT_SIGNAL,
			onclick: function (value) {

				Edge.DEFAULT_SIGNAL = value;


			}
		}));

		page.addComponent(new ComponentHTML({
			html: "(to make a stronger relationship, draw multiple arrows!)"
		}));

		page.addComponent(new ComponentButton({
			label: "Justification",
			onclick: function(){
				openPage('ViewDatabase')
				const filterNodes = [page.target.from.label, page.target.to.label];
				fetchDatabaseEntries(filterNodes);
			}
		}));

		page.addComponent(new ComponentButton({
			label: "Justification Exact",
			onclick: function(){
				openPage('ViewDatabase')
				const filterNodes = [page.target.from.label, page.target.to.label];
				fetchMatchingNodes(filterNodes);
			}
		}));


		page.addComponent(new ComponentButton({
			label: "delete arrow",
			onclick: function(edge){
				edge.kill();
				self.showPage("Edit");
			}
		}));
		self.addPage("Edge", page);

		page.onedit = function() {
			var edge = page.target;
		
			// Get connected node names
			var fromNode = edge.from ? edge.from.label || "Unnamed" : "Unknown";
			var toNode = edge.to ? edge.to.label || "Unnamed" : "Unknown";
		
			// Update the existing title component
			var titleElement = page.dom.querySelector("h3"); // Assumes <h3> is used for the title
			if (titleElement) {
				titleElement.innerHTML = `Edge (${fromNode} → ${toNode})`;
			}
		};
	})();

	// Label!
	(function(){
		var page = new SidebarPage();
		page.addComponent(new ComponentButton({
			header: true,
			label: "back to top",
			onclick: function(){
				self.showPage("Edit");
			}
		}));
		page.addComponent("text", new ComponentInput({
			label: "<br><br>Label:",
			id: 'text',
			textarea: true
		}));
		page.onshow = function(){
			// Focus on the text field
			page.getComponent("text").select();
		};
		page.onhide = function(){
			// If you'd just edited it...
			var label = page.target;
			if(!page.target) return;

			// If text is "" or all spaces, DELETE.
			var text = label.text;
			if(/^\s*$/.test(text)){
				// that was all whitespace, KILL.
				page.target = null;
				label.kill();
			}

		};
		page.onedit = function(){
			// page.target is already set by SidebarPage.edit()
			// Don't call setValue here - it creates a circular reference
			// The component will get the value via getValue() when it's shown
		};
		page.addComponent(new ComponentButton({
			label: "delete label",
			onclick: function(label){
				label.kill();
				self.showPage("Edit");
			}
		}));
		self.addPage("Label", page);
	})();

    // Global Node!
	// (function(){
	// 	var page = new SidebarPage();
	// 	page.addComponent(new ComponentButton({
	// 		header: true,
	// 		label: "back to top",
	// 		onclick: function(){
	// 			self.showPage("Edit");
	// 		}
	// 	}));

	// 	page.addComponent(new ComponentHTML({
	// 		html: `<br><h3>Global Node Parameters</h3>`
	// 	}))

	// 	page.addComponent("radius", new ComponentSliderGlobal({
	// 		bg: "radius",
	// 		item: "Node",
	// 		label: "Border Radius:",
	// 		globalProp: 'radius',
	// 		options: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
	// 		//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
	// 		oninput: function(value){
	// 			Node.DEFAULT_RADIUS = value;
	// 		}
	// 	}));
	// 	page.addComponent("retention", new ComponentSliderGlobal({
	// 		bg: "lag",
	// 		item: "Node",
	// 		label: "Node Retention:",
	// 		globalProp: 'retention',
	// 		options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
	// 		//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
	// 		oninput: function(value){
	// 			Node.DEFAULT_RETENTION = value;
	// 		}
	// 	}));

	// 	// page.addComponent("pass", new ComponentCheckbox({
	// 	// 	label: 'Pass Node: ',
	// 	// 	id: 'pass',
	// 	// 	value: Node.DEFAULT_PASSNODE,
	// 	// 	onclick: function (value) {
	// 	// 		Node.DEFAULT_PASSNODE = value;
	// 	// 	}
	// 	// }))

	// 	// page.addComponent("pass", new ComponentSliderGlobal({
	// 	// 	bg: "lag",
	// 	// 	item: "Node",
	// 	// 	label: "Node Retention:",
	// 	// 	globalProp: 'pass',
	// 	// 	options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
	// 	// 	//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
	// 	// 	oninput: function(value){
	// 	// 		Node.DEFAULT_RETENTION = value;
	// 	// 	}
	// 	// }));


	// 	page.addComponent("randomize", new ComponentButton({
	// 		label: "Randomize Colors",
	// 		onclick: function(value){
	// 			const numOfNodes = loopy.model.nodes.length
	// 			for (let i = 0; i <= numOfNodes; i++ ) {
	// 				let color = i % 20
	// 				loopy.model.nodes[i].hue = color
	// 			}
	// 		}
	// 	}));

	// 	page.addComponent("pictureReady", new ComponentButton({
	// 		label: "Make Uniform Color",
	// 		onclick: function(value){
	// 			const numOfNodes = loopy.model.nodes.length
	// 			for (let i = 0; i <= numOfNodes; i++ ) {
	// 				let color = "red"
	// 				loopy.model.nodes[i].hue = color
	// 			}
	// 		}
	// 	}));
	// })();

	// Edit
	(function(){
		var page = new SidebarPage();
		page.addComponent(new ComponentHTML({
		html: "" +
			"<div class='sidebar-brand'>FlowCLD <span class='sidebar-version'>v1.1</span></div>" +
			"<div class='sidebar-subtitle'>A tool for thinking in systems</div>" +

			"<div class='sidebar-section'>" +
				"<div class='sidebar-section-label'>Model</div>" +
				"<div class='sidebar-btn-row'>" +
					"<span class='mini_button' onclick='loopy.savedModels.promptSave()'>Save Model</span> " +
					"<span class='mini_button' onclick='publish(\"modal\",[\"my_models\"])'>My Models</span>" +
				"</div>" +
			"</div>" +

			"<div class='sidebar-section'>" +
				"<div class='sidebar-section-label'>Import / Export</div>" +
				"<div class='sidebar-btn-row'>" +
					"<span class='mini_button' onclick='publish(\"modal\",[\"save_link\"])'>Save as Link</span>" +
				"</div>" +
				"<div class='sidebar-btn-row'>" +
					"<span class='mini_button' onclick='publish(\"export/file\")'>Save as File</span> " +
					"<span class='mini_button' onclick='publish(\"import/file\")'>Load from File</span>" +
				"</div>" +
				"<div class='sidebar-btn-row'>" +
					"<span class='mini_button' onclick='publish(\"modal\",[\"embed\"])'>Embed</span> " +
					"<span class='mini_button' onclick='publish(\"modal\",[\"save_gif\"])'>Export GIF</span>" +
				"</div>" +
			"</div>" +

			"<div class='sidebar-section'>" +
				"<div class='sidebar-section-label'>Help</div>" +
				"<div class='sidebar-btn-row'>" +
					"<span class='mini_button' onclick='publish(\"modal\",[\"examples\"])'>Examples</span> " +
					"<span class='mini_button' onclick='publish(\"modal\",[\"howto\"])'>How To</span> " +
					"<span class='mini_button' onclick='publish(\"modal\",[\"credits\"])'>Credits</span>" +
				"</div>" +
			"</div>"

		}));

		page.addComponent(new ComponentButton({
			label: "Global Edge Parameters",
			onclick: function(){
				self.showPage("GlobalParameters");
			}
		}));

		page.addComponent(new ComponentButton({
			label: "Global Node Parameters",
			onclick: function(){
				self.showPage("GlobalNodeParameters");
			}
		}));
	
		self.addPage("Edit", page);
	
		// Global Parameters Page
		var globalPage = new SidebarPage();

		globalPage.addComponent(new ComponentButton({
			header: true,
			label: "back to top",
			onclick: function(){
				self.showPage("Edit");
			}
		}));

		globalPage.addComponent(new ComponentHTML({
			html: `<br><h3>Global Edge Parameters</h3>`
		}))
		

		globalPage.addComponent("damper", new ComponentSliderGlobal({
			bg: "lag",
			item: "Edge",
			label: "Global Decay:",
			options: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0],
			globalProp: "damper",  // The property to apply globally
			oninput: function(value) {
				Edge.damper = value;
			}
		}));

		globalPage.addComponent("confidence", new ComponentSliderGlobal({
			bg: "lag",
			item: "Edge",
			label: "Global Confidence:",
			options: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0],
			globalProp: "confidence",  // The property to apply globally
			oninput: function(value) {
				Edge.defaultStrengthMultiplier = value; // Update the default for new edges
			}
		}));

		globalPage.addComponent("lag", new ComponentSliderGlobal({
			bg: "lag",
			item: "Edge",
			label: "Global Propagation Delay:",
			options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			globalProp: "lag",  // The property to apply globally
			oninput: function(value) {
				Edge.defaultLag = value;
			}
		}));
	
		self.addPage("GlobalParameters", globalPage);

		// Global Parameters Page
		var globalNodePage = new SidebarPage();

		globalNodePage.addComponent(new ComponentButton({
			header: true,
			label: "back to top",
			onclick: function(){
				self.showPage("Edit");
			}
		}));

		globalNodePage.addComponent(new ComponentHTML({
			html: `<br><h3>Global Node Parameters</h3>`
		}))

		globalNodePage.addComponent("radius", new ComponentSliderGlobal({
			bg: "radius",
			item: "Node",
			label: "Border Radius:",
			globalProp: 'radius',
			options: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
			//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
			oninput: function(value){
				Node.DEFAULT_RADIUS = value;
			}
		}));
		globalNodePage.addComponent("retention", new ComponentSliderGlobal({
			bg: "lag",
			item: "Node",
			label: "Node Retention:",
			globalProp: 'retention',
			options: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
			//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
			oninput: function(value){
				Node.DEFAULT_RETENTION = value;
			}
		}));
		// page.addComponent("pass", new ComponentCheckbox({
		// 	label: 'Pass Node: ',
		// 	id: 'pass',
		// 	value: Node.DEFAULT_PASSNODE,
		// 	onclick: function (value) {
		// 		Node.DEFAULT_PASSNODE = value;
		// 	}
		// }))

		globalNodePage.addComponent("pass", new ComponentButton({
			label: "Flip Pass Node:",
			onclick: function(){
				const numOfNodes = loopy.model.nodes.length;
				if (numOfNodes === 0) return;
				let opposite = !loopy.model.nodes[0].pass;
				for (let i = 0; i < numOfNodes; i++) {
					loopy.model.nodes[i].pass = opposite;
				}
			}
		}));
		globalNodePage.addComponent("randomize", new ComponentButton({
			label: "Randomize Colors",
			onclick: function(){
				const numOfNodes = loopy.model.nodes.length;
				for (let i = 0; i < numOfNodes; i++) {
					loopy.model.nodes[i].hue = i % 20;
				}
			}
		}));

		globalNodePage.addComponent("pictureReady", new ComponentButton({
			label: "Make Uniform Color",
			onclick: function(){
				const numOfNodes = loopy.model.nodes.length;
				for (let i = 0; i < numOfNodes; i++) {
					loopy.model.nodes[i].hue = 0;
				}
			}
		}));
	
		self.addPage("GlobalNodeParameters", globalNodePage);

	})();
	
	
	

	// Ctrl-S to SAVE
	subscribe("key/save",function(){
		if(Key.control){ // Ctrl-S or ⌘-S
			publish("modal",["save_link"]);
		}
	});
}

function SidebarPage(){

	// TODO: be able to focus on next component with an "Enter".

	var self = this;
	self.target = null;

	// DOM
	self.dom = document.createElement("div");
	self.show = function(){ self.dom.style.display="block"; self.onshow(); };
	self.hide = function(){ self.dom.style.display="none"; self.onhide(); };

	// Components
	self.components = [];
	self.componentsByID = {};
	self.addComponent = function(propName, component){

		// One or two args
		if(!component){
			component = propName;
			propName = "";
		}

		component.page = self; // tie to self
		component.propName = propName; // tie to propName
		self.dom.appendChild(component.dom); // add to DOM

		// remember component
		self.components.push(component);
		self.componentsByID[propName] = component;

		// return!
		return component;

	};
	self.getComponent = function(propName){
		return self.componentsByID[propName];
	};

	// Edit
	self.edit = function(object){

		// New target to edit!
		self.target = object;

		// Show each property with its component
		for(var i=0;i<self.components.length;i++){
			self.components[i].show();
		}

		// Callback!
		self.onedit();

	};

	// TO IMPLEMENT: callbacks
	self.onedit = function(){};
	self.onshow = function(){};
	self.onhide = function(){};

	// Start hiding!
	self.hide();

}



/////////////////////////////////////////////////////////////////////////////////////////////
// COMPONENTS ///////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////

function Component(){
	var self = this;
	self.dom = null;
	self.page = null;
	self.propName = null;
	self.show = function(){
		// TO IMPLEMENT
	};
	self.getValue = function(){
		if (!self.page.target) {
			return "";
		}
		if (!self.propName) {
			return "";
		}
		return self.page.target[self.propName];
	};
	self.setValue = function(value){
		// Model's been changed!
		publish("model/changed");

		// Edit the value!
		self.page.target[self.propName] = value;
		self.page.onedit(); // callback!
		
	};
}

function ComponentGlobal(){
	var self = this;
	self.dom = null;
	self.page = null;
	self.propName = null;
	self.show = function(){
		// TO IMPLEMENT
	};
	self.getValue = function(){
		// console.log(self)
		return self.page.target[self.propName];
	};

	self.setValue = function(value){
		
		// Model's been changed!
		publish("model/changed");

		// console.log(self)
		// Edit the value!
		self.page.target[self.propName] = value;
		self.page.onedit(); // callback!
		
	};
}

function ComponentGlobalNode(){
	var self = this;
	self.dom = null;
	self.page = null;
	self.propName = null;
	self.show = function(){
		// TO IMPLEMENT
	};
	self.getValue = function(){
		return self.globalNodePage.target[self.propName];
	};
	self.setValue = function(value){
		
		// Model's been changed!
		publish("model/changed");
		// console.log(self)
		// Edit the value!
		self.globalNodePage.target[self.propName] = value;
		self.page.onedit(); // callback!
		
	};
}


function ComponentInput(config) {
    // Inherit
    var self = this;
    Component.apply(self);

    // DOM: label + text input
    self.dom = document.createElement("div");
    var label = _createLabel(config.label);
    var className = config.textarea ? "component_textarea" : "component_input";
	var id = config.id;
    var input = _createInput(className, id, config.textarea);


    input.oninput = function(event) {
        var value = input.value;
		if (value.toLowerCase() == "infinity") {
			value = Infinity
		} else if (value.toLowerCase() == "-infinity") {
			value = -Infinity
		}
        var isFinite = Number.isFinite(Number(value));
		var isInfinityOrNegativeInifity = (value == Infinity || value == -Infinity);

        if ((self.propName == "floor" || self.propName == "ceiling" || self.propName == "flow") && value != "") {
            if (isFinite || isInfinityOrNegativeInifity) {
                self.setValue(Number(value));
                input.style.borderColor = "green"; // Reset border color if valid
            } else {
                // Display error or feedback
                input.style.borderColor = "red"; // Highlight input field if invalid
            }
        } else {
            self.setValue(value);
        }
    };

    self.dom.appendChild(label);
    self.dom.appendChild(input);

    // Show
    self.show = function() {
        input.value = self.getValue();
        // Reset border color on show
        input.style.borderColor = "";
    };

    // Select
    self.select = function() {
        setTimeout(function() { input.select(); }, 10);
    };
}

function ComponentSlider(config){

    // Inherit properties and methods from Component
    var self = this;
    Component.apply(self);

    // TODO: control with + / -, alt keys?? (potential future feature for keyboard control)

    // Create DOM: label and slider container
    self.dom = document.createElement("div");
    var labelContainer = document.createElement("div");  // Container to hold label and value side by side
    labelContainer.style.display = "flex";  // Use flex to align label and value in a row
    labelContainer.style.gap = "10px";  // Add some spacing between label and value

    var label = _createLabel(config.label);  // Create a label for the slider component
    labelContainer.appendChild(label);

    // The Color slider shows a color NAME (categorical) — keep it a read-only label.
    // All other sliders are numeric, so expose an editable number input alongside the
    // slider so users can TYPE an exact/arbitrary value instead of only the discrete steps.
    var isColor = (config.label === "Color:");
    var sortedOptions = config.options.slice().sort(function(a, b){ return a - b; });
    var optMin = sortedOptions[0];
    var optMax = sortedOptions[sortedOptions.length - 1];

    var value;  // the value-display element (label for color, <input> for numeric)
    if(isColor){
        value = _createLabel(getColor(config.options[0]));
    } else {
        value = document.createElement("input");
        value.type = "number";
        value.className = "component_slider_value_input";
        value.min = optMin;
        value.max = optMax;
        value.step = "any";              // allow arbitrary values, not just 0.1 steps
        value.value = config.options[0];
        value.style.width = "56px";
        // Don't let typing in the box start a slider drag.
        value.addEventListener("mousedown", function(e){ e.stopPropagation(); });
        value.addEventListener("change", function(){
            var v = parseFloat(value.value);
            if(isNaN(v)){ value.value = self.getValue(); return; }  // revert garbage
            if(v < optMin) v = optMin;
            if(v > optMax) v = optMax;                              // clamp to slider range
            value.value = v;
            self.setValue(v);
            if(config.oninput) config.oninput(v);
            movePointer();
        });
    }
    labelContainer.appendChild(value);

    self.dom.appendChild(labelContainer);

    // Reflect the current value in the display (handles off-grid typed values too).
    var updateDisplay = function(){
        var v = self.getValue();
        if(isColor) value.innerHTML = getColor(v);
        else value.value = v;
    };

    // Create the slider container DOM
    var sliderDOM = document.createElement("div");
    sliderDOM.setAttribute("class","component_slider");  // Add class for styling
    self.dom.appendChild(sliderDOM);

    // Slider DOM: add graphic and pointer elements
    var slider = new Image();
    slider.draggable = false;  // Prevent dragging of the slider image
    slider.src = "css/sliders/" + config.bg + ".png";  // Set the background image for the slider
    slider.setAttribute("class","component_slider_graphic");
    var pointer = new Image();
    pointer.draggable = false;  // Prevent dragging of the pointer image
    pointer.src = "css/sliders/slider_pointer.png";  // Set the pointer image
    pointer.setAttribute("class","component_slider_pointer");
    sliderDOM.appendChild(slider);
    sliderDOM.appendChild(pointer);

    // Function to move the pointer to the correct position based on the current value
    var movePointer = function(){
        var current = self.getValue();  // Get the current value of the slider
        var optionIndex = config.options.indexOf(current);  // Find the index of the current value
        if(optionIndex === -1){
            // Typed value isn't one of the discrete options — snap pointer to nearest.
            var bestD = Infinity;
            for(var i = 0; i < config.options.length; i++){
                var d = Math.abs(config.options[i] - current);
                if(d < bestD){ bestD = d; optionIndex = i; }
            }
        }
        var x = (optionIndex + 0.5) * (250 / config.options.length);  // Calculate the position of the pointer
        pointer.style.left = (x - 7.5) + "px";  // Adjust pointer position (7.5px is half of the pointer width)
    };

    // Event handlers for slider interaction
    var isDragging = false;  // Track whether the user is dragging the pointer
    var onmousedown = function(event){
        isDragging = true;  // Set dragging to true on mouse down
        sliderInput(event);  // Update the slider value
    };
    var onmouseup = function(){
        isDragging = false;  // Stop dragging on mouse up
    };
    var onmousemove = function(event){
        if(isDragging) sliderInput(event);  // If dragging, update the slider value on mouse move
    };

    // Function to handle slider input (mouse events)
    var sliderInput = function(event){
        // Calculate the option index based on mouse position
        var index = event.x / 250;
        var optionIndex = Math.floor(index * config.options.length);
        var option = config.options[optionIndex];
        if(option === undefined) return;  // Exit if the calculated option is invalid
        self.setValue(option);  // Set the slider value to the calculated option

        // Trigger the oninput callback if provided
        if(config.oninput){
            config.oninput(option);
            updateDisplay(); // Update the value display to show the current option
        }

        // Move the pointer to the new position
        movePointer();
    };

    // Add mouse events to the slider for interaction
    _addMouseEvents(slider, onmousedown, onmousemove, onmouseup);

	function getColor(value) {
		const colorMap = {
			0: 'Crimson',
			1: 'Red',
			2: 'Red-Orange',
			3: 'Orange',
			4: 'Light Orange',
			5: 'Light Yellow-Orange',
			6: 'Yellow-Orange',
			7: 'Yellow',
			8: 'Light Green',
			9: 'Green',
			10: 'Dark Green',
			11: 'Teal',
			12: 'Blue',
			13: 'Brigh Blue',
			14: 'Indigo',
			15: 'Dark Indigo',
			16: 'Dark Violet',
			17: 'Violet',
			18: 'Light Violet',
			19: 'Magenta'
		};
		return colorMap[value] || value;
	}

    // Show function to initialize the slider position and value label
    self.show = function(){
        movePointer();  // Move the pointer to the correct position
        updateDisplay(); // Update the value display to show the current value
    };

    // Function to set the background color of the slider
    self.setBGColor = function(color){
        slider.style.background = color;  // Update the background color of the slider graphic
    };

}

function ComponentSliderGlobal(config) {
    var self = this;
    ComponentGlobal.apply(self);

    // Create DOM: label and slider container
    self.dom = document.createElement("div");
    var labelContainer = document.createElement("div");  
    labelContainer.style.display = "flex";
    labelContainer.style.gap = "10px";  

    var label = _createLabel(config.label);
    labelContainer.appendChild(label);

	self.getValue = function() {
        // Decide what global property to return based on config.item and config.globalProp
        if (config.item === "Edge") {
            if (config.globalProp === "damper") return Edge.damper;
            if (config.globalProp === "confidence") return Edge.defaultStrengthMultiplier;
            if (config.globalProp === "lag") return Edge.defaultLag;
        } else if (config.item === "Node") {
            if (config.globalProp === "radius") return Node.DEFAULT_RADIUS;
            if (config.globalProp === "retention") return Node.DEFAULT_RETENTION;
        }
        return config.options[0]; // fallback if none match
    };
	self.setValue = function(value) {
        publish("model/changed");
        if (config.item === "Edge") {
            loopy.model.edges.forEach(edge => {
                edge[config.globalProp] = value;
            });
            // Also update any global defaults if needed
            if (config.globalProp === "damper") Edge.damper = value;
            if (config.globalProp === "confidence") Edge.defaultStrengthMultiplier = value;
            if (config.globalProp === "lag") Edge.defaultLag = value;
        } else if (config.item === "Node") {
            loopy.model.nodes.forEach(node => {
                node[config.globalProp] = value;
            });
            if (config.globalProp === "radius") Node.DEFAULT_RADIUS = value;
            if (config.globalProp === "retention") Node.DEFAULT_RETENTION = value;
        }
		self.page.onedit();
    };

    // Global sliders are always numeric — expose an editable number input so users
    // can type an exact/arbitrary value instead of only the discrete steps.
    var sortedOptions = config.options.slice().sort(function(a, b){ return a - b; });
    var optMin = sortedOptions[0];
    var optMax = sortedOptions[sortedOptions.length - 1];

    var valueLabel = document.createElement("input");
    valueLabel.type = "number";
    valueLabel.className = "component_slider_value_input";
    valueLabel.min = optMin;
    valueLabel.max = optMax;
    valueLabel.step = "any";
    valueLabel.value = config.options[0];
    valueLabel.style.width = "56px";
    valueLabel.addEventListener("mousedown", function(e){ e.stopPropagation(); });
    valueLabel.addEventListener("change", function(){
        var v = parseFloat(valueLabel.value);
        if(isNaN(v)){ valueLabel.value = self.getValue(); return; }
        if(v < optMin) v = optMin;
        if(v > optMax) v = optMax;
        valueLabel.value = v;
        self.setValue(v);
        if(config.oninput) config.oninput(v);
        movePointer();
    });
    labelContainer.appendChild(valueLabel);

    self.dom.appendChild(labelContainer);

    var updateDisplay = function(){ valueLabel.value = self.getValue(); };

    // Create the slider container DOM
    var sliderDOM = document.createElement("div");
    sliderDOM.setAttribute("class", "component_slider");
    self.dom.appendChild(sliderDOM);

    // Slider DOM: add graphic and pointer elements
    var slider = new Image();
    slider.draggable = false;  
    slider.src = "css/sliders/" + config.bg + ".png";  
    slider.setAttribute("class", "component_slider_graphic");
    var pointer = new Image();
    pointer.draggable = false;  
    pointer.src = "css/sliders/slider_pointer.png";  
    pointer.setAttribute("class", "component_slider_pointer");
    sliderDOM.appendChild(slider);
    sliderDOM.appendChild(pointer);

    // Function to move the pointer to the correct position based on the current value
    var movePointer = function () {
        var current = self.getValue();
        var optionIndex = config.options.indexOf(current);
        if(optionIndex === -1){
            // Typed value isn't a discrete option — snap pointer to nearest.
            var bestD = Infinity;
            for(var i = 0; i < config.options.length; i++){
                var d = Math.abs(config.options[i] - current);
                if(d < bestD){ bestD = d; optionIndex = i; }
            }
        }
        var x = (optionIndex + 0.5) * (250 / config.options.length);
        pointer.style.left = (x - 7.5) + "px";
    };

    // Event handlers for slider interaction
    var isDragging = false;  
    var onmousedown = function (event) {
        isDragging = true;  
        sliderInput(event);  
    };
    var onmouseup = function () {
        isDragging = false;  
    };
    var onmousemove = function (event) {
        if (isDragging) sliderInput(event);  
    };

    // Function to handle slider input (mouse events)
    var sliderInput = function (event) {
        var index = event.x / 250;
        var optionIndex = Math.floor(index * config.options.length);
        var option = config.options[optionIndex];
        if (option === undefined) return;  

        self.setValue(option);  

        if (config.oninput) {
            config.oninput(option);
            updateDisplay();
        }

        movePointer();
    };

    _addMouseEvents(slider, onmousedown, onmousemove, onmouseup);

    function getColor(value) {
        const colorMap = {
            0: 'Crimson',
            1: 'Red',
            2: 'Red-Orange',
            3: 'Orange',
            4: 'Light Orange',
            5: 'Light Yellow-Orange',
            6: 'Yellow-Orange',
            7: 'Yellow',
            8: 'Light Green',
            9: 'Green',
            10: 'Dark Green',
            11: 'Teal',
            12: 'Blue',
            13: 'Bright Blue',
            14: 'Indigo',
            15: 'Dark Indigo',
            16: 'Dark Violet',
            17: 'Violet',
            18: 'Light Violet',
            19: 'Magenta'
        };
        return colorMap[value] || value;
    }

    // Show function to initialize the slider position and value label
    self.show = function () {
        movePointer();
        updateDisplay();
    };

    // New setValue function that applies to all edges
	if (config.item == "Edge"){
		self.setValue = function (value) {
			loopy.model.edges.forEach(edge => {
				edge[config.globalProp] = value;  
			});
			publish("model/changed");  
		};
	
	} else if (config.item == "Node"){
		self.setValue = function (value) {
			loopy.model.nodes.forEach(node => {
				node[config.globalProp] = value;  
			});
			publish("model/changed");  
		};
	}



    // Function to set the background color of the slider
    self.setBGColor = function (color) {
        slider.style.background = color;  
    };
}

function ComponentCheckbox(config) {
    // Inherit from Component
    var self = this;
    Component.apply(self);

    // Create DOM: label + checkbox input
    self.dom = document.createElement("div");
    var label = _createLabel(config.label);
    var id = config.id;
    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "component_checkbox";
	
    // Set initial value based on saved state or default config value
    checkbox.checked = config.value;

    // Handle checkbox state change
    checkbox.onchange = function() {
        config.value = checkbox.checked; // Set config value to match checkbox state
        self.setValue(config.value);     // Update the value accordingly
        // console.log(config.value);       // Log the current value


        // Trigger the onclick handler if defined
        if (typeof config.onclick === "function") {
            config.onclick(config.value); // Pass the updated value to the onclick function
        }
    };

    // Append elements to the component's DOM
    self.dom.appendChild(label);
    self.dom.appendChild(checkbox);

    // Show: Sync checkbox state with the component's value
    self.show = function() {
        checkbox.checked = self.getValue();
    };
}

// Dropdown select bound to a model property (e.g. edge functional form).
// config.options = [{value, text}, ...]
function ComponentSelect(config) {
    var self = this;
    Component.apply(self);

    self.dom = document.createElement("div");
    var label = _createLabel(config.label);
    self.dom.appendChild(label);

    var select = document.createElement("select");
    select.className = "component_select";
    config.options.forEach(function(opt){
        var o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.text;
        select.appendChild(o);
    });
    select.onchange = function(){
        self.setValue(select.value);
        if(config.oninput) config.oninput(select.value);
    };
    self.dom.appendChild(select);

    self.show = function(){
        var v = self.getValue();
        select.value = (v === undefined || v === null || v === "") ? config.options[0].value : v;
    };
}

// A simple on/off toggle that sets a node's source/sink formula property to a
// sensible default constant (config.defaultFormula) when checked, and clears it
// when unchecked. Lets users mark a source/sink without writing an expression,
// while still reflecting any custom formula set via the formula editor.
function ComponentFormulaToggle(config) {
    var self = this;
    Component.apply(self);

    self.dom = document.createElement("div");
    var label = _createLabel(config.label);
    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "component_checkbox";

    checkbox.onchange = function(){
        if(!self.page.target) return;
        self.page.target[config.prop] = checkbox.checked ? config.defaultFormula : null;
        publish("model/changed");
        self.page.onedit();
    };

    self.dom.appendChild(label);
    self.dom.appendChild(checkbox);

    self.show = function(){
        checkbox.checked = !!(self.page.target && self.page.target[config.prop]);
    };
}

function ComponentButton(config){
	// Inherit
	var self = this;
	Component.apply(self);

	// DOM: just a button
	self.dom = document.createElement("div");
	var button = _createButton(config.label, function(){
		config.onclick(self.page.target);
	});
	self.dom.appendChild(button);

	// Unless it's a HEADER button!
	if(config.header){
		button.setAttribute("header","yes");
	}

}

function ComponentHTML(config){
	// Inherit
	var self = this;
	Component.apply(self);

	// just a div
	self.dom = document.createElement("div");
	self.dom.innerHTML = config.html;

}

function ComponentOutput(config){
	// Inherit
	var self = this;
	Component.apply(self);

	// DOM: just a readonly input that selects all when clicked
	self.dom = _createInput("component_output");
	self.dom.setAttribute("readonly", "true");
	self.dom.onclick = function(){
		self.dom.select();
	};

	// Output the string!
	self.output = function(string){
		self.dom.value = string;
	};

}
