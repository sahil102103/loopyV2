/***********************

Use the same PAGE UI thing

************************/

function Modal(loopy){

	var self = this;
	self.loopy = loopy;
	PageUI.call(self, document.getElementById("modal_page"));

	// Is showing?
	self.isShowing = false;

	// show/hide
	self.show = function(){
		document.getElementById("modal_container").setAttribute("show","yes");
		self.isShowing = true;
	};
	self.hide = function(){
		document.getElementById("modal_container").setAttribute("show","no");
		if(self.currentPage.onhide) self.currentPage.onhide();
		self.isShowing = false;
	};

	// Close button
	document.getElementById("modal_bg").onclick = self.hide;
	document.getElementById("modal_close").onclick = self.hide;

	// Handle ESC key globally
	document.addEventListener('keydown', function(event) {
		if (event.key === 'Escape' && self.isShowing) {
			self.hide();
		}
	});

	// Show... what page?
	subscribe("modal", function(pageName){

		self.show();
		var page = self.showPage(pageName);

		// Do something
		if(page.onshow) page.onshow();

		// Dimensions
		var dom = document.getElementById("modal");
		dom.style.width = self.currentPage.width+"px";
		dom.style.height = self.currentPage.height+"px";

	});

	///////////////////
	// PAGES! /////////
	///////////////////

	// Examples
	(function(){
		var page = new Page();
		page.width = 670;
		page.height = 570;
		var iframe = page.addComponent(new ModalIframe({
			page: page,
			src: "pages/examples/",
			width: 640,
			height: 520
		}));
		iframe.dom.style.background = "#f7f7f7";
		self.addPage("examples", page);
	})();

	// How To
	(function(){
		var page = new Page();
		page.width = 530;
		page.height = 430;
		page.addComponent(new ModalIframe({
			page: page,
			src: "pages/howto.html",
			width: 500,
			height: 350
		}));

		var label = document.createElement("div");
		label.style.fontSize = "18px";
		label.style.marginTop = "6px";
		label.style.color = "#777";
		label.innerHTML = "need ideas for simulations? check out <span style='text-decoration:underline; cursor:pointer' onclick='publish(\"modal\",[\"examples\"])'>the examples!</span>";
		page.dom.appendChild(label);

		self.addPage("howto", page);

	})();

	// Data
	(function(){
		var page = new Page();
		page.width = 670;
		page.height = 570;
		var iframe = page.addComponent(new ModalIframe({
			page: page,
			src: "pages/data",
			width: 640,
			height: 520
		}));
		iframe.dom.style.background = "#f7f7f7";
		self.addPage("data", page);
	})();

	// Credits
	(function(){
		var page = new Page();
		page.width = 690;
		page.height = 550;
		page.addComponent(new ModalIframe({
			page: page,
			src: "pages/credits/",
			width: 660,
			height: 500
		}))
		self.addPage("credits", page);
	})();

	// Save as link
	// (function(){
	// 	var page = new Page();
	// 	page.width = 500;
	// 	page.height = 155;
	// 	page.addComponent(new ComponentHTML({
	// 		html: "copy your link:"
	// 	}));
	// 	var output = page.addComponent(new ComponentOutput({}));

	// 	var label = document.createElement("div");
	// 	label.style.textAlign = "right";
	// 	label.style.fontSize = "15px";
	// 	label.style.marginTop = "6px";
	// 	label.style.color = "#888";
	// 	label.innerHTML = "(this is a long URL, so you may want to use a link-shortener like <a target='_blank' href='https://bitly.com/'>bit.ly</a>)";
	// 	page.dom.appendChild(label);

	// 	// chars left...
	// 	var chars = document.createElement("div");
	// 	chars.style.textAlign = "right";
	// 	chars.style.fontSize = "15px";
	// 	chars.style.marginTop = "3px";
	// 	chars.style.color = "#888";
	// 	chars.innerHTML = "X out of 2048 characters";
	// 	page.dom.appendChild(chars);

	// 	page.onshow = function(){

	// 		// Copy-able link
	// 		var link = loopy.saveToURL();
	// 		output.output(link);
	// 		output.dom.select();

	// 		// Chars left
	// 		var html = link.length+" / 2048 characters";
	// 		if(link.length>2048){
	// 			html += " - MAY BE TOO LONG FOR MOST BROWSERS";
	// 		}
	// 		chars.innerHTML = html;
	// 		chars.style.fontWeight = (link.length>2048) ? "bold" : "100";
	// 		chars.style.fontSize = (link.length>2048) ? "14px" : "15px";

	// 	};

	// 	// or, tweet it
	// 	self.addPage("save_link", page);
	// })();

	// Save as Link Modal (with Firestore integration)
(function () {
    var page = new Page();
    page.width = 500;
    page.height = 200;

    // Input fields for link data
    page.addComponent(new ComponentHTML({ html: "Save a link to your account:" }));
    var urlInput = page.addComponent(new ComponentInput({ placeholder: "Enter the URL" }));
    var descInput = page.addComponent(new ComponentInput({ placeholder: "Enter a description" }));

    // Save button
    var saveButton = document.createElement("button");
    saveButton.innerHTML = "Save Link";
    saveButton.style.marginTop = "10px";
    page.dom.appendChild(saveButton);

    saveButton.onclick = async function () {
        const url = urlInput.getValue();
        const description = descInput.getValue();

        if (!url) {
            alert("Please enter a valid URL.");
            return;
        }

        try {
            const auth = getAuth();
            const user = auth.currentUser;

            if (!user) {
                alert("You must be signed in to save links.");
                return;
            }

            const db = getFirestore();
            const linkData = {
                userId: user.uid,
                url: url,
                description: description,
                createdAt: new Date()
            };

            // Add link to Firestore
            await addDoc(collection(db, "links"), linkData);
            alert("Link saved successfully!");

            // Reset the input fields after saving
            urlInput.setValue("");
            descInput.setValue("");
        } catch (error) {
            console.error("Error saving link:", error.message);
            alert("An error occurred while saving the link. Please try again.");
        }
    };

    // Set the onshow handler to clear input fields when the modal is shown
    page.onshow = function () {
        urlInput.setValue("");
        descInput.setValue("");
    };

    // Add the page to the Modal
    self.addPage("save_link_with_account", page);
})();


	// Embed
	(function(){
		var page = new Page();
		page.width = 700;
		page.height = 500;

		// ON UPDATE DIMENSIONS
		var iframeSRC;
		var _onUpdate = function(){
			var embedCode = '<iframe width="'+width.getValue()+'" height="'+height.getValue()+'" frameborder="0" src="'+iframeSRC+'"></iframe>';
			output.output(embedCode);
		};

		// THE SHTUFF
		var sidebar = document.createElement("div");
		sidebar.style.width = "150px";
		sidebar.style.height = "440px";
		sidebar.style.float = "left";
		page.dom.appendChild(sidebar);

		// Label
		var label = document.createElement("div");
		label.innerHTML = "<br>PREVIEW &rarr;<br><br>";
		sidebar.appendChild(label);

		// Label 2
		var label = document.createElement("div");
		label.style.fontSize = "15px";
		label.innerHTML = "what size do you want your embed to be?";
		sidebar.appendChild(label);

		// Size!
		var width = _createNumberInput(_onUpdate);
		sidebar.appendChild(width.dom);
		var label = document.createElement("div");
		label.style.display = "inline-block";
		label.style.fontSize = "15px";
		label.innerHTML = "&nbsp;×&nbsp;";
		sidebar.appendChild(label);
		var height = _createNumberInput(_onUpdate);
		sidebar.appendChild(height.dom);

		// Label 3
		var label = document.createElement("div");
		label.style.fontSize = "15px";
		label.innerHTML = "<br><br>copy this code into your website's html:";
		sidebar.appendChild(label);

		// Output!
		var output = new ComponentOutput({});
		output.dom.style.fontSize = "12px";
		sidebar.appendChild(output.dom);

		// Label 3
		var label = document.createElement("div");
		label.style.fontSize = "15px";
		label.style.textAlign = "right";
		label.innerHTML = "<br><br>(note: the REMIX button lets someone else, well, remix your model! don't worry, it'll just be a copy, it won't affect the original.)";
		sidebar.appendChild(label);

		// IFRAME
		var iframe = page.addComponent(new ModalIframe({
			page: page,
			manual: true,
			src: "",
			width: 500,
			height: 440
		})).dom;
		iframe.style.float = "right";
		page.onshow = function(){

			// Default dimensions
			width.setValue(500);
			height.setValue(440);

			// The iframe!
			iframeSRC = loopy.saveToURL(true);
			iframe.src = iframeSRC;

			// Select to copy-paste
			_onUpdate();
			output.dom.select();

		};
		page.onhide = function(){
			iframe.removeAttribute("src");
		};
		self.addPage("embed", page);


	})();

	// GIF
	(function(){
		var page = new Page();
		page.width = 530;
		page.height = 400;
		page.addComponent(new ModalIframe({
			page: page,
			src: "pages/gif.html",
			width: 500,
			height: 350
		}))
		self.addPage("save_gif", page);
	})();

	// My Models (content populated dynamically by SavedModels.js)
	(function(){
		var page = new Page();
		page.width = 600;
		page.height = 500;
		page.onshow = function(){
			if (loopy.savedModels) {
				loopy.savedModels.showMyModelsModal();
			}
		};
		self.addPage("my_models", page);
	})();

	// Formula Editor
	(function(){
		var page = new Page();
		page.width = 600;
		page.height = 700;

		// Inject modern styles for the formula editor modal
		if (!document.getElementById('formula-editor-styles')) {
			var style = document.createElement('style');
			style.id = 'formula-editor-styles';
			style.innerHTML = `
			#modal[show="yes"] .formula-editor-root {
			  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
			  background: #f8fafb;
			  border-radius: 16px;
			  box-shadow: 0 4px 24px rgba(0,0,0,0.10);
			  padding: 16px 12px 12px 12px;
			  max-width: 340px;
			  margin: 0 auto;
			  display: flex;
			  flex-direction: column;
			  align-items: center;
			}
			.formula-editor-root h3 {
			  font-size: 1.15rem;
			  font-weight: 700;
			  margin-bottom: 0.2em;
			  color: #222;
			  text-align: center;
			}
			.formula-editor-root p {
			  color: #555;
			  margin-bottom: 0.7em;
			  font-size: 0.98rem;
			  text-align: center;
			}
			.formula-editor-root .formula-input-row {
			  width: 100%;
			  margin-bottom: 0.7em;
			  display: flex;
			  flex-direction: column;
			  align-items: center;
			}
			.formula-editor-root input[type="text"] {
			  width: 100%;
			  font-size: 1rem;
			  padding: 0.32em 0.6em;
			  border: 1.5px solid #bbb;
			  border-radius: 7px;
			  margin-top: 0.12em;
			  margin-bottom: 0.2em;
			  background: #f7f7fa;
			  transition: border 0.2s;
			}
			.formula-editor-root input[type="text"]:focus {
			  border: 1.5px solid #4CAF50;
			  outline: none;
			}
			.formula-editor-root .calc-outer {
			  width: 100%;
			  display: flex;
			  flex-direction: column;
			  align-items: center;
			  margin-bottom: 0.5em;
			}
			.formula-editor-root .calc-grid {
			  display: grid;
			  grid-template-columns: repeat(6, 32px);
			  gap: 6px;
			  margin: 0 auto;
			  justify-content: center;
			}
			.formula-editor-root .calc-btn {
			  width: 32px;
			  height: 32px;
			  font-size: 0.93rem;
			  border: none;
			  border-radius: 7px;
			  background: #f3f4f6;
			  color: #222;
			  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
			  cursor: pointer;
			  transition: background 0.13s, box-shadow 0.13s;
			  font-weight: 500;
			  display: flex;
			  align-items: center;
			  justify-content: center;
			}
			.formula-editor-root .calc-btn:hover, .formula-editor-root .calc-btn:focus {
			  background: #e0f7e9;
			  box-shadow: 0 2px 8px rgba(76,175,80,0.07);
			}
			.formula-editor-root .calc-btn:active {
			  background: #b2dfdb;
			}
			.formula-editor-root .vars-constants {
			  background: #f4faff;
			  border-radius: 10px;
			  padding: 8px 0 4px 0;
			  margin: 0.7em 0 0.5em 0;
			  width: 100%;
			  box-sizing: border-box;
			  display: flex;
			  flex-direction: column;
			  align-items: center;
			}
			.formula-editor-root .vars-constants h4 {
			  font-size: 0.98rem;
			  font-weight: 600;
			  margin-bottom: 0.3em;
			  color: #333;
			  width: 90%;
			  text-align: left;
			}
			.formula-editor-root .vars-row {
			  display: flex;
			  flex-wrap: wrap;
			  gap: 5px;
			  margin-bottom: 0.2em;
			  width: 90%;
			  justify-content: flex-start;
			}
			.formula-editor-root .vars-btn {
			  padding: 4px 9px;
			  font-size: 0.92rem;
			  border: none;
			  border-radius: 5px;
			  background: #e6f3ff;
			  color: #1a237e;
			  cursor: pointer;
			  transition: background 0.13s;
			}
			.formula-editor-root .vars-btn:hover, .formula-editor-root .vars-btn:focus {
			  background: #b3e5fc;
			}
			.formula-editor-root .action-row {
			  display: flex;
			  gap: 8px;
			  margin-top: 0.7em;
			  justify-content: center;
			  width: 100%;
			}
			.formula-editor-root .action-btn {
			  flex: 1 1 0;
			  padding: 7px 0;
			  font-size: 0.98rem;
			  border: none;
			  border-radius: 7px;
			  font-weight: 600;
			  cursor: pointer;
			  transition: background 0.13s;
			  margin: 0;
			}
			.formula-editor-root .action-btn.save {
			  background: #4CAF50;
			  color: #fff;
			}
			.formula-editor-root .action-btn.save:hover, .formula-editor-root .action-btn.save:focus {
			  background: #388e3c;
			}
			.formula-editor-root .action-btn.clear {
			  background: #f44336;
			  color: #fff;
			}
			.formula-editor-root .action-btn.clear:hover, .formula-editor-root .action-btn.clear:focus {
			  background: #b71c1c;
			}
			.formula-editor-root .action-btn.cancel {
			  background: #888;
			  color: #fff;
			}
			.formula-editor-root .action-btn.cancel:hover, .formula-editor-root .action-btn.cancel:focus {
			  background: #444;
			}
		`;
			document.head.appendChild(style);
		}

		// Root container for formula editor
		var root = document.createElement('div');
		root.className = 'formula-editor-root';
		page.dom.appendChild(root);

		// Title
		var title = document.createElement('h3');
		title.textContent = 'Formula Editor';
		root.appendChild(title);

		var desc = document.createElement('p');
		desc.textContent = "Create a mathematical formula for this node's value";
		root.appendChild(desc);

		// Formula input row
		var formulaRow = document.createElement('div');
		formulaRow.className = 'formula-input-row';
		root.appendChild(formulaRow);

		var formulaLabel = document.createElement('label');
		formulaLabel.textContent = 'Formula:';
		formulaLabel.style.fontWeight = '500';
		formulaLabel.style.marginBottom = '0.2em';
		formulaLabel.style.alignSelf = 'flex-start';
		formulaRow.appendChild(formulaLabel);

		var formulaInput = document.createElement('input');
		formulaInput.type = 'text';
		formulaInput.placeholder = 'e.g., Y0 * Math.exp(k * t)';
		formulaInput.style.marginTop = '0.1em';
		formulaRow.appendChild(formulaInput);

		// Calculator grid (centered, compact)
		var calcOuter = document.createElement('div');
		calcOuter.className = 'calc-outer';
		root.appendChild(calcOuter);

		var calcGrid = document.createElement('div');
		calcGrid.className = 'calc-grid';
		calcOuter.appendChild(calcGrid);

		[
			7, 8, 9, '/', '(', ')',
			4, 5, 6, '*', '^', 'sqrt',
			1, 2, 3, '-', 'exp', 'log',
			0, '.', '=', '+', 'sin', 'cos'
		].forEach(function(symbol) {
			var btn = document.createElement('button');
			btn.className = 'calc-btn';
			btn.textContent = symbol;
			btn.onclick = function() {
				if (symbol === 'sqrt') insertToFormula('Math.sqrt(');
				else if (symbol === 'exp') insertToFormula('Math.exp(');
				else if (symbol === 'log') insertToFormula('Math.log(');
				else if (symbol === 'sin') insertToFormula('Math.sin(');
				else if (symbol === 'cos') insertToFormula('Math.cos(');
				else insertToFormula(symbol);
			};
			calcGrid.appendChild(btn);
		});

		// Variables & Constants (aligned to keypad width)
		var varsBox = document.createElement('div');
		varsBox.className = 'vars-constants';
		root.appendChild(varsBox);

		var varsTitle = document.createElement('h4');
		varsTitle.textContent = 'Variables & Constants';
		varsBox.appendChild(varsTitle);

		var constantsRow = document.createElement('div');
		constantsRow.className = 'vars-row';
		['t', 'Y0', 'pi', 'e'].forEach(function(constant) {
			var btn = document.createElement('button');
			btn.className = 'vars-btn';
			btn.textContent = constant;
			btn.onclick = function() {
				if (constant === 'pi') insertToFormula('Math.PI');
				else if (constant === 'e') insertToFormula('Math.E');
				else insertToFormula(constant);
			};
			constantsRow.appendChild(btn);
		});
		varsBox.appendChild(constantsRow);

		// Node variables (populated on show)
		var nodeVarsRow = document.createElement('div');
		nodeVarsRow.className = 'vars-row';
		nodeVarsRow.id = 'node-vars-row';
		varsBox.appendChild(nodeVarsRow);

		// Action buttons (aligned, compact)
		var actionRow = document.createElement('div');
		actionRow.className = 'action-row';
		root.appendChild(actionRow);

		var saveBtn = document.createElement('button');
		saveBtn.className = 'action-btn save';
		saveBtn.textContent = 'Save Formula';
		saveBtn.onclick = function() {
			if (window.currentFormulaNode) {
				window.currentFormulaNode.formula = formulaInput.value;
				publish('model/changed');
				self.hide();
			}
		};
		actionRow.appendChild(saveBtn);

		var clearBtn = document.createElement('button');
		clearBtn.className = 'action-btn clear';
		clearBtn.textContent = 'Clear Formula';
		clearBtn.onclick = function() {
			formulaInput.value = '';
		};
		actionRow.appendChild(clearBtn);

		var cancelBtn = document.createElement('button');
		cancelBtn.className = 'action-btn cancel';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.onclick = function() {
			self.hide();
		};
		actionRow.appendChild(cancelBtn);

		// Helper: insert text at cursor
		function insertToFormula(text) {
			var input = formulaInput;
			var start = input.selectionStart;
			var end = input.selectionEnd;
			var currentValue = input.value;
			input.value = currentValue.substring(0, start) + text + currentValue.substring(end);
			input.setSelectionRange(start + text.length, start + text.length);
			input.focus();
		}

		// Populate node variables on show
		page.onshow = function() {
			if (window.currentFormulaNode && window.currentFormulaNode.formula) {
				formulaInput.value = window.currentFormulaNode.formula;
			} else {
				formulaInput.value = '';
			}
			nodeVarsRow.innerHTML = '';
			if (window.currentFormulaNode && window.currentFormulaNode.model) {
				window.currentFormulaNode.model.nodes.forEach(function(node) {
					if (node !== window.currentFormulaNode && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(node.label)) {
						var btn = document.createElement('button');
						btn.className = 'vars-btn';
						btn.textContent = node.label;
						btn.onclick = function() { insertToFormula(node.label); };
						nodeVarsRow.appendChild(btn);
					}
				});
			}
		};



		self.addPage("formula_editor", page);
	})();

}

function ModalIframe(config){

	var self = this;

	// IFRAME
	var iframe = document.createElement("iframe");
	self.dom = iframe;
	iframe.width = config.width;
	iframe.height = config.height;

	// Show & Hide
	if(!config.manual){
		config.page.onshow = function(){
			iframe.src = config.src;
		};
		config.page.onhide = function(){
			iframe.removeAttribute("src");
		};
	}

}