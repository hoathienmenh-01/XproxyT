/**
 * Database Module — Phase 13
 * 
 * SQLite storage using Node.js built-in `node:sqlite` (Node 24+).
 * Replaces JSON file storage with atomic, concurrent-safe SQLite + WAL mode.
 */

// node:sqlite is available in Node 24+. Use require for ts-node compatibility.
let DatabaseSync: any;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  // Fallback: will fail at runtime if Node < 24
}
import * as path from 'path';
import * as fs from 'fs';

/** Database instance */
let db: any = null;

/** Default database path */
const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'luna-proxy.db');

/** Currently active database path (updated on init) */
let activeDbPath: string = DEFAULT_DB_PATH;

/**
 * Initialize the database connection and create tables.
 */
export function initDatabase(dbPath?: string): any {
  const resolvedPath = dbPath || DEFAULT_DB_PATH;
  activeDbPath = resolvedPath;
  
  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (db) {
    db.close();
  }

  db = new DatabaseSync(resolvedPath);
  
  // Enable WAL mode for better concurrent access
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  
  // Create tables
  createTables(db);
  
  return db;
}

/**
 * Get the current database instance.
 */
export function getDatabase(): any {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create all required tables.
 */
function createTables(database: any): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      account_key TEXT PRIMARY KEY,
      request_count INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL DEFAULT (unixepoch()),
      last_429_at INTEGER
    )
  `);

  // API Keys table for SaaS-like authentication
  database.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      display_suffix TEXT NOT NULL,
      client_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for common queries
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)
  `);
}

// ===== Generic CRUD helpers =====

/**
 * Insert or replace a row in a table with JSON data.
 */
export function upsert(table: string, id: string, data: any): void {
  const database = getDatabase();
  // Use different SQL for tables without updated_at
  if (table === 'rate_limits') {
    const stmt = database.prepare(
      `INSERT OR REPLACE INTO ${table} (account_key, data) VALUES (?, ?)`
    );
    stmt.run(id, JSON.stringify(data));
  } else {
    const stmt = database.prepare(
      `INSERT OR REPLACE INTO ${table} (id, data, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())`
    );
    stmt.run(id, JSON.stringify(data));
  }
}

/**
 * Get a row by ID, parsing the JSON data column.
 */
