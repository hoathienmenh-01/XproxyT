import { describe, it, assertEqual, assertTrue, assertFalse, assertMatch, flushAsync, printSummary } from './utils';
import { extractActiveTask, extractRecentErrors, compactMessages, buildCompactedMessages } from '../src/modules/contextCompactor';
import { shouldResetSession, classifyResetReason, createResetContext } from '../src/modules/sessionReset';
import { createSnapshot, formatSnapshotAsContext, mergeSnapshotWithMessages } from '../src/modules/sessionSnapshot';

describe('Section CC.1 — extractActiveTask', () => {
  it('extracts last user message as active task', () => {
    const messages = [
      { role: 'user', content: 'Fix the bug in main.ts' },
      { role: 'assistant', content: 'I fixed it.' },
      { role: 'user', content: 'Now add tests' },
    ];
    const task = extractActiveTask(messages);
    assertEqual(task, 'Now add tests', 'should be last user message');
  });

  it('returns empty for no messages', () => {
    assertEqual(extractActiveTask([]), '', 'empty');
    assertEqual(extractActiveTask(null as any), '', 'null');
  });

  it('truncates long messages', () => {
    const longMsg = 'x'.repeat(1000);
    const messages = [{ role: 'user', content: longMsg }];
    const task = extractActiveTask(messages);
    assertTrue(task.length <= 500, 'should truncate to 500 chars');
  });
});

describe('Section CC.2 — extractRecentErrors', () => {
  it('extracts error from tool result', () => {
    const messages = [
      { role: 'user', content: 'run test' },
      { role: 'tool', content: 'Error: ENOENT: no such file or directory' },
    ];
    const errors = extractRecentErrors(messages);
    assertTrue(errors.length > 0, 'should find error');
    assertTrue(errors[0].includes('ENOENT'), 'should contain error');
  });

  it('returns empty for no errors', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    const errors = extractRecentErrors(messages);
    assertEqual(errors.length, 0, 'no errors');
  });

  it('limits to maxErrors', () => {
    const messages = [
      { role: 'tool', content: 'Error: first' },
      { role: 'tool', content: 'Error: second' },
      { role: 'tool', content: 'Error: third' },
      { role: 'tool', content: 'Error: fourth' },
    ];
    const errors = extractRecentErrors(messages, 2);
    assertTrue(errors.length <= 2, 'should respect limit');
  });
});

describe('Section CC.3 — compactMessages', () => {
  it('keeps recent messages in full', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));
    const result = compactMessages(messages, { keepRecentCount: 5 });
    assertEqual(result.priorityMessages.length, 5, 'should keep 5 recent');
  });

  it('creates compressed summary for old messages', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));
    const result = compactMessages(messages, { keepRecentCount: 5 });
    assertTrue(result.compressedSummary.length > 0, 'should have summary');
    assertTrue(result.compressedSummary.includes('15 messages'), 'should mention count');
  });

  it('extracts active task', () => {
    const messages = [
      { role: 'user', content: 'Build the app' },
      { role: 'assistant', content: 'Done' },
    ];
    const result = compactMessages(messages);
    assertEqual(result.activeTask, 'Build the app', 'should extract task');
  });

  it('handles empty messages', () => {
    const result = compactMessages([]);
    assertEqual(result.priorityMessages.length, 0, 'empty');
    assertEqual(result.compressedSummary, '', 'no summary');
  });

  it('strips thinking from old messages', () => {
    const messages = [
      { role: 'assistant', content: '<think>reasoning</think>answer 1' },
      { role: 'user', content: 'next' },
      { role: 'assistant', content: 'answer 2' },
      { role: 'user', content: 'next2' },
      { role: 'assistant', content: 'answer 3' },
      { role: 'user', content: 'next3' },
      { role: 'assistant', content: 'answer 4' },
    ];
    const result = compactMessages(messages, { keepRecentCount: 2, stripThinking: true });
    assertFalse(result.compressedSummary.includes('<think>'), 'should strip thinking from summary');
  });
});

