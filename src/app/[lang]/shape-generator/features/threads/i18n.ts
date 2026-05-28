/**
 * threads/i18n.ts — 6-language string table for the threads UI (W6).
 *
 * Wave 2 Phase 2 Track D Week 6. Spec §10.5 (Korean canonical terminology).
 *
 * Mirrors the `referenceGeometry/i18n.ts` pattern (D4) — a self-contained
 * dict per language so the W6 PR is additive and avoids cross-cutting i18n
 * plumbing. The Wave 3 i18n pass will collect these into the shared CSV.
 *
 * Six langs per project standard: ko / en / ja / zh / es / ar. KO + EN are
 * fully populated; JA / ZH partially native, ES / AR English-fallback for
 * any string the Wave 3 pass hasn't filled. Consumers call
 * `pickThreadsDict(lang)` and never need a fallback guard.
 *
 * Korean canon (spec §10.5):
 *   thread = 나사산, external = 수나사, internal = 암나사,
 *   metric M = M나사, tap drill = 탭 드릴, RH = 오른나사, LH = 왼나사.
 */

export type ThreadsLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface ThreadsDict {
  // ─── Section titles & buttons ──────────────────────────────────
  readonly sectionTitle: string;             // "나사산 / Threads"
  readonly addThreadButton: string;          // toolbar / ribbon
  readonly editThreadTitle: string;          // edit-modal title
  readonly newThreadTitle: string;           // new-modal title
  readonly deleteThread: string;
  readonly save: string;
  readonly cancel: string;

  // ─── Picker labels ─────────────────────────────────────────────
  readonly labelSeries: string;
  readonly labelDesignation: string;
  readonly labelClass: string;
  readonly labelDirection: string;
  readonly labelLength: string;
  readonly labelStartOffset: string;
  readonly labelMode: string;
  readonly labelKind: string;
  readonly labelFace: string;

  // ─── Series labels (4 main + 3 variants) ──────────────────────
  readonly seriesIsoMCoarse: string;         // ISO M (coarse)
  readonly seriesIsoMFine: string;
  readonly seriesUnc: string;
  readonly seriesUnf: string;
  readonly seriesNpt: string;
  readonly seriesBspParallel: string;
  readonly seriesBspTapered: string;

  // ─── Series sub-tab groups (4 main as per spec §10.1) ─────────
  readonly seriesGroupIsoM: string;          // "ISO M"
  readonly seriesGroupUts: string;           // "UTS"
  readonly seriesGroupNpt: string;           // "NPT"
  readonly seriesGroupBsp: string;           // "BSP"

  // ─── Direction labels ─────────────────────────────────────────
  readonly directionRight: string;           // 오른나사 (RH)
  readonly directionLeft: string;            // 왼나사 (LH)

  // ─── Thread-kind labels ───────────────────────────────────────
  readonly kindInternal: string;             // 암나사
  readonly kindExternal: string;             // 수나사

  // ─── Mode labels (cosmetic / geometric) ───────────────────────
  readonly modeCosmetic: string;             // 표시용 (cosmetic)
  readonly modeGeometric: string;            // 실제 형상 (geometric)
  readonly badgeCosmetic: string;            // green badge text
  readonly badgeGeometric: string;           // grayed-out badge text
  readonly hintGeometricW7: string;          // grayed-out hint ("Phase 2 W7")

  // ─── Hint / helper text ────────────────────────────────────────
  readonly hintPitch: string;
  readonly hintTapDrill: string;             // 탭 드릴
  readonly hintMajorDia: string;
  readonly hintMinorDia: string;
  readonly hintViewportMagenta: string;      // viewport magenta-dashed-circle hint
  readonly hintFacePlaceholder: string;      // "Face id (placeholder until face-picking)"

  // ─── Validation errors ────────────────────────────────────────
  readonly errorLengthRange: string;
  readonly errorUnknownDesignation: string;
  readonly errorInvalidClass: string;
  readonly errorStartOffsetNegative: string;
  readonly errorMissingFace: string;

  // ─── W8 — callout-standard names (drawing standards) ───────────
  readonly calloutStandardIso: string;       // ISO 6410-1
  readonly calloutStandardAsme: string;      // ASME Y14.6
  readonly calloutStandardJis: string;       // JIS B 0205
  readonly calloutStandardDin: string;       // DIN 13
  readonly calloutStandardGb: string;        // GB 196

  // ─── W8 — BOM column headers (THREAD OPERATIONS block) ────────
  readonly bomColumnDesignation: string;     // 호칭
  readonly bomColumnCount: string;           // 수량
  readonly bomColumnTotalLength: string;     // 총 길이
  readonly bomColumnTapDrill: string;        // 탭 드릴 Ø
  readonly bomColumnClass: string;           // 등급
  readonly bomColumnSeries: string;          // 계열
  readonly bomBlockTitle: string;            // "THREAD OPERATIONS" header

  // ─── W8 — drawing-rep flag toggle ─────────────────────────────
  readonly drawingRepFlagLabel: string;      // "ISO 6410-1 simplified drawing rep"
  readonly drawingRepFlagOn: string;
  readonly drawingRepFlagOff: string;
  readonly drawingRepPhase3Hint: string;     // grayed-out hint
}

