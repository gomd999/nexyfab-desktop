/**
 * 생성 파이프라인 **단계 어휘** — 로딩 표시의 단일 소스.
 *
 * ## 왜 어휘를 따로 두나
 * 「생성 중…」만 도는 스피너는 **얼마나 남았는지도, 무엇이 오래 걸리는지도** 못 알려준다.
 * 우리 파이프라인은 AI 호출 1~2회 + 결정론 검증 여러 단계로 20~60초가 걸린다. 그동안
 * 사용자가 보는 것이 회전하는 원 하나면 「멈춘 것」과 「도는 것」을 구별할 수 없다.
 *
 * ⚠ 라벨을 라우트 안에 문자열로 박으면 **화면·i18n·MCP 진행표시가 각자 다른 말**을 하게 된다.
 *   이 세션에서 어휘·프롬프트·enum 이 갈려 다섯 번 틀렸다 — 같은 실수를 표시 계층에서
 *   반복하지 않는다.
 *
 * ⚠ `weight` 는 **실측 기반 상대 소요**다(합계 100). 지어낸 백분율로 진행바를 채우면
 *   「92%에서 30초 멈춤」이 된다. AI 호출이 압도적으로 길다는 사실을 그대로 반영한다.
 */

/**
 * @typedef {{ id:string, weight:number, ko:string, en:string, zh:string, ja:string, es:string, ar:string, detail?:string }} Stage
 *
 * ⚠ **6개국어를 다 채운다.** 사이트가 ko·en·zh·ja·es·ar 이고, 로딩 문구만 영어로 두면
 *   ja 사용자는 「번역했는데 영어인가」와 「아직 번역이 없다」를 구별할 수 없다.
 *   `scripts/i18n/lang-coverage.test.ts` 래칫이 이걸 강제한다 — 실제로 여기서 걸렸다.
 */
export const LANGS = ['ko', 'en', 'zh', 'ja', 'es', 'ar'];

/** 자유형(설명 → 조립) 경로. 실측: AI 왕복이 전체의 절반 가까이를 먹는다. */
export const ASSEMBLE_STAGES = [
  { id: 'catalog', weight: 3, ko: '템플릿 카탈로그 확인', en: 'Checking template catalog', zh: '检查模板目录', ja: 'テンプレート目録を確認', es: 'Revisando el catálogo de plantillas', ar: 'فحص فهرس القوالب',
    detail: '먼저 만들어 둔 55종 중에 맞는 것이 있는지 본다' },
  { id: 'ai', weight: 45, ko: '설계 해석', en: 'Interpreting the design', zh: '解析设计', ja: '設計を解釈中', es: 'Interpretando el diseño', ar: 'تفسير التصميم',
    detail: '설명을 부품·치수·관계로 옮긴다(가장 오래 걸리는 단계)' },
  { id: 'autofix', weight: 4, ko: '어휘 교정', en: 'Correcting vocabulary', zh: '修正构件类型', ja: '部品種別を補正', es: 'Corrigiendo el vocabulario', ar: 'تصحيح المفردات',
    detail: '잘못 고른 부품 종류를 치수 변경 없이 바로잡는다' },
  { id: 'place', weight: 6, ko: '배치 정리', en: 'Resolving placement', zh: '解算布置', ja: '配置を解決', es: 'Resolviendo la colocación', ar: 'حل المواضع',
    detail: '관계 구속을 풀고, 뜬 부품을 얹고, 파고든 것을 떼어낸다' },
  { id: 'build', weight: 12, ko: '형상 생성·검증', en: 'Building and checking', zh: '生成并校验形状', ja: '形状生成と検証', es: 'Construyendo y verificando', ar: 'البناء والتحقق',
    detail: '게이트·간섭·지지·질량·구조를 전부 실측한다' },
  { id: 'intent', weight: 18, ko: '요청과 대조', en: 'Matching against your request', zh: '与需求比对', ja: 'ご要望と照合', es: 'Comparando con su solicitud', ar: 'المطابقة مع طلبك',
    detail: '만든 것이 시킨 것과 같은지 치수 단위로 확인한다' },
  { id: 'repair', weight: 10, ko: '불일치 교정', en: 'Repairing mismatches', zh: '修正不一致', ja: '不一致を修正', es: 'Corrigiendo discrepancias', ar: 'إصلاح الاختلافات',
    detail: '어긋난 곳을 되먹여 다시 만든다(개선될 때만 채택)' },
  { id: 'done', weight: 2, ko: '마무리', en: 'Finalizing', zh: '收尾', ja: '仕上げ', es: 'Finalizando', ar: 'اللمسات الأخيرة' },
];

