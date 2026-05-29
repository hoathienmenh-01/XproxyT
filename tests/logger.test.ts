/**
 * Phase 12 — Structured Logger Tests
 */

import { describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync } from './utils';

const mod = require('../src/modules/logger');
const { logger, configureLogger, getLoggerConfig, redactSensitive } = mod;

// ===== Section LG.1 — Logger levels =====
describe('LG.1 — Logger levels', () => {
  it('has default config', () => {
    logger.reset();
    const cfg = getLoggerConfig();
    assertEqual(cfg.level, 'info', 'default level');
    assertEqual(cfg.format, 'json', 'default format');
    assertTrue(cfg.enabled, 'enabled by default');
    assertTrue(cfg.sensitiveFields.length > 0, 'has sensitive fields');
  });

  it('configureLogger overrides settings', () => {
    logger.reset();
    configureLogger({ level: 'debug', format: 'text' });
    const cfg = getLoggerConfig();
    assertEqual(cfg.level, 'debug', 'overridden level');
    assertEqual(cfg.format, 'text', 'overridden format');
  });

  it('respects log level threshold', () => {
    logger.reset();
    configureLogger({ level: 'warn', enabled: true });
    // debug and info should be filtered out
    logger.debug('should not appear');
    logger.info('should not appear');
    logger.warn('should appear');
    logger.error('should appear');
    const pending = logger.flush();
    assertTrue(pending.every((e: any) => e.level === 'warn' || e.level === 'error' || e.level === 'fatal'),
      'only warn+ should be in pending');
  });

  it('disabled logger produces no entries', () => {
    logger.reset();
    configureLogger({ enabled: false });
    logger.info('should not appear');
    assertEqual(logger.pendingCount(), 0, 'no entries when disabled');
    configureLogger({ enabled: true });
  });
});

// ===== Section LG.2 — Sensitive field redaction =====
describe('LG.2 — Sensitive field redaction', () => {
  it('redacts token field', () => {
    const result = redactSensitive({ token: 'secret123', name: 'test' });
    assertEqual(result.token, '[REDACTED]', 'token redacted');
    assertEqual(result.name, 'test', 'name preserved');
  });

  it('redacts authorization header', () => {
    const result = redactSensitive({ Authorization: 'Bearer xyz', host: 'example.com' });
    assertEqual(result.Authorization, '[REDACTED]', 'auth redacted');
    assertEqual(result.host, 'example.com', 'host preserved');
  });

  it('redacts nested sensitive fields', () => {
    const result = redactSensitive({
      headers: { Authorization: 'Bearer xyz', 'Content-Type': 'json' },
      body: { password: 'secret', name: 'test' },
    });
    assertEqual(result.headers.Authorization, '[REDACTED]', 'nested auth redacted');
    assertEqual(result.headers['Content-Type'], 'json', 'nested non-sensitive preserved');
    assertEqual(result.body.password, '[REDACTED]', 'nested password redacted');
    assertEqual(result.body.name, 'test', 'nested name preserved');
  });

  it('redacts cookies', () => {
    const result = redactSensitive({ cookies: 'session=abc', apiKey: 'key123' });
    assertEqual(result.cookies, '[REDACTED]', 'cookies redacted');
    assertEqual(result.apiKey, '[REDACTED]', 'apiKey redacted');
  });

  it('handles null/undefined gracefully', () => {
    assertEqual(redactSensitive(null), null, 'null');
    assertEqual(redactSensitive(undefined), undefined, 'undefined');
    assertEqual(redactSensitive('string'), 'string', 'string passthrough');
  });
});

// ===== Section LG.3 — Child logger =====
describe('LG.3 — Child logger', () => {
  it('child logger inherits context', () => {
    logger.reset();
    configureLogger({ level: 'debug' });
    const child = logger.child({ traceId: 'abc-123', sessionId: 'sess-456' });
    child.info('test message');
    const pending = logger.flush();
    assertTrue(pending.length > 0, 'should have entry');
    assertEqual(pending[0].traceId, 'abc-123', 'traceId inherited');
    assertEqual(pending[0].sessionId, 'sess-456', 'sessionId inherited');
    assertEqual(pending[0].message, 'test message', 'message preserved');
  });

  it('child logger allows overriding context', () => {
    logger.reset();
    configureLogger({ level: 'debug' });
    const child = logger.child({ traceId: 'abc-123' });
    child.warn('override test', { traceId: 'override-789', data: { key: 'value' } });
    const pending = logger.flush();
    assertEqual(pending[0].traceId, 'override-789', 'traceId overridden');
    assertTrue(pending[0].data?.key === 'value', 'data passed');
  });
});

// ===== Section LG.4 — Flush and reset =====
describe('LG.4 — Flush and reset', () => {
  it('flush returns and clears entries', () => {
    logger.reset();
    configureLogger({ level: 'debug' });
    logger.info('entry 1');
    logger.info('entry 2');
    assertTrue(logger.pendingCount() >= 2, 'has entries');
    const flushed = logger.flush();
    assertTrue(flushed.length >= 2, 'flushed entries');
    assertEqual(logger.pendingCount(), 0, 'cleared after flush');
  });

  it('reset clears everything', () => {
    logger.info('before reset');
    logger.reset();
    assertEqual(logger.pendingCount(), 0, 'no entries after reset');
    const cfg = getLoggerConfig();
    assertEqual(cfg.level, 'info', 'config reset to default');
  });
});

// ===== Section LG.5 — Error logging =====
describe('LG.5 — Error logging', () => {
  it('logs error with error object', () => {
    logger.reset();
    configureLogger({ level: 'debug' });
    logger.error('something failed', { error: new Error('test error'), runId: 'run-1' });
    const pending = logger.flush();
    assertTrue(pending.length > 0, 'has entry');
    assertEqual(pending[0].level, 'error', 'error level');
    assertTrue(pending[0].error?.message.includes('test error'), 'error message');
    assertEqual(pending[0].runId, 'run-1', 'runId set');
  });

  it('logs fatal', () => {
    logger.reset();
    configureLogger({ level: 'debug' });
    logger.fatal('critical failure', { data: { code: 500 } });
    const pending = logger.flush();
    assertEqual(pending[0].level, 'fatal', 'fatal level');
  });
});

flushAsync().then(() => printSummary());