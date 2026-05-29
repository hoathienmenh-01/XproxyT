/**
 * Session Snapshot — Extract key context from a session for injection into new requests.
 * 
 * Instead of sending full conversation history, extract:
 * - Active task (what the user is trying to do)
 * - Recent errors (what went wrong)
 * - File references (what files are being worked on)
 * - Recent edits (what changes were made)
 * - Last tool results (what the model just did)
 * - Working directory context
 */

export interface SessionSnapshot {
  activeTask: string;
  recentErrors: string[];
  fileReferences: string[];
  recentEdits: string[];
  lastToolResults: string[];
  workingDirectory: string;
  turnCount: number;
  createdAt: number;
}

export interface SnapshotOptions {
  maxActiveTaskChars: number;
  maxErrorChars: number;
  maxFileReferences: number;
  maxRecentEdits: number;
  maxLastToolResults: number;
  maxToolResultChars: number;
}

const DEFAULT_OPTIONS: SnapshotOptions = {
  maxActiveTaskChars: 500,
  maxErrorChars: 300,
  maxFileReferences: 20,
  maxRecentEdits: 5,
  maxLastToolResults: 3,
  maxToolResultChars: 1000,
};

const FILE_PATTERNS = [
  /(?:^|\s)(\/[\w\-./]+\.\w+)/gm,
  /(?:^|\s)(\.[\w\-./]+\.\w+)/gm,
  /(?:path|file|filePath|file_path)[:\s="]+([^\s"']+?\.\w+)/gi,
];

const EDIT_PATTERNS = [
  /(?:write_to_file|replace_in_file|write_file|edit_file).*?(?:path|file)[:\s="]+([^\s"']+)/i,
  /(?:created?|modified?|edited?|updated?)\s+(?:file\s+)?[:\s]*([^\s]+\.\w+)/i,
];

const ERROR_PATTERNS = [
  /error[:\s]/i,
  /failed[:\s]/i,
  /exception[:\s]/i,
  /ENOENT/i,
  /EACCES/i,
  /syntaxerror/i,
  /typeerror/i,
  /referenceerror/i,
  /cannot find/i,
  /not found/i,
  /permission denied/i,
];

/**
 * Create a snapshot from a message array.
 */
export function createSnapshot(
  messages: any[],
  options: Partial<SnapshotOptions> = {},
): SessionSnapshot {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const snapshot: SessionSnapshot = {
    activeTask: '',
    recentErrors: [],
    fileReferences: [],
    recentEdits: [],
    lastToolResults: [],
    workingDirectory: '',
    turnCount: messages.length,
    createdAt: Date.now(),
  };

  if (!messages || messages.length === 0) return snapshot;

  // Extract active task (last user message)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'user') {
      const content = getMessageContent(msg);
      snapshot.activeTask = content.slice(0, opts.maxActiveTaskChars);
      break;
    }
  }

  // Extract file references, errors, edits, tool results
  const seenFiles = new Set<string>();
  const seenErrors = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const content = getMessageContent(msg);

    // File references
    if (seenFiles.size < opts.maxFileReferences) {
      for (const pattern of FILE_PATTERNS) {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(content)) !== null) {
          const file = match[1];
          if (file && !seenFiles.has(file) && file.length > 3 && file.length < 200) {
            seenFiles.add(file);
            if (seenFiles.size >= opts.maxFileReferences) break;
          }
        }
      }
    }

    // Recent errors (from tool results and assistant messages)
    if (snapshot.recentErrors.length < 3 && (msg.role === 'tool' || msg.role === 'assistant')) {
      for (const pattern of ERROR_PATTERNS) {
        if (pattern.test(content)) {
          const lines = content.split('\n');
          for (const line of lines) {
            if (pattern.test(line)) {
              const errorText = line.trim().slice(0, opts.maxErrorChars);
              if (errorText && !seenErrors.has(errorText)) {
                seenErrors.add(errorText);
                snapshot.recentErrors.push(errorText);
              }
              break;
            }
          }
          break;
        }
      }
    }

    // Recent edits
    if (snapshot.recentEdits.length < opts.maxRecentEdits) {
      for (const pattern of EDIT_PATTERNS) {
        const match = content.match(pattern);
        if (match && match[1]) {
          const edit = match[1].trim();
          if (edit && !snapshot.recentEdits.includes(edit)) {
            snapshot.recentEdits.push(edit);
          }
        }
      }
    }

    // Last tool results
    if (snapshot.lastToolResults.length < opts.maxLastToolResults && msg.role === 'tool') {
      const truncated = content.slice(0, opts.maxToolResultChars);
      if (truncated.trim()) {
        snapshot.lastToolResults.push(truncated);
      }
    }
  }

  snapshot.fileReferences = Array.from(seenFiles);

  // Extract working directory from messages
  for (const msg of messages) {
    if (!msg) continue;
    const content = getMessageContent(msg);
    const wdMatch = content.match(/(?:working.?directory|cwd|current.?dir)[:\s=]+([^\s\n]+)/i);
    if (wdMatch && wdMatch[1]) {
      snapshot.workingDirectory = wdMatch[1];
      break;
    }
  }

  return snapshot;
}

