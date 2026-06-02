'use client';

/**
 * AssemblyBrowserModal — Phase 3.A first user-facing assembly UI for
 * NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone modal that lets the user browse the parts and mates that make
 * up an AssemblyState IR and edit them in place:
 *
 *   - Left panel: parts tree. Each row carries an editable name, a fixed
 *     checkbox (toggles the solver's "anchor" flag), and a remove button.
 *     "+ Add part" pushes a new PartInstance with a fresh id at identity
 *     placement (the first part defaults to fixed so the assembly is not
 *     floating).
 *   - Right panel: mates list. Each row exposes the mate kind selector
 *     (all 11 kinds the IR supports — 7 standard + 4 advanced), the two
 *     references (partId + refId text inputs + refKind selector), and a
 *     numeric value field for the kinds that need one
 *     (distance, angle, gear ratio, rack-pinion pinion radius).
 *   - Solve button at the bottom calls the injectable `onSolve`
 *     handler with the current state and renders the returned
 *     iterations / DoF / residuals / success flag.
 *
 * The component owns its AssemblyState; consumers seed it via
 * `initialState`. The state is held as `readonly parts/mates` (as the IR
 * dictates) and mutated through the edit helpers in `assemblyState.ts` so
 * we never sidestep the validation that lives in the IR.
 *
 * All test ids are prefixed `solver-assembly-` per the task convention.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AssemblyState,
  type PartInstance,
  IDENTITY_QUAT,
} from '@/lib/assembly/assemblyState';
import { useAssemblyStorage } from '@/lib/assembly/assemblyPersist';
import type { Mate, MateKind, MateRef, MateRefKind } from '@/lib/assembly/mate';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { SaveError } from '@/lib/cad/featureTreePersist';
import { listPartRefs } from '@/lib/assembly/geometryResolver';
import MateConstraintsToolbar, {
  type ToolbarSelectionRef,
  type ToolbarRefKind,
} from './MateConstraintsToolbar';
import SuggestedMatesPanel from './SuggestedMatesPanel';
import {
  inferMatesFromPlacements,
  type FaceData,
  type AxisData,
} from '@/lib/brep-bridge/stepAssemblyMateInference';
import { derivePartGeometryForAssembly } from './assemblyPartGeometry';

// ─── i18n ────────────────────────────────────────────────────────────────

export type AssemblyBrowserLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  partsHeading: string;
  matesHeading: string;
  addPart: string;
  addMate: string;
  remove: string;
  fixed: string;
  partName: string;
  mateKind: string;
  refA: string;
  refB: string;
  refKind: string;
  partId: string;
  refId: string;
  value: string;
  solve: string;
  solving: string;
  close: string;
  solveResultTitle: string;
  iterations: string;
  dof: string;
  success: string;
  failure: string;
  maxResidual: string;
  perMate: string;
  errorPrefix: string;
  emptyParts: string;
  emptyMates: string;
  /** Toggle button on each part row to open the FeatureTree JSON editor. */
  editFeatureTree: string;
  hideFeatureTree: string;
  /** Placeholder shown inside the empty FeatureTree textarea. */
  featureTreePlaceholder: string;
  /** Error prefix shown beneath the textarea on parse failure. */
  featureTreeParseError: string;
  /** Small badge label that prefixes the phase value ('real' | 'stub'). */
  phaseLabel: string;
  /** Per-part "Select refs" panel toggle. */
  selectRefs: string;
  hideRefs: string;
  /** Heading shown above the per-part ref-button grid. */
  refsAvailable: string;
  /** Banner shown when the user tries to select a 3rd ref while 2 are picked. */
  maxRefs: string;
  /** "Selected: ..." prefix above the mate toolbar. */
  selectedLabel: string;
  /** Empty-selection placeholder. */
  selectedEmpty: string;
  /** Clear-selection button label. */
  clearSelection: string;
  /** Persistence (Phase 4) — shown when a projectId is provided. */
  savedAt: string;
  saveError: string;
  reset: string;
  /** "Infer mates" button label (Phase 5.2.3 mate inference). */
  inferMates: string;
  /** In-flight label shown while the inference is running. */
  inferring: string;
  /** Footer line shown above the panel when results came back non-empty. */
  suggestionsAvailable: string;
  /** Footer line shown above the panel when 0 mates were inferred. */
  noSuggestions: string;
}

