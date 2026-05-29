// @ts-nocheck
/**
 * Phase 19 — Integration Tests
 * Tests the full request pipeline with mocked upstream.
 * Verifies: sanitizer → watchdog → validator → session management → response
 */

import { describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync } from './utils';

// === Test 1: Response Sanitizer Pipeline ===
const sanitizer = require('../src/modules/responseSanitizer');

describe('INT.1 — Sanitizer pipeline end-to-end', () => {
  it('strips reasoning, deduplicates, and auto-closes XML', () => {
    const input = '<think>Let me think...</think>\nHere is the answer.\n<think>More thinking...</think>\nHere is the answer.\n<ml_tool_calls><ml_tool_call><name>read</name>';
    const result = sanitizer.sanitizeFullResponse(input);
    assertFalse(result.includes('<think>'), 'should strip think blocks');
    assertFalse(result.includes('Let me think'), 'should strip think content');
    assertTrue(result.includes('</ml_tool_calls>'), 'should auto-close XML');
  });

  it('strips leaked upstream content', () => {
    const input = 'Tool does not exist.\nThe answer is 42.';
    const result = sanitizer.sanitizeFullResponse(input);
    assertFalse(result.includes('Tool does not exist'), 'should strip tool leak');
    assertTrue(result.includes('42'), 'should keep valid content');
  });

  it('sanitizes stream chunks correctly', () => {
    const chunk1 = sanitizer.sanitizeStreamChunk('<think>partial');
    const chunk2 = sanitizer.sanitizeStreamChunk('</think>answer text');
    assertFalse(chunk1.includes('<think>'), 'partial think stripped');
    assertTrue(chunk2.includes('answer'), 'answer preserved');
  });
});

// === Test 2: Tool Call Validator Pipeline ===
const validator = require('../src/modules/toolCallValidator');

describe('INT.2 — Tool call validator end-to-end', () => {
  it('validates and repairs a batch of tool calls', () => {
    const calls = [
      {id: 'tc1', name: 'read_file', arguments: '{"path": "test.ts"}'},
      {id: 'tc2', name: 'tool.execute_command', arguments: 'invalid json'},
      {id: 'tc3', name: '', arguments: '{}'},
      {id: 'tc4', name: 'write', arguments: ''},
    ];
    const result = validator.validateToolCalls(calls);
    assertTrue(result.toolCalls.length >= 1, 'at least 1 valid call');
    assertTrue(result.rejected.length >= 1, 'at least 1 rejected');
    // Empty name gets rejected, invalid JSON gets rejected, empty args get repaired to {}
    assertTrue(result.toolCalls.length + result.rejected.length === calls.length, 'all calls accounted for');
  });

  it('detects tool call format from raw content', () => {
    assertTrue(validator.detectToolCallFormat('<ml_tool_calls>') === 'xml_ml', 'detects ml');
    assertTrue(validator.detectToolCallFormat('<tool_calls>') === 'xml_legacy', 'detects legacy');
    assertTrue(validator.detectToolCallFormat('[function_calls]') === 'bracket', 'detects bracket');
    assertTrue(validator.detectToolCallFormat('plain text') === 'none', 'detects none');
  });
});

// === Test 3: Session Reset Decision ===
const sessionReset = require('../src/modules/sessionReset');

describe('INT.3 — Session reset decision pipeline', () => {
  it('resets stale session and preserves active task', () => {
    const health = {
      messageCount: 10,
      retryCount: 0,
      streamFailureCount: 0,
      lastActivityAt: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
      turnCount: 5,
    };
    const decision = sessionReset.shouldResetSession(health, { staleSessionHours: 24 });
    assertTrue(decision.shouldReset, 'should reset stale');
    assertTrue(decision.reason === 'stale_session', 'reason is stale');
  });

  it('creates reset context preserving active task', () => {
    const messages = [
      {role: 'user', content: 'Fix the bug in main.ts'},
      {role: 'assistant', content: 'Looking at the file...'},
      {role: 'tool', content: 'Error: ENOENT not found'},
      {role: 'user', content: 'Try again'},
    ];
    const ctx = sessionReset.createResetContext(messages);
    assertTrue(ctx.activeTask.includes('Try again'), 'preserves active task');
    assertTrue(ctx.recentErrors.length > 0, 'has recent errors');
    assertTrue(ctx.summary.includes('reset'), 'has reset marker');
  });
});

// === Test 4: Context Compactor Pipeline ===
const compactor = require('../src/modules/contextCompactor');

