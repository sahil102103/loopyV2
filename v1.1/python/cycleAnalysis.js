// const apiKey = process.env.URL_DOMAIN;


function showLoadingSpinner() {
    document.getElementById('loading-spinner').style.display = 'block';
}

// Function to hide the loading spinner
function hideLoadingSpinner() {
    document.getElementById('loading-spinner').style.display = 'none';
}

// Global arrays (if you wish to keep them as globals)
let edgePairs = [];
let edgePolarities = [];
let edgeWeights = [];
let edgeDelays = [];
let edgeCertainties = [];
let duplicateLabels = [];
let variables = [];
let timeSeriesData = {};

let edgeNodesPairs = [];

// Utility for small async delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// Example function that updates edgePolarities asynchronously
// If your code does not need this small delay or logic, you can remove it.
const delayNodeAdding = async (from, to, label) => {
    await delay(2);
    const index = edgePairs.findIndex(pair => pair[0] === from.label && pair[1] === to.label);
    if (index !== -1 && edgePolarities[index] !== label) {
        edgePolarities[index] = label;
    }
};

// Store every [node.id, node.label] pair so we can detect duplicates
const addEdgeNodePair = (from, to) => {
    const edgeNodePair = [[from.id, from.label], [to.id, to.label]];
    edgeNodesPairs.push(edgeNodePair);
};

// Check if multiple different node IDs share the same label
// (Loopy can allow duplicate labels).
const findDuplicateLabels = () => {
    const labelMap = new Map();
    edgeNodesPairs.forEach(pair => {
        pair.forEach(node => {
            const [id, label] = node;
            if (labelMap.has(label)) {
                const existingIds = labelMap.get(label);
                if (!existingIds.includes(id)) {
                    duplicateLabels.push(label);
                    existingIds.push(id);
                }
            } else {
                labelMap.set(label, [id]);
            }
        });
    });
};

/**
 * loadInitialData
 * 
 * Gathers the latest state of nodes, edges, and time-series from Loopy.
 * Returns an object with all data needed by the backend.
 */
const loadInitialData = async () => {
    // Clear arrays from any previous runs (optional).
    edgePairs = [];
    edgePolarities = [];
    edgeWeights = [];
    edgeDelays = [];
    edgeCertainties = [];
    edgeNodesPairs = [];
    duplicateLabels = [];
    variables = [];

    // 1. Capture time series data if it exists in your Chart
    //    If no data, we alert the user.
    timeSeriesData =
      chart?.data?.datasets?.length
        ? chart.data.datasets.reduce((acc, dataset) => {
            acc[dataset.label] = [...dataset.data];
            return acc;
          }, {})
        : {};

    if (!Object.keys(timeSeriesData).length) {
        alert('Please run the diagram to access all tabs (no time series data found).');
        return null; 
    }

    // 2. Filter nodes & edges based on user selection or entire Loopy model
    const selectedNodes = loopy.multipleselect.getSelectedNodes(); // array of node.labels selected
    const hasSelection = selectedNodes.length > 0;

    const nodesToInclude = hasSelection
        ? loopy.model.nodes.filter(node => selectedNodes.includes(node.label))
        : loopy.model.nodes;

    const edgesToInclude = hasSelection
        ? loopy.model.edges.filter(edge =>
            selectedNodes.includes(edge.from.label) &&
            selectedNodes.includes(edge.to.label)
          )
        : loopy.model.edges;

    // 3. Collect variables (node labels)
    nodesToInclude.forEach(node => {
        variables.push(node.label);
    });

    // 4. Collect edge data
    for (const edge of edgesToInclude) {
        const node1 = edge.from;
        const node2 = edge.to;

        // Track the node info for detecting duplicate labels
        addEdgeNodePair(node1, node2);

        // Push edge attributes
        edgeWeights.push(edge.damper);
        edgeDelays.push(edge.lag);
        edgeCertainties.push(edge.confidence);

        // Delay-based labeling logic
        await delayNodeAdding(node1, node2, edge.label);

        // Build the edge pair if it’s not already present
        const edgePair = [node1.label, node2.label];
        const exists = edgePairs.some(pair =>
            pair[0] === edgePair[0] && pair[1] === edgePair[1]
        );
        if (!exists) {
            edgePairs.push(edgePair);
            edgePolarities.push(edge.strength); // e.g., '+' or '-'
        }
    }

    // 5. Find & store labels that appear on multiple node IDs
    findDuplicateLabels();

    // 6. OPTIONAL: If your backend expects passNodes, floors, ceilings, etc.,
    //    define them here or fetch them from your UI.
    //    For demonstration, let's define some empty placeholders.
    const passnodeList = loopy.model.nodes
    .filter(node => node.isPassNode)
    .map(node => node.label);

    const nodeFloors = loopy.model.nodes.reduce((acc, node) => {
        acc[node.label] = node.floor !== undefined ? node.floor : -Infinity; // Default to -Infinity if undefined
        return acc;
    }, {});
    
    const nodeCeilings = loopy.model.nodes.reduce((acc, node) => {
        acc[node.label] = node.ceiling !== undefined ? node.ceiling : Infinity; // Default to Infinity if undefined
        return acc;
    }, {});

    // 7. Return a single object containing everything the backend needs.
    //    The backend's route will read these fields to rebuild the graph.
    return {
        edges: edgePairs,            // array of [sourceLabel, targetLabel]
        edgeWeights,                 // array of numeric weights
        edgePolarities,              // array of '+' or '-' (etc.)
        edgeDelays,                  // array of numeric delays
        edgeCertainties,             // array of numeric certainties
        passNodes: passnodeList,                   // array of node labels that should be pass-nodes
        nodeFloors,                  // object with { [nodeLabel]: number }
        nodeCeilings,                // object with { [nodeLabel]: number }
        timeSeriesData,              // node -> array of numeric values
        variables,                   // node labels, if needed
        duplicateLabels,             // for debugging or special handling
    };
};

