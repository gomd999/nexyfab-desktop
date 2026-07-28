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