describe('Section CC.4 — buildCompactedMessages', () => {
  it('builds messages with system prompt', () => {
    const compacted = {
      priorityMessages: [{ role: 'user', content: 'hello' }],
      compressedSummary: 'Previous context',
      activeTask: 'hello',
      recentErrors: [],
      estimatedTokens: 10,
      droppedCount: 0,
    };
    const messages = buildCompactedMessages(compacted, 'System prompt');
    assertTrue(messages[0].role === 'system', 'first should be system');
    assertTrue(messages[0].content.includes('System prompt'), 'has system prompt');
    assertTrue(messages[0].content.includes('Previous context'), 'has summary');
    assertEqual(messages.length, 2, 'system + user');
  });

  it('includes recent errors in system prompt', () => {
    const compacted = {
      priorityMessages: [],
      compressedSummary: '',
      activeTask: '',
      recentErrors: ['ENOENT: file not found'],
      estimatedTokens: 0,
      droppedCount: 0,
    };
    const messages = buildCompactedMessages(compacted);
    assertTrue(messages[0].content.includes('ENOENT'), 'should include error');
  });
});

describe('Section SR.1 — shouldResetSession', () => {
  it('resets on stale session', () => {
    const health = {
      messageCount: 5,
      retryCount: 0,
      streamFailureCount: 0,
      lastActivityAt: Date.now() - 25 * 60 * 60 * 1000,
      turnCount: 5,
    };
    const decision = shouldResetSession(health);
    assertTrue(decision.shouldReset, 'should reset');
    assertEqual(decision.reason, 'stale_session', 'reason');
  });

  it('resets on retry storm', () => {
    const health = {
      messageCount: 5,
      retryCount: 4,
      streamFailureCount: 0,
      lastActivityAt: Date.now(),
      turnCount: 5,
    };
    const decision = shouldResetSession(health);
    assertTrue(decision.shouldReset, 'should reset');
    assertEqual(decision.reason, 'retry_storm', 'reason');
    assertTrue(decision.preserveActiveTask, 'preserve task');
  });

  it('resets on stream failures', () => {
    const health = {
      messageCount: 5,
      retryCount: 0,
      streamFailureCount: 6,
      lastActivityAt: Date.now(),
      turnCount: 5,
    };
    const decision = shouldResetSession(health);
    assertTrue(decision.shouldReset, 'should reset');
    assertEqual(decision.reason, 'stream_failures', 'reason');
  });

  it('resets on long conversation', () => {
    const health = {
      messageCount: 55,
      retryCount: 0,
      streamFailureCount: 0,
      lastActivityAt: Date.now(),
      turnCount: 55,
    };
    const decision = shouldResetSession(health);
    assertTrue(decision.shouldReset, 'should reset');
    assertEqual(decision.reason, 'long_conversation', 'reason');
  });

  it('does not reset healthy session', () => {
    const health = {
      messageCount: 10,
      retryCount: 0,
      streamFailureCount: 0,
      lastActivityAt: Date.now(),
      turnCount: 10,
    };
    const decision = shouldResetSession(health);
    assertFalse(decision.shouldReset, 'should not reset');
    assertEqual(decision.reason, 'none', 'reason');
  });
});

describe('Section SR.2 — classifyResetReason', () => {
  it('classifies chat in progress', () => {
    assertEqual(classifyResetReason('The chat is in progress'), 'context_drift', 'drift');
  });

  it('classifies stream failures', () => {
    assertEqual(classifyResetReason('stream error timeout'), 'stream_failures', 'stream');
  });

  it('classifies context overflow', () => {
    assertEqual(classifyResetReason('context length exceeded'), 'token_overflow', 'overflow');
  });

  it('returns none for unknown', () => {
    assertEqual(classifyResetReason('hello'), 'none', 'unknown');
  });
});

