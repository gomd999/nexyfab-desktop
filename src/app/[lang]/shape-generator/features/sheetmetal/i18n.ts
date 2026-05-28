/**
 * sheetmetal/i18n.ts — 6-language string table for the Sheet Metal UI (B5).
 *
 * Wave 2 Phase 2 Track B Week 5. Spec §6.3 (Korean canonical right pane),
 * §6.6 (KR-first labels), §10 (auto-drawing pipeline labels).
 *
 * Mirrors the `threads/i18n.ts` pattern (D6) — a self-contained dict per
 * language so the B5 PR is additive and avoids cross-cutting plumbing.
 *
 * Korean canon (spec §6.6):
 *   bend line = 절곡선, flat pattern = 전개도, K-factor = K-팩터,
 *   bend allowance = 절곡 허용량, outline = 외곽선,
 *   auto-drawing = 자동 도면 (자동 도면 생성 button), springback = 스프링백.
 *
 * NOTE: the 5-mode shell-level i18n (판금 mode label etc.) lives in the
 * shapeDict/ModelRibbon and is not duplicated here.
 */

export type SheetMetalLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface SheetMetalDict {
  // ─── Right pane sections ───────────────────────────────────────
  readonly rightPaneTitle: string;            // "판금 속성" / "Sheet metal properties"
  readonly sectionMaterial: string;           // "재료"
  readonly sectionThickness: string;          // "두께"
  readonly sectionKFactorTable: string;       // "K-팩터 표"
  readonly sectionBendPreview: string;        // "절곡 허용량 미리보기"
  readonly sectionFlatBlank: string;          // "전개 블랭크"

  // ─── Material labels (matches sheetMetalTables.ts ids) ─────────
  readonly materialLabel: string;             // "재료"
  readonly materialMildSteel: string;
  readonly materialStainless304: string;
  readonly materialAluminum5052: string;
  readonly materialAluminum6061: string;
  readonly materialGalvanized: string;
  readonly materialBrass: string;
  readonly materialCopper: string;

  // ─── Property labels ───────────────────────────────────────────
  readonly thicknessLabel: string;            // "두께"
  readonly kFactorLabel: string;              // "K-팩터"
  readonly bendAllowanceLabel: string;        // "절곡 허용량"
  readonly bendDeductionLabel: string;        // "절곡 공제량"
  readonly springbackLabel: string;           // "스프링백"
  readonly minBendRadiusLabel: string;        // "최소 굽힘 반경"
  readonly bendLineLabel: string;             // "절곡선"
  readonly outlineLabel: string;              // "외곽선"
  readonly flatPatternLabel: string;          // "전개도"
  readonly radiusLabel: string;
  readonly angleLabel: string;
  readonly directionLabel: string;
  readonly highlightedRow: string;            // "현재 R/t" caption

  // ─── K-factor table headers ────────────────────────────────────
  readonly kTableMaterialCol: string;         // "재료"
  readonly kTableRatioCol: string;            // "R/t"
  readonly kTableValueCol: string;            // "K"
  readonly kTableCopiedToClipboard: string;   // "복사됨" toast

  // ─── Buttons ───────────────────────────────────────────────────
  readonly autoDrawingButton: string;         // "자동 도면 생성"
  readonly autoDrawingTitle: string;          // "자동 도면" dialog title
  readonly generatePdfButton: string;         // "PDF 생성"
  readonly exportCsvButton: string;           // "CSV로 복사"
  readonly closeButton: string;               // "닫기"
  readonly refreshButton: string;             // "새로고침"
  readonly copyCellButton: string;            // "복사"
  readonly cancelButton: string;              // "취소"

  // ─── Units ─────────────────────────────────────────────────────
  readonly unitsLabel: string;                // "단위"
  readonly unitMm: string;                    // "mm"
  readonly unitInch: string;                  // "inch"

  // ─── Dock ──────────────────────────────────────────────────────
  readonly dockTitle: string;                 // "절곡 표 (Bend table dock)"
  readonly dockCollapse: string;
  readonly dockExpand: string;
  readonly dockClose: string;

  // ─── Auto-drawing dialog ──────────────────────────────────────
  readonly autoDrawingDeferredNote: string;   // geometric unfold pending message
  readonly autoDrawingTaskRef: string;        // task #31 reference
  readonly autoDrawingPreviewTitle: string;
  readonly autoDrawingHeader: string;
  readonly autoDrawingTimestamp: string;
  readonly pdfGenerated: string;              // success toast

  // ─── Bend allowance preview line ───────────────────────────────
  readonly bendPreviewSampleLine: string;     // "샘플 절곡 (R=2, t=2, θ=90°)"
  readonly bendPreviewFormulaLine: string;    // "BA = θ × (R + K × t) × π / 180"

  // ─── Onboarding tour ──────────────────────────────────────────
  readonly tourSheetMetalTitle: string;       // "판금 모드"
  readonly tourSheetMetalBody: string;
}

