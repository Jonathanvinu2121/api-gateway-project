const mongoose = require('mongoose');

const requestLogSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true
  },
  route: {
    type: String,
    required: true
  },
  statusCode: {
    type: Number,
    required: true
  },
  latencyMs: {
    type: Number,
    required: true
  },
  rateLimitDecision: {
    type: String,
    enum: ['allowed', 'blocked'],
    required: true
  },
  breakerState: {
    type: String,
    enum: ['CLOSED', 'OPEN', 'HALF_OPEN'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('RequestLog', requestLogSchema);
