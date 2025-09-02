#!/usr/bin/env node
/**
 * Get Railway's current public IP for database whitelisting
 * Run with: node get-railway-ip.js
 */

const https = require('https');

async function getRailwayIP() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'pbm-backend-production.up.railway.app',
      path: '/api/auth/server-info',
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve(info.serverInfo.publicIP);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    const ip = await getRailwayIP();
    console.log(`Current Railway IP: ${ip}`);
    console.log(`Add this to your MySQL allowed hosts: ${ip}`);
    console.log(`Or whitelist the range: 162.220.232.0/24`);
  } catch (error) {
    console.error('Error getting Railway IP:', error.message);
  }
}

main();