/**
 * programToFeatures — replays a precise feature PROGRAM (from the Studio's
 * cad-feature-program path) into the modeler's editable feature tree, so a
 * chat-built precise part arrives as real sketch/hole/pattern/fillet features
 * (not an imported mesh). The modeler then builds it through its own pipeline
 * (OCCT when enabled → analytic B-rep + lossless STEP).
 *
 * Coordinate note: the Studio program is Z-up with hole positions (posX,posY)
 * on the top face; the modeler's hole feature uses (posX,posZ). We map
 * posY → posZ. Ribs and shells are deferred (need their own sketch/profile);
 * they are returned in `skipped` so the caller can fall back for those.
 */
import { generateRectSegments, generateCircleSegments } from '../sketch/sketchGeometryOps';
import type { SketchProfile, SketchConfig, SketchPoint } from '../sketch/types';
import type { FeatureType } from '../features/types';
import type { FeatureProgram, ProgramFeature } from '../../studio/emitScadFromProgram';

const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);
const pt = (x: number, y: number): SketchPoint => ({ x, y } as SketchPoint);

export interface ModelerFeatureApi {
  addSketchFeature: (
    profile: SketchProfile,
    config: SketchConfig,
    plane: 'xy' | 'xz' | 'yz',
    operation: 'add' | 'subtract',
    planeOffset?: number,
    constraints?: undefined,
    dimensions?: undefined,
    faceFrame?: {
      origin: [number, number, number];
      normal: [number, number, number];
      uAxis: [number, number, number];
      vAxis: [number, number, number];
    },
  ) => void;
  addFeatureWithParams: (type: FeatureType, overrides: Record<string, number>) => void;
  /** Replace the modeler's BASE primitive (box/cylinder). Preferred over a
   *  sketch base: the modeler always starts with a default base solid, so a
   *  sketch 'add' would UNION the part onto that default box (wrong dims). */
  setBaseShape?: (shapeId: string, params: Record<string, number>) => void;
  /** Clear the existing feature stack before replaying (idempotent handoff). */
  clearFeatures?: () => void;
  /** F-6(260808g) — 멀티바디: 배치 파트 목록으로 어셈블리 시드(모델러 좌표계,
   *  position=파트 중심). 단일 바디 피처트리 경로와 상호 배타. */
  setAssemblyParts?: (parts: Array<{
    shapeId: string;
    params: Record<string, number>;
    name?: string;
    position?: [number, number, number];
    rotation?: [number, number, number];
  }>) => void;
}

/** Replay a feature program into the modeler. Returns whether the base was built
 *  and which feature types were skipped (deferred). */
