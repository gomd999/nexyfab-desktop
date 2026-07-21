/**
 * design-driver/gdtGate — WB-5: GD&T 자동 제안 + 검증 게이트.
 *
 * 생성≠검증. 이 게이트는 두 층으로 동작한다:
 *
 *   1. PROPOSE (제안) — 각 바디의 실제 네임드 토폴로지(NamedTopology, 즉
 *      buildExtrudeTopo / buildRevolveMeasureTopo 가 만든 실물 폴리헤드론)에서
 *      평면 face 를 뽑아 `suggestGdtCallouts`(annotations/gdtCalloutSuggester —
 *      기존 자산 재사용)로 데이텀 프레임 + flatness/perpendicularity/parallelism
 *      콜아웃을 제안한다. 제안 휴리스틱은 재사용, 그 값은 아직 아무것도 아니다.
 *
 *   2. VERIFY (검증) — 제안된 모든 콜아웃을 모델 지오메트리로 REAL 측정한다:
 *        flatness         = 제어 face 루프 정점의 최적합 평면 최대 편차(mm)
 *        perpendicularity = |90° − (제어·데이텀 법선각)| 편차를 face 최대폭으로
 *        parallelism      = |0°  − (제어·데이텀 법선각)| 편차를 face 최대폭으로
 *        angularity       = |α   − (제어·데이텀 법선각)| 편차를 face 최대폭으로
 *      돌려 도출한 orientation zone(mm) = 최대폭 × sin(편차). 실측 actual 이
 *      선언/제안 공차 존 이내면 within.
 *
 * 정직 불변식 (성역):
 *   - 값 날조 금지: 제어 피처와 데이텀이 실제 이름으로 해석되고, 통제량이 실측
 *     가능할 때만 콜아웃을 발행한다. 실측할 수 없으면 발행하지 않는다.
 *   - PlanGdtSpec(계획이 선언한 설계 요구): 해석 불가 또는 실측 actual > 존 이면
 *     게이트 FAIL(패키지 미산출) — 선언 치수의 expected 검사와 동일한 강제력.
 *   - 자동 제안(proposed): 자문(advisory). 실측이 제안 존을 초과하면 게이트를
 *     떨어뜨리지 않고 그냥 폐기(droppedProposals 로 사유만 기록). 발행된 자동
 *     콜아웃은 전부 REAL actual 을 달고 나간다.
 *   - position/cylindricity/profile: 현재 네임드 토폴로지에 홀 패턴·해석적 원통
 *     면이 없어 실측 불가 → 제안·검증에서 제외(날조 대신 명시적 공백).
 *
 * 소비만(수정 없음): `NamedTopology`(drawingArtifact.topologies), 그리고
 * `suggestGdtCallouts`/`pickDatumCandidates`(annotations/gdtCalloutSuggester).
 */

import { add, cross, dot, lengthOf, scale, sub, type Vec3 } from '@/lib/sketch/sketchPlane';
import type { NamedTopology } from '@/lib/cad/topoNaming';
import {
  suggestGdtCallouts,
  type AnalyzedFeature,
  type SuggestedCallout,
} from '@/app/[lang]/shape-generator/annotations/gdtCalloutSuggester';
import {
  bodyKey,
  type DesignPlan,
  type GateResult,
  type GdtCalloutRecord,
  type GdtCharacteristicKind,
  type PlanGdtSpec,
} from './types';

// ─── numeric tolerance ─────────────────────────────────────────────────────

/** Absolute mm slack absorbing float noise on an exact (0-deviation) relation. */
const ZONE_EPS = 1e-9;
const DEG = Math.PI / 180;

/** Nominal surface angle (deg, between the two planes) each orientation kind
 *  controls to. flatness has no datum ⇒ no nominal. */
function nominalAngleFor(kind: GdtCharacteristicKind, declared?: number): number {
  if (declared !== undefined) return declared;
  if (kind === 'perpendicularity') return 90;
  if (kind === 'parallelism') return 0;
  if (kind === 'angularity') return 45; // caller should declare; sane fallback
  return 0;
}

// ─── real geometry off a NamedTopology face ─────────────────────────────────

interface FaceGeom {
  /** Outward normal (featureMesh invariant). */
  normal: Vec3;
  /** 3D loop vertices. */
  loop: Vec3[];
  centroid: Vec3;
  areaMm2: number;
  /** Max pairwise vertex distance — the feature's characteristic span. */
  extentMm: number;
}

