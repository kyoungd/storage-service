const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

const BUCKET_NAME = process.env.BUCKET_NAME;
const SEND_KEY = process.env.SEND_KEY || 'test-send';
const VIEW_KEY = process.env.VIEW_KEY || 'test-view';
const FILE_NAME = 'data.json';
const LOCAL_FILE = path.join(__dirname, FILE_NAME);

// Use GCS in production, local file for testing
const useLocal = !BUCKET_NAME;
let storage, file;

if (!useLocal) {
  const { Storage } = require('@google-cloud/storage');
  storage = new Storage();
  file = storage.bucket(BUCKET_NAME).file(FILE_NAME);
}

async function loadData() {
  try {
    if (useLocal) {
      const contents = await fs.readFile(LOCAL_FILE, 'utf8');
      return JSON.parse(contents);
    } else {
      const [contents] = await file.download();
      return JSON.parse(contents.toString());
    }
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 404) return [];
    throw err;
  }
}

async function saveData(data) {
  if (useLocal) {
    await fs.writeFile(LOCAL_FILE, JSON.stringify(data, null, 2));
  } else {
    await file.save(JSON.stringify(data, null, 2), {
      contentType: 'application/json',
    });
  }
}

// POST /data - append new data (requires SEND_KEY)
app.post('/data', async (req, res) => {
  const key = req.headers['x-send-key'];
  if (key !== SEND_KEY) {
    return res.status(401).json({ error: 'Invalid send key' });
  }

  try {
    const existing = await loadData();
    existing.push({
      timestamp: new Date().toISOString(),
      payload: req.body,
    });
    await saveData(existing);
    res.json({ success: true, count: existing.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data - return all data as JSON (requires VIEW_KEY)
app.get('/data', async (req, res) => {
  const key = req.headers['x-view-key'];
  if (key !== VIEW_KEY) {
    return res.status(401).json({ error: 'Invalid view key' });
  }

  try {
    const data = await loadData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /view - HTML page to view data
app.get('/view', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>View Data</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    input { padding: 8px; font-size: 16px; width: 300px; }
    button { padding: 8px 16px; font-size: 16px; cursor: pointer; }
    pre { background: #f4f4f4; padding: 20px; overflow: auto; border-radius: 4px; }
    .error { color: red; }
  </style>
</head>
<body>
  <h1>View Stored Data</h1>
  <div>
    <input type="password" id="key" placeholder="Enter view key" />
    <button onclick="fetchData()">Load Data</button>
  </div>
  <div id="result"></div>
  <script>
    async function fetchData() {
      const key = document.getElementById('key').value.trim();
      const result = document.getElementById('result');
      try {
        const res = await fetch('/data', { headers: { 'x-view-key': key } });
        const data = await res.json();
        if (res.ok) {
          result.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
        } else {
          result.innerHTML = '<p class="error">' + data.error + '</p>';
        }
      } catch (err) {
        result.innerHTML = '<p class="error">' + err.message + '</p>';
      }
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
