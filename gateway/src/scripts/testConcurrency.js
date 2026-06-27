const GATEWAY_URL = 'http://localhost:4000';

async function runTest() {
  const timestamp = Date.now();
  const name = `Test Tenant ${timestamp}`;
  const email = `tenant_${timestamp}@example.com`;
  const password = 'password123';

  console.log(`[Test] Registering new tenant: ${email}...`);
  let registerRes;
  try {
    registerRes = await fetch(`${GATEWAY_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
  } catch (err) {
    console.error('[Test] Gateway connection failed. Is the gateway running?', err.message);
    return;
  }

  if (!registerRes.ok) {
    const errorText = await registerRes.text();
    console.error(`[Test] Registration failed: Status ${registerRes.status}. Response:`, errorText);
    return;
  }

  const registerData = await registerRes.json();
  const token = registerData.token;
  console.log('[Test] Registered successfully. JWT obtained.');

  console.log('\n[Test] Sending 20 concurrent requests to /api/users/data...');
  
  // Create 20 request promises executing concurrently
  const requestPromises = Array.from({ length: 20 }).map((_, index) => {
    return fetch(`${GATEWAY_URL}/api/users/data`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    .then(async (res) => {
      const status = res.status;
      const headers = {
        limit: res.headers.get('X-RateLimit-Limit'),
        remaining: res.headers.get('X-RateLimit-Remaining'),
        reset: res.headers.get('X-RateLimit-Reset'),
        retryAfter: res.headers.get('Retry-After')
      };
      
      let body = {};
      try {
        body = await res.json();
      } catch (e) {
        // Ignored
      }
      
      return { index: index + 1, status, headers, body };
    })
    .catch((err) => {
      return { index: index + 1, status: 'ERROR', error: err.message };
    });
  });

  const results = await Promise.all(requestPromises);

  let successCount = 0;
  let rateLimitedCount = 0;
  let otherCount = 0;

  console.log('\n[Test] Individual Request Results:');
  results.forEach((r) => {
    if (r.status === 200) {
      successCount++;
      console.log(`  Req #${r.index}: Status 200 OK | Remaining Quota: ${r.headers.remaining}/${r.headers.limit} | Reset: ${r.headers.reset}`);
    } else if (r.status === 429) {
      rateLimitedCount++;
      console.log(`  Req #${r.index}: Status 429 Too Many Requests | Remaining Quota: ${r.headers.remaining}/${r.headers.limit} | Retry-After: ${r.headers.retryAfter}s | Reset: ${r.headers.reset}`);
    } else {
      otherCount++;
      console.log(`  Req #${r.index}: Status ${r.status} | Error: ${r.error || JSON.stringify(r.body)}`);
    }
  });

  console.log('\n[Test] Summary:');
  console.log(`  Total Requests: 20`);
  console.log(`  Allowed (200 OK): ${successCount}`);
  console.log(`  Blocked (429 Too Many Requests): ${rateLimitedCount}`);
  console.log(`  Failed/Others: ${otherCount}`);

  // Assertions
  if (successCount === 5 && rateLimitedCount === 15) {
    console.log('\n[Test] SUCCESS: Concurrency test passed! Exactly 5 requests allowed, 15 requests blocked.');
  } else {
    console.error(`\n[Test] FAILURE: Concurrency test failed. Expected 5 allowed and 15 blocked, but got ${successCount} allowed and ${rateLimitedCount} blocked.`);
    process.exit(1);
  }
}

runTest();
