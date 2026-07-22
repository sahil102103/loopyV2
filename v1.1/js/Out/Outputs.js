// Global settings
const autoColorEnabled = true; // If true, node colors are set automatically using convertNumToColor
const undoStack = []; // Simple undo stack (Work in progress)

// Convert numeric hue to a color pair [name, hex]
function convertNumToColor(color) {
    switch (color) {
        case 0:
            return ["Crimson", "#e71d43"];
        case 1:
            return ["Red", "#ff0000"];
        case 2:
            return ["Red-Orange", "#ff3700"];
        case 3:
            return ["Orange", "#ff6e00"];
        case 4:
            return ["Light Orange", "#ffa500"];
        case 5:
            return ["Light Yellow-Orange", "#ffc300"];
        case 6:
            return ["Yellow-Orange", "#ffe100"];
        case 7:
            return ["Yellow", "#ffff00"];
        case 8:
            return ["Light Green", "#aad500"];
        case 9:
            return ["Green", "#55aa00"];
        case 10:
            return ["Dark Green", "#008000"];
        case 11:
            return ["Teal", "#005555"];
        case 12:
            return ["Blue", "#002baa"];
        case 13:
            return ["Bright Blue", "#0000ff"];
        case 14:
            return ["Indigo", "#1900d5"];
        case 15:
            return ["Dark Indigo", "#3200ac"];
        case 16:
            return ["Dark Violet", "#4b0082"];
        case 17:
            return ["Violet", "#812ba6"];
        case 18:
            return ["Light Violet", "#b857ca"];
        case 19:
            return ["Magenta", "#d03a87"];
        default:
            return ["Default", "#000000"];
    }
}

var chart;
var chartSmooth;
var smoothWindowValue = 7;
var timeSeriesNodeData = [];
var fullNodeData = []; // Store the full data separately

// Function to save state for undo (Work in progress)
function pushUndoState() {
    // For demonstration, we push a deep copy of current fullNodeData.
    // A more complete implementation would capture all relevant model state.
    undoStack.push(JSON.parse(JSON.stringify(fullNodeData)));
}

// Stub undo function (work in progress)
function undoAction() {
    if (undoStack.length === 0) {
        console.log("Nothing to undo.");
        return;
    }
    const prevState = undoStack.pop();
    // Restore previous state (here we simply replace fullNodeData and redraw the chart)
    fullNodeData = prevState;
    // Also update timeSeriesNodeData based on restored fullNodeData:
    timeSeriesNodeData.forEach((dataset, index) => {
        dataset.data = fullNodeData[index].data.slice();
    });
    chart.update();
    console.log("Undo performed (Work in progress).");
}

// Attach undo action to a button if it exists
document.getElementById('undoButton')?.addEventListener('click', undoAction);

function drawTimeSeriesChart() {
    timeSeriesNodeData = [];
    fullNodeData = []; // Initialize full data storage

    // Use either selected nodes or all nodes from the model
    const nodes = loopy.multipleselect.getSelectedNodes().length === 0 
        ? loopy.model.nodes 
        : loopy.multipleselect.getSelectedNodes();

    nodes.forEach(node => {
        // Ensure initial value is within floor and ceiling limits
        let initialValue = node.value;
        if (node.ceiling !== undefined && initialValue > node.ceiling) {
            initialValue = node.ceiling;
        }
        // Create node data, using automatic color if enabled
        const colorPair = autoColorEnabled ? convertNumToColor(node.hue) : [node.manualColorName, node.manualColorHex];
        const nodeData = {
            label: node.label,
            data: [initialValue],
            borderColor: colorPair[1],
            backgroundColor: colorPair[1],
            borderWidth: 5,
            fill: false
        };
        timeSeriesNodeData.push(nodeData);
        fullNodeData.push({ ...nodeData });
    });

    const canvas = document.getElementById('timeSeriesChart');
    // Limit the chart size via inline styling
    // canvas.style.width = "600px";
    // canvas.style.height = "400px";
    
    const ctx = canvas.getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({ length: timeSeriesNodeData[0].data.length }, (_, i) => i.toString()),
            datasets: timeSeriesNodeData
        },
        options: {
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Current Node Value'
                    },
                    beginAtZero: true
                }
            }
        }
    });

    addForwardBackwardDataSlider();
}

