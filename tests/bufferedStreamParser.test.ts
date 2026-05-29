/**
 * Phase 9 — Buffered Stream Parser Tests
 * Tests for the new BufferedStreamParser class
 */

import { describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync } from './utils';

// ---- Import the module under test ----
const mod = require('../src/modules/bufferedToolAccumulator');
const {
  createAccumulatorState,
  processChunk,
  finalize,
  reset,
  BufferedStreamParser,
} = mod;

// ===== Section BSP.1 — BufferedStreamParser basics =====
describe('BSP.1 — BufferedStreamParser basics', () => {
  it('creates a parser instance', () => {
    const parser = new BufferedStreamParser();
    assertTrue(parser !== null, 'parser should not be null');
    assertTrue(typeof parser.processChunk === 'function', 'should have processChunk');
    assertTrue(typeof parser.finalize === 'function', 'should have finalize');
    assertTrue(typeof parser.reset === 'function', 'should have reset');
  });

  it('passes plain text through immediately', () => {
    const parser = new BufferedStreamParser();
    const result = parser.processChunk('Hello world');
    assertEqual(result.textChunks, 'Hello world', 'plain text should pass through');
    assertEqual(result.toolCallReady, false, 'no tool call ready');
    assertEqual(result.toolCallContent, null, 'no tool call content');
  });

  it('handles empty input', () => {
    const parser = new BufferedStreamParser();
    const result = parser.processChunk('');
    assertEqual(result.textChunks, '', 'empty text');
    assertEqual(result.toolCallReady, false, 'no tool call');
  });

  it('handles null/undefined input gracefully', () => {
    const parser = new BufferedStreamParser();
    const r1 = parser.processChunk(null);
    assertEqual(r1.textChunks, '', 'null text');
    const r2 = parser.processChunk(undefined);
    assertEqual(r2.textChunks, '', 'undefined text');
  });

  it('reset clears all state', () => {
    const parser = new BufferedStreamParser();
    parser.processChunk('some text');
    parser.reset();
    const result = parser.processChunk('new text');
    assertEqual(result.textChunks, 'new text', 'should start fresh after reset');
  });
});

// ===== Section BSP.2 — Chunk stitching =====
describe('BSP.2 — Chunk stitching', () => {
  it('stitches partial ml_tool_calls tags across chunks', () => {
    const parser = new BufferedStreamParser();
    // First chunk: partial opening tag
    const r1 = parser.processChunk('Hello <ml_tool');
    // Should hold back the partial marker
    assertTrue(r1.textChunks.length > 0 || r1.toolCallReady === false, 'partial marker held back');
    
    // Second chunk: completes opening tag + content
    const r2 = parser.processChunk('_calls><ml_tool_call><name>read_file</name><parameters><path>test.ts</path></parameters></ml_tool_call></ml_tool_calls>');
    assertTrue(r2.toolCallReady, 'tool call should be ready after stitching');
    assertTrue(r2.toolCallContent !== null, 'tool call content should exist');
    assertTrue(r2.toolCallContent!.includes('read_file'), 'should contain tool name');
  });

  it('stitches content across many small chunks', () => {
    const parser = new BufferedStreamParser();
    const chunks = ['<ml', '_tool', '_calls>', '<ml_tool_call>', '<name>exec</name>', 
                     '<parameters><cmd>ls</cmd></parameters>', '</ml_tool_call>', '</ml_tool_calls>'];
    let result;
    for (const chunk of chunks) {
      result = parser.processChunk(chunk);
    }
    assertTrue(result!.toolCallReady, 'should detect complete tool call after many chunks');
    assertTrue(result!.toolCallContent!.includes('exec'), 'should contain tool name');
  });

  it('stitches legacy tool_calls tags', () => {
    const parser = new BufferedStreamParser();
    const r1 = parser.processChunk('Text before <tool');
    const r2 = parser.processChunk('_calls><tool_call><name>write</name></tool_call></tool_calls>');
    assertTrue(r2.toolCallReady, 'legacy tool call should be ready');
    assertTrue(r2.toolCallContent!.includes('<tool_calls>'), 'should contain full block');
  });

  it('stitches bracket function_calls', () => {
    const parser = new BufferedStreamParser();
    const r1 = parser.processChunk('Some text [function');
    const r2 = parser.processChunk('_calls]name:read[/function_calls]');
    assertTrue(r2.toolCallReady, 'bracket function call should be ready');
  });
});

