/**
 * DesignInner.tsx 채팅 프롬프트 예시 문구 지역화 — **ja/zh/es/ar 사용자에게도 영어가
 * 나가던 결함** (260802, EasyWizard CATEGORIES·simulator RISK_SCENARIOS 와 동일 유형).
 *
 * 예전엔 모듈 레벨 EXAMPLES_KO/EXAMPLES_EN 두 배열을 `ko ? A : B` 로 선택했다 — ko가
 * 아니면 전부 en 배열을 받았으므로 ja/zh/es/ar 는 자기 언어를 전혀 보지 못했다.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './DesignExamplesDict';

const SITE_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;
const HANGUL = /[가-힣]/;

describe('★DesignInner 채팅 예시가 6개 언어를 모두 갖는다', () => {
  it('★모든 예시가 6개 언어 전부에 텍스트를 갖는다', () => {
    const missing: string[] = [];
    EXAMPLES.forEach((ex, i) => {
      for (const lang of SITE_LANGS) {
        if (!ex[lang]) missing.push(`EXAMPLES[${i}].${lang}`);
      }
    });
    expect(missing).toEqual([]);
  });

  it('★ko 가 아닌 모든 언어에서 한글이 남지 않는다 — 이게 실제 결함이었다', () => {
    const leaked: string[] = [];
    EXAMPLES.forEach((ex, i) => {
      for (const lang of SITE_LANGS) {
        if (lang === 'ko') continue;
        if (HANGUL.test(ex[lang])) leaked.push(`EXAMPLES[${i}].${lang}`);
      }
    });
    expect(leaked).toEqual([]);
  });

  it('ko 값은 원본과 같다 — 번역 과정에서 원문이 바뀌지 않았는지', () => {
    expect(EXAMPLES[0].ko).toBe('내경 500mm 원통형 물탱크, 높이 800mm, 벽두께 5mm, 바닥에 원뿔형 배출구(45도), 중앙에 지름 25mm 교반축');
    expect(EXAMPLES[2].ko).toBe('L자 브래킷, 다리 각 80mm, 두께 6, 각 면에 지름 6 홀 2개');
  });
});