// ─── Korean (canonical for the Korean market) ─────────────────────

const KO: ThreadsDict = {
  sectionTitle: '나사산',
  addThreadButton: '나사 추가',
  editThreadTitle: '나사산 편집',
  newThreadTitle: '새 나사산',
  deleteThread: '삭제',
  save: '저장',
  cancel: '취소',

  labelSeries: '계열',
  labelDesignation: '호칭',
  labelClass: '등급',
  labelDirection: '방향',
  labelLength: '길이 (mm)',
  labelStartOffset: '시작 오프셋 (mm)',
  labelMode: '모드',
  labelKind: '종류',
  labelFace: '대상 면',

  seriesIsoMCoarse: 'ISO M 보통나사',
  seriesIsoMFine: 'ISO M 가는나사',
  seriesUnc: 'UTS UNC',
  seriesUnf: 'UTS UNF',
  seriesNpt: 'NPT 관용 테이퍼',
  seriesBspParallel: 'BSP 평행 (G)',
  seriesBspTapered: 'BSP 테이퍼 (Rc)',

  seriesGroupIsoM: 'ISO M',
  seriesGroupUts: 'UTS',
  seriesGroupNpt: 'NPT',
  seriesGroupBsp: 'BSP',

  directionRight: '오른나사 (RH)',
  directionLeft: '왼나사 (LH)',

  kindInternal: '암나사',
  kindExternal: '수나사',

  modeCosmetic: '표시용',
  modeGeometric: '실제 형상',
  badgeCosmetic: 'cosmetic',
  badgeGeometric: 'geometric',
  hintGeometricW7: 'W7에서 활성화 예정',

  hintPitch: '피치',
  hintTapDrill: '탭 드릴',
  hintMajorDia: '외경 D',
  hintMinorDia: '안지름 D1',
  hintViewportMagenta: '뷰포트에 자홍색 점선 원으로 표시됩니다.',
  hintFacePlaceholder: '면 ID (면 선택 도구 도입 전 임시)',

  errorLengthRange: '길이는 0 이상이어야 합니다.',
  errorUnknownDesignation: '카탈로그에 없는 호칭입니다.',
  errorInvalidClass: '선택한 계열에서 사용할 수 없는 등급입니다.',
  errorStartOffsetNegative: '시작 오프셋은 0 이상이어야 합니다.',
  errorMissingFace: '대상 면이 지정되지 않았습니다.',

  calloutStandardIso: 'ISO 6410-1 (기본)',
  calloutStandardAsme: 'ASME Y14.6 (인치)',
  calloutStandardJis: 'JIS B 0205 (일본)',
  calloutStandardDin: 'DIN 13 (독일)',
  calloutStandardGb: 'GB 196 (중국)',

  bomColumnDesignation: '호칭',
  bomColumnCount: '수량',
  bomColumnTotalLength: '총 길이 (mm)',
  bomColumnTapDrill: '탭 드릴 Ø',
  bomColumnClass: '등급',
  bomColumnSeries: '계열',
  bomBlockTitle: '나사 가공',

  drawingRepFlagLabel: 'ISO 6410-1 단면도 표시',
  drawingRepFlagOn: '켜짐',
  drawingRepFlagOff: '꺼짐',
  drawingRepPhase3Hint: 'Phase 3 도면 모듈에서 활성화 예정',
};

// ─── English (canonical for everywhere else) ──────────────────────

const EN: ThreadsDict = {
  sectionTitle: 'Threads',
  addThreadButton: 'Add Thread',
  editThreadTitle: 'Edit Thread',
  newThreadTitle: 'New Thread',
  deleteThread: 'Delete',
  save: 'Save',
  cancel: 'Cancel',

  labelSeries: 'Series',
  labelDesignation: 'Designation',
  labelClass: 'Class',
  labelDirection: 'Direction',
  labelLength: 'Length (mm)',
  labelStartOffset: 'Start offset (mm)',
  labelMode: 'Mode',
  labelKind: 'Kind',
  labelFace: 'Face',

  seriesIsoMCoarse: 'ISO M coarse',
  seriesIsoMFine: 'ISO M fine',
  seriesUnc: 'UTS UNC',
  seriesUnf: 'UTS UNF',
  seriesNpt: 'NPT (pipe taper)',
  seriesBspParallel: 'BSP parallel (G)',
  seriesBspTapered: 'BSP tapered (Rc)',

  seriesGroupIsoM: 'ISO M',
  seriesGroupUts: 'UTS',
  seriesGroupNpt: 'NPT',
  seriesGroupBsp: 'BSP',

  directionRight: 'Right-hand (RH)',
  directionLeft: 'Left-hand (LH)',

  kindInternal: 'Internal',
  kindExternal: 'External',

  modeCosmetic: 'Cosmetic',
  modeGeometric: 'Geometric',
  badgeCosmetic: 'cosmetic',
  badgeGeometric: 'geometric',
  hintGeometricW7: 'Coming in Phase 2 W7',

  hintPitch: 'Pitch',
  hintTapDrill: 'Tap drill',
  hintMajorDia: 'Major Ø D',
  hintMinorDia: 'Minor Ø D1',
  hintViewportMagenta: 'Shown as a magenta dashed circle in the viewport.',
  hintFacePlaceholder: 'Face id (placeholder until face-picking lands)',

  errorLengthRange: 'Length must be ≥ 0.',
  errorUnknownDesignation: 'Designation is not in the catalog.',
  errorInvalidClass: 'Class is not valid for the selected series.',
  errorStartOffsetNegative: 'Start offset must be ≥ 0.',
  errorMissingFace: 'No target face selected.',

  calloutStandardIso: 'ISO 6410-1 (default)',
  calloutStandardAsme: 'ASME Y14.6 (inch)',
  calloutStandardJis: 'JIS B 0205 (Japan)',
  calloutStandardDin: 'DIN 13 (Germany)',
  calloutStandardGb: 'GB 196 (China)',

  bomColumnDesignation: 'Designation',
  bomColumnCount: 'Qty',
  bomColumnTotalLength: 'Total length (mm)',
  bomColumnTapDrill: 'Tap drill Ø',
  bomColumnClass: 'Class',
  bomColumnSeries: 'Series',
  bomBlockTitle: 'THREAD OPERATIONS',

  drawingRepFlagLabel: 'ISO 6410-1 simplified drawing rep',
  drawingRepFlagOn: 'On',
  drawingRepFlagOff: 'Off',
  drawingRepPhase3Hint: 'Enabled when the Phase 3 drawing module ships',
};

// ─── JA / ZH / ES / AR — partial native, English fallback ─────────

const JA: ThreadsDict = {
  ...EN,
  sectionTitle: 'ねじ',
  addThreadButton: 'ねじを追加',
  editThreadTitle: 'ねじを編集',
  newThreadTitle: '新規ねじ',
  deleteThread: '削除',
  save: '保存',
  cancel: 'キャンセル',
  labelSeries: '系列',
  labelDesignation: '呼び',
  labelClass: '等級',
  labelDirection: '方向',
  labelLength: '長さ (mm)',
  labelStartOffset: '開始オフセット (mm)',
  labelMode: 'モード',
  labelKind: '種類',
  labelFace: '対象面',
  seriesIsoMCoarse: 'ISO M 並目',
  seriesIsoMFine: 'ISO M 細目',
  seriesNpt: 'NPT 管用テーパねじ',
  seriesBspParallel: 'BSP 平行 (G)',
  seriesBspTapered: 'BSP テーパ (Rc)',
  directionRight: '右ねじ (RH)',
  directionLeft: '左ねじ (LH)',
  kindInternal: '雌ねじ',
  kindExternal: '雄ねじ',
  modeCosmetic: '表示のみ',
  modeGeometric: '実形状',
  hintGeometricW7: 'W7 で提供予定',
  hintPitch: 'ピッチ',
  hintTapDrill: 'タップ下穴',
  hintViewportMagenta: 'ビューポートにマゼンタの破線円で表示します。',

  calloutStandardIso: 'ISO 6410-1 (既定)',
  calloutStandardAsme: 'ASME Y14.6 (インチ)',
  calloutStandardJis: 'JIS B 0205 (日本)',
  calloutStandardDin: 'DIN 13 (ドイツ)',
  calloutStandardGb: 'GB 196 (中国)',

  bomColumnDesignation: '呼び',
  bomColumnCount: '数量',
  bomColumnTotalLength: '合計長さ (mm)',
  bomColumnTapDrill: 'タップ下穴 Ø',
  bomColumnClass: '等級',
  bomColumnSeries: '系列',
  bomBlockTitle: 'ねじ加工',

  drawingRepFlagLabel: 'ISO 6410-1 簡略表記',
  drawingRepFlagOn: 'オン',
  drawingRepFlagOff: 'オフ',
  drawingRepPhase3Hint: 'Phase 3 図面モジュールで有効化予定',
};

const ZH: ThreadsDict = {
  ...EN,
  sectionTitle: '螺纹',
  addThreadButton: '添加螺纹',
  editThreadTitle: '编辑螺纹',
  newThreadTitle: '新建螺纹',
  deleteThread: '删除',
  save: '保存',
  cancel: '取消',
  labelSeries: '系列',
  labelDesignation: '规格',
  labelClass: '等级',
  labelDirection: '方向',
  labelLength: '长度 (mm)',
  labelStartOffset: '起始偏移 (mm)',
  labelMode: '模式',
  labelKind: '类型',
  labelFace: '目标面',
  seriesIsoMCoarse: 'ISO M 粗牙',
  seriesIsoMFine: 'ISO M 细牙',
  seriesNpt: 'NPT 圆锥管螺纹',
  seriesBspParallel: 'BSP 平行 (G)',
  seriesBspTapered: 'BSP 锥形 (Rc)',
  directionRight: '右旋 (RH)',
  directionLeft: '左旋 (LH)',
  kindInternal: '内螺纹',
  kindExternal: '外螺纹',
  modeCosmetic: '示意',
  modeGeometric: '实体',
  hintGeometricW7: '将于 W7 启用',
  hintPitch: '螺距',
  hintTapDrill: '攻丝底孔',
  hintViewportMagenta: '将在视口中以洋红色虚线圆显示。',

  calloutStandardIso: 'ISO 6410-1 (默认)',
  calloutStandardAsme: 'ASME Y14.6 (英制)',
  calloutStandardJis: 'JIS B 0205 (日本)',
  calloutStandardDin: 'DIN 13 (德国)',
  calloutStandardGb: 'GB 196 (中国)',

  bomColumnDesignation: '规格',
  bomColumnCount: '数量',
  bomColumnTotalLength: '总长 (mm)',
  bomColumnTapDrill: '攻丝底孔 Ø',
  bomColumnClass: '等级',
  bomColumnSeries: '系列',
  bomBlockTitle: '螺纹加工',

  drawingRepFlagLabel: 'ISO 6410-1 简化表示',
  drawingRepFlagOn: '开',
  drawingRepFlagOff: '关',
  drawingRepPhase3Hint: '将在 Phase 3 图纸模块中启用',
};

const ES: ThreadsDict = {
  ...EN,
  sectionTitle: 'Roscas',
  addThreadButton: 'Añadir rosca',
  editThreadTitle: 'Editar rosca',
  newThreadTitle: 'Nueva rosca',
  deleteThread: 'Eliminar',
  save: 'Guardar',
  cancel: 'Cancelar',
  labelSeries: 'Serie',
  labelDesignation: 'Designación',
  labelClass: 'Clase',
  labelDirection: 'Sentido',
  labelLength: 'Longitud (mm)',
  labelStartOffset: 'Desplazamiento inicial (mm)',
  labelMode: 'Modo',
  labelKind: 'Tipo',
  labelFace: 'Cara',
  directionRight: 'Derechas (RH)',
  directionLeft: 'Izquierdas (LH)',
  kindInternal: 'Interna',
  kindExternal: 'Externa',
  modeCosmetic: 'Cosmética',
  modeGeometric: 'Geométrica',
  hintViewportMagenta: 'Se muestra como un círculo magenta a trazos en el visor.',

  calloutStandardIso: 'ISO 6410-1 (predet.)',
  calloutStandardAsme: 'ASME Y14.6 (pulgadas)',
  calloutStandardJis: 'JIS B 0205 (Japón)',
  calloutStandardDin: 'DIN 13 (Alemania)',
  calloutStandardGb: 'GB 196 (China)',
  bomColumnDesignation: 'Designación',
  bomColumnCount: 'Cant.',
  bomColumnTotalLength: 'Longitud total (mm)',
  bomColumnTapDrill: 'Broca de tap Ø',
  bomColumnClass: 'Clase',
  bomColumnSeries: 'Serie',
  bomBlockTitle: 'OPERACIONES DE ROSCA',
  drawingRepFlagLabel: 'Representación ISO 6410-1',
  drawingRepFlagOn: 'Sí',
  drawingRepFlagOff: 'No',
  drawingRepPhase3Hint: 'Se activa con el módulo de planos (Phase 3)',
};

const AR: ThreadsDict = {
  ...EN,
  sectionTitle: 'أسنان لولبية',
  addThreadButton: 'إضافة لولب',
  editThreadTitle: 'تحرير اللولب',
  newThreadTitle: 'لولب جديد',
  deleteThread: 'حذف',
  save: 'حفظ',
  cancel: 'إلغاء',
  labelSeries: 'السلسلة',
  labelDesignation: 'الرمز',
  labelClass: 'الفئة',
  labelDirection: 'الاتجاه',
  labelLength: 'الطول (مم)',
  labelStartOffset: 'إزاحة البداية (مم)',
  labelMode: 'الوضع',
  labelKind: 'النوع',
  labelFace: 'الوجه',
  directionRight: 'يمين (RH)',
  directionLeft: 'يسار (LH)',
  kindInternal: 'داخلي',
  kindExternal: 'خارجي',
  modeCosmetic: 'تجميلي',
  modeGeometric: 'هندسي',

  calloutStandardIso: 'ISO 6410-1 (افتراضي)',
  calloutStandardAsme: 'ASME Y14.6 (بوصة)',
  calloutStandardJis: 'JIS B 0205 (اليابان)',
  calloutStandardDin: 'DIN 13 (ألمانيا)',
  calloutStandardGb: 'GB 196 (الصين)',
  bomColumnDesignation: 'الرمز',
  bomColumnCount: 'الكمية',
  bomColumnTotalLength: 'الطول الكلي (مم)',
  bomColumnTapDrill: 'قطر الثقب Ø',
  bomColumnClass: 'الفئة',
  bomColumnSeries: 'السلسلة',
  bomBlockTitle: 'عمليات اللولب',
  drawingRepFlagLabel: 'تمثيل ISO 6410-1',
  drawingRepFlagOn: 'مفعل',
  drawingRepFlagOff: 'معطل',
  drawingRepPhase3Hint: 'يفعل في وحدة الرسومات (المرحلة 3)',
};

const DICTS: Record<ThreadsLang, ThreadsDict> = {
  ko: KO,
  en: EN,
  ja: JA,
  zh: ZH,
  es: ES,
  ar: AR,
};

/** Look up a fully-populated `ThreadsDict` for the given lang. Unknown
 *  codes (or `undefined`) fall back to English so the UI is always
 *  fully labelled. */
export function pickThreadsDict(lang: ThreadsLang | string | undefined): ThreadsDict {
  if (lang === undefined) return EN;
  if (Object.prototype.hasOwnProperty.call(DICTS, lang)) {
    return DICTS[lang as ThreadsLang];
  }
  // Permissive: route segments like 'kr', 'cn' map to ko / zh.
  switch (lang) {
    case 'kr':
      return KO;
    case 'cn':
      return ZH;
    case 'jp':
      return JA;
    default:
      return EN;
  }
}

/** Translate a thread series code to a localised label (full descriptor). */
export function seriesLabel(
  dict: ThreadsDict,
  series:
    | 'ISO_M_COARSE'
    | 'ISO_M_FINE'
    | 'UNC'
    | 'UNF'
    | 'NPT'
    | 'BSP_PARALLEL'
    | 'BSP_TAPERED',
): string {
  switch (series) {
    case 'ISO_M_COARSE': return dict.seriesIsoMCoarse;
    case 'ISO_M_FINE':   return dict.seriesIsoMFine;
    case 'UNC':          return dict.seriesUnc;
    case 'UNF':          return dict.seriesUnf;
    case 'NPT':          return dict.seriesNpt;
    case 'BSP_PARALLEL': return dict.seriesBspParallel;
    case 'BSP_TAPERED':  return dict.seriesBspTapered;
  }
}

/** Public re-exports for tests. */
export const THREADS_DICT_EN = EN;
export const THREADS_DICT_KO = KO;
export const THREADS_DICT_JA = JA;
export const THREADS_DICT_ZH = ZH;
export const THREADS_DICT_ES = ES;
export const THREADS_DICT_AR = AR;
