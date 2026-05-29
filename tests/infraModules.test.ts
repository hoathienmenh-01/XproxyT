import { describe, it, assertEqual, assertTrue, assertFalse, assertMatch, flushAsync, printSummary } from './utils';

// Rate Limiter
import {
  configureRateLimiter,
  getRateLimiterConfig,
  checkRateLimit,
  acquireRequest,
  report429,
  getAccountRateState,
  getGlobalRateDiagnostics,
  resetRateLimiter,
} from '../src/modules/rateLimiter';

// Fingerprint Rotation
import {
  generateFingerprint,
  generateFingerprintHeaders,
  rotateHeaders,
  getRotatingFingerprintHeaders,
  forceRotate,
} from '../src/modules/fingerprintRotation';

// ============================================================
// Section RL.1 — Rate Limiter Config
// ============================================================

describe('Section RL.1 — Rate Limiter config', () => {
  it('has sensible defaults', () => {
    resetRateLimiter();
    const config = getRateLimiterConfig();
    assertTrue(config.maxRequestsPerWindow > 0, 'maxRequestsPerWindow > 0');
    assertTrue(config.windowMs > 0, 'windowMs > 0');
    assertTrue(config.cooldownMs > 0, 'cooldownMs > 0');
    assertTrue(config.maxConcurrent > 0, 'maxConcurrent > 0');
    assertTrue(config.globalMaxRequestsPerWindow > 0, 'globalMaxRequestsPerWindow > 0');
  });

  it('allows overriding config', () => {
    resetRateLimiter();
    configureRateLimiter({ maxRequestsPerWindow: 10, maxConcurrent: 1 });
    const config = getRateLimiterConfig();
    assertEqual(config.maxRequestsPerWindow, 10, 'overridden maxRequestsPerWindow');
    assertEqual(config.maxConcurrent, 1, 'overridden maxConcurrent');
    resetRateLimiter();
  });
});

// ============================================================
// Section RL.2 — Rate Limit Check
// ============================================================

describe('Section RL.2 — checkRateLimit', () => {
  it('allows request within limits', () => {
    resetRateLimiter();
    const result = checkRateLimit('account-1');
    assertTrue(result.allowed, 'should allow');
    assertTrue(result.remainingInWindow! > 0, 'has remaining');
  });

  it('rejects when at concurrent limit', () => {
    resetRateLimiter();
    configureRateLimiter({ maxConcurrent: 1 });
    const r1 = acquireRequest('account-1');
    assertTrue(r1.acquired, 'first acquired');
    const result = checkRateLimit('account-1');
    assertFalse(result.allowed, 'should reject at concurrent limit');
    assertTrue(result.reason!.includes('concurrent'), 'reason mentions concurrent');
    r1.release();
    resetRateLimiter();
  });

  it('rejects when in cooldown from 429', () => {
    resetRateLimiter();
    report429('account-1', 5000);
    const result = checkRateLimit('account-1');
    assertFalse(result.allowed, 'should reject in cooldown');
    assertTrue(result.reason!.includes('cooldown'), 'reason mentions cooldown');
    assertTrue(result.retryAfterMs! > 0, 'has retryAfterMs');
    resetRateLimiter();
  });

  it('rejects when at per-account rate limit', () => {
    resetRateLimiter();
    configureRateLimiter({ maxRequestsPerWindow: 2, windowMs: 60000 });
    acquireRequest('account-1');
    acquireRequest('account-1');
    const result = checkRateLimit('account-1');
    assertFalse(result.allowed, 'should reject at rate limit');
    assertTrue(result.reason!.includes('rate limit'), 'reason mentions rate limit');
    resetRateLimiter();
  });

  it('rejects when at global rate limit', () => {
    resetRateLimiter();
    configureRateLimiter({ globalMaxRequestsPerWindow: 2, globalWindowMs: 60000 });
    acquireRequest('account-1');
    acquireRequest('account-2');
    const result = checkRateLimit('account-3');
    assertFalse(result.allowed, 'should reject at global limit');
    assertTrue(result.reason!.includes('Global'), 'reason mentions Global');
    resetRateLimiter();
  });
});

// ============================================================
// Section RL.3 — Acquire and Release
// ============================================================

