/**
 * M6 — 클라우드 프로젝트 PATCH 낙관적 동시성 (다른 탭·기기에서 먼저 저장된 경우 충돌 감지).
 */

export function assertIfMatchUpdatedAt(
  serverUpdatedAt: number | string,
  ifMatchUpdatedAt: number | string | undefined,
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
  // The Postgres adapter returns BIGINT columns as decimal strings. Treat
  // those as valid revision tokens, but never silently bypass the guard for
  // malformed or unsafe values.
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    return {
      ok: false,
      message: 'Conflict: the project revision token is invalid. Reload the project, then save again.',
      serverUpdatedAt: Number.isSafeInteger(a) ? a : -1,
      clientExpected: Number.isSafeInteger(b) ? b : -1,
    };
  }
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
