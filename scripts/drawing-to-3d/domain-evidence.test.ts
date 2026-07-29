/**
 * 도메인 안전 판정의 근거 충분성 (260729).
 *
 * 실시검도 게이트·완성도 게이트에는 evidence_sufficient 를 넣었으면서 **정작
 * domainSafetyVerdict 에는 넣지 않았다.** `ok: failed.length === 0` 이므로 판정한
 * 항목이 0개면 자동으로 "이상 없음"이 된다.
 *
 * 실측(전 49종): 7건이 판정 0개인 채 "이상 없음"으로 인쇄되고 있었다 —
 * 조경 6종(단지·울타리·화단벽·주차포장·정자·식재) + girder_bridge.
 * 목재 부재가 없는 조경에서 목재 검토가 비는 것은 **정상**이다. 문제는 그것이
 * "조경 검토 이상 없음"으로 읽혔다는 것이다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';
import { easySummary } from './easy-summary.mjs';

type V = { label: string; ok: boolean; judged: number; evidenceSufficient: boolean; unavailable?: string[] } | null;
const verdict = (d: string, id: string) =>
  (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => V)(buildAssemblyTemplate(d, id, {}), {});

/**
 * ⚠ 260731: 「판정 0개」의 검체가 없어졌다.
 *
 * `apartment_complex` 는 51종 중 **유일하게 실판정 0** 이라 이 파일 전체의 검체였는데,
 * 계획 P2-④ 로 단지 배치 검토(인동간격 등)를 붙이면서 실판정이 생겼다. 검체가 사라졌다고
 * **불변식을 지울 수는 없다** — 「판정 0개는 통과가 아니다」는 이 세션 내내 지킨 규약이다.
 * `rc_frame` 에서 `rcMeta` 를 지워 검체를 만든 것과 같은 방식으로, 제원 메타를 지운
 * 어셈블리를 검체로 쓴다. 실제로 사용자가 매싱만 만들고 제원을 안 넣으면 이 상태가 된다.
 */
function landscapeNoJudgment() {
  const a = buildAssemblyTemplate('landscape', 'apartment_complex', {}) as Record<string, unknown>;
  delete a.siteLayout;
  return a;
}
const noJudgmentVerdict = () =>
  (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => V)(landscapeNoJudgment(), {});

describe('판정한 항목이 0개면 "이상 없음"이 아니다', () => {
  it('제원 메타가 없는 조경 매싱 — 판정 0개가 드러난다', () => {
    const v = noJudgmentVerdict();
    expect(v?.judged).toBe(0);
    expect(v?.evidenceSufficient).toBe(false);
    expect(v?.unavailable?.join(' ')).toContain('판정한 항목이 0개입니다');
  });

  it('★단지 제원을 선언하면 판정 0개가 해소된다 — P2-④ 의 결과', () => {
    // 검체를 바꾼 이유가 회귀로 남아야 한다. 「검사를 안 붙여서 0」이 아니라
    // 「제원이 없어서 0」이라는 것이 이 두 케이스의 대조로 확정된다.
    const v = verdict('landscape', 'apartment_complex');
    expect(v?.judged).toBeGreaterThan(0);
    expect(v?.unavailable?.join(' ') ?? '').not.toContain('판정한 항목이 0개');
  });

  /**
   * ⚠ 이 목록은 **비어 가는 것이 정상**이다 — 세션마다 「판정 0개」 템플릿이 하나씩
   * 실판정을 얻어 빠져 나갔고, 260731 에 마지막(`apartment_complex`)이 빠졌다.
   * 그 기록을 남긴다. 목록이 비었다고 불변식이 없어진 것이 아니라, 검체를 위의
   * 「제원 메타 없는 어셈블리」로 옮긴 것이다.
   *
   *  · 260729  girder_bridge — 바닥판 폭 자기정합 추가 + `countJudged` 가 `ok` 를
   *            안 세던 버그(판정하는 템플릿을 0개로 오고지) 수정
   *  · 260729c planter_wall·parking_pavement·tree_planting — 포장 층 두께·수관경·저판 폭
   *  · 260730  fence_run·pavilion — 기둥 간격·살대·가로대 / 용마루·처마·경사각
   *  · 260731  apartment_complex — 인동간격(건축법 시행령 §86③)
   */

  it('"판정 대상 없음"과 "이상 없음"을 구별해 말한다', () => {
    const u = noJudgmentVerdict()!.unavailable!.join(' ');
    expect(u).toContain('"이상 없음"이 아닙니다');
    // 왜 비었는지도 말한다 — 검사가 실패한 것이 아니다.
    expect(u).toContain('합·불을 낸 항목이 하나도 없습니다');
  });

  it('소비자 판정문이 "이상 없음"이라 하지 않는다', () => {
    const html = (easySummary as unknown as (a: unknown, o: Record<string, unknown>) => string)(
      landscapeNoJudgment(),
      { title: 't', domain: 'landscape', domainSafety: noJudgmentVerdict() });
    const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(t).toContain('판정한 항목 0개');
    expect(t).not.toMatch(/조경 검토[^·]*이상 없음/);
  });
});

