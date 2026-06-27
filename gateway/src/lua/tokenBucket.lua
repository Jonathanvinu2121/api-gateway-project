local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4] or 1)
local ttl = tonumber(ARGV[5] or 60)

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
  tokens = capacity - requested
  last_refill = now
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('EXPIRE', key, ttl)
  return { 1, tokens, now }
else
  local elapsed = now - last_refill
  if elapsed > 0 then
    local refill = elapsed * refill_rate
    tokens = math.min(capacity, tokens + refill)
    last_refill = now
  end

  local allowed = 0
  if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
  end

  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('EXPIRE', key, ttl)

  local time_to_full = (capacity - tokens) / refill_rate
  local reset_time = now + time_to_full

  return { allowed, tokens, reset_time }
end
