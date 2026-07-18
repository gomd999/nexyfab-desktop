import { describe, it, expect } from 'vitest';
import { buildAssembly, assemblyToComposeIntent, assemblyAtLevel, autoTagAssembly } from './assembly.mjs';

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

  it('체결 정합 — hex_bolt×flange(BCD)·hex_bolt×hex_nut = 접촉(간섭 아님)', () => {
    const r = build([
      { id: 'fl', type: 'flange', params: { outerDia: 580, boreDia: 522, thickness: 25, bcd: 552, boltHoleD: 18, boltCount: 16 }, at: { tx: 400, ty: 400, tz: 800, ry: 90 }, role: 'mount', material: 'steel' },
      { id: 'b1', type: 'hex_bolt', params: { threadDia: 16, length: 60 }, at: { tx: 435, ty: 400 + 276, tz: 800, ry: -90 }, role: 'mount', material: 'steel' },
      { id: 'n1', type: 'hex_nut', params: { af: 24, thickness: 13, boreDia: 16 }, at: { tx: 438, ty: 400 + 276, tz: 800, ry: -90 }, role: 'mount', material: 'steel' },
    ]);
    expect(r.interferences).toEqual([]);
    const notes = ((r as unknown as { contacts: Array<{ note?: string }> }).contacts ?? []).map((q) => q.note ?? '');
    expect(notes.some((n) => n.includes('볼트-플랜지'))).toBe(true);
    expect(notes.some((n) => n.includes('볼트-너트'))).toBe(true);
  });

  it('메시 방사 내·외포 — 링 메시가 케이스 보어 안·드럼 밖이면 실분리', () => {
    // 사각 링 단면의 8정점 프리즘(반경 150..200, x 100..140) — z축 아님 x축 링
    const mk = (r0: number, r1: number) => {
      const verts: number[][] = [];
      for (const r of [r0, r1]) for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) for (const x of [100, 140]) verts.push([x, 400 + r * Math.cos(a), 800 + r * Math.sin(a)]);
      const faces = [[0, 1, 2], [2, 1, 3], [4, 5, 6], [6, 5, 7]]; // 판정은 정점 기반 — 면은 최소
      return { volumeMm3: 1000, aabb: { min: [100, 400 - r1, 800 - r1], max: [140, 400 + r1, 800 + r1] }, verts, faces };
    };
    const r = build([
      { id: 'case', type: 'tube', params: { outerDia: 460, innerDia: 440, length: 200 }, at: { tx: 50, ty: 400, tz: 800, ry: 90 }, role: 'vessel', material: 'steel' },
      { id: 'drum', type: 'tube', params: { outerDia: 260, innerDia: 90, length: 150 }, at: { tx: 60, ty: 400, tz: 800, ry: 90 }, role: 'mount', material: 'steel' },
      { id: 'ring', type: 'mesh', params: mk(150, 200), at: { tx: 0, ty: 0, tz: 0 }, role: 'mount', material: 'steel' },
    ]);
    expect(r.interferences).toEqual([]);
  });

  it('계통 태그(_sys)·상세 단계(assemblyAtLevel) — 1차=골격 부분집합', () => {
    const parts = [
      { id: 'a', type: 'box', params: { width: 100, depth: 100, height: 100 }, at: { tx: 0, ty: 0, tz: 0 }, system: '시험대' },
      { id: 'b', type: 'hex_bolt', params: { threadDia: 16, length: 60 }, at: { tx: 300, ty: 0, tz: 0 }, system: '체결', detail: 2 },
    ];
    const draft = assemblyAtLevel({ name: 't', parts }, 1) as { parts: Array<{ id: string }> };
    expect(draft.parts.map((p) => p.id)).toEqual(['a']);
    const intent = assemblyToComposeIntent({ parts }) as { features: Array<{ _sys?: string }> };
    expect(intent.features[0]._sys).toBe('시험대');
    expect(intent.features.some((f) => f._sys === '체결')).toBe(true);
  });

  it('#1 autoTagAssembly — 미지정만 채움, detail2=철물/자유곡면, 1차=골격 부분집합', () => {
    const t2 = autoTagAssembly({
      parts: [
        { id: 'a', type: 'box', params: { width: 100, depth: 100, height: 100 }, at: { tx: 0, ty: 0, tz: 0 }, role: 'frame' },
        { id: 'b', type: 'hex_bolt', params: { threadDia: 16, length: 60 }, at: { tx: 300, ty: 0, tz: 0 } },
        { id: 'c', type: 'cylinder', params: { diameter: 50, length: 100 }, at: { tx: 600, ty: 0, tz: 0 }, system: '커스텀', detail: 2 },
      ],
    }) as { parts: Array<Record<string, unknown>> };
    expect(t2.parts[0].system).toBe('구조');
    expect(t2.parts[0].detail).toBeUndefined(); // box=골격(1)
    expect(t2.parts[1].system).toBe('체결');
    expect(t2.parts[1].detail).toBe(2);
    expect(t2.parts[2].system).toBe('커스텀'); // 기지정 불변
    expect((assemblyAtLevel(t2, 1) as { parts: unknown[] }).parts.length).toBe(1); // b·c=detail2 제외
  });

  it('revolve 실방출 — composeIntent 에 revolve 피처(실린더 프록시 아님)', () => {
    const intent = assemblyToComposeIntent({
      parts: [{ id: 's', type: 'revolve', params: { profile: [[0, 0], [90, 200], [0, 200]] }, at: { tx: 200, ty: 400, tz: 800, ry: 90 } }],
    }) as { features: Array<{ kind: string; profile?: number[][] }> };
    expect(intent.features[0].kind).toBe('revolve');
    expect(intent.features[0].profile?.length).toBe(3);
  });

  it('pipe_reducer 케이스 보어=소경-벽두께 보수 판정', () => {
    const r = build([
      { id: 'cone', type: 'pipe_reducer', params: { dia1: 520, dia2: 420, length: 300, wallThk: 10 }, at: { tx: 0, ty: 400, tz: 800, ry: 90 }, role: 'frame', material: 'steel' },
      { id: 'drumOk', type: 'cylinder', params: { diameter: 380, length: 250 }, at: { tx: 20, ty: 400, tz: 800, ry: 90 }, role: 'mount', material: 'steel' },
    ]);
    expect(r.interferences).toEqual([]);
  });
});
