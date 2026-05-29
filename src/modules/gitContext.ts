/**
 * Git-aware Context — Send git diff instead of full files to reduce token usage.
 *
 * When Claude Code / Cline edits files, the full file content is often sent
 * back as context. For large files, this wastes tokens. Instead, we can:
 * - Detect when a file has been recently modified
 * - Generate a git diff summary
 * - Replace full file content with diff in the context
 * - Track git status for workspace awareness
 */

import { execSync } from 'child_process';

export interface GitDiffResult {
  filePath: string;
  hasChanges: boolean;
  diff: string;
  insertions: number;
  deletions: number;
  summary: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  dirtyFiles: string[];
  ahead: number;
  behind: number;
  lastCommit: string;
  lastCommitMessage: string;
}

export interface GitContextOptions {
  /** Working directory for git commands */
  cwd?: string;
  /** Maximum diff size in characters */
  maxDiffChars?: number;
  /** Include untracked files */
  includeUntracked?: boolean;
  /** Files to exclude from diff */
  excludePatterns?: string[];
}

const DEFAULT_MAX_DIFF_CHARS = 2000;
const GIT_TIMEOUT_MS = 5000;

/**
 * Check if a path is inside a git repository.
 */
export function isGitRepo(cwd?: string): boolean {
  try {
    const result = execSync('git rev-parse --is-inside-work-tree', {
      cwd: cwd || process.cwd(),
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Get git status for the workspace.
 */
export function getGitStatus(options?: GitContextOptions): GitStatusResult {
  const cwd = options?.cwd || process.cwd();

  const defaultResult: GitStatusResult = {
    isRepo: false,
    branch: '',
    dirtyFiles: [],
    ahead: 0,
    behind: 0,
    lastCommit: '',
    lastCommitMessage: '',
  };

  try {
    if (!isGitRepo(cwd)) return defaultResult;

    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const statusOutput = execSync('git status --porcelain', {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const dirtyFiles = statusOutput
      ? statusOutput.split('\n').map(line => line.slice(3).trim()).filter(Boolean)
      : [];

    let ahead = 0;
    let behind = 0;
    try {
      const revList = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const parts = revList.split(/\s+/);
      if (parts.length >= 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // No upstream configured
    }

    let lastCommit = '';
    let lastCommitMessage = '';
    try {
      lastCommit = execSync('git rev-parse --short HEAD', {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      lastCommitMessage = execSync('git log -1 --pretty=format:"%s"', {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().replace(/^"|"$/g, '');
    } catch {
      // No commits yet
    }

    return {
      isRepo: true,
      branch,
      dirtyFiles,
      ahead,
      behind,
      lastCommit,
      lastCommitMessage,
    };
  } catch {
    return defaultResult;
  }
}

/**
 * Get git diff for a specific file.
 * Returns diff content or empty if no changes.
 */
export function getFileDiff(
  filePath: string,
  options?: GitContextOptions,
): GitDiffResult {
  const cwd = options?.cwd || process.cwd();
  const maxDiffChars = options?.maxDiffChars || DEFAULT_MAX_DIFF_CHARS;

  const defaultResult: GitDiffResult = {
    filePath,
    hasChanges: false,
    diff: '',
    insertions: 0,
    deletions: 0,
    summary: '',
  };

  try {
    if (!isGitRepo(cwd)) return defaultResult;

    // Check if file has changes
    const diffStat = execSync(`git diff --numstat -- "${filePath}"`, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!diffStat) {
      // Check staged changes
      const stagedStat = execSync(`git diff --cached --numstat -- "${filePath}"`, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (!stagedStat) return defaultResult;
    }

    const statLine = diffStat || '';
    const parts = statLine.split('\t');
    const insertions = parseInt(parts[0], 10) || 0;
    const deletions = parseInt(parts[1], 10) || 0;

    // Get actual diff
    let diff = execSync(`git diff -- "${filePath}"`, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!diff) {
      // Try staged diff
      diff = execSync(`git diff --cached -- "${filePath}"`, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    }

    // Truncate if too long
    let truncated = false;
    if (diff.length > maxDiffChars) {
      diff = diff.slice(0, maxDiffChars) + '\n... (truncated)';
      truncated = true;
    }

    const summary = `+${insertions} -${deletions}${truncated ? ' (truncated)' : ''}`;

    return {
      filePath,
      hasChanges: true,
      diff,
      insertions,
      deletions,
      summary,
    };
  } catch {
    return defaultResult;
  }
}

/**
 * Get diffs for all modified files in the workspace.
 */
export function getWorkspaceDiff(options?: GitContextOptions): GitDiffResult[] {
  const cwd = options?.cwd || process.cwd();
  const results: GitDiffResult[] = [];

  try {
    if (!isGitRepo(cwd)) return results;

    const status = getGitStatus(options);
    const excludePatterns = options?.excludePatterns || [];

    for (const file of status.dirtyFiles) {
      // Check exclusion patterns
      if (excludePatterns.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(file);
        }
        return file.includes(pattern);
      })) {
        continue;
      }

      const diff = getFileDiff(file, options);
      if (diff.hasChanges) {
        results.push(diff);
      }
    }

    return results;
  } catch {
    return results;
  }
}

/**
 * Build a git context summary string.
 * Used to replace full file content in context with diff summaries.
 */
export function buildGitContextSummary(options?: GitContextOptions): string {
  const status = getGitStatus(options);

  if (!status.isRepo) return '';

  const lines: string[] = ['=== GIT WORKSPACE CONTEXT ==='];

  lines.push(`Branch: ${status.branch}`);
  if (status.ahead > 0 || status.behind > 0) {
    lines.push(`Ahead: ${status.ahead}, Behind: ${status.behind}`);
  }
  if (status.lastCommit) {
    lines.push(`Last commit: ${status.lastCommit} — ${status.lastCommitMessage}`);
  }

  if (status.dirtyFiles.length > 0) {
    lines.push(`\nModified files (${status.dirtyFiles.length}):`);
    const diffs = getWorkspaceDiff(options);
    for (const diff of diffs) {
      lines.push(`  ${diff.filePath} [${diff.summary}]`);
      if (diff.diff) {
        // Include abbreviated diff
        const diffLines = diff.diff.split('\n');
        const contextLines = diffLines.slice(0, 20);
        lines.push(contextLines.map(l => '    ' + l).join('\n'));
        if (diffLines.length > 20) {
          lines.push(`    ... (${diffLines.length - 20} more lines)`);
        }
      }
    }
  } else {
    lines.push('No modified files.');
  }

  return lines.join('\n');
}

/**
 * Replace full file content references in messages with git diff context.
 * Scans messages for tool results that contain full file reads and replaces
 * them with diff summaries when the file has been modified.
 */
export function replaceFullContentWithDiffs(
  messages: any[],
  options?: GitContextOptions,
): any[] {
  const diffs = getWorkspaceDiff(options);
  if (diffs.length === 0) return messages;

  const diffMap = new Map<string, GitDiffResult>();
  for (const diff of diffs) {
    diffMap.set(diff.filePath, diff);
  }

  return messages.map(msg => {
    if (msg.role !== 'tool' && msg.role !== 'assistant') return msg;
    if (typeof msg.content !== 'string') return msg;

    // Check if this message contains a full file read for a modified file
    for (const [filePath, diff] of diffMap) {
      const filePattern = new RegExp(
        `(?:Reading file|File content|<read_file>|path>${escapeRegex(filePath)})`,
        'i',
      );

      if (filePattern.test(msg.content)) {
        // Replace full content with diff summary
        return {
          ...msg,
          content: `[Git diff for ${filePath}]\n${diff.diff}\n[End diff — ${diff.summary}]`,
        };
      }
    }

    return msg;
  });
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}