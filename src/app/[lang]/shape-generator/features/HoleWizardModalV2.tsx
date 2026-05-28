'use client';

/**
 * HoleWizardModalV2 — flag-gated three-tab redesign (Phase 2 W2 skeleton).
 *
 * Visual + interaction shell only. The Apply button is wired to a single
 * `onApply(def: HoleArrayDefinition)` callback that hands the validated
 * definition to the parent; no boolean / worker calls happen inside the
 * modal. The worker endpoint (`/occt/op/hole/drilled`) lands in a later
 * commit once occt-worker `src/` is unblocked.
 *
 * Flag mechanism — matches the existing `?shell=v2` pattern (see
 * `ShapeGeneratorApp.tsx` `ShellGate`): we read `useSearchParams()` and
 * gate on `?hole-wizard=v2`. The legacy `HoleWizardModal.tsx` (V1) is
 * untouched and continues to mount in `ShapeGeneratorInner.tsx`; this V2
 * component is rendered alongside but returns `null` until the flag is
 * flipped (default-off through Phase 2 W2).
 *
 * Spec references: §6.1 layout, §6.5 i18n strings.
 */

import React, { useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  HOLE_STANDARD_SERIES,
  type HoleStandardSeries,
  type HoleStandardSpec,
} from './holeStandards';
import {
  createLinearArrayDefaults,
  createCircularArrayDefaults,
  createRectArrayDefaults,
  createManualArrayDefaults,
  createFromSketchArrayDefaults,
  expandHoleArray,
  validateHoleArray,
  resolveHoleSpec,
  DEFAULT_DRILL_TIP_ANGLE,
  type BlindBottomShape,
  type HoleArrayDefinition,
  type HoleArrayKind,
  type HoleKind,
  type HoleSpec,
  type HoleStandardRef,
  type TerminationKind,
  type TerminationParams,
} from './holeArray';
import { computeHoleSectionSvg, type SvgElement } from './holeSectionSvg';

// ─── Public props ──────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar' | string;
  onClose: () => void;
  onApply: (def: HoleArrayDefinition) => void;
  /**
   * When `true`, bypass the search-param flag check. Test escape hatch
   * (the next/navigation mock in tests can't easily set query params).
   */
  forceFlagOpen?: boolean;
}

// ─── i18n dictionary ───────────────────────────────────────────────────────
// Strings sourced from `wave-2-phase-2-hole-wizard-spec.md` §6.5 (KR/EN/JA/
// ZH/ES/AR). KR is canonical for the Nexysys product surface per the i18n
// preferences memory; EN baseline drives the spec table.

type Dict = {
  wizardTitle: string;
  tabType: string;
  tabSize: string;
  tabPosition: string;
  tabTermination: string;
  tabPreview: string;
  kindDrilled: string;
  kindCbore: string;
  kindCsk: string;
  kindCdrill: string;
  kindTap: string;
  kindPipeTap: string;
  positionKindLinear: string;
  positionKindCircular: string;
  positionKindRect: string;
  positionKindFromSketch: string;
  positionKindManual: string;
  fitClose: string;
  fitNormal: string;
  fitLoose: string;
  nPositions: (n: number) => string;
  addHoles: string;
  cancel: string;
  flagOff: string;
  /** Field labels (kept short for the dense table layout). */
  fStartX: string;
  fStartY: string;
  fDx: string;
  fDy: string;
  fCount: string;
  fCenterX: string;
  fCenterY: string;
  fRadius: string;
  fStartAngle: string;
  fStepX: string;
  fStepY: string;
  fRows: string;
  fCols: string;
  fSketchId: string;
  fitClassLabel: string;
  /** Termination tab labels. */
  termBlind: string;
  termThrough: string;
  termUpToNext: string;
  termUpToFace: string;
  termDepth: string;
  termBottomFlat: string;
  termBottomConical: string;
  termDrillTipAngle: string;
  termFacePickerPlaceholder: string;
  termFacePickerHint: string;
  /** Preview tab labels. */
  prevHeader: string;
  prevDiameter: string;
  prevHeadDiameter: string;
  prevHeadDepth: string;
  prevConeDiameter: string;
  prevConeAngle: string;
  prevPositions: string;
  /** Sub-type fields (counterbore / countersink / tap). */
  fHeadDiameter: string;
  fHeadDepth: string;
  fConeDiameter: string;
  fConeAngle: string;
};

