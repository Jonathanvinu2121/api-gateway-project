require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const Tenant = require('./src/models/Tenant');
const User = require('./src/models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/api_gateway';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key';

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB successfully.');

  // Clean up existing demo users/tenants
  const demoEmails = ['free@example.com', 'pro@example.com', 'enterprise@example.com'];
  await User.deleteMany({ email: { $in: demoEmails } });
  await Tenant.deleteMany({ name: { $in: ['Free Demo Tenant', 'Pro Demo Tenant', 'Enterprise Demo Tenant'] } });

  const tenantsData = [
    { name: 'Free Demo Tenant', tier: 'free', email: 'free@example.com' },
    { name: 'Pro Demo Tenant', tier: 'pro', email: 'pro@example.com' },
    { name: 'Enterprise Demo Tenant', tier: 'enterprise', email: 'enterprise@example.com' }
  ];

  console.log('\n--- Seeding Demo Tenants and Users ---');
  for (const item of tenantsData) {
    // Create tenant
    const tenant = new Tenant({ name: item.name, tier: item.tier });
    await tenant.save();

    // Hash password
    const passwordHash = await bcrypt.hash('password123', 10);

    // Create user
    const user = new User({
      email: item.email,
      passwordHash,
      tenantId: tenant._id
    });
    await user.save();

    // Generate JWT token matching the gateway's expected payload
    const token = jwt.sign(
      {
        userId: user._id.toString(),
        tenantId: tenant._id.toString(),
        tier: tenant.tier,
        email: user.email
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`\nTier:       ${item.tier.toUpperCase()}`);
    console.log(`Email:      ${item.email}`);
    console.log(`Password:   password123`);
    console.log(`Tenant ID:  ${tenant._id}`);
    console.log(`JWT Token:  ${token}`);
  }
  console.log('\nSeeding completed successfully.');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Error during seeding:', err);
  process.exit(1);
});
