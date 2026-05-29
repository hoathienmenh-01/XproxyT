# Luna Proxy

OpenAI-compatible proxy gateway that forwards requests to Qwen AI (International). Supports Cline, Claude Code CLI, and any OpenAI-compatible client.

---

## 🚀 Installation

### Requirements
- Node.js 18+ (recommended: Node 22+)
- npm or bun

### Step 1: Clone & Install

```bash
git clone <repo-url>
cd Luna-Proxy-main
npm install
```

### Step 2: Configure Qwen AI Token

**Option 1: Environment variables**
```bash
# Windows
set QWEN_AI_TOKEN=tongyi_sso_ticket_xxx
set QWEN_AI_COOKIES=cna=xxx; token=xxx

# Linux/Mac
export QWEN_AI_TOKEN=tongyi_sso_ticket_xxx
export QWEN_AI_COOKIES=cna=xxx; token=xxx
```

**Option 2: Dashboard UI**
1. Start the server → open `http://localhost:8080`
2. Go to **Providers** page → click **Start OAuth**
3. Login to Qwen AI in the popup window
4. Token is automatically captured and saved

**Option 3: API**
```bash
curl -X POST http://localhost:8080/api/provider/token \
  -H "Content-Type: application/json" \
  -d '{"providerId": "qwen-ai", "token": "your_token_here"}'
```

### Step 3: Start

```bash
# Development
npx tsx src/dev.ts

# Or use bun
bun src/dev.ts
```

Server starts at `http://localhost:8080`

---

## 🔧 Usage

### With Cline / VS Code

1. Open Cline settings
2. Set **API Provider** = `OpenAI Compatible`
3. **Base URL** = `http://localhost:8080`
4. **API Key** = any string (or proxy key if configured)
5. **Model** = `qwen3-coder-plus` or `qwen3.7-max-preview`

### With Claude Code CLI

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_API_KEY=any-key
claude "write a fibonacci function in Python"
```

### With OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="any-key"
)

response = client.chat.completions.create(
    model="qwen3-coder-plus",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### With curl

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

---

## 🌐 API Endpoints

### Chat Completion (OpenAI-compatible)
```
POST /v1/chat/completions
```
- Supports: stream, non-stream, tool calls, thinking mode
- Headers: `x-luna-session-id` (optional), `x-luna-trace-id` (auto)

### Messages (Anthropic-compatible)
```
POST /v1/messages
```

### Models
```
GET /v1/models
```

### Health Check
```
GET /health
```
Returns: status, version, uptime, memory, active sessions, active runs

### Usage Analytics
```
GET /api/usage          # Token usage, cost, model breakdown
POST /api/test-model    # Test a model (body: {"model": "qwen3-coder-plus"})
```

**GET /api/usage** returns:
```json
{
  "totalRequests": 3,
  "successfulRequests": 3,
  "failedRequests": 0,
  "estimatedInputTokens": 6000,
  "estimatedOutputTokens": 3000,
  "totalTokens": 9000,
  "avgDurationMs": 1891,
  "byModel": [{"model": "qwen3-coder-plus", "count": 3}],
  "requestsPerHour": [{"hour": "5/29 05:00", "count": 3}],
  "errors": [],
  "estimatedCost": 0.008,
  "streamingRequests": 1,
  "nonStreamingRequests": 2
}
```

**POST /api/test-model** returns:
```json
{
  "ok": true,
  "model": "qwen3-coder-plus",
  "response": "OK",
  "usage": {"prompt_tokens": 58, "completion_tokens": 1, "total_tokens": 59},
  "durationMs": 2001
}
```

---

## 🖥 Dashboard

Open `http://localhost:8080` in your browser:

| Page | Function |
|------|----------|
| **Dashboard** | Proxy health, uptime, RAM, active sessions, recent requests |
| **Providers** | Manage Qwen AI token, OAuth login |
| **Models** | View model catalog |
| **Sessions** | Manage conversation sessions, compact, reset |
| **Runs** | View request run history |
| **Workspace** | File locks, git status, conflict detection |
| **Analytics** | Token usage, cost estimation, model breakdown, requests/hour charts |
| **Logs** | View request logs, filter by level |
| **Settings** | Configure session, rate limit, token overflow |

---

## 📊 Analytics & Test Model

### Analytics Page (`/analytics`)

Real-time proxy usage statistics:

- **Primary Metrics**: Total Requests, Avg Latency, Success Rate, Streaming count
- **Token Usage**: Input Tokens, Output Tokens, Total Tokens, Estimated Cost (Qwen pricing)
- **Charts**: Requests by Model bar chart, Requests per Hour sparkline (24h), Error Breakdown
- **Auto-refresh**: Every 5 seconds

Standalone window available at `/analytics-window`

### Test Model

