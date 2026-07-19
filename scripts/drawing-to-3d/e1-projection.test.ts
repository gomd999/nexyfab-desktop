/** E1 실윤곽 투영 회귀(260719) — 비90° 회전 부품=코너 사영 볼록헐, 축정렬=사각 유지. */
import { describe, it, expect } from 'vitest';
import { ga2dDrawing as _ga2d } from './package.mjs';
import { placedCorners } from './assembly.mjs';

const ga2dDrawing = _ga2d as unknown as (asm: unknown, opts?: Record<string, unknown>) => string;

const brace = { id: 'brace', type: 'box', params: { width: 1000, depth: 60, height: 60 }, at: { tx: 0, ty: 0, tz: 0, rz: 30 }, material: 'steel', role: 'beam' };
const col = { id: 'col', type: 'box', params: { width: 100, depth: 100, height: 800 }, at: { tx: 1200, ty: 0, tz: 0 }, material: 'steel', role: 'column' };

describe('E1 실윤곽 투영', () => {
  it('rz=30 브레이스: FRONT·PLAN 폴리곤 실루엣(2), 축정렬만이면 0', () => {
    const html = ga2dDrawing({ parts: [brace, col] }, { title: 'e1', domain: 'mech' });
    expect((html.match(/<polygon points=/g) ?? []).length).toBe(2);
    expect((ga2dDrawing({ parts: [col] }, { title: 'e1b', domain: 'mech' }).match(/<polygon points=/g) ?? []).length).toBe(0);
  });
  it('placedCorners: rz=90 박스 코너가 AABB 와 일치(단일 수학 검증)', () => {
    const cs = placedCorners({ type: 'box', params: { width: 200, depth: 100, height: 50 }, at: { rz: 90 } });
    const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
    expect(Math.min(...xs)).toBeCloseTo(-100, 6); // rz=90: width→-y … x 스팬=depth
    expect(Math.max(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(200, 6);
  });
});
