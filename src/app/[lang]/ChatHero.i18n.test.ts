/**
 * ChatHero 계산 카드 지역화 — **en 사용자에게도 한국어가 나가던 결함** (260801).
 *
 * ChatHero 자체는 DICT(6개 site 언어: kr/en/ja/cn/es/ar)로 이미 완결된 다국어 페이지였는데,
 * 두 개의 모듈 레벨 상수만 예외였다 — 언어 분기가 **아예 없어서** en 사용자조차 한국어를
 * 그대로 봤다(simulator RISK_SCENARIOS, 7fa0516e 와 동일 유형):
 *  - CHECK_LABELS: 계산 결과 카드의 검토항목 이름(휨·전단·처짐…)
 *  - (구)summarizeFeatures 내 하드코딩: 3D 사양 카드의 feature 이름(박스·구멍·실린더…)
 *    → FEATURE_KIND_I18N 신설로 대체
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECK_LABELS_I18N,
  CAD_RESULT_I18N,
  CHAT_UI_I18N,
  DRAWING_TYPE_I18N,
  DESIGN_PATH_I18N,
  FEATURE_KIND_I18N,
  formatChatActionError,
  generationGateStatusOf,
  hasGeneratedGeometryEvidence,
  inferChatDomain,
  isAssemblyClashRepairRequest,
  shouldUseCadSplitView,
  protectedPrecisionCadEditResult,
} from './ChatHero';
import { buildMechanicalDesignGraph } from '@/lib/ai/mechanicalDesignGraph';

const SITE_LANGS = ['kr', 'en', 'ja', 'cn', 'es', 'ar'] as const;
const CHECK_KEYS = [
  'flexure', 'shear', 'deflection', 'axial', 'buckling',
  'overturning', 'sliding', 'bearing', 'eccentricity',
  'moment', 'combined', 'drift', 'bolt_shear', 'bolt_bearing',
];
const FEATURE_KEYS = ['box', 'prism', 'hole', 'cylinder', 'sphere', 'cone', 'revolve'];
const HANGUL = /[가-힣]/;
const CHAT_HERO_SOURCE = readFileSync(join(process.cwd(), 'src', 'app', '[lang]', 'ChatHero.tsx'), 'utf8');

describe('unified chat-first design entry', () => {
  it('fills starter and follow-up prompts without executing them', () => {
    expect(CHAT_HERO_SOURCE).toContain('data-testid="starter-prompt" onClick={() => fillPrompt(s)}');
    expect(CHAT_HERO_SOURCE).toContain('onClick={() => fillPrompt(c)}');
    expect(CHAT_HERO_SOURCE).not.toContain('onClick={() => send(s)}');
    expect(CHAT_HERO_SOURCE).not.toContain('onClick={() => send(c)}');
  });

  it('uses one attachment control and exposes a reviewable execution lane', () => {
    expect(CHAT_HERO_SOURCE).toContain('data-testid="design-execution-lane-card"');
    expect(CHAT_HERO_SOURCE).toContain('classifyRasterDataUrl(dataUrl)');
    expect(CHAT_HERO_SOURCE).not.toContain('attachModeRef');
    expect(CHAT_HERO_SOURCE).toContain('if (pendingAttachment && !attached)');
    expect(CHAT_HERO_SOURCE.match(/fileRef\.current\?\.click\(\)/g)).toHaveLength(2);
  });
});

describe('채팅 API 오류 안내', () => {
  it('게스트 일일 한도를 한국어 행동 안내와 로그인 링크로 바꾼다', () => {
    const message = formatChatActionError('kr', 'kr', {
      code: 'GUEST_CHAT_QUOTA', limit: 3, resetAtMs: Date.UTC(2026, 7, 19),
    }, 'fallback');
    expect(message).toContain('게스트 AI 설계 3회');
    expect(message).toContain('[로그인](/login?lang=kr)');
    expect(message).not.toContain('Guest daily AI design limit');
  });

  it('모든 지원 언어에 게스트 제한 안내와 해당 언어 로그인 경로가 있다', () => {
    for (const lang of SITE_LANGS) {
      const message = formatChatActionError(lang, lang, { code: 'GUEST_CHAT_QUOTA', limit: 3 }, 'fallback');
      expect(message).toContain(`/login?lang=${lang}`);
      expect(message).not.toBe('fallback');
    }
  });
});

describe('상용 제품 경로와 첫 요청 자동 라우팅', () => {
  it('모든 언어에 제품·기계와 공간·인프라 경로 문구가 있다', () => {
    for (const lang of SITE_LANGS) {
      expect(DESIGN_PATH_I18N[lang].mechanical).toBeTruthy();
      expect(DESIGN_PATH_I18N[lang].spatial).toBeTruthy();
      expect(DESIGN_PATH_I18N[lang].beta).toBeTruthy();
      expect(DESIGN_PATH_I18N[lang].auto).toBeTruthy();
    }
  });

  it('명확한 요청만 분야로 자동 라우팅하고 애매한 요청은 기본 경로에 남긴다', () => {
    expect(inferChatDomain('기어와 베어링이 들어간 로봇 조립 제품')).toBe('mechanical');
    expect(inferChatDomain('건축 건물의 벽과 지붕을 설계해줘')).toBe('architecture');
    expect(inferChatDomain('건축')).toBe('architecture');
    expect(inferChatDomain('apartment building')).toBe('architecture');
    expect(inferChatDomain('토목 도로 선형과 측량 종단을 검토해줘')).toBe('civil');
    expect(inferChatDomain('조경 정원의 식재와 관수 계획')).toBe('landscape');
    expect(inferChatDomain('인테리어 가구와 조명 배치')).toBe('interior');
    expect(inferChatDomain('무언가 멋진 것을 만들어줘')).toBeNull();
    expect(inferChatDomain('건물 주변 도로와 조경을 함께 설계해줘')).toBeNull();
  });
});

describe('existing assembly follow-up routing', () => {
  it('routes clash repair wording to stateful assembly editing', () => {
    expect(isAssemblyClashRepairRequest('간섭(부품 겹침)을 해결하도록 배치를 수정해줘')).toBe(true);
    expect(isAssemblyClashRepairRequest('Fix the interferences by adjusting placement')).toBe(true);
    expect(isAssemblyClashRepairRequest('이 설계의 제조 리스크는?')).toBe(false);
  });
});

describe('저장 결과의 생성 증거는 누락 시 fail-closed', () => {
  it('gateErrors 누락을 통과가 아닌 not_run으로 분류한다', () => {
    expect(generationGateStatusOf(undefined)).toBe('not_run');
    expect(generationGateStatusOf([])).toBe('passed');
    expect(generationGateStatusOf(['invalid feature'])).toBe('failed');
  });

  it('intent/assembly 객체 없이 실제 STEP 또는 SCAD 문자열만 형상 증거로 인정한다', () => {
    expect(hasGeneratedGeometryEvidence(null, undefined)).toBe(false);
    expect(hasGeneratedGeometryEvidence('', '   ')).toBe(false);
    expect(hasGeneratedGeometryEvidence('ISO-10303-21;', undefined)).toBe(true);
    expect(hasGeneratedGeometryEvidence(null, 'cube([1,1,1]);')).toBe(true);
  });
});

describe('정밀 CAD 원본 보호', () => {
  it('기존 NFAB 컨텍스트를 신규 형상으로 전체 재생성하지 않도록 차단한다', async () => {
    const designGraph = await buildMechanicalDesignGraph({
      magic: 'nfab', version: 3,
      tree: {
        rootId: 'root', activeNodeId: 'root',
        nodes: [{ id: 'root', type: 'baseShape', params: {}, enabled: true, parentId: null }],
      },
      scene: { selectedId: 'box', params: { width: 10, depth: 10, height: 10 }, paramExpressions: {} },
    });
    const result = protectedPrecisionCadEditResult('kr', {
      program: { part: 'existing', features: [] },
      unmapped: [],
      designGraph,
      editPolicy: {
        mode: 'revision_bound_patch_only',
        wholeModelRegenerationAllowed: false,
        protectedNodeIds: [],
      },
    });
    expect(result.error).toContain('전체 모델 재생성을 차단');
    expect(result.error).toContain(designGraph.revisionSha256.slice(0, 12));
  });
});

describe('★CHECK_LABELS_I18N(계산 검토항목명)이 6개 site 언어를 모두 갖는다', () => {
  it('★모든 항목이 6개 언어 전부에 값을 갖는다', () => {
    const missing: string[] = [];
    for (const key of CHECK_KEYS) {
      const row = CHECK_LABELS_I18N[key];
      if (!row) { missing.push(`${key} (항목 없음)`); continue; }
      for (const lang of SITE_LANGS) {
        if (!row[lang]) missing.push(`${key}.${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★en 을 포함해 kr 이 아닌 모든 언어에서 한글이 남지 않는다 — 이게 실제 결함이었다', () => {
    const leaked: string[] = [];
    for (const key of CHECK_KEYS) {
      for (const lang of SITE_LANGS) {
        if (lang === 'kr') continue;
        const v = CHECK_LABELS_I18N[key]?.[lang];
        if (v && HANGUL.test(v)) leaked.push(`${key}.${lang}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('kr 값은 원본과 같다 — 번역 과정에서 원문이 바뀌지 않았는지', () => {
    expect(CHECK_LABELS_I18N.flexure.kr).toBe('휨');
    expect(CHECK_LABELS_I18N.bolt_bearing.kr).toBe('지압');
  });
});

describe('★FEATURE_KIND_I18N(3D 사양 카드 feature명)이 6개 site 언어를 모두 갖는다', () => {
  it('★모든 항목이 6개 언어 전부에 값을 갖는다', () => {
    const missing: string[] = [];
    for (const key of FEATURE_KEYS) {
      const row = FEATURE_KIND_I18N[key];
      if (!row) { missing.push(`${key} (항목 없음)`); continue; }
      for (const lang of SITE_LANGS) {
        if (!row[lang]) missing.push(`${key}.${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★en 을 포함해 kr 이 아닌 모든 언어에서 한글이 남지 않는다', () => {
    const leaked: string[] = [];
    for (const key of FEATURE_KEYS) {
      for (const lang of SITE_LANGS) {
        if (lang === 'kr') continue;
        const v = FEATURE_KIND_I18N[key]?.[lang];
        if (v && HANGUL.test(v)) leaked.push(`${key}.${lang}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('kr 값은 원본과 같다', () => {
    expect(FEATURE_KIND_I18N.box.kr).toBe('박스');
    expect(FEATURE_KIND_I18N.revolve.kr).toBe('회전체(단면 프로파일)');
  });
});

describe('CAD 결과 작업공간 회귀 방지', () => {
  it('랜딩 경로에서 시작한 대화도 넓은 화면과 CAD 결과가 있으면 분할 3D를 표시한다', () => {
    expect(shouldUseCadSplitView(true, true, true)).toBe(true);
    expect(shouldUseCadSplitView(false, true, true)).toBe(false);
    expect(shouldUseCadSplitView(true, false, true)).toBe(false);
    expect(shouldUseCadSplitView(true, true, false)).toBe(false);
  });

  it('CAD 상세 문구는 모든 언어에 있고 비한국어 번역에 한글이 새지 않는다', () => {
    const missing: string[] = [];
    const leaked: string[] = [];
    for (const lang of SITE_LANGS) {
      const copy = CAD_RESULT_I18N[lang];
      for (const [key, value] of Object.entries(copy)) {
        const strings = Array.isArray(value) ? value : [value];
        for (const text of strings) {
          if (!text) missing.push(`${lang}.${key}`);
          if (lang !== 'kr' && HANGUL.test(text)) leaked.push(`${lang}.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(leaked).toEqual([]);
    expect(CAD_RESULT_I18N.ar.jetTitle).toContain('التدفق المحوري');
  });
});

describe('ChatHero 사용자 노출 문구 전수 지역화', () => {
  it('잔여 UI 사전과 도면 유형 사전이 6개 언어를 모두 제공한다', () => {
    const missing: string[] = [];
    for (const lang of SITE_LANGS) {
      for (const [key, value] of Object.entries(CHAT_UI_I18N[lang])) {
        if (!String(value).trim()) missing.push(`ui.${lang}.${key}`);
      }
    }
    for (const [type, labels] of Object.entries(DRAWING_TYPE_I18N)) {
      for (const lang of SITE_LANGS) if (!labels[lang]) missing.push(`drawing.${type}.${lang}`);
    }
    expect(missing).toEqual([]);
  });

  it('비한국어 UI 사전에는 한글이 남지 않는다', () => {
    const leaked: string[] = [];
    for (const lang of SITE_LANGS) {
      if (lang === 'kr') continue;
      for (const [key, value] of Object.entries(CHAT_UI_I18N[lang])) {
        if (HANGUL.test(String(value))) leaked.push(`ui.${lang}.${key}`);
      }
      for (const [type, labels] of Object.entries(DRAWING_TYPE_I18N)) {
        if (HANGUL.test(labels[lang])) leaked.push(`drawing.${type}.${lang}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('클라이언트가 실행형·대화형·제목 요청 모두에 현재 언어를 전달한다', () => {
    expect(CHAT_HERO_SOURCE).toMatch(/message: text, domain: requestDomain, history, lang/);
    expect(CHAT_HERO_SOURCE).toMatch(/stream: true, lang/);
    expect(CHAT_HERO_SOURCE).toMatch(/mode: 'title', domain, lang/);
  });

  it('production chat form controls retain stable autofill and accessibility identities', () => {
    expect(CHAT_HERO_SOURCE).toContain('id="nf-chat-reference-file" name="design-reference"');
    expect(CHAT_HERO_SOURCE).toContain('id="nf-chat-design-prompt"');
    expect(CHAT_HERO_SOURCE).toContain('name="design-prompt"');
    expect(CHAT_HERO_SOURCE).toContain('aria-label={t.placeholder}');
  });

  it('과거 사용자 노출 하드코딩이 렌더 경로에 남지 않는다', () => {
    const forbidden = [
      'placeholder="기준 최장변', 'aria-label="pin"', 'aria-label="delete"',
      '>↻ Re-run</button>', 'title="접촉/체결 후보',
      "lang === 'kr' ? '현재 조립체", "isRtl ? 'الجزء المحدد' : '선택 부품'",
    ];
    for (const text of forbidden) expect(CHAT_HERO_SOURCE).not.toContain(text);
  });
});
