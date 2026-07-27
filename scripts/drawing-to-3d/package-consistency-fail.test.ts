/**
 * 산출물 크로스 정합 게이트의 **실패 경로** 회귀 (260728, §6-3 선행조건).
 *
 * 배경: 260727 A-7 전수감사는 consistency(문서 간 수치 정합)를 "소비자 문서에 실을지"
 * 잔여(P2)로 남기면서 착수 조건을 못 박았다 — **실패 사례를 만들 수 있을 때**.
 * 4개 도메인 템플릿이 전부 pass 라 어셈블리 쪽에서는 실패를 못 만들었기 때문이다.
 *
 * 그런데 실패를 만들려고 어셈블리를 위조할 필요가 없다. `packageConsistencyCheck` 는
 * **문서가 실제로 인쇄한 숫자를 정규식으로 회수해** 기준(basis)과 대조하는 순수 함수다.
 * 서로 어긋나는 문서 집합을 직접 주면 검출기의 실패 경로가 결정론으로 재현된다.
 * 이 테스트가 없으면 "지금까지 한 번도 FAIL 을 낸 적 없다"가 "검출기가 동작한다"의
 * 근거가 되어버린다 — 실제로는 회수 정규식이 죽어서 조용히 통과했을 수도 있다.
 */
import { describe, it, expect } from 'vitest';
import { packageConsistencyCheck as _pcc } from './package.mjs';
import { easySummary as _es } from './easy-summary.mjs';

type Basis = { rev: string; massKg: number; env: number[]; parts: number };
type Check = { file: string; metric: string; value: number; expect: number; tol: number; pass: boolean; note?: string };
const packageConsistencyCheck = _pcc as unknown as (
  files: Array<{ name: string; content: string }>,
  basis: Basis,
  o?: { hasFluid?: boolean; alignment?: unknown },
) => { pass: boolean; checks: Check[]; rev: string };

const BASIS: Basis = { rev: 'aabbccdd', massKg: 200, env: [1000, 500, 300], parts: 3 };

const structural = (kg: number) => `<html><body><p>총 질량 <b>${kg.toFixed(1)} kg</b></p></body></html>`;
const boq = (kg: number) => `<html><body><div><b>${kg.toFixed(1)} kg</b><span>총 자재 질량</span></div></body></html>`;
const dossier = (kg: number) => `<html><body><div><b>${kg.toFixed(1)} kg</b><span>총 질량</span></div></body></html>`;

const find = (checks: Check[], file: string, metricPart: string) =>
  checks.find((c) => c.file === file && c.metric.includes(metricPart));

describe('packageConsistencyCheck — 실패 경로가 실제로 동작하는가', () => {
  it('전 문서가 기준과 일치하면 pass (과탐 0)', () => {
    const res = packageConsistencyCheck(
      [
        { name: 'structural.html', content: structural(200) },
        { name: 'BOQ.html', content: boq(200) },
        { name: 'Dossier.html', content: dossier(200) },
      ],
      BASIS,
    );
    expect(res.pass).toBe(true);
    expect(res.checks.length).toBeGreaterThan(0); // 0건이면 회수 정규식이 죽은 것이다
    expect(find(res.checks, 'structural.html', 'totalMassKg')?.value).toBe(200);
  });

  it('★구조 문서가 기준과 다른 질량을 인쇄하면 FAIL 로 잡힌다', () => {
    const res = packageConsistencyCheck(
      [
        { name: 'structural.html', content: structural(100) }, // 기준 200 과 불일치
        { name: 'BOQ.html', content: boq(200) },
        { name: 'Dossier.html', content: dossier(200) },
      ],
      BASIS,
    );
    expect(res.pass).toBe(false);
    const c = find(res.checks, 'structural.html', 'totalMassKg');
    expect(c?.pass).toBe(false);
    expect(c?.value).toBe(100);
    expect(c?.expect).toBe(200);
  });

  it('★Dossier 와 BOQ 가 서로 다른 질량을 인쇄하면 문서-대-문서 대조가 잡는다', () => {
    const res = packageConsistencyCheck(
      [
        { name: 'structural.html', content: structural(200) },
        { name: 'BOQ.html', content: boq(200) },
        { name: 'Dossier.html', content: dossier(160) }, // 1% 허용을 크게 넘김
      ],
      BASIS,
    );
    expect(res.pass).toBe(false);
    expect(find(res.checks, 'Dossier.html↔BOQ.html', 'totalMassKg')?.pass).toBe(false);
  });

  it('유체가 있으면 BOQ(자재질량) 대 구조(운전질량) 대조는 생략하고 그 사실을 note 로 남긴다', () => {
    const res = packageConsistencyCheck(
      [
        { name: 'structural.html', content: structural(200) },
        { name: 'BOQ.html', content: boq(120) }, // 정의가 달라 불일치가 정상
        { name: 'Dossier.html', content: dossier(120) },
      ],
      BASIS,
      { hasFluid: true },
    );
    const c = find(res.checks, 'BOQ.html', 'totalMassKg');
    expect(c?.pass).toBe(true);
    expect(c?.note).toContain('대조 생략');
  });

  it('문서가 없으면 "대조 불가"로 스킵한다 — 없는 것을 통과로도 실패로도 세지 않는다', () => {
    const res = packageConsistencyCheck([], BASIS);
    expect(res.pass).toBe(true);
    expect(res.checks.filter((c) => c.metric.includes('totalMassKg'))).toHaveLength(0);
  });
});

