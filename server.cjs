const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Handle client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`ImagineThisPrinted app running on port ${port}`);
  console.log(`Access at: http://localhost:${port}`);
});