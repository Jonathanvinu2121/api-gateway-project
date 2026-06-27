require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth.routes');
const proxyRoutes = require('./routes/proxy.routes');
const authMiddleware = require('./middleware/auth');
const { initRateLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/api_gateway';

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

// Initialize rate limiter Lua scripts, then start Express server
initRateLimiter().then(() => {
  app.listen(PORT, () => {
    console.log(`API Gateway listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize rate limiter Lua scripts:', err.message);
  process.exit(1);
});
