// @ts-nocheck
/**
 * Server Routes — API route registration extracted from server.ts.
 * Phase 18: Server Split refactor.
 */

import Router from '@koa/router';
import * as querystring from 'querystring';
import axios from 'axios';
import {configStore} from '../configStore';
import {sessionStore} from '../sessionStore';
import {runStore} from '../runtime/runStore';
import {lockManager} from '../runtime/locks';
import {getRuntimeDiagnostics, getSchedulerConfig} from '../runtime/scheduler';
import {getQueueDiagnostics} from '../modules/rateLimiter';
import {getAccountsFromProviderConf} from '../runtime/providerRouter';
import {getNetworkProfiles, upsertNetworkProfile, deleteNetworkProfile, verifyDirectIp} from '../runtime/networkProfiles';
import {getWorkers, upsertWorker, deleteWorker, verifyWorkerIp} from '../modules/workers';
import {chatCleanupScheduler} from '../modules/chatCleanup';
import {getQwenAiModelCatalog} from '../main/providers/builtin/qwen-ai';
import {QwenAiAdapter} from '../main/proxy/adapters/qwen-ai';
import {QwenAiAdapter as QwenAiOAuthAdapter} from '../main/oauth/adapters/qwen-ai';
import {captureQwenAiCredentials} from '../main/oauth/qwenAiCapture';
import {getAllPrompts, getPromptOverrides, setPromptOverride, resetPromptOverrides} from '../main/proxy/prompts/prompts';
import * as crypto from 'crypto';
import {compactSession} from '../modules/sessionCompactor';
import {getWorkspaceDiagnostics, cleanupExpiredLocks} from '../modules/workspaceScheduler';
import {insertApiKey, getApiKeyByHash, deactivateApiKey, listApiKeys, deleteApiKey, getApiKeyById, updateKeyAccountBinding} from '../modules/database';
import {collectNonStreamFromTransformedSSE} from '../modules/sseCollector';
import {abortRun, releaseRun} from '../runtime/scheduler';
import {registerRunController, unregisterRunController} from '../runtime/runControllers';
import {Account, Provider} from '../main/store/types';
import type {ProviderWorker} from '../runtime/types';
import {logger as appLogger} from '../modules/logger';

/**
 * Register all API routes on the given router.
 */
