# Luna-Proxy — Plan Đưa Vào Sử Dụng

**Mục tiêu:** Đưa Luna-Proxy vào trạng thái có thể chạy thực tế với Cline / Claude Code CLI

## Phase A — Wiring Modules Vào Runtime ⚡

### A1. Wire Database vào sessionStore
- [ ] Tạo `SqliteSessionStore` class trong `src/sessionStore.ts`
- [ ] Thêm `storageBackend` config option: 'json' | 'sqlite'
- [ ] Khi `sqlite`: dùng `database.ts` CRUD thay JSON
- [ ] Migration auto-run khi switch backend
- [ ] Tests backward compat

### A2. Wire Database vào configStore
- [ ] Tạo `SqliteConfigStore` class trong `src/configStore.ts`
- [ ] Khi `sqlite`: dùng `database.ts` getConfig/setConfig
- [ ] Preserve existing API

### A3. Wire Logger vào tất cả files chính
- [ ] Replace console.log/warn/error trong server.ts (~40 calls)
- [ ] Replace console.log trong qwen-ai.ts (~20 calls)
- [ ] Add traceId per request
- [ ] Verify tests

### A4. Wire routes.ts vào server.ts
- [x] Import `registerRoutes` từ `src/server/routes.ts`
- [x] Thêm `registerRoutes(this.router)` vào `setupRoutes()`
- [x] Verify tests pass (47/47)
- [ ] Cleanup: xóa duplicate inline routes (dead code, non-urgent)

## Phase B — Runtime Hardening 🛡

### B1. Error Handling Enhancement
- [x] Global error handler middleware trong Koa (try/catch in setupMiddleware)
- [x] Structured error response format: { error: { message, type } }
- [x] Logs errors via appLogger with path/method context
- [ ] Unhandled rejection handler (process-level, non-urgent)
- [ ] Uncaught exception handler (process-level, non-urgent)

### B2. Health Check Enhancement
- [x] `/health` trả về: version, uptime, uptimeHuman, activeSessions, activeRuns, memory, timestamp
- [ ] `/health/detailed` trả về: database, rate limiter status (non-urgent)

### B3. Config Validation
- [ ] Validate config on load
- [ ] Default values cho missing fields
- [ ] Migration cho old config formats

## Phase C — Testing & Verification ✅

### C1. Smoke Test
- [ ] Start server
- [ ] Send test request to /v1/chat/completions
- [ ] Verify response format
- [ ] Verify logs are written
- [ ] Verify session created

### C2. Integration Test Enhancement
- [ ] Test full request flow với mock upstream
- [ ] Test tool call round trip
- [ ] Test session lifecycle (create → compact → reset)
- [ ] Test rate limiting behavior

## Tiến trình thực hiện

1. **Phase A** trước — wiring modules vào runtime (impact cao nhất)
2. **Phase B** sau — error handling + health check
3. **Phase C** cuối — smoke test + verify