/**
 * 소비자 문서 도달 — A-7 잔여(P2)의 본체. 위에서 검출기의 실패 경로를 고정했으므로
 * 이제 그 판정을 쉬운요약에 실어도 "미검증 코드를 소비자 문서에 넣는" 것이 아니다.
 */
const easySummary = _es as unknown as (asm: unknown, opts?: Record<string, unknown>) => string;

const OK_ASM = {
  name: '정합 테스트 받침대',
  parts: [
    { id: 'base', type: 'box', material: 'SS400', params: { width: 300, depth: 300, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'post', type: 'box', material: 'SS400', params: { width: 60, depth: 60, height: 400 }, at: { tx: 120, ty: 120, tz: 20 } },
  ],
};
const FAILING = { pass: false, rev: 'aabbccdd', checks: [
  { file: 'BOQ.html', metric: 'totalMassKg(vs 구조)', value: 160, expect: 200, tol: 2, pass: false },
  { file: 'structural.html', metric: 'totalMassKg', value: 200, expect: 200, tol: 2, pass: true },
] };

describe('쉬운요약 — 문서 정합 불일치가 소비자에게 도달하는가 (§6-3)', () => {
  it('불일치가 있으면 별도 경고 블록으로 실리고, 실패한 항목만 나열한다', () => {
    const html = easySummary(OK_ASM, { title: 't', domain: 'mech', consistency: FAILING });
    expect(html).toContain('동봉 문서끼리 숫자가 어긋납니다');
    expect(html).toContain('BOQ.html');
    expect(html).toContain('160');
    // 통과한 항목은 경고에 끌어오지 않는다(과탐 0)
    expect(html).not.toContain('structural.html — totalMassKg:');
  });

  it('★안전 판정을 오염시키지 않는다 — 서류 문제이지 "형상이 위험하다"가 아니다', () => {
    const html = easySummary(OK_ASM, { title: 't', domain: 'mech', consistency: FAILING });
    // 안전 경고 목록/종합 판정은 그대로여야 한다
    expect(html).toContain('걸린 안전 경고는 없습니다');
    expect(html).not.toContain('지금 형상 그대로 만들면 위험합니다');
    expect(html).toContain('형상이 위험하다는 뜻은 아니지만');
  });

  it('통과했으면 아무 말도 하지 않는다 — 대조 못한 문서가 있으므로 "전부 맞다"고 보증하지 않는다', () => {
    const html = easySummary(OK_ASM, { title: 't', domain: 'mech', consistency: { pass: true, rev: 'aabbccdd', checks: [] } });
    expect(html).not.toContain('동봉 문서끼리 숫자가 어긋납니다');
    expect(html).not.toContain('문서가 서로 맞습니다');
  });

  it('정합을 아예 실행하지 못했으면(error) 침묵한다 — 실패로 둔갑시키지 않는다', () => {
    const html = easySummary(OK_ASM, { title: 't', domain: 'mech', consistency: { error: 'boom' } });
    expect(html).not.toContain('동봉 문서끼리 숫자가 어긋납니다');
  });

  it('consistency 를 안 넘기면 종전과 동일(하위호환)', () => {
    const a = easySummary(OK_ASM, { title: 't', domain: 'mech' });
    const b = easySummary(OK_ASM, { title: 't', domain: 'mech', consistency: null });
    expect(a).toBe(b);
    expect(a).not.toContain('동봉 문서끼리');
  });
});
