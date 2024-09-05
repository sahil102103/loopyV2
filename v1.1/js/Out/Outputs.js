// const { CanvasRenderService } = require('chartjs-node-canvas');

var chart;
var chartSmooth;
var smoothWindowValue = 7;

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
            return;
    }
}

var timeSeriesNodeData = [];


function drawTimeSeriesChart() {
    timeSeriesNodeData = [];
    if (selectedNodes.length == 0) {
        loopy.model.nodes.forEach(node => {
            timeSeriesNodeData.push({
            label: node.label,
            data: [],
            borderColor: `${convertNumToColor(node.hue)[1]}`,
            backgroundColor: `${convertNumToColor(node.hue)[1]}`,
            borderWidth: 1,
            fill: false
            })
        })
    } else {
        selectedNodes.forEach(node => {
            timeSeriesNodeData.push({
            label: node.label,
            data: [],
            borderColor: `${convertNumToColor(node.hue)[0]}`,
            backgroundColor: `${convertNumToColor(node.hue)[1]}`,
            borderWidth: 1,
            fill: false
            })
        })
    }

    

    const ctx = document.getElementById('timeSeriesChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['0'],
            datasets: timeSeriesNodeData
        },
        options: {
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
}

function smoothData(data, windowSize) {
    const smoothed = [];
    for (let i = 0; i < data.length; i++) {
        const windowStart = Math.max(0, i - Math.floor(windowSize / 2));
        const windowEnd = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
        const windowData = data.slice(windowStart, windowEnd);
        const windowAverage = windowData.reduce((sum, value) => sum + value, 0) / windowData.length;
        smoothed.push(windowAverage);
    }
    return smoothed;
}

document.getElementById('smoothWindowForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent the form from submitting normally
    smoothWindowValue = parseInt(document.getElementById('smoothwindow').value);
    
    if (isNaN(smoothWindowValue) || smoothWindowValue <= 0) {
        alert('Please enter a valid positive number for the smoothing window.');
        return;
    }

    chartSmooth.destroy()

    drawSmoothedTimeSeriesChart()
});

function drawSmoothedTimeSeriesChart() {
    const smoothedData = timeSeriesNodeData.map(dataset => {
        if (dataset.data.length === 0) {
            console.warn(`Dataset ${dataset.label} has no data to smooth.`);
            return null;
        }
        
        return {
            label: `${dataset.label} (Smoothed)`,
            data: smoothData(dataset.data, smoothWindowValue), // Use the input window size
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




// var _listenerReset = subscribe("model/reset", function(){
//     if (chart){
//         chart.destroy();
//     }
//     drawTimeSeriesChart();
// });

// document.getElementById('saveButton').addEventListener('click', function () {
//     // Get the canvas element
//     const canvas = document.getElementById('myChart');
//     // Convert the canvas to a data URL
//     const dataURL = canvas.toDataURL('image/png');
//     // Create a temporary link element
//     const link = document.createElement('a');
//     link.href = dataURL;
//     link.download = 'chart.png'; // The name of the downloaded file
//     // Trigger the download by simulating a click
//     link.click();
// });

// Function to execute when the button is clicked
// function handleClick() {

// }

// Function to execute when the button is clicked
// function handleClick() {
//     chart.destroy()
//     drawTimeSeriesChart();
// }

// // Get the button element and add an event listener
// const button = document.getElementById('rebuildTimeSeriesChartButton');
// console.log(chart.toBase64Image())
// button.href = chart.toBase64Image();
// button.download = 'my_file_name.png';

// // Trigger the download
// button.click();


function openPage(pageName) {
    let tabcontent = document.getElementsByClassName('tabcontent');
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = 'none';
    }

    let tablinks = document.getElementsByClassName('tablink');
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].style.backgroundColor = '';
    }

    document.getElementById(pageName).style.display = 'block';
    document.querySelector(`[onclick="openPage('${pageName}')"]`).style.backgroundColor = '#ccc';

    document.getElementById('destoryTimeSeriesChart')

    if (pageName === 'TimeSeries') {
        if (!chart) {
            drawTimeSeriesChart()
        }
        chart.update()
    }

    if (pageName === 'TimeSeriesSmooth') {
        if (!chartSmooth) {
            drawSmoothedTimeSeriesChart();
        } else {
            // Re-smooth the data before updating the chart
            const smoothedData = timeSeriesNodeData.map(dataset => {
                return {
                    label: `${dataset.label} (Smoothed)`,
                    data: smoothData(dataset.data, smoothWindowValue), // Use the same window size used initially
                    borderColor: dataset.borderColor,
                    backgroundColor: dataset.backgroundColor,
                    borderWidth: 1,
                    fill: false
                };
            });

            chartSmooth.data.datasets = smoothedData; // Update the datasets with new smoothed data
            chartSmooth.destroy()
            drawSmoothedTimeSeriesChart()
        }
    }

}

function updateTimeSeriesChart(currentAmount, iter) {
    chart.data.datasets[iter].data.push(currentAmount);

}


function captureNodeData() {
    let csvContent = "data:text/csv;charset=utf-8,";

    // Add the headers for the CSV
    csvContent += "Node Label,Node Value\n";

    // Iterate over the node data and create CSV rows
    timeSeriesNodeData.forEach(dataset => {
        const label = dataset.label;
        const values = dataset.data.join(","); // Join values with commas

        // Add each node's data as a new row
        csvContent += `${label},${values}\n`;
    });

    return csvContent;
}

function downloadCSV() {
    const csvContent = captureNodeData();

    // Create a temporary link element
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);

    // Set the file name for the download
    link.download = "node_data.csv";

    // Trigger the download by simulating a click
    document.body.appendChild(link);
    link.click();

    // Clean up by removing the link after the download
    document.body.removeChild(link);
}

// Add an event listener to a button for downloading the CSV
document.getElementById("downloadCSVButton").addEventListener("click", downloadCSV);
