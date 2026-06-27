const express = require('express');
const proxy = require('express-http-proxy');
const { rateLimiterMiddleware } = require('../middleware/rateLimiter');
const router = express.Router();

// Hardcoded route table mapping service prefix to target upstream URL with rate limit config
const routeTable = {
  users: {
    pathPrefix: 'users',
    upstreamUrl: process.env.USERS_SERVICE_URL || 'http://localhost:5001',
    rateLimit: {
      enabled: true,
      algorithm: 'token_bucket',
      free: { capacity: 5, refillRate: 0.1 }, // 5 tokens max, refills at 0.1/sec (1 token per 10s)
      pro: { capacity: 50, refillRate: 5 },
      enterprise: { capacity: 200, refillRate: 20 }
    }
  },
  orders: {
    pathPrefix: 'orders',
    upstreamUrl: process.env.ORDERS_SERVICE_URL || 'http://localhost:5002',
    rateLimit: {
      enabled: true,
      algorithm: 'sliding_window',
      free: { windowSize: 60, maxRequests: 5 }, // 5 requests max in a 60s sliding window
      pro: { windowSize: 60, maxRequests: 50 },
      enterprise: { windowSize: 60, maxRequests: 250 }
    }
  }
};

console.log('Route Table Loaded with Rate Limits:', JSON.stringify(routeTable, null, 2));

// Catch-all route to proxy requests dynamically based on the service prefix
router.use('/:service', (req, res, next) => {
  const service = req.params.service;
  const routeConfig = routeTable[service];

  if (!routeConfig) {
    return res.status(404).json({
      error: 'Not Found',
      message: `No proxy route configured for service: '${service}'`
    });
  }

  // Create rate limiter checker dynamically for this route configuration
  const limitChecker = rateLimiterMiddleware(routeConfig);

  // Run rate limiting first, then proxy if allowed
  return limitChecker(req, res, (err) => {
    if (err) return next(err);

    // Proxy the request to the upstream service
    return proxy(routeConfig.upstreamUrl, {
      proxyReqPathResolver: (req) => {
        // req.url is the path after the matched service prefix (e.g., /data or /health)
        return req.url;
      },
      userResHeaderDecorator: (headers) => {
        return headers;
      },
      proxyErrorHandler: (err, res, next) => {
        console.error(`Proxy error connecting to service '${service}' at ${routeConfig.upstreamUrl}:`, err.message);
        res.status(502).json({
          error: 'Bad Gateway',
          message: `Could not connect to service '${service}'`,
          details: err.message
        });
      }
    })(req, res, next);
  });
});

module.exports = router;
