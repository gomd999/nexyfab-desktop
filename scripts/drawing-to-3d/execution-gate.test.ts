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

/**
 * GA 미생성 시 판정 불가 처리 (260728 §7-5).
 *
 * §7-5 로 MCP 툴을 훑다가 `execution_gate` 가 `ga2dDrawing` 실패를 조용히 삼키고
 * `gaHtml=''` 로 계속 진행하는 것을 발견했다. 그러면 GA 를 읽는 M3/M5/M6 이 전부
 * **"미충족"** 으로 보고된다 — 도면이 부실한 게 아니라 **없는 것**인데, 소비자는
 * "용접 기호가 빠졌어요"를 읽는다. 판정 못 한 것이 **틀린 판정**으로 둔갑한다.
 */
describe('checkExecutionReadiness — GA 미생성은 "미충족"이 아니라 "판정 불가"', () => {
  const asm = {
    name: '용접 있는 어셈블리',
    parts: [
      { id: 'base', type: 'box', material: 'SS400', params: { width: 300, depth: 300, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
      { id: 'post', type: 'box', material: 'SS400', params: { width: 60, depth: 60, height: 400 }, at: { tx: 120, ty: 120, tz: 20 } },
    ],
  };
  const welds = [{ a: 'base', b: 'post', lengthMm: 240 }];

  it('★GA 가 없으면 M3·M5·M6 이 FAIL 이 아니라 N/A 로 나온다', () => {
    const r = checkExecutionReadiness(asm, { gaHtml: '', sheetsHtml: '<div>재질 SS400</div>', welds });
    const by = (id: string) => r.items.find((i) => i.id === id)!;
    for (const id of ['M3', 'M5', 'M6']) {
      expect(by(id).pass, id).toBeNull();
      expect(by(id).detail.join(' '), id).toContain('판정 불가');
    }
    // failed 목록에 끌려 들어가지 않는다 — 이게 소비자 문서로 새던 경로다
    expect(r.failed.some((f) => /^M[356] /.test(f))).toBe(false);
  });

  it('GA 미생성 사실이 note 와 플래그로 드러난다 — 조용히 넘어가지 않는다', () => {
    const r = checkExecutionReadiness(asm, { gaHtml: '', sheetsHtml: '', welds });
    expect((r as { gaMissing?: boolean }).gaMissing).toBe(true);
    expect(r.note).toContain('GA 도면 미생성');
  });

  it('부품도만으로 판정 가능한 항목은 그대로 판정한다 (M1)', () => {
    const r = checkExecutionReadiness(asm, { gaHtml: '', sheetsHtml: '', welds });
    expect(r.items.find((i) => i.id === 'M1')!.pass).not.toBeNull();
  });

  it('GA 가 있으면 종전과 동일하게 판정한다 (하위호환)', () => {
    const ga = '<div class="nf-gentol">일반공차</div><div>재질 SS400</div>';
    const r = checkExecutionReadiness(asm, { gaHtml: ga, sheetsHtml: '', welds });
    expect((r as { gaMissing?: boolean }).gaMissing).toBeUndefined();
    expect(r.items.find((i) => i.id === 'M5')!.pass).toBe(true);
    expect(r.items.find((i) => i.id === 'M3')!.pass).toBe(false); // nf-weldarrow 없음 = 진짜 미충족
  });
});
