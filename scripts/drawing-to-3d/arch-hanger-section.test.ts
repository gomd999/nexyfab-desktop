/**
 * 아치교 행어 단면 근거 명시 (260729).
 *
 * 전수 감사에서 출하 `arch_bridge` 가 자기 검사에서 FAIL 났다(행어 ratio 1.387).
 * 파고들다 면적 계산이 `hangerDia × hangerDia` 인 것을 보고 "원형봉인데 사각 면적을
 * 쓴다"고 의심했으나 — **틀린 가설이었다.** 실측하니 행어 부품이 실제로
 * `type:'box', width=depth=90` 인 **각봉**이라 d² 가 형상과 일치한다.
 *
 * 다만 진짜 문제가 남는다: 메타명이 `hangerDia`(지름 = 원형봉)인데 형상은 각봉이다.
 * 이름만 보고 Ø90 로 발주하면 면적이 πd²/4 = 6,362mm² 로 **27% 작아진다** —
 * 검사는 8,100 으로 통과 여부를 따졌는데 실물은 6,362 인 상황이 된다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { archBridgeCheck } from './bridge-check.mjs';

type Chk = { name: string; sigma_MPa: number; ratio: number; ok: boolean; note?: string };
const run = (p?: unknown) =>
  (archBridgeCheck as unknown as (a: unknown, p: unknown) => { checks: Chk[]; verdict: string })(
    buildAssemblyTemplate('bridge', 'arch_bridge', {}), p ?? {});
const hanger = (p?: unknown) => run(p).checks.find((c) => /행어/.test(c.name))!;

describe('단면 근거를 감추지 않는다', () => {
  it('형상 기준(각봉)임을 명시한다 — 계산과 형상은 일치한다', () => {
    const h = hanger();
    expect(h.note).toContain('각봉 90×90 = 8100mm²');
    expect(h.note).toContain('모델 형상 기준');
  });

  it('이름과 형상의 불일치를 경고한다 — Ø90 로 읽으면 27% 작다', () => {
    const h = hanger();
    expect(h.note).toContain('메타명은 hangerDia 지만 형상은 각봉');
    expect(h.note).toContain('6362mm²');
    expect(h.note).toContain('발주 전 확인');
  });

  it('A 를 직접 입력하면 그 값을 근거로 적는다 — 추측이 섞이지 않는다', () => {
    expect(hanger({ A_hanger_mm2: 12000 }).note).toContain('입력값 12000mm²');
    expect(hanger({ A_hanger_mm2: 12000 }).note).not.toContain('각봉');
  });
});

describe('출하 템플릿의 FAIL 은 실제 판정이다 — 덮지 않는다', () => {
  it('행어가 허용응력을 초과한다(ratio > 1) — 이 사실을 유지한다', () => {
    // 단면 근거를 밝혔다고 해서 판정을 바꾸지 않는다. 하중 모델이 간이(보수측)라는 것은
    // 검사 자신이 명시하고 있고, 초과는 초과다.
    const h = hanger();
    expect(h.ok).toBe(false);
    expect(h.ratio).toBeGreaterThan(1);
    expect(run().verdict).toBe('FAIL');
  });

  it('단면을 키우면 통과한다 — 검사가 공허하지 않다', () => {
    expect(hanger({ A_hanger_mm2: 12000 }).ok).toBe(true);
  });
});

describe('사하중이 중실 모델에서 나온다는 사실을 밝힌다 (260729)', () => {
  // 실측: 120m 타이드 아치의 wDC 577.1 kN/m 중 타이 2본 222 · 아치 리브 215 kN/m 이
  // **중실 강재**(타이 800×1800 · 리브 900×1400) 자중이다. 실 타이드 아치는 제작
  // 박스(중공)라 자중이 훨씬 작다. 사하중은 모든 부재력을 지배하므로 이 근사가
  // 행어 장력까지 부풀리고, 그것이 곧 "행어 초과" 판정이 됐다.
  const loads = (p?: unknown) =>
    (archBridgeCheck as unknown as (a: unknown, p: unknown) => {
      loads: { wDC_kNm: number; deadShare_kN: Record<string, number>; basis: string };
      checks: Chk[]; verdict: string;
    })(buildAssemblyTemplate('bridge', 'arch_bridge', {}), p ?? {});

  it('자중 분담을 부재별로 보고한다 — 어디서 왔는지 감추지 않는다', () => {
    const l = loads().loads;
    expect(l.deadShare_kN.tie_L).toBeGreaterThan(0);
    expect(l.deadShare_kN.arch).toBeGreaterThan(0);
    expect(l.deadShare_kN.main_deck).toBeGreaterThan(0);
  });

  it('중실 모델임을 명시하고 보수측 치우침을 경고한다', () => {
    const b = loads().loads.basis;
    expect(b).toContain('중실 단면');
    expect(b).toContain('보수측으로 크게 치우칠 수 있다');
    expect(b).toContain('A_tie_mm2');
  });

  it('단면을 선언하면 자중과 응력을 같은 단면으로 계산한다 — 한쪽에만 쓰지 않는다', () => {
    // 종전엔 A 입력이 **응력에만** 반영되고 자중은 중실 형상 그대로였다.
    const base = loads().loads.wDC_kNm;
    const declared = loads({ A_tie_mm2: 150000, A_rib_mm2: 110000 }).loads;
    expect(declared.wDC_kNm).toBeLessThan(base * 0.5); // 577 → 183
    // 일부만 선언하면 **선언한 것만** 반영되고 나머지는 여전히 중실이라고 말한다.
    expect(declared.basis).toContain('hanger');
    expect(declared.basis).not.toContain('tie_L');

    const all = loads({ A_tie_mm2: 150000, A_rib_mm2: 110000, A_hanger_mm2: 8100 }).loads;
    expect(all.basis).toContain('선언 A 입력 기준');
    expect(all.basis).not.toContain('중실 단면');
  });

  it('행어 초과는 중실 모델의 인공물이었다 — 실단면 선언 시 통과', () => {
    expect(loads().verdict).toBe('FAIL');
    const r = loads({ A_tie_mm2: 150000, A_rib_mm2: 110000, A_hanger_mm2: 8100 });
    expect(r.verdict).toBe('PASS');
    expect(r.checks.find((c) => /행어/.test(c.name))!.ratio).toBeLessThan(1);
  });

  it('중공률을 가정하지 않는다 — 선언이 없으면 중실 유지(보수측)', () => {
    expect(loads().loads.wDC_kNm).toBeCloseTo(577.1, 0);
  });
});
