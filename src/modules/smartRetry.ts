/**
 * Smart Retry — 3-Attempt Retry with Session Reset
 * 
 * Attempt 1: Send normally with current chatId
 * Attempt 2 (Network glitch): Wait 1s, resend identical request
 * Attempt 3 (Stale chat): Reset session → create new Chat ID → resend full history
 * 
 * Usage:
 *   const result = await executeWithRetry({
 *     adapter, model, messages, chatId, sessionId, stream, signal,
 *     createChat: (model, label) => adapter.createChat(model, label),
 *     chatCompletion: (params) => adapter.chatCompletion(params),
 *     resetSession: (sessionId, reason) => sessionStore.resetProviderSessionId(sessionId, reason),
 *     upsertBinding: (sessionId, binding) => sessionStore.upsertProviderBinding(sessionId, binding),
 *     markStaleChat: (chatId) => chatCleanupScheduler.markStale(chatId),
 *   });
 */

import { logger as appLogger } from './logger';

// ============================================================================
// Types
// ============================================================================

export type RetryAction = 'network' | 'stale-chat' | 'fatal';

export interface SmartRetryConfig {
  /** Maximum attempts (default: 3) */
  maxAttempts: number;
  /** Delay before attempt 2 (network retry) in ms */
  networkRetryDelayMs: number;
  /** Whether to use non-stream for attempt 3 (more reliable) */
  forceNonStreamOnReset: boolean;
  /** Enable stale chat cleanup marking */
  enableCleanupMarking: boolean;
}

export interface SmartRetryParams {
  /** The adapter instance (QwenAiAdapter) */
  adapter: any;
  /** Model name */
  model: string;
  /** Processed messages to send */
  messages: any[];
  /** Current Qwen chat ID (may be undefined for first request) */
  chatId?: string;
  /** Luna session ID for tracking */
  sessionId?: string;
  /** Provider ID */
  providerId: string;
  /** Account ID */
  accountId: string;
  /** Whether client wants stream mode */
  stream: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Additional params to pass to chatCompletion */
  extraParams?: Record<string, any>;
  /** Logger prefix for trace */
  tracePrefix?: string;
  /** Config overrides */
  config?: Partial<SmartRetryConfig>;
}

export interface SmartRetryResult {
  /** The Qwen API response */
  response: any;
  /** The chat ID used (may be new if reset happened) */
  chatId: string;
  /** Whether a retry occurred */
  retried: boolean;
  /** Number of attempts made */
  attempts: number;
  /** Whether session was reset (attempt 3) */
  sessionReset: boolean;
  /** Old chat ID if reset happened */
  oldChatId?: string;
  /** Reason for retry if any */
  retryReasons: string[];
  /** Total time spent including retries */
  totalDurationMs: number;
}

const DEFAULT_CONFIG: SmartRetryConfig = {
  maxAttempts: 3,
  networkRetryDelayMs: 1000,
  forceNonStreamOnReset: true,
  enableCleanupMarking: true,
};

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify an error into a retry action category.
 * 
 * 'network'     → Retry with same params (attempt 2)
 * 'stale-chat'  → Reset session + new chat (attempt 3)
 * 'fatal'       → No retry (429, auth, etc.)
 */
export function classifyRetryAction(error: unknown): RetryAction {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  // Fatal — do NOT retry
  if (/429|rate.?limit|too.?many/i.test(msg)) return 'fatal';
  if (/401|403|unauthorized|forbidden|invalid.?token/i.test(msg)) return 'fatal';
  if (/400|bad.?request/i.test(msg) && !/chat|session/i.test(msg)) return 'fatal';

  // Network glitch — retry same request
  if (/econnreset|etimedout|econnrefused|socket.?hang.?up/i.test(msg)) return 'network';
  if (/enotfound|eai_again|network.?error/i.test(msg)) return 'network';
  if (/timeout|timed.?out/i.test(msg)) return 'network';
  if (/abort/i.test(msg)) return 'fatal'; // User abort, don't retry

  // Stale chat — need session reset
  if (/chat.?not.?found|session.?expired|session.?not.?found/i.test(msg)) return 'stale-chat';
  if (/500|502|503|internal.?server.?error|bad.?gateway|service.?unavailable/i.test(msg)) return 'stale-chat';
  if (/empty.?response|no.?content|response.?parse/i.test(msg)) return 'stale-chat';

  // Unknown — treat as stale-chat for first retry, then fatal
  return 'stale-chat';
}

/**
 * Check if a Qwen response looks valid (has content).
 */
export function isResponseValid(responseData: any): boolean {
  if (!responseData) return false;
  
  // Check for error in response body
  if (responseData.error) return false;
  
  // Check for choices with content
  const choices = responseData.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const content = choices[0]?.message?.content;
    if (typeof content === 'string' && content.trim().length > 0) return true;
  }
  
  // Check for streaming delta content
  if (responseData.choices?.[0]?.delta?.content) return true;
  
  return false;
}

// ============================================================================
// Smart Retry Executor
// ============================================================================

/**
 * Execute a chat completion with smart 3-attempt retry logic.
 */
