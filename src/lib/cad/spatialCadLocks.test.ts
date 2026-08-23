import { describe, expect, it } from 'vitest';
import { canReleaseSpatialCadLock, mergeSpatialCadLocks, normalizeSpatialCadLocks, releaseSpatialCadLocks, spatialCadLockClientView } from './spatialCadLocks';

const human = { id: 'h1', target: { kind: 'parameter' as const, objectId: 'lengthM' }, scope: 'project:p1:civil:doc1', source: 'human' as const, reason: 'edit', createdAt: new Date().toISOString(), ownerUserId: 'u1' };
const authority = { ...human, id: 'a1', source: 'authority' as const, ownerUserId: null };

describe('spatial CAD lock contract', () => {
  it('sorts/dedupes and marks ownerless locks unreleasable', () => {
    const result = normalizeSpatialCadLocks([authority, human, human]);
    expect(result.locks.map(lock => lock.id)).toEqual(['a1', 'h1']);
    expect(result.issues).toContain('duplicate_lock');
    expect(result.locks.find(lock => lock.id === 'a1')).not.toHaveProperty('canRelease');
  });
  it('preserves omitted owner locks and only upserts the current user and scope', () => {
    const result = mergeSpatialCadLocks([{ ...human, id: 'old' }, authority], [human], 'u1');
    expect(result.locks.map(lock => lock.id)).toEqual(['a1', 'h1', 'old']);
    expect(canReleaseSpatialCadLock(authority, 'u1')).toBe(false);
    expect(canReleaseSpatialCadLock(human, 'u1')).toBe(true);
  });
  it('releases atomically by owner and scope and never releases authority or legacy locks', () => {
    const existing = [human, authority, { ...human, id: 'foreign', ownerUserId: 'u2' }];
    expect(releaseSpatialCadLocks(existing, ['h1'], 'u1', human.scope).releasedIds).toEqual(['h1']);
    expect(releaseSpatialCadLocks(existing, ['h1', 'foreign'], 'u1', human.scope)).toMatchObject({ locks: existing, releasedIds: [], issues: ['lock_release_not_allowed'] });
    expect(releaseSpatialCadLocks(existing, ['a1'], 'u1', human.scope).issues).toEqual(['lock_release_not_allowed']);
  });
  it('derives release visibility for the authenticated user without exposing owner identity', () => {
    const view = spatialCadLockClientView(human, 'u1', human.scope);
    expect(view.canRelease).toBe(true);
    expect(view).not.toHaveProperty('ownerUserId');
    expect(normalizeSpatialCadLocks([{ ...human, canRelease: true }]).locks[0]).not.toHaveProperty('canRelease');
  });
});
