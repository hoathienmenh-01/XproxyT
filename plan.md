# Luna-Proxy Phase 9–14 Implementation Plan

**Ngày tạo:** 2026-05-29
**Nguyên tắc:** Mỗi phase phải PASS tất cả tests trước khi sang phase tiếp theo.
**Trạng thái hiện tại:** 15/15 modules wired, 183/183 tests pass

---

## PHASE 9 — Buffered Stream Parser Rewrite 🔴 Priority

### Mục tiêu
Thay thế chunk-level parsing bằng buffered incremental parser để giảm malformed tool calls.

### Tasks
- [x] 9.1 Refactor `bufferedToolAccumulator.ts` thành full buffered stream parser
  - [x] Implement `BufferedStreamParser` class
  - [x] Chunk stitching: ghép partial chunks trước khi parse
  - [x] Complete-block detection: KHÔNG emit cho đến khi tag/JSON/block complete
  - [x] Support: `<ml_tool_calls>`, `<tool_calls>`, `[function_calls]`, JSON envelope
  - [x] Partial marker holdback logic
- [x] 9.2 Tích hợp vào `qwen-ai.ts` handleStream()
  - [x] Import `BufferedStreamParser` vào qwen-ai.ts
  - [x] Initialize `bufferState` in handleStream()
  - [ ] Full stream refactor (future: replace chunk-level parser completely)
- [x] 9.3 Viết tests
  - [x] Test chunk stitching (partial `<ml_tool_calls` + `>` ghép lại)
  - [x] Test complete block detection (đủ close tag mới emit)
  - [x] Test mixed content (text + tool calls xen kẽ)
  - [x] Test partial marker holdback (không emit `<ml` nếu có thể là `<ml_tool_calls`)
  - [x] Test edge cases: empty chunks, unicode, nested XML
  - [x] Run: `npx ts-node tests/bufferedStreamParser.test.ts` — 27/27 PASS

### Test Checkpoint
```bash
npx ts-node tests/bufferedStreamParser.test.ts
# Expected: ALL tests pass
```

---

## PHASE 10 — Non-stream Tool Rounds 🔴 Priority

### Mục tiêu
Bật `stream=false` cho tool-call rounds để giảm 90% parser issues.

### Tasks
- [x] 10.1 Cập nhật `claudeCodeMode.ts`
  - [x] Default `nonStreamTools: true`
  - [x] Config option `streamToolRounds` via claudeCodeMode settings
- [x] 10.2 `server.ts` already uses `shouldUseNonStream()` detection
  - [x] Detect tool-call round: messages có tool results + assistant có tool_calls
  - [x] Log `[Server] Claude Code mode: forcing non-stream for tool-call round`
- [x] 10.3 Non-stream path in `qwen-ai.ts` already applies sanitizer
  - [x] `handleNonStream()` returns tool_calls with `validateToolCalls()` via `sendToolCalls()`
  - [x] `sanitizeFullResponse()` applied in answer phase
- [x] 10.4 Viết tests
  - [x] Test `shouldUseNonStream()` with 8 message patterns
  - [x] Test default nonStreamTools is true
  - [x] Run: `npx ts-node tests/nonStreamToolRounds.test.ts` — 11/11 PASS
  - [x] Backward compat: `npx ts-node tests/phase5.test.ts` — 51/51 PASS

### Test Checkpoint
```bash
npx ts-node tests/nonStreamToolRounds.test.ts
npx ts-node tests/phase5.test.ts  # backward compat
# Expected: ALL tests pass
```

---

## PHASE 11 — Remove @ts-nocheck & Type Safety 🟡 Priority

### Mục tiêu
Loại bỏ `@ts-nocheck`, fix type errors, tách server.ts thành modules nhỏ hơn.

### Tasks
- [ ] 11.1 Tách `server.ts` (hiện ~2600 lines)
  - [ ] `src/server/routes.ts` — API route definitions
  - [ ] `src/server/handlers.ts` — Chat completion handler logic
  - [ ] `src/server/middleware.ts` — Auth, CORS, rate limit middleware
  - [ ] `src/server/index.ts` — Server bootstrap + wiring
- [ ] 11.2 Fix type errors trong route handlers
  - [ ] Thêm proper types cho request/response bodies
  - [ ] Fix `ctx.request.body as any` → proper type guards
  - [ ] Fix implicit any trong message processing
- [ ] 11.3 Fix type errors trong `qwen-ai.ts`
  - [ ] Thêm `@types/node` dependency
  - [ ] Fix `Buffer`, `NodeJS` type references
  - [ ] Fix `this as any` casts → proper typing
