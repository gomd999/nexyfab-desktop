import { describe, it, expect } from 'vitest';
import { buildAssembly, assemblyToComposeIntent } from './assembly.mjs';
import { gate, partAabb } from './reconstruct.mjs';
import { partVolume } from './structural.mjs';

const beam = { id: 'beam', type: 'box', params: { width: 3000, depth: 300, height: 500 }, at: { tx: 0, ty: 0, tz: 0 }, role: 'beam', material: 'concrete' };
const main = { id: 'm1', type: 'rebar', params: { dia: 22, points: [[50, 50, 50], [2950, 50, 50]] }, at: { tx: 0, ty: 0, tz: 0 }, role: 'rebar', material: 'steel' };
const stirrup = { id: 'st1', type: 'rebar', params: { dia: 10, points: [[500, 50, 50], [500, 250, 50], [500, 250, 450], [500, 50, 450], [500, 50, 50]] }, at: { tx: 0, ty: 0, tz: 0 }, role: 'rebar', material: 'steel' };

describe('rebar 어휘(R2-④) — 폴리라인 스윕 봉', () => {
  it('게이트 — dia·points 검증(정직 거부)', () => {
    expect(gate({ type: 'rebar', dia: 22, points: [[0, 0, 0], [100, 0, 0]] })).toEqual([]);
    expect(gate({ type: 'rebar', dia: 0, points: [[0, 0, 0], [100, 0, 0]] }).length).toBeGreaterThan(0);
    expect(gate({ type: 'rebar', dia: 22, points: [[0, 0, 0]] }).length).toBeGreaterThan(0);
  });

  it('AABB(±r) + 체적(π/4·d²·경로장 폐형)', () => {
    const bb = partAabb({ type: 'rebar', dia: 22, points: [[50, 50, 50], [2950, 50, 50]] }) as { min: number[]; max: number[] };
    expect(bb.min).toEqual([39, 39, 39]);
    expect(bb.max).toEqual([2961, 61, 61]);
    const v = partVolume('rebar', main.params) as number;
    expect(v).toBeCloseTo((Math.PI / 4) * 22 ** 2 * 2900, 3);
    // 스터럽 폐루프 경로장 = 2*(200+400)=1200
    expect(partVolume('stirrup' === 'stirrup' ? 'rebar' : 'rebar', stirrup.params)).toBeCloseTo((Math.PI / 4) * 100 * 1200, 3);
  });

  it('매입·교차 분류 — 부재 내포=매입, rebar 쌍=결속(간섭 0)', () => {
    const b = buildAssembly({ name: 'rc', domain: 'building', parts: [beam, main, stirrup] }) as {
      ok: boolean; interferences: unknown[]; contacts: Array<{ note: string }>;
    };
    expect(b.ok).toBe(true);
    expect(b.interferences).toEqual([]);
    expect(b.contacts.filter((c) => c.note.includes('매입')).length).toBe(2);
    expect(b.contacts.filter((c) => c.note.includes('교차')).length).toBe(1);
  });

  it('composeIntent — 세그먼트 실린더(방향 회전)+절점 스피어, _pid 스코프', () => {
    const intent = assemblyToComposeIntent({ parts: [stirrup] }) as {
      features: Array<{ kind: string; at: { rotate?: number[] }; _pid?: number }>;
    };
    const cyls = intent.features.filter((f) => f.kind === 'cylinder');
    const sphs = intent.features.filter((f) => f.kind === 'sphere');
    expect(cyls.length).toBe(4); // 폐루프 4변
    expect(sphs.length).toBe(3); // 내부 절점
    expect(cyls[0].at.rotate).toEqual([0, 90, 90]); // +y 세그먼트
    for (const f of intent.features) expect(f._pid).toBe(0);
  });
});