/** 스트림 프레임 자체의 라벨(시작·완료·실패) — 단계표 밖이지만 같은 6언어 규약을 따른다. */
export const FRAME_LABELS = {
  start: { ko: '시작', en: 'Starting', zh: '开始', ja: '開始', es: 'Iniciando', ar: 'البدء' },
  done: { ko: '완료', en: 'Done', zh: '完成', ja: '完了', es: 'Listo', ar: 'تم' },
  error: { ko: '실패', en: 'Failed', zh: '失败', ja: '失敗', es: 'Falló', ar: 'فشل' },
};

/** 문서·STEP 발행 경로(패키지). 어셈블리가 이미 있는 상태에서 시작한다. */
export const PACKAGE_STAGES = [
  { id: 'build', weight: 10, ko: '형상 확인', en: 'Verifying geometry', zh: '校验形状', ja: '形状を検証', es: 'Verificando la geometría', ar: 'التحقق من الشكل' },
  { id: 'step', weight: 25, ko: 'STEP 조립 트리 생성', en: 'Building STEP assembly tree', zh: '生成 STEP 装配树', ja: 'STEP 組立ツリー生成', es: 'Creando el árbol de ensamblaje STEP', ar: 'إنشاء شجرة تجميع STEP',
    detail: '부품·계통 계층과 반복 부품 인스턴스를 만든다' },
  { id: 'drawing', weight: 30, ko: '도면 투영', en: 'Projecting drawings', zh: '投影图纸', ja: '図面を投影', es: 'Proyectando los planos', ar: 'إسقاط الرسومات' },
  { id: 'checks', weight: 25, ko: '분야 검토', en: 'Domain checks', zh: '专业校核', ja: '分野検討', es: 'Comprobaciones por disciplina', ar: 'فحوصات التخصص',
    detail: '구조·피난·배관 등 해당 분야 판정' },
  { id: 'pack', weight: 10, ko: '도서 묶음', en: 'Packaging', zh: '文件打包', ja: '図書一式にまとめる', es: 'Empaquetando', ar: 'التجميع' },
];

/**
 * 단계 목록 → 누적 진행률 표. `pct(id)` 는 **그 단계를 시작할 때**의 값이다.
 * ⚠ 끝날 때 값을 쓰면 마지막 단계에서 100%가 되어 버려, 실제로 끝나기 전에 다 된 것처럼 보인다.
 */
export function progressTable(stages) {
  const total = stages.reduce((a, s) => a + s.weight, 0) || 1;
  let acc = 0;
  const at = new Map();
  for (const s of stages) { at.set(s.id, Math.round((acc / total) * 100)); acc += s.weight; }
  return {
    pct: (id) => at.get(id) ?? 0,
    /** 진행 이벤트 한 건 — 화면·로그·MCP 가 같은 모양을 쓴다. */
    event: (id, extra = {}) => {
      const s = stages.find((x) => x.id === id);
      if (!s) throw new Error(`알 수 없는 단계 '${id}' — pipeline-stages.mjs 에 없다`);
      const labels = Object.fromEntries(LANGS.map((L) => [L, s[L]]));
      return { stage: s.id, pct: at.get(s.id), ...labels, ...(s.detail ? { detail: s.detail } : {}), ...extra };
    },
    /** 프레임 라벨(시작·완료·실패) — 라우트가 문자열을 직접 들지 않게 여기서 준다. */
    frame: (kind, extra = {}) => {
      const l = FRAME_LABELS[kind];
      if (!l) throw new Error(`알 수 없는 프레임 '${kind}'`);
      return { stage: kind, pct: kind === 'start' ? 0 : 100, ...l, ...extra };
    },
    ids: stages.map((s) => s.id),
  };
}
