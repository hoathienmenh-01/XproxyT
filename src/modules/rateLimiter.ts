/**
 * Rate Limiter — Protect Qwen accounts from abuse and rate limit errors.
 *
 * When multiple clients hit the proxy simultaneously or a client makes
 * rapid-fire requests, we need to:
 * - Track request rates per account
 * - Enforce configurable rate limits
 * - Provide backpressure signals
 * - Support per-account and global limits
 * - Handle 429 rate-limit responses with cooldown
 */

export interface RateLimiterConfig {
  /** Maximum requests per window per account */
  maxRequestsPerWindow: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Cooldown period after a 429 response (ms) */
  cooldownMs: number;
  /** Maximum concurrent requests per account */
  maxConcurrent: number;
  /** Enable global rate limit across all accounts */
  globalMaxRequestsPerWindow: number;
  /** Global window duration in milliseconds */
  globalWindowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  remainingInWindow?: number;
}

export interface AccountRateState {
  /** Request timestamps in current window */
  requestTimestamps: number[];
  /** Current concurrent requests */
  concurrentCount: number;
  /** Whether account is in cooldown from 429 */
  inCooldown: boolean;
  /** When cooldown expires */
  cooldownExpiresAt: number;
  /** Total requests served */
  totalRequests: number;
  /** Total rejected requests */
  totalRejected: number;
  /** Last 429 timestamp */
  last429At: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequestsPerWindow: 30,
  windowMs: 60_000, // 1 minute
  cooldownMs: 30_000, // 30 seconds
  maxConcurrent: 3,
  globalMaxRequestsPerWindow: 100,
  globalWindowMs: 60_000,
};

// Per-account state
const accountStates = new Map<string, AccountRateState>();

// Global state
let globalRequestTimestamps: number[] = [];
let globalTotalRequests = 0;
let globalTotalRejected = 0;

// Config
let config: RateLimiterConfig = { ...DEFAULT_CONFIG };

// ===== Promise Queue for Burst Traffic =====
// When concurrent limit is hit, requests are queued instead of rejected.
// They wait (via Promise) until a slot frees up, then proceed.
// Only rejected with 429 if they wait longer than queueTimeoutMs.

