const DB_PAGE_SIZE = 10;

// Cursor-based pagination state (unfiltered)
let dbPageCursors = [null]; // cursors[i] = startAfter doc for page i (null = beginning)
let dbCurrentPage = 0;
let dbHasNextPage = false;

// Client-side pagination state (filtered)
let dbAllRows = [];
let dbIsFiltered = false;

function makeRow(data) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${data.node1 || 'N/A'}</td>
        <td>${data.node2 || 'N/A'}</td>
        <td>${data.edgeproperties?.polarity || 'N/A'}</td>
        <td>${data.edgeproperties?.strength || 'N/A'}</td>
        <td>${data.edgeproperties?.explanation || 'N/A'}</td>
    `;
    return row;
}

function updatePaginationUI(pageNum, hasNext, knownTotal) {
    document.getElementById('dbPrevBtn').disabled = pageNum === 0;
    document.getElementById('dbNextBtn').disabled = !hasNext;
    document.getElementById('dbPageInfo').textContent = knownTotal
        ? `Page ${pageNum + 1} of ${knownTotal}`
        : `Page ${pageNum + 1}`;
}

// Render a page from client-side filtered results
function renderDbPage() {
    const tableBody = document.querySelector('#databaseTable tbody');
    const start = dbCurrentPage * DB_PAGE_SIZE;
    const pageRows = dbAllRows.slice(start, start + DB_PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(dbAllRows.length / DB_PAGE_SIZE));

    tableBody.innerHTML = '';
    if (pageRows.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5">No data matches the filter.</td></tr>`;
    } else {
        pageRows.forEach(row => tableBody.appendChild(row));
    }
    updatePaginationUI(dbCurrentPage, dbCurrentPage < totalPages - 1, totalPages);
}

// Fetch and render a single page from Firestore using cursor pagination
async function fetchAndRenderFirestorePage(pageIndex) {
    const { db, collection, query, orderBy, limit, startAfter, getDocs } = firebase;
    const ref = collection(db, "edge connections justifications");
    const cursor = dbPageCursors[pageIndex];

    const constraints = [orderBy('timestamp', 'desc'), limit(DB_PAGE_SIZE)];
    if (cursor) constraints.push(startAfter(cursor));
    const snapshot = await getDocs(query(ref, ...constraints));

    // Store cursor for the next page if we haven't been here before
    if (snapshot.docs.length === DB_PAGE_SIZE && !dbPageCursors[pageIndex + 1]) {
        dbPageCursors[pageIndex + 1] = snapshot.docs[snapshot.docs.length - 1];
    }
    dbHasNextPage = snapshot.docs.length === DB_PAGE_SIZE;

    const tableBody = document.querySelector('#databaseTable tbody');
    tableBody.innerHTML = '';
    if (snapshot.docs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5">No data found.</td></tr>`;
    } else {
        snapshot.docs.forEach(doc => tableBody.appendChild(makeRow(doc.data())));
    }

    dbCurrentPage = pageIndex;
    updatePaginationUI(pageIndex, dbHasNextPage, null);
}

const firebaseReady = new Promise(resolve => {
    if (window.firebase) {
        resolve();
    } else {
        window.addEventListener('firebase-ready', resolve, { once: true });
    }
});

// Pre-fetch database entries as soon as Firebase is ready so the tab loads instantly
firebaseReady.then(() => fetchDatabaseEntries());

let nodeConnectionsTabInitialized = false;

