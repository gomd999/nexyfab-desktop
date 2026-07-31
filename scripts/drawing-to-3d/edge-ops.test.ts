/**
 * edge-ops.test.ts — 면·선 기준 필렛/모따기 (260802).
 *
 * ## 무엇이 없었나
 * 종전에는 `part.filletMm` 으로 **솔리드 전 에지**를 둥글리는 것뿐이었다. 실무는
 * 「이 모서리만 R5」인데 그걸 못 했다.
 *
 * ## 범위는 **측정이 정했다** (위상 명명 스파이크 ADR-017)
 * ```
 * 명명 커버리지  extrude 100% · revolve 0% · linearPattern 0%
 * fillet 결과    0% — 필렛 결과는 topo 를 등록하지 않는다
 * ```
 * → **압출 기반만** · **필렛 위 필렛 금지**. 열면 「어제 건 필렛이 오늘 딴 데 가 있는」 상태가 된다.
 *
 * ## 배선 (260802 실측)
 * `face-drag` 픽킹 → `topoNaming` 안정 이름 → **엣지 중점** → `EdgeFinder.containsPoint`.
 * ⚠ 위상 이름 해석은 **TS 계층**에 있고 커널로 오는 것은 **해석된 점**이다 —
 *   여기서 이름을 다시 풀면 `topoNaming` 이 두 벌이 되고 언젠가 갈린다.
 */
import { describe, expect, it } from 'vitest';
import { gate } from './reconstruct.mjs';
import { partVolumeEffective } from './structural.mjs';

const G = (i: unknown): string[] => (gate as unknown as (x: unknown) => string[])(i);
const V = (p: unknown): { volumeMm3: number; basis: string; note: string } =>
  (partVolumeEffective as unknown as (x: unknown) => { volumeMm3: number; basis: string; note: string })(p);

const BOX = { width: 100, depth: 60, height: 20 };
const OP = { kind: 'fillet', size: 3, at: [0, 0, 10], len: 20 };

describe('게이트 — 범위 밖은 거부한다', () => {
  it('압출 기반 어휘는 통과한다', () => {
    expect(G({ type: 'box', ...BOX, edgeOps: [OP] })).toEqual([]);
  });

  it('★회전체는 거부한다 — 위상 이름 커버리지 0% 라 재빌드에서 참조를 잃는다', () => {
    const e = G({ type: 'revolve', profile: [[0, 0], [50, 0], [50, 100], [0, 100]], edgeOps: [OP] });
    expect(e.join(' ')).toMatch(/압출 기반만/);
  });

  it('★같은 엣지에 두 번 걸면 거부한다 — 필렛 위 필렛은 참조를 잃는다', () => {
    const e = G({ type: 'box', ...BOX, edgeOps: [OP, { ...OP, size: 5 }] });
    expect(e.join(' ')).toMatch(/필렛 위 필렛/);
  });

  it('★엣지 중점(at)이 없으면 거부한다 — 커널이 엣지를 고를 수 없다', () => {
    const e = G({ type: 'box', ...BOX, edgeOps: [{ kind: 'fillet', size: 3 }] });
    expect(e.join(' ')).toMatch(/at\[3\] 누락/);
  });

  it('size 범위를 벗어나면 거부한다', () => {
    expect(G({ type: 'box', ...BOX, edgeOps: [{ ...OP, size: 0 }] }).join(' ')).toMatch(/size invalid/);
  });
});

