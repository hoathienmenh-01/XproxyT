/**
 * Server Middleware — Auth, CORS, header utilities.
 * Phase 11: Type Safety refactor — extracted from server.ts.
 * Phase 26: API Key Authentication (SaaS-like).
 */

import Koa from 'koa';
import * as crypto from 'crypto';
import { getApiKeyByHash } from '../modules/database';

const SENSITIVE_HEADER_RE = /(authorization|cookie|token|api-key|x-proxy-key|proxy-authorization|secret|session)/i;

export function normalizeHeaders(headers: Record<string, any> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    const normalizedKey = String(key).toLowerCase();
    if (Array.isArray(value)) {
      out[normalizedKey] = value.map(v => String(v)).join('; ');
    } else {
      out[normalizedKey] = String(value);
    }
  }
  return out;
}

export function maskHeaders(headers: Record<string, any> | undefined | null): Record<string, string> {
  const normalized = normalizeHeaders(headers);
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(normalized)) {
    masked[key] = SENSITIVE_HEADER_RE.test(key) ? '[redacted]' : value;
  }
  return masked;
}

export function getClientResponseHeaders(ctx: Koa.Context): Record<string, string> {
  const headers = maskHeaders(ctx.res.getHeaders() as Record<string, any>);
  const type = ctx.response.type;
  if (type && !headers['content-type']) headers['content-type'] = type;
  return headers;
}

/**
 * Unified API Key + Proxy Key authentication middleware.
 * Supports:
 *   1. API Key (SHA-256 hash lookup in SQLite) — checked FIRST (more specific)
 *   2. Proxy Key (simple text match from config) — checked as fallback
 * Fail open if no auth is configured at all.
 *
 * Sources for each:
 *   - API Key: Authorization: Bearer sk-luna-... OR x-api-key: sk-luna-...
 *   - Proxy Key: Authorization: Bearer <key> OR x-proxy-key: <key>
 */
export async function requireApiKey(ctx: Koa.Context, next: () => Promise<void>): Promise<void> {
  try {
    const authHeader = ctx.get('Authorization');
    const xProxyKey = ctx.get('x-proxy-key');
    const xApiKey = ctx.get('x-api-key'); // Anthropic convention

    // Extract bearer token from Authorization header (if present)
    const bearerToken = authHeader?.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';

    // --- Determine if auth is required ---
    let proxyKey = '';
    let hasApiKeys = false;
    try {
      const { configStore } = require('../configStore');
      const conf = configStore.getConfig();
      proxyKey = String(conf.proxy?.key || '').trim();
    } catch {}
    try {
      const { listApiKeys } = require('../modules/database');
      const keys: Array<{ is_active: number }> = listApiKeys();
      hasApiKeys = keys.some((k: { is_active: number }) => k.is_active === 1);
    } catch {}

    // If NO proxy key configured AND no API keys exist → fail open (no auth needed)
    if (!proxyKey && !hasApiKeys) {
      (ctx.state as any).clientName = 'open-access';
      await next();
      return;
    }

    // --- Check 1: API Key (SHA-256 hash lookup in SQLite) — checked FIRST ---
    // API keys are identified by the "sk-luna-" prefix and can come from
    // either the Authorization header or the x-api-key header.
    const possibleApiKey = bearerToken.startsWith('sk-luna-')
      ? bearerToken
      : (xApiKey && xApiKey.startsWith('sk-luna-'))
        ? xApiKey
        : '';
    if (possibleApiKey && hasApiKeys) {
      const keyHash = crypto.createHash('sha256').update(possibleApiKey).digest('hex');
      const apiKeyRow = getApiKeyByHash(keyHash);

      if (apiKeyRow) {
        if (apiKeyRow.is_active === 0) {
          ctx.status = 403;
          ctx.body = {
            error: {
              message: 'Forbidden: API key has been deactivated',
              type: 'permission_error',
            },
          };
          return;
        }
        (ctx.state as any).clientName = apiKeyRow.client_name || 'unknown';
        (ctx.state as any).apiKeyId = apiKeyRow.id;
        // Per-account key binding: store the bound account_id for the chat endpoint
        if (apiKeyRow.account_id) {
          (ctx.state as any).boundAccountId = apiKeyRow.account_id;
        }
        await next();
        return;
      }
    }

    // --- Check 2: Proxy Key (simple text match from config) — checked as fallback ---
    // Proxy key can come from Authorization Bearer header or x-proxy-key header.
    // Only use proxy-key-specific sources (not x-api-key, which is reserved for API keys).
    if (proxyKey) {
      const providedKey = bearerToken || xProxyKey;
      if (providedKey === proxyKey) {
        (ctx.state as any).clientName = 'proxy-key-user';
        await next();
        return;
      }
    }

    // --- Neither passed ---
    ctx.status = 401;
    ctx.body = {
      error: {
        message: 'Unauthorized: Invalid credentials. Provide a valid API key (sk-luna-...) or Proxy Key',
        type: 'authentication_error',
      },
    };
  } catch (err) {
    // If database is not available, fail open with a warning
    console.warn('[Auth] requireApiKey error (failing open):', err instanceof Error ? err.message : String(err));
    (ctx.state as any).clientName = 'unknown';
    await next();
  }
}

/**
 * CORS middleware.
 */
export async function corsMiddleware(ctx: Koa.Context, next: () => Promise<void>): Promise<void> {
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key, X-Proxy-Key');
  if (ctx.method === 'OPTIONS') {
    ctx.status = 204;
    return;
  }
  await next();
}
