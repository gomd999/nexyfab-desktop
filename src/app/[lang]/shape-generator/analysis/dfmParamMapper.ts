/**
 * dfmParamMapper — DFMIssue → param key 휴리스틱 매핑
 *
 * DFMIssue에는 paramKey 필드가 없으므로 issue.type과 현재 shape params를
 * 교차해서 관련 파라미터를 추론합니다.
 * 반환값: paramKey → { severity, message } 맵
 */

import type { DFMResult, DFMIssue } from './dfmAnalysis';

export interface DFMParamWarning {
  severity: 'error' | 'warning' | 'info';
  message: string;
  issueType: string;
}

/**
 * issue.type → 연관 param key 후보 목록 (우선순위 순)
 * 매칭은 실제 params 객체에 해당 key가 존재하는지로 필터링됩니다.
 */
/** Keys ordered to match `DFMPanel` FIX_SUGGESTIONS / 라이브러리 파트 camelCase first. */
const ISSUE_TYPE_TO_PARAM_CANDIDATES: Record<string, string[]> = {
  thin_wall:      ['wallThickness', 'wall_thickness', 'thickness', 'shellThickness', 'depth', 'width', 'height'],
  uniform_wall:   ['wallThickness', 'wall_thickness', 'thickness', 'shellThickness'],
  draft_angle:    ['draftAngle', 'draft_angle', 'draft'],
  aspect_ratio:   ['height', 'length', 'width', 'depth'],
  deep_pocket:    ['pocketDepthRatio', 'pocketDepth', 'depth', 'height'],
  sharp_corner:   ['filletRadius', 'fillet_radius', 'cornerRadius', 'corner_radius', 'radius'],
  undercut:       ['undercutRelief', 'undercut', 'depth', 'grooveDepth', 'groove_depth'],
  tool_access:    ['filletRadius', 'width', 'depth', 'slot_width', 'groove_width', 'radius'],
  overhang:       ['height', 'depth', 'width', 'layerHeight', 'layer_height'],
  bridge:         ['height', 'depth', 'width'],
  support_volume: ['height', 'depth', 'width', 'layerHeight', 'layer_height'],
};

/**
 * DFMResult[] + 현재 shape params → param key별 경고 맵
 * 가장 심각한 이슈만 param당 1개 남깁니다.
 */
export function mapDFMToParams(
  dfmResults: DFMResult[] | null | undefined,
  params: Record<string, number>,
): Record<string, DFMParamWarning> {
  if (!dfmResults || dfmResults.length === 0) return {};

  const paramKeys = Object.keys(params);
  const warnings: Record<string, DFMParamWarning> = {};

  // severity 우선순위 — error > warning > info
  const SEVERITY_RANK: Record<string, number> = { error: 3, warning: 2, info: 1 };

  for (const result of dfmResults) {
    for (const issue of result.issues) {
      const candidates = ISSUE_TYPE_TO_PARAM_CANDIDATES[issue.type] ?? [];
      // 실제 params에 존재하는 첫 번째 후보 key 선택
      const matchedKey = candidates.find(c => paramKeys.includes(c));
      if (!matchedKey) continue;

      const existing = warnings[matchedKey];
      const incomingRank = SEVERITY_RANK[issue.severity] ?? 0;
      const existingRank = existing ? (SEVERITY_RANK[existing.severity] ?? 0) : 0;

      // 더 심각한 이슈로만 덮어씀
      if (!existing || incomingRank > existingRank) {
        warnings[matchedKey] = {
          severity: issue.severity,
          message: issue.suggestion || issue.description,
          issueType: issue.type,
        };
      }
    }
  }

  return warnings;
}

/**
 * dfmResults에서 전체 최저 점수를 반환합니다.
 * results가 없으면 null.
 */
export function getBestDFMScore(
  dfmResults: DFMResult[] | null | undefined,
): number | null {
  if (!dfmResults || dfmResults.length === 0) return null;
  return Math.max(...dfmResults.map(r => r.score));
}

/**
 * dfmResults에서 상위 N개 이슈 요약을 반환합니다.
 */
export function getTopDFMIssues(
  dfmResults: DFMResult[] | null | undefined,
  limit = 5,
): Array<{ type: string; severity: string; description: string }> {
  if (!dfmResults || dfmResults.length === 0) return [];

  const SEVERITY_RANK: Record<string, number> = { error: 3, warning: 2, info: 1 };

  return dfmResults
    .flatMap(r => r.issues)
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, limit)
    .map(i => ({ type: i.type, severity: i.severity, description: i.description }));
}
