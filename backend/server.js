const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { spawn } = require("child_process");

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// POST API Route to execute Python script
app.post("/execute-python", (req, res) => {
    const inputData = req.body; // Data sent from the frontend

    const pythonProcess = spawn("python3", ["python_script.py", JSON.stringify(inputData)]);

    let result = "";
    pythonProcess.stdout.on("data", (data) => {
        result += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
        console.error(`Python Error: ${data}`);
    });

    pythonProcess.on("close", () => {
        res.json(JSON.parse(result)); // Send the Python script's result back to the client
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});