document.getElementById('cycleAnalysisTab').onclick = async () => {

    showLoadingSpinner();
    await loadInitialData();

    // Collect data to send to the backend
    const payload = {
        edges: edgePairs, // Example: [["A", "B"], ["B", "C"]]
        edge_polarities: edgePolarities // Example: ["+", "–"]
    };

    console.log(payload)

    try {
        // Send POST request to Flask backend
        const response = await fetch('https://loopyv2.onrender.com/cycle-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Display the returned table in HTML
        document.getElementById("cycleTable").innerHTML = data.table;

        // Handle duplicate node labels
        const duplicateNodesWithEdgesWarningId = document.getElementById("duplicateNodesWithEdgesWarning");
        duplicateNodesWithEdgesWarningId.innerHTML = 'Duplicate Nodes: ';
        duplicateLabels.forEach(label => {
            duplicateNodesWithEdgesWarningId.innerHTML += `<span>${label}; </span>`;
        });

        // CLD cycle analysis moved to dedicated CLD Analysis tab

    } catch (error) {
        console.error("Error fetching cycle analysis data:", error);
    } finally {
        hideLoadingSpinner();
        openPage('CycleAnalysis');
    }
};

// Crisis Analysis Event Listener
document.getElementById('crisisAnalysisTab').addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    console.log("Crisis Analysis clicked");

    showLoadingSpinner();

    try {
        // Load data
        await loadInitialData();

        if (Object.keys(timeSeriesData).length === 0) {
            throw new Error("No valid time series data to send.");
        }

        const requestData = { time_series_data: timeSeriesData, start_iteration: 0 };
        console.log("Payload:", requestData);

        // Fetch plot from the backend
        const response = await fetch('https://loopyv2.onrender.com/crisis-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

        // Display the plot
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const container = document.getElementById('crisisAnalysisPlots');
        container.innerHTML = ''; // Clear previous plots

        const img = document.createElement('img');
        img.src = url;
        img.alt = "Crisis Analysis Plot";
        container.appendChild(img);

        // CLD behavior classification moved to dedicated CLD Analysis tab

    } catch (error) {
        console.error("Error:", error);
        alert(`Error: ${error.message}`);
    } finally {
        hideLoadingSpinner();
        console.log('Done');
    }
});

// CLD Analysis is now integrated into existing analysis tabs
// No separate tab needed

// CLD analysis functions are now integrated into existing analysis tabs

