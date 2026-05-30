/**
 * Load Test — 8 sequential requests with 1s gap
 * Mimics 5-10 requests per minute scenario
 * Run: node tests/load-test.js
 */
const http = require('http');

const API_KEY = 'sk-luna-c5fb1a34be9478d5bf45c6f268b8620136e3484b2d6b82ab2c326989ea287829';
const BASE = 'http://localhost:8080';
const TOTAL = 8;
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
    timeout: 60000
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      const elapsed = Date.now() - start;
      let content = '';
      try { content = JSON.parse(d).choices?.[0]?.message?.content || ''; } catch {}
      results.push({ i, status: res.statusCode, elapsed, content: content.slice(0, 40), ok: res.statusCode === 200 });
      done++;
      if (done === TOTAL) printResults();
    });
  });

  req.on('error', e => {
    results.push({ i, status: 'ERR', elapsed: Date.now() - start, content: e.message, ok: false });
    done++;
    if (done === TOTAL) printResults();
  });

  req.on('timeout', () => {
    req.destroy();
    results.push({ i, status: 'TIMEOUT', elapsed: Date.now() - start, content: 'timeout', ok: false });
    done++;
    if (done === TOTAL) printResults();
  });

  req.write(payload);
  req.end();
}

function printResults() {
  console.log('\n=== LOAD TEST: ' + TOTAL + ' sequential requests (1s gap) ===');
  console.log('Req# | Status | Latency   | Content');
  console.log('-----|--------|-----------|----------------------------------');

  results.sort((a, b) => a.i - b.i);
  let passed = 0, failed = 0, sumLat = 0, minLat = 99999, maxLat = 0;

  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(icon + ' #' + r.i + '   | ' + String(r.status).padEnd(6) + ' | ' + (r.elapsed + 'ms').padEnd(9) + ' | ' + r.content);
    if (r.ok) {
      passed++;
      sumLat += r.elapsed;
      minLat = Math.min(minLat, r.elapsed);
      maxLat = Math.max(maxLat, r.elapsed);
    } else {
      failed++;
    }
  }

  console.log('\n--- Summary ---');
  console.log('Total: ' + TOTAL + ' | Passed: ' + passed + ' | Failed: ' + failed);
  if (passed > 0) {
    console.log('Latency — Min: ' + minLat + 'ms | Max: ' + maxLat + 'ms | Avg: ' + Math.round(sumLat / passed) + 'ms');
  }
  console.log('Rate limit (30 req/min, 3 concurrent): ' + (failed === 0 ? 'NOT HIT — all requests passed' : 'HIT — ' + failed + ' requests rejected'));
  console.log('Throughput: ' + TOTAL + ' requests in ~' + Math.round((TOTAL - 1)) + 's = ~' + (TOTAL * 60 / (TOTAL - 1)).toFixed(1) + ' req/min equivalent');
}

// Send 8 requests sequentially with 1 second gap
console.log('Starting load test: ' + TOTAL + ' requests, 1s apart...');
for (let i = 0; i < TOTAL; i++) {
  setTimeout(() => sendRequest(i + 1), i * 1000);
}