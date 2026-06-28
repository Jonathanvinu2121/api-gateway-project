const express = require('express');
const app = express();

const PORT = process.env.PORT || 5002;

let failureRateOverride = null;

// Helper to get random latency
const getLatencyDelay = () => {
  const min = parseInt(process.env.LATENCY_MIN || '50', 10);
  const max = parseInt(process.env.LATENCY_MAX || '2000', 10);
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Helper to check if request should fail
const shouldFail = () => {
  const failureRate = failureRateOverride !== null ? failureRateOverride : parseFloat(process.env.FAILURE_RATE || '0');
  return Math.random() < failureRate;
};

// Healthcheck endpoint (no latency/failure)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'orders-service' });
});

// Configure endpoint to update failure rate at runtime with key validation
app.post('/configure', express.json(), (req, res) => {
  const apiKey = req.headers['x-admin-key'];
  const expectedKey = process.env.ADMIN_API_KEY || 'admin_demo_secret_key';

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing admin key' });
  }

  const { failureRate } = req.body;
  if (typeof failureRate !== 'number' || failureRate < 0 || failureRate > 1) {
    return res.status(400).json({ error: 'Bad Request', message: 'failureRate must be a number between 0 and 1' });
  }

  failureRateOverride = failureRate;
  console.log(`[orders-service] Failure rate override updated to: ${failureRate}`);
  return res.status(200).json({ success: true, failureRate: failureRateOverride });
});

// Data endpoint (with random latency and failure injection)
app.get('/data', (req, res) => {
  if (shouldFail()) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Mock service failure injected',
      service: 'orders-service'
    });
  }

  const delay = getLatencyDelay();
  setTimeout(() => {
    res.status(200).json({
      service: 'orders-service',
      timestamp: new Date().toISOString(),
      latencyInjectedMs: delay,
      orders: [
        { id: 101, item: 'Laptop', amount: 1200, status: 'Shipped' },
        { id: 102, item: 'Phone', amount: 800, status: 'Pending' },
        { id: 103, item: 'Headphones', amount: 150, status: 'Delivered' }
      ]
    });
  }, delay);
});

app.listen(PORT, () => {
  console.log(`orders-service running on port ${PORT}`);
});
