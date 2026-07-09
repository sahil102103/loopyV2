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
        // Clear multi-select when switching away
        if (self.currentTool === "multiselect" && tool !== "multiselect") {
            if (loopy.multipleselect) loopy.multipleselect.clearSelection();
        }
        self.currentTool = tool;
        var name = "TOOL_" + tool.toUpperCase();
        loopy.tool = Loopy[name];
        document.getElementById("canvasses").setAttribute("cursor", tool);
    };

    // Switch from eraser to draw tool on mouseup (only when eraser is active)
    document.addEventListener("mouseup", function() {
        if (self.currentTool === "erase" && loopy.mode === Loopy.MODE_EDIT) {
            self.setTool("ink");
            buttonsByID["erase"].deselect();
            buttonsByID["ink"].select();
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

    // Divider: drawing tools vs action tools
    self.addDivider = function() {
        var divider = document.createElement("div");
        divider.setAttribute("class", "toolbar_divider");
        self.dom.appendChild(divider);
    };
    self.addDivider();

	self.addButton({
        id: "undo",
        tooltip: "(U)ndo",
        callback: function() {
            loopy.model.undo();
        }
    });
	self.addButton({
        id: "redo",
        tooltip: "(R)edo",
        callback: function() {
            loopy.model.redo();
        }
    });
	self.addButton({
        id: "multiselect",
        tooltip: "Multi-(S)elect",
        callback: function() {
            self.setTool("multiselect");
        }
    });

    // Divider: action tools vs viewport tools
    self.addDivider();

    self.addZoomButton = function(options) {
        var id = options.id;
        var tooltip = options.tooltip;
        var callback = options.callback;
        var text = options.text;

        var button = document.createElement("div");
        button.setAttribute("class", "toolbar_button zoom_button");
        button.setAttribute("data-balloon", tooltip);
        button.setAttribute("data-balloon-pos", "right");
        button.textContent = text;
        
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
        text: "\u2212",
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
    self.addZoomButton({
        id: "pan",
        tooltip: "(P)an Canvas",
        text: "\u270B",
        callback: function() {
            self.setTool("pan");
        }
    });

    // ── Auto-layout: reorganize nodes so relationships are easier to read ──
    self.addDivider();

    var layoutWrap = document.createElement("div");
    layoutWrap.className = "toolbar_layout_wrap";
    layoutWrap.style.position = "relative";

    var layoutBtn = document.createElement("div");
    layoutBtn.className = "toolbar_button zoom_button";
    layoutBtn.setAttribute("data-balloon", "Auto-layout graph (L) — arrange nodes so links are easier to follow");
    layoutBtn.setAttribute("data-balloon-pos", "right");
    layoutBtn.textContent = "\u25A6"; // ▦ grid-ish icon
    layoutBtn.style.fontSize = "14px";
    layoutBtn.title = "Auto-layout";

    var layoutMenu = document.createElement("div");
    layoutMenu.className = "toolbar_layout_menu";
    layoutMenu.style.display = "none";

    function _runLayout(mode) {
        layoutMenu.style.display = "none";
        if (!loopy.model || !loopy.model.nodes.length) {
            if (typeof window.showToast === "function") {
                window.showToast("Add some nodes first", "error", true);
            }
            return;
        }
        if (typeof GraphLayout === "undefined" || !GraphLayout.apply) {
            console.error("GraphLayout not loaded");
            return;
        }
        try {
            var result = GraphLayout.apply(loopy.model, { mode: mode, fitView: true, normalizeArcs: true });
            if (typeof window.showToast === "function") {
                var label = mode === "force" ? "Force layout" : (mode === "circle" ? "Circle layout" : "Grid layout");
                window.showToast(label + " · " + result.nodeCount + " nodes (Undo to revert)", "success", true);
            }
        } catch (err) {
            console.error(err);
            if (typeof window.showToast === "function") {
                window.showToast("Layout failed: " + err.message, "error", true);
            }
        }
    }

    [
        { mode: "force",  label: "Force (recommended)", hint: "Cluster related nodes" },
        { mode: "circle", label: "Circle",              hint: "Even ring overview" },
        { mode: "grid",   label: "Grid",                hint: "Compact rows" },
    ].forEach(function (item) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "toolbar_layout_item";
        row.innerHTML = "<strong>" + item.label + "</strong><span>" + item.hint + "</span>";
        row.addEventListener("click", function (e) {
            e.stopPropagation();
            _runLayout(item.mode);
        });
        layoutMenu.appendChild(row);
    });

    layoutBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        // Plain click → force layout (most useful). Shift/Alt → open menu.
        if (e.shiftKey || e.altKey) {
            layoutMenu.style.display = layoutMenu.style.display === "none" ? "block" : "none";
        } else {
            _runLayout("force");
        }
    });
    // Right-click / long affordance: always show menu
    layoutBtn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        layoutMenu.style.display = layoutMenu.style.display === "none" ? "block" : "none";
    });
    // Small chevron strip to open menu without shift
    var menuToggle = document.createElement("div");
    menuToggle.className = "toolbar_layout_caret";
    menuToggle.textContent = "\u25BE";
    menuToggle.title = "More layout options";
    menuToggle.addEventListener("click", function (e) {
        e.stopPropagation();
        layoutMenu.style.display = layoutMenu.style.display === "none" ? "block" : "none";
    });

    layoutWrap.appendChild(layoutBtn);
    layoutWrap.appendChild(menuToggle);
    layoutWrap.appendChild(layoutMenu);
    self.dom.appendChild(layoutWrap);

    document.addEventListener("click", function () {
        layoutMenu.style.display = "none";
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
    subscribe("key/pan", function() {
        loopy.ink.reset();
        self.setTool("pan");
    });
    // L = force auto-layout
    subscribe("key/layout", function () {
        if (loopy.mode === Loopy.MODE_EDIT) _runLayout("force");
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
