/**
 * cloudDoc/versionConflict.ts — D1 (Phase D) PDM 동시편집 409 helper.
 *
 * Cloud document metadata mutations (PUT /api/documents/[id]) can race
 * when two clients have the same document open and both try to rename /
 * reassign workspace. Without optimistic concurrency, the second write
 * silently overwrites the first.
 *
 * Contract:
 *   - Caller passes the version they observed (from the last GET).
 *   - Server compares against the row's current version.
 *   - Mismatch → 409 with `serverVersion` + `clientExpected` so the UI
 *     can show "this was updated elsewhere, reload to merge".
 *
 * Mirrors `src/lib/nfProjectConcurrency.ts::assertIfMatchUpdatedAt`
 * (M6 project endpoint) but uses the integer `version` counter that
 * cloud documents already track in `nf_documents.version`.
 *
 * Companion to `docs/wave-2-cloud-document-migration.md` §4.1 PUT
 * concurrency; documented in `docs/strategy/M6_PDM_LITE.md` D1 scope.
 */

export interface DocVersionConflictResult {
  readonly ok: false;
  readonly message: string;
  readonly serverVersion: number;
  readonly clientExpected: number;
}

export interface DocVersionOkResult {
  readonly ok: true;
}

export function assertIfMatchDocVersion(
  serverVersion: number,
  ifMatchVersion: number | undefined,
): DocVersionOkResult | DocVersionConflictResult {
  if (ifMatchVersion === undefined) return { ok: true };
  const a = Number(serverVersion);
  const b = Number(ifMatchVersion);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: true };
  if (a !== b) {
    return {
      ok: false,
      message:
        'Conflict: this document was updated by another session. Reload the document, then re-apply your change.',
      serverVersion: a,
      clientExpected: b,
    };
  }
  return { ok: true };
}
