const EventEmitter = require('events');

class CircuitBreaker extends EventEmitter {
  constructor(serviceId, config = {}) {
    super();
    this.serviceId = serviceId;
    this.state = 'CLOSED'; // States: CLOSED, OPEN, HALF_OPEN
    this.consecutiveFailures = 0;
    this.requestsWindow = []; // Stores rolling window of request outcomes: { success: boolean, timestamp: number }
    this.lastStateTransition = 0;
    
    // Trial request counters for HALF_OPEN
    this.trialRequestsCount = 0;
    this.trialRequestsSuccess = 0;

    // Default thresholds/configs
    this.failureThreshold = config.failureThreshold || 5;
    this.errorRateThreshold = config.errorRateThreshold || 0.5; // 50%
    this.rollingWindowSize = config.rollingWindowSize || 20;
    this.cooldownPeriod = config.cooldownPeriod || 10000; // 10 seconds
    this.trialRequestLimit = config.trialRequestLimit || 3;
    this.minRequestsForThreshold = config.minRequestsForThreshold || 5;
  }

  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateTransition = Date.now();

    if (newState === 'HALF_OPEN') {
      this.trialRequestsCount = 0;
      this.trialRequestsSuccess = 0;
    }

    this.emit('transition', {
      service: this.serviceId,
      from: oldState,
      to: newState
    });

    console.log(`[CircuitBreaker] ${this.serviceId}: ${oldState} -> ${newState}`);
  }

  allowRequest() {
    const now = Date.now();
    
    if (this.state === 'OPEN') {
      if (now - this.lastStateTransition > this.cooldownPeriod) {
        this.transitionTo('HALF_OPEN');
        return true;
      }
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      if (this.trialRequestsCount < this.trialRequestLimit) {
        this.trialRequestsCount++;
        return true;
      }
      return false; // Queue/block request if the trial capacity in HALF_OPEN is filled
    }

    return true;
  }

  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.trialRequestsSuccess++;
      if (this.trialRequestsSuccess >= this.trialRequestLimit) {
        this.transitionTo('CLOSED');
        this.consecutiveFailures = 0;
        this.requestsWindow = [];
      }
    } else if (this.state === 'CLOSED') {
      this.consecutiveFailures = 0;
      this.requestsWindow.push({ success: true, timestamp: Date.now() });
      if (this.requestsWindow.length > this.rollingWindowSize) {
        this.requestsWindow.shift();
      }
    }
  }

  recordFailure() {
    if (this.state === 'HALF_OPEN') {
      // Any failure during HALF_OPEN trips it back to OPEN immediately
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED') {
      this.consecutiveFailures++;
      this.requestsWindow.push({ success: false, timestamp: Date.now() });
      if (this.requestsWindow.length > this.rollingWindowSize) {
        this.requestsWindow.shift();
      }

      let shouldTrip = false;

      // Condition A: N consecutive failures
      if (this.consecutiveFailures >= this.failureThreshold) {
        shouldTrip = true;
      }

      // Condition B: Error rate threshold in rolling window
      if (!shouldTrip && this.requestsWindow.length >= this.minRequestsForThreshold) {
        const total = this.requestsWindow.length;
        const failed = this.requestsWindow.filter(r => !r.success).length;
        const errorRate = failed / total;
        if (errorRate >= this.errorRateThreshold) {
          shouldTrip = true;
        }
      }

      if (shouldTrip) {
        this.transitionTo('OPEN');
      }
    }
  }
}

// In-memory registry of circuit breakers per upstream service
const breakers = {};

function getBreaker(serviceId, config = {}) {
  if (!breakers[serviceId]) {
    breakers[serviceId] = new CircuitBreaker(serviceId, config);
  }
  return breakers[serviceId];
}

const circuitBreakerMiddleware = (req, res, next) => {
  const serviceId = req.params.service;
  if (!serviceId) {
    return next();
  }

  // Get or initialize the circuit breaker for this service
  const breaker = getBreaker(serviceId);
  req.breaker = breaker;
  req.breakerRecorded = false;

  // Helpers to prevent double recording per request
  req.recordBreakerFailure = () => {
    if (!req.breakerRecorded) {
      req.breakerRecorded = true;
      breaker.recordFailure();
    }
  };

  req.recordBreakerSuccess = () => {
    if (!req.breakerRecorded) {
      req.breakerRecorded = true;
      breaker.recordSuccess();
    }
  };

  // Intercept the response completion
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      req.recordBreakerFailure();
    } else {
      req.recordBreakerSuccess();
    }
  });

  // Check state
  if (!breaker.allowRequest()) {
    res.setHeader('X-Circuit-State', breaker.state);
    return res.status(503).json({
      error: 'Service Unavailable',
      message: `Circuit breaker is OPEN for service '${serviceId}'. Request short-circuited.`,
      state: breaker.state
    });
  }

  next();
};

module.exports = {
  CircuitBreaker,
  getBreaker,
  circuitBreakerMiddleware
};
