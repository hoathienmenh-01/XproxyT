import { describe, it, assertEqual, assertTrue, assertFalse, assertMatch, flushAsync, printSummary } from './utils';
import { validateToolCall, validateToolCalls, detectToolCallFormat, isCompleteToolCall } from '../src/modules/toolCallValidator';

describe('Section T.1 — validateToolCall', () => {
  it('validates a correct tool call', () => {
    const result = validateToolCall({ name: 'read_file', arguments: '{"path":"test.ts"}' });
    assertTrue(result.valid, 'should be valid');
    assertEqual(result.name, 'read_file', 'name');
    assertFalse(result.repaired, 'not repaired');
  });

  it('repairs empty arguments', () => {
    const result = validateToolCall({ name: 'read_file', arguments: '' });
    assertTrue(result.valid, 'should be valid after repair');
    assertTrue(result.repaired, 'should be repaired');
    assertEqual(result.arguments, '{}', 'empty args become {}');
  });

  it('repairs markdown-fenced JSON', () => {
    const result = validateToolCall({ name: 'test', arguments: '```json\n{"path":"test.ts"}\n```' });
    assertTrue(result.valid, 'should be valid');
    assertTrue(result.repaired, 'should be repaired');
  });

  it('repairs trailing commas in JSON', () => {
    const result = validateToolCall({ name: 'test', arguments: '{"path":"test.ts",}' });
    assertTrue(result.valid, 'should be valid');
    assertTrue(result.repaired, 'should be repaired');
  });

  it('strips tool. prefix from name', () => {
    const result = validateToolCall({ name: 'tool.read_file', arguments: '{}' });
    assertEqual(result.name, 'read_file', 'should strip prefix');
    assertTrue(result.repaired, 'should be repaired');
  });

  it('handles empty name', () => {
    const result = validateToolCall({ name: '', arguments: '{}' });
    assertFalse(result.valid, 'should be invalid');
    assertTrue(result.errors.length > 0, 'should have errors');
  });

  it('generates id when missing', () => {
    const result = validateToolCall({ name: 'test', arguments: '{}' });
    assertTrue(result.id.startsWith('call_'), 'should have call id');
  });

  it('fuzzy matches tool names case-insensitively', () => {
    const tools = [{ name: 'read_file' }];
    const result = validateToolCall({ name: 'Read_File', arguments: '{}' }, tools);
    assertEqual(result.name, 'read_file', 'should match');
    assertTrue(result.repaired, 'should be repaired');
  });

  it('reports unknown tool', () => {
    const tools = [{ name: 'read_file' }];
    const result = validateToolCall({ name: 'write_file', arguments: '{}' }, tools);
    assertTrue(result.errors.some(e => e.includes('Unknown tool')), 'should report unknown');
  });
});

describe('Section T.2 — validateToolCalls', () => {
  it('validates multiple calls', () => {
    const result = validateToolCalls([
      { name: 'read_file', arguments: '{"path":"a.ts"}' },
      { name: 'write_file', arguments: '{"path":"b.ts"}' },
    ]);
    assertEqual(result.toolCalls.length, 2, 'should have 2');
    assertTrue(result.valid, 'should be valid');
  });

  it('rejects calls with empty names', () => {
    const result = validateToolCalls([{ name: '', arguments: '{}' }]);
    assertTrue(result.rejected.length > 0, 'should reject');
    assertEqual(result.toolCalls.length, 0, 'no valid calls');
  });

  it('repairs multiple calls', () => {
    const result = validateToolCalls([
      { name: 'test', arguments: '' },
      { name: 'test', arguments: '```json\n{"x":1}\n```' },
    ]);
    assertTrue(result.repaired >= 2, 'should repair both');
  });

  it('handles empty input', () => {
    const result = validateToolCalls([]);
    assertEqual(result.toolCalls.length, 0, 'empty');
    assertTrue(result.valid, 'valid by default');
  });
});

describe('Section T.3 — detectToolCallFormat', () => {
  it('detects ml_tool_calls', () => {
    assertEqual(detectToolCallFormat('<ml_tool_calls>test</ml_tool_calls>'), 'xml_ml', 'ml');
  });

  it('detects tool_calls', () => {
    assertEqual(detectToolCallFormat('<tool_calls>test</tool_calls>'), 'xml_legacy', 'legacy');
  });

  it('detects function_calls bracket', () => {
    assertEqual(detectToolCallFormat('[function_calls]test[/function_calls]'), 'bracket', 'bracket');
  });

  it('returns none for plain text', () => {
    assertEqual(detectToolCallFormat('Hello world'), 'none', 'none');
  });

  it('handles empty input', () => {
    assertEqual(detectToolCallFormat(''), 'none', 'empty');
  });
});

describe('Section T.4 — isCompleteToolCall', () => {
  it('detects complete ml_tool_calls', () => {
    assertTrue(isCompleteToolCall('<ml_tool_calls><ml_tool_call><ml_tool_name>test</ml_tool_name></ml_tool_call></ml_tool_calls>'), 'complete');
  });

  it('rejects incomplete ml_tool_calls', () => {
    assertFalse(isCompleteToolCall('<ml_tool_calls><ml_tool_call>'), 'incomplete');
  });

  it('detects complete tool_calls', () => {
    assertTrue(isCompleteToolCall('<tool_calls>data</tool_calls>'), 'legacy complete');
  });

  it('returns false for no tool call', () => {
    assertFalse(isCompleteToolCall('Hello'), 'no tool call');
  });

  it('returns false for empty', () => {
    assertFalse(isCompleteToolCall(''), 'empty');
    assertFalse(isCompleteToolCall(null as any), 'null');
  });
});

flushAsync().then(() => printSummary());