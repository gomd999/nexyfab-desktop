/**
 * locale-hardcode.test.ts — **날짜·숫자도 언어를 따라가야 한다** (260802).
 *
 * ## 사전 래칫이 못 보던 것
 * `lang-coverage` 는 **사전**을 센다. 그런데 실측해 보니
 * `toLocaleDateString('ko-KR')` 하드코딩이 **100파일 181자리**였다 —
 * 사이트가 6언어로 돌아도 **날짜와 숫자는 언제나 한국 형식**으로 나온다.
 *
 * 「번역이 끝났다」고 말하려면 사전만 봐서는 안 된다. 이 세션에서 파트너 포털 17개를
 * 통째로 못 봤던 것과 같은 교훈이다 — **무엇을 안 세고 있는지를 먼저 알아야 한다.**
 *
 * ## ⚠ 전부가 결함은 아니다
 * 서버 로그·파일명·CSV 헤더처럼 사용자 언어와 무관해야 하는 자리도 있다.
 * 그래서 이 목록을 「결함」이라 부르지 않고 **늘지 않게만** 잠근다.
 * 고칠 때는 `@/lib/i18n/format` 의 `formatDate`/`formatNumber`/`formatMoney` 를 쓴다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findHardcodedLocales } from './locale-hardcode.mjs';

const SRC = join(process.cwd(), 'src');
const BASELINE: Array<{ file: string; hits: number }> = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts', 'i18n', 'locale-hardcode-baseline.json'), 'utf8'),
);

const rows = (findHardcodedLocales as unknown as (r: string) => Array<{ file: string; hits: number }>)(SRC);
const now = new Map(rows.map((r) => [r.file, r.hits]));
const base = new Map(BASELINE.map((r) => [r.file, r.hits]));

describe('로케일 하드코딩 래칫', () => {
  it('★새로 로케일을 박아 넣은 파일이 없다 — `@/lib/i18n/format` 을 쓰라', () => {
    const added = [...now.keys()].filter((f) => !base.has(f)).sort();
    expect(
      added,
      `로케일을 하드코딩한 파일이 새로 생겼다:\n  ${added.join('\n  ')}\n`
      + '→ formatDate/formatNumber/formatMoney 를 쓰거나, 사용자 언어와 무관한 자리라면\n'
      + '  scripts/i18n/locale-hardcode-baseline.json 에 이유와 함께 추가하라.',
    ).toEqual([]);
  });

  it('★기존 파일에서 하드코딩이 늘지 않았다', () => {
    const worse = [...now.entries()]
      .filter(([f, n]) => base.has(f) && n > (base.get(f) ?? 0))
      .map(([f, n]) => `${f}: ${base.get(f)} → ${n}`);
    expect(worse, `하드코딩이 늘어난 파일:\n  ${worse.join('\n  ')}`).toEqual([]);
  });

  it('고친 파일은 기준선에서 줄어야 한다 — 갚은 부채를 남기면 래칫이 헐거워진다', () => {
    const stale = [...base.entries()]
      .filter(([f, n]) => (now.get(f) ?? 0) < n)
      .map(([f, n]) => `${f}: ${n} → ${now.get(f) ?? 0}`);
    expect(
      stale,
      `기준선이 실제보다 큰 파일(갱신 필요):\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('포맷 헬퍼', () => {
  it('★언어마다 다른 결과를 낸다 — 같은 값이면 헬퍼가 로케일을 안 쓰는 것이다', async () => {
    const { formatDate, formatNumber } = await import('../../src/lib/i18n/format');
    const ts = Date.UTC(2026, 4, 10);
    const ko = formatDate(ts, 'kr');
    const en = formatDate(ts, 'en');
    const ja = formatDate(ts, 'ja');
    expect(ko).toBeTruthy();
    expect(ko).not.toBe(en);
    expect(ja).not.toBe(en);
    // 스페인어는 소수점·자릿수 구분자가 영어와 반대다.
    expect(formatNumber(1234.5, 'es')).not.toBe(formatNumber(1234.5, 'en'));
  });

  it('★깨진 값은 빈 문자열이 아니라 null — 「날짜 없음」과 「값이 깨졌다」는 다르다', async () => {
    const { formatDate } = await import('../../src/lib/i18n/format');
    expect(formatDate(null, 'ko')).toBeNull();
    expect(formatDate('not-a-date', 'ko')).toBeNull();
    expect(formatDate(NaN, 'ko')).toBeNull();
  });

  it('★통화는 **표시 언어가 아니라 거래 통화**가 정한다', async () => {
    const { formatMoney } = await import('../../src/lib/i18n/format');
    // 한국어 사용자가 USD 주문을 봐도 $ 여야 한다 — 언어로 통화를 바꾸면 금액을 오독한다.
    const usdInKo = formatMoney(1000, 'kr', 'USD');
    expect(usdInKo).toBeTruthy();
    expect(usdInKo).not.toContain('₩');
  });
});
