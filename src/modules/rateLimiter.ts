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
    },
    result: { allowed: true },
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
  accountStates.clear();
  globalRequestTimestamps = [];
  globalTotalRequests = 0;
  globalTotalRejected = 0;
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