describe('질량 — 부품 전체 필렛과 **같은 폐형**을 엣지 길이에 쓴다', () => {
  it('★필렛 (1−π/4)r²L 만큼 줄어든다', () => {
    const plain = V({ id: 'b', type: 'box', params: BOX }).volumeMm3;
    const r = V({ id: 'b', type: 'box', params: BOX, edgeOps: [OP] });
    expect(plain - r.volumeMm3).toBeCloseTo((1 - Math.PI / 4) * 9 * 20, 6);
    expect(r.basis).toMatch(/edge-ops/);
  });

  it('모따기는 (c²/2)L — 같은 크기면 필렛보다 많이 깎는다', () => {
    const f = V({ id: 'b', type: 'box', params: BOX, edgeOps: [OP] }).volumeMm3;
    const c = V({ id: 'b', type: 'box', params: BOX, edgeOps: [{ ...OP, kind: 'chamfer' }] }).volumeMm3;
    expect(c).toBeLessThan(f);
  });

  it('★엣지 길이가 없으면 **부피를 건드리지 않고** 과대라고 적는다', () => {
    const plain = V({ id: 'b', type: 'box', params: BOX }).volumeMm3;
    const r = V({ id: 'b', type: 'box', params: BOX, edgeOps: [{ kind: 'fillet', size: 3, at: [0, 0, 10] }] });
    // 길이를 추정해 곱하면 그 수치의 출처를 아무도 모른다.
    expect(r.volumeMm3).toBeCloseTo(plain, 6);
    expect(r.note).toMatch(/엣지 길이 미선언/);
  });
});

/**
 * ★커널이 **실제로 그 엣지만** 깎는가 (260802).
 *
 * ⚠ 폐형이 맞아도 형상이 다르면 의미가 없다. 그리고 오늘 「예외가 안 났다」를 「됐다」로
 *   읽어 두 번 틀렸다 — **부피로 확인한다.**
 * ⚠ 커널 호출이라 느리다(WASM 초기화). 그래도 이 검사가 없으면 「STEP 크기가 늘었다」가
 *   유일한 근거가 되는데, 그건 필렛이 **엉뚱한 엣지**에 걸려도 늘어난다.
 */
describe('커널 실측 — 지목한 엣지에만 걸린다', () => {
  const meshVol = (s: { mesh: (o: unknown) => { vertices: ArrayLike<number>; triangles: ArrayLike<number> } }): number => {
    const m = s.mesh({ tolerance: 0.3, angularTolerance: 25 });
    const V2 = m.vertices, T = m.triangles;
    let v6 = 0;
    for (let i = 0; i + 2 < T.length; i += 3) {
      const a = T[i]! * 3, b = T[i + 1]! * 3, c = T[i + 2]! * 3;
      v6 += V2[a]! * (V2[b + 1]! * V2[c + 2]! - V2[b + 2]! * V2[c + 1]!)
        - V2[a + 1]! * (V2[b]! * V2[c + 2]! - V2[b + 2]! * V2[c]!)
        + V2[a + 2]! * (V2[b]! * V2[c + 1]! - V2[b + 1]! * V2[c]!);
    }
    return Math.abs(v6) / 6;
  };

  it('★한 엣지 R3 = 전체 R3 보다 훨씬 덜 깎인다 — 폐형과도 맞는다', async () => {
    const mod = await import('./to-step.mjs') as unknown as { ensureReplicad: () => Promise<Record<string, never>> };
    const rc = await mod.ensureReplicad() as unknown as {
      drawRectangle: (w: number, d: number) => { sketchOnPlane: (p: string) => { extrude: (h: number) => never } };
    };
    const mk = (): never => rc.drawRectangle(100, 60).sketchOnPlane('XY').extrude(20);
    const plain = meshVol(mk());
    const all = meshVol((mk() as unknown as { fillet: (r: number) => never }).fillet(3));
    // 중점 지목 — 100×60 은 XY 중심 기준이라 한 수직 엣지 중점은 (-50,-30,10).
    const one = meshVol((mk() as unknown as { fillet: (r: number, f: (e: { containsPoint: (p: number[]) => boolean }) => boolean) => never })
      .fillet(3, (e) => e.containsPoint([-50, -30, 10])));
    expect(plain).toBeCloseTo(120000, 0);
    // 한 엣지만 깎였으므로 전체보다 **덜** 깎인다.
    expect(plain - one).toBeLessThan(plain - all);
    // 폐형 (1−π/4)·r²·L = 38.6mm³ 와 같은 자릿수여야 한다(메시 근사라 ±).
    expect(plain - one).toBeGreaterThan(20);
    expect(plain - one).toBeLessThan(80);
  }, 300_000);
});
