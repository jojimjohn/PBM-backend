/**
 * Debug Export Endpoint - See actual error message
 */
const http = require('http');

async function testExport() {
  console.log('\n🔍 Debug Export Endpoint\n');

  try {
    // Login first
    const loginData = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 5000,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        email: 'admin@alramrami.com',
        password: 'admin123',
        companyId: 'al-ramrami'
      }));
      req.end();
    });

    const token = loginData.data.accessToken;
    console.log('✅ Login successful\n');

    // Test export with full error details
    const exportRes = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 5000,
        path: '/api/reports/purchase-cost/export?format=csv',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('Status:', res.statusCode);
          console.log('Headers:', res.headers);
          console.log('Body:', data);
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    console.log('\nParsed response:', exportRes);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testExport();
