const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const redis = require('../lib/redis');

let tokenBucketSha = null;
let slidingWindowSha = null;

const initRateLimiter = async () => {
  try {
    const tokenBucketPath = path.join(__dirname, '../lua/tokenBucket.lua');
    const slidingWindowPath = path.join(__dirname, '../lua/slidingWindow.lua');

    const tokenBucketScript = fs.readFileSync(tokenBucketPath, 'utf8');
    const slidingWindowScript = fs.readFileSync(slidingWindowPath, 'utf8');

    tokenBucketSha = await redis.script('load', tokenBucketScript);
    slidingWindowSha = await redis.script('load', slidingWindowScript);

    console.log('Rate Limiter Lua scripts pre-loaded successfully.');
    console.log('Token Bucket SHA:', tokenBucketSha);
    console.log('Sliding Window SHA:', slidingWindowSha);
  } catch (err) {
    console.error('Failed to load Rate Limiter Lua scripts:', err.message);
    process.exit(1);
  }
};

const rateLimiterMiddleware = (routeConfig) => {
  return async (req, res, next) => {
    // Exclude healthcheck routes from rate limiting
    if (req.path === '/health' || req.path === '/health/') {
      return next();
    }

    // If rate limiting is disabled, skip
    if (!routeConfig.rateLimit || !routeConfig.rateLimit.enabled) {
      return next();
    }

    // Resolve tenant info from req.user (attached by auth middleware)
    const tenantId = req.user ? req.user.tenantId : 'anonymous';
    const tier = req.user ? req.user.tier : 'free';

    // Redis key scoped as ratelimit:{tenantId}:{routePrefix}
    const key = `ratelimit:${tenantId}:${routeConfig.pathPrefix}`;
    const algorithm = routeConfig.rateLimit.algorithm;
    const limits = routeConfig.rateLimit[tier] || routeConfig.rateLimit.free;

    const now = Date.now() / 1000; // current time in float seconds

    try {
      if (algorithm === 'token_bucket') {
        const capacity = limits.capacity || 10;
        const refillRate = limits.refillRate || 1;
        const requested = 1;
        const ttl = 60;

        // Execute EVALSHA
        const result = await redis.evalsha(tokenBucketSha, 1, key, capacity, refillRate, now, requested, ttl);
        const allowed = result[0];
        const remaining = result[1];
        const resetTime = result[2];

        // Set response headers
        res.setHeader('X-RateLimit-Limit', capacity);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, Math.floor(remaining)));
        res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime));

        if (allowed === 1) {
          return next();
        } else {
          const retryAfter = Math.max(1, Math.ceil(resetTime - now));
          res.setHeader('Retry-After', retryAfter);
          return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded (Token Bucket)',
            retryAfterSeconds: retryAfter
          });
        }

      } else if (algorithm === 'sliding_window') {
        const windowSize = limits.windowSize || 60;
        const maxRequests = limits.maxRequests || 5;
        const rand = crypto.randomBytes(4).toString('hex');
        const ttl = windowSize * 2;

        // Execute EVALSHA
        const result = await redis.evalsha(slidingWindowSha, 1, key, windowSize, maxRequests, now, rand, ttl);
        const allowed = result[0];
        const remaining = result[1];
        const resetTime = result[2];

        // Set response headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
        res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime));

        if (allowed === 1) {
          return next();
        } else {
          const retryAfter = Math.max(1, Math.ceil(resetTime - now));
          res.setHeader('Retry-After', retryAfter);
          return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded (Sliding Window)',
            retryAfterSeconds: retryAfter
          });
        }
      } else {
        console.warn(`[RateLimiter] Unknown algorithm: ${algorithm}`);
        return next();
      }
    } catch (err) {
      console.error(`Rate limiting execution error on route /api/${routeConfig.pathPrefix}:`, err.message);
      // Fall open: if redis or scripts fail, allow request but log error
      return next();
    }
  };
};

module.exports = {
  initRateLimiter,
  rateLimiterMiddleware
};
