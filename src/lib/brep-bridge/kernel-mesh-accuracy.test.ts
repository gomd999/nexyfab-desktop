/**
 * kernel-mesh-accuracy.test.ts — 커널 메시 부피가 **고지한 만큼만 틀리는가** (260801i).
 *
 * ## 왜 필요한가
 * `stepKernelImport` 는 「곡면 부피가 최대 0.7% 과소로 나온다」고 **수치로 고지**한다.
 * 고지는 적어 두는 것만으로는 지켜지지 않는다 — 허용오차 기본값을 누가 바꾸면 그 문장이
 * 조용히 거짓이 된다. 정확부피를 아는 형상으로 **실제 편차를 재서** 고정한다.
 *
 * ## 왜 이 세 형상인가
 * 평면만 있는 형상은 삼각 근사가 정확하다. 오차는 **곡률에서만** 생기므로 곡률이 다른
 * 세 가지(원기둥=1방향, 구=2방향, 원환=2방향 복합)를 본다.
 *
 * ## ⚠ 편향은 한쪽이다
 * 삼각형이 볼록면을 **현으로 자르므로 항상 과소**다. 무작위 오차가 아니라 편향이라
 * 「±」로 적으면 안 된다 — 질량이 체계적으로 작게 나간다.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  KERNEL_MESH_TOL_MM,
  KERNEL_MESH_ANGULAR_DEG,
  KERNEL_CURVED_VOLUME_BIAS_PCT,
} from './stepKernelImport';

interface MeshLike { vertices: ArrayLike<number>; triangles: ArrayLike<number> }
interface Solid { mesh: (o: unknown) => MeshLike; delete?: () => void }
interface Rc {
  drawCircle: (r: number) => { sketchOnPlane: (p: string) => { extrude: (h: number) => Solid };
    translate: (v: [number, number]) => { sketchOnPlane: (p: string) => { revolve: (a: number[]) => Solid } } };
  makeSphere: (r: number) => Solid;
}

/** 삼각 메시 폐부피 — `stepKernelImport` 와 **같은 식**이다(다르면 대조가 무의미하다). */
function meshVolume(m: MeshLike): number {
  let v6 = 0;
  const V = m.vertices, T = m.triangles;
  for (let i = 0; i + 2 < T.length; i += 3) {
    const a = T[i]! * 3, b = T[i + 1]! * 3, c = T[i + 2]! * 3;
    v6 += V[a]! * (V[b + 1]! * V[c + 2]! - V[b + 2]! * V[c + 1]!)
      - V[a + 1]! * (V[b]! * V[c + 2]! - V[b + 2]! * V[c]!)
      + V[a + 2]! * (V[b]! * V[c + 1]! - V[b + 1]! * V[c]!);
  }
  return Math.abs(v6) / 6;
}

let rc: Rc | null = null;
async function kernel(): Promise<Rc> {
  if (rc) return rc;
  const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
  const mod = (await import(/* @vite-ignore */ pathToFileURL(join(base, 'to-step.mjs')).href)) as {
    ensureReplicad: () => Promise<Rc>;
  };
  rc = await mod.ensureReplicad();
  return rc;
}

describe('커널 메시 부피 — 고지한 편차 안에 있는가', () => {
  const opts = { tolerance: KERNEL_MESH_TOL_MM, angularTolerance: KERNEL_MESH_ANGULAR_DEG };

  it('★곡면 형상의 부피 과소가 고지값을 넘지 않는다 (원기둥·구·원환)', async () => {
    const k = await kernel();
    const cases: Array<[string, Solid, number]> = [
      ['원기둥 ⌀100×200', k.drawCircle(50).sketchOnPlane('XY').extrude(200), Math.PI * 50 * 50 * 200],
      ['구 ⌀100', k.makeSphere(50), (4 / 3) * Math.PI * 50 ** 3],
      ['원환 R100 r20', k.drawCircle(20).translate([100, 0]).sketchOnPlane('XZ').revolve([0, 0, 1]),
        2 * Math.PI ** 2 * 100 * 20 * 20],
    ];
    for (const [name, solid, exact] of cases) {
      const devPct = (meshVolume(solid.mesh(opts)) / exact - 1) * 100;
      solid.delete?.();
      // 과소 편향이 고지값 안에 있어야 한다.
      expect(devPct, `${name}: ${devPct.toFixed(3)}%`).toBeGreaterThan(-KERNEL_CURVED_VOLUME_BIAS_PCT);
      // ⚠ **과대는 나오면 안 된다.** 나오면 편향 방향 설명이 틀린 것이고, 메시가 닫히지
      //   않았을 가능성이 있다(그 경우 부피 자체가 의미 없다).
      expect(devPct, `${name} 이 과대로 나왔다 — 편향 방향 설명이 틀렸다`).toBeLessThanOrEqual(0.001);
    }
  }, 300_000);

  it('★허용오차를 조이면 편차가 실제로 줄어든다 — 옵션이 먹는지 확인', async () => {
    /**
     * ⚠ 처음 「replicad 가 tolerance 를 무시한다」고 판단했다가 정정했다 — 같은 shape 객체를
     *   재사용해 **캐시된 메시**를 다시 읽고 있었다. 옵션이 안 먹으면 고지값이 거짓이 되므로
     *   먹는다는 사실 자체를 검사로 둔다.
     */
    const k = await kernel();
    const exact = (4 / 3) * Math.PI * 50 ** 3;
    const coarse = k.makeSphere(50);
    const dCoarse = Math.abs(meshVolume(coarse.mesh({ tolerance: 1.0, angularTolerance: 45 })) / exact - 1);
    coarse.delete?.();
    const fine = k.makeSphere(50);
    const dFine = Math.abs(meshVolume(fine.mesh({ tolerance: 0.02, angularTolerance: 5 })) / exact - 1);
    fine.delete?.();
    expect(dFine, `조인 쪽 ${(dFine * 100).toFixed(3)}% 가 성긴 쪽 ${(dCoarse * 100).toFixed(3)}% 보다 작아야 한다`)
      .toBeLessThan(dCoarse);
  }, 300_000);
});
