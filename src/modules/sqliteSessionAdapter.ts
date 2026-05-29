// @ts-nocheck
/**
 * SQLite Session Adapter — Phase A1
 * 
 * Provides SQLite-backed persistence for sessionStore.
 * Wraps database.ts generic CRUD with session-specific operations.
 * Uses lazy import to avoid breaking builds without node:sqlite.
 */

let _db: any = null;
let initialized = false;

function getDb() {
  if (!_db) {
    _db = require('./database');
  }
  return _db;
}

/**
 * Initialize SQLite database for session storage.
 */
export function initSqliteSessionDb(dbPath?: string): void {
  if (initialized) return;
  const db = getDb();
  db.initDatabase(dbPath);
  initialized = true;
}

/**
 * Save all sessions to SQLite (bulk upsert).
 */
export function saveSessionsToSqlite(sessions: Record<string, any>): void {
  if (!initialized) throw new Error('SQLite not initialized');
  const db = getDb();
  for (const [key, session] of Object.entries(sessions)) {
    const id = session.id || key.replace('session::', '');
    db.upsert('sessions', id, session);
  }
}

/**
 * Save a single session to SQLite.
 */
export function saveSessionToSqlite(session: any): void {
  if (!initialized) throw new Error('SQLite not initialized');
  getDb().upsert('sessions', session.id, session);
}

/**
 * Load all sessions from SQLite.
 */
export function loadSessionsFromSqlite(): Record<string, any> {
  if (!initialized) throw new Error('SQLite not initialized');
  const rows = getDb().getAll('sessions');
  const result: Record<string, any> = {};
  for (const row of rows) {
    const session = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    if (session && session.id) {
      result[`session::${session.id}`] = session;
    }
  }
  return result;
}

/**
 * Load a single session from SQLite.
 */
export function loadSessionFromSqlite(id: string): any | null {
  if (!initialized) return null;
  const row = getDb().getById('sessions', id);
  if (!row) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

/**
 * Delete a session from SQLite.
 */
export function deleteSessionFromSqlite(id: string): boolean {
  if (!initialized) return false;
  return getDb().deleteById('sessions', id);
}

/**
 * Check if SQLite backend is available.
 */
export function isSqliteInitialized(): boolean {
  return initialized;
}