import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import { deleteNexyfabAccountData } from './deleteAccountData';

describe('deleteNexyfabAccountData', () => {
  it('removes non-cascading funnel data before the user row', async () => {
    const statements: string[] = [];
    const db = {
      execute: vi.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return { changes: sql.includes('DELETE FROM nf_users') ? 1 : 0 };
      }),
    } as unknown as DbAdapter;

    await deleteNexyfabAccountData(db, 'user-1');

    const funnel = statements.findIndex(sql => sql.startsWith('DELETE FROM nf_funnel_event'));
    const user = statements.findIndex(sql => sql.startsWith('DELETE FROM nf_users'));
    expect(funnel).toBeGreaterThanOrEqual(0);
    expect(user).toBeGreaterThan(funnel);
    expect(statements).toContain('UPDATE nf_support_tickets SET assigned_to = NULL WHERE assigned_to = ?');
  });

  it('fails if the user row was not deleted', async () => {
    const db = {
      execute: vi.fn(async () => ({ changes: 0 })),
    } as unknown as DbAdapter;

    await expect(deleteNexyfabAccountData(db, 'missing')).rejects.toThrow(/expected one user row/);
  });
});
