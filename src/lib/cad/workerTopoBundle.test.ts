/**
 * K7-S1 — 워커 topo 번들 패리티: IIFE 번들의 출력이 TS 직수입과 **바이트 동일**
 * 계약(이름 집합·앵커 좌표)이어야 노드/워커 경로가 단일 소스로 묶인다.
 * 번들 재생성 누락(소스만 고치고 npm run build:worker-topo 안 돌림)도 여기서 잡힌다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExtrudeTopo, edgeMidpoint, namesOf } from './topoNaming';

type TopoModule = {
  buildExtrudeTopo: typeof buildExtrudeTopo;
  namesOf: typeof namesOf;
  edgeMidpoint: typeof edgeMidpoint;
};

function loadBundle(): TopoModule {
  const src = readFileSync(join(process.cwd(), 'occt-worker', 'topo-naming.bundle.js'), 'utf8');
  const self: { NexyTopo?: TopoModule } = {};
  new Function('self', `${src}; self.NexyTopo = NexyTopo;`)(self);
  return self.NexyTopo!;
}

const FEATURE = {
  id: 'f1',
  kind: 'extrude',
  loop: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
  depth: 10,
  direction: 'one_sided',
  mode: 'add',
} as never;

describe('worker topo bundle parity (K7-S1)', () => {
  it('bundle and direct TS import produce identical names and anchors', () => {
    const bundle = loadBundle();
    const a = buildExtrudeTopo(FEATURE);
    const b = bundle.buildExtrudeTopo(FEATURE);
    for (const kind of ['face', 'edge'] as const) {
      const namesA = namesOf(a, kind);
      const namesB = bundle.namesOf(b, kind);
      expect(namesB).toEqual(namesA);
      expect(namesA.length).toBeGreaterThan(0);
    }
    // 규약 이름 실재 + 앵커(에지 중점) 좌표 동일
    const faceNames = namesOf(a, 'face');
    expect(faceNames).toContain('f.cap.bottom');
    expect(faceNames.some(n => n.startsWith('f.side.'))).toBe(true);
    for (const name of namesOf(a, 'edge')) {
      const ma = edgeMidpoint(a, name);
      const mb = bundle.edgeMidpoint(b, name);
      expect(mb).toEqual(ma);
    }
  });

  it('public copy is byte-identical to the source bundle', () => {
    const src = readFileSync(join(process.cwd(), 'occt-worker', 'topo-naming.bundle.js'), 'utf8');
    const pub = readFileSync(join(process.cwd(), 'public', 'occt-worker', 'topo-naming.bundle.js'), 'utf8');
    expect(pub).toBe(src);
  });
});
