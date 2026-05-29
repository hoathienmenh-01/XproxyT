/**
 * Server Middleware — Auth, CORS, header utilities.
 * Phase 11: Type Safety refactor — extracted from server.ts.
 */

import Koa from 'koa';

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
 * CORS middleware.
 */
export async function corsMiddleware(ctx: Koa.Context, next: () => Promise<void>): Promise<void> {
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (ctx.method === 'OPTIONS') {
    ctx.status = 204;
    return;
  }
  await next();
}