export function getById(table: string, id: string): any | null {
  const database = getDatabase();
  const stmt = database.prepare(`SELECT data FROM ${table} WHERE id = ?`);
  const row = stmt.get(id) as any;
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

/**
 * Get all rows from a table, parsing JSON data.
 */
export function getAll(table: string, limit: number = 1000): any[] {
  const database = getDatabase();
  const stmt = database.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC LIMIT ?`);
  const rows = stmt.all(limit) as any[];
  return rows.map(row => {
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Delete a row by ID.
 */
export function deleteById(table: string, id: string): boolean {
  const database = getDatabase();
  const stmt = database.prepare(`DELETE FROM ${table} WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Count rows in a table.
 */
export function count(table: string): number {
  const database = getDatabase();
  const stmt = database.prepare(`SELECT COUNT(*) as count FROM ${table}`);
  const row = stmt.get() as any;
  return row?.count || 0;
}

// ===== Config-specific helpers =====

/**
 * Get a config value by key.
 */
export function getConfigValue(key: string): any | null {
  const database = getDatabase();
  const stmt = database.prepare('SELECT value FROM config WHERE key = ?');
  const row = stmt.get(key) as any;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

/**
 * Set a config value by key.
 */
export function setConfigValue(key: string, value: any): void {
  const database = getDatabase();
  const stmt = database.prepare(
    'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, unixepoch())'
  );
  stmt.run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

/**
 * Get all config values as an object.
 */
export function getAllConfig(): Record<string, any> {
  const database = getDatabase();
  const stmt = database.prepare('SELECT key, value FROM config');
  const rows = stmt.all() as any[];
  const config: Record<string, any> = {};
  for (const row of rows) {
    try {
      config[row.key] = JSON.parse(row.value);
    } catch {
      config[row.key] = row.value;
    }
  }
  return config;
}

// ===== Log-specific helpers =====

/**
 * Insert a log entry.
 */
export function insertLog(level: string, message: string, data?: any): void {
  const database = getDatabase();
  const stmt = database.prepare(
    'INSERT INTO logs (level, message, data, created_at) VALUES (?, ?, ?, unixepoch())'
  );
  stmt.run(level, message, data ? JSON.stringify(data) : null);
}

/**
 * Get recent log entries.
 */
export function getLogs(limit: number = 200, level?: string): any[] {
  const database = getDatabase();
  let sql = 'SELECT level, message, data, created_at FROM logs';
  const params: any[] = [];
  if (level) {
    sql += ' WHERE level = ?';
    params.push(level);
  }
  sql += ' ORDER BY rowid DESC LIMIT ?';
  params.push(limit);
  
  const stmt = database.prepare(sql);
  const rows = stmt.all(...params) as any[];
  return rows.map(row => ({
    level: row.level,
    message: row.message,
    data: row.data ? (() => { try { return JSON.parse(row.data); } catch { return row.data; } })() : null,
    createdAt: row.created_at,
  }));
}

/**
 * Clear all logs.
 */
export function clearLogs(): void {
  const database = getDatabase();
  database.exec('DELETE FROM logs');
}

/**
 * Get log statistics.
 */
export function getLogStats(): { total: number; byLevel: Record<string, number> } {
  const database = getDatabase();
  const total = (database.prepare('SELECT COUNT(*) as c FROM logs').get() as any)?.c || 0;
  const stmt = database.prepare('SELECT level, COUNT(*) as c FROM logs GROUP BY level');
  const rows = stmt.all() as any[];
  const byLevel: Record<string, number> = {};
  for (const row of rows) {
    byLevel[row.level] = row.c;
  }
  return { total, byLevel };
}

// ===== API Key helpers =====

export interface ApiKeyRow {
  id: string;
  key_hash: string;
  display_suffix: string;
  client_name: string | null;
  is_active: number;
  created_at: string;
}

/**
 * Insert a new API key record.
 */
export function insertApiKey(id: string, keyHash: string, displaySuffix: string, clientName: string): void {
  const database = getDatabase();
  const stmt = database.prepare(
    'INSERT INTO api_keys (id, key_hash, display_suffix, client_name) VALUES (?, ?, ?, ?)'
  );
  stmt.run(id, keyHash, displaySuffix, clientName);
}

/**
 * Look up an API key by its hash. Returns the row if found, null otherwise.
 */
export function getApiKeyByHash(keyHash: string): ApiKeyRow | null {
  const database = getDatabase();
  const stmt = database.prepare(
    'SELECT id, key_hash, display_suffix, client_name, is_active, created_at FROM api_keys WHERE key_hash = ?'
  );
  const row = stmt.get(keyHash) as ApiKeyRow | undefined;
  return row || null;
}

/**
 * Deactivate an API key by ID.
 */
export function deactivateApiKey(id: string): boolean {
  const database = getDatabase();
  const stmt = database.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * List all API keys.
 */
export function listApiKeys(): ApiKeyRow[] {
  const database = getDatabase();
  const stmt = database.prepare(
    'SELECT id, key_hash, display_suffix, client_name, is_active, created_at FROM api_keys ORDER BY created_at DESC'
  );
  return stmt.all() as ApiKeyRow[];
}

/**
 * Get database diagnostics.
 */
export function getDatabaseDiagnostics(): {
  path: string;
  tables: string[];
  rowCounts: Record<string, number>;
  walMode: boolean;
} {
  const database = getDatabase();
  
  // Get table names
  const tableRows = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all() as any[];
  const tables = tableRows.map(r => r.name);
  
  // Get row counts
  const rowCounts: Record<string, number> = {};
  for (const table of tables) {
    rowCounts[table] = count(table);
  }
  
  // Check WAL mode
  const journalMode = database.prepare('PRAGMA journal_mode').get() as any;
  
  return {
    path: activeDbPath,
    tables,
    rowCounts,
    walMode: journalMode?.journal_mode === 'wal',
  };
}