function faceGeom(topo: NamedTopology, name: string): FaceGeom | null {
  const loc = topo.byName.get(name);
  if (!loc || loc.kind !== 'face') return null;
  const f = topo.poly.faces[loc.index];
  if (!f) return null;
  const loop = f.vertices.map((vi) => topo.poly.vertices[vi]);
  if (loop.length < 3) return null;
  // centroid
  let c: Vec3 = { x: 0, y: 0, z: 0 };
  for (const p of loop) c = add(c, p);
  const centroid = scale(c, 1 / loop.length);
  // Newell area (2× area vector = Σ cross(pi, pi+1))
  let acc: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    acc = add(acc, cross(a, b));
  }
  const areaMm2 = lengthOf(acc) / 2;
  // extent = max pairwise distance across the loop
  let extentMm = 0;
  for (let i = 0; i < loop.length; i++) {
    for (let j = i + 1; j < loop.length; j++) {
      const d = lengthOf(sub(loop[i], loop[j]));
      if (d > extentMm) extentMm = d;
    }
  }
  return { normal: f.normal, loop, centroid, areaMm2, extentMm };
}

function unit(v: Vec3): Vec3 | null {
  const l = lengthOf(v);
  return l < 1e-12 ? null : scale(v, 1 / l);
}

// ─── the two REAL measurements ──────────────────────────────────────────────

/** Flatness = max |signed distance of a loop vertex to the face's own plane|.
 *  Planar polyhedron faces measure ~0 (verified, not assumed). */
