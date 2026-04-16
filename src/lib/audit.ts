// Fire-and-forget audit log writer
// DB가 있으면 DB에, 없으면 콘솔에

function sanitizeMetadata(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
    if (typeof v === 'string') result[k] = v.trim().slice(0, 1000);
    else if (typeof v === 'number' || typeof v === 'boolean') result[k] = v;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function logAudit(opts: {
  userId: string;
  action: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}): void {
  const entry = { id: crypto.randomUUID(), ...opts, created_at: Date.now() };
  const { getDbAdapter } = require('./db-adapter');
  const db = getDbAdapter();
  db.execute(
    `INSERT INTO nf_audit_log (id, user_id, action, resource_id, metadata, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entry.id, entry.userId, entry.action,
    entry.resourceId ?? null,
    entry.metadata ? JSON.stringify(sanitizeMetadata(entry.metadata)) : null,
    entry.ip ?? null,
    entry.created_at,
  ).catch((err: unknown) => {
    // DB write failed — log to stderr so it's captured by log aggregators (Sentry, CloudWatch, etc.)
    console.error('[AUDIT] DB write failed, falling back to stderr:', err);
    console.error('[AUDIT]', JSON.stringify(entry));
  });
}
