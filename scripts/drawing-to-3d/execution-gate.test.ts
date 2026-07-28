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
    const r = checkExecutionReadiness(asm, { gaHtml: '', sheetsHtml: '<div>재질 SS400</div>', welds, gaFailed: true });
    const by = (id: string) => r.items.find((i) => i.id === id)!;
    for (const id of ['M3', 'M5', 'M6']) {
      expect(by(id).pass, id).toBeNull();
      expect(by(id).detail.join(' '), id).toContain('판정 불가');
    }
    // failed 목록에 끌려 들어가지 않는다 — 이게 소비자 문서로 새던 경로다
    expect(r.failed.some((f) => /^M[356] /.test(f))).toBe(false);
  });

  it('GA 미생성 사실이 note 와 플래그로 드러난다 — 조용히 넘어가지 않는다', () => {
    const r = checkExecutionReadiness(asm, { gaHtml: '', sheetsHtml: '', welds, gaFailed: true });
    expect((r as { gaMissing?: boolean }).gaMissing).toBe(true);
    expect(r.note).toContain('GA 도면 미생성');
  });

  it('GA 가 실패해도 부품도에서 확인된 PASS 는 그대로 남는다 — 확인된 것을 버리지 않는다', () => {
    // 부품도에 치수가 전부 있으면 GA 가 없어도 M1 은 옳게 PASS 다(합집합에서 찾았으므로).
    const sheets = '<p>300 300 20 60 60 400</p>';
    const r = checkExecutionReadiness(asm, { gaHtml: '', sheetsHtml: sheets, welds, gaFailed: true });
    expect(r.items.find((i) => i.id === 'M1')!.pass).toBe(true);
  });

  it('반대로 GA 실패 + 못 찾음이면 M1 FAIL 도 신뢰할 수 없어 N/A 가 된다', () => {
    const r = checkExecutionReadiness(asm, { gaHtml: '', sheetsHtml: '', welds, gaFailed: true });
    expect(r.items.find((i) => i.id === 'M1')!.pass).toBeNull();
  });

  it('GA 가 있으면 종전과 동일하게 판정한다 (하위호환)', () => {
    const ga = '<div class="nf-gentol">일반공차</div><div>재질 SS400</div>';
    const r = checkExecutionReadiness(asm, { gaHtml: ga, sheetsHtml: '', welds });
    expect((r as { gaMissing?: boolean }).gaMissing).toBeUndefined();
    expect(r.items.find((i) => i.id === 'M5')!.pass).toBe(true);
    expect(r.items.find((i) => i.id === 'M3')!.pass).toBe(false); // nf-weldarrow 없음 = 진짜 미충족
  });
});

/**
 * 부품 제작도 미생성 — GA 케이스의 **대칭 사례**이자 더 섬세한 규칙 (260728).
 *
 * M1·M2·M4 는 GA+부품도의 **합집합**에서 찾는다. 그래서 소스가 하나 빠져도
 *  · 찾았으면(PASS) 그 판정은 여전히 옳고,
 *  · 못 찾았으면(FAIL) "도면에 없음"과 "그 도면이 없음"을 구별할 수 없다.
 * → **FAIL 만 N/A 로 낮추고 PASS 는 그대로 둔다.** 통째로 N/A 로 만들면 멀쩡히 확인된
 *   것까지 버려 과소 보고가 된다.
 */