function initNodeConnectionsTab() {
    if (nodeConnectionsTabInitialized) return;
    nodeConnectionsTabInitialized = true;

    const generateButton = document.getElementById('generateButton');
    const saveButton = document.getElementById('saveButton');
    const clearButton = document.getElementById('clearButton');
    const resetButton = document.getElementById('resetDefaultsButton');

    // Generate Explanation
    generateButton.addEventListener('click', async () => {
        const node1 = document.getElementById('node1').value.trim();
        const node2 = document.getElementById('node2').value.trim();
        const polarity = document.getElementById('polarity').value;
        const strength = parseFloat(document.getElementById('strength').value);

        if (!validateInputs(node1, node2, strength)) return;

        const outputElement = document.getElementById('output');
        const justificationInput = document.getElementById('justification');
        outputElement.textContent = 'Generating explanation...';

        let apiKey = document.getElementById('apiKey').value.trim();
        const systemPrompt = generateSystemPrompt(node1, node2, polarity, strength);

        try {
            const explanation = await fetchExplanationFromAPI(apiKey, systemPrompt);
            justificationInput.value = explanation;
            outputElement.textContent = explanation;
            alert("Explanation generated and added to the justification field!");
        } catch (error) {
            handleError(error, outputElement);
        }
    });

    // Save Connection
    saveButton.addEventListener('click', async () => {
        const node1 = document.getElementById('node1').value.trim();
        const node2 = document.getElementById('node2').value.trim();
        const polarity = document.getElementById('polarity').value;
        const strength = parseFloat(document.getElementById('strength').value);
        const justification = document.getElementById('justification').value.trim();

        if (!validateInputs(node1, node2, strength)) return;

        try {
            await saveConnectionToFirestore(node1, node2, polarity, strength, justification);
            alert("Connection saved successfully!");
        } catch (error) {
            console.error("Error saving connection:", error.message);
            alert("Failed to save the connection.");
        }
    });

    // Clear Fields
    clearButton.addEventListener('click', clearFormFields);

    // Reset Defaults
    resetButton.addEventListener('click', resetDefaults);
}

function validateInputs(node1, node2, strength) {
    if (!node1 || !node2 || isNaN(strength) || strength < 0.1 || strength > 1.0) {
        alert("Please fill out all fields correctly.");
        return false;
    }
    return true;
}

function generateSystemPrompt(node1, node2, polarity, strength) {
    return `
You are a system that:
    a. generates brief explanations for connections between nodes in a causal loop diagram (CLD). 
    b. In this diagram, each directed link from Node 1 to Node 2 has two attributes:
        1.	Polarity, which can be positive (+) or negative (–):
        •	Positive (+) means that an increase in Node 1 leads to an increase in Node 2 (and similarly a decrease leads to a decrease).
        •	Negative (–) means that an increase in Node 1 leads to a decrease in Node 2 (and similarly a decrease leads to an increase).
        2.	Strength, which reflects how strong the polarity is (think of it as an absolute value of correlation instead of a parameter)

The user will provide:
	•	Node 1: ${node1}
	•	Node 2: ${node2}
	•	Polarity: ${polarity} (as indicated by + or –)
	•	Strength: ${strength} (as a numeric value between 0 - 1)

Your task is to: 
    1. Fill in the blanks:
	•	An increase in ${node1} leads to (prompt to engine: evaluate whether increase or decrease) in ${node2}, because (prompt to engine: give reasoning).
	2.	Check the user-provided polarity and strength and correct them if necessary. Specifically:
	•	If the polarity appears inconsistent with known causal dynamics (e.g., “ice leads to fewer accidents” when evidence suggests “ice leads to more accidents”), provide the corrected polarity.
	•	If the strength is significantly off based on available evidence, recommend a revised strength.
	3.	Explain any corrections clearly and briefly.
	4.	Generate a user prompt for perplexity pro citation search in the format: "Please input this into Perplexity Pro search [https://www.perplexity.ai/]: Give 3 high quality citations to support (system response to: An increase in ${node1} leads to (prompt to engine: evaluate whether increase or decrease) in ${node2})".

Note: Please output the response in plain text.
    `;
}

async function fetchExplanationFromAPI(apiKey, systemPrompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }],
            max_tokens: 2048
        })
    });

    const data = await response.json();
    return data.choices[0].message.content;
}

