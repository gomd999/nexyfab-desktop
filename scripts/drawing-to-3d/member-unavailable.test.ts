/**
 * 부재 강도 미검토가 "이상 없음"으로 읽히던 것 (260728).
 *
 * structuralCheck 의 부재 휨/처짐 검토는 호출자가 지간·단면을 선언했을 때만 돈다
 * (opts.member). 그런데 주 경로(assembly.mjs)는 `structuralCheck(asm, {})` 로 부르므로
 * **모든 패키지에서 member=null** 이었고, warnings 는 비고 ok=true 가 됐다.
 * method 문자열은 "단순보 부재"를 수행한 것처럼 나열했다.
 *
 * 실측: 보 8개 가대 → structural.ok=true · warnings=[] · 쉬운요약 "구조 안전(개산)
 * 이상 없음". 부재 응력·처짐을 하나도 보지 않고서 그렇게 나갔다.
 */
import { describe, it, expect } from 'vitest';
import { structuralCheck } from './structural.mjs';
import { easySummary } from './easy-summary.mjs';

type Structural = {
  ok: boolean; warnings: string[]; method: string; member: unknown;
  memberUnavailable?: { ran: boolean; candidates: number; messageKo: string; needInputs: unknown[] };
};
const check = structuralCheck as unknown as (a: unknown, o?: unknown) => Structural;
const summary = easySummary as unknown as (a: unknown, o?: Record<string, unknown>) => string;

const beamRig = (n: number) => ({
  name: '안정 가대', domain: 'mech',
  parts: [
    { id: 'base', type: 'box', role: 'slab', material: 'steel', params: { width: 4000, depth: 4000, height: 100 }, at: { tx: 0, ty: 0, tz: 50 } },
    ...Array.from({ length: n }, (_, i) => ({
      id: `bm_${i}`, type: 'box', role: 'beam', material: 'steel',
      params: { width: 3800, depth: 100, height: 150 }, at: { tx: 0, ty: -1750 + i * 500, tz: 175 },
    })),
  ],
});

describe('부재 검토를 안 했으면 안 했다고 말한다', () => {
  it('보가 있는데 지간·단면 미선언이면 memberUnavailable 로 남는다', () => {
    const s = check(beamRig(8), {});
    expect(s.member).toBeNull();
    expect(s.memberUnavailable?.ran).toBe(false);
    expect(s.memberUnavailable?.candidates).toBe(8);
    expect(s.memberUnavailable?.messageKo).toContain('안전하다"는 뜻이 아닙니다');
  });

  it('필요한 입력을 이름으로 알려준다 — 무엇을 주면 검토되는지', () => {
    const s = check(beamRig(3), {});
    const names = (s.memberUnavailable?.needInputs as { name: string }[]).map((x) => x.name);
    expect(names).toContain('member.section');
    expect(names).toContain('member.spanMm');
  });

  it('안 돌린 검토를 method 에 적지 않는다 — 적으면 수행한 것으로 읽힌다', () => {
    const s = check(beamRig(4), {});
    expect(s.method).not.toContain('· 단순보 부재');
    expect(s.method).toContain('부재 휨/처짐 미검토');
  });

  it('지간·단면을 주면 종전대로 검토하고 미검토 표시는 사라진다 — 회귀 없음', () => {
    const s = check(beamRig(4), { member: { section: 'SHS50x50x3', spanMm: 1300 } });
    expect(s.member).not.toBeNull();
    expect(s.memberUnavailable).toBeUndefined();
    expect(s.method).toContain('· 단순보 부재');
  });

  it('보·기둥이 하나도 없으면 침묵한다 — 해당 없는 곳에 경고를 뿌리지 않는다', () => {
    const slabOnly = { name: '판', domain: 'mech', parts: [
      { id: 'base', type: 'box', role: 'slab', material: 'steel', params: { width: 1000, depth: 1000, height: 50 }, at: { tx: 0, ty: 0, tz: 25 } },
    ] };
    expect(check(slabOnly, {}).memberUnavailable).toBeUndefined();
  });

  it('미검토는 실패가 아니다 — ok 를 false 로 뒤집지 않는다', () => {
    // 못 본 것을 "문제 발견"으로 바꾸면 그것도 거짓이다. ok 는 그대로 두고 판정 불가로 전달.
    const s = check(beamRig(8), {});
    expect(s.ok).toBe(true);
    expect(s.warnings).toHaveLength(0);
  });

  it('쉬운요약 판정문이 "이상 없음"을 한정한다 — 굵은 글씨만 읽어도 오해하지 않게', () => {
    const html = summary(beamRig(8), { title: '안정 가대', domain: 'mech' });
    const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(txt).toContain('구조 안전(개산) 이상 없음 (부재 강도 미검토');
  });
});

describe('Dossier 가 부재 단면·지간을 지어내지 않는다', () => {
  // 종전: dossierReport 가 **어떤 어셈블리에든** {section:'SHS50x50x3', spanMm:1000} 을
  // 지어내 넘겼다. 실측(301부재 아치, 실제 부재 120×120·간격 400mm): 지어낸 50×50×3 이
  // 188,714kg 를 받는 것으로 계산돼 "부재 이용률 452" 가 문서에 찍히고
  // "부재 SHS50x50x3 초과 — 단면 상향 필요" 경고까지 떴다 — 존재하지 않는 부재를
  // 키우라는 지시다.
  const dossier = async (a: unknown, o?: Record<string, unknown>) => {
    const { dossierReport } = await import('./pid_dossier.mjs') as unknown as
      { dossierReport: (a: unknown, o?: Record<string, unknown>) => string };
    return dossierReport(a, { title: 't', ...o }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  };

  it('선언이 없으면 이용률을 만들어내지 않고 미검토를 적는다', async () => {
    const txt = await dossier(beamRig(8));
    expect(txt).not.toContain('SHS50x50x3');
    expect(txt).not.toMatch(/부재 이용률/);
    expect(txt).toContain('부재 강도(휨응력·처짐) 미검토');
  });

  it('없는 부재를 키우라는 경고가 뜨지 않는다', async () => {
    const txt = await dossier(beamRig(8));
    expect(txt).not.toMatch(/부재 SHS\S* 초과/);
  });

  it('호출자가 선언하면 검토하고 근거를 "선언값"으로 밝힌다 — 기능 상실 없음', async () => {
    const txt = await dossier(beamRig(8), { member: { section: 'SHS50x50x3', spanMm: 1000 } });
    expect(txt).toMatch(/부재 이용률 [\d.]+\(SHS50x50x3 지간 1000mm — 선언값\)/);
    expect(txt).not.toContain('부재 강도(휨응력·처짐) 미검토');
  });
});
