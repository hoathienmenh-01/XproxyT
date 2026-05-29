import { describe, it, assertEqual, assertTrue, assertFalse, assertMatch, assertNotMatch, flushAsync, printSummary } from './utils';

// Phase 5.1: Claude Code Mode
import {
  getClaudeCodeConfig,
  applyClaudeCodeOverrides,
  shouldUseNonStream,
  shouldAutoCompact,
  shouldCompactByTokens,
  shouldAutoReset,
  buildClaudeCodeSettings,
  getClaudeCodeSummary,
} from '../src/modules/claudeCodeMode';

// Phase 5.2: Workspace-aware Scheduling
import {
  acquireFileLock,
  releaseFileLock,
  releaseSessionLocks,
  recordFileChange,
  isFileStale,
  checkConflict,
  getHotFiles,
  getWorkspaceDiagnostics,
  cleanupExpiredLocks,
  clearWorkspaceState,
} from '../src/modules/workspaceScheduler';

// ============================================================
// Section CC.5 — Claude Code Mode: Config
// ============================================================

describe('Section CC.5 — getClaudeCodeConfig', () => {
  it('returns defaults when no settings provided', () => {
    const config = getClaudeCodeConfig();
    assertEqual(config.enabled, false, 'enabled should be false');
    assertEqual(config.reasoningEffort, 'low', 'reasoningEffort');
    assertEqual(config.stripThinking, true, 'stripThinking');
    assertEqual(config.keepRecentCount, 5, 'keepRecentCount');
    assertEqual(config.autoCompactThreshold, 20, 'autoCompactThreshold');
    assertEqual(config.maxOutputTokens, 8192, 'maxOutputTokens');
    assertEqual(config.strictSanitizer, true, 'strictSanitizer');
    assertEqual(config.alwaysValidateTools, true, 'alwaysValidateTools');
    assertEqual(config.nonStreamTools, true, 'nonStreamTools default true');
    assertEqual(config.forceFastMode, false, 'forceFastMode');
    assertEqual(config.maxTurns, 50, 'maxTurns');
    assertEqual(config.compactTokenThreshold, 30000, 'compactTokenThreshold');
  });

  it('returns defaults when enabled is missing', () => {
    const config = getClaudeCodeConfig({});
    assertFalse(config.enabled, 'disabled when no claudeCodeMode key');
  });

  it('enables when explicitly set to true', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true } });
    assertTrue(config.enabled, 'should be enabled');
  });

  it('overrides specific values', () => {
    const config = getClaudeCodeConfig({
      claudeCodeMode: {
        enabled: true,
        reasoningEffort: 'none',
        maxOutputTokens: 4096,
        nonStreamTools: true,
      },
    });
    assertTrue(config.enabled, 'enabled');
    assertEqual(config.reasoningEffort, 'none', 'overridden reasoningEffort');
    assertEqual(config.maxOutputTokens, 4096, 'overridden maxOutputTokens');
    assertTrue(config.nonStreamTools, 'overridden nonStreamTools');
    // Non-overridden values keep defaults
    assertTrue(config.stripThinking, 'default stripThinking');
    assertEqual(config.keepRecentCount, 5, 'default keepRecentCount');
  });

  it('respects falsy enabled value', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: false, reasoningEffort: 'high' } });
    assertFalse(config.enabled, 'disabled even with overrides');
    assertEqual(config.reasoningEffort, 'high', 'override applied but mode disabled');
  });
});

// ============================================================
// Section CC.6 — Claude Code Mode: Overrides
// ============================================================

describe('Section CC.6 — applyClaudeCodeOverrides', () => {
  it('returns request unchanged when disabled', () => {
    const request = { model: 'qwen3-max', stream: true };
    const config = getClaudeCodeConfig();
    const result = applyClaudeCodeOverrides(request, config);
    assertEqual(result.model, 'qwen3-max', 'model unchanged');
    assertTrue(result.stream, 'stream unchanged');
  });

  it('sets reasoning_effort to low by default', () => {
    const request = { model: 'qwen3-max' };
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true } });
    const result = applyClaudeCodeOverrides(request, config);
    assertEqual(result.reasoning_effort, 'low', 'reasoning_effort set to low');
  });

  it('sets thinking_mode to fast when reasoningEffort is none', () => {
    const request = { model: 'qwen3-max' };
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, reasoningEffort: 'none' } });
    const result = applyClaudeCodeOverrides(request, config);
    assertEqual(result.reasoning_effort, 'none', 'reasoning_effort');
    assertEqual(result.thinking_mode, 'fast', 'thinking_mode');
  });

  it('forceFastMode overrides everything', () => {
    const request = { model: 'qwen3-max', reasoning_effort: 'high' };
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, forceFastMode: true, reasoningEffort: 'high' } });
    const result = applyClaudeCodeOverrides(request, config);
    assertEqual(result.thinking_mode, 'fast', 'force fast mode');
    assertEqual(result.reasoning_effort, 'none', 'force none');
  });

  it('sets max_tokens', () => {
    const request = { model: 'qwen3-max' };
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, maxOutputTokens: 4096 } });
    const result = applyClaudeCodeOverrides(request, config);
    assertEqual(result.max_tokens, 4096, 'max_tokens set');
  });

  it('does not set max_tokens when 0', () => {
    const request = { model: 'qwen3-max' };
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, maxOutputTokens: 0 } });
    const result = applyClaudeCodeOverrides(request, config);
    assertTrue(result.max_tokens === undefined, 'no max_tokens when 0');
  });
});

