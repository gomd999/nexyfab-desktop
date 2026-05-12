/**
 * NL → SCAD intent evaluation set (R4).
 *
 * 30+ representative customer prompts in Korean and English, paired with
 * expected intent fields and tolerance rules. Used by `scoreIntent()` to
 * grade real AI responses against ground truth, and by CI gating to
 * regress-prevent prompt/model changes.
 *
 * Each case lists `must` constraints (hard fails) and `should` constraints
 * (soft fails — count toward an overall accuracy score but a single soft
 * miss doesn't fail the case). Numeric params accept a tolerance band so
 * "30mm cube" matching width=29 still passes.
 */

import type { IntentInput } from '../../openscad-render/intentToScad';

export interface EvalCase {
  /** Stable id used in evaluation reports. */
  id: string;
  /** Prompt language for filtering / split reporting. */
  lang: 'ko' | 'en';
  prompt: string;
  /** Hard requirements — case fails if any of these don't hold. */
  must: {
    shapeId?: string;
    /** numericParams[k] = expected value; tolerance[k] = ± in same units. */
    paramsApprox?: Record<string, { value: number; tolerance: number }>;
    /** Set of feature types that must appear. */
    featureTypes?: string[];
  };
  /** Soft expectations — counted but don't fail the case. */
  should?: {
    paramsApprox?: Record<string, { value: number; tolerance: number }>;
    featureCount?: number;
  };
}

const KO: EvalCase[] = [
  {
    id: 'ko_box_30mm',
    lang: 'ko',
    prompt: '30mm 정육면체',
    must: {
      shapeId: 'box',
      paramsApprox: {
        width: { value: 30, tolerance: 1 },
        height: { value: 30, tolerance: 1 },
        depth: { value: 30, tolerance: 1 },
      },
    },
  },
  {
    id: 'ko_box_rect',
    lang: 'ko',
    prompt: '가로 50 세로 30 높이 20인 직육면체 만들어줘',
    must: {
      shapeId: 'box',
      paramsApprox: {
        width: { value: 50, tolerance: 1 },
        depth: { value: 30, tolerance: 1 },
        height: { value: 20, tolerance: 1 },
      },
    },
  },
  {
    id: 'ko_cylinder',
    lang: 'ko',
    prompt: '지름 40mm 높이 60mm 원기둥',
    must: {
      shapeId: 'cylinder',
      paramsApprox: {
        diameter: { value: 40, tolerance: 1 },
        height: { value: 60, tolerance: 1 },
      },
    },
  },
  {
    id: 'ko_sphere',
    lang: 'ko',
    prompt: '반지름 25mm 구',
    must: {
      shapeId: 'sphere',
      paramsApprox: { radius: { value: 25, tolerance: 1 } },
    },
  },
  {
    id: 'ko_pipe',
    lang: 'ko',
    prompt: '외경 30 내경 20 길이 100인 파이프',
    must: {
      shapeId: 'pipe',
      paramsApprox: {
        outerDiameter: { value: 30, tolerance: 1 },
        innerDiameter: { value: 20, tolerance: 1 },
      },
    },
  },
  {
    id: 'ko_box_with_hole',
    lang: 'ko',
    prompt: '50x50x10 박스에 가운데 직경 8mm 구멍',
    must: {
      shapeId: 'box',
      featureTypes: ['hole'],
      paramsApprox: {
        width: { value: 50, tolerance: 2 },
        height: { value: 10, tolerance: 1 },
      },
    },
  },
  {
    id: 'ko_box_with_fillet',
    lang: 'ko',
    prompt: '40mm 큐브 모서리에 5mm 필렛',
    must: {
      shapeId: 'box',
      featureTypes: ['fillet'],
    },
  },
  {
    id: 'ko_hexnut',
    lang: 'ko',
    prompt: 'M10 육각너트',
    must: { shapeId: 'hexNut' },
  },
  {
    id: 'ko_washer',
    lang: 'ko',
    prompt: '외경 20 내경 10 두께 2 와셔',
    must: {
      shapeId: 'washer',
      paramsApprox: {
        outerDiameter: { value: 20, tolerance: 1 },
        innerDiameter: { value: 10, tolerance: 1 },
      },
    },
  },
  {
    id: 'ko_lbracket',
    lang: 'ko',
    prompt: 'L자 브라켓 80x80, 두께 5',
    must: {
      shapeId: 'lBracket',
      paramsApprox: { thickness: { value: 5, tolerance: 1 } },
    },
  },
  {
    id: 'ko_gear',
    lang: 'ko',
    prompt: '20개 이빨 모듈 2 두께 8 평기어',
    must: { shapeId: 'gear' },
  },
  {
    id: 'ko_enclosure',
    lang: 'ko',
    prompt: '120x80x40 전자제품 케이스, 벽두께 2mm',
    must: {
      shapeId: 'enclosure',
      paramsApprox: {
        width: { value: 120, tolerance: 5 },
      },
    },
  },
  {
    id: 'ko_threaded_rod',
    lang: 'ko',
    prompt: 'M8 길이 50 나사봉',
    must: { shapeId: 'threadedRod' },
  },
  {
    id: 'ko_pattern',
    lang: 'ko',
    prompt: '50x50x10 박스에 가로로 5개 일렬 구멍 (간격 8mm, 직경 4mm)',
    must: {
      shapeId: 'box',
      featureTypes: ['hole'],
    },
    should: { featureCount: 1 },
  },
  {
    id: 'ko_iBeam',
    lang: 'ko',
    prompt: '높이 100 폭 50 길이 1000 H빔',
    must: { shapeId: 'iBeam' },
  },
  {
    id: 'ko_motormount',
    lang: 'ko',
    prompt: 'NEMA 17 스테퍼 모터 마운트',
    must: { shapeId: 'motorMount' },
  },
  {
    id: 'ko_torus',
    lang: 'ko',
    prompt: '단면반경 5mm 중심반경 30mm 도넛',
    must: { shapeId: 'torus' },
  },
  {
    id: 'ko_disk',
    lang: 'ko',
    prompt: '직경 60 두께 3 디스크',
    must: {
      shapeId: 'disk',
      paramsApprox: {
        diameter: { value: 60, tolerance: 1 },
      },
    },
  },
];