const dict: Record<AssemblyBrowserLang, Dict> = {
  ko: {
    modalTitle: '어셈블리 브라우저',
    partsHeading: '부품',
    matesHeading: '메이트',
    addPart: '+ 부품 추가',
    addMate: '+ 메이트 추가',
    remove: '삭제',
    fixed: '고정',
    partName: '부품 이름',
    mateKind: '메이트 종류',
    refA: '참조 A',
    refB: '참조 B',
    refKind: '참조 형식',
    partId: '부품 ID',
    refId: '참조 ID',
    value: '값',
    solve: '풀기',
    solving: '풀이 중...',
    close: '닫기',
    solveResultTitle: '풀이 결과',
    iterations: '반복',
    dof: '자유도',
    success: '성공',
    failure: '실패',
    maxResidual: '최대 잔차',
    perMate: '메이트별 잔차',
    errorPrefix: '오류',
    emptyParts: '아직 부품이 없습니다',
    emptyMates: '아직 메이트가 없습니다',
    editFeatureTree: 'FeatureTree 편집',
    hideFeatureTree: 'FeatureTree 닫기',
    featureTreePlaceholder: '{ "nodes": [] } 형식의 JSON',
    featureTreeParseError: 'JSON 파싱 오류',
    phaseLabel: '단계',
    selectRefs: 'ref 선택',
    hideRefs: 'ref 닫기',
    refsAvailable: '사용 가능 ref',
    maxRefs: '최대 2개',
    selectedLabel: '선택됨',
    selectedEmpty: '(없음)',
    clearSelection: '선택 초기화',
    savedAt: '저장됨',
    saveError: '저장 실패',
    reset: '초기화',
    inferMates: '메이트 추론',
    inferring: '추론 중...',
    suggestionsAvailable: '추천 사용 가능',
    noSuggestions: '추천된 메이트가 없습니다',
  },
  en: {
    modalTitle: 'Assembly Browser',
    partsHeading: 'Parts',
    matesHeading: 'Mates',
    addPart: '+ Add part',
    addMate: '+ Add mate',
    remove: 'Remove',
    fixed: 'Fixed',
    partName: 'Part name',
    mateKind: 'Mate kind',
    refA: 'Ref A',
    refB: 'Ref B',
    refKind: 'Ref kind',
    partId: 'Part id',
    refId: 'Ref id',
    value: 'Value',
    solve: 'Solve',
    solving: 'Solving...',
    close: 'Close',
    solveResultTitle: 'Solve result',
    iterations: 'iters',
    dof: 'DoF',
    success: 'success',
    failure: 'failure',
    maxResidual: 'max residual',
    perMate: 'Per-mate residuals',
    errorPrefix: 'Error',
    emptyParts: 'No parts yet',
    emptyMates: 'No mates yet',
    editFeatureTree: 'Edit FeatureTree',
    hideFeatureTree: 'Hide FeatureTree',
    featureTreePlaceholder: 'JSON of shape { "nodes": [] }',
    featureTreeParseError: 'JSON parse error',
    phaseLabel: 'Phase',
    selectRefs: 'Select refs',
    hideRefs: 'Hide refs',
    refsAvailable: 'Available refs',
    maxRefs: 'Max 2 refs',
    selectedLabel: 'Selected',
    selectedEmpty: '(none)',
    clearSelection: 'Clear selection',
    savedAt: 'Saved',
    saveError: 'Save failed',
    reset: 'Reset',
    inferMates: 'Infer mates',
    inferring: 'Inferring...',
    suggestionsAvailable: 'Suggestions available',
    noSuggestions: 'No mate suggestions found',
  },
  ja: {
    modalTitle: 'アセンブリブラウザ',
    partsHeading: 'パーツ',
    matesHeading: 'メイト',
    addPart: '+ パーツ追加',
    addMate: '+ メイト追加',
    remove: '削除',
    fixed: '固定',
    partName: 'パーツ名',
    mateKind: 'メイト種類',
    refA: '参照 A',
    refB: '参照 B',
    refKind: '参照種類',
    partId: 'パーツID',
    refId: '参照ID',
    value: '値',
    solve: '解く',
    solving: '計算中...',
    close: '閉じる',
    solveResultTitle: '計算結果',
    iterations: '反復',
    dof: '自由度',
    success: '成功',
    failure: '失敗',
    maxResidual: '最大残差',
    perMate: 'メイト別残差',
    errorPrefix: 'エラー',
    emptyParts: 'パーツがまだありません',
    emptyMates: 'メイトがまだありません',
    editFeatureTree: 'FeatureTree 編集',
    hideFeatureTree: 'FeatureTree 閉じる',
    featureTreePlaceholder: '{ "nodes": [] } 形式の JSON',
    featureTreeParseError: 'JSON 解析エラー',
    phaseLabel: 'フェーズ',
    selectRefs: '参照を選択',
    hideRefs: '参照を閉じる',
    refsAvailable: '利用可能な参照',
    maxRefs: '最大2件',
    selectedLabel: '選択中',
    selectedEmpty: '(なし)',
    clearSelection: '選択解除',
    savedAt: '保存済み',
    saveError: '保存失敗',
    reset: 'リセット',
    inferMates: '合致を推論',
    inferring: '推論中...',
    suggestionsAvailable: '推奨が利用可能',
    noSuggestions: '推奨される合致はありません',
  },
  zh: {
    modalTitle: '装配浏览器',
    partsHeading: '零件',
    matesHeading: '配合',
    addPart: '+ 添加零件',
    addMate: '+ 添加配合',
    remove: '删除',
    fixed: '固定',
    partName: '零件名称',
    mateKind: '配合类型',
    refA: '参考 A',
    refB: '参考 B',
    refKind: '参考类型',
    partId: '零件ID',
    refId: '参考ID',
    value: '值',
    solve: '求解',
    solving: '求解中...',
    close: '关闭',
    solveResultTitle: '求解结果',
    iterations: '迭代',
    dof: '自由度',
    success: '成功',
    failure: '失败',
    maxResidual: '最大残差',
    perMate: '每个配合残差',
    errorPrefix: '错误',
    emptyParts: '尚无零件',
    emptyMates: '尚无配合',
    editFeatureTree: '编辑 FeatureTree',
    hideFeatureTree: '关闭 FeatureTree',
    featureTreePlaceholder: '形如 { "nodes": [] } 的 JSON',
    featureTreeParseError: 'JSON 解析错误',
    phaseLabel: '阶段',
    selectRefs: '选择参考',
    hideRefs: '关闭参考',
    refsAvailable: '可用参考',
    maxRefs: '最多2个',
    selectedLabel: '已选择',
    selectedEmpty: '(无)',
    clearSelection: '清除选择',
    savedAt: '已保存',
    saveError: '保存失败',
    reset: '重置',
    inferMates: '推断配合',
    inferring: '推断中...',
    suggestionsAvailable: '建议可用',
    noSuggestions: '未找到配合建议',
  },
  es: {
    modalTitle: 'Navegador de Ensamblaje',
    partsHeading: 'Piezas',
    matesHeading: 'Restricciones',
    addPart: '+ Añadir pieza',
    addMate: '+ Añadir restricción',
    remove: 'Eliminar',
    fixed: 'Fija',
    partName: 'Nombre de pieza',
    mateKind: 'Tipo de restricción',
    refA: 'Ref A',
    refB: 'Ref B',
    refKind: 'Tipo de ref',
    partId: 'ID de pieza',
    refId: 'ID de ref',
    value: 'Valor',
    solve: 'Resolver',
    solving: 'Resolviendo...',
    close: 'Cerrar',
    solveResultTitle: 'Resultado',
    iterations: 'iters',
    dof: 'GdL',
    success: 'éxito',
    failure: 'fallo',
    maxResidual: 'residuo máx.',
    perMate: 'Residuos por restricción',
    errorPrefix: 'Error',
    emptyParts: 'Sin piezas todavía',
    emptyMates: 'Sin restricciones todavía',
    editFeatureTree: 'Editar FeatureTree',
    hideFeatureTree: 'Ocultar FeatureTree',
    featureTreePlaceholder: 'JSON de forma { "nodes": [] }',
    featureTreeParseError: 'Error de análisis JSON',
    phaseLabel: 'Fase',
    selectRefs: 'Seleccionar refs',
    hideRefs: 'Ocultar refs',
    refsAvailable: 'Refs disponibles',
    maxRefs: 'Máx. 2 refs',
    selectedLabel: 'Seleccionado',
    selectedEmpty: '(ninguno)',
    clearSelection: 'Limpiar selección',
    savedAt: 'Guardado',
    saveError: 'Error al guardar',
    reset: 'Restablecer',
    inferMates: 'Inferir restricciones',
    inferring: 'Infiriendo...',
    suggestionsAvailable: 'Sugerencias disponibles',
    noSuggestions: 'No se encontraron sugerencias',
  },
  ar: {
    modalTitle: 'متصفح التجميع',
    partsHeading: 'الأجزاء',
    matesHeading: 'القيود',
    addPart: '+ إضافة جزء',
    addMate: '+ إضافة قيد',
    remove: 'حذف',
    fixed: 'ثابت',
    partName: 'اسم الجزء',
    mateKind: 'نوع القيد',
    refA: 'مرجع A',
    refB: 'مرجع B',
    refKind: 'نوع المرجع',
    partId: 'مُعرّف الجزء',
    refId: 'مُعرّف المرجع',
    value: 'القيمة',
    solve: 'حل',
    solving: 'يحل...',
    close: 'إغلاق',
    solveResultTitle: 'نتيجة الحل',
    iterations: 'تكرارات',
    dof: 'درجات الحرية',
    success: 'نجاح',
    failure: 'فشل',
    maxResidual: 'أقصى متبقي',
    perMate: 'متبقي لكل قيد',
    errorPrefix: 'خطأ',
    emptyParts: 'لا توجد أجزاء بعد',
    emptyMates: 'لا توجد قيود بعد',
    editFeatureTree: 'تحرير FeatureTree',
    hideFeatureTree: 'إخفاء FeatureTree',
    featureTreePlaceholder: 'JSON بالشكل { "nodes": [] }',
    featureTreeParseError: 'خطأ في تحليل JSON',
    phaseLabel: 'المرحلة',
    selectRefs: 'اختيار المراجع',
    hideRefs: 'إخفاء المراجع',
    refsAvailable: 'المراجع المتاحة',
    maxRefs: 'الحد الأقصى 2',
    selectedLabel: 'المحدد',
    selectedEmpty: '(لا شيء)',
    clearSelection: 'مسح التحديد',
    savedAt: 'تم الحفظ',
    saveError: 'فشل الحفظ',
    reset: 'إعادة تعيين',
    inferMates: 'استنتاج القيود',
    inferring: 'يستنتج...',
    suggestionsAvailable: 'الاقتراحات متاحة',
    noSuggestions: 'لا توجد قيود مقترحة',
  },
};

// ─── solve result shape used by the modal UI ─────────────────────────────

/**
 * Shape of the data this modal renders after a solve. Mirrors
 * IterativeSolveResult so consumers (and the api/assembly-solve route)
 * can pass the solver's output through unchanged. We keep the type loose
 * (no AssemblyState requirement) so the Phase-1 API stub can satisfy it.
 */
