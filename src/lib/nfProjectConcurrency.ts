/**
 * M6 — 클라우드 프로젝트 PATCH 낙관적 동시성 (다른 탭·기기에서 먼저 저장된 경우 충돌 감지).
 */

export function assertIfMatchUpdatedAt(
  serverUpdatedAt: number,
  ifMatchUpdatedAt: number | undefined,
):
  | { ok: true }
  | {
      ok: false;
      message: string;
      serverUpdatedAt: number;
      clientExpected: number;
    } {
  if (ifMatchUpdatedAt === undefined) return { ok: true };
  const a = Number(serverUpdatedAt);
  const b = Number(ifMatchUpdatedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: true };
  if (a !== b) {
    return {
      ok: false,
      message:
        'Conflict: this project was updated elsewhere. Reload the project from the dashboard, then save again.',
      serverUpdatedAt: a,
      clientExpected: b,
    };
  }
  return { ok: true };
}
