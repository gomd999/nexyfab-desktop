/**
 * criterion-declared.test.ts — **참고값 9건을 판정으로 연다** (260802).
 *
 * ## 무엇이 문제였나
 * 판정불가 55건을 분해했을 때 9건이 「참고값(기준 미선언)」이었다. 전부 같은 형태였다 —
 * 「기준이 용도·등급이 정하는 값이라 판정하지 않는다」고 적어 두고 **`needInputs` 를
 * 하나도 안 달았다.** 그래서 요구 수집기에 안 잡히고, 사용자는 **무엇을 주면 되는지
 * 알 방법이 없었다.** 260802 오전에 고친 것(`fit` 경로·환기 상류 의존)과 같은 형태다.
 *
 * ## 어떻게 열었나 — **기준을 지어내지 않는다**
 * TEMA 권장 간격·용도별 P/D·좌석 간격 법정 기준은 표와 관례라서 우리가 값을 고르면
 * 근거가 우리 추측이 된다. 그래서 **사용자가 기준을 선언하면 그 기준으로 판정**한다
 * (`zoning.coverageLimitPct`·`seismicG` 와 같은 방식이고 이 리포가 이미 쓰는 패턴).
 *
 * **예외 하나 — 언더컷은 표가 아니라 수식이다.** 표준 이높이(ha*=1) 인벌류트 랙 절삭에서
 * `z_min = 2/sin²α` 이므로 α=20° → 17.10, α=14.5° → 31.90 이 **유도된다**(우리는 올림해 18·32).
 * 흔히 인용되는 17·32 가 여기서 나온다 — 표 인용이 아니라 유도라 출처 확보 없이 계산한다.
 *
 * ## 이 테스트가 지키는 것
 * 1. 선언한 **경로 문자열이 실제로 먹는지**(오늘 두 번 어긋났다 — `fit`·`pressureAngleDeg`)
 * 2. **불통과 방향도 나오는지** — 항상 통과하는 판정은 판정이 아니다
 * 3. 기준을 안 주면 **요구를 남기는지** — 조용히 사라지면 「해당 없음」으로 읽힌다
 */
import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { auditDomainSafety } from './domain-dossier-verify.mjs';
import { collectJudgments } from './domain-audit.mjs';

type Acc = {
  real: Array<{ label: string; pass: boolean }>;
  unjudged: Array<{ label: string; fields: string[] }>;
};

const build = (d: string, id: string) =>
  (buildAssemblyTemplate as unknown as (a: string, b: string, c: unknown) => Record<string, unknown>)(d, id, {});

/** 선언 경로 문자열을 **그대로 따라가** 값을 심는다 — 우리가 아는 실제 경로를 쓰지 않는다. */
function setDeclared(obj: Record<string, unknown>, path: string, value: unknown): void {
  const seg = path.split('.');
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < seg.length - 1; i++) {
    if (cur[seg[i]] == null || typeof cur[seg[i]] !== 'object') cur[seg[i]] = {};
    cur = cur[seg[i]] as Record<string, unknown>;
  }
  cur[seg[seg.length - 1]] = value;
}

const judge = (asm: unknown): Acc =>
  (collectJudgments as unknown as (t: unknown) => Acc)(
    ((auditDomainSafety as unknown as (a: unknown, p: unknown) => { result?: unknown })(asm, {})).result,
  );

/** 기준을 주기 전/후를 함께 본다. */
function probe(domain: string, id: string, fields: Record<string, unknown>, re: RegExp) {
  const before = judge(build(domain, id));
  const asm = build(domain, id);
  for (const [k, v] of Object.entries(fields)) setDeclared(asm, k, v);
  const after = judge(asm);
  return {
    waitingBefore: before.unjudged.filter((x) => re.test(x.label)),
    judgedAfter: after.real.filter((x) => re.test(x.label)),
    stillWaiting: after.unjudged.filter((x) => re.test(x.label)),
  };
}