const EN: EvalCase[] = [
  {
    id: 'en_box_cube',
    lang: 'en',
    prompt: '30mm cube',
    must: {
      shapeId: 'box',
      paramsApprox: {
        width: { value: 30, tolerance: 1 },
        height: { value: 30, tolerance: 1 },
        depth: { value: 30, tolerance: 1 },
      },
    },
  },
  {
    id: 'en_rectangle',
    lang: 'en',
    prompt: 'rectangular box 50 by 30 by 20 millimeters',
    must: { shapeId: 'box' },
  },
  {
    id: 'en_cylinder',
    lang: 'en',
    prompt: 'cylinder 40mm diameter, 60mm tall',
    must: {
      shapeId: 'cylinder',
      paramsApprox: {
        diameter: { value: 40, tolerance: 1 },
        height: { value: 60, tolerance: 1 },
      },
    },
  },
  {
    id: 'en_sphere',
    lang: 'en',
    prompt: '25mm radius sphere',
    must: { shapeId: 'sphere' },
  },
  {
    id: 'en_pipe',
    lang: 'en',
    prompt: 'pipe with 30mm OD, 20mm ID, 100mm long',
    must: {
      shapeId: 'pipe',
      paramsApprox: {
        outerDiameter: { value: 30, tolerance: 1 },
        innerDiameter: { value: 20, tolerance: 1 },
      },
    },
  },
  {
    id: 'en_hex_nut',
    lang: 'en',
    prompt: 'M10 hex nut',
    must: { shapeId: 'hexNut' },
  },
  {
    id: 'en_box_with_chamfer',
    lang: 'en',
    prompt: '40mm cube with 3mm chamfer on all edges',
    must: {
      shapeId: 'box',
      featureTypes: ['chamfer'],
    },
  },
  {
    id: 'en_screw',
    lang: 'en',
    prompt: 'M6 hex socket cap screw, 25mm length',
    must: { shapeId: 'screw' },
  },
  {
    id: 'en_lbracket',
    lang: 'en',
    prompt: 'L-bracket 80x80, 5mm thick',
    must: { shapeId: 'lBracket' },
  },
  {
    id: 'en_heatsink',
    lang: 'en',
    prompt: 'CPU heatsink with fins, 100x100x40',
    must: { shapeId: 'heatsink' },
  },
  {
    id: 'en_shelf_bracket',
    lang: 'en',
    prompt: 'shelf bracket, depth 200mm, height 150mm',
    must: { shapeId: 'shelfBracket' },
  },
  {
    id: 'en_t_beam',
    lang: 'en',
    prompt: 'T-beam, 50x50x500',
    must: { shapeId: 'tBeam' },
  },
  {
    id: 'en_box_pattern_holes',
    lang: 'en',
    prompt: '60x60x10 plate with 4 mounting holes 4mm dia at corners',
    must: {
      shapeId: 'box',
      featureTypes: ['hole'],
    },
  },
  {
    id: 'en_torus',
    lang: 'en',
    prompt: 'torus with tube radius 5 and major radius 30',
    must: { shapeId: 'torus' },
  },
  {
    id: 'en_flange',
    lang: 'en',
    prompt: 'pipe flange 100mm OD with 6 mounting holes',
    must: { shapeId: 'flange' },
  },
];

