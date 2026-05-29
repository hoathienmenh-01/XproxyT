import { describe, it, assertEqual, assertTrue, assertFalse, assertMatch, assertNotMatch, flushAsync, printSummary } from './utils';
import {
  stripReasoningFromAnswer,
  autoCloseXmlTags,
  deduplicateContent,
  stripLeakedContent,
  hasIncompleteToolCalls,
  sanitizeFullResponse,
  sanitizeStreamChunk,
  analyzeResponseQuality,
} from '../src/modules/responseSanitizer';

describe('Section S.1 — stripReasoningFromAnswer', () => {
  it('strips complete <think>...</think> blocks', () => {
    const input = '<think>\nLet me think about this.\n</think>\nHere is the answer.';
    const result = stripReasoningFromAnswer(input);
    assertEqual(result, 'Here is the answer.', 'should strip think block');
  });

  it('strips <thinking>...</thinking> blocks', () => {
    const input = '<thinking>Some reasoning</thinking>The real answer.';
    const result = stripReasoningFromAnswer(input);
    assertEqual(result, 'The real answer.', 'should strip thinking block');
  });

  it('strips partial unclosed <think> blocks', () => {
    const input = '<think>\nThis never closes...';
    const result = stripReasoningFromAnswer(input);
    assertEqual(result, '', 'should strip unclosed think');
  });

  it('preserves content without reasoning tags', () => {
    const input = 'This is a normal response without any thinking.';
    const result = stripReasoningFromAnswer(input);
    assertEqual(result, input, 'should preserve normal content');
  });

  it('handles multiple think blocks', () => {
    const input = '<think>first</think>Hello<think>second</think>World';
    const result = stripReasoningFromAnswer(input);
    assertEqual(result, 'HelloWorld', 'should strip multiple blocks leaving adjacent text');
  });

  it('handles empty input', () => {
    assertEqual(stripReasoningFromAnswer(''), '', 'empty input');
    assertEqual(stripReasoningFromAnswer(null as any), null, 'null input');
  });
});

describe('Section S.2 — autoCloseXmlTags', () => {
  it('closes unclosed ml_tool_calls', () => {
    const input = '<ml_tool_calls><ml_tool_call><ml_tool_name>read_file</ml_tool_name><ml_parameters><path>test.ts</path>';
    const result = autoCloseXmlTags(input);
    assertTrue(result.includes('</ml_parameters>'), 'should close ml_parameters');
    assertTrue(result.includes('</ml_tool_call>'), 'should close ml_tool_call');
    assertTrue(result.includes('</ml_tool_calls>'), 'should close ml_tool_calls');
  });

  it('leaves properly closed XML unchanged', () => {
    const input = '<ml_tool_calls><ml_tool_call><ml_tool_name>test</ml_tool_name><ml_parameters></ml_parameters></ml_tool_call></ml_tool_calls>';
    const result = autoCloseXmlTags(input);
    assertEqual(result, input, 'should not modify closed XML');
  });

  it('handles empty input', () => {
    assertEqual(autoCloseXmlTags(''), '', 'empty input');
  });
});

describe('Section S.3 — deduplicateContent', () => {
  it('detects and removes duplicate halves', () => {
    const half = 'This is a sentence that repeats. '.repeat(10);
    const input = half + half;
    const result = deduplicateContent(input);
    assertTrue(result.length < input.length, 'should be shorter than duplicate');
  });

  it('does not modify short content', () => {
    const input = 'Short text';
    const result = deduplicateContent(input);
    assertEqual(result, input, 'should not modify short text');
  });

  it('removes duplicate paragraphs', () => {
    const para = 'This paragraph is repeated multiple times in the content and is long enough to trigger dedup.';
    const input = [para, 'Different content here that is unique and long enough.', para, 'Another unique paragraph content that is also long enough.'].join('\n\n');
    const result = deduplicateContent(input);
    // The duplicate paragraph should appear only once
    const occurrences = result.split(para).length - 1;
    assertEqual(occurrences, 1, 'para should appear only once');
  });
});

describe('Section S.4 — stripLeakedContent', () => {
  it('strips "Tool does not exist" leak', () => {
    const input = 'Tool does not exist. Here is my answer.';
    const result = stripLeakedContent(input);
    assertNotMatch(result, /Tool does not exist/, 'should strip leak');
  });

  it('strips "tool resources exhausted" leak', () => {
    const input = 'tool resources exhausted';
    const result = stripLeakedContent(input);
    assertNotMatch(result, /tool resources exhausted/, 'should strip leak');
  });

  it('strips "The chat is in progress" leak', () => {
    const input = 'The chat is in progress';
    const result = stripLeakedContent(input);
    assertNotMatch(result, /chat is in progress/, 'should strip leak');
  });

  it('preserves clean content', () => {
    const input = 'This is a clean response.';
    const result = stripLeakedContent(input);
    assertEqual(result, input, 'should preserve clean content');
  });
});

