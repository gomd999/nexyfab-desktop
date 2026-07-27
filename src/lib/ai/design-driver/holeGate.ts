/**
 * design-driver/holeGate — WB-9: 구멍(OCCT boolean cut) 게이트.
 *
 * Consumption vs self-implementation (보고 의무 — 명세):
 *
 *   CONSUMED — the REAL OCCT kernel (occt/nodeOcctBridge + nodeOcctLoader):
 *   `buildFromExtrude` builds both the base prism and each hole TOOL as B-rep
 *   solids, `boolean.subtract` (BRepAlgoAPI_Cut) actually removes the material,
 *   and the kernel's own `volume` (BRepGProp) REAL-measures the result. No mesh
 *   approximation of the cut, and no arithmetic standing in for the boolean.
 *
 *   SELF-IMPLEMENTED — the gate verdict: every declared hole must REMOVE
 *   material (a hole placed off the part removes nothing → refusal, not a
 *   silent pass), the kernel's measured net volume must match the volume the
 *   declared cuts imply, and holes must not be declared where the kernel can't
 *   verify them (blind holes, non-extrude base, kernel unavailable).
 *
 * 왜 필요했나: 260723 A-4 실측(n=12, 실 DeepSeek) — ref-naming 수정으로 계획 통과율이
 * 8.3%→83.3%로 올랐지만 완주는 0/12였고, 막힌 12건 중 **5건이 전부 구멍**이었다.
 * 스키마에 구멍이 없어 LLM이 구멍을 별도 body로 만들었고 geometry 게이트가 "AABB
 * 겹침"으로 정확히 거부한 것 — 모델 잘못이 아니라 표현 수단의 부재였다.
 *
 * 근사 명시: 공구는 정n각형 프리즘(기본 64각형)이라 원기둥의 테셀레이션이다. 따라서
 * 기대 부피는 πr²가 아니라 **그 정n각형 면적**으로 계산한다 — 스스로 못 맞추는 기준을
 * 세우지 않기 위해서. 정n각형 대 원의 면적 편차는 노트에 수치로 싣는다.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import type { OcctShape } from '@/lib/occt/types';
import type { GateResult, HoleSpec, PlanPart } from './types';

const DEFAULT_SEGMENTS = 64;
const MIN_SEGMENTS = 12;
const MAX_SEGMENTS = 256;
const DEFAULT_TOL_REL = 1e-6;

export interface HoleCutResult {
  id: string;
  /** Human-readable tool size — '⌀6.5' or '60×40 rect'. */
  label: string;
  shape: 'round' | 'rect';
  /** Declared centre in the body's sketch frame, mm (구멍 일람표용). */
  atX: number;
  atY: number;
  /** Blind depth from the top face, mm. null ⇒ through. */
  depthMm: number | null;
  /** Cross-section area of the TOOL as actually built (regular n-gon), mm². */
  toolAreaMm2: number;
  /** Material this cut actually removed, per the kernel, mm³. */
  removedMm3: number;
}

export interface HoleArtifact {
  ok: boolean;
  holeCount: number;
  segments: number;
  baseVolumeMm3: number;
  netVolumeMm3: number;
  /** Volume the declared cuts imply (base − Σ n-gon prisms), mm³. */
  expectedNetVolumeMm3: number;
  cuts: HoleCutResult[];
  /** Regular n-gon area ÷ circle area − 1 (negative: the tessellation under-cuts). */
  tessellationAreaRelDev: number;
  step?: string;
  reason?: string;
  kernelUnavailable?: boolean;
}

function fail(holeCount: number, reason: string, kernelUnavailable = false): HoleArtifact {
  return {
    ok: false, holeCount, segments: 0, baseVolumeMm3: 0, netVolumeMm3: 0,
    expectedNetVolumeMm3: 0, cuts: [], tessellationAreaRelDev: 0, reason, kernelUnavailable,
  };
}

/** Regular n-gon INSCRIBED in radius r — the tool we actually build. */
function ngonLoop(cx: number, cy: number, r: number, segments: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

/** Area of the inscribed regular n-gon = (n/2)·r²·sin(2π/n). */
function ngonArea(r: number, segments: number): number {
  return (segments / 2) * r * r * Math.sin((2 * Math.PI) / segments);
}

/** Axis-aligned rectangle centred on (cx,cy) — the EXACT tool (no tessellation). */
function rectLoop(cx: number, cy: number, w: number, h: number): Array<{ x: number; y: number }> {
  const hw = w / 2, hh = h / 2;
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ];
}

