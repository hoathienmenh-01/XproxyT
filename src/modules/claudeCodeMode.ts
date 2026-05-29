/**
 * Claude Code Mode — Auto-configuration for optimal Claude Code / Cline experience.
 *
 * When enabled, applies these optimizations:
 * - reasoning_effort: low (reduce reasoning leak risk)
 * - Strict sanitizer (strip all reasoning from output)
 * - Tool call validator always active
 * - Shorter session history (keep recent 5)
 * - Auto-compact at lower threshold
 * - Non-stream tool rounds (stream=false for tool calls → fewer parser issues)
 * - Prefer fast/thinking-off models to reduce reasoning leak
 */

export interface ClaudeCodeConfig {
  /** Enable Claude Code mode */
  enabled: boolean;
  /** Override reasoning_effort */
  reasoningEffort: string;
  /** Strip thinking from all output */
  stripThinking: boolean;
  /** Keep recent message count */
  keepRecentCount: number;
  /** Auto-compact threshold (message count) */
  autoCompactThreshold: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Enable strict sanitizer */
  strictSanitizer: boolean;
  /** Tool call validation always on */
  alwaysValidateTools: boolean;
  /** Use non-stream for tool call rounds */
  nonStreamTools: boolean;
  /** Force fast thinking mode */
  forceFastMode: boolean;
  /** Maximum conversation turns before auto-reset */
  maxTurns: number;
  /** Compact when token estimate exceeds this */
  compactTokenThreshold: number;
}

const DEFAULT_CLAUDE_CODE_CONFIG: ClaudeCodeConfig = {
  enabled: false,
  reasoningEffort: 'low',
  stripThinking: true,
  keepRecentCount: 5,
  autoCompactThreshold: 20,
  maxOutputTokens: 8192,
  strictSanitizer: true,
  alwaysValidateTools: true,
  nonStreamTools: true,
  forceFastMode: false,
  maxTurns: 50,
  compactTokenThreshold: 30000,
};

/**
 * Get Claude Code mode configuration.
 * Returns defaults if not configured.
 */
export function getClaudeCodeConfig(settings?: Record<string, any>): ClaudeCodeConfig {
  const cc = settings?.claudeCodeMode || {};
  return {
    ...DEFAULT_CLAUDE_CODE_CONFIG,
    ...cc,
    enabled: cc.enabled === true,
  };
}

/**
 * Apply Claude Code mode overrides to a chat completion request.
 * Modifies reasoning_effort, thinking_mode, max_tokens, etc.
 */
export function applyClaudeCodeOverrides(
  request: any,
  config: ClaudeCodeConfig,
): any {
  if (!config.enabled) return request;

  const overrides: any = { ...request };

  // Force low reasoning effort to reduce reasoning leak
  if (config.reasoningEffort) {
    overrides.reasoning_effort = config.reasoningEffort;
    overrides.thinking_mode = config.reasoningEffort === 'none' ? 'fast' : undefined;
  }

  // Force fast mode to disable thinking entirely
  if (config.forceFastMode) {
    overrides.thinking_mode = 'fast';
    overrides.reasoning_effort = 'none';
  }

  // Force max output tokens
  if (config.maxOutputTokens > 0) {
    overrides.max_tokens = config.maxOutputTokens;
  }

  return overrides;
}

/**
 * Determine if a request should use non-stream mode.
 * Tool call rounds benefit from non-stream to avoid parser issues.
 */
export function shouldUseNonStream(
  messages: any[],
  config: ClaudeCodeConfig,
): boolean {
  if (!config.enabled || !config.nonStreamTools) return false;

  // Check if the last assistant message contains tool calls
  // This indicates we're in a tool-call round (client sending tool results)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      // If the assistant message has tool_calls or contains XML tool patterns
      if (msg.tool_calls && msg.tool_calls.length > 0) return true;
      if (typeof msg.content === 'string' && /<ml_tool_calls>/.test(msg.content)) return true;
      break;
    }
    if (msg.role === 'tool' || msg.role === 'function') {
      return true; // Tool result messages mean we're in a tool-call round
    }
  }

  return false;
}

/**
 * Check if Claude Code mode should trigger auto-compact.
 */
export function shouldAutoCompact(
  messageCount: number,
  config: ClaudeCodeConfig,
): boolean {
  if (!config.enabled) return false;
  return messageCount >= config.autoCompactThreshold;
}

/**
 * Check if context token estimate exceeds compact threshold.
 */
export function shouldCompactByTokens(
  estimatedTokens: number,
  config: ClaudeCodeConfig,
): boolean {
  if (!config.enabled) return false;
  return estimatedTokens >= config.compactTokenThreshold;
}

/**
 * Check if session should auto-reset based on turn count.
 */
export function shouldAutoReset(
  turnCount: number,
  config: ClaudeCodeConfig,
): boolean {
  if (!config.enabled) return false;
  return turnCount >= config.maxTurns;
}

/**
 * Build merged settings for Claude Code mode.
 * Merges Claude Code config with existing settings.
 */
export function buildClaudeCodeSettings(
  existingSettings: Record<string, any>,
  config: ClaudeCodeConfig,
): Record<string, any> {
  if (!config.enabled) return existingSettings;

  return {
    ...existingSettings,
    claudeCodeMode: {
      enabled: true,
      reasoningEffort: config.reasoningEffort,
      stripThinking: config.stripThinking,
      keepRecentCount: config.keepRecentCount,
      autoCompactThreshold: config.autoCompactThreshold,
      maxOutputTokens: config.maxOutputTokens,
      strictSanitizer: config.strictSanitizer,
      alwaysValidateTools: config.alwaysValidateTools,
      nonStreamTools: config.nonStreamTools,
      forceFastMode: config.forceFastMode,
      maxTurns: config.maxTurns,
      compactTokenThreshold: config.compactTokenThreshold,
    },
    // Override session settings for Claude Code
    session: {
      ...(existingSettings.session || {}),
      compaction: {
        ...(existingSettings.session?.compaction || {}),
        keepRecentCount: config.keepRecentCount,
        stripThinking: config.stripThinking,
      },
      autoReset: {
        ...(existingSettings.session?.autoReset || {}),
        maxMessages: config.maxTurns,
      },
    },
  };
}

/**
 * Get Claude Code mode summary for logging.
 */
export function getClaudeCodeSummary(config: ClaudeCodeConfig): string {
  if (!config.enabled) return 'Claude Code mode: disabled';
  return [
    'Claude Code mode: ENABLED',
    `  reasoning_effort: ${config.reasoningEffort}`,
    `  stripThinking: ${config.stripThinking}`,
    `  keepRecentCount: ${config.keepRecentCount}`,
    `  autoCompactThreshold: ${config.autoCompactThreshold}`,
    `  maxOutputTokens: ${config.maxOutputTokens}`,
    `  strictSanitizer: ${config.strictSanitizer}`,
    `  alwaysValidateTools: ${config.alwaysValidateTools}`,
    `  nonStreamTools: ${config.nonStreamTools}`,
    `  forceFastMode: ${config.forceFastMode}`,
    `  maxTurns: ${config.maxTurns}`,
    `  compactTokenThreshold: ${config.compactTokenThreshold}`,
  ].join('\n');
}