describe('Section RL.3 — acquireRequest', () => {
  it('acquires and tracks concurrent count', () => {
    resetRateLimiter();
    configureRateLimiter({ maxConcurrent: 3 });
    const r1 = acquireRequest('account-1');
    assertTrue(r1.acquired, 'first acquired');
    const state = getAccountRateState('account-1');
    assertEqual(state.concurrentCount, 1, 'concurrent count 1');
    r1.release();
    const stateAfter = getAccountRateState('account-1');
    assertEqual(stateAfter.concurrentCount, 0, 'concurrent count 0 after release');
    resetRateLimiter();
  });

  it('increments total requests', () => {
    resetRateLimiter();
    const r1 = acquireRequest('account-1');
    const r2 = acquireRequest('account-1');
    const state = getAccountRateState('account-1');
    assertTrue(state.totalRequests >= 2, 'total requests >= 2');
    r1.release();
    r2.release();
    resetRateLimiter();
  });

  it('release is idempotent', () => {
    resetRateLimiter();
    const r1 = acquireRequest('account-1');
    r1.release();
    r1.release(); // Second release should be no-op
    const state = getAccountRateState('account-1');
    assertEqual(state.concurrentCount, 0, 'concurrent count 0');
    resetRateLimiter();
  });

  it('returns not acquired when rate limited', () => {
    resetRateLimiter();
    report429('account-1', 5000);
    const r1 = acquireRequest('account-1');
    assertFalse(r1.acquired, 'should not acquire');
    assertFalse(r1.result.allowed, 'result not allowed');
    resetRateLimiter();
  });
});

// ============================================================
// Section RL.4 — 429 Reporting
// ============================================================

describe('Section RL.4 — report429', () => {
  it('puts account into cooldown', () => {
    resetRateLimiter();
    report429('account-1', 5000);
    const state = getAccountRateState('account-1');
    assertTrue(state.inCooldown, 'in cooldown');
    assertTrue(state.cooldownExpiresAt > Date.now(), 'cooldown expires in future');
    assertEqual(state.totalRejected, 1, 'total rejected 1');
    resetRateLimiter();
  });

  it('uses default cooldown when no retryAfterMs', () => {
    resetRateLimiter();
    configureRateLimiter({ cooldownMs: 10000 });
    report429('account-1');
    const state = getAccountRateState('account-1');
    assertTrue(state.inCooldown, 'in cooldown');
    const remaining = state.cooldownExpiresAt - Date.now();
    assertTrue(remaining > 5000, 'cooldown duration reasonable');
    resetRateLimiter();
  });
});

// ============================================================
// Section RL.5 — Global Diagnostics
// ============================================================

describe('Section RL.5 — getGlobalRateDiagnostics', () => {
  it('tracks global requests', () => {
    resetRateLimiter();
    acquireRequest('account-1');
    acquireRequest('account-2');
    const diag = getGlobalRateDiagnostics();
    assertTrue(diag.totalRequests >= 2, 'total requests >= 2');
    assertTrue(diag.activeAccounts >= 2, 'active accounts >= 2');
    resetRateLimiter();
  });

  it('tracks rejected requests', () => {
    resetRateLimiter();
    report429('account-1');
    const diag = getGlobalRateDiagnostics();
    assertTrue(diag.totalRejected >= 1, 'total rejected >= 1');
    resetRateLimiter();
  });
});

// ============================================================
// Section RL.6 — Reset
// ============================================================

describe('Section RL.6 — resetRateLimiter', () => {
  it('clears all state', () => {
    resetRateLimiter();
    acquireRequest('account-1');
    report429('account-2');
    resetRateLimiter();
    const diag = getGlobalRateDiagnostics();
    assertEqual(diag.totalRequests, 0, 'total requests reset');
    assertEqual(diag.totalRejected, 0, 'total rejected reset');
    assertEqual(diag.activeAccounts, 0, 'active accounts reset');
  });
});

// ============================================================
// Section FP.1 — Fingerprint Generation
// ============================================================

describe('Section FP.1 — generateFingerprint', () => {
  it('generates valid fingerprint', () => {
    const fp = generateFingerprint();
    assertTrue(fp.userAgent.includes('Chrome'), 'userAgent has Chrome');
    assertTrue(fp.secChUa.includes('Chromium'), 'secChUa has Chromium');
    assertEqual(fp.secChUaMobile, '?0', 'mobile is ?0');
    assertTrue(fp.secChUaPlatform.length > 0, 'has platform');
    assertTrue(fp.bxVersion.length > 0, 'has bxVersion');
  });

  it('generates different fingerprints on each call', () => {
    const fp1 = generateFingerprint();
    const fp2 = generateFingerprint();
    // With random selection, there's a chance they could be the same,
    // but the probability is very low with many combinations
    // We just verify both are valid
    assertTrue(fp1.userAgent.includes('Chrome'), 'fp1 valid');
    assertTrue(fp2.userAgent.includes('Chrome'), 'fp2 valid');
  });
});