const isRect = (h: HoleSpec): boolean => h.shape === 'rect';

/** The tool loop + its EXACT cross-section area, per declared shape. */
function toolFor(h: HoleSpec, segments: number): { loop: Array<{ x: number; y: number }>; areaMm2: number; label: string } {
  if (isRect(h)) {
    const w = h.widthMm as number, ht = h.heightMm as number;
    return { loop: rectLoop(h.at.x, h.at.y, w, ht), areaMm2: w * ht, label: `${w}×${ht} rect` };
  }
  const r = (h.diameterMm as number) / 2;
  return { loop: ngonLoop(h.at.x, h.at.y, r, segments), areaMm2: ngonArea(r, segments), label: `⌀${h.diameterMm}` };
}

/** Z extent of the base extrude — the tool must span it completely. */
function zRange(feature: ExtrudeFeature): { z0: number; z1: number } {
  const d = feature.depth;
  if (feature.direction === 'two_sided') return { z0: -d, z1: d };
  if (feature.direction === 'midplane') return { z0: -d / 2, z1: d / 2 };
  return { z0: 0, z1: d };
}

/**
 * Cut every declared hole with the real kernel. Returns null when the part
 * declares no holes (no OCCT load happens then). Async — kernel load ~700 ms.
 */
export async function buildHoleArtifact(part: PlanPart): Promise<HoleArtifact | null> {
  const holes = part.holes;
  if (!holes || holes.length === 0) return null;

  for (const h of holes) {
    if (isRect(h)) {
      if (!((h.widthMm ?? 0) > 0) || !((h.heightMm ?? 0) > 0)) {
        return fail(holes.length, `hole '${h.id}': a rect cutout needs positive widthMm and heightMm, got ${h.widthMm}×${h.heightMm}`);
      }
    } else if (!((h.diameterMm ?? 0) > 0)) {
      return fail(holes.length, `hole '${h.id}': diameter must be positive, got ${h.diameterMm}`);
    }
    if (!Number.isFinite(h.at?.x) || !Number.isFinite(h.at?.y)) {
      return fail(holes.length, `hole '${h.id}': centre must be finite {x,y}`);
    }
    if (h.kind === 'blind' && !((h.depthMm ?? 0) > 0)) {
      return fail(holes.length, `hole '${h.id}': a blind hole needs a positive depthMm, got ${h.depthMm}`);
    }
  }

  const body = part.bodies[0];
  if (!body || body.feature.kind !== 'extrude') {
    return fail(holes.length, `holes require bodies[0] to be an extrude solid (got ${body?.feature.kind ?? 'none'})`);
  }
  const feature = body.feature as ExtrudeFeature;

  // 테셀레이션은 파트 안에서 균일해야 한다 — 구멍마다 다른 각수를 쓰면 "근사 편차"가
  // 하나의 수치로 진술되지 않는다(리포트가 어느 구멍 얘기인지 모르게 됨). 서로 다른
  // 값을 선언하면 조용히 하나로 밀지 않고 거부한다.
  const declared = holes.map((h) => h.segments).filter((v): v is number => v !== undefined);
  if (declared.length > 0 && declared.some((v) => v !== declared[0])) {
    return fail(holes.length, `holes declare different tessellation segments (${[...new Set(declared)].join(', ')}) — one part must use one tool tessellation so the stated deviation means something`);
  }
  const segments = Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, Math.round(declared[0] ?? DEFAULT_SEGMENTS)));

  const load = await loadOcctNode();
  if (!load.ok || !load.oc) {
    return fail(holes.length, `OCCT kernel unavailable: ${load.reason ?? 'unknown'} — cannot verify declared holes`, true);
  }
  const bridge = createNodeOcctBridge(load.oc);

  const toRelease: OcctShape[] = [];
  try {
    const base = await bridge.buildFromExtrude(feature);
    if (!base.ok || !base.shape) return fail(holes.length, `base extrude build failed: ${base.error ?? 'no shape'}`);
    toRelease.push(base.shape);
    const baseVolumeMm3 = base.shape.volume ?? NaN;
    if (!Number.isFinite(baseVolumeMm3) || baseVolumeMm3 <= 0) {
      return fail(holes.length, `base solid has no measurable volume (${baseVolumeMm3})`);
    }

    const { z0, z1 } = zRange(feature);
    // 공구는 소재를 확실히 관통해야 한다 — two_sided(±depth)로 base의 Z 범위를 덮는다.
    const toolDepth = Math.max(Math.abs(z0), Math.abs(z1)) + Math.max(1, Math.abs(z1 - z0) * 0.1);

    let current = base.shape;
    let currentVolume = baseVolumeMm3;
    const cuts: HoleCutResult[] = [];
    let expectedRemoved = 0;

    const thicknessMm = z1 - z0;
    for (const h of holes) {
      const t = toolFor(h, segments);
      const blind = h.kind === 'blind';
      // 블라인드 깊이가 소재 두께 이상이면 그건 관통이다 — 조용히 관통으로 만들지 않고
      // 선언을 고치게 한다(도면엔 블라인드, 실물엔 관통인 부품 방지).
      if (blind && (h.depthMm as number) >= thicknessMm) {
        return fail(holes.length, `hole '${h.id}': blind depth ${h.depthMm} mm >= material thickness ${thicknessMm} mm — that is a through hole, declare kind:'through'`);
      }
      let toolRes;
      if (blind) {
        // 공구를 윗면에서 depth 만큼만 내린다. 브리지의 z0 지정 프리즘이 필요하다
        // (buildFromExtrude는 0..d / ±d / ±d/2 세 위치밖에 못 놓는다).
        if (!bridge.buildPrismAt) {
          return fail(holes.length, `hole '${h.id}': this OCCT bridge cannot place a prism at an explicit z0 (buildPrismAt absent) — a blind depth cannot be built here`, true);
        }
        const d = h.depthMm as number;
        toolRes = await bridge.buildPrismAt(t.loop, z1 - d, d + Math.max(1, thicknessMm * 0.1));
      } else {
        const tool: ExtrudeFeature = {
          kind: 'extrude',
          loop: t.loop,
          depth: toolDepth,
          direction: 'two_sided',
          mode: 'add',
        };
        toolRes = await bridge.buildFromExtrude(tool);
      }
      if (!toolRes.ok || !toolRes.shape) return fail(holes.length, `hole '${h.id}': tool build failed: ${toolRes.error ?? 'no shape'}`);
      toRelease.push(toolRes.shape);

      const cutRes = await bridge.boolean.subtract(current, toolRes.shape);
      if (!cutRes.ok || !cutRes.shape) return fail(holes.length, `hole '${h.id}': kernel cut failed: ${cutRes.error ?? 'no shape'}`);
      toRelease.push(cutRes.shape);

      const nextVolume = cutRes.shape.volume ?? NaN;
      if (!Number.isFinite(nextVolume)) return fail(holes.length, `hole '${h.id}': cut result has no measurable volume`);
      const removed = currentVolume - nextVolume;
      // 재료를 안 깎았다 = 구멍이 부품 밖이거나 이미 뚫린 자리 — 통과시키면 도면엔
      // 구멍이 있는데 실물엔 없는 부품이 나간다.
      if (!(removed > 0)) {
        return fail(holes.length, `hole '${h.id}' removed no material (Δ=${removed.toFixed(6)} mm³) — the hole is outside the profile or duplicates another hole`);
      }
      cuts.push({
        id: h.id, label: t.label, shape: isRect(h) ? 'rect' : 'round',
        atX: h.at.x, atY: h.at.y, depthMm: blind ? (h.depthMm as number) : null,
        toolAreaMm2: t.areaMm2, removedMm3: removed,
      });
      // 관통은 두께 전부, 블라인드는 선언 깊이만큼 재료가 사라져야 한다.
      expectedRemoved += t.areaMm2 * (blind ? (h.depthMm as number) : thicknessMm);
      current = cutRes.shape;
      currentVolume = nextVolume;
    }

    let step: string | undefined;
    try { step = await bridge.exportSTEP(current); } catch { step = undefined; }

    const anyRound = holes.some((h) => !isRect(h));
    const circleArea = Math.PI;
    const ngonUnit = ngonArea(1, segments);
    return {
      ok: true,
      holeCount: holes.length,
      segments,
      baseVolumeMm3,
      netVolumeMm3: currentVolume,
      expectedNetVolumeMm3: baseVolumeMm3 - expectedRemoved,
      cuts,
      // 사각 공구는 테셀레이션이 없다(정확) — 전부 사각이면 0을 보고한다.
      tessellationAreaRelDev: anyRound ? ngonUnit / circleArea - 1 : 0,
      ...(step ? { step } : {}),
    };
  } catch (e) {
    return fail(holes.length, `hole cut threw: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    for (const s of toRelease) {
      try { bridge.release(s); } catch { /* best-effort */ }
    }
  }
}

/**
 * Hole gate. Fails (패키지 미산출) when the kernel could not build/verify the
 * declared holes, when any hole removed no material, or when the kernel's
 * measured net volume disagrees with what the declared cuts imply.
 */
export function holeGate(part: PlanPart, artifact: HoleArtifact | null): GateResult {
  const id = `hole:${part.partId}`;
  const holes = part.holes as HoleSpec[] | undefined;
  const notes: string[] = [
    'occt/nodeOcctBridge 소비: buildFromExtrude(소재+공구)→BRepAlgoAPI_Cut 실커널→BRepGProp 순부피 실측·STEP 산출',
    '원형 공구=정n각형 프리즘(원기둥의 테셀레이션) — 기대 부피도 같은 정n각형 기준으로 계산(πr² 아님). 사각 컷아웃은 테셀레이션 없음(정확)',
    '관통=두께 전부·블라인드=선언 깊이만큼 재료 제거를 커널 부피로 검증(블라인드는 브리지의 buildPrismAt로 윗면 기준 배치). OCCT 미가용 시 거부(무음 통과 없음)',
    '구멍 일람표(schedule)의 지름/형상/깊이는 커널 부피로 검증된 값 — 중심 좌표는 선언값이다(부피 검사는 구멍이 소재 안에 완전히 들어있고 서로 겹치지 않음까지만 보증)',
    'geometry 게이트의 메시 부피는 구멍 반영 전 총량 — 이 파트의 순부피는 여기 netVolumeMm3가 정본',
  ];

  if (!holes || holes.length === 0) {
    return { id, kind: 'hole', pass: true, notes: ['no holes declared — gate not applicable'], metrics: {} };
  }
  if (!artifact) {
    return { id, kind: 'hole', pass: false, reason: 'hole artifact missing — declared holes were never built', notes, metrics: {} };
  }
  if (!artifact.ok) {
    return { id, kind: 'hole', pass: false, reason: artifact.reason ?? 'hole cut failed', notes, metrics: { holeCount: artifact.holeCount } };
  }

  const metrics: Record<string, number> = {
    holeCount: artifact.holeCount,
    segments: artifact.segments,
    baseVolumeMm3: artifact.baseVolumeMm3,
    netVolumeMm3: artifact.netVolumeMm3,
    expectedNetVolumeMm3: artifact.expectedNetVolumeMm3,
    removedVolumeMm3: artifact.baseVolumeMm3 - artifact.netVolumeMm3,
    tessellationAreaRelDev: artifact.tessellationAreaRelDev,
  };

  const reasons: string[] = [];
  const denom = Math.max(Math.abs(artifact.expectedNetVolumeMm3), 1e-9);
  const relErr = Math.abs(artifact.netVolumeMm3 - artifact.expectedNetVolumeMm3) / denom;
  metrics.netVolumeRelError = relErr;
  if (relErr > DEFAULT_TOL_REL) {
    reasons.push(
      `kernel net volume ${artifact.netVolumeMm3.toFixed(4)} mm³ deviates from the declared cuts' implied ${artifact.expectedNetVolumeMm3.toFixed(4)} mm³ by relError ${relErr} > ${DEFAULT_TOL_REL} — the cuts did not do what the plan declared (overlapping holes, or a hole crossing the profile edge)`,
    );
  }

  return {
    id,
    kind: 'hole',
    pass: reasons.length === 0,
    ...(reasons.length ? { reason: reasons.join(' | ') } : {}),
    notes,
    metrics,
  };
}
