import fs from 'fs';
import path from 'path';

// Lazy import for SQLite support (requires Node 24+)
let _sqliteDb: any = null;
function getSqliteDb() {
  if (!_sqliteDb) {
    try { _sqliteDb = require('./modules/database'); } catch { _sqliteDb = null; }
  }
  return _sqliteDb;
}

export interface ProviderAccountConfig {
  id: string;
  name?: string;
  enabled?: boolean;
  credentials?: Record<string, string>;
  maxConcurrentRuns?: number;
  networkProfileId?: string;
  status?: string;
}

export interface ProviderConfig {
  id: string;
  name?: string;
  credentials?: Record<string, string>;
  accounts?: ProviderAccountConfig[];
  maxConcurrentRuns?: number;
  networkProfileId?: string;
  oauth?: {
    authorizeUrl?: string;
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
    authorizeParams?: Record<string, string>;
    tokenParamName?: string;
    tokenKey?: string;
  };
}

export interface StoredConfig {
  providers: ProviderConfig[];
  proxy: { host: string; port: number; key?: string };
  models: Array<{ id: string; name: string }>;
  modelsUpdatedAt?: number;
  logs: Array<{ level: string; message: string; timestamp: number }>;
  settings: Record<string, any>;
}

export class ConfigStore {
  private filePath: string;
  private data: StoredConfig;
  private useSqlite = false;
  /** SSE listeners for real-time log streaming */
  private logListeners: Set<(entry: {level: string; message: string; timestamp: number}) => void> = new Set();

  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.join(dataDir, 'config.json');
    this.data = this.load();
  }

  /**
   * Enable SQLite backend for config storage.
   */
  enableSqliteBackend(dbPath?: string): void {
    const db = getSqliteDb();
    if (!db) { console.warn('[ConfigStore] SQLite not available'); return; }
    db.initDatabase(dbPath);
    this.useSqlite = true;
    // Migrate existing config to SQLite
    for (const [key, value] of Object.entries(this.data)) {
      db.setConfigValue(key, value);
    }
    // Reload from SQLite
    const sqliteConfig = db.getAllConfig();
    if (Object.keys(sqliteConfig).length > 0) {
      this.data = {...this.data, ...sqliteConfig} as StoredConfig;
    }
  }

  private load(): StoredConfig {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(raw) as StoredConfig;
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }

    const defaultConfig: StoredConfig = {
      providers: [
        {
          id: 'qwen-ai',
          name: 'Qwen AI (International)',
          credentials: {},
        },
      ],
      proxy: { host: '127.0.0.1', port: 8080, key: '' },
      models: [],
      logs: [],
      settings: {},
    };

    defaultConfig.settings = {
      tokenOverflow: {
        enabled: true,
        threshold: 10000,
        sanitizer: {
          enabled: true,
          mode: 'generic-plus-client-rules',
          preserveRawDebugFile: false,
          maxEnvironmentFileList: 200,
          maxMessageChars: 20000,
          stripClientToolProtocol: true,
          stripAutomatedClientErrors: true,
          stripAssistantToolFailureEcho: true,
          stripAssistantThinking: true,
          dedupeAssistantMessages: true,
          assistantSimilarityThreshold: 0.85,
          assistantDedupeMode: 'normalized-token-jaccard',
          assistantKeepStrategy: 'latest-clean',
          stripAssistantContainerConfusion: true,
          maxAssistantMessages: 1,
          maxToolResultChars: 12000,
          maxToolResultCount: 5,
          prioritizeUserMessages: true,
          includeProjectSnapshot: true,
        },
      },
      session: {
        enabled: true,
        historyLimit: 10,
        rollingHistoryK: 10,
        summaryEveryNTurns: 5,
        summaryMaxTokens: 800,
        summaryInputMaxTokens: 6000,
        summaryMessageMaxChars: 3000,
        summaryIncludeSystemMessages: false,
        autoCompact: true,
        compactAfterMessages: 40,
        compactModel: 'Qwen3.6-Plus',
        compactKeepRecent: 5,
        overflowSignal: {
          enabled: true,
          mode: 'auto',
          signalThresholdTokens: 90000,
        },
        chatCleanup: {
          enabled: false,
          afterResponse: false,
          scheduled: {
            enabled: false,
            mode: 'proxy-created',
            intervalHours: 1,
            maxAgeHours: 24,
          },
        },
      },
      multiThread: {
        enabled: true,
        globalMaxConcurrentRuns: 20,
        defaultProviderMaxConcurrentRuns: 5,
        defaultAccountMaxConcurrentRuns: 2,
        sameProviderChatPolicy: 'queue',
        sameSessionWritePolicy: 'serialize',
        queueTimeoutMs: 120000,
        runTimeoutMs: 300000,
        subagentMode: 'parallel-safe',
      },
      egressIsolation: {
        enabled: false,
        mode: 'worker',
        strict: true,
        fallbackToDirect: false,
        verifyBeforeUse: true,
        verifyIpUrl: 'https://api.ipify.org?format=json',
      },
      tokenLimits: {
        enabled: true,
        maxInputTokens: 128000,
        warnInputTokens: 100000,
        defaultMaxOutputTokens: 8192,
        maxOutputTokensCap: 32000,
      },
      ui: {
        language: 'en',
      },
      proxyMechanisms: {
        promiseQueue: {
          enabled: true,
        },
        smartRetry: {
          enabled: true,
        },
        sessionSerialize: {
          enabled: true,
        },
        forceNewSession: {
          enabled: false,
        },
      },
    };

    this.save(defaultConfig);
    return defaultConfig;
  }

  private save(data?: StoredConfig) {
    try {
      const toSave = data ?? this.data;
      // SQLite: persist config keys
      const db = this.useSqlite ? getSqliteDb() : null;
      if (db) {
        try {
          for (const [key, value] of Object.entries(toSave)) {
            db.setConfigValue(key, value);
          }
        } catch (err) {
          console.error('[ConfigStore] SQLite save failed, falling back to JSON:', err);
        }
      }
      // Always also write JSON (as backup / fallback)
      fs.writeFileSync(this.filePath, JSON.stringify(toSave, null, 2), 'utf8');
      this.data = toSave;
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  }

  getConfig() {
    return this.data;
  }

  updateConfig(partial: Partial<StoredConfig>) {
    if (partial.settings && typeof partial.settings === 'object') {
      this.data.settings = {
        ...(this.data.settings || {}),
        ...partial.settings,
        tokenOverflow: {
          ...(this.data.settings?.tokenOverflow || {}),
          ...(partial.settings.tokenOverflow || {}),
          sanitizer: {
            ...((this.data.settings?.tokenOverflow as any)?.sanitizer || {}),
            ...((partial.settings.tokenOverflow as any)?.sanitizer || {}),
          },
        },
        session: {
          ...(this.data.settings?.session || {}),
          ...(partial.settings.session || {}),
          overflowSignal: {
            ...((this.data.settings?.session as any)?.overflowSignal || {}),
            ...((partial.settings.session as any)?.overflowSignal || {}),
          },
          chatCleanup: {
            ...((this.data.settings?.session as any)?.chatCleanup || {}),
            ...((partial.settings.session as any)?.chatCleanup || {}),
            scheduled: {
              ...((this.data.settings?.session as any)?.chatCleanup?.scheduled || {}),
              ...((partial.settings.session as any)?.chatCleanup?.scheduled || {}),
            },
          },
        },
        multiThread: {
          ...((this.data.settings?.multiThread as any) || {}),
          ...((partial.settings.multiThread as any) || {}),
        },
        egressIsolation: {
          ...((this.data.settings?.egressIsolation as any) || {}),
          ...((partial.settings.egressIsolation as any) || {}),
        },
        tokenLimits: {
          ...((this.data.settings?.tokenLimits as any) || {}),
          ...((partial.settings.tokenLimits as any) || {}),
        },
        ui: {
          ...((this.data.settings?.ui as any) || {}),
          ...((partial.settings.ui as any) || {}),
        },
        proxyMechanisms: {
          ...((this.data.settings?.proxyMechanisms as any) || {}),
          ...((partial.settings.proxyMechanisms as any) || {}),
          promiseQueue: {
            ...((this.data.settings?.proxyMechanisms as any)?.promiseQueue || {}),
            ...((partial.settings.proxyMechanisms as any)?.promiseQueue || {}),
          },
          smartRetry: {
            ...((this.data.settings?.proxyMechanisms as any)?.smartRetry || {}),
            ...((partial.settings.proxyMechanisms as any)?.smartRetry || {}),
          },
          sessionSerialize: {
            ...((this.data.settings?.proxyMechanisms as any)?.sessionSerialize || {}),
            ...((partial.settings.proxyMechanisms as any)?.sessionSerialize || {}),
          },
          forceNewSession: {
            ...((this.data.settings?.proxyMechanisms as any)?.forceNewSession || {}),
            ...((partial.settings.proxyMechanisms as any)?.forceNewSession || {}),
          },
        },
      };
      const rest = {...partial};
      delete (rest as any).settings;
      this.data = {...this.data, ...(rest as any)};
    } else {
      this.data = {...this.data, ...(partial as any)};
    }
    this.save();
    return this.data;
  }

  setProviderToken(providerId: string, tokenKey: string, tokenValue: string) {
    const p = this.data.providers.find(x => x.id === providerId);
    if (!p) {
      this.data.providers.push({ id: providerId, credentials: { [tokenKey]: tokenValue } });
    } else {
      p.credentials = { ...(p.credentials || {}), [tokenKey]: tokenValue };
    }
    this.save();
  }

  /**
   * Add a new account to a provider.
   * If provider has no accounts[] yet, migrate existing credentials to an implicit "local" account first.
   */
  addProviderAccount(providerId: string, accountId: string, accountName: string, credentials: Record<string, string>) {
    const p = this.data.providers.find(x => x.id === providerId);
    if (!p) return null;
    // Migrate: if no explicit accounts yet but has provider-level credentials, create implicit "local" account
    if (!p.accounts || p.accounts.length === 0) {
      const existingCreds = p.credentials || {};
      if (Object.keys(existingCreds).length > 0) {
        p.accounts = [{ id: providerId, name: p.name || providerId, enabled: true, credentials: existingCreds }];
      } else {
        p.accounts = [];
      }
    }
    // Check duplicate
    if (p.accounts.some(a => a.id === accountId)) return null;
    const newAccount = { id: accountId, name: accountName, enabled: true, credentials };
    p.accounts.push(newAccount);
    this.save();
    return newAccount;
  }

  /**
   * Delete an account from a provider.
   */
  deleteProviderAccount(providerId: string, accountId: string): boolean {
    const p = this.data.providers.find(x => x.id === providerId);
    if (!p || !p.accounts) return false;
    const idx = p.accounts.findIndex(a => a.id === accountId);
    if (idx < 0) return false;
    p.accounts.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * Update an account's credentials or properties.
   */
  updateProviderAccount(providerId: string, accountId: string, updates: { name?: string; credentials?: Record<string, string>; enabled?: boolean }) {
    const p = this.data.providers.find(x => x.id === providerId);
    if (!p || !p.accounts) return null;
    const acc = p.accounts.find(a => a.id === accountId);
    if (!acc) return null;
    if (updates.name !== undefined) acc.name = updates.name;
    if (updates.credentials !== undefined) acc.credentials = updates.credentials;
    if (updates.enabled !== undefined) acc.enabled = updates.enabled;
    this.save();
    return acc;
  }

  setProviderOAuthConfig(providerId: string, oauthConfig: any) {
    const p = this.data.providers.find(x => x.id === providerId);
    if (!p) {
      this.data.providers.push({ id: providerId, oauth: oauthConfig });
    } else {
      p.oauth = { ...(p.oauth || {}), ...(oauthConfig || {}) };
    }
    this.save();
  }

  getProviderOAuthConfig(providerId: string) {
    const p = this.data.providers.find(x => x.id === providerId);
    return p?.oauth ?? null;
  }

  getModels() {
    return this.data.models;
  }

  addModel(model: { id: string; name: string }) {
    this.data.models.push(model);
    this.save();
    return this.data.models;
  }

  setModels(models: Array<{ id: string; name: string }>) {
    this.data = {
      ...this.data,
      models: [...models],
      modelsUpdatedAt: Date.now(),
    };
    this.save();
    return this.data.models;
  }

  addLog(level: string, message: string) {
    const entry = { level, message, timestamp: Date.now() };
    this.data.logs.push(entry);
    // keep logs bounded
    if (this.data.logs.length > 1000) this.data.logs.shift();
    this.save();
    // Notify SSE listeners
    for (const listener of this.logListeners) {
      try { listener(entry); } catch {}
    }
  }

  /** Register an SSE log listener. Returns unsubscribe function. */
  onLog(listener: (entry: {level: string; message: string; timestamp: number}) => void): () => void {
    this.logListeners.add(listener);
    return () => { this.logListeners.delete(listener); };
  }

  getLogs(limit = 200) {
    return this.data.logs.slice(-limit).reverse();
  }

  getLogsStats() {
    const total = this.data.logs.length;
    const errors = this.data.logs.filter(l => l.level === 'error').length;
    const chatRequests = this.data.logs.filter(l => {
      try {
        const parsed = JSON.parse(l.message);
        return parsed.path === '/v1/chat/completions';
      } catch {
        return false;
      }
    }).length;
    return { total, errors, chatRequests };
  }

  clearLogs() {
    this.data.logs = [];
    this.save();
  }

  getUsageAnalytics() {
    const logs = this.data.logs;
    const chatLogs: Array<{model?: string; status?: number; durationMs?: number; stream?: boolean; error?: string; totalTokens?: number; promptTokens?: number; completionTokens?: number; timestamp: number}> = [];

    for (const log of logs) {
      try {
        const parsed = JSON.parse(log.message);
        if (parsed.path === '/v1/chat/completions' || parsed.path === '/api/test-model') {
          // Extract actual token counts from response.usage if available
          let promptTokens = 0;
          let completionTokens = 0;
          let totalTokensVal = parsed.totalTokens || 0;
          const resp = parsed.response;
          if (resp && typeof resp === 'object') {
            const usage = resp.usage;
            if (usage && typeof usage === 'object') {
              // Support both OpenAI format and Qwen format
              promptTokens = Number(usage.prompt_tokens) || Number(usage.input_tokens) || 0;
              completionTokens = Number(usage.completion_tokens) || Number(usage.output_tokens) || 0;
              totalTokensVal = Number(usage.total_tokens) || (promptTokens + completionTokens) || totalTokensVal;
            }
          }
          // Also support top-level token fields (e.g. from /api/test-model logs)
          if (promptTokens === 0 && completionTokens === 0) {
            promptTokens = Number(parsed.prompt_tokens) || 0;
            completionTokens = Number(parsed.completion_tokens) || 0;
            totalTokensVal = Number(parsed.total_tokens) || (promptTokens + completionTokens) || totalTokensVal;
          }
          // Skip dummy values (1/1/2) from Qwen adapter — use estimation instead
          if (promptTokens === 1 && completionTokens === 1 && totalTokensVal === 2) {
            promptTokens = 0;
            completionTokens = 0;
            totalTokensVal = 0;
          }
          chatLogs.push({
            model: parsed.model,
            status: parsed.status,
            durationMs: parsed.durationMs,
            stream: parsed.stream,
            error: parsed.error,
            totalTokens: totalTokensVal,
            promptTokens,
            completionTokens,
            timestamp: log.timestamp,
          });
        }
      } catch {}
    }

    const totalRequests = chatLogs.length;
    const successfulRequests = chatLogs.filter(l => !l.error && (l.status === 200 || !l.status)).length;
    const failedRequests = chatLogs.filter(l => !!l.error).length;

    // Use actual token counts when available, fall back to estimation
    const actualInputTokens = chatLogs.reduce((s, l) => s + (l.promptTokens || 0), 0);
    const actualOutputTokens = chatLogs.reduce((s, l) => s + (l.completionTokens || 0), 0);
    const requestsWithTokenData = chatLogs.filter(l => (l.promptTokens || 0) > 0).length;
    const hasActualData = requestsWithTokenData > 0;

    // For requests without usage data, estimate ~2000 input + 1000 output
    const requestsWithoutData = totalRequests - requestsWithTokenData;
    const estimatedInputFallback = requestsWithoutData * 2000;
    const estimatedOutputFallback = requestsWithoutData * 1000;

    const estimatedInputTokens = actualInputTokens + (hasActualData ? estimatedInputFallback : totalRequests * 2000);
    const estimatedOutputTokens = actualOutputTokens + (hasActualData ? estimatedOutputFallback : totalRequests * 1000);
    const totalTokens = estimatedInputTokens + estimatedOutputTokens;

    // Average latency
    const withDuration = chatLogs.filter(l => typeof l.durationMs === 'number');
    const avgDurationMs = withDuration.length > 0
      ? Math.round(withDuration.reduce((s, l) => s + l.durationMs!, 0) / withDuration.length)
      : 0;

    // Requests by model
    const modelMap: Record<string, number> = {};
    for (const l of chatLogs) {
      const m = l.model || 'unknown';
      modelMap[m] = (modelMap[m] || 0) + 1;
    }
    const byModel = Object.entries(modelMap).map(([model, count]) => ({model, count})).sort((a, b) => b.count - a.count);

    // Requests per hour (last 24h)
    const now = Date.now();
    const hours: Record<string, number> = {};
    for (const l of chatLogs) {
      if (now - l.timestamp < 86400000) {
        const d = new Date(l.timestamp);
        const key = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00`;
        hours[key] = (hours[key] || 0) + 1;
      }
    }
    const requestsPerHour = Object.entries(hours).map(([hour, count]) => ({hour, count}));

    // Error breakdown
    const errorTypes: Record<string, number> = {};
    for (const l of chatLogs) {
      if (l.error) {
        const errKey = l.error.length > 50 ? l.error.slice(0, 50) + '…' : l.error;
        errorTypes[errKey] = (errorTypes[errKey] || 0) + 1;
      }
    }
    const errors = Object.entries(errorTypes).map(([error, count]) => ({error, count})).sort((a, b) => b.count - a.count);

    // Cost estimation (rough: ~$0.50 per 1M input tokens, ~$1.50 per 1M output tokens for Qwen)
    const estimatedCost = (estimatedInputTokens / 1_000_000) * 0.5 + (estimatedOutputTokens / 1_000_000) * 1.5;

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      estimatedInputTokens,
      estimatedOutputTokens,
      totalTokens,
      avgDurationMs,
      byModel,
      requestsPerHour,
      errors,
      estimatedCost: Math.round(estimatedCost * 1000) / 1000,
      streamingRequests: chatLogs.filter(l => l.stream).length,
      nonStreamingRequests: chatLogs.filter(l => !l.stream).length,
    };
  }
}

export const configStore = new ConfigStore();

export default configStore;
