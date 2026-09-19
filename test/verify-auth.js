const http = require('http');

// Simple JWT generation using node's crypto to avoid any dependency mismatch
const crypto = require('crypto');

const JWT_SECRET = 'kltn_hk1_2026_delivery_jwt_secret_key_change_in_production';

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createJwt(payload, secret = JWT_SECRET, expiresInSec = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const fullPayload = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

const TOKEN_ADMIN = createJwt({ sub: 'admin-001', email: 'admin@delivery.com', role: 'ADMIN' });
const TOKEN_DISPATCHER = createJwt({ sub: 'disp-002', email: 'dispatcher@delivery.com', role: 'DISPATCHER' });
const TOKEN_DRIVER = createJwt({ sub: 'driver-003', email: 'driver@delivery.com', role: 'DRIVER' });
const TOKEN_INVALID_ROLE = createJwt({ sub: 'super-004', email: 'super@delivery.com', role: 'SUPER_ADMIN' });
const TOKEN_WRONG_SECRET = createJwt({ sub: 'fake-005', email: 'fake@delivery.com', role: 'ADMIN' }, 'wrong_secret');

function makeRequest(path, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: 3001,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (e) {
            json = data;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING VERIFICATION OF 9 SECURITY SCENARIOS ---');
  let passed = 0;
  let failed = 0;

  async function assertCase(name, actualStatus, expectedStatus, condition = true, detail = '') {
    if (actualStatus === expectedStatus && condition) {
      console.log(`✅ PASS: ${name} [Status ${actualStatus}]`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${name} [Expected ${expectedStatus}, got ${actualStatus}] - ${detail}`);
      failed++;
    }
  }

  // Test 1: Global Guard blocks unauthenticated request (401)
  const t1 = await makeRequest('/api/depots');
  await assertCase('Test 1: GET /api/depots without token -> 401', t1.status, 401, t1.body.statusCode === 401, JSON.stringify(t1.body));

  // Test 2: Invalid token signature or malformed (401)
  const t2a = await makeRequest('/api/depots', TOKEN_WRONG_SECRET);
  await assertCase('Test 2a: Token wrong signature -> 401', t2a.status, 401);
  const t2b = await makeRequest('/api/depots', 'not-a-valid-jwt-token');
  await assertCase('Test 2b: Malformed token -> 401', t2b.status, 401);

  // Test 3: Token with invalid role SUPER_ADMIN (401)
  const t3 = await makeRequest('/api/depots', TOKEN_INVALID_ROLE);
  await assertCase('Test 3: Token with role SUPER_ADMIN -> 401 (Invalid token role)', t3.status, 401, t3.body.message === 'Invalid token role');

  // Test 4: Bypass with @Public() on /api/health and /api
  const t4a = await makeRequest('/api/health');
  await assertCase('Test 4a: GET /api/health without token -> 200', t4a.status, 200, t4a.body.status === 'ok');
  const t4b = await makeRequest('/api');
  await assertCase('Test 4b: GET /api without token -> 200', t4b.status, 200, t4b.body === 'Hello World!');

  // Test 5: Valid authenticated request on route without @Roles() (200)
  const t5 = await makeRequest('/api/depots', TOKEN_DRIVER);
  await assertCase('Test 5: GET /api/depots with TOKEN_DRIVER -> 200 (any authenticated user)', t5.status, 200, Array.isArray(t5.body));

  // Test 6: Check 403 Forbidden with @Roles(UserRole.ADMIN) when accessed by DRIVER
  const t6 = await makeRequest('/api/orders/pool', TOKEN_DRIVER);
  await assertCase('Test 6: GET /api/orders/pool with TOKEN_DRIVER -> 403 Forbidden', t6.status, 403, t6.body.statusCode === 403);

  // Test 7: Check 200 OK with @Roles(UserRole.ADMIN) when accessed by ADMIN
  const t7 = await makeRequest('/api/orders/pool', TOKEN_ADMIN);
  await assertCase('Test 7: GET /api/orders/pool with TOKEN_ADMIN -> 200 OK', t7.status, 200, Array.isArray(t7.body));

  // Test 8: Multiple Roles @Roles(ADMIN, DISPATCHER) on GET /api/orders
  const t8a = await makeRequest('/api/orders', TOKEN_DISPATCHER);
  await assertCase('Test 8a: GET /api/orders with TOKEN_DISPATCHER -> 200 OK', t8a.status, 200, Array.isArray(t8a.body));
  const t8b = await makeRequest('/api/orders', TOKEN_DRIVER);
  await assertCase('Test 8b: GET /api/orders with TOKEN_DRIVER -> 403 Forbidden', t8b.status, 403, t8b.body.statusCode === 403);

  // Test 9: @CurrentUser() decorator extracts sub, email, role
  const t9 = await makeRequest('/api/profile', TOKEN_DRIVER);
  const profileCorrect = t9.body && t9.body.sub === 'driver-003' && t9.body.email === 'driver@delivery.com' && t9.body.role === 'DRIVER';
  await assertCase('Test 9: GET /api/profile with TOKEN_DRIVER -> 200 with extracted sub, email, role', t9.status, 200, profileCorrect, JSON.stringify(t9.body));

  console.log(`\n--- SUMMARY: ${passed} PASSED, ${failed} FAILED ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Error running verification tests:', err);
  process.exit(1);
});