interface QueuedRequest {
  accountId: string;
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

/** Per-account request queues */
const accountQueues = new Map<string, QueuedRequest[]>();

/** Global queue stats */
let globalQueuedCount = 0;
let globalTotalQueued = 0;
let globalTotalQueueTimeouts = 0;

/**
 * Process the queue for a given account when a slot frees up.
 * Called internally after release().
 */
function processQueue(accountId: string): void {
  const queue = accountQueues.get(accountId);
  if (!queue || queue.length === 0) return;

  // Check if a slot is actually available now
  const state = getOrCreateState(accountId);
  if (state.inCooldown) return; // Don't dequeue during cooldown
  if (state.concurrentCount >= config.maxConcurrent) return; // Still full

  // Also check per-account rate limit
  const now = Date.now();
  state.requestTimestamps = state.requestTimestamps.filter(
    t => now - t < config.windowMs,
  );
  if (state.requestTimestamps.length >= config.maxRequestsPerWindow) return; // Rate limited

  // Dequeue the next request
  const next = queue.shift();
  if (!next) return;

  globalQueuedCount--;

  // Clear its timeout timer
  if (next.timeoutTimer) {
    clearTimeout(next.timeoutTimer);
  }

  // Acquire the slot for this request
  state.requestTimestamps.push(now);
  state.concurrentCount++;
  state.totalRequests++;
  globalRequestTimestamps.push(now);
  globalTotalRequests++;

  // Resolve the waiting request — it can now proceed
  next.resolve();

  // Process next in queue if more slots available (recursive)
  if (queue.length > 0) {
    // Use setTimeout to avoid deep recursion
    setTimeout(() => processQueue(accountId), 0);
  }
}

/**
 * Configure the rate limiter.
 */
export function configureRateLimiter(overrides: Partial<RateLimiterConfig>): void {
  config = { ...DEFAULT_CONFIG, ...overrides };
}

/**
 * Get current rate limiter configuration.
 */
export function getRateLimiterConfig(): RateLimiterConfig {
  return { ...config };
}

/**
 * Check if a request is allowed for the given account.
 * Does NOT increment counters — call `acquireRequest()` after.
 */
export function checkRateLimit(accountId: string): RateLimitResult {
  const now = Date.now();

  // Check cooldown from 429
  const state = getOrCreateState(accountId);
  if (state.inCooldown && now < state.cooldownExpiresAt) {
    return {
      allowed: false,
      reason: `Account ${accountId} is in cooldown after 429`,
      retryAfterMs: state.cooldownExpiresAt - now,
    };
  }

  // Clear expired cooldown
  if (state.inCooldown && now >= state.cooldownExpiresAt) {
    state.inCooldown = false;
  }

  // Check concurrent limit
  if (state.concurrentCount >= config.maxConcurrent) {
    return {
      allowed: false,
      reason: `Account ${accountId} at concurrent limit (${state.concurrentCount}/${config.maxConcurrent})`,
      retryAfterMs: 1000, // Retry in 1s
    };
  }

  // Clean old timestamps outside window
  state.requestTimestamps = state.requestTimestamps.filter(
    t => now - t < config.windowMs,
  );

  // Check per-account rate limit
  if (state.requestTimestamps.length >= config.maxRequestsPerWindow) {
    const oldestInWindow = state.requestTimestamps[0];
    return {
      allowed: false,
      reason: `Account ${accountId} at rate limit (${state.requestTimestamps.length}/${config.maxRequestsPerWindow})`,
      retryAfterMs: config.windowMs - (now - oldestInWindow),
      remainingInWindow: 0,
    };
  }

  // Check global rate limit
  globalRequestTimestamps = globalRequestTimestamps.filter(
    t => now - t < config.globalWindowMs,
  );

  if (globalRequestTimestamps.length >= config.globalMaxRequestsPerWindow) {
    const oldestGlobal = globalRequestTimestamps[0];
    return {
      allowed: false,
      reason: `Global rate limit reached (${globalRequestTimestamps.length}/${config.globalMaxRequestsPerWindow})`,
      retryAfterMs: config.globalWindowMs - (now - oldestGlobal),
      remainingInWindow: 0,
    };
  }

  return {
    allowed: true,
    remainingInWindow: config.maxRequestsPerWindow - state.requestTimestamps.length,
  };
}

/**
 * Acquire a request slot for the given account.
 * Call this BEFORE making the request.
 * Returns a release function to call when the request completes.
 * (Original behavior — immediate reject if limit hit)
 */
export function acquireRequest(accountId: string): {
  acquired: boolean;
  release: () => void;
  result: RateLimitResult;
} {
  const check = checkRateLimit(accountId);
  if (!check.allowed) {
    return {
      acquired: false,
      release: () => {},
      result: check,
    };
  }

  const now = Date.now();
  const state = getOrCreateState(accountId);
  state.requestTimestamps.push(now);
  state.concurrentCount++;
  state.totalRequests++;
  globalRequestTimestamps.push(now);
  globalTotalRequests++;

  let released = false;
  return {
    acquired: true,
    release: () => {
      if (released) return;
      released = true;
      state.concurrentCount = Math.max(0, state.concurrentCount - 1);
      // Process queued requests waiting for this account
      processQueue(accountId);
    },
    result: { allowed: true },
  };
}

/**
 * Acquire a request slot with Promise Queue (Burst Traffic Handler).
 * 
 * Instead of rejecting with 429 when concurrent limit is hit, this function
 * puts the request into a FIFO queue and waits (via Promise) until a slot
 * frees up. Only rejects with 429 if:
 * - Request is in cooldown (upstream 429)
 * - Per-account rate limit exceeded (30 req/min)
 * - Global rate limit exceeded (100 req/min)
 * - Queue timeout exceeded (default 120s)
 * 
 * Usage:
 *   const { promise, cancel } = acquireRequestWithQueue(accountId);
 *   ctx.res.on('close', cancel); // cleanup on client disconnect
 *   const release = await promise;
 *   // ... make the upstream request ...
 *   release();
 */
export function acquireRequestWithQueue(accountId: string, queueTimeoutMs = 120_000): { promise: Promise<() => void>; cancel: () => void } {
  let queueCancelled = false;
  let releaseFn: (() => void) | null = null;
  let queuedRef: QueuedRequest | null = null;
  let settledRef = false;
  let timeoutTimerRef: ReturnType<typeof setTimeout> | null = null;
  let queueRef: QueuedRequest[] | null = null;

  // Cancel function — remove from queue if still waiting, or no-op if already resolved
  const cancel = () => {
    queueCancelled = true;

    // If already settled (resolved or rejected), nothing to do
    if (settledRef) return;

    // If in queue (not yet resolved), remove and reject
    if (queuedRef && queueRef) {
      settledRef = true;

      // Clear timeout timer
      if (timeoutTimerRef) {
        clearTimeout(timeoutTimerRef);
        timeoutTimerRef = null;
      }

      // Remove from queue array
      const idx = queueRef.indexOf(queuedRef);
      if (idx !== -1) queueRef.splice(idx, 1);

      globalQueuedCount--;
      const st = getOrCreateState(accountId);
      st.totalRejected++;
      globalTotalRejected++;
    }
    // If already resolved (request running upstream), cancel is no-op
    // The caller should handle abort via AbortController separately
  };

  const promise = new Promise<() => void>((resolve, reject) => {
    // If already cancelled before promise body runs
    if (queueCancelled) {
      reject(new Error('Request cancelled while in queue'));
      return;
    }

    const now = Date.now();

    // Check cooldown — reject immediately, don't queue
    const state = getOrCreateState(accountId);
    if (state.inCooldown && now < state.cooldownExpiresAt) {
      state.totalRejected++;
      globalTotalRejected++;
      reject(new Error(`429: Account ${accountId} in cooldown. Retry after ${state.cooldownExpiresAt - now}ms`));
      return;
    }

    // Clear expired cooldown
    if (state.inCooldown && now >= state.cooldownExpiresAt) {
      state.inCooldown = false;
    }

    // Check per-account rate limit — reject immediately, don't queue
    state.requestTimestamps = state.requestTimestamps.filter(
      t => now - t < config.windowMs,
    );
    if (state.requestTimestamps.length >= config.maxRequestsPerWindow) {
      state.totalRejected++;
      globalTotalRejected++;
      reject(new Error(`429: Account ${accountId} at rate limit (${state.requestTimestamps.length}/${config.maxRequestsPerWindow})`));
      return;
    }

    // Check global rate limit — reject immediately, don't queue
    globalRequestTimestamps = globalRequestTimestamps.filter(
      t => now - t < config.globalWindowMs,
    );
    if (globalRequestTimestamps.length >= config.globalMaxRequestsPerWindow) {
      globalTotalRejected++;
      reject(new Error(`429: Global rate limit reached (${globalRequestTimestamps.length}/${config.globalMaxRequestsPerWindow})`));
      return;
    }

    // If concurrent slot available — acquire immediately (no queue needed)
    if (state.concurrentCount < config.maxConcurrent) {
      // Check if cancelled while acquiring
      if (queueCancelled) {
        reject(new Error('Request cancelled while acquiring slot'));
        return;
      }

      state.requestTimestamps.push(now);
      state.concurrentCount++;
      state.totalRequests++;
      globalRequestTimestamps.push(now);
      globalTotalRequests++;

      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        state.concurrentCount = Math.max(0, state.concurrentCount - 1);
        processQueue(accountId);
      });
      return;
    }

    // Concurrent limit hit — enqueue instead of rejecting
    if (!accountQueues.has(accountId)) {
      accountQueues.set(accountId, []);
    }
    const queue = accountQueues.get(accountId)!;
    queueRef = queue;

    globalQueuedCount++;
    globalTotalQueued++;

    let settled = false;
    settledRef = false;

    // Set queue timeout — if waiting too long, reject with 429
    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      settledRef = true;

      // Remove from queue
      const idx = queue.indexOf(queued);
      if (idx !== -1) queue.splice(idx, 1);

      globalQueuedCount--;
      globalTotalQueueTimeouts++;
      state.totalRejected++;
      globalTotalRejected++;

      reject(new Error(`429: Queue timeout for account ${accountId} after ${queueTimeoutMs}ms. Concurrent: ${state.concurrentCount}/${config.maxConcurrent}`));
    }, queueTimeoutMs);
    timeoutTimerRef = timeoutTimer;

    const queued: QueuedRequest = {
      accountId,
      resolve: () => {
        if (settled) return;
        settled = true;
        settledRef = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);

        // If cancelled while in queue, don't acquire the slot
        if (queueCancelled) {
          // Release the slot we just acquired back
          const st = getOrCreateState(accountId);
          st.concurrentCount = Math.max(0, st.concurrentCount - 1);
          processQueue(accountId);
          reject(new Error('Request cancelled while in queue'));
          return;
        }

        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          const st = getOrCreateState(accountId);
          st.concurrentCount = Math.max(0, st.concurrentCount - 1);
          processQueue(accountId);
        });
      },
      reject: (err: Error) => {
        if (settled) return;
        settled = true;
        settledRef = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        reject(err);
      },
      enqueuedAt: now,
      timeoutTimer,
    };
    queuedRef = queued;

    queue.push(queued);
  });

  return { promise, cancel };
}

