import { describe, it, expect } from 'vitest';
import { normalizeInviteEmail, parseMemberInviteRole } from '@/lib/nfProjectMemberInput';

describe('M6 project member invite input', () => {
  it('normalizes email', () => {
    expect(normalizeInviteEmail('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('parses member role', () => {
    expect(parseMemberInviteRole('editor')).toBe('editor');
    expect(parseMemberInviteRole('viewer')).toBe('viewer');
    expect(parseMemberInviteRole('admin')).toBe(null);
    expect(parseMemberInviteRole(undefined)).toBe(null);
  });
});
