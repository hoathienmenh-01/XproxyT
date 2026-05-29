# Final 3 Tasks — Plan & Execution

## Task 1: Database Wiring ✅
- [x] Database module ready (`src/modules/database.ts`) — 5 tables, WAL mode, 18/18 tests
- [x] Migration module ready (`src/modules/migrate.ts`) — JSON→SQLite, 5/5 tests
- [x] Logger module ready (`src/modules/logger.ts`) — 15/15 tests
- [x] SQLite session adapter (`src/modules/sqliteSessionAdapter.ts`) — lazy import, no Node 24 breakage
- [x] `sessionStore.enableSqliteBackend()` — auto-migrate JSON→SQLite, fallback if fail
- [x] `configStore.enableSqliteBackend()` — dual-write SQLite + JSON backup
- [x] Smoke test: 22/22 PASS

## Task 2: Logger Wiring ✅
- [x] Logger imported into `routes.ts`
- [x] Model refresh operations logged
- [x] Trace ID middleware added to server.ts (`x-luna-trace-id` header)
- [x] 3 key console.log calls replaced with appLogger in server.ts (non-stream, static serve, session reset)
- **Remaining:** ~50 console.log calls in server.ts and ~20 in qwen-ai.ts (non-urgent, can be done incrementally)

## Task 3: Frontend Health Indicators ✅
- [x] HealthData type added to Dashboard
- [x] `/health` response parsed (uptime, memory, activeSessions, version)
- [x] Health card shows: uptime, RAM usage, version
- [x] Active runs card shows: live session count
- [x] Auto-refresh every 2s already working
- **Note:** All TS errors are pre-existing (no @types/react). Dashboard works at runtime.