export function reconstructFeatureTree(program: FeatureProgram, api: ModelerFeatureApi): { ok: boolean; skipped: string[] } {
  // F-6(260808g) — 멀티바디 프로그램: 배치 파트 목록을 그대로 어셈블리로 시드
  // (좌표 사상은 프로듀서 chatCadHandoff.assemblyToPartsProgram 이 실측 규약으로
  // 완료). 단일 바디 피처트리 경로와 상호 배타.
  if (program?.assemblyParts?.length) {
    if (!api.setAssemblyParts) return { ok: false, skipped: ['assembly'] };
    api.setAssemblyParts(program.assemblyParts);
    return { ok: true, skipped: [] };
  }
  const feats: ProgramFeature[] = program?.features ?? [];
  const base = feats.find(f => f.type === 'sketchExtrude');
  if (!base) return { ok: false, skipped: [] };

  // 1. base solid. The modeler ALWAYS starts with a default base primitive
  // (a 50×30×20 box), so the old approach — a sketch 'add' — unioned the part
  // ONTO that box, corrupting the dimensions. Instead REPLACE the base
  // primitive directly when we can (box/cylinder, which is every Studio base).
  // The modeler is Y-up: box height is the vertical (Y) axis and the hole
  // feature drills along Y through it. So the plate's THICKNESS must map to the
  // box height (Studio height), not depth — otherwise the holes drill through
  // the wrong dimension and blow up the bbox. width→X, height→Y(thickness),
  // depth→Z.
  const h = num(base.height, 8);
  // NOTE: do NOT clearFeatures() here — the modeler mounts fresh on handoff, and
  // clearAll() resets activeNodeId asynchronously, so features added in the same
  // tick attach to a stale (removed) parent and vanish from the tree.
  const skipped: string[] = [];
  const poly = Array.isArray(base.profile) && base.profile.length >= 3 ? base.profile : null;
  if (poly) {
    // 베이스리스(260808e 근본수정): 'none' 베이스로 전환해 기본 프리미티브
    // 겹침을 제거 — 첫 스케치 피처가 파이프라인 체인 시작점이 된다
    // (upstreamEmpty 기지원 경로).
    api.setBaseShape?.('none', {});
    // P-1b(260808b) — 임의 폐다각 프로파일: 프리미티브가 아니라 진짜 스케치
    // 피처로 시드한다(점 좌표는 intent 폴리곤 공간 그대로 — 중심화하지 않음,
    // SCAD/STEP 경로와 동일 좌표 유지가 정합 조건).
    const points = poly.map(([x, y]) => pt(num(x, 0), num(y, 0)));
    const segments = points.map((a, i) => {
      const b = points[(i + 1) % points.length]!;
      return { type: 'line' as const, points: [a, b], id: `hp_seg_${i}` };
    });
    const profile: SketchProfile = { segments, closed: true };
    const config = { mode: 'extrude', depth: h, revolveAngle: 360, revolveAxis: 'y', segments: 32 } as unknown as SketchConfig;
    api.addSketchFeature(profile, config, 'xy', 'add', 0);

  } else if (api.setBaseShape) {
    if (base.shape === 'circle') {
      api.setBaseShape('cylinder', { diameter: num(base.width, 50), height: h });
    } else {
      api.setBaseShape('box', { width: num(base.width, 100), height: h, depth: num(base.depth, 80) });
    }
  } else {
    // Fallback (no base-shape setter): sketch extrude (will double the default box).
    let profile: SketchProfile;
    if (base.shape === 'circle') {
      profile = { segments: generateCircleSegments(pt(0, 0), num(base.width, 50) / 2, 64), closed: true };
    } else {
      const w = num(base.width, 100), d = num(base.depth, 80);
      profile = { segments: generateRectSegments(pt(-w / 2, -d / 2), pt(w / 2, d / 2)), closed: true };
    }
    const config = { mode: 'extrude', depth: h, revolveAngle: 360, revolveAxis: 'y', segments: 32 } as unknown as SketchConfig;
    api.addSketchFeature(profile, config, 'xy', 'add', 0);
  }

  // 2. downstream features, in program order (a pattern follows its source hole)
  for (const f of feats) {
    try {
    switch (f.type) {
      case 'sketchExtrude':
        break;
      case 'hole': {
        // EXPAND patterns into explicit holes rather than using the modeler's
        // circularPattern feature — it places copies at the wrong radius (the
        // bbox blew up to 2×PCD in the Z axis). Same positions the OpenSCAD
        // preview and the analytic-STEP route use.
        const addHole = (x: number, y: number) => api.addFeatureWithParams('hole', {
          holeType: num(f.holeType, 0), diameter: num(f.diameter, 6), posX: x, posZ: y, depth: 999,
        });
        const pat = feats.find(p => (p.type === 'circularPattern' || p.type === 'linearPattern') && p.feature === f.id);
        if (pat?.type === 'circularPattern') {
          const cnt = Math.max(2, Math.round(num(pat.count, 4)));
          const r = num(pat.pcd, 60) / 2;
          for (let i = 0; i < cnt; i++) { const a = (i / cnt) * 2 * Math.PI; addHole(Math.cos(a) * r, Math.sin(a) * r); }
        } else if (pat?.type === 'linearPattern') {
          const cnt = Math.max(2, Math.round(num(pat.count, 3)));
          const sp = num(pat.spacing, 20);
          for (let i = 0; i < cnt; i++) {
            const off = (i - (cnt - 1) / 2) * sp;
            addHole(num(f.posX, 0) + (pat.axis === 'y' ? 0 : off), num(f.posY, 0) + (pat.axis === 'y' ? off : 0));
          }
        } else {
          addHole(num(f.posX, 0), num(f.posY, 0));
        }
        break;
      }
      case 'boss': {
        // F-1(260808f) — 판 상면 보스: 기지원 face-frame 스케치로 시드.
        // 사상표 실측(260808e): rect 베이스=중심원점·height→월드 y(높이축)·
        // 구멍 posX→x/posY→z — 보스도 같은 사상. 상면 프레임 u=x, v=z,
        // 프로파일 (u,v)=(posX,posY) 중심 원.
        const bossH = num(f.height, 10);
        const dia = num(f.diameter, 20);
        const baseH = num(base.height, 8);
        // G-0(260808g) — 원판(circle→cylinder 베이스, height→y 중심대칭)도 상면
        // y=+h/2 이 동일하므로 같은 프레임으로 안착. 폴리라인 베이스는 상면이
        // y=h/2 가 아니므로(월드 z 압출) 계속 정직하게 skipped.
        if ((base.shape !== 'rect' && base.shape !== 'circle') || !api.addSketchFeature) { skipped.push('boss'); break; }
        const profile: SketchProfile = {
          segments: generateCircleSegments(pt(num(f.posX, 0), num(f.posY, 0)), dia / 2, 48),
          closed: true,
        };
        const config = { mode: 'extrude', depth: bossH, revolveAngle: 360, revolveAxis: 'y', segments: 48 } as unknown as SketchConfig;
        api.addSketchFeature(profile, config, 'xy', 'add', 0, undefined, undefined, {
          origin: [0, baseH / 2, 0],
          normal: [0, 1, 0],
          uAxis: [1, 0, 0],
          vAxis: [0, 0, 1],
        });
        break;
      }
      case 'circularPattern':
      case 'linearPattern':
        break; // expanded together with their source hole above
      case 'rib': {
        // G-0(260808g) — 모델러 rib 는 선분 기반(startX/Z→endX/Z, 두께·높이,
        // direction 0=부품 바닥 기준 상향). SCAD 방출(translate z=0 anchor
        // BOTTOM cuboid = 베이스 바닥에서 상향)과 동일 의미. 프로그램 (x,y)
        // 평면 → 모델러 (x,z) 사상은 hole 과 동일(posY→z).
        const t = num(f.width, 8);
        const ribH = num(f.height, 40);
        const L = num(f.length, num(base.depth, 80));
        const rx = num(f.posX, 0), ry = num(f.posY, 0);
        const seg = f.alongY
          ? { startX: rx, startZ: ry - L / 2, endX: rx, endZ: ry + L / 2 }
          : { startX: rx - L / 2, startZ: ry, endX: rx + L / 2, endZ: ry };
        api.addFeatureWithParams('rib', { ...seg, thickness: t, height: ribH, direction: 0 });
        break;
      }
      case 'shell':
        // G-0(260808g) — openFace: 모델러 enum 1=상면 개방·2=하면 개방(0=밀폐는
        // 프로그램 어휘에 없음 — SCAD 방출과 동일하게 기본 상면 개방).
        api.addFeatureWithParams('shell', {
          wallThickness: num(f.wallThickness, 2),
          openFace: f.openFace === 'bottom' ? 2 : 1,
        });
        break;
      case 'fillet':
        api.addFeatureWithParams('fillet', { radius: num(f.radius, 3) });
        break;
      case 'chamfer':
        api.addFeatureWithParams('chamfer', { distance: num(f.distance, 1) });
        break;
      default:
        skipped.push(f.type); // rib / shell / etc. — handled by the imported-geometry fallback
    }
    } catch {
      // A single bad feature must not abort the whole tree reconstruction.
      skipped.push(`${f.type} (error)`);
    }
  }
  return { ok: true, skipped };
}
