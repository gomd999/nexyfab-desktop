/**
 * output-lang.mjs — **산출물이 무슨 언어로 나가는지 숨기지 않는다** (260802).
 *
 * ## 실측이 말하는 것
 * 검토 엔진의 언어 필드를 세어 보면 `labelKo 836 · labelEn 86 · messageKo 49` 다 —
 * **영어 커버리지가 약 10%**이고 ja·zh·es·ar 은 **0**이다. 패키지 라우트도
 * `options.lang === 'en'` 하나만 알아듣고, 그마저 **시트명·표두만** 영어이며 본문은 한국어다.
 * 그런데 사이트는 6개 언어로 팔린다.
 *
 * ## 그래서 무엇을 하는가 — 그리고 **무엇을 하지 않는가**
 * 836개 라벨을 지금 번역할 수는 없다. 대신:
 *  1. **여섯 언어를 다 받는다.** 지금은 `es` 로 요청해도 조용히 무시된다 —
 *     「요청이 없었던 것」과 「요청을 못 들어준 것」은 다르다.
 *  2. **본문 언어를 그 사람의 언어로 고지한다.** 스페인어 사용자가 한국어 검토서를 받고
 *     한국어 안내문으로 「한국어입니다」라고 적어 두면 **읽을 수 없는 고지**다.
 *  3. **`<html lang>` 은 바꾸지 않는다.** 본문이 한국어인데 `lang="ar"` 로 적으면
 *     스크린리더가 아랍어로 읽으려 한다 — 표시를 고쳐 내용을 속이는 꼴이다.
 *     `lang` 은 **내용의 언어**지 사용자의 언어가 아니다.
 *
 * ## ⚠ 「번역됨」을 부풀리지 않는다
 * `en` 은 GA 도면의 시트명·표두만 영어다. 그것을 `translated: true` 로 적으면
 * 사용자는 검토서까지 영어일 것으로 읽는다. 그래서 상태를 **셋으로** 나눈다:
 * `none`(전혀) · `partial`(일부만) · `full`(전부). 지금 `full` 인 언어는 `ko` 뿐이다.
 */

/** 라우트 표기(`kr`·`cn`)와 ISO 표기(`ko`·`zh`)를 둘 다 받는다. */
const ALIAS = { kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar' };

/** 산출물이 **실제로** 쓰는 본문 언어. 지금은 하나다 — 늘어나면 여기부터 바뀐다. */
export const CONTENT_LANG = 'ko';

/**
 * 요청 언어를 6언어 중 하나로 정규화한다.
 * @returns `'ko'|'en'|'ja'|'zh'|'es'|'ar'` — 모르는 값이면 `null`(기본값을 지어내지 않는다)
 */
export function normalizeOutputLang(value) {
  if (typeof value !== 'string') return null;
  const k = value.trim().toLowerCase().split(/[-_]/)[0];
  return ALIAS[k] ?? null;
}

/**
 * 그 언어로 번역이 어디까지 돼 있나.
 * @returns `'full' | 'partial' | 'none'`
 */
export function translationCoverage(lang) {
  if (lang === CONTENT_LANG) return 'full';
  // ⚠ `en` 은 **GA 도면 시트명·표두만** 영어다(라우트가 `lang:'en'` 을 그쪽에만 넘긴다).
  //   검토서·물량·안내문 본문은 한국어 그대로다.
  if (lang === 'en') return 'partial';
  return 'none';
}

/** 각 언어로 된 고지 문구. **읽을 수 있는 언어로 적어야 고지다.** */
const NOTICE = {
  ko: {
    full: null,
    partial: null,
    none: null,
  },
  en: {
    heading: 'Document language',
    partial: 'You requested <b>English</b>. Only the GA drawing sheet names and table headers are in English — '
      + 'the review report, quantities, and this guide are <b>in Korean</b>. This is not a translated document.',
    none: 'You requested <b>English</b>, but this package is written <b>in Korean</b>. It has not been translated.',
    dims: 'Numbers, dimensions, and part IDs are language-independent and can be read as-is.',
  },
  ja: {
    heading: '文書の言語',
    none: '<b>日本語</b>で要求されましたが、このパッケージは<b>韓国語</b>で作成されています。翻訳されていません。',
    dims: '数値・寸法・部品IDは言語に依存しないため、そのまま読めます。',
  },
  zh: {
    heading: '文档语言',
    none: '您请求的是<b>中文</b>，但本资料包以<b>韩文</b>撰写，尚未翻译。',
    dims: '数值、尺寸和零件编号与语言无关，可直接阅读。',
  },
  es: {
    heading: 'Idioma del documento',
    none: 'Ha solicitado <b>español</b>, pero este paquete está redactado <b>en coreano</b>. No ha sido traducido.',
    dims: 'Las cifras, las cotas y los identificadores de pieza no dependen del idioma y pueden leerse tal cual.',
  },
  ar: {
    heading: 'لغة المستند',
    none: 'لقد طلبت <b>العربية</b>، غير أنّ هذه الحزمة مكتوبة <b>بالكورية</b> ولم تُترجم.',
    dims: 'الأرقام والأبعاد ومعرّفات القطع لا تعتمد على اللغة ويمكن قراءتها كما هي.',
  },
};

/**
 * 안내문 맨 위에 붙일 고지 HTML.
 *
 * @param lang `normalizeOutputLang` 결과
 * @returns HTML 문자열 — 고지가 필요 없으면(`ko`) `''`
 *
 * ⚠ `dir="rtl"` 은 **이 고지 블록에만** 준다. 문서 본문은 한국어라 LTR 이다 —
 *   전체를 뒤집으면 읽을 수 있게 되는 게 아니라 한국어가 거꾸로 흐른다.
 */
export function outputLangNoticeHtml(lang) {
  if (!lang || lang === CONTENT_LANG) return '';
  const t = NOTICE[lang];
  if (!t) return '';
  const cov = translationCoverage(lang);
  const body = cov === 'partial' ? (t.partial ?? t.none) : t.none;
  if (!body) return '';
  const rtl = lang === 'ar' ? ' dir="rtl"' : '';
  return `<div class="warn"${rtl} lang="${lang}"><b>${t.heading}</b><br>${body}`
    + (t.dims ? `<br>${t.dims}` : '')
    + `</div>`
    // 한국어 병기 — 이 문서를 받는 쪽이 한국인 담당자일 수도 있다.
    + `<div class="warn" lang="ko"><b>문서 언어 고지</b><br>`
    + `요청 언어 <code>${lang}</code> · 본문 언어 <code>${CONTENT_LANG}</code> · 번역 상태 <code>${cov}</code><br>`
    + `<b>번역되지 않았다는 사실을 문서에 남긴다</b> — 없는 것을 없다고 적지 않으면 「해당 없음」으로 읽힌다.</div>`;
}