const DICT: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', Dict> = {
  ko: {
    wizardTitle: '구멍 마법사 (V2)',
    tabType: '유형',
    tabSize: '크기',
    tabPosition: '위치',
    tabTermination: '종료',
    tabPreview: '미리보기',
    kindDrilled: '드릴',
    kindCbore: '카운터보어',
    kindCsk: '카운터싱크',
    kindCdrill: '카운터드릴',
    kindTap: '탭(나사구멍)',
    kindPipeTap: '파이프 탭',
    positionKindLinear: '선형 패턴',
    positionKindCircular: '원형 패턴',
    positionKindRect: '격자',
    positionKindFromSketch: '스케치에서',
    positionKindManual: '수동 입력',
    fitClose: '정밀',
    fitNormal: '보통',
    fitLoose: '헐거움',
    nPositions: (n: number) => `${n}개 위치`,
    addHoles: '구멍 추가',
    cancel: '취소',
    flagOff: 'V2 마법사 비활성화 — ?hole-wizard=v2 플래그를 켜십시오',
    fStartX: '시작 X',
    fStartY: '시작 Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: '개수',
    fCenterX: '중심 X',
    fCenterY: '중심 Y',
    fRadius: '반지름',
    fStartAngle: '시작각 (rad)',
    fStepX: 'X 간격',
    fStepY: 'Y 간격',
    fRows: '행',
    fCols: '열',
    fSketchId: '스케치 ID',
    fitClassLabel: '핏 클래스',
    termBlind: '막힘',
    termThrough: '관통',
    termUpToNext: '다음 면까지',
    termUpToFace: '면 지정',
    termDepth: '깊이 (mm)',
    termBottomFlat: '평면 바닥',
    termBottomConical: '원뿔 바닥',
    termDrillTipAngle: '드릴팁 각도 (°)',
    termFacePickerPlaceholder: '[작업자 준비 후 면 선택]',
    termFacePickerHint: '워커 준비 시 활성화',
    prevHeader: '단면 미리보기',
    prevDiameter: '드릴 ⌀',
    prevHeadDiameter: '카운터보어 ⌀',
    prevHeadDepth: '카운터보어 깊이',
    prevConeDiameter: '카운터싱크 ⌀',
    prevConeAngle: '카운터싱크 각도',
    prevPositions: '위치 수',
    fHeadDiameter: '머리 ⌀',
    fHeadDepth: '머리 깊이',
    fConeDiameter: '원뿔 ⌀',
    fConeAngle: '원뿔 각도 (°)',
  },
  en: {
    wizardTitle: 'Hole Wizard (V2)',
    tabType: 'Type',
    tabSize: 'Size',
    tabPosition: 'Position',
    tabTermination: 'Termination',
    tabPreview: 'Preview',
    kindDrilled: 'Drilled',
    kindCbore: 'Counterbore',
    kindCsk: 'Countersink',
    kindCdrill: 'Counterdrill',
    kindTap: 'Tap',
    kindPipeTap: 'Pipe Tap',
    positionKindLinear: 'Linear',
    positionKindCircular: 'Circular',
    positionKindRect: 'Rectangular',
    positionKindFromSketch: 'From sketch',
    positionKindManual: 'Manual',
    fitClose: 'Close',
    fitNormal: 'Normal',
    fitLoose: 'Loose',
    nPositions: (n: number) => `${n} position${n === 1 ? '' : 's'}`,
    addHoles: 'Add Holes',
    cancel: 'Cancel',
    flagOff: 'V2 wizard disabled — enable with ?hole-wizard=v2',
    fStartX: 'Start X',
    fStartY: 'Start Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: 'Count',
    fCenterX: 'Center X',
    fCenterY: 'Center Y',
    fRadius: 'Radius',
    fStartAngle: 'Start angle (rad)',
    fStepX: 'Step X',
    fStepY: 'Step Y',
    fRows: 'Rows',
    fCols: 'Cols',
    fSketchId: 'Sketch ID',
    fitClassLabel: 'Fit class',
    termBlind: 'Blind',
    termThrough: 'Through all',
    termUpToNext: 'Up to next',
    termUpToFace: 'Up to face',
    termDepth: 'Depth (mm)',
    termBottomFlat: 'Flat bottom',
    termBottomConical: 'Conical bottom',
    termDrillTipAngle: 'Drill tip angle (°)',
    termFacePickerPlaceholder: '[Pick face after Worker is ready]',
    termFacePickerHint: 'Enabled once worker face-picker lands',
    prevHeader: 'Cross-section preview',
    prevDiameter: 'Drill ⌀',
    prevHeadDiameter: 'Counterbore ⌀',
    prevHeadDepth: 'Counterbore depth',
    prevConeDiameter: 'Countersink ⌀',
    prevConeAngle: 'Countersink angle',
    prevPositions: 'Positions',
    fHeadDiameter: 'Head ⌀',
    fHeadDepth: 'Head depth',
    fConeDiameter: 'Cone ⌀',
    fConeAngle: 'Cone angle (°)',
  },
  ja: {
    wizardTitle: 'ホールウィザード (V2)',
    tabType: '種類',
    tabSize: 'サイズ',
    tabPosition: '位置',
    tabTermination: '終端',
    tabPreview: 'プレビュー',
    kindDrilled: 'ドリル',
    kindCbore: 'カウンターボア',
    kindCsk: 'カウンターシンク',
    kindCdrill: 'カウンタードリル',
    kindTap: 'タップ',
    kindPipeTap: 'パイプタップ',
    positionKindLinear: '直線',
    positionKindCircular: '円形',
    positionKindRect: '格子',
    positionKindFromSketch: 'スケッチから',
    positionKindManual: '手動',
    fitClose: '精密',
    fitNormal: '普通',
    fitLoose: 'ゆるい',
    nPositions: (n: number) => `${n} 位置`,
    addHoles: 'ホールを追加',
    cancel: 'キャンセル',
    flagOff: 'V2 ウィザードは無効 — ?hole-wizard=v2 で有効化',
    fStartX: '開始 X',
    fStartY: '開始 Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: '数',
    fCenterX: '中心 X',
    fCenterY: '中心 Y',
    fRadius: '半径',
    fStartAngle: '開始角 (rad)',
    fStepX: 'X 間隔',
    fStepY: 'Y 間隔',
    fRows: '行',
    fCols: '列',
    fSketchId: 'スケッチ ID',
    fitClassLabel: 'フィット',
    termBlind: '止まり',
    termThrough: '貫通',
    termUpToNext: '次の面まで',
    termUpToFace: '面指定',
    termDepth: '深さ (mm)',
    termBottomFlat: '平面底',
    termBottomConical: '円錐底',
    termDrillTipAngle: 'ドリル先端角 (°)',
    termFacePickerPlaceholder: '[ワーカー準備後に面を選択]',
    termFacePickerHint: 'ワーカー対応後に有効化',
    prevHeader: '断面プレビュー',
    prevDiameter: 'ドリル ⌀',
    prevHeadDiameter: 'カウンターボア ⌀',
    prevHeadDepth: 'カウンターボア深さ',
    prevConeDiameter: 'カウンターシンク ⌀',
    prevConeAngle: 'カウンターシンク角度',
    prevPositions: '位置数',
    fHeadDiameter: 'ヘッド ⌀',
    fHeadDepth: 'ヘッド深さ',
    fConeDiameter: 'コーン ⌀',
    fConeAngle: 'コーン角度 (°)',
  },
  zh: {
    wizardTitle: '孔向导 (V2)',
    tabType: '类型',
    tabSize: '尺寸',
    tabPosition: '位置',
    tabTermination: '终止',
    tabPreview: '预览',
    kindDrilled: '钻孔',
    kindCbore: '沉头扩孔',
    kindCsk: '沉头孔',
    kindCdrill: '沉头钻孔',
    kindTap: '攻丝',
    kindPipeTap: '管螺纹',
    positionKindLinear: '线性',
    positionKindCircular: '圆形',
    positionKindRect: '矩形',
    positionKindFromSketch: '从草图',
    positionKindManual: '手动',
    fitClose: '紧配合',
    fitNormal: '普通配合',
    fitLoose: '松配合',
    nPositions: (n: number) => `${n} 个位置`,
    addHoles: '添加孔',
    cancel: '取消',
    flagOff: 'V2 向导已禁用 — 使用 ?hole-wizard=v2 启用',
    fStartX: '起点 X',
    fStartY: '起点 Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: '数量',
    fCenterX: '中心 X',
    fCenterY: '中心 Y',
    fRadius: '半径',
    fStartAngle: '起始角 (rad)',
    fStepX: 'X 步长',
    fStepY: 'Y 步长',
    fRows: '行',
    fCols: '列',
    fSketchId: '草图 ID',
    fitClassLabel: '配合等级',
    termBlind: '盲孔',
    termThrough: '通孔',
    termUpToNext: '至下一面',
    termUpToFace: '至指定面',
    termDepth: '深度 (mm)',
    termBottomFlat: '平底',
    termBottomConical: '锥底',
    termDrillTipAngle: '钻头角度 (°)',
    termFacePickerPlaceholder: '[工作器就绪后选择面]',
    termFacePickerHint: '工作器就绪后启用',
    prevHeader: '截面预览',
    prevDiameter: '钻孔 ⌀',
    prevHeadDiameter: '沉头扩孔 ⌀',
    prevHeadDepth: '沉头扩孔深度',
    prevConeDiameter: '沉头孔 ⌀',
    prevConeAngle: '沉头孔角度',
    prevPositions: '位置数',
    fHeadDiameter: '头部 ⌀',
    fHeadDepth: '头部深度',
    fConeDiameter: '锥面 ⌀',
    fConeAngle: '锥面角度 (°)',
  },
  es: {
    wizardTitle: 'Asistente de Hole (V2)',
    tabType: 'Tipo',
    tabSize: 'Tamaño',
    tabPosition: 'Posición',
    tabTermination: 'Terminación',
    tabPreview: 'Vista previa',
    kindDrilled: 'Taladrado',
    kindCbore: 'Avellanado plano',
    kindCsk: 'Avellanado',
    kindCdrill: 'Contrataladrado',
    kindTap: 'Roscado',
    kindPipeTap: 'Roscado para tubo',
    positionKindLinear: 'Lineal',
    positionKindCircular: 'Circular',
    positionKindRect: 'Rectangular',
    positionKindFromSketch: 'Desde croquis',
    positionKindManual: 'Manual',
    fitClose: 'Cerrado',
    fitNormal: 'Normal',
    fitLoose: 'Flojo',
    nPositions: (n: number) => `${n} ${n === 1 ? 'posición' : 'posiciones'}`,
    addHoles: 'Añadir Holes',
    cancel: 'Cancelar',
    flagOff: 'Asistente V2 desactivado — activa con ?hole-wizard=v2',
    fStartX: 'X inicial',
    fStartY: 'Y inicial',
    fDx: 'dX',
    fDy: 'dY',
    fCount: 'Cantidad',
    fCenterX: 'X centro',
    fCenterY: 'Y centro',
    fRadius: 'Radio',
    fStartAngle: 'Ángulo inicial (rad)',
    fStepX: 'Paso X',
    fStepY: 'Paso Y',
    fRows: 'Filas',
    fCols: 'Columnas',
    fSketchId: 'ID de croquis',
    fitClassLabel: 'Clase de ajuste',
    termBlind: 'Ciego',
    termThrough: 'Pasante total',
    termUpToNext: 'Hasta el próximo',
    termUpToFace: 'Hasta cara',
    termDepth: 'Profundidad (mm)',
    termBottomFlat: 'Fondo plano',
    termBottomConical: 'Fondo cónico',
    termDrillTipAngle: 'Ángulo de punta (°)',
    termFacePickerPlaceholder: '[Selecciona cara cuando Worker esté listo]',
    termFacePickerHint: 'Activo cuando el selector de cara esté disponible',
    prevHeader: 'Vista previa de sección',
    prevDiameter: 'Taladro ⌀',
    prevHeadDiameter: 'Avellanado ⌀',
    prevHeadDepth: 'Profundidad avellanado',
    prevConeDiameter: 'Avellanado cónico ⌀',
    prevConeAngle: 'Ángulo avellanado',
    prevPositions: 'Posiciones',
    fHeadDiameter: 'Cabeza ⌀',
    fHeadDepth: 'Profundidad cabeza',
    fConeDiameter: 'Cono ⌀',
    fConeAngle: 'Ángulo del cono (°)',
  },
  ar: {
    wizardTitle: 'معالج الفتحات (V2)',
    tabType: 'النوع',
    tabSize: 'الحجم',
    tabPosition: 'الموضع',
    tabTermination: 'الإنهاء',
    tabPreview: 'معاينة',
    kindDrilled: 'مثقوب',
    kindCbore: 'تجويف عميق',
    kindCsk: 'تجويف مخروطي',
    kindCdrill: 'تثقيب مركّب',
    kindTap: 'حلزون داخلي',
    kindPipeTap: 'حلزون أنبوب',
    positionKindLinear: 'خطي',
    positionKindCircular: 'دائري',
    positionKindRect: 'مستطيل',
    positionKindFromSketch: 'من الرسم',
    positionKindManual: 'يدوي',
    fitClose: 'تطابق دقيق',
    fitNormal: 'تطابق عادي',
    fitLoose: 'تطابق فضفاض',
    nPositions: (n: number) => `${n} مواضع`,
    addHoles: 'إضافة فتحات',
    cancel: 'إلغاء',
    flagOff: 'معالج V2 معطل — فعّل عبر ?hole-wizard=v2',
    fStartX: 'بداية X',
    fStartY: 'بداية Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: 'العدد',
    fCenterX: 'مركز X',
    fCenterY: 'مركز Y',
    fRadius: 'نصف القطر',
    fStartAngle: 'الزاوية البدائية (rad)',
    fStepX: 'خطوة X',
    fStepY: 'خطوة Y',
    fRows: 'صفوف',
    fCols: 'أعمدة',
    fSketchId: 'معرف الرسم',
    fitClassLabel: 'فئة التطابق',
    termBlind: 'معتم',
    termThrough: 'نافذ كامل',
    termUpToNext: 'حتى السطح التالي',
    termUpToFace: 'حتى وجه محدد',
    termDepth: 'العمق (mm)',
    termBottomFlat: 'قاع مستوٍ',
    termBottomConical: 'قاع مخروطي',
    termDrillTipAngle: 'زاوية رأس المثقاب (°)',
    termFacePickerPlaceholder: '[اختر الوجه بعد تجهيز العامل]',
    termFacePickerHint: 'يُفعل عند جاهزية مُنتقي الأوجه',
    prevHeader: 'معاينة المقطع',
    prevDiameter: 'قطر المثقاب',
    prevHeadDiameter: 'قطر التجويف العميق',
    prevHeadDepth: 'عمق التجويف العميق',
    prevConeDiameter: 'قطر التجويف المخروطي',
    prevConeAngle: 'زاوية التجويف المخروطي',
    prevPositions: 'عدد المواضع',
    fHeadDiameter: 'قطر الرأس',
    fHeadDepth: 'عمق الرأس',
    fConeDiameter: 'قطر المخروط',
    fConeAngle: 'زاوية المخروط (°)',
  },
};

