const express = require('express');
const RequestLog = require('../models/RequestLog');
const { getBreaker } = require('../middleware/circuitBreaker');
const router = express.Router();

const upstreamUrls = {
  users: process.env.USERS_SERVICE_URL || 'http://localhost:5001',
  orders: process.env.ORDERS_SERVICE_URL || 'http://localhost:5002'
};

// GET /admin/metrics
router.get('/metrics', async (req, res) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Queries to calculate metrics in the last 5 minutes
    const totalRequests = await RequestLog.countDocuments({ timestamp: { $gte: fiveMinutesAgo } });
    const allowed = await RequestLog.countDocuments({ timestamp: { $gte: fiveMinutesAgo }, rateLimitDecision: 'allowed' });
    const blocked = await RequestLog.countDocuments({ timestamp: { $gte: fiveMinutesAgo }, rateLimitDecision: 'blocked' });

    // Retrieve breaker states
    const usersBreaker = getBreaker('users');
    const ordersBreaker = getBreaker('orders');

    const breakerStates = {
      users: usersBreaker ? usersBreaker.state : 'CLOSED',
      orders: ordersBreaker ? ordersBreaker.state : 'CLOSED'
    };

    return res.status(200).json({
      metrics: {
        timeWindowMinutes: 5,
        totalRequests,
        allowed,
        blocked
      },
      breakerStates
    });
  } catch (err) {
    console.error('[AdminRoutes] Error calculating metrics:', err.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to calculate system metrics',
      details: err.message
    });
  }
});

// POST /admin/configure/:service
router.post('/configure/:service', express.json(), async (req, res) => {
  const apiKey = req.headers['x-admin-key'];
  const expectedKey = process.env.ADMIN_API_KEY || 'admin_demo_secret_key';

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing admin key' });
  }

  const { service } = req.params;
  const { failureRate } = req.body;

  const upstreamUrl = upstreamUrls[service];
  if (!upstreamUrl) {
    return res.status(404).json({ error: 'Not Found', message: `Unknown service: ${service}` });
  }

  if (typeof failureRate !== 'number' || failureRate < 0 || failureRate > 1) {
    return res.status(400).json({ error: 'Bad Request', message: 'failureRate must be a number between 0 and 1' });
  }

  try {
    const response = await fetch(`${upstreamUrl}/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': apiKey
      },
      body: JSON.stringify({ failureRate })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Upstream Error', message: errText });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error(`[AdminRoutes] Failed to configure upstream service ${service}:`, err.message);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
