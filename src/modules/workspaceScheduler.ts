/**
 * Workspace-aware Scheduling — Avoid file conflicts and context collision between multiple agents.
 *
 * When multiple Cline/Claude Code tabs run simultaneously, they may:
 * - Edit the same file concurrently → corruption
 * - Use stale context after another agent modifies a file
 * - Create conflicting tool call results
 *
 * This module provides:
 * - File-level locks (only one agent can edit a file at a time)
 * - Workspace health tracking (which files are "hot")
 * - Conflict detection before tool execution
 * - Stale context detection after file changes
 */

export interface FileLock {
  filePath: string;
  ownerSessionId: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface WorkspaceState {
  /** Map of filePath → active lock */
  locks: Map<string, FileLock>;
  /** Map of filePath → last modified timestamp */
  fileTimestamps: Map<string, number>;
  /** Map of sessionId → set of locked files */
  sessionLocks: Map<string, Set<string>>;
  /** Recent file change events */
  recentChanges: FileChangeEvent[];
}

export interface FileChangeEvent {
  filePath: string;
  sessionId: string;
  action: 'write' | 'replace' | 'delete';
  timestamp: number;
}

export interface LockResult {
  acquired: boolean;
  filePath: string;
  ownerSessionId?: string;
  waitMs?: number;
  reason?: string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingSession?: string;
  conflictingFile?: string;
  reason?: string;
}

const DEFAULT_LOCK_TIMEOUT_MS = 60_000; // 1 minute
const MAX_RECENT_CHANGES = 100;
const CONFLICT_WINDOW_MS = 5_000; // 5 seconds

// Global workspace state
const workspaceState: WorkspaceState = {
  locks: new Map(),
  fileTimestamps: new Map(),
  sessionLocks: new Map(),
  recentChanges: [],
};

/**
 * Acquire a file lock for a session.
 * Returns immediately with success/failure.
 */
export function acquireFileLock(
  filePath: string,
  sessionId: string,
  timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
): LockResult {
  const normalized = normalizePath(filePath);
  const existing = workspaceState.locks.get(normalized);

  // Check if existing lock is expired
  if (existing && existing.expiresAt < Date.now()) {
    releaseFileLock(normalized, existing.ownerSessionId);
  }

  // Check if file is already locked by another session
  const current = workspaceState.locks.get(normalized);
  if (current && current.ownerSessionId !== sessionId) {
    return {
      acquired: false,
      filePath: normalized,
      ownerSessionId: current.ownerSessionId,
      reason: `File locked by session ${current.ownerSessionId}`,
    };
  }

  // Acquire or refresh lock
  const lock: FileLock = {
    filePath: normalized,
    ownerSessionId: sessionId,
    acquiredAt: Date.now(),
    expiresAt: Date.now() + timeoutMs,
  };

  workspaceState.locks.set(normalized, lock);

  // Track session locks
  if (!workspaceState.sessionLocks.has(sessionId)) {
    workspaceState.sessionLocks.set(sessionId, new Set());
  }
  workspaceState.sessionLocks.get(sessionId)!.add(normalized);

  return {
    acquired: true,
    filePath: normalized,
  };
}

/**
 * Release a file lock.
 */
export function releaseFileLock(filePath: string, sessionId: string): boolean {
  const normalized = normalizePath(filePath);
  const lock = workspaceState.locks.get(normalized);

  if (!lock || lock.ownerSessionId !== sessionId) {
    return false;
  }

  workspaceState.locks.delete(normalized);

  const sessionFiles = workspaceState.sessionLocks.get(sessionId);
  if (sessionFiles) {
    sessionFiles.delete(normalized);
    if (sessionFiles.size === 0) {
      workspaceState.sessionLocks.delete(sessionId);
    }
  }

  return true;
}

/**
 * Release all locks owned by a session.
 * Called when a session ends or disconnects.
 */
export function releaseSessionLocks(sessionId: string): number {
  const sessionFiles = workspaceState.sessionLocks.get(sessionId);
  if (!sessionFiles) return 0;

  let released = 0;
  for (const filePath of sessionFiles) {
    if (workspaceState.locks.delete(filePath)) {
      released++;
    }
  }
  workspaceState.sessionLocks.delete(sessionId);
  return released;
}

/**
 * Record a file change event.
 * Used to detect stale context in other sessions.
 */
export function recordFileChange(
  filePath: string,
  sessionId: string,
  action: 'write' | 'replace' | 'delete',
): void {
  const normalized = normalizePath(filePath);
  const event: FileChangeEvent = {
    filePath: normalized,
    sessionId,
    action,
    timestamp: Date.now(),
  };

  workspaceState.fileTimestamps.set(normalized, Date.now());
  workspaceState.recentChanges.push(event);

  // Trim old changes
  if (workspaceState.recentChanges.length > MAX_RECENT_CHANGES) {
    workspaceState.recentChanges = workspaceState.recentChanges.slice(-MAX_RECENT_CHANGES);
  }
}

/**
 * Check if a file was recently modified by another session.
 * Returns true if the file has stale context.
 */
export function isFileStale(
  filePath: string,
  sessionId: string,
  sinceTimestamp?: number,
): boolean {
  const normalized = normalizePath(filePath);
  const lastModified = workspaceState.fileTimestamps.get(normalized);

  if (!lastModified) return false;

  // Check if modified by another session
  const relevantChanges = workspaceState.recentChanges.filter(
    c => c.filePath === normalized && c.sessionId !== sessionId,
  );

  if (relevantChanges.length === 0) return false;

  const cutoff = sinceTimestamp || Date.now() - CONFLICT_WINDOW_MS;
  return relevantChanges.some(c => c.timestamp > cutoff);
}

/**
 * Detect potential conflicts before executing a tool call.
 * Checks if the target file is being edited by another session.
 */
export function checkConflict(
  filePath: string,
  sessionId: string,
): ConflictCheckResult {
  const normalized = normalizePath(filePath);
  const lock = workspaceState.locks.get(normalized);

  if (lock && lock.ownerSessionId !== sessionId && lock.expiresAt > Date.now()) {
    return {
      hasConflict: true,
      conflictingSession: lock.ownerSessionId,
      conflictingFile: normalized,
      reason: `File ${normalized} is locked by session ${lock.ownerSessionId}`,
    };
  }

  // Check recent changes
  if (isFileStale(normalized, sessionId)) {
    const recentChange = workspaceState.recentChanges
      .filter(c => c.filePath === normalized && c.sessionId !== sessionId)
      .pop();

    return {
      hasConflict: true,
      conflictingSession: recentChange?.sessionId,
      conflictingFile: normalized,
      reason: `File ${normalized} was recently modified by session ${recentChange?.sessionId}`,
    };
  }

  return { hasConflict: false };
}

/**
 * Get files that are currently locked (hot files).
 * Useful for diagnostics and logging.
 */
export function getHotFiles(): Array<{ filePath: string; ownerSession: string; ageMs: number }> {
  const now = Date.now();
  const result: Array<{ filePath: string; ownerSession: string; ageMs: number }> = [];

  for (const [filePath, lock] of workspaceState.locks) {
    if (lock.expiresAt > now) {
      result.push({
        filePath,
        ownerSession: lock.ownerSessionId,
        ageMs: now - lock.acquiredAt,
      });
    }
  }

  return result;
}

/**
 * Get workspace diagnostics for logging.
 */
export function getWorkspaceDiagnostics(): {
  activeLocks: number;
  trackedSessions: number;
  recentChangeCount: number;
  hotFiles: string[];
} {
  const now = Date.now();
  const activeLocks = Array.from(workspaceState.locks.values()).filter(l => l.expiresAt > now);

  return {
    activeLocks: activeLocks.length,
    trackedSessions: workspaceState.sessionLocks.size,
    recentChangeCount: workspaceState.recentChanges.length,
    hotFiles: activeLocks.map(l => l.filePath),
  };
}

/**
 * Expire all locks older than maxAgeMs.
 * Should be called periodically to clean up stale locks.
 */
export function cleanupExpiredLocks(maxAgeMs: number = DEFAULT_LOCK_TIMEOUT_MS): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [filePath, lock] of workspaceState.locks) {
    if (lock.expiresAt < now || (now - lock.acquiredAt) > maxAgeMs) {
      workspaceState.locks.delete(filePath);
      const sessionFiles = workspaceState.sessionLocks.get(lock.ownerSessionId);
      if (sessionFiles) {
        sessionFiles.delete(filePath);
        if (sessionFiles.size === 0) {
          workspaceState.sessionLocks.delete(lock.ownerSessionId);
        }
      }
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Clear all workspace state.
 * Useful for testing.
 */
export function clearWorkspaceState(): void {
  workspaceState.locks.clear();
  workspaceState.fileTimestamps.clear();
  workspaceState.sessionLocks.clear();
  workspaceState.recentChanges.length = 0;
}

/**
 * Normalize file path for consistent comparison.
 */
function normalizePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/') // Normalize backslashes
    .replace(/\/+/g, '/') // Remove duplicate slashes
    .replace(/\/$/, ''); // Remove trailing slash
}