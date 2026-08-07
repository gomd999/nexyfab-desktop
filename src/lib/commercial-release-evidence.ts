export interface ReleaseEvidenceIssue { code: string; message: string }
type Env = Record<string, string | undefined>;

function ageIssue(env: Env, key: string, maxAgeDays: number, now: number): ReleaseEvidenceIssue | null {
  const value = env[key];
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return { code: `${key}.missing`, message: `${key} must be a valid ISO timestamp` };
  const age = now - parsed;
  if (age < 0 || age > maxAgeDays * 86_400_000) {
    return { code: `${key}.stale`, message: `${key} must be within ${maxAgeDays} days` };
  }
  return null;
}

export function commercialReleaseEvidenceIssues(env: Env, now = Date.now()): ReleaseEvidenceIssue[] {
  const issues: ReleaseEvidenceIssue[] = [];
  if (env.NEXYFAB_COMMERCIAL_MODE !== '1') {
    issues.push({ code: 'commercial_mode.disabled', message: 'NEXYFAB_COMMERCIAL_MODE must be 1' });
  }
  for (const key of ['ONCALL_OWNER', 'SUPPORT_OWNER', 'ROLLBACK_OWNER']) {
    if (!env[key]?.trim()) issues.push({ code: `${key}.missing`, message: `${key} must name an accountable owner` });
  }
  for (const issue of [
    ageIssue(env, 'LAST_RESTORE_DRILL_AT', 100, now),
    ageIssue(env, 'LAST_PAYMENT_REHEARSAL_AT', 30, now),
    ageIssue(env, 'LEGAL_POLICY_APPROVED_AT', 365, now),
  ]) if (issue) issues.push(issue);
  return issues;
}
