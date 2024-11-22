/**********************************

SIDEBAR CODE

**********************************/
document.getElementById('sidebar-toggle').addEventListener('click', function() {
    var sidebar = document.getElementById('sidebar');
    if (sidebar.style.right === '0px') {
        sidebar.style.right = '-300px'; // Hide sidebar
    } else {
        sidebar.style.right = '0px'; // Show sidebar
    }
});


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
	// SHOW AND HIDE ///////////////////////////////////////////////////////////////////////////
	////////////////////////////////////////////////////////////////////////////////////////////

	// Add a toggle button within the sidebar
	// var toggleButton = document.createElement("button");
	// toggleButton.innerHTML = "|||";
	// toggleButton.className = "sidebar-toggle-button";
	// self.dom.appendChild(toggleButton);

	// // Method to show the sidebar
	// self.showSidebar = function() {
	// 	self.dom.style.display = "block";
	// };

	// // Method to hide the sidebar
	// self.hideSidebar = function() {
	// 	self.dom.style.display = "none";
	// };

	// // Method to toggle the sidebar's visibility
	// self.toggleSidebar = function() {
	// 	if (self.dom.style.display === "none") {
	// 		self.showSidebar();
	// 	} else {
	// 		self.hideSidebar();
	// 	}
	// };

	// // Event listener for the toggle button
	// toggleButton.addEventListener("click", function() {
	// 	self.toggleSidebar();
	// });

	// // Ensure the sidebar is visible by default
	// self.showSidebar();

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
		page.addComponent("radius", new ComponentSlider({
			bg: "initial",
			label: "Border Radius:",
			options: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
			//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
			oninput: function(value){
				Node.DEFAULT_RADIUS = value;
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
			label: "Weight:",
			options:[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
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
			options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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
		// Add the Set Global Parameters Button in the Edit page
		var page = new SidebarPage();
		page.addComponent(new ComponentHTML({
		html: "" +
			"<b style='font-size:1.4em'>FlowCLD (V1.1)</b><br>A tool for thinking in systems<br><br>" +

			"<span class='mini_button' onclick='publish(\"modal\",[\"examples\"])'>see examples</span> " +
			"<span class='mini_button' onclick='publish(\"modal\",[\"howto\"])'>how to</span> " +
			"<span class='mini_button' onclick='publish(\"modal\",[\"credits\"])'>credits</span><br><br>" +

			"<hr/><br>" +

			"<span class='mini_button' onclick='publish(\"modal\",[\"save_link\"])'>save as link</span> <br><br>" +
			"<span class='mini_button' onclick='publish(\"export/file\")'>save as file</span> " +
			"<span class='mini_button' onclick='publish(\"import/file\")'>load from file</span> <br><br>" +
			"<span class='mini_button' onclick='publish(\"modal\",[\"embed\"])'>embed in your website</span> <br><br>" +
			"<span class='mini_button' onclick='publish(\"modal\",[\"save_gif\"])'>make a GIF using LICEcap</span> <br><br>" +

			"<hr/><br>" +

			"<div id='loadPythonPackages'>" +
				"<b>To access ALL TABS<br>" +
				"<b style='font-size: .8em'>Will take a minute or two to load<br>" +
				"<b style='font-size: .8em'>PS: Make sure all names are different<br><br>" +
				"<div id='loadingIndicator' style='display: none;'> <div class='spinner'></div> </div>" +
				"<span class='mini_button' onclick='loadAndExecutePythonScript()'>Load In Python Packages</span><br><br>" +
			"<hr/><br>" +

			"</div>"
		}));
	
		// Add the Set Global Parameters button correctly using ComponentButton
		page.addComponent(new ComponentButton({
			label: "Set Edge Parameters",
			onclick: function(){
				self.showPage("GlobalParameters");
			}
		}));

		page.addComponent(new ComponentButton({
			label: "Set Node Parameters",
			onclick: function(){
				self.showPage("GlobalNodeParameters");
			}
		}));
	
		self.addPage("Edit", page);
	
		// Global Parameters Page
		var globalPage = new SidebarPage();
		

		globalPage.addComponent("damper", new ComponentSliderGlobal({
			bg: "lag",
			item: "Edge",
			label: "Global Weight:",
			options: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
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
			options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			globalProp: "lag",  // The property to apply globally
			oninput: function(value) {
				Edge.defaultLag = value;
			}
		}));

	
		globalPage.addComponent(new ComponentButton({
			label: "Back to Edit",
			onclick: function(){
				self.showPage("Edit");
			}
		}));
	
		self.addPage("GlobalParameters", globalPage);

		// Global Parameters Page
		var globalNodePage = new SidebarPage();

		function getRandomLightColor() {
			const hue = Math.floor(Math.random() * 360); // Random hue between 0 and 360
			const saturation = Math.floor(Math.random() * 100) + 1; // Saturation between 1% and 100%
			const lightness = 75; // Fixed lightness at 75%
		  
			return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
		  }
		  
		  // Example usage:
		  const randomColor = getRandomLightColor();
		  document.body.style.backgroundColor = randomColor;
		  

		globalNodePage.addComponent("randomize", new ComponentButton({
			label: "Randomize Colors",
			onclick: function(value){
				const numOfNodes = loopy.model.nodes.length
				for (let i = 0; i <= numOfNodes; i++ ) {
					let color = i % 20
					loopy.model.nodes[i].hue = color
				}
			}
		}));

		globalNodePage.addComponent("pictureReady", new ComponentButton({
			label: "Make Uniform Color",
			onclick: function(value){
				const numOfNodes = loopy.model.nodes.length
				for (let i = 0; i <= numOfNodes; i++ ) {
					let color = 8
					loopy.model.nodes[i].hue = color
				}
			}
		}));

		// globalNodePage.addComponent("System Loss", new ComponentSliderGlobal({
		// 	bg: "lag",
		// 	item: "Node",
		// 	label: "System Loss",
		// 	options: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
		// 	globalProp: 'systemLoss',
		// 	oninput: function(value){
		// 		Node.defaultHue = value;
		// 	}
		// }));

		// page.addComponent("radius", new ComponentSlider({
		// 	bg: "initial",
		// 	label: "Border Radius:",
		// 	options: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
		// 	//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
		// 	oninput: function(value){
		// 		Node.DEFAULT_RADIUS = value;
		// 	}
		// }));
		globalNodePage.addComponent("radius", new ComponentSliderGlobal({
			bg: "initial",
			item: "Node",
			label: "Border Radius:",
			globalProp: 'radius',
			options: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
			//options: [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1],
			oninput: function(value){
				Node.DEFAULT_RADIUS = value;
			}
		}));



	
		globalNodePage.addComponent(new ComponentButton({
			label: "Back to Edit",
			onclick: function(){
				self.showPage("Edit");
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

function ComponentSliderGlobal(config) {
    var self = this;
    Component.apply(self);

    // Create DOM: label and slider container
    self.dom = document.createElement("div");
    var labelContainer = document.createElement("div");  
    labelContainer.style.display = "flex";
    labelContainer.style.gap = "10px";  

    var label = _createLabel(config.label);
    labelContainer.appendChild(label);

    // Create value label to display the current value (default to the first option on load)
    var valueLabel = _createLabel(config.label === "Color:" ? getColor(config.options[0]) : config.options[0]);
    labelContainer.appendChild(valueLabel);

    self.dom.appendChild(labelContainer);

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
        var value = self.getValue();  
        var optionIndex = config.options.indexOf(value);
		console.log(optionIndex)
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
            valueLabel.innerHTML = config.label === "Color:" ? getColor(option) : option; 
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
        valueLabel.innerHTML = config.label === "Color:" ? getColor(self.getValue()) : self.getValue();
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