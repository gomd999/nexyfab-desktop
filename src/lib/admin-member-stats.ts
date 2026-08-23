export interface AdminMemberPlanStat {
  plan: string;
  count: number;
}

type RawAdminMemberPlanStat = {
  plan: string | null | undefined;
  count: unknown;
};

function safeCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

/** PostgreSQL returns COUNT(*) as a string; normalize before any arithmetic. */
export function normalizeAdminMemberPlanStats(rows: RawAdminMemberPlanStat[]): AdminMemberPlanStat[] {
  return rows.map((row) => ({
    plan: row.plan?.trim().toLowerCase() || 'free',
    count: safeCount(row.count),
  }));
}

export function summarizeAdminMembers(rows: RawAdminMemberPlanStat[]) {
  const stats = normalizeAdminMemberPlanStats(rows);
  const total = stats.reduce((sum, row) => sum + row.count, 0);
  const paid = stats
    .filter((row) => row.plan !== 'free')
    .reduce((sum, row) => sum + row.count, 0);

  return {
    stats,
    total,
    paid,
    free: Math.max(0, total - paid),
    conversionRate: total > 0 ? (paid / total) * 100 : 0,
  };
}
