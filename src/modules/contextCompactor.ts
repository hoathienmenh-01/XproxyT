/**
 * Context Compactor — Smart context compression for multi-turn sessions.
 * 
 * Instead of sending full history, this module:
 * 1. Keeps high-priority content (active task, recent edits, current error, last tool result)
 * 2. Compresses low-priority content (old terminal logs, repeated diffs, stale tool outputs)
 * 3. Generates a structured summary that preserves context while reducing tokens
 */

export interface CompactionOptions {
  /** Maximum number of recent messages to keep in full */
  keepRecentCount: number;
  /** Maximum characters per tool result before compression */
  maxToolResultChars: number;
  /** Maximum number of tool results to keep in full */
  maxToolResults: number;
  /** Whether to strip thinking/reasoning from history */
  stripThinking: boolean;
  /** Maximum total token estimate for compacted output */
  maxOutputTokens: number;
}

const DEFAULT_OPTIONS: CompactionOptions = {
  keepRecentCount: 5,
  maxToolResultChars: 4000,
  maxToolResults: 3,
  stripThinking: true,
  maxOutputTokens: 8000,
};

export interface CompactedContext {
  /** High-priority messages kept in full */
  priorityMessages: any[];
  /** Compressed summary of old messages */
  compressedSummary: string;
  /** Active task extracted from recent messages */
  activeTask: string;
  /** Recent errors extracted */
  recentErrors: string[];
  /** Total estimated tokens after compaction */
  estimatedTokens: number;
  /** Messages that were dropped */
  droppedCount: number;
}

/**
 * Estimate token count (rough: 1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Extract active task from messages — looks for the last user message
 * or task-related content.
 */
export function extractActiveTask(messages: any[]): string {
  if (!messages || messages.length === 0) return '';

  // Look backwards for the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      // Return first 500 chars of the active task
      return content.slice(0, 500);
    }
  }

  return '';
}

/**
 * Extract recent errors from messages — looks for error patterns in
 * tool results and assistant messages.
 */
export function extractRecentErrors(messages: any[], maxErrors: number = 3): string[] {
  if (!messages || messages.length === 0) return [];

  const errors: string[] = [];
  const errorPatterns = [
    /error[:\s]/i,
    /failed[:\s]/i,
    /exception[:\s]/i,
    /ENOENT/i,
    /EACCES/i,
    /syntaxerror/i,
    /typeerror/i,
    /referenceerror/i,
    /cannot find/i,
    /not found/i,
    /permission denied/i,
  ];

  // Search backwards for recent errors
  for (let i = messages.length - 1; i >= 0 && errors.length < maxErrors; i--) {
    const msg = messages[i];
    if (!msg) continue;
    
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    
    for (const pattern of errorPatterns) {
      if (pattern.test(content)) {
        // Extract error context (the matching line + a few surrounding lines)
        const lines = content.split('\n');
        for (let j = 0; j < lines.length; j++) {
          if (pattern.test(lines[j])) {
            const start = Math.max(0, j - 1);
            const end = Math.min(lines.length, j + 3);
            const errorBlock = lines.slice(start, end).join('\n').slice(0, 300);
            if (!errors.includes(errorBlock)) {
              errors.push(errorBlock);
            }
            break;
          }
        }
        break; // Only one error per message
      }
    }
  }

  return errors;
}

/**
 * Compress a single message — strip thinking, truncate tool results, etc.
 */
function compressMessage(msg: any, options: CompactionOptions): any {
  if (!msg) return msg;

  let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');

  // Strip thinking blocks if configured
  if (options.stripThinking) {
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    content = content.replace(/<think>[\s\S]*$/g, '');
  }

  // Truncate long tool results
  if (msg.role === 'tool' || (msg.role === 'user' && content.length > options.maxToolResultChars)) {
    if (content.length > options.maxToolResultChars) {
      const half = Math.floor(options.maxToolResultChars / 2);
      content = content.slice(0, half) + '\n...[truncated]...\n' + content.slice(-half);
    }
  }

  return { ...msg, content };
}

/**
 * Compact a message array for a multi-turn session.
 * Preserves recent messages in full, compresses older ones.
 */
export function compactMessages(
  messages: any[],
  options: Partial<CompactionOptions> = {},
): CompactedContext {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (!messages || messages.length === 0) {
    return {
      priorityMessages: [],
      compressedSummary: '',
      activeTask: '',
      recentErrors: [],
      estimatedTokens: 0,
      droppedCount: 0,
    };
  }

  const activeTask = extractActiveTask(messages);
  const recentErrors = extractRecentErrors(messages);

  // Split into old and recent
  const recentStart = Math.max(0, messages.length - opts.keepRecentCount);
  const oldMessages = messages.slice(0, recentStart);
  const recentMessages = messages.slice(recentStart);

  // Compress old messages into a summary
  const compressedParts: string[] = [];
  let toolResultCount = 0;

  for (const msg of oldMessages) {
    if (!msg) continue;
    
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    
    // Count tool results
    if (msg.role === 'tool' || (msg.role === 'user' && content.includes('<ml_tool_result>'))) {
      toolResultCount++;
      if (toolResultCount > opts.maxToolResults) {
        // Skip old tool results beyond limit
        continue;
      }
    }

    // Strip thinking from old messages
    let cleaned = content;
    if (opts.stripThinking) {
      cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
      cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    }

    // Truncate long content
    if (cleaned.length > 500) {
      cleaned = cleaned.slice(0, 250) + '...[truncated]...' + cleaned.slice(-250);
    }

    if (cleaned.trim()) {
      compressedParts.push(`[${msg.role}]: ${cleaned.trim()}`);
    }
  }

  const compressedSummary = compressedParts.length > 0
    ? `[Previous conversation history (${oldMessages.length} messages, ${toolResultCount} tool results)]\n${compressedParts.join('\n')}`
    : '';

  // Keep recent messages in full (with optional compression)
  const priorityMessages = recentMessages.map(msg => compressMessage(msg, opts));

  // Estimate total tokens
  const summaryTokens = estimateTokens(compressedSummary);
  const priorityTokens = priorityMessages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    return sum + estimateTokens(content);
  }, 0);
  const totalTokens = summaryTokens + priorityTokens;

  return {
    priorityMessages,
    compressedSummary,
    activeTask,
    recentErrors,
    estimatedTokens: totalTokens,
    droppedCount: oldMessages.length - compressedParts.length,
  };
}

/**
 * Build the final message array from a compacted context.
 * Returns messages ready to send to the provider.
 */
export function buildCompactedMessages(
  compacted: CompactedContext,
  systemPrompt?: string,
): any[] {
  const messages: any[] = [];

  // Add system context
  let systemContent = systemPrompt || '';
  
  if (compacted.compressedSummary) {
    systemContent += (systemContent ? '\n\n' : '') + compacted.compressedSummary;
  }
  
  if (compacted.recentErrors.length > 0) {
    systemContent += '\n\n[Recent errors to be aware of]\n' + compacted.recentErrors.join('\n');
  }

  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  // Add priority (recent) messages
  messages.push(...compacted.priorityMessages);

  return messages;
}