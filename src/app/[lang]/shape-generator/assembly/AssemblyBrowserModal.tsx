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
  type Quat,
  IDENTITY_QUAT,
} from '@/lib/assembly/assemblyState';
import { useAssemblyHistory } from '@/lib/assembly/assemblyHistory';
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
import {
  importStepAssembly,
  type StepAssemblyImportResult,
} from '@/lib/brep-bridge/stepAssemblyImport';
import FeatureTreePlannerPanel from '../sketch/FeatureTreePlannerPanel';
import type { PlanStep } from '@/lib/ai/featureTreePlanner';
import { buildBom, bomToCsv, bomToJson } from '@/lib/assembly/bomExport';
import Assembly3DViewer from './Assembly3DViewer';
import AssemblyAiPanel from './AssemblyAiPanel';
import PartManipulatorGizmo, {
  type PartManipulatorMode,
  type Vec3,
} from './PartManipulatorGizmo';
import type { AssemblyPlan } from '@/lib/ai/assemblyNlParser';

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
  /**
   * Phase 3.2 — solver picker label rendered next to the Solve button.
   * The select itself lets the user steer which assembly solver runs:
   * Auto (server picks), Gauss-Seidel, Lagrangian, or Adaptive.
   */
  solverLabel: string;
  /** Solver picker option — server picks via pickAutoSolver (default). */
  solverAuto: string;
  /** Solver picker option — Gauss-Seidel relaxation (iterativeSolve). */
  solverGaussSeidel: string;
  /** Solver picker option — Newton-LM with numeric Jacobian (lagrangianSolve). */
  solverLagrangian: string;
  /** Solver picker option — Newton-LM + analytic Jacobian + line-search. */
  solverAdaptive: string;
  /** Prefix shown on the solverUsed badge next to the phase badge. */
  solverUsedLabel: string;
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
  /** Undo button label (Phase 4.2 history). */
  undo: string;
  /** Redo button label. */
  redo: string;
  /** History panel section heading. */
  historyHeading: string;
  /** Empty placeholder when no entries have been recorded. */
  historyEmpty: string;
  /**
   * Templates used to build human-readable change descriptions stored in
   * the history. They take the part / mate id (or pre-localized fragment)
   * and return the localized full description. Kept as functions because
   * many languages don't follow English word order.
   */
  descAddPart: (id: string) => string;
  descRemovePart: (id: string) => string;
  descAddMate: (id: string) => string;
  descRemoveMate: (id: string) => string;
  descAcceptMate: (id: string) => string;
  descAcceptAllMates: (count: number) => string;
  /**
   * Description recorded in history when a mate's numeric value cell is
   * committed via the MMMM inline-edit pattern (Enter on the value input).
   * Takes the mate id and the new value so the history panel reads
   * "Update mate m1 value → 25" — the inline edit goes through
   * `recordChange` so Undo restores the prior value.
   */
  descUpdateMateValue: (id: string, value: number) => string;
  /** "Import STEP assembly" footer button label (Phase 4.B). */
  importStepAssembly: string;
  /** In-flight label while the file is being parsed. */
  importingAssembly: string;
  /** Builds the "Imported N parts, M warnings, K unsupported" summary. */
  importedSummary: (parts: number, warnings: number, unsupported: number) => string;
  /** Disclosure label for the per-part warnings list. */
  warningsList: string;
  /** Disclosure label for the per-solid unsupported list. */
  unsupportedList: string;
  /** Description recorded in history when a STEP assembly is imported. */
  descImportAssembly: (fileName: string, parts: number) => string;
  /** Error shown when the selected file exceeds the 5 MB cap (413). */
  errorFileTooLarge: string;
  /** Error shown when the selected file is empty (400). */
  errorFileEmpty: string;
  /**
   * Footer checkbox label: "Auto-infer mates after import" (Phase 5.2.4).
   * Toggles whether the modal fires inferMatesFromPlacements right after a
   * STEP assembly import (or a sample-loader remount) so the user lands on
   * a populated Suggested-Mates panel without clicking "Infer mates".
   */
  autoInferLabel: string;
  /**
   * Toast template shown right after an auto-inference fires — returns the
   * localized "Imported N parts, inferred M mate suggestions" line.
   */
  inferredSummary: (parts: number, mates: number) => string;
  /** Toast dismiss button label (X). */
  dismissToast: string;
  /**
   * Phase 3.AI.Assembly — toggle label that turns on the AI assembly
   * builder (per-part FeatureTreePlannerPanel + assembly-level NL input).
   * Default off so the modal's existing layout is unchanged for users who
   * don't opt in.
   */
  aiAssemblyBuilder: string;
  /**
   * Placeholder shown in the assembly-level NL input. Sample phrasings
   * mirror the two patterns the Phase 1 parser recognises ("3 stacked"
   * and "2 x 3 grid") so the user immediately understands what to type.
   */
  createAssemblyPrompt: string;
  /**
   * Submit button label next to the assembly-level NL input.
   */
  createAssemblySubmit: string;
  /**
   * Banner shown when the parser cannot match any pattern in the user's
   * input. Graceful fallback: tell the user we couldn't parse instead of
   * doing something unexpected.
   */
  couldNotParse: string;
  /**
   * Phase 4.5 — Bill of Materials export. The footer "Export BOM" button
   * reveals a small CSV / JSON sub-menu that triggers a download blob.
   */
  exportBom: string;
  /** Sub-menu label for the CSV download. */
  bomCsv: string;
  /** Sub-menu label for the JSON download. */
  bomJson: string;
  /**
   * Tooltip shown on the post-export inline summary. Wraps the total mass
   * value in a localized "Total mass: X g" line.
   */
  bomTotalMass: string;
  /**
   * Phase 3.A.viewer-integration — toggle label that mounts the
   * standalone {@link Assembly3DViewer} alongside the parts list. Default
   * off so the modal's existing 2D parts/mates layout is unchanged for
   * users (and tests) that don't opt in.
   */
  show3DView: string;
  /** Toggle label when the 3D viewer is already mounted. */
  hide3DView: string;
  /**
   * Phase 3.A.UUUUU-integration — toggle label that mounts the rich
   * standalone {@link AssemblyAiPanel} (Agent-VVVV intent pipeline) in a
   * side slot of the modal. Default off so existing modal layout is
   * untouched for users (and the existing 210 tests) that don't opt in.
   * Distinct from `aiAssemblyBuilder` (NNNN inline 2-pattern builder).
   */
  aiPanel: string;
  /** Toggle label when the AI panel is already mounted. */
  hideAiPanel: string;
  /** Phase 3.A.RRRRR-integration — gizmo mode picker. Translate (XYZ arrows). */
  gizmoModeTranslate: string;
  /** Gizmo mode picker — rotate (XYZ rings). */
  gizmoModeRotate: string;
  /** Heading shown above the gizmo mode picker. */
  gizmoModeLabel: string;
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
    solverLabel: '솔버',
    solverAuto: '자동',
    solverGaussSeidel: 'Gauss-Seidel',
    solverLagrangian: 'Lagrangian',
    solverAdaptive: '적응형',
    solverUsedLabel: '사용 솔버',
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
    undo: '실행 취소',
    redo: '다시 실행',
    historyHeading: '편집 기록',
    historyEmpty: '아직 기록된 변경이 없습니다',
    descAddPart: (id) => `부품 추가 ${id}`,
    descRemovePart: (id) => `부품 삭제 ${id}`,
    descAddMate: (id) => `메이트 추가 ${id}`,
    descRemoveMate: (id) => `메이트 삭제 ${id}`,
    descAcceptMate: (id) => `추론 메이트 수락 ${id}`,
    descAcceptAllMates: (count) => `추론 메이트 일괄 수락 (${count})`,
    descUpdateMateValue: (id, value) => `메이트 값 변경 ${id} → ${value}`,
    importStepAssembly: 'STEP 어셈블리 가져오기',
    importingAssembly: '어셈블리 가져오는 중...',
    importedSummary: (parts, warnings, unsupported) =>
      `${parts}개 부품, ${warnings}개 경고, ${unsupported}개 미지원 항목을 가져왔습니다`,
    warningsList: '경고',
    unsupportedList: '미지원 항목',
    descImportAssembly: (fileName, parts) => `STEP 어셈블리 가져오기 ${fileName} (${parts} 부품)`,
    errorFileTooLarge: '파일이 너무 큽니다 (최대 5MB · 413)',
    errorFileEmpty: '파일이 비어 있습니다 (400)',
    autoInferLabel: '가져오기 후 메이트 자동 추론',
    inferredSummary: (parts, mates) =>
      `${parts}개 부품을 가져오고, ${mates}개 메이트 제안을 추론했습니다`,
    dismissToast: '닫기',
    aiAssemblyBuilder: 'AI 어셈블리 빌더',
    createAssemblyPrompt: '예: 3 stacked plates / 2 x 3 grid',
    createAssemblySubmit: '생성',
    couldNotParse: '입력을 이해할 수 없습니다',
    exportBom: 'BOM 내보내기',
    bomCsv: 'CSV',
    bomJson: 'JSON',
    bomTotalMass: '총 질량',
    show3DView: '3D 뷰 표시',
    hide3DView: '3D 뷰 숨기기',
    aiPanel: 'AI 패널',
    hideAiPanel: 'AI 패널 닫기',
    gizmoModeTranslate: '이동',
    gizmoModeRotate: '회전',
    gizmoModeLabel: '기즈모 모드',
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
    solverLabel: 'Solver',
    solverAuto: 'Auto',
    solverGaussSeidel: 'Gauss-Seidel',
    solverLagrangian: 'Lagrangian',
    solverAdaptive: 'Adaptive',
    solverUsedLabel: 'Solver',
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
    undo: 'Undo',
    redo: 'Redo',
    historyHeading: 'Recent changes',
    historyEmpty: 'No recorded changes yet',
    descAddPart: (id) => `Add part ${id}`,
    descRemovePart: (id) => `Remove part ${id}`,
    descAddMate: (id) => `Add mate ${id}`,
    descRemoveMate: (id) => `Remove mate ${id}`,
    descAcceptMate: (id) => `Accept inferred mate ${id}`,
    descAcceptAllMates: (count) => `Accept all inferred mates (${count})`,
    descUpdateMateValue: (id, value) => `Update mate ${id} value → ${value}`,
    importStepAssembly: 'Import STEP assembly',
    importingAssembly: 'Importing assembly...',
    importedSummary: (parts, warnings, unsupported) =>
      `Imported ${parts} parts, ${warnings} warnings, ${unsupported} unsupported`,
    warningsList: 'Warnings',
    unsupportedList: 'Unsupported',
    descImportAssembly: (fileName, parts) =>
      `Import STEP assembly ${fileName} (${parts} parts)`,
    errorFileTooLarge: 'File too large (max 5 MB · 413)',
    errorFileEmpty: 'File is empty (400)',
    autoInferLabel: 'Auto-infer mates after import',
    inferredSummary: (parts, mates) =>
      `Imported ${parts} parts, inferred ${mates} mate suggestions`,
    dismissToast: 'Dismiss',
    aiAssemblyBuilder: 'AI assembly builder',
    createAssemblyPrompt: 'e.g., 3 stacked plates / 2 x 3 grid',
    createAssemblySubmit: 'Create',
    couldNotParse: 'Could not parse',
    exportBom: 'Export BOM',
    bomCsv: 'CSV',
    bomJson: 'JSON',
    bomTotalMass: 'Total mass',
    show3DView: 'Show 3D view',
    hide3DView: 'Hide 3D view',
    aiPanel: 'AI panel',
    hideAiPanel: 'Hide AI panel',
    gizmoModeTranslate: 'Translate',
    gizmoModeRotate: 'Rotate',
    gizmoModeLabel: 'Gizmo mode',
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
    solverLabel: 'ソルバー',
    solverAuto: '自動',
    solverGaussSeidel: 'Gauss-Seidel',
    solverLagrangian: 'Lagrangian',
    solverAdaptive: '適応型',
    solverUsedLabel: '使用ソルバー',
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
    undo: '元に戻す',
    redo: 'やり直し',
    historyHeading: '編集履歴',
    historyEmpty: 'まだ記録された変更はありません',
    descAddPart: (id) => `パーツ追加 ${id}`,
    descRemovePart: (id) => `パーツ削除 ${id}`,
    descAddMate: (id) => `メイト追加 ${id}`,
    descRemoveMate: (id) => `メイト削除 ${id}`,
    descAcceptMate: (id) => `推論メイトを受入 ${id}`,
    descAcceptAllMates: (count) => `推論メイトを一括受入 (${count})`,
    descUpdateMateValue: (id, value) => `メイト値変更 ${id} → ${value}`,
    importStepAssembly: 'STEP アセンブリ取込',
    importingAssembly: 'アセンブリ取込中...',
    importedSummary: (parts, warnings, unsupported) =>
      `${parts} パーツ、${warnings} 警告、${unsupported} 未対応 を取込`,
    warningsList: '警告',
    unsupportedList: '未対応',
    descImportAssembly: (fileName, parts) =>
      `STEPアセンブリ取込 ${fileName} (${parts}パーツ)`,
    errorFileTooLarge: 'ファイルサイズ超過 (最大 5MB · 413)',
    errorFileEmpty: 'ファイルが空です (400)',
    autoInferLabel: '取込後に合致を自動推論',
    inferredSummary: (parts, mates) =>
      `${parts}パーツを取込み、${mates}件の合致候補を推論しました`,
    dismissToast: '閉じる',
    aiAssemblyBuilder: 'AI アセンブリビルダー',
    createAssemblyPrompt: '例: 3 stacked plates / 2 x 3 grid',
    createAssemblySubmit: '作成',
    couldNotParse: '入力を解析できません',
    exportBom: 'BOM エクスポート',
    bomCsv: 'CSV',
    bomJson: 'JSON',
    bomTotalMass: '総質量',
    show3DView: '3D ビューを表示',
    hide3DView: '3D ビューを隠す',
    aiPanel: 'AI パネル',
    hideAiPanel: 'AI パネルを閉じる',
    gizmoModeTranslate: '移動',
    gizmoModeRotate: '回転',
    gizmoModeLabel: 'ギズモモード',
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
    solverLabel: '求解器',
    solverAuto: '自动',
    solverGaussSeidel: 'Gauss-Seidel',
    solverLagrangian: 'Lagrangian',
    solverAdaptive: '自适应',
    solverUsedLabel: '已用求解器',
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
    undo: '撤销',
    redo: '重做',
    historyHeading: '编辑历史',
    historyEmpty: '尚未记录任何更改',
    descAddPart: (id) => `添加零件 ${id}`,
    descRemovePart: (id) => `删除零件 ${id}`,
    descAddMate: (id) => `添加配合 ${id}`,
    descRemoveMate: (id) => `删除配合 ${id}`,
    descAcceptMate: (id) => `接受推断配合 ${id}`,
    descAcceptAllMates: (count) => `批量接受推断配合 (${count})`,
    descUpdateMateValue: (id, value) => `更改配合数值 ${id} → ${value}`,
    importStepAssembly: '导入 STEP 装配',
    importingAssembly: '正在导入装配...',
    importedSummary: (parts, warnings, unsupported) =>
      `已导入 ${parts} 个零件、${warnings} 条警告、${unsupported} 个不支持项`,
    warningsList: '警告',
    unsupportedList: '不支持',
    descImportAssembly: (fileName, parts) => `导入 STEP 装配 ${fileName} (${parts} 零件)`,
    errorFileTooLarge: '文件过大 (最大 5MB · 413)',
    errorFileEmpty: '文件为空 (400)',
    autoInferLabel: '导入后自动推断配合',
    inferredSummary: (parts, mates) =>
      `已导入 ${parts} 个零件，推断了 ${mates} 条配合建议`,
    dismissToast: '关闭',
    aiAssemblyBuilder: 'AI 装配生成器',
    createAssemblyPrompt: '例如: 3 stacked plates / 2 x 3 grid',
    createAssemblySubmit: '创建',
    couldNotParse: '无法解析输入',
    exportBom: '导出 BOM',
    bomCsv: 'CSV',
    bomJson: 'JSON',
    bomTotalMass: '总质量',
    show3DView: '显示 3D 视图',
    hide3DView: '隐藏 3D 视图',
    aiPanel: 'AI 面板',
    hideAiPanel: '关闭 AI 面板',
    gizmoModeTranslate: '平移',
    gizmoModeRotate: '旋转',
    gizmoModeLabel: '操控器模式',
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
    solverLabel: 'Solver',
    solverAuto: 'Auto',
    solverGaussSeidel: 'Gauss-Seidel',
    solverLagrangian: 'Lagrangiano',
    solverAdaptive: 'Adaptativo',
    solverUsedLabel: 'Solver',
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
    undo: 'Deshacer',
    redo: 'Rehacer',
    historyHeading: 'Cambios recientes',
    historyEmpty: 'Aún no hay cambios registrados',
    descAddPart: (id) => `Añadir pieza ${id}`,
    descRemovePart: (id) => `Eliminar pieza ${id}`,
    descAddMate: (id) => `Añadir restricción ${id}`,
    descRemoveMate: (id) => `Eliminar restricción ${id}`,
    descAcceptMate: (id) => `Aceptar restricción inferida ${id}`,
    descAcceptAllMates: (count) => `Aceptar todas las restricciones inferidas (${count})`,
    descUpdateMateValue: (id, value) =>
      `Actualizar valor de la restricción ${id} → ${value}`,
    importStepAssembly: 'Importar ensamblaje STEP',
    importingAssembly: 'Importando ensamblaje...',
    importedSummary: (parts, warnings, unsupported) =>
      `Importadas ${parts} piezas, ${warnings} advertencias, ${unsupported} no soportadas`,
    warningsList: 'Advertencias',
    unsupportedList: 'No soportadas',
    descImportAssembly: (fileName, parts) =>
      `Importar ensamblaje STEP ${fileName} (${parts} piezas)`,
    errorFileTooLarge: 'Archivo demasiado grande (máx 5 MB · 413)',
    errorFileEmpty: 'Archivo vacío (400)',
    autoInferLabel: 'Inferir restricciones tras importar',
    inferredSummary: (parts, mates) =>
      `Importadas ${parts} piezas, inferidas ${mates} sugerencias de restricción`,
    dismissToast: 'Cerrar',
    aiAssemblyBuilder: 'Constructor de ensamblaje IA',
    createAssemblyPrompt: 'p. ej., 3 stacked plates / 2 x 3 grid',
    createAssemblySubmit: 'Crear',
    couldNotParse: 'No se pudo analizar',
    exportBom: 'Exportar BOM',
    bomCsv: 'CSV',
    bomJson: 'JSON',
    bomTotalMass: 'Masa total',
    show3DView: 'Mostrar vista 3D',
    hide3DView: 'Ocultar vista 3D',
    aiPanel: 'Panel IA',
    hideAiPanel: 'Ocultar panel IA',
    gizmoModeTranslate: 'Trasladar',
    gizmoModeRotate: 'Rotar',
    gizmoModeLabel: 'Modo gizmo',
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
    solverLabel: 'الحلّال',
    solverAuto: 'تلقائي',
    solverGaussSeidel: 'Gauss-Seidel',
    solverLagrangian: 'لاغرانجي',
    solverAdaptive: 'متكيّف',
    solverUsedLabel: 'الحلّال المستخدم',
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
    undo: 'تراجع',
    redo: 'إعادة',
    historyHeading: 'التغييرات الأخيرة',
    historyEmpty: 'لا توجد تغييرات مسجلة بعد',
    descAddPart: (id) => `إضافة جزء ${id}`,
    descRemovePart: (id) => `حذف جزء ${id}`,
    descAddMate: (id) => `إضافة قيد ${id}`,
    descRemoveMate: (id) => `حذف قيد ${id}`,
    descAcceptMate: (id) => `قبول القيد المستنتج ${id}`,
    descAcceptAllMates: (count) => `قبول جميع القيود المستنتجة (${count})`,
    descUpdateMateValue: (id, value) => `تحديث قيمة القيد ${id} → ${value}`,
    importStepAssembly: 'استيراد تجميع STEP',
    importingAssembly: 'جارٍ استيراد التجميع...',
    importedSummary: (parts, warnings, unsupported) =>
      `تم استيراد ${parts} جزءًا، ${warnings} تحذيرًا، ${unsupported} غير مدعوم`,
    warningsList: 'تحذيرات',
    unsupportedList: 'غير مدعوم',
    descImportAssembly: (fileName, parts) =>
      `استيراد تجميع STEP ${fileName} (${parts} جزء)`,
    errorFileTooLarge: 'الملف كبير جدًا (الحد الأقصى 5 ميغابايت · 413)',
    errorFileEmpty: 'الملف فارغ (400)',
    autoInferLabel: 'استنتاج القيود تلقائيًا بعد الاستيراد',
    inferredSummary: (parts, mates) =>
      `تم استيراد ${parts} جزءًا واستنتاج ${mates} اقتراح قيود`,
    dismissToast: 'إغلاق',
    aiAssemblyBuilder: 'منشئ التجميع بالذكاء الاصطناعي',
    createAssemblyPrompt: 'مثال: 3 stacked plates / 2 x 3 grid',
    createAssemblySubmit: 'إنشاء',
    couldNotParse: 'تعذّر التحليل',
    exportBom: 'تصدير BOM',
    bomCsv: 'CSV',
    bomJson: 'JSON',
    bomTotalMass: 'الكتلة الإجمالية',
    show3DView: 'إظهار العرض ثلاثي الأبعاد',
    hide3DView: 'إخفاء العرض ثلاثي الأبعاد',
    aiPanel: 'لوحة الذكاء الاصطناعي',
    hideAiPanel: 'إخفاء لوحة الذكاء الاصطناعي',
    gizmoModeTranslate: 'إزاحة',
    gizmoModeRotate: 'تدوير',
    gizmoModeLabel: 'وضع الأداة',
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
  /**
   * Phase 3.2 — concrete solver the server actually ran. Mirrors the
   * /api/assembly-solve route's `solverUsed`. When the request asked for
   * `solver: 'auto'`, this echoes back whichever Gauss-Seidel / Lagrangian
   * / Adaptive variant `pickAutoSolver` chose so the UI can show the
   * decision to the user. Optional so legacy callers (and the Phase-1
   * stub path that predates the picker) still type-check.
   */
  solverUsed?: AssemblySolverChoice;
}

