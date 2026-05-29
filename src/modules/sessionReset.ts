/**
 * Session Reset — Auto-detect when a session needs to be reset.
 * 
 * Triggers:
 * - Context drift: model repeating itself, forgetting state
 * - Retry storm: too many retries in short time
 * - Stream failures: multiple stream errors
 * - Long conversation: too many messages
 * - Stale session: session hasn't been used for a long time
 */

export interface SessionHealth {
  messageCount: number;
  retryCount: number;
  streamFailureCount: number;
  lastError?: string;
  lastActivityAt: number;
  turnCount: number;
}

export type ResetReason =
  | 'context_drift'
  | 'retry_storm'
  | 'stream_failures'
  | 'long_conversation'
  | 'stale_session'
  | 'token_overflow'
  | 'none';

export interface ResetDecision {
  shouldReset: boolean;
  reason: ResetReason;
  details: string;
  preserveActiveTask: boolean;
}

export interface ResetConfig {
  maxRetries: number;
  maxStreamFailures: number;
  maxMessages: number;
  staleSessionHours: number;
}

const DEFAULT_CONFIG: ResetConfig = {
  maxRetries: 3,
  maxStreamFailures: 5,
  maxMessages: 50,
  staleSessionHours: 24,
};

/**
 * Check if a session should be reset based on health metrics.
 */
export function shouldResetSession(
  health: SessionHealth,
  config: Partial<ResetConfig> = {},
): ResetDecision {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Check stale session
  const hoursSinceActivity = (Date.now() - health.lastActivityAt) / (1000 * 60 * 60);
  if (hoursSinceActivity > cfg.staleSessionHours) {
    return {
      shouldReset: true,
      reason: 'stale_session',
      details: `Session inactive for ${Math.round(hoursSinceActivity)}h (limit: ${cfg.staleSessionHours}h)`,
      preserveActiveTask: false,
    };
  }

  // Check retry storm
  if (health.retryCount >= cfg.maxRetries) {
    return {
      shouldReset: true,
      reason: 'retry_storm',
      details: `${health.retryCount} retries in this session (limit: ${cfg.maxRetries})`,
      preserveActiveTask: true,
    };
  }

  // Check stream failures
  if (health.streamFailureCount >= cfg.maxStreamFailures) {
    return {
      shouldReset: true,
      reason: 'stream_failures',
      details: `${health.streamFailureCount} stream failures (limit: ${cfg.maxStreamFailures})`,
      preserveActiveTask: true,
    };
  }

  // Check long conversation
  if (health.messageCount >= cfg.maxMessages) {
    return {
      shouldReset: true,
      reason: 'long_conversation',
      details: `${health.messageCount} messages (limit: ${cfg.maxMessages})`,
      preserveActiveTask: true,
    };
  }

  return {
    shouldReset: false,
    reason: 'none',
    details: 'Session is healthy',
    preserveActiveTask: false,
  };
}

/**
 * Classify the reason for a reset from an error message.
 */
export function classifyResetReason(error: string): ResetReason {
  if (!error) return 'none';
  
  if (/chat.{0,5}in.{0,5}progress/i.test(error)) return 'context_drift';
  if (/stream.{0,10}(fail|error|timeout)/i.test(error)) return 'stream_failures';
  if (/context.{0,10}(exceed|overflow|too.{0,3}long)/i.test(error)) return 'token_overflow';
  if (/retry|retries|attempt/i.test(error)) return 'retry_storm';
  
  return 'none';
}

/**
 * Create a minimal reset context from the old session.
 * Preserves the active task and recent errors while discarding old history.
 */
export function createResetContext(
  messages: any[],
  options: { maxActiveTaskChars?: number; maxErrorChars?: number } = {},
): { summary: string; activeTask: string; recentErrors: string[] } {
  const maxTaskChars = options.maxActiveTaskChars ?? 500;
  const maxErrorChars = options.maxErrorChars ?? 300;

  // Extract active task (last user message)
  let activeTask = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      activeTask = content.slice(0, maxTaskChars);
      break;
    }
  }

  // Extract recent errors
  const recentErrors: string[] = [];
  const errorPatterns = [/error[:\s]/i, /failed[:\s]/i, /exception/i, /ENOENT/i, /EACCES/i];
  
  for (let i = messages.length - 1; i >= 0 && recentErrors.length < 3; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    
    for (const pattern of errorPatterns) {
      if (pattern.test(content)) {
        const lines = content.split('\n');
        for (const line of lines) {
          if (pattern.test(line)) {
            recentErrors.push(line.slice(0, maxErrorChars));
            break;
          }
        }
        break;
      }
    }
  }

  // Build summary
  const parts: string[] = [];
  parts.push('[Session was reset due to context issues]');
  if (activeTask) {
    parts.push(`Active task: ${activeTask}`);
  }
  if (recentErrors.length > 0) {
    parts.push(`Recent errors:\n${recentErrors.join('\n')}`);
  }

  return {
    summary: parts.join('\n\n'),
    activeTask,
    recentErrors,
  };
}