// Per-user sliding-window rate limiting. In-memory per serverless instance —
// a cheap first line of defense for free routes ("fail cheap"), not a global
// guarantee. Credit debits are the hard cap on paid routes.

const windows = new Map(); // key -> array of timestamps (ms)

// Returns true if the call is allowed, false if the user is over the limit.
export function checkRateLimit(userId, route, limit, windowMs) {
  const key = `${userId}:${route}`;
  const now = Date.now();
  const cutoff = now - windowMs;

  const hits = (windows.get(key) || []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return false;
  }

  hits.push(now);
  windows.set(key, hits);

  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (windows.size > 5000) {
    for (const [k, v] of windows) {
      if (v.every((t) => t <= cutoff)) windows.delete(k);
    }
  }
  return true;
}

export function rateLimited(res) {
  res.status(429).json({
    ok: false,
    error: 'Too many requests. Please wait a moment and try again.',
    code: 'RATE_LIMITED',
  });
}