function addForwardBackwardDataSlider() {
    if (!document.getElementById('sliderContainer')) {
        // Create slider container with fixed positioning at bottom
        const sliderContainer = document.createElement('div');
        sliderContainer.id = 'sliderContainer';
        sliderContainer.style.display = 'flex';
        sliderContainer.style.alignItems = 'center';
        sliderContainer.style.gap = '20px';
        sliderContainer.style.width = '100%';
        sliderContainer.style.padding = '8px 20px';
        sliderContainer.style.boxSizing = 'border-box';
        sliderContainer.style.position = 'fixed';
        sliderContainer.style.bottom = '0';
        sliderContainer.style.left = '0';
        sliderContainer.style.backgroundColor = '#fff';
        sliderContainer.style.borderTop = '1px solid #ddd';
        sliderContainer.style.zIndex = '1000';

        // Backward slider container (Trim Start)
        const backwardContainer = document.createElement('div');
        backwardContainer.innerHTML = `
            <label for="backwardDataSlider">Trim Start</label>
            <input type="range" id="backwardDataSlider" min="0" max="100" value="0" style="width: 100%; height: 8px;">
        `;

        // Forward slider container (Trim End)
        const forwardContainer = document.createElement('div');
        forwardContainer.innerHTML = `
            <label for="forwardDataSlider">Trim End</label>
            <input type="range" id="forwardDataSlider" min="0" max="100" value="100" style="width: 100%; height: 8px;">
        `;

        // Append the sliders to the container
        sliderContainer.appendChild(backwardContainer);
        sliderContainer.appendChild(forwardContainer);
        document.getElementById('TimeSeries').appendChild(sliderContainer);

        // Add event listeners for slider input
        document.getElementById('backwardDataSlider').addEventListener('input', function (event) {
            updateChartBackwardData(parseInt(event.target.value));
        });

        document.getElementById('forwardDataSlider').addEventListener('input', function (event) {
            updateChartForwardData(parseInt(event.target.value));
        });
    }
}

function updateSmoothChartFromTrim(startIndex, endIndex) {
    if (!chartSmooth) return;
    chartSmooth.data.labels = Array.from({ length: endIndex - startIndex }, (_, i) => i + startIndex);
    chartSmooth.data.datasets = timeSeriesNodeData.map((dataset, index) => ({
        label: `${dataset.label} (Smoothed)`,
        data: smoothData(fullNodeData[index].data.slice(startIndex, endIndex), smoothWindowValue),
        borderColor: dataset.borderColor,
        backgroundColor: dataset.backgroundColor,
        borderWidth: 1,
        fill: false
    }));
    chartSmooth.update();
}

function updateChartForwardData(percentage) {
    const backwardValue = parseInt(document.getElementById('backwardDataSlider').value);
    if (percentage <= backwardValue) return; // Prevent overlap

    const startIndex = Math.ceil(fullNodeData[0].data.length * (backwardValue / 100));
    const endIndex = Math.ceil(fullNodeData[0].data.length * (percentage / 100));

    chart.data.labels = Array.from({ length: endIndex - startIndex }, (_, i) => i + startIndex);
    chart.data.datasets.forEach((dataset, index) => {
        dataset.data = fullNodeData[index].data.slice(startIndex, endIndex);
    });
    chart.update();
    updateSmoothChartFromTrim(startIndex, endIndex);
}

function updateChartBackwardData(percentage) {
    const forwardValue = parseInt(document.getElementById('forwardDataSlider').value);
    if (percentage >= forwardValue) return; // Prevent overlap

    const startIndex = Math.ceil(fullNodeData[0].data.length * (percentage / 100));
    const endIndex = Math.ceil(fullNodeData[0].data.length * (forwardValue / 100));

    chart.data.labels = Array.from({ length: endIndex - startIndex }, (_, i) => i + startIndex);
    chart.data.datasets.forEach((dataset, index) => {
        dataset.data = fullNodeData[index].data.slice(startIndex, endIndex);
    });
    chart.update();
    updateSmoothChartFromTrim(startIndex, endIndex);
}

function toggleSmoothView() {
    const content = document.getElementById('smoothContent');
    const chevron = document.getElementById('smoothChevron');
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? '' : 'none';
    chevron.style.transform = isHidden ? '' : 'rotate(-90deg)';
}

