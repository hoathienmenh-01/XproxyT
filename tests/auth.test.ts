// @ts-nocheck
/**
 * Auth Test — Proxy Key & API Key coexistence
 * Tests that both Proxy Key and API Key work independently and together
 * without conflicts.
 */

const http = require('http');
const crypto = require('crypto');

const HOST = '127.0.0.1';
const PORT = 8099; // Use a different port to avoid conflicts

function httpGet(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${HOST}:${PORT}${path}`, { headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
  });
}

function httpPost(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function httpPatch(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runAuthTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.log(`  ✗ ${msg}`);
      failed++;
    }
  }

  console.log('\n=== Auth Test: Starting server ===\n');

  // Import and start server
  const server = require('../src/server');
  const { configStore } = require('../src/configStore');
  const srv = server.simpleProxyServer || server.default;

  try {
    await srv.start(PORT, HOST);
    console.log(`Server started on ${HOST}:${PORT}`);
  } catch (e) {
    console.log('Server start error:', e.message || e);
  }
  await new Promise(r => setTimeout(r, 2000));

  // ===== TEST PHASE 1: No auth configured — should be open access =====
  console.log('\n--- Phase 1: No auth configured (open access) ---');
  try {
    // Reset config: no proxy key, no API keys
    const conf = configStore.getConfig();
    configStore.updateConfig({ proxy: { ...conf.proxy, key: '' } });
    // Note: API keys may exist in SQLite from previous runs, but this tests the middleware logic

    const health = await httpGet('/health');
    assert(health.status === 200, 'Health endpoint accessible without auth (open access)');
  } catch (err) {
    console.error('Phase 1 error:', err.message);
    failed++;
  }

  // ===== TEST PHASE 2: Proxy Key only =====
  console.log('\n--- Phase 2: Proxy Key configured ---');
  const TEST_PROXY_KEY = 'test-proxy-key-12345';
  try {
    const conf = configStore.getConfig();
    configStore.updateConfig({ proxy: { ...conf.proxy, key: TEST_PROXY_KEY } });
    await new Promise(r => setTimeout(r, 500));

    // Test 2a: No key provided → should be 401
    const noKey = await httpGet('/v1/models');
    assert(noKey.status === 401, 'No key → 401 Unauthorized');

    // Test 2b: Wrong key → should be 401
    const wrongKey = await httpGet('/v1/models', { 'Authorization': 'Bearer wrong-key' });
    assert(wrongKey.status === 401, 'Wrong key → 401 Unauthorized');

    // Test 2c: Correct Proxy Key via Authorization header → should be 200
    const correctBearer = await httpGet('/v1/models', { 'Authorization': `Bearer ${TEST_PROXY_KEY}` });
    assert(correctBearer.status === 200, 'Correct Proxy Key via Authorization → 200');

    // Test 2d: Correct Proxy Key via x-proxy-key header → should be 200
    const correctXProxy = await httpGet('/v1/models', { 'x-proxy-key': TEST_PROXY_KEY });
    assert(correctXProxy.status === 200, 'Correct Proxy Key via x-proxy-key → 200');
  } catch (err) {
    console.error('Phase 2 error:', err.message);
    failed++;
  }

  // ===== TEST PHASE 3: API Key only =====
  console.log('\n--- Phase 3: API Key configured ---');
  let testApiKey = '';
  let testKeyId = '';
  try {
    // Remove proxy key first
    const conf = configStore.getConfig();
    configStore.updateConfig({ proxy: { ...conf.proxy, key: '' } });
    await new Promise(r => setTimeout(r, 500));

    // Generate an API key via admin endpoint (no auth needed since proxy key removed)
    const genResult = await httpPost('/api/admin/keys', { client_name: 'test-auth-client' });
    assert(genResult.status === 200, 'Generate API key succeeds');
    assert(genResult.data.ok === true, 'API key generation returns ok');
    assert(genResult.data.rawApiKey?.startsWith('sk-luna-'), 'Generated key starts with sk-luna-');

    testApiKey = genResult.data.rawApiKey;
    testKeyId = genResult.data.id;

    // Test 3a: No key → 401
    const noKey = await httpGet('/v1/models');
    assert(noKey.status === 401, 'No API key → 401 Unauthorized');

    // Test 3b: Correct API Key via Authorization header → 200
    const correctAuth = await httpGet('/v1/models', { 'Authorization': `Bearer ${testApiKey}` });
    assert(correctAuth.status === 200, 'Correct API Key via Authorization → 200');

    // Test 3c: Correct API Key via x-api-key header → 200
    const correctXApiKey = await httpGet('/v1/models', { 'x-api-key': testApiKey });
    assert(correctXApiKey.status === 200, 'Correct API Key via x-api-key header → 200');

    // Test 3d: Wrong API Key → 401
    const wrongApiKey = await httpGet('/v1/models', { 'Authorization': 'Bearer sk-luna-0000000000000000000000000000000000000000000000000000000000000000' });
    assert(wrongApiKey.status === 401, 'Wrong API Key → 401 Unauthorized');
  } catch (err) {
    console.error('Phase 3 error:', err.message);
    failed++;
  }

  // ===== TEST PHASE 4: Both Proxy Key AND API Key configured =====
  console.log('\n--- Phase 4: Both Proxy Key AND API Key configured ---');
  try {
    const conf = configStore.getConfig();
    configStore.updateConfig({ proxy: { ...conf.proxy, key: TEST_PROXY_KEY } });
    await new Promise(r => setTimeout(r, 500));

    // Test 4a: No key → 401
    const noKey = await httpGet('/v1/models');
    assert(noKey.status === 401, 'Both enabled, no key → 401');

    // Test 4b: Proxy Key via Authorization → 200
    const proxyAuth = await httpGet('/v1/models', { 'Authorization': `Bearer ${TEST_PROXY_KEY}` });
    assert(proxyAuth.status === 200, 'Both enabled, Proxy Key via Authorization → 200');

    // Test 4c: Proxy Key via x-proxy-key → 200
    const proxyXHeader = await httpGet('/v1/models', { 'x-proxy-key': TEST_PROXY_KEY });
    assert(proxyXHeader.status === 200, 'Both enabled, Proxy Key via x-proxy-key → 200');

    // Test 4d: API Key via Authorization → 200 (THIS WAS THE BUG)
    const apiAuth = await httpGet('/v1/models', { 'Authorization': `Bearer ${testApiKey}` });
    assert(apiAuth.status === 200, 'Both enabled, API Key via Authorization → 200');

    // Test 4e: API Key via x-api-key → 200 (THIS WAS THE BUG)
    const apiXHeader = await httpGet('/v1/models', { 'x-api-key': testApiKey });
    assert(apiXHeader.status === 200, 'Both enabled, API Key via x-api-key → 200');

    // Test 4f: Wrong key → 401
    const wrongKey = await httpGet('/v1/models', { 'Authorization': 'Bearer totally-wrong' });
    assert(wrongKey.status === 401, 'Both enabled, wrong key → 401');

    // Test 4g: API key sent via x-proxy-key should NOT work (cross-channel isolation)
    const crossChannel = await httpGet('/v1/models', { 'x-proxy-key': testApiKey });
    assert(crossChannel.status === 401, 'API key via x-proxy-key should NOT pass (cross-channel isolation)');

    // Test 4h: Proxy key sent via x-api-key should NOT work (cross-channel isolation)
    const crossChannel2 = await httpGet('/v1/models', { 'x-api-key': TEST_PROXY_KEY });
    assert(crossChannel2.status === 401, 'Proxy key via x-api-key should NOT pass (cross-channel isolation)');
  } catch (err) {
    console.error('Phase 4 error:', err.message);
    failed++;
  }

  // ===== TEST PHASE 5: API Key toggle (deactivate/activate) =====
  console.log('\n--- Phase 5: API Key toggle ---');
  try {
    // Deactivate the API key
    const toggle = await httpPatch(`/api/admin/keys/${testKeyId}/toggle`);
    assert(toggle.status === 200, 'Toggle API key succeeds');
    assert(toggle.data.ok === true, 'Toggle returns ok');

    // Try with deactivated key → 403
    const deactivated = await httpGet('/v1/models', { 'Authorization': `Bearer ${testApiKey}` });
    assert(deactivated.status === 403, 'Deactivated API Key → 403 Forbidden');

    // Proxy key should still work even with deactivated API key
    const conf = configStore.getConfig();
    if (conf.proxy?.key === TEST_PROXY_KEY) {
      const proxyStillWorks = await httpGet('/v1/models', { 'Authorization': `Bearer ${TEST_PROXY_KEY}` });
      assert(proxyStillWorks.status === 200, 'Proxy Key still works after API key deactivation');
    }

    // Re-activate the API key
    const toggle2 = await httpPatch(`/api/admin/keys/${testKeyId}/toggle`);
    assert(toggle2.status === 200, 'Re-activate API key succeeds');

    // Should work again
    const reactivated = await httpGet('/v1/models', { 'Authorization': `Bearer ${testApiKey}` });
    assert(reactivated.status === 200, 'Reactivated API Key works again → 200');
  } catch (err) {
    console.error('Phase 5 error:', err.message);
    failed++;
  }

  // ===== TEST PHASE 6: Admin routes should NOT require auth =====
  console.log('\n--- Phase 6: Admin routes accessible ---');
  try {
    const conf = configStore.getConfig();
    // Proxy key is still set
    assert(conf.proxy?.key === TEST_PROXY_KEY, 'Proxy key is still set');

    // Admin key list should work without auth
    const listKeys = await httpGet('/api/admin/keys');
    assert(listKeys.status === 200, 'Admin /api/admin/keys accessible without auth');
    assert(Array.isArray(listKeys.data.keys), 'Returns keys array');

    // Generate key should work without auth
    const genKey = await httpPost('/api/admin/keys', { client_name: 'admin-test' });
    assert(genKey.status === 200, 'Admin /api/admin/keys POST accessible without auth');
  } catch (err) {
    console.error('Phase 6 error:', err.message);
    failed++;
  }

  // ===== TEST PHASE 7: Cleanup =====
  console.log('\n--- Phase 7: Cleanup ---');
  try {
    const conf = configStore.getConfig();
    configStore.updateConfig({ proxy: { ...conf.proxy, key: '' } });
    console.log('  Proxy key cleared');
  } catch (err) {
    console.error('Phase 7 error:', err.message);
  }

  console.log(`\n=== Auth Test Results: ${passed}/${passed + failed} passed, ${failed} failed ===\n`);

  // Shutdown
  try { await srv.stop(); } catch {}
  process.exit(failed > 0 ? 1 : 0);
}

runAuthTests();