/**
 * Get queue diagnostics.
 */
export function getQueueDiagnostics(): {
  queuedCount: number;
  totalQueued: number;
  totalQueueTimeouts: number;
  perAccountQueueSizes: Record<string, number>;
} {
  const perAccount: Record<string, number> = {};
  for (const [id, queue] of accountQueues) {
    if (queue.length > 0) perAccount[id] = queue.length;
  }
  return {
    queuedCount: globalQueuedCount,
    totalQueued: globalTotalQueued,
    totalQueueTimeouts: globalTotalQueueTimeouts,
    perAccountQueueSizes: perAccount,
  };
}

/**
 * Report a 429 rate-limit response from upstream.
 * Puts the account into cooldown.
 */
export function report429(accountId: string, retryAfterMs?: number): void {
  const state = getOrCreateState(accountId);
  state.inCooldown = true;
  state.last429At = Date.now();
  state.cooldownExpiresAt = Date.now() + (retryAfterMs || config.cooldownMs);
  state.totalRejected++;
  globalTotalRejected++;
}

/**
 * Get rate limit diagnostics for an account.
 */
export function getAccountRateState(accountId: string): AccountRateState {
  const state = getOrCreateState(accountId);
  const now = Date.now();
  return {
    ...state,
    requestTimestamps: state.requestTimestamps.filter(t => now - t < config.windowMs),
  };
}