document.getElementById('degreeCentralityTab').onclick = async () => {
    showLoadingSpinner();
    await loadInitialData();

    const payload = {
        edges: edgePairs, // Example: [["A", "B"], ["B", "C"]]
        edge_polarities: edgePolarities // Example: ["+", "–"]
    };

    try {
        // Send POST request to the backend
        const response = await fetch('https://loopyv2.onrender.com/degree-centrality', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Backend Error: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        // Insert the returned HTML into the DOM
        document.getElementById("centralityTable").innerHTML = data.centrality_output;
    } catch (error) {
        console.error("Error fetching centrality data:", error);
        alert(`Error: ${error.message}`);
    } finally {
        hideLoadingSpinner();
        openPage('DegreeCentrality');
    }
};

document.getElementById('visualAnalysisTab').onclick = async () => {
    showLoadingSpinner();
    try {
        // Prepare data payload to send to the backend
        const payload = {
            edges: edgePairs,             // Example: [["A", "B"], ["B", "C"]]
            edge_polarities: edgePolarities // Example: ["+", "–"]
        };

        // Send a POST request to the Flask backend
        const response = await fetch('https://loopyv2.onrender.com/visual-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch visual analysis: ${response.statusText}`);
        }

        const { plots } = await response.json(); // Retrieve file paths for plots

        // Display the plots dynamically
        const plotsContainer = document.getElementById('visualAnalysisPlots');
        plotsContainer.innerHTML = ''; // Clear existing plots

        plots.forEach(plotPath => {
            const img = document.createElement('img');
            img.src = `https://loopyv2.onrender.com/get-plot/${plotPath}`;
            img.alt = 'Visual Analysis Plot';
            plotsContainer.appendChild(img);
        });

        openPage('VisualAnalysis'); // Open the Visual Analysis Tab
    } catch (error) {
        console.error("Error fetching visual analysis:", error);
        alert(`Error: ${error.message}`);
    } finally {
        hideLoadingSpinner();
    }
};


// Correlation Analysis Event Listener
document.getElementById('correlationTab').addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    console.log("Correlation Analysis clicked");

    showLoadingSpinner();

    try {
        // Load graph data
        await loadInitialData();

        if (edgePairs.length === 0) {
            throw new Error("No valid edges provided for correlation analysis.");
        }

        const requestData = { edges: edgePairs, time_points: 50 };
        console.log("Payload:", requestData);

        // Fetch correlation plot from the backend
        const response = await fetch('https://loopyv2.onrender.com/correlation-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

        // Display the plot
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const container = document.getElementById('correlationPlot');
        container.innerHTML = ''; // Clear previous plots

        const img = document.createElement('img');
        img.src = url;
        img.alt = "Correlation Analysis Plot";
        container.appendChild(img);

    } catch (error) {
        console.error("Error fetching correlation analysis:", error);
        alert(`Error: ${error.message}`);
    } finally {
        hideLoadingSpinner();
        console.log('Correlation Analysis Done');
    }
});


// Example for a stability map that needs decay/delay ranges
document.getElementById("genereatedDelayDecay").onclick = async () => {
    showLoadingSpinner();
    const data = await loadInitialData();
    if (!data) {
        hideLoadingSpinner();
        console.log('fail')
        return;
    }

    const decayMin = parseFloat(document.getElementById("decayMin").value);
    const decayMax = parseFloat(document.getElementById("decayMax").value);
    const decaySteps = parseInt(document.getElementById("decaySteps").value);
    const delayMin = parseFloat(document.getElementById("delayMin").value);
    const delayMax = parseFloat(document.getElementById("delayMax").value);
    const delaySteps = parseInt(document.getElementById("delaySteps").value);

    const requestData = {
        // Merge data from loadInitialData with your range values
        ...data,
        decayRange: [decayMin, decayMax, decaySteps],
        delayRange: [delayMin, delayMax, delaySteps]
    };

    console.log("Request Data for Stability Map:", requestData);

    try {
        const response = await fetch("https://loopyv2.onrender.com/generate-stability-map", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestData),
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const plotContainer = document.getElementById("stabilityMapPlot");
        plotContainer.innerHTML = ""; 
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Stability Map";
        plotContainer.appendChild(img);
    } catch (error) {
        console.error("Error generating stability map:", error);
        alert("Failed to generate stability map. See console for details.");
    } finally {
        hideLoadingSpinner();
    }
};