// ============================================================
// Section CC.7 — Claude Code Mode: shouldUseNonStream
// ============================================================

describe('Section CC.7 — shouldUseNonStream', () => {
  it('returns false when disabled', () => {
    const config = getClaudeCodeConfig();
    assertFalse(shouldUseNonStream([{ role: 'user', content: 'hi' }], config), 'disabled');
  });

  it('returns false when nonStreamTools is false', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: false } });
    assertFalse(shouldUseNonStream([{ role: 'user', content: 'hi' }], config), 'nonStreamTools off');
  });

  it('returns true when tool results present', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'fix the bug' },
      { role: 'assistant', content: 'I will read the file' },
      { role: 'tool', content: 'file content here' },
    ];
    assertTrue(shouldUseNonStream(messages, config), 'tool results present');
  });

  it('returns true when assistant has tool_calls', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'fix' },
      { role: 'assistant', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file' } }] },
    ];
    assertTrue(shouldUseNonStream(messages, config), 'assistant has tool_calls');
  });

  it('returns true when assistant has ml_tool_calls XML', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'fix' },
      { role: 'assistant', content: '<ml_tool_calls><ml_tool_call><name>read_file</name></ml_tool_call></ml_tool_calls>' },
    ];
    assertTrue(shouldUseNonStream(messages, config), 'ml_tool_calls XML');
  });

  it('returns false for normal conversation', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, nonStreamTools: true } });
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    assertFalse(shouldUseNonStream(messages, config), 'normal conversation');
  });
});

// ============================================================
// Section CC.8 — Claude Code Mode: Thresholds
// ============================================================

describe('Section CC.8 — Claude Code Mode thresholds', () => {
  it('shouldAutoCompact triggers at threshold', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, autoCompactThreshold: 10 } });
    assertFalse(shouldAutoCompact(5, config), 'below threshold');
    assertTrue(shouldAutoCompact(10, config), 'at threshold');
    assertTrue(shouldAutoCompact(15, config), 'above threshold');
  });

  it('shouldAutoCompact returns false when disabled', () => {
    const config = getClaudeCodeConfig();
    assertFalse(shouldAutoCompact(100, config), 'disabled');
  });

  it('shouldCompactByTokens triggers at threshold', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, compactTokenThreshold: 1000 } });
    assertFalse(shouldCompactByTokens(500, config), 'below threshold');
    assertTrue(shouldCompactByTokens(1000, config), 'at threshold');
    assertTrue(shouldCompactByTokens(2000, config), 'above threshold');
  });

  it('shouldAutoReset triggers at maxTurns', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true, maxTurns: 20 } });
    assertFalse(shouldAutoReset(10, config), 'below maxTurns');
    assertTrue(shouldAutoReset(20, config), 'at maxTurns');
    assertTrue(shouldAutoReset(30, config), 'above maxTurns');
  });
});

// ============================================================
// Section CC.9 — Claude Code Mode: Settings & Summary
// ============================================================

describe('Section CC.9 — buildClaudeCodeSettings', () => {
  it('returns existing settings when disabled', () => {
    const existing = { session: { enabled: true } };
    const config = getClaudeCodeConfig();
    const result = buildClaudeCodeSettings(existing, config);
    assertEqual(result.session.enabled, true, 'preserved');
    assertTrue(result.claudeCodeMode === undefined, 'no claudeCodeMode key');
  });

  it('merges claudeCodeMode when enabled', () => {
    const existing = { session: { enabled: true } };
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true } });
    const result = buildClaudeCodeSettings(existing, config);
    assertTrue(result.claudeCodeMode.enabled, 'claudeCodeMode enabled');
    assertEqual(result.session.compaction.keepRecentCount, 5, 'keepRecentCount');
    assertTrue(result.session.compaction.stripThinking, 'stripThinking');
    assertEqual(result.session.autoReset.maxMessages, 50, 'maxMessages');
  });

  it('preserves existing session compaction settings', () => {
    const existing = { session: { compaction: { maxToolResultChars: 8000 } } };
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true } });
    const result = buildClaudeCodeSettings(existing, config);
    assertEqual(result.session.compaction.maxToolResultChars, 8000, 'preserved');
    assertEqual(result.session.compaction.keepRecentCount, 5, 'added');
  });
});