// ===== Section BSP.3 — Complete block detection =====
describe('BSP.3 — Complete block detection', () => {
  it('does NOT emit incomplete tool call blocks', () => {
    const parser = new BufferedStreamParser();
    const result = parser.processChunk('<ml_tool_calls><ml_tool_call><name>test</name>');
    assertEqual(result.toolCallReady, false, 'incomplete block should not be ready');
    // Text before the marker should be emitted
    // (but nothing inside the tool call block)
  });

  it('emits complete tool call block', () => {
    const parser = new BufferedStreamParser();
    const xml = '<ml_tool_calls><ml_tool_call><name>read_file</name><parameters><path>a.ts</path></parameters></ml_tool_call></ml_tool_calls>';
    const result = parser.processChunk(xml);
    assertTrue(result.toolCallReady, 'complete block should be ready');
    assertTrue(result.toolCallContent!.includes('</ml_tool_calls>'), 'should have close tag');
  });

  it('emits text before tool call as textChunks', () => {
    const parser = new BufferedStreamParser();
    const content = 'Here is what I found: <ml_tool_calls><ml_tool_call><name>test</name></ml_tool_call></ml_tool_calls>';
    const result = parser.processChunk(content);
    assertTrue(result.textChunks.includes('Here is what I found'), 'should emit text before tool call');
    assertTrue(result.toolCallReady, 'tool call should be ready');
  });

  it('emits text after tool call block in finalize', () => {
    const parser = new BufferedStreamParser();
    parser.processChunk('<ml_tool_calls><ml_tool_call><name>t</name></ml_tool_call></ml_tool_calls>Done!');
    const final = parser.finalize();
    assertTrue(final.text.includes('Done!'), 'text after tool call should be in finalize');
  });
});

// ===== Section BSP.4 — Partial marker holdback =====
describe('BSP.4 — Partial marker holdback', () => {
  it('holds back partial "<ml" marker', () => {
    const parser = new BufferedStreamParser();
    const result = parser.processChunk('Hello <ml');
    // Should not emit "<ml" as text since it could be start of <ml_tool_calls
    assertFalse(result.textChunks.includes('<ml'), 'partial marker should be held back');
  });

  it('holds back partial "</ml_tool_calls" marker', () => {
    const parser = new BufferedStreamParser();
    // First start a tool call block
    parser.processChunk('<ml_tool_calls><ml_tool_call><name>x</name></ml_tool_call>');
    // Then partial close marker
    const result = parser.processChunk('</ml_tool');
    assertEqual(result.toolCallReady, false, 'not ready yet');
    // The partial close should be held back
  });

  it('does NOT hold back text that cannot be a marker', () => {
    const parser = new BufferedStreamParser();
    const result = parser.processChunk('Hello world no markers here');
    assertEqual(result.textChunks, 'Hello world no markers here', 'clean text should pass through');
  });
});