// Generate Decay-Retention Stability Map
document.getElementById("generateDecayRetention").onclick = async () => {
    showLoadingSpinner();
    try {
      // 1. Load Loopy data
      const data = await loadInitialData();
      if (!data) {
        hideLoadingSpinner();
        return;
      }
  
      // 2. Extract user inputs for Decay/Retention
      const decayMin = parseFloat(document.getElementById("decayMin").value);
      const decayMax = parseFloat(document.getElementById("decayMax").value);
      const decaySteps = parseInt(document.getElementById("decaySteps").value);
  
      const retentionMin = parseFloat(document.getElementById("nodeRetentionMin").value);
      const retentionMax = parseFloat(document.getElementById("nodeRetentionMax").value);
      const retentionSteps = parseInt(document.getElementById("nodeRetentionSteps").value);
  
      // 3. Merge everything into a single payload
      const requestData = {
        ...data, // edges, edgeWeights, edgePolarities, passNodes, etc. from loadInitialData
        decayRange: [decayMin, decayMax, decaySteps],
        retentionRange: [retentionMin, retentionMax, retentionSteps],
      };
  
      // 4. Send POST to the Flask route
      const response = await fetch("https://loopyv2.onrender.com/generate-decay-retention-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });
  
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.statusText}`);
      }
  
      // 5. Get the PNG blob
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
  
      // 6. Display the resulting image in your DOM
      const plotsContainer = document.getElementById("stabilityMapPlot");
      plotsContainer.innerHTML = "";
      const img = document.createElement("img");
      img.src = url;
      img.alt = "Decay-Retention Stability Map";
      plotsContainer.appendChild(img);
  
    } catch (error) {
      console.error("Error generating decay-retention map:", error);
      alert("An error occurred. Check console for details.");
    } finally {
      hideLoadingSpinner();
    }
  };
  


// Generate Retention-Delay Stability Map
document.getElementById("generateRetentionDelay").onclick = async () => {
    showLoadingSpinner();
    const data = await loadInitialData();
    if (!data) {
        hideLoadingSpinner();
        return;
    }

    try {
        const retentionMin = parseFloat(document.getElementById("nodeRetentionMin").value);
        const retentionMax = parseFloat(document.getElementById("nodeRetentionMax").value);
        const retentionSteps = parseInt(document.getElementById("nodeRetentionSteps").value);

        const delayMin = parseFloat(document.getElementById("delayMin").value);
        const delayMax = parseFloat(document.getElementById("delayMax").value);
        const delaySteps = parseInt(document.getElementById("delaySteps").value);

        const requestData = {
            ...data,
            retentionRange: [retentionMin, retentionMax, retentionSteps],
            delayRange: [delayMin, delayMax, delaySteps],
        };

        console.log("Request Data for Retention-Delay Map:", requestData);

        const response = await fetch("https://loopyv2.onrender.com/generate-retention-delay-map", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestData),
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.statusText}`);

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const plotsContainer = document.getElementById("stabilityMapPlot");
        plotsContainer.innerHTML = "";
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Retention-Delay Stability Map";
        plotsContainer.appendChild(img);
    } catch (error) {
        console.error("Error generating retention-delay map:", error);
        alert("An error occurred. Check console for details.");
    } finally {
        hideLoadingSpinner();
    }
};

document.getElementById('simulationTab').onclick = async () => {
    showLoadingSpinner();
    await loadInitialData();

    try {
        // Log the payload for debugging
        console.log('Payload:', { time_series_data: timeSeriesData });

        // Send data to the backend for simulation
        const response = await fetch('https://loopyv2.onrender.com/simulation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ time_series_data: timeSeriesData }),
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('Backend error:', error);
            throw new Error(error.error || 'Failed to fetch simulation plot');
        }

        // Receive the simulation plot
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        // Display the plot in the simulationPlots container
        const plotsContainer = document.getElementById('simulationPlots');
        plotsContainer.innerHTML = ''; // Clear any existing content

        const img = document.createElement('img');
        img.src = url;
        plotsContainer.appendChild(img);
    } catch (error) {
        console.error('Error:', error.message);
        alert('An error occurred while generating the simulation plot. Please try again.');
    } finally {
        hideLoadingSpinner();
        openPage('Simulation1');
    }
};


document.getElementById('simulation2Tab').onclick = async () => {
    showLoadingSpinner();
    await loadInitialData();

    try {
        // Send data to the backend for simulation
        const response = await fetch('https://loopyv2.onrender.com/simulation2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ time_series_data: timeSeriesData }),
        });

        if (!response.ok) {
            throw new Error('Failed to fetch simulation2 plots');
        }

        // Receive the simulation plots
        const { plots } = await response.json();
        const plotsContainer = document.getElementById('simulationPlots2');
        plotsContainer.innerHTML = ''; // Clear any existing content

        // Display each plot
        plots.forEach((plot) => {
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${plot.plot}`;
            img.alt = `Simulation2 Plot: ${plot.variable}`;
            plotsContainer.appendChild(img);
        });
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while generating the simulation2 plots. Please try again.');
    } finally {
        hideLoadingSpinner();
        openPage('Simulation2');
    }
};

document.getElementById('boxPlotTab').onclick = async () => {
    showLoadingSpinner();
    await loadInitialData();

    try {
        // Send data to the backend for boxplot generation
        const response = await fetch('https://loopyv2.onrender.com/boxplots', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ time_series_data: timeSeriesData }),
        });

        if (!response.ok) {
            throw new Error('Failed to fetch boxplots');
        }

        // Receive the boxplots
        const { plots } = await response.json();
        const plotsContainer = document.getElementById('boxPlots');
        plotsContainer.innerHTML = ''; // Clear any existing content

        // Display each plot
        plots.forEach((plot) => {
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${plot.plot}`;
            img.alt = `Boxplot for ${plot.variable}`;
            plotsContainer.appendChild(img);
        });
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while generating the boxplots. Please try again.');
    } finally {
        hideLoadingSpinner();
        openPage('BoxPlot');
    }
};