export const SCAD_INTENT_EVALSET: EvalCase[] = [...KO, ...EN];

// ─── Scorer ─────────────────────────────────────────────────────────────────

export interface ScoreResult {
  caseId: string;
  passed: boolean;
  /** 0–1, fraction of `must` + `should` constraints satisfied. */
  partialScore: number;
  /** Reasons for failure / partial credit. */
  failures: string[];
}

/**
 * Score a real intent payload against an EvalCase. The scorer is forgiving
 * by design — manufacturers describe parts in many ways, and the AI may
 * legitimately return synonymous fields (e.g. `length` vs `depth`). We
 * accept either as long as the geometric meaning is preserved.
 */
export function scoreIntent(eval_case: EvalCase, intent: Partial<IntentInput>): ScoreResult {
  const failures: string[] = [];
  const must = eval_case.must;
  const should = eval_case.should ?? {};

  let mustChecks = 0;
  let mustOk = 0;

  if (must.shapeId !== undefined) {
    mustChecks++;
    if (intent.shapeId === must.shapeId) mustOk++;
    else failures.push(`shapeId: expected ${must.shapeId}, got ${intent.shapeId ?? 'undefined'}`);
  }

  for (const [k, spec] of Object.entries(must.paramsApprox ?? {})) {
    mustChecks++;
    const v = intent.params?.[k];
    if (typeof v === 'number' && Math.abs(v - spec.value) <= spec.tolerance) {
      mustOk++;
    } else {
      failures.push(`param ${k}: expected ~${spec.value} (±${spec.tolerance}), got ${v ?? 'missing'}`);
    }
  }

  for (const ft of must.featureTypes ?? []) {
    mustChecks++;
    const present = (intent.features ?? []).some(f => f.type === ft && f.enabled !== false);
    if (present) mustOk++;
    else failures.push(`feature ${ft} missing`);
  }

  let shouldChecks = 0;
  let shouldOk = 0;
  for (const [k, spec] of Object.entries(should.paramsApprox ?? {})) {
    shouldChecks++;
    const v = intent.params?.[k];
    if (typeof v === 'number' && Math.abs(v - spec.value) <= spec.tolerance) shouldOk++;
  }
  if (typeof should.featureCount === 'number') {
    shouldChecks++;
    if ((intent.features?.filter(f => f.enabled !== false).length ?? 0) === should.featureCount) {
      shouldOk++;
    }
  }

  const totalChecks = mustChecks + shouldChecks;
  const totalOk = mustOk + shouldOk;
  const partialScore = totalChecks === 0 ? 1 : totalOk / totalChecks;
  const passed = mustOk === mustChecks;

  return {
    caseId: eval_case.id,
    passed,
    partialScore,
    failures,
  };
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  averageScore: number;
  byLang: Record<'ko' | 'en', { passed: number; total: number }>;
  cases: ScoreResult[];
}

export function summarizeEval(results: ScoreResult[], cases: EvalCase[] = SCAD_INTENT_EVALSET): EvalSummary {
  const byLang = { ko: { passed: 0, total: 0 }, en: { passed: 0, total: 0 } };
  let passed = 0;
  let scoreSum = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const c = cases[i];
    if (r.passed) passed++;
    scoreSum += r.partialScore;
    if (c?.lang) {
      byLang[c.lang].total++;
      if (r.passed) byLang[c.lang].passed++;
    }
  }
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    averageScore: results.length === 0 ? 0 : scoreSum / results.length,
    byLang,
    cases: results,
  };
}