function measureFlatness(g: FaceGeom): number {
  const n = unit(g.normal);
  if (!n) return Infinity;
  let maxDev = 0;
  for (const p of g.loop) {
    const dev = Math.abs(dot(sub(p, g.centroid), n));
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

/** Orientation zone (mm) between a controlled face and a datum face, plus the
 *  measured angular deviation from nominal. zone = span·sin(Δangle) — the max
 *  distance a controlled-surface point strays from the perfectly-oriented plane
 *  over the feature's span (conservative, 근사 명시). */
function measureOrientation(
  ctrl: FaceGeom,
  datum: FaceGeom,
  nominalDeg: number,
): { actualMm: number; angularDeviationDeg: number } | null {
  const nc = unit(ctrl.normal);
  const nd = unit(datum.normal);
  if (!nc || !nd) return null;
  // Angle between the two PLANES ∈ [0,90], from |cos| of their normals.
  const c = Math.min(1, Math.abs(dot(nc, nd)));
  const betweenDeg = Math.acos(c) / DEG;
  const angularDeviationDeg = Math.abs(nominalDeg - betweenDeg);
  const actualMm = ctrl.extentMm * Math.sin(angularDeviationDeg * DEG);
  return { actualMm, angularDeviationDeg };
}

// ─── planar features → suggestGdtCallouts input (reuse) ─────────────────────

function planarFeaturesOf(topo: NamedTopology): AnalyzedFeature[] {
  const out: AnalyzedFeature[] = [];
  for (const [name, loc] of topo.byName) {
    if (loc.kind !== 'face') continue;
    const g = faceGeom(topo, name);
    if (!g) continue;
    const n = unit(g.normal) ?? g.normal;
    out.push({
      id: name,
      kind: 'planar',
      areaMm2: g.areaMm2,
      direction: [n.x, n.y, n.z],
      position: [g.centroid.x, g.centroid.y, g.centroid.z],
    });
  }
  return out;
}

/** SuggestedCallout.symbol → the subset this gate can REAL-verify. */
function verifiableKind(symbol: SuggestedCallout['symbol']): GdtCharacteristicKind | null {
  if (symbol === 'flatness') return 'flatness';
  if (symbol === 'perpendicularity') return 'perpendicularity';
  if (symbol === 'parallelism') return 'parallelism';
  return null; // position / cylindricity / profile / … — not measurable here
}

// ─── artifact ────────────────────────────────────────────────────────────────

export interface GdtArtifact {
  /** REAL-verified callouts (proposed:true auto, proposed:false declared). */
  emitted: GdtCalloutRecord[];
  /** Plan-DECLARED specs that failed (unresolvable/violated) — gate reasons. */
  declaredFailures: string[];
  /** Auto proposals dropped as unverifiable/out-of-zone (advisory record). */
  droppedProposals: string[];
}

const ORIENTATION_KINDS: ReadonlySet<GdtCharacteristicKind> = new Set<GdtCharacteristicKind>([
  'perpendicularity',
  'parallelism',
  'angularity',
]);

/** Verify ONE callout against real topology. Returns the record (when the
 *  controlled quantity REAL-measures within zone) or a refusal string (never a
 *  fabricated value). */
function verifyCallout(args: {
  topo: NamedTopology;
  partId: string;
  bodyId: string;
  characteristic: GdtCharacteristicKind;
  feature: string;
  datums: string[];
  toleranceMm: number;
  nominalAngleDeg?: number;
  proposed: boolean;
  id: string;
}): { record: GdtCalloutRecord } | { refusal: string } {
  const { topo, characteristic, feature, datums, toleranceMm } = args;
  const ctrl = faceGeom(topo, feature);
  if (!ctrl) {
    return { refusal: `feature '${feature}' does not resolve to a real face in ${bodyKey(args.partId, args.bodyId)}` };
  }

  let actualMm: number;
  let angularDeviationDeg: number | undefined;
  let basis: string;

  if (characteristic === 'flatness') {
    actualMm = measureFlatness(ctrl);
    basis = `flatness = 최적합 평면 대비 face '${feature}' 루프 정점 최대 편차 ${actualMm.toExponential(3)} mm (실측)`;
  } else if (ORIENTATION_KINDS.has(characteristic)) {
    if (datums.length === 0) return { refusal: `${characteristic} on '${feature}' needs a datum` };
    const datum = faceGeom(topo, datums[0]);
    if (!datum) {
      return { refusal: `datum '${datums[0]}' does not resolve to a real face in ${bodyKey(args.partId, args.bodyId)}` };
    }
    const nominalDeg = nominalAngleFor(characteristic, args.nominalAngleDeg);
    const m = measureOrientation(ctrl, datum, nominalDeg);
    if (!m) return { refusal: `${characteristic} '${feature}'↔'${datums[0]}': degenerate normal` };
    actualMm = m.actualMm;
    angularDeviationDeg = m.angularDeviationDeg;
    basis =
      `${characteristic} zone = span ${ctrl.extentMm.toFixed(4)} mm × sin(${m.angularDeviationDeg.toExponential(3)}° 공칭 ${nominalDeg}° 편차) ` +
      `= ${actualMm.toExponential(3)} mm (실측 도출·근사 명시)`;
  } else {
    return { refusal: `characteristic '${characteristic}' not REAL-measurable in this topology` };
  }

  const within = actualMm <= toleranceMm * (1 + 1e-9) + ZONE_EPS;
  if (!within) {
    return {
      refusal:
        `${characteristic} on '${feature}'` +
        (datums.length ? ` |${datums.join(',')}` : '') +
        `: measured actual ${actualMm.toExponential(3)} mm exceeds tolerance zone ${toleranceMm} mm`,
    };
  }

  const record: GdtCalloutRecord = {
    id: args.id,
    partId: args.partId,
    bodyId: args.bodyId,
    characteristic,
    feature,
    datums: [...datums],
    toleranceMm,
    actualMm,
    proposed: args.proposed,
    basis,
  };
  if (angularDeviationDeg !== undefined) record.angularDeviationDeg = angularDeviationDeg;
  return { record };
}

/**
 * Build the GD&T artifact for a plan: propose (reuse gdtCalloutSuggester) +
 * verify (real measurement) for every body with a NamedTopology, and enforce
 * every plan-declared PlanGdtSpec. Never throws.
 */
export function buildGdtArtifact(
  plan: DesignPlan,
  topologies: ReadonlyMap<string, NamedTopology>,
): GdtArtifact {
  const emitted: GdtCalloutRecord[] = [];
  const declaredFailures: string[] = [];
  const droppedProposals: string[] = [];

  // ── 1. AUTO propose + verify per body (advisory, verify-or-drop) ──────────
  for (const part of plan.parts) {
    for (const body of part.bodies) {
      const topo = topologies.get(bodyKey(part.partId, body.bodyId));
      if (!topo) continue; // loft/sweep etc. — no named topology, explicit gap
      const features = planarFeaturesOf(topo);
      if (features.length === 0) continue;
      const suggestion = suggestGdtCallouts(features);
      const letterToFace = new Map(suggestion.datums.map((d) => [d.letter, d.featureId]));

      for (const c of suggestion.callouts) {
        const kind = verifiableKind(c.symbol);
        if (!kind) continue; // position/cylindricity/profile — not measurable here
        // datumRefs on a SuggestedCallout are datum LETTERS; map to face names.
        const datumFaces: string[] = [];
        let badDatum = false;
        for (const letter of c.datumRefs) {
          const f = letterToFace.get(letter as 'A' | 'B' | 'C');
          if (!f) {
            badDatum = true;
            break;
          }
          datumFaces.push(f);
        }
        if (badDatum) continue;
        const id =
          `gdt:${part.partId}:${body.bodyId}:${kind}:${c.featureId}` +
          (datumFaces.length ? `|${datumFaces.join(',')}` : '');
        const res = verifyCallout({
          topo,
          partId: part.partId,
          bodyId: body.bodyId,
          characteristic: kind,
          feature: c.featureId,
          datums: datumFaces,
          toleranceMm: c.toleranceMm,
          proposed: true,
          id,
        });
        if ('record' in res) emitted.push(res.record);
        else droppedProposals.push(res.refusal);
      }
    }
  }

  // ── 2. DECLARED specs (enforced — failure ⇒ gate fail) ────────────────────
  for (const spec of plan.drawing.gdt ?? []) {
    const res = verifyDeclared(plan, topologies, spec);
    if ('record' in res) emitted.push(res.record);
    else declaredFailures.push(`declared GD&T '${spec.id}': ${res.refusal}`);
  }

  emitted.sort((a, b) => a.id.localeCompare(b.id));
  droppedProposals.sort();
  return { emitted, declaredFailures, droppedProposals };
}

function verifyDeclared(
  plan: DesignPlan,
  topologies: ReadonlyMap<string, NamedTopology>,
  spec: PlanGdtSpec,
): { record: GdtCalloutRecord } | { refusal: string } {
  const part = plan.parts.find((p) => p.partId === spec.partId);
  if (!part) return { refusal: `unknown partId '${spec.partId}'` };
  const body = part.bodies.find((b) => b.bodyId === spec.bodyId);
  if (!body) return { refusal: `part '${spec.partId}' has no body '${spec.bodyId}'` };
  const topo = topologies.get(bodyKey(spec.partId, spec.bodyId));
  if (!topo) {
    return { refusal: `no named topology for body '${spec.bodyId}' (loft/sweep bodies are not GD&T-measurable)` };
  }
  return verifyCallout({
    topo,
    partId: spec.partId,
    bodyId: spec.bodyId,
    characteristic: spec.characteristic,
    feature: spec.feature,
    datums: spec.datums ?? [],
    toleranceMm: spec.toleranceMm,
    nominalAngleDeg: spec.nominalAngleDeg,
    proposed: false,
    id: spec.id,
  });
}

// ─── gate ────────────────────────────────────────────────────────────────────

export function gdtGate(plan: DesignPlan, artifact: GdtArtifact): GateResult {
  const notes = [
    'GD&T 자동 제안 = 실토폴로지(planar face) 기반, 제안 휴리스틱은 gdtCalloutSuggester(annotations) 재사용 — 검증은 모델 지오메트리 실측(생성≠검증)',
    'flatness = 최적합 평면 최대 편차(mm, 실측); orientation zone(mm) = 제어 face 최대폭 × sin(공칭각 편차) — 보수적 도출(근사 명시)',
    'position/cylindricity/profile 미검증 — 네임드 토폴로지에 홀 패턴·해석적 원통면 부재 → 해당 특성 제외(날조 대신 명시적 공백)',
    'auto 제안은 자문(advisory): 실측 actual > 제안 존이면 폐기(값 날조 금지); 계획 선언 GD&T(PlanGdtSpec)만 게이트 강제',
  ];

  const proposedCount = artifact.emitted.filter((e) => e.proposed).length;
  const declaredCount = artifact.emitted.filter((e) => !e.proposed).length;
  let maxActualMm = 0;
  let worstMarginMm = Infinity;
  for (const e of artifact.emitted) {
    if (e.actualMm > maxActualMm) maxActualMm = e.actualMm;
    const margin = e.toleranceMm - e.actualMm;
    if (margin < worstMarginMm) worstMarginMm = margin;
  }
  if (!Number.isFinite(worstMarginMm)) worstMarginMm = 0;

  const pass = artifact.declaredFailures.length === 0;
  return {
    id: 'gdt',
    kind: 'gdt',
    pass,
    metrics: {
      calloutCount: artifact.emitted.length,
      proposedCount,
      declaredCount,
      droppedProposalCount: artifact.droppedProposals.length,
      declaredFailureCount: artifact.declaredFailures.length,
      maxActualMm,
      worstMarginMm,
    },
    ...(pass ? {} : { reason: artifact.declaredFailures.join('; ') }),
    notes,
  };
}
