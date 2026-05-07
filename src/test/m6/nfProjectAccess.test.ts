import { describe, it, expect, vi } from 'vitest';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import type { DbAdapter } from '@/lib/db-adapter';

/** 소유자 분기만 단위 테스트 — 멤버 분기는 `ensureProjectMembersTable`가 동일 모듈 내 바인딩이라 스파이 없이 실 DB를 타기 때문. */
describe('M6 nfProjectAccess (owner branch)', () => {
  it('returns owner when project.user_id matches', async () => {
    const db = {
      queryOne: vi.fn().mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u-owner',
        name: 'X',
        updated_at: 1,
        created_at: 1,
      }),
    } as unknown as DbAdapter;

    const acc = await resolveProjectAccess(db, 'p1', 'u-owner');
    expect(acc?.role).toBe('owner');
    expect(acc?.canEdit).toBe(true);
    expect(acc?.ownerUserId).toBe('u-owner');
    expect(db.queryOne).toHaveBeenCalledTimes(1);
  });
});