describe('Section SR.3 — createResetContext', () => {
  it('preserves active task', () => {
    const messages = [
      { role: 'user', content: 'Fix the auth bug' },
      { role: 'assistant', content: 'Working on it' },
    ];
    const result = createResetContext(messages);
    assertTrue(result.activeTask.includes('Fix the auth bug'), 'has task');
    assertTrue(result.summary.includes('Fix the auth bug'), 'summary has task');
  });

  it('extracts recent errors', () => {
    const messages = [
      { role: 'user', content: 'test' },
      { role: 'tool', content: 'Error: ENOENT file not found' },
    ];
    const result = createResetContext(messages);
    assertTrue(result.recentErrors.length > 0, 'has errors');
  });
});

describe('Section SS.1 — createSnapshot', () => {
  it('extracts active task', () => {
    const messages = [
      { role: 'user', content: 'Build the dashboard' },
      { role: 'assistant', content: 'Building...' },
    ];
    const snapshot = createSnapshot(messages);
    assertEqual(snapshot.activeTask, 'Build the dashboard', 'task');
    assertEqual(snapshot.turnCount, 2, 'turn count');
  });

  it('extracts file references', () => {
    const messages = [
      { role: 'tool', content: 'Reading file src/main.ts\nFound 3 errors in src/utils.ts' },
    ];
    const snapshot = createSnapshot(messages);
    assertTrue(snapshot.fileReferences.length > 0, 'has files');
  });

  it('handles empty messages', () => {
    const snapshot = createSnapshot([]);
    assertEqual(snapshot.activeTask, '', 'empty task');
    assertEqual(snapshot.turnCount, 0, 'no turns');
  });
});

describe('Section SS.2 — formatSnapshotAsContext', () => {
  it('formats snapshot with all fields', () => {
    const snapshot = {
      activeTask: 'Build app',
      recentErrors: ['ENOENT'],
      fileReferences: ['src/main.ts'],
      recentEdits: ['src/utils.ts'],
      lastToolResults: ['File read successfully'],
      workingDirectory: '/home/user/project',
      turnCount: 10,
      createdAt: Date.now(),
    };
    const context = formatSnapshotAsContext(snapshot);
    assertTrue(context.includes('SESSION CONTEXT SNAPSHOT'), 'has header');
    assertTrue(context.includes('Build app'), 'has task');
    assertTrue(context.includes('ENOENT'), 'has error');
    assertTrue(context.includes('src/main.ts'), 'has file');
    assertTrue(context.includes('/home/user/project'), 'has cwd');
  });

  it('handles empty snapshot', () => {
    const snapshot = {
      activeTask: '',
      recentErrors: [],
      fileReferences: [],
      recentEdits: [],
      lastToolResults: [],
      workingDirectory: '',
      turnCount: 0,
      createdAt: Date.now(),
    };
    const context = formatSnapshotAsContext(snapshot);
    assertTrue(context.includes('SESSION CONTEXT SNAPSHOT'), 'still has header');
  });
});

describe('Section SS.3 — mergeSnapshotWithMessages', () => {
  it('prepends snapshot as system message', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const snapshot = {
      activeTask: 'Build app',
      recentErrors: [],
      fileReferences: [],
      recentEdits: [],
      lastToolResults: [],
      workingDirectory: '',
      turnCount: 1,
      createdAt: Date.now(),
    };
    const result = mergeSnapshotWithMessages(messages, snapshot);
    assertEqual(result[0].role, 'system', 'first is system');
    assertTrue(result[0].content.includes('Build app'), 'has snapshot');
    assertEqual(result.length, 2, 'system + user');
  });

  it('merges with existing system message', () => {
    const messages = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hello' },
    ];
    const snapshot = {
      activeTask: 'Build app',
      recentErrors: [],
      fileReferences: [],
      recentEdits: [],
      lastToolResults: [],
      workingDirectory: '',
      turnCount: 2,
      createdAt: Date.now(),
    };
    const result = mergeSnapshotWithMessages(messages, snapshot);
    assertEqual(result.length, 2, 'same count');
    assertTrue(result[0].content.includes('You are helpful'), 'preserves system');
    assertTrue(result[0].content.includes('Build app'), 'adds snapshot');
  });
});

flushAsync().then(() => printSummary());