// ─── Korean (canonical for the Korean market) ─────────────────────

const KO: SheetMetalDict = {
  rightPaneTitle: '판금 속성',
  sectionMaterial: '재료',
  sectionThickness: '두께',
  sectionKFactorTable: 'K-팩터 표',
  sectionBendPreview: '절곡 허용량 미리보기',
  sectionFlatBlank: '전개 블랭크',

  materialLabel: '재료',
  materialMildSteel: '연강 (SPCC)',
  materialStainless304: '스테인리스 STS304',
  materialAluminum5052: '알루미늄 AL5052',
  materialAluminum6061: '알루미늄 AL6061',
  materialGalvanized: '아연도금강판 (SGCC)',
  materialBrass: '황동 C2680',
  materialCopper: '동판 C1100',

  thicknessLabel: '두께',
  kFactorLabel: 'K-팩터',
  bendAllowanceLabel: '절곡 허용량',
  bendDeductionLabel: '절곡 공제량',
  springbackLabel: '스프링백',
  minBendRadiusLabel: '최소 굽힘 반경',
  bendLineLabel: '절곡선',
  outlineLabel: '외곽선',
  flatPatternLabel: '전개도',
  radiusLabel: '반경',
  angleLabel: '각도',
  directionLabel: '방향',
  highlightedRow: '현재 R/t',

  kTableMaterialCol: '재료',
  kTableRatioCol: 'R/t',
  kTableValueCol: 'K',
  kTableCopiedToClipboard: '복사됨',

  autoDrawingButton: '자동 도면 생성',
  autoDrawingTitle: '자동 도면',
  generatePdfButton: 'PDF 생성',
  exportCsvButton: 'CSV로 복사',
  closeButton: '닫기',
  refreshButton: '새로고침',
  copyCellButton: '복사',
  cancelButton: '취소',

  unitsLabel: '단위',
  unitMm: 'mm',
  unitInch: '인치',

  dockTitle: '절곡 표',
  dockCollapse: '접기',
  dockExpand: '펴기',
  dockClose: '닫기',

  autoDrawingDeferredNote:
    '기하학적 전개 계산은 occt-worker 가동 대기 중입니다. 현재 K-팩터 표 값만 표시합니다.',
  autoDrawingTaskRef: 'Wave 1 task #31 — occt-worker 프로비저닝',
  autoDrawingPreviewTitle: 'PDF 미리보기',
  autoDrawingHeader: 'NexyFab 판금 자동 도면',
  autoDrawingTimestamp: '생성 시각',
  pdfGenerated: 'PDF 생성 완료',

  bendPreviewSampleLine: '샘플 절곡 (R=2 mm, t=2 mm, θ=90°)',
  bendPreviewFormulaLine: 'BA = θ × (R + K × t) × π / 180',

  tourSheetMetalTitle: '판금 모드',
  tourSheetMetalBody:
    '피처 트리에서 판금 피처를 클릭하면 우측 패널에 K-팩터 표가 나타납니다.',
};

// ─── English (canonical for everywhere else) ──────────────────────