describe('실제로 판정한 것은 그대로 통과시킨다 — 과잉 반응 금지', () => {
  it.each([
    ['landscape', 'pergola'], ['landscape', 'timber_deck'],
    ['bridge', 'truss_bridge'], ['interior', 'cafe_room'],
  ])('%s/%s — 판정 항목이 있으면 evidenceSufficient', (d, id) => {
    const v = verdict(d, id);
    expect(v?.judged).toBeGreaterThan(0);
    expect(v?.evidenceSufficient).toBe(true);
  });

  it('판정이 있으면 종전대로 "이상 없음" — 회귀 없음', () => {
    const html = (easySummary as unknown as (a: unknown, o: Record<string, unknown>) => string)(
      buildAssemblyTemplate('landscape', 'timber_deck', {}),
      { title: 't', domain: 'landscape', domainSafety: verdict('landscape', 'timber_deck') });
    expect(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('조경 검토 (목재부재·배수 등) 이상 없음');
  });
});

describe('판정 0개의 이유를 뭉개지 않는다', () => {
  it('배근 미선언이면 "입력 대기"로 갈린다(대상 없음이 아니다)', () => {
    // ⚠ 260729 갱신: rc_frame 은 이후 rcMeta 로 배근을 선언해 판정 7개가 됐다.
    // 그 선언을 빼면 종전 상태가 그대로 재현된다 — 보·기둥·기초가 전부
    // verdict "INPUT(beamAs/colAst/footing)" 이고 checks:null. 단면력은 산출됐는데
    // 배근이 없어 강도 판정을 못 하는 것이므로 "대상 없음"이 아니라 "판정 불가"다.
    const a = buildAssemblyTemplate('building', 'rc_frame', {}) as unknown as Record<string, unknown>;
    delete a.rcMeta;
    const v = (domainSafetyVerdict as unknown as (x: unknown, p: unknown) => V)(a, {});
    expect(v?.judged).toBe(0);
    const u = v!.unavailable!.join(' ');
    expect(u).toContain('입력 대기 상태');
    expect(u).toContain('판정 불가');
  });

  it('배근을 선언하면 판정 0개가 해소된다 — 이 수정의 결과', () => {
    const v = verdict('building', 'rc_frame');
    expect(v?.judged).toBeGreaterThan(0);
    expect(v?.unavailable?.join(' ') ?? '').not.toContain('판정한 항목이 0개');
  });

  it('이유를 모르면 단정하지 않는다 — INPUT 표식이 없으면 사실만 적는다', () => {
    // 조경은 목재 부재도 제원도 없으면 검사 항목이 비고 INPUT 표식도 없다.
    const u = noJudgmentVerdict()!.unavailable!.join(' ');
    expect(u).toContain('합·불을 낸 항목이 하나도 없습니다');
    expect(u).toContain('적용 대상이 없거나');   // 가능성으로만 제시
    expect(u).not.toContain('입력 대기 상태');
  });

  it('★countJudged 는 `ok` 필드 검사도 센다 — 안 세면 판정하는 템플릿이 0개로 고지된다', () => {
    // 교량·조경 검사 항목은 `pass` 가 아니라 `ok` 를 쓴다({name, ok:true}).
    // 첫 구현이 `pass` 만 세는 바람에 실판정하는 템플릿이 "판정 0개"로 나갔다 —
    // 고치려던 결함의 거울상이라 회귀로 박는다.
    const v = verdict('bridge', 'truss_bridge');   // 하현재 인장·상현재 압축·단부 대각재
    expect(v?.judged).toBeGreaterThan(0);
    expect(v?.evidenceSufficient).toBe(true);
  });

  it('★그러나 자기정합은 안전 판정이 아니다 — 260729b 정정', () => {
    // ⚠ 이 테스트는 원래 `girder_bridge` 로 "판정 0개가 아니다"를 고정하고 있었다.
    //   **그 전제가 틀렸다.** girder_bridge 의 유일한 검사는 "바닥판 폭 자기정합"
    //   (`kind:'self-consistency'`)이고, 그것은 형상이 자기모순이 아니라는 뜻이지
    //   구조가 안전하다는 뜻이 아니다. 그 하나로 evidenceSufficient 가 충족돼
    //   **실판정 0개인 교량이 「이상 없음」으로 나가고 있었다** — 안전망이 범주 오류로
    //   뚫린 자리다. 이제 안전 판정 분모에서 빼므로 「판정 불가」로 드러난다.
    const v = verdict('bridge', 'girder_bridge');
    expect(v?.judged).toBe(0);
    expect(v?.evidenceSufficient).toBe(false);
    expect(v?.unavailable?.join(' ')).toContain('입력 대기');   // 대상 없음이 아니다
  });
});
