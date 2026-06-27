require('dotenv').config();
const express = require('express');
const proxyRoutes = require('./routes/proxy.routes');

const app = express();
const PORT = process.env.PORT || 4000;

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[Gateway] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Mount the proxy routes under /api
app.use('/api', proxyRoutes);

// Health check for gateway itself
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'api-gateway' });
});

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Requested path does not exist on gateway' });
});

app.listen(PORT, () => {
  console.log(`API Gateway listening on port ${PORT}`);
});
