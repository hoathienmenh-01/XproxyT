/**
 * Structured Logger — Phase 12
 * 
 * Replaces console.log with structured logging:
 * - Log levels: debug, info, warn, error, fatal
 * - JSON output format
 * - Request correlation IDs
 * - Sensitive field redaction
 * - Context injection (sessionId, runId, providerId)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  /** Correlation ID for request tracing */
  traceId?: string;
  /** Session context */
  sessionId?: string;
  runId?: string;
  providerId?: string;
  /** Additional structured data */
  data?: Record<string, any>;
  /** Error info if applicable */
  error?: { message: string; stack?: string; code?: string };
}

export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  /** Output format */
  format: 'json' | 'text';
  /** Enable/disable logging */
  enabled: boolean;
  /** Fields to redact from log output */
  sensitiveFields: string[];
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  format: 'json',
  enabled: true,
  sensitiveFields: [
    'token', 'cookies', 'cookie', 'authorization', 'password',
    'secret', 'api_key', 'apiKey', 'accessToken', 'accessToken',
  ],
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/** Global logger configuration */
let config: LoggerConfig = { ...DEFAULT_CONFIG };

/** Pending log entries for batch flush */
const pendingEntries: LogEntry[] = [];

/**
 * Configure the logger.
 */
export function configureLogger(overrides: Partial<LoggerConfig>): void {
  config = { ...config, ...overrides };
}

/**
 * Get current logger configuration.
 */
export function getLoggerConfig(): LoggerConfig {
  return { ...config };
}

/**
 * Redact sensitive fields from an object.
 */
export function redactSensitive(obj: any, sensitiveFields?: string[]): any {
  if (!obj || typeof obj !== 'object') return obj;
  const fields = sensitiveFields || config.sensitiveFields;
  const redacted = { ...obj };
  
  for (const key of Object.keys(redacted)) {
    const lowerKey = key.toLowerCase();
    if (fields.some(f => lowerKey.includes(f.toLowerCase()))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      if (Array.isArray(redacted[key])) {
        redacted[key] = redacted[key].map((item: any) =>
          typeof item === 'object' ? redactSensitive(item, fields) : item
        );
      } else {
        redacted[key] = redactSensitive(redacted[key], fields);
      }
    }
  }
  
  return redacted;
}

/**
 * Format a log entry as JSON string.
 */
function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Format a log entry as human-readable text.
 */
function formatText(entry: LogEntry): string {
  const parts = [
    `[${entry.timestamp}]`,
    `[${entry.level.toUpperCase().padEnd(5)}]`,
  ];
  if (entry.traceId) parts.push(`[${entry.traceId.slice(0, 8)}]`);
  if (entry.sessionId) parts.push(`[s:${entry.sessionId.slice(0, 8)}]`);
  parts.push(entry.message);
  if (entry.data) {
    const dataStr = JSON.stringify(entry.data);
    if (dataStr.length < 200) {
      parts.push(dataStr);
    } else {
      parts.push(dataStr.slice(0, 200) + '...');
    }
  }
  if (entry.error) parts.push(`ERROR: ${entry.error.message}`);
  return parts.join(' ');
}

/**
 * Core log function.
 */
function log(
  level: LogLevel,
  message: string,
  context?: {
    traceId?: string;
    sessionId?: string;
    runId?: string;
    providerId?: string;
    data?: Record<string, any>;
    error?: Error | { message: string; stack?: string; code?: string };
  },
): void {
  if (!config.enabled) return;
  if (LOG_LEVELS[level] < LOG_LEVELS[config.level]) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    traceId: context?.traceId,
    sessionId: context?.sessionId,
    runId: context?.runId,
    providerId: context?.providerId,
    data: context?.data ? redactSensitive(context.data) : undefined,
    error: context?.error ? {
      message: context.error.message,
      stack: 'stack' in context.error ? context.error.stack : undefined,
      code: 'code' in context.error ? (context.error as any).code : undefined,
    } : undefined,
  };

  const formatted = config.format === 'json' ? formatJson(entry) : formatText(entry);
  
  // Output to appropriate console method
  switch (level) {
    case 'debug':
      console.debug(formatted);
      break;
    case 'info':
      console.info(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'error':
    case 'fatal':
      console.error(formatted);
      break;
  }

  // Add to pending for batch flush
  pendingEntries.push(entry);
}

/**
 * Logger instance with convenience methods.
 */
export const logger = {
  debug: (message: string, context?: Parameters<typeof log>[2]) => log('debug', message, context),
  info: (message: string, context?: Parameters<typeof log>[2]) => log('info', message, context),
  warn: (message: string, context?: Parameters<typeof log>[2]) => log('warn', message, context),
  error: (message: string, context?: Parameters<typeof log>[2]) => log('error', message, context),
  fatal: (message: string, context?: Parameters<typeof log>[2]) => log('fatal', message, context),
  
  /**
   * Create a child logger with pre-set context fields.
   */
  child(context: { traceId?: string; sessionId?: string; runId?: string; providerId?: string }) {
    return {
      debug: (message: string, extra?: Parameters<typeof log>[2]) => log('debug', message, { ...context, ...extra }),
      info: (message: string, extra?: Parameters<typeof log>[2]) => log('info', message, { ...context, ...extra }),
      warn: (message: string, extra?: Parameters<typeof log>[2]) => log('warn', message, { ...context, ...extra }),
      error: (message: string, extra?: Parameters<typeof log>[2]) => log('error', message, { ...context, ...extra }),
      fatal: (message: string, extra?: Parameters<typeof log>[2]) => log('fatal', message, { ...context, ...extra }),
    };
  },

  /**
   * Get pending log entries (for batch flush to file).
   */
  getPending(): LogEntry[] {
    return [...pendingEntries];
  },

  /**
   * Flush and clear pending entries.
   */
  flush(): LogEntry[] {
    const entries = [...pendingEntries];
    pendingEntries.length = 0;
    return entries;
  },

  /**
   * Get count of pending entries.
   */
  pendingCount(): number {
    return pendingEntries.length;
  },

  /**
   * Reset logger to defaults (for testing).
   */
  reset(): void {
    config = { ...DEFAULT_CONFIG };
    pendingEntries.length = 0;
  },
};