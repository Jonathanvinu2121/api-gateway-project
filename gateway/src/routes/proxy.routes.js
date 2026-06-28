const express = require('express');
const proxy = require('express-http-proxy');
const { rateLimiterMiddleware } = require('../middleware/rateLimiter');
const { circuitBreakerMiddleware, getBreaker } = require('../middleware/circuitBreaker');
const RequestLog = require('../models/RequestLog');
const ioHelper = require('../lib/io');
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

// Global request logging interceptor
router.use((req, res, next) => {
  const start = Date.now();

  // Initialize state-stamped variables for logging accuracy
  req.rateLimitDecision = 'allowed';

  // Parse the service path prefix to resolve the corresponding breaker state
  const pathParts = req.path.split('/'); // e.g., req.path = "/users/data" -> ['', 'users', 'data']
  const service = pathParts[1];
  if (service && routeTable[service]) {
    const breaker = getBreaker(service);
    req.breakerState = breaker ? breaker.state : 'CLOSED';
  } else {
    req.breakerState = 'CLOSED';
  }

  // Hook into response completion
  res.on('finish', async () => {
    // Only log if request resolved to one of our mapped service routes
    if (!service || !routeTable[service]) return;

    const latencyMs = Date.now() - start;
    const tenantId = req.user ? req.user.tenantId : 'anonymous';
    const route = req.originalUrl;
    const statusCode = res.statusCode;
    const rateLimitDecision = req.rateLimitDecision;
    const breakerState = req.breakerState;

    try {
      const log = new RequestLog({
        tenantId,
        route,
        statusCode,
        latencyMs,
        rateLimitDecision,
        breakerState,
        timestamp: new Date()
      });
      await log.save();

      // Emit Live WebSocket Event immediately
      ioHelper.emitEvent('request:logged', {
        tenantId,
        route,
        statusCode,
        latencyMs,
        rateLimitDecision,
        breakerState,
        timestamp: log.timestamp
      });
    } catch (err) {
      console.error('[Logging Interceptor] Error logging request to Mongo:', err.message);
    }
  });

  next();
});

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

  // Run rate limiting first
  return limitChecker(req, res, (err) => {
    if (err) return next(err);

    // Run circuit breaker second
    return circuitBreakerMiddleware(req, res, (err) => {
      if (err) return next(err);

      // Proxy the request to the upstream service if both checks pass
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
          
          // Explicitly record a failure on the service's circuit breaker
          if (req.recordBreakerFailure) {
            req.recordBreakerFailure();
          }

          res.status(502).json({
            error: 'Bad Gateway',
            message: `Could not connect to service '${service}'`,
            details: err.message
          });
        }
      })(req, res, next);
    });
  });
});

module.exports = router;
