const express = require('express');
const app = express();

const PORT = process.env.PORT || 5002;

// Helper to get random latency
const getLatencyDelay = () => {
  const min = parseInt(process.env.LATENCY_MIN || '50', 10);
  const max = parseInt(process.env.LATENCY_MAX || '2000', 10);
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Helper to check if request should fail
const shouldFail = () => {
  const failureRate = parseFloat(process.env.FAILURE_RATE || '0');
  return Math.random() < failureRate;
};

// Healthcheck endpoint (no latency/failure)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'orders-service' });
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