- [ ] 11.4 Bật TypeScript strict mode (từng bước)
  - [ ] `noImplicitAny: true` → fix errors
  - [ ] `strictNullChecks: true` → fix errors
  - [ ] Verify: `npx tsc -p tsconfig.json --noEmit`
- [ ] 11.5 Viết tests
  - [ ] Test type guards cho request validation
  - [ ] Test route handler error paths
  - [ ] Run: `npx tsc -p tsconfig.json --noEmit`
  - [ ] Run: `npx ts-node tests/contextCompactor.test.ts` (backward compat)

### Test Checkpoint
```bash
npx tsc -p tsconfig.json --noEmit
# Expected: 0 type errors
npx ts-node tests/contextCompactor.test.ts
npx ts-node tests/infraModules.test.ts
npx ts-node tests/phase5.test.ts
# Expected: ALL tests pass (183+)
```

---

## PHASE 12 — Structured Logging 🟡 Priority

### Mục tiêu
Thay console.log bằng structured logging với levels, request tracing, correlation IDs.

### Tasks
- [x] 12.1 Tạo `src/modules/logger.ts`
  - [ ] Logger class với levels: debug/info/warn/error/fatal
  - [ ] JSON output format
  - [ ] Request correlation IDs (trace ID per request)
  - [ ] Context injection: sessionId, runId, providerId
  - [ ] Redaction: sensitive fields (token, cookies, Authorization)
  - [ ] Performance: async buffering, batch flush
- [ ] 12.2 Thay console.log trong các files chính
  - [ ] `server.ts` — request/response logs
  - [ ] `qwen-ai.ts` — adapter logs (wire debug, stream events)
  - [ ] Modules: watchdog, sanitizer, validator, rate limiter
- [ ] 12.3 Log output destinations
  - [ ] Console (stdout) cho dev mode
  - [ ] File rotation cho production (`data/logs/`)
  - [ ] Config: log level, output format, rotation policy
- [x] 12.4 Viết tests
  - [x] Test log levels filtering
  - [x] Test correlation ID propagation
  - [x] Test sensitive field redaction
  - [x] Test async buffer flush
  - [x] Run: `npx ts-node tests/logger.test.ts` — 15/15 PASS

### Test Checkpoint
```bash
npx ts-node tests/logger.test.ts
# Expected: ALL tests pass
npx ts-node tests/contextCompactor.test.ts  # backward compat
# Expected: ALL tests pass
```

---

## PHASE 13 — SQLite Storage 🟢 Priority

### Mục tiêu
Thay JSON files bằng SQLite + WAL để atomic writes, concurrency tốt hơn.

### Tasks
- [x] 13.1 Setup SQLite
  - [x] Use Node.js built-in `node:sqlite` (Node 24+) — no external dependency
  - [x] Tạo `src/modules/database.ts` — SQLite connection manager
  - [x] Schema: sessions, runs, config, logs, rate_limits (5 tables)
- [ ] 13.2 Migration từ JSON
  - [ ] Tạo migration script: `src/modules/migrate.ts`
  - [ ] `sessions.json` → SQLite sessions table
  - [ ] `config.json` → SQLite config table
  - [ ] Logs → SQLite logs table (với auto-rotation)
- [ ] 13.3 Refactor stores
  - [ ] `sessionStore.ts` → SQLite backend
  - [ ] `configStore.ts` → SQLite backend
  - [ ] `runStore.ts` → SQLite backend
  - [ ] Preserve API compatibility (same function signatures)
- [ ] 13.4 Performance
  - [ ] WAL mode cho concurrent reads
  - [ ] Prepared statements cho hot paths
  - [ ] Connection pooling
  - [ ] Index optimization
- [x] 13.5 Viết tests
  - [x] Test CRUD operations cho mỗi table
  - [x] Test config helpers (get/set/getAll)
  - [x] Test log helpers (insert/get/clear/stats)
  - [x] Test diagnostics (tables, rowCounts, WAL mode)
  - [x] Run: `npx ts-node tests/database.test.ts` — 18/18 PASS

### Test Checkpoint
```bash
npx ts-node tests/database.test.ts
# Expected: ALL tests pass
npx ts-node tests/sessionStore.test.ts  # backward compat
# Expected: ALL tests pass
```

---

## PHASE 14 — Frontend Dashboard 🟢 Priority

### Mục tiêu
Nâng cấp UI thành dashboard đầy đủ cho monitoring và management.

### Tasks
- [ ] 14.1 Session Viewer
  - [ ] Danh sách sessions với health status indicators
  - [ ] Chi tiết session: messages, context hash, turn count
  - [ ] Session health: compaction status, reset triggers
  - [ ] Actions: clear, compact, reset provider, delete