describe('Section S.5 — hasIncompleteToolCalls', () => {
  it('detects unclosed ml_tool_calls', () => {
    assertTrue(hasIncompleteToolCalls('<ml_tool_calls><ml_tool_call>'), 'should detect incomplete');
  });

  it('returns false for complete ml_tool_calls', () => {
    assertFalse(hasIncompleteToolCalls('<ml_tool_calls></ml_tool_calls>'), 'should not flag complete');
  });

  it('returns false for no tool calls', () => {
    assertFalse(hasIncompleteToolCalls('Hello world'), 'should not flag plain text');
  });

  it('returns false for empty input', () => {
    assertFalse(hasIncompleteToolCalls(''), 'empty');
    assertFalse(hasIncompleteToolCalls(null as any), 'null');
  });
});

describe('Section S.6 — sanitizeFullResponse', () => {
  it('applies full pipeline', () => {
    const input = '<think>reasoning</think>Tool does not exist. Answer here.';
    const result = sanitizeFullResponse(input);
    assertNotMatch(result, /<think>/, 'should strip reasoning');
    assertNotMatch(result, /Tool does not exist/, 'should strip leak');
    assertTrue(result.includes('Answer here'), 'should preserve answer');
  });

  it('auto-closes XML in full response', () => {
    const input = '<ml_tool_calls><ml_tool_call><ml_tool_name>test</ml_tool_name>';
    const result = sanitizeFullResponse(input);
    assertTrue(result.includes('</ml_tool_calls>'), 'should close XML');
  });

  it('handles empty input', () => {
    assertEqual(sanitizeFullResponse(''), '', 'empty');
    assertEqual(sanitizeFullResponse(null as any), null, 'null');
  });
});

describe('Section S.7 — sanitizeStreamChunk', () => {
  it('strips leaked content from chunk', () => {
    const result = sanitizeStreamChunk('Tool does not exist');
    assertNotMatch(result, /Tool does not exist/, 'should strip leak from chunk');
  });

  it('strips reasoning from chunk', () => {
    const result = sanitizeStreamChunk('<think>hidden</think>visible');
    assertTrue(result.includes('visible'), 'should keep visible');
    assertNotMatch(result, /<think>/, 'should strip think');
  });

  it('preserves clean chunks', () => {
    const result = sanitizeStreamChunk('Hello world');
    assertEqual(result, 'Hello world', 'should preserve clean chunk');
  });
});

describe('Section S.8 — analyzeResponseQuality', () => {
  it('detects reasoning content', () => {
    const result = analyzeResponseQuality('<think>reasoning</think>answer');
    assertTrue(result.hasReasoning, 'should detect reasoning');
  });

  it('detects leaked content', () => {
    const result = analyzeResponseQuality('Tool does not exist');
    assertTrue(result.hasLeakedContent, 'should detect leak');
  });

  it('detects incomplete tool calls', () => {
    const result = analyzeResponseQuality('<ml_tool_calls>incomplete');
    assertTrue(result.hasIncompleteToolCalls, 'should detect incomplete');
  });

  it('returns metrics for clean content', () => {
    const result = analyzeResponseQuality('Clean answer');
    assertFalse(result.hasReasoning, 'no reasoning');
    assertFalse(result.hasLeakedContent, 'no leak');
    assertFalse(result.hasIncompleteToolCalls, 'no incomplete');
    assertTrue(result.cleanLength > 0, 'has clean length');
    assertTrue(result.originalLength > 0, 'has original length');
  });

  it('handles empty input', () => {
    const result = analyzeResponseQuality('');
    assertEqual(result.cleanLength, 0, 'zero clean length');
  });
});

describe('Section S.9 — stripReasoningFromAnswer edge cases', () => {
  it('handles content after unclosed think with space', () => {
    // Unclosed think consumed all remaining content
    const result = stripReasoningFromAnswer('<think>Hello');
    assertEqual(result, '', 'should strip unclosed');
  });

  it('handles multiple think blocks with answer between', () => {
    const input = '<think>first</think>Answer1<think>second</think>Answer2';
    const result = stripReasoningFromAnswer(input);
    assertTrue(result.includes('Answer1'), 'has answer1');
    assertTrue(result.includes('Answer2'), 'has answer2');
  });

  it('handles mixed case thinking tags', () => {
    const input = '<THINKING>reasoning</THINKING>answer';
    const result = stripReasoningFromAnswer(input);
    assertTrue(result.includes('answer'), 'preserves answer');
  });
});

describe('Section S.10 — sanitizeStreamChunk integration', () => {
  it('strips reasoning and leaks from chunk', () => {
    const result = sanitizeStreamChunk('<think>hidden</think>Tool does not exist. Answer.');
    assertNotMatch(result, /<think>/, 'no reasoning');
    assertNotMatch(result, /Tool does not exist/, 'no leak');
    assertTrue(result.includes('Answer'), 'has answer');
  });

  it('handles null input gracefully', () => {
    const result = sanitizeStreamChunk(null as any);
    assertEqual(result, null, 'null passthrough');
  });
});

flushAsync().then(() => printSummary());
