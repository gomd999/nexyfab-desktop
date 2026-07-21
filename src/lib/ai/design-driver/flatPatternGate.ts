/**
 * design-driver/flatPatternGate — WB-2: 판금 전개 게이트 (sheet-metal unfold).
 *
 * Consumption vs self-implementation (보고 의무 — 명세):
 *
 *   CONSUMED — the REAL sheet-metal engine (features/sheetMetal): a base-panel
 *   BoxGeometry is built and each declared op is applied via `applyBend` /
 *   `applyFlange` (which stamp the exact bend history), then `generateFlatPattern`
 *   unfolds the stack. The developed (flat) length + per-bend allowances come
 *   from that engine's material K-factor tables (sheetMetalTables) — they are
 *   MEASURED by the unfold, never asserted here (실행하지 않은 판정은 판정이 아니다).
 *
 *   SELF-IMPLEMENTED — the flat DXF assembly (CUT outline + BEND fold lines via
 *   netDxf.segmentsToDxf) and the gate verdict: a manufacturability block on any
 *   error-severity bend warning (min-radius / angle-range from validateBend), and
 *   an optional developed-length cross-check against the plan's independent
 *   hand-calc (|measured − expected| ≤ devTol — mirrors expectedVolume).
 *
 * 근사 명시: the gate verifies the DEVELOPED LENGTH and bend schedule, not a
 * folded-solid FEA. Springback/tooling-collision are out of scope and stated as
 * limitations. The part's folded 3D solid is not meshed (featureMesh has no
 * sheet-metal kind) — bodies[0] is the flat base panel, dimensioned by the
 * geometry/drawing gates as usual; this gate is the ADDITIONAL flat-pattern
 * verification and DXF deliverable.
 */

import * as THREE from 'three';
import {
  applyBend,
  applyFlange,
  generateFlatPattern,
  SHEET_METAL_MATERIAL_ORDER,
  type BendHistoryEntry,
} from '@/app/[lang]/shape-generator/features/sheetMetal';
import {
  DEFAULT_MATERIAL,
  type SheetMetalBendWarning,
  type SheetMetalMaterial,
} from '@/app/[lang]/shape-generator/features/sheetMetalTables';
import { segmentsToDxf, type Seg } from '@/lib/papercraft/netDxf';
import type { GateResult, PlanPart, SheetMetalBendRow, SheetMetalSpec } from './types';

const DEFAULT_DEV_TOL_MM = 1e-6;

/** Resolve a plan material string to a real engine material key. */
function resolveMaterial(key: string | undefined): { material: SheetMetalMaterial; resolved: boolean } {
  if (key && (SHEET_METAL_MATERIAL_ORDER as string[]).includes(key)) {
    return { material: key as SheetMetalMaterial, resolved: true };
  }
  return { material: DEFAULT_MATERIAL, resolved: key === undefined };
}

/** Flat-pattern computation result — consumed by both the gate and the packager. */
export interface FlatPatternArtifact {
  developedLengthMm: number;
  blankWidthMm: number;
  thicknessMm: number;
  material: string;
  /** True when the requested material key was a known engine material. */
  materialResolved: boolean;
  bendTable: SheetMetalBendRow[];
  warnings: SheetMetalBendWarning[];
  addedMaterialMm: number;
  /** Laser-ready flat DXF (CUT outline + BEND lines). */
  dxf: string;
}

/** Build the flat-pattern DXF: developed-length × width outline + bend lines. */
function flatPatternDxf(lengthMm: number, widthMm: number, bendTable: SheetMetalBendRow[]): string {
  const segs: Seg[] = [
    // CUT outline (length along X, width along Y).
    { a: [0, 0], b: [lengthMm, 0], layer: 'CUT' },
    { a: [0, widthMm], b: [lengthMm, widthMm], layer: 'CUT' },
    { a: [0, 0], b: [0, widthMm], layer: 'CUT' },
    { a: [lengthMm, 0], b: [lengthMm, widthMm], layer: 'CUT' },
  ];
  for (const row of bendTable) {
    const x = Math.max(0, Math.min(lengthMm, row.positionMm));
    segs.push({ a: [x, 0], b: [x, widthMm], layer: 'BEND' });
  }
  return segmentsToDxf(segs);
}

/**
 * Reconstruct the folded stack from the plan's ops and REAL-unfold it. Returns
 * null when the part carries no sheetMetal spec. Throws are impossible for well-
 * formed ops; a malformed op surfaces as an engine error caught by the driver's
 * build step (never silently skipped).
 */
