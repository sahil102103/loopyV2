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
		// Set hidden state FIRST so a throwing onhide can't leave the overlay
		// up (which would block all menus) or isShowing stuck true.
		document.getElementById("modal_container").setAttribute("show","no");
		self.isShowing = false;
		try {
			if(self.currentPage && self.currentPage.onhide) self.currentPage.onhide();
		} catch(e) {
			console.warn("modal onhide failed:", e);
		}
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

		var page = self.showPage(pageName);
		if(!page){
			console.warn("Modal page not found:", pageName);
			return;
		}

		self.show();

		// Do something
		if(page.onshow) page.onshow();

		// Dimensions
		var dom = document.getElementById("modal");
		dom.style.width = page.width+"px";
		dom.style.height = page.height+"px";

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

	// Save as Link
	(function(){
		var page = new Page();
		page.width = 500;
		page.height = 155;
		page.addComponent(new ComponentHTML({
			html: "copy your link:"
		}));
		var output = page.addComponent(new ComponentOutput({}));

		var label = document.createElement("div");
		label.style.textAlign = "right";
		label.style.fontSize = "15px";
		label.style.marginTop = "6px";
		label.style.color = "#888";
		label.innerHTML = "(this is a long URL, so you may want to use a link-shortener like <a target='_blank' href='https://bitly.com/'>bit.ly</a>)";
		page.dom.appendChild(label);

		var chars = document.createElement("div");
		chars.style.textAlign = "right";
		chars.style.fontSize = "15px";
		chars.style.marginTop = "3px";
		chars.style.color = "#888";
		page.dom.appendChild(chars);

		page.onshow = function(){
			var link = loopy.saveToURL();
			output.output(link);
			output.dom.select();

			var html = link.length+" / 2048 characters";
			if(link.length>2048){
				html += " - MAY BE TOO LONG FOR MOST BROWSERS";
			}
			chars.innerHTML = html;
			chars.style.fontWeight = (link.length>2048) ? "bold" : "100";
			chars.style.fontSize = (link.length>2048) ? "14px" : "15px";
		};

		self.addPage("save_link", page);
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
				loopy.savedModels.showMyModelsModal(page.dom);
			}
		};
		self.addPage("my_models", page);
	})();

	// Formula Editor
	(function(){
		var page = new Page();
		page.width = 600;
		page.height = 710;

		// Inject modern styles for the formula editor modal
		if (!document.getElementById('formula-editor-styles')) {
			var style = document.createElement('style');
			style.id = 'formula-editor-styles';
			style.innerHTML = `
			#modal[show="yes"] .formula-editor-root {
			  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
			  background: #ffffff;
			  border-radius: 12px;
			  overflow: hidden;
			  position: relative;
			  padding: 16px 16px 14px;
			  width: 100%;
			  box-sizing: border-box;
			  display: flex;
			  flex-direction: column;
			  gap: 0;
			}
			.formula-editor-root h3 {
			  font-size: 1.05rem;
			  font-weight: 700;
			  color: #111;
			  text-align: center;
			  margin: 0 0 10px;
			  letter-spacing: -0.01em;
			}
			/* Tab bar */
			.fe-tabs {
			  display: flex;
			  gap: 0;
			  background: #f0f0f0;
			  border-radius: 8px;
			  overflow: hidden;
			  margin-bottom: 8px;
			  padding: 3px;
			}
			.fe-tab {
			  flex: 1;
			  margin: 0;
			  padding: 5px 0;
			  border: none;
			  background: transparent;
			  color: #666;
			  font-size: 0.85rem;
			  font-weight: 500;
			  cursor: pointer;
			  border-radius: 6px;
			  transition: background 0.15s, color 0.15s;
			}
			.fe-tab.active {
			  background: #1a1a2e;
			  color: #fff;
			  font-weight: 600;
			}
			/* Description */
			.fe-desc {
			  font-size: 0.8rem;
			  color: #777;
			  text-align: center;
			  margin: 0 0 8px;
			  min-height: 1.3em;
			  line-height: 1.3;
			}
			/* Input */
			.fe-input-wrap {
			  position: relative;
			  margin-bottom: 8px;
			}
			.fe-input-label {
			  font-size: 0.72rem;
			  font-weight: 600;
			  color: #999;
			  text-transform: uppercase;
			  letter-spacing: 0.05em;
			  margin-bottom: 4px;
			  display: block;
			}
			.formula-editor-root input[type="text"] {
			  width: 100%;
			  font-size: 0.93rem;
			  font-family: 'Menlo', 'Consolas', 'Monaco', monospace;
			  padding: 8px 10px;
			  border: 1.5px solid #d0d0d0;
			  border-radius: 7px;
			  background: #fafafa;
			  color: #1a1a2e;
			  box-sizing: border-box;
			  transition: border 0.2s, box-shadow 0.2s;
			  caret-color: #4CAF50;
			}
			.formula-editor-root input[type="text"]:focus {
			  border-color: #1a1a2e;
			  box-shadow: 0 0 0 3px rgba(26,26,46,0.08);
			  outline: none;
			  background: #fff;
			}
			/* Keypad */
			.formula-editor-root .calc-outer {
			  background: #1a1a2e;
			  border-radius: 10px;
			  padding: 10px 10px 14px;
			  margin-bottom: 8px;
			  width: 100%;
			  box-sizing: border-box;
			  overflow: hidden;
			  align-self: stretch;
			  min-width: 0;
			}
			.formula-editor-root .calc-grid {
			  display: grid;
			  grid-template-columns: repeat(6, minmax(0, 1fr));
			  grid-auto-rows: 38px;
			  gap: 5px;
			  width: 100%;
			}
			.formula-editor-root .calc-btn {
			  height: 38px;
			  margin: 0;
			  padding: 0;
			  font-size: 0.88rem;
			  border: none;
			  border-radius: 6px;
			  cursor: pointer;
			  font-weight: 500;
			  font-family: 'Menlo', 'Consolas', monospace;
			  transition: filter 0.1s, transform 0.1s;
			  display: flex;
			  align-items: center;
			  justify-content: center;
			  user-select: none;
			}
			.formula-editor-root .calc-btn:active {
			  filter: brightness(1.2);
			  transform: scale(0.95);
			}
			/* Digit buttons */
			.formula-editor-root .calc-btn.btn-num {
			  background: #2d2d44;
			  color: #cdd6f4;
			}
			.formula-editor-root .calc-btn.btn-num:hover {
			  background: #383854;
			}
			/* Operator buttons */
			.formula-editor-root .calc-btn.btn-op {
			  background: #1e3a5f;
			  color: #89b4fa;
			}
			.formula-editor-root .calc-btn.btn-op:hover {
			  background: #254980;
			}
			/* Paren buttons */
			.formula-editor-root .calc-btn.btn-paren {
			  background: #2d3748;
			  color: #ffd700;
			}
			.formula-editor-root .calc-btn.btn-paren:hover {
			  background: #3a4a60;
			}
			/* Function buttons */
			.formula-editor-root .calc-btn.btn-fn {
			  background: #1a3a2a;
			  color: #a6e3a1;
			  font-size: 0.82rem;
			}
			.formula-editor-root .calc-btn.btn-fn:hover {
			  background: #224d38;
			}
			/* Backspace button */
			.formula-editor-root .calc-btn.btn-del {
			  background: #3a1a1a;
			  color: #f38ba8;
			}
			.formula-editor-root .calc-btn.btn-del:hover {
			  background: #4d2020;
			}
			/* Variables section */
			.formula-editor-root .vars-constants {
			  background: #f8f9fa;
			  border: 1.5px solid #e8e8e8;
			  border-radius: 8px;
			  padding: 8px 10px 6px;
			  margin-bottom: 10px;
			}
			.formula-editor-root .vars-constants h4 {
			  font-size: 0.7rem;
			  font-weight: 600;
			  color: #999;
			  text-transform: uppercase;
			  letter-spacing: 0.05em;
			  margin: 0 0 6px;
			}
			.formula-editor-root .vars-row {
			  display: flex;
			  flex-wrap: wrap;
			  gap: 5px;
			}
			.formula-editor-root .vars-row + .vars-row {
			  margin-top: 5px;
			}
			.formula-editor-root .vars-btn {
			  margin: 0;
			  padding: 3px 10px;
			  font-size: 0.82rem;
			  font-family: 'Menlo', 'Consolas', monospace;
			  border: 1.5px solid #d0d8ff;
			  border-radius: 4px;
			  background: #eef0fe;
			  color: #3730a3;
			  cursor: pointer;
			  transition: background 0.13s;
			  font-weight: 500;
			}
			.formula-editor-root .vars-btn:hover {
			  background: #d0d5fa;
			}
			/* Action row */
			.formula-editor-root .action-row {
			  display: flex;
			  gap: 8px;
			}
			.formula-editor-root .action-btn {
			  flex: 1;
			  margin: 0;
			  padding: 9px 0;
			  font-size: 0.88rem;
			  font-weight: 600;
			  border: none;
			  border-radius: 7px;
			  cursor: pointer;
			  letter-spacing: 0.02em;
			  transition: filter 0.13s;
			}
			.formula-editor-root .action-btn:hover { filter: brightness(0.9); }
			.formula-editor-root .action-btn.save   { background: #1a1a2e; color: #fff; }
			.formula-editor-root .action-btn.clear  { background: #fee2e2; color: #991b1b; }
			.formula-editor-root .action-btn.cancel { background: #f1f1f1; color: #444; }
			/* Title header + help toggle */
			.formula-editor-root .fe-header {
			  position: relative;
			  display: flex;
			  align-items: center;
			  justify-content: center;
			  margin-bottom: 10px;
			}
			.formula-editor-root .fe-header h3 { margin: 0; }
			.formula-editor-root .fe-help-btn {
			  position: absolute;
			  right: 0;
			  top: 50%;
			  transform: translateY(-50%);
			  width: 24px; height: 24px;
			  border-radius: 50%;
			  border: 1.5px solid #d0d0d0;
			  background: #f5f5f5;
			  color: #555;
			  font-weight: 700;
			  font-size: 0.85rem;
			  line-height: 1;
			  padding: 0;
			  cursor: pointer;
			  display: flex; align-items: center; justify-content: center;
			}
			.formula-editor-root .fe-help-btn:hover { background: #e9e9f5; color: #1a1a2e; }
			/* Help overlay panel */
			.formula-editor-root .fe-help {
			  display: none;
			  position: absolute;
			  inset: 0;
			  z-index: 5;
			  background: #fff;
			  border-radius: 12px;
			  padding: 18px 20px;
			  overflow-y: auto;
			  box-sizing: border-box;
			}
			.formula-editor-root .fe-help.open { display: block; }
			.formula-editor-root .fe-help h4 { font-size: 1rem; margin: 0 0 6px; color: #111; }
			.formula-editor-root .fe-help h5 { font-size: 0.78rem; margin: 13px 0 4px; color: #1a1a2e; text-transform: uppercase; letter-spacing: 0.04em; }
			.formula-editor-root .fe-help p { font-size: 0.82rem; line-height: 1.45; color: #444; margin: 4px 0; }
			.formula-editor-root .fe-help ul { margin: 4px 0; padding-left: 18px; }
			.formula-editor-root .fe-help li { font-size: 0.82rem; line-height: 1.5; color: #444; }
			.formula-editor-root .fe-help code { font-family: 'Menlo','Consolas',monospace; background: #f0f0f5; padding: 1px 5px; border-radius: 4px; color: #3730a3; font-size: 0.78rem; }
			.formula-editor-root .fe-help table { width: 100%; border-collapse: collapse; margin: 6px 0; }
			.formula-editor-root .fe-help th, .formula-editor-root .fe-help td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #eee; font-size: 0.79rem; vertical-align: top; }
			.formula-editor-root .fe-help-callout { background: #fff8e1; border: 1px solid #ffe082; border-radius: 6px; padding: 8px 10px; margin: 10px 0; font-size: 0.8rem; line-height: 1.45; color: #6d4c00; }
			.formula-editor-root .fe-help-close {
			  position: absolute; top: 10px; right: 12px;
			  border: none; background: transparent;
			  font-size: 1.3rem; line-height: 1; cursor: pointer; color: #999; padding: 2px 6px;
			}
			.formula-editor-root .fe-help-close:hover { color: #333; }
		`;
			document.head.appendChild(style);
		}

		// Root container for formula editor
		var root = document.createElement('div');
		root.className = 'formula-editor-root';
		page.dom.appendChild(root);

		// Title + help toggle
		var header = document.createElement('div');
		header.className = 'fe-header';
		var title = document.createElement('h3');
		title.textContent = 'Formula Editor';
		header.appendChild(title);
		var helpBtn = document.createElement('button');
		helpBtn.className = 'fe-help-btn';
		helpBtn.textContent = '?';
		helpBtn.title = 'How formulas work';
		header.appendChild(helpBtn);
		root.appendChild(header);

		// Help overlay panel (hidden until "?" is clicked)
		var help = document.createElement('div');
		help.className = 'fe-help';
		help.innerHTML = `
			<button class="fe-help-close" title="Close">&times;</button>
			<h4>How formulas work</h4>
			<p>Each node has three optional formulas. Pick a tab, type an expression, and Save. Canvas Play and notebook-backed analyses use the same four-phase simulation contract.</p>

			<h5>The three tabs</h5>
			<ul>
				<li><b>Value</b> — replaces a retention-zero converter's edge-driven update with your expression.</li>
				<li><b>Source</b> — returns a post-update multiplier, normally above <code>1</code>.</li>
				<li><b>Sink</b> — returns a post-update multiplier, normally between <code>0</code> and <code>1</code>.</li>
			</ul>

			<div class="fe-help-callout"><b>Source &amp; Sink are multiplicative factors.</b> Bounds are applied first, then the Sink factor, then the Source factor. <code>1</code> is neutral, <code>0.95</code> removes 5%, and <code>1.05</code> adds 5%.</div>

			<h5>Variables you can use</h5>
			<table>
				<tr><th>Variable</th><th>Meaning</th></tr>
				<tr><td><code>x</code> or <code>val</code></td><td>this node's current value (Source/Sink)</td></tr>
				<tr><td><code>Y0</code></td><td>this node's initial value</td></tr>
				<tr><td><code>t</code></td><td>current timestep (0, 1, 2, …)</td></tr>
				<tr><td><code>math.*</code>, <code>np.*</code>, <code>e</code></td><td>restricted math helpers such as <code>math.exp</code>, <code>math.sin</code>, and <code>np.clip</code></td></tr>
				<tr><td><code>raw['Name']</code></td><td>a node's value at the start of the tick</td></tr>
				<tr><td><code>nxt['Name']</code></td><td>a node's currently committed next value</td></tr>
				<tr><td><code>inputs['Name']</code></td><td>an incoming edge contribution for a converter</td></tr>
			</table>

			<h5>Examples</h5>
			<ul>
				<li>Constant 5% growth — <b>Source</b>: <code>1.05</code></li>
				<li>Constant 5% drain — <b>Sink</b>: <code>0.95</code></li>
				<li>Time-varying drain — <b>Sink</b>: <code>math.exp(-0.01 * t)</code></li>
				<li>Oscillating source factor — <b>Source</b>: <code>1 + 0.1 * math.sin(t / 5)</code></li>
				<li>Converter from another node — <b>Value</b>: <code>0.6 * nxt['Income']</code></li>
			</ul>

			<p style="color:#888;">Tip: the quick checkboxes set factors of <code>1.05</code> and <code>0.95</code>. Invalid Source/Sink formulas use the neutral factor <code>1</code>; invalid Value formulas retain the converter's previous value.</p>
		`;
		root.appendChild(help);
		helpBtn.onclick = function() { help.classList.toggle('open'); };
		help.querySelector('.fe-help-close').onclick = function() { help.classList.remove('open'); };

		// Tabs: Value / Sink / Source
		var tabBar = document.createElement('div');
		tabBar.className = 'fe-tabs';
		root.appendChild(tabBar);

		var tabDefs = [
			{ key: 'formula',      label: 'Value',  desc: "Defines a retention-zero converter — use raw, nxt, inputs, t, and Y0.", placeholder: "e.g., 0.6 * nxt['Income']" },
			{ key: 'sinkFormula',  label: 'Sink',   desc: "Post-update factor applied first — 1 is neutral; 0.95 removes 5%.",     placeholder: 'e.g., 0.95  or  math.exp(-0.01 * t)' },
			{ key: 'sourceFormula',label: 'Source', desc: "Post-update factor applied after Sink — 1.05 adds 5%.",                placeholder: 'e.g., 1.05  or  1 + 0.1 * math.sin(t)' },
		];

		var activeTab = 'formula';
		var tabBtns = {};
		tabDefs.forEach(function(def) {
			var btn = document.createElement('button');
			btn.textContent = def.label;
			btn.className = 'fe-tab';
			btn.onclick = function() {
				activeTab = def.key;
				updateActiveTab();
			};
			tabBtns[def.key] = btn;
			tabBar.appendChild(btn);
		});

		// Description line
		var desc = document.createElement('p');
		desc.className = 'fe-desc';
		root.appendChild(desc);

		// Formula input
		var formulaRow = document.createElement('div');
		formulaRow.className = 'fe-input-wrap';
		root.appendChild(formulaRow);

		var formulaLabel = document.createElement('label');
		formulaLabel.className = 'fe-input-label';
		formulaRow.appendChild(formulaLabel);

		var formulaInput = document.createElement('input');
		formulaInput.type = 'text';
		formulaRow.appendChild(formulaInput);

		// Per-tab stored values (written on tab switch)
		var tabValues = { formula: '', sinkFormula: '', sourceFormula: '' };

		function updateActiveTab() {
			tabDefs.forEach(function(def) {
				var btn = tabBtns[def.key];
				if (def.key === activeTab) {
					desc.textContent = def.desc;
					formulaLabel.textContent = def.label + ' Formula';
					formulaInput.placeholder = def.placeholder;
					formulaInput.value = tabValues[def.key];
					btn.classList.add('active');
				} else {
					btn.classList.remove('active');
				}
			});
			formulaInput.focus();
		}

		// Sync input value back to tabValues before switching
		formulaInput.addEventListener('input', function() {
			tabValues[activeTab] = formulaInput.value;
		});

		// Calculator grid (centered, compact)
		var calcOuter = document.createElement('div');
		calcOuter.className = 'calc-outer';
		root.appendChild(calcOuter);

		var calcGrid = document.createElement('div');
		calcGrid.className = 'calc-grid';
		calcOuter.appendChild(calcGrid);

		var buttonDefs = [
			{ s: '7',    c: 'num'   }, { s: '8',    c: 'num'   }, { s: '9',    c: 'num'   }, { s: '/',    c: 'op'    }, { s: '(',    c: 'paren' }, { s: ')',    c: 'paren' },
			{ s: '4',    c: 'num'   }, { s: '5',    c: 'num'   }, { s: '6',    c: 'num'   }, { s: '*',    c: 'op'    }, { s: '**',   c: 'op'    }, { s: 'sqrt', c: 'fn'    },
			{ s: '1',    c: 'num'   }, { s: '2',    c: 'num'   }, { s: '3',    c: 'num'   }, { s: '-',    c: 'op'    }, { s: 'exp',  c: 'fn'    }, { s: 'log',  c: 'fn'    },
			{ s: '0',    c: 'num'   }, { s: '.',    c: 'num'   }, { s: '⌫',   c: 'del'   }, { s: '+',    c: 'op'    }, { s: 'sin',  c: 'fn'    }, { s: 'cos',  c: 'fn'    },
		];
		buttonDefs.forEach(function(def) {
			var btn = document.createElement('button');
			btn.className = 'calc-btn btn-' + def.c;
			btn.textContent = def.s;
			btn.onclick = function() {
				if (def.s === '⌫') {
					var input = formulaInput;
					var start = input.selectionStart, end = input.selectionEnd;
					if (start !== end) {
						input.value = input.value.substring(0, start) + input.value.substring(end);
						input.setSelectionRange(start, start);
					} else if (start > 0) {
						input.value = input.value.substring(0, start - 1) + input.value.substring(start);
						input.setSelectionRange(start - 1, start - 1);
					}
					tabValues[activeTab] = input.value;
					input.focus();
				} else if (def.s === 'sqrt') insertToFormula('math.sqrt(');
				else if (def.s === 'exp')  insertToFormula('math.exp(');
				else if (def.s === 'log')  insertToFormula('math.log(');
				else if (def.s === 'sin')  insertToFormula('math.sin(');
				else if (def.s === 'cos')  insertToFormula('math.cos(');
				else insertToFormula(def.s);
			};
			calcGrid.appendChild(btn);
		});

		// Variables & Constants (aligned to keypad width)
		var varsBox = document.createElement('div');
		varsBox.className = 'vars-constants';
		root.appendChild(varsBox);

		var varsTitle = document.createElement('h4');
		varsTitle.textContent = 'Variables & Constants';
		varsTitle.style.marginBottom = '7px';
		varsBox.appendChild(varsTitle);

		var constantsRow = document.createElement('div');
		constantsRow.className = 'vars-row';
		['t', 'Y0', 'pi', 'e'].forEach(function(constant) {
			var btn = document.createElement('button');
			btn.className = 'vars-btn';
			btn.textContent = constant;
			btn.onclick = function() {
				if (constant === 'pi') insertToFormula('math.pi');
				else if (constant === 'e') insertToFormula('math.e');
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
		saveBtn.textContent = 'Save';
		saveBtn.onclick = function() {
			if (window.currentFormulaNode) {
				tabValues[activeTab] = formulaInput.value; // flush current tab
				window.currentFormulaNode.formula       = tabValues.formula       || null;
				window.currentFormulaNode.sinkFormula   = tabValues.sinkFormula   || null;
				window.currentFormulaNode.sourceFormula = tabValues.sourceFormula || null;
				publish('model/changed');
				self.hide();
			}
		};
		actionRow.appendChild(saveBtn);

		var clearBtn = document.createElement('button');
		clearBtn.className = 'action-btn clear';
		clearBtn.textContent = 'Clear';
		clearBtn.onclick = function() {
			formulaInput.value = '';
			tabValues[activeTab] = '';
		};
		actionRow.appendChild(clearBtn);

		var cancelBtn = document.createElement('button');
		cancelBtn.className = 'action-btn cancel';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.onclick = function() {
			self.hide();
		};
		actionRow.appendChild(cancelBtn);

		// Helper: insert text at cursor in the active input
		function insertToFormula(text) {
			var input = formulaInput;
			var start = input.selectionStart;
			var end = input.selectionEnd;
			input.value = input.value.substring(0, start) + text + input.value.substring(end);
			input.setSelectionRange(start + text.length, start + text.length);
			tabValues[activeTab] = input.value;
			input.focus();
		}

		// Populate node variables on show
		page.onshow = function() {
			var node = window.currentFormulaNode;
			tabValues.formula       = (node && node.formula)       || '';
			tabValues.sinkFormula   = (node && node.sinkFormula)   || '';
			tabValues.sourceFormula = (node && node.sourceFormula) || '';
			activeTab = 'formula';
			updateActiveTab();
			nodeVarsRow.innerHTML = '';
			if (node && node.model) {
				node.model.nodes.forEach(function(n) {
					if (n !== node && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(n.label)) {
						var btn = document.createElement('button');
						btn.className = 'vars-btn';
						btn.textContent = n.label;
						btn.onclick = function() { insertToFormula(n.label); };
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
