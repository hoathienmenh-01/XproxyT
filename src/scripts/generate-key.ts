#!/usr/bin/env node
/**
 * API Key Generator Script
 * 
 * Generates a new API key, hashes it with SHA-256, and stores in SQLite.
 * Run: npx ts-node src/scripts/generate-key.ts [client-name]
 */

import * as crypto from 'crypto';
import * as path from 'path';
import { initDatabase, insertApiKey } from '../modules/database';

function generateApiKey(clientName: string): string {
  // Initialize database
  initDatabase();

  // Generate random 32 bytes as hex
  const randomHex = crypto.randomBytes(32).toString('hex');
  
  // Create raw key in format: sk-luna-{random_hex}
  const rawKey = `sk-luna-${randomHex}`;
  
  // Hash the raw key with SHA-256
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  
  // Get last 4 characters as display suffix
  const displaySuffix = rawKey.slice(-4);
  
  // Generate unique ID
  const id = crypto.randomUUID();
  
  // Insert into database
  insertApiKey(id, keyHash, displaySuffix, clientName);
  
  return rawKey;
}

// Main execution
const clientName = process.argv[2] || 'default-client';

try {
  const rawKey = generateApiKey(clientName);
  
  console.log('========================================');
  console.log('  Luna-Proxy API Key Generated');
  console.log('========================================');
  console.log(`  Client: ${clientName}`);
  console.log(`  Key:    ${rawKey}`);
  console.log('');
  console.log('  ⚠️  Copy this key now! It will NOT be shown again.');
  console.log('========================================');
} catch (err) {
  console.error('Failed to generate API key:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}