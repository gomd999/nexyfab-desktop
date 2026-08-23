'use client';

/**
 * DimensionAnnotationModal — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone modal for authoring a Dimension or GdtCallout against a
 * specific viewport on a Sheet. The modal does not mutate the sheet
 * itself — it builds an IR object and hands it back via `onAdd` so the
 * caller can splice it into the sheet's `dimensions` / `gdtCallouts`
 * arrays.
 *
 * Layout:
 *   1. Kind selector — radio "dimension" / "gd&t" / "surface" / "weld"
 *   2. If dimension: kind (linear/aligned/radial/diametric/angular) +
 *      refs (N text inputs, N = KIND_REF_COUNT) + tolerance form +
 *      prefix/suffix
 *   3. If GD&T: symbol + target ref + tolerance value + datums (comma list)
 *      + material condition
 *   4. If surface finish (W4-D): ISO 1302 base symbol + target ref + Ra +
 *      production method + lay + all-around
 *   5. If weld (W4-D): AWS/ISO weld type + side + target ref + size/length/
 *      pitch + field/all-around flags + tail note
 *   6. Submit + Cancel
 *
 * Validation: surface/weld IRs run their lib validators before onAdd
 * (validateSurfaceFinish / validateWeldSymbol — every problem surfaced at
 * once); dimension/gd&t keep the light client-side guard with the caller
 * re-validating (validateDimension / validateGdt).
 */

import * as React from 'react';
import type { Sheet } from '@/lib/drawing/sheet';
import type {
  Dimension,
  DimensionKind,
  GdtCallout,
  GdtKind,
  Tolerance,
} from '@/lib/drawing/dimension';
import {
  validateSurfaceFinish,
  type SurfaceFinishSymbol,
  type SurfaceFinishKind,
  type SurfaceLay,
} from '@/lib/drawing/surfaceFinishSymbol';
import {
  validateWeldSymbol,
  type WeldSymbol,
  type WeldType,
  type WeldSide,
} from '@/lib/drawing/weldSymbol';

// ─── props ───────────────────────────────────────────────────────────────

/** Everything this modal can author (W4-D adds surface finish + weld). */
export type DrawingAnnotation = Dimension | GdtCallout | SurfaceFinishSymbol | WeldSymbol;

export interface DimensionAnnotationModalProps {
  lang: string;
  sheet: Sheet;
  /** Which viewport the new annotation will attach to. */
  viewportId: string;
  /** Receiver for the new annotation. */
  onAdd: (annotation: DrawingAnnotation) => void;
  onClose: () => void;
}

// ─── i18n ────────────────────────────────────────────────────────────────

interface ModalDict {
  title: string;
  kindDimension: string;
  kindGdt: string;
  kindSurface: string;
  kindWeld: string;
  sfKindLabel: string;
  sfTargetLabel: string;
  sfRaMaxLabel: string;
  sfMethodLabel: string;
  sfLayLabel: string;
  sfAllAroundLabel: string;
  weldTypeLabel: string;
  weldSideLabel: string;
  weldTargetLabel: string;
  weldSizeLabel: string;
  weldLengthLabel: string;
  weldPitchLabel: string;
  weldFieldLabel: string;
  weldAllAroundLabel: string;
  weldTailLabel: string;
  dimKindLabel: string;
  refsLabel: string;
  refPlaceholder: (i: number) => string;
  prefixLabel: string;
  suffixLabel: string;
  valueOverrideLabel: string;
  toleranceLabel: string;
  toleranceUpper: string;
  toleranceLower: string;
  toleranceMin: string;
  toleranceMax: string;
  toleranceDesignation: string;
  gdtSymbolLabel: string;
  gdtTargetLabel: string;
  gdtToleranceValueLabel: string;
  gdtDatumsLabel: string;
  gdtMaterialConditionLabel: string;
  submit: string;
  cancel: string;
}

