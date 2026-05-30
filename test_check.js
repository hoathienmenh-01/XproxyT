const fs = require('fs');
const path = require('path');

// Find the new hashed JS file
const assetsDir = path.join(__dirname, 'public', 'assets');
const files = fs.readdirSync(assetsDir);
const jsFile = files.find(f => f.startsWith('proxy-luna-app') && f.endsWith('.js'));

console.log('=== Frontend JS Check ===');
console.log('JS files in assets:', files);
console.log('Found JS:', jsFile);

if (jsFile) {
  const jsContent = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');
  console.log('File size:', jsContent.length, 'bytes');
  console.log('Has Accounts & API Keys:', jsContent.includes('Accounts'));
  console.log('Has Thêm Tài Khoản:', jsContent.includes('Th'));
  console.log('Has api/admin/accounts:', jsContent.includes('api/admin/accounts'));
  console.log('Has api/admin/providers:', jsContent.includes('api/admin/providers'));
}

// Check index.html
const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
console.log('\n=== index.html ===');
console.log('References:', indexHtml.match(/src="[^"]+"/)?.[0]);