describe('Section CC.10 — getClaudeCodeSummary', () => {
  it('returns disabled message when not enabled', () => {
    const config = getClaudeCodeConfig();
    assertEqual(getClaudeCodeSummary(config), 'Claude Code mode: disabled', 'disabled');
  });

  it('returns full summary when enabled', () => {
    const config = getClaudeCodeConfig({ claudeCodeMode: { enabled: true } });
    const summary = getClaudeCodeSummary(config);
    assertTrue(summary.includes('ENABLED'), 'has ENABLED');
    assertTrue(summary.includes('reasoning_effort: low'), 'has reasoning_effort');
    assertTrue(summary.includes('stripThinking: true'), 'has stripThinking');
    assertTrue(summary.includes('keepRecentCount: 5'), 'has keepRecentCount');
    assertTrue(summary.includes('maxTurns: 50'), 'has maxTurns');
    assertTrue(summary.includes('compactTokenThreshold: 30000'), 'has compactTokenThreshold');
  });
});

// ============================================================
// Section WS.1 — Workspace Scheduler: File Locks
// ============================================================

describe('Section WS.1 — acquireFileLock', () => {
  it('acquires lock on unlocked file', () => {
    clearWorkspaceState();
    const result = acquireFileLock('src/main.ts', 'session-1');
    assertTrue(result.acquired, 'should acquire');
    assertEqual(result.filePath, 'src/main.ts', 'filePath normalized');
  });

  it('acquires lock on same file by same session (refresh)', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    const result = acquireFileLock('src/main.ts', 'session-1');
    assertTrue(result.acquired, 'same session refresh');
  });

  it('rejects lock on file locked by another session', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    const result = acquireFileLock('src/main.ts', 'session-2');
    assertFalse(result.acquired, 'should reject');
    assertEqual(result.ownerSessionId, 'session-1', 'owner is session-1');
    assertTrue(result.reason!.includes('session-1'), 'reason mentions owner');
  });

  it('normalizes paths', () => {
    clearWorkspaceState();
    const result = acquireFileLock('src\\main.ts', 'session-1');
    assertTrue(result.acquired, 'should acquire');
    assertEqual(result.filePath, 'src/main.ts', 'normalized');
  });

  it('normalizes duplicate slashes', () => {
    clearWorkspaceState();
    const result = acquireFileLock('src//main.ts', 'session-1');
    assertEqual(result.filePath, 'src/main.ts', 'normalized');
  });
});

describe('Section WS.2 — releaseFileLock', () => {
  it('releases lock owned by session', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    const released = releaseFileLock('src/main.ts', 'session-1');
    assertTrue(released, 'should release');

    // Another session can now acquire
    const result = acquireFileLock('src/main.ts', 'session-2');
    assertTrue(result.acquired, 'can acquire after release');
  });

  it('returns false for non-existent lock', () => {
    clearWorkspaceState();
    const released = releaseFileLock('src/nonexistent.ts', 'session-1');
    assertFalse(released, 'no lock to release');
  });

  it('returns false when releasing lock owned by another session', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    const released = releaseFileLock('src/main.ts', 'session-2');
    assertFalse(released, 'wrong session');
  });
});

describe('Section WS.3 — releaseSessionLocks', () => {
  it('releases all locks for a session', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    acquireFileLock('src/utils.ts', 'session-1');
    acquireFileLock('src/config.ts', 'session-2');

    const released = releaseSessionLocks('session-1');
    assertEqual(released, 2, 'released 2 locks');

    // session-2 can now acquire the released files
    const result = acquireFileLock('src/main.ts', 'session-2');
    assertTrue(result.acquired, 'can acquire after session-1 released');
  });

  it('returns 0 for session with no locks', () => {
    clearWorkspaceState();
    const released = releaseSessionLocks('nonexistent-session');
    assertEqual(released, 0, 'no locks');
  });
});

// ============================================================
// Section WS.4 — File Change Tracking
// ============================================================

describe('Section WS.4 — recordFileChange and isFileStale', () => {
  it('records file change and detects stale', () => {
    clearWorkspaceState();
    recordFileChange('src/main.ts', 'session-1', 'write');
    assertTrue(isFileStale('src/main.ts', 'session-2'), 'stale for other session');
    assertFalse(isFileStale('src/main.ts', 'session-1'), 'not stale for same session');
  });

  it('returns false for untracked files', () => {
    clearWorkspaceState();
    assertFalse(isFileStale('src/untracked.ts', 'session-1'), 'untracked');
  });

  it('tracks file timestamps', () => {
    clearWorkspaceState();
    recordFileChange('src/main.ts', 'session-1', 'write');
    recordFileChange('src/utils.ts', 'session-2', 'replace');

    assertTrue(isFileStale('src/main.ts', 'session-2'), 'main.ts stale for session-2');
    assertTrue(isFileStale('src/utils.ts', 'session-1'), 'utils.ts stale for session-1');
    assertFalse(isFileStale('src/main.ts', 'session-1'), 'main.ts not stale for session-1');
  });
});