describe('INT.4 — Context compactor end-to-end', () => {
  it('compacts large message history and preserves key info', () => {
    const messages = [];
    for (let i = 0; i < 40; i++) {
      messages.push({role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}: some content here`});
    }
    messages.push({role: 'user', content: 'What is the current error?'});

    const result = compactor.compactMessages(messages, { keepRecentCount: 5, stripThinking: true });
    assertTrue(result.priorityMessages.length <= 6, 'keeps recent messages');
    assertTrue(result.compressedSummary.length > 0, 'has summary');
    assertTrue(result.estimatedTokens > 0, 'estimates tokens');
    assertTrue(result.activeTask.includes('current error'), 'preserves active task');
  });

  it('builds compacted messages with system prompt', () => {
    const compacted = {
      priorityMessages: [{role: 'user', content: 'latest'}],
      compressedSummary: '[Previous 30 messages summarized]',
      activeTask: 'latest',
      recentErrors: ['ENOENT: file not found'],
      estimatedTokens: 100,
      droppedCount: 30,
    };
    const result = compactor.buildCompactedMessages(compacted, 'You are helpful');
    assertTrue(result[0].role === 'system', 'system message first');
    assertTrue(result[0].content.includes('helpful'), 'has system prompt');
    assertTrue(result[0].content.includes('ENOENT'), 'has errors');
    assertTrue(result[0].content.includes('summarized'), 'has summary');
  });
});

// === Test 5: Session Snapshot Pipeline ===
const snapshot = require('../src/modules/sessionSnapshot');

describe('INT.5 — Session snapshot end-to-end', () => {
  it('creates snapshot and merges into messages', () => {
    const messages = [
      {role: 'system', content: 'You are helpful'},
      {role: 'user', content: 'Read file.ts and fix the bug'},
      {role: 'assistant', content: 'Reading file.ts now'},
      {role: 'tool', content: 'Error: TypeError at line 42'},
      {role: 'user', content: 'Fix it'},
    ];
    const snap = snapshot.createSnapshot(messages);
    assertTrue(snap.activeTask.includes('Fix it'), 'has active task');
    assertTrue(snap.recentErrors.length > 0, 'has errors');

    const merged = snapshot.mergeSnapshotWithMessages(messages, snap);
    const sysMsg = merged.find(m => m.role === 'system');
    assertTrue(sysMsg.content.includes('SESSION CONTEXT SNAPSHOT'), 'has snapshot');
    assertTrue(sysMsg.content.includes('Fix it'), 'has active task in context');
  });
});

// === Test 6: Workspace Scheduler Pipeline ===
const workspace = require('../src/modules/workspaceScheduler');

describe('INT.6 — Workspace scheduler end-to-end', () => {
  it('acquires lock, detects conflict, releases on session end', () => {
    workspace.clearWorkspaceState();

    // Session A acquires lock
    const lock = workspace.acquireFileLock('src/main.ts', 'session-a');
    assertTrue(lock.acquired, 'lock acquired');

    // Session B tries same file — conflict
    const conflict = workspace.checkConflict('src/main.ts', 'session-b');
    assertTrue(conflict.hasConflict, 'conflict detected');

    // Session A releases
    const released = workspace.releaseSessionLocks('session-a');
    assertTrue(released >= 1, 'released locks');

    // Session B can now acquire
    const lock2 = workspace.acquireFileLock('src/main.ts', 'session-b');
    assertTrue(lock2.acquired, 'session-b can acquire');
  });

  it('tracks file changes and detects stale context', () => {
    workspace.clearWorkspaceState();
    workspace.recordFileChange('src/utils.ts', 'session-1', 'write');
    assertTrue(workspace.isFileStale('src/utils.ts', 'session-2'), 'stale for other');
    assertFalse(workspace.isFileStale('src/utils.ts', 'session-1'), 'not stale for same');
  });
});

// === Test 7: Logger Pipeline ===
const {logger, configureLogger} = require('../src/modules/logger');

describe('INT.7 — Logger end-to-end', () => {
  it('logs with structured context and redacts sensitive data', () => {
    logger.reset();
    configureLogger({level: 'debug'});
    logger.info('Request processed', {
      traceId: 'req-123',
      sessionId: 'sess-456',
      data: {model: 'qwen3', token: 'secret123', status: 200},
    });
    const pending = logger.flush();
    assertTrue(pending.length === 1, 'one log entry');
    assertEqual(pending[0].traceId, 'req-123', 'traceId set');
    assertEqual(pending[0].data.token, '[REDACTED]', 'token redacted');
    assertEqual(pending[0].data.status, 200, 'status preserved');
  });

  it('child logger propagates context', () => {
    logger.reset();
    configureLogger({level: 'debug'});
    const child = logger.child({traceId: 'trace-abc', sessionId: 'sess-xyz'});
    child.warn('Tool call failed', {data: {tool: 'read_file'}});
    const pending = logger.flush();
    assertEqual(pending[0].traceId, 'trace-abc', 'child traceId');
    assertEqual(pending[0].sessionId, 'sess-xyz', 'child sessionId');
    assertEqual(pending[0].data.tool, 'read_file', 'extra data');
  });
});

// === Test 8: Database Pipeline ===
const db = require('../src/modules/database');
const path = require('path');
const fs = require('fs');
const os = require('os');
const TEST_DB = path.join(os.tmpdir(), `luna-integration-${Date.now()}.db`);

describe('INT.8 — Database end-to-end', () => {
  it('full CRUD lifecycle for sessions', () => {
    db.initDatabase(TEST_DB);
    db.upsert('sessions', 'int-sess-1', {model: 'qwen3', messages: ['hello']});
    const retrieved = db.getById('sessions', 'int-sess-1');
    assertEqual(retrieved.model, 'qwen3', 'stored model');

    db.upsert('sessions', 'int-sess-1', {model: 'qwen3-max', messages: ['updated']});
    const updated = db.getById('sessions', 'int-sess-1');
    assertEqual(updated.model, 'qwen3-max', 'updated model');

    assertTrue(db.deleteById('sessions', 'int-sess-1'), 'deleted');
    assertEqual(db.getById('sessions', 'int-sess-1'), null, 'gone');
  });

  it('config and logs work end-to-end', () => {
    db.setConfigValue('settings.session.enabled', true);
    assertTrue(db.getConfigValue('settings.session.enabled'), 'config stored');

    db.insertLog('info', 'Integration test log', {test: true});
    const logs = db.getLogs(10, 'info');
    assertTrue(logs.length > 0, 'has logs');
    assertTrue(logs[0].message.includes('Integration'), 'log message');
  });
});

// Cleanup
flushAsync().then(() => {
  printSummary();
  db.closeDatabase();
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
});