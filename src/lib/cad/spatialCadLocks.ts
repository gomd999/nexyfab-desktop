import type { DesignLockTarget } from '@/lib/ai/designWorkspaceRevision';

export type SpatialCadLockSource = 'human' | 'expert' | 'authority';
export interface SpatialCadLockDto {
  id: string;
  target: DesignLockTarget;
  scope: string;
  source: SpatialCadLockSource;
  reason: string;
  createdAt: string;
  ownerUserId?: string | null;
  canRelease?: boolean;
}

const KINDS = new Set(['workspace', 'base_shape', 'assembly', 'occurrence', 'feature', 'parameter', 'authoritative_input']);
export const MAX_SPATIAL_CAD_LOCKS = 64;

export function spatialCadLockScope(projectId: string, domain: string, documentId: string): string {
  return `project:${encodeURIComponent(projectId)}:domain:${encodeURIComponent(domain)}:document:${encodeURIComponent(documentId)}`;
}

export function validateSpatialCadLockTarget(value: unknown): value is DesignLockTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Partial<DesignLockTarget>;
  return typeof target.kind === 'string' && KINDS.has(target.kind)
    && typeof target.objectId === 'string' && !!target.objectId.trim()
    && (target.field === undefined || (typeof target.field === 'string' && !!target.field.trim()));
}

export function validateSpatialCadLock(value: unknown): value is SpatialCadLockDto {
  if (!value || typeof value !== 'object') return false;
  const lock = value as Partial<SpatialCadLockDto>;
  return typeof lock.id === 'string' && !!lock.id.trim() && lock.id.length <= 180
    && validateSpatialCadLockTarget(lock.target) && typeof lock.scope === 'string' && !!lock.scope.trim()
    && (lock.source === 'human' || lock.source === 'expert' || lock.source === 'authority')
    && typeof lock.reason === 'string' && !!lock.reason.trim() && lock.reason.length <= 500
    && typeof lock.createdAt === 'string' && Number.isFinite(Date.parse(lock.createdAt))
    && (lock.ownerUserId === undefined || lock.ownerUserId === null || (typeof lock.ownerUserId === 'string' && !!lock.ownerUserId.trim()));
}

export function normalizeSpatialCadLocks(input: readonly unknown[], now = Date.now()): { locks: SpatialCadLockDto[]; issues: string[] } {
  const issues: string[] = [];
  if (input.length > MAX_SPATIAL_CAD_LOCKS) issues.push('too_many_locks');
  const byId = new Map<string, SpatialCadLockDto>();
  for (const value of input) {
    if (!validateSpatialCadLock(value)) { issues.push('invalid_lock'); continue; }
    if (Date.parse(value.createdAt) > now + 60_000) { issues.push('future_lock'); continue; }
    if (byId.has(value.id)) { issues.push('duplicate_lock'); continue; }
    // `canRelease` is request-user relative and therefore must never be
    // trusted from, or persisted with, a client supplied lock.
    const { canRelease: _ignored, ...persisted } = value;
    void _ignored;
    byId.set(value.id, { ...persisted, target: { ...value.target } });
  }
  return { locks: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), issues: [...new Set(issues)] };
}

/** Upsert server-derived user locks without interpreting omission as release.
 * Release is a separate, revision-bound operation so a stale/full-array client
 * can never remove a newer lock by replacement. */
export function mergeSpatialCadLocks(existing: readonly SpatialCadLockDto[], incomingHuman: readonly SpatialCadLockDto[], userId: string, scope?: string): { locks: SpatialCadLockDto[]; issues: string[] } {
  const normalized = normalizeSpatialCadLocks(incomingHuman);
  const issues = [...normalized.issues];
  if (!userId.trim()) return { locks: [...existing], issues: [...issues, 'invalid_owner'] };
  const byId = new Map<string, SpatialCadLockDto>(existing.map(lock => {
    const { canRelease: _ignored, ...persisted } = lock;
    void _ignored;
    return [lock.id, { ...persisted, target: { ...lock.target } }];
  }));
  for (const lock of normalized.locks) {
    const current = byId.get(lock.id);
    const allowed = lock.source === 'human' && lock.ownerUserId === userId && (!scope || lock.scope === scope)
      && (!current || (current.source === 'human' && current.ownerUserId === userId && current.scope === lock.scope));
    if (!allowed) { issues.push('client_lock_scope_violation'); continue; }
    byId.set(lock.id, lock);
  }
  return { locks: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), issues: [...new Set(issues)] };
}

export function canReleaseSpatialCadLock(lock: SpatialCadLockDto, userId: string, scope?: string): boolean {
  if (lock.source === 'authority') return false;
  return (lock.source === 'human' || lock.source === 'expert') && !!lock.ownerUserId
    && lock.ownerUserId === userId && (!scope || lock.scope === scope);
}

/** Explicit release is atomic: one foreign/authority/legacy id rejects the
 * complete request and preserves every lock. */
export function releaseSpatialCadLocks(existing: readonly SpatialCadLockDto[], releaseIds: readonly string[], userId: string, scope: string): { locks: SpatialCadLockDto[]; releasedIds: string[]; issues: string[] } {
  const ids = [...new Set(releaseIds)];
  if (!userId.trim() || !scope.trim() || !ids.length || ids.some(id => !id.trim())) {
    return { locks: [...existing], releasedIds: [], issues: ['invalid_lock_release'] };
  }
  const byId = new Map(existing.map(lock => [lock.id, lock]));
  const blocked = ids.filter(id => {
    const lock = byId.get(id);
    return !lock || !canReleaseSpatialCadLock(lock, userId, scope);
  });
  if (blocked.length) return { locks: [...existing], releasedIds: [], issues: ['lock_release_not_allowed'] };
  const releaseSet = new Set(ids);
  return { locks: existing.filter(lock => !releaseSet.has(lock.id)), releasedIds: ids, issues: [] };
}

export function spatialCadLockClientView(lock: SpatialCadLockDto, userId: string, scope: string): SpatialCadLockDto {
  const { ownerUserId: _ownerUserId, ...client } = lock;
  void _ownerUserId;
  return { ...client, target: { ...lock.target }, canRelease: canReleaseSpatialCadLock(lock, userId, scope) };
}
