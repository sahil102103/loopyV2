// document.getElementById('data-window').innerHTML = `
// 		<div>
// 			<h4>Welcome to the Loopy Output Window</h4>
// 			<p>Click a menu item to get started. The first two tabs are for stakeholders; the rest are for researchers.
// 				Some tabs may load slowly due to complex computations like Simulation and Random Seeds.</p>
// 		</div>
// 		<div class="tabs">
// 			<button class="tablink" id='canvasTab' onclick="openPage('Canvas')">Canvas</button>
// 			<button class="tablink" id='amountsTab' onclick="openPage('Amounts')">Amounts</button>
// 			<button class="tablink" id='timeSeriesTab' onclick="openPage('TimeSeries')">Time Series</button>

// 			<!-- <button class="tablink">Graph Analysis</button> -->
// 			<div class="dropdown">
// 				<button class="tablink">Graph Analysis</button>
// 				<div class="dropdown-content">
// 					<a id='cycleAnalysisTab' onclick="openPage('CycleAnalysis')">Cycle Detection</a>
// 					<a id='degreeCentralityTab' onclick="openPage('DegreeCentrality')">Graph Centralities</a>
// 				</div>
// 			</div>
// 			<button class="tablink" id='visualAnalysisTab' onclick="openPage('VisualAnalysis')">Visual Analysis</button>
// 			<button class="tablink" id='crisisAnalysisTab' onclick="openPage('CrisisAnalysis')">Crisis Analysis</button>

// 			<div class="dropdown">
// 				<button class="tablink">Simulation Graphs</button>
// 				<div class="dropdown-content">
// 					<a id='simulationTab' onclick="openPage('Simulation1')">Histogram 1</a>
// 					<a id='simulation2Tab' onclick="openPage('Simulation2')">Histogram 2</a>
// 					<a id='boxPlotTab' onclick="openPage('BoxPlot')">Box Plot</a>
// 					<a id='violinPlotTab' onclick="openPage('ViolinPlot')">Violin Plot</a>
// 				</div>
// 			</div>
// 			<!-- <button class="tablink" id='simulationTab' onclick="openPage('Simulation')">Simulation</button> -->
// 			<button class="tablink" id='randomSeedsTab' onclick="openPage('RandomSeeds')">Random Seeds</button>
// 			<button class="tablink" id='correlationTab' onclick="openPage('Correlation')">Correlation</button>
// 		</div>

// 		<div id="Canvas" class="tabcontent"> 
// 			<div id="canvasses"></div>

// 			<div id="toolbar"></div>
// 			<div id="playbar"></div>
// 			<div id="sidebar" style="height: 90%; margin-top: 8%;"></div>
// 		</div>

// 		<div id="Amounts" class="tabcontent">
// 			<div id="node-data-content"></div>
// 		</div>

// 		<div id="TimeSeries" class="tabcontent">
// 			<!-- <h2>Node Value over Time</h2> -->
// 			<canvas id="timeSeriesChart" style="width:95%;margin-top: 250px;"></canvas>
// 		</div>

// 		<!-- Have to collaborate with other researcher to have this properly working and change the python code into something that works with the loopy output-->
// 		<div id="CycleAnalysis" class="tabcontent">
// 			<div id="duplicateNodesWithEdgesWarning"></div>
// 			<br>
// 			<h4>Cycle Detection</h4>
// 			<table id="cycleTable"></table>
// 		</div>

// 		<div id="DegreeCentrality" class="tabcontent">
// 			<table id="centralityTable"></table>
// 		</div>

// 		<div id="VisualAnalysis" class="tabcontent">
// 			<div id="visualAnalysisPlots"></div>
// 		</div>

// 		<div id="CrisisAnalysis" class="tabcontent">
// 			<div id="crisisAnalysisPlots"></div>
// 		</div>

// 		<div id="Simulation1" class="tabcontent">
// 			<div id="simulationPlots"></div>
// 		</div>
// 		<div id="Simulation2" class="tabcontent">
// 			<div id="simulationPlots2"></div>
// 		</div>
// 		<div id="BoxPlot" class="tabcontent">
// 			<div id="boxPlots"></div>
// 		</div>
// 		<div id="ViolinPlot" class="tabcontent">
// 			<div id="violinPlots"></div>
// 		</div>

// 		<div id="RandomSeeds" class="tabcontent">
// 			<div id="randomSeedsPlots"></div>
// 		</div>

// 		<div id="Correlation" class="tabcontent">
// 			<div id="correlationPlot" style="width: 100%; height: 100%;"></div>
// 		</div>

// `