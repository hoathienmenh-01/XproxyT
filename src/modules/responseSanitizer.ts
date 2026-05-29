/**
 * Response Sanitizer Layer — post-processes Qwen upstream responses
 * to fix common issues before emitting to downstream clients.
 *
 * Handles:
 * A. Duplicate assistant content
 * B. Malformed/unclosed XML tags
 * C. Incomplete tool call blocks
 * D. Leaked raw XML
 * E. Reasoning content leaking into answer
 * F. Empty/no-content responses
 */

// ---- Leak patterns: things Qwen outputs that should never reach the client ----
const LEAK_PATTERNS: RegExp[] = [
  /tool resources exhausted/i,
  /直接聊天/,
  /无法访问该链接/,
  /用户使用了工具，但未能成功执行/,
  /Tool does not exists?\.?/i,
  /Function .+ is not found/i,
  /I (do not|don't|cannot?) (?:have|possess|use) (?:a )?(?:tool|function)/i,
  /\bBuilt-in tools?\b.*\bexhausted\b/i,
  /The chat is in progress/i,
];

// ---- Reasoning leak patterns: thinking traces that leak into answer content ----
const REASONING_LEAK_PATTERNS: RegExp[] = [
  /<think>[\s\S]*?<\/think>/g,
  /\bLet me think about this\b/i,
  /\bFirst, I need to analyze\b/i,
  /\bMy reasoning process\b/i,
];

/**
 * Strip reasoning/thinking blocks from answer content.
 * This is the P1 fix — reasoning content is the #1 cause of parser corruption.
 */
export function stripReasoningFromAnswer(content: string): string {
  if (!content) return content;

  // Strip <think>...</think> blocks (Qwen's native thinking output)
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Strip <thinking>...</thinking> blocks (some models use this format)
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');

  // Strip partial unclosed <think> blocks (common in streaming)
  cleaned = cleaned.replace(/<think>[\s\S]*$/g, '');
  cleaned = cleaned.replace(/<thinking>[\s\S]*$/g, '');

  return cleaned.trim();
}

/**
 * Auto-close unclosed XML tags.
 * If a tag was opened but never closed, close it to prevent parser corruption.
 */
export function autoCloseXmlTags(content: string): string {
  if (!content) return content;

  let result = content;

  // Check for unclosed ml_tool_calls
  const openCount = (result.match(/<ml_tool_calls>/g) || []).length;
  const closeCount = (result.match(/<\/ml_tool_calls>/g) || []).length;
  if (openCount > closeCount) {
    // Close any unclosed inner tags first
    const unclosedCall = (result.match(/<ml_tool_call>/g) || []).length
      - (result.match(/<\/ml_tool_call>/g) || []).length;
    const unclosedName = (result.match(/<ml_tool_name>/g) || []).length
      - (result.match(/<\/ml_tool_name>/g) || []).length;
    const unclosedParams = (result.match(/<ml_parameters>/g) || []).length
      - (result.match(/<\/ml_parameters>/g) || []).length;

    let suffix = '';
    if (unclosedName > 0) suffix += '</ml_tool_name>';
    if (unclosedParams > 0) suffix += '</ml_parameters>';
    if (unclosedCall > 0) suffix += '</ml_tool_call>';
    if (openCount > closeCount) suffix += '</ml_tool_calls>';

    result += suffix;
  }

  return result;
}

/**
 * Detect and remove duplicate content blocks.
 * Qwen sometimes outputs the same content twice in a single response.
 */
export function deduplicateContent(content: string): string {
  if (!content || content.length < 100) return content;

  // Check for exact duplicate halves
  const halfLen = Math.floor(content.length / 2);
  const firstHalf = content.slice(0, halfLen);
  const secondHalf = content.slice(halfLen).trim();

  // If the second half starts with the same content as the first half, it's a duplicate
  if (secondHalf.length > 50 && firstHalf.startsWith(secondHalf.slice(0, 50))) {
    return firstHalf.trim();
  }

  // Check for repeated paragraphs
  const paragraphs = content.split(/\n{2,}/);
  if (paragraphs.length >= 4) {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const p of paragraphs) {
      const key = p.trim().slice(0, 100);
      if (key.length > 20 && seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(p);
    }
    if (deduped.length < paragraphs.length) {
      return deduped.join('\n\n').trim();
    }
  }

  return content;
}

/**
 * Check if content is a leaked provider tool/internal message.
 */
export function isLeakedContent(content: string): boolean {
  if (!content) return false;
  return LEAK_PATTERNS.some(pattern => pattern.test(content));
}

/**
 * Remove leaked provider tool messages from content.
 */
export function stripLeakedContent(content: string): string {
  if (!content) return content;

  let cleaned = content;
  for (const pattern of LEAK_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

/**
 * Check if content contains incomplete tool call blocks.
 * Returns true if there's an opening tag without a matching close.
 */
export function hasIncompleteToolCalls(content: string): boolean {
  if (!content) return false;

  const openMl = (content.match(/<ml_tool_calls>/g) || []).length;
  const closeMl = (content.match(/<\/ml_tool_calls>/g) || []).length;
  if (openMl > closeMl) return true;

  const openLegacy = (content.match(/<tool_calls>/g) || []).length;
  const closeLegacy = (content.match(/<\/tool_calls>/g) || []).length;
  if (openLegacy > closeLegacy) return true;

  return false;
}

/**
 * Full sanitization pipeline for non-stream responses.
 * Applies all sanitizers in order.
 */
export function sanitizeFullResponse(content: string): string {
  if (!content) return content;

  let result = content;

  // 1. Strip reasoning from answer
  result = stripReasoningFromAnswer(result);

  // 2. Remove leaked content
  result = stripLeakedContent(result);

  // 3. Deduplicate
  result = deduplicateContent(result);

  // 4. Auto-close XML if present
  if (result.includes('<ml_tool_calls>') || result.includes('<tool_calls>')) {
    result = autoCloseXmlTags(result);
  }

  return result.trim();
}

/**
 * Sanitize a single streaming chunk.
 * Lighter than full sanitization — only does what's safe per-chunk.
 */
export function sanitizeStreamChunk(chunk: string): string {
  if (!chunk) return chunk;

  let result = chunk;

  // Strip leaked content patterns
  for (const pattern of LEAK_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Strip inline reasoning leaks
  result = stripReasoningFromAnswer(result);

  return result;
}

/**
 * Response quality metrics for diagnostics.
 */
export function analyzeResponseQuality(content: string): {
  hasReasoning: boolean;
  hasLeakedContent: boolean;
  hasIncompleteToolCalls: boolean;
  hasDuplicateContent: boolean;
  cleanLength: number;
  originalLength: number;
} {
  if (!content) {
    return {
      hasReasoning: false,
      hasLeakedContent: false,
      hasIncompleteToolCalls: false,
      hasDuplicateContent: false,
      cleanLength: 0,
      originalLength: 0,
    };
  }

  const hasReasoning = /<think>|<\/think>|<thinking>|<\/thinking>/i.test(content);
  const hasLeakedContent = LEAK_PATTERNS.some(p => p.test(content));
  const incomplete = hasIncompleteToolCalls(content);

  const deduped = deduplicateContent(content);
  const hasDuplicateContent = deduped.length < content.length - 50;

  const cleaned = sanitizeFullResponse(content);

  return {
    hasReasoning,
    hasLeakedContent,
    hasIncompleteToolCalls: incomplete,
    hasDuplicateContent,
    cleanLength: cleaned.length,
    originalLength: content.length,
  };
}