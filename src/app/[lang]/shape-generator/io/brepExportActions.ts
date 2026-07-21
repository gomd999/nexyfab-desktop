/**
 * brepExportActions — W5-H SAT/IGES/IFC 익스포트 버튼의 액션 계층.
 *
 * ShapeGeneratorInner 의 다른 익스포트 핸들러(handleExportGLTF 등)와 같은
 * 순서를 따르되, 거대 허브 파일 밖에서 단위 테스트할 수 있게 분리했다:
 *   geometry 확인 → freemium planLimits 게이트 → exporters 동적 임포트 →
 *   성공/거부 콜백. exporters 의 라이터는 자체 검증 실패 시 사유와 함께
 *   throw 하므로(생성≠검증), 여기서는 그 사유를 onRefused 로 그대로 전달만
 *   한다 — 요약하거나 성공으로 둔갑시키지 않는다.
 */

import type * as THREE from 'three';

export const BREP_EXPORT_FORMATS = ['sat', 'iges', 'ifc'] as const;
export type BrepExportFormat = (typeof BREP_EXPORT_FORMATS)[number];

export interface BrepExportCallbacks {
  /** planLimits.exportFormats 에 없음 → 호스트가 업그레이드 프롬프트. */
  onGated: () => void;
  /** 익스포트 시작 (호스트: setExportingFormat). */
  onStart: () => void;
  onSuccess: () => void;
  /** 라이터 거부/실패 — reason 은 exporters 가 던진 사유 원문. */
  onRefused: (reason: string) => void;
  /** 시작된 경우에만 호출 (호스트: setExportingFormat(null)). */
  onFinally: () => void;
}

export type BrepExportOutcome = 'no-geometry' | 'gated' | 'exported' | 'refused';

export async function runBrepExport(
  format: BrepExportFormat,
  geometry: THREE.BufferGeometry | null | undefined,
  allowedFormats: readonly string[],
  cb: BrepExportCallbacks,
  filename = 'shape-design',
): Promise<BrepExportOutcome> {
  if (!geometry) return 'no-geometry';
  if (!allowedFormats.includes(format)) {
    cb.onGated();
    return 'gated';
  }
  cb.onStart();
  try {
    const ex = await import('./exporters');
    if (format === 'sat') await ex.exportSAT(geometry, filename);
    else if (format === 'iges') await ex.exportIGES(geometry, filename);
    else await ex.exportIFC(geometry, filename);
    cb.onSuccess();
    return 'exported';
  } catch (err) {
    cb.onRefused(err instanceof Error ? err.message : String(err));
    return 'refused';
  } finally {
    cb.onFinally();
  }
}