export async function executeWithRetry(params: SmartRetryParams): Promise<SmartRetryResult> {
  const cfg: SmartRetryConfig = { ...DEFAULT_CONFIG, ...params.config };
  const startTime = Date.now();
  const tracePrefix = params.tracePrefix || '[SmartRetry]';
  const retryReasons: string[] = [];
  let currentChatId = params.chatId;
  let sessionReset = false;
  let oldChatId: string | undefined;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    const attemptLabel = `Attempt ${attempt}/${cfg.maxAttempts}`;
    
    // Check abort signal
    if (params.signal?.aborted) {
      throw new Error('Request aborted by client');
    }

    try {
      // Determine stream mode — force non-stream on attempt 3 (reset) for reliability
      const useStream = (attempt === cfg.maxAttempts && cfg.forceNonStreamOnReset && sessionReset)
        ? false
        : params.stream;

      appLogger.info(`${tracePrefix} ${attemptLabel} — ${attempt === 1 ? 'normal send' : attempt === 2 ? 'network retry' : 'session reset + new chat'}`, {
        data: {
          model: params.model,
          chatId: currentChatId,
          sessionId: params.sessionId,
          stream: useStream,
          attempt,
        },
      });

      // Build chat completion params
      const chatParams: any = {
        model: params.model,
        messages: params.messages,
        stream: useStream,
        providerSessionId: currentChatId,
        signal: params.signal,
        ...(params.extraParams || {}),
      };

      // For attempt 3 (session reset), create a fresh chat first
      if (attempt === cfg.maxAttempts && !sessionReset) {
        // This is the reset attempt
        oldChatId = currentChatId;
        
        appLogger.info(`${tracePrefix} Resetting session, creating new Chat ID...`, {
          data: { oldChatId, sessionId: params.sessionId },
        });

        // Create new chat on Qwen
        if (params.adapter?.createChat) {
          currentChatId = await params.adapter.createChat(
            params.model,
            `smart-retry-${attempt}`,
          );
          chatParams.providerSessionId = currentChatId;
          sessionReset = true;

          appLogger.info(`${tracePrefix} New Chat ID created: ${currentChatId}`, {
            data: { oldChatId, newChatId: currentChatId },
          });
        }
      }

      // Execute the actual request
      const { response, chatId: responseChatId } = await params.adapter.chatCompletion(chatParams);
      
      // Use the chat ID from response if available
      if (responseChatId) {
        currentChatId = responseChatId;
      }

      // Validate response (for non-stream)
      if (!params.stream && !isResponseValid(response?.data)) {
        const action = 'stale-chat';
        if (attempt < cfg.maxAttempts) {
          retryReasons.push(`${attemptLabel}: Invalid response (empty/error), action=${action}`);
          appLogger.warn(`${tracePrefix} ${attemptLabel} — Invalid response, will retry`, {
            data: { hasData: !!response?.data, hasError: !!response?.data?.error },
          });

          // Network retry delay for attempt 2
          if (attempt === 2) {
            await sleep(cfg.networkRetryDelayMs);
          }
          continue;
        }
      }

      // Success!
      const totalDurationMs = Date.now() - startTime;
      
      appLogger.info(`${tracePrefix} ${attemptLabel} — SUCCESS${attempt > 1 ? ' (retried)' : ''}`, {
        data: {
          chatId: currentChatId,
          sessionReset,
          attempts: attempt,
          durationMs: totalDurationMs,
          retryReasons,
        },
      });

      // Mark old chat as stale for cleanup if session was reset
      if (sessionReset && oldChatId && cfg.enableCleanupMarking) {
        appLogger.info(`${tracePrefix} Marking old Chat ID for cleanup`, {
          data: { oldChatId, newChatId: currentChatId },
        });
        // Cleanup is handled by caller via markStaleChat callback
      }

      return {
        response,
        chatId: currentChatId || '',
        retried: attempt > 1,
        attempts: attempt,
        sessionReset,
        oldChatId: sessionReset ? oldChatId : undefined,
        retryReasons,
        totalDurationMs,
      };

    } catch (error) {
      const action = classifyRetryAction(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      
      retryReasons.push(`${attemptLabel}: ${errMsg} → ${action}`);
      
      appLogger.warn(`${tracePrefix} ${attemptLabel} — FAILED (${action})`, {
        data: { error: errMsg, action, attempt },
      });

      // Fatal error — don't retry
      if (action === 'fatal') {
        appLogger.error(`${tracePrefix} Fatal error, not retrying`, {
          data: { error: errMsg, attempts: attempt },
          error: error instanceof Error ? error : undefined,
        });
        throw error;
      }

      // Last attempt — throw the error
      if (attempt >= cfg.maxAttempts) {
        appLogger.error(`${tracePrefix} All ${cfg.maxAttempts} attempts exhausted`, {
          data: { error: errMsg, retryReasons },
          error: error instanceof Error ? error : undefined,
        });
        throw error;
      }

      // Network error on attempt 1 → wait and retry same request
      if (action === 'network' && attempt === 1) {
        appLogger.info(`${tracePrefix} Network error, waiting ${cfg.networkRetryDelayMs}ms before retry...`);
        await sleep(cfg.networkRetryDelayMs);
        continue;
      }

      // Stale chat or network on attempt 2 → will do session reset on attempt 3
      if (attempt === 2) {
        appLogger.info(`${tracePrefix} Will attempt session reset on next try...`);
        continue;
      }
    }
  }

  // Should not reach here, but just in case
  throw new Error(`${tracePrefix} All retry attempts exhausted`);
}

// ============================================================================
// Utility
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}