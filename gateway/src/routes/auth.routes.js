const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Tenant = require('../models/Tenant');
const User = require('../models/User');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const TOKEN_EXPIRY = '24h';

// Helper to generate JWT
const generateToken = (user, tenant) => {
  const payload = {
    userId: user._id.toString(),
    tenantId: tenant._id.toString(),
    tier: tenant.tier,
    email: user.email
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
};

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Bad Request', message: 'name, email, and password are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ error: 'Conflict', message: 'User with this email already exists' });
    }

    // Create the Tenant (default tier: free)
    const tenant = new Tenant({ name, tier: 'free' });
    await tenant.save();

    // Hash the password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create the User
    const user = new User({
      email: email.toLowerCase(),
      passwordHash,
      tenantId: tenant._id
    });
    await user.save();

    // Generate JWT
    const token = generateToken(user, tenant);

    return res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        tenantId: tenant._id,
        tier: tenant.tier
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Bad Request', message: 'email and password are required' });
    }

    // Find user and populate their tenant
    const user = await User.findOne({ email: email.toLowerCase() }).populate('tenantId');
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
    }

    const tenant = user.tenantId;
    if (!tenant) {
      return res.status(400).json({ error: 'Bad Request', message: 'User is not associated with any active tenant' });
    }

    // Generate JWT
    const token = generateToken(user, tenant);

    return res.status(200).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        tenantId: tenant._id,
        tier: tenant.tier
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
