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

		// page.addComponent("flow", new ComponentInput({
		// 	label: "Additional Amount:",
		// 	id: 'flow'
		// }));

		page.addComponent("floor", new ComponentInput({
			label: "Floor:",
			id: 'floor'
		}));

		// page.addComponent("ceiling", new ComponentInput({
		// 	label: "Ceiling:",
		// 	id: 'ceiling'
		// }));

		page.addComponent("pass", new ComponentCheckbox({
			label: 'Pass Node: ',
			id: 'pass',
			value: Node.DEFAULT_PASSNODE,
			onclick: function (value) {
				Node.DEFAULT_PASSNODE = value;
			}
		}))


		// page.addComponent(new ComponentButton({
		// 	label: "delete node",
		// 	onclick: function(node){
		// 		node.kill();
		// 		self.showPage("Edit");
		// 	}
		// }));		
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

		page.addComponent("lineBreak", new ComponentHTML({
			html: "linebreak"
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
			label: "Dampener:",
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
			options: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, .6, .7, .8, .9, 1],
			oninput: function (value) {
				Edge.defaultLag = value;
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
			
			"<b style='font-size:1.4em'>FlowSD</b><br>A tool for thinking in systems<br><br>"+

			"<span class='mini_button' onclick='publish(\"modal\",[\"examples\"])'>see examples</span> "+
			"<span class='mini_button' onclick='publish(\"modal\",[\"howto\"])'>how to</span> "+
			"<span class='mini_button' onclick='publish(\"modal\",[\"credits\"])'>credits</span><br><br>"+
			

			"<hr/><br>"+

			"<span class='mini_button' onclick='publish(\"modal\",[\"save_link\"])'>save as link</span> <br><br>"+
			"<span class='mini_button' onclick='publish(\"export/file\")'>save as file</span> "+
			"<span class='mini_button' onclick='publish(\"import/file\")'>load from file</span> <br><br>"+
			"<span class='mini_button' onclick='publish(\"modal\",[\"embed\"])'>embed in your website</span> <br><br>"+
			"<span class='mini_button' onclick='publish(\"modal\",[\"save_gif\"])'>make a GIF using LICEcap</span> <br><br>"+

			"<hr/><br>"+

			"<b>To access ALL TABS<br>" +
			"<b style='font-size: .8em'>Will take a minute or two to load<br><br>" +
			"<span class='mini_button' onclick=loadAndExecutePythonScript()>Load In Python Packages</span><br><br>"

		}));
		page.a
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

    // Create value label to display the current value (default to the first option on load)
	var value = _createLabel(`${config.label === "Color:" ? getColor(config.options[0]) : config.options[0]}`);
    labelContainer.appendChild(value);

    self.dom.appendChild(labelContainer);

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
        var value = self.getValue();  // Get the current value of the slider
        var optionIndex = config.options.indexOf(value);  // Find the index of the current value
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
			value.innerHTML = config.label === "Color:" ? getColor(self.getValue()) : self.getValue(); // Update the value label to show the current option
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
		value.innerHTML = config.label === "Color:" ? getColor(self.getValue()) : self.getValue(); // Update the value label to show the current option
    };

    // Function to set the background color of the slider
    self.setBGColor = function(color){
        slider.style.background = color;  // Update the background color of the slider graphic
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
        console.log(config.value);       // Log the current value


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