// ============================================================
// Section WS.5 — Conflict Detection
// ============================================================

describe('Section WS.5 — checkConflict', () => {
  it('detects lock conflict', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    const conflict = checkConflict('src/main.ts', 'session-2');
    assertTrue(conflict.hasConflict, 'has conflict');
    assertEqual(conflict.conflictingSession, 'session-1', 'conflicting session');
    assertEqual(conflict.conflictingFile, 'src/main.ts', 'conflicting file');
  });

  it('returns no conflict for unlocked file', () => {
    clearWorkspaceState();
    const conflict = checkConflict('src/main.ts', 'session-1');
    assertFalse(conflict.hasConflict, 'no conflict');
  });

  it('returns no conflict for same session lock', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    const conflict = checkConflict('src/main.ts', 'session-1');
    assertFalse(conflict.hasConflict, 'same session');
  });

  it('detects recent change conflict', () => {
    clearWorkspaceState();
    recordFileChange('src/main.ts', 'session-1', 'write');
    const conflict = checkConflict('src/main.ts', 'session-2');
    assertTrue(conflict.hasConflict, 'recent change conflict');
    assertTrue(conflict.reason!.includes('recently modified'), 'reason');
  });
});

// ============================================================
// Section WS.6 — Hot Files & Diagnostics
// ============================================================

describe('Section WS.6 — getHotFiles and diagnostics', () => {
  it('returns hot files', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    acquireFileLock('src/utils.ts', 'session-2');

    const hot = getHotFiles();
    assertEqual(hot.length, 2, 'two hot files');
    assertTrue(hot.some(f => f.filePath === 'src/main.ts'), 'main.ts');
    assertTrue(hot.some(f => f.filePath === 'src/utils.ts'), 'utils.ts');
  });

  it('returns diagnostics', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1');
    recordFileChange('src/utils.ts', 'session-2', 'write');

    const diag = getWorkspaceDiagnostics();
    assertEqual(diag.activeLocks, 1, 'one active lock');
    assertEqual(diag.trackedSessions, 1, 'one tracked session');
    assertEqual(diag.recentChangeCount, 1, 'one recent change');
  });
});

// ============================================================
// Section WS.7 — Lock Expiration & Cleanup
// ============================================================

describe('Section WS.7 — cleanupExpiredLocks', () => {
  it('cleans up expired locks', () => {
    clearWorkspaceState();
    // Acquire with very short timeout
    acquireFileLock('src/main.ts', 'session-1', 1); // 1ms timeout
    // Wait a bit
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    const cleaned = cleanupExpiredLocks();
    assertTrue(cleaned >= 0, 'cleanup ran');

    // Should be able to acquire now
    const result = acquireFileLock('src/main.ts', 'session-2');
    assertTrue(result.acquired, 'can acquire after cleanup');
  });

  it('does not clean active locks', () => {
    clearWorkspaceState();
    acquireFileLock('src/main.ts', 'session-1', 60000);
    acquireFileLock('src/utils.ts', 'session-2', 60000);

    const cleaned = cleanupExpiredLocks(100); // 100ms max age
    // These locks were just acquired (age ~0ms), should not be cleaned
    const hot = getHotFiles();
    assertTrue(hot.length === 2, 'active locks preserved');
  });
});

// ============================================================
// Section WS.8 — Path Normalization
// ============================================================

describe('Section WS.8 — Path normalization', () => {
  it('normalizes backslashes to forward slashes', () => {
    clearWorkspaceState();
    const result = acquireFileLock('src\\main.ts', 'session-1');
    assertEqual(result.filePath, 'src/main.ts', 'backslash normalized');
  });

  it('removes trailing slash', () => {
    clearWorkspaceState();
    const result = acquireFileLock('src/main.ts/', 'session-1');
    assertEqual(result.filePath, 'src/main.ts', 'trailing slash removed');
  });

  it('removes duplicate slashes', () => {
    clearWorkspaceState();
    const result = acquireFileLock('src//main.ts', 'session-1');
    assertEqual(result.filePath, 'src/main.ts', 'duplicate slash removed');
  });

  it('treats equivalent paths as same file', () => {
    clearWorkspaceState();
    acquireFileLock('src\\main.ts', 'session-1');
    const result = acquireFileLock('src/main.ts', 'session-2');
    assertFalse(result.acquired, 'same file different separators');
  });
});

flushAsync().then(() => printSummary());