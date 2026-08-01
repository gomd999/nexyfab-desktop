/**
 * 어셈블리 카탈로그 다국어 — **빠진 것을 기계가 센다** (260801).
 *
 * 이 검사의 목적은 번역 품질이 아니라 **완결성**이다. 사람이 「다 했다」고 말하는 대신
 * 남은 개수가 0인지 기계가 확인한다. 오늘 이 저장소에서 반복된 실패가
 * 「만들었다고 적었지만 실제로는 안 닿았다」였기 때문이다.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LANGS, TEMPLATE_LABELS, PARAM_LABELS, localizeLabel, localizeTemplates } from './assembly-i18n.mjs';
import { listAssemblyTemplates } from './domain-assemblies.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'domain-assemblies.mjs'), 'utf8');
const NON_KO = LANGS.filter((l) => l !== 'ko');

/** 원본이 실제로 쓰는 한국어 라벨을 그대로 긁는다 — 손으로 옮겨 적으면 어긋난다. */
function sourceLabels() {
  const titles = [...SRC.matchAll(/labelKo:\s*'([^']*)'\s*,\s*labelEn:\s*'([^']*)'/g)].map((m) => ({ ko: m[1], en: m[2] }));
  const titleSet = new Set(titles.map((t) => t.ko));
  const params = [...new Set([...SRC.matchAll(/labelKo:\s*'([^']*)'/g)].map((m) => m[1]).filter((k) => !titleSet.has(k)))];
  return { titles, params };
}

test('전제: 원본에서 라벨을 실제로 긁어온다 — 0개면 이 검사 전체가 공허하다', () => {
  const { titles, params } = sourceLabels();
  assert.ok(titles.length >= 50, `템플릿 제목 ${titles.length}개 — 파서 확인 필요`);
  assert.ok(params.length >= 200, `파라미터 라벨 ${params.length}개 — 파서 확인 필요`);
});

test('★템플릿 제목이 6개국어를 모두 갖는다', () => {
  const { titles } = sourceLabels();
  const missing = [];
  for (const t of titles) {
    const row = TEMPLATE_LABELS[t.ko];
    if (!row) { missing.push(`${t.ko} (항목 자체 없음)`); continue; }
    const gaps = NON_KO.filter((l) => !row[l]);
    if (gaps.length) missing.push(`${t.ko} → ${gaps.join(',')}`);
  }
  assert.deepEqual(missing, [], `번역 누락 ${missing.length}건:\n  ${missing.slice(0, 20).join('\n  ')}`);
});

test('★제목의 en 이 원본 labelEn 과 어긋나지 않는다 — 두 곳에 다른 영어가 있으면 화면이 갈린다', () => {
  const { titles } = sourceLabels();
  const conflicts = titles
    .filter((t) => TEMPLATE_LABELS[t.ko] && TEMPLATE_LABELS[t.ko].en !== t.en)
    .map((t) => `${t.ko}: 표="${TEMPLATE_LABELS[t.ko].en}" vs 원본="${t.en}"`);
  assert.deepEqual(conflicts, [], `영어 표기 불일치 ${conflicts.length}건:\n  ${conflicts.join('\n  ')}`);
});

test('★파라미터 라벨이 6개국어를 모두 갖는다', () => {
  const { params } = sourceLabels();
  const missing = [];
  for (const ko of params) {
    const row = PARAM_LABELS[ko];
    if (!row) { missing.push(`${ko} (항목 없음)`); continue; }
    const gaps = NON_KO.filter((l) => !row[l]);
    if (gaps.length) missing.push(`${ko} → ${gaps.join(',')}`);
  }
  assert.deepEqual(missing, [], `번역 누락 ${missing.length}/${params.length}건 (앞 20):\n  ${missing.slice(0, 20).join('\n  ')}`);
});

test('★표에만 있고 원본에 없는 항목이 없다 — 죽은 번역은 오래되면 틀린 번역이 된다', () => {
  const { titles, params } = sourceLabels();
  const koTitles = new Set(titles.map((t) => t.ko));
  const koParams = new Set(params);
  const deadT = Object.keys(TEMPLATE_LABELS).filter((k) => !koTitles.has(k));
  const deadP = Object.keys(PARAM_LABELS).filter((k) => !koParams.has(k));
  assert.deepEqual([...deadT, ...deadP], [], `원본에 없는 표 항목: ${[...deadT, ...deadP].join(', ')}`);
});

test('★번역이 없을 때 영어로 조용히 때우지 않는다 — 무슨 언어로 나갔는지 함께 돌려준다', () => {
  const table = { 아무거나: { en: 'Whatever' } };
  const r = localizeLabel('아무거나', 'ja', table);
  assert.equal(r.text, 'Whatever');
  assert.equal(r.via, 'en', 'ja 를 요청했는데 en 이 나갔다는 사실이 남아야 한다');
  const r2 = localizeLabel('표에없음', 'ja', table);
  assert.equal(r2.via, 'ko');
});

test('ko 를 요청하면 원문 그대로 — 왕복 번역하지 않는다', () => {
  const r = localizeLabel('타워 크레인 (마스트 격자+지브)', 'ko', TEMPLATE_LABELS);
  assert.equal(r.text, '타워 크레인 (마스트 격자+지브)');
  assert.equal(r.via, 'ko');
});

test('★실측: 실제 템플릿 목록을 ja 로 지역화하면 제목에 한글이 남지 않는다', () => {
  const list = listAssemblyTemplates();
  const out = localizeTemplates(list, 'ja');
  assert.ok(out.length >= 50, `전제: 템플릿 ${out.length}개`);
  const stillKo = out.filter((t) => /[가-힣]/.test(t.label)).map((t) => t.label);
  assert.deepEqual(stillKo, [], `ja 인데 한글로 남은 제목 ${stillKo.length}개: ${stillKo.slice(0, 10).join(', ')}`);
});

test('★실측: ja 로 지역화하면 파라미터 라벨에도 한글이 남지 않는다', () => {
  const out = localizeTemplates(listAssemblyTemplates(), 'ja');
  const stillKo = [];
  for (const t of out) for (const p of t.params ?? []) if (/[가-힣]/.test(p.label)) stillKo.push(p.label);
  const uniq = [...new Set(stillKo)];
  assert.deepEqual(uniq, [], `ja 인데 한글로 남은 파라미터 ${uniq.length}개 (앞 15): ${uniq.slice(0, 15).join(', ')}`);
});

test('★모든 지원 언어에서 한글이 남지 않는다 — ja 만 고치고 끝내지 않는다', () => {
  const list = listAssemblyTemplates();
  const bad = [];
  for (const lang of NON_KO) {
    const out = localizeTemplates(list, lang);
    for (const t of out) {
      if (/[가-힣]/.test(t.label)) bad.push(`${lang}:제목:${t.labelKo}`);
      for (const p of t.params ?? []) if (/[가-힣]/.test(p.label)) bad.push(`${lang}:파라미터:${p.labelKo}`);
    }
  }
  assert.deepEqual([...new Set(bad)], [], `한글 잔존 ${new Set(bad).size}건`);
});
