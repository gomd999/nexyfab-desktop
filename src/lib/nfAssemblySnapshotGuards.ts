/**
 * 클라이언트/스크립트에서 `.nfab` JSON 문자열이 어셈블리 스냅샷 형태인지 가볍게 검사(스키마 전체 검증 아님).
 */
export function assemblySnapshotJsonLooksValid(raw: string): boolean {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    if ('placedParts' in o && !Array.isArray(o.placedParts)) return false;
    if ('mates' in o && !Array.isArray(o.mates)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * `serializeProject` → `toJsonString` 결과가 저장·다운로드 전에 최소 형태를 갖는지 검사.
 * 전체 스키마 검증은 아님(`parseProject`가 로드 시 담당).
 */
export function nfabProjectExportJsonLooksValid(raw: string): boolean {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    if (o.magic !== 'nfab') return false;
    if (typeof o.version !== 'number') return false;
    if (!o.tree || typeof o.tree !== 'object' || Array.isArray(o.tree)) return false;
    if (!o.scene || typeof o.scene !== 'object' || Array.isArray(o.scene)) return false;
    const a = o.assembly;
    if (a !== undefined && (typeof a !== 'object' || a === null || Array.isArray(a))) return false;
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      const rec = a as Record<string, unknown>;
      if ('placedParts' in rec && !Array.isArray(rec.placedParts)) return false;
      if ('mates' in rec && !Array.isArray(rec.mates)) return false;
      if ('bodies' in rec && rec.bodies !== undefined && !Array.isArray(rec.bodies)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
