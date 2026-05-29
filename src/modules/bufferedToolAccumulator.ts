/**
 * Buffered Tool Call Accumulator
 * 
 * Buffers streaming content until a complete tool call block is detected.
 * This prevents partial XML/JSON parse errors that cause malformed tool calls.
 * 
 * Key principle: DON'T parse until the block is COMPLETE.
 * 
 * Phase 9: Added BufferedStreamParser class for improved chunk stitching.
 */

export interface AccumulatorState {
  /** Raw content buffer */
  buffer: string;
  /** Whether we're inside a tool call block */
  capturing: boolean;
  /** The format being captured */
  captureFormat: 'xml_ml' | 'xml_legacy' | 'json_envelope' | 'bracket' | null;
  /** Depth tracking for nested structures */
  depth: number;
  /** Whether a complete tool call was detected */
  complete: boolean;
  /** The complete tool call content */
  completeContent: string | null;
  /** Non-tool-call text that was accumulated */
  textContent: string;
  /** Partial text that might be start of tool call */
  pendingText: string;
}

export function createAccumulatorState(): AccumulatorState {
  return {
    buffer: '',
    capturing: false,
    captureFormat: null,
    depth: 0,
    complete: false,
    completeContent: null,
    textContent: '',
    pendingText: '',
  };
}

/** Markers for tool call detection */
const MARKERS = {
  xml_ml: { open: '<ml_tool_calls', close: '</ml_tool_calls>' },
  xml_legacy: { open: '<tool_calls>', close: '</tool_calls>' },
  json_envelope: { open: '__tool_call__', close: '}' },
  bracket: { open: '[function_calls]', close: '[/function_calls]' },
} as const;

/** All opening marker prefixes (for partial match detection) */
const OPEN_PREFIXES = [
  '<ml_tool_calls',
  '<tool_calls>',
  '__tool_call__',
  '[function_calls]',
];

/** All closing markers */
const CLOSE_MARKERS = [
  '</ml_tool_calls>',
  '</tool_calls>',
  '[/function_calls]',
];

/** Maximum length of any marker prefix — used for holdback window */
const MAX_MARKER_PREFIX_LEN = Math.max(
  ...OPEN_PREFIXES.map(m => m.length),
  ...CLOSE_MARKERS.map(m => m.length),
);

/**
 * Find if the end of a string matches a prefix of any marker.
 * Returns the number of characters to hold back.
 */
function findPartialMarker(buf: string): number {
  if (!buf || buf.length === 0) return 0;
  
  // Check all open/close marker prefixes
  const allMarkers = [...OPEN_PREFIXES, ...CLOSE_MARKERS];
  
  for (const marker of allMarkers) {
    // Check if the end of buf is a prefix of this marker
    const checkLen = Math.min(marker.length - 1, buf.length);
    for (let len = checkLen; len >= 1; len--) {
      const tail = buf.slice(buf.length - len);
      if (marker.startsWith(tail)) {
        return len;
      }
    }
  }

  return 0;
}

/**
 * Process an incoming chunk through the accumulator.
 * Returns:
 * - textChunks: text content to emit to the client (safe, non-tool-call text)
 * - toolCallReady: if true, completeContent has the full tool call block
 */
export function processChunk(
  state: AccumulatorState,
  chunk: string,
): { textChunks: string; toolCallReady: boolean } {
  if (!chunk) return { textChunks: '', toolCallReady: false };

  state.buffer += chunk;

  // If already complete, don't process more
  if (state.complete) {
    return { textChunks: '', toolCallReady: false };
  }

  // If already capturing, look for close marker
  if (state.capturing) {
    return checkForCompletion(state);
  }

  // Not yet capturing — look for open markers
  const startResult = detectAndStartCapture(state);
  // If we just started capturing, immediately check for completion
  // (the close marker might already be in the buffer)
  if (state.capturing && !state.complete) {
    const completionResult = checkForCompletion(state);
    if (completionResult.toolCallReady) {
      // Merge: any text from startResult + the completion result
      return { textChunks: startResult.textChunks, toolCallReady: true };
    }
  }
  return startResult;
}

/**
 * Detect if buffer contains start of a tool call block.
 * If found, start capturing. If not, emit as safe text.
 */
function detectAndStartCapture(state: AccumulatorState): { textChunks: string; toolCallReady: boolean } {
  const buf = state.buffer;

  // Check each format for an opening marker
  for (const [format, markers] of Object.entries(MARKERS)) {
    const idx = buf.indexOf(markers.open);
    if (idx >= 0) {
      // Found a potential tool call start
      // Emit text before the marker as safe text
      const textBefore = buf.slice(0, idx);
      const remaining = buf.slice(idx);

      // Check if this is a partial marker match (could be start of marker)
      // Only commit if we have enough of the marker to be sure
      if (format === 'xml_ml' || format === 'xml_legacy' || format === 'bracket') {
        // For XML/bracket, the open marker itself is complete once found
        state.buffer = remaining;
        state.capturing = true;
        state.captureFormat = format as any;
        state.pendingText = '';
        return { textChunks: textBefore, toolCallReady: false };
      }
    }
  }

  // No marker found yet
  // But we might have a PARTIAL marker at the end of the buffer
  // Check for partial matches and hold back only those chars
  const holdback = findPartialMarker(buf);
  if (holdback > 0) {
    // Emit everything except the holdback region
    const safeText = buf.slice(0, buf.length - holdback);
    state.buffer = buf.slice(buf.length - holdback);
    return { textChunks: safeText, toolCallReady: false };
  }

  // No partial marker at the end — all content is safe text, emit it all.
  // This ensures short text like "Hello world" passes through immediately.
  const safeText = buf;
  state.buffer = '';
  return { textChunks: safeText, toolCallReady: false };
}