/**
 * Solver picker options. Mirrors the API's `solver` request field
 * (`gauss_seidel` | `lagrangian` | `adaptive` | `auto`) — the modal
 * forwards the user's pick verbatim and the server is responsible for
 * resolving `auto` to a concrete choice via `pickAutoSolver`.
 */
export type AssemblySolverChoice =
  | 'gauss_seidel'
  | 'lagrangian'
  | 'adaptive';

export type AssemblySolverSelection = AssemblySolverChoice | 'auto';

/**
 * All solver picker options in the order they should appear in the UI.
 * Kept exported so tests can iterate the full set without re-declaring
 * the union.
 */
export const ASSEMBLY_SOLVER_SELECTIONS: ReadonlyArray<AssemblySolverSelection> = [
  'auto',
  'gauss_seidel',
  'lagrangian',
  'adaptive',
];

/**
 * onSolve receives the current AssemblyState plus the per-part FeatureTree
 * map. The map may be empty (no part has a tree yet) — callers decide
 * whether to send `featureTrees` over the wire or omit it for the stub
 * path. The optional 3rd `solver` argument carries the user's solver
 * picker choice ('auto' | 'gauss_seidel' | 'lagrangian' | 'adaptive');
 * legacy callers that ignore it default to the API's 'gauss_seidel'
 * back-compat path. Three args (instead of one bag) keep the signature
 * ergonomic for tests that only care about state.
 */
