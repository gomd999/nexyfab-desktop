/**
 * 지진·풍하중 미실시가 침묵하던 것 (260729).
 *
 * 두 검토는 **이미 구현돼 있다** — KDS 41 17 00 등가정적(층중량→V·Fx→포탈법→기둥
 * 지진조합)과 KDS 41 12 00 풍하중. 그런데 각각 `params.seismic.R` · `params.wind.V0`
 * 가 있을 때만 돌고, 패키지 경로는 verifyParams 를 비운 채 호출했다. 게다가
 * `generate_domain_package` 는 verifyParams 를 **전달조차 하지 않았다** — 넣어도
 * 반영되지 않는 구조였다.
 *
 * 결과: 생성되는 모든 건물 도면집에서 지진·풍이 한 번도 돌지 않았고
 * `seismic:null · wind:null · ok:true` 로 나갔다. 소비자는 "하중경로 검토 이상 없음"을
 * 구조 검증으로 읽는다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { loadPathCheck } from './load-path.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';
import { easySummary } from './easy-summary.mjs';

type LP = { ok: boolean; scope: string; seismic: unknown; wind: unknown; lateralUnavailable?: { what: string; needInputs: { name: string }[]; messageKo: string }[] };
const lp = loadPathCheck as unknown as (a: unknown, p: unknown) => LP;
const frame = () => buildAssemblyTemplate('building', 'rc_frame', {});

describe('안 돌린 횡하중 검토를 침묵으로 두지 않는다', () => {
  it('기본 실행에서 지진·풍이 미실시로 보고된다', () => {
    const r = lp(frame(), {});
    expect(r.seismic).toBeNull();
    expect(r.wind).toBeNull();
    expect(r.lateralUnavailable?.map((u) => u.what)).toEqual(['seismic', 'wind']);
  });

  it('"안전하다는 뜻이 아니다"를 명시한다', () => {
    const u = lp(frame(), {}).lateralUnavailable ?? [];
    expect(u[0].messageKo).toContain('"지진에 안전하다"는 뜻이 아닙니다');
    expect(u[1].messageKo).toContain('"풍하중에 안전하다"는 뜻이 아닙니다');
  });

  it('형상에서 알 수 없는 값만 요구한다 — R·V0', () => {
    // 층높이·층중량·건물외곽은 이미 형상에서 파생된다. 추측해 넣으면 그게 날조다.
    const u = lp(frame(), {}).lateralUnavailable ?? [];
    expect(u[0].needInputs[0].name).toBe('seismic.R');
    expect(u[1].needInputs[0].name).toBe('wind.V0');
  });

  it('scope 문자열이 미실시를 표시한다 — 안전검토 문서에 그대로 실린다', () => {
    expect(lp(frame(), {}).scope).toContain('⚠ 미실시');
  });

  it('R·V0 를 주면 실제로 돌고 미실시 표시가 사라진다 — 회귀 없음', () => {
    const r = lp(frame(), { seismic: { R: 5 }, wind: { V0: 30 } });
    expect(r.seismic).not.toBeNull();
    expect(r.wind).not.toBeNull();
    expect(r.lateralUnavailable).toBeUndefined();
    expect(r.scope).toContain('등가정적 지진');
    expect(r.scope).not.toContain('미실시');
  });
});

describe('소비자 도달', () => {
  const verdict = (p: unknown) =>
    (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => { ok: boolean; unavailable?: string[] })(frame(), p);

  it('통과한 검토라도 미실시 항목을 함께 올린다', () => {
    const v = verdict({});
    expect(v.ok).toBe(true);          // 찾은 문제는 없다
    expect(v.unavailable).toHaveLength(2); // 그러나 두 항목을 보지 않았다
  });

  it('판정문이 "이상 없음"을 한정한다', () => {
    const html = (easySummary as unknown as (a: unknown, o: Record<string, unknown>) => string)(
      frame(), { title: 't', domain: 'building', domainSafety: verdict({}) });
    expect(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('2개 항목 미실시');
  });
});