/**
 * Check if the capture is complete (close marker found).
 */
function checkForCompletion(state: AccumulatorState): { textChunks: string; toolCallReady: boolean } {
  const buf = state.buffer;
  const format = state.captureFormat!;

  let closeIdx = -1;

  switch (format) {
    case 'xml_ml':
      closeIdx = buf.indexOf('</ml_tool_calls>');
      if (closeIdx >= 0) {
        state.completeContent = buf.slice(0, closeIdx + '</ml_tool_calls>'.length);
        state.buffer = buf.slice(closeIdx + '</ml_tool_calls>'.length);
        state.complete = true;
        return { textChunks: '', toolCallReady: true };
      }
      break;

    case 'xml_legacy':
      closeIdx = buf.indexOf('</tool_calls>');
      if (closeIdx >= 0) {
        state.completeContent = buf.slice(0, closeIdx + '</tool_calls>'.length);
        state.buffer = buf.slice(closeIdx + '</tool_calls>'.length);
        state.complete = true;
        return { textChunks: '', toolCallReady: true };
      }
      break;

    case 'bracket':
      closeIdx = buf.indexOf('[/function_calls]');
      if (closeIdx >= 0) {
        state.completeContent = buf.slice(0, closeIdx + '[/function_calls]'.length);
        state.buffer = buf.slice(closeIdx + '[/function_calls]'.length);
        state.complete = true;
        return { textChunks: '', toolCallReady: true };
      }
      break;
  }

  // Still capturing — no close marker found yet
  return { textChunks: '', toolCallReady: false };
}

/**
 * Finalize the accumulator — called when the stream ends.
 * Returns any remaining buffered content as text.
 */
export function finalize(state: AccumulatorState): { text: string; toolCallContent: string | null } {
  if (state.complete && state.completeContent) {
    // Return remaining buffer as text + the complete tool call
    return {
      text: state.buffer,
      toolCallContent: state.completeContent,
    };
  }

  if (state.capturing) {
    // Incomplete capture — the tool call was never completed
    // Return everything as text (incomplete tool call = treat as text)
    return {
      text: state.buffer,
      toolCallContent: null,
    };
  }

  // Never started capturing — all content is text
  return {
    text: state.buffer,
    toolCallContent: null,
  };
}

/**
 * Reset the accumulator for reuse (e.g., after processing one tool call block).
 */
export function reset(state: AccumulatorState): void {
  state.buffer = '';
  state.capturing = false;
  state.captureFormat = null;
  state.depth = 0;
  state.complete = false;
  state.completeContent = null;
  state.pendingText = '';
}

// ===== Phase 9: BufferedStreamParser — Class-based API =====

export interface BufferedStreamResult {
  /** Safe text to emit to client immediately */
  textChunks: string;
  /** Whether a complete tool call block has been detected */
  toolCallReady: boolean;
  /** The complete tool call content (only set when toolCallReady is true) */
  toolCallContent: string | null;
}

/**
 * BufferedStreamParser — Class-based buffered incremental parser.
 * 
 * Usage:
 *   const parser = new BufferedStreamParser();
 *   const result = parser.processChunk('some text...');
 *   if (result.toolCallReady) { /* emit tool call *​/ }
 *   else if (result.textChunks) { /* emit text *​/ }
 *   const final = parser.finalize();
 */
export class BufferedStreamParser {
  private state: AccumulatorState;
  private toolCallEmitted: boolean = false;

  constructor() {
    this.state = createAccumulatorState();
  }

  /**
   * Process a single chunk from the stream.
   * Returns text to emit immediately and any completed tool call.
   */
  processChunk(chunk: string | null | undefined): BufferedStreamResult {
    if (chunk === null || chunk === undefined || chunk === '') {
      return { textChunks: '', toolCallReady: false, toolCallContent: null };
    }

    // If tool call already emitted, remaining is text
    if (this.toolCallEmitted) {
      return { textChunks: chunk, toolCallReady: false, toolCallContent: null };
    }

    const result = processChunk(this.state, chunk);

    if (result.toolCallReady) {
      this.toolCallEmitted = true;
      const toolCallContent = this.state.completeContent;
      
      // Any remaining buffer content is trailing text
      const trailingText = this.state.buffer || '';
      // Also include any text that was emitted before the tool call marker
      const allText = (result.textChunks || '') + (trailingText || '');
      
      return {
        textChunks: allText,
        toolCallReady: true,
        toolCallContent,
      };
    }

    return {
      textChunks: result.textChunks,
      toolCallReady: false,
      toolCallContent: null,
    };
  }

  /**
   * Finalize the parser — called when the stream ends.
   * Returns any remaining buffered content.
   */
  finalize(): { text: string; toolCallContent: string | null } {
    return finalize(this.state);
  }

  /**
   * Reset the parser for reuse.
   */
  reset(): void {
    reset(this.state);
    this.toolCallEmitted = false;
  }
}