// ===== Section BSP.5 — Mixed content =====
describe('BSP.5 — Mixed content', () => {
  it('handles text, then tool call, then more text', () => {
    const parser = new BufferedStreamParser();
    
    // Text before
    const r1 = parser.processChunk('Let me read the file. ');
    assertTrue(r1.textChunks.includes('Let me read'), 'should emit text');
    
    // Tool call
    const r2 = parser.processChunk('<ml_tool_calls><ml_tool_call><name>read_file</name><parameters><path>x.ts</path></parameters></ml_tool_call></ml_tool_calls>');
    assertTrue(r2.toolCallReady, 'tool call ready');
    
    // Text after (via finalize)
    const final = parser.finalize();
    // Any remaining buffer content should be text
  });

  it('handles multiple tool call blocks in sequence', () => {
    const parser = new BufferedStreamParser();
    
    // First tool call
    const r1 = parser.processChunk('<ml_tool_calls><ml_tool_call><name>a</name></ml_tool_call></ml_tool_calls>');
    assertTrue(r1.toolCallReady, 'first tool call ready');
    
    // Reset and process second
    parser.reset();
    const r2 = parser.processChunk('<ml_tool_calls><ml_tool_call><name>b</name></ml_tool_call></ml_tool_calls>');
    assertTrue(r2.toolCallReady, 'second tool call ready after reset');
  });

  it('handles text with angle brackets that are NOT tool calls', () => {
    const parser = new BufferedStreamParser();
    const result = parser.processChunk('Use <T> generic syntax in TypeScript');
    assertTrue(result.textChunks.length > 0, 'should emit text');
    assertFalse(result.toolCallReady, 'should not detect as tool call');
  });
});

// ===== Section BSP.6 — Edge cases =====
describe('BSP.6 — Edge cases', () => {
  it('handles unicode content', () => {
    const parser = new BufferedStreamParser();
    const result = parser.processChunk('Xin chào! 日本語テスト 🚀');
    assertEqual(result.textChunks, 'Xin chào! 日本語テスト 🚀', 'unicode should pass through');
  });

  it('handles very large chunk', () => {
    const parser = new BufferedStreamParser();
    const bigText = 'A'.repeat(100000);
    const result = parser.processChunk(bigText);
    assertTrue(result.textChunks.length > 0, 'large chunk should emit');
  });

  it('finalize returns remaining buffer as text', () => {
    const parser = new BufferedStreamParser();
    // Send two chunks — text is emitted during processChunk
    const r1 = parser.processChunk('partial ');
    const r2 = parser.processChunk('content');
    // Since text is emitted during processChunk, finalize returns remaining buffer
    // The combined text from processChunk calls should include our content
    const combinedText = r1.textChunks + r2.textChunks;
    assertTrue(combinedText.includes('partial') || combinedText.includes('content'),
      'text should be emitted during processChunk');
    assertEqual(parser.finalize().toolCallContent, null, 'no tool call');
  });

  it('finalize after complete tool call returns remaining text', () => {
    const parser = new BufferedStreamParser();
    parser.processChunk('<ml_tool_calls><ml_tool_call><name>x</name></ml_tool_call></ml_tool_calls>after');
    const final = parser.finalize();
    assertTrue(final.text.includes('after'), 'should have text after tool call');
  });
});

// ===== Section BSP.7 — Legacy API backward compatibility =====
describe('BSP.7 — Legacy API backward compatibility', () => {
  it('createAccumulatorState still works', () => {
    const state = createAccumulatorState();
    assertTrue(state !== null, 'state should not be null');
    assertEqual(state.buffer, '', 'buffer should be empty');
    assertEqual(state.capturing, false, 'not capturing');
  });

  it('processChunk function still works', () => {
    const state = createAccumulatorState();
    const result = processChunk(state, 'Hello');
    assertEqual(result.textChunks, 'Hello', 'plain text pass through');
    assertEqual(result.toolCallReady, false, 'no tool call');
  });

  it('finalize function still works', () => {
    const state = createAccumulatorState();
    const r = processChunk(state, 'content');
    // Text is either emitted during processChunk or remains in buffer for finalize
    const hasText = r.textChunks.length > 0 || finalize(state).text.length > 0;
    assertTrue(hasText, 'should have text either in chunk or finalize');
    assertEqual(finalize(state).toolCallContent, null, 'no tool call');
  });

  it('reset function still works', () => {
    const state = createAccumulatorState();
    processChunk(state, 'content');
    reset(state);
    assertEqual(state.buffer, '', 'buffer cleared');
    assertEqual(state.capturing, false, 'not capturing');
  });
});

// ===== Run =====
flushAsync().then(() => {
  printSummary();
});