import { describe, it, assertEqual, assertTrue, assertFalse, assertMatch, flushAsync, printSummary } from './utils';
import { classifyError, decideRetry } from '../src/modules/retryPolicy';

describe('Section R.1 — classifyError', () => {
  it('classifies timeout errors', () => {
    assertEqual(classifyError(new Error('Connection timeout')), 'timeout', 'timeout');
    assertEqual(classifyError(new Error('ECONNRESET')), 'timeout', 'econnreset');
    assertEqual(classifyError(new Error('Request timed out')), 'timeout', 'timed out');
  });

  it('classifies chat_in_progress', () => {
    assertEqual(classifyError(new Error('The chat is in progress')), 'chat_in_progress', 'exact');
    assertEqual(classifyError(new Error('chat in progress error')), 'chat_in_progress', 'variant');
  });

  it('classifies rate_limit', () => {
    assertEqual(classifyError(new Error('429 Too Many Requests')), 'rate_limit', '429');
    assertEqual(classifyError(new Error('rate limit exceeded')), 'rate_limit', 'text');
  });

  it('classifies auth_error', () => {
    assertEqual(classifyError(new Error('401 Unauthorized')), 'auth_error', '401');
    assertEqual(classifyError(new Error('invalid token')), 'auth_error', 'token');
  });

  it('classifies upstream_disconnect', () => {
    assertEqual(classifyError(new Error('ECONNREFUSED')), 'upstream_disconnect', 'refused');
    assertEqual(classifyError(new Error('socket hang up')), 'upstream_disconnect', 'hangup');
  });

  it('classifies dead_stream', () => {
    assertEqual(classifyError(new Error('stream ended before first SSE data')), 'dead_stream', 'dead');
  });

  it('classifies malformed_stream', () => {
    assertEqual(classifyError(new Error('invalid JSON at position 5')), 'malformed_stream', 'json');
  });

  it('classifies unknown errors', () => {
    assertEqual(classifyError(new Error('something weird')), 'unknown', 'unknown');
    assertEqual(classifyError('string error'), 'unknown', 'string');
  });
});

describe('Section R.2 — decideRetry', () => {
  it('retries timeout with fresh chat', () => {
    const decision = decideRetry(new Error('timeout'), 0);
    assertTrue(decision.shouldRetry, 'should retry');
    assertTrue(decision.freshChat, 'should fresh chat');
    assertFalse(decision.switchAccount, 'no switch account');
    assertEqual(decision.category, 'timeout', 'category');
  });

  it('retries chat_in_progress with delay', () => {
    const decision = decideRetry(new Error('The chat is in progress'), 0);
    assertTrue(decision.shouldRetry, 'should retry');
    assertTrue(decision.delayMs >= 2000, 'min delay 2s');
    assertTrue(decision.freshChat, 'fresh chat');
  });

  it('retries rate_limit with account switch', () => {
    const decision = decideRetry(new Error('429'), 0);
    assertTrue(decision.shouldRetry, 'should retry');
    assertTrue(decision.switchAccount, 'switch account');
    assertTrue(decision.delayMs >= 5000, 'min delay 5s');
  });

  it('does not retry auth_error', () => {
    const decision = decideRetry(new Error('401 Unauthorized'), 0);
    assertFalse(decision.shouldRetry, 'should not retry');
  });

  it('does not retry after max retries', () => {
    const decision = decideRetry(new Error('timeout'), 3);
    assertFalse(decision.shouldRetry, 'should not retry');
    assertMatch(decision.reason, /Max retries/, 'reason mentions max');
  });

  it('returns exponential backoff delays', () => {
    const d0 = decideRetry(new Error('timeout'), 0);
    const d1 = decideRetry(new Error('timeout'), 1);
    // base=1000, d0 ~= 1000, d1 ~= 2000 (with jitter)
    assertTrue(d0.delayMs <= d1.delayMs + 500, 'increasing delays');
  });

  it('retries unknown once', () => {
    const d0 = decideRetry(new Error('weird error'), 0);
    assertTrue(d0.shouldRetry, 'first unknown retries');
    const d1 = decideRetry(new Error('weird error'), 1);
    assertFalse(d1.shouldRetry, 'second unknown does not');
  });
});

flushAsync().then(() => printSummary());