// ─── Tabs & sub-type catalogs ──────────────────────────────────────────────

type WizardTab = 'type' | 'size' | 'position' | 'termination' | 'preview';

/**
 * The 6 first-class hole types from spec §2. The wizard's UI label uses
 * camelCase / friendly names but the data-model `HoleKind` uses snake_case
 * for `pipe_tap`. The `WIZARD_TO_HOLEKIND` table maps between them.
 */
type WizardHoleType = 'drilled' | 'counterbore' | 'countersink' | 'counterdrill' | 'tap' | 'pipeTap';

const WIZARD_HOLE_TYPES: ReadonlyArray<WizardHoleType> = [
  'drilled',
  'counterbore',
  'countersink',
  'counterdrill',
  'tap',
  'pipeTap',
];

const WIZARD_TO_HOLEKIND: Record<WizardHoleType, HoleKind> = {
  drilled: 'drilled',
  counterbore: 'counterbore',
  countersink: 'countersink',
  counterdrill: 'counterdrill',
  tap: 'tap',
  pipeTap: 'pipe_tap',
};

const TERMINATION_KINDS: ReadonlyArray<TerminationKind> = [
  'blind',
  'through',
  'upToNext',
  'upToFace',
];

const POSITION_KINDS: ReadonlyArray<HoleArrayKind> = [
  'linear',
  'circular',
  'rect',
  'fromSketch',
  'manual',
];

