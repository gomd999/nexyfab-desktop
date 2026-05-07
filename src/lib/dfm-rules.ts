/**
 * dfm-rules.ts — pure rule-based manufacturability checker.
 *
 * Extracted from /api/nexyfab/dfm-check so non-HTTP callers (CLI, batch,
 * future CAD analysis pipelines) can reuse it. The route handler now
 * delegates here and adds auth/persistence/logging on top.
 *
 * Rules are intentionally conservative — false negatives hurt more than
 * false positives at this stage. Every threshold should be revisitable:
 * we record the input + output to `nf_dfm_check` so we can later mine
 * "warnings the user ignored without consequence" and tune the rules.
 */

export interface DfmCheckItem {
  level: 'error' | 'warning' | 'info';
  param: string;
  message: string;
  value?: number;
}

export interface DfmCheckResult {
  issues:   number;
  warnings: number;
  items:    DfmCheckItem[];
}

export function runDfmChecks(params: Record<string, number>): DfmCheckResult {
  const items: DfmCheckItem[] = [];

  const wallThickness = params.wallThickness ?? params.wall_thickness ?? params.thickness ?? null;
  if (wallThickness !== null) {
    if (wallThickness < 0.8) {
      items.push({ level: 'error', param: 'wallThickness',
        message: `벽 두께 ${wallThickness.toFixed(2)}mm — 최소 0.8mm 이상 필요`,
        value: wallThickness });
    } else if (wallThickness < 1.5) {
      items.push({ level: 'warning', param: 'wallThickness',
        message: `벽 두께 ${wallThickness.toFixed(2)}mm — 1.5mm 미만은 파손 위험 있음`,
        value: wallThickness });
    }
  }

  const holeDiameter = params.holeDiameter ?? params.hole_diameter ?? params.holeDiam ?? null;
  if (holeDiameter !== null) {
    if (holeDiameter < 0.5) {
      items.push({ level: 'error', param: 'holeDiameter',
        message: `홀 직경 ${holeDiameter.toFixed(2)}mm — 최소 0.5mm 이상 필요`,
        value: holeDiameter });
    } else if (holeDiameter < 1.0) {
      items.push({ level: 'warning', param: 'holeDiameter',
        message: `홀 직경 ${holeDiameter.toFixed(2)}mm — 1mm 미만 홀은 공구 파손 위험`,
        value: holeDiameter });
    }
  }

  const draftAngle = params.draftAngle ?? params.draft_angle ?? params.draft ?? null;
  if (draftAngle !== null && draftAngle < 1) {
    items.push({ level: 'warning', param: 'draftAngle',
      message: `구배각 ${draftAngle.toFixed(1)}° — 사출 성형 시 최소 1° 권장`,
      value: draftAngle });
  }

  const radius = params.radius ?? params.fillet ?? params.cornerRadius ?? null;
  if (radius !== null && radius < 0.3) {
    items.push({ level: 'warning', param: 'radius',
      message: `모서리 반경 ${radius.toFixed(2)}mm — 0.3mm 미만은 응력 집중 위험`,
      value: radius });
  }

  const height = params.height ?? params.h ?? null;
  const width  = params.width  ?? params.w ?? params.diameter ?? null;
  if (height !== null && width !== null && width > 0) {
    const aspect = height / width;
    if (aspect > 5) {
      items.push({ level: 'error', param: 'aspectRatio',
        message: `종횡비 ${aspect.toFixed(1)} — 5 초과 시 가공 불안정`,
        value: aspect });
    } else if (aspect > 3) {
      items.push({ level: 'warning', param: 'aspectRatio',
        message: `종횡비 ${aspect.toFixed(1)} — 3 초과 시 지지대 필요 가능성`,
        value: aspect });
    }
  }

  const pitch = params.pitch ?? null;
  if (pitch !== null && pitch > 0 && pitch < 0.2) {
    items.push({ level: 'warning', param: 'pitch',
      message: `나사 피치 ${pitch.toFixed(2)}mm — 매우 미세, 특수 가공 필요`,
      value: pitch });
  }

  return {
    issues:   items.filter(i => i.level === 'error').length,
    warnings: items.filter(i => i.level === 'warning').length,
    items,
  };
}
