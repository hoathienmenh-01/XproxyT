/**
 * Manual test for unified auth middleware and UI routes.
 * Run: node tests/manual-auth-test.js
 */
const http = require('http');

const BASE = 'http://127.0.0.1:8080';
let API_KEY = ''; // Will be created dynamically
const PROXY_KEY = 'xuantoi';

function request(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { ...headers },
    };
    if (body) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        resolve({
          status: res.statusCode,
          contentType,
          body: b,
          isHtml: contentType.includes('text/html'),
          isJson: contentType.includes('application/json'),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name} — ${detail}`);
    failed++;
  }
}

async function createTestApiKey() {
  const data = JSON.stringify({ client_name: 'test-auto' });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 8080,
      path: '/api/admin/keys', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b).rawApiKey); } catch { resolve(''); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('\n=== Test Suite: Unified Auth Middleware ===\n');

  // Create a fresh API key for testing
  API_KEY = await createTestApiKey();
  if (API_KEY) {
    console.log(`  ℹ️  Created test API key: ${API_KEY.slice(0, 20)}...`);
  }

  // --- 1. Health endpoint (no auth required) ---
  console.log('1. Health endpoint (no auth)');
  {
    const r = await request('GET', '/health');
    check('returns 200', r.status === 200, `status=${r.status}`);
    check('returns JSON', r.isJson, `contentType=${r.contentType}`);
    const j = JSON.parse(r.body);
    check('status ok', j.status === 'ok', `status=${j.status}`);
  }

  // --- 2. Proxy Key auth ---
  console.log('\n2. Proxy Key auth');
  {
    // No key → 401
    const r1 = await request('GET', '/v1/models');
    check('no key → 401', r1.status === 401, `status=${r1.status}`);

    // Wrong key → 401
    const r2 = await request('GET', '/v1/models', {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    check('wrong key → 401', r2.status === 401, `status=${r2.status}`);

    // Correct proxy key via Authorization → 200
    const r3 = await request('GET', '/v1/models', {
      headers: { Authorization: `Bearer ${PROXY_KEY}` },
    });
    check('correct proxy key → 200', r3.status === 200, `status=${r3.status}`);

    // Correct proxy key via x-proxy-key header → 200
    const r4 = await request('GET', '/v1/models', {
      headers: { 'x-proxy-key': PROXY_KEY },
    });
    check('x-proxy-key header → 200', r4.status === 200, `status=${r4.status}`);
  }

  // --- 3. API Key auth ---
  console.log('\n3. API Key auth (sk-luna-...)');
  {
    // Valid API key → 200
    const r1 = await request('GET', '/v1/models', {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    check('valid API key → 200', r1.status === 200, `status=${r1.status}`);

    // Fake API key → 401
    const r2 = await request('GET', '/v1/models', {
      headers: { Authorization: 'Bearer sk-luna-fake1234567890' },
    });
    check('fake API key → 401', r2.status === 401, `status=${r2.status}`);
  }

  // --- 4. API Key list ---
  console.log('\n4. Admin API Key management');
  {
    const r1 = await request('GET', '/api/admin/keys');
    check('list keys → 200', r1.status === 200, `status=${r1.status}`);
    const j = JSON.parse(r1.body);
    check('keys array returned', Array.isArray(j.keys), `type=${typeof j.keys}`);
    check('has at least 1 key', j.keys.length >= 1, `count=${j.keys.length}`);
  }

  // --- 5. SPA fallback for UI routes ---
  console.log('\n5. SPA fallback for UI routes');
  {
    // Root "/" should return HTML (either static index.html or SPA fallback)
    const r1 = await request('GET', '/');
    check('/ → HTML or 200', r1.status === 200, `status=${r1.status}`);

    // /api-keys → SPA fallback should return HTML
    const r2 = await request('GET', '/api-keys');
    check('/api-keys → 200', r2.status === 200, `status=${r2.status}`);
    check('/api-keys → HTML', r2.isHtml, `contentType=${r2.contentType}`);

    // /analytics → SPA fallback should return HTML
    const r3 = await request('GET', '/analytics');
    check('/analytics → 200', r3.status === 200, `status=${r3.status}`);
    check('/analytics → HTML', r3.isHtml, `contentType=${r3.contentType}`);

    // /dashboard → SPA fallback
    const r4 = await request('GET', '/dashboard');
    check('/dashboard → 200', r4.status === 200, `status=${r4.status}`);
    check('/dashboard → HTML', r4.isHtml, `contentType=${r4.contentType}`);
  }

  // --- 6. API paths should NOT be caught by SPA fallback ---
  console.log('\n6. API paths NOT caught by SPA fallback');
  {
    const r1 = await request('GET', '/api/config');
    check('/api/config → JSON', r1.isJson, `contentType=${r1.contentType}`);

    const r2 = await request('GET', '/v1/models');
    check('/v1/models without auth → 401 JSON', r2.status === 401 && r2.isJson, `status=${r2.status}`);
  }

  // --- 7. /v1/chat/completions auth middleware ---
  console.log('\n7. /v1/chat/completions unified middleware');
  {
    // No auth → 401 (proxy key is set)
    const r1 = await request('POST', '/v1/chat/completions', {
      body: { model: 'test', messages: [{ role: 'user', content: 'hi' }] },
    });
    check('no auth → 401', r1.status === 401, `status=${r1.status}`);

    // Proxy key → passes middleware (may fail later due to provider, but not 401)
    const r2 = await request('POST', '/v1/chat/completions', {
      headers: { Authorization: `Bearer ${PROXY_KEY}` },
      body: { model: 'qwen3', messages: [{ role: 'user', content: 'hi' }], stream: false },
    });
    check('proxy key → not 401', r2.status !== 401, `status=${r2.status}`);

    // API key → passes middleware
    const r3 = await request('POST', '/v1/chat/completions', {
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: { model: 'qwen3', messages: [{ role: 'user', content: 'hi' }], stream: false },
    });
    check('API key → not 401', r3.status !== 401, `status=${r3.status}`);
  }

  // --- Summary ---
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);
  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED!');
  } else {
    console.log('⚠️  Some tests failed. See above for details.');
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test script error:', err);
  process.exit(1);
});