async function saveConnectionToFirestore(node1, node2, polarity, strength, justification) {
    await firebaseReady;
    const connectionData = {
        edgeproperties: { polarity, strength, explanation: justification },
        node1,
        node2,
        timestamp: new Date()
    };

    await firebase.addDoc(firebase.collection(firebase.db, "edge connections justifications"), connectionData);
}

function clearFormFields() {
    document.getElementById('node1').value = '';
    document.getElementById('node2').value = '';
    document.getElementById('polarity').value = '+';
    document.getElementById('strength').value = '';
    document.getElementById('justification').value = '';
    document.getElementById('output').textContent = 'No output yet...';
}

function resetDefaults() {
    document.getElementById('polarity').value = '+';
    document.getElementById('strength').value = 0.5;
    document.getElementById('output').textContent = 'Defaults reset. Please update other fields.';
}

function handleError(error, outputElement) {
    console.error("Error:", error.message);
    outputElement.textContent = `Error: ${error.message}`;
    alert("An error occurred. Please try again.");
}

async function fetchDatabaseEntries(filterNodes = [], filterByGraph = false) {
    await firebaseReady;

    const isFiltered = filterNodes.length > 0 || filterByGraph;
    dbIsFiltered = isFiltered;

    if (!isFiltered) {
        // Real Firestore cursor pagination — only fetch one page at a time
        dbPageCursors = [null];
        dbCurrentPage = 0;
        try {
            await fetchAndRenderFirestorePage(0);
        } catch (error) {
            console.error('Error fetching data:', error.message);
            alert('Failed to fetch data from Firestore.');
        }
        return;
    }

    // Filtered: fetch all docs and filter client-side
    const currentNodes = new Set();
    if (filterByGraph) {
        window.loopy.model.edges.forEach(edge => {
            currentNodes.add(edge.from.label || "Unnamed Node");
            currentNodes.add(edge.to.label || "Unnamed Node");
        });
    }

    try {
        const querySnapshot = await firebase.getDocs(firebase.collection(firebase.db, "edge connections justifications"));
        dbAllRows = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (filterByGraph && !currentNodes.has(data.node1) && !currentNodes.has(data.node2)) return;
            if (filterNodes.length > 0) {
                const node1Match = filterNodes.some(node => node.toLowerCase() === data.node1.toLowerCase());
                const node2Match = filterNodes.some(node => node.toLowerCase() === data.node2.toLowerCase());
                if (!node1Match && !node2Match) return;
            }
            dbAllRows.push(makeRow(data));
        });
        dbCurrentPage = 0;
        renderDbPage();
    } catch (error) {
        console.error('Error fetching data:', error.message);
        alert('Failed to fetch data from Firestore.');
    }
}