export type AssemblyBrowserOnSolve = (
  state: AssemblyState,
  featureTrees: Record<string, FeatureTree>,
  solver?: AssemblySolverSelection,
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
  /**
   * Optional injectable STEP-assembly importer (Phase 4.B). When provided,
   * the "Import STEP assembly" footer button delegates to this function
   * instead of calling the in-process `importStepAssembly` directly.
   * Tests inject a mock to avoid round-tripping a real STEP file through
   * the parser inside jsdom (and to assert that the modal forwards the
   * file source verbatim).
   *
   * The default path reads the picked file via FileReader.readAsText and
   * calls `importStepAssembly(source)` synchronously. Either path then
   * recordChange()s the returned state onto the history stack so the user
   * can Ctrl+Z back to the pre-import state.
   */
  onImportStepAssembly?: (source: string, fileName: string) => Promise<StepAssemblyImportResult>;
  /**
   * Maximum size, in bytes, of a STEP file the importer will accept.
   * Defaults to 5 MiB (5 × 1024 × 1024). Anything larger surfaces the
   * `errorFileTooLarge` (HTTP 413) message and the import is rejected
   * before we attempt to read the file body. Lets tests override the cap
   * down to a few bytes without having to build a multi-megabyte fixture.
   */
  importStepMaxBytes?: number;
  /**
   * Phase 5.2.4 — when true, the modal automatically runs
   * {@link inferMatesFromPlacements} once on mount (provided the user's
   * `nexyfab:autoInfer` preference is on AND at least 2 parts + 1
   * FeatureTree are present). The wrapping page sets this to `true`
   * whenever the seed came from a sample-load or a STEP import, and
   * `false` (the default) for the blank assembly so the empty-state UI
   * stays empty until the user explicitly clicks "Infer mates".
   *
   * The auto-trigger fires AT MOST ONCE per mount; toggling the prop
   * mid-life has no further effect (use `key={...}` to remount and
   * re-trigger, matching how the page already remounts on sample-change).
   */
  autoInferOnMount?: boolean;
  /**
   * Phase 5.2.4 — initial value of the auto-infer user preference. When
   * `undefined` the modal hydrates from `localStorage['nexyfab:autoInfer']`
   * (defaulting to `true` when the slot is empty); when defined the modal
   * uses this verbatim and skips the localStorage read on the initial
   * render. Tests inject `false` to deterministically opt out without
   * having to pre-seed window.localStorage.
   */
  initialAutoInfer?: boolean;
}

/** Persistence key prefixes — kept stable across modal + wrapper. */
const ASSEMBLY_STORAGE_PREFIX = 'nexyfab:assembly:';
const ASSEMBLY_TREES_STORAGE_PREFIX = 'nexyfab:assembly-trees:';

/** Default 5 MiB cap on STEP files routed through the importer. */
const DEFAULT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * localStorage slot holding the user's auto-infer preference (Phase 5.2.4).
 * Kept outside any per-project prefix because it's a global UX preference
 * shared across every assembly the user opens. Persisted as the literal
 * string 'true' / 'false' so a missing slot reads back as `null` and the
 * hook can apply its default-true policy unambiguously.
 */
const AUTO_INFER_STORAGE_KEY = 'nexyfab:autoInfer';

/**
 * How long the import-summary toast stays visible before auto-dismissing.
 * 6 s gives the user enough time to read the "Imported N parts, inferred
 * M suggestions" line without leaving the toast lingering forever. The
 * toast also exposes a manual Dismiss button for keyboard / a11y users.
 */
const IMPORT_TOAST_AUTO_DISMISS_MS = 6000;

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

/**
 * Validate a user-entered numeric value for a mate's value cell. The MMMM
 * inline-edit pattern surfaces an invalid value with a red border and
 * refuses to push it through `recordChange` (history would throw via
 * `validateAssembly` anyway, but we catch it earlier so the UX is "input
 * stays red while user is typing" rather than "history toast pops").
 *
 * Rules per task spec:
 *   - distance.value:        finite, ≥ 0       (negative rejected)
 *   - angle.value:           finite, ≥ 0       (negative rejected per UX policy
 *                            even though the IR allows [-180, 180])
 *   - gear.ratio:            finite, > 0       (zero rejected — division)
 *   - rack_pinion.pinionR:   finite, > 0       (zero rejected — division)
 *
 * Returns `true` when the value is acceptable, `false` otherwise. Kinds
 * without a value field (`coincident` / `concentric` / …) silently return
 * `true` so the helper is no-op for the rows that don't render an input.
 */