const DICT: Record<string, ModalDict> = {
  en: {
    title: 'Add Annotation',
    kindDimension: 'Dimension',
    kindGdt: 'GD&T',
    kindSurface: 'Surface finish',
    kindWeld: 'Weld',
    sfKindLabel: 'Base symbol (ISO 1302)',
    sfTargetLabel: 'Target ref (face/edge id)',
    sfRaMaxLabel: 'Ra max (µm, optional)',
    sfMethodLabel: 'Production method (optional)',
    sfLayLabel: 'Lay',
    sfAllAroundLabel: 'All-around',
    weldTypeLabel: 'Weld type',
    weldSideLabel: 'Side',
    weldTargetLabel: 'Target ref (edge/joint id)',
    weldSizeLabel: 'Size (mm, optional)',
    weldLengthLabel: 'Length (mm, optional)',
    weldPitchLabel: 'Pitch (mm, needs length)',
    weldFieldLabel: 'Field weld',
    weldAllAroundLabel: 'All-around',
    weldTailLabel: 'Tail note (process/spec)',
    dimKindLabel: 'Dimension kind',
    refsLabel: 'Geometry refs',
    refPlaceholder: (i) => `ref ${i + 1} (e.g. f.side.0 / e.vert.1)`,
    prefixLabel: 'Prefix',
    suffixLabel: 'Suffix',
    valueOverrideLabel: 'Value override (optional)',
    toleranceLabel: 'Tolerance',
    toleranceUpper: 'Upper',
    toleranceLower: 'Lower',
    toleranceMin: 'Min',
    toleranceMax: 'Max',
    toleranceDesignation: 'ISO fit (e.g. H7)',
    gdtSymbolLabel: 'GD&T symbol',
    gdtTargetLabel: 'Target ref',
    gdtToleranceValueLabel: 'Tolerance value (mm)',
    gdtDatumsLabel: 'Datums (comma-separated, e.g. A,B)',
    gdtMaterialConditionLabel: 'Material condition',
    submit: 'Add',
    cancel: 'Cancel',
  },
  ko: {
    title: '주석 추가',
    kindDimension: '치수',
    kindGdt: 'GD&T (기하공차)',
    kindSurface: '표면거칠기',
    kindWeld: '용접기호',
    sfKindLabel: '기본 기호 (ISO 1302)',
    sfTargetLabel: '대상 ref (페이스/엣지 id)',
    sfRaMaxLabel: 'Ra 최대 (µm, 선택)',
    sfMethodLabel: '가공 방법 (선택)',
    sfLayLabel: '줄무늬 방향(lay)',
    sfAllAroundLabel: '전체 둘레',
    weldTypeLabel: '용접 종류',
    weldSideLabel: '기준선 측',
    weldTargetLabel: '대상 ref (엣지/조인트 id)',
    weldSizeLabel: '치수 (mm, 선택)',
    weldLengthLabel: '길이 (mm, 선택)',
    weldPitchLabel: '피치 (mm, 길이 필요)',
    weldFieldLabel: '현장 용접',
    weldAllAroundLabel: '전체 둘레',
    weldTailLabel: '꼬리 노트 (공정/규격)',
    dimKindLabel: '치수 종류',
    refsLabel: '형상 참조',
    refPlaceholder: (i) => `참조 ${i + 1} (예: f.side.0 / e.vert.1)`,
    prefixLabel: '접두어',
    suffixLabel: '접미어',
    valueOverrideLabel: '값 수동입력 (선택)',
    toleranceLabel: '공차',
    toleranceUpper: '상한',
    toleranceLower: '하한',
    toleranceMin: '최소',
    toleranceMax: '최대',
    toleranceDesignation: 'ISO 끼워맞춤 (예: H7)',
    gdtSymbolLabel: 'GD&T 기호',
    gdtTargetLabel: '대상 ref',
    gdtToleranceValueLabel: '공차값 (mm)',
    gdtDatumsLabel: '데이텀 (쉼표구분, 예: A,B)',
    gdtMaterialConditionLabel: '재료 조건',
    submit: '추가',
    cancel: '취소',
  },
  ja: {
    title: '注釈を追加', kindDimension: '寸法', kindGdt: '幾何公差', kindSurface: '表面仕上げ', kindWeld: '溶接',
    sfKindLabel: '基本記号 (ISO 1302)', sfTargetLabel: '対象参照（面/エッジID）', sfRaMaxLabel: 'Ra最大（µm、任意）',
    sfMethodLabel: '加工方法（任意）', sfLayLabel: '筋目方向', sfAllAroundLabel: '全周', weldTypeLabel: '溶接種類',
    weldSideLabel: '側', weldTargetLabel: '対象参照（エッジ/継手ID）', weldSizeLabel: 'サイズ（mm、任意）',
    weldLengthLabel: '長さ（mm、任意）', weldPitchLabel: 'ピッチ（mm、長さが必要）', weldFieldLabel: '現場溶接',
    weldAllAroundLabel: '全周', weldTailLabel: 'テール注記（工程/規格）', dimKindLabel: '寸法種類', refsLabel: '形状参照',
    refPlaceholder: (i) => `参照 ${i + 1}（例: f.side.0 / e.vert.1）`, prefixLabel: '接頭辞', suffixLabel: '接尾辞',
    valueOverrideLabel: '値の上書き（任意）', toleranceLabel: '公差', toleranceUpper: '上限', toleranceLower: '下限',
    toleranceMin: '最小', toleranceMax: '最大', toleranceDesignation: 'ISO はめあい（例: H7）', gdtSymbolLabel: '幾何公差記号',
    gdtTargetLabel: '対象参照', gdtToleranceValueLabel: '公差値 (mm)', gdtDatumsLabel: 'データム（カンマ区切り、例: A,B）',
    gdtMaterialConditionLabel: '実体公差方式', submit: '追加', cancel: 'キャンセル',
  },
  zh: {
    title: '添加标注', kindDimension: '尺寸', kindGdt: '几何公差', kindSurface: '表面粗糙度', kindWeld: '焊接',
    sfKindLabel: '基本符号 (ISO 1302)', sfTargetLabel: '目标引用（面/边ID）', sfRaMaxLabel: 'Ra 最大值（µm，可选）',
    sfMethodLabel: '加工方法（可选）', sfLayLabel: '纹理方向', sfAllAroundLabel: '全周', weldTypeLabel: '焊缝类型',
    weldSideLabel: '侧面', weldTargetLabel: '目标引用（边/接头ID）', weldSizeLabel: '尺寸（mm，可选）',
    weldLengthLabel: '长度（mm，可选）', weldPitchLabel: '节距（mm，需要长度）', weldFieldLabel: '现场焊接',
    weldAllAroundLabel: '全周', weldTailLabel: '尾注（工艺/规范）', dimKindLabel: '尺寸类型', refsLabel: '几何引用',
    refPlaceholder: (i) => `引用 ${i + 1}（例如 f.side.0 / e.vert.1）`, prefixLabel: '前缀', suffixLabel: '后缀',
    valueOverrideLabel: '覆盖数值（可选）', toleranceLabel: '公差', toleranceUpper: '上偏差', toleranceLower: '下偏差',
    toleranceMin: '最小', toleranceMax: '最大', toleranceDesignation: 'ISO 配合（例如 H7）', gdtSymbolLabel: '几何公差符号',
    gdtTargetLabel: '目标引用', gdtToleranceValueLabel: '公差值 (mm)', gdtDatumsLabel: '基准（逗号分隔，例如 A,B）',
    gdtMaterialConditionLabel: '实体状态', submit: '添加', cancel: '取消',
  },
  es: {
    title: 'Añadir anotación', kindDimension: 'Cota', kindGdt: 'Tolerancia geométrica', kindSurface: 'Acabado superficial', kindWeld: 'Soldadura',
    sfKindLabel: 'Símbolo base (ISO 1302)', sfTargetLabel: 'Referencia objetivo (ID de cara/arista)', sfRaMaxLabel: 'Ra máximo (µm, opcional)',
    sfMethodLabel: 'Método de producción (opcional)', sfLayLabel: 'Dirección del rayado', sfAllAroundLabel: 'Todo el contorno', weldTypeLabel: 'Tipo de soldadura',
    weldSideLabel: 'Lado', weldTargetLabel: 'Referencia objetivo (ID de arista/unión)', weldSizeLabel: 'Tamaño (mm, opcional)',
    weldLengthLabel: 'Longitud (mm, opcional)', weldPitchLabel: 'Paso (mm, requiere longitud)', weldFieldLabel: 'Soldadura en campo',
    weldAllAroundLabel: 'Todo el contorno', weldTailLabel: 'Nota de cola (proceso/norma)', dimKindLabel: 'Tipo de cota', refsLabel: 'Referencias geométricas',
    refPlaceholder: (i) => `referencia ${i + 1} (p. ej. f.side.0 / e.vert.1)`, prefixLabel: 'Prefijo', suffixLabel: 'Sufijo',
    valueOverrideLabel: 'Valor manual (opcional)', toleranceLabel: 'Tolerancia', toleranceUpper: 'Superior', toleranceLower: 'Inferior',
    toleranceMin: 'Mínimo', toleranceMax: 'Máximo', toleranceDesignation: 'Ajuste ISO (p. ej. H7)', gdtSymbolLabel: 'Símbolo geométrico',
    gdtTargetLabel: 'Referencia objetivo', gdtToleranceValueLabel: 'Valor de tolerancia (mm)', gdtDatumsLabel: 'Referencias datum (separadas por comas, p. ej. A,B)',
    gdtMaterialConditionLabel: 'Condición de material', submit: 'Añadir', cancel: 'Cancelar',
  },
  ar: {
    title: 'إضافة تعليق', kindDimension: 'بُعد', kindGdt: 'تفاوت هندسي', kindSurface: 'تشطيب السطح', kindWeld: 'لحام',
    sfKindLabel: 'الرمز الأساسي (ISO 1302)', sfTargetLabel: 'مرجع الهدف (معرّف وجه/حافة)', sfRaMaxLabel: 'أقصى Ra (µm، اختياري)',
    sfMethodLabel: 'طريقة التصنيع (اختياري)', sfLayLabel: 'اتجاه الأثر', sfAllAroundLabel: 'حول المحيط', weldTypeLabel: 'نوع اللحام',
    weldSideLabel: 'الجانب', weldTargetLabel: 'مرجع الهدف (معرّف حافة/وصلة)', weldSizeLabel: 'الحجم (mm، اختياري)',
    weldLengthLabel: 'الطول (mm، اختياري)', weldPitchLabel: 'الخطوة (mm، تتطلب طولًا)', weldFieldLabel: 'لحام موقعي',
    weldAllAroundLabel: 'حول المحيط', weldTailLabel: 'ملاحظة الذيل (العملية/المواصفة)', dimKindLabel: 'نوع البُعد', refsLabel: 'مراجع الشكل',
    refPlaceholder: (i) => `المرجع ${i + 1} (مثال f.side.0 / e.vert.1)`, prefixLabel: 'بادئة', suffixLabel: 'لاحقة',
    valueOverrideLabel: 'قيمة بديلة (اختياري)', toleranceLabel: 'التفاوت', toleranceUpper: 'العلوي', toleranceLower: 'السفلي',
    toleranceMin: 'الأدنى', toleranceMax: 'الأقصى', toleranceDesignation: 'ملاءمة ISO (مثال H7)', gdtSymbolLabel: 'رمز التفاوت الهندسي',
    gdtTargetLabel: 'مرجع الهدف', gdtToleranceValueLabel: 'قيمة التفاوت (mm)', gdtDatumsLabel: 'المراجع الأساسية (مفصولة بفواصل، مثال A,B)',
    gdtMaterialConditionLabel: 'حالة المادة', submit: 'إضافة', cancel: 'إلغاء',
  },
};