const CASES: Array<[string, string, string, Record<string, unknown>, RegExp]> = [
  ['덕트 풍속', 'building', 'duct_run', { 'ductMeta.allowableVelocityMps': 8, 'ductMeta.designFlowCMH': 5000 }, /풍속/],
  ['행어 간격', 'building', 'duct_run', { 'ductMeta.hangerSpacingMaxMm': 3000 }, /행어/],
  ['기둥 세장비', 'landscape', 'pavilion', { 'pavilionMeta.allowableSlenderness': 20 }, /세장비/],
  ['문 짝수', 'interior', 'built_in_closet', { 'closetMeta.doorsPerBayMin': 1 }, /문 짝수/],
  ['좌석 간격', 'interior', 'counter_bar', { 'counterMeta.seatPitchMinMm': 550 }, /좌석 간격/],
  ['언더컷', 'mech', 'gear_train', { 'gearMeta.pressureAngleDeg': 20 }, /언더컷/],
  ['배플 간격', 'mech', 'heat_exchanger', { 'hxMeta.baffleSpacingMinMm': 300 }, /배플/],
  ['전달각', 'mech', 'four_bar', { 'fourBarMeta.transmissionAngleMinDeg': 40 }, /전달각/],
  ['피치비', 'mech', 'propeller', { 'propellerMeta.pdRatioMin': 0.5 }, /피치비/],
];

describe('기준을 선언하면 판정된다', () => {
  it.each(CASES)('★%s — 기준 없으면 요구를 남기고, 주면 판정된다', (_name, domain, id, fields, re) => {
    const r = probe(domain, id, fields, re);
    expect(r.waitingBefore.length, '기준 없을 때 항목 자체가 없다 — 조용히 사라지면 「해당 없음」으로 읽힌다').toBeGreaterThan(0);
    expect(r.waitingBefore[0].fields.length, '무엇을 달라는지 안 적혀 있다 — 사용자가 줄 수 없다').toBeGreaterThan(0);
    expect(r.judgedAfter.length, `선언한 경로 [${Object.keys(fields).join(', ')}] 가 판정을 켜지 못했다 — 안내가 실제와 다르다`).toBeGreaterThan(0);
    expect(r.stillWaiting, '기준을 줬는데 여전히 미판정으로 남아 있다').toEqual([]);
  });
});

describe('불통과 방향도 나온다 — 항상 통과하는 판정은 판정이 아니다', () => {
  it('★좌석 간격: 산출 600mm 인데 하한 700mm 를 주면 FAIL', () => {
    const r = probe('interior', 'counter_bar', { 'counterMeta.seatPitchMinMm': 700 }, /좌석 간격/);
    expect(r.judgedAfter[0]?.pass).toBe(false);
  });

  it('★기둥 세장비: 산출 16.0 인데 상한 10 을 주면 FAIL', () => {
    const r = probe('landscape', 'pavilion', { 'pavilionMeta.allowableSlenderness': 10 }, /세장비/);
    expect(r.judgedAfter[0]?.pass).toBe(false);
  });

  it('★언더컷: 20잇 기어에 압력각 14.5° 면 한계 32잇이라 FAIL — 유도식이 맞게 돈다', () => {
    const r = probe('mech', 'gear_train', { 'gearMeta.pressureAngleDeg': 14.5 }, /언더컷/);
    expect(r.judgedAfter[0]?.pass, 'z_min = 2/sin²14.5° = 31.90 → 올림 32잇 > 20잇 이므로 언더컷').toBe(false);
  });
});

describe('유도식은 표 인용이 아니다', () => {
  it('★압력각별 한계 잇수가 **계산으로** 나온다 — 20°→18 · 14.5°→32', () => {
    // 2/sin²α — 흔히 인용되는 두 값이 여기서 나온다. 표를 외워 적은 것이 아니다.
    const zMin = (deg: number) => Math.ceil(2 / Math.sin((deg * Math.PI) / 180) ** 2);
    expect(zMin(20)).toBe(18);     // 2/sin²20° = 17.10 → 올림 18
    expect(zMin(14.5)).toBe(32);   // 2/sin²14.5° = 31.90 → 올림 32
    /**
     * ⚠ 통상 인용되는 「17」·「32」는 **반올림**이다(17.10→17 · 31.90→32).
     *   우리는 **올림**을 쓴다 — 한계가 17.10잇이면 17잇은 미달이라 미세 언더컷이 난다.
     *   그래서 20° 에서만 교과서보다 한 잇 보수적이고(18), 14.5° 는 32로 일치한다.
     *   (처음 이 테스트에 33을 적었다가 실측으로 정정했다 — 31.90 이지 32.02 가 아니다.)
     */
    const r = probe('mech', 'gear_train', { 'gearMeta.pressureAngleDeg': 20 }, /언더컷/);
    expect(r.judgedAfter[0]?.label).toContain('20°');
  });
});
