// @ts-nocheck
/**
 * Phase B3 — Config Validator Tests
 */

import {describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync} from './utils';

const {validateConfig, applyConfigDefaults} = require('../src/modules/configValidator');

// ===== Section CV.1 — validateConfig =====
describe('CV.1 — validateConfig', () => {
  it('returns valid for good config', () => {
    const result = validateConfig({
      providers: [{id: 'qwen-ai', credentials: {token: 'test'}}],
      proxy: {host: '127.0.0.1', port: 8080},
      settings: {},
    });
    assertTrue(result.valid, 'valid config');
    assertEqual(result.errors.length, 0, 'no errors');
  });

  it('returns error for null config', () => {
    const result = validateConfig(null);
    assertFalse(result.valid, 'not valid');
    assertTrue(result.errors.length > 0, 'has errors');
  });

  it('returns error for invalid port', () => {
    const result = validateConfig({
      providers: [{id: 'qwen-ai', credentials: {}}],
      proxy: {host: '127.0.0.1', port: 99999},
      settings: {},
    });
    assertFalse(result.valid, 'not valid for bad port');
  });

  it('warns for missing credentials', () => {
    const result = validateConfig({
      providers: [{id: 'qwen-ai'}],
      proxy: {host: '127.0.0.1', port: 8080},
      settings: {},
    });
    assertTrue(result.valid, 'still valid');
    assertTrue(result.warnings.length > 0, 'has warnings');
    assertTrue(result.warnings.some((w: string) => w.includes('no credentials')), 'warns about credentials');
  });

  it('warns for very low token overflow threshold', () => {
    const result = validateConfig({
      providers: [{id: 'qwen-ai', credentials: {token: 't'}}],
      proxy: {host: '127.0.0.1', port: 8080},
      settings: {tokenOverflow: {threshold: 500}},
    });
    assertTrue(result.warnings.some((w: string) => w.includes('very low')), 'warns about low threshold');
  });

  it('error for providers not array', () => {
    const result = validateConfig({
      providers: 'not-array',
      proxy: {host: '127.0.0.1', port: 8080},
    });
    assertFalse(result.valid, 'not valid');
  });
});

// ===== Section CV.2 — applyConfigDefaults =====
describe('CV.2 — applyConfigDefaults', () => {
  it('fills session defaults', () => {
    const result = applyConfigDefaults({providers: [], settings: {}});
    assertTrue(result.settings.session.enabled === true, 'session enabled default');
    assertTrue(result.settings.session.rollingHistoryK === 10, 'rollingHistoryK default');
    assertTrue(result.settings.session.compactAfterMessages === 40, 'compactAfterMessages default');
  });

  it('fills tokenLimits defaults', () => {
    const result = applyConfigDefaults({providers: [], settings: {}});
    assertTrue(result.settings.tokenLimits.enabled === true, 'tokenLimits enabled default');
    assertTrue(result.settings.tokenLimits.maxInputTokens === 128000, 'maxInputTokens default');
    assertTrue(result.settings.tokenLimits.defaultMaxOutputTokens === 8192, 'defaultMaxOutputTokens default');
  });

  it('fills tokenOverflow defaults', () => {
    const result = applyConfigDefaults({providers: [], settings: {}});
    assertTrue(result.settings.tokenOverflow.enabled === true, 'tokenOverflow enabled default');
    assertTrue(result.settings.tokenOverflow.threshold === 10000, 'threshold default');
  });

  it('preserves existing values', () => {
    const result = applyConfigDefaults({
      providers: [],
      settings: {
        session: {rollingHistoryK: 20, enabled: false},
        tokenLimits: {maxInputTokens: 64000},
      },
    });
    assertTrue(result.settings.session.rollingHistoryK === 20, 'preserves rollingHistoryK');
    assertTrue(result.settings.session.enabled === false, 'preserves enabled=false');
    assertTrue(result.settings.tokenLimits.maxInputTokens === 64000, 'preserves maxInputTokens');
  });

  it('creates settings if missing', () => {
    const result = applyConfigDefaults({providers: []});
    assertTrue(typeof result.settings === 'object', 'settings created');
    assertTrue(typeof result.settings.session === 'object', 'session created');
    assertTrue(typeof result.settings.tokenLimits === 'object', 'tokenLimits created');
  });
});

// Cleanup
flushAsync().then(() => {
  printSummary();
});