function pickDict(lang: string): ModalDict {
  const key = lang === 'cn' ? 'zh' : lang;
  return DICT[key] ?? DICT.en;
}

// ─── constants ───────────────────────────────────────────────────────────

const DIMENSION_KINDS: ReadonlyArray<DimensionKind> = [
  'linear', 'aligned', 'radial', 'diametric', 'angular',
];

const GDT_KINDS: ReadonlyArray<GdtKind> = [
  'straightness', 'flatness', 'circularity', 'cylindricity',
  'position', 'concentricity', 'runout',
];

const KIND_REF_COUNT: Record<DimensionKind, number> = {
  linear: 2,
  aligned: 2,
  radial: 1,
  diametric: 1,
  angular: 2,
};

type ToleranceKind = Tolerance['kind'];

// ─── component ───────────────────────────────────────────────────────────

export default function DimensionAnnotationModal(
  props: DimensionAnnotationModalProps,
): React.ReactElement {
  const { lang, viewportId, onAdd, onClose } = props;
  const dict = pickDict(lang);

  const [annotationKind, setAnnotationKind] = React.useState<'dimension' | 'gdt' | 'surface' | 'weld'>('dimension');

  // ─── dimension state ─────────────────────────────────────────────────
  const [dimKind, setDimKind] = React.useState<DimensionKind>('linear');
  const refCount = KIND_REF_COUNT[dimKind];
  const [refs, setRefs] = React.useState<string[]>(['', '']);
  React.useEffect(() => {
    setRefs((prev) => {
      const next = [...prev];
      while (next.length < refCount) next.push('');
      while (next.length > refCount) next.pop();
      return next;
    });
  }, [refCount]);
  const [prefix, setPrefix] = React.useState('');
  const [suffix, setSuffix] = React.useState('');
  const [valueOverride, setValueOverride] = React.useState('');
  const [tolKind, setTolKind] = React.useState<ToleranceKind>('none');
  const [tolUpper, setTolUpper] = React.useState('0.1');
  const [tolLower, setTolLower] = React.useState('0.1');
  const [tolMin, setTolMin] = React.useState('9.9');
  const [tolMax, setTolMax] = React.useState('10.1');
  const [tolDesignation, setTolDesignation] = React.useState('H7');

  // ─── gd&t state ──────────────────────────────────────────────────────
  const [gdtKind, setGdtKind] = React.useState<GdtKind>('flatness');
  const [gdtTarget, setGdtTarget] = React.useState('');
  const [gdtToleranceValue, setGdtToleranceValue] = React.useState('0.05');
  const [gdtDatumsStr, setGdtDatumsStr] = React.useState('');
  const [gdtMaterialCondition, setGdtMaterialCondition] = React.useState<'' | 'M' | 'L'>('');

  // ─── surface finish state (W4-D) ─────────────────────────────────────
  const [sfKind, setSfKind] = React.useState<SurfaceFinishKind>('machining_required');
  const [sfTarget, setSfTarget] = React.useState('');
  const [sfRaMax, setSfRaMax] = React.useState('3.2');
  const [sfMethod, setSfMethod] = React.useState('');
  const [sfLay, setSfLay] = React.useState<'' | SurfaceLay>('');
  const [sfAllAround, setSfAllAround] = React.useState(false);

  // ─── weld state (W4-D) ───────────────────────────────────────────────
  const [weldType, setWeldType] = React.useState<WeldType>('fillet');
  const [weldSide, setWeldSide] = React.useState<WeldSide>('arrow');
  const [weldTarget, setWeldTarget] = React.useState('');
  const [weldSize, setWeldSize] = React.useState('6');
  const [weldLength, setWeldLength] = React.useState('');
  const [weldPitch, setWeldPitch] = React.useState('');
  const [weldField, setWeldField] = React.useState(false);
  const [weldAllAround, setWeldAllAround] = React.useState(false);
  const [weldTail, setWeldTail] = React.useState('');

  const [error, setError] = React.useState<string | null>(null);

  // ─── builders ────────────────────────────────────────────────────────

  function buildTolerance(): Tolerance | undefined {
    switch (tolKind) {
      case 'none':
        return undefined;
      case 'bilateral':
        return { kind: 'bilateral', upper: Number(tolUpper), lower: Number(tolLower) };
      case 'unilateral':
        return { kind: 'unilateral', upper: Number(tolUpper), lower: Number(tolLower) };
      case 'limit':
        return { kind: 'limit', min: Number(tolMin), max: Number(tolMax) };
      case 'iso_fit':
        return { kind: 'iso_fit', designation: tolDesignation };
    }
  }

  function buildDimension(): Dimension {
    const id = `dim-${Date.now()}`;
    const tolerance = buildTolerance();
    const base = {
      id,
      viewportId,
      refs: refs.slice(0, refCount),
      tolerance,
      prefix: prefix || undefined,
      suffix: suffix || undefined,
      valueOverride: valueOverride === '' ? undefined : Number(valueOverride),
    };
    return { ...base, kind: dimKind } as Dimension;
  }

  function buildGdt(): GdtCallout {
    const id = `gdt-${Date.now()}`;
    const datums = gdtDatumsStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return {
      id,
      viewportId,
      kind: gdtKind,
      targetRef: gdtTarget,
      toleranceValue: Number(gdtToleranceValue),
      datums: datums.length > 0 ? datums : undefined,
      materialCondition: gdtMaterialCondition || undefined,
    };
  }

  function buildSurface(): SurfaceFinishSymbol {
    const built: SurfaceFinishSymbol = {
      id: `sf-${Date.now()}`,
      viewportId,
      targetRef: sfTarget,
      kind: sfKind,
      raMax: sfRaMax === '' ? undefined : Number(sfRaMax),
      productionMethod: sfMethod || undefined,
      lay: sfLay === '' ? undefined : sfLay,
      allAround: sfAllAround || undefined,
    };
    const v = validateSurfaceFinish(built);
    if (!v.ok) throw new Error(v.errors.join('; '));
    return built;
  }

  function buildWeld(): WeldSymbol {
    const built: WeldSymbol = {
      id: `weld-${Date.now()}`,
      viewportId,
      targetRef: weldTarget,
      weldType,
      side: weldSide,
      size: weldSize === '' ? undefined : Number(weldSize),
      length: weldLength === '' ? undefined : Number(weldLength),
      pitch: weldPitch === '' ? undefined : Number(weldPitch),
      fieldWeld: weldField || undefined,
      allAround: weldAllAround || undefined,
      tail: weldTail || undefined,
    };
    const v = validateWeldSymbol(built);
    if (!v.ok) throw new Error(v.errors.join('; '));
    return built;
  }

  function handleSubmit(): void {
    setError(null);
    try {
      if (annotationKind === 'dimension') {
        const built = buildDimension();
        // Basic client-side guard: refs must all be filled.
        if (built.refs.some((r) => !r)) {
          throw new Error('all refs must be filled');
        }
        onAdd(built);
      } else if (annotationKind === 'gdt') {
        const built = buildGdt();
        if (!built.targetRef) {
          throw new Error('targetRef is required');
        }
        if (!(Number(gdtToleranceValue) > 0)) {
          throw new Error('tolerance value must be positive');
        }
        onAdd(built);
      } else if (annotationKind === 'surface') {
        onAdd(buildSurface());
      } else {
        onAdd(buildWeld());
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ─── render ──────────────────────────────────────────────────────────

  return (
    <div
      data-testid="solver-dim-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 8,
          minWidth: 420,
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
          fontFamily: 'system-ui, sans-serif',
          color: '#111',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{dict.title}</h2>

        {/* Kind selector */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              name="annotation-kind"
              data-testid="solver-dim-kind-dimension"
              checked={annotationKind === 'dimension'}
              onChange={() => setAnnotationKind('dimension')}
            />
            {dict.kindDimension}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              name="annotation-kind"
              data-testid="solver-dim-kind-gdt"
              checked={annotationKind === 'gdt'}
              onChange={() => setAnnotationKind('gdt')}
            />
            {dict.kindGdt}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              name="annotation-kind"
              data-testid="solver-dim-kind-surface"
              checked={annotationKind === 'surface'}
              onChange={() => setAnnotationKind('surface')}
            />
            {dict.kindSurface}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              name="annotation-kind"
              data-testid="solver-dim-kind-weld"
              checked={annotationKind === 'weld'}
              onChange={() => setAnnotationKind('weld')}
            />
            {dict.kindWeld}
          </label>
        </div>

        {annotationKind === 'dimension' ? (
          <div data-testid="solver-dim-dimension-form">
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.dimKindLabel}
              <select
                data-testid="solver-dim-dimkind-select"
                value={dimKind}
                onChange={(e) => setDimKind(e.target.value as DimensionKind)}
                style={{ marginLeft: 8 }}
              >
                {DIMENSION_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>

            <fieldset style={{ marginBottom: 8 }}>
              <legend>{dict.refsLabel}</legend>
              {refs.map((r, i) => (
                <input
                  key={i}
                  data-testid={`solver-dim-ref-${i}-input`}
                  value={r}
                  placeholder={dict.refPlaceholder(i)}
                  onChange={(e) => {
                    const next = [...refs];
                    next[i] = e.target.value;
                    setRefs(next);
                  }}
                  style={{ display: 'block', marginTop: 4, width: '100%' }}
                />
              ))}
            </fieldset>

            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.prefixLabel}
              <input
                data-testid="solver-dim-prefix-input"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.suffixLabel}
              <input
                data-testid="solver-dim-suffix-input"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.valueOverrideLabel}
              <input
                data-testid="solver-dim-value-override-input"
                value={valueOverride}
                onChange={(e) => setValueOverride(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>

            <fieldset style={{ marginBottom: 8 }}>
              <legend>{dict.toleranceLabel}</legend>
              <select
                data-testid="solver-dim-tolerance-kind-select"
                value={tolKind}
                onChange={(e) => setTolKind(e.target.value as ToleranceKind)}
              >
                <option value="none">none</option>
                <option value="bilateral">bilateral</option>
                <option value="unilateral">unilateral</option>
                <option value="limit">limit</option>
                <option value="iso_fit">iso_fit</option>
              </select>
              {(tolKind === 'bilateral' || tolKind === 'unilateral') && (
                <div style={{ marginTop: 4 }}>
                  <label>
                    {dict.toleranceUpper}
                    <input
                      data-testid="solver-dim-tolerance-upper-input"
                      value={tolUpper}
                      onChange={(e) => setTolUpper(e.target.value)}
                      style={{ marginLeft: 4, width: 80 }}
                    />
                  </label>
                  <label style={{ marginLeft: 12 }}>
                    {dict.toleranceLower}
                    <input
                      data-testid="solver-dim-tolerance-lower-input"
                      value={tolLower}
                      onChange={(e) => setTolLower(e.target.value)}
                      style={{ marginLeft: 4, width: 80 }}
                    />
                  </label>
                </div>
              )}
              {tolKind === 'limit' && (
                <div style={{ marginTop: 4 }}>
                  <label>
                    {dict.toleranceMin}
                    <input
                      data-testid="solver-dim-tolerance-min-input"
                      value={tolMin}
                      onChange={(e) => setTolMin(e.target.value)}
                      style={{ marginLeft: 4, width: 80 }}
                    />
                  </label>
                  <label style={{ marginLeft: 12 }}>
                    {dict.toleranceMax}
                    <input
                      data-testid="solver-dim-tolerance-max-input"
                      value={tolMax}
                      onChange={(e) => setTolMax(e.target.value)}
                      style={{ marginLeft: 4, width: 80 }}
                    />
                  </label>
                </div>
              )}
              {tolKind === 'iso_fit' && (
                <div style={{ marginTop: 4 }}>
                  <label>
                    {dict.toleranceDesignation}
                    <input
                      data-testid="solver-dim-tolerance-designation-input"
                      value={tolDesignation}
                      onChange={(e) => setTolDesignation(e.target.value)}
                      style={{ marginLeft: 4 }}
                    />
                  </label>
                </div>
              )}
            </fieldset>
          </div>
        ) : annotationKind === 'gdt' ? (
          <div data-testid="solver-dim-gdt-form">
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtSymbolLabel}
              <select
                data-testid="solver-dim-gdt-kind-select"
                value={gdtKind}
                onChange={(e) => setGdtKind(e.target.value as GdtKind)}
                style={{ marginLeft: 8 }}
              >
                {GDT_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtTargetLabel}
              <input
                data-testid="solver-dim-gdt-target-input"
                value={gdtTarget}
                onChange={(e) => setGdtTarget(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtToleranceValueLabel}
              <input
                data-testid="solver-dim-gdt-tolerance-input"
                value={gdtToleranceValue}
                onChange={(e) => setGdtToleranceValue(e.target.value)}
                style={{ marginLeft: 8, width: 100 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtDatumsLabel}
              <input
                data-testid="solver-dim-gdt-datums-input"
                value={gdtDatumsStr}
                onChange={(e) => setGdtDatumsStr(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtMaterialConditionLabel}
              <select
                data-testid="solver-dim-gdt-mc-select"
                value={gdtMaterialCondition}
                onChange={(e) => setGdtMaterialCondition(e.target.value as '' | 'M' | 'L')}
                style={{ marginLeft: 8 }}
              >
                <option value="">(none / RFS)</option>
                <option value="M">M (max material)</option>
                <option value="L">L (least material)</option>
              </select>
            </label>
          </div>
        ) : annotationKind === 'surface' ? (
          <div data-testid="solver-dim-surface-form">
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.sfKindLabel}
              <select
                data-testid="solver-dim-sf-kind-select"
                value={sfKind}
                onChange={(e) => setSfKind(e.target.value as SurfaceFinishKind)}
                style={{ marginLeft: 8 }}
              >
                <option value="basic">basic</option>
                <option value="machining_required">machining_required</option>
                <option value="machining_prohibited">machining_prohibited</option>
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.sfTargetLabel}
              <input
                data-testid="solver-dim-sf-target-input"
                value={sfTarget}
                onChange={(e) => setSfTarget(e.target.value)}
                placeholder="f.side.0"
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.sfRaMaxLabel}
              <input
                data-testid="solver-dim-sf-ramax-input"
                value={sfRaMax}
                onChange={(e) => setSfRaMax(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.sfMethodLabel}
              <input
                data-testid="solver-dim-sf-method-input"
                value={sfMethod}
                onChange={(e) => setSfMethod(e.target.value)}
                placeholder="milled / ground"
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.sfLayLabel}
              <select
                data-testid="solver-dim-sf-lay-select"
                value={sfLay}
                onChange={(e) => setSfLay(e.target.value as '' | SurfaceLay)}
                style={{ marginLeft: 8 }}
              >
                <option value="">(none)</option>
                <option value="=">=</option>
                <option value="X">X</option>
                <option value="M">M</option>
                <option value="C">C</option>
                <option value="R">R</option>
                <option value="P">P</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <input
                type="checkbox"
                data-testid="solver-dim-sf-allaround-input"
                checked={sfAllAround}
                onChange={(e) => setSfAllAround(e.target.checked)}
              />
              {dict.sfAllAroundLabel}
            </label>
          </div>
        ) : (
          <div data-testid="solver-dim-weld-form">
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.weldTypeLabel}
              <select
                data-testid="solver-dim-weld-type-select"
                value={weldType}
                onChange={(e) => setWeldType(e.target.value as WeldType)}
                style={{ marginLeft: 8 }}
              >
                {(['fillet', 'square', 'bevel', 'vee', 'plug', 'spot'] as const).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.weldSideLabel}
              <select
                data-testid="solver-dim-weld-side-select"
                value={weldSide}
                onChange={(e) => setWeldSide(e.target.value as WeldSide)}
                style={{ marginLeft: 8 }}
              >
                <option value="arrow">arrow</option>
                <option value="other">other</option>
                <option value="both">both</option>
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.weldTargetLabel}
              <input
                data-testid="solver-dim-weld-target-input"
                value={weldTarget}
                onChange={(e) => setWeldTarget(e.target.value)}
                placeholder="e.vert.0"
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.weldSizeLabel}
              <input
                data-testid="solver-dim-weld-size-input"
                value={weldSize}
                onChange={(e) => setWeldSize(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.weldLengthLabel}
              <input
                data-testid="solver-dim-weld-length-input"
                value={weldLength}
                onChange={(e) => setWeldLength(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.weldPitchLabel}
              <input
                data-testid="solver-dim-weld-pitch-input"
                value={weldPitch}
                onChange={(e) => setWeldPitch(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <input
                type="checkbox"
                data-testid="solver-dim-weld-field-input"
                checked={weldField}
                onChange={(e) => setWeldField(e.target.checked)}
              />
              {dict.weldFieldLabel}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <input
                type="checkbox"
                data-testid="solver-dim-weld-allaround-input"
                checked={weldAllAround}
                onChange={(e) => setWeldAllAround(e.target.checked)}
              />
              {dict.weldAllAroundLabel}
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.weldTailLabel}
              <input
                data-testid="solver-dim-weld-tail-input"
                value={weldTail}
                onChange={(e) => setWeldTail(e.target.value)}
                placeholder="GMAW"
                style={{ marginLeft: 8 }}
              />
            </label>
          </div>
        )}

        {error ? (
          <div
            data-testid="solver-dim-error"
            style={{ color: '#b91c1c', marginTop: 8, fontSize: 13 }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            data-testid="solver-dim-cancel"
            onClick={onClose}
            style={{ padding: '6px 12px' }}
          >
            {dict.cancel}
          </button>
          <button
            type="button"
            data-testid="solver-dim-submit"
            onClick={handleSubmit}
            style={{
              padding: '6px 12px',
              background: '#1d4ed8',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {dict.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