export function registerRoutes(router: Router): void {

  // === Health & Config ===
  router.get('/', async ctx => {
    ctx.body = { name: 'XproxyT', version: '0.1.0' };
  });

  router.get('/health', async ctx => {
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    ctx.body = {
      status: 'ok',
      version: '0.1.0',
      uptime: Math.round(uptime),
      uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.round(uptime % 60)}s`,
      activeSessions: sessionStore.listSessions().length,
      activeRuns: runStore.getActiveRuns().length,
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      },
      timestamp: new Date().toISOString(),
    };
  });

  router.get('/api/config', async ctx => {
    ctx.body = configStore.getConfig();
  });

  router.post('/api/config', async ctx => {
    const body = ctx.request.body as any;
    ctx.body = configStore.updateConfig(body);
  });

  // === Provider Token & OAuth ===
  router.post('/api/provider/token', async ctx => {
    const {providerId, tokenKey = 'ticket', token, credentials} = ctx.request.body as any;
    if (!providerId || (!token && !credentials)) {
      ctx.status = 400;
      ctx.body = { error: 'providerId and token or credentials required' };
      return;
    }
    appLogger.info('[Routes] Provider token set', {data: {providerId, hasCredentials: !!credentials}});
    if (credentials && typeof credentials === 'object') {
      for (const [key, value] of Object.entries(credentials)) {
        if (typeof value === 'string' && value.length > 0) {
          configStore.setProviderToken(providerId, key, value);
        }
      }
    } else {
      configStore.setProviderToken(providerId, tokenKey, token);
    }
    ctx.body = { success: true };
  });

  router.post('/api/provider/oauth-config', async ctx => {
    const {providerId, oauth} = ctx.request.body as any;
    if (!providerId || !oauth) {
      ctx.status = 400;
      ctx.body = { error: 'providerId and oauth config required' };
      return;
    }
    configStore.setProviderOAuthConfig(providerId, oauth);
    ctx.body = { success: true };
  });

  router.get('/api/provider/oauth-config', async ctx => {
    const providerId = ctx.query.providerId as string;
    if (!providerId) {
      ctx.status = 400;
      ctx.body = { error: 'providerId required' };
      return;
    }
    ctx.body = configStore.getProviderOAuthConfig(providerId);
  });

  router.get('/api/prompts', async ctx => {
    ctx.body = getAllPrompts();
  });

  router.post('/api/prompts', async ctx => {
    const body = ctx.request.body as any;
    if (!body || !body.id) {
      ctx.status = 400;
      ctx.body = { error: 'id and value required' };
      return;
    }
    setPromptOverride(String(body.id), String(body.value || ''));
    ctx.body = { ok: true, prompts: getAllPrompts() };
  });

  router.post('/api/prompts/reset', async ctx => {
    resetPromptOverrides();
    ctx.body = { ok: true, prompts: getAllPrompts() };
  });

  router.post('/api/provider/oauth/capture', async ctx => {
    const {providerId, timeout} = ctx.request.body as any;
    if (providerId !== 'qwen-ai') {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Only qwen-ai auto capture is supported' };
      return;
    }
    const result = await captureQwenAiCredentials(Number(timeout) || undefined);
    if (!result.success || !result.credentials) {
      ctx.status = 400;
      ctx.body = result;
      return;
    }
    for (const [key, value] of Object.entries(result.credentials)) {
      if (value) configStore.setProviderToken(providerId, key, value);
    }
    ctx.body = result;
  });

  router.post('/api/provider/validate', async ctx => {
    const {providerId, credentials} = ctx.request.body as any;
    if (!providerId || !credentials) {
      ctx.status = 400;
      ctx.body = {ok: false, error: 'providerId and credentials required'};
      return;
    }
    if (providerId === 'qwen-ai') {
      try {
        const adapter = new QwenAiOAuthAdapter();
        const result = await adapter.validateToken(credentials || {});
        ctx.body = {ok: !!result.valid, valid: !!result.valid, accountInfo: result.accountInfo, error: result.error};
      } catch (err) {
        ctx.status = 500;
        ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
      }
      return;
    }
    ctx.status = 400;
    ctx.body = {ok: false, error: 'Unsupported provider'};
  });

  router.get('/api/provider/status', async ctx => {
    const providerId = String(ctx.query.providerId || '');
    if (!providerId) {
      ctx.status = 400;
      ctx.body = {ok: false, error: 'providerId required'};
      return;
    }
    if (providerId !== 'qwen-ai') {
      ctx.body = {ok: true, status: 'warn', detail: 'Unsupported provider'};
      return;
    }
    const conf = configStore.getConfig();
    const providerConf = conf.providers.find(p => p.id === providerId);
    const credentials = providerConf?.credentials || {};
    if (!credentials.token && !credentials.cookies && !credentials.cookie) {
      ctx.body = {ok: true, status: 'dead', detail: 'No credentials'};
      return;
    }
    try {
      const adapter = new QwenAiOAuthAdapter();
      const result = await adapter.validateToken(credentials);
      ctx.body = {ok: true, status: result.valid ? 'alive' : 'dead', detail: result.valid ? 'Token valid' : (result.error || 'Token invalid')};
    } catch (error) {
      ctx.body = {ok: true, status: 'warn', detail: error instanceof Error ? error.message : String(error)};
    }
  });

  // === OAuth Flow ===
  router.get('/auth/start/:providerId', async ctx => {
    const providerId = ctx.params.providerId;
    const oauth = configStore.getProviderOAuthConfig(providerId);
    if (!oauth || !oauth.authorizeUrl) {
      ctx.status = 400;
      ctx.body = {error: 'OAuth authorizeUrl not configured'};
      return;
    }
    const state = Math.random().toString(36).slice(2);
    const callbackUrl = `${ctx.origin}/auth/callback/${encodeURIComponent(providerId)}`;
    const params: any = {
      client_id: oauth.clientId, redirect_uri: callbackUrl, response_type: 'code',
      scope: (oauth.scopes || []).join(' '), state, ...(oauth.authorizeParams || {}),
    };
    ctx.redirect(oauth.authorizeUrl + (oauth.authorizeUrl.includes('?') ? '&' : '?') + querystring.stringify(params));
  });

  router.get('/auth/callback/:providerId', async ctx => {
    const providerId = ctx.params.providerId;
    const oauth = configStore.getProviderOAuthConfig(providerId);
    const q = ctx.query as any;
    const tokenParamName = oauth?.tokenParamName || 'token';
    const tokenKey = oauth?.tokenKey || 'token';
    if (q[tokenParamName]) {
      configStore.setProviderToken(providerId, tokenKey, q[tokenParamName]);
      ctx.body = `<html><body><h3>Login successful</h3><script>setTimeout(()=>window.close(),1200)</script></body></html>`;
      return;
    }
    if (q.code && oauth && oauth.tokenUrl) {
      try {
        const callbackUrl = `${ctx.origin}/auth/callback/${encodeURIComponent(providerId)}`;
        const resp = await axios.post(oauth.tokenUrl, querystring.stringify({
          grant_type: 'authorization_code', code: q.code, redirect_uri: callbackUrl,
          client_id: oauth.clientId, client_secret: oauth.clientSecret,
        }), {headers: {'Content-Type': 'application/x-www-form-urlencoded'}});
        const tokenVal = resp.data && (resp.data.access_token || resp.data.token || resp.data.tongyi_sso_ticket || resp.data.ticket);
        if (tokenVal) {
          configStore.setProviderToken(providerId, tokenKey, tokenVal);
          ctx.body = `<html><body><h3>Login successful</h3><script>setTimeout(()=>window.close(),1200)</script></body></html>`;
          return;
        }
        ctx.body = `<html><body><h3>Login exchange completed</h3><pre>${JSON.stringify(resp.data,null,2)}</pre></body></html>`;
      } catch (err) {
        ctx.status = 500;
        ctx.body = `<html><body><h3>OAuth failed</h3><pre>${String(err)}</pre></body></html>`;
      }
      return;
    }
    ctx.body = `<html><body><h3>OAuth callback received</h3></body></html>`;
  });

  // === Models ===
  router.get('/api/models', async ctx => {
    ctx.body = {providerId: 'qwen-ai', source: 'builtin-qwen-catalog', items: getQwenAiModelCatalog(), updatedAt: null};
  });

  // /v1/models is registered in server.ts with requireApiKey middleware

  // === Logs ===
  router.get('/api/logs/stats', async ctx => { ctx.body = configStore.getLogsStats(); });
  router.get('/api/logs', async ctx => { ctx.body = configStore.getLogs(Number(ctx.query.limit || 200)); });
  router.get('/api/usage', async ctx => { ctx.body = configStore.getUsageAnalytics(); });
  router.delete('/api/logs', async ctx => { configStore.clearLogs(); ctx.body = {ok: true}; });

  // === Test Model ===
  router.post('/api/test-model', async ctx => {
    const {model} = ctx.request.body as any;
    if (!model) {
      ctx.status = 400;
      ctx.body = {ok: false, error: 'model is required'};
      return;
    }
    const conf = configStore.getConfig();
    const providerConf = conf.providers.find(p => p.id === 'qwen-ai');
    const credentials = providerConf?.credentials || {};
    if (!credentials.token && !credentials.cookies && !credentials.cookie) {
      ctx.status = 400;
      ctx.body = {ok: false, error: 'Provider not configured. Set token or cookies first.'};
      return;
    }
    try {
      const {QwenAiAdapter} = require('../main/proxy/adapters/qwen-ai');
      const provider = {id: 'qwen-ai', apiEndpoint: 'https://chat.qwen.ai', chatPath: '/api/v2/chat/completions', modelMappings: (require('../main/providers/builtin/qwen-ai').getQwenAiModelMappings ? require('../main/providers/builtin/qwen-ai').getQwenAiModelMappings() : [])};
      const account = {id: 'test', providerId: 'qwen-ai', name: 'test', credentials};
      const adapter = new QwenAiAdapter(provider, account);
      const startedAt = Date.now();
      const {response, chatId} = await adapter.chatCompletion({
        model,
        messages: [{role: 'user', content: 'Hello, respond with just "OK" to confirm you are working.'}],
        stream: false,
      });
      const nsh = new (require('../main/proxy/adapters/qwen-ai').QwenAiStreamHandler)(model);
      const transformed = await nsh.handleStream(response.data);
      const result = await (require('../modules/sseCollector').collectNonStreamFromTransformedSSE)(transformed, model);
      const durationMs = Date.now() - startedAt;
      const content = result?.choices?.[0]?.message?.content || '';
      // Prefer real usage captured by the handler from Qwen stream events,
      // fall back to usage extracted by sseCollector, then default to zeros.
      const handlerUsage = nsh.getLastUsage();
      const collectorUsage = result?.usage || {};
      const usage = handlerUsage || collectorUsage;
      ctx.body = {
        ok: true,
        model,
        response: content.substring(0, 200),
        usage: {
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: usage.completion_tokens || 0,
          total_tokens: usage.total_tokens || 0,
        },
        durationMs,
        chatId,
      };
      configStore.addLog('info', JSON.stringify({
        path: '/api/test-model',
        model,
        status: 200,
        durationMs,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        stream: false,
      }));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.status = 500;
      ctx.body = {ok: false, error: errMsg, model};
      configStore.addLog('error', JSON.stringify({
        path: '/api/test-model',
        model,
        status: 500,
        error: errMsg,
      }));
    }
  });

  // === Chat Cleanup ===
  router.get('/api/chat-cleanup/status', async ctx => { ctx.body = chatCleanupScheduler.status(); });

  // === Sessions ===
  router.get('/api/sessions', async ctx => {
    ctx.body = sessionStore.listSessions().map(s => ({
      id: s.id, source: s.source, workspace: s.workspace, threadId: s.threadId,
      title: s.title, model: s.model, providerSessionId: s.providerSessionId,
      contextHash: s.contextHash, turnCount: s.turnCount || 0, messageCount: s.messages.length,
      summary: s.summary, compactedAt: s.compactedAt, createdAt: s.createdAt,
      updatedAt: s.updatedAt, lastRequestAt: s.lastRequestAt, active: s.active,
    }));
  });

  router.get('/api/sessions/diagnostics', async ctx => {
    const conf = configStore.getConfig();
    const sessionCfg = conf.settings?.session || {};
    const allSessions = sessionStore.listSessions();
    ctx.body = {
      sessionEnabled: sessionCfg.enabled !== false, resolutionMode: 'context-hash',
      rollingHistoryK: Number(sessionCfg.rollingHistoryK) || 10,
      summaryEveryNTurns: Number(sessionCfg.summaryEveryNTurns) || 5,
      totalSessions: allSessions.length,
      stats: {persistent: allSessions.filter(s => s.mode === 'persistent' || !s.mode).length, indexed: allSessions.filter(s => !!s.contextHash).length, summarized: allSessions.filter(s => !!s.summary).length},
    };
  });

  router.get('/api/sessions/:id', async ctx => {
    const session = sessionStore.getSession(ctx.params.id);
    if (!session) { ctx.status = 404; ctx.body = {error: 'Session not found'}; return; }
    ctx.body = {...session, activeRunDetails: (session.activeRunIds || []).map(id => runStore.getRun(id)).filter(Boolean)};
  });

  router.delete('/api/sessions/:id', async ctx => {
    const ok = sessionStore.deleteSession(ctx.params.id);
    ctx.status = ok ? 200 : 404;
    ctx.body = {ok};
  });

  router.post('/api/sessions/:id/clear', async ctx => {
    const ok = sessionStore.clearSession(ctx.params.id);
    ctx.status = ok ? 200 : 404;
    ctx.body = {ok};
  });

  router.post('/api/sessions/:id/compact', async ctx => {
    const session = sessionStore.getSession(ctx.params.id);
    if (!session) { ctx.status = 404; ctx.body = {error: 'Session not found'}; return; }
    const conf = configStore.getConfig();
    const providerConf = conf.providers.find(p => p.id === 'qwen-ai');
    const token = providerConf?.credentials?.token || process.env.QWEN_AI_TOKEN || '';
    const cookies = (providerConf?.credentials?.cookies || providerConf?.credentials?.cookie) || process.env.QWEN_AI_COOKIES || '';
    if (!token && !cookies) { ctx.status = 400; ctx.body = {error: 'Provider not configured'}; return; }
    try {
      appLogger.info('[Routes] Session compact started', {data: {sessionId: ctx.params.id}});
      ctx.body = {ok: true, summary: await compactSession(session.id, token, cookies)};
      appLogger.info('[Routes] Session compact completed', {data: {sessionId: ctx.params.id}});
    } catch (err) {
      appLogger.error('[Routes] Session compact failed', {data: {sessionId: ctx.params.id}, error: err instanceof Error ? err : undefined});
      ctx.status = 500; ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  router.post('/api/sessions/:id/rename', async ctx => {
    const {title} = ctx.request.body as any;
    if (!title) { ctx.status = 400; ctx.body = {error: 'title required'}; return; }
    const ok = sessionStore.renameSession(ctx.params.id, String(title));
    ctx.status = ok ? 200 : 404;
    ctx.body = {ok};
  });

  router.post('/api/sessions/reload', async ctx => { sessionStore.reload(); ctx.body = {ok: true}; });
  router.delete('/api/sessions', async ctx => { sessionStore.clearAll(); ctx.body = {ok: true}; });

  router.post('/api/sessions/:id/reset-provider', async ctx => {
    const body = ctx.request.body as any;
    const ok = await sessionStore.resetProviderSessionId(ctx.params.id, body?.purpose);
    ctx.status = ok ? 200 : 404;
    ctx.body = {ok};
  });

  // === Runs ===
  router.get('/api/runs', async ctx => { ctx.body = runStore.listRuns(Number(ctx.query.limit || 200)); });
  router.get('/api/runs/:id', async ctx => {
    const run = runStore.getRun(ctx.params.id);
    if (!run) { ctx.status = 404; ctx.body = {error: 'Run not found'}; return; }
    ctx.body = run;
  });
  router.delete('/api/runs/:id', async ctx => {
    const run = runStore.getRun(ctx.params.id);
    if (run?.sessionId) sessionStore.removeActiveRunId(run.sessionId, ctx.params.id);
    const ok = runStore.deleteRun(ctx.params.id);
    ctx.status = ok ? 200 : 404;
    ctx.body = {ok};
  });
  router.delete('/api/runs', async ctx => {
    for (const run of runStore.listRuns(5000)) {
      if (run.sessionId) sessionStore.removeActiveRunId(run.sessionId, run.id);
    }
    runStore.clearAll();
    ctx.body = {ok: true};
  });
  router.post('/api/runs/:id/cancel', async ctx => {
    const run = runStore.getRun(ctx.params.id);
    if (!run) { ctx.status = 404; ctx.body = {error: 'Run not found'}; return; }
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      ctx.body = {ok: true, status: run.status, alreadyTerminal: true}; return;
    }
    await abortRun(ctx.params.id, 'Cancelled by user');
    runStore.cancelRun(ctx.params.id);
    await releaseRun(ctx.params.id);
    if (run.sessionId) sessionStore.removeActiveRunId(run.sessionId, ctx.params.id);
    ctx.body = {ok: true, status: 'cancelled'};
  });

  // === Runtime ===
  router.get('/api/runtime', async ctx => {
    const diag = getRuntimeDiagnostics();
    const queueDiag = getQueueDiagnostics();
    ctx.body = {
      ...diag,
      queue: queueDiag,
      activeRuns: runStore.getActiveRuns().map(r => ({id: r.id, status: r.status, providerId: r.providerId, accountId: r.accountId, providerChatId: r.providerChatId, sessionId: r.sessionId, workerId: r.workerId, startedAt: r.startedAt})),
      workers: getWorkers().map(w => ({id: w.id, providerId: w.providerId, status: w.status, lastVerifiedIp: w.lastVerifiedIp})),
    };
  });

  router.get('/api/provider-runtime', async ctx => {
    ctx.body = {config: getSchedulerConfig(), locks: lockManager.getSnapshot(), activeRuns: runStore.getActiveRuns()};
  });

  // === Network & Workers ===
  router.get('/api/network-profiles', async ctx => { ctx.body = getNetworkProfiles(); });
  router.post('/api/network-profiles', async ctx => { ctx.body = upsertNetworkProfile(ctx.request.body as any); });
  router.put('/api/network-profiles/:id', async ctx => { const p = ctx.request.body as any; p.id = ctx.params.id; ctx.body = upsertNetworkProfile(p); });
  router.delete('/api/network-profiles/:id', async ctx => { ctx.body = {ok: deleteNetworkProfile(ctx.params.id)}; });
  router.get('/api/egress/direct-ip', async ctx => { try { ctx.body = await verifyDirectIp(); } catch { ctx.body = {ip: 'unknown', source: 'error'}; } });
  router.get('/api/workers', async ctx => { ctx.body = getWorkers(); });
  router.post('/api/workers', async ctx => { ctx.body = upsertWorker(ctx.request.body as ProviderWorker); });
  router.put('/api/workers/:id', async ctx => { const w = ctx.request.body as ProviderWorker; w.id = ctx.params.id; ctx.body = upsertWorker(w); });
  router.delete('/api/workers/:id', async ctx => { ctx.body = {ok: deleteWorker(ctx.params.id)}; });
  router.post('/api/workers/:id/verify-ip', async ctx => {
    const result = await verifyWorkerIp(ctx.params.id);
    if (!result) { ctx.status = 404; ctx.body = {error: 'Worker not found'}; return; }
    ctx.body = result;
  });

  // === Workspace & Git ===
  router.get('/api/workspace/diagnostics', async ctx => { ctx.body = getWorkspaceDiagnostics(); });
  router.post('/api/workspace/cleanup-locks', async ctx => { ctx.body = {ok: true, cleaned: cleanupExpiredLocks()}; });
  router.get('/api/workspace/git-status', async ctx => {
    try {
      const {getGitStatus} = require('../modules/gitContext');
      ctx.body = getGitStatus();
    } catch (err) {
      ctx.body = {isRepo: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // === Real-time Log Stream (SSE) ===
  router.get('/api/logs/stream', async ctx => {
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.set('X-Accel-Buffering', 'no');
    ctx.status = 200;

    const stream = new (require('stream').PassThrough)();
    ctx.body = stream;

    // Send initial ping
    stream.write(':connected\n\n');

    const unsubscribe = configStore.onLog((entry) => {
      try {
        const data = JSON.stringify(entry);
        stream.write(`data: ${data}\n\n`);
      } catch {}
    });

    // Heartbeat every 15s to keep connection alive
    const heartbeat = setInterval(() => {
      try { stream.write(':heartbeat\n\n'); } catch {}
    }, 15000);

    ctx.req.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
      stream.end();
    });
  });

  // === Misc ===
  router.post('/api/providers/:providerId/accounts/:accountId/reset-circuit', async ctx => {
    ctx.body = {ok: true, providerId: ctx.params.providerId, accountId: ctx.params.accountId};
  });
  router.post('/api/models', async ctx => { ctx.status = 405; ctx.body = {ok: false, error: 'Models managed from built-in catalog'}; });
  router.post('/api/models/refresh', async ctx => {
    try {
      const items = getQwenAiModelCatalog();
      configStore.setModels(items);
      appLogger.info('[Routes] Model catalog refreshed', {data: {count: items.length}});
      ctx.body = {ok: true, count: items.length, items, updatedAt: Date.now()};
    } catch (error) {
      appLogger.error('[Routes] Model refresh failed', {error: error instanceof Error ? error : undefined});
      ctx.status = 500; ctx.body = {ok: false, error: error instanceof Error ? error.message : String(error)};
    }
  });

  // === Phase 27: Admin API Key Management ===
  // These routes are under /api/admin/* and do NOT require API key middleware
  // (they are internal dashboard management routes)

  // List all API keys (without hash)
  router.get('/api/admin/keys', async ctx => {
    try {
      const keys = listApiKeys();
      ctx.body = {
        ok: true,
        keys: keys.map(k => ({
          id: k.id,
          display_suffix: k.display_suffix,
          client_name: k.client_name,
          account_id: k.account_id,
          is_active: k.is_active,
          created_at: k.created_at,
        })),
      };
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // Generate a new API key (with optional account binding)
  router.post('/api/admin/keys', async ctx => {
    const body = ctx.request.body as any;
    const clientName = body?.client_name || 'default-client';
    const accountId = body?.account_id || null;
    try {
      const randomHex = crypto.randomBytes(32).toString('hex');
      const rawKey = `sk-luna-${randomHex}`;
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const displaySuffix = rawKey.slice(-4);
      const id = crypto.randomUUID();
      insertApiKey(id, keyHash, displaySuffix, clientName, accountId);
      ctx.body = {
        ok: true,
        rawApiKey: rawKey,
        id,
        client_name: clientName,
        account_id: accountId,
        display_suffix: displaySuffix,
        message: 'Copy this key now. It will NOT be shown again.',
      };
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // Toggle API key active status
  router.patch('/api/admin/keys/:id/toggle', async ctx => {
    const {id} = ctx.params;
    try {
      const db = require('../modules/database');
      const database = db.getDatabase();
      const stmt = database.prepare('SELECT id, is_active FROM api_keys WHERE id = ?');
      const row = stmt.get(id) as any;
      if (!row) {
        ctx.status = 404;
        ctx.body = {ok: false, error: 'API key not found'};
        return;
      }
      const newActive = row.is_active === 1 ? 0 : 1;
      const updateStmt = database.prepare('UPDATE api_keys SET is_active = ? WHERE id = ?');
      updateStmt.run(newActive, id);
      ctx.body = {ok: true, id, is_active: newActive};
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // Delete an API key permanently
  router.delete('/api/admin/keys/:id', async ctx => {
    const {id} = ctx.params;
    try {
      const ok = deleteApiKey(id);
      ctx.status = ok ? 200 : 404;
      ctx.body = {ok};
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // Update account binding for an API key
  router.patch('/api/admin/keys/:id/account', async ctx => {
    const {id} = ctx.params;
    const body = ctx.request.body as any;
    const accountId = body?.account_id || null;
    try {
      const key = getApiKeyById(id);
      if (!key) {
        ctx.status = 404;
        ctx.body = {ok: false, error: 'API key not found'};
        return;
      }
      const ok = updateKeyAccountBinding(id, accountId);
      ctx.body = {ok, id, account_id: accountId};
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // List available accounts for key binding
  router.get('/api/admin/accounts', async ctx => {
    try {
      const conf = configStore.getConfig();
      const accounts: any[] = [];
      for (const provider of conf.providers || []) {
        // Explicit accounts
        const providerAccounts = (provider.accounts || []).map(a => ({
          id: a.id,
          name: a.name || a.id,
          providerId: provider.id,
          enabled: a.enabled !== false,
        }));
        if (providerAccounts.length > 0) {
          accounts.push(...providerAccounts);
        } else if (provider.credentials && Object.keys(provider.credentials).length > 0) {
          // Implicit "local" account
          accounts.push({
            id: provider.id,
            name: provider.name || provider.id,
            providerId: provider.id,
            enabled: true,
          });
        }
      }
      ctx.body = {ok: true, accounts};
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // Add a new account to a provider
  router.post('/api/admin/providers/:providerId/accounts', async ctx => {
    const {providerId} = ctx.params;
    const body = ctx.request.body as any;
    const accountId = body?.id;
    const accountName = body?.name;
    const credentials = body?.credentials || {};
    if (!accountId) {
      ctx.status = 400;
      ctx.body = {ok: false, error: 'Account ID is required'};
      return;
    }
    try {
      const result = configStore.addProviderAccount(providerId, accountId, accountName || accountId, credentials);
      if (!result) {
        ctx.status = 409;
        ctx.body = {ok: false, error: 'Account ID already exists or provider not found'};
        return;
      }
      ctx.body = {ok: true, account: result};
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // Update an account
  router.patch('/api/admin/providers/:providerId/accounts/:accountId', async ctx => {
    const {providerId, accountId} = ctx.params;
    const body = ctx.request.body as any;
    try {
      const result = configStore.updateProviderAccount(providerId, accountId, body || {});
      if (!result) {
        ctx.status = 404;
        ctx.body = {ok: false, error: 'Account not found'};
        return;
      }
      ctx.body = {ok: true, account: result};
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // Delete an account
  router.delete('/api/admin/providers/:providerId/accounts/:accountId', async ctx => {
    const {providerId, accountId} = ctx.params;
    try {
      const ok = configStore.deleteProviderAccount(providerId, accountId);
      ctx.status = ok ? 200 : 404;
      ctx.body = {ok};
    } catch (err) {
      ctx.status = 500;
      ctx.body = {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  });

  // Admin bypass test-model (no API key required)
  router.post('/api/admin/test-model', async ctx => {
    const {model, prompt} = ctx.request.body as any;
    if (!model) {
      ctx.status = 400;
      ctx.body = {ok: false, error: 'model is required'};
      return;
    }
    const conf = configStore.getConfig();
    const providerConf = conf.providers.find(p => p.id === 'qwen-ai');
    const credentials = providerConf?.credentials || {};
    if (!credentials.token && !credentials.cookies && !credentials.cookie) {
      ctx.status = 400;
      ctx.body = {ok: false, error: 'Provider not configured. Set token or cookies first.'};
      return;
    }
    try {
      const {QwenAiAdapter} = require('../main/proxy/adapters/qwen-ai');
      const provider = {id: 'qwen-ai', apiEndpoint: 'https://chat.qwen.ai', chatPath: '/api/v2/chat/completions', modelMappings: (require('../main/providers/builtin/qwen-ai').getQwenAiModelMappings ? require('../main/providers/builtin/qwen-ai').getQwenAiModelMappings() : [])};
      const account = {id: 'test', providerId: 'qwen-ai', name: 'test', credentials};
      const adapter = new QwenAiAdapter(provider, account);
      const startedAt = Date.now();
      const {response, chatId} = await adapter.chatCompletion({
        model,
        messages: [{role: 'user', content: prompt || 'Hello, respond with just "OK" to confirm you are working.'}],
        stream: false,
      });
      const nsh = new (require('../main/proxy/adapters/qwen-ai').QwenAiStreamHandler)(model);
      const transformed = await nsh.handleStream(response.data);
      const result = await collectNonStreamFromTransformedSSE(transformed, model);
      const durationMs = Date.now() - startedAt;
      const content = result?.choices?.[0]?.message?.content || '';
      const handlerUsage = nsh.getLastUsage();
      const collectorUsage = result?.usage || {};
      const usage = handlerUsage || collectorUsage;
      ctx.body = {
        ok: true,
        model,
        response: content.substring(0, 200),
        usage: {
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: usage.completion_tokens || 0,
          total_tokens: usage.total_tokens || 0,
        },
        durationMs,
        chatId,
      };
      configStore.addLog('info', JSON.stringify({
        path: '/api/admin/test-model',
        model,
        status: 200,
        durationMs,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        stream: false,
      }));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.status = 500;
      ctx.body = {ok: false, error: errMsg, model};
      configStore.addLog('error', JSON.stringify({
        path: '/api/admin/test-model',
        model,
        status: 500,
        error: errMsg,
      }));
    }
  });
}
