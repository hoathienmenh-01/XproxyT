/**
 * Phase 10 — Non-stream Tool Rounds Tests
 * Tests for shouldUseNonStream with various message patterns
 */

import { describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync } from './utils';

const { getClaudeCodeConfig, shouldUseNonStream } = require('../src/modules/claudeCodeMode');

// ===== Section NST.1 — Non-stream detection patterns =====
describe('NST.1 — Non-stream detection patterns', () => {
  it('detects tool result at end of messages', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'fix bug' },
      { role: 'assistant', content: '<ml_tool_calls>...</ml_tool_calls>' },
      { role: 'tool', content: 'File content here' },
      { role: 'user', content: 'now fix the error' },
    ];
    assertTrue(shouldUseNonStream(messages, config), 'tool result present');
  });

  it('detects assistant with tool_calls field', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'help' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'user', content: 'continue' },
    ];
    assertTrue(shouldUseNonStream(messages, config), 'tool_calls field');
  });

  it('detects assistant with ml_tool_calls XML in content', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'fix' },
      { role: 'assistant', content: 'Let me check. <ml_tool_calls><ml_tool_call><name>read_file</name></ml_tool_call></ml_tool_calls>' },
      { role: 'user', content: 'ok' },
    ];
    assertTrue(shouldUseNonStream(messages, config), 'ml_tool_calls in content');
  });

  it('detects function role message', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'help' },
      { role: 'assistant', content: 'calling tool' },
      { role: 'function', content: 'result' },
    ];
    assertTrue(shouldUseNonStream(messages, config), 'function role message');
  });

  it('returns false for normal conversation without tools', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'how are you?' },
    ];
    assertFalse(shouldUseNonStream(messages, config), 'normal conversation');
  });

  it('returns false for single user message', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'write a function' },
    ];
    assertFalse(shouldUseNonStream(messages, config), 'first turn');
  });

  it('returns false when disabled even with tool results', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: false } });
    const messages = [
      { role: 'user', content: 'fix' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', content: 'content' },
    ];
    assertFalse(shouldUseNonStream(messages, config), 'disabled');
  });

  it('returns false when claude code mode disabled', () => {
    const config = getClaudeCodeConfig();
    const messages = [
      { role: 'tool', content: 'result' },
    ];
    assertFalse(shouldUseNonStream(messages, config), 'mode disabled');
  });
});

// ===== Section NST.2 — Default config with nonStreamTools =====
describe('NST.2 — Default nonStreamTools is true', () => {
  it('nonStreamTools defaults to true', () => {
    const config = getClaudeCodeConfig();
    assertTrue(config.nonStreamTools, 'default nonStreamTools should be true');
  });

  it('nonStreamTools can be overridden to false', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { nonStreamTools: false } });
    assertFalse(config.nonStreamTools, 'overridden to false');
  });

  it('nonStreamTools true triggers shouldUseNonStream when enabled', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'fix' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', content: 'file content' },
    ];
    assertTrue(shouldUseNonStream(messages, config), 'should detect tool round');
  });
});

flushAsync().then(() => printSummary());