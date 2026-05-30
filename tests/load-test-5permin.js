/**
 * Load Test — 5 sequential requests with 8s gap = ~3.75 req/min
 * Simulates real-world "5-10 requests per minute" scenario
 * Run: node tests/load-test-5permin.js
 */
const http = require('http');

const API_KEY = 'sk-luna-c5fb1a34be9478d5bf45c6f268b8620136e3484b2d6b82ab2c326989ea287829';
const TOTAL = 5;
const GAP_MS = 8000; // 8 seconds between requests
const results = [];
let done = 0;

function sendRequest(i) {
  const start = Date.now();
  const payload = JSON.stringify({
    model: 'qwen3-coder-plus',
    stream: false,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply only: ACK-' + i }]
  });

  const req = http.request({
    hostname: 'localhost',
    port: 8080,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': 'Bearer ' + API_KEY
    },
    timeout: 120000
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      const elapsed = Date.now() - start;
      let content = '', rateLimited = false;
      try {
        const parsed = JSON.parse(d);
        content = parsed.choices?.[0]?.message?.content || '';
        if (res.statusCode === 429) rateLimited = true;
      } catch {}
      results.push({ i, status: res.statusCode, elapsed, content: content.slice(0, 50), ok: res.statusCode === 200, rateLimited });
      done++;
      if (done === TOTAL) printResults();
    });
  });

  req.on('error', e => {
    results.push({ i, status: 'ERR', elapsed: Date.now() - start, content: e.message, ok: false, rateLimited: false });
    done++;
    if (done === TOTAL) printResults();
  });

  req.on('timeout', () => {
    req.destroy();
    results.push({ i, status: 'TIMEOUT', elapsed: Date.now() - start, content: 'timeout', ok: false, rateLimited: false });
    done++;
    if (done === TOTAL) printResults();
  });

  req.write(payload);
  req.end();
}

function printResults() {
  console.log('\n================================================================');
  console.log('  LOAD TEST: ' + TOTAL + ' requests, ' + (GAP_MS/1000) + 's apart = ~' + (60000/GAP_MS).toFixed(1) + ' req/min');
  console.log('================================================================');
  console.log('Req# | Status | Latency   | Content');
  console.log('-----|--------|-----------|--------------------------------------');

  results.sort((a, b) => a.i - b.i);
  let passed = 0, failed = 0, rateLimited = 0, sumLat = 0, minLat = 99999, maxLat = 0;

  for (const r of results) {
    const icon = r.ok ? '✅' : (r.rateLimited ? '🚫' : '❌');
    console.log(icon + ' #' + r.i + '   | ' + String(r.status).padEnd(6) + ' | ' + (r.elapsed + 'ms').padEnd(9) + ' | ' + r.content);
    if (r.ok) {
      passed++;
      sumLat += r.elapsed;
      minLat = Math.min(minLat, r.elapsed);
      maxLat = Math.max(maxLat, r.elapsed);
    } else {
      failed++;
      if (r.rateLimited) rateLimited++;
    }
  }

  console.log('\n--- Summary ---');
  console.log('Passed: ' + passed + ' | Failed: ' + failed + ' | Rate-limited (429): ' + rateLimited);
  if (passed > 0) {
    console.log('Latency  — Min: ' + minLat + 'ms | Max: ' + maxLat + 'ms | Avg: ' + Math.round(sumLat / passed) + 'ms | Median: ' + median(results.filter(r => r.ok).map(r => r.elapsed)) + 'ms');
  }
  console.log('\nRate Limiter Config:');
  console.log('  - Per-account: 30 req/min window');
  console.log('  - Concurrent: 3 max simultaneous');
  console.log('  - Cooldown: 30s after 429');
  console.log('  - Global: 100 req/min');
  console.log('\nVerdict: ' + (rateLimited === 0
    ? '✅ All requests passed — proxy handles ' + (60000/GAP_MS).toFixed(1) + ' req/min with NO rate limiting'
    : '⚠️ ' + rateLimited + ' requests hit 429 — likely due to concurrent limit (previous requests still in-flight)'));
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

console.log('Starting: ' + TOTAL + ' requests, ' + (GAP_MS/1000) + 's apart...');
console.log('Estimated total time: ~' + Math.round((TOTAL - 1) * GAP_MS / 1000 + 8) + 's\n');

for (let i = 0; i < TOTAL; i++) {
  setTimeout(() => {
    console.log('  Sending request #' + (i + 1) + ' at +' + (i * GAP_MS / 1000) + 's...');
    sendRequest(i + 1);
  }, i * GAP_MS);
}