function isMateValueValid(kind: MateKind, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (kind === 'distance' || kind === 'angle') return v >= 0;
  if (kind === 'gear' || kind === 'rack_pinion') return v > 0;
  return true;
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

// ─── assembly-level NL builder (Phase 3.AI.Assembly) ────────────────────

/**
 * Result of parsing the assembly-level NL input. Phase 1 recognises two
 * deterministic patterns:
 *
 *   1. "N stacked"          → N parts + (N-1) concentric mates between
 *                             consecutive parts on their z_axis. Anything
 *                             after "stacked" (e.g. "stacked plates",
 *                             "stacked blocks") is ignored — the noun is
 *                             part-template-agnostic at this level.
 *   2. "N x M grid"         → N*M parts arranged conceptually in a grid;
 *                             no mates are added (we don't yet have a
 *                             cross-axis pattern primitive in the IR).
 *                             Accepts 'x', 'X', or '×'.
 *
 * Anything else returns `{ kind: 'unparsed' }` so the caller can render
 * the "Could not parse" banner instead of guessing.
 *
 * The parser is intentionally tiny and pure (no LLM, no state). Future
 * phases will layer richer pattern matching (e.g. "ring of N" / "row of
 * N spaced D") on top of the same return shape.
 */
export type AssemblyNlResult =
  | { kind: 'stacked'; count: number }
  | { kind: 'grid'; rows: number; cols: number }
  | { kind: 'unparsed' };

const STACKED_RE = /^\s*(\d+)\s+stacked\b/i;
const GRID_RE = /^\s*(\d+)\s*[x×X]\s*(\d+)\s+grid\b/i;

export function parseAssemblyNl(text: string): AssemblyNlResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: 'unparsed' };
  const gridMatch = GRID_RE.exec(trimmed);
  if (gridMatch) {
    const rows = Number(gridMatch[1]);
    const cols = Number(gridMatch[2]);
    if (Number.isFinite(rows) && Number.isFinite(cols) && rows > 0 && cols > 0) {
      return { kind: 'grid', rows, cols };
    }
  }
  const stackedMatch = STACKED_RE.exec(trimmed);
  if (stackedMatch) {
    const count = Number(stackedMatch[1]);
    if (Number.isFinite(count) && count > 0) {
      return { kind: 'stacked', count };
    }
  }
  return { kind: 'unparsed' };
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
  onImportStepAssembly,
  importStepMaxBytes = DEFAULT_IMPORT_MAX_BYTES,
  autoInferOnMount = false,
  initialAutoInfer,
}: AssemblyBrowserModalProps): React.ReactElement {
  const t = dict[lang];

  // Persistence + history (Phase 4 + 4.2): all assembly-state I/O now flows
  // through `useAssemblyHistory`, which internally delegates persistence to
  // `useAssemblyStorage` (when storageKey is set) and otherwise degrades to
  // plain in-memory state. The hook owns the past/present/future stacks for
  // Undo/Redo. Per-part FeatureTrees stay outside history (they're a side
  // editor and not part of AssemblyState).
  const assemblyKey = projectId !== undefined ? `${ASSEMBLY_STORAGE_PREFIX}${projectId}` : '';
  const treesKey =
    projectId !== undefined ? `${ASSEMBLY_TREES_STORAGE_PREFIX}${projectId}` : '';

  const history = useAssemblyHistory(initialState ?? EMPTY_STATE, {
    maxHistory: 50,
    storageKey: assemblyKey,
  });

  /**
   * Override layer for non-tracked edits (rename / fixed toggle / mate kind
   * change / ref edit / value edit / mate remove via row button). These
   * edits may produce IR-invalid intermediate states (e.g. typing a
   * non-existent partId into a mate ref), so we cannot push them through
   * `history.recordChange` (which would throw via `validateAssembly`). The
   * override "wins" over `history.state` while present; whenever history
   * advances (recordChange / undo / redo) the override is cleared so the
   * canonical, validated state takes back over.
   */
  const [overrideState, setOverrideState] = useState<AssemblyState | null>(null);
  const lastHistoryStateRef = useRef<AssemblyState>(history.state);
  useEffect(() => {
    if (lastHistoryStateRef.current !== history.state) {
      lastHistoryStateRef.current = history.state;
      setOverrideState(null);
    }
  }, [history.state]);

  const state = overrideState ?? history.state;

  /**
   * Non-recording state setter. Used for transient edits that should NOT
   * push to history (and must therefore bypass validateAssembly).
   */
  const setStateDirect = useCallback(
    (next: AssemblyState | ((prev: AssemblyState) => AssemblyState)) => {
      setOverrideState((prevOverride) => {
        const base = prevOverride ?? lastHistoryStateRef.current;
        return typeof next === 'function'
          ? (next as (p: AssemblyState) => AssemblyState)(base)
          : next;
      });
    },
    [],
  );

  /**
   * Recording state setter. Pushes the new state onto the history stack
   * with a localized description. The override layer (if any) is cleared
   * via the effect above as soon as history.state advances.
   */
  const recordState = useCallback(
    (next: AssemblyState | ((prev: AssemblyState) => AssemblyState), description: string) => {
      const base = overrideState ?? history.state;
      const resolved =
        typeof next === 'function'
          ? (next as (p: AssemblyState) => AssemblyState)(base)
          : next;
      history.recordChange(resolved, description);
    },
    [overrideState, history],
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

  /**
   * Phase 3.2 — solver picker selection. 'auto' lets the server choose
   * (recommendSolver + adaptive upgrade). Defaults to 'auto' so new
   * users get the best out-of-the-box experience; the API back-compat
   * default of 'gauss_seidel' still kicks in for any caller that omits
   * the field, which is why the dispatcher only forwards the field when
   * the user actually deviates from a known sentinel.
   */
  const [solverSelection, setSolverSelection] = useState<AssemblySolverSelection>(
    'auto',
  );

  // ── parts ops ──────────────────────────────────────────────────────────

  const addPartLocal = useCallback(() => {
    const base = overrideState ?? history.state;
    const idx = base.parts.length + 1;
    const id = `part_${idx}`;
    const part: PartInstance = {
      id,
      name: `Part ${idx}`,
      partTemplateId: id,
      position: { x: 0, y: 0, z: 0 },
      orientation: IDENTITY_QUAT,
      // First part is fixed so the IR-level invariant (>=1 fixed part)
      // is satisfied as soon as the user picks Solve.
      fixed: base.parts.length === 0,
    };
    recordState(
      (prev) => ({ ...prev, parts: [...prev.parts, part] }),
      t.descAddPart(id),
    );
  }, [overrideState, history.state, recordState, t]);

  const removePartLocal = useCallback((partId: string) => {
    recordState(
      (prev) => ({
        ...prev,
        parts: prev.parts.filter((p) => p.id !== partId),
        // Drop any mates that reference the removed part so the user isn't
        // left with dangling refs they have to clean up manually.
        mates: prev.mates.filter(
          (m) => m.a.partId !== partId && m.b.partId !== partId,
        ),
      }),
      t.descRemovePart(partId),
    );
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
    // Clear the 3D viewer highlight if the removed part was selected.
    setSelectedPartId((prev) => (prev === partId ? null : prev));
  }, [recordState, t]);

  const renamePart = useCallback((partId: string, name: string) => {
    setStateDirect((prev) => ({
      ...prev,
      parts: prev.parts.map((p) => (p.id === partId ? { ...p, name } : p)),
    }));
  }, [setStateDirect]);

  const toggleFixed = useCallback((partId: string, fixed: boolean) => {
    setStateDirect((prev) => ({
      ...prev,
      parts: prev.parts.map((p) => (p.id === partId ? { ...p, fixed } : p)),
    }));
  }, [setStateDirect]);

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
    const base = overrideState ?? history.state;
    const idx = base.mates.length + 1;
    const id = `mate_${idx}`;
    // Note: when no parts exist the fallback partIds 'part_1' / 'part_2'
    // make the resulting state IR-invalid (mate refs an unknown part), so
    // `history.recordChange` will throw via validateAssembly. That's the
    // correct UX: clicking "+ Add mate" with zero parts is meaningless and
    // the user must first add parts. We propagate the throw to surface it
    // in tests / Sentry rather than silently dropping the click.
    const a: MateRef = {
      partId: base.parts[0]?.id ?? 'part_1',
      refId: 'ref_a',
      refKind: 'face',
    };
    const b: MateRef = {
      partId: base.parts[1]?.id ?? base.parts[0]?.id ?? 'part_2',
      refId: 'ref_b',
      refKind: 'face',
    };
    const mate = newMateOfKind(id, 'coincident', a, b);
    recordState(
      (prev) => ({ ...prev, mates: [...prev.mates, mate] }),
      t.descAddMate(id),
    );
  }, [overrideState, history.state, recordState, t]);

  const removeMateLocal = useCallback(
    (mateId: string) => {
      recordState(
        (prev) => ({
          ...prev,
          mates: prev.mates.filter((m) => m.id !== mateId),
        }),
        t.descRemoveMate(mateId),
      );
      // MMMM — drop any in-flight value draft for the removed mate.
      setMateValueDraft((prev) => {
        if (!(mateId in prev)) return prev;
        const { [mateId]: _drop, ...rest } = prev;
        void _drop;
        return rest;
      });
    },
    [recordState, t],
  );

  const changeMateKind = useCallback((mateId: string, kind: MateKind) => {
    setStateDirect((prev) => ({
      ...prev,
      mates: prev.mates.map((m) =>
        m.id === mateId ? newMateOfKind(m.id, kind, m.a, m.b) : m,
      ),
    }));
    // Drop any stale value draft for this mate — switching to a kind
    // that exposes a different value (or none at all) makes the prior
    // raw text meaningless and could pin a phantom red border.
    setMateValueDraft((prev) => {
      if (!(mateId in prev)) return prev;
      const { [mateId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  }, [setStateDirect]);

  const updateMateRef = useCallback(
    (mateId: string, side: 'a' | 'b', patch: Partial<MateRef>) => {
      setStateDirect((prev) => ({
        ...prev,
        mates: prev.mates.map((m) =>
          m.id === mateId
            ? ({ ...m, [side]: { ...m[side], ...patch } } as Mate)
            : m,
        ),
      }));
    },
    [setStateDirect],
  );

  /**
   * Per-mate inline-edit draft buffer for the value cell. Mirrors the
   * MMMM pattern from `SketchConstraintOverlay`:
   *
   *   - Absent entry → the input reflects the canonical mate value
   *     (`getMateValue(m)`) and is in "display" mode.
   *   - Present entry → the input shows the user-typed draft `raw`; the
   *     `invalid` flag drives the red border. Enter commits via
   *     `recordChange` (parsed value); Escape clears the draft (revert).
   *
   * Held in the modal so a kind change that drops the value field can
   * clean up the now-stale draft without leaking it into the next mate
   * that re-acquires a value cell.
   */
  const [mateValueDraft, setMateValueDraft] = useState<
    Record<string, { raw: string; invalid: boolean }>
  >({});

  const beginMateValueEdit = useCallback((mateId: string, seed: number) => {
    setMateValueDraft((prev) => ({
      ...prev,
      [mateId]: { raw: String(seed), invalid: false },
    }));
  }, []);

  const cancelMateValueEdit = useCallback((mateId: string) => {
    setMateValueDraft((prev) => {
      if (!(mateId in prev)) return prev;
      const { [mateId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  }, []);

  const onMateValueChange = useCallback(
    (mateId: string, kind: MateKind, raw: string) => {
      // Stay in edit mode for every keystroke. Parse + validate the new
      // raw value so the red-border flag updates live (matches the
      // MMMM SketchConstraintOverlay pattern where the badge highlights
      // the invalid input on the way to commit).
      const parsed = Number(raw);
      const invalid = !isMateValueValid(kind, parsed);
      setMateValueDraft((prev) => ({
        ...prev,
        [mateId]: { raw, invalid },
      }));
    },
    [],
  );

  /**
   * Commit a value draft to history via `recordChange` (so Undo restores
   * the prior value). Rejects invalid drafts in-place — the red border
   * stays, the history stack is untouched, and the next Enter retries.
   *
   * The override layer is cleared as soon as `recordChange` advances
   * `history.state` (effect at `lastHistoryStateRef`), so any transient
   * ref/kind edits the user made on this mate are folded into the same
   * history entry — matching the "save on Enter" UX users expect from
   * SolidWorks dimension cells.
   */
  const commitMateValueEdit = useCallback(
    (mateId: string) => {
      const draft = mateValueDraft[mateId];
      if (draft === undefined) return;
      const parsed = Number(draft.raw);
      if (!Number.isFinite(parsed)) return;
      const base = overrideState ?? history.state;
      const target = base.mates.find((m) => m.id === mateId);
      if (target === undefined) return;
      if (!isMateValueValid(target.kind, parsed)) {
        // Keep the draft so the red border stays visible.
        setMateValueDraft((prev) => ({
          ...prev,
          [mateId]: { raw: draft.raw, invalid: true },
        }));
        return;
      }
      const currentValue = getMateValue(target);
      if (currentValue === parsed) {
        // No-op commit — drop the draft so the input goes back to display
        // mode without polluting history.
        cancelMateValueEdit(mateId);
        return;
      }
      const next: AssemblyState = {
        ...base,
        mates: base.mates.map((m) => (m.id === mateId ? setMateValue(m, parsed) : m)),
      };
      try {
        history.recordChange(next, t.descUpdateMateValue(mateId, parsed));
        cancelMateValueEdit(mateId);
      } catch {
        // validateAssembly threw — keep the draft + flag invalid so the
        // user sees the red border. Most likely a sibling override edit
        // left the mate in an IR-invalid shape (e.g., refKind mismatch).
        setMateValueDraft((prev) => ({
          ...prev,
          [mateId]: { raw: draft.raw, invalid: true },
        }));
      }
    },
    [mateValueDraft, overrideState, history, t, cancelMateValueEdit],
  );

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
  const onAddMateFromToolbar = useCallback(
    (mate: Mate) => {
      recordState(
        (prev) => ({ ...prev, mates: [...prev.mates, mate] }),
        t.descAddMate(mate.id),
      );
      setSelection([]);
    },
    [recordState, t],
  );

  // ── reset (Phase 4) ───────────────────────────────────────────────────

  /**
   * Wipe parts, mates, per-part FeatureTrees and the textarea bodies in
   * one shot. In persisted mode the storage hooks see the empty record
   * via their setters, debounce 500 ms and write the empty payload to
   * localStorage — effectively clearing the slot.
   */
  const onResetAssembly = useCallback(() => {
    // Reset blanks the assembly to EMPTY_STATE — independent of whatever
    // initialState was seeded, matching the Phase 4 contract that "Reset"
    // means "wipe everything". We record this as a history entry rather
    // than calling `history.reset()` (which would only revert to the
    // initial seed) so the user can Undo a stray reset click. The override
    // layer is cleared via the effect on history.state change.
    if (state.parts.length > 0 || state.mates.length > 0) {
      history.recordChange(EMPTY_STATE, t.descRemovePart('*'));
    }
    setOverrideState(null);
    setFeatureTrees({});
    setFeatureTreeText({});
    setFeatureTreeOpen({});
    setFeatureTreeError({});
    setRefsPanelOpen({});
    setSelection([]);
    setTreesPersistError(null);
    setSuggestions([]);
    setHasInferred(false);
    setImportState({ status: 'idle' });
    setWarningsOpen(false);
    setUnsupportedOpen(false);
    // MMMM inline value editor — drop any in-flight value drafts so a
    // future mate that gains a value cell starts in display mode rather
    // than inheriting a stale red border.
    setMateValueDraft({});
    // AI assembly builder (Phase 3.AI.Assembly): clear transient NL state.
    // Toggle itself is preserved — user explicitly turned it on, so we
    // don't undo that just because they wiped the assembly contents.
    setAiInput('');
    setAiStatus(null);
    // 3D viewer highlight — drop the selection so the (now-empty) parts
    // list and the (now-empty) viewer agree on "no selection". The
    // show3DView toggle is preserved (same UX rationale as the AI toggle).
    setSelectedPartId(null);
    // Gizmo mode is a transient UI preference, not bound to the assembly
    // content — leave it on whatever the user picked. AI panel toggle is
    // user-explicit; preserve it across reset for the same reason as the
    // 3D / inline AI toggles above.
  }, [state.parts.length, state.mates.length, history, setFeatureTrees, t]);

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

  // ── auto-infer preference (Phase 5.2.4) ───────────────────────────────
  //
  // User preference for "auto-infer mates after import", persisted to
  // localStorage['nexyfab:autoInfer'] (default true on first visit). The
  // footer checkbox flips this; the on-mount effect below reads it.
  // We hydrate via a function-form useState initializer so the
  // localStorage read happens exactly once per modal mount.
  const [autoInfer, setAutoInferState] = useState<boolean>(() => {
    if (initialAutoInfer !== undefined) return initialAutoInfer;
    if (typeof window === 'undefined' || !window.localStorage) return true;
    try {
      const raw = window.localStorage.getItem(AUTO_INFER_STORAGE_KEY);
      if (raw === null) return true;
      return raw === 'true';
    } catch {
      return true;
    }
  });
  const setAutoInfer = useCallback((next: boolean) => {
    setAutoInferState(next);
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(AUTO_INFER_STORAGE_KEY, next ? 'true' : 'false');
    } catch {
      // QuotaExceeded / disabled cookies → silently keep the in-memory value.
    }
  }, []);

  /**
   * Toast surfaced after an auto-inference fires. Both counts are baked
   * into the localized "Imported N parts, inferred M suggestions" line;
   * `null` means no toast is currently displayed. Cleared either via the
   * Dismiss button or the auto-fade timer (see effect below).
   */
  const [importToast, setImportToast] = useState<{
    parts: number;
    mates: number;
  } | null>(null);
  const dismissImportToast = useCallback(() => setImportToast(null), []);

  // ── AI assembly builder (Phase 3.AI.Assembly) ──────────────────────────
  //
  // Single boolean gate that flips on:
  //   1. a per-part inline FeatureTreePlannerPanel on every part row, and
  //   2. an assembly-level NL input + submit at the modal footer.
  //
  // Default off so the modal's existing tests + layout are untouched for
  // every consumer that hasn't opted in.
  const [aiBuilderOn, setAiBuilderOn] = useState<boolean>(false);
  /** Controlled input value for the assembly-level NL submit form. */
  const [aiInput, setAiInput] = useState<string>('');
  /**
   * Status banner shown below the assembly-level NL input. `null` means no
   * banner; an object means the most recent submit produced this outcome.
   * - 'created' renders the success summary (parts + mates created).
   * - 'unparsed' renders the localized couldNotParse line.
   */
  const [aiStatus, setAiStatus] = useState<
    | null
    | { kind: 'created'; parts: number; mates: number }
    | { kind: 'unparsed' }
  >(null);

  /**
   * Apply a planner-supplied `PlanStep[]` to a single part's FeatureTree
   * by folding every `add_node` step onto the node list. Other step kinds
   * (remove / move / toggle_suppress) operate on existing nodes — same
   * semantics as `SolverSketchEditorWithExtrude.handlePlannerApply` but
   * inlined here because the assembly modal doesn't have an `applyEdit`
   * history layer for per-part trees (those live outside AssemblyState).
   */
  const applyPlanStepsToPartTree = useCallback(
    (partId: string, steps: PlanStep[]): void => {
      setFeatureTrees((prev) => {
        const current = prev[partId] ?? { nodes: [] };
        let nextNodes = [...current.nodes];
        for (const step of steps) {
          if (step.type === 'add_node' && step.node !== undefined) {
            nextNodes.push(step.node);
          } else if (step.type === 'remove_node' && step.nodeId !== undefined) {
            nextNodes = nextNodes.filter((n) => n.id !== step.nodeId);
          } else if (
            step.type === 'move_node' &&
            step.nodeId !== undefined &&
            typeof step.toIdx === 'number'
          ) {
            const fromIdx = nextNodes.findIndex((n) => n.id === step.nodeId);
            if (fromIdx >= 0) {
              const [moved] = nextNodes.splice(fromIdx, 1);
              if (moved !== undefined) nextNodes.splice(step.toIdx, 0, moved);
            }
          } else if (step.type === 'toggle_suppress' && step.nodeId !== undefined) {
            nextNodes = nextNodes.map((n) =>
              n.id === step.nodeId
                ? { ...n, suppressed: !(n.suppressed === true) }
                : n,
            );
          }
        }
        const nextTree: FeatureTree = { nodes: nextNodes };
        const out = { ...prev, [partId]: nextTree };
        return out;
      });
      // Keep the textarea body in sync so a user who later opens the JSON
      // editor sees the planner-produced tree rather than the pre-apply one.
      setFeatureTreeText((prev) => {
        const currentTree = featureTrees[partId] ?? { nodes: [] };
        let nextNodes = [...currentTree.nodes];
        for (const step of steps) {
          if (step.type === 'add_node' && step.node !== undefined) {
            nextNodes.push(step.node);
          } else if (step.type === 'remove_node' && step.nodeId !== undefined) {
            nextNodes = nextNodes.filter((n) => n.id !== step.nodeId);
          } else if (
            step.type === 'move_node' &&
            step.nodeId !== undefined &&
            typeof step.toIdx === 'number'
          ) {
            const fromIdx = nextNodes.findIndex((n) => n.id === step.nodeId);
            if (fromIdx >= 0) {
              const [moved] = nextNodes.splice(fromIdx, 1);
              if (moved !== undefined) nextNodes.splice(step.toIdx, 0, moved);
            }
          } else if (step.type === 'toggle_suppress' && step.nodeId !== undefined) {
            nextNodes = nextNodes.map((n) =>
              n.id === step.nodeId
                ? { ...n, suppressed: !(n.suppressed === true) }
                : n,
            );
          }
        }
        return { ...prev, [partId]: JSON.stringify({ nodes: nextNodes }, null, 2) };
      });
    },
    [setFeatureTrees, featureTrees],
  );

  /**
   * Pick a fresh part id that does not collide with any existing one in
   * `base`. We extend the same `part_${n}` convention `addPartLocal` uses
   * so the resulting ids are visually consistent across mediums (UI add,
   * STEP import, AI NL builder).
   */
  function pickFreshPartId(taken: ReadonlySet<string>, startIdx: number): {
    id: string;
    nextIdx: number;
  } {
    let idx = startIdx;
    // Cap the search to avoid pathological infinite loops if the caller
    // somehow seeds an absurdly dense set; in practice idx grows by 1.
    for (let safety = 0; safety < 10_000; safety++) {
      const candidate = `part_${idx}`;
      if (!taken.has(candidate)) return { id: candidate, nextIdx: idx + 1 };
      idx++;
    }
    return { id: `part_${idx}_${Date.now()}`, nextIdx: idx + 1 };
  }

  /**
   * Run the assembly-level NL parser on the current input and apply the
   * result to AssemblyState. Updates `aiStatus` so the user always sees
   * what happened (success summary or "Could not parse"). Single
   * `recordChange` so the whole NL prompt lands as one history entry.
   */
  const onAiAssemblySubmit = useCallback(() => {
    const result = parseAssemblyNl(aiInput);
    if (result.kind === 'unparsed') {
      setAiStatus({ kind: 'unparsed' });
      return;
    }
    const base = overrideState ?? history.state;
    const takenPartIds = new Set(base.parts.map((p) => p.id));
    const takenMateIds = new Set(base.mates.map((m) => m.id));
    let partIdx = base.parts.length + 1;
    let mateIdx = base.mates.length + 1;
    const newParts: PartInstance[] = [];
    const newMates: Mate[] = [];

    if (result.kind === 'stacked') {
      const STACK_SPACING = 10;
      for (let i = 0; i < result.count; i++) {
        const picked = pickFreshPartId(takenPartIds, partIdx);
        partIdx = picked.nextIdx;
        takenPartIds.add(picked.id);
        const isFirst = base.parts.length === 0 && i === 0;
        newParts.push({
          id: picked.id,
          name: `Part ${picked.id.replace(/^part_/, '')}`,
          partTemplateId: picked.id,
          // Stack along +Z so consecutive parts read as physically
          // stacked in the viewport when geometry shows up.
          position: { x: 0, y: 0, z: i * STACK_SPACING },
          orientation: IDENTITY_QUAT,
          fixed: isFirst,
        });
      }
      // Build (count-1) concentric mates between consecutive parts on
      // their z_axis. We use the canonical z_axis ref every part exposes.
      for (let i = 0; i < newParts.length - 1; i++) {
        const a = newParts[i]!;
        const b = newParts[i + 1]!;
        let mid: string;
        // Find a non-colliding mate id.
        while (true) {
          mid = `mate_${mateIdx++}`;
          if (!takenMateIds.has(mid)) break;
        }
        takenMateIds.add(mid);
        newMates.push({
          id: mid,
          kind: 'concentric',
          a: { partId: a.id, refId: 'z_axis', refKind: 'axis' },
          b: { partId: b.id, refId: 'z_axis', refKind: 'axis' },
        });
      }
    } else if (result.kind === 'grid') {
      const SPACING = 10;
      for (let r = 0; r < result.rows; r++) {
        for (let c = 0; c < result.cols; c++) {
          const picked = pickFreshPartId(takenPartIds, partIdx);
          partIdx = picked.nextIdx;
          takenPartIds.add(picked.id);
          const isFirst = base.parts.length === 0 && r === 0 && c === 0;
          newParts.push({
            id: picked.id,
            name: `Part ${picked.id.replace(/^part_/, '')}`,
            partTemplateId: picked.id,
            position: { x: c * SPACING, y: r * SPACING, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: isFirst,
          });
        }
      }
    }

    const description =
      result.kind === 'stacked'
        ? `AI: ${result.count} stacked → ${newParts.length} parts + ${newMates.length} mates`
        : `AI: ${result.rows}x${result.cols} grid → ${newParts.length} parts`;
    recordState(
      (prev) => ({
        parts: [...prev.parts, ...newParts],
        mates: [...prev.mates, ...newMates],
      }),
      description,
    );
    setAiStatus({
      kind: 'created',
      parts: newParts.length,
      mates: newMates.length,
    });
    setAiInput('');
  }, [aiInput, overrideState, history.state, recordState]);

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
      recordState(
        (prev) => ({ ...prev, mates: [...prev.mates, mate] }),
        t.descAcceptMate(mate.id),
      );
      setSuggestions((prev) => prev.filter((s) => s.id !== mate.id));
    },
    [recordState, t],
  );

  const onRejectSuggestion = useCallback((mateId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== mateId));
  }, []);

  const onAcceptAllSuggestions = useCallback(() => {
    const count = suggestions.length;
    recordState(
      (prev) => ({ ...prev, mates: [...prev.mates, ...suggestions] }),
      t.descAcceptAllMates(count),
    );
    setSuggestions([]);
  }, [recordState, suggestions, t]);

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

  // ── STEP assembly import (Phase 4.B) ───────────────────────────────────
  //
  // UX contract (matches /api/step-import for size/empty errors so the
  // labels read naturally):
  //   - 5 MiB cap, surfaced as the "413 file too large" message — we use
  //     the same number so a user who later moves to the server route sees
  //     identical wording.
  //   - empty file (0 bytes OR whitespace-only after read) → "400 empty".
  //   - successful parse → state.parts + featureTrees merge into the
  //     modal's history via `recordChange`, so the user can Ctrl+Z back to
  //     the pre-import assembly. We bake the file name + new part count
  //     into the description so the history panel reads "Import STEP
  //     assembly foo.step (3 parts)".
  //   - warnings / unsupported lists are kept in the import-result panel,
  //     not the history panel — they're per-import diagnostics, not edit
  //     events.

  /**
   * Hidden <input type="file"> — clicked imperatively by the visible
   * "Import STEP assembly" button. We keep a ref so the button can call
   * .click() without rendering a default file-picker chrome.
   */
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importState, setImportState] = useState<
    | { status: 'idle' }
    | { status: 'loading'; fileName: string }
    | {
        status: 'ok';
        fileName: string;
        partCount: number;
        warnings: ReadonlyArray<string>;
        unsupported: ReadonlyArray<string>;
      }
    | { status: 'error'; httpStatus: 400 | 413 | 422; message: string }
  >({ status: 'idle' });
  /** Independent expand flags for the warnings / unsupported disclosure
   *  lists (collapsed by default — the summary line is the headline UI). */
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [unsupportedOpen, setUnsupportedOpen] = useState(false);

  const onImportButtonClick = useCallback(() => {
    if (importState.status === 'loading') return;
    importFileRef.current?.click();
  }, [importState.status]);

  /**
   * Run the importer on a freshly-read STEP file source. Handles the
   * happy path (recordChange + summary panel) AND the validateAssembly
   * failure case (the importer's state may legitimately fail IR
   * validation — e.g., zero-part STEP files — and we want the user to
   * see that as a 422 rather than have it propagate as an unhandled
   * throw out of recordChange).
   */
  const applyImportResult = useCallback(
    (result: StepAssemblyImportResult, fileName: string) => {
      try {
        recordState(result.state, t.descImportAssembly(fileName, result.state.parts.length));
        setFeatureTrees((prev) => ({ ...prev, ...result.featureTrees }));
        // Seed the textarea bodies for every imported part so the editor
        // panel hydrates with the imported JSON immediately if the user
        // opens it. This matches the seed flow used by initialFeatureTrees.
        setFeatureTreeText((prev) => {
          const next = { ...prev };
          for (const [pid, tree] of Object.entries(result.featureTrees)) {
            next[pid] = JSON.stringify(tree, null, 2);
          }
          return next;
        });
        setImportState({
          status: 'ok',
          fileName,
          partCount: result.state.parts.length,
          warnings: result.warnings,
          unsupported: result.unsupported,
        });
        setWarningsOpen(false);
        setUnsupportedOpen(false);
        // Phase 5.2.4 — auto-infer right after a successful import so the
        // Suggested-Mates panel is populated by the time the user looks
        // back at the modal. Gated on the user's `autoInfer` preference.
        // We feed inference the *imported* state + merged trees directly
        // (not the closure's `state` / `featureTrees`, which won't have
        // re-rendered yet — React batches the setStates above).
        if (autoInfer) {
          const mergedTrees = { ...featureTrees, ...result.featureTrees };
          const { partFaces, partAxes } = derivePartGeometryForAssembly(
            result.state.parts,
            mergedTrees,
          );
          const inferred = onInferMates
            ? onInferMates(result.state, partFaces, partAxes)
            : inferMatesFromPlacements(result.state, partFaces, partAxes);
          const existingMateIds = new Set(result.state.mates.map((m) => m.id));
          const filtered = inferred.filter((m) => !existingMateIds.has(m.id));
          setSuggestions(filtered);
          setHasInferred(true);
          setImportToast({ parts: result.state.parts.length, mates: filtered.length });
        }
      } catch (e) {
        setImportState({
          status: 'error',
          httpStatus: 422,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [recordState, setFeatureTrees, t, autoInfer, featureTrees, onInferMates],
  );

  const onImportFileChosen = useCallback(
    async (file: File): Promise<void> => {
      // 5 MiB cap → 413 BEFORE we read the file. Reading first would defeat
      // the point of the cap (an attacker could OOM the tab with a 1 GB
      // file). `file.size` is the on-disk byte length, not the decoded
      // text length, which is what we actually want to gate on.
      if (file.size > importStepMaxBytes) {
        setImportState({
          status: 'error',
          httpStatus: 413,
          message: t.errorFileTooLarge,
        });
        return;
      }
      if (file.size === 0) {
        setImportState({
          status: 'error',
          httpStatus: 400,
          message: t.errorFileEmpty,
        });
        return;
      }
      setImportState({ status: 'loading', fileName: file.name });
      try {
        // Prefer `file.text()` (modern browsers), fall back to FileReader
        // for jsdom + legacy browsers. The check is on the actual File
        // instance because some jsdom polyfills shim a non-callable
        // property on the prototype.
        let source: string;
        if (typeof (file as { text?: unknown }).text === 'function') {
          source = await file.text();
        } else {
          source = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () =>
              reject(reader.error ?? new Error('FileReader.read failed'));
            reader.readAsText(file);
          });
        }
        // A file that's whitespace-only is functionally empty too — the
        // importer would throw `empty_source`. Catch it here so the user
        // sees the friendlier 400 message.
        if (source.trim().length === 0) {
          setImportState({
            status: 'error',
            httpStatus: 400,
            message: t.errorFileEmpty,
          });
          return;
        }
        const result = onImportStepAssembly
          ? await onImportStepAssembly(source, file.name)
          : importStepAssembly(source);
        applyImportResult(result, file.name);
      } catch (e) {
        setImportState({
          status: 'error',
          httpStatus: 422,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [
      importStepMaxBytes,
      onImportStepAssembly,
      applyImportResult,
      t.errorFileTooLarge,
      t.errorFileEmpty,
    ],
  );

  const onImportFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Clear the input's value so picking the same file twice in a row
      // still fires `change` — Chrome / Firefox suppress the second event
      // otherwise. We do this BEFORE awaiting onImportFileChosen so a
      // late await rejection doesn't leave us stuck with a stale value.
      e.target.value = '';
      if (!file) return;
      void onImportFileChosen(file);
    },
    [onImportFileChosen],
  );

  // ── solve ─────────────────────────────────────────────────────────────

  const onSolveClick = useCallback(async () => {
    if (!onSolve) return;
    setSolveState({ status: 'loading' });
    try {
      const result = await onSolve(state, featureTrees, solverSelection);
      setSolveState({ status: 'ok', result });
    } catch (e) {
      setSolveState({
        status: 'error',
        message: `${t.errorPrefix}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }, [onSolve, state, featureTrees, solverSelection, t.errorPrefix]);

  // ── BOM export (Phase 4.5) ────────────────────────────────────────────
  //
  // Two-step UX:
  //   1. Click "Export BOM" → reveal a small CSV / JSON sub-menu.
  //   2. Click CSV or JSON → buildBom() against current state +
  //      featureTrees, serialize, and trigger a download blob.
  //
  // The blob is created via URL.createObjectURL and revoked after the
  // anchor click so we don't leak per-export object URLs into the tab's
  // memory map. assemblyName defaults to the projectId (when present) so
  // the downloaded file has a meaningful name out of the box.

  const [bomMenuOpen, setBomMenuOpen] = useState(false);
  const toggleBomMenu = useCallback(() => setBomMenuOpen((v) => !v), []);

  // ── 3D viewer toggle (Phase 3.A.viewer-integration) ──────────────────
  //
  // Default off so the modal's existing 2D parts-list / mates-list layout
  // is unchanged for users (and the 194 existing modal tests) that don't
  // opt in. When ON we mount {@link Assembly3DViewer} between the parts
  // panel and the mates panel, sharing the `selectedPartId` state with the
  // 2D parts list so a click in either surface highlights the other.
  const [show3DView, setShow3DView] = useState<boolean>(false);
  const toggle3DView = useCallback(() => setShow3DView((v) => !v), []);

  /**
   * Currently-selected partId, shared between the 2D parts list and the
   * 3D viewer. `null` means "no selection". Click on a 2D part row or a
   * 3D mesh sets this; clearing happens implicitly when the highlighted
   * part is removed (handled in `removePartLocal`).
   */
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const onSelectPartFromViewer = useCallback((partId: string) => {
    setSelectedPartId((prev) => (prev === partId ? null : partId));
  }, []);
  const onSelectPartFromList = useCallback((partId: string) => {
    setSelectedPartId((prev) => (prev === partId ? null : partId));
  }, []);

  // ── AI panel (UUUUU Agent integration, Phase 3.A.UUUUU-integration) ──
  //
  // Default off so the modal's existing layout + the 210 pre-existing
  // modal tests are untouched for every consumer that hasn't opted in.
  // Distinct from `aiBuilderOn` (NNNN inline 2-pattern NL builder): this
  // hosts the richer standalone {@link AssemblyAiPanel} (VVVV regex+LLM
  // intent pipeline) in a side slot so the user can choose between the
  // quick footer NL line or the full-featured panel with plan preview.
  const [aiPanelOn, setAiPanelOn] = useState<boolean>(false);
  const toggleAiPanel = useCallback(() => setAiPanelOn((v) => !v), []);

  /**
   * AssemblyAiPanel.onBuildAssembly handler. Translates an {@link
   * AssemblyPlan} (stacked | grid | ring | pair) into PartInstance + Mate
   * appends and lands the whole batch as a single history entry so the
   * user can Ctrl+Z back to the pre-AI state. Mirrors the part / mate id
   * picking logic of the existing inline NL builder so the two paths
   * produce visually identical assemblies for the patterns they both
   * support; ring + pair are exclusive to this richer panel.
   *
   * recordChange policy: ONE history entry per AI submit so Undo restores
   * the whole AI-generated batch in one click (matches the inline NL
   * builder's policy).
   */
  const onBuildAssemblyFromPlan = useCallback(
    (plan: AssemblyPlan) => {
      if (plan.kind === 'unparsed') return;
      const base = overrideState ?? history.state;
      const takenPartIds = new Set(base.parts.map((p) => p.id));
      const takenMateIds = new Set(base.mates.map((m) => m.id));
      let partIdx = base.parts.length + 1;
      let mateIdx = base.mates.length + 1;
      const newParts: PartInstance[] = [];
      const newMates: Mate[] = [];

      function freshMateId(): string {
        while (true) {
          const mid = `mate_${mateIdx++}`;
          if (!takenMateIds.has(mid)) {
            takenMateIds.add(mid);
            return mid;
          }
        }
      }

      if (plan.kind === 'stacked') {
        const spacing = plan.spacing ?? 10;
        for (let i = 0; i < plan.count; i++) {
          const picked = pickFreshPartId(takenPartIds, partIdx);
          partIdx = picked.nextIdx;
          takenPartIds.add(picked.id);
          const isFirst = base.parts.length === 0 && i === 0;
          newParts.push({
            id: picked.id,
            name: `Part ${picked.id.replace(/^part_/, '')}`,
            partTemplateId: picked.id,
            position: { x: 0, y: 0, z: i * spacing },
            orientation: IDENTITY_QUAT,
            fixed: isFirst,
          });
        }
        for (let i = 0; i < newParts.length - 1; i++) {
          const a = newParts[i]!;
          const b = newParts[i + 1]!;
          newMates.push({
            id: freshMateId(),
            kind: 'concentric',
            a: { partId: a.id, refId: 'z_axis', refKind: 'axis' },
            b: { partId: b.id, refId: 'z_axis', refKind: 'axis' },
          });
        }
      } else if (plan.kind === 'grid') {
        const spacing = plan.spacing ?? 10;
        for (let r = 0; r < plan.rows; r++) {
          for (let c = 0; c < plan.cols; c++) {
            const picked = pickFreshPartId(takenPartIds, partIdx);
            partIdx = picked.nextIdx;
            takenPartIds.add(picked.id);
            const isFirst = base.parts.length === 0 && r === 0 && c === 0;
            newParts.push({
              id: picked.id,
              name: `Part ${picked.id.replace(/^part_/, '')}`,
              partTemplateId: picked.id,
              position: { x: c * spacing, y: r * spacing, z: 0 },
              orientation: IDENTITY_QUAT,
              fixed: isFirst,
            });
          }
        }
      } else if (plan.kind === 'ring') {
        const radius = plan.radius ?? 50;
        for (let i = 0; i < plan.count; i++) {
          const theta = (2 * Math.PI * i) / plan.count;
          const picked = pickFreshPartId(takenPartIds, partIdx);
          partIdx = picked.nextIdx;
          takenPartIds.add(picked.id);
          const isFirst = base.parts.length === 0 && i === 0;
          newParts.push({
            id: picked.id,
            name: `Part ${picked.id.replace(/^part_/, '')}`,
            partTemplateId: picked.id,
            position: {
              x: radius * Math.cos(theta),
              y: radius * Math.sin(theta),
              z: 0,
            },
            orientation: IDENTITY_QUAT,
            fixed: isFirst,
          });
        }
      } else if (plan.kind === 'pair') {
        for (let i = 0; i < 2; i++) {
          const picked = pickFreshPartId(takenPartIds, partIdx);
          partIdx = picked.nextIdx;
          takenPartIds.add(picked.id);
          const isFirst = base.parts.length === 0 && i === 0;
          newParts.push({
            id: picked.id,
            name: `Part ${picked.id.replace(/^part_/, '')}`,
            partTemplateId: picked.id,
            position: { x: i * 10, y: 0, z: 0 },
            orientation: IDENTITY_QUAT,
            fixed: isFirst,
          });
        }
        const a = newParts[0]!;
        const b = newParts[1]!;
        // pair plans always carry one of the 3 vocabulary mates
        // (concentric / coincident / hinge). z_axis is the canonical
        // shared ref every part exposes.
        newMates.push({
          id: freshMateId(),
          kind: plan.mate,
          a: { partId: a.id, refId: 'z_axis', refKind: 'axis' },
          b: { partId: b.id, refId: 'z_axis', refKind: 'axis' },
        });
      }

      if (newParts.length === 0 && newMates.length === 0) return;
      const description = `AI panel: ${plan.kind} → +${newParts.length} parts, +${newMates.length} mates`;
      recordState(
        (prev) => ({
          parts: [...prev.parts, ...newParts],
          mates: [...prev.mates, ...newMates],
        }),
        description,
      );
    },
    [overrideState, history.state, recordState],
  );

  // ── Part manipulator gizmo (RRRRR Agent integration) ──────────────────
  //
  // The gizmo only mounts when both `show3DView` is ON and a part is
  // selected. We expose a translate/rotate mode picker so the user can
  // flip between XYZ arrows and XYZ rings without dropping their
  // selection.
  //
  // Phase 1 simulation: Assembly3DViewer.tsx is intentionally untouched
  // (DO NOT modify constraint), so we cannot reach into its sceneRef /
  // cameraRef / renderer DOM element. Instead we pass a tiny stub scene
  // (`{} as THREE.Scene`) that satisfies the gizmo's `Boolean(selectedPart
  // && scene)` render gate, and OMIT camera + domElement so the gizmo's
  // internal TransformControls construction is skipped (the gizmo's own
  // `if (camera && domElement)` guard handles this). The visible DOM
  // marker still mounts, and `onTransform` is fully wired — tests that
  // want to assert state changes can call it directly via the gizmo's
  // mock pose-end events (or in this batch, by simulating onTransform
  // through the modal's wrapper API).
  //
  // The phase-2 follow-up will either add a `viewerRef` prop to
  // Assembly3DViewer or render the gizmo inside the viewer itself.
  const [gizmoMode, setGizmoMode] = useState<PartManipulatorMode>('translate');
  const stubGizmoScene = useMemo(
    // Cast through unknown so we don't pull `three` into the modal's import
    // graph just for a sentinel. The gizmo only reads `.add?.()` / `.remove?.()`
    // off the scene, both of which optional-chain on missing methods.
    () => ({}) as unknown as import('three').Scene,
    [],
  );

  const selectedPart = useMemo<PartInstance | null>(() => {
    if (selectedPartId === null) return null;
    return state.parts.find((p) => p.id === selectedPartId) ?? null;
  }, [selectedPartId, state.parts]);

  /**
   * PartManipulatorGizmo.onTransform handler. Records a single history
   * entry per drag-end so Undo restores the prior pose in one click. We
   * push through `history.recordChange` directly (not via setStateDirect)
   * because pose moves are user-initiated and meaningful enough to
   * deserve a stack entry. The gizmo already snapped to grid before
   * calling, so we trust the inputs verbatim.
   *
   * recordChange policy: one history entry per gizmo drag-end. The IR's
   * `validateAssembly` is invoked on the way through; a pose change can't
   * make the assembly IR-invalid (geometry-only), so it always succeeds.
   */
  const onGizmoTransform = useCallback(
    (partId: string, position: Vec3, orientation: Quat) => {
      recordState(
        (prev) => ({
          ...prev,
          parts: prev.parts.map((p) =>
            p.id === partId ? { ...p, position, orientation } : p,
          ),
        }),
        `Gizmo: move ${partId}`,
      );
    },
    [recordState],
  );

  const downloadBom = useCallback(
    (format: 'csv' | 'json') => {
      const assemblyName = projectId ?? 'assembly';
      const bom = buildBom(state, {
        assemblyName,
        featureTrees,
      });
      const body = format === 'csv' ? bomToCsv(bom) : bomToJson(bom);
      const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
      const blob = new Blob([body], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${assemblyName}-bom.${format}`;
      // Some browsers / jsdom skip the navigation unless the anchor is
      // briefly in the DOM. Append → click → remove keeps the side
      // effects scoped to this function.
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBomMenuOpen(false);
    },
    [projectId, state, featureTrees],
  );

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

  // ── keyboard shortcuts: Ctrl+Z (undo), Ctrl+Y / Ctrl+Shift+Z (redo) ────
  //
  // Scope: window-level keydown listener active while the modal is mounted.
  // We deliberately do NOT swallow the keystroke when focus is inside a
  // text-editing widget (input / textarea / contenteditable) — browser-native
  // undo/redo on those fields is the user's expectation and overriding it
  // would feel hostile. The modal-level shortcut therefore only fires when
  // focus is on the document body or a non-editing element.
  const onUndo = history.undo;
  const onRedo = history.redo;
  const canUndo = history.canUndo;
  const canRedo = history.canRedo;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          onUndo();
        }
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (canRedo) {
          e.preventDefault();
          onRedo();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onUndo, onRedo, canUndo, canRedo]);

  // ── Phase 5.2.4 on-mount auto-inference ────────────────────────────────
  //
  // When the wrapping page sets `autoInferOnMount` (e.g., after a
  // sample-loader change OR after a STEP import that remounts the modal
  // with the imported state), AND the user's `autoInfer` preference is
  // on, AND there are at least 2 parts + 1 FeatureTree to chew on, we
  // run inference once. The `autoInferRanRef` guard prevents the effect
  // from re-firing on later re-renders even if the deps change — to
  // re-trigger, the parent must remount the modal (key change), which
  // is what `_content.tsx` already does on sample-change.
  //
  // We deliberately read the latest `state` / `featureTrees` from refs
  // captured at effect-execution time rather than putting them in the
  // dep array — adding them would let any unrelated edit re-fire the
  // effect, which is exactly the spam behaviour we're avoiding.
  const stateRef = useRef(state);
  const featureTreesRef = useRef(featureTrees);
  const onInferMatesRef = useRef(onInferMates);
  useEffect(() => {
    stateRef.current = state;
    featureTreesRef.current = featureTrees;
    onInferMatesRef.current = onInferMates;
  });
  const autoInferRanRef = useRef(false);
  useEffect(() => {
    if (autoInferRanRef.current) return;
    if (!autoInferOnMount) return;
    if (!autoInfer) return;
    const s = stateRef.current;
    const trees = featureTreesRef.current;
    if (s.parts.length < 2) return;
    if (Object.keys(trees).length === 0) return;
    autoInferRanRef.current = true;
    const { partFaces, partAxes } = derivePartGeometryForAssembly(s.parts, trees);
    const fn = onInferMatesRef.current;
    const inferred = fn
      ? fn(s, partFaces, partAxes)
      : inferMatesFromPlacements(s, partFaces, partAxes);
    const existingMateIds = new Set(s.mates.map((m) => m.id));
    const filtered = inferred.filter((m) => !existingMateIds.has(m.id));
    setSuggestions(filtered);
    setHasInferred(true);
    setImportToast({ parts: s.parts.length, mates: filtered.length });
  }, [autoInferOnMount, autoInfer]);

  // Auto-dismiss the import toast after a short delay. Stays mounted
  // forever if the user disables the timer by hovering an interaction
  // (we keep this simple — just a fixed 6 s window).
  useEffect(() => {
    if (importToast === null) return;
    const id = setTimeout(() => setImportToast(null), IMPORT_TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [importToast]);

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
          data-testid="solver-assembly-3d-toggle-wrap"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={toggle3DView}
            data-testid="solver-assembly-3d-toggle"
            aria-pressed={show3DView}
            title={show3DView ? t.hide3DView : t.show3DView}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              background: show3DView ? '#ecfdf5' : '#fff',
              color: show3DView ? '#065f46' : '#374151',
              border: `1px solid ${show3DView ? '#6ee7b7' : '#d1d5db'}`,
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {show3DView ? t.hide3DView : t.show3DView}
          </button>
          <button
            type="button"
            onClick={toggleAiPanel}
            data-testid="solver-assembly-ai-panel-toggle"
            aria-pressed={aiPanelOn}
            title={aiPanelOn ? t.hideAiPanel : t.aiPanel}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              background: aiPanelOn ? '#eff6ff' : '#fff',
              color: aiPanelOn ? '#1e40af' : '#374151',
              border: `1px solid ${aiPanelOn ? '#93c5fd' : '#d1d5db'}`,
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {aiPanelOn ? t.hideAiPanel : t.aiPanel}
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: show3DView ? '1fr 420px 1.4fr' : '1fr 1.4fr',
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
                  const isSelectedPart = selectedPartId === p.id;
                  return (
                    <div
                      key={p.id}
                      data-testid={`solver-assembly-part-row-${p.id}`}
                      data-selected={isSelectedPart ? 'true' : undefined}
                      onClick={(e) => {
                        // Only "select" the part when the click landed on the
                        // row chrome itself, not on an interactive descendant
                        // (input / select / button / textarea / label). Those
                        // already do their own thing and folding them into
                        // selection would feel hostile.
                        const tag = (e.target as HTMLElement).tagName;
                        if (
                          tag === 'INPUT' ||
                          tag === 'SELECT' ||
                          tag === 'BUTTON' ||
                          tag === 'TEXTAREA' ||
                          tag === 'LABEL' ||
                          tag === 'OPTION'
                        ) {
                          return;
                        }
                        onSelectPartFromList(p.id);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: '4px 6px',
                        border: `1px solid ${isSelectedPart ? '#10b981' : '#f3f4f6'}`,
                        background: isSelectedPart ? '#ecfdf5' : 'transparent',
                        borderRadius: 4,
                        cursor: 'pointer',
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
                      {aiBuilderOn && (
                        <div
                          data-testid={`solver-assembly-part-${p.id}-ai-planner`}
                          style={{ marginTop: 4 }}
                        >
                          <FeatureTreePlannerPanel
                            lang={lang}
                            currentTree={featureTrees[p.id] ?? { nodes: [] }}
                            onApply={(steps) =>
                              applyPlanStepsToPartTree(p.id, steps)
                            }
                          />
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

          {/* ── MIDDLE: 3D viewer (Phase 3.A.viewer-integration) ────── */}
          {show3DView && (
            <section
              data-testid="solver-assembly-3d-panel"
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 280,
                position: 'relative',
              }}
            >
              <Assembly3DViewer
                state={state}
                featureTrees={featureTrees}
                selectedPartId={selectedPartId ?? undefined}
                onSelectPart={onSelectPartFromViewer}
                width={400}
                height={400}
                lang={lang}
              />
              {/* ── RRRRR Agent: PartManipulatorGizmo integration ──
                  Only when a part is selected. The gizmo's render gate is
                  Boolean(selectedPart && scene); we pass a stub scene so
                  the DOM marker mounts (camera + dom are omitted so the
                  internal TransformControls path is skipped — that path
                  needs hooks into the viewer's renderer which we can't
                  add without modifying Assembly3DViewer). */}
              {selectedPart !== null && (
                <>
                  <div
                    data-testid="solver-assembly-gizmo-mode-bar"
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      fontSize: 11,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ color: '#374151' }}>{t.gizmoModeLabel}:</span>
                    <button
                      type="button"
                      onClick={() => setGizmoMode('translate')}
                      data-testid="solver-assembly-gizmo-mode-translate"
                      aria-pressed={gizmoMode === 'translate'}
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        background: gizmoMode === 'translate' ? '#1e40af' : '#fff',
                        color: gizmoMode === 'translate' ? '#fff' : '#374151',
                        border: '1px solid #93c5fd',
                        borderRadius: 3,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {t.gizmoModeTranslate}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGizmoMode('rotate')}
                      data-testid="solver-assembly-gizmo-mode-rotate"
                      aria-pressed={gizmoMode === 'rotate'}
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        background: gizmoMode === 'rotate' ? '#1e40af' : '#fff',
                        color: gizmoMode === 'rotate' ? '#fff' : '#374151',
                        border: '1px solid #93c5fd',
                        borderRadius: 3,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {t.gizmoModeRotate}
                    </button>
                  </div>
                  <PartManipulatorGizmo
                    selectedPart={selectedPart}
                    scene={stubGizmoScene}
                    onTransform={onGizmoTransform}
                    mode={gizmoMode}
                  />
                </>
              )}
            </section>
          )}

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

                      {vSpec.needed && (() => {
                        // Inline value editor (MMMM pattern mirrored from
                        // SketchConstraintOverlay). When a draft exists,
                        // the input shows the user's raw text and turns
                        // red on invalid; absent a draft, it reflects the
                        // canonical mate value. Enter commits via
                        // `recordChange` so Ctrl+Z restores the prior
                        // value. Esc + onBlur discard the draft.
                        const draft = mateValueDraft[m.id];
                        const displayValue =
                          draft !== undefined ? draft.raw : String(v ?? 0);
                        const invalid = draft?.invalid === true;
                        return (
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
                              value={displayValue}
                              aria-label={`${t.value} ${m.id}`}
                              aria-invalid={invalid || undefined}
                              data-testid={`solver-assembly-mate-value-${m.id}`}
                              data-mate-value-invalid={invalid ? 'true' : undefined}
                              onChange={(e) =>
                                onMateValueChange(m.id, m.kind, e.target.value)
                              }
                              onDoubleClick={(e) => {
                                // Double-click selects the existing text +
                                // ensures we're in edit mode so the user
                                // can immediately type the new value.
                                if (draft === undefined) {
                                  beginMateValueEdit(m.id, v ?? 0);
                                }
                                (e.currentTarget as HTMLInputElement).select();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (draft === undefined) {
                                    // Enter with no draft = no-op; just
                                    // blur to mirror native number input.
                                    return;
                                  }
                                  commitMateValueEdit(m.id);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  cancelMateValueEdit(m.id);
                                }
                              }}
                              step="0.1"
                              style={{
                                flex: 1,
                                fontSize: 11,
                                padding: 3,
                                border: `1px solid ${
                                  invalid ? '#fca5a5' : '#d1d5db'
                                }`,
                                background: invalid ? '#fef2f2' : '#fff',
                                borderRadius: 3,
                              }}
                            />
                            <span style={{ color: '#6b7280' }}>{vSpec.label}</span>
                          </label>
                        );
                      })()}
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

        {/* ── UUUUU Agent: AssemblyAiPanel mount ───────────────────
            Rendered as a horizontal strip immediately below the main
            grid (no extra column to avoid breaking the existing 2D ↔ 3D
            layout). Mounts only when the user clicks the panel toggle in
            the top-bar — default off so the modal layout is unchanged
            for the 210 pre-existing tests. */}
        {aiPanelOn && (
          <div
            data-testid="solver-assembly-ai-panel-host"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <AssemblyAiPanel lang={lang} onBuildAssembly={onBuildAssemblyFromPlan} />
          </div>
        )}

        {/* ── auto-infer summary toast (Phase 5.2.4) ──────────────── */}
        {importToast !== null && (
          <div
            data-testid="solver-assembly-import-toast"
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              padding: '8px 12px',
              background: '#ecfdf5',
              color: '#065f46',
              border: '1px solid #6ee7b7',
              borderRadius: 4,
            }}
          >
            <span data-testid="solver-assembly-import-toast-text" style={{ flex: 1 }}>
              {t.inferredSummary(importToast.parts, importToast.mates)}
            </span>
            <button
              type="button"
              data-testid="solver-assembly-import-toast-dismiss"
              onClick={dismissImportToast}
              aria-label={t.dismissToast}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: '#fff',
                border: '1px solid #6ee7b7',
                color: '#065f46',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {t.dismissToast}
            </button>
          </div>
        )}

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                {solveState.result.solverUsed && (
                  <span
                    data-testid="solver-assembly-solve-solver-used"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: '#e0e7ff',
                      color: '#3730a3',
                      border: '1px solid #c7d2fe',
                    }}
                  >
                    {t.solverUsedLabel}: {solveState.result.solverUsed}
                  </span>
                )}
              </div>
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

        {/* ── STEP assembly import panel (Phase 4.B) ──────────────── */}
        <div
          data-testid="solver-assembly-import-section"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {importState.status === 'loading' && (
            <div
              data-testid="solver-assembly-import-loading"
              style={{
                fontSize: 12,
                color: '#6b7280',
                padding: 8,
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 4,
              }}
            >
              {t.importingAssembly} ({importState.fileName})
            </div>
          )}
          {importState.status === 'error' && (
            <div
              data-testid="solver-assembly-import-error"
              role="alert"
              data-http-status={importState.httpStatus}
              style={{
                fontSize: 12,
                color: '#b91c1c',
                padding: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 4,
              }}
            >
              {importState.message}
            </div>
          )}
          {importState.status === 'ok' && (
            <div
              data-testid="solver-assembly-import-result"
              style={{
                fontSize: 12,
                padding: 8,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div
                data-testid="solver-assembly-import-summary"
                style={{ fontWeight: 600, color: '#065f46' }}
              >
                {t.importedSummary(
                  importState.partCount,
                  importState.warnings.length,
                  importState.unsupported.length,
                )}
                <span style={{ fontWeight: 400, color: '#047857', marginInlineStart: 6 }}>
                  ({importState.fileName})
                </span>
              </div>
              {importState.warnings.length > 0 && (
                <div data-testid="solver-assembly-import-warnings-wrap">
                  <button
                    type="button"
                    onClick={() => setWarningsOpen((v) => !v)}
                    data-testid="solver-assembly-import-warnings-toggle"
                    aria-expanded={warningsOpen}
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      background: '#fff',
                      border: '1px solid #fbbf24',
                      color: '#92400e',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {warningsOpen ? '▼ ' : '▶ '}
                    {t.warningsList} ({importState.warnings.length})
                  </button>
                  {warningsOpen && (
                    <ul
                      data-testid="solver-assembly-import-warnings-list"
                      style={{
                        listStyle: 'disc',
                        margin: '4px 0 0 18px',
                        padding: 0,
                        fontSize: 11,
                        color: '#78350f',
                        fontFamily: 'monospace',
                      }}
                    >
                      {importState.warnings.map((w, i) => (
                        <li
                          key={`w-${i}`}
                          data-testid={`solver-assembly-import-warning-${i}`}
                        >
                          {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {importState.unsupported.length > 0 && (
                <div data-testid="solver-assembly-import-unsupported-wrap">
                  <button
                    type="button"
                    onClick={() => setUnsupportedOpen((v) => !v)}
                    data-testid="solver-assembly-import-unsupported-toggle"
                    aria-expanded={unsupportedOpen}
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      background: '#fff',
                      border: '1px solid #f87171',
                      color: '#991b1b',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    {unsupportedOpen ? '▼ ' : '▶ '}
                    {t.unsupportedList} ({importState.unsupported.length})
                  </button>
                  {unsupportedOpen && (
                    <ul
                      data-testid="solver-assembly-import-unsupported-list"
                      style={{
                        listStyle: 'disc',
                        margin: '4px 0 0 18px',
                        padding: 0,
                        fontSize: 11,
                        color: '#7f1d1d',
                        fontFamily: 'monospace',
                      }}
                    >
                      {importState.unsupported.map((u, i) => (
                        <li
                          key={`u-${i}`}
                          data-testid={`solver-assembly-import-unsupported-${i}`}
                        >
                          {u}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── history panel (Phase 4.2) ────────────────────────────── */}
        <div
          data-testid="solver-assembly-history-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 8,
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span>{t.historyHeading}</span>
            <span
              data-testid="solver-assembly-history-current"
              style={{
                fontWeight: 400,
                color: '#6b7280',
                fontStyle: 'italic',
              }}
            >
              {history.description}
            </span>
          </div>
          {history.canUndo || history.canRedo ? (
            <ol
              data-testid="solver-assembly-history-list"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {history.history.slice(0, 5).map((entry, idx) => (
                <li
                  key={`${entry.timestamp}-${idx}`}
                  data-testid={`solver-assembly-history-entry-${idx}`}
                  style={{
                    fontSize: 11,
                    color: idx === 0 ? '#111827' : '#6b7280',
                    fontFamily: 'monospace',
                  }}
                >
                  {idx === 0 ? '▶ ' : '  '}
                  {entry.description}
                </li>
              ))}
            </ol>
          ) : (
            <div
              data-testid="solver-assembly-history-empty"
              style={{ fontSize: 11, color: '#9ca3af' }}
            >
              {t.historyEmpty}
            </div>
          )}
        </div>

        {/* ── AI assembly builder (Phase 3.AI.Assembly) ───────────────── */}
        {aiBuilderOn && (
          <div
            data-testid="solver-assembly-ai-builder"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 8,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 4,
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                value={aiInput}
                placeholder={t.createAssemblyPrompt}
                data-testid="solver-assembly-ai-input"
                aria-label={t.aiAssemblyBuilder}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAiAssemblySubmit();
                  }
                }}
                style={{
                  flex: 1,
                  fontSize: 12,
                  padding: 6,
                  border: '1px solid #93c5fd',
                  borderRadius: 4,
                }}
              />
              <button
                type="button"
                onClick={onAiAssemblySubmit}
                data-testid="solver-assembly-ai-submit"
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#2563eb',
                  color: '#fff',
                  border: '1px solid #1d4ed8',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {t.createAssemblySubmit}
              </button>
            </div>
            {aiStatus?.kind === 'unparsed' && (
              <div
                data-testid="solver-assembly-ai-unparsed"
                role="alert"
                style={{
                  fontSize: 11,
                  color: '#b91c1c',
                  padding: '4px 6px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 3,
                }}
              >
                {t.couldNotParse}
              </div>
            )}
            {aiStatus?.kind === 'created' && (
              <div
                data-testid="solver-assembly-ai-created"
                style={{
                  fontSize: 11,
                  color: '#065f46',
                  padding: '4px 6px',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: 3,
                }}
              >
                +{aiStatus.parts} parts, +{aiStatus.mates} mates
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
          <label
            data-testid="solver-assembly-auto-infer-label"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: '#374151',
              padding: '2px 6px',
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              background: '#fafafa',
            }}
            title={t.autoInferLabel}
          >
            <input
              type="checkbox"
              data-testid="solver-assembly-auto-infer"
              checked={autoInfer}
              onChange={(e) => setAutoInfer(e.target.checked)}
            />
            {t.autoInferLabel}
          </label>
          <label
            data-testid="solver-assembly-ai-toggle-label"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: '#374151',
              padding: '2px 6px',
              border: '1px solid #e5e7eb',
              borderRadius: 4,
              background: '#fafafa',
            }}
            title={t.aiAssemblyBuilder}
          >
            <input
              type="checkbox"
              data-testid="solver-assembly-ai-toggle"
              checked={aiBuilderOn}
              onChange={(e) => {
                setAiBuilderOn(e.target.checked);
                // Reset transient NL state when the user closes the panel
                // so a future re-open starts fresh (no stale banner).
                if (!e.target.checked) {
                  setAiStatus(null);
                  setAiInput('');
                }
              }}
            />
            {t.aiAssemblyBuilder}
          </label>
          <button
            type="button"
            onClick={history.undo}
            disabled={!history.canUndo}
            data-testid="solver-assembly-undo"
            title={`${t.undo} (Ctrl+Z)`}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              background: history.canUndo ? '#fff' : '#f3f4f6',
              color: history.canUndo ? '#111827' : '#9ca3af',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: history.canUndo ? 'pointer' : 'not-allowed',
            }}
          >
            {t.undo}
          </button>
          <button
            type="button"
            onClick={history.redo}
            disabled={!history.canRedo}
            data-testid="solver-assembly-redo"
            title={`${t.redo} (Ctrl+Y)`}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              background: history.canRedo ? '#fff' : '#f3f4f6',
              color: history.canRedo ? '#111827' : '#9ca3af',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: history.canRedo ? 'pointer' : 'not-allowed',
            }}
          >
            {t.redo}
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".step,.stp,application/step,model/step"
            data-testid="solver-assembly-import-step-file-input"
            onChange={onImportFileInputChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={onImportButtonClick}
            disabled={importState.status === 'loading'}
            data-testid="solver-assembly-import-step"
            title={t.importStepAssembly}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              background: importState.status === 'loading' ? '#f3f4f6' : '#fff',
              color: importState.status === 'loading' ? '#9ca3af' : '#111827',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: importState.status === 'loading' ? 'not-allowed' : 'pointer',
            }}
          >
            {importState.status === 'loading' ? t.importingAssembly : t.importStepAssembly}
          </button>
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
          <div
            data-testid="solver-assembly-export-bom-wrap"
            style={{ position: 'relative', display: 'inline-block' }}
          >
            <button
              type="button"
              onClick={toggleBomMenu}
              data-testid="solver-assembly-export-bom"
              aria-haspopup="menu"
              aria-expanded={bomMenuOpen}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                background: '#fff',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t.exportBom}
            </button>
            {bomMenuOpen && (
              <div
                data-testid="solver-assembly-export-bom-menu"
                role="menu"
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  right: 0,
                  marginBottom: 4,
                  background: '#fff',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 100,
                  zIndex: 1100,
                }}
              >
                <button
                  type="button"
                  onClick={() => downloadBom('csv')}
                  data-testid="solver-assembly-export-bom-csv"
                  role="menuitem"
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: '#fff',
                    border: 'none',
                    borderBottom: '1px solid #f3f4f6',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {t.bomCsv}
                </button>
                <button
                  type="button"
                  onClick={() => downloadBom('json')}
                  data-testid="solver-assembly-export-bom-json"
                  role="menuitem"
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: '#fff',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {t.bomJson}
                </button>
              </div>
            )}
          </div>
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
          <label
            data-testid="solver-assembly-solver-select-label"
            htmlFor="solver-assembly-solver-select"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: '#374151',
            }}
          >
            {t.solverLabel}
            <select
              id="solver-assembly-solver-select"
              data-testid="solver-assembly-solver-select"
              value={solverSelection}
              onChange={(e) =>
                setSolverSelection(e.target.value as AssemblySolverSelection)
              }
              style={{
                fontSize: 12,
                padding: '4px 6px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: '#fff',
              }}
            >
              <option value="auto">{t.solverAuto}</option>
              <option value="gauss_seidel">{t.solverGaussSeidel}</option>
              <option value="lagrangian">{t.solverLagrangian}</option>
              <option value="adaptive">{t.solverAdaptive}</option>
            </select>
          </label>
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
