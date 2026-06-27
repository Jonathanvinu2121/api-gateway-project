const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const path = req.path;

  // Exclude /health, /auth/*, and /admin/* from authentication checks
  const isExcluded = 
    path === '/health' || 
    path.startsWith('/auth/') || 
    path.startsWith('/admin/');

  if (isExcluded) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header is missing'
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header format must be Bearer <token>'
    });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    req.user = decoded; // Attach claims (userId, tenantId, tier, email) to req.user
    next();
  } catch (err) {
    console.error('JWT Verification failed:', err.message);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      details: err.message
    });
  }
};

module.exports = authMiddleware;
