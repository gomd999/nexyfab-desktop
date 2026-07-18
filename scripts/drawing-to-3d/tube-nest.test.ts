import { describe, it, expect } from 'vitest';
import { buildAssembly, assemblyToComposeIntent } from './assembly.mjs';

/** 보어 내포 폐형(260718t) — 케이싱(tube)×로터/샤프트 동축 내포는 간섭이 아니다. */
describe('보어 내포 폐형 — 동축 회전체 in 중공 회전체', () => {
  const build = (parts: unknown[]) => buildAssembly({ name: 't', domain: 'mech', parts }) as {
    ok: boolean; interferences: Array<{ a: string; b: string }>; gateErrors: string[];
  };

  it('수평(x축) 케이싱 tube 안의 로터 tube + 샤프트 cylinder — 간섭 0', () => {
    const r = build([
      { id: 'case', type: 'tube', params: { outerDia: 520, innerDia: 500, length: 300 }, at: { tx: 400, ty: 400, tz: 800, ry: 90 }, role: 'frame', material: 'steel' },
      { id: 'rotor', type: 'tube', params: { outerDia: 480, innerDia: 90, length: 200 }, at: { tx: 450, ty: 400, tz: 800, ry: 90 }, role: 'mount', material: 'steel' },
      { id: 'shaft', type: 'cylinder', params: { diameter: 80, length: 600 }, at: { tx: 200, ty: 400, tz: 800, ry: 90 }, role: 'mount', material: 'steel' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.interferences).toEqual([]);
  });

  it('수직(z축) flange 가 케이스 외경에 슬립(보어>외경) — 간섭 0', () => {
    const r = build([
      { id: 'case', type: 'cylinder', params: { diameter: 520, length: 400 }, at: { tx: 0, ty: 0, tz: 0 }, role: 'vessel', material: 'steel' },
      { id: 'fl', type: 'flange', params: { outerDia: 580, boreDia: 522, thickness: 20, bcd: 550, boltHoleD: 18, boltCount: 12 }, at: { tx: 0, ty: 0, tz: 100 }, role: 'mount', material: 'steel' },
    ]);
    expect(r.interferences).toEqual([]);
  });

  it('보어보다 큰 내부물·벽 물림 오프셋은 여전히 간섭(과소탐 금지)', () => {
    const r = build([
      { id: 'case', type: 'tube', params: { outerDia: 520, innerDia: 500, length: 300 }, at: { tx: 0, ty: 400, tz: 800, ry: 90 }, role: 'frame', material: 'steel' },
      { id: 'big', type: 'cylinder', params: { diameter: 510, length: 200 }, at: { tx: 50, ty: 400, tz: 800, ry: 90 }, role: 'mount', material: 'steel' },
      { id: 'off', type: 'cylinder', params: { diameter: 200, length: 200 }, at: { tx: 50, ty: 400, tz: 970, ry: 90 }, role: 'mount', material: 'steel' },
    ]);
    const pairs = r.interferences.map((q) => [q.a, q.b].sort().join('+'));
    expect(pairs).toContain('big+case');
    expect(pairs.some((p) => p.includes('off') && p.includes('case'))).toBe(true);
  });

  it('로컬 오프셋은 부품 회전을 따라 변환 — ry=90 pipe_reducer 2단이 +x 로 진행(월드 z 부유 금지)', () => {
    const intent = assemblyToComposeIntent({
      parts: [{ id: 'r', type: 'pipe_reducer', params: { dia1: 520, dia2: 420, length: 300, wallThk: 10 }, at: { tx: 650, ty: 400, tz: 800, ry: 90 } }],
    }) as { features: Array<{ op: string; _pid?: number; at: { translate: number[] } }> };
    const adds = intent.features.filter((f) => f.op !== 'subtract');
    expect(adds[1].at.translate).toEqual([800, 400, 800]); // 2단=+150 along x(축), z 불변
    for (const f of intent.features) expect(f._pid).toBe(0); // 부품 스코프 태그
  });

  it('pipe_reducer 케이스 보어=소경-벽두께 보수 판정', () => {
    const r = build([
      { id: 'cone', type: 'pipe_reducer', params: { dia1: 520, dia2: 420, length: 300, wallThk: 10 }, at: { tx: 0, ty: 400, tz: 800, ry: 90 }, role: 'frame', material: 'steel' },
      { id: 'drumOk', type: 'cylinder', params: { diameter: 380, length: 250 }, at: { tx: 20, ty: 400, tz: 800, ry: 90 }, role: 'mount', material: 'steel' },
    ]);
    expect(r.interferences).toEqual([]);
  });
});
