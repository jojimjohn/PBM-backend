/**
 * Check MFA status for a user
 * Run: node scripts/check-mfa-status.js
 */

require('dotenv').config();
const { initializeDatabases, getDbConnection } = require('../config/database');

async function checkMfaStatus() {
  try {
    await initializeDatabases();
    const db = getDbConnection('al-ramrami');

    const user = await db('users')
      .where({ email: 'admin@alramrami.com' })
      .select('id', 'email', 'mfa_enabled', 'mfa_secret', 'mfa_verified_at', 'mfa_last_used')
      .first();

    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }

    console.log('\n📋 MFA Status for:', user.email);
    console.log('─'.repeat(50));
    console.log('User ID:', user.id);
    console.log('MFA Enabled:', user.mfa_enabled ? '✅ Yes' : '❌ No');
    console.log('MFA Secret:', user.mfa_secret ? '✅ Set' : '❌ Not set');
    console.log('MFA Verified At:', user.mfa_verified_at || 'Not verified');
    console.log('MFA Last Used:', user.mfa_last_used || 'Never');
    console.log('─'.repeat(50));

    // Check if MFA should trigger on login
    const willRequireMfa = user.mfa_enabled && user.mfa_verified_at;
    console.log('\n🔐 Will require MFA on login:', willRequireMfa ? '✅ Yes' : '❌ No');

    if (!willRequireMfa) {
      if (!user.mfa_enabled) {
        console.log('   → Reason: mfa_enabled is false');
      }
      if (!user.mfa_verified_at) {
        console.log('   → Reason: mfa_verified_at is null (setup not completed)');
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkMfaStatus();
