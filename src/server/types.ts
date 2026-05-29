/**
 * Server Types — Shared type definitions for the proxy server.
 * Phase 11: Type Safety refactor.
 */

/** Incoming chat completion request body */
export interface ChatCompletionRequestBody {
  model?: string;
  messages?: Array<{
    role: string;
    content?: string | Array<{ type: string; text?: string; [key: string]: any }>;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
    name?: string;
  }>;
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  tools?: Array<{
    type?: string;
    function?: {
      name: string;
      description?: string;
      parameters?: Record<string, any>;
    };
    name?: string;
    description?: string;
    parameters?: Record<string, any>;
    input_schema?: Record<string, any>;
  }>;
  tool_choice?: string | { type?: string; function?: { name: string }; mode?: string };
  enable_thinking?: boolean;
  enableThinking?: boolean;
  thinking_mode?: string;
  thinkingMode?: string;
  qwen_thinking_mode?: string;
  qwenThinkingMode?: string;
  reasoning_effort?: string;
  reasoning?: { effort?: string };
  thinking_budget?: number;
  enableWebSearch?: boolean;
  file_ids?: string[];
  providerSessionId?: string;
  provider_session_id?: string;
  account?: string;
  metadata?: {
    account_id?: string;
    subagent_id?: string;
    agent_id?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

/** Error response format */
export interface ErrorResponse {
  error: {
    message: string;
    type?: string;
    code?: string;
    param?: string;
    [key: string]: any;
  };
}

/** Proxy configuration */
export interface ProxyConfig {
  key?: string;
  [key: string]: any;
}

/** Session health metrics for reset decisions */
export interface SessionHealthMetrics {
  messageCount: number;
  retryCount: number;
  streamFailureCount: number;
  lastError?: string;
  lastActivityAt: number;
  turnCount: number;
}