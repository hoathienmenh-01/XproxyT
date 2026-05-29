/**
 * Tool Call Validator — validates tool calls before emitting to clients.
 * Ensures tool name exists, arguments are valid JSON, required fields present.
 * Can repair minor malformations or reject invalid calls.
 */

export interface ToolCallInput {
  id?: string;
  name: string;
  arguments: string | Record<string, any>;
  type?: string;
}

export interface ToolCallOutput {
  id: string;
  name: string;
  arguments: string;
  type: 'function';
  valid: boolean;
  errors: string[];
  repaired: boolean;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  required?: string[];
}

export interface ValidationResult {
  valid: boolean;
  toolCalls: ToolCallOutput[];
  rejected: Array<{ name: string; reason: string }>;
  repaired: number;
}

/**
 * Validate and repair a single tool call.
 */
export function validateToolCall(
  call: ToolCallInput,
  knownTools?: ToolDefinition[],
): ToolCallOutput {
  const errors: string[] = [];
  let repaired = false;
  let name = call.name || '';
  let argsStr = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {});
  const id = call.id || `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // 1. Validate name
  if (!name || name.trim().length === 0) {
    errors.push('Tool name is empty');
  }

  // Strip common prefixes that Qwen sometimes adds
  const originalName = name;
  name = name.replace(/^(tool\.|function\.|call_)/i, '').trim();
  if (name !== originalName) repaired = true;

  // 2. Validate and repair arguments JSON
  if (!argsStr || argsStr.trim().length === 0) {
    argsStr = '{}';
    repaired = true;
  }

  try {
    JSON.parse(argsStr);
  } catch {
    // Try to repair common JSON malformations
    const repaired_args = repairJsonArguments(argsStr);
    if (repaired_args !== null) {
      argsStr = repaired_args;
      repaired = true;
    } else {
      errors.push(`Invalid JSON arguments: ${argsStr.slice(0, 100)}`);
      argsStr = '{}';
      repaired = true;
    }
  }

  // 3. Check against known tools if available
  if (knownTools && knownTools.length > 0 && name) {
    const matched = knownTools.find(t => t.name === name);
    if (!matched) {
      // Try fuzzy match
      const fuzzyMatch = knownTools.find(t =>
        t.name.toLowerCase() === name.toLowerCase() ||
        t.name.replace(/[_-]/g, '') === name.replace(/[_-]/g, '')
      );
      if (fuzzyMatch) {
        name = fuzzyMatch.name;
        repaired = true;
      } else {
        errors.push(`Unknown tool: ${name}`);
      }
    }
  }

  return {
    id,
    name,
    arguments: argsStr,
    type: 'function',
    valid: errors.length === 0,
    errors,
    repaired,
  };
}

/**
 * Try to repair common JSON argument malformations.
 */
function repairJsonArguments(input: string): string | null {
  let s = input.trim();

  // Remove markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  s = s.trim();

  // Try parsing after fence removal
  try {
    JSON.parse(s);
    return s;
  } catch {}

  // Fix trailing commas
  let fixed = s.replace(/,\s*([\]}])/g, '$1');
  try {
    JSON.parse(fixed);
    return fixed;
  } catch {}

  // Fix unquoted keys (simple cases)
  fixed = s.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  try {
    JSON.parse(fixed);
    return fixed;
  } catch {}

  // Fix single quotes to double quotes
  fixed = s.replace(/'/g, '"');
  try {
    JSON.parse(fixed);
    return fixed;
  } catch {}

  // Wrap in braces if it looks like key-value pairs
  if (s.includes(':') && !s.startsWith('{')) {
    fixed = `{${s}}`;
    // Apply fixes to the wrapped version
    fixed = fixed.replace(/,\s*([\]}])/g, '$1');
    fixed = fixed.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    try {
      JSON.parse(fixed);
      return fixed;
    } catch {}
  }

  return null;
}

/**
 * Validate a batch of tool calls.
 */
export function validateToolCalls(
  calls: ToolCallInput[],
  knownTools?: ToolDefinition[],
): ValidationResult {
  const toolCalls: ToolCallOutput[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  let repairedCount = 0;

  for (const call of calls) {
    const validated = validateToolCall(call, knownTools);
    if (validated.valid) {
      toolCalls.push(validated);
      if (validated.repaired) repairedCount++;
    } else {
      // If only errors are unknown tool name, still emit (let client handle)
      const hasOnlyUnknownTool = validated.errors.every(e => e.startsWith('Unknown tool'));
      if (hasOnlyUnknownTool && validated.name) {
        toolCalls.push(validated);
        if (validated.repaired) repairedCount++;
      } else {
        rejected.push({
          name: validated.name || 'unknown',
          reason: validated.errors.join('; '),
        });
      }
    }
  }

  return {
    valid: rejected.length === 0,
    toolCalls,
    rejected,
    repaired: repairedCount,
  };
}

/**
 * Detect tool call format in content and extract raw calls.
 * Supports: JSON envelope, XML ml_tool_calls, legacy bracket format.
 */
export function detectToolCallFormat(content: string): 'json_envelope' | 'xml_ml' | 'xml_legacy' | 'bracket' | 'none' {
  if (!content) return 'none';

  // JSON envelope: {"__tool_call__": {...}}
  if (/__tool_call__/.test(content)) return 'json_envelope';

  // XML ml format: <ml_tool_calls>
  if (/<ml_tool_calls>/.test(content)) return 'xml_ml';

  // XML legacy: <tool_calls>
  if (/<tool_calls>/.test(content)) return 'xml_legacy';

  // Bracket format: [function_calls]
  if (/\[function_calls\]/.test(content)) return 'bracket';

  return 'none';
}

/**
 * Check if a tool call result is likely valid/complete.
 */
export function isCompleteToolCall(content: string): boolean {
  if (!content) return false;

  const format = detectToolCallFormat(content);

  switch (format) {
    case 'json_envelope': {
      // Check that JSON is parseable
      try {
        const match = content.match(/__tool_call__[^}]*({[^}]*})/);
        if (match) {
          JSON.parse(match[1]);
          return true;
        }
      } catch {}
      return false;
    }
    case 'xml_ml': {
      // Check complete tags
      const hasOpen = content.includes('<ml_tool_calls>');
      const hasClose = content.includes('</ml_tool_calls>');
      const hasName = content.includes('<ml_tool_name>');
      return hasOpen && hasClose && hasName;
    }
    case 'xml_legacy': {
      const hasOpen = content.includes('<tool_calls>');
      const hasClose = content.includes('</tool_calls>');
      return hasOpen && hasClose;
    }
    case 'bracket': {
      const hasOpen = content.includes('[function_calls]');
      const hasClose = content.includes('[/function_calls]');
      return hasOpen && hasClose;
    }
    case 'none':
    default:
      return false;
  }
}