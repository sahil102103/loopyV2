/**********************************
TOOLBAR CODE
**********************************/

function Toolbar(loopy) {
    var self = this;

    // Tools & Buttons
    var buttons = [];
    var buttonsByID = {};
    self.dom = document.getElementById("toolbar");

    self.addButton = function(options) {
        var id = options.id;
        var tooltip = options.tooltip;
        var callback = options.callback;

        // Add the button
        var button = new ToolbarButton(self, {
            id: id,
            icon: "css/icons/" + id + ".png",
            tooltip: tooltip,
            callback: callback
        });
        self.dom.appendChild(button.dom);
        buttons.push(button);
        buttonsByID[id] = button;

        // Keyboard shortcut!
        (function(id) {
            subscribe("key/" + id, function() {
                loopy.ink.reset(); // also CLEAR INK CANVAS
                buttonsByID[id].callback();
            });
        })(id);
    };

    // Select button
    self.selectButton = function(button) {
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].deselect();
        }
        button.select();
    };

    // Set Tool
    self.currentTool = "ink";
    self.setTool = function(tool) {
        self.currentTool = tool;
        var name = "TOOL_" + tool.toUpperCase();
        console.log(name)
        loopy.tool = Loopy[name];
        document.getElementById("canvasses").setAttribute("cursor", tool);
    };

    // Switch from eraser to draw tool on mouseup
    document.addEventListener("mouseup", function() {
        if (self.currentTool === "erase") {
            self.setTool("ink"); // Switch back to draw tool
            buttonsByID["erase"].deselect(); // Deselect the eraser button
            buttonsByID["ink"].select(); // Select the ink/draw button
        }
    });

    // Populate those buttons!
    self.addButton({
        id: "ink",
        tooltip: "PE(N)CIL",
        callback: function() {
            self.setTool("ink");
        }
    });
    self.addButton({
        id: "label",
        tooltip: "(T)EXT",
        callback: function() {
            self.setTool("label");
        }
    });
    self.addButton({
        id: "drag",
        tooltip: "MO(V)E",
        callback: function() {
            self.setTool("drag");
        }
    });
    self.addButton({
        id: "erase",
        tooltip: "(E)RASE",
        callback: function() {
            self.setTool("erase");
        }
    });
	self.addButton({
        id: "undo",
        tooltip: "(U)ndo",
        callback: function() {
            loopy.model.undo();
            // self.setTool("undo");
        }
    });
	self.addButton({
        id: "redo",
        tooltip: "(R)edo",
        callback: function() {
            loopy.model.redo();
            // self.setTool("redo");
        }
    });
	self.addButton({
        id: "multiselect",
        tooltip: "Multi-(S)elect",
        callback: function() {
            self.setTool("multiselect");
        }
    });

    // Zoom controls
    self.addZoomButton = function(options) {
        var id = options.id;
        var tooltip = options.tooltip;
        var callback = options.callback;
        var text = options.text;

        // Create custom zoom button
        var button = document.createElement("div");
        button.setAttribute("class", "toolbar_button zoom_button");
        button.setAttribute("data-balloon", tooltip);
        button.setAttribute("data-balloon-pos", "right");
        button.textContent = text;
        button.style.fontSize = "16px";
        button.style.fontWeight = "bold";
        button.style.display = "flex";
        button.style.alignItems = "center";
        button.style.justifyContent = "center";
        button.style.backgroundColor = "#ddd";
        button.style.border = "2px solid #ddd";
        button.style.cursor = "pointer";
        
        button.onclick = function() {
            callback();
        };
        
        self.dom.appendChild(button);
        buttons.push({dom: button, select: function(){}, deselect: function(){}});
    };

    self.addZoomButton({
        id: "zoom_in",
        tooltip: "Zoom In (+)",
        text: "+",
        callback: function() {
            loopy.model.zoomIn();
        }
    });
    self.addZoomButton({
        id: "zoom_out",
        tooltip: "Zoom Out (-)",
        text: "-",
        callback: function() {
            loopy.model.zoomOut();
        }
    });
    self.addZoomButton({
        id: "zoom_reset",
        tooltip: "Reset Zoom (0)",
        text: "0",
        callback: function() {
            loopy.model.resetZoom();
        }
    });

    // Keyboard shortcuts for zoom
    subscribe("key/zoom_in", function() {
        loopy.model.zoomIn();
    });
    subscribe("key/zoom_out", function() {
        loopy.model.zoomOut();
    });
    subscribe("key/zoom_reset", function() {
        loopy.model.resetZoom();
    });

    // Select the default button
    buttonsByID.ink.callback();
}

/**********************************
TOOLBAR BUTTON CODE
**********************************/

function ToolbarButton(toolbar, config) {
    var self = this;
    self.id = config.id;

    // Icon
    self.dom = document.createElement("div");
    self.dom.setAttribute("class", "toolbar_button");
    self.dom.style.backgroundImage = "url('" + config.icon + "')";

    // Tooltip
    self.dom.setAttribute("data-balloon", config.tooltip);
    self.dom.setAttribute("data-balloon-pos", "right");

    // Selected?
    self.select = function() {
        self.dom.setAttribute("selected", "yes");
    };
    self.deselect = function() {
        self.dom.setAttribute("selected", "no");
    };

    // On Click
    self.callback = function() {
        config.callback();
        toolbar.selectButton(self);
    };
    self.dom.onclick = self.callback;
}

document.getElementById('toolbar-toggle').addEventListener('click', function() {
    var toolbar = document.getElementById('toolbar');
    toolbar.classList.toggle('collapsed');
});