- [ ] 14.2 Workspace Diagnostics Dashboard
  - [ ] Workspace lock status (hot files, active locks)
  - [ ] Git status display (branch, dirty files, diffs)
  - [ ] Conflict detection alerts
  - [ ] Cleanup controls
- [ ] 14.3 Real-time Stream Monitor
  - [ ] Active runs display với live status
  - [ ] Stream health indicators (watchdog status)
  - [ ] Rate limiter status per account
  - [ ] Error rate charts
- [ ] 14.4 Configuration UI
  - [ ] Session config editor (rollingHistoryK, compaction thresholds)
  - [ ] Rate limiter config editor
  - [ ] Claude Code mode toggle
  - [ ] Provider config management
- [ ] 14.5 Viết tests
  - [ ] API endpoint integration tests
  - [ ] Run frontend build: `cd frontend && npm run build`
  - [ ] Manual UI testing checklist

### Test Checkpoint
```bash
cd frontend && npm run build
# Expected: build succeeds, 0 errors
npx ts-node tests/contextCompactor.test.ts  # backward compat
# Expected: ALL tests pass
```

---

## Test Strategy

### Trước mỗi phase:
1. Chạy TẤT CẢ tests hiện có: `npx ts-node tests/*.test.ts`
2. Verify baseline: 183/183 pass
3. Backup branch: `git checkout -b phase-N`

### Trong mỗi phase:
1. Viết tests TRƯỚC khi implement (TDD approach)
2. Run tests sau mỗi task
3. Fix failures ngay lập tức

### Sau mỗi phase:
1. Run toàn bộ test suite
2. Verify backward compatibility
3. Cập nhật PHASE_REPORT.md với kết quả
4. Commit: `git commit -m "Phase N: [description] - X/X tests pass"`

---

## Timeline ước tính

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| Phase 9 — Buffered Parser | 3-5 ngày | None |
| Phase 10 — Non-stream Tools | 1-2 ngày | Phase 9 |
| Phase 11 — Type Safety | 2-3 ngày | None |
| Phase 12 — Logging | 2-3 ngày | Phase 11 |
| Phase 13 — SQLite | 3-5 ngày | Phase 11 |
| Phase 14 — Dashboard | 3-5 ngày | Phase 12, 13 |

**Tổng ước tính:** 14-23 ngày

---

# PHASE 15–20 — Giai đoạn Wiring & Production

## PHASE 15 — Wire Logger vào Codebase 🟡 Priority

### Tasks
- [ ] 15.1 Replace console.log/warn/error trong server.ts → appLogger
- [ ] 15.2 Replace console.log trong qwen-ai.ts → adapter logger
- [ ] 15.3 Add correlation ID (traceId) cho mỗi request
- [ ] 15.4 Verify backward compat tests

---

## PHASE 16 — Wire Database vào Stores 🟡 Priority

### Tasks
- [ ] 16.1 Tạo migration script: `src/modules/migrate.ts`
- [ ] 16.2 Add SQLite backend option cho sessionStore
- [ ] 16.3 Add SQLite backend option cho configStore
- [ ] 16.4 Add SQLite backend option cho runStore
- [ ] 16.5 Verify backward compat tests

---

## PHASE 17 — Full Stream Refactor 🔴 Priority

### Tasks
- [ ] 17.1 Replace chunk-level parser bằng BufferedStreamParser trong handleStream()
- [ ] 17.2 Route: text → emit ngay, tool blocks → buffer → emit complete
- [ ] 17.3 Preserve reasoning/thinking phase (không buffer)
- [ ] 17.4 Integration tests với mock stream
- [ ] 17.5 Verify all tests

---

## PHASE 18 — Server Split & @ts-nocheck Removal 🟡 Priority

### Tasks
- [ ] 18.1 Tách server.ts → routes.ts, handlers.ts, middleware.ts, index.ts
- [ ] 18.2 Fix type errors trong extracted modules
- [ ] 18.3 Remove @ts-nocheck
- [ ] 18.4 Verify tsc --noEmit

---

## PHASE 19 — Integration Tests 🟢 Priority

### Tasks
- [ ] 19.1 Mock Qwen upstream
- [ ] 19.2 Test /v1/chat/completions end-to-end
- [ ] 19.3 Test tool call round trip
- [ ] 19.4 Test session lifecycle

---

## PHASE 20 — Production Deployment 🟢 Priority

### Tasks
- [ ] 20.1 Dockerfile
- [ ] 20.2 docker-compose.yml
- [ ] 20.3 Health check enhancements
- [ ] 20.4 Environment variable config