/**
 * Format a snapshot as a structured context string for injection into system prompt.
 */
export function formatSnapshotAsContext(snapshot: SessionSnapshot): string {
  const parts: string[] = [];

  parts.push('=== SESSION CONTEXT SNAPSHOT ===');

  if (snapshot.activeTask) {
    parts.push(`\n## Active Task\n${snapshot.activeTask}`);
  }

  if (snapshot.workingDirectory) {
    parts.push(`\n## Working Directory\n${snapshot.workingDirectory}`);
  }

  if (snapshot.fileReferences.length > 0) {
    parts.push(`\n## Files Referenced\n${snapshot.fileReferences.slice(0, 15).join('\n')}`);
  }

  if (snapshot.recentEdits.length > 0) {
    parts.push(`\n## Recent Edits\n${snapshot.recentEdits.join('\n')}`);
  }

  if (snapshot.recentErrors.length > 0) {
    parts.push(`\n## Recent Errors\n${snapshot.recentErrors.join('\n')}`);
  }

  if (snapshot.lastToolResults.length > 0) {
    parts.push(`\n## Last Tool Results\n${snapshot.lastToolResults.join('\n---\n')}`);
  }

  parts.push(`\n## Session Stats\nTurns: ${snapshot.turnCount}`);
  parts.push('=== END SNAPSHOT ===');

  return parts.join('\n');
}

/**
 * Merge a snapshot with a message array.
 * The snapshot is prepended as a system message.
 */
export function mergeSnapshotWithMessages(
  messages: any[],
  snapshot: SessionSnapshot,
  existingSystemPrompt?: string,
): any[] {
  const snapshotContext = formatSnapshotAsContext(snapshot);

  if (!snapshotContext) return messages;

  // Find existing system message
  const systemIdx = messages.findIndex(m => m?.role === 'system');

  if (systemIdx >= 0) {
    // Append snapshot to existing system message
    const updated = [...messages];
    const existingContent = getMessageContent(updated[systemIdx]);
    updated[systemIdx] = {
      ...updated[systemIdx],
      content: existingContent + '\n\n' + snapshotContext,
    };
    return updated;
  }

  // No system message — prepend one
  const systemContent = existingSystemPrompt
    ? existingSystemPrompt + '\n\n' + snapshotContext
    : snapshotContext;

  return [
    { role: 'system', content: systemContent },
    ...messages,
  ];
}

/**
 * Helper to extract content string from a message.
 */
function getMessageContent(msg: any): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part?.text) return part.text;
        return JSON.stringify(part);
      })
      .join('\n');
  }
  return JSON.stringify(msg.content || '');
}