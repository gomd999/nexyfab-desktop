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

describe('판정한 항목이 0개면 "이상 없음"이 아니다', () => {
  it.each([
    ['landscape', 'fence_run'], ['landscape', 'planter_wall'], ['landscape', 'parking_pavement'],
    ['landscape', 'tree_planting'], ['landscape', 'pavilion'], ['landscape', 'apartment_complex'],
    // ⚠ 260729 정정: girder_bridge 를 여기서 뺐다. 당시엔 실제로 판정 0개였으나
    // (a) 바닥판 폭 자기정합을 추가했고 (b) countJudged 가 `ok` 필드를 세지 않아
    // **판정하는 템플릿을 0개로 잘못 고지**하던 버그를 고쳤다 — 아래 별도 케이스로 옮김.
  ])('%s/%s — 판정 0개가 드러난다', (d, id) => {
    const v = verdict(d, id);
    expect(v?.judged).toBe(0);
    expect(v?.evidenceSufficient).toBe(false);
    expect(v?.unavailable?.join(' ')).toContain('판정한 항목이 0개입니다');
  });

  it('"판정 대상 없음"과 "이상 없음"을 구별해 말한다', () => {
    const u = verdict('landscape', 'fence_run')!.unavailable!.join(' ');
    expect(u).toContain('"이상 없음"이 아닙니다');
    // 왜 비었는지도 말한다 — 검사가 실패한 것이 아니다.
    expect(u).toContain('합·불을 낸 항목이 하나도 없습니다');
  });

  it('소비자 판정문이 "이상 없음"이라 하지 않는다', () => {
    const html = (easySummary as unknown as (a: unknown, o: Record<string, unknown>) => string)(
      buildAssemblyTemplate('landscape', 'fence_run', {}),
      { title: 't', domain: 'landscape', domainSafety: verdict('landscape', 'fence_run') });
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
    // 조경은 목재 부재가 없으면 검사 항목이 비고 INPUT 표식도 없다.
    const u = verdict('landscape', 'fence_run')!.unavailable!.join(' ');
    expect(u).toContain('합·불을 낸 항목이 하나도 없습니다');
    expect(u).toContain('적용 대상이 없거나');   // 가능성으로만 제시
    expect(u).not.toContain('입력 대기 상태');
  });

  it('★countJudged 는 `ok` 필드 검사도 센다 — 안 세면 판정하는 템플릿이 0개로 고지된다', () => {
    // 교량·조경 검사 항목은 `pass` 가 아니라 `ok` 를 쓴다({name, ok:true}).
    // 첫 구현이 `pass` 만 세는 바람에 girder_bridge 가 바닥판 폭을 판정하고도
    // "판정 0개"로 나갔다 — 내가 고치려던 결함의 거울상이라 회귀로 박는다.
    const v = verdict('bridge', 'girder_bridge');
    expect(v?.judged).toBeGreaterThan(0);
    expect(v?.evidenceSufficient).toBe(true);
  });
});
