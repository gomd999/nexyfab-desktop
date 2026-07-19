/**
 * T2 실시 검도 게이트 M1~M6 회귀(260719).
 * GA+부품도 조합=전 항목 PASS · 부품도 없는 특례 치수=정직 M1 거부(post: 높이 누락 사상).
 */
import { describe, it, expect } from 'vitest';
import { buildAssembly } from './assembly.mjs';
import { ga2dDrawing as _ga2d } from './package.mjs';
import { partSheets as _ps } from './part-sheets.mjs';
import { checkExecutionReadiness } from './execution-gate.mjs';

const ga2dDrawing = _ga2d as unknown as (asm: unknown, opts?: Record<string, unknown>) => string;
const partSheets = _ps as unknown as (asm: unknown, opts?: Record<string, unknown>) => string;
type Gate = { ok: boolean; score: string; items: { id: string; pass: boolean | null; detail: string[] }[]; failed: string[]; na: string[] };
const item = (r: Gate, id: string) => r.items.find((i) => i.id === id)!;

const ASM = {
  parts: [
    { id: 'bed', type: 'plate_with_holes', params: { width: 300, depth: 200, thickness: 20, holes: [{ x: 40, y: 40, d: 10 }, { x: 260, y: 40, d: 6, kind: 'tap', thread: 'M6', depth: 15 }] }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'post', type: 'box', params: { width: 60, depth: 60, height: 400 }, at: { tx: 120, ty: 70, tz: 20 } },
    { id: 'brace', type: 'box', params: { width: 350, depth: 40, height: 40 }, at: { tx: 0, ty: 80, tz: 20, rz: 30 } },
  ],
};

describe('T2 실시 검도 게이트', () => {
  it('GA+부품도: M1~M6 전 적용 항목 PASS(용접 화살표·구멍표·나사·일반공차·헐 투영)', () => {
    const built = buildAssembly(ASM);
    expect(built.ok).toBe(true);
    expect(built.welds.length).toBeGreaterThan(0); // post↔bed 면접촉 필릿
    const ga = ga2dDrawing(ASM, { title: 't2', domain: 'mech', welds: built.welds });
    const sheets = partSheets(ASM, { title: 't2-sheets' });
    const r = checkExecutionReadiness(ASM, { gaHtml: ga, sheetsHtml: sheets, welds: built.welds }) as Gate;
    expect(item(r, 'M1').pass, JSON.stringify(item(r, 'M1').detail)).toBe(true);
    expect(item(r, 'M2').pass, JSON.stringify(item(r, 'M2').detail)).toBe(true);
    expect(item(r, 'M3').pass).toBe(true); // nf-weldarrow 실배치
    expect(item(r, 'M4').pass).toBe(true);
    expect(item(r, 'M5').pass).toBe(true);
    expect(item(r, 'M6').pass).toBe(true); // brace rz=30 → 헐 폴리곤
    expect(r.ok).toBe(true);
  });
  it('부품도 없는 은닉 치수(stepped_plate 단차) = M1 정직 거부 — "치수 누락" 지목', () => {
    const asm = { parts: [{ id: 'sp1', type: 'stepped_plate', params: { width: 200, depth: 120, thickness: 20, stepWidth: 47, stepThickness: 9.5 }, at: { tx: 0, ty: 0, tz: 0 } }] };
    const ga = ga2dDrawing(asm, { title: 't2b', domain: 'mech' });
    const r = checkExecutionReadiness(asm, { gaHtml: ga, welds: [] }) as Gate;
    expect(item(r, 'M1').pass).toBe(false);
    expect(item(r, 'M1').detail.join(' ')).toContain('sp1');
    expect(item(r, 'M1').detail.join(' ')).toMatch(/stepWidth|stepThickness/);
    // 부품도(제작 치수 행) 동봉 시 해소
    const r2 = checkExecutionReadiness(asm, { gaHtml: ga, sheetsHtml: partSheets(asm), welds: [] }) as Gate;
    expect(item(r2, 'M1').pass).toBe(true);
  });
  it('해당 없음=N/A(감점 아님): 구멍·용접·탭·회전 없는 단순 프레임', () => {
    const asm = { parts: [{ id: 'c1', type: 'box', params: { width: 100, depth: 100, height: 900 }, at: { tx: 0, ty: 0, tz: 0 } }] };
    const ga = ga2dDrawing(asm, { title: 't2c', domain: 'mech' });
    const r = checkExecutionReadiness(asm, { gaHtml: ga, sheetsHtml: partSheets(asm), welds: [] }) as Gate;
    expect(r.na).toEqual(expect.arrayContaining(['M2', 'M3', 'M4', 'M6']));
    expect(r.ok).toBe(true);
  });
});
