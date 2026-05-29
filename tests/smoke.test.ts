// @ts-nocheck
/**
 * Phase C1 — Smoke Test
 * Starts the server, tests key endpoints, then shuts down.
 */

const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8080;

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://${HOST}:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
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

async function runSmokeTests() {
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

  console.log('\n=== Smoke Test: Starting server ===\n');

  // Import and start server
  const server = require('../src/server');
  const srv = server.simpleProxyServer || server.default;
  
  // Explicitly start the server
  try {
    await srv.start(PORT, HOST);
    console.log(`Server started on ${HOST}:${PORT}`);
  } catch (e) {
    console.log('Server start error:', e.message || e);
  }

  // Wait a bit for server to be ready
  await new Promise(r => setTimeout(r, 2000));

  try {
    // Test 1: Health endpoint
    console.log('SMOKE.1 — Health endpoint');
    const health = await httpGet('/health');
    assert(health.status === 200, 'health returns 200');
    assert(health.data.status === 'ok', 'status is ok');
    assert(health.data.version === '0.1.0', 'has version');
    assert(typeof health.data.uptime === 'number', 'has uptime');
    assert(typeof health.data.memory === 'object', 'has memory info');
    assert(typeof health.data.activeSessions === 'number', 'has activeSessions');
    assert(typeof health.data.activeRuns === 'number', 'has activeRuns');

    // Test 2: Config endpoint
    console.log('\nSMOKE.2 — Config endpoint');
    const config = await httpGet('/api/config');
    assert(config.status === 200, 'config returns 200');
    assert(Array.isArray(config.data.providers), 'has providers array');

    // Test 3: Models endpoint
    console.log('\nSMOKE.3 — Models endpoint');
    const models = await httpGet('/api/models');
    assert(models.status === 200, 'models returns 200');
    assert(Array.isArray(models.data.items), 'has items array');

    // Test 4: Sessions endpoint
    console.log('\nSMOKE.4 — Sessions endpoint');
    const sessions = await httpGet('/api/sessions');
    assert(sessions.status === 200, 'sessions returns 200');
    assert(Array.isArray(sessions.data), 'sessions is array');

    // Test 5: Runs endpoint
    console.log('\nSMOKE.5 — Runs endpoint');
    const runs = await httpGet('/api/runs');
    assert(runs.status === 200, 'runs returns 200');

    // Test 6: Workspace diagnostics
    console.log('\nSMOKE.6 — Workspace diagnostics');
    const workspace = await httpGet('/api/workspace/diagnostics');
    assert(workspace.status === 200, 'workspace returns 200');
    assert(typeof workspace.data.activeLocks === 'number', 'has activeLocks');

    // Test 7: Git status
    console.log('\nSMOKE.7 — Git status');
    const git = await httpGet('/api/workspace/git-status');
    assert(git.status === 200, 'git-status returns 200');
    assert(typeof git.data.isRepo === 'boolean', 'has isRepo');

    // Test 8: 404 for unknown API
    console.log('\nSMOKE.8 — Error handling');
    const notFound = await httpGet('/api/nonexistent');
    assert(notFound.status === 404, 'returns 404 for unknown route');

    // Test 9: Runtime
    console.log('\nSMOKE.9 — Runtime diagnostics');
    const runtime = await httpGet('/api/runtime');
    assert(runtime.status === 200, 'runtime returns 200');
    assert(Array.isArray(runtime.data.activeRuns), 'has activeRuns');

    // Test 10: Logs
    console.log('\nSMOKE.10 — Logs endpoint');
    const logs = await httpGet('/api/logs?limit=5');
    assert(logs.status === 200, 'logs returns 200');

  } catch (err) {
    console.error('\nSmoke test error:', err.message);
    failed++;
  }

  console.log(`\n=== Smoke Test Results: ${passed}/${passed + failed} passed, ${failed} failed ===\n`);

  // Shutdown
  try { await srv.stop(); } catch {}
  process.exit(failed > 0 ? 1 : 0);
}

runSmokeTests();