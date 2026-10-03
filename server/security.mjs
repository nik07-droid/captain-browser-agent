const LOOPBACK_ORIGINS = new Set(['http://127.0.0.1:4317', 'http://localhost:4317']);
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

export function allowedOrigin(origin) {
  if (!origin) return true;
  return LOOPBACK_ORIGINS.has(origin) || EXTENSION_ORIGIN.test(origin);
}

export function responseOrigin(origin) {
  return origin && allowedOrigin(origin) ? origin : LOOPBACK_ORIGINS.values().next().value;
}

export function createRateLimiter({ limit = 60, windowMs = 60_000, now = Date.now } = {}) {
  const clients = new Map();
  return (key) => {
    const time = now(), existing = clients.get(key);
    if (!existing || time - existing.started >= windowMs) {
      clients.set(key, { started: time, count: 1 });
      return { allowed: true, remaining: limit - 1 };
    }
    existing.count++;
    return { allowed: existing.count <= limit, remaining: Math.max(0, limit - existing.count), retryAfterMs: Math.max(0, windowMs - (time - existing.started)) };
  };
}

export function isJsonRequest(headers = {}) {
  return /^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '');
}
