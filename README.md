# Luna Proxy (XproxyT)

**OpenAI-compatible AI proxy gateway** — Nhận request từ bất kỳ client OpenAI-compatible (Cline, Claude Code, OpenAI SDK...) và chuyển tiếp đến **Qwen AI (International)**. Bao gồm dashboard quản lý, session management, rate limiting, analytics và nhiều tính năng enterprise-grade.

---

## 📖 Mục lục

- [Tổng quan](#-tổng-quan)
- [Cách hoạt động](#-cách-hoạt-động)
- [Kiến trúc hệ thống](#-kiến-trúc-hệ-thống)
- [Tech Stack](#-tech-stack)
- [Cài đặt](#-cài-đặt)
- [Sử dụng](#-sử-dụng)
- [Tính năng chi tiết](#-tính-năng-chi tiết)
- [API Endpoints](#-api-endpoints)
- [Dashboard](#-dashboard)
- [Cấu hình](#-cấu-hình)
- [Authentication](#-authentication)
- [Docker](#-docker)
- [Tests](#-tests)
- [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
- [License](#-license)

---

## 🎯 Tổng quan

Luna Proxy đóng vai trò là **middleware gateway** giữa các AI coding client và Qwen AI API. Thay vì mỗi client kết nối trực tiếp đến Qwen, tất cả request đi qua Luna Proxy, nơi đóng gói thêm các tính năng:

| Khả năng | Mô tả |
|----------|-------|
| **Protocol Translation** | Chuyển đổi OpenAI ↔ Anthropic ↔ Qwen format tự động |
| **Session Management** | Tự động quản lý conversation context, compaction, reset |
| **Rate Limiting** | Giới hạn request per-account, cooldown khi bị 429 |
| **Token Overflow** | Tự động phát hiện và xử lý khi context quá dài |
| **Tool Call Handling** | Parse, validate, repair tool calls từ Qwen response |
| **Stream Processing** | Xử lý SSE stream real-time với buffering và watchdog |
| **Multi-Provider** | Hỗ trợ nhiều provider account, load balancing |
| **Dashboard UI** | Giao diện web quản lý toàn bộ proxy |

### Client nào hoạt động được?

| Client | Protocol | Trạng thái |
|--------|----------|------------|
| **Cline (VS Code)** | OpenAI Compatible | ✅ Hoạt động |
| **Claude Code CLI** | Anthropic Compatible | ✅ Hoạt động |
| **OpenAI SDK (Python/Node)** | OpenAI Compatible | ✅ Hoạt động |
| **curl / HTTP client** | OpenAI Compatible | ✅ Hoạt động |
| **Bất kỳ OpenAI-compatible client** | OpenAI Compatible | ✅ Hoạt động |

---

## ⚙️ Cách hoạt động

### Luồng xử lý tổng thể

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Cline / Claude Code / OpenAI SDK)    │
│                                                                     │
│  User nhập prompt → Client gửi HTTP request                         │
│  POST /v1/chat/completions  (OpenAI format)                         │
│  hoặc POST /v1/messages      (Anthropic format)                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP/HTTPS (JSON + SSE)
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     LUNA PROXY (Koa Server)                         │
│                                                                     │
│  ┌─────────────────── Middleware Chain ───────────────────────┐     │
│  │ ① Trace ID    → Sinh UUID cho mỗi request (x-luna-trace)  │     │
│  │ ② Error Catch → Global error handler, trả JSON error       │     │
│  │ ③ CORS        → Set Access-Control-* headers               │     │
│  │ ④ Body Parser → Parse JSON body (giới hạn 10MB)            │     │
│  │ ⑤ Auth        → Kiểm tra API Key / Proxy Key               │     │
│  └────────────────────────────────────────────────────────────┘     │
│                           ↓                                         │
│  ┌─────────────────── Request Pipeline ──────────────────────┐     │
│  │ ⑥ Protocol Detection → Nhận diện OpenAI hay Anthropic     │     │
│  │ ⑦ Format Conversion  → Chuẩn hóa về internal format       │     │
│  │ ⑧ Session Resolution → Tìm/tạo session theo context hash  │     │
│  │ ⑨ Rate Limit Check   → Kiểm tra quota per-account          │     │
│  │ ⑩ Token Count  → Ước tính tokens, kiểm tra overflow        │     │
│  │ ⑪ Provider Select    → Chọn provider + account phù hợp    │     │
│  │ ⑫ Lock & Schedule    → Acquire capacity lock,排队 nếu đầy │     │
│  │ ⑫ Tool Prompt Inject → Inject ML_XML tool prompt vào msg   │     │
│  └────────────────────────────────────────────────────────────┘     │
│                           ↓                                         │
│  ┌─────────────────── Provider Call ─────────────────────────┐     │
│  │ ⑬ QwenAiAdapter     → Gọi Qwen AI API                    │     │
│  │ ⑭ Stream Transform   → Parse SSE, transform response      │     │
│  │ ⑮ Response Sanitize  → Strip thinking, fix tool calls     │     │
│  │ ⑯ Tool Call Validate → Validate/repair JSON tool output   │     │
│  └────────────────────────────────────────────────────────────┘     │
│                           ↓                                         │
│  ┌─────────────────── Persistence ───────────────────────────┐     │
│  │ ⑰ Log Request        → Ghi log vào SQLite + JSON          │     │
│  │ ⑱ Update Session     → Lưu messages, turn count            │     │
│  │ ⑲ Update Run         → Cập nhật run status, duration       │     │
│  │ ⑳ Release Lock       → Giải phóng capacity lock            │     │
│  └────────────────────────────────────────────────────────────┘     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP/HTTPS (SSE stream hoặc JSON)
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     QWEN AI API (chat.qwen.ai)                      │
│                                                                     │
│  POST https://chat.qwen.ai/api/v2/chat/completions                 │
│  Headers: Cookie, Authorization (token từ Qwen account)            │
│  → Trả về SSE stream hoặc JSON response                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Luồng chi tiết cho 1 Chat Request

```
1. Client gửi:  POST /v1/chat/completions
                Body: { model: "qwen3-coder-plus", messages: [...], stream: true }

2. Middleware:
   → Sinh trace ID: "a1b2c3d4e5f6"
   → Parse JSON body
   → Kiểm tra auth: SHA-256("sk-luna-xxx") → SQLite lookup → PASS
   → Set ctx.state.clientName = "my-app"

3. Route Handler:
   → Detect: OpenAI format (có messages[] + model)
   → Convert: OpenAI messages → internal format
   → Session: hash(messages) → tìm session existing hoặc tạo mới
   → Rate limit: accountKey = "qwen-ai:default" → check 30req/min → PASS
   → Token estimate: ~5000 tokens → dưới threshold 128000 → OK
   → Select provider: qwen-ai → account "default" → adapter created
   → Acquire lock: capacity = 1/2 → PASS (còn slot)
   → Inject tool prompt: thêm ML_XML tool definitions vào system message

4. Call Qwen:
   → POST https://chat.qwen.ai/api/v2/chat/completions
   → Cookie: "cna=xxx; token=xxx"
   → Stream: true → SSE response

5. Stream Processing:
   → eventsource-parser parse SSE events
   → QwenAiStreamHandler transform → OpenAI SSE format
   → BufferedToolAccumulator hold partial chunks
   → ResponseSanitizer strip thinking blocks
   → ToolCallValidator validate JSON tool calls
   → Write SSE chunks to client response stream

6. Cleanup:
   → Log: configStore.addLog("info", "{path,model,status,duration}")
   → Session: sessionStore.updateSession({messages, turnCount})
   → Run: runStore.updateRun({status:"completed", duration: 3200ms})
   → Lock: releaseRun() → capacity freed
```

---

## 🏗 Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React SPA)                        │
│                                                                  │
│  React 18 + TypeScript + Vite                                    │
│  ├── Dashboard     (health, active runs, recent requests)        │
│  ├── Providers     (Qwen token, OAuth login)                     │
│  ├── Models        (model catalog browser)                       │
│  ├── Sessions      (conversation management)                     │
│  ├── Runs          (request run history)                         │
│  ├── Analytics     (token usage, cost, charts)                   │
│  ├── Logs          (request logs, filter by level)               │
│  ├── Settings      (session, rate limit, overflow config)        │
│  ├── Workspace     (file locks, git status)                      │
│  ├── Network       (network profiles, egress isolation)          │
│  └── API Keys      (admin API key management)                    │
│                                                                  │
│  State: useState/useEffect per component, polling 2-5s           │
│  HTTP:  fetch() thuần (không Axios, không state library)         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API (fetch)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND (Node.js + Koa)                       │
│                                                                  │
│  ┌──────────────── Server Layer ──────────────────┐              │
│  │ server.ts        Main request handler (~2400L)  │              │
│  │ server/routes.ts API route registration         │              │
│  │ server/middleware.ts  Auth, CORS, headers        │              │
│  └────────────────────────────────────────────────┘              │
│                                                                  │
│  ┌──────────────── Modules (20+) ─────────────────┐              │
│  │ responseSanitizer   Strip thinking, fix XML     │              │
│  │ streamWatchdog      Timeout protection          │              │
│  │ retryPolicy         Auto retry on failure       │              │
│  │ toolCallValidator   Validate/repair tool calls  │              │
│  │ bufferedToolAccumulator  Stream buffering       │              │
│  │ sseCollector        Collect non-stream SSE      │              │
│  │ contextCompactor    Compact long conversations  │              │
│  │ sessionReset        Auto reset stale sessions   │              │
│  │ sessionSnapshot     Create session snapshots    │              │
│  │ sessionCompactor    Summarize & compact sessions│              │
│  │ sessionPersistence  Persist messages to store   │              │
│  │ rateLimiter         Per-account rate limiting   │              │
│  │ fingerprintRotation Random browser fingerprints │              │
│  │ workspaceScheduler  File locks & conflict detect│              │
│  │ gitContext          Auto inject git diff        │              │
│  │ claudeCodeMode      Claude Code compatibility   │              │
│  │ configValidator     Validate config on startup  │              │
│  │ logger              Structured logging (5 levels│              │
│  │ database            SQLite storage (WAL mode)   │              │
│  │ migrate             Data migration helpers      │              │
│  │ asyncWriter         Async file writer           │              │
│  │ overflowPolicy      Token overflow handling     │              │
│  │ textUtils           Token estimation            │              │
│  └────────────────────────────────────────────────┘              │
│                                                                  │
│  ┌──────────────── Runtime Layer ─────────────────┐              │
│  │ scheduler          Queueing & concurrency      │              │
│  │ locks              Account/provider locks       │              │
│  │ providerRouter     Provider/account selection   │              │
│  │ providerFactory    Adapter construction        │              │
│  │ runStore           Run persistence              │              │
│  │ runControllers     Abort/cancel registry        │              │
│  │ networkProfiles    Network profile management   │              │
│  │ workerClient       Worker forwarding            │              │
│  │ workerSelector     Worker selection rules       │              │
│  └────────────────────────────────────────────────┘              │
│                                                                  │
│  ┌──────────────── Proxy Layer ───────────────────┐              │
│  │ QwenAiAdapter      Qwen API client             │              │
│  │ QwenAiStreamHandler  SSE stream transformer    │              │
│  │ anthropic.ts       Anthropic format converter   │              │
│  │ toolcall/          Tool prompt injection & parse│              │
│  │ prompts/           Runtime-editable prompts     │              │
│  │ overflowSanitizer  Overflow text cleanup        │              │
│  └────────────────────────────────────────────────┘              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    PERSISTENCE LAYER                              │
│                                                                  │
│  ┌──────────────────────┐  ┌────────────────────────────┐       │
│  │ SQLite (node:sqlite)  │  │ JSON Files (fallback)      │       │
│  │                       │  │                            │       │
│  │ Tables:               │  │ data/config.json           │       │
│  │  • sessions            │  │ data/sessions.json         │       │
│  │  • config              │  │ data/runs.json             │       │
│  │  • logs                │  │ data/wire-logs/            │       │
│  │  • runs                │  │ data/overflow/             │       │
│  │  • rate_limits         │  │ data/compact/              │       │
│  │  • api_keys            │  │                            │       │
│  │                       │  │                            │       │
│  │ Mode: WAL              │  │                            │       │
│  │ Path: data/luna-proxy.db│  │                            │       │
│  └──────────────────────┘  └────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    QWEN AI (chat.qwen.ai)                        │
│                                                                  │
│  POST /api/v2/chat/completions                                   │
│  Auth: Cookie + Bearer token                                     │
│  Response: SSE stream (eventsource-parser)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠 Tech Stack

| Layer | Công nghệ | Vai trò |
|-------|-----------|---------|
| **Backend Runtime** | Node.js 24+ | Server runtime, hỗ trợ `node:sqlite` built-in |
| **Backend Framework** | Koa.js + @koa/router | HTTP server, middleware chain, routing |
| **Ngôn ngữ** | TypeScript | Type-safe cho cả frontend và backend |
| **Frontend** | React 18 + React Router v6 | SPA dashboard quản lý |
| **Frontend Bundler** | Vite 5 | Dev server + production build |
| **Dev Runtime** | Bun (chính) / ts-node-dev (phụ) | Chạy TypeScript trực tiếp |
| **HTTP Client** | Axios | Gọi Qwen AI API upstream |
| **SSE Parser** | eventsource-parser | Parse Server-Sent Events từ Qwen |
| **Cơ sở dữ liệu** | SQLite (node:sqlite) | Persistent storage với WAL mode |
| **Fallback Storage** | JSON files | Backward compatibility |
| **Browser Automation** | Puppeteer | OAuth credential capture |
| **Compression** | zstd-codec | Nén/giải nén dữ liệu |
| **Containerization** | Docker + Docker Compose | Production deployment |
| **Build Tool** | TypeScript compiler (tsc) | Biên dịch TypeScript |

---

## 📦 Cài đặt

### Yêu cầu

- **Node.js 24+** (bắt buộc cho `node:sqlite` built-in)
- npm, pnpm, hoặc bun

### Bước 1: Clone & Install

```bash
git clone https://github.com/hoathienmenh-01/XproxyT.git
cd Luna-Proxy-main
npm install
```

### Bước 2: Cấu hình Qwen AI Token

**Cách 1: Environment variables**
```bash
# Windows
set QWEN_AI_TOKEN=tongyi_sso_ticket_xxx
set QWEN_AI_COOKIES=cna=xxx; token=xxx

# Linux/Mac
export QWEN_AI_TOKEN=tongyi_sso_ticket_xxx
export QWEN_AI_COOKIES=cna=xxx; token=xxx
```

**Cách 2: Dashboard UI (khuyên dùng)**
1. Start server → mở `http://localhost:8080`
2. Vào trang **Providers** → click **Start OAuth** hoặc **Auto Capture**
3. Login Qwen AI trong popup
4. Token tự động capture và lưu

**Cách 3: API**
```bash
curl -X POST http://localhost:8080/api/provider/token \
  -H "Content-Type: application/json" \
  -d '{"providerId": "qwen-ai", "token": "your_token_here"}'
```

### Bước 3: Start Server

```bash
# Development (dùng Bun - nhanh nhất)
bun src/dev.ts

# Hoặc dùng npm
npm run dev

# Hoặc dùng ts-node-dev (auto-reload)
npm run dev:watch
```

Server khởi động tại `http://localhost:8080`

### Bước 4: Build Frontend (nếu sửa UI)

```bash
cd frontend
npm install
npm run build
# Output → public/ (served by backend)
```

---

## 🔧 Sử dụng

### Với Cline / VS Code

1. Mở Cline settings
2. **API Provider** = `OpenAI Compatible`
3. **Base URL** = `http://localhost:8080`
4. **API Key** = bất kỳ chuỗi nào (hoặc API key `sk-luna-...` nếu đã cấu hình auth)
5. **Model** = `qwen3-coder-plus` hoặc `qwen3.7-max-preview`

### Với Claude Code CLI

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_API_KEY=any-key
claude "write a fibonacci function in Python"
```

### Với OpenAI SDK (Python)

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

### Với curl

```bash
# Stream mode
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Non-stream mode
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

---

## 🌟 Tính năng chi tiết

### 1. Protocol Translation (Chuyển đổi giao thức)

Luna Proxy tự động chuyển đổi giữa 3 format:

| Input Format | Output Format | Endpoint |
|-------------|---------------|----------|
| OpenAI | Qwen AI | `POST /v1/chat/completions` |
| Anthropic | Qwen AI | `POST /v1/messages` |
| Qwen AI (native) | OpenAI | Internal conversion |

**Chi tiết:**
- OpenAI `messages[]` → Qwen `messages[]` (giữ nguyên format)
- Anthropic `content blocks` → Qwen `messages[]` (flatten text blocks)
- Qwen `function_call` → OpenAI `tool_calls[]` (transform stream)
- Qwen `thinking` blocks → Strip hoặc preserve tùy config

### 2. Session Management (Quản lý phiên)

Mỗi conversation được quản lý như một **session** với đầy đủ lifecycle:

```
Tạo mới → Tích lũy messages → Compact khi quá dài → Reset khi stale
```

| Chức năng | Mô tả |
|-----------|-------|
| **Auto-create** | Tự tạo session mới khi không tìm thấy session matching |
| **Context Hash** | Hash messages để resolve session — cùng context = cùng session |
| **Rolling History** | Giữ N messages gần nhất (configurable, mặc định 10) |
| **Auto Compact** | Khi messages > 40, tự tóm tắt bằng Qwen AI và giữ lại 5 messages gần nhất |
| **Session Snapshot** | Tạo snapshot toàn bộ session state để rollback |
| **Auto Reset** | Phát hiện session stale (cùng content lặp lại) → tự reset |
| **Provider Binding** | Mỗi session liên kết với Qwen chat ID riêng |
| **Summary** | Tóm tắt conversation mỗi N turns (mặc định 5) |

### 3. Rate Limiting (Giới hạn tốc độ)

| Policy | Giá trị mặc định | Mô tả |
|--------|------------------|-------|
| Requests per minute | 30 | Per-account limit |
| Concurrent runs | 2 per account | Giới hạn đồng thời |
| 429 cooldown | Auto detect | Tự động backoff khi bị upstream 429 |
| Queue timeout | 120s | Thời gian排队 tối đa |
| Run timeout | 300s | Thời gian chạy tối đa cho 1 request |

Khi bị rate limit, request sẽ được **queue** và chờ slot trống thay vì reject ngay.

### 4. Token Overflow Handling (Xử lý context quá dài)

Khi context gần đạt giới hạn token của Qwen:

```
estimateTokens(messages) > threshold?
    ↓ YES
┌─ Overflow Policy ──────────────────────────────────┐
│ ① Sanitize messages                                │
│    - Strip thinking blocks                         │
│    - Remove duplicate assistant messages            │
│    - Truncate tool results (>12000 chars)           │
│    - Strip client tool protocol messages            │
│ ② Upload overflow file to Qwen OSS                 │
│    - Generate file with full context                │
│    - Upload via Qwen file API                      │
│    - Attach file_id to message                     │
│ ③ Compact session                                   │
│    - Summarize older messages                       │
│    - Keep recent N messages intact                  │
│ ④ Auto-reset session                                │
│    - If context still too long after compact        │
│    - Create fresh session with summary              │
└────────────────────────────────────────────────────┘
```

### 5. Tool Call Handling (Xử lý tool calls)

Qwen AI trả tool calls dưới dạng XML trong response text. Luna Proxy tự động:

| Bước | Chức năng |
|------|-----------|
| **Parse** | Nhận diện ML_XML tool call format từ Qwen response |
| **Extract** | Trích xuất tool name, arguments, tool call ID |
| **Validate** | Kiểm tra JSON validity của arguments |
| **Repair** | Tự sửa JSON bị lỗi (missing quotes, trailing commas...) |
| **Fuzzy Match** | Match tool name gần đúng nếu tên không khớp chính xác |
| **Convert** | Transform về OpenAI `tool_calls[]` format |
| **Inject Prompt** | Inject ML_XML tool definitions vào system message |

### 6. Stream Processing (Xử lý stream)

```
Qwen SSE Stream
    ↓
eventsource-parser (parse raw SSE)
    ↓
QwenAiStreamHandler (transform events)
    ↓
BufferedToolAccumulator (buffer partial chunks)
    ↓
ResponseSanitizer (clean output)
    ↓
StreamWatchdog (timeout protection)
    ↓
Client SSE Response (OpenAI format)
```

| Component | Vai trò |
|-----------|---------|
| **eventsource-parser** | Parse raw SSE text thành structured events |
| **QwenAiStreamHandler** | Transform Qwen events → OpenAI format |
| **BufferedToolAccumulator** | Ghép partial chunks, hold partial markers |
| **ResponseSanitizer** | Strip thinking blocks, fix XML, remove duplicates |
| **StreamWatchdog** | Timeout protection — abort nếu stream bị treo |
| **AsyncWriter** | Ghi wire-logs bất đồng bộ (không block stream) |

### 7. Fingerprint Rotation (Xoay vân tay browser)

Để tránh bị Qwen phát hiện là bot, mỗi request gửi với fingerprint ngẫu nhiên:

- **User-Agent**: Random Chrome/Edge UA string
- **Browser Headers**: Random sec-ch-ua, sec-fetch-* headers
- **Cookie Headers**: Random bx-* headers
- **195 combinations** khác nhau

### 8. Multi-Thread & Concurrency (Đa luồng)

| Khả năng | Mô tả |
|----------|-------|
| **Global Max Concurrent** | 20 runs đồng thời toàn hệ thống |
| **Provider Max** | 5 runs per provider |
| **Account Max** | 2 runs per account |
| **Same Chat Policy** | Queue nếu cùng chat ID (tránh conflict) |
| **Session Write Lock** | Serialize writes cùng session |
| **Provider Binding Lock** | Tránh 2 runs dùng cùng provider credentials |

### 9. Workspace Scheduler (Quản lý workspace)

Khi nhiều agent cùng làm việc trên 1 workspace:

| Chức năng | Mô tả |
|-----------|-------|
| **File Locks** | Lock file khi agent đang edit |
| **Conflict Detection** | Phát hiện 2 agent sửa cùng file |
| **Stale Context** | Phát hiện context đã lỗi thời (file changed) |
| **Git Context** | Auto inject `git diff` vào system prompt |

### 10. Logging & Monitoring

| Khả năng | Chi tiết |
|----------|----------|
| **5 Log Levels** | debug, info, warn, error, fatal |
| **Structured JSON** | Mỗi log entry là JSON object |
| **Correlation ID** | Trace ID liên kết toàn bộ request lifecycle |
| **Sensitive Redaction** | Tự động mask headers chứa token/cookie/secret |
| **Wire Logs** | Lưu raw request/response stream để debug |
| **SQLite Storage** | Logs lưu trong SQLite table `logs` |
| **Auto Cleanup** | Giới hạn 1000 log entries, tự xóa cũ |

### 11. Config Validation

Tự động validate cấu hình khi khởi động:

- Kiểm tra kiểu dữ liệu của mọi setting
- Fill giá trị mặc định cho missing fields
- Warn nếu cấu hình có thể gây lỗi
- Reject giá trị không hợp lệ

---

## 🌐 API Endpoints

### Proxy Endpoints (AI Inference)

| Method | Path | Mô tả | Auth |
|--------|------|-------|------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completion | ✅ API Key |
| `POST` | `/v1/messages` | Anthropic-compatible messages | ✅ API Key |
| `GET` | `/v1/models` | List available models | ✅ API Key |

### Admin API (Dashboard)

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/health` | Health check (status, uptime, memory) |
| `GET` | `/api/config` | Lấy toàn bộ config |
| `POST` | `/api/config` | Cập nhật config |
| `GET` | `/api/models` | Model catalog |
| `POST` | `/api/models/refresh` | Refresh model catalog |
| `POST` | `/api/test-model` | Test 1 model (gửi "Hello" và đo response) |

### Sessions API

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/sessions` | List tất cả sessions |
| `GET` | `/api/sessions/:id` | Chi tiết 1 session |
| `DELETE` | `/api/sessions/:id` | Xóa 1 session |
| `POST` | `/api/sessions/:id/clear` | Xóa messages trong session |
| `POST` | `/api/sessions/:id/compact` | Compact session (tóm tắt) |
| `POST` | `/api/sessions/:id/rename` | Đổi tên session |
| `POST` | `/api/sessions/:id/reset-provider` | Reset provider session binding |
| `GET` | `/api/sessions/diagnostics` | Session diagnostics |
| `POST` | `/api/sessions/reload` | Reload sessions từ storage |
| `DELETE` | `/api/sessions` | Xóa tất cả sessions |

### Runs API

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/runs` | List run history |
| `GET` | `/api/runs/:id` | Chi tiết 1 run |
| `DELETE` | `/api/runs/:id` | Xóa 1 run |
| `DELETE` | `/api/runs` | Xóa tất cả runs |
| `POST` | `/api/runs/:id/cancel` | Cancel 1 run đang chạy |

### Provider & Auth API

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/provider/status` | Kiểm tra trạng thái provider |
| `POST` | `/api/provider/token` | Set provider token |
| `POST` | `/api/provider/validate` | Validate provider credentials |
| `POST` | `/api/provider/oauth-config` | Cấu hình OAuth |
| `GET` | `/api/provider/oauth-config` | Lấy OAuth config |
| `POST` | `/api/provider/oauth/capture` | Auto capture credentials (Puppeteer) |
| `GET` | `/auth/start/:providerId` | Bắt đầu OAuth flow |
| `GET` | `/auth/callback/:providerId` | OAuth callback |

### Runtime & Infrastructure API

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/runtime` | Runtime diagnostics (active runs, locks, workers) |
| `GET` | `/api/provider-runtime` | Provider runtime config & locks |
| `GET` | `/api/logs` | Request logs |
| `GET` | `/api/logs/stats` | Log statistics |
| `DELETE` | `/api/logs` | Clear all logs |
| `GET` | `/api/usage` | Usage analytics (tokens, cost, breakdown) |

### Network & Workers API

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/network-profiles` | List network profiles |
| `POST` | `/api/network-profiles` | Tạo/cập nhật network profile |
| `PUT` | `/api/network-profiles/:id` | Cập nhật network profile |
| `DELETE` | `/api/network-profiles/:id` | Xóa network profile |
| `GET` | `/api/egress/direct-ip` | Kiểm tra IP trực tiếp |
| `GET` | `/api/workers` | List workers |
| `POST` | `/api/workers` | Tạo/cập nhật worker |
| `PUT` | `/api/workers/:id` | Cập nhật worker |
| `DELETE` | `/api/workers/:id` | Xóa worker |
| `POST` | `/api/workers/:id/verify-ip` | Verify worker IP |

### Workspace API

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/workspace/diagnostics` | Workspace diagnostics |
| `POST` | `/api/workspace/cleanup-locks` | Cleanup expired locks |
| `GET` | `/api/workspace/git-status` | Git repository status |

### Admin API Key Management

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/admin/keys` | List tất cả API keys |
| `POST` | `/api/admin/keys` | Tạo API key mới |
| `PATCH` | `/api/admin/keys/:id/toggle` | Toggle active/inactive |

### Prompts API

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/prompts` | List tất cả prompts |
| `POST` | `/api/prompts` | Override 1 prompt |
| `POST` | `/api/prompts/reset` | Reset tất cả prompt overrides |

### Debug API

| Method | Path | Mô tả |
|--------|------|-------|
| `POST` | `/api/debug/qwen-roundtrip` | Test full Qwen roundtrip |
| `POST` | `/api/debug/qwen-wire` | Test Qwen wire-level response |
| `POST` | `/api/debug/qwen-file-flow` | Test file upload flow |

---

## 🖥 Dashboard

Mở `http://localhost:8080` trong trình duyệt:

### Dashboard (`/`)
- Proxy health status (online/offline)
- Uptime, RAM usage
- Active sessions & runs count
- Configured providers count
- Queued runs & capacity
- Runtime scheduler table (active runs, locks)
- Recent request logs (auto-refresh 2s)

### Providers (`/providers`)
- Qwen AI token management
- OAuth login flow (auto-open popup)
- Auto credential capture (Puppeteer)
- Provider status check (alive/dead/warn)
- Credential validation

### Models (`/models`)
- Qwen AI model catalog browser
- Model metadata: name, ID, limits, modalities
- Model aliases mapping
- Refresh catalog button

### Sessions (`/sessions`)
- List all conversation sessions
- Session details: messages, turn count, summary
- Actions: compact, clear, rename, delete, reset provider binding
- Session diagnostics

### Runs (`/runs`)
- Request run history
- Run details: status, provider, account, session, worker, duration
- Cancel running requests
- Clear run history

### Analytics (`/analytics`)
- **Primary Metrics**: Total Requests, Avg Latency, Success Rate, Streaming count
- **Token Usage**: Input Tokens, Output Tokens, Total Tokens, Estimated Cost
- **Charts**: Requests by Model (bar chart), Requests per Hour (24h sparkline)
- **Error Breakdown**: Error types and counts
- **Test Model**: Chọn model → chạy test → xem latency + tokens
- Auto-refresh every 5 seconds
- Standalone window: `/analytics-window`

### Logs (`/logs`)
- Request logs với filter theo level (info/warn/error)
- Log statistics (total, errors, chat requests)
- Clear logs button

### Settings (`/settings`)
- **Session**: enabled, rollingHistoryK, summaryEveryNTurns, autoCompact, compactAfterMessages
- **Rate Limit**: maxConcurrentRuns, queueTimeoutMs, runTimeoutMs
- **Token Overflow**: enabled, threshold, sanitizer settings
- **Token Limits**: maxInputTokens, maxOutputTokens, warnInputTokens
- **Egress Isolation**: enabled, mode, verifyBeforeUse
- **Multi-Thread**: enabled, globalMaxConcurrentRuns
- **UI**: language (en/vi)

### Workspace (`/workspace`)
- File lock status
- Git repository status (branch, diff, dirty files)
- Conflict detection
- Lock cleanup

### Network Profiles (`/network`)
- Network profile management
- Direct IP verification
- Egress isolation configuration

### API Keys (`/api-keys`)
- Tạo API key mới (`sk-luna-...`)
- List tất cả keys (ẩn hash, chỉ hiện suffix)
- Toggle active/inactive
- Client name tagging

---

## ⚙️ Cấu hình

Auto-created tại `data/config.json` khi lần đầu chạy. Chỉnh sửa qua Dashboard → Settings hoặc trực tiếp file.

### Cấu hình đầy đủ

```json
{
  "providers": [
    {
      "id": "qwen-ai",
      "name": "Qwen AI (International)",
      "credentials": {
        "token": "tongyi_sso_ticket_xxx",
        "cookies": "cna=xxx; token=xxx"
      },
      "accounts": [
        {
          "id": "default",
          "name": "Primary Account",
          "enabled": true,
          "maxConcurrentRuns": 2,
          "credentials": { "token": "...", "cookies": "..." }
        }
      ],
      "oauth": {
        "authorizeUrl": "https://...",
        "tokenUrl": "https://...",
        "clientId": "...",
        "scopes": ["..."]
      }
    }
  ],
  "proxy": {
    "host": "127.0.0.1",
    "port": 8080,
    "key": "my-secret-proxy-key"
  },
  "models": [],
  "settings": {
    "session": {
      "enabled": true,
      "rollingHistoryK": 10,
      "summaryEveryNTurns": 5,
      "summaryMaxTokens": 800,
      "autoCompact": true,
      "compactAfterMessages": 40,
      "compactModel": "Qwen3.6-Plus",
      "compactKeepRecent": 5,
      "overflowSignal": {
        "enabled": true,
        "mode": "auto",
        "signalThresholdTokens": 90000
      },
      "chatCleanup": {
        "enabled": false,
        "scheduled": {
          "enabled": false,
          "intervalHours": 1,
          "maxAgeHours": 24
        }
      }
    },
    "tokenOverflow": {
      "enabled": true,
      "threshold": 10000,
      "sanitizer": {
        "enabled": true,
        "mode": "generic-plus-client-rules",
        "maxMessageChars": 20000,
        "maxToolResultChars": 12000,
        "maxToolResultCount": 5,
        "stripClientToolProtocol": true,
        "stripAssistantThinking": true,
        "dedupeAssistantMessages": true,
        "assistantSimilarityThreshold": 0.85
      }
    },
    "multiThread": {
      "enabled": true,
      "globalMaxConcurrentRuns": 20,
      "defaultProviderMaxConcurrentRuns": 5,
      "defaultAccountMaxConcurrentRuns": 2,
      "sameProviderChatPolicy": "queue",
      "sameSessionWritePolicy": "serialize",
      "queueTimeoutMs": 120000,
      "runTimeoutMs": 300000
    },
    "tokenLimits": {
      "enabled": true,
      "maxInputTokens": 128000,
      "warnInputTokens": 100000,
      "defaultMaxOutputTokens": 8192,
      "maxOutputTokensCap": 32000
    },
    "egressIsolation": {
      "enabled": false,
      "mode": "worker",
      "strict": true,
      "verifyBeforeUse": true
    },
    "ui": {
      "language": "en"
    }
  }
}
```

---

## 🔐 Authentication

Hệ thống auth gồm 3 lớp, ưu tiên theo thứ tự:

### Lớp 1: API Key (SaaS-style) — Ưu tiên cao nhất

```
Header: Authorization: Bearer sk-luna-<64 hex chars>
Hoặc:   x-api-key: sk-luna-<64 hex chars>

Server xử lý:
1. Tách prefix "sk-luna-"
2. SHA-256 hash raw key
3. Lookup trong SQLite table api_keys
4. Kiểm tra is_active
5. Set ctx.state.clientName
```

- Quản lý qua Dashboard → API Keys
- Mỗi key có client name, creation date, active status
- Key chỉ hiển thị 1 lần khi tạo (sau đó chỉ hiện suffix 4 chars)

### Lớp 2: Proxy Key — Fallback

```
Header: Authorization: Bearer <any-key>
Hoặc:   x-proxy-key: <any-key>

Server xử lý:
1. Đọc proxy.key từ config
2. So sánh trực tiếp với giá trị trong header
```

### Lớp 3: OAuth 2.0 — Cho Provider

```
Flow: /auth/start/:providerId → redirect → Qwen authorize
      /auth/callback/:providerId → exchange code → store token
```

### Fail-Open Logic

```
Không có proxy key VÀ không có API key nào active?
→ Cho phép truy cập tự do (open-access)
→ Phù hợp cho development / local use
```

---

## 🐳 Docker

### Docker Compose (khuyên dùng)

```bash
docker-compose up -d
```

### Docker thủ công

```bash
docker build -t luna-proxy .
docker run -p 8080:8080 -v luna-data:/app/data luna-proxy
```

### Docker features

- **Multi-stage build**: Builder stage + Production stage (image nhỏ hơn)
- **Health check**: `curl -f http://localhost:8080/health` mỗi 30s
- **Persistent volume**: `/app/data` cho SQLite DB, logs, overflow files
- **Environment variables**: `PORT`, `HOST`, `QWEN_AI_TOKEN`, `QWEN_AI_COOKIES`
- **Base image**: `node:24-slim`

---

## 🧪 Tests

```bash
# Chạy từng test file
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
npx ts-node tests/migrate.test.ts
npx ts-node tests/auth.test.ts
npx ts-node tests/integration.test.ts

# Smoke test (khởi động server + test endpoints)
npx ts-node tests/smoke.test.ts
```

| Test File | Coverage |
|-----------|----------|
| `contextCompactor.test.ts` | Context compaction logic |
| `infraModules.test.ts` | Infrastructure modules (rate limiter, fingerprint, etc.) |
| `phase5.test.ts` | Phase 5 features (session, overflow) |
| `responseSanitizer.test.ts` | Response sanitization rules |
| `retryPolicy.test.ts` | Retry logic on failures |
| `toolCallValidator.test.ts` | Tool call JSON validation & repair |
| `bufferedStreamParser.test.ts` | Buffered stream parsing |
| `nonStreamToolRounds.test.ts` | Non-stream tool call rounds |
| `logger.test.ts` | Structured logging |
| `database.test.ts` | SQLite CRUD operations |
| `configValidator.test.ts` | Config validation rules |
| `migrate.test.ts` | Data migration |
| `auth.test.ts` | API key & proxy key authentication |
| `integration.test.ts` | End-to-end integration |
| `smoke.test.ts` | Server startup & endpoint smoke test |

---

## 📁 Cấu trúc thư mục

```
Luna-Proxy/
├── README.md                          # Tài liệu này
├── STRUCTURE.md                       # Chi tiết cấu trúc code
├── PHASE_REPORT.md                    # Báo cáo phát triển theo phase
├── FINAL_PLAN.md                      # Kế hoạch phát triển cuối
├── USAGE_PLAN.md                      # Kế hoạch sử dụng
├── package.json                       # Dependencies & scripts
├── tsconfig.json                      # TypeScript config (backend)
├── Dockerfile                         # Docker multi-stage build
├── docker-compose.yml                 # Docker Compose config
├── .dockerignore                      # Docker ignore rules
│
├── src/                               # BACKEND SOURCE
│   ├── dev.ts                         # Entry point (development)
│   ├── index.ts                       # Package export surface
│   ├── server.ts                      # Main server (~2400 lines)
│   ├── configStore.ts                 # Config persistence (JSON + SQLite)
│   ├── sessionStore.ts                # Session persistence
│   │
│   ├── server/                        # Server modules
│   │   ├── types.ts                   # Shared types (ChatCompletionRequestBody, etc.)
│   │   ├── middleware.ts              # Auth, CORS, header utilities
│   │   └── routes.ts                  # API route registration (~650 lines)
│   │
│   ├── modules/                       # Feature modules (20+)
│   │   ├── database.ts                # SQLite storage (WAL mode, 6 tables)
│   │   ├── sqliteSessionAdapter.ts    # SQLite session adapter
│   │   ├── migrate.ts                 # Data migration helpers
│   │   ├── configValidator.ts         # Config validation on startup
│   │   ├── logger.ts                  # Structured logging (5 levels)
│   │   ├── rateLimiter.ts             # Per-account rate limiting
│   │   ├── responseSanitizer.ts       # Strip thinking, fix XML, dedupe
│   │   ├── streamWatchdog.ts          # Stream timeout protection
│   │   ├── retryPolicy.ts             # Auto retry on failure
│   │   ├── toolCallValidator.ts       # Validate/repair tool call JSON
│   │   ├── bufferedToolAccumulator.ts # Stream buffering & accumulation
│   │   ├── sseCollector.ts            # Collect non-stream SSE
│   │   ├── contextCompactor.ts        # Compact long conversations
│   │   ├── sessionCompactor.ts        # Session summarization
│   │   ├── sessionReset.ts            # Auto reset stale sessions
│   │   ├── sessionSnapshot.ts         # Session state snapshots
│   │   ├── sessionPersistence.ts      # Persist messages to store
│   │   ├── contextHash.ts             # Context hash computation
│   │   ├── fingerprintRotation.ts     # Browser fingerprint rotation
│   │   ├── workspaceScheduler.ts      # File locks & conflict detection
│   │   ├── gitContext.ts              # Auto inject git diff
│   │   ├── claudeCodeMode.ts          # Claude Code compatibility
│   │   ├── overflowPolicy.ts          # Token overflow handling
│   │   ├── textUtils.ts               # Token estimation
│   │   ├── asyncWriter.ts             # Async file writer
│   │   ├── chatCleanup.ts             # Qwen chat cleanup scheduler
│   │   ├── ossUploader.ts             # Qwen OSS file upload
│   │   ├── responseAnalyzer.ts        # Response XML inspection
│   │   ├── rollingSummary.ts          # Async rolling summary
│   │   ├── upstreamErrorHandler.ts    # Upstream error normalization
│   │   └── workers.ts                 # Worker registry
│   │
│   ├── runtime/                       # Runtime layer
│   │   ├── scheduler.ts               # Queueing & concurrency policies
│   │   ├── locks.ts                   # Lock management
│   │   ├── providerRouter.ts          # Provider/account selection
│   │   ├── providerFactory.ts         # Adapter construction
│   │   ├── runStore.ts                # Run persistence
│   │   ├── runControllers.ts          # Abort/cancel registry
│   │   ├── networkProfiles.ts         # Network profile management
│   │   ├── workerClient.ts            # Worker forwarding
│   │   ├── workerSelector.ts          # Worker selection
│   │   └── types.ts                   # Runtime type definitions
│   │
│   ├── main/                          # Proxy & provider layer
│   │   ├── proxy/
│   │   │   ├── adapters/qwen-ai.ts    # Qwen API client & stream handler
│   │   │   ├── anthropic.ts           # Anthropic format converter
│   │   │   ├── overflowSanitizer.ts   # Overflow text cleanup
│   │   │   ├── toolcall/toolcall.ts   # Tool prompt injection & parsing
│   │   │   ├── prompts/prompts.ts     # Runtime-editable prompts
│   │   │   └── ...                    # Other proxy utilities
│   │   ├── oauth/                     # OAuth credential capture
│   │   ├── providers/builtin/         # Built-in provider definitions
│   │   └── store/types.ts             # Provider/account types
│   │
│   ├── scripts/
│   │   └── generate-key.ts            # API key generation script
│   │
│   └── types/
│       └── node-sqlite.d.ts           # Node 24 SQLite type declarations
│
├── frontend/                          # FRONTEND SOURCE (React)
│   ├── index.html                     # HTML shell
│   ├── vite.config.ts                 # Vite build config
│   ├── tsconfig.json                  # TypeScript config
│   ├── DESIGN_GUIDELINES.md           # UI design guidelines
│   └── src/
│       ├── App.tsx                    # Router & route definitions
│       ├── main.tsx                   # React entry point
│       ├── styles.css                 # Global styles
│       ├── i18n.tsx                   # Internationalization (en/vi)
│       ├── components/
│       │   └── Layout.tsx             # Shared layout (sidebar + content)
│       ├── design/
│       │   └── tokens.ts              # Design tokens (colors, spacing)
│       └── pages/
│           ├── Dashboard.tsx           # Dashboard page
│           ├── Providers.tsx           # Provider management
│           ├── Models.tsx              # Model catalog
│           ├── Sessions.tsx            # Session management
│           ├── Runs.tsx                # Run history
│           ├── Analytics.tsx           # Usage analytics
│           ├── AnalyticsWindow.tsx     # Standalone analytics window
│           ├── Logs.tsx                # Request logs
│           ├── Settings.tsx            # Configuration
│           ├── Workspace.tsx           # Workspace management
│           ├── NetworkProfiles.tsx     # Network profiles
│           ├── ProxyPage.tsx           # Proxy status
│           └── ApiKeys.tsx             # API key management
│
├── public/                            # BUILT FRONTEND (served by backend)
│   ├── index.html
│   ├── styles.css
│   └── assets/
│       ├── index-D6w6AveW.js
│       └── proxy-luna-app.js
│
├── tests/                             # TEST FILES (293+ tests)
│   ├── utils.ts                       # Test harness helpers
│   ├── auth.test.ts                   # Authentication tests
│   ├── database.test.ts               # SQLite tests
│   ├── configValidator.test.ts        # Config validation tests
│   ├── contextCompactor.test.ts       # Context compaction tests
│   ├── infraModules.test.ts           # Infrastructure module tests
│   ├── phase5.test.ts                 # Phase 5 feature tests
│   ├── responseSanitizer.test.ts      # Response sanitizer tests
│   ├── retryPolicy.test.ts            # Retry policy tests
│   ├── toolCallValidator.test.ts      # Tool call validator tests
│   ├── bufferedStreamParser.test.ts   # Stream parser tests
│   ├── nonStreamToolRounds.test.ts    # Non-stream tool tests
│   ├── logger.test.ts                 # Logger tests
│   ├── migrate.test.ts                # Migration tests
│   ├── integration.test.ts            # Integration tests
│   ├── smoke.test.ts                  # Smoke tests
│   └── ...                            # Other test files
│
├── data/                              # RUNTIME DATA (auto-created)
│   ├── config.json                    # Config + logs (JSON fallback)
│   ├── luna-proxy.db                  # SQLite database
│   ├── sessions.json                  # Sessions (JSON fallback)
│   ├── runs.json                      # Runs (JSON fallback)
│   ├── wire-logs/                     # Raw wire logs
│   ├── overflow/                      # Overflow prompt files
│   └── compact/                       # Compacted session summaries
│
└── Resource/                          # Demo images
    ├── DemoClaudeCode.gif
    ├── DemoCline.gif
    └── SetupProvider.gif
```

---

## 📄 License

MIT