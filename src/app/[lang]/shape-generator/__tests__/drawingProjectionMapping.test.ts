/**
 * F-4 준비(260808g) — occtProjectViews 명명 뷰의 (u,v)↔월드 사상 **실측 고정**.
 *
 * 도면 치수를 피처(구멍) 좌표에 연동하려면 각 뷰의 투영 사상이 실측으로
 * 고정돼야 한다(추측 배선 금지 — P-1a 교훈). 비대칭 판(월드 x 0..100 ·
 * y 0..60 · z ±4)에 z축 관통 구멍(중심 (30,10))을 뚫고 세 뷰의 SVG 경계/
 * 구멍 원 중심을 실측한다. F-2 오버레이 사상의 실검증 — right 는 (−y,−z)로
 * 실측 정정됐다(가정 (y,−z)의 u 부호 반전).
 *
 * Skipped via RUN_OCCT_FEASIBILITY=0 (WASM init cost) — 기본 ON.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  ensureOcctReady,
  isOcctReady,
  occtExtrudeProfile,
  occtExtrudeCircle,
  occtProjectViews,
  getShape,
  registerShape,
  resetShapeRegistry,
} from '../features/occtEngine';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

/** 세그먼트 인지 SVG 경로 파서 — M/L 은 (x,y) 쌍, A 는 7-튜플에서 끝점만.
 *  (아크 파라미터 rx/ry/rot/flags 를 좌표로 오해하면 경계가 오염된다 — 실측
 *  실패에서 교정.) replicad toSVGPaths 는 곡선 배열의 배열 → flat 허용. */
function pathPoints(d: string): Array<{ u: number; v: number }> {
  const pts: Array<{ u: number; v: number }> = [];
  const re = /([MLA])([^MLAZ]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1].toUpperCase();
    const nums = (m[2].match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? []).map(Number);
    if (cmd === 'A') {
      for (let i = 0; i + 6 < nums.length; i += 7) pts.push({ u: nums[i + 5], v: nums[i + 6] });
    } else {
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ u: nums[i], v: nums[i + 1] });
    }
  }
  return pts;
}

function pathBounds(paths: unknown[]): { minU: number; maxU: number; minV: number; maxV: number } {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const d of (paths as unknown[]).flat(3).map(String)) {
    for (const { u, v } of pathPoints(d)) {
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
  }
  return { minU, maxU, minV, maxV };
}

describeMaybe('drawing projection mapping (F-4 measurement pin)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 120_000);

  it('front=(x,−z) · top=(x,y) · right=(−y,−z), hole circle lands in TOP at (cx,cy)', () => {
    expect(isOcctReady()).toBe(true);
    resetShapeRegistry();
    // 판: 스케치 (x,y) 사각 0..100 × 0..60, z 압출 8(중심대칭 ±4).
    const host = occtExtrudeProfile(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }],
      8,
    );
    expect(host.handle).toBeTruthy();
    // 구멍: 중심 (30,10) ⌀16, z 관통(툴 z ±5) — cut.
    const tool = occtExtrudeCircle(8, 30, 10, 10);
    const hostSolid = getShape(host.handle!) as { cut: (o: unknown) => unknown };
    const cutSolid = hostSolid.cut(getShape(tool.handle!));
    const handle = registerShape(cutSolid);

    const views = occtProjectViews(handle, ['front', 'top', 'right']);
    expect(views).not.toBeNull();

    // top: (u,v)=(x,y) → 판 0..100 × 0..60, 구멍 원(8곡선 근사) 중심 (30,10).
    const top = pathBounds(views!.top!.visible);
    expect(top.minU).toBeCloseTo(0, 0);
    expect(top.maxU).toBeCloseTo(100, 0);
    expect(top.minV).toBeCloseTo(0, 0);
    expect(top.maxV).toBeCloseTo(60, 0);
    // 구멍 원: top 의 아크 경로 — 지름 양끝점 (38,10)·(22,10), 반지름 8.
    // (끝점 2개가 지름 대척점 + rx=8 → 중심 (30,10)·⌀16 이 수학적으로 고정.)
    const arcPaths = (views!.top!.visible as unknown[]).flat(3).map(String).filter(d => /A/i.test(d));
    expect(arcPaths.length).toBeGreaterThan(0);
    const arcBounds = pathBounds(arcPaths);
    expect(arcBounds.minU).toBeCloseTo(22, 0);
    expect(arcBounds.maxU).toBeCloseTo(38, 0);
    expect(arcBounds.minV).toBeCloseTo(10, 0);
    expect(arcBounds.maxV).toBeCloseTo(10, 0);
    const rx = Number((arcPaths[0].match(/A\s*(-?\d+(?:\.\d+)?)/i) ?? [])[1]);
    expect(rx).toBeCloseTo(8, 1);

    // front: (u,v)=(x,−z) → 0..100 × −4..4 (두께 8).
    const front = pathBounds([...views!.front!.visible, ...views!.front!.hidden]);
    expect(front.minU).toBeCloseTo(0, 0);
    expect(front.maxU).toBeCloseTo(100, 0);
    expect(front.maxV - front.minV).toBeCloseTo(8, 0);
    expect(front.minV).toBeCloseTo(-4, 0);

    // right: (u,v)=(−y,−z) → −60..0 × −4..4. (실측 정정 — F-2 가 가정한
    // (y,−z)가 아니라 u 부호가 반전된다. 오버레이도 이 실측에 맞춰 수정.)
    const right = pathBounds([...views!.right!.visible, ...views!.right!.hidden]);
    expect(right.minU).toBeCloseTo(-60, 0);
    expect(right.maxU).toBeCloseTo(0, 0);
    expect(right.maxV - right.minV).toBeCloseTo(8, 0);
  }, 120_000);
});
