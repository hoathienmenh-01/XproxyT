/**
 * Phase 16 — Migration Tests
 */

import { describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync } from './utils';

const mod = require('../src/modules/migrate');
const { migrateToJson, backupJsonFiles, verifyMigration } = mod;

const dbMod = require('../src/modules/database');
const { initDatabase, closeDatabase, getById, getConfigValue } = dbMod;

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `luna-migrate-${Date.now()}.db`);

// ===== Section MG.1 — Migration functions exist =====
describe('MG.1 — Migration module exports', () => {
  it('exports migrateToJson function', () => {
    assertTrue(typeof migrateToJson === 'function', 'migrateToJson exists');
  });

  it('exports backupJsonFiles function', () => {
    assertTrue(typeof backupJsonFiles === 'function', 'backupJsonFiles exists');
  });

  it('exports verifyMigration function', () => {
    assertTrue(typeof verifyMigration === 'function', 'verifyMigration exists');
  });
});

// ===== Section MG.2 — Migration with no data =====
describe('MG.2 — Migration with no JSON files', () => {
  it('returns success with zero counts when no files exist', async () => {
    initDatabase(TEST_DB);
    const result = await migrateToJson(TEST_DB);
    assertTrue(result.success || result.migrated.sessions === 0, 'no sessions to migrate');
    assertTrue(result.migrated.sessions === 0, 'zero sessions');
    assertTrue(result.migrated.config === 0, 'zero config');
    assertTrue(result.migrated.logs === 0, 'zero logs');
    assertTrue(result.migrated.runs === 0, 'zero runs');
    closeDatabase();
  });
});

// ===== Section MG.3 — Backup functions =====
describe('MG.3 — Backup functions', () => {
  it('backupJsonFiles returns result object', () => {
    const result = backupJsonFiles();
    assertTrue(Array.isArray(result.backed), 'backed is array');
    assertTrue(Array.isArray(result.errors), 'errors is array');
  });

  it('verifyMigration returns result object', () => {
    const result = verifyMigration();
    assertTrue(typeof result.verified === 'boolean', 'verified is boolean');
    assertTrue(typeof result.details === 'object', 'details is object');
  });
});

// Cleanup
flushAsync().then(() => {
  printSummary();
  closeDatabase();
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
});