const EN: SheetMetalDict = {
  rightPaneTitle: 'Sheet metal properties',
  sectionMaterial: 'Material',
  sectionThickness: 'Thickness',
  sectionKFactorTable: 'K-factor table',
  sectionBendPreview: 'Bend allowance preview',
  sectionFlatBlank: 'Flat blank',

  materialLabel: 'Material',
  materialMildSteel: 'Mild Steel (SPCC)',
  materialStainless304: 'Stainless STS304',
  materialAluminum5052: 'Aluminum 5052',
  materialAluminum6061: 'Aluminum 6061',
  materialGalvanized: 'Galvanized Steel (SGCC)',
  materialBrass: 'Brass C2680',
  materialCopper: 'Copper C1100',

  thicknessLabel: 'Thickness',
  kFactorLabel: 'K-factor',
  bendAllowanceLabel: 'Bend allowance',
  bendDeductionLabel: 'Bend deduction',
  springbackLabel: 'Springback',
  minBendRadiusLabel: 'Min bend radius',
  bendLineLabel: 'Bend line',
  outlineLabel: 'Outline',
  flatPatternLabel: 'Flat pattern',
  radiusLabel: 'Radius',
  angleLabel: 'Angle',
  directionLabel: 'Direction',
  highlightedRow: 'Current R/t',

  kTableMaterialCol: 'Material',
  kTableRatioCol: 'R/t',
  kTableValueCol: 'K',
  kTableCopiedToClipboard: 'Copied',

  autoDrawingButton: 'Auto-drawing',
  autoDrawingTitle: 'Auto-drawing',
  generatePdfButton: 'Generate PDF',
  exportCsvButton: 'Copy as CSV',
  closeButton: 'Close',
  refreshButton: 'Refresh',
  copyCellButton: 'Copy',
  cancelButton: 'Cancel',

  unitsLabel: 'Units',
  unitMm: 'mm',
  unitInch: 'inch',

  dockTitle: 'Bend table',
  dockCollapse: 'Collapse',
  dockExpand: 'Expand',
  dockClose: 'Close',

  autoDrawingDeferredNote:
    'Geometric unfold pending occt-worker provision; using K-factor tables for K-value display only.',
  autoDrawingTaskRef: 'Wave 1 task #31 — occt-worker provision',
  autoDrawingPreviewTitle: 'PDF preview',
  autoDrawingHeader: 'NexyFab Sheet Metal Auto-Drawing',
  autoDrawingTimestamp: 'Generated at',
  pdfGenerated: 'PDF generated',

  bendPreviewSampleLine: 'Sample bend (R=2 mm, t=2 mm, θ=90°)',
  bendPreviewFormulaLine: 'BA = θ × (R + K × t) × π / 180',

  tourSheetMetalTitle: 'Sheet metal mode',
  tourSheetMetalBody:
    'Click any sheet metal feature in the tree to see the right pane with K-factor table.',
};

// ─── JA / ZH / ES / AR ─────────────────────────────────────────────