/** Resolve which catalog series matches a (standard, holeType) selection. */
function defaultSeriesFor(holeType: WizardHoleType): HoleStandardSeries {
  if (holeType === 'pipeTap') return 'NPT';
  return 'ISO';
}

// ─── Component ─────────────────────────────────────────────────────────────

function pickLang(raw: string | undefined): keyof typeof DICT {
  const map: Record<string, keyof typeof DICT> = {
    ko: 'ko', kr: 'ko', en: 'en', ja: 'ja', jp: 'ja',
    zh: 'zh', cn: 'zh', es: 'es', ar: 'ar',
  };
  return map[raw ?? 'en'] ?? 'en';
}

export default function HoleWizardModalV2({
  open,
  lang,
  onClose,
  onApply,
  forceFlagOpen,
}: Props) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const t = DICT[pickLang(seg)];

  // ── Flag gate — matches ?shell=v2 pattern from ShellGate. ─────────────────
  const flagOn = forceFlagOpen === true || sp?.get('hole-wizard') === 'v2';

  // ── Tab state. ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<WizardTab>('type');

  // ── Type tab state. ──────────────────────────────────────────────────────
  const [holeType, setHoleType] = useState<WizardHoleType>('drilled');

  // ── Size tab state. ──────────────────────────────────────────────────────
  const [series, setSeries] = useState<HoleStandardSeries>(() => defaultSeriesFor('drilled'));
  const [designationIndex, setDesignationIndex] = useState(0);
  const [fitClass, setFitClass] = useState<'close' | 'normal' | 'loose'>('normal');

  // Reset designation when series flips so we don't index past the new
  // catalog's length (e.g. ISO has 18 rows, NPT has 10).
  const rows = HOLE_STANDARD_SERIES[series] ?? [];
  const safeIndex = Math.min(designationIndex, Math.max(0, rows.length - 1));
  const selectedRow: HoleStandardSpec | undefined = rows[safeIndex];

  // ── Position tab state. ──────────────────────────────────────────────────
  // We hold the full HoleArrayDefinition in state, seeded from the factory
  // matching the current `positionKind`. Switching kind reseeds with the
  // factory default — that's intentional, the wizard is "pick a kind, then
  // tweak", not "fill in the kind-specific section of a shared blob".
  const [positionKind, setPositionKind] = useState<HoleArrayKind>('linear');
  const [arrayDef, setArrayDef] = useState<HoleArrayDefinition>(() =>
    createLinearArrayDefaults('wizard-array', {
      series: 'ISO',
      designation: 'M6',
      fitClass: 'normal',
    }),
  );

  // Keep arrayDef.holeSpec in sync with current Size selection. The compiler
  // warning here is benign — selectedRowName is a primitive string from a
  // catalog read on every render, but the compiler can't prove the upstream
  // useState identity is stable enough to track. Plain derivation is fine.
  const selectedRowName = selectedRow?.name ?? '';
  const currentHoleSpec: HoleStandardRef = {
    series,
    designation: selectedRowName,
    fitClass,
  };

  /**
   * Switch position kind — reseed the array def using the matching factory
   * so each kind starts at sensible defaults the user can tweak.
   */
  function changePositionKind(next: HoleArrayKind) {
    setPositionKind(next);
    let seeded: HoleArrayDefinition;
    switch (next) {
      case 'linear':
        seeded = createLinearArrayDefaults('wizard-array', currentHoleSpec);
        break;
      case 'circular':
        seeded = createCircularArrayDefaults('wizard-array', currentHoleSpec);
        break;
      case 'rect':
        seeded = createRectArrayDefaults('wizard-array', currentHoleSpec);
        break;
      case 'fromSketch':
        seeded = createFromSketchArrayDefaults('wizard-array', '', currentHoleSpec);
        break;
      case 'manual':
        seeded = createManualArrayDefaults('wizard-array', currentHoleSpec);
        break;
    }
    setArrayDef(seeded);
  }

  // ── Termination tab state. ───────────────────────────────────────────────
  // We hold the termination + params separately from arrayDef so flipping
  // tabs doesn't reseed when the user comes back. The full HoleArrayDefinition
  // delivered to onApply merges these via the `effectiveDef` memo below.
  const [terminationKind, setTerminationKind] = useState<TerminationKind>('through');
  const [blindDepth, setBlindDepth] = useState<number>(10);
  const [blindBottomShape, setBlindBottomShape] = useState<BlindBottomShape>('conical');
  const [drillTipAngle, setDrillTipAngle] = useState<number>(DEFAULT_DRILL_TIP_ANGLE);

  // Derived HoleSpec from current Type + Size selection. Resolves from the
  // catalog row whenever Type / Size / Fit changes. Pure derivation — no extra
  // state to keep in sync.
  const resolvedHoleSpec: HoleSpec = useMemo(() => {
    return resolveHoleSpec(
      WIZARD_TO_HOLEKIND[holeType],
      currentHoleSpec,
      selectedRow as Parameters<typeof resolveHoleSpec>[2],
    );
  }, [holeType, selectedRow, currentHoleSpec]);

  // Build the termination-params bag from the four-piece termination state.
  const terminationParams: TerminationParams = useMemo(() => {
    switch (terminationKind) {
      case 'blind':
        return {
          kind: 'blind',
          depth: blindDepth,
          bottomShape: blindBottomShape,
          drillTipAngle,
        };
      case 'through':
        return { kind: 'through' };
      case 'upToNext':
        return { kind: 'upToNext' };
      case 'upToFace':
        // UI-only path: no face picker yet (worker blocked). We keep faceId
        // empty and rely on the validator to flag UPTOFACE_FACE_MISSING. The
        // Apply button stays disabled until the user picks blind / through /
        // upToNext or a future face-picker fills the id.
        return { kind: 'upToFace', faceId: '' };
    }
  }, [terminationKind, blindDepth, blindBottomShape, drillTipAngle]);

  // The "effective" def merges the current Size + Type + Termination selections
  // back into the position-tab def for validation + preview. arrayDef itself
  // only changes on Position-tab edits.
  const effectiveDef: HoleArrayDefinition = useMemo(() => ({
    ...arrayDef,
    holeSpec: currentHoleSpec,
    holeSpecDetail: resolvedHoleSpec,
    terminationKind,
    terminationParams,
  }), [arrayDef, currentHoleSpec, resolvedHoleSpec, terminationKind, terminationParams]);

  // Live count of resolved positions — drives the "(N positions)" footer.
  const positions = useMemo(() => expandHoleArray(effectiveDef), [effectiveDef]);
  const validation = useMemo(() => validateHoleArray(effectiveDef), [effectiveDef]);

  if (!open) return null;

  // Flag-off rendering: emit a tiny placeholder so the parent's mount logic
  // sees the component is present (helps with test ergonomics) but no real
  // UI appears. Keeps V2 dark until the search-param flag is flipped.
  if (!flagOn) {
    return (
      <div data-testid="hole-wizard-v2-flag-off" style={{ display: 'none' }}>
        {t.flagOff}
      </div>
    );
  }

  const handleApply = () => {
    if (!validation.ok) return;
    // Hand off the effective definition (size + termination + position) — the
    // memoized merge already carries the resolved HoleSpec + TerminationParams.
    onApply(effectiveDef);
    onClose();
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 12px',
    background: active ? 'var(--nx-accent)' : 'var(--nx-border-strong)',
    color: 'var(--nx-panel-2)',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  });

  const tileBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 8px',
    background: active ? '#059669' : 'var(--nx-border-strong)',
    color: 'var(--nx-panel-2)',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    background: 'var(--nx-bg)',
    color: 'var(--nx-panel-2)',
    border: '1px solid #374151',
    borderRadius: 4,
    marginTop: 4,
  };

  const kindLabels: Record<WizardHoleType, string> = {
    drilled: t.kindDrilled,
    counterbore: t.kindCbore,
    countersink: t.kindCsk,
    counterdrill: t.kindCdrill,
    tap: t.kindTap,
    pipeTap: t.kindPipeTap,
  };

  const positionKindLabels: Record<HoleArrayKind, string> = {
    linear: t.positionKindLinear,
    circular: t.positionKindCircular,
    rect: t.positionKindRect,
    fromSketch: t.positionKindFromSketch,
    manual: t.positionKindManual,
  };

  return (
    <div
      data-testid="hole-wizard-v2-root"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--nx-panel)',
          color: 'var(--nx-panel-2)',
          borderRadius: 10,
          padding: 20,
          width: 640,
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid #374151',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            🕳️ {t.wizardTitle}
          </h2>
          <button
            onClick={onClose}
            data-testid="hole-wizard-v2-close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--nx-text-2)',
              fontSize: 20,
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }} role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'type'}
            data-testid="hole-wizard-v2-tab-type"
            onClick={() => setActiveTab('type')}
            style={tabBtnStyle(activeTab === 'type')}
          >
            {t.tabType}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'size'}
            data-testid="hole-wizard-v2-tab-size"
            onClick={() => setActiveTab('size')}
            style={tabBtnStyle(activeTab === 'size')}
          >
            {t.tabSize}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'position'}
            data-testid="hole-wizard-v2-tab-position"
            onClick={() => setActiveTab('position')}
            style={tabBtnStyle(activeTab === 'position')}
          >
            {t.tabPosition}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'termination'}
            data-testid="hole-wizard-v2-tab-termination"
            onClick={() => setActiveTab('termination')}
            style={tabBtnStyle(activeTab === 'termination')}
          >
            {t.tabTermination}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'preview'}
            data-testid="hole-wizard-v2-tab-preview"
            onClick={() => setActiveTab('preview')}
            style={tabBtnStyle(activeTab === 'preview')}
          >
            {t.tabPreview}
          </button>
        </div>

        {/* ── Tab: Type ─────────────────────────────────────────────────── */}
        {activeTab === 'type' && (
          <div data-testid="hole-wizard-v2-panel-type">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {WIZARD_HOLE_TYPES.map((k) => (
                <button
                  key={k}
                  data-testid={`hole-wizard-v2-type-${k}`}
                  onClick={() => {
                    setHoleType(k);
                    // Auto-flip series if the user picks Pipe Tap so the
                    // Size tab opens onto a sensible catalog.
                    const nextSeries = defaultSeriesFor(k);
                    if (nextSeries !== series) {
                      setSeries(nextSeries);
                      setDesignationIndex(0);
                    }
                  }}
                  style={tileBtnStyle(holeType === k)}
                >
                  {kindLabels[k]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Tab: Size ─────────────────────────────────────────────────── */}
        {activeTab === 'size' && (
          <div data-testid="hole-wizard-v2-panel-size">
            {/* Series picker */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
              {(Object.keys(HOLE_STANDARD_SERIES) as HoleStandardSeries[]).map((s) => (
                <button
                  key={s}
                  data-testid={`hole-wizard-v2-series-${s}`}
                  onClick={() => {
                    setSeries(s);
                    setDesignationIndex(0);
                  }}
                  style={{
                    padding: '6px 10px',
                    background: series === s ? 'var(--nx-accent)' : 'var(--nx-border-strong)',
                    color: 'var(--nx-panel-2)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Designation grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginBottom: 10 }}>
              {rows.map((row, i) => (
                <button
                  key={row.name}
                  data-testid={`hole-wizard-v2-designation-${row.name}`}
                  onClick={() => setDesignationIndex(i)}
                  style={tileBtnStyle(i === safeIndex)}
                >
                  {row.name}
                </button>
              ))}
            </div>
            {/* Fit class — only meaningful for clearance kinds */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>
                {t.fitClassLabel}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['close', 'normal', 'loose'] as const).map((f) => (
                  <button
                    key={f}
                    data-testid={`hole-wizard-v2-fit-${f}`}
                    onClick={() => setFitClass(f)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      background: fitClass === f ? '#0ea5e9' : 'var(--nx-border-strong)',
                      color: 'var(--nx-panel-2)',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {f === 'close' ? t.fitClose : f === 'normal' ? t.fitNormal : t.fitLoose}
                  </button>
                ))}
              </div>
            </div>
            {/* Resolved row preview */}
            {selectedRow && (
              <div
                data-testid="hole-wizard-v2-size-preview"
                style={{
                  marginTop: 12,
                  padding: 10,
                  background: 'var(--nx-bg)',
                  border: '1px solid #374151',
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: '#d1d5db',
                }}
              >
                <div>name: <b>{selectedRow.name}</b></div>
                <div>nominal Ø: <b>{selectedRow.nominal} {selectedRow.unit}</b></div>
                <div>tap drill Ø: <b>{selectedRow.tapDrill.toFixed(2)} mm</b></div>
                {selectedRow.pitch !== undefined && (
                  <div>pitch: <b>{selectedRow.pitch} mm</b></div>
                )}
                {selectedRow.tpi !== undefined && (
                  <div>TPI: <b>{selectedRow.tpi}</b></div>
                )}
                {selectedRow.fits && (
                  <div>
                    fits — close {selectedRow.fits.close.toFixed(2)} / normal {selectedRow.fits.normal.toFixed(2)} / loose {selectedRow.fits.loose.toFixed(2)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Position ─────────────────────────────────────────────── */}
        {activeTab === 'position' && (
          <div data-testid="hole-wizard-v2-panel-position">
            {/* Position-kind picker */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 10 }}>
              {POSITION_KINDS.map((pk) => (
                <button
                  key={pk}
                  data-testid={`hole-wizard-v2-position-${pk}`}
                  onClick={() => changePositionKind(pk)}
                  style={tileBtnStyle(positionKind === pk)}
                >
                  {positionKindLabels[pk]}
                </button>
              ))}
            </div>

            {/* Kind-specific parameter inputs. */}
            <PositionKindEditor
              def={arrayDef}
              onChange={setArrayDef}
              labels={t}
              inputStyle={inputStyle}
            />
          </div>
        )}

        {/* ── Tab: Termination ──────────────────────────────────────────── */}
        {activeTab === 'termination' && (
          <div data-testid="hole-wizard-v2-panel-termination">
            {/* Mode picker — 4 tile buttons matching the 4 TerminationKind values. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 12 }}>
              {TERMINATION_KINDS.map((tk) => {
                const label =
                  tk === 'blind' ? t.termBlind
                  : tk === 'through' ? t.termThrough
                  : tk === 'upToNext' ? t.termUpToNext
                  : t.termUpToFace;
                return (
                  <button
                    key={tk}
                    data-testid={`hole-wizard-v2-termination-${tk}`}
                    onClick={() => setTerminationKind(tk)}
                    style={tileBtnStyle(terminationKind === tk)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Blind sub-panel — depth + bottom shape + tip angle. */}
            {terminationKind === 'blind' && (
              <div
                data-testid="hole-wizard-v2-termination-blind-detail"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}
              >
                <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
                  {t.termDepth}
                  <input
                    type="number"
                    data-testid="hole-wizard-v2-termination-depth"
                    min={0}
                    step={0.5}
                    value={blindDepth}
                    onChange={(e) => setBlindDepth(Number(e.target.value))}
                    style={inputStyle}
                  />
                </label>
                <div style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
                  {t.termBottomFlat} / {t.termBottomConical}
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {(['flat', 'conical'] as const).map((shape) => (
                      <button
                        key={shape}
                        data-testid={`hole-wizard-v2-termination-bottom-${shape}`}
                        onClick={() => setBlindBottomShape(shape)}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          background: blindBottomShape === shape ? '#0ea5e9' : 'var(--nx-border-strong)',
                          color: 'var(--nx-panel-2)',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {shape === 'flat' ? t.termBottomFlat : t.termBottomConical}
                      </button>
                    ))}
                  </div>
                </div>
                {blindBottomShape === 'conical' && (
                  <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
                    {t.termDrillTipAngle}
                    <select
                      data-testid="hole-wizard-v2-termination-tipangle"
                      value={drillTipAngle}
                      onChange={(e) => setDrillTipAngle(Number(e.target.value))}
                      style={inputStyle}
                    >
                      <option value={60}>60°</option>
                      <option value={118}>118° (std)</option>
                      <option value={135}>135° (hard)</option>
                    </select>
                  </label>
                )}
              </div>
            )}

            {/* Through — no params, just an explanatory tag. */}
            {terminationKind === 'through' && (
              <div
                data-testid="hole-wizard-v2-termination-through-detail"
                style={{ fontSize: 12, color: 'var(--nx-text-2)', padding: 8 }}
              >
                {t.termThrough}: ⌀{resolvedHoleSpec.diameter} {/* passes entire body */}
              </div>
            )}

            {/* Up-to-next — disabled placeholder until worker face-picker lands. */}
            {terminationKind === 'upToNext' && (
              <div
                data-testid="hole-wizard-v2-termination-upToNext-detail"
                style={{ padding: 8 }}
              >
                <button
                  data-testid="hole-wizard-v2-termination-upToNext-picker"
                  disabled
                  style={{
                    padding: '8px 12px',
                    background: 'var(--nx-border-strong)',
                    color: 'var(--nx-text-2)',
                    border: '1px dashed #4b5563',
                    borderRadius: 6,
                    cursor: 'not-allowed',
                    fontSize: 12,
                    opacity: 0.6,
                  }}
                >
                  {t.termFacePickerPlaceholder}
                </button>
                <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 6 }}>
                  {t.termFacePickerHint}
                </div>
              </div>
            )}

            {/* Up-to-face — disabled placeholder; same shape as upToNext. */}
            {terminationKind === 'upToFace' && (
              <div
                data-testid="hole-wizard-v2-termination-upToFace-detail"
                style={{ padding: 8 }}
              >
                <button
                  data-testid="hole-wizard-v2-termination-upToFace-picker"
                  disabled
                  style={{
                    padding: '8px 12px',
                    background: 'var(--nx-border-strong)',
                    color: 'var(--nx-text-2)',
                    border: '1px dashed #4b5563',
                    borderRadius: 6,
                    cursor: 'not-allowed',
                    fontSize: 12,
                    opacity: 0.6,
                  }}
                >
                  {t.termFacePickerPlaceholder}
                </button>
                <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 6 }}>
                  {t.termFacePickerHint}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Preview ──────────────────────────────────────────────── */}
        {activeTab === 'preview' && (
          <div data-testid="hole-wizard-v2-panel-preview">
            <PreviewPanel
              spec={resolvedHoleSpec}
              term={terminationParams}
              positionCount={positions.length}
              labels={t}
            />
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            gap: 8,
          }}
        >
          <div
            data-testid="hole-wizard-v2-count"
            style={{ fontSize: 12, color: 'var(--nx-text-2)' }}
          >
            {t.nPositions(positions.length)}
            {!validation.ok && (
              <span style={{ color: '#fbbf24', marginLeft: 8 }}>
                ⚠ {validation.errors.length}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              data-testid="hole-wizard-v2-cancel"
              style={{
                padding: '8px 14px',
                background: 'var(--nx-border-strong)',
                color: 'var(--nx-panel-2)',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {t.cancel}
            </button>
            <button
              onClick={handleApply}
              disabled={!validation.ok || !selectedRow}
              data-testid="hole-wizard-v2-apply"
              style={{
                padding: '8px 14px',
                background: validation.ok && selectedRow ? 'var(--nx-accent)' : 'var(--nx-border-strong)',
                color: 'var(--nx-text)',
                border: 'none',
                borderRadius: 6,
                cursor: validation.ok && selectedRow ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
                opacity: validation.ok && selectedRow ? 1 : 0.6,
              }}
            >
              {t.addHoles}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Position-kind editor (kept inline; small enough not to need a file) ───

interface PositionKindEditorProps {
  def: HoleArrayDefinition;
  onChange: (next: HoleArrayDefinition) => void;
  labels: Dict;
  inputStyle: React.CSSProperties;
}

function PositionKindEditor({ def, onChange, labels, inputStyle }: PositionKindEditorProps) {
  // Helper: update the kind-specific data without losing the discriminator.
  function patch<K extends HoleArrayKind>(
    kind: K,
    data: Partial<Extract<HoleArrayDefinition['params'], { kind: K }>['data']>,
  ) {
    if (def.params.kind !== kind) return;
    onChange({
      ...def,
      params: {
        kind,
        // Runtime check above narrows the union; the cast below is the
        // narrowest possible signoff for the spread.
        data: { ...def.params.data, ...data },
      } as HoleArrayDefinition['params'],
    });
  }

  if (def.params.kind === 'linear') {
    const d = def.params.data;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartX}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-startX"
            value={d.startX}
            onChange={(e) => patch('linear', { startX: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartY}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-startY"
            value={d.startY}
            onChange={(e) => patch('linear', { startY: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fDx}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-dx"
            value={d.dx}
            onChange={(e) => patch('linear', { dx: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fDy}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-dy"
            value={d.dy}
            onChange={(e) => patch('linear', { dy: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fCount}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-count"
            min={1}
            step={1}
            value={d.count}
            onChange={(e) => patch('linear', { count: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
      </div>
    );
  }

  if (def.params.kind === 'circular') {
    const d = def.params.data;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fCenterX}
          <input type="number" data-testid="hole-wizard-v2-circular-centerX" value={d.centerX} onChange={(e) => patch('circular', { centerX: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fCenterY}
          <input type="number" data-testid="hole-wizard-v2-circular-centerY" value={d.centerY} onChange={(e) => patch('circular', { centerY: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fRadius}
          <input type="number" data-testid="hole-wizard-v2-circular-radius" value={d.radius} onChange={(e) => patch('circular', { radius: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartAngle}
          <input type="number" data-testid="hole-wizard-v2-circular-startAngle" value={d.startAngle} step={0.1} onChange={(e) => patch('circular', { startAngle: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fCount}
          <input type="number" data-testid="hole-wizard-v2-circular-count" min={1} step={1} value={d.count} onChange={(e) => patch('circular', { count: Number(e.target.value) })} style={inputStyle} />
        </label>
      </div>
    );
  }

  if (def.params.kind === 'rect') {
    const d = def.params.data;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartX}
          <input type="number" data-testid="hole-wizard-v2-rect-startX" value={d.startX} onChange={(e) => patch('rect', { startX: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartY}
          <input type="number" data-testid="hole-wizard-v2-rect-startY" value={d.startY} onChange={(e) => patch('rect', { startY: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStepX}
          <input type="number" data-testid="hole-wizard-v2-rect-stepX" value={d.stepX} onChange={(e) => patch('rect', { stepX: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStepY}
          <input type="number" data-testid="hole-wizard-v2-rect-stepY" value={d.stepY} onChange={(e) => patch('rect', { stepY: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fRows}
          <input type="number" data-testid="hole-wizard-v2-rect-rows" min={1} step={1} value={d.rows} onChange={(e) => patch('rect', { rows: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fCols}
          <input type="number" data-testid="hole-wizard-v2-rect-cols" min={1} step={1} value={d.cols} onChange={(e) => patch('rect', { cols: Number(e.target.value) })} style={inputStyle} />
        </label>
      </div>
    );
  }

  if (def.params.kind === 'fromSketch') {
    const d = def.params.data;
    return (
      <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
        {labels.fSketchId}
        <input
          type="text"
          data-testid="hole-wizard-v2-fromSketch-sketchId"
          value={d.sketchFeatureId}
          onChange={(e) => patch('fromSketch', { sketchFeatureId: e.target.value })}
          style={inputStyle}
          placeholder="sketch-7"
        />
      </label>
    );
  }

  // Manual — render a compact table. Wave 2 W2 ships read-only with a
  // single seed row; the full add/remove + CSV paste UI lands in W4 polish.
  if (def.params.kind === 'manual') {
    const d = def.params.data;
    return (
      <div data-testid="hole-wizard-v2-manual-table" style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {d.points.map((pt, i) => (
          <div key={pt.id ?? i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <span style={{ minWidth: 24, color: 'var(--nx-text-2)' }}>#{i + 1}</span>
            <input
              type="number"
              data-testid={`hole-wizard-v2-manual-x-${i}`}
              value={pt.x}
              onChange={(e) => {
                const next = [...d.points];
                next[i] = { ...next[i], x: Number(e.target.value) };
                patch('manual', { points: next });
              }}
              style={inputStyle}
            />
            <input
              type="number"
              data-testid={`hole-wizard-v2-manual-y-${i}`}
              value={pt.y}
              onChange={(e) => {
                const next = [...d.points];
                next[i] = { ...next[i], y: Number(e.target.value) };
                patch('manual', { points: next });
              }}
              style={inputStyle}
            />
          </div>
        ))}
      </div>
    );
  }

  // Exhaustive fallback — should be unreachable.
  return null;
}

// ─── Preview panel (Tab 5) ─────────────────────────────────────────────────

interface PreviewPanelProps {
  spec: HoleSpec;
  term: TerminationParams;
  positionCount: number;
  labels: Dict;
}

/**
 * Tab 5 — resolved-dimensions summary + 2D SVG cross-section. The SVG itself
 * is built by `computeHoleSectionSvg` (pure function); this component just
 * maps the primitive list onto SVG nodes.
 *
 * The summary block lists Drill ⌀, Counterbore ⌀×depth (if applicable),
 * Countersink ⌀ + angle (if applicable), Termination, and Position count —
 * matching the layout in spec §6.1.5.
 */
function PreviewPanel({ spec, term, positionCount, labels }: PreviewPanelProps) {
  const svg = useMemo(() => computeHoleSectionSvg(spec, term), [spec, term]);

  const summaryRows: Array<{ label: string; value: string }> = [
    { label: labels.prevDiameter, value: `Ø${spec.diameter} mm` },
  ];
  if (spec.kind === 'counterbore' || spec.kind === 'counterdrill') {
    summaryRows.push({
      label: labels.prevHeadDiameter,
      value: `Ø${spec.headDiameter} mm`,
    });
    summaryRows.push({
      label: labels.prevHeadDepth,
      value: `${spec.headDepth} mm`,
    });
  }
  if (spec.kind === 'countersink') {
    summaryRows.push({
      label: labels.prevConeDiameter,
      value: `Ø${spec.coneDiameter} mm`,
    });
    summaryRows.push({
      label: labels.prevConeAngle,
      value: `${spec.coneAngle}°`,
    });
  }
  summaryRows.push({
    label: labels.tabTermination,
    value:
      term.kind === 'blind'
        ? `${labels.termBlind} ${term.depth} mm`
        : term.kind === 'through'
          ? labels.termThrough
          : term.kind === 'upToNext'
            ? labels.termUpToNext
            : labels.termUpToFace,
  });
  summaryRows.push({
    label: labels.prevPositions,
    value: String(positionCount),
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* Summary table */}
      <div data-testid="hole-wizard-v2-preview-summary">
        <div style={{ fontSize: 12, color: 'var(--nx-text-2)', marginBottom: 6 }}>
          {labels.prevHeader}
        </div>
        <div
          style={{
            background: 'var(--nx-bg)',
            border: '1px solid #374151',
            borderRadius: 6,
            padding: 10,
            fontFamily: 'monospace',
            fontSize: 12,
            color: '#d1d5db',
          }}
        >
          {summaryRows.map((row) => (
            <div
              key={row.label}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}
            >
              <span>{row.label}</span>
              <b>{row.value}</b>
            </div>
          ))}
        </div>
      </div>

      {/* SVG cross-section */}
      <div data-testid="hole-wizard-v2-preview-svg-container">
        <svg
          data-testid="hole-wizard-v2-preview-svg"
          width={svg.layout.width}
          height={svg.layout.height}
          viewBox={`0 0 ${svg.layout.width} ${svg.layout.height}`}
          style={{
            background: 'var(--nx-bg)',
            border: '1px solid #374151',
            borderRadius: 6,
          }}
        >
          {svg.elements.map((el, i) => renderSvgEl(el, i))}
        </svg>
      </div>
    </div>
  );
}

/** Map a single primitive onto its SVG node. Pure render helper. */
function renderSvgEl(el: SvgElement, key: number): React.ReactNode {
  if (el.kind === 'line') {
    const isCenterline = el.className === 'centerline';
    const isDim = el.className === 'dim';
    const stroke = isCenterline ? '#6b7280' : isDim ? '#9ca3af' : el.className === 'part-edge' ? '#94a3b8' : '#22d3ee';
    return (
      <line
        key={key}
        x1={el.x1}
        y1={el.y1}
        x2={el.x2}
        y2={el.y2}
        stroke={stroke}
        strokeWidth={isCenterline ? 0.75 : 1.25}
        strokeDasharray={isCenterline ? '3 2' : undefined}
      />
    );
  }
  if (el.kind === 'polyline') {
    const pts = el.points.map((p) => `${p.x},${p.y}`).join(' ');
    return (
      <polyline
        key={key}
        points={pts}
        fill="none"
        stroke="#22d3ee"
        strokeWidth={1.25}
      />
    );
  }
  // label
  return (
    <text
      key={key}
      x={el.x}
      y={el.y}
      textAnchor={el.anchor}
      fontSize={10}
      fill={el.className === 'dim' ? '#cbd5e1' : '#e5e7eb'}
      fontFamily="monospace"
    >
      {el.text}
    </text>
  );
}