Quickly verify if a model is responding:

1. Go to **Analytics** page (`/analytics`)
2. Scroll to **Test Model** section
3. Select a model from dropdown or type a custom model name
4. Click **⚡ Run Test**
5. See: latency, input/output tokens, response text

Via API:
```bash
curl -X POST http://localhost:8080/api/test-model \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3-coder-plus"}'
```

---

## ⚙️ Configuration

Auto-created on first run at `data/config.json`. Edit via Dashboard → Settings.

### Key settings:

```json
{
  "settings": {
    "session": {
      "enabled": true,
      "rollingHistoryK": 10,
      "compactAfterMessages": 40
    },
    "tokenLimits": {
      "enabled": true,
      "maxInputTokens": 128000,
      "defaultMaxOutputTokens": 8192
    },
    "tokenOverflow": {
      "enabled": true,
      "threshold": 10000
    },
    "multiThread": {
      "enabled": true,
      "globalMaxConcurrentRuns": 20
    }
  }
}
```

### Proxy Key (security)

```json
{
  "proxy": {
    "key": "my-secret-key"
  }
}
```

When enabled, all requests must include:
```
Authorization: Bearer my-secret-key
```

---

## 🐳 Docker

```bash
# Build & chạy
docker-compose up -d

# Hoặc build thủ công
docker build -t luna-proxy .
docker run -p 8080:8080 -v luna-data:/app/data luna-proxy
```

---

## 🧪 Tests

```bash
# Chạy tất cả tests
npx ts-node tests/contextCompactor.test.ts
npx ts-node tests/infraModules.test.ts
npx ts-node tests/phase5.test.ts
npx ts-node tests/responseSanitizer.test.ts
npx ts-node tests/retryPolicy.test.ts
npx ts-node tests/toolCallValidator.test.ts
npx ts-node tests/bufferedStreamParser.test.ts
npx ts-node tests/nonStreamToolRounds.test.ts
npx ts-node tests/logger.test.ts
npx ts-node tests/database.test.ts
npx ts-node tests/configValidator.test.ts
npx ts-node tests/integration.test.ts

# Smoke test (khởi động server + test endpoints)
npx ts-node tests/smoke.test.ts
```

---

## 📊 Tính năng chính

| Tính năng | Mô tả |
|-----------|-------|
| **Response Sanitizer** | Strip reasoning leak, auto-close XML, remove duplicate content |
| **Buffered Stream Parser** | Ghép partial chunks, hold back partial markers, emit complete blocks |
| **Non-stream Tool Rounds** | Tự động dùng non-stream cho tool call rounds (giảm 90% parser lỗi) |
| **Tool Call Validator** | Validate/repair JSON, fuzzy name matching, format detection |
| **Session Management** | Auto-create, context hash, compaction, auto-reset, snapshot |
| **Rate Limiting** | Per-account 30req/min, 3 concurrent, 429 cooldown |
| **Fingerprint Rotation** | Random Chrome/UA/bx headers, 195 combinations |
| **Git Context** | Auto inject git diff vào system prompt |
| **Workspace Scheduler** | File locks, conflict detection, stale context detection |
| **Config Validation** | Validate on startup, fill defaults, warn dangerous settings |
| **Structured Logging** | 5 levels, JSON format, correlation IDs, sensitive field redaction |
| **SQLite Storage** | WAL mode, 5 tables (sẵn sàng, cần enableSqliteBackend()) |

---

## 📁 Cấu trúc thư mục

```
src/
├── modules/              # 20 modules chức năng
│   ├── responseSanitizer.ts
│   ├── streamWatchdog.ts
│   ├── retryPolicy.ts
│   ├── toolCallValidator.ts
│   ├── bufferedToolAccumulator.ts
│   ├── contextCompactor.ts
│   ├── sessionReset.ts
│   ├── sessionSnapshot.ts
│   ├── workspaceScheduler.ts
│   ├── gitContext.ts
│   ├── claudeCodeMode.ts
│   ├── rateLimiter.ts
│   ├── fingerprintRotation.ts
│   ├── logger.ts
│   ├── database.ts
│   ├── configValidator.ts
│   ├── migrate.ts
│   ├── sqliteSessionAdapter.ts
│   └── asyncWriter.ts
├── server/               # Server modules
│   ├── types.ts
│   ├── middleware.ts
│   └── routes.ts
├── server.ts             # Main server (request handler)
├── sessionStore.ts       # Session storage (JSON/SQLite)
├── configStore.ts        # Config storage (JSON/SQLite)
├── dev.ts                # Entry point
└── types/
    └── node-sqlite.d.ts  # Node 24 SQLite types

tests/                    # 16 test files, 293+ tests
frontend/                 # React dashboard
```

---

## 📄 License

MIT