document.getElementById('violinPlotTab').onclick = async () => {
    showLoadingSpinner();
    await loadInitialData();

    try {
        // Send data to the backend for violin plot generation
        const response = await fetch('https://loopyv2.onrender.com/violinplots', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ time_series_data: timeSeriesData }),
        });

        if (!response.ok) {
            throw new Error('Failed to fetch violin plots');
        }

        // Receive the violin plots
        const { plots } = await response.json();
        const plotsContainer = document.getElementById('violinPlots');
        plotsContainer.innerHTML = ''; // Clear any existing content

        // Display each plot
        plots.forEach((plot) => {
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${plot.plot}`;
            img.alt = `Violin Plot for ${plot.variable}`;
            plotsContainer.appendChild(img);
        });
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred while generating the violin plots. Please try again.');
    } finally {
        hideLoadingSpinner();
        openPage('ViolinPlot');
    }
};



document.getElementById('randomSeedsTab').onclick = async () => {
    showLoadingSpinner();
    await loadInitialData();

    try {
        const payload = {
            edges: edgePairs,
            edge_polarities: edgePolarities
        };

        const response = await fetch('https://loopyv2.onrender.com/random-seeds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('Failed to fetch random seeds plots');
        }

        const plotData = await response.json();
        const plotsContainer = document.getElementById('randomSeedsPlots');
        plotsContainer.innerHTML = '';

        plotData.forEach(plot => {
            const img = document.createElement('img');
            const binary = atob(plot.data); // Decode Base64 string
            const array = new Uint8Array(binary.length);

            for (let i = 0; i < binary.length; i++) {
                array[i] = binary.charCodeAt(i);
            }

            const blob = new Blob([array], { type: 'image/png' });
            img.src = URL.createObjectURL(blob);
            img.alt = plot.filename;
            plotsContainer.appendChild(img);
        });
    } catch (error) {
        console.error('Error:', error.message);
        alert('An error occurred while fetching random seeds plots. Please try again.');
    } finally {
        hideLoadingSpinner();
        openPage('RandomSeeds');
    }
};


const stripe = Stripe('pk_test_51QY9jPD0q75cxrZOtNHqMMjLwnQLLxGxtiBnLT5V1w35xfZ8cWkk2m3FU41Hv9tawj8MgDBMiFOQyFLIB3NGNcvk00XWHJ1NkO'); // Replace with your Stripe publishable key


document.addEventListener('DOMContentLoaded', () => {
    // Use MutationObserver to watch for dynamically added elements
    const observer = new MutationObserver((mutationsList, observer) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                const researcherModeButton = document.getElementById('researcherMode');
                if (researcherModeButton) {
                    // Add event listener once the button is detected
                    researcherModeButton.addEventListener('click', async () => {
                        try {
                            showLoadingSpinner();
                            console.log("Activating Researcher Mode and initializing payments...");

                            // Call your backend to create a checkout session
                            const response = await fetch('https://loopyv2.onrender.com/create-checkout-session', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ amount: 2000 }) // $20.00 in cents
                            });

                            if (!response.ok) {
                                throw new Error('Failed to create checkout session. Ensure the backend is running and accessible.');
                            }

                            const session = await response.json();

                            // Redirect to Stripe Checkout
                            const result = await stripe.redirectToCheckout({ sessionId: session.id });
                            if (result.error) {
                                console.error(result.error.message);
                                alert('Error during redirect to Stripe Checkout: ' + result.error.message);
                            }
                        } catch (error) {
                            console.error('Error:', error.message);
                            alert('An error occurred. Please try again.');
                        } finally {
                            hideLoadingSpinner();
                        }
                    });

                    // Disconnect the observer once the element is found
                    observer.disconnect();
                }
            }
        }
    });

    // Start observing the body for changes
    observer.observe(document.body, { childList: true, subtree: true });
});