/**
 * Get global rate limit diagnostics.
 */
export function getGlobalRateDiagnostics(): {
  totalRequests: number;
  totalRejected: number;
  activeRequestsInWindow: number;
  activeAccounts: number;
} {
  const now = Date.now();
  return {
    totalRequests: globalTotalRequests,
    totalRejected: globalTotalRejected,
    activeRequestsInWindow: globalRequestTimestamps.filter(
      t => now - t < config.globalWindowMs,
    ).length,
    activeAccounts: accountStates.size,
  };
}

/**
 * Reset all rate limit state.
 * Useful for testing.
 */
export function resetRateLimiter(): void {
  // Reject all queued requests
  for (const [id, queue] of accountQueues) {
    for (const item of queue) {
      if (item.timeoutTimer) clearTimeout(item.timeoutTimer);
      item.reject(new Error('Rate limiter reset'));
    }
  }
  accountQueues.clear();
  accountStates.clear();
  globalRequestTimestamps = [];
  globalTotalRequests = 0;
  globalTotalRejected = 0;
  globalQueuedCount = 0;
  globalTotalQueued = 0;
  globalTotalQueueTimeouts = 0;
}

function getOrCreateState(accountId: string): AccountRateState {
  if (!accountStates.has(accountId)) {
    accountStates.set(accountId, {
      requestTimestamps: [],
      concurrentCount: 0,
      inCooldown: false,
      cooldownExpiresAt: 0,
      totalRequests: 0,
      totalRejected: 0,
      last429At: 0,
    });
  }
  return accountStates.get(accountId)!;
}