const JA: SheetMetalDict = {
  ...EN,
  rightPaneTitle: '板金プロパティ',
  sectionMaterial: '材料',
  sectionThickness: '板厚',
  sectionKFactorTable: 'K係数 表',
  sectionBendPreview: '曲げ代プレビュー',
  sectionFlatBlank: '展開ブランク',

  materialLabel: '材料',
  materialMildSteel: '軟鋼 (SPCC)',
  materialStainless304: 'ステンレス STS304',
  materialAluminum5052: 'アルミ AL5052',
  materialAluminum6061: 'アルミ AL6061',
  materialGalvanized: '亜鉛めっき鋼板 (SGCC)',
  materialBrass: '黄銅 C2680',
  materialCopper: '銅板 C1100',

  thicknessLabel: '板厚',
  kFactorLabel: 'K係数',
  bendAllowanceLabel: '曲げ代',
  bendDeductionLabel: '曲げ控除量',
  springbackLabel: 'スプリングバック',
  minBendRadiusLabel: '最小曲げ半径',
  bendLineLabel: '曲げ線',
  outlineLabel: '外形',
  flatPatternLabel: '展開図',
  radiusLabel: '半径',
  angleLabel: '角度',
  directionLabel: '方向',
  highlightedRow: '現在の R/t',

  kTableMaterialCol: '材料',
  kTableRatioCol: 'R/t',
  kTableValueCol: 'K',
  kTableCopiedToClipboard: 'コピーしました',

  autoDrawingButton: '自動製図',
  autoDrawingTitle: '自動製図',
  generatePdfButton: 'PDF を生成',
  exportCsvButton: 'CSV としてコピー',
  closeButton: '閉じる',
  refreshButton: '更新',
  copyCellButton: 'コピー',
  cancelButton: 'キャンセル',

  unitsLabel: '単位',
  unitMm: 'mm',
  unitInch: 'インチ',

  dockTitle: '曲げテーブル',
  dockCollapse: '折りたたむ',
  dockExpand: '展開する',
  dockClose: '閉じる',

  autoDrawingDeferredNote:
    '形状展開計算は occt-worker の起動を待っています。現在は K 係数表の値のみ表示します。',
  autoDrawingTaskRef: 'Wave 1 task #31 — occt-worker 提供',
  autoDrawingPreviewTitle: 'PDF プレビュー',
  autoDrawingHeader: 'NexyFab 板金自動図面',
  autoDrawingTimestamp: '生成時刻',
  pdfGenerated: 'PDF を生成しました',

  bendPreviewSampleLine: 'サンプル曲げ (R=2 mm, t=2 mm, θ=90°)',
  bendPreviewFormulaLine: 'BA = θ × (R + K × t) × π / 180',

  tourSheetMetalTitle: '板金モード',
  tourSheetMetalBody:
    'フィーチャツリーで板金フィーチャをクリックすると、右ペインに K 係数表が表示されます。',
};

const ZH: SheetMetalDict = {
  ...EN,
  rightPaneTitle: '钣金属性',
  sectionMaterial: '材料',
  sectionThickness: '厚度',
  sectionKFactorTable: 'K因子表',
  sectionBendPreview: '弯曲余量预览',
  sectionFlatBlank: '展开毛坯',

  materialLabel: '材料',
  materialMildSteel: '低碳钢 (SPCC)',
  materialStainless304: '不锈钢 STS304',
  materialAluminum5052: '铝 AL5052',
  materialAluminum6061: '铝 AL6061',
  materialGalvanized: '镀锌钢板 (SGCC)',
  materialBrass: '黄铜 C2680',
  materialCopper: '紫铜 C1100',

  thicknessLabel: '厚度',
  kFactorLabel: 'K因子',
  bendAllowanceLabel: '弯曲余量',
  bendDeductionLabel: '折弯扣减量',
  springbackLabel: '回弹',
  minBendRadiusLabel: '最小折弯半径',
  bendLineLabel: '折弯线',
  outlineLabel: '轮廓',
  flatPatternLabel: '展开图',
  radiusLabel: '半径',
  angleLabel: '角度',
  directionLabel: '方向',
  highlightedRow: '当前 R/t',

  kTableMaterialCol: '材料',
  kTableRatioCol: 'R/t',
  kTableValueCol: 'K',
  kTableCopiedToClipboard: '已复制',

  autoDrawingButton: '自动制图',
  autoDrawingTitle: '自动制图',
  generatePdfButton: '生成 PDF',
  exportCsvButton: '复制为 CSV',
  closeButton: '关闭',
  refreshButton: '刷新',
  copyCellButton: '复制',
  cancelButton: '取消',

  unitsLabel: '单位',
  unitMm: '毫米',
  unitInch: '英寸',

  dockTitle: '折弯表',
  dockCollapse: '收起',
  dockExpand: '展开',
  dockClose: '关闭',

  autoDrawingDeferredNote:
    '几何展开计算等待 occt-worker 上线;当前仅显示 K 因子表数值。',
  autoDrawingTaskRef: 'Wave 1 任务 #31 — occt-worker 部署',
  autoDrawingPreviewTitle: 'PDF 预览',
  autoDrawingHeader: 'NexyFab 钣金自动制图',
  autoDrawingTimestamp: '生成时间',
  pdfGenerated: 'PDF 已生成',

  bendPreviewSampleLine: '样本折弯 (R=2 mm, t=2 mm, θ=90°)',
  bendPreviewFormulaLine: 'BA = θ × (R + K × t) × π / 180',

  tourSheetMetalTitle: '钣金模式',
  tourSheetMetalBody:
    '在特征树中点击任意钣金特征,即可在右侧面板中查看 K 因子表。',
};