async function fetchMatchingNodes(filterNodes = []) {
    await firebaseReady;

    if (filterNodes.length < 2) {
        alert('Please provide at least two nodes to filter.');
        return;
    }

    const [firstNode, secondNode] = filterNodes.map(node => node.trim().toLowerCase());

    try {
        const querySnapshot = await firebase.getDocs(firebase.collection(firebase.db, "edge connections justifications"));

        dbAllRows = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const isMatch = data.node1.toLowerCase() === firstNode && data.node2.toLowerCase() === secondNode;
            if (!isMatch) return;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${data.node1 || 'N/A'}</td>
                <td>${data.node2 || 'N/A'}</td>
                <td>${data.edgeproperties?.polarity || 'N/A'}</td>
                <td>${data.edgeproperties?.strength || 'N/A'}</td>
                <td>${data.edgeproperties?.explanation || 'N/A'}</td>
            `;
            dbAllRows.push(row);
        });

        dbCurrentPage = 0;
        renderDbPage();
    } catch (error) {
        console.error('Error fetching data:', error.message);
        alert('Failed to fetch data from Firestore.');
    }
}

async function loadGraphEdgesToTable() {
    await firebaseReady;
    const tableSection = document.getElementById("graphTable");
    const tableHeaderSection = document.getElementById("graphTableHeader");
    const tableBody = document.querySelector("#graphTable tbody");
    tableBody.innerHTML = ''; // Clear previous rows

    const currentNodes = new Set();
    const graphEdges = [];

    // Collect graph edges
    window.loopy.model.edges.forEach(edge => {
        const node1 = edge.from.label || "Unnamed Node";
        const node2 = edge.to.label || "Unnamed Node";
        const polarity = edge.strength > 0 ? "+" : "-";
        const strength = Math.abs(edge.strength);

        graphEdges.push({ node1, node2, polarity, strength });
        currentNodes.add(node1);
        currentNodes.add(node2);
    });

    // Fetch existing database connections
    const existingConnections = new Set();
    const querySnapshot = await firebase.getDocs(firebase.collection(firebase.db, "edge connections justifications"));
    querySnapshot.forEach(doc => {
        const data = doc.data();
        existingConnections.add(`${data.node1}-${data.node2}`);
    });

    // Filter edges not in the database
    const edgesToAdd = graphEdges.filter(edge => {
        const edgeKey = `${edge.node1}-${edge.node2}`;
        return !existingConnections.has(edgeKey);
    });

    if (edgesToAdd.length === 0) {
        tableSection.style.display = "none";
        tableHeaderSection.style.display = "none";
        return;
    } else {
        tableSection.style.display = "table";
        tableHeaderSection.style.display = "table-header-group"; // Correct display for table header
    }

    // Populate table with filtered edges
    edgesToAdd.forEach(edge => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${edge.node1}</td>
            <td>${edge.node2}</td>
            <td>${edge.polarity}</td>
            <td>${edge.strength}</td>
            <td><button class="fillButton">Autofill</button></td>
        `;
        row.querySelector('.fillButton').addEventListener('click', () => {
            autofillForm(edge);
        });
        tableBody.appendChild(row);
    });
}

function autofillForm(edge) {
    document.getElementById('node1').value = edge.node1;
    document.getElementById('node2').value = edge.node2;
    document.getElementById('polarity').value = edge.polarity;
    document.getElementById('strength').value = edge.strength;
}

// Initialize event listeners once and attach UI refresh separately
document.addEventListener('DOMContentLoaded', () => {
    initNodeConnectionsTab();

    // Every time the node connections tab is clicked, refresh the table data
    document.getElementById('nodeConnectionsTab').addEventListener('click', loadGraphEdgesToTable);

    // Database-related event listeners
    document.getElementById('refreshDatabaseButton').addEventListener('click', () => fetchDatabaseEntries());
    document.getElementById('viewDatabaseTab').addEventListener('click', () => fetchDatabaseEntries());

    // Filter button functionality
    document.getElementById('filterDatabaseButton').addEventListener('click', () => {
        const filterInput = document.getElementById('nodeFilter').value.trim();
        const filterNodes = filterInput
            .split(',')
            .map(node => node.trim())
            .filter(node => node.length > 0);
        fetchDatabaseEntries(filterNodes);
    });
    
    document.getElementById('filterGraphButton').addEventListener('click', () => {
        fetchDatabaseEntries([], true);
    });

    document.getElementById('dbPrevBtn').addEventListener('click', async () => {
        if (dbCurrentPage === 0) return;
        if (dbIsFiltered) {
            dbCurrentPage--;
            renderDbPage();
        } else {
            await fetchAndRenderFirestorePage(dbCurrentPage - 1);
        }
    });
    document.getElementById('dbNextBtn').addEventListener('click', async () => {
        if (dbIsFiltered) {
            if (dbCurrentPage < Math.ceil(dbAllRows.length / DB_PAGE_SIZE) - 1) {
                dbCurrentPage++;
                renderDbPage();
            }
        } else {
            if (dbHasNextPage) await fetchAndRenderFirestorePage(dbCurrentPage + 1);
        }
    });
});
