require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth.routes');
const proxyRoutes = require('./routes/proxy.routes');
const adminRoutes = require('./routes/admin.routes');
const authMiddleware = require('./middleware/auth');
const { initRateLimiter } = require('./middleware/rateLimiter');
const { getBreaker } = require('./middleware/circuitBreaker');
const ioHelper = require('./lib/io');

const app = express();

// Configure CORS globally
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
  exposedHeaders: ['x-circuit-state', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
  credentials: true
}));

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/api_gateway';

// Create HTTP server wrapping the Express app
const server = http.createServer(app);

// Initialize Socket.io using the HTTP server
ioHelper.init(server);

// Wire circuit breaker transition event forwarding over Socket.io
const usersBreaker = getBreaker('users');
const ordersBreaker = getBreaker('orders');

usersBreaker.on('transition', (data) => {
  ioHelper.emitEvent('breaker:transition', {
    service: data.service,
    from: data.from,
    to: data.to
  });
});

ordersBreaker.on('transition', (data) => {
  ioHelper.emitEvent('breaker:transition', {
    service: data.service,
    from: data.from,
    to: data.to
  });
});

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB successfully'))
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

// Body parsers
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const tenantInfo = req.user ? `Tenant: ${req.user.tenantId} (${req.user.tier})` : 'Anonymous';
    console.log(`[Gateway] ${req.method} ${req.originalUrl} - ${tenantInfo} - Status: ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Mount auth routes (unprotected)
app.use('/auth', authRoutes);

// Mount admin routes (unprotected - JWT exclusion is handled inside auth.js since /admin/* is excluded)
app.use('/admin', adminRoutes);

// Gateway health check (unprotected)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'api-gateway' });
});

// Apply JWT authentication middleware globally
app.use(authMiddleware);

// Mount the proxy routes under /api (requires JWT unless excluded in middleware)
app.use('/api', proxyRoutes);

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Requested path does not exist on gateway' });
});

// Initialize rate limiter Lua scripts, then start server
initRateLimiter().then(() => {
  server.listen(PORT, () => {
    console.log(`API Gateway listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize rate limiter Lua scripts:', err.message);
  process.exit(1);
});
