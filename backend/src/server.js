const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Healthcheck endpoint for Docker Compose
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'brandguard-api',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'BrandGuard Preflight API',
    version: '1.0.0',
    status: 'running'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BrandGuard API server listening on port ${PORT}`);
});
