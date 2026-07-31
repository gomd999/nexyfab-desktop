/**
 * lang-coverage.test.ts — **6언어 규칙을 문서에서 회귀로 옮긴다** (260802).
 *
 * ## 무엇을 막는가
 * `src/lib/i18n/normalize.ts` 에 이미 규칙이 있다 — "여섯 언어를 다 넣거나 PR 을 막아라".
 * 그런데 **지키는 장치가 없어서** 95개 파일이 규칙 밖에 있었고, 그 안에 정책 6페이지가 있었다:
 * `es`·`ar` 이 `langMap` 에서 `'en'` 으로 고정돼 **개인정보·환불·보안 정책이 영어로 나가고 있었다.**
 * 라이브 실측 — es↔en 단어일치 72~80% · ar↔en 83~90% · 아랍 문자 비율 12~20%
 * (같은 사이트의 마케팅 페이지는 es↔en 10~16%).
 *
 * ## 왜 절대값이 아니라 **목록 대비 증가**를 막는가
 * 기존 94건은 대부분 제품 내부 화면이라 한 번에 갚을 대상이 아니다. 지금 필요한 것은
 * **새 파일이 같은 함정에 빠지지 않는 것**이다. 총량 상한만 두면 하나 고치고 하나 어겨도 통과한다.
 * 그래서 **파일 이름**으로 비교한다.
 *
 * ## ⚠ 이 측정은 휴리스틱이다
 * `lang-coverage.mjs` 주석에 적은 대로 과대·과소가 둘 다 가능하다. 그래서 이 테스트는
 * 「미번역 화면 수」를 주장하지 않는다 — **「규칙 밖 파일 목록이 늘지 않았다」**만 주장한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findIncompleteLangFiles } from './lang-coverage.mjs';

const SRC = join(process.cwd(), 'src');
const BASELINE: string[] = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts', 'i18n', 'lang-coverage-baseline.json'), 'utf8'),
);

describe('6언어 커버리지 래칫', () => {
  const rows = (findIncompleteLangFiles as unknown as (r: string) => Array<{ file: string; missing: string[] }>)(SRC);
  const now = new Set(rows.map((r) => r.file));
  const base = new Set(BASELINE);

  it('★새로 규칙을 어긴 파일이 없다 — 6언어를 다 넣거나 기준선을 갱신하라', () => {
    const added = [...now].filter((f) => !base.has(f)).sort();
    expect(
      added,
      `6언어 미완 파일이 새로 생겼다:\n  ${added.join('\n  ')}\n`
      + '→ 해당 파일에 ja·zh·es·ar 을 채우거나, 의도한 예외라면\n'
      + '  scripts/i18n/lang-coverage-baseline.json 에 **이유와 함께** 추가하라.',
    ).toEqual([]);
  });

  it('고친 파일은 기준선에서 빠져야 한다 — 갚은 부채를 남겨 두면 래칫이 헐거워진다', () => {
    const fixed = [...base].filter((f) => !now.has(f)).sort();
    expect(
      fixed,
      `이미 6언어가 된 파일이 기준선에 남아 있다:\n  ${fixed.join('\n  ')}\n`
      + '→ scripts/i18n/lang-coverage-baseline.json 에서 지워라.',
    ).toEqual([]);
  });

  it('★정책·법적 문서는 기준선에 들어올 수 없다 — 영어로 나가면 성격이 다르다', () => {
    /**
     * 260802 에 여섯 페이지를 채웠다. 다시 미완이 되면 여기서 깨진다.
     * 「부채로 등록하고 미루는 것」이 허용되지 않는 부류를 못박아 둔다.
     */
    const LEGAL = /(privacy|refund|customer|security|partner|terms)[-_]?(policy|of-use)|company-introduction/i;
    const offenders = rows.filter((r) => LEGAL.test(r.file)).map((r) => `${r.file} [${r.missing.join(',')}]`);
    expect(offenders, `법적 문서가 6언어 미완이다:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('기준선 파일은 실재하는 경로만 담는다 — 지워진 파일이 남으면 래칫이 무의미해진다', () => {
    // 스캐너가 훑는 전체 목록에 없으면 그 경로는 사라진 것이다.
    const all = new Set(rows.map((r) => r.file));
    const stale = BASELINE.filter((f) => !all.has(f));
    // 위 두 테스트가 이미 잡지만, 실패 메시지를 「사라진 파일」로 따로 준다.
    expect(stale.length, `기준선에만 있는 경로 ${stale.length}건: ${stale.slice(0, 5).join(', ')}`).toBe(0);
  });
});
