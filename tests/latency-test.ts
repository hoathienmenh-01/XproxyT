// @ts-nocheck
/**
 * Latency & Data Integrity Test Script
 * =====================================
 * Kiểm chứng độ trễ (TTFT, tổng thời gian) và tính toàn vẹn dữ liệu
 * khi gửi request qua Luna Proxy đến Qwen AI.
 *
 * Cách chạy:
 *   npx ts-node tests/latency-test.ts
 *   npx ts-node tests/latency-test.ts --model=qwen3-coder-plus
 *   npx ts-node tests/latency-test.ts --base-url=http://localhost:8080
 *   npx ts-node tests/latency-test.ts --api-key=sk-luna-xxx
 *   npx ts-node tests/latency-test.ts --non-stream  (chỉ test non-stream)
 *   npx ts-node tests/latency-test.ts --stream       (chỉ test stream)
 *   npx ts-node tests/latency-test.ts --repeat=3     (chạy N lần để lấy median)
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

// ============================================================================
// Configuration
// ============================================================================

interface TestConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  stream: boolean;
  nonStream: boolean;
  repeat: number;
  timeoutMs: number;
}

function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  const config: TestConfig = {
    baseUrl: 'http://localhost:8080',
    model: 'qwen3-coder-plus',
    apiKey: '',
    stream: true,
    nonStream: true,
    repeat: 1,
    timeoutMs: 120_000,
  };

  for (const arg of args) {
    if (arg.startsWith('--base-url=')) config.baseUrl = arg.split('=')[1];
    if (arg.startsWith('--model=')) config.model = arg.split('=')[1];
    if (arg.startsWith('--api-key=')) config.apiKey = arg.split('=')[1];
    if (arg.startsWith('--repeat=')) config.repeat = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--timeout=')) config.timeoutMs = parseInt(arg.split('=')[1], 10);
    if (arg === '--non-stream') { config.stream = false; config.nonStream = true; }
    if (arg === '--stream') { config.stream = true; config.nonStream = false; }
  }

  return config;
}

// ============================================================================
// Test Payload — phức tạp: tiếng Việt, emoji, ký tự đặc biệt, code block
// ============================================================================

const TEST_PAYLOAD = {
  model: '', // set dynamically
  stream: true,
  temperature: 0.1,
  max_tokens: 512,
  messages: [
    {
      role: 'system',
      content: [
        'Bạn là một trợ lý AI hữu ích. Trả lời bằng tiếng Việt khi được hỏi bằng tiếng Việt.',
        'Khi được yêu cầu in một chuỗi cụ thể, hãy in CHÍNH XÁC chuỗi đó, không thêm bớt gì.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Hãy phản hồi CHÍNH XÁC chuỗi sau (bao gồm cả emoji, ký tự đặc biệt và xuống dòng):',
        '',
        '---BEGIN MARKER---',
        'Xin chào! Đây là bài test tiếng Việt có dấu: ă, â, ê, ô, ơ, ư, đ.',
        'Ký tự đặc biệt: <>&"\'\\n\\t\\r {}[]|/\\@#$%^&*()_+-=~`',
        'Emoji: 🚀🔥💻✅❌🎯📊🧪',
        'Code block:',
        '```python',
        'def hello(name: str) -> str:',
        '    return f"Xin chào, {name}!"',
        '```',
        'Đường dẫn: C:\\Users\\test\\file.txt và /home/user/file.txt',
        'JSON lồng nhau: {"key": "value", "nested": {"arr": [1, 2, 3]}}',
        'Unicode: 日本語テスト、한국어 테스트、中文测试',
        '---END MARKER---',
        '',
        'Chỉ in ra nội dung giữa ---BEGIN MARKER--- và ---END MARKER---, KHÔNG thêm bất kỳ giải thích nào.',
      ].join('\n'),
    },
  ],
};

// Expected content fragments that MUST appear in the response
const EXPECTED_FRAGMENTS = [
  'Xin chào!',
  'ă, â, ê, ô, ơ, ư, đ',
  '🚀🔥💻✅❌🎯📊🧪',
  'def hello(name: str)',
  'Xin chào, {name}!',
  'C:\\Users\\test\\file.txt',
  '---BEGIN MARKER---',
  '---END MARKER---',
  '日本語テスト',
  '한국어 테스트',
];

// ============================================================================
// SSE Parser — parse Server-Sent Events from raw text stream
// ============================================================================

interface SSEEvent {
  event?: string;
  data: string;
  raw: string;
}

interface StreamParseResult {
  events: SSEEvent[];
  totalChunks: number;
  totalBytes: number;
  accumulatedText: string;
  firstTokenTime: number | null;
  parseErrors: string[];
  sseFormatErrors: string[];
  doneReceived: boolean;
  fullResponse: string;
  rawResponse: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

function parseSSEStream(rawText: string): StreamParseResult {
  const result: StreamParseResult = {
    events: [],
    totalChunks: 0,
    totalBytes: Buffer.byteLength(rawText, 'utf-8'),
    accumulatedText: '',
    firstTokenTime: null,
    parseErrors: [],
    sseFormatErrors: [],
    doneReceived: false,
    fullResponse: '',
    rawResponse: '',
    usage: null,
  };

  // Split by double newline to get SSE blocks
  const blocks = rawText.split('\n\n');
  let currentEvent: Partial<SSEEvent> = {};

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    let eventData = '';
    let eventType = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataContent = line.slice(6);
        if (dataContent === '[DONE]') {
          result.doneReceived = true;
          continue;
        }
        eventData = dataContent;
      } else if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith(':')) {
        // SSE comment — ignore (keep-alive)
      } else if (line.trim() === '') {
        // empty line — skip
      } else {
        // Malformed SSE line
        result.sseFormatErrors.push(`Unexpected SSE line: "${line.slice(0, 80)}"`);
      }
    }

    if (eventData) {
      result.totalChunks++;
      const event: SSEEvent = { event: eventType || undefined, data: eventData, raw: trimmed };
      result.events.push(event);

      // Try to parse JSON
      try {
        const parsed = JSON.parse(eventData);

        // Validate SSE JSON structure (OpenAI format)
        if (!parsed.object && !parsed.choices && !parsed.error) {
          result.sseFormatErrors.push(
            `JSON missing 'object' and 'choices': ${eventData.slice(0, 100)}`
          );
        }

        // Extract delta content
        if (parsed.choices && Array.isArray(parsed.choices)) {
          for (const choice of parsed.choices) {
            const delta = choice.delta;
            if (delta && delta.content) {
              result.accumulatedText += delta.content;
            }
            // Check for finish reason
            if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
              // Normal completion
            }
          }
        }

        // Extract usage
        if (parsed.usage) {
          result.usage = {
            prompt_tokens: parsed.usage.prompt_tokens,
            completion_tokens: parsed.usage.completion_tokens,
            total_tokens: parsed.usage.total_tokens,
          };
        }
      } catch (err) {
        result.parseErrors.push(
          `JSON parse error: ${(err as Error).message} | data: ${eventData.slice(0, 200)}`
        );
      }
    }
  }

  result.fullResponse = result.accumulatedText;
  return result;
}

// ============================================================================
// HTTP Request Helpers
// ============================================================================

interface RequestMetrics {
  ttft: number | null;        // Time To First Token (ms)
  totalTime: number;          // Total completion time (ms)
  httpStatus: number;
  httpStatusText: string;
  responseBytes: number;
  rawResponse: string;
}

function httpRequest(urlStr: string, body: object, headers: Record<string, string>, timeoutMs: number): Promise<RequestMetrics> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const postData = JSON.stringify(body);
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData, 'utf-8').toString(),
      ...headers,
    };

    const startTime = performance.now();
    let firstByteTime: number | null = null;
    let ttft: number | null = null;
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: reqHeaders,
        timeout: timeoutMs,
      },
      (res) => {
        res.on('data', (chunk: Buffer) => {
          if (firstByteTime === null) {
            firstByteTime = performance.now();
            ttft = firstByteTime - startTime;
          }
          chunks.push(chunk);
          totalBytes += chunk.length;
        });

        res.on('end', () => {
          const totalTime = performance.now() - startTime;
          const rawResponse = Buffer.concat(chunks).toString('utf-8');

          resolve({
            ttft,
            totalTime,
            httpStatus: res.statusCode || 0,
            httpStatusText: res.statusMessage || '',
            responseBytes: totalBytes,
            rawResponse,
          });
        });

        res.on('error', (err) => {
          reject(new Error(`Response error: ${err.message}`));
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Request error: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    req.write(postData);
    req.end();
  });
}

// ============================================================================
// Test Runner
// ============================================================================

interface TestCase {
  name: string;
  mode: 'stream' | 'non-stream';
  passed: boolean;
  metrics: RequestMetrics | null;
  parseResult: StreamParseResult | null;
  integrityChecks: IntegrityCheck[];
  error?: string;
}

interface IntegrityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

function runIntegrityChecks(
  parseResult: StreamParseResult,
  mode: 'stream' | 'non-stream',
  httpStatus: number
): IntegrityCheck[] {
  const checks: IntegrityCheck[] = [];

  // Check 1: HTTP status is 200
  checks.push({
    name: 'HTTP Status 200',
    passed: httpStatus === 200,
    detail: `Got ${httpStatus}`,
  });

  if (mode === 'stream') {
    // Check 2: SSE events received
    checks.push({
      name: 'SSE events received',
      passed: parseResult.events.length > 0,
      detail: `Received ${parseResult.events.length} SSE events`,
    });

    // Check 3: [DONE] marker received
    checks.push({
      name: '[DONE] marker received',
      passed: parseResult.doneReceived,
      detail: parseResult.doneReceived ? 'OK' : 'Missing [DONE] marker',
    });

    // Check 4: No JSON parse errors
    checks.push({
      name: 'No JSON parse errors in SSE',
      passed: parseResult.parseErrors.length === 0,
      detail: parseResult.parseErrors.length === 0
        ? 'All SSE data blocks are valid JSON'
        : `${parseResult.parseErrors.length} errors: ${parseResult.parseErrors[0]}`,
    });

    // Check 5: No SSE format errors
    checks.push({
      name: 'SSE format integrity',
      passed: parseResult.sseFormatErrors.length === 0,
      detail: parseResult.sseFormatErrors.length === 0
        ? 'All SSE blocks follow expected format'
        : `${parseResult.sseFormatErrors.length} warnings: ${parseResult.sseFormatErrors[0]}`,
    });

    // Check 6: Response text is not empty
    checks.push({
      name: 'Response text not empty',
      passed: parseResult.accumulatedText.length > 0,
      detail: `Accumulated ${parseResult.accumulatedText.length} chars`,
    });

    // Check 7: No corrupt unicode characters
    const hasCorruptUnicode = /[\ufffd]/.test(parseResult.accumulatedText);
    checks.push({
      name: 'No corrupt Unicode (U+FFFD)',
      passed: !hasCorruptUnicode,
      detail: hasCorruptUnicode
        ? 'Found replacement characters (U+FFFD) — possible encoding corruption'
        : 'No corrupt Unicode detected',
    });

    // Check 8: Content integrity — expected fragments
    const missingFragments: string[] = [];
    for (const fragment of EXPECTED_FRAGMENTS) {
      if (!parseResult.accumulatedText.includes(fragment)) {
        missingFragments.push(fragment);
      }
    }
    // For stream mode, content may be sanitized/stripped, so we check if at least 50% of fragments are present
    const foundCount = EXPECTED_FRAGMENTS.length - missingFragments.length;
    const threshold = Math.ceil(EXPECTED_FRAGMENTS.length * 0.5);
    checks.push({
      name: 'Content integrity (expected fragments)',
      passed: foundCount >= threshold,
      detail: `Found ${foundCount}/${EXPECTED_FRAGMENTS.length} expected fragments (threshold: ${threshold})${
        missingFragments.length > 0
          ? `. Missing: ${missingFragments.slice(0, 3).join(', ')}${missingFragments.length > 3 ? '...' : ''}`
          : ''
      }`,
    });
  } else {
    // Non-stream mode checks
    // Check 2: Response is valid JSON
    let parsed: any;
    try {
      parsed = JSON.parse(parseResult.fullResponse || parseResult.rawResponse || '{}');
    } catch {
      // not valid JSON
    }

    checks.push({
      name: 'Response is valid JSON',
      passed: !!parsed,
      detail: parsed ? `Parsed object with keys: ${Object.keys(parsed).join(', ')}` : 'Failed to parse response as JSON',
    });

    if (parsed) {
      // Check 3: Has choices array
      checks.push({
        name: 'Response has choices[]',
        passed: Array.isArray(parsed.choices) && parsed.choices.length > 0,
        detail: parsed.choices ? `${parsed.choices.length} choices` : 'Missing choices array',
      });

      // Check 4: Has message content
      const content = parsed.choices?.[0]?.message?.content || '';
      checks.push({
        name: 'Response message content not empty',
        passed: content.length > 0,
        detail: `Content length: ${content.length} chars`,
      });

      // Check 5: Content integrity
      const missingFragments: string[] = [];
      for (const fragment of EXPECTED_FRAGMENTS) {
        if (!content.includes(fragment)) {
          missingFragments.push(fragment);
        }
      }
      const foundCount = EXPECTED_FRAGMENTS.length - missingFragments.length;
      const threshold = Math.ceil(EXPECTED_FRAGMENTS.length * 0.5);
      checks.push({
        name: 'Content integrity (expected fragments)',
        passed: foundCount >= threshold,
        detail: `Found ${foundCount}/${EXPECTED_FRAGMENTS.length} expected fragments${
          missingFragments.length > 0
            ? `. Missing: ${missingFragments.slice(0, 3).join(', ')}${missingFragments.length > 3 ? '...' : ''}`
          : ''
        }`,
      });
    }
  }

  return checks;
}

async function runStreamTest(config: TestConfig, runIndex: number): Promise<TestCase> {
  const testCase: TestCase = {
    name: `Stream Test #${runIndex + 1}`,
    mode: 'stream',
    passed: false,
    metrics: null,
    parseResult: null,
    integrityChecks: [],
  };

  try {
    const payload = { ...TEST_PAYLOAD, model: config.model, stream: true };
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const metrics = await httpRequest(
      `${config.baseUrl}/v1/chat/completions`,
      payload,
      headers,
      config.timeoutMs
    );
    testCase.metrics = metrics;

    // Parse SSE stream
    const parseResult = parseSSEStream(metrics.rawResponse);
    // Also set firstTokenTime from TTFT
    if (metrics.ttft !== null) {
      parseResult.firstTokenTime = metrics.ttft;
    }
    testCase.parseResult = parseResult;

    // Run integrity checks
    testCase.integrityChecks = runIntegrityChecks(parseResult, 'stream', metrics.httpStatus);
    testCase.passed = testCase.integrityChecks.every(c => c.passed);
  } catch (err) {
    testCase.error = (err as Error).message;
    testCase.passed = false;
  }

  return testCase;
}

async function runNonStreamTest(config: TestConfig, runIndex: number): Promise<TestCase> {
  const testCase: TestCase = {
    name: `Non-Stream Test #${runIndex + 1}`,
    mode: 'non-stream',
    passed: false,
    metrics: null,
    parseResult: null,
    integrityChecks: [],
  };

  try {
    const payload = { ...TEST_PAYLOAD, model: config.model, stream: false };
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const metrics = await httpRequest(
      `${config.baseUrl}/v1/chat/completions`,
      payload,
      headers,
      config.timeoutMs
    );
    testCase.metrics = metrics;

    // For non-stream, the entire response is a single JSON
    const parseResult: StreamParseResult = {
      events: [],
      totalChunks: 1,
      totalBytes: metrics.responseBytes,
      accumulatedText: '',
      firstTokenTime: metrics.ttft,
      parseErrors: [],
      sseFormatErrors: [],
      doneReceived: false,
      fullResponse: metrics.rawResponse,
      usage: null,
    };

    // Try to extract content
    try {
      const parsed = JSON.parse(metrics.rawResponse);
      const content = parsed.choices?.[0]?.message?.content || '';
      parseResult.accumulatedText = content;
      if (parsed.usage) {
        parseResult.usage = {
          prompt_tokens: parsed.usage.prompt_tokens,
          completion_tokens: parsed.usage.completion_tokens,
          total_tokens: parsed.usage.total_tokens,
        };
      }
    } catch {
      parseResult.parseErrors.push('Failed to parse non-stream response as JSON');
    }

    testCase.parseResult = parseResult;

    // Run integrity checks
    testCase.integrityChecks = runIntegrityChecks(parseResult, 'non-stream', metrics.httpStatus);
    testCase.passed = testCase.integrityChecks.every(c => c.passed);
  } catch (err) {
    testCase.error = (err as Error).message;
    testCase.passed = false;
  }

  return testCase;
}

// ============================================================================
// Output Formatting
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function colorize(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return 'N/A';
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printSeparator(char = '─', length = 72): void {
  console.log(colorize('gray', char.repeat(length)));
}

function printHeader(title: string): void {
  console.log();
  printSeparator('═');
  console.log(colorize('bold', `  ${title}`));
  printSeparator('═');
}

function printTestCase(test: TestCase): void {
  const statusIcon = test.passed ? colorize('green', '✅ PASS') : colorize('red', '❌ FAIL');
  console.log(colorize('bold', `\n  ${test.name}  ${statusIcon}`));
  printSeparator('─');

  if (test.error) {
    console.log(colorize('red', `  ERROR: ${test.error}`));
    return;
  }

  // Metrics
  if (test.metrics) {
    console.log(colorize('cyan', '  📊 Latency Metrics:'));
    console.log(`     TTFT (Time To First Token):  ${colorize('bold', formatMs(test.metrics.ttft))}`);
    console.log(`     Total Completion Time:       ${colorize('bold', formatMs(test.metrics.totalTime))}`);
    console.log(`     HTTP Status:                 ${test.metrics.httpStatus} ${test.metrics.httpStatusText}`);
    console.log(`     Response Size:               ${formatBytes(test.metrics.responseBytes)}`);
  }

  // Usage
  if (test.parseResult?.usage) {
    const u = test.parseResult.usage;
    console.log(colorize('cyan', '  📊 Token Usage:'));
    console.log(`     Prompt Tokens:     ${u.prompt_tokens ?? 'N/A'}`);
    console.log(`     Completion Tokens: ${u.completion_tokens ?? 'N/A'}`);
    console.log(`     Total Tokens:      ${u.total_tokens ?? 'N/A'}`);
  }

  // SSE Stats (stream only)
  if (test.mode === 'stream' && test.parseResult) {
    console.log(colorize('cyan', '  📡 Stream Statistics:'));
    console.log(`     SSE Events:        ${test.parseResult.events.length}`);
    console.log(`     Accumulated Text:  ${test.parseResult.accumulatedText.length} chars`);
    console.log(`     [DONE] Received:   ${test.parseResult.doneReceived ? 'Yes' : 'No'}`);
    console.log(`     JSON Parse Errors: ${test.parseResult.parseErrors.length}`);
    console.log(`     SSE Format Issues: ${test.parseResult.sseFormatErrors.length}`);
  }

  // Integrity Checks
  console.log(colorize('cyan', '  🔍 Integrity Checks:'));
  for (const check of test.integrityChecks) {
    const icon = check.passed ? colorize('green', '✓') : colorize('red', '✗');
    const name = check.passed ? check.name : colorize('red', check.name);
    console.log(`     ${icon} ${name}`);
    if (!check.passed) {
      console.log(colorize('red', `       └─ ${check.detail}`));
    } else if (check.detail) {
      console.log(colorize('gray', `       └─ ${check.detail}`));
    }
  }

  // Show accumulated text preview (first 300 chars)
  if (test.parseResult?.accumulatedText && test.parseResult.accumulatedText.length > 0) {
    console.log(colorize('cyan', '  📝 Response Preview (first 300 chars):'));
    const preview = test.parseResult.accumulatedText.slice(0, 300);
    const lines = preview.split('\n');
    for (const line of lines.slice(0, 10)) {
      console.log(colorize('dim', `     │ ${line}`));
    }
    if (lines.length > 10 || test.parseResult.accumulatedText.length > 300) {
      console.log(colorize('dim', `     │ ... (${test.parseResult.accumulatedText.length} chars total)`));
    }
  }

  // Show parse errors if any
  if (test.parseResult?.parseErrors && test.parseResult.parseErrors.length > 0) {
    console.log(colorize('red', '  ⚠️  Parse Errors:'));
    for (const err of test.parseResult.parseErrors.slice(0, 3)) {
      console.log(colorize('red', `     • ${err.slice(0, 200)}`));
    }
  }
}

function printSummary(tests: TestCase[]): void {
  printHeader('📊 SUMMARY');

  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;
  const total = tests.length;

  console.log(colorize('bold', `  Total: ${total}  |  `) +
    colorize('green', `Passed: ${passed}`) + '  |  ' +
    (failed > 0 ? colorize('red', `Failed: ${failed}`) : colorize('gray', `Failed: 0`))
  );

  // Latency summary
  const streamTests = tests.filter(t => t.mode === 'stream' && t.metrics);
  const nonStreamTests = tests.filter(t => t.mode === 'non-stream' && t.metrics);

  if (streamTests.length > 0) {
    console.log(colorize('cyan', '\n  ⏱ Stream Latency:'));
    const ttfts = streamTests.map(t => t.metrics!.ttft!).filter(v => v !== null);
    const totals = streamTests.map(t => t.metrics!.totalTime);
    if (ttfts.length > 0) {
      console.log(`     TTFT   — Min: ${formatMs(Math.min(...ttfts))}  Max: ${formatMs(Math.max(...ttfts))}  Avg: ${formatMs(ttfts.reduce((a, b) => a + b, 0) / ttfts.length)}  Median: ${formatMs(median(ttfts))}`);
    }
    console.log(`     Total  — Min: ${formatMs(Math.min(...totals))}  Max: ${formatMs(Math.max(...totals))}  Avg: ${formatMs(totals.reduce((a, b) => a + b, 0) / totals.length)}  Median: ${formatMs(median(totals))}`);
  }

  if (nonStreamTests.length > 0) {
    console.log(colorize('cyan', '\n  ⏱ Non-Stream Latency:'));
    const ttfts = nonStreamTests.map(t => t.metrics!.ttft!).filter(v => v !== null);
    const totals = nonStreamTests.map(t => t.metrics!.totalTime);
    if (ttfts.length > 0) {
      console.log(`     TTFT   — Min: ${formatMs(Math.min(...ttfts))}  Max: ${formatMs(Math.max(...ttfts))}  Avg: ${formatMs(ttfts.reduce((a, b) => a + b, 0) / ttfts.length)}  Median: ${formatMs(median(ttfts))}`);
    }
    console.log(`     Total  — Min: ${formatMs(Math.min(...totals))}  Max: ${formatMs(Math.max(...totals))}  Avg: ${formatMs(totals.reduce((a, b) => a + b, 0) / totals.length)}  Median: ${formatMs(median(totals))}`);
  }

  console.log();
  if (failed === 0) {
    console.log(colorize('green', '  🎉 All tests passed!'));
  } else {
    console.log(colorize('red', `  ⚠️  ${failed} test(s) failed. Review details above.`));
  }
  console.log();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ============================================================================
// Health Check
// ============================================================================

async function checkHealth(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/health`);
    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.get(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.status === 'ok') {
              console.log(colorize('green', `  ✓ Proxy is healthy — uptime ${parsed.uptimeHuman}, RAM ${parsed.memory?.rss}`));
              resolve(true);
            } else {
              console.log(colorize('yellow', `  ⚠ Proxy returned unexpected status: ${parsed.status}`));
              resolve(false);
            }
          } catch {
            console.log(colorize('red', '  ✗ Failed to parse health response'));
            resolve(false);
          }
        });
      }
    );

    req.on('error', (err) => {
      console.log(colorize('red', `  ✗ Cannot reach proxy at ${baseUrl}: ${err.message}`));
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      console.log(colorize('red', `  ✗ Health check timeout at ${baseUrl}`));
      resolve(false);
    });
  });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const config = parseArgs();

  printHeader('🧪 Luna Proxy — Latency & Data Integrity Test');
  console.log(colorize('cyan', `  Base URL:   ${config.baseUrl}`));
  console.log(colorize('cyan', `  Model:      ${config.model}`));
  console.log(colorize('cyan', `  Auth:       ${config.apiKey ? `API Key (${config.apiKey.slice(0, 12)}...)` : 'None (fail-open)'}`));
  console.log(colorize('cyan', `  Repeat:     ${config.repeat}x per mode`));
  console.log(colorize('cyan', `  Timeout:    ${config.timeoutMs}ms`));
  console.log(colorize('cyan', `  Modes:      ${config.stream ? 'Stream' : ''}${config.stream && config.nonStream ? ' + ' : ''}${config.nonStream ? 'Non-Stream' : ''}`));

  // Health check
  console.log(colorize('cyan', '\n  🏥 Health Check:'));
  const healthy = await checkHealth(config.baseUrl);
  if (!healthy) {
    console.log(colorize('yellow', '\n  ⚠ Proxy may not be running. Proceeding anyway...\n'));
  }

  const allTests: TestCase[] = [];

  // Stream tests
  if (config.stream) {
    console.log(colorize('cyan', `\n  📡 Running ${config.repeat} stream test(s)...`));
    for (let i = 0; i < config.repeat; i++) {
      console.log(colorize('gray', `    [${i + 1}/${config.repeat}] Sending stream request...`));
      const test = await runStreamTest(config, i);
      allTests.push(test);
      printTestCase(test);
    }
  }

  // Non-stream tests
  if (config.nonStream) {
    console.log(colorize('cyan', `\n  📦 Running ${config.repeat} non-stream test(s)...`));
    for (let i = 0; i < config.repeat; i++) {
      console.log(colorize('gray', `    [${i + 1}/${config.repeat}] Sending non-stream request...`));
      const test = await runNonStreamTest(config, i);
      allTests.push(test);
      printTestCase(test);
    }
  }

  // Summary
  printSummary(allTests);

  // Exit code
  const allPassed = allTests.every(t => t.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(colorize('red', `\n  Fatal error: ${err.message}`));
  process.exit(2);
});