describe('checkExecutionReadiness — 부품도 미생성 시 FAIL 만 판정 불가로', () => {
  // 치수가 어디에도 없으면 M1 은 원래 FAIL — 소스 결손이면 그 FAIL 을 신뢰할 수 없다.
  const asm = {
    name: '판재',
    parts: [{ id: 'p1', type: 'plate_with_holes', material: 'SS400', params: { width: 137, depth: 91, thickness: 13, holes: [{ x: 20, y: 20, d: 9 }] }, at: { tx: 0, ty: 0, tz: 0 } }],
  };

  it('★부품도가 없으면 M1 FAIL 이 N/A 로 낮춰지고 사유가 붙는다', () => {
    const r = checkExecutionReadiness(asm, { gaHtml: '<div class="nf-gentol">재질</div>', sheetsHtml: '', sheetsFailed: true });
    const m1 = r.items.find((i) => i.id === 'M1')!;
    expect(m1.pass).toBeNull();
    expect(m1.detail.join(' ')).toContain('부품 제작도');
    expect(m1.detail.join(' ')).toContain('판정 불가');
    expect(r.failed.some((f) => f.startsWith('M1'))).toBe(false);
    expect((r as { sheetsMissing?: boolean }).sheetsMissing).toBe(true);
  });

  it('★소스가 빠져도 PASS 는 그대로 둔다 — 확인된 것을 버리지 않는다', () => {
    // 치수가 GA 에 전부 있으면 부품도가 없어도 M1 은 옳게 PASS 다.
    const ga = '<div class="nf-gentol">재질</div><p>137 91 13</p>';
    const r = checkExecutionReadiness(asm, { gaHtml: ga, sheetsHtml: '', sheetsFailed: true });
    expect(r.items.find((i) => i.id === 'M1')!.pass).toBe(true);
  });

  it('★생성 실패가 아니라 애초에 안 만든 것이면 종전대로 FAIL — 도면에 정말 없다', () => {
    // 이 구별을 뭉갰다가 기존 회귀("부품도 없는 은닉 치수 = M1 정직 거부")에 정확히 잡혔다.
    const r = checkExecutionReadiness(asm, { gaHtml: '<div class="nf-gentol">재질</div>', sheetsHtml: '' });
    expect(r.items.find((i) => i.id === 'M1')!.pass).toBe(false);
    expect((r as { sheetsMissing?: boolean }).sheetsMissing).toBeUndefined();
  });

  it('두 소스가 다 있으면 종전과 동일 (하위호환)', () => {
    const r = checkExecutionReadiness(asm, { gaHtml: '<div class="nf-gentol">재질</div>', sheetsHtml: '<p>일부</p>' });
    expect((r as { sheetsMissing?: boolean }).sheetsMissing).toBeUndefined();
    expect(r.items.find((i) => i.id === 'M1')!.pass).toBe(false); // 진짜 미충족은 그대로 FAIL
  });
});

describe('근거 충분성(evidence_sufficient) — 빈 검사가 합격이 되던 자리 (260728)', () => {
  // 실 CAD 코퍼스가 독립적으로 같은 함정을 잡았다(result/report/layer2-pilot.md):
  // "모든 대조가 skip 되고 watertight 만 남아 score 1.0 으로 통과할 뻔 — 게이트가
  //  아무것도 검증 않고 도장 찍는 최악 케이스."
  const asm = { name: 'x', domain: 'mech', parts: [
    { id: 'p', type: 'box', role: 'slab', params: { width: 100, depth: 100, height: 5 }, at: { tx: 0, ty: 0, tz: 0 } },
  ] };
  const run = (o: Record<string, unknown>) =>
    (checkExecutionReadiness as unknown as (a: unknown, o: unknown) => {
      score: string; ok: boolean; evidenceSufficient: boolean; note: string;
    })(asm, o);

  it('GA·부품도가 둘 다 없으면 M1~M6 전부 N/A → 통과가 아니다', () => {
    // 종전: applicable=[] 에서 `[].every(...)` 가 true → score "0/0" · ok true ·
    // 소비자 문구 "0/0 (제작 착수 가능 수준)". 도면이 안 만들어진 패키지가
    // 제작 착수 가능으로 선언됐다.
    const g = run({ gaHtml: '', sheetsHtml: '', welds: [], gaFailed: true, sheetsFailed: true });
    expect(g.evidenceSufficient).toBe(false);
    expect(g.ok).toBe(false);
    expect(g.score).toContain('0/0');
  });

  it('원인을 설계 결함이 아니라 산출물 부재로 지목한다', () => {
    // "보완 필요"로만 적으면 도면을 고치라는 뜻으로 읽힌다 — 고칠 도면 자체가 없다.
    const g = run({ gaHtml: '', sheetsHtml: '', welds: [], gaFailed: true, sheetsFailed: true });
    expect(g.note).toContain('설계 결함이 아니라');
    expect(g.note).toContain('도면 생성 실패 원인');
  });

  it('점수가 분모 붕괴를 감추지 않는다 — "2/2" 와 "6/6" 은 똑같이 100% 로 읽힌다', () => {
    const g = run({ gaHtml: '<div class="nf-gentol">재질</div>', sheetsHtml: '', welds: [] });
    expect(g.score).toMatch(/전 6항목 중 \d개 해당없음/);
  });
});
