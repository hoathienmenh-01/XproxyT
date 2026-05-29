/**
 * Phase 13 — SQLite Database Tests
 */

import { describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync } from './utils';

const mod = require('../src/modules/database');
const {
  initDatabase,
  closeDatabase,
  upsert,
  getById,
  getAll,
  deleteById,
  count,
  getConfigValue,
  setConfigValue,
  getAllConfig,
  insertLog,
  getLogs,
  clearLogs,
  getLogStats,
  getDatabaseDiagnostics,
} = mod;

const path = require('path');
const fs = require('fs');
const os = require('os');

// Use a temp database for testing
const TEST_DB = path.join(os.tmpdir(), `luna-test-${Date.now()}.db`);

// ===== Section DB.1 — Database initialization =====
describe('DB.1 — Database initialization', () => {
  it('initializes database with tables', () => {
    const db = initDatabase(TEST_DB);
    assertTrue(db !== null, 'database created');
    assertTrue(fs.existsSync(TEST_DB), 'db file exists');
  });

  it('creates all required tables', () => {
    const diag = getDatabaseDiagnostics();
    assertTrue(diag.tables.includes('sessions'), 'sessions table');
    assertTrue(diag.tables.includes('config'), 'config table');
    assertTrue(diag.tables.includes('logs'), 'logs table');
    assertTrue(diag.tables.includes('runs'), 'runs table');
    assertTrue(diag.tables.includes('rate_limits'), 'rate_limits table');
    assertTrue(diag.walMode, 'WAL mode enabled');
  });
});

// ===== Section DB.2 — Generic CRUD =====
describe('DB.2 — Generic CRUD', () => {
  it('upserts and retrieves a session', () => {
    const sessionData = { id: 'sess-1', model: 'qwen3', messages: ['hello'] };
    upsert('sessions', 'sess-1', sessionData);
    const retrieved = getById('sessions', 'sess-1');
    assertEqual(retrieved.id, 'sess-1', 'id matches');
    assertEqual(retrieved.model, 'qwen3', 'model matches');
  });

  it('overwrites existing row on upsert', () => {
    upsert('sessions', 'sess-2', { version: 1 });
    upsert('sessions', 'sess-2', { version: 2 });
    const retrieved = getById('sessions', 'sess-2');
    assertEqual(retrieved.version, 2, 'version updated');
  });

  it('returns null for non-existent ID', () => {
    const result = getById('sessions', 'nonexistent');
    assertEqual(result, null, 'null for missing');
  });

  it('gets all rows', () => {
    upsert('runs', 'run-1', { status: 'completed' });
    upsert('runs', 'run-2', { status: 'failed' });
    const all = getAll('runs');
    assertTrue(all.length >= 2, 'at least 2 rows');
  });

  it('deletes a row', () => {
    upsert('sessions', 'sess-del', { test: true });
    assertTrue(count('sessions') > 0, 'has rows');
    const deleted = deleteById('sessions', 'sess-del');
    assertTrue(deleted, 'deleted');
    assertEqual(getById('sessions', 'sess-del'), null, 'gone');
  });

  it('counts rows', () => {
    const before = count('sessions');
    upsert('sessions', 'count-test', { data: 'test' });
    const after = count('sessions');
    assertTrue(after >= before, 'count increased');
  });

  it('handles complex nested JSON data', () => {
    const complex = {
      nested: { deeply: { value: 42 } },
      array: [1, 2, 3],
      unicode: '日本語テスト',
      nullField: null,
    };
    upsert('sessions', 'complex-test', complex);
    const retrieved = getById('sessions', 'complex-test');
    assertEqual(retrieved.nested.deeply.value, 42, 'nested value');
    assertEqual(retrieved.array.length, 3, 'array length');
    assertEqual(retrieved.unicode, '日本語テスト', 'unicode');
    assertEqual(retrieved.nullField, null, 'null field');
  });
});

// ===== Section DB.3 — Config helpers =====
describe('DB.3 — Config helpers', () => {
  it('sets and gets config value', () => {
    setConfigValue('testKey', { enabled: true });
    const value = getConfigValue('testKey');
    assertTrue(value.enabled, 'config value');
  });

  it('overwrites config value', () => {
    setConfigValue('overwrite', 'v1');
    setConfigValue('overwrite', 'v2');
    assertEqual(getConfigValue('overwrite'), 'v2', 'overwritten');
  });

  it('returns null for missing config', () => {
    const value = getConfigValue('missing_key');
    assertEqual(value, null, 'null for missing');
  });

  it('gets all config as object', () => {
    setConfigValue('key1', 'val1');
    setConfigValue('key2', { nested: true });
    const all = getAllConfig();
    assertTrue('key1' in all, 'has key1');
    assertTrue('key2' in all, 'has key2');
  });
});

// ===== Section DB.4 — Log helpers =====
describe('DB.4 — Log helpers', () => {
  it('inserts and retrieves logs', () => {
    clearLogs();
    insertLog('info', 'test message', { requestId: 'abc' });
    const logs = getLogs(10);
    assertTrue(logs.length > 0, 'has logs');
    assertEqual(logs[0].level, 'info', 'level');
    assertEqual(logs[0].message, 'test message', 'message');
  });

  it('filters logs by level', () => {
    clearLogs();
    insertLog('info', 'info msg');
    insertLog('error', 'error msg');
    insertLog('warn', 'warn msg');
    const errors = getLogs(100, 'error');
    assertTrue(errors.length > 0, 'has errors');
    assertTrue(errors.every((l: any) => l.level === 'error'), 'only errors');
  });

  it('clears all logs', () => {
    insertLog('info', 'to be cleared');
    clearLogs();
    const logs = getLogs(100);
    assertEqual(logs.length, 0, 'cleared');
  });

  it('gets log statistics', () => {
    clearLogs();
    insertLog('info', 'msg1');
    insertLog('info', 'msg2');
    insertLog('error', 'msg3');
    const stats = getLogStats();
    assertTrue(stats.total >= 3, 'total >= 3');
    assertTrue(stats.byLevel['info'] >= 2, 'info count');
    assertTrue(stats.byLevel['error'] >= 1, 'error count');
  });
});

// ===== Section DB.5 — Diagnostics =====
describe('DB.5 — Database diagnostics', () => {
  it('returns diagnostics with all tables', () => {
    const diag = getDatabaseDiagnostics();
    assertTrue(diag.tables.length >= 5, 'at least 5 tables');
    assertTrue(diag.walMode, 'WAL mode');
    assertTrue(diag.path.includes('luna-test'), 'test db path');
    assertTrue('sessions' in diag.rowCounts, 'sessions rowcount');
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