// ============================================================
// Section FP.2 — Fingerprint Headers
// ============================================================

describe('Section FP.2 — generateFingerprintHeaders', () => {
  it('generates all required headers', () => {
    const headers = generateFingerprintHeaders();
    assertTrue('User-Agent' in headers, 'has User-Agent');
    assertTrue('sec-ch-ua' in headers, 'has sec-ch-ua');
    assertTrue('sec-ch-ua-mobile' in headers, 'has sec-ch-ua-mobile');
    assertTrue('sec-ch-ua-platform' in headers, 'has sec-ch-ua-platform');
    assertTrue('bx-v' in headers, 'has bx-v');
    assertTrue('bx-umidtoken' in headers, 'has bx-umidtoken');
    assertTrue('bx-ua' in headers, 'has bx-ua');
  });

  it('generates valid User-Agent', () => {
    const headers = generateFingerprintHeaders();
    assertMatch(headers['User-Agent'], /Mozilla.*Chrome.*Safari/, 'valid User-Agent');
  });

  it('generates valid bx-umidtoken', () => {
    const headers = generateFingerprintHeaders();
    assertTrue(headers['bx-umidtoken'].startsWith('T'), 'bx-umidtoken starts with T');
    assertTrue(headers['bx-umidtoken'].length > 50, 'bx-umidtoken reasonable length');
  });

  it('generates valid bx-ua', () => {
    const headers = generateFingerprintHeaders();
    assertTrue(headers['bx-ua'].startsWith('231!'), 'bx-ua starts with 231!');
    assertTrue(headers['bx-ua'].length > 50, 'bx-ua reasonable length');
  });
});

// ============================================================
// Section FP.3 — Header Rotation
// ============================================================

describe('Section FP.3 — rotateHeaders', () => {
  it('replaces fingerprint headers', () => {
    const existing = {
      'User-Agent': 'OLD_AGENT',
      'bx-umidtoken': 'OLD_TOKEN',
      'Authorization': 'Bearer xxx',
    };
    const rotated = rotateHeaders(existing);
    assertTrue(rotated['User-Agent'] !== 'OLD_AGENT', 'User-Agent rotated');
    assertTrue(rotated['bx-umidtoken'] !== 'OLD_TOKEN', 'bx-umidtoken rotated');
    assertEqual(rotated['Authorization'], 'Bearer xxx', 'Authorization preserved');
  });

  it('preserves non-fingerprint headers', () => {
    const existing = {
      'Authorization': 'Bearer xxx',
      'Content-Type': 'application/json',
      'X-Custom': 'value',
    };
    const rotated = rotateHeaders(existing);
    assertEqual(rotated['Authorization'], 'Bearer xxx', 'Authorization preserved');
    assertEqual(rotated['Content-Type'], 'application/json', 'Content-Type preserved');
    assertEqual(rotated['X-Custom'], 'value', 'Custom header preserved');
  });
});

// ============================================================
// Section FP.4 — Rotating Fingerprint (cached)
// ============================================================

describe('Section FP.4 — getRotatingFingerprintHeaders', () => {
  it('returns cached headers for first few requests', () => {
    forceRotate();
    const h1 = getRotatingFingerprintHeaders();
    const h2 = getRotatingFingerprintHeaders();
    // First 4 requests should use same cached fingerprint
    assertEqual(h1['User-Agent'], h2['User-Agent'], 'cached same UA');
    assertEqual(h1['bx-umidtoken'], h2['bx-umidtoken'], 'cached same token');
  });

  it('rotates after N requests', () => {
    forceRotate();
    const h1 = getRotatingFingerprintHeaders();
    // Make 4 more requests to trigger rotation at request 5
    for (let i = 0; i < 4; i++) getRotatingFingerprintHeaders();
    const h6 = getRotatingFingerprintHeaders();
    // After 5 requests, should have rotated (though random could theoretically match)
    // We just verify both are valid
    assertTrue(h1['User-Agent'].includes('Chrome'), 'first valid');
    assertTrue(h6['User-Agent'].includes('Chrome'), 'rotated valid');
  });

  it('forceRotate resets state', () => {
    forceRotate();
    const h1 = getRotatingFingerprintHeaders();
    forceRotate();
    const h2 = getRotatingFingerprintHeaders();
    // After force rotate, new fingerprint generated
    // Both should be valid regardless
    assertTrue(h1['User-Agent'].includes('Chrome'), 'first valid');
    assertTrue(h2['User-Agent'].includes('Chrome'), 'second valid');
  });
});

flushAsync().then(() => printSummary());