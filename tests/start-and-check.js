/**
 * Start Luna Proxy server and wait for health check
 * Run: node tests/start-and-check.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const projectDir = path.join(__dirname, '..');
const serverScript = path.join(projectDir, 'src', 'dev.ts');

console.log('Starting Luna Proxy server...');

const server = spawn('npx', ['ts-node', serverScript], {
  cwd: projectDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

server.stdout.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg) console.log('[server]', msg);
});

server.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg) console.error('[server-err]', msg);
});

// Poll health endpoint
let attempts = 0;
const maxAttempts = 30;

function checkHealth() {
  attempts++;
  http.get('http://localhost:8080/health', (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(d);
        if (parsed.status === 'ok') {
          console.log('\n✅ Server is healthy!');
          console.log('  Status:', parsed.status);
          console.log('  Uptime:', parsed.uptimeHuman);
          console.log('  Sessions:', parsed.activeSessions);
          console.log('  Memory:', parsed.memory?.rss);
          
          // Now run latency test
          console.log('\nRunning latency test...\n');
          const test = spawn('npx', ['ts-node', 'tests/latency-test.ts', '--stream', '--repeat=1'], {
            cwd: projectDir,
            stdio: 'inherit',
            shell: true,
          });
          test.on('close', (code) => {
            console.log('\nTest exit code:', code);
            // Keep server running, don't kill
            process.exit(code || 0);
          });
        }
      } catch {
        // Not ready yet
      }
    });
  }).on('error', () => {
    if (attempts < maxAttempts) {
      process.stdout.write('.');
      setTimeout(checkHealth, 1000);
    } else {
      console.error('\n❌ Server failed to start after', maxAttempts, 'seconds');
      server.kill();
      process.exit(1);
    }
  });
}

// Wait 5s for server to initialize
setTimeout(checkHealth, 5000);