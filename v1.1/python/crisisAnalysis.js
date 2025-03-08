// function showLoadingSpinner() {
//     document.getElementById('loading-spinner').style.display = 'block';
// }

// // Function to hide the loading spinner
// function hideLoadingSpinner() {
//     document.getElementById('loading-spinner').style.display = 'none';
// }

// // We will use these dataset arrays along with time series data from other files
// let edgePairs = [];
// let edgePolarities = [];
// let edgeWeights = [];
// let edgeDelays = [];
// let edgeCertainties = [];
// let duplicateLabels = [];
// let variables = [];
// let timeSeriesData = {}


// const delay = ms => new Promise(res => setTimeout(res, ms));

// const delayNodeAdding = async (from, to, label) => {
//     await delay(2);
//     const index = edgePairs.findIndex(pair => pair[0] === from.label && pair[1] === to.label);
//     if (index !== -1 && edgePolarities[index] !== label) {
//         edgePolarities[index] = label;
//     }
// };

// let edgeNodesPairs = [];

// const addEdgeNodePair = (from, to) => {
//     const edgeNodePair = [[from.id, from.label], [to.id, to.label]];
//     edgeNodesPairs.push(edgeNodePair);
// };

// const findDuplicateLabels = () => {
//     const labelMap = new Map();
//     edgeNodesPairs.forEach(pair => {
//         pair.forEach(node => {
//             const [id, label] = node;
//             if (labelMap.has(label)) {
//                 const existingIds = labelMap.get(label);
//                 if (!existingIds.includes(id)) {
//                     duplicateLabels.push(label);
//                     existingIds.push(id);
//                 }
//             } else {
//                 labelMap.set(label, [id]);
//             }
//         });
//     });
// };

// const loadInitialData = async () => {
//     variables = [];

// 	timeSeriesData = chart.data.datasets.reduce((acc, dataset) => {
// 		acc[dataset.label] = [...dataset.data];
// 		return acc
// 	}, {})

//     // Filter nodes and edges based on whether selectedNodes is populated
//     const nodesToInclude = loopy.multipleselect.getSelectedNodes().length > 0 ? 
//         loopy.model.nodes.filter(node => loopy.multipleselect.getSelectedNodes().includes(node.label)) : 
//         loopy.model.nodes;

//     const edgesToInclude = loopy.multipleselect.getSelectedNodes().length > 0 ? 
//         loopy.model.edges.filter(edge => 
//             loopy.multipleselect.getSelectedNodes().includes(edge.from.label) && loopy.multipleselect.getSelectedNodes().includes(edge.to.label)
//         ) : 
//         loopy.model.edges;

//     nodesToInclude.forEach(node => {
//         variables.push(node.label);
//     });

//     edgesToInclude.forEach(edge => {
//         const node1 = edge.from;
//         const node2 = edge.to;

//         // Add the nodes connected by this edge to the edgeNodesPairs array, along with all of the attributes
//         addEdgeNodePair(node1, node2);
// 		edgeWeights.push(edge.damper);
// 		edgeDelays.push(edge.lag);
// 		edgeCertainties.push(edge.confidence);


//         // Perform the 'something' logic for each edge
//         delayNodeAdding(node1, node2, edge.label);

//         // Check for duplicate edge pairs
//         const edgePair = [node1.label, node2.label];
//         if (!edgePairs.some(pair => pair[0] === edgePair[0] && pair[1] === edgePair[1])) {
//             edgePairs.push(edgePair);
//             edgePolarities.push(edge.label);
//         }
//     });

//     // Find and log duplicate labels
//     findDuplicateLabels();
	
// };