export interface AssemblyBrowserSolveResult {
  success: boolean;
  iterations?: number;
  finalMaxResidual?: number;
  /** Approximate DoF — supplied by the caller (Phase-1 route returns 0). */
  dof?: number;
  residuals: ReadonlyArray<{
    mateId: string;
    residual: number;
    supported: boolean;
  }>;
  /**
   * Phase 4 marker mirrored from /api/assembly-solve. 'real' means the
   * iterativeSolve ran against featureTreeGeometryResolver; 'stub' means
   * deterministic zero-residual response (Phase 1 backward-compat).
   * Optional so older callers (and the empty-featureTrees default path)
   * still type-check.
   */
  phase?: 'real' | 'stub';
}

/**
 * onSolve receives the current AssemblyState plus the per-part FeatureTree
 * map. The map may be empty (no part has a tree yet) — callers decide
 * whether to send `featureTrees` over the wire or omit it for the stub
 * path. Two args (instead of one bag) keep the signature ergonomic for
 * tests that only care about state.
 */
export type AssemblyBrowserOnSolve = (
  state: AssemblyState,
  featureTrees: Record<string, FeatureTree>,
) => Promise<AssemblyBrowserSolveResult>;

export interface AssemblyBrowserModalProps {
  lang: AssemblyBrowserLang;
  initialState?: AssemblyState;
  /**
   * Optional pre-seeded per-part FeatureTrees. Keys are PartInstance.id,
   * values are the FeatureTree IR the geometry resolver consumes. Parts
   * without an entry contribute no geometry (solver falls back to its
   * stub behaviour for that part's refs).
   */
  initialFeatureTrees?: Record<string, FeatureTree>;
  onClose: () => void;
  /** Optional solve handler. When absent the Solve button is disabled. */
  onSolve?: AssemblyBrowserOnSolve;
  /**
   * Optional project identifier (Phase 4). When provided, the modal swaps
   * its in-memory state for `useAssemblyStorage('nexyfab:assembly:${projectId}')`
   * (parts + mates persisted) AND per-part FeatureTrees persisted under
   * `nexyfab:tree:${projectId}` as a single combined record. When absent
   * the modal behaves exactly as before (100 % back-compat for the
   * existing 50 in-memory tests).
   */
  projectId?: string;
  /**
   * Optional injectable mate-inference callback (Phase 5.2.3). When
   * provided, the "Infer mates" button calls this in place of the default
   * `inferMatesFromPlacements + derivePartGeometryForAssembly` pipeline.
   * Wrappers wiring real OCCT-derived geometry pass this; the default
   * Phase 1 path is featureTree-AABB inside the modal.
   *
   * Sync return matches the Phase 1 spec ("inference is sync"); wrappers
   * doing async OCCT work should resolve to a snapshot before calling.
   */
  onInferMates?: (
    state: AssemblyState,
    partFaces: Record<string, FaceData[]>,
    partAxes: Record<string, AxisData[]>,
  ) => Mate[];
}

/** Persistence key prefixes — kept stable across modal + wrapper. */
const ASSEMBLY_STORAGE_PREFIX = 'nexyfab:assembly:';
const ASSEMBLY_TREES_STORAGE_PREFIX = 'nexyfab:assembly-trees:';

// ─── small immutable helpers ─────────────────────────────────────────────

const ALL_MATE_KINDS: ReadonlyArray<MateKind> = [
  'coincident',
  'concentric',
  'distance',
  'angle',
  'parallel',
  'perpendicular',
  'tangent',
  'hinge',
  'slot',
  'gear',
  'rack_pinion',
];

const ALL_REF_KINDS: ReadonlyArray<MateRefKind> = [
  'face',
  'edge',
  'axis',
  'plane',
  'point',
];

/**
 * Whether the given mate kind carries a numeric value field that the user
 * should be able to edit. Lets the UI render the value input conditionally.
 */
function mateKindNeedsValue(kind: MateKind): { needed: boolean; label: string } {
  switch (kind) {
    case 'distance':
      return { needed: true, label: 'mm' };
    case 'angle':
      return { needed: true, label: 'deg' };
    case 'gear':
      return { needed: true, label: 'ratio' };
    case 'rack_pinion':
      return { needed: true, label: 'pinionR (mm)' };
    default:
      return { needed: false, label: '' };
  }
}

/** Build the right "value" key + default for the given mate kind. */
function newMateOfKind(id: string, kind: MateKind, a: MateRef, b: MateRef): Mate {
  switch (kind) {
    case 'distance':
      return { id, kind: 'distance', a, b, value: 10 };
    case 'angle':
      return { id, kind: 'angle', a, b, value: 90 };
    case 'gear':
      return { id, kind: 'gear', a, b, ratio: 1 };
    case 'rack_pinion':
      return { id, kind: 'rack_pinion', a, b, pinionRadius: 1 };
    case 'hinge':
      return { id, kind: 'hinge', a, b };
    case 'slot':
      return { id, kind: 'slot', a, b };
    case 'coincident':
    case 'concentric':
    case 'parallel':
    case 'perpendicular':
    case 'tangent':
      return { id, kind, a, b };
  }
}

/** Read the numeric value off a mate that has one, else undefined. */
function getMateValue(m: Mate): number | undefined {
  if (m.kind === 'distance' || m.kind === 'angle') return m.value;
  if (m.kind === 'gear') return m.ratio;
  if (m.kind === 'rack_pinion') return m.pinionRadius;
  return undefined;
}

/** Return a new mate with the numeric value replaced (no-op for valueless kinds). */
function setMateValue(m: Mate, v: number): Mate {
  if (m.kind === 'distance') return { ...m, value: v };
  if (m.kind === 'angle') return { ...m, value: v };
  if (m.kind === 'gear') return { ...m, ratio: v };
  if (m.kind === 'rack_pinion') return { ...m, pinionRadius: v };
  return m;
}

// ─── ref-selection helpers (mate-toolbar bridge) ─────────────────────────

/**
 * The 7 canonical refs every part exposes, regardless of FeatureTree, mirrored
 * 1-to-1 from `buildPartRefRegistry`'s always-present block. We render these
 * inline as clickable buttons so the user can build a mate selection without
 * needing a FeatureTree at all (Phase 1 baseline).
 */
const CANONICAL_REFS: ReadonlyArray<{ refId: string; refKind: ToolbarRefKind }> = [
  { refId: 'origin', refKind: 'point' },
  { refId: 'x_axis', refKind: 'axis' },
  { refId: 'y_axis', refKind: 'axis' },
  { refId: 'z_axis', refKind: 'axis' },
  { refId: 'xy_plane', refKind: 'plane' },
  { refId: 'yz_plane', refKind: 'plane' },
  { refId: 'xz_plane', refKind: 'plane' },
];
const CANONICAL_REF_IDS: ReadonlySet<string> = new Set(CANONICAL_REFS.map((r) => r.refId));

/**
 * Infer the {@link ToolbarRefKind} for a refId produced by `listPartRefs`
 * (geometryResolver). We use the well-defined naming scheme:
 *   - any id containing `axis`              → axis  (extrude_axis, hole_axis_N, …)
 *   - any id containing `plane`             → plane (sketch_plane, sketch_plane_N, …)
 *   - `origin` / any id with `_top_`        → point (hole_top_N)
 *
 * Returns `null` for ids we don't know how to map (so the UI silently skips
 * them rather than passing an invalid refKind into the mate toolbar).
 */
function inferRefKindFromId(refId: string): ToolbarRefKind | null {
  if (refId === 'origin') return 'point';
  if (refId.includes('axis')) return 'axis';
  if (refId.includes('plane')) return 'plane';
  if (refId.includes('_top_')) return 'point';
  return null;
}

