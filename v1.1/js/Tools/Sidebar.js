/**********************************

SIDEBAR CODE

**********************************/

function Sidebar(loopy){

	var self = this;
	PageUI.call(self, document.getElementById("sidebar"));

	// Edit
	self.edit = function(object){
		self.showPage(object._CLASS_);
		self.currentPage.edit(object);
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
		page.addComponent("label", new ComponentInput({
			label: "<br><br>Name:",
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
		page.onedit = function(){

			// Set color of Slider
			var node = page.target;
			var color = Node.COLORS[node.hue];
			page.getComponent("init").setBGColor(color);

			// Focus on the name field IF IT'S "" or "?"
			var name = node.label;
			if(name=="" || name=="?") page.getComponent("label").select();

		};

		page.addComponent("flow", new ComponentInput({
			label: "Additional Amount:",
			id: 'flow'
		}));

		page.addComponent("floor", new ComponentInput({
			label: "Floor:",
			id: 'floor'
		}));

		page.addComponent("ceiling", new ComponentInput({
			label: "Ceiling:",
			id: 'ceiling'
		}));

		page.addComponent(new ComponentButton({
			label: "delete node",
			onclick: function(node){
				node.kill();
				self.showPage("Edit");
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
		page.addComponent("strength", new ComponentSlider({
			bg: "strength",
			label: "<br><br>Correlation:",
			options: [1.00, 0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 
				0.92, 0.91, 0.90, 0.89, 0.88, 0.87, 0.86, 0.85, 0.84, 
				0.83, 0.82, 0.81, 0.80, 0.79, 0.78, 0.77, 0.76, 0.75, 
				0.74, 0.73, 0.72, 0.71, 0.70, 0.69, 0.68, 0.67, 0.66, 
				0.65, 0.64, 0.63, 0.62, 0.61, 0.60, 0.59, 0.58, 0.57, 
				0.56, 0.55, 0.54, 0.53, 0.52, 0.51, 0.50, 0.49, 0.48, 
				0.47, 0.46, 0.45, 0.44, 0.43, 0.42, 0.41, 0.40, 0.39, 
				0.38, 0.37, 0.36, 0.35, 0.34, 0.33, 0.32, 0.31, 0.30, 
				0.29, 0.28, 0.27, 0.26, 0.25, 0.24, 0.23, 0.22, 0.21, 
				0.20, 0.19, 0.18, 0.17, 0.16, 0.15, 0.14, 0.13, 0.12, 
				0.11, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 
				0.02, 0.01, -0.01, -0.02, -0.03, -0.04, -0.05, -0.06, 
				-0.07, -0.08, -0.09, -0.10, -0.11, -0.12, -0.13, -0.14, 
				-0.15, -0.16, -0.17, -0.18, -0.19, -0.20, -0.21, -0.22, 
				-0.23, -0.24, -0.25, -0.26, -0.27, -0.28, -0.29, -0.30, 
				-0.31, -0.32, -0.33, -0.34, -0.35, -0.36, -0.37, -0.38, 
				-0.39, -0.40, -0.41, -0.42, -0.43, -0.44, -0.45, -0.46, 
				-0.47, -0.48, -0.49, -0.50, -0.51, -0.52, -0.53, -0.54,
				-0.55, -0.56, -0.57, -0.58, -0.59, -0.60, -0.61, -0.62, 
				-0.63, -0.64, -0.65, -0.66, -0.67, -0.68, -0.69, -0.70, 
				-0.71, -0.72, -0.73, -0.74, -0.75, -0.76, -0.77, -0.78, 
				-0.79, -0.80, -0.81, -0.82, -0.83, -0.84, -0.85, -0.86, 
				-0.87, -0.88, -0.89, -0.90, -0.91, -0.92, -0.93, -0.94, 
				-0.95, -0.96, -0.97, -0.98, -0.99, -1.00],
			oninput: function(value){
				Edge.defaultStrength = value;
			}
		}));
		// page.addComponent("strengthMultiplier", new ComponentSlider({
		// 	bg: "lag",
		// 	label: "Strength:",
		// 	options:[1, 1.5, 2, 2.5, 3],
		// 	oninput: function(value){
		// 		Edge.defaultStrengthMultiplier = value;
		// 	}
		// }));

		page.addComponent("confidence", new ComponentSlider({
			bg: "lag",
			label: "Confidence:",
			options:[0.5, 0.4, 0.3, 0.2, 0.1, 0],
			oninput: function(value){
				Edge.defaultStrengthMultiplier = value;
			}
		}));


		page.addComponent("lag", new ComponentSlider({
			bg: "lag",
			label: "Lag:",
			options: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, .6, .7, .8, .9, 1],
			oninput: function (value) {
				Edge.defaultLag = value
			}

		}));
		page.addComponent(new ComponentHTML({
			html: "(to make a stronger relationship, draw multiple arrows!)"
		}));
		page.addComponent(new ComponentButton({
			label: "delete arrow",
			onclick: function(edge){
				edge.kill();
				self.showPage("Edit");
			}
		}));
		self.addPage("Edge", page);
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
		page.addComponent(new ComponentButton({
			label: "delete label",
			onclick: function(label){
				label.kill();
				self.showPage("Edit");
			}
		}));
		self.addPage("Label", page);
	})();

	// Edit
	(function(){
		var page = new SidebarPage();
		page.addComponent(new ComponentHTML({
			html: ""+
			
			"<b style='font-size:1.4em'>LOOPY</b> (v2.0)<br>A tool for thinking in systems<br><br>"+

			"<span class='mini_button' onclick='publish(\"modal\",[\"examples\"])'>see examples</span> "+
			"<span class='mini_button' onclick='publish(\"modal\",[\"howto\"])'>how to</span> "+
			"<span class='mini_button' onclick='publish(\"modal\",[\"credits\"])'>credits</span><br><br>"+

			"<hr/><br>"+

			"<span class='mini_button' onclick='publish(\"modal\",[\"save_link\"])'>save as link</span> <br><br>"+
			"<span class='mini_button' onclick='publish(\"export/file\")'>save as file</span> "+
			"<span class='mini_button' onclick='publish(\"import/file\")'>load from file</span> <br><br>"+
			"<span class='mini_button' onclick='publish(\"modal\",[\"embed\"])'>embed in your website</span> <br><br>"+
			"<span class='mini_button' onclick='publish(\"modal\",[\"save_gif\"])'>make a GIF using LICEcap</span> <br><br>"

		}));
		self.addPage("Edit", page);
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

	// Inherit
	var self = this;
	Component.apply(self);

	// TODO: control with + / -, alt keys??

	// DOM: label + slider
	self.dom = document.createElement("div");
	var label = _createLabel(config.label);
	self.dom.appendChild(label);
	var sliderDOM = document.createElement("div");
	sliderDOM.setAttribute("class","component_slider");
	self.dom.appendChild(sliderDOM);

	// Slider DOM: graphic + pointer
	var slider = new Image();
	slider.draggable = false;
	slider.src = "css/sliders/"+config.bg+".png";
	slider.setAttribute("class","component_slider_graphic");
	var pointer = new Image();
	pointer.draggable = false;
	pointer.src = "css/sliders/slider_pointer.png";
	pointer.setAttribute("class","component_slider_pointer");
	sliderDOM.appendChild(slider);
	sliderDOM.appendChild(pointer);
	var movePointer = function(){
		var value = self.getValue();
		var optionIndex = config.options.indexOf(value);
		var x = (optionIndex+0.5) * (250/config.options.length);
		pointer.style.left = (x-7.5)+"px";
	};

	// On click... (or on drag)
	var isDragging = false;
	var onmousedown = function(event){
		isDragging = true;
		sliderInput(event);
	};
	var onmouseup = function(){
		isDragging = false;
	};
	var onmousemove = function(event){
		if(isDragging) sliderInput(event);
	};
	var sliderInput = function(event){

		// What's the option?
		var index = event.x/250;
		var optionIndex = Math.floor(index*config.options.length);
		var option = config.options[optionIndex];
		if(option===undefined) return;
		self.setValue(option);

		// Callback! (if any)
		if(config.oninput){
			config.oninput(option);
		}

		// Move pointer there.
		movePointer();

	};
	_addMouseEvents(slider, onmousedown, onmousemove, onmouseup);

	// Show
	self.show = function(){
		movePointer();
	};

	// BG Color!
	self.setBGColor = function(color){
		slider.style.background = color;
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

function ComponentCheckbox(config) {

    // Inherit
    var self = this;
    Component.apply(self);

    // Create DOM elements
    self.dom = document.createElement("div");

    var checkbox = _createCheckbox(config.value, function() {
		config.onclick(self.page.target);
	})
    // checkbox.type = "checkbox";

    var label = document.createElement("label");
    label.textContent = config.label;

    // Append checkbox and label to the container
    self.dom.appendChild(checkbox);
    self.dom.appendChild(label);

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