/**
 * Async Writer — non-blocking file I/O utilities.
 * Replaces synchronous fs.writeFileSync with queued async writes.
 * 
 * Benefits:
 * - No event loop blocking on file writes
 * - Debounced/batched writes for high-frequency updates
 * - Graceful error handling
 */

import fs from 'fs';
import path from 'path';

/** Queue of pending writes per file path */
const writeQueues = new Map<string, Promise<void>>();

/** Debounce timers for batched writes */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Latest debounced content per file path (for flush) */
const pendingDebouncedContent = new Map<string, string>();

/**
 * Write a file asynchronously without blocking the event loop.
 * If a write to the same path is already in progress, queues behind it.
 */
export async function writeFileAsync(filePath: string, content: string): Promise<void> {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      await fs.promises.writeFile(filePath, content, 'utf8');
    } catch (err) {
      console.warn(`[AsyncWriter] Failed to write ${filePath}:`, err instanceof Error ? err.message : err);
    }
  });
  writeQueues.set(filePath, next);
  return next;
}

/**
 * Write JSON file asynchronously with pretty formatting.
 */
export async function writeJsonAsync(filePath: string, data: any): Promise<void> {
  return writeFileAsync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Append to a file asynchronously. Creates file if it doesn't exist.
 */
export async function appendFileAsync(filePath: string, content: string): Promise<void> {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      await fs.promises.appendFile(filePath, content, 'utf8');
    } catch (err) {
      console.warn(`[AsyncWriter] Failed to append ${filePath}:`, err instanceof Error ? err.message : err);
    }
  });
  writeQueues.set(filePath, next);
  return next;
}

/**
 * Debounced write — only writes after `delayMs` of no new calls.
 * Useful for config/logs that change frequently but don't need immediate persistence.
 */
export function debouncedWrite(filePath: string, content: string, delayMs: number = 500): void {
  const existing = debounceTimers.get(filePath);
  if (existing) clearTimeout(existing);

  pendingDebouncedContent.set(filePath, content);
  debounceTimers.set(filePath, setTimeout(() => {
    debounceTimers.delete(filePath);
    pendingDebouncedContent.delete(filePath);
    writeFileAsync(filePath, content).catch(() => {});
  }, delayMs));
}

/**
 * Debounced JSON write.
 */
export function debouncedWriteJson(filePath: string, data: any, delayMs: number = 500): void {
  debouncedWrite(filePath, JSON.stringify(data, null, 2), delayMs);
}

/**
 * Flush all pending debounced writes immediately.
 * Call this on graceful shutdown.
 */
export async function flushAllPending(): Promise<void> {
  // Flush debounce timers — write their pending content immediately
  for (const [filePath, timer] of debounceTimers) {
    clearTimeout(timer);
  }
  const debouncedWrites: Promise<void>[] = [];
  for (const [filePath, content] of pendingDebouncedContent) {
    debouncedWrites.push(writeFileAsync(filePath, content).catch(() => {}));
  }
  debounceTimers.clear();
  pendingDebouncedContent.clear();

  // Wait for all queued writes (including debounced ones just triggered)
  const pending = Array.from(writeQueues.values());
  const all = [...pending, ...debouncedWrites];
  if (all.length > 0) {
    await Promise.allSettled(all);
  }
}

/**
 * Get count of pending writes (for diagnostics).
 */
export function pendingWriteCount(): number {
  return writeQueues.size + debounceTimers.size;
}