function smoothData(data, windowSize) {
    return data.map((_, i) => {
        const windowStart = Math.max(0, i - Math.floor(windowSize / 2));
        const windowEnd = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
        const windowData = data.slice(windowStart, windowEnd);
        return windowData.reduce((sum, value) => sum + value, 0) / windowData.length;
    });
}

document.getElementById('smoothWindowForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent form submission
    smoothWindowValue = parseInt(document.getElementById('smoothwindow').value);
    
    if (isNaN(smoothWindowValue) || smoothWindowValue <= 0) {
        alert('Please enter a valid positive number for the smoothing window.');
        return;
    }

    chartSmooth?.destroy();
    drawSmoothedTimeSeriesChart();
});

function drawSmoothedTimeSeriesChart() {
    const smoothedData = timeSeriesNodeData.map(dataset => {
        if (dataset.data.length === 0) {
            console.warn(`Dataset ${dataset.label} has no data to smooth.`);
            return null;
        }
        return {
            label: `${dataset.label} (Smoothed)`,
            data: smoothData(dataset.data, smoothWindowValue),
            borderColor: dataset.borderColor,
            backgroundColor: dataset.backgroundColor,
            borderWidth: 1,
            fill: false
        };
    }).filter(dataset => dataset !== null);

    if (smoothedData.length === 0) {
        console.warn("No valid data to display in the smoothed chart.");
        return;
    }

    const ctxSmooth = document.getElementById('timeSeriesChartSmooth').getContext('2d');
    chartSmooth = new Chart(ctxSmooth, {
        type: 'line',
        data: {
            labels: chart.data.labels,
            datasets: smoothedData
        },
        options: {
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Smoothed Node Value'
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

function openPage(pageName) {
    let tabcontent = document.getElementsByClassName('tabcontent');
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = 'none';
    }

    let tablinks = document.getElementsByClassName('tablink');
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove('active');
        tablinks[i].style.backgroundColor = '';
    }

    var dropdowns = document.querySelectorAll('.tab-dropdown');
    for (var i = 0; i < dropdowns.length; i++) {
        dropdowns[i].classList.remove('active');
    }

    document.getElementById(pageName).style.display = 'block';

    var trigger = document.querySelector('[data-page="' + pageName + '"]');
    if (!trigger) {
        trigger = document.querySelector('[onclick="openPage(\'' + pageName + '\')"]');
    }
    if (trigger) {
        trigger.classList.add('active');
        var parentDropdown = trigger.closest('.tab-dropdown');
        if (parentDropdown) {
            parentDropdown.classList.add('active');
        }
        // Close focus-opened dropdowns after selection so they do not cover
        // controls on the destination page.
        if (typeof trigger.blur === 'function') trigger.blur();
    }

    if (pageName === 'Canvas') {
        window.dispatchEvent(new Event('resize'));
    }

    if (pageName === 'Tables') {
        if (window.tablesView) window.tablesView.render();
    }

    if (pageName === 'StructuralEdits') {
        if (window.structuralEditor) window.structuralEditor.render();
    }

    if (pageName === 'TeamSessions') {
        if (window.teamWorkspace) window.teamWorkspace.render();
    }

    if (pageName === 'AdminPanel') {
        if (window.adminPanel) window.adminPanel.renderPanel();
    }

    if (pageName === 'LegacyTimeSeries') {
        if (!chart) {
            drawTimeSeriesChart();
        }
        chart.update();
        if (!chartSmooth) {
            drawSmoothedTimeSeriesChart();
        } else {
            const smoothedData = timeSeriesNodeData.map(dataset => {
                return {
                    label: `${dataset.label} (Smoothed)`,
                    data: smoothData(dataset.data, smoothWindowValue),
                    borderColor: dataset.borderColor,
                    backgroundColor: dataset.backgroundColor,
                    borderWidth: 1,
                    fill: false
                };
            });
            chartSmooth.data.datasets = smoothedData;
            chartSmooth.destroy();
            drawSmoothedTimeSeriesChart();
        }
    }

}

// CLD behavior analysis moved to dedicated CLD Analysis tab

function updateTimeSeriesChart(currentAmount, iter) {
    // Before updating, push current state for undo
    pushUndoState();
    chart.data.datasets[iter].data.push(currentAmount);
}
