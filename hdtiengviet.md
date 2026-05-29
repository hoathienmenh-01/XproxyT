# Hướng Dẫn Sử Dụng Luna Proxy — Chi Tiết

---

## Mục lục

1. [Luna Proxy là gì?](#1-luna-proxy-là-gì)
2. [Cách hoạt động](#2-cách-hoạt-động)
3. [Cài đặt chi tiết](#3-cài-đặt-chi-tiết)
4. [Cấu hình](#4-cấu-hình)
5. [Sử dụng với các tool](#5-sử-dụng-với-các-tool)
6. [Dashboard quản lý](#6-dashboard-quản-lý)
7. [API Reference](#7-api-reference)
8. [Các tính năng nâng cao](#8-các-tính-năng-nâng-cao)
9. [Xử lý lỗi thường gặp](#9-xử-lý-lỗi-thường-gặp)
10. [Docker deployment](#10-docker-deployment)
11. [Kiến trúc hệ thống](#11-kiến-trúc-hệ-thống)

---

## 1. Luna Proxy là gì?

Luna Proxy là một **proxy gateway** trung gian, nhận request từ các AI coding tool (như Cline, Claude Code) theo chuẩn OpenAI API, rồi chuyển tiếp đến **Qwen AI** (model AI của Alibaba).

### Tại sao cần Luna Proxy?

- **Cline / Claude Code** chỉ hiểu OpenAI API format (`/v1/chat/completions`)
- **Qwen AI** có API riêng (không tương thích trực tiếp)
- Luna Proxy **chuyển đổi** giữa 2 format này một cách tự động
- Ngoài ra còn tối ưu: chống reasoning leak, repair tool calls, quản lý session...

### Hỗ trợ những gì?

| Client | Endpoint | Hỗ trợ |
|--------|----------|---------|
| **Cline (VS Code)** | `/v1/chat/completions` | ✅ Hoàn chỉnh |
| **Claude Code CLI** | `/v1/messages` (Anthropic) | ✅ Hoàn chỉnh |
| **OpenAI SDK** | `/v1/chat/completions` | ✅ Hoàn chỉnh |
| **curl / HTTP client** | Bất kỳ endpoint nào | ✅ |
| **Bất kỳ OpenAI-compatible client** | `/v1/chat/completions` | ✅ |

### Tính năng chính

- 🛡️ **Chống reasoning leak** — Tự động strip `<think>` blocks trước khi gửi về client
- 🔧 **Repair tool calls** — Sửa malformed JSON, fuzzy match tool names
- ⏱️ **Stream watchdog** — Tự abort stream nếu treo > 25 giây
- 🔄 **Auto retry** — Phân loại lỗi, exponential backoff
- 📦 **Buffered parser** — Ghép partial chunks, emit complete blocks only
- 🚫 **Non-stream tool rounds** — Tự dùng non-stream cho tool calls (giảm 90% lỗi)
- 📊 **Rate limiting** — 30 req/min per account, chống abuse
- 🎭 **Fingerprint rotation** — Random browser headers, chống detect
- 🗄️ **Session management** — Auto-create, compact, reset, snapshot
- 📝 **Context compaction** — Tự nén context khi quá dài
- 🌿 **Git context** — Tự inject git diff vào system prompt
- 🔒 **Workspace locks** — Chống conflict khi nhiều tab cùng edit file
- 📊 **Structured logging** — JSON logs, correlation IDs, redact secrets
- 🗃️ **SQLite storage** — WAL mode, sẵn sàng (cần bật thủ công)

---

## 2. Cách hoạt động

### Luồng request cơ bản

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Cline /     │────▶│  Luna Proxy  │────▶│  Qwen AI    │
│  Claude Code │◀────│  localhost    │◀────│  chat.qwen  │
│  OpenAI SDK  │     │  :8080       │     │  .ai        │
└─────────────┘     └──────────────┘     └─────────────┘
     Client              Proxy               Upstream
```

### Chi tiết từng bước

**Bước 1: Client gửi request**
```
POST http://localhost:8080/v1/chat/completions
{
  "model": "qwen3-coder-plus",
  "messages": [{"role": "user", "content": "Write hello world"}],
  "stream": true
}
```

**Bước 2: Luna Proxy xử lý**
1. **Xác thực** — Kiểm tra proxy key (nếu có)
2. **Chọn provider** — Chọn Qwen AI account
3. **Rate limit** — Kiểm tra giới hạn request
4. **Session management** — Gắn session ID, load context cũ
5. **Context compaction** — Nén context nếu quá dài
6. **Token overflow** — Upload file nếu token quá lớn
7. **Tool prompt injection** — Inject tool coercion rules
8. **Non-stream detection** — Nếu có tool calls → dùng non-stream
9. **Gửi lên Qwen AI** — Chuyển đổi format, gọi upstream

**Bước 3: Xử lý response từ Qwen AI**
1. **Watchdog** — Theo dõi stream, abort nếu treo
2. **Buffered parser** — Ghép partial chunks
3. **Sanitizer** — Strip reasoning leak, remove duplicate, auto-close XML
4. **Tool call validator** — Validate/repair tool calls
5. **Emit về client** — Gửi SSE chunks về client

**Bước 4: Lưu session**
1. Lưu messages vào session store
2. Cập nhật context hash
3. Release workspace locks
4. Ghi log request

### Stream vs Non-stream

| Mode | Khi nào dùng | Ưu điểm | Nhược điểm |
|------|--------------|----------|------------|
| **Stream** (mặc định) | Câu trả lời thường | Real-time, UX tốt | Có thể parser lỗi |
| **Non-stream** | Tool call rounds | Ổn định, ít lỗi | Chậm hơn một chút |

Luna Proxy **tự động chọn non-stream** khi phát hiện tool call round (Phase 10).

---

## 3. Cài đặt chi tiết

### Yêu cầu hệ thống

- **Node.js** 18+ (khuyến nghị 22+)
- **npm** hoặc **bun**
- **OS**: Windows, macOS, Linux

### Bước 1: Clone dự án

```bash
git clone <repo-url>
cd Luna-Proxy-main
```

### Bước 2: Cài dependencies

```bash
npm install
```

Output mong đợi:
```
added 268 packages in 43s
```

### Bước 3: Lấy Qwen AI Token

**Cách A: Dùng OAuth (khuyến nghị)**

1. Khởi động server: `npx ts-node src/dev.ts`
2. Mở trình duyệt: `http://localhost:8080`
3. Vào trang **Providers** → nhấn **Start OAuth**
4. Đăng nhập Qwen AI trong cửa sổ popup
5. Token tự capture và lưu

**Cách B: Lấy thủ công từ browser**

1. Mở `https://chat.qwen.ai` và đăng nhập
2. Mở DevTools (F12) → Application → Local Storage
3. Tìm key `token` → copy giá trị
4. Mở Application → Cookies → copy toàn bộ cookie string

**Cách C: Dùng environment variables**

```bash
# Windows CMD
set QWEN_AI_TOKEN=tongyi_sso_ticket_abc123
set QWEN_AI_COOKIES=cna=xxx; token=xxx; xlly_s=xxx

# Windows PowerShell
$env:QWEN_AI_TOKEN="tongyi_sso_ticket_abc123"
$env:QWEN_AI_COOKIES="cna=xxx; token=xxx"

# Linux/Mac
export QWEN_AI_TOKEN=tongyi_sso_ticket_abc123
export QWEN_AI_COOKIES="cna=xxx; token=xxx"
```

**Cách D: Dùng API**

```bash
curl -X POST http://localhost:8080/api/provider/token \
  -H "Content-Type: application/json" \
  -d '{"providerId": "qwen-ai", "token": "your_token_here"}'
```

### Bước 4: Khởi động server

```bash
# Cách 1: ts-node (khuyến nghị)
npx ts-node src/dev.ts

# Cách 2: bun (nhanh hơn)
bun src/dev.ts

# Cách 3: npm script (nếu có)
npm run dev
```

Output mong đợi:
```
[ConfigValidator] Config validated OK {"providers":1,"sessionEnabled":true}
[SimpleProxyServer] serving static from C:\...\public
qwen-provider proxy listening on 127.0.0.1:8080
```

### Bước 5: Kiểm tra server hoạt động

```bash
# Health check
curl http://localhost:8080/health

# Kết quả mong đợi:
# {"status":"ok","version":"0.1.0","uptime":5,"activeSessions":0,"activeRuns":0,...}
```

### Bước 6: Gửi test request

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Say hello in Vietnamese"}],
    "stream": false
  }'
```

---

## 4. Cấu hình

### File cấu hình

Cấu hình tự tạo tại `data/config.json` khi chạy lần đầu. Có thể chỉnh sửa qua:
- Dashboard UI → Settings
- API: `POST /api/config`
- Trực tiếp file `data/config.json`

### Các setting quan trọng

```json
{
  "proxy": {
    "host": "127.0.0.1",
    "port": 8080,
    "key": ""
  },
  "providers": [
    {
      "id": "qwen-ai",
      "credentials": {
        "token": "your_token",
        "cookies": "your_cookies"
      }
    }
  ],
  "settings": {
    "session": {
      "enabled": true,
      "rollingHistoryK": 10,
      "compactAfterMessages": 40,
      "compactKeepRecent": 5
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
      "globalMaxConcurrentRuns": 20,
      "queueTimeoutMs": 120000
    },
    "egressIsolation": {
      "enabled": false
    },
    "ui": {
      "language": "vi"
    }
  }
}
```

### Giải thích từng setting

#### `proxy.key` — Proxy Key (bảo mật)
- Nếu để trống: ai cũng gọi được API
- Nếu set: mọi request phải có `Authorization: Bearer <key>`

#### `session.enabled` — Bật session memory
- `true`: Tự động quản lý conversation context
- `false`: Stateless, mỗi request độc lập

#### `session.rollingHistoryK` — Số messages giữ lại
- Giữ N messages gần nhất trong context
- Cũ hơn → nén thành summary

#### `session.compactAfterMessages` — Auto-compact threshold
- Khi messages > N → tự động nén context
- Giữ `compactKeepRecent` messages gần nhất

#### `tokenLimits.maxInputTokens` — Giới hạn input
- Nếu input > limit → trả lỗi 400
- Nếu gần limit → warning log

#### `tokenOverflow.enabled` — Bật overflow file
- Khi context quá dài → upload file thay vì gửi inline
- `threshold`: ngưỡng token để trigger overflow

#### `multiThread.globalMaxConcurrentRuns` — Concurrent requests
- Số request đồng thời tối đa toàn server

### Ngôn ngữ UI

```json
{ "settings": { "ui": { "language": "vi" } } }
```
- `"vi"`: Tiếng Việt
- `"en"`: English

---

## 5. Sử dụng với các tool

### Cline (VS Code Extension)

1. Mở VS Code → Cline extension
2. Vào **Settings** (biểu tượng bánh răng)
3. Cấu hình:
   - **API Provider**: `OpenAI Compatible`
   - **Base URL**: `http://localhost:8080`
   - **API Key**: để trống hoặc nhập proxy key
   - **Model**: `qwen3-coder-plus`
4. Nhấn **Done**
5. Sử dụng Cline bình thường

**Lưu ý:**
- Cline sẽ gửi tool calls → Luna Proxy tự repair nếu malformed
- Reasoning leak được strip tự động
- Non-stream mode cho tool rounds (ổn định hơn)

### Claude Code CLI

```bash
# Set environment
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_API_KEY=any-key

# Sử dụng
claude "write a fibonacci function in Python"
claude "fix the bug in main.ts"
```

**Lưu ý:**
- Claude Code gửi Anthropic format → Luna Proxy convert sang Qwen format
- Response convert ngược lại Anthropic format
- Tool calls được handle tự động

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="any-key"  # hoặc proxy key
)

# Chat completion
response = client.chat.completions.create(
    model="qwen3-coder-plus",
    messages=[
        {"role": "system", "content": "You are a helpful coding assistant."},
        {"role": "user", "content": "Write a Python function to sort a list"}
    ],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### OpenAI Node.js SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:8080/v1',
  apiKey: 'any-key'
});

const response = await client.chat.completions.create({
  model: 'qwen3-coder-plus',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response.choices[0].message.content);
```

### curl

```bash
# Non-stream
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'

# Stream
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Với tool calls
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Read the file main.ts"}],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "read_file",
          "description": "Read a file",
          "parameters": {
            "type": "object",
            "properties": {
              "path": {"type": "string"}
            },
            "required": ["path"]
          }
        }
      }
    ],
    "stream": false
  }'
```

---

## 6. Dashboard quản lý

Mở `http://localhost:8080` trong trình duyệt.

### Trang Dashboard (Tổng quan)

Hiển thị:
- **Proxy Health**: Trạng thái server (online/offline), uptime, RAM
- **Active Runs**: Số request đang xử lý, live sessions
- **Configured Providers**: Số nhà cung cấp đã cấu hình
- **Recent Requests**: Bảng log request gần đây
- **Runtime Scheduler**: Active runs, locks, queued requests

### Trang Providers

- Quản lý Qwen AI token/cookie
- OAuth login (1-click)
- Validate token
- Xem provider status (alive/dead)

### Trang Models

- Xem catalog models của Qwen AI
- Refresh catalog
- Danh sách models: qwen3-coder-plus, qwen3.7-max-preview, etc.

### Trang Sessions

- Danh sách tất cả sessions
- Chi tiết session: messages, context hash, turn count
- Actions: Clear, Compact, Rename, Reset Provider, Delete
- Session diagnostics

### Trang Runs

- Lịch sử request runs
- Chi tiết: provider, account, model, status, duration
- Cancel running requests

### Trang Workspace

- File locks: file đang được session nào edit
- Git status: branch, dirty files, ahead/behind
- Conflict detection
- Cleanup expired locks

### Trang Logs

- Request logs với filter theo level
- Chi tiết: headers, response, prompt, duration
- Clear logs

### Trang Analytics (Phân tích)

Trang Analytics hiển thị thống kê sử dụng proxy theo thời gian thực.

**Truy cập:**
- `http://localhost:8080/analytics` — Trong layout chính (có sidebar)
- `http://localhost:8080/analytics-window` — Cửa sổ riêng biệt (không sidebar)

**Các thẻ metric chính:**
- **Total Requests**: Tổng số request, bao gồm số thành công và thất bại
- **Avg Latency**: Thời gian phản hồi trung bình mỗi request
- **Success Rate**: Tỷ lệ request thành công (%)
- **Streaming**: Số request dùng stream mode

**Phần Token Usage (Sử dụng Token):**
- **Input Tokens**: Số token đầu vào (prompt) — lấy từ `response.usage` của API
- **Output Tokens**: Số token đầu ra (completion)
- **Total Tokens**: Tổng cả input + output
- **Est. Cost**: Chi phí ước tính dựa trên giá Qwen ($0.50/M input, $1.50/M output)
- **Thanh tỷ lệ**: Hiển thị tỷ lệ Input/Output visually

**Biểu đồ:**
- **Requests by Model**: Thanh bar hiển thị số request theo từng model
- **Requests per Hour**: Sparkline chart hiển thị request/giờ trong 24h qua, kèm thống kê Peak/Avg/Hours
- **Error Breakdown**: Thanh bar hiển thị lỗi theo loại (chỉ hiện khi có lỗi)

**Tự động refresh:** Mỗi 5 giây (trang trong sidebar) hoặc 3 giây (cửa sổ riêng)

### Trang Test Model (Kiểm thử Model)

Phần Test Model cho phép kiểm tra nhanh xem một model có hoạt động không.

**Cách sử dụng:**
1. Vào trang **Analytics** (`/analytics`)
2. Cuộn xuống phần **Test Model**
3. Chọn model từ dropdown (hiển thị các model đã dùng gần đây) **hoặc** nhập tên model tùy chỉnh
4. Nhấn **⚡ Run Test**
5. Đợi kết quả (thường 2-5 giây)

**Kết quả hiển thị khi model hoạt động:**
- ✅ **Model is working** — Xác nhận model phản hồi
- **Latency**: Thời gian phản hồi (giây)
- **Input Tokens**: Số token đầu vào thực tế
- **Output Tokens**: Số token đầu ra thực tế
- **Total Tokens**: Tổng token
- **Response**: Nội dung model trả về (tối đa 200 ký tự)

**Khi có lỗi:**
- ❌ Hiển thị thông báo lỗi chi tiết (ví dụ: "Provider not configured", "Rate limit exceeded")

**Ví dụ test qua API:**
```bash
# Test model qwen3-coder-plus
curl -X POST http://localhost:8080/api/test-model \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3-coder-plus"}'

# Kết quả:
# {
#   "ok": true,
#   "model": "qwen3-coder-plus",
#   "response": "OK",
#   "usage": {"prompt_tokens": 58, "completion_tokens": 1, "total_tokens": 59},
#   "durationMs": 2001
# }
```

### Trang Settings

- **Language**: Tiếng Việt / English
- **Token Overflow**: Bật/tắt, threshold
- **Session Memory**: enabled, history limit, auto-compact
- **Multi-thread**: concurrent runs, queue timeout
- **Egress Isolation**: IP isolation cho workers
- **Token Limits**: max input/output tokens

---

## 7. API Reference

### Chat Completion (OpenAI-compatible)

```
POST /v1/chat/completions
```

**Request body:**
```json
{
  "model": "qwen3-coder-plus",
  "messages": [
    {"role": "system", "content": "You are helpful"},
    {"role": "user", "content": "Hello"}
  ],
  "stream": true,
  "tools": [...],
  "tool_choice": "auto",
  "max_tokens": 8192,
  "temperature": 0.7,
  "enable_thinking": true,
  "reasoning_effort": "low"
}
```

**Response headers:**
- `x-luna-session-id`: Session ID
- `x-luna-trace-id`: Request trace ID
- `x-luna-provider-session-id`: Qwen chat ID

### Messages (Anthropic-compatible)

```
POST /v1/messages
```

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 3600,
  "uptimeHuman": "1h 0m 0s",
  "activeSessions": 3,
  "activeRuns": 1,
  "memory": {
    "rss": "150MB",
    "heapUsed": "80MB"
  },
  "timestamp": "2026-05-29T00:00:00.000Z"
}
```

### Models

```
GET /v1/models
```

### Config

```
GET /api/config
POST /api/config
```

### Sessions

```
GET /api/sessions                    # List all
GET /api/sessions/:id                # Get detail
DELETE /api/sessions/:id             # Delete
POST /api/sessions/:id/clear         # Clear history
POST /api/sessions/:id/compact       # Compact context
POST /api/sessions/:id/rename        # Rename
POST /api/sessions/:id/reset-provider # Reset upstream chat
GET /api/sessions/diagnostics        # Diagnostics
```

### Runs

```
GET /api/runs                        # List all
GET /api/runs/:id                    # Get detail
DELETE /api/runs/:id                 # Delete
POST /api/runs/:id/cancel            # Cancel running
```

### Runtime

```
GET /api/runtime                     # Active runs, workers, locks
GET /api/provider-runtime            # Config, locks, active runs
```

### Workspace

```
GET /api/workspace/diagnostics       # File locks, sessions, hot files
POST /api/workspace/cleanup-locks    # Cleanup expired locks
GET /api/workspace/git-status        # Git branch, dirty files
```

### Logs & Analytics

```
GET /api/logs?limit=200              # Get logs
GET /api/logs/stats                  # Log statistics
DELETE /api/logs                     # Clear all logs
GET /api/usage                       # Usage analytics (tokens, cost, models, errors)
POST /api/test-model                 # Test a model (body: {"model": "qwen3-coder-plus"})
```

**GET /api/usage Response:**
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

**POST /api/test-model Response:**
```json
{
  "ok": true,
  "model": "qwen3-coder-plus",
  "response": "OK",
  "usage": {"prompt_tokens": 58, "completion_tokens": 1, "total_tokens": 59},
  "durationMs": 2001,
  "chatId": "2e03366b-..."
}
```

### Provider

```
POST /api/provider/token             # Set token
POST /api/provider/validate          # Validate credentials
GET /api/provider/status             # Check status
POST /api/provider/oauth/capture     # OAuth capture
```

---

## 8. Các tính năng nâng cao

### Auto Session Management

Luna Proxy tự động quản lý conversation context:

1. **Context Hash**: Mỗi request được hash → nếu trùng → dùng session cũ
2. **Compaction**: Khi messages > 40 → tự nén, giữ 5 messages gần nhất
3. **Snapshot**: Inject active task + recent errors vào system prompt
4. **Auto Reset**: Session stale > 24h hoặc retry storm → tự reset

### Tool Call Handling

Khi model trả về tool calls:

1. **Detection**: Detect XML format (`<ml_tool_calls>`, `<tool_calls>`, `[function_calls]`)
2. **Buffering**: Buffered parser hold back partial markers
3. **Validation**: Validate JSON, repair malformed arguments
4. **Fuzzy Match**: Fix tool name typpy (case-insensitive)
5. **Emit**: Emit complete tool_calls response

### Rate Limiting

- **Per-account**: 30 requests/phút, 3 concurrent
- **Global**: 100 requests/phút
- **429 cooldown**: 30 giây khi upstream trả 429
- **Configurable**: Điều chỉnh qua Settings

### Fingerprint Rotation

Mỗi 5 requests, Luna Proxy random:
- Chrome version (13 versions)
- Platform (Linux/Windows/Mac)
- User-Agent string
- bx-umidtoken, bx-ua headers

Mục đích: tránh Qwen detect proxy và block.

### Token Overflow

Khi context > 10,000 tokens:
1. Upload nội dung dài lên Qwen AI (như file attachment)
2. Thay thế messages bằng reference đến file
3. Giảm đáng kể token usage

### Git Context Injection

Tự động detect git repo và inject vào system prompt:
- Branch hiện tại
- Dirty files (modified, added, deleted)
- Git diff gần đây
- Last commit message

---

## 9. Xử lý lỗi thường gặp

### "Token/cookies not configured"

```
Lỗi: Token/cookies not configured for account "xxx"
```

**Giải pháp:**
1. Vào Dashboard → Providers → nhập token
2. Hoặc set environment: `set QWEN_AI_TOKEN=xxx`
3. Restart server

### "Rate limit exceeded"

```
Lỗi: Rate limit exceeded (429)
```

**Giải pháp:**
1. Đợi 30 giây rồi thử lại
2. Hoặc tăng limit trong Settings → Multi-thread
3. Thêm nhiều accounts để load balance

### "Chat is in progress"

```
Lỗi: The chat is in progress
```

**Giải pháp:**
- Luna Proxy **tự xử lý**: tạo chat mới và retry
- Nếu vẫn lỗi: vào Sessions → Reset Provider cho session đó

### Stream treo / không response

**Giải pháp:**
- Luna Proxy có **watchdog 25s**: tự abort nếu stream treo
- Nếu vẫn gặp: refresh client, thử lại

### Tool calls malformed

**Giải pháp:**
- Luna Proxy **tự repair**: JSON fix, name fuzzy match
- Nếu vẫn lỗi: kiểm tra logs trong Dashboard → Logs

### Context quá dài

```
Lỗi: context_length_exceeded
```

**Giải pháp:**
1. Vào Sessions → Compact session
2. Hoặc Settings → giảm `rollingHistoryK`
3. Hoặc Settings → bật `tokenOverflow`

---

## 10. Docker deployment

### Build và chạy

```bash
# Cách 1: docker-compose (khuyến nghị)
docker-compose up -d

# Cách 2: Docker manual
docker build -t luna-proxy .
docker run -d \
  -p 8080:8080 \
  -v luna-data:/app/data \
  -e QWEN_AI_TOKEN=your_token \
  --name luna-proxy \
  luna-proxy
```

### Docker compose với environment

```bash
# Tạo file .env
echo "QWEN_AI_TOKEN=your_token" > .env
echo "QWEN_AI_COOKIES=your_cookies" >> .env

# Chạy
docker-compose up -d
```

### Quản lý

```bash
# Xem logs
docker-compose logs -f

# Dừng
docker-compose down

# Restart
docker-compose restart

# Update
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Volume

Data được lưu trong Docker volume `luna-data`:
- `data/config.json` — Cấu hình
- `data/sessions.json` — Sessions
- `data/wire-logs/` — Wire logs
- `data/overflow/` — Overflow files

---

## 11. Kiến trúc hệ thống

### Tổng quan

```
src/
├── server.ts                 # Main server — request handling, routing
├── dev.ts                    # Entry point + graceful shutdown
├── sessionStore.ts           # Session storage (JSON/SQLite)
├── configStore.ts            # Config storage (JSON/SQLite)
│
├── modules/                  # 20 functional modules
│   ├── responseSanitizer.ts  # Strip reasoning, dedup, leaks
│   ├── streamWatchdog.ts     # 25s idle timeout
│   ├── retryPolicy.ts        # Error classification + backoff
│   ├── toolCallValidator.ts  # Validate/repair tool calls
│   ├── bufferedToolAccumulator.ts  # Buffered stream parser
│   ├── contextCompactor.ts   # Smart context compression
│   ├── sessionReset.ts       # Auto session reset
│   ├── sessionSnapshot.ts    # Session snapshot injection
│   ├── workspaceScheduler.ts # File locks, conflict detection
│   ├── gitContext.ts         # Git diff injection
│   ├── claudeCodeMode.ts     # Claude Code auto-config
│   ├── rateLimiter.ts        # Per-account rate limiting
│   ├── fingerprintRotation.ts # Random browser headers
│   ├── logger.ts             # Structured logging
│   ├── database.ts           # SQLite storage
│   ├── configValidator.ts    # Config validation
│   ├── migrate.ts            # JSON → SQLite migration
│   ├── sqliteSessionAdapter.ts # SQLite session backend
│   └── asyncWriter.ts        # Async file I/O
│
├── server/                   # Extracted server modules
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── middleware.ts         # CORS, header masking
│   └── routes.ts             # API route registration
│
├── main/
│   └── proxy/
│       └── adapters/
│           └── qwen-ai.ts   # Qwen AI adapter (core)
│
└── types/
    └── node-sqlite.d.ts     # Node 24 SQLite types
```

### Request Flow

```
Client Request
    │
    ▼
┌──────────────────┐
│ Trace ID Middleware │ ← x-luna-trace-id
├──────────────────┤
│ Error Handler     │ ← Global try/catch
├──────────────────┤
│ CORS Middleware    │ ← Access-Control headers
├──────────────────┤
│ Body Parser       │ ← JSON 10MB limit
├──────────────────┤
│ Route Handler     │
│   ├─ Auth check   │ ← Proxy key validation
│   ├─ Rate limit   │ ← Per-account + global
│   ├─ Session mgmt │ ← Context hash, load history
│   ├─ Compact      │ ← Auto-compact if > 40 msgs
│   ├─ Snapshot     │ ← Inject active task + errors
│   ├─ Git context  │ ← Inject git diff
│   ├─ Tool inject  │ ← 10-rule coercion prompt
│   ├─ Token guard  │ ← Input size validation
│   └─ Send upstream│ ← Qwen AI API call
├──────────────────┤
│ Response Handler  │
│   ├─ Watchdog     │ ← 25s idle timeout
│   ├─ Buffered parse│ ← Ghép partial chunks
│   ├─ Sanitizer    │ ← Strip reasoning, leaks
│   ├─ Validator    │ ← Repair tool calls
│   └─ Emit to client│ ← SSE stream
└──────────────────┘
```

---

## Mẹo sử dụng

1. **Model tốt nhất cho coding**: `qwen3-coder-plus` (1M context)
2. **Tránh reasoning leak**: Set `reasoning_effort: low` hoặc `none`
3. **Nếu tool calls hay lỗi**: Kiểm tra Dashboard → Logs để debug
4. **Nếu context hay overflow**: Giảm `rollingHistoryK` xuống 5
5. **Nếu server chậm**: Tăng `globalMaxConcurrentRuns`
6. **Nếu muốn xem chi tiết**: Dashboard → Logs → filter theo level