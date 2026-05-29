/**
 * Retry Policy — handles upstream error classification and retry decisions.
 * 
 * Error types:
 * - timeout: retry with fresh chat
 * - dead stream: recreate stream
 * - 429/rate limit: switch account or backoff
 * - chat in progress: retry same session or new chat
 * - malformed stream: regenerate
 * - upstream disconnect: reconnect
 */

export interface RetryDecision {
  /** Whether to retry */
  shouldRetry: boolean;
  /** Delay before retry in ms */
  delayMs: number;
  /** Whether to create a fresh chat (new chat_id) */
  freshChat: boolean;
  /** Whether to switch to a different account */
  switchAccount: boolean;
  /** Human-readable reason */
  reason: string;
  /** Error category for logging */
  category: ErrorCategory;
}

export type ErrorCategory =
  | 'timeout'
  | 'dead_stream'
  | 'rate_limit'
  | 'chat_in_progress'
  | 'malformed_stream'
  | 'upstream_disconnect'
  | 'auth_error'
  | 'unknown';

export interface RetryConfig {
  /** Maximum number of retries per request */
  maxRetries: number;
  /** Base delay for exponential backoff in ms */
  baseDelayMs: number;
  /** Maximum delay cap in ms */
  maxDelayMs: number;
  /** Whether to create fresh chat on chat_in_progress */
  freshChatOnInProgress: boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  freshChatOnInProgress: true,
};

/**
 * Classify an upstream error into a category.
 */
export function classifyError(error: unknown): ErrorCategory {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (/timeout|timed?\s*out|ECONNRESET/i.test(msg)) return 'timeout';
  if (/chat\s*(is\s+)?in\s*progress/i.test(msg)) return 'chat_in_progress';
  if (/429|rate\s*limit|too\s*many\s*requests/i.test(msg)) return 'rate_limit';
  if (/malformed|invalid\s*json|parse\s*error|unexpected\s*token/i.test(msg)) return 'malformed_stream';
  if (/econnrefused|econnreset|socket\s*hang\s*up|network\s*error/i.test(msg)) return 'upstream_disconnect';
  if (/401|403|unauthorized|invalid\s*token/i.test(msg)) return 'auth_error';
  if (/dead|stale|no\s*data|empty\s*stream|stream\s*ended\s*before/i.test(msg)) return 'dead_stream';

  return 'unknown';
}

/**
 * Decide whether to retry based on the error category and attempt count.
 */
export function decideRetry(
  error: unknown,
  attempt: number,
  config: Partial<RetryConfig> = {},
): RetryDecision {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const category = classifyError(error);

  if (attempt >= cfg.maxRetries) {
    return {
      shouldRetry: false,
      delayMs: 0,
      freshChat: false,
      switchAccount: false,
      reason: `Max retries (${cfg.maxRetries}) exhausted`,
      category,
    };
  }

  const backoff = Math.min(
    cfg.baseDelayMs * Math.pow(2, attempt),
    cfg.maxDelayMs,
  );
  // Add jitter (±20%)
  const jitter = backoff * (0.8 + Math.random() * 0.4);
  const delayMs = Math.round(jitter);

  switch (category) {
    case 'timeout':
      return {
        shouldRetry: true,
        delayMs,
        freshChat: true,
        switchAccount: false,
        reason: `Timeout on attempt ${attempt + 1}, retrying with fresh chat`,
        category,
      };

    case 'dead_stream':
      return {
        shouldRetry: true,
        delayMs,
        freshChat: true,
        switchAccount: false,
        reason: `Dead stream on attempt ${attempt + 1}, recreating`,
        category,
      };

    case 'chat_in_progress':
      return {
        shouldRetry: true,
        delayMs: Math.max(delayMs, 2000), // At least 2s for chat_in_progress
        freshChat: cfg.freshChatOnInProgress,
        switchAccount: false,
        reason: `Chat in progress on attempt ${attempt + 1}${cfg.freshChatOnInProgress ? ', creating fresh chat' : ', waiting'}`,
        category,
      };

    case 'rate_limit':
      return {
        shouldRetry: true,
        delayMs: Math.max(delayMs, 5000), // At least 5s for rate limits
        freshChat: false,
        switchAccount: true,
        reason: `Rate limited on attempt ${attempt + 1}, backing off`,
        category,
      };

    case 'malformed_stream':
      return {
        shouldRetry: true,
        delayMs,
        freshChat: true,
        switchAccount: false,
        reason: `Malformed stream on attempt ${attempt + 1}, regenerating`,
        category,
      };

    case 'upstream_disconnect':
      return {
        shouldRetry: true,
        delayMs,
        freshChat: true,
        switchAccount: false,
        reason: `Upstream disconnect on attempt ${attempt + 1}, reconnecting`,
        category,
      };

    case 'auth_error':
      // Auth errors are not retryable — the token is invalid
      return {
        shouldRetry: false,
        delayMs: 0,
        freshChat: false,
        switchAccount: false,
        reason: `Auth error — token may be expired or invalid`,
        category,
      };

    case 'unknown':
    default:
      // Unknown errors: retry once with backoff
      if (attempt < 1) {
        return {
          shouldRetry: true,
          delayMs,
          freshChat: true,
          switchAccount: false,
          reason: `Unknown error on attempt ${attempt + 1}, retrying once`,
          category,
        };
      }
      return {
        shouldRetry: false,
        delayMs: 0,
        freshChat: false,
        switchAccount: false,
        reason: `Unknown error after ${attempt + 1} attempts, not retrying`,
        category,
      };
  }
}

/**
 * Sleep utility for retry delays.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}