/**
 * Selection cap. Two refs is the universal mate-toolbar precondition (cf.
 * MATE_DEFS in MateConstraintsToolbar). We chose **FIFO oldest-evict** over
 * **reject 3rd** so the user can fluidly re-aim selection without manually
 * clicking the first ref again — matching SolidWorks / Onshape behaviour.
 */
const MAX_SELECTION = 2;

/**
 * Update a selection array in response to a ref-button click. Toggling an
 * already-selected ref removes it; clicking a fresh ref appends it (and
 * evicts the oldest entry when the cap is exceeded). The (partId, refId)
 * tuple is the identity key — a different part with the same refId (e.g.,
 * both parts have `x_axis`) counts as a distinct selection slot.
 */
function toggleSelection(
  current: ReadonlyArray<ToolbarSelectionRef>,
  next: ToolbarSelectionRef,
): ReadonlyArray<ToolbarSelectionRef> {
  const existingIdx = current.findIndex(
    (s) => s.partId === next.partId && s.refId === next.refId,
  );
  if (existingIdx >= 0) {
    // toggle off
    return current.filter((_, i) => i !== existingIdx);
  }
  const appended = [...current, next];
  if (appended.length <= MAX_SELECTION) return appended;
  // evict oldest — FIFO
  return appended.slice(appended.length - MAX_SELECTION);
}

// ─── per-part FeatureTree record persistence ─────────────────────────────

/**
 * Tiny purpose-built hook for the assembly modal — persists a
 * `Record<string, FeatureTree>` (per-part trees) under one localStorage
 * key with a 500 ms debounced write. Mirrors the contract of
 * `useFeatureTreeStorage` but for a record, since the existing hook is
 * per-single-tree.
 *
 * Returns a tuple of `[record, setRecord, jsonText]` so the assembly
 * modal can hydrate per-part textarea bodies from the stored snapshot on
 * mount without re-stringifying every part on each render.
 *
 * When `key` is empty (no projectId), behaves as a plain useState; no
 * localStorage I/O happens. This is the 100 %-back-compat hatch.
 */
const TREES_AUTOSAVE_DEBOUNCE_MS = 500;
function usePersistedTreeRecord(
  key: string,
  initial: Record<string, FeatureTree>,
  onError: (e: SaveError, message: string) => void,
): [
  Record<string, FeatureTree>,
  (next: Record<string, FeatureTree>) => void,
  Record<string, string>,
] {
  const [state, setStateInternal] = useState<{
    record: Record<string, FeatureTree>;
    text: Record<string, string>;
  }>(() => {
    if (!key) return { record: initial, text: stringifyRecord(initial) };
    if (typeof window === 'undefined' || !window.localStorage) {
      return { record: initial, text: stringifyRecord(initial) };
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return { record: initial, text: stringifyRecord(initial) };
      const parsed = JSON.parse(raw) as { record?: Record<string, FeatureTree> };
      if (parsed && parsed.record && typeof parsed.record === 'object') {
        return { record: parsed.record, text: stringifyRecord(parsed.record) };
      }
    } catch {
      // fall through to initial
    }
    return { record: initial, text: stringifyRecord(initial) };
  });

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setRecord = useCallback(
    (next: Record<string, FeatureTree>) => {
      setStateInternal({ record: next, text: stringifyRecord(next) });
      if (!key) return;
      if (typeof window === 'undefined' || !window.localStorage) return;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        try {
          window.localStorage.setItem(key, JSON.stringify({ record: next }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            (err instanceof Error && err.name === 'QuotaExceededError') ||
            (err && typeof err === 'object' && (err as { code?: number }).code === 22)
          ) {
            onErrorRef.current('quota_exceeded', msg);
          } else {
            onErrorRef.current('unknown', msg);
          }
        }
      }, TREES_AUTOSAVE_DEBOUNCE_MS);
    },
    [key],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return [state.record, setRecord, state.text];
}

function stringifyRecord(rec: Record<string, FeatureTree>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = JSON.stringify(v, null, 2);
  }
  return out;
}

// ─── component ───────────────────────────────────────────────────────────

const EMPTY_STATE: AssemblyState = { parts: [], mates: [] };

