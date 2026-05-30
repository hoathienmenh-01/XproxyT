const http = require('http');

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: 8080,
      path,
      method,
      headers: {'Content-Type': 'application/json'},
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== Step 1: Check accounts ===');
  const accounts = await api('GET', '/api/admin/accounts');
  console.log(JSON.stringify(accounts, null, 2));

  console.log('\n=== Step 2: Create API key for account "1" ===');
  const key1 = await api('POST', '/api/admin/keys', { client_name: 'test-account-1', account_id: '1' });
  console.log('Key 1:', key1.ok ? `Created: ${key1.rawApiKey}` : key1.error);
  const rawKey1 = key1.rawApiKey;

  console.log('\n=== Step 3: Create API key for account "2" ===');
  const key2 = await api('POST', '/api/admin/keys', { client_name: 'test-account-2', account_id: '2' });
  console.log('Key 2:', key2.ok ? `Created: ${key2.rawApiKey}` : key2.error);
  const rawKey2 = key2.rawApiKey;

  console.log('\n=== Step 4: List all keys ===');
  const allKeys = await api('GET', '/api/admin/keys');
  console.log(JSON.stringify(allKeys, null, 2));

  console.log('\n=== Step 5: Test key1 → should route to account "1" ===');
  console.log(`Using key: ${rawKey1}`);
  const test1 = await new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'Qwen3',
      messages: [{role: 'user', content: 'Say OK only'}],
      stream: false,
    });
    const req = http.request({
      hostname: '127.0.0.1', port: 8080,
      path: '/v1/chat/completions', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawKey1}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  console.log('Status:', test1.status);
  if (test1.body?.error) console.log('Error:', test1.body.error.message || test1.body.error);
  else console.log('Response OK, has content:', !!test1.body?.choices?.[0]?.message?.content);

  console.log('\n=== Step 6: Test key2 → should route to account "2" ===');
  console.log(`Using key: ${rawKey2}`);
  const test2 = await new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'Qwen3',
      messages: [{role: 'user', content: 'Say OK only'}],
      stream: false,
    });
    const req = http.request({
      hostname: '127.0.0.1', port: 8080,
      path: '/v1/chat/completions', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawKey2}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  console.log('Status:', test2.status);
  if (test2.body?.error) console.log('Error:', test2.body.error.message || test2.body.error);
  else console.log('Response OK, has content:', !!test2.body?.choices?.[0]?.message?.content);

  console.log('\n=== DONE ===');
}

main().catch(console.error);