const ES: SheetMetalDict = {
  ...EN,
  rightPaneTitle: 'Propiedades de chapa',
  sectionMaterial: 'Material',
  sectionThickness: 'Espesor',
  sectionKFactorTable: 'Tabla de Factor K',
  sectionBendPreview: 'Vista previa del margen de doblado',
  sectionFlatBlank: 'Plantilla plana',

  materialLabel: 'Material',
  materialMildSteel: 'Acero dulce (SPCC)',
  materialStainless304: 'Inoxidable STS304',
  materialAluminum5052: 'Aluminio 5052',
  materialAluminum6061: 'Aluminio 6061',
  materialGalvanized: 'Acero galvanizado (SGCC)',
  materialBrass: 'Latón C2680',
  materialCopper: 'Cobre C1100',

  thicknessLabel: 'Espesor',
  kFactorLabel: 'Factor K',
  bendAllowanceLabel: 'Margen de doblado',
  bendDeductionLabel: 'Deducción de doblado',
  springbackLabel: 'Recuperación elástica',
  minBendRadiusLabel: 'Radio mínimo de doblado',
  bendLineLabel: 'Línea de doblado',
  outlineLabel: 'Contorno',
  flatPatternLabel: 'Patrón plano',
  radiusLabel: 'Radio',
  angleLabel: 'Ángulo',
  directionLabel: 'Dirección',
  highlightedRow: 'R/t actual',

  kTableMaterialCol: 'Material',
  kTableRatioCol: 'R/t',
  kTableValueCol: 'K',
  kTableCopiedToClipboard: 'Copiado',

  autoDrawingButton: 'Dibujo automático',
  autoDrawingTitle: 'Dibujo automático',
  generatePdfButton: 'Generar PDF',
  exportCsvButton: 'Copiar como CSV',
  closeButton: 'Cerrar',
  refreshButton: 'Actualizar',
  copyCellButton: 'Copiar',
  cancelButton: 'Cancelar',

  unitsLabel: 'Unidades',
  unitMm: 'mm',
  unitInch: 'pulgada',

  dockTitle: 'Tabla de pliegues',
  dockCollapse: 'Contraer',
  dockExpand: 'Expandir',
  dockClose: 'Cerrar',

  autoDrawingDeferredNote:
    'Desplegado geométrico pendiente del occt-worker; mostrando solo valores de la tabla del factor K.',
  autoDrawingTaskRef: 'Wave 1 tarea #31 — provisión de occt-worker',
  autoDrawingPreviewTitle: 'Vista previa del PDF',
  autoDrawingHeader: 'Dibujo automático de chapa NexyFab',
  autoDrawingTimestamp: 'Generado en',
  pdfGenerated: 'PDF generado',

  bendPreviewSampleLine: 'Doblado de muestra (R=2 mm, t=2 mm, θ=90°)',
  bendPreviewFormulaLine: 'BA = θ × (R + K × t) × π / 180',

  tourSheetMetalTitle: 'Modo chapa metálica',
  tourSheetMetalBody:
    'Haga clic en cualquier función de chapa metálica en el árbol para ver el panel derecho con la tabla del factor K.',
};

