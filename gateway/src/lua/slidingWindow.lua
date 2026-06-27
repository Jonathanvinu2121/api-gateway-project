local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local rand = ARGV[4]
local ttl = tonumber(ARGV[5] or (window * 2))

local clear_before = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', clear_before)

local count = redis.call('ZCARD', key)
local allowed = 0
if count < limit then
  local member = tostring(now) .. ":" .. rand
  redis.call('ZADD', key, now, member)
  count = count + 1
  allowed = 1
end

redis.call('EXPIRE', key, ttl)

local remaining = limit - count
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset_time = now + window
if oldest[2] then
  reset_time = tonumber(oldest[2]) + window
end

return { allowed, remaining, reset_time }