export function buildFlatPatternArtifact(part: PlanPart): FlatPatternArtifact | null {
  const spec = part.sheetMetal;
  if (!spec) return null;

  const { material, resolved } = resolveMaterial(spec.material);
  const t = spec.thicknessMm;

  // Base panel blank: width along X, thickness along Y, length along Z — matches
  // the engine's primary-axis / edge-index conventions (features/sheetMetal).
  let geo: THREE.BufferGeometry = new THREE.BoxGeometry(spec.baseWidthMm, t, spec.baseLengthMm);
  for (const op of spec.ops) {
    if (op.kind === 'bend') {
      geo = applyBend(geo, {
        angle: op.angle,
        radius: op.radius,
        position: op.position ?? 0.5,
        direction: op.direction ?? 'up',
      });
    } else {
      geo = applyFlange(geo, {
        height: op.height ?? 0,
        angle: op.angle,
        radius: op.radius,
        edgeIndex: op.edgeIndex ?? 0,
      });
    }
  }

  const history = (geo.userData as { __bendHistory?: BendHistoryEntry[] } | undefined)?.__bendHistory ?? [];
  const flat = generateFlatPattern(geo, history, t, material);

  const bendTable: SheetMetalBendRow[] = flat.bendTable.map((b) => ({
    index: b.index,
    positionMm: b.position,
    angleDeg: b.angle,
    radiusMm: b.radius,
    direction: b.direction,
    bendAllowanceMm: b.bendAllowance,
    kFactor: b.kFactor,
  }));

  const addedMaterialMm = spec.ops
    .filter((o) => o.kind === 'flange')
    .reduce((sum, o) => sum + Math.max(0, (o.height ?? 0) - o.radius), 0);

  return {
    developedLengthMm: flat.length,
    blankWidthMm: flat.width,
    thicknessMm: t,
    material,
    materialResolved: resolved,
    bendTable,
    warnings: flat.warnings,
    addedMaterialMm,
    dxf: flatPatternDxf(flat.length, flat.width, bendTable),
  };
}

/**
 * Flat-pattern gate. Fails (패키지 미산출) when:
 *   - the spec is present but the artifact could not be built (build failure), or
 *   - any bend carries an ERROR-severity warning (min inner radius / angle range —
 *     the part would crack on the press brake), or
 *   - the developed length disagrees with the plan's independent hand-calc
 *     beyond devTol (a stated cross-check failed).
 * Bend-schedule numbers are the engine's real unfold, restated as metrics.
 */
export function flatPatternGate(part: PlanPart, artifact: FlatPatternArtifact | null): GateResult {
  const id = `flat-pattern:${part.partId}`;
  const spec = part.sheetMetal as SheetMetalSpec | undefined;
  const notes: string[] = [
    'features/sheetMetal 엔진 소비: 베이스 블랭크→ops(applyBend/applyFlange)→generateFlatPattern 실전개(전개장·BA=재료 K-factor 실측)',
    '전개장·벤드 스케줄만 검증 — 폴딩 솔리드 FEA/스프링백/툴링 간섭 미수행(근사 명시)',
  ];
  const metrics: Record<string, number> = {};

  if (!spec) {
    // Driver only calls this gate for sheetMetal parts; a missing spec is a
    // contract violation, surfaced rather than silently passed.
    return { id, kind: 'flat-pattern', pass: false, metrics, reason: 'flat-pattern gate invoked on a non-sheetMetal part', notes };
  }
  if (!artifact) {
    return { id, kind: 'flat-pattern', pass: false, metrics, reason: 'sheet-metal unfold produced no flat pattern (build failed)', notes };
  }

  metrics.developedLengthMm = artifact.developedLengthMm;
  metrics.blankWidthMm = artifact.blankWidthMm;
  metrics.thicknessMm = artifact.thicknessMm;
  metrics.bendCount = artifact.bendTable.length;
  metrics.addedMaterialMm = artifact.addedMaterialMm;

  const errors = artifact.warnings.filter((w) => w.severity === 'error');
  const warns = artifact.warnings.filter((w) => w.severity === 'warning');
  metrics.bendErrorCount = errors.length;
  metrics.bendWarningCount = warns.length;
  for (const w of warns) notes.push(`bend warning ${w.code}: ${w.messageEn}`);
  if (!artifact.materialResolved) {
    notes.push(`material '${spec.material}' unknown — fell back to ${DEFAULT_MATERIAL} K-factor curve (근사 명시)`);
  }

  const reasons: string[] = [];
  for (const e of errors) reasons.push(`bend ${e.code}: ${e.messageEn}`);

  if (spec.expectedDevelopedLengthMm !== undefined) {
    const tol = spec.devTolMm ?? DEFAULT_DEV_TOL_MM;
    const deviation = Math.abs(artifact.developedLengthMm - spec.expectedDevelopedLengthMm);
    metrics.expectedDevelopedLengthMm = spec.expectedDevelopedLengthMm;
    metrics.developedLengthDeviationMm = deviation;
    if (deviation > tol) {
      reasons.push(
        `developed length ${artifact.developedLengthMm.toFixed(4)} mm deviates from expected ` +
          `${spec.expectedDevelopedLengthMm} mm by ${deviation.toFixed(4)} mm (> tol ${tol})`,
      );
    }
  }

  return {
    id,
    kind: 'flat-pattern',
    pass: reasons.length === 0,
    metrics,
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    notes,
  };
}
