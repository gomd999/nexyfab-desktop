/** Shared validation for project member invite API + tests. */

export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseMemberInviteRole(r: unknown): 'editor' | 'viewer' | null {
  if (r === 'editor' || r === 'viewer') return r;
  return null;
}
