const express = require('express');
const proxy = require('express-http-proxy');
const router = express.Router();

// Hardcoded route table mapping service prefix to target upstream URL
const routeTable = {
  users: {
    upstreamUrl: process.env.USERS_SERVICE_URL || 'http://localhost:5001'
  },
  orders: {
    upstreamUrl: process.env.ORDERS_SERVICE_URL || 'http://localhost:5002'
  }
};

console.log('Route Table Loaded:', routeTable);

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

  // Use express-http-proxy to forward request to the upstream service
  return proxy(routeConfig.upstreamUrl, {
    proxyReqPathResolver: (req) => {
      // req.url is the path after the matched service prefix (e.g., /data or /health)
      return req.url;
    },
    userResHeaderDecorator: (headers) => {
      // Can add custom headers here if needed.
      return headers;
    },
    // Handle proxy errors gracefully (e.g. if downstream service is down)
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

module.exports = router;