const AR: SheetMetalDict = {
  ...EN,
  rightPaneTitle: 'خصائص الصفائح المعدنية',
  sectionMaterial: 'المادة',
  sectionThickness: 'السماكة',
  sectionKFactorTable: 'جدول عامل K',
  sectionBendPreview: 'معاينة مخصص الانثناء',
  sectionFlatBlank: 'القالب المسطح',

  materialLabel: 'المادة',
  materialMildSteel: 'صلب طري (SPCC)',
  materialStainless304: 'فولاذ مقاوم STS304',
  materialAluminum5052: 'ألمنيوم 5052',
  materialAluminum6061: 'ألمنيوم 6061',
  materialGalvanized: 'صلب مجلفن (SGCC)',
  materialBrass: 'نحاس أصفر C2680',
  materialCopper: 'نحاس أحمر C1100',

  thicknessLabel: 'السماكة',
  kFactorLabel: 'عامل K',
  bendAllowanceLabel: 'مخصص الانثناء',
  bendDeductionLabel: 'خصم الانثناء',
  springbackLabel: 'الارتداد',
  minBendRadiusLabel: 'أصغر نصف قطر للانثناء',
  bendLineLabel: 'خط الانثناء',
  outlineLabel: 'المخطط',
  flatPatternLabel: 'النمط المسطح',
  radiusLabel: 'نصف القطر',
  angleLabel: 'الزاوية',
  directionLabel: 'الاتجاه',
  highlightedRow: 'R/t الحالي',

  kTableMaterialCol: 'المادة',
  kTableRatioCol: 'R/t',
  kTableValueCol: 'K',
  kTableCopiedToClipboard: 'تم النسخ',

  autoDrawingButton: 'الرسم التلقائي',
  autoDrawingTitle: 'الرسم التلقائي',
  generatePdfButton: 'إنشاء PDF',
  exportCsvButton: 'نسخ بتنسيق CSV',
  closeButton: 'إغلاق',
  refreshButton: 'تحديث',
  copyCellButton: 'نسخ',
  cancelButton: 'إلغاء',

  unitsLabel: 'الوحدات',
  unitMm: 'مم',
  unitInch: 'بوصة',

  dockTitle: 'جدول الانثناء',
  dockCollapse: 'طي',
  dockExpand: 'توسيع',
  dockClose: 'إغلاق',

  autoDrawingDeferredNote:
    'حساب النشر الهندسي قيد الانتظار لتوفير occt-worker؛ يتم عرض قيم جدول عامل K فقط.',
  autoDrawingTaskRef: 'Wave 1 task #31 — توفير occt-worker',
  autoDrawingPreviewTitle: 'معاينة PDF',
  autoDrawingHeader: 'الرسم التلقائي للصفائح المعدنية NexyFab',
  autoDrawingTimestamp: 'تم الإنشاء في',
  pdfGenerated: 'تم إنشاء PDF',

  bendPreviewSampleLine: 'انثناء عينة (R=2 مم, t=2 مم, θ=90°)',
  bendPreviewFormulaLine: 'BA = θ × (R + K × t) × π / 180',

  tourSheetMetalTitle: 'وضع الصفائح المعدنية',
  tourSheetMetalBody:
    'انقر على أي ميزة صفائح معدنية في الشجرة لعرض الجزء الأيمن مع جدول عامل K.',
};

const DICTS: Record<SheetMetalLang, SheetMetalDict> = {
  ko: KO,
  en: EN,
  ja: JA,
  zh: ZH,
  es: ES,
  ar: AR,
};

/** Look up a fully-populated `SheetMetalDict` for the given lang.
 *  Unknown codes (or `undefined`) fall back to English so the UI is
 *  always fully labelled. */
export function pickSheetMetalDict(lang: SheetMetalLang | string | undefined): SheetMetalDict {
  if (lang === undefined) return EN;
  if (Object.prototype.hasOwnProperty.call(DICTS, lang)) {
    return DICTS[lang as SheetMetalLang];
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

/** Public re-exports for tests. */
export const SHEET_METAL_DICT_KO = KO;
export const SHEET_METAL_DICT_EN = EN;
export const SHEET_METAL_DICT_JA = JA;
export const SHEET_METAL_DICT_ZH = ZH;
export const SHEET_METAL_DICT_ES = ES;
export const SHEET_METAL_DICT_AR = AR;