export default function AssemblyBrowserModal({
  lang,
  initialState,
  initialFeatureTrees,
  onClose,
  onSolve,
  projectId,
  onInferMates,
}: AssemblyBrowserModalProps): React.ReactElement {
  const t = dict[lang];

  // Persistence (Phase 4): when projectId is supplied we route assembly
  // state through `useAssemblyStorage` (autosave to
  // `nexyfab:assembly:${projectId}`) and per-part FeatureTrees through the
  // simpler local-storage hook below. When absent both branches fall back
  // to plain `useState`, preserving the existing 50 in-memory tests.
  const assemblyKey = projectId !== undefined ? `${ASSEMBLY_STORAGE_PREFIX}${projectId}` : '';
  const treesKey =
    projectId !== undefined ? `${ASSEMBLY_TREES_STORAGE_PREFIX}${projectId}` : '';

  // Always-call both hooks — rules-of-hooks demands a stable call shape.
  const [persistedState, setPersistedState] = useAssemblyStorage(
    assemblyKey,
    initialState ?? EMPTY_STATE,
  );
  const [memoryState, setMemoryState] = useState<AssemblyState>(initialState ?? EMPTY_STATE);

  const state = projectId !== undefined ? persistedState : memoryState;
  // Uniform `setState(prev => next)` adapter — `useAssemblyStorage`'s
  // setter only takes a value, so we resolve the updater against the
  // current `state` ourselves when in persisted mode.
  const setState = useCallback(
    (next: AssemblyState | ((prev: AssemblyState) => AssemblyState)) => {
      if (projectId !== undefined) {
        const resolved =
          typeof next === 'function'
            ? (next as (p: AssemblyState) => AssemblyState)(persistedState)
            : next;
        setPersistedState(resolved);
      } else {
        setMemoryState(next);
      }
    },
    [projectId, persistedState, setPersistedState],
  );

  // Persistence toast for the trees-storage branch.
  const [treesPersistError, setTreesPersistError] = useState<{
    error: SaveError;
    message: string;
  } | null>(null);
  const onTreesPersistError = useCallback((error: SaveError, message: string) => {
    setTreesPersistError({ error, message });
  }, []);
  const [persistedTrees, setPersistedTrees, persistedTreesText] = usePersistedTreeRecord(
    treesKey,
    initialFeatureTrees ?? {},
    onTreesPersistError,
  );

  /**
   * Per-part FeatureTrees, controlled. Only parts whose JSON parsed
   * successfully (and was non-empty) appear here; opening the editor
   * for a fresh part does NOT add an entry until the user types valid
   * JSON. This way an empty string clears any prior entry.
   */
  const [memoryFeatureTrees, setMemoryFeatureTrees] = useState<Record<string, FeatureTree>>(
    initialFeatureTrees ?? {},
  );
  const featureTrees = projectId !== undefined ? persistedTrees : memoryFeatureTrees;
  const setFeatureTrees = useCallback(
    (
      next:
        | Record<string, FeatureTree>
        | ((prev: Record<string, FeatureTree>) => Record<string, FeatureTree>),
    ) => {
      if (projectId !== undefined) {
        const resolved =
          typeof next === 'function'
            ? (next as (p: Record<string, FeatureTree>) => Record<string, FeatureTree>)(
                persistedTrees,
              )
            : next;
        setPersistedTrees(resolved);
      } else {
        setMemoryFeatureTrees(next);
      }
    },
    [projectId, persistedTrees, setPersistedTrees],
  );
  /**
   * Per-part "raw" textarea contents — the controlled value of each
   * textarea. Decoupled from `featureTrees` so the user can transiently
   * hold invalid JSON in the textarea while we report the parse error
   * and disable Solve. Seeded by JSON-stringifying `initialFeatureTrees`
   * lazily on first edit. In persisted mode we seed from the hydrated
   * record's stringified snapshot so a reload picks up the previously
   * saved textarea bodies verbatim.
   */
  const [featureTreeText, setFeatureTreeText] = useState<Record<string, string>>(
    () => {
      if (projectId !== undefined) return persistedTreesText;
      const seed: Record<string, string> = {};
      for (const [pid, tree] of Object.entries(initialFeatureTrees ?? {})) {
        seed[pid] = JSON.stringify(tree, null, 2);
      }
      return seed;
    },
  );
  /** Per-part textarea-open flag (drives the inline editor visibility). */
  const [featureTreeOpen, setFeatureTreeOpen] = useState<Record<string, boolean>>({});
  /** Per-part parse error message (truthy iff the textarea body failed JSON.parse / shape check). */
  const [featureTreeError, setFeatureTreeError] = useState<Record<string, string>>({});
  /** Per-part "refs panel" expand flag — drives the canonical-ref grid visibility. */
  const [refsPanelOpen, setRefsPanelOpen] = useState<Record<string, boolean>>({});
  /**
   * Current mate-toolbar selection — at most {@link MAX_SELECTION} refs at
   * a time. Newest entries are at the END; FIFO eviction keeps the most
   * recent two when the user clicks a 3rd ref (see `toggleSelection`).
   */
  const [selection, setSelection] = useState<ReadonlyArray<ToolbarSelectionRef>>([]);
  const [solveState, setSolveState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ok'; result: AssemblyBrowserSolveResult }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  // ── parts ops ──────────────────────────────────────────────────────────

  const addPartLocal = useCallback(() => {
    setState((prev) => {
      const idx = prev.parts.length + 1;
      const id = `part_${idx}`;
      const part: PartInstance = {
        id,
        name: `Part ${idx}`,
        partTemplateId: id,
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
        // First part is fixed so the IR-level invariant (>=1 fixed part)
        // is satisfied as soon as the user picks Solve.
        fixed: prev.parts.length === 0,
      };
      return { ...prev, parts: [...prev.parts, part] };
    });
  }, []);

  const removePartLocal = useCallback((partId: string) => {
    setState((prev) => ({
      ...prev,
      parts: prev.parts.filter((p) => p.id !== partId),
      // Drop any mates that reference the removed part so the user isn't
      // left with dangling refs they have to clean up manually.
      mates: prev.mates.filter(
        (m) => m.a.partId !== partId && m.b.partId !== partId,
      ),
    }));
    // Also drop any associated FeatureTree / editor state for the removed
    // part so a future re-add of the same id starts fresh.
    setFeatureTrees((prev) => {
      if (!(partId in prev)) return prev;
      const { [partId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    setFeatureTreeText((prev) => {
      if (!(partId in prev)) return prev;
      const { [partId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    setFeatureTreeOpen((prev) => {
      if (!(partId in prev)) return prev;
      const { [partId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    setFeatureTreeError((prev) => {
      if (!(partId in prev)) return prev;
      const { [partId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    setRefsPanelOpen((prev) => {
      if (!(partId in prev)) return prev;
      const { [partId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    // Drop any selection entries pointing at the removed part so the mate
    // toolbar doesn't end up holding refs to a part that no longer exists.
    setSelection((prev) => prev.filter((s) => s.partId !== partId));
  }, []);

  const renamePart = useCallback((partId: string, name: string) => {
    setState((prev) => ({
      ...prev,
      parts: prev.parts.map((p) => (p.id === partId ? { ...p, name } : p)),
    }));
  }, []);

  const toggleFixed = useCallback((partId: string, fixed: boolean) => {
    setState((prev) => ({
      ...prev,
      parts: prev.parts.map((p) => (p.id === partId ? { ...p, fixed } : p)),
    }));
  }, []);

  // ── featureTree ops ────────────────────────────────────────────────────

  const toggleFeatureTreeEditor = useCallback((partId: string) => {
    setFeatureTreeOpen((prev) => ({ ...prev, [partId]: !prev[partId] }));
  }, []);

  /**
   * Validate one textarea body against the FeatureTree shape:
   *   - empty / whitespace → clear the tree (returns ok=true, tree=undefined)
   *   - JSON.parse failure → returns ok=false, error message
   *   - parsed but not `{ nodes: [...] }` → ok=false, error message
   *   - parsed ok                          → ok=true, tree=parsed
   *
   * Kept intentionally shallow: full per-node `validateTree` semantics
   * are enforced server-side by the API route, and re-validating them
   * client-side would duplicate the IR walk for no UX gain.
   */
  function parseFeatureTreeBody(
    text: string,
  ): { ok: true; tree: FeatureTree | undefined } | { ok: false; error: string } {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { ok: true, tree: undefined };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'expected an object with a "nodes" array' };
    }
    const obj = parsed as { nodes?: unknown };
    if (!Array.isArray(obj.nodes)) {
      return { ok: false, error: 'expected "nodes" to be an array' };
    }
    return { ok: true, tree: parsed as FeatureTree };
  }

  const updateFeatureTreeText = useCallback((partId: string, text: string) => {
    setFeatureTreeText((prev) => ({ ...prev, [partId]: text }));
    const result = parseFeatureTreeBody(text);
    if (result.ok) {
      setFeatureTreeError((prev) => {
        if (!(partId in prev)) return prev;
        const { [partId]: _drop, ...rest } = prev;
        void _drop;
        return rest;
      });
      setFeatureTrees((prev) => {
        if (result.tree === undefined) {
          if (!(partId in prev)) return prev;
          const { [partId]: _drop, ...rest } = prev;
          void _drop;
          return rest;
        }
        return { ...prev, [partId]: result.tree };
      });
    } else {
      setFeatureTreeError((prev) => ({ ...prev, [partId]: result.error }));
    }
  }, []);

  // ── mates ops ──────────────────────────────────────────────────────────

  const addMateLocal = useCallback(() => {
    setState((prev) => {
      const idx = prev.mates.length + 1;
      const id = `mate_${idx}`;
      const a: MateRef = {
        partId: prev.parts[0]?.id ?? 'part_1',
        refId: 'ref_a',
        refKind: 'face',
      };
      const b: MateRef = {
        partId: prev.parts[1]?.id ?? prev.parts[0]?.id ?? 'part_2',
        refId: 'ref_b',
        refKind: 'face',
      };
      const mate = newMateOfKind(id, 'coincident', a, b);
      return { ...prev, mates: [...prev.mates, mate] };
    });
  }, []);

  const removeMateLocal = useCallback((mateId: string) => {
    setState((prev) => ({
      ...prev,
      mates: prev.mates.filter((m) => m.id !== mateId),
    }));
  }, []);

  const changeMateKind = useCallback((mateId: string, kind: MateKind) => {
    setState((prev) => ({
      ...prev,
      mates: prev.mates.map((m) =>
        m.id === mateId ? newMateOfKind(m.id, kind, m.a, m.b) : m,
      ),
    }));
  }, []);

  const updateMateRef = useCallback(
    (mateId: string, side: 'a' | 'b', patch: Partial<MateRef>) => {
      setState((prev) => ({
        ...prev,
        mates: prev.mates.map((m) =>
          m.id === mateId
            ? ({ ...m, [side]: { ...m[side], ...patch } } as Mate)
            : m,
        ),
      }));
    },
    [],
  );

  const updateMateValue = useCallback((mateId: string, value: number) => {
    setState((prev) => ({
      ...prev,
      mates: prev.mates.map((m) => (m.id === mateId ? setMateValue(m, value) : m)),
    }));
  }, []);

  // ── ref-selection / mate-toolbar ops ───────────────────────────────────

  const toggleRefsPanel = useCallback((partId: string) => {
    setRefsPanelOpen((prev) => ({ ...prev, [partId]: !prev[partId] }));
  }, []);

  const onRefButtonClick = useCallback(
    (partId: string, refId: string, refKind: ToolbarRefKind) => {
      setSelection((prev) => toggleSelection(prev, { partId, refId, refKind }));
    },
    [],
  );

  const onClearSelection = useCallback(() => setSelection([]), []);

  /**
   * MateConstraintsToolbar.onAdd handler — appends the validated Mate to
   * state.mates and clears the selection so the next mate starts fresh
   * (UX matches Onshape: pick refs → click button → selection resets).
   * mate.ts validateMate is NOT re-run here because the toolbar guarantees
   * a cross-part, kind-compatible pair via canApply().
   */
  const onAddMateFromToolbar = useCallback((mate: Mate) => {
    setState((prev) => ({ ...prev, mates: [...prev.mates, mate] }));
    setSelection([]);
  }, []);

  // ── reset (Phase 4) ───────────────────────────────────────────────────

  /**
   * Wipe parts, mates, per-part FeatureTrees and the textarea bodies in
   * one shot. In persisted mode the storage hooks see the empty record
   * via their setters, debounce 500 ms and write the empty payload to
   * localStorage — effectively clearing the slot.
   */
  const onResetAssembly = useCallback(() => {
    setState(EMPTY_STATE);
    setFeatureTrees({});
    setFeatureTreeText({});
    setFeatureTreeOpen({});
    setFeatureTreeError({});
    setRefsPanelOpen({});
    setSelection([]);
    setTreesPersistError(null);
    setSuggestions([]);
    setHasInferred(false);
  }, [setState, setFeatureTrees]);

  // ── infer-mates (Phase 5.2.3) ──────────────────────────────────────────

  /**
   * Suggestion buffer — populated by `onInferMatesClick`, drained by
   * `onAcceptSuggestion` / `onAcceptAllSuggestions` (push into state.mates)
   * or `onRejectSuggestion` / `onRejectAllSuggestions` (silent drop).
   */
  const [suggestions, setSuggestions] = useState<ReadonlyArray<Mate>>([]);
  /**
   * Sticky flag: distinguishes "user hasn't pressed the button yet" from
   * "user pressed and got zero results". Lets the UI show the `noSuggestions`
   * banner only after at least one inference run.
   */
  const [hasInferred, setHasInferred] = useState<boolean>(false);

  const onInferMatesClick = useCallback(() => {
    const { partFaces, partAxes } = derivePartGeometryForAssembly(
      state.parts,
      featureTrees,
    );
    const inferred = onInferMates
      ? onInferMates(state, partFaces, partAxes)
      : inferMatesFromPlacements(state, partFaces, partAxes);
    // Drop any suggestion whose id collides with an existing mate id (the
    // inference module generates `inferred_<kind>_<n>` so practical
    // collisions are rare, but defensive). Also dedup against any prior
    // suggestion buffer — the user may infer twice with no accept in
    // between.
    const existingMateIds = new Set(state.mates.map((m) => m.id));
    const existingSuggestionIds = new Set(suggestions.map((s) => s.id));
    const filtered = inferred.filter(
      (m) => !existingMateIds.has(m.id) && !existingSuggestionIds.has(m.id),
    );
    setSuggestions([...suggestions, ...filtered]);
    setHasInferred(true);
  }, [onInferMates, state, featureTrees, suggestions]);

  const onAcceptSuggestion = useCallback(
    (mate: Mate) => {
      setState((prev) => ({ ...prev, mates: [...prev.mates, mate] }));
      setSuggestions((prev) => prev.filter((s) => s.id !== mate.id));
    },
    [setState],
  );

  const onRejectSuggestion = useCallback((mateId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== mateId));
  }, []);

  const onAcceptAllSuggestions = useCallback(() => {
    setState((prev) => ({ ...prev, mates: [...prev.mates, ...suggestions] }));
    setSuggestions([]);
  }, [setState, suggestions]);

  const onRejectAllSuggestions = useCallback(() => {
    setSuggestions([]);
  }, []);

  const partNameById = useCallback(
    (partId: string): string | undefined => {
      const part = state.parts.find((p) => p.id === partId);
      return part?.name;
    },
    [state.parts],
  );

  // ── solve ─────────────────────────────────────────────────────────────

  const onSolveClick = useCallback(async () => {
    if (!onSolve) return;
    setSolveState({ status: 'loading' });
    try {
      const result = await onSolve(state, featureTrees);
      setSolveState({ status: 'ok', result });
    } catch (e) {
      setSolveState({
        status: 'error',
        message: `${t.errorPrefix}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }, [onSolve, state, featureTrees, t.errorPrefix]);

  // ── derived ────────────────────────────────────────────────────────────

  /**
   * Solve is disabled whenever:
   *  - the parent didn't provide an `onSolve` handler, OR
   *  - a solve is currently in-flight, OR
   *  - ANY part's FeatureTree textarea currently holds invalid JSON
   *    (we'd POST garbage). Empty textareas are fine — those just mean
   *    that part contributes no geometry (stub-fallback).
   */
  const hasFeatureTreeError = useMemo(
    () => Object.values(featureTreeError).some((msg) => Boolean(msg)),
    [featureTreeError],
  );
  const solveDisabled = useMemo(
    () => !onSolve || solveState.status === 'loading' || hasFeatureTreeError,
    [onSolve, solveState.status, hasFeatureTreeError],
  );

  return (
    <div
      data-testid="solver-assembly-modal"
      role="dialog"
      aria-labelledby="solver-assembly-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 20,
          borderRadius: 8,
          maxWidth: 1080,
          width: '95%',
          maxHeight: '92vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3
          id="solver-assembly-title"
          data-testid="solver-assembly-title"
          style={{ margin: 0, fontSize: 16, fontWeight: 600 }}
        >
          {t.modalTitle}
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.4fr',
            gap: 16,
            alignItems: 'stretch',
          }}
        >
          {/* ── LEFT: parts tree ──────────────────────────────────────── */}
          <section
            data-testid="solver-assembly-parts-panel"
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minHeight: 280,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t.partsHeading}</div>
            <div
              data-testid="solver-assembly-parts-list"
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              {state.parts.length === 0 ? (
                <div
                  data-testid="solver-assembly-parts-empty"
                  style={{ fontSize: 12, color: '#6b7280', padding: 8 }}
                >
                  {t.emptyParts}
                </div>
              ) : (
                state.parts.map((p) => {
                  const treeOpen = !!featureTreeOpen[p.id];
                  const treeText = featureTreeText[p.id] ?? '';
                  const treeErr = featureTreeError[p.id];
                  const refsOpen = !!refsPanelOpen[p.id];
                  // Extra (non-canonical) refs derived from this part's
                  // FeatureTree, if one has been provided. listPartRefs
                  // returns the canonical 7 too — filter them out so we
                  // don't render duplicate buttons.
                  const partTree = featureTrees[p.id];
                  const extraRefs: ReadonlyArray<{ refId: string; refKind: ToolbarRefKind }> =
                    partTree
                      ? listPartRefs(partTree)
                          .filter((refId) => !CANONICAL_REF_IDS.has(refId))
                          .map((refId) => {
                            const kind = inferRefKindFromId(refId);
                            return kind ? { refId, refKind: kind } : null;
                          })
                          .filter(
                            (
                              r,
                            ): r is { refId: string; refKind: ToolbarRefKind } => r !== null,
                          )
                      : [];
                  return (
                    <div
                      key={p.id}
                      data-testid={`solver-assembly-part-row-${p.id}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: '4px 6px',
                        border: '1px solid #f3f4f6',
                        borderRadius: 4,
                      }}
                    >
                      <div
                        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                      >
                        <input
                          type="text"
                          value={p.name}
                          aria-label={`${t.partName} ${p.id}`}
                          data-testid={`solver-assembly-part-name-${p.id}`}
                          onChange={(e) => renamePart(p.id, e.target.value)}
                          style={{
                            flex: 1,
                            fontSize: 12,
                            padding: 4,
                            border: '1px solid #d1d5db',
                            borderRadius: 3,
                          }}
                        />
                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!p.fixed}
                            data-testid={`solver-assembly-part-fixed-${p.id}`}
                            onChange={(e) => toggleFixed(p.id, e.target.checked)}
                          />
                          {t.fixed}
                        </label>
                        <button
                          type="button"
                          onClick={() => toggleFeatureTreeEditor(p.id)}
                          data-testid={`solver-assembly-part-${p.id}-tree-toggle`}
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            background: treeOpen ? '#e0f2fe' : '#fff',
                            border: '1px solid #93c5fd',
                            color: '#1d4ed8',
                            borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >
                          {treeOpen ? t.hideFeatureTree : t.editFeatureTree}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleRefsPanel(p.id)}
                          data-testid={`solver-assembly-part-${p.id}-refs-toggle`}
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            background: refsOpen ? '#dcfce7' : '#fff',
                            border: '1px solid #86efac',
                            color: '#166534',
                            borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >
                          {refsOpen ? t.hideRefs : t.selectRefs}
                        </button>
                        <button
                          type="button"
                          onClick={() => removePartLocal(p.id)}
                          data-testid={`solver-assembly-part-remove-${p.id}`}
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            background: '#fff',
                            border: '1px solid #fca5a5',
                            color: '#b91c1c',
                            borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >
                          {t.remove}
                        </button>
                      </div>
                      {treeOpen && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <textarea
                            value={treeText}
                            placeholder={t.featureTreePlaceholder}
                            aria-label={`FeatureTree ${p.id}`}
                            data-testid={`solver-assembly-part-${p.id}-tree-editor`}
                            onChange={(e) =>
                              updateFeatureTreeText(p.id, e.target.value)
                            }
                            spellCheck={false}
                            rows={6}
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 11,
                              padding: 6,
                              border: `1px solid ${treeErr ? '#fca5a5' : '#d1d5db'}`,
                              borderRadius: 3,
                              resize: 'vertical',
                              minHeight: 60,
                            }}
                          />
                          {treeErr && (
                            <div
                              data-testid={`solver-assembly-part-${p.id}-tree-error`}
                              style={{
                                fontSize: 11,
                                color: '#b91c1c',
                                padding: '2px 4px',
                                background: '#fef2f2',
                                border: '1px solid #fecaca',
                                borderRadius: 3,
                              }}
                            >
                              {t.featureTreeParseError}: {treeErr}
                            </div>
                          )}
                        </div>
                      )}
                      {refsOpen && (
                        <div
                          data-testid={`solver-assembly-part-${p.id}-refs-panel`}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            padding: 4,
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: 4,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: '#166534',
                            }}
                          >
                            {t.refsAvailable}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 3,
                            }}
                          >
                            {[...CANONICAL_REFS, ...extraRefs].map((r) => {
                              const isSelected = selection.some(
                                (s) => s.partId === p.id && s.refId === r.refId,
                              );
                              return (
                                <button
                                  key={r.refId}
                                  type="button"
                                  onClick={() =>
                                    onRefButtonClick(p.id, r.refId, r.refKind)
                                  }
                                  data-testid={`solver-assembly-part-${p.id}-ref-${r.refId}`}
                                  aria-pressed={isSelected}
                                  title={`${r.refId} (${r.refKind})`}
                                  style={{
                                    fontSize: 10,
                                    padding: '2px 6px',
                                    background: isSelected ? '#166534' : '#fff',
                                    color: isSelected ? '#fff' : '#374151',
                                    border: `1px solid ${
                                      isSelected ? '#166534' : '#d1d5db'
                                    }`,
                                    borderRadius: 3,
                                    cursor: 'pointer',
                                    fontFamily: 'monospace',
                                  }}
                                >
                                  {r.refId}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <button
              type="button"
              onClick={addPartLocal}
              data-testid="solver-assembly-add-part"
              style={{
                marginTop: 6,
                fontSize: 12,
                padding: '6px 10px',
                background: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t.addPart}
            </button>

            {/* ── selection display + mate-toolbar bridge ─────────────── */}
            <div
              data-testid="solver-assembly-selection-bar"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                marginTop: 8,
                padding: 6,
                borderTop: '1px dashed #e5e7eb',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 600 }}>{t.selectedLabel}:</span>
                {selection.length === 0 ? (
                  <span style={{ color: '#6b7280' }}>{t.selectedEmpty}</span>
                ) : (
                  selection.map((s, idx) => (
                    <span
                      key={`${s.partId}:${s.refId}`}
                      data-testid={`solver-assembly-selection-${idx}`}
                      style={{
                        fontFamily: 'monospace',
                        padding: '1px 5px',
                        background: '#dcfce7',
                        border: '1px solid #86efac',
                        borderRadius: 3,
                      }}
                    >
                      {s.partId}:{s.refId}
                    </span>
                  ))
                )}
                <span style={{ color: '#9ca3af', marginInlineStart: 'auto' }}>
                  ({t.maxRefs})
                </span>
                <button
                  type="button"
                  onClick={onClearSelection}
                  disabled={selection.length === 0}
                  data-testid="solver-assembly-clear-selection"
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    background: selection.length === 0 ? '#f3f4f6' : '#fff',
                    color: selection.length === 0 ? '#9ca3af' : '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: 3,
                    cursor: selection.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {t.clearSelection}
                </button>
              </div>
              <MateConstraintsToolbar
                lang={lang}
                selection={selection}
                onAdd={onAddMateFromToolbar}
                onClear={onClearSelection}
              />
            </div>
          </section>

          {/* ── RIGHT: mates list ─────────────────────────────────────── */}
          <section
            data-testid="solver-assembly-mates-panel"
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minHeight: 280,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t.matesHeading}</div>
            <div
              data-testid="solver-assembly-mates-list"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {state.mates.length === 0 ? (
                <div
                  data-testid="solver-assembly-mates-empty"
                  style={{ fontSize: 12, color: '#6b7280', padding: 8 }}
                >
                  {t.emptyMates}
                </div>
              ) : (
                state.mates.map((m) => {
                  const vSpec = mateKindNeedsValue(m.kind);
                  const v = getMateValue(m);
                  return (
                    <div
                      key={m.id}
                      data-testid={`solver-assembly-mate-row-${m.id}`}
                      style={{
                        border: '1px solid #f3f4f6',
                        borderRadius: 4,
                        padding: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                        }}
                      >
                        <span
                          data-testid={`solver-assembly-mate-name-${m.id}`}
                          style={{ fontWeight: 600 }}
                        >
                          {m.id}
                        </span>
                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {t.mateKind}
                          <select
                            value={m.kind}
                            aria-label={`${t.mateKind} ${m.id}`}
                            data-testid={`solver-assembly-mate-kind-${m.id}`}
                            onChange={(e) =>
                              changeMateKind(m.id, e.target.value as MateKind)
                            }
                            style={{ fontSize: 12, padding: 2 }}
                          >
                            {ALL_MATE_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeMateLocal(m.id)}
                          data-testid={`solver-assembly-mate-remove-${m.id}`}
                          style={{
                            marginLeft: 'auto',
                            fontSize: 11,
                            padding: '3px 8px',
                            background: '#fff',
                            border: '1px solid #fca5a5',
                            color: '#b91c1c',
                            borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >
                          {t.remove}
                        </button>
                      </div>

                      {(['a', 'b'] as const).map((side) => {
                        const ref = m[side];
                        return (
                          <div
                            key={side}
                            data-testid={`solver-assembly-mate-${side}-${m.id}`}
                            style={{
                              display: 'flex',
                              gap: 6,
                              alignItems: 'center',
                              fontSize: 11,
                            }}
                          >
                            <span style={{ width: 32 }}>
                              {side === 'a' ? t.refA : t.refB}
                            </span>
                            <input
                              type="text"
                              value={ref.partId}
                              aria-label={`${t.partId} ${m.id} ${side}`}
                              data-testid={`solver-assembly-mate-${side}-partid-${m.id}`}
                              onChange={(e) =>
                                updateMateRef(m.id, side, { partId: e.target.value })
                              }
                              style={{
                                flex: 1,
                                fontSize: 11,
                                padding: 3,
                                border: '1px solid #d1d5db',
                                borderRadius: 3,
                              }}
                            />
                            <input
                              type="text"
                              value={ref.refId}
                              aria-label={`${t.refId} ${m.id} ${side}`}
                              data-testid={`solver-assembly-mate-${side}-refid-${m.id}`}
                              onChange={(e) =>
                                updateMateRef(m.id, side, { refId: e.target.value })
                              }
                              style={{
                                flex: 1,
                                fontSize: 11,
                                padding: 3,
                                border: '1px solid #d1d5db',
                                borderRadius: 3,
                              }}
                            />
                            <select
                              value={ref.refKind}
                              aria-label={`${t.refKind} ${m.id} ${side}`}
                              data-testid={`solver-assembly-mate-${side}-refkind-${m.id}`}
                              onChange={(e) =>
                                updateMateRef(m.id, side, {
                                  refKind: e.target.value as MateRefKind,
                                })
                              }
                              style={{ fontSize: 11, padding: 2 }}
                            >
                              {ALL_REF_KINDS.map((rk) => (
                                <option key={rk} value={rk}>
                                  {rk}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}

                      {vSpec.needed && (
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 11,
                          }}
                        >
                          <span style={{ width: 32 }}>{t.value}</span>
                          <input
                            type="number"
                            value={v ?? 0}
                            aria-label={`${t.value} ${m.id}`}
                            data-testid={`solver-assembly-mate-value-${m.id}`}
                            onChange={(e) =>
                              updateMateValue(m.id, Number(e.target.value))
                            }
                            step="0.1"
                            style={{
                              flex: 1,
                              fontSize: 11,
                              padding: 3,
                              border: '1px solid #d1d5db',
                              borderRadius: 3,
                            }}
                          />
                          <span style={{ color: '#6b7280' }}>{vSpec.label}</span>
                        </label>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <button
              type="button"
              onClick={addMateLocal}
              data-testid="solver-assembly-add-mate"
              style={{
                marginTop: 6,
                fontSize: 12,
                padding: '6px 10px',
                background: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t.addMate}
            </button>
          </section>
        </div>

        {/* ── infer-mates section (Phase 5.2.3) ─────────────────────── */}
        <div
          data-testid="solver-assembly-infer-mates-section"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={onInferMatesClick}
              data-testid="solver-assembly-infer-mates-button"
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fde68a',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t.inferMates}
            </button>
            {hasInferred && suggestions.length > 0 && (
              <span
                data-testid="solver-assembly-infer-mates-status"
                style={{ fontSize: 11, color: '#92400e' }}
              >
                {t.suggestionsAvailable} ({suggestions.length})
              </span>
            )}
            {hasInferred && suggestions.length === 0 && (
              <span
                data-testid="solver-assembly-infer-mates-empty"
                style={{ fontSize: 11, color: '#6b7280' }}
              >
                {t.noSuggestions}
              </span>
            )}
          </div>
          {suggestions.length > 0 && (
            <div data-testid="solver-suggested-mates-panel">
              <SuggestedMatesPanel
                lang={lang}
                suggestions={suggestions}
                onAccept={onAcceptSuggestion}
                onAcceptAll={onAcceptAllSuggestions}
                onReject={onRejectSuggestion}
                onRejectAll={onRejectAllSuggestions}
                partNameById={partNameById}
              />
            </div>
          )}
        </div>

        {/* ── solve result ──────────────────────────────────────────── */}
        {solveState.status === 'loading' && (
          <div
            data-testid="solver-assembly-solve-loading"
            style={{ fontSize: 12, color: '#6b7280', padding: 8 }}
          >
            {t.solving}
          </div>
        )}
        {solveState.status === 'error' && (
          <div
            data-testid="solver-assembly-solve-error"
            style={{
              fontSize: 12,
              color: '#b91c1c',
              padding: 8,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
            }}
          >
            {solveState.message}
          </div>
        )}
        {solveState.status === 'ok' && (
          <div
            data-testid="solver-assembly-solve-result"
            style={{
              fontSize: 12,
              padding: 8,
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 700 }}>{t.solveResultTitle}</div>
              {solveState.result.phase && (
                <span
                  data-testid="solver-assembly-solve-phase"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background:
                      solveState.result.phase === 'real' ? '#dcfce7' : '#fef3c7',
                    color:
                      solveState.result.phase === 'real' ? '#166534' : '#92400e',
                    border: `1px solid ${
                      solveState.result.phase === 'real' ? '#86efac' : '#fde68a'
                    }`,
                  }}
                >
                  {t.phaseLabel}: {solveState.result.phase}
                </span>
              )}
            </div>
            <div>
              <span data-testid="solver-assembly-solve-success">
                {solveState.result.success ? t.success : t.failure}
              </span>
              {' · '}
              <span data-testid="solver-assembly-solve-dof">
                {t.dof}: {solveState.result.dof ?? 0}
              </span>
              {solveState.result.iterations !== undefined && (
                <>
                  {' · '}
                  <span data-testid="solver-assembly-solve-iterations">
                    {t.iterations}: {solveState.result.iterations}
                  </span>
                </>
              )}
              {solveState.result.finalMaxResidual !== undefined && (
                <>
                  {' · '}
                  <span data-testid="solver-assembly-solve-max-residual">
                    {t.maxResidual}: {solveState.result.finalMaxResidual.toFixed(4)}
                  </span>
                </>
              )}
            </div>
            {solveState.result.residuals.length > 0 && (
              <div
                data-testid="solver-assembly-solve-residuals"
                style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <div style={{ fontWeight: 600 }}>{t.perMate}</div>
                {solveState.result.residuals.map((r) => (
                  <div
                    key={r.mateId}
                    data-testid={`solver-assembly-solve-residual-${r.mateId}`}
                    style={{ fontFamily: 'monospace', fontSize: 11 }}
                  >
                    {r.mateId}: {r.residual.toFixed(4)}
                    {!r.supported ? ' (unsupported)' : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── footer ───────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 4,
            alignItems: 'center',
          }}
        >
          {/* Persistence status banner — visible only when projectId is set.
              The Reset button is always visible (works in both modes). */}
          {projectId !== undefined && treesPersistError === null && (
            <span
              data-testid="solver-assembly-saved"
              style={{ color: '#16a34a', fontSize: 11, marginRight: 'auto' }}
            >
              {t.savedAt}
            </span>
          )}
          {projectId !== undefined && treesPersistError !== null && (
            <span
              data-testid="solver-assembly-save-error"
              role="alert"
              style={{
                color: '#dc2626',
                fontSize: 11,
                marginRight: 'auto',
                padding: '2px 6px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 4,
              }}
            >
              {t.saveError}: {treesPersistError.error === 'quota_exceeded'
                ? 'quota exceeded'
                : treesPersistError.message}
            </span>
          )}
          <button
            type="button"
            onClick={onResetAssembly}
            data-testid="solver-assembly-reset"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.reset}
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="solver-assembly-close"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.close}
          </button>
          <button
            type="button"
            onClick={onSolveClick}
            disabled={solveDisabled}
            data-testid="solver-assembly-solve"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              background: solveDisabled ? '#e5e7eb' : '#0ea5e9',
              color: solveDisabled ? '#9ca3af' : '#fff',
              border: '1px solid #0284c7',
              borderRadius: 4,
              cursor: solveDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {solveState.status === 'loading' ? t.solving : t.solve}
          </button>
        </div>
      </div>
    </div>
  );
}
