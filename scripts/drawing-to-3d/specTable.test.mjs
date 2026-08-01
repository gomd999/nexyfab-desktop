/**
 * specTable — **계산해 둔 제원이 사용자 문서에 닿는가** (260801, 격차 W3).
 *
 * 잡는 것은 「표가 그려지나」가 아니라 이 저장소가 반복해 온 결함들이다:
 *   · 계산은 하는데 안 내보냄 — 감속비가 게이트에만 있고 리포트엔 없던 상태
 *   · 모르는 것을 지어냄 — 뜻 모르는 키에 한글 라벨을 붙이는 것
 *   · 없음을 이상으로 적음 — 메타 없는 템플릿에 「제원 없음」이라 쓰는 것
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { specTable } from './package.mjs';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';

test('★감속비가 실제로 표에 실린다 — 지금까지 게이트만 읽던 값', () => {
  const r = buildAssemblyTemplate('mech', 'gear_train', {});
  const asm = r.assembly ?? r;
  assert.ok(asm.gearMeta, '전제: gear_train 은 gearMeta 를 만든다');
  const html = specTable(asm);
  assert.match(html, /총 감속비/);
  assert.ok(html.includes(String(asm.gearMeta.totalRatio)), '계산된 감속비 값 자체가 실려야 한다');
});

test('★모르는 키는 번역하지 않고 원래 이름으로 낸다', () => {
  const html = specTable({ xMeta: { tubePitch: 32, someKeyWeDoNotKnow: 7 } });
  assert.match(html, /관 피치/);                    // 아는 것은 번역
  assert.match(html, /someKeyWeDoNotKnow/);         // 모르는 것은 그대로 — 지어내지 않는다
});

test('아는 키에도 원래 이름을 병기한다 — 오역이면 독자가 알아챌 수 있게', () => {
  const html = specTable({ xMeta: { totalRatio: 12.5 } });
  assert.match(html, /totalRatio/);
});

test('★메타가 없으면 빈 문자열 — 「제원 없음」이라고 적지 않는다', () => {
  assert.equal(specTable({ name: 'x', parts: [] }), '');
  assert.equal(specTable(null), '');
  assert.equal(specTable({ xMeta: {} }), '');
});

test('★Grashof 를 참/거짓이 아니라 뜻으로 적는다', () => {
  assert.match(specTable({ xMeta: { grashof: true } }), /완전회전 가능/);
  const no = specTable({ xMeta: { grashof: false } });
  assert.match(no, /불충족/);
  /**
   * ⚠ 처음엔 `doesNotMatch(/충족 —/)` 로 썼는데 **검사 도구가 틀린** 것이었다:
   *   한국어에서 「불충족」은 「충족」을 부분문자열로 반드시 포함한다. 그 검사는 통과할 수 없다.
   *   진짜 위험은 글자가 아니라 **뜻**이다 — 회전 불가를 회전 가능으로 읽는 것.
   */
  assert.doesNotMatch(no, /완전회전 가능/);
  assert.match(no, /회전 불가/);
});

test('★값을 지어내 채우지 않는다 — null·빈문자·중첩객체는 행을 만들지 않는다', () => {
  const html = specTable({ xMeta: { totalRatio: 5, a: null, b: '', c: { deep: 1 }, d: [{ o: 1 }] } });
  assert.match(html, /총 감속비/);
  for (const k of ['a', 'b', 'c', 'd']) assert.doesNotMatch(html, new RegExp(`\\(${k}\\)`));
});

test('배열은 나열로 읽힌다 — 중심거리·피치원', () => {
  assert.match(specTable({ xMeta: { centerDistances: [40, 60] } }), /40 · 60/);
});

test('★note 는 행이 아니라 각주로 — 표 안에 문장이 들어가면 표가 안 읽힌다', () => {
  const html = specTable({ xMeta: { diameter: 100, note: '맞물림 중심거리 폐형 배치' } });
  assert.match(html, /맞물림 중심거리 폐형 배치/);
  assert.doesNotMatch(html, /\(note\)/);
});

test('★결론 항목이 앞에 온다 — 감속비가 표 끝에 있으면 안 읽힌다', () => {
  const html = specTable({ xMeta: { thickness: 10, module: 2, totalRatio: 9 } });
  assert.ok(html.indexOf('총 감속비') < html.indexOf('치폭'), '감속비가 치폭보다 앞');
});

test('★실측: 메타를 가진 템플릿 전부에서 표가 나오고, 없는 템플릿은 조용하다', () => {
  const seen = { withMeta: 0, rendered: 0, without: 0, quiet: 0 };
  for (const t of buildAssemblyTemplate.list ? buildAssemblyTemplate.list() : LIST) {
    let asm;
    try { const r = buildAssemblyTemplate(t.domain, t.id, {}); asm = r.assembly ?? r; } catch { continue; }
    const has = Object.keys(asm).some((k) => /Meta$/.test(k) && asm[k] && typeof asm[k] === 'object' && Object.keys(asm[k]).length);
    const html = specTable(asm);
    if (has) { seen.withMeta++; if (html) seen.rendered++; }
    else { seen.without++; if (!html) seen.quiet++; }
  }
  assert.ok(seen.withMeta > 20, `전제: 메타 보유 템플릿이 충분히 많아야 한다 (실측 ${seen.withMeta})`);
  assert.equal(seen.rendered, seen.withMeta, '메타가 있으면 빠짐없이 표가 나와야 한다');
  assert.equal(seen.quiet, seen.without, '메타가 없으면 아무것도 안 그려야 한다');
});

/** 템플릿 목록 — 러너가 목록 API 를 노출하지 않는 경우의 대체 경로. */
const LIST = (await import('./domain-assemblies.mjs')).listAssemblyTemplates?.() ?? [];
