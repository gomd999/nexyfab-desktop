import type { GuidedRequirementGate } from '@/lib/ai/guidedDesignBrief';
import type { FeatureEditIntent } from './featureEditDispatcher';

export const GUIDED_LOCAL_MECHANICAL_PLAN = 'nexyfab.guided-local-mechanical-plan.v1' as const;

interface Measurement {
  value: number;
  unit: string;
}

export type GuidedLocalMechanicalPlanResult =
  | {
      ok: true;
      summary: string;
      payload: {
        planner: typeof GUIDED_LOCAL_MECHANICAL_PLAN;
        aiModelExecution: 'NOT_RUN';
        units: 'mm';
        authoritativeRequirements: Record<string, { value: unknown; sourceRef: string }>;
        intents: FeatureEditIntent[];
        comparisonMetrics: Array<{
          id: string;
          label: string;
          value: number;
          unit: 'mm';
          status: 'PREVIEW';
        }>;
      };
    }
  | { ok: false; reason: string; nextQuestion: string };

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`(mm|cm|in|inch(?:es)?)`;

function toMillimetres(measurement: Measurement): number | null {
  const value = measurement.value * (measurement.unit === 'cm' ? 10 : measurement.unit.startsWith('in') ? 25.4 : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1_000_000) / 1_000_000 : null;
}

function firstMeasurement(text: string, label: RegExp): Measurement | null {
  const after = new RegExp(`${label.source}\\s*[:=]?\\s*${NUMBER}\\s*${UNIT}`, 'i').exec(text);
  if (after) return { value: Number(after[1]), unit: after[2]!.toLowerCase() };
  const before = new RegExp(`${NUMBER}\\s*${UNIT}\\s*${label.source}`, 'i').exec(text);
  return before ? { value: Number(before[1]), unit: before[2]!.toLowerCase() } : null;
}

function bracketLegs(text: string): [number, number] | null {
  const match = new RegExp(`${NUMBER}\\s*${UNIT}\\s*[x×]\\s*${NUMBER}\\s*(mm|cm|in|inch(?:es)?)?\\s*(?:legs?|arms?|다리)`, 'i').exec(text);
  if (!match) return null;
  const first = toMillimetres({ value: Number(match[1]), unit: match[2]!.toLowerCase() });
  const second = toMillimetres({ value: Number(match[3]), unit: (match[4] ?? match[2])!.toLowerCase() });
  return first && second ? [first, second] : null;
}

function gateValue(gate: GuidedRequirementGate, key: string): { value: unknown; sourceRef: string } | null {
  const item = gate.items.find(candidate => candidate.domain === 'mechanical' && candidate.key === key);
  return item?.state === 'AUTHORITATIVE' && item.sourceRef?.trim() && item.value !== undefined
    ? { value: item.value, sourceRef: item.sourceRef }
    : null;
}

/**
 * Deliberately narrow, deterministic first product path. It never invents a
 * dimension or silently converts an assumption into exact CAD. Unsupported or
 * ambiguous briefs return the exact next question instead of a plausible model.
 */
export function buildGuidedLocalMechanicalPlan(
  gate: GuidedRequirementGate,
  originalPrompt: string,
): GuidedLocalMechanicalPlanResult {
  if (!gate.ready || gate.requestedStage === 'concept') {
    return { ok: false, reason: 'requirements_not_authoritative', nextQuestion: 'Confirm every required exact-design input before creating a CAD preview.' };
  }
  const functional = gateValue(gate, 'functional_requirements');
  const dimensions = gateValue(gate, 'critical_dimensions');
  const materialProcess = gateValue(gate, 'material_process');
  if (!functional || !dimensions || !materialProcess) {
    return { ok: false, reason: 'requirements_not_authoritative', nextQuestion: 'Confirm function, critical dimensions, material, and manufacturing process.' };
  }

  const sourceText = `${originalPrompt}\n${String(functional.value)}\n${String(dimensions.value)}\n${String(materialProcess.value)}`;
  if (!/(?:l[\s-]?bracket|angle bracket|엘\s*브라켓|l형\s*브라켓|브라켓)/i.test(sourceText)) {
    return { ok: false, reason: 'local_shape_not_supported', nextQuestion: 'Local guided CAD currently supports an L-bracket. Name the L-bracket and its two leg sizes.' };
  }
  const legs = bracketLegs(sourceText);
  if (!legs) {
    return { ok: false, reason: 'missing_bracket_legs', nextQuestion: 'Provide both L-bracket leg sizes, for example “100 mm × 50 mm legs”.' };
  }
  const depthMeasurement = firstMeasurement(sourceText, /(?:length|depth|extrusion length|길이|압출 길이)/);
  const thicknessMeasurement = firstMeasurement(sourceText, /(?:thickness|wall thickness|두께)/);
  const depth = depthMeasurement ? toMillimetres(depthMeasurement) : null;
  const thickness = thicknessMeasurement ? toMillimetres(thicknessMeasurement) : null;
  if (!depth) {
    return { ok: false, reason: 'missing_bracket_length', nextQuestion: 'Provide the bracket extrusion length, for example “length 40 mm”.' };
  }
  if (!thickness) {
    return { ok: false, reason: 'missing_bracket_thickness', nextQuestion: 'Provide the bracket thickness, for example “thickness 5 mm”.' };
  }
  if (thickness >= Math.min(...legs)) {
    return { ok: false, reason: 'invalid_bracket_thickness', nextQuestion: 'Thickness must be smaller than both leg sizes. Confirm a manufacturable thickness.' };
  }
  const materialText = String(materialProcess.value);
  if (!/(?:alumin(?:um|ium)|알루미늄)/i.test(materialText)) {
    return { ok: false, reason: 'unsupported_local_material', nextQuestion: 'For this local path, confirm an aluminum grade and manufacturing process.' };
  }
  if (!/(?:cnc|mill(?:ed|ing)?|machin(?:ed|ing)?|밀링|절삭|가공)/i.test(materialText)) {
    return { ok: false, reason: 'missing_manufacturing_process', nextQuestion: 'Confirm the manufacturing process, for example “CNC milling”.' };
  }

  const params = { width: legs[0], height: legs[1], depth, thickness };
  return {
    ok: true,
    summary: `Local deterministic L-bracket · ${legs[0]} × ${legs[1]} × ${depth} mm · t ${thickness} mm`,
    payload: {
      planner: GUIDED_LOCAL_MECHANICAL_PLAN,
      aiModelExecution: 'NOT_RUN',
      units: 'mm',
      authoritativeRequirements: { functional_requirements: functional, critical_dimensions: dimensions, material_process: materialProcess },
      intents: [{ kind: 'set_base_shape', shapeId: 'lBracket', params }],
      comparisonMetrics: [
        { id: 'leg-a', label: 'Leg A', value: legs[0], unit: 'mm', status: 'PREVIEW' },
        { id: 'leg-b', label: 'Leg B', value: legs[1], unit: 'mm', status: 'PREVIEW' },
        { id: 'length', label: 'Length', value: depth, unit: 'mm', status: 'PREVIEW' },
        { id: 'thickness', label: 'Thickness', value: thickness, unit: 'mm', status: 'PREVIEW' },
      ],
    },
  };
}
