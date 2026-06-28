const express = require('express');
const RequestLog = require('../models/RequestLog');
const { getBreaker } = require('../middleware/circuitBreaker');
const router = express.Router();

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

module.exports = router;
