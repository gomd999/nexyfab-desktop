'use client';

/**
 * SolverSketchEditorWithExtrude — Phase 2.A wrapper of SolverSketchEditor
 * adding an "Extrude" button + depth/options modal + SCAD/PNG preview pane.
 *
 * Architecture:
 *   - Wraps the unchanged SolverSketchEditor (Phase 1.3 sibling stays as-is).
 *   - Listens to `onSketchChange` to mirror the current sketch state locally.
 *   - "Extrude" button opens a modal with depth + direction + mode inputs.
 *   - On submit: POST /api/extrude-render → renders to SCAD + PNG → shows preview.
 *
 * Test surface (data-testids):
 *   solver-extrude-button, solver-extrude-modal,
 *   solver-extrude-depth-input, solver-extrude-submit, solver-extrude-cancel,
 *   solver-extrude-scad-preview, solver-extrude-png-preview-{idx},
 *   solver-extrude-error.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import SolverSketchEditor, { type SolverSketchEditorProps } from './SolverSketchEditor';
import RevolveModal, { type RevolveFetcher, type RevolveLang } from './RevolveModal';
import type { SweepFetcher, SweepLang } from './SweepModal';
import type { LoftFetcher, LoftLang } from './LoftModal';
import type { PatternFetcher, PatternLang } from './PatternModal';
import type { ShellFetcher, ShellLang } from './ShellModal';
import type { HoleFetcher, HoleWizardLang } from './HoleWizardModal';
import type { FilletFetcher, FilletLang } from './FilletModal';
import type { ChamferFetcher, ChamferLang } from './ChamferModal';
import FeatureTreeView, { type FeatureTreeLang } from './FeatureTreeView';
import type { PlannerLang } from './FeatureTreePlannerPanel';
import type { PlanIntent, PlanStep } from '@/lib/ai/featureTreePlanner';
import type { StepImportFetcher, StepImportLang } from './StepImportModal';
import type { BranchManagerLang } from './FeatureTreeBranchManager';
import type { FeatureTreeStatsLang } from './FeatureTreeStatsPanel';
import type { FeatureTreeOptimizerLang } from './FeatureTreeOptimizerPanel';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import {
  applyBooleanToSketch,
  detectLoopsAsPolygons,
  combineLoops,
  type SketchBooleanOp,
} from '@/lib/sketch/sketchLoopsBoolean';
import type { SketchLoop } from '@/lib/sketch/sketchBoolean';
import type { ExtrudeDirection, ExtrudeMode } from '@/lib/cad/extrudeProfile';
import type { AxisLine2D } from '@/lib/cad/revolveProfile';
import {
  type FeatureKind,
  type FeatureNode,
  type FeatureTree,
} from '@/lib/cad/featureTree';
import { applyEdit, FeatureTreeEditError, type EditOp } from '@/lib/cad/featureTreeEdit';
import {
  serializeFeatureTree,
  writeToStorage,
  type SaveError,
} from '@/lib/cad/featureTreePersist';
import { useFeatureTreeHistory } from '@/lib/cad/featureTreeHistory';
import { useCrdtDoc } from '@/lib/collab/useCrdtDoc';
import { CursorOverlay, colorForUserId } from '@/app/[lang]/shape-generator/_shared/CursorOverlay';
import { CollabStatusBadge } from '@/app/[lang]/shape-generator/_shared/CollabStatusBadge';

// StlViewer pulls in Three.js + STLLoader; dynamic-loaded to keep the
// Sketch editor bundle small for users who never click Extrude.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>3D viewer loading…</div>,
});

// Sweep / Loft / Pattern modals are also dynamic-loaded so the wrapper
// bundle stays small for users who never open them. Each modal pulls in
// its own copy of the StlViewer dynamic chunk, but only when first opened.
const SweepModal = dynamic(() => import('./SweepModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const LoftModal = dynamic(() => import('./LoftModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const PatternModal = dynamic(() => import('./PatternModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const ShellModal = dynamic(() => import('./ShellModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const HoleWizardModal = dynamic(() => import('./HoleWizardModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const FilletModal = dynamic(() => import('./FilletModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const ChamferModal = dynamic(() => import('./ChamferModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
const StepImportModal = dynamic(() => import('./StepImportModal'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
// FeatureTreePlannerPanel (Phase 3.AI.UI) — dynamic-loaded so users who
// never toggle the AI panel pay no bundle cost. Default state below is
// `showPlanner=false` so the chunk only loads on click.
const FeatureTreePlannerPanel = dynamic(() => import('./FeatureTreePlannerPanel'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
// IntentExamplesPanel (Phase 3.AI.UI helper) — surfaces INTENT_EXAMPLES
// as click-to-insert chips. Hidden by default (chunk loads only after the
// "Show examples" toggle is clicked).
const IntentExamplesPanel = dynamic(() => import('./IntentExamplesPanel'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
});
// FeatureTreeBranchManager (Agent-YYYYY) — standalone panel for snapshot /
// load / diff / merge / delete of whole-tree branches. Hidden by default
// (chunk loads only after the "Branches" toggle is clicked); kept fully
// independent of the collab / AI planner / examples toggles per the
// orthogonality contract in the task description.
const FeatureTreeBranchManager = dynamic(
  () => import('./FeatureTreeBranchManager'),
  {
    ssr: false,
    loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
  },
);
// FeatureTreeStatsPanel (Agent-EEEEEE) — surfaces aggregate + selected-node
// stats (volume/area/bbox/mass/...) for the live FeatureTree. Hidden by
// default (chunk loads only after the "Stats" toggle is clicked); kept
// fully independent of the collab / AI planner / examples / branches
// toggles per the orthogonality contract — all five can be on at once.
const FeatureTreeStatsPanel = dynamic(
  () => import('./FeatureTreeStatsPanel'),
  {
    ssr: false,
    loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
  },
);
// FeatureTreeOptimizerPanel (B31.5 wrapper integration) — surfaces the
// non-destructive whole-tree GC pass (remove suppressed / orphans / merge
// patterns) next to the live FeatureTreeView. Hidden by default (chunk
// loads only after the "Optimize" toggle is clicked); kept fully
// independent of every other toggle per the orthogonality contract — all
// six can be on at once.
const FeatureTreeOptimizerPanel = dynamic(
  () => import('./FeatureTreeOptimizerPanel'),
  {
    ssr: false,
    loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>loading…</div>,
  },
);

type Lang = NonNullable<SolverSketchEditorProps['lang']>;

interface Dict {
  extrude: string;
  revolve: string;
  sweep: string;
  loft: string;
  pattern: string;
  shell: string;
  hole: string;
  fillet: string;
  chamfer: string;
  importStep: string;
  importModeLabel: string;
  importModeReplace: string;
  importModeMerge: string;
  modalTitle: string;
  depth: string;
  direction: string;
  mode: string;
  draft: string;
  oneSided: string; twoSided: string; midplane: string;
  add: string; cut: string;
  submit: string; cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  errorPrefix: string;
  errorDepthInvalid: string;
  /** Persistence (Phase 2.8) — shown when a projectId is provided. */
  savedAt: string;
  saveError: string;
  reset: string;
  /** Undo / redo (Phase 2.7.1 — featureTreeHistory integration). */
  undo: string;
  redo: string;
  /** AI Planner panel toggle (Phase 3.AI.UI). */
  aiPlanner: string;
  showPlanner: string;
  hidePlanner: string;
  /** Toast surface after Plan apply. `{N}` is replaced with the node count. */
  plannerToast: string;
  /** IntentExamplesPanel toggle (Phase 3.AI.UI helper). */
  showExamples: string;
  hideExamples: string;
  /** Collab mode (Phase 1 wiring of useCrdtDoc + CursorOverlay). */
  collabMode: string;
  collabConnected: string;
  /** `{N}` placeholder for peer count. */
  collabPeers: string;
  /** Branches panel toggle (Agent-YYYYY — FeatureTreeBranchManager wiring). */
  branches: string;
  branchesToggle: string;
  /** Stats panel toggle (Agent-EEEEEE — FeatureTreeStatsPanel wiring). */
  stats: string;
  showStats: string;
  hideStats: string;
  /** Optimizer panel toggle (B31.5 — FeatureTreeOptimizerPanel wiring). */
  optimizeTree: string;
  hideOptimize: string;
  /** Multi-loop boolean integration (sketchBoolean → ExtrudeModal). `{N}` is loop count. */
  multipleLoopsDetected: string;
  booleanOp: string;
  opUnion: string;
  opSubtract: string;
  opIntersect: string;
  opSeparate: string;
  /** Surfaced when the chosen boolean op collapses every loop (e.g., intersect of disjoint inputs). */
  booleanEmptyWarning: string;
  /** Preview heading above the combined SVG. */
  booleanPreviewHeading: string;
}

const dict: Record<Lang, Dict> = {
  ko: {
    extrude: '돌출', revolve: '회전', sweep: '스윕', loft: '로프트', pattern: '패턴', shell: '쉘', hole: '구멍', fillet: '필렛', chamfer: '모따기',
    importStep: 'STEP 가져오기', importModeLabel: '가져오기 모드',
    importModeReplace: '교체', importModeMerge: '병합',
    modalTitle: '돌출 설정', depth: '깊이 (mm)', direction: '방향', mode: '연산', draft: '드래프트 각도(°)',
    oneSided: '한 방향', twoSided: '양 방향', midplane: '중심면',
    add: '추가', cut: '제거',
    submit: '돌출', cancel: '취소',
    rendering: '렌더링 중...', scadHeading: 'SCAD 소스', pngHeading: '미리보기',
    errorPrefix: '오류',
    errorDepthInvalid: '깊이는 0보다 커야 합니다',
    savedAt: '저장됨',
    saveError: '저장 실패',
    reset: '초기화',
    undo: '실행 취소',
    redo: '다시 실행',
    aiPlanner: 'AI 플래너',
    showPlanner: 'AI 플래너 표시',
    hidePlanner: 'AI 플래너 숨기기',
    plannerToast: '계획 적용 완료 ({N}개 노드 추가)',
    showExamples: '예시 표시',
    hideExamples: '예시 숨기기',
    collabMode: '협업 모드',
    collabConnected: '연결됨',
    collabPeers: '{N}명 접속 중',
    branches: '브랜치',
    branchesToggle: '브랜치 패널 표시',
    stats: '통계',
    showStats: '통계 표시',
    hideStats: '통계 숨기기',
    optimizeTree: '최적화',
    hideOptimize: '최적화 숨기기',
    multipleLoopsDetected: '여러 폐곡선 감지 ({N}개)',
    booleanOp: '불리언 연산',
    opUnion: '합집합',
    opSubtract: '차집합',
    opIntersect: '교집합',
    opSeparate: '개별 유지',
    booleanEmptyWarning: '선택한 연산의 결과가 비었습니다 — 다른 연산을 선택하세요.',
    booleanPreviewHeading: '결합 결과 미리보기',
  },
  en: {
    extrude: 'Extrude', revolve: 'Revolve', sweep: 'Sweep', loft: 'Loft', pattern: 'Pattern', shell: 'Shell', hole: 'Hole', fillet: 'Fillet', chamfer: 'Chamfer',
    importStep: 'Import STEP', importModeLabel: 'Import mode',
    importModeReplace: 'Replace', importModeMerge: 'Merge',
    modalTitle: 'Extrude options', depth: 'Depth (mm)', direction: 'Direction', mode: 'Mode', draft: 'Draft angle (°)',
    oneSided: 'One-sided', twoSided: 'Two-sided', midplane: 'Midplane',
    add: 'Add', cut: 'Cut',
    submit: 'Extrude', cancel: 'Cancel',
    rendering: 'Rendering...', scadHeading: 'SCAD source', pngHeading: 'Preview',
    errorPrefix: 'Error',
    errorDepthInvalid: 'depth must be > 0',
    savedAt: 'Saved',
    saveError: 'Save failed',
    reset: 'Reset',
    undo: 'Undo',
    redo: 'Redo',
    aiPlanner: 'AI Planner',
    showPlanner: 'Show AI Planner',
    hidePlanner: 'Hide AI Planner',
    plannerToast: 'Plan applied ({N} nodes added)',
    showExamples: 'Show examples',
    hideExamples: 'Hide examples',
    collabMode: 'Collab mode',
    collabConnected: 'Connected',
    collabPeers: '{N} peers',
    branches: 'Branches',
    branchesToggle: 'Show branches panel',
    stats: 'Stats',
    showStats: 'Show stats',
    hideStats: 'Hide stats',
    optimizeTree: 'Optimize',
    hideOptimize: 'Hide optimize',
    multipleLoopsDetected: 'Multiple loops detected ({N})',
    booleanOp: 'Boolean op',
    opUnion: 'Union',
    opSubtract: 'Subtract',
    opIntersect: 'Intersect',
    opSeparate: 'All separate',
    booleanEmptyWarning: 'Selected operation produced an empty result — try another op.',
    booleanPreviewHeading: 'Combined preview',
  },
  ja: {
    extrude: '押し出し', revolve: '回転', sweep: 'スイープ', loft: 'ロフト', pattern: 'パターン', shell: 'シェル', hole: '穴', fillet: 'フィレット', chamfer: '面取り',
    importStep: 'STEPインポート', importModeLabel: 'インポートモード',
    importModeReplace: '置換', importModeMerge: 'マージ',
    modalTitle: '押し出し設定', depth: '深さ (mm)', direction: '方向', mode: '操作', draft: 'ドラフト角度(°)',
    oneSided: '片側', twoSided: '両側', midplane: '中央面',
    add: '追加', cut: '除去',
    submit: '押し出し', cancel: 'キャンセル',
    rendering: 'レンダリング中...', scadHeading: 'SCADソース', pngHeading: 'プレビュー',
    errorPrefix: 'エラー',
    errorDepthInvalid: '深さは 0 より大きい必要があります',
    savedAt: '保存済み',
    saveError: '保存失敗',
    reset: 'リセット',
    undo: '元に戻す',
    redo: 'やり直す',
    aiPlanner: 'AIプランナー',
    showPlanner: 'AIプランナーを表示',
    hidePlanner: 'AIプランナーを隠す',
    plannerToast: 'プラン適用完了 ({N}個のノード追加)',
    showExamples: '例を表示',
    hideExamples: '例を隠す',
    collabMode: 'コラボモード',
    collabConnected: '接続済み',
    collabPeers: '{N}人接続中',
    branches: 'ブランチ',
    branchesToggle: 'ブランチパネルを表示',
    stats: '統計',
    showStats: '統計を表示',
    hideStats: '統計を隠す',
    optimizeTree: '最適化',
    hideOptimize: '最適化を隠す',
    multipleLoopsDetected: '複数の閉ループを検出 ({N})',
    booleanOp: 'ブール演算',
    opUnion: '和',
    opSubtract: '差',
    opIntersect: '積',
    opSeparate: '個別に保持',
    booleanEmptyWarning: '選択した演算の結果が空です — 別の演算を試してください。',
    booleanPreviewHeading: '結合プレビュー',
  },
  zh: {
    extrude: '拉伸', revolve: '旋转', sweep: '扫掠', loft: '放样', pattern: '阵列', shell: '抽壳', hole: '孔', fillet: '圆角', chamfer: '倒角',
    importStep: '导入 STEP', importModeLabel: '导入模式',
    importModeReplace: '替换', importModeMerge: '合并',
    modalTitle: '拉伸选项', depth: '深度 (mm)', direction: '方向', mode: '模式', draft: '拔模角度(°)',
    oneSided: '单向', twoSided: '双向', midplane: '中面',
    add: '增加', cut: '切除',
    submit: '拉伸', cancel: '取消',
    rendering: '渲染中...', scadHeading: 'SCAD源', pngHeading: '预览',
    errorPrefix: '错误',
    errorDepthInvalid: '深度必须大于 0',
    savedAt: '已保存',
    saveError: '保存失败',
    reset: '重置',
    undo: '撤销',
    redo: '重做',
    aiPlanner: 'AI规划器',
    showPlanner: '显示AI规划器',
    hidePlanner: '隐藏AI规划器',
    plannerToast: '计划已应用 (添加{N}个节点)',
    showExamples: '显示示例',
    hideExamples: '隐藏示例',
    collabMode: '协作模式',
    collabConnected: '已连接',
    collabPeers: '{N}个用户',
    branches: '分支',
    branchesToggle: '显示分支面板',
    stats: '统计',
    showStats: '显示统计',
    hideStats: '隐藏统计',
    optimizeTree: '优化',
    hideOptimize: '隐藏优化',
    multipleLoopsDetected: '检测到多个闭合环 ({N}个)',
    booleanOp: '布尔运算',
    opUnion: '并集',
    opSubtract: '差集',
    opIntersect: '交集',
    opSeparate: '保持独立',
    booleanEmptyWarning: '所选运算结果为空 — 请尝试其他运算。',
    booleanPreviewHeading: '组合预览',
  },
  es: {
    extrude: 'Extruir', revolve: 'Revolver', sweep: 'Barrido', loft: 'Loft', pattern: 'Patrón', shell: 'Vaciar', hole: 'Agujero', fillet: 'Redondeo', chamfer: 'Chaflán',
    importStep: 'Importar STEP', importModeLabel: 'Modo de importación',
    importModeReplace: 'Reemplazar', importModeMerge: 'Combinar',
    modalTitle: 'Opciones de extrusión', depth: 'Profundidad (mm)', direction: 'Dirección', mode: 'Modo', draft: 'Ángulo de salida(°)',
    oneSided: 'Un lado', twoSided: 'Dos lados', midplane: 'Plano medio',
    add: 'Añadir', cut: 'Cortar',
    submit: 'Extruir', cancel: 'Cancelar',
    rendering: 'Renderizando...', scadHeading: 'Fuente SCAD', pngHeading: 'Vista previa',
    errorPrefix: 'Error',
    errorDepthInvalid: 'la profundidad debe ser > 0',
    savedAt: 'Guardado',
    saveError: 'Error al guardar',
    reset: 'Restablecer',
    undo: 'Deshacer',
    redo: 'Rehacer',
    aiPlanner: 'Planificador IA',
    showPlanner: 'Mostrar planificador IA',
    hidePlanner: 'Ocultar planificador IA',
    plannerToast: 'Plan aplicado ({N} nodos añadidos)',
    showExamples: 'Mostrar ejemplos',
    hideExamples: 'Ocultar ejemplos',
    collabMode: 'Modo colaboración',
    collabConnected: 'Conectado',
    collabPeers: '{N} usuarios',
    branches: 'Ramas',
    branchesToggle: 'Mostrar panel de ramas',
    stats: 'Estadísticas',
    showStats: 'Mostrar estadísticas',
    hideStats: 'Ocultar estadísticas',
    optimizeTree: 'Optimizar',
    hideOptimize: 'Ocultar optimización',
    multipleLoopsDetected: 'Se detectaron varios bucles ({N})',
    booleanOp: 'Operación booleana',
    opUnion: 'Unión',
    opSubtract: 'Resta',
    opIntersect: 'Intersección',
    opSeparate: 'Todos por separado',
    booleanEmptyWarning: 'La operación seleccionada produjo un resultado vacío — pruebe otra.',
    booleanPreviewHeading: 'Vista previa combinada',
  },
  ar: {
    extrude: 'بثق', revolve: 'دوران', sweep: 'كنس', loft: 'لوفت', pattern: 'نمط', shell: 'قشرة', hole: 'ثقب', fillet: 'تدوير', chamfer: 'شطف',
    importStep: 'استيراد STEP', importModeLabel: 'وضع الاستيراد',
    importModeReplace: 'استبدال', importModeMerge: 'دمج',
    modalTitle: 'خيارات البثق', depth: 'العمق (مم)', direction: 'الاتجاه', mode: 'الوضع', draft: 'زاوية المسودة(°)',
    oneSided: 'جانب واحد', twoSided: 'جانبان', midplane: 'مستوى متوسط',
    add: 'إضافة', cut: 'قص',
    submit: 'بثق', cancel: 'إلغاء',
    rendering: 'جارٍ التصيير...', scadHeading: 'مصدر SCAD', pngHeading: 'معاينة',
    errorPrefix: 'خطأ',
    errorDepthInvalid: 'يجب أن يكون العمق أكبر من 0',
    savedAt: 'تم الحفظ',
    saveError: 'فشل الحفظ',
    reset: 'إعادة تعيين',
    undo: 'تراجع',
    redo: 'إعادة',
    aiPlanner: 'مخطط الذكاء الاصطناعي',
    showPlanner: 'إظهار مخطط الذكاء الاصطناعي',
    hidePlanner: 'إخفاء مخطط الذكاء الاصطناعي',
    plannerToast: 'تم تطبيق الخطة ({N} عقد مضافة)',
    showExamples: 'إظهار الأمثلة',
    hideExamples: 'إخفاء الأمثلة',
    collabMode: 'وضع التعاون',
    collabConnected: 'متصل',
    collabPeers: '{N} مستخدمين',
    branches: 'الفروع',
    branchesToggle: 'إظهار لوحة الفروع',
    stats: 'إحصائيات',
    showStats: 'إظهار الإحصائيات',
    hideStats: 'إخفاء الإحصائيات',
    optimizeTree: 'تحسين',
    hideOptimize: 'إخفاء التحسين',
    multipleLoopsDetected: 'تم اكتشاف عدة حلقات ({N})',
    booleanOp: 'العملية المنطقية',
    opUnion: 'اتحاد',
    opSubtract: 'طرح',
    opIntersect: 'تقاطع',
    opSeparate: 'كل على حدة',
    booleanEmptyWarning: 'أسفرت العملية المحددة عن نتيجة فارغة — جرّب عملية أخرى.',
    booleanPreviewHeading: 'معاينة مدمجة',
  },
};

interface RenderResult {
  scad: string;
  pngs: { label: string; base64: string }[];
  /** Binary STL bytes as base64 (Phase 2.A.4 — Three.js viewer). */
  stl?: string;
}

type RenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: RenderResult }
  | { status: 'error'; message: string };

interface ExtrudeFetcher {
  (req: {
    sketch: SolverViewState;
    depth: number;
    draftDegrees?: number;
    direction: ExtrudeDirection;
    mode: ExtrudeMode;
    includeStl?: boolean;
  }): Promise<
    | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
    | { ok: false; code: string; message: string }
  >;
}

/**
 * Module-level WeakMap so the wrapper can attach an optional AbortSignal to
 * any fetcher call without changing the public ExtrudeFetcher signature
 * (tests inject mock fetchers that ignore the signal — fine, abort is then
 * best-effort and we just suppress the late setState via the same signal).
 */
const fetcherSignals = new WeakMap<ExtrudeFetcher, AbortSignal>();

const defaultFetcher: ExtrudeFetcher = async (req) => {
  const signal = fetcherSignals.get(defaultFetcher);
  const res = await fetch('/api/extrude-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  return res.json();
};

/**
 * Optional persistence (Phase 2.8). When a `projectId` is supplied, the
 * wrapper switches FeatureTree state from plain in-memory `useState` to
 * `useFeatureTreeStorage('nexyfab:tree:${projectId}')` — auto-load on
 * mount, debounced save (500 ms) on every edit, Reset button to clear.
 *
 * When `projectId` is omitted, the wrapper uses the original in-memory
 * `useState` path verbatim. No localStorage I/O happens — tests written
 * before persistence existed keep passing without changes.
 *
 * Implementation note: React rules-of-hooks forbid conditional hook calls,
 * so we always call BOTH hooks and pick the active branch by `useMemo`.
 * The unused branch holds its empty initial state and never advances, so
 * the cost is one extra `useState` allocation per render.
 */
const STORAGE_KEY_PREFIX = 'nexyfab:tree:';

export interface SolverSketchEditorWithExtrudeProps extends SolverSketchEditorProps {
  /**
   * Optional project identifier. When provided the FeatureTree is
   * persisted to `localStorage['nexyfab:tree:${projectId}']` with a 500 ms
   * debounced auto-save (see useFeatureTreeStorage). When absent the
   * wrapper stays on its original in-memory state (100 % back-compat).
   */
  projectId?: string;
  /** Injectable fetcher for tests. Defaults to POST /api/extrude-render. */
  extrudeFetcher?: ExtrudeFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/revolve-render. */
  revolveFetcher?: RevolveFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/sweep-render. */
  sweepFetcher?: SweepFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/loft-render. */
  loftFetcher?: LoftFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/pattern-render. */
  patternFetcher?: PatternFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/shell-render. */
  shellFetcher?: ShellFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/hole-render. */
  holeFetcher?: HoleFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/fillet-render. */
  filletFetcher?: FilletFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/chamfer-render. */
  chamferFetcher?: ChamferFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/step-import. */
  stepImportFetcher?: StepImportFetcher;
  /**
   * Optional axis hint forwarded to the Revolve modal — e.g., a selected
   * line in the sketch. The modal renders a "use this as axis" button.
   */
  revolveAxisHint?: AxisLine2D;
  /**
   * Injectable LLM intent fetcher forwarded to FeatureTreePlannerPanel
   * (Phase 3.AI.UI). When omitted the wrapper provides a default that
   * POSTs the prompt to `/api/featureTree-planner`; tests can replace it
   * with a deterministic mock OR pass `null` to opt out entirely (the
   * panel then runs the regex-only path).
   *
   * Contract:
   *   - resolve to a `PlanIntent` to drive `planFromIntent` downstream;
   *   - resolve to `null` if the LLM cannot understand;
   *   - throw to surface an error in the panel.
   */
  plannerLlmFetcher?: ((text: string) => Promise<PlanIntent | null>) | null;
  /**
   * Phase 3.AI convenience prop — when `true`, the inner SolverSketchEditor
   * mounts with the SketchConstraintAiPanel open by default (vs the prior
   * default of hidden behind the title-bar "AI" toggle). The wrapper also
   * exposes a `solver-wrapper-ai-constraints-toggle` button so callers can
   * flip the seed value at runtime; flipping it bumps a remount key on the
   * editor so the new default takes effect immediately.
   *
   * Forwarded directly to `SolverSketchEditor.defaultShowSketchAi`; the
   * editor's title-bar "AI" toggle still works as before — it operates on
   * the editor's internal state after the seed is applied.
   *
   * Default: `false` (back-compat — every prior test that asserted the AI
   * panel is NOT mounted on first paint keeps passing).
   */
  defaultShowSketchAi?: boolean;
}

/**
 * Tiny in-modal SVG preview for the boolean-combined loops. Auto-fits the
 * polygon bbox into a 240×140 viewport with 6 px padding. Pure presentation
 * — no event handlers, no editor coupling. Caller passes a stable test id
 * so multiple instances (current + future) can be independently asserted.
 */
function BooleanPreviewSvg({
  loops,
  testid,
}: {
  loops: ReadonlyArray<SketchLoop>;
  testid: string;
}): React.ReactElement {
  const width = 240;
  const height = 140;
  const padding = 6;
  // Compute combined bbox across every loop.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const hasFiniteBbox =
    Number.isFinite(minX) && Number.isFinite(maxX) &&
    Number.isFinite(minY) && Number.isFinite(maxY);
  const bboxW = hasFiniteBbox ? Math.max(maxX - minX, 1e-6) : 1;
  const bboxH = hasFiniteBbox ? Math.max(maxY - minY, 1e-6) : 1;
  const scale = hasFiniteBbox
    ? Math.min((width - 2 * padding) / bboxW, (height - 2 * padding) / bboxH)
    : 1;
  // Centered with Y flipped (SVG y goes down, sketch y goes up).
  const cx = hasFiniteBbox ? (minX + maxX) / 2 : 0;
  const cy = hasFiniteBbox ? (minY + maxY) / 2 : 0;
  const project = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: width / 2 + (p.x - cx) * scale,
    y: height / 2 - (p.y - cy) * scale,
  });
  const palette = ['#0284c7', '#16a34a', '#dc2626', '#7c3aed', '#d97706', '#0891b2'];
  return (
    <svg
      data-testid={testid}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 4,
        display: 'block',
      }}
    >
      {loops.length === 0 && (
        <text
          x={width / 2}
          y={height / 2}
          fontSize={11}
          fill="#9ca3af"
          textAnchor="middle"
          dominantBaseline="central"
        >
          ∅
        </text>
      )}
      {loops.map((loop, i) => {
        if (loop.length < 3) return null;
        const projected = loop.map((p) => project(p));
        const pts = projected.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        const color = palette[i % palette.length];
        return (
          <polygon
            key={i}
            data-testid={`${testid}-loop-${i}`}
            points={pts}
            fill={`${color}22`}
            stroke={color}
            strokeWidth={1.4}
          />
        );
      })}
    </svg>
  );
}

export default function SolverSketchEditorWithExtrude(
  props: SolverSketchEditorWithExtrudeProps,
): React.ReactElement {
  const {
    projectId,
    extrudeFetcher = defaultFetcher,
    revolveFetcher,
    sweepFetcher,
    loftFetcher,
    patternFetcher,
    shellFetcher,
    holeFetcher,
    filletFetcher,
    chamferFetcher,
    stepImportFetcher,
    revolveAxisHint,
    plannerLlmFetcher,
    defaultShowSketchAi = false,
    ...editorProps
  } = props;
  // Wrapper-level state for the AI constraints toggle. Seeded from the
  // `defaultShowSketchAi` prop and flipped via the wrapper toggle button.
  // The value is passed down as `defaultShowSketchAi` to the editor and is
  // paired with a remount key (incremented on every toggle) so the new
  // seed takes effect on first paint of the remounted editor. The editor's
  // own title-bar "AI" toggle continues to flip its internal state
  // independently after that.
  const [wrapperAiOn, setWrapperAiOn] = useState<boolean>(defaultShowSketchAi);
  const [editorRemountKey, setEditorRemountKey] = useState<number>(0);
  const toggleWrapperAi = useCallback(() => {
    setWrapperAiOn((prev) => !prev);
    setEditorRemountKey((k) => k + 1);
  }, []);
  const t = dict[(editorProps.lang ?? 'en') as Lang];
  const treeLang = (editorProps.lang ?? 'en') as FeatureTreeLang;
  const plannerLang = (editorProps.lang ?? 'en') as PlannerLang;

  const [sketch, setSketch] = useState<SolverViewState>({ points: [], lines: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [revolveOpen, setRevolveOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [loftOpen, setLoftOpen] = useState(false);
  const [patternOpen, setPatternOpen] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [holeOpen, setHoleOpen] = useState(false);
  const [filletOpen, setFilletOpen] = useState(false);
  const [chamferOpen, setChamferOpen] = useState(false);
  const [stepImportOpen, setStepImportOpen] = useState(false);
  /** Replace vs merge — set inside the STEP import wizard before submit. */
  const [stepImportMode, setStepImportMode] = useState<'replace' | 'merge'>('replace');
  const [depth, setDepth] = useState<string>('10');
  const [direction, setDirection] = useState<ExtrudeDirection>('one_sided');
  const [mode, setMode] = useState<ExtrudeMode>('add');
  const [draftDegrees, setDraftDegrees] = useState<string>('0');
  const [render, setRender] = useState<RenderState>({ status: 'idle' });
  /**
   * Boolean op selected in the modal when the sketch has > 1 closed loop.
   * Defaults to 'union' — the most common "combine multiple parts of a
   * sketch into a single profile" intent. When the sketch has 0 or 1 loops
   * the op is effectively ignored (applyBooleanToSketch short-circuits to
   * the input sketch) so this state has no observable effect.
   */
  const [booleanOp, setBooleanOp] = useState<SketchBooleanOp>('union');

  // ── feature tree state (Phase 2.7 + 5.2 UI + 2.7.1 history) ─────────────
  // Persistence toast (Phase 2.8) — shown when the side-channel write
  // detector spots a `localStorage.setItem` failure (quota_exceeded,
  // no_storage, unknown). The history hook (Phase 2.7.1) owns the primary
  // debounced write; we run a sync re-write here purely for error capture
  // because useFeatureTreeHistory does not surface onError today.
  const [persistError, setPersistError] = useState<{ error: SaveError; message: string } | null>(
    null,
  );

  // History hook (Phase 2.7.1) — wraps the prior raw `useFeatureTreeStorage`
  // call. When `projectId` is supplied, the hook mirrors the *present* tree
  // to localStorage under nexyfab:tree:${projectId} via its internal use of
  // useFeatureTreeStorage. When `projectId` is absent the hook is in-memory
  // only (storageKey passed as undefined). past/future stacks are session-
  // only either way — re-mount starts with an empty undo history.
  const historyStorageKey =
    projectId !== undefined ? `${STORAGE_KEY_PREFIX}${projectId}` : undefined;
  const {
    tree: featureTree,
    apply: applyHistoryEdit,
    undo: undoHistory,
    redo: redoHistory,
    canUndo,
    canRedo,
    reset: resetHistory,
  } = useFeatureTreeHistory(undefined, {
    maxHistory: 50,
    storageKey: historyStorageKey,
  });

  const [selectedFeatureId, setSelectedFeatureId] = useState<string | undefined>(undefined);
  /** Monotonic id generator for tree nodes created by modal submits. Seeded
   *  from the loaded tree size so a freshly rehydrated tree appends new
   *  nodes after the persisted ones rather than colliding with them.
   *  Note: undo does NOT decrement this — a redo would replay the snapshot
   *  with its original id, and a subsequent fresh add jumps to a higher id
   *  (gap in id sequence is harmless, ids only need uniqueness). */
  const nextNodeIdRef = useRef<number>(featureTree.nodes.length);

  // Pre-validating apply wrapper. Because useFeatureTreeHistory.apply
  // delegates straight to featureTreeEdit.applyEdit (which throws on
  // invalid ops via FeatureTreeEditError) inside a setState updater, an
  // unhandled throw would crash React. We dry-run the same op first
  // against the current tree; on FeatureTreeEditError we silently ignore
  // (the prior UI did the same — e.g. delete blocked by dependents
  // simply returned prev). All other errors propagate.
  const safeApply = useCallback(
    (edit: EditOp, treeForValidation: FeatureTree): boolean => {
      try {
        applyEdit(treeForValidation, edit);
      } catch (e) {
        if (e instanceof FeatureTreeEditError) return false;
        throw e;
      }
      applyHistoryEdit(edit);
      return true;
    },
    [applyHistoryEdit],
  );

  // Synthetic-payload helper: each modal returns only SCAD+pngs, not a full
  // feature IR, so we synthesise a placeholder payload tagged by `kind`. The
  // SCAD render is owned by the modal preview pane; the tree node only
  // surfaces history + selection. Full IR threading lands in a later batch.
  // The history hook receives this as an `insert_node` op so undo can roll
  // it back and redo can restore it byte-for-byte.
  const appendNode = useCallback(
    (kind: FeatureKind, labelBase: string): void => {
      const idx = nextNodeIdRef.current++;
      const id = `${kind}_${idx}`;
      // Cast the synthesised stub to FeaturePayload — runtime tests do not
      // walk the payload shape; the FeatureTreeView only inspects `kind`.
      const payload = { kind } as unknown as FeatureNode['payload'];
      const node: FeatureNode = {
        id,
        name: `${labelBase} ${idx + 1}`,
        dependencies: [],
        payload,
      };
      applyHistoryEdit({ type: 'insert_node', node });
    },
    [applyHistoryEdit],
  );

  // ── fetcher wrappers — intercept ok responses to append a tree node ────
  // Wrap each per-feature fetcher exactly once per identity change. We
  // intentionally re-create on appendNode identity (stable across renders).
  const wrappedExtrudeFetcher = useMemo(
    () => {
      const base = extrudeFetcher;
      return async (req: Parameters<ExtrudeFetcher>[0]) => {
        const res = await base(req);
        if (res && res.ok === true) appendNode('extrude', t.extrude);
        return res;
      };
    },
    [extrudeFetcher, appendNode, t.extrude],
  );
  const wrappedRevolveFetcher = useMemo<RevolveFetcher | undefined>(
    () => {
      if (!revolveFetcher) return undefined;
      return async (req) => {
        const res = await revolveFetcher(req);
        if (res && res.ok === true) appendNode('revolve', t.revolve);
        return res;
      };
    },
    [revolveFetcher, appendNode, t.revolve],
  );
  const wrappedSweepFetcher = useMemo<SweepFetcher | undefined>(
    () => {
      if (!sweepFetcher) return undefined;
      return async (req) => {
        const res = await sweepFetcher(req);
        if (res && res.ok === true) appendNode('sweep', t.sweep);
        return res;
      };
    },
    [sweepFetcher, appendNode, t.sweep],
  );
  const wrappedLoftFetcher = useMemo<LoftFetcher | undefined>(
    () => {
      if (!loftFetcher) return undefined;
      return async (req) => {
        const res = await loftFetcher(req);
        if (res && res.ok === true) appendNode('loft', t.loft);
        return res;
      };
    },
    [loftFetcher, appendNode, t.loft],
  );
  const wrappedPatternFetcher = useMemo<PatternFetcher | undefined>(
    () => {
      if (!patternFetcher) return undefined;
      return async (req) => {
        const res = await patternFetcher(req);
        if (res && res.ok === true) {
          const kind: FeatureKind =
            req.kind === 'circular' ? 'circular_pattern' : 'linear_pattern';
          appendNode(kind, t.pattern);
        }
        return res;
      };
    },
    [patternFetcher, appendNode, t.pattern],
  );
  const wrappedShellFetcher = useMemo<ShellFetcher | undefined>(
    () => {
      if (!shellFetcher) return undefined;
      return async (req) => {
        const res = await shellFetcher(req);
        // Shell yields an extruded thin-wall body; tag the synthesised
        // node as 'extrude' (the FeatureKind enum has no dedicated shell
        // kind yet — covered by the Phase 2.x rework).
        if (res && res.ok === true) appendNode('extrude', t.shell);
        return res;
      };
    },
    [shellFetcher, appendNode, t.shell],
  );
  const wrappedHoleFetcher = useMemo<HoleFetcher | undefined>(
    () => {
      if (!holeFetcher) return undefined;
      return async (req) => {
        const res = await holeFetcher(req);
        if (res && res.ok === true) appendNode('hole', t.hole);
        return res;
      };
    },
    [holeFetcher, appendNode, t.hole],
  );
  const wrappedFilletFetcher = useMemo<FilletFetcher | undefined>(
    () => {
      if (!filletFetcher) return undefined;
      return async (req) => {
        const res = await filletFetcher(req);
        if (res && res.ok === true) appendNode('fillet', t.fillet);
        return res;
      };
    },
    [filletFetcher, appendNode, t.fillet],
  );
  const wrappedChamferFetcher = useMemo<ChamferFetcher | undefined>(
    () => {
      if (!chamferFetcher) return undefined;
      return async (req) => {
        const res = await chamferFetcher(req);
        if (res && res.ok === true) appendNode('chamfer', t.chamfer);
        return res;
      };
    },
    [chamferFetcher, appendNode, t.chamfer],
  );

  // ── tree-row callbacks ──────────────────────────────────────────────────
  // Reset = clear the tree + the local id counter via the history hook's
  // `reset()` (seed is the empty tree, so present collapses to {nodes: []}
  // and past/future are wiped). When persisted, the empty tree is mirrored
  // to localStorage on the next debounce flush.
  const handleResetTree = useCallback(() => {
    nextNodeIdRef.current = 0;
    setSelectedFeatureId(undefined);
    setPersistError(null);
    resetHistory();
  }, [resetHistory]);
  const handleSelectNode = useCallback((id: string) => {
    setSelectedFeatureId(id);
  }, []);
  const handleToggleSuppress = useCallback(
    (id: string) => {
      const idx = featureTree.nodes.findIndex((n) => n.id === id);
      if (idx < 0) return;
      const node = featureTree.nodes[idx]!;
      const nextSuppressed = !(node.suppressed === true);
      safeApply(
        { type: 'set_suppressed', nodeId: id, suppressed: nextSuppressed },
        featureTree,
      );
    },
    [featureTree, safeApply],
  );
  const handleDeleteNode = useCallback(
    (id: string) => {
      const ok = safeApply({ type: 'remove_node', nodeId: id }, featureTree);
      if (ok) {
        setSelectedFeatureId((curr) => (curr === id ? undefined : curr));
      }
    },
    [featureTree, safeApply],
  );
  const handleReorderNodes = useCallback(
    (fromIdx: number, toIdx: number) => {
      const node = featureTree.nodes[fromIdx];
      if (!node) return;
      safeApply({ type: 'move_node', nodeId: node.id, toIndex: toIdx }, featureTree);
    },
    [featureTree, safeApply],
  );

  // ── STEP import — replace / merge into tree ─────────────────────────────
  // Expressed as a sequence of EditOps so each import lands in the undo
  // stack: Replace = remove every existing node (reverse order to satisfy
  // dependent checks) then insert every imported node; Merge = insert
  // every imported node, prefixing ids on collision with existing.
  const handleStepImport = useCallback(
    (importedTree: FeatureTree, _warnings: string[], _unsupported: string[]) => {
      const prev = featureTree;
      if (stepImportMode === 'replace') {
        // Bump the id counter past any imported id so future modal
        // appends do not collide with id-prefixed imports.
        nextNodeIdRef.current = importedTree.nodes.length;
        // Remove in reverse so a downstream node is gone before its dep.
        for (let i = prev.nodes.length - 1; i >= 0; i--) {
          applyHistoryEdit({ type: 'remove_node', nodeId: prev.nodes[i]!.id });
        }
        for (const node of importedTree.nodes) {
          applyHistoryEdit({ type: 'insert_node', node });
        }
      } else {
        // Merge — append, prefixing imported ids on collision.
        const existing = new Set(prev.nodes.map((n) => n.id));
        const prefix = `imp${Date.now().toString(36)}_`;
        const remap = new Map<string, string>();
        for (const node of importedTree.nodes) {
          remap.set(node.id, existing.has(node.id) ? `${prefix}${node.id}` : node.id);
        }
        for (const node of importedTree.nodes) {
          const remapped: FeatureNode = {
            ...node,
            id: remap.get(node.id) ?? node.id,
            dependencies: node.dependencies.map((d) => remap.get(d) ?? d),
          };
          applyHistoryEdit({ type: 'insert_node', node: remapped });
        }
      }
      setStepImportOpen(false);
    },
    [featureTree, stepImportMode, applyHistoryEdit],
  );

  // ── AI Planner panel (Phase 3.AI.UI) ───────────────────────────────────
  // Hidden by default (compact mode). The toggle button mounts/unmounts
  // the panel, so the dynamic chunk only loads when first opened.
  const [showPlanner, setShowPlanner] = useState(false);
  const [plannerToast, setPlannerToast] = useState<string | null>(null);
  const plannerToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // IntentExamplesPanel — off by default; on click a chip we capture the
  // selected text in `examplePrefill` and surface it in a read-only preview
  // band so the user can copy/paste into the planner input. Pushing the
  // text directly into the planner's internal textarea state would require
  // either lifting that state up (touches 23 panel tests) or a ref API
  // (Phase 2). Phase 1 keeps the planner untouched.
  const [showExamples, setShowExamples] = useState(false);
  const [examplePrefill, setExamplePrefill] = useState<string | null>(null);

  const handleSelectExample = useCallback((text: string) => {
    setExamplePrefill(text);
  }, []);

  // Default LLM intent fetcher — POSTs the prompt to the planner API
  // route. Tests pass `null` or a mock to bypass network. Whenever the
  // caller explicitly passes `null`, we forward `undefined` to the panel
  // so the panel runs regex-only.
  const defaultPlannerLlmFetcher = useCallback(
    async (text: string): Promise<PlanIntent | null> => {
      const res = await fetch('/api/featureTree-planner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        throw new Error(`planner endpoint returned ${res.status}`);
      }
      const data: unknown = await res.json();
      // Endpoint envelope: { ok: true, intent: PlanIntent | null } | { ok: false, message: string }
      if (typeof data === 'object' && data !== null) {
        const d = data as { ok?: boolean; intent?: PlanIntent | null; message?: string };
        if (d.ok === true) return d.intent ?? null;
        if (d.ok === false) throw new Error(d.message ?? 'planner endpoint error');
      }
      return null;
    },
    [],
  );
  // Resolve the panel's llmIntentFetcher prop:
  //   - prop omitted (undefined) → default (POST /api/...)
  //   - prop === null            → undefined (regex-only path)
  //   - prop supplied            → forwarded as-is (tests)
  const effectivePlannerFetcher: ((text: string) => Promise<PlanIntent | null>) | undefined =
    plannerLlmFetcher === undefined
      ? defaultPlannerLlmFetcher
      : plannerLlmFetcher === null
        ? undefined
        : plannerLlmFetcher;

  // Apply a PlanStep[] to the history-managed tree. Each step is mapped
  // to the corresponding EditOp so undo/redo can roll it back as a
  // standard history entry — N steps land as N entries in the past
  // stack. Steps for which the panel did not supply the required field
  // (e.g., add_node without a node) are skipped silently.
  const handlePlannerApply = useCallback(
    (steps: PlanStep[]): void => {
      let added = 0;
      for (const step of steps) {
        if (step.type === 'add_node' && step.node !== undefined) {
          applyHistoryEdit({ type: 'insert_node', node: step.node });
          added++;
        } else if (step.type === 'remove_node' && step.nodeId !== undefined) {
          applyHistoryEdit({ type: 'remove_node', nodeId: step.nodeId });
        } else if (
          step.type === 'move_node' &&
          step.nodeId !== undefined &&
          typeof step.toIdx === 'number'
        ) {
          applyHistoryEdit({ type: 'move_node', nodeId: step.nodeId, toIndex: step.toIdx });
        } else if (step.type === 'toggle_suppress' && step.nodeId !== undefined) {
          // Resolve current suppressed state from the tree at apply time.
          const node = featureTree.nodes.find((n) => n.id === step.nodeId);
          if (node !== undefined) {
            applyHistoryEdit({
              type: 'set_suppressed',
              nodeId: step.nodeId,
              suppressed: !(node.suppressed === true),
            });
          }
        }
      }
      // Bump the node id counter past any added nodes so subsequent
      // modal-driven appends do not collide with planner ids.
      nextNodeIdRef.current += added;

      // Show a short toast / inline confirmation. Auto-clear after 3s.
      const msg = t.plannerToast.replace('{N}', String(added));
      setPlannerToast(msg);
      if (plannerToastTimerRef.current !== null) {
        clearTimeout(plannerToastTimerRef.current);
      }
      plannerToastTimerRef.current = setTimeout(() => {
        setPlannerToast(null);
        plannerToastTimerRef.current = null;
      }, 3000);
    },
    [applyHistoryEdit, featureTree, t.plannerToast],
  );

  // Clear pending toast timer on unmount.
  useEffect(() => {
    return () => {
      if (plannerToastTimerRef.current !== null) {
        clearTimeout(plannerToastTimerRef.current);
        plannerToastTimerRef.current = null;
      }
    };
  }, []);

  // ── Branches panel (Agent-YYYYY — FeatureTreeBranchManager wiring) ──────
  // Default-off toggle. When on, FeatureTreeBranchManager mounts beneath
  // the existing planner / examples panels (same "below toolbar" zone) so
  // users see snapshot / load / merge controls alongside the live tree.
  //
  // Independent of the collab / AI planner / examples toggles per the
  // orthogonality contract — all four can be on at once.
  //
  // storageKeyPrefix policy:
  //   - projectId provided → `nexyfab:tree-branches:${projectId}` so each
  //     project gets its own branch list (mirrors the per-project tree
  //     storage key `nexyfab:tree:${projectId}` used by useFeatureTreeHistory).
  //   - projectId omitted → fall through to the BranchManager default
  //     (`nexyfab:tree-branches`) which is the global / no-project slot.
  //
  // onLoadTree contract (Load + Merge):
  //   - useFeatureTreeHistory has no public "replace tree" setter; the only
  //     ways to mutate are apply(EditOp), undo(), redo(), reset(). To swap
  //     in a fresh tree from a branch payload we therefore:
  //       1. resetHistory() — wipes past/future stacks AND collapses the
  //          present to the EMPTY_TREE seed (history seedRef is captured
  //          on mount with no initialTree → EMPTY_TREE).
  //       2. for each node in the loaded tree, applyHistoryEdit({insert_node}).
  //     The user gives up the prior undo trail on load (matches the
  //     contract: loading a branch is a destructive "switch context" act
  //     analogous to git checkout — the prior in-flight history would be
  //     incoherent against a different node set).
  //   - We also bump nextNodeIdRef past the loaded tree length so the next
  //     modal-driven append does not collide with branch ids. Subsequent
  //     fresh adds will sit at a higher numeric suffix — a gap in the id
  //     sequence is harmless (ids only need uniqueness, not contiguity).
  //   - selectedFeatureId is reset (selection is invalidated by the swap).
  //   - persistError is cleared (a fresh tree may succeed where the prior
  //     state was failing; if the new tree still fails to write, the
  //     persistence side-channel effect will re-surface the banner).
  const [showBranches, setShowBranches] = useState(false);

  // ── Stats panel (Agent-EEEEEE — FeatureTreeStatsPanel wiring) ───────────
  // Default-off toggle. When on, FeatureTreeStatsPanel mounts beneath the
  // existing planner / examples / branches panels (same "below toolbar"
  // zone). Independent of every other toggle per the orthogonality
  // contract — all five can be on at once.
  //
  // Wiring:
  //   - `tree` is the live history-managed featureTree.
  //   - `selectedNodeId` is forwarded as the wrapper's selectedFeatureId
  //     so clicking a row in FeatureTreeView highlights the "Selected
  //     feature" sub-section inside the panel.
  //   - `lang` mirrors the wrapper lang (FeatureTreeStatsLang shares the
  //     same 6-lang shape).
  const [showStats, setShowStats] = useState(false);
  const statsLang = (editorProps.lang ?? 'en') as FeatureTreeStatsLang;

  // ── Optimizer panel (B31.5 — FeatureTreeOptimizerPanel wiring) ─────────
  // Default-off toggle. When on, FeatureTreeOptimizerPanel mounts beneath
  // the other below-toolbar panels. Independent of every other toggle.
  //
  // onOptimized contract:
  //   - The standalone panel ran `optimizeTree(tree, opts)` and handed us
  //     a structurally clean optimized tree. We replace the wrapper's
  //     history-managed tree with the optimized one by EMITTING DIFF
  //     EditOps to the history hook — one remove_node per dropped id
  //     followed by one insert_node per surviving / re-inserted node. Each
  //     op lands on the past stack so undo can step BACK to the
  //     pre-optimize tree (incrementally) and redo can re-apply.
  //   - We dispatch removals in reverse declaration order so a downstream
  //     dependent disappears before its dependency (matches the same
  //     reverse-order strategy used by the STEP-import replace path).
  //   - We bump nextNodeIdRef past the optimized tree length so subsequent
  //     modal-driven appends do not collide with optimized ids.
  //   - selectedFeatureId is cleared if it points at a removed node.
  const [showOptimize, setShowOptimize] = useState(false);
  const optimizerLang = (editorProps.lang ?? 'en') as FeatureTreeOptimizerLang;

  const handleOptimizedTree = useCallback(
    (optimized: FeatureTree) => {
      const prev = featureTree;
      const optimizedIds = new Set(optimized.nodes.map((n) => n.id));
      // Step 1: remove every prior node that the optimizer dropped, in
      // reverse order (so a downstream dependent is gone before its dep).
      // We also re-emit removes for surviving ids — but only when the
      // payload moved (uncommon); simpler is to ONLY remove the deltas
      // and insert ONLY the newly-introduced ids. The optimizer is
      // non-destructive (it never re-orders or re-payloads surviving
      // nodes — see featureTreeOptimizer header), so we can safely scope
      // the diff to additions/removals.
      const removedIds: string[] = [];
      for (let i = prev.nodes.length - 1; i >= 0; i--) {
        const node = prev.nodes[i]!;
        if (!optimizedIds.has(node.id)) {
          removedIds.push(node.id);
        }
      }
      for (const id of removedIds) {
        applyHistoryEdit({ type: 'remove_node', nodeId: id });
      }
      // Step 2: insert any optimized node that did not already exist.
      const priorIds = new Set(prev.nodes.map((n) => n.id));
      for (const node of optimized.nodes) {
        if (!priorIds.has(node.id)) {
          applyHistoryEdit({ type: 'insert_node', node });
        }
      }
      // Bump id counter past the optimized tree size so future modal
      // appends do not collide with surviving / inserted optimizer ids.
      nextNodeIdRef.current = Math.max(
        nextNodeIdRef.current,
        optimized.nodes.length,
      );
      // Clear selection if it referenced a removed node.
      setSelectedFeatureId((curr) =>
        curr !== undefined && !optimizedIds.has(curr) ? undefined : curr,
      );
    },
    [featureTree, applyHistoryEdit],
  );

  const branchStorageKeyPrefix =
    projectId !== undefined
      ? `nexyfab:tree-branches:${projectId}`
      : undefined; // → BranchManager falls back to its DEFAULT_PREFIX.

  const handleLoadTreeFromBranch = useCallback(
    (loaded: FeatureTree) => {
      // Reset first so the past/future stacks reflect a clean "loaded a
      // branch" inflection point — undo will NOT walk back into the
      // pre-load tree, which matches the documented "switch context"
      // semantics. The BranchManager itself already handed us a deep
      // clone via cloneTree, so we can hand the node references straight
      // to insert_node without further copying.
      resetHistory();
      for (const node of loaded.nodes) {
        applyHistoryEdit({ type: 'insert_node', node });
      }
      // Bump the id counter past the loaded tree size so subsequent
      // modal-driven appends do not collide with branch-resident ids.
      nextNodeIdRef.current = Math.max(
        nextNodeIdRef.current,
        loaded.nodes.length,
      );
      setSelectedFeatureId(undefined);
      setPersistError(null);
    },
    [resetHistory, applyHistoryEdit],
  );

  // ── Collab mode (Phase 1 wiring of useCrdtDoc + CursorOverlay) ──────────
  // The hook is ALWAYS called (Rules of Hooks). When `collabEnabled` is
  // false we never call `update`/`setLocal` and never render the overlay
  // — so the wrapper stays byte-for-byte back-compat with the prior tests.
  const [collabEnabled, setCollabEnabled] = useState(false);
  const collabDocId = projectId ?? 'demo';
  const {
    state: crdtState,
    update: crdtUpdate,
    awareness: crdtAwareness,
    isConnected: crdtConnected,
  } = useCrdtDoc<FeatureTree>({
    docId: collabDocId,
    initialState: featureTree,
    transport: 'memory',
    userId: 'me',
  });
  // Self-update guard: when a local edit pushes into the CRDT and the
  // subscribe callback fires back with the same snapshot we just wrote,
  // suppress the remote → local apply path to avoid the
  // featureTree → update → subscribe → setFeatureTree cycle.
  const lastSyncedRef = useRef<FeatureTree | null>(null);
  // Viewport ref for the CursorOverlay positioning.
  const sketchViewportRef = useRef<HTMLDivElement | null>(null);

  // Local → CRDT mirror: whenever the history-managed featureTree changes
  // and we're in collab mode, push the new snapshot into the CRDT. We mark
  // the value in lastSyncedRef *before* the update so the subscribe
  // callback's self-echo is suppressed below.
  useEffect(() => {
    if (!collabEnabled) return;
    if (lastSyncedRef.current === featureTree) return;
    lastSyncedRef.current = featureTree;
    try {
      crdtUpdate((draft) => {
        // The crdtAdapter snapshot is a structural clone of `draft` after
        // the mutator runs. Replace nodes wholesale — coarse-grained on
        // purpose, see crdtAdapter docs.
        draft.nodes = featureTree.nodes;
      });
    } catch {
      // CRDT push errors are non-fatal — collab is best-effort.
    }
  }, [collabEnabled, featureTree, crdtUpdate]);

  // CRDT → local mirror: when a remote update arrives, replay it onto the
  // history-managed tree as a sequence of insert_node ops. We use a coarse
  // reset+rebuild strategy because the history hook does not expose a tree
  // setter. Self-echoes are skipped via lastSyncedRef. Only runs in collab
  // mode.
  const lastAppliedRemoteRef = useRef<FeatureTree | null>(null);
  useEffect(() => {
    if (!collabEnabled) return;
    if (crdtState === featureTree) return;
    if (lastAppliedRemoteRef.current === crdtState) return;
    // Cheap structural compare via JSON — Phase 1 stub adapter clones, so
    // ref equality alone is not enough.
    const same =
      crdtState.nodes.length === featureTree.nodes.length &&
      JSON.stringify(crdtState.nodes) === JSON.stringify(featureTree.nodes);
    if (same) return;
    lastAppliedRemoteRef.current = crdtState;
    // Mark synced so the local→CRDT effect above does not re-broadcast.
    lastSyncedRef.current = featureTree;
    // Reset history to the empty seed, then bulk-insert remote nodes.
    resetHistory();
    for (const node of crdtState.nodes) {
      applyHistoryEdit({ type: 'insert_node', node });
    }
  }, [collabEnabled, crdtState, featureTree, resetHistory, applyHistoryEdit]);

  // Local mouse position → awareness cursor. Only attached when collab
  // is on, so the listener is fully torn down in off mode.
  const handleSketchMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!collabEnabled) return;
      const el = sketchViewportRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      crdtAwareness.setLocal('cursor', {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
    },
    [collabEnabled, crdtAwareness],
  );

  // Peer derivation for the embedded CollabStatusBadge (JJJJJJ × VVVVV
  // integration). Pulled directly from useCrdtDoc's awareness snapshot so
  // the badge re-renders on every presence delta. userColors mirrors the
  // deterministic colorForUserId hash from CursorOverlay so the badge
  // tooltip swatches match the live cursor markers.
  const peerIds = Object.keys(crdtAwareness.remoteStates);
  const peerCount = peerIds.length;
  const peerUserColors = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const id of peerIds) {
      out[id] = colorForUserId(id);
    }
    return out;
  }, [peerIds]);

  // Tracks the in-flight fetch's AbortController so cancel/unmount can abort
  // it AND so we can suppress late setState after the controller is aborted.
  const abortRef = useRef<AbortController | null>(null);

  // Keep a stable callback to avoid re-renders inside the wrapped editor.
  const handleSketchChange = useCallback((s: SolverViewState) => {
    setSketch(s);
  }, []);

  // Merge our handler with any user-supplied onSketchChange.
  const composedOnSketchChange = useMemo(() => {
    const userHandler = editorProps.onSketchChange;
    if (!userHandler) return handleSketchChange;
    return (s: SolverViewState) => {
      userHandler(s);
      handleSketchChange(s);
    };
  }, [editorProps.onSketchChange, handleSketchChange]);

  const canExtrude = sketch.points.length >= 3 && sketch.lines.length >= 3;
  const canRevolve = canExtrude;
  const canSweep = canExtrude;
  const canLoft = canExtrude;
  const canPattern = canExtrude;
  const canShell = canExtrude;
  const canHole = canExtrude;
  const canFillet = canExtrude;
  const canChamfer = canExtrude;

  /**
   * Detected closed loops (computed once per sketch change). When the user
   * has drawn > 1 closed loop, the modal surfaces a boolean op selector +
   * a combined-preview SVG. With 0 or 1 loops these are silently inert and
   * the wrapper behaves byte-for-byte like before.
   */
  const detectedLoops: ReadonlyArray<SketchLoop> = useMemo(
    () => detectLoopsAsPolygons(sketch).loops,
    [sketch],
  );
  const hasMultipleLoops = detectedLoops.length > 1;
  const combinedPreviewLoops: ReadonlyArray<SketchLoop> = useMemo(() => {
    if (!hasMultipleLoops) return detectedLoops;
    return combineLoops(detectedLoops, booleanOp);
  }, [hasMultipleLoops, detectedLoops, booleanOp]);

  const onSubmit = useCallback(async () => {
    const d = Number(depth);
    if (!Number.isFinite(d) || d <= 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: ${t.errorDepthInvalid}` });
      return;
    }
    const draftN = Number(draftDegrees);

    // Abort any previous in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Attach signal for defaultFetcher to pick up. Test-injected fetchers
    // ignore this entry (they aren't the defaultFetcher reference).
    fetcherSignals.set(extrudeFetcher, controller.signal);

    // Apply multi-loop boolean if applicable. With 0 or 1 loop the helper
    // returns the input sketch by referential equality so existing single-
    // loop callers see no behavioural change. Empty combined result (e.g.,
    // intersect of disjoint inputs) surfaces as a user-facing error and
    // skips the network call entirely.
    const { sketch: sketchToSend, combinedLoops } = applyBooleanToSketch(sketch, booleanOp);
    if (hasMultipleLoops && combinedLoops.length === 0) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: ${t.booleanEmptyWarning}`,
      });
      return;
    }

    setRender({ status: 'loading' });
    try {
      const res = await wrappedExtrudeFetcher({
        sketch: sketchToSend,
        depth: d,
        draftDegrees: Number.isFinite(draftN) && draftN !== 0 ? draftN : undefined,
        direction,
        mode,
        includeStl: true,
      });
      if (controller.signal.aborted) return;
      if (res.ok) {
        setRender({ status: 'ok', result: { scad: res.scad, pngs: res.pngs, stl: res.stl } });
      } else {
        setRender({ status: 'error', message: `${t.errorPrefix}: ${res.message}` });
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setRender({ status: 'error', message: `${t.errorPrefix}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      fetcherSignals.delete(extrudeFetcher);
    }
  }, [
    depth, draftDegrees, direction, mode, sketch, extrudeFetcher, wrappedExtrudeFetcher,
    booleanOp, hasMultipleLoops,
    t.errorPrefix, t.errorDepthInvalid, t.booleanEmptyWarning,
  ]);

  // Reset preview when modal closes; also abort any in-flight fetch so a
  // late setState after the user clicked Cancel does NOT land on a closed
  // modal (React act() warning) or leak the response.
  useEffect(() => {
    if (!modalOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      setRender({ status: 'idle' });
    }
  }, [modalOpen]);

  // Abort on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // Persistence error side-channel — useFeatureTreeHistory does not expose
  // an onError option today, so the history hook's internal
  // useFeatureTreeStorage swallows quota / unknown write failures. We
  // re-write the same tree here purely to detect those failures and
  // surface a banner. The write is the same shape the history hook writes
  // (same key, same envelope), so the duplicate is harmless: either both
  // succeed (no banner) or both fail (banner shown). Only runs when a
  // projectId is present and the tree actually changed.
  const lastErrorCheckTreeRef = useRef<FeatureTree | null>(null);
  useEffect(() => {
    if (projectId === undefined || historyStorageKey === undefined) {
      // In-memory mode: no writes ever happen, no errors to surface.
      if (persistError !== null) setPersistError(null);
      return;
    }
    if (lastErrorCheckTreeRef.current === featureTree) return;
    lastErrorCheckTreeRef.current = featureTree;
    const json = serializeFeatureTree(featureTree);
    const res = writeToStorage(historyStorageKey, json);
    if (!res.ok) {
      setPersistError({ error: res.error, message: res.message });
    } else if (persistError !== null) {
      setPersistError(null);
    }
  }, [featureTree, projectId, historyStorageKey, persistError]);

  // ── Undo / Redo keyboard shortcut (Phase 2.7.1) ─────────────────────────
  // Ctrl+Z → undo, Ctrl+Shift+Z or Ctrl+Y → redo (Cmd on macOS treated
  // the same via metaKey). Skipped when focus is in a text-editing
  // surface so users typing in an input field don't lose their text.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return false;
    };
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoHistory();
        return;
      }
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redoHistory();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoHistory, redoHistory]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        ref={sketchViewportRef}
        data-testid="solver-collab-viewport"
        onMouseMove={handleSketchMouseMove}
        style={{ position: 'relative' }}
      >
        <SolverSketchEditor
          key={`editor-${editorRemountKey}`}
          {...editorProps}
          onSketchChange={composedOnSketchChange}
          defaultShowSketchAi={wrapperAiOn}
        />
        {collabEnabled && (
          <CursorOverlay
            awareness={{ remoteStates: crdtAwareness.remoteStates }}
            viewportRef={sketchViewportRef}
          />
        )}
      </div>

      {/* Operation toolbar */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={!canExtrude}
          onClick={() => setModalOpen(true)}
          data-testid="solver-extrude-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canExtrude ? '#16a34a' : '#e5e7eb',
            color: canExtrude ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canExtrude ? '#15803d' : '#d1d5db'),
            borderRadius: 6,
            cursor: canExtrude ? 'pointer' : 'not-allowed',
          }}
        >
          ⬆ {t.extrude}
        </button>
        <button
          type="button"
          disabled={!canRevolve}
          onClick={() => setRevolveOpen(true)}
          data-testid="solver-revolve-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canRevolve ? '#0ea5e9' : '#e5e7eb',
            color: canRevolve ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canRevolve ? '#0284c7' : '#d1d5db'),
            borderRadius: 6,
            cursor: canRevolve ? 'pointer' : 'not-allowed',
          }}
        >
          ↻ {t.revolve}
        </button>
        <button
          type="button"
          disabled={!canSweep}
          onClick={() => setSweepOpen(true)}
          data-testid="solver-sweep-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canSweep ? '#8b5cf6' : '#e5e7eb',
            color: canSweep ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canSweep ? '#7c3aed' : '#d1d5db'),
            borderRadius: 6,
            cursor: canSweep ? 'pointer' : 'not-allowed',
          }}
        >
          ✏ {t.sweep}
        </button>
        <button
          type="button"
          disabled={!canLoft}
          onClick={() => setLoftOpen(true)}
          data-testid="solver-loft-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canLoft ? '#f59e0b' : '#e5e7eb',
            color: canLoft ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canLoft ? '#d97706' : '#d1d5db'),
            borderRadius: 6,
            cursor: canLoft ? 'pointer' : 'not-allowed',
          }}
        >
          🥯 {t.loft}
        </button>
        <button
          type="button"
          disabled={!canPattern}
          onClick={() => setPatternOpen(true)}
          data-testid="solver-pattern-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canPattern ? '#10b981' : '#e5e7eb',
            color: canPattern ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canPattern ? '#059669' : '#d1d5db'),
            borderRadius: 6,
            cursor: canPattern ? 'pointer' : 'not-allowed',
          }}
        >
          ▦ {t.pattern}
        </button>
        <button
          type="button"
          disabled={!canShell}
          onClick={() => setShellOpen(true)}
          data-testid="solver-shell-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canShell ? '#14b8a6' : '#e5e7eb',
            color: canShell ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canShell ? '#0d9488' : '#d1d5db'),
            borderRadius: 6,
            cursor: canShell ? 'pointer' : 'not-allowed',
          }}
        >
          ◌ {t.shell}
        </button>
        <button
          type="button"
          disabled={!canHole}
          onClick={() => setHoleOpen(true)}
          data-testid="solver-hole-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canHole ? '#6366f1' : '#e5e7eb',
            color: canHole ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canHole ? '#4f46e5' : '#d1d5db'),
            borderRadius: 6,
            cursor: canHole ? 'pointer' : 'not-allowed',
          }}
        >
          ⊙ {t.hole}
        </button>
        <button
          type="button"
          disabled={!canFillet}
          onClick={() => setFilletOpen(true)}
          data-testid="solver-fillet-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canFillet ? '#f43f5e' : '#e5e7eb',
            color: canFillet ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canFillet ? '#e11d48' : '#d1d5db'),
            borderRadius: 6,
            cursor: canFillet ? 'pointer' : 'not-allowed',
          }}
        >
          ◜ {t.fillet}
        </button>
        <button
          type="button"
          disabled={!canChamfer}
          onClick={() => setChamferOpen(true)}
          data-testid="solver-chamfer-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canChamfer ? '#64748b' : '#e5e7eb',
            color: canChamfer ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canChamfer ? '#475569' : '#d1d5db'),
            borderRadius: 6,
            cursor: canChamfer ? 'pointer' : 'not-allowed',
          }}
        >
          ◣ {t.chamfer}
        </button>
        {/* STEP import — always enabled (canExtrude gate intentionally bypassed). */}
        <button
          type="button"
          onClick={() => setStepImportOpen(true)}
          data-testid="solver-import-step-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: '#d97706',
            color: '#fff',
            border: '1px solid #b45309',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          ⤓ {t.importStep}
        </button>
      </div>

      {/* Feature tree panel (Phase 2.7) — mounted below the operation
          toolbar so users see new nodes accumulate as they submit modals.
          Phase 2.8 adds a Reset button + persistence status banner that
          surface ONLY when the wrapper is in persisted mode (projectId set). */}
      <div data-testid="solver-feature-tree-panel" style={{ marginTop: 4 }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 4,
            fontSize: 12,
          }}
        >
          <button
            type="button"
            onClick={handleResetTree}
            data-testid="solver-feature-tree-reset"
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: '#fff',
              border: '1px solid #d1d5db',
              color: '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.reset}
          </button>
          <button
            type="button"
            onClick={undoHistory}
            disabled={!canUndo}
            data-testid="solver-undo-button"
            aria-label={t.undo}
            title={`${t.undo} (Ctrl+Z)`}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: canUndo ? '#fff' : '#f3f4f6',
              border: '1px solid #d1d5db',
              color: canUndo ? '#374151' : '#9ca3af',
              borderRadius: 4,
              cursor: canUndo ? 'pointer' : 'not-allowed',
            }}
          >
            ↶ {t.undo}
          </button>
          <button
            type="button"
            onClick={redoHistory}
            disabled={!canRedo}
            data-testid="solver-redo-button"
            aria-label={t.redo}
            title={`${t.redo} (Ctrl+Y)`}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: canRedo ? '#fff' : '#f3f4f6',
              border: '1px solid #d1d5db',
              color: canRedo ? '#374151' : '#9ca3af',
              borderRadius: 4,
              cursor: canRedo ? 'pointer' : 'not-allowed',
            }}
          >
            ↷ {t.redo}
          </button>
          <button
            type="button"
            onClick={() => setShowPlanner((v) => !v)}
            data-testid="solver-planner-toggle"
            aria-label={showPlanner ? t.hidePlanner : t.showPlanner}
            aria-expanded={showPlanner}
            title={showPlanner ? t.hidePlanner : t.showPlanner}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: showPlanner ? '#2563eb' : '#fff',
              border: '1px solid ' + (showPlanner ? '#1d4ed8' : '#d1d5db'),
              color: showPlanner ? '#fff' : '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            ✨ {t.aiPlanner}
          </button>
          <button
            type="button"
            onClick={() => setShowExamples((v) => !v)}
            data-testid="solver-planner-examples-toggle"
            aria-label={showExamples ? t.hideExamples : t.showExamples}
            aria-expanded={showExamples}
            title={showExamples ? t.hideExamples : t.showExamples}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: showExamples ? '#7c3aed' : '#fff',
              border: '1px solid ' + (showExamples ? '#6d28d9' : '#d1d5db'),
              color: showExamples ? '#fff' : '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            💡 {showExamples ? t.hideExamples : t.showExamples}
          </button>
          <button
            type="button"
            onClick={() => setShowBranches((v) => !v)}
            data-testid="solver-branches-toggle"
            aria-label={t.branchesToggle}
            aria-expanded={showBranches}
            title={t.branchesToggle}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: showBranches ? '#0891b2' : '#fff',
              border: '1px solid ' + (showBranches ? '#0e7490' : '#d1d5db'),
              color: showBranches ? '#fff' : '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            🌿 {t.branches}
          </button>
          <button
            type="button"
            onClick={() => setShowStats((v) => !v)}
            data-testid="solver-stats-toggle"
            aria-label={showStats ? t.hideStats : t.showStats}
            aria-expanded={showStats}
            title={showStats ? t.hideStats : t.showStats}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: showStats ? '#2563eb' : '#fff',
              border: '1px solid ' + (showStats ? '#1d4ed8' : '#d1d5db'),
              color: showStats ? '#fff' : '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            📊 {t.stats}
          </button>
          <button
            type="button"
            onClick={() => setShowOptimize((v) => !v)}
            data-testid="solver-optimize-toggle"
            aria-label={showOptimize ? t.hideOptimize : t.optimizeTree}
            aria-expanded={showOptimize}
            title={showOptimize ? t.hideOptimize : t.optimizeTree}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: showOptimize ? '#059669' : '#fff',
              border: '1px solid ' + (showOptimize ? '#047857' : '#d1d5db'),
              color: showOptimize ? '#fff' : '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            🧹 {t.optimizeTree}
          </button>
          {/*
            Wrapper-level "AI constraints" toggle (Phase 3.AI). Flips the
            `defaultShowSketchAi` seed passed to the inner SolverSketchEditor,
            paired with a remount key bump so the new seed takes effect on
            next paint. The editor's own title-bar "AI" button keeps working
            independently after that. Default-off — back-compat with every
            prior wrapper test that asserted no AI panel on first paint.
          */}
          <button
            type="button"
            onClick={toggleWrapperAi}
            data-testid="solver-wrapper-ai-constraints-toggle"
            aria-pressed={wrapperAiOn}
            aria-label="Toggle sketch AI constraints panel default"
            title="Toggle sketch AI constraints panel default"
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: wrapperAiOn ? '#7c3aed' : '#fff',
              border: '1px solid ' + (wrapperAiOn ? '#6d28d9' : '#d1d5db'),
              color: wrapperAiOn ? '#fff' : '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            🪄 AI constraints
          </button>
          <label
            data-testid="solver-collab-toggle-label"
            style={{
              display: 'flex',
              gap: 4,
              alignItems: 'center',
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: collabEnabled ? '#0ea5e9' : '#fff',
              border: '1px solid ' + (collabEnabled ? '#0284c7' : '#d1d5db'),
              color: collabEnabled ? '#fff' : '#374151',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={collabEnabled}
              onChange={(e) => setCollabEnabled(e.target.checked)}
              data-testid="solver-collab-toggle"
              aria-label={t.collabMode}
              style={{ margin: 0 }}
            />
            🌐 {t.collabMode}
          </label>
          {collabEnabled && (
            // CollabStatusBadge (JJJJJJ) embedded inside the existing
            // `solver-collab-status` slot. The outer span is preserved as a
            // hosting wrapper so prior tests that query this testid keep
            // matching; the badge supplies the headline + status dot + peer
            // tooltip on top of that. Badge i18n keys (Collab / Connected /
            // peers / 연결됨 / 명 …) overlap the prior inline string, so
            // back-compat assertions still pass against `.textContent`.
            <span
              data-testid="solver-collab-status"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <CollabStatusBadge
                lang={(editorProps.lang ?? 'en') as Lang}
                isConnected={crdtConnected}
                peerCount={peerCount}
                peerIds={peerIds}
                userColors={peerUserColors}
              />
            </span>
          )}
          {projectId !== undefined && persistError === null && (
            <span
              data-testid="solver-feature-tree-saved"
              style={{ color: '#16a34a', fontSize: 11 }}
            >
              {t.savedAt}
            </span>
          )}
          {projectId !== undefined && persistError !== null && (
            <span
              data-testid="solver-feature-tree-save-error"
              role="alert"
              style={{
                color: '#dc2626',
                fontSize: 11,
                padding: '2px 6px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 4,
              }}
            >
              {t.saveError}: {persistError.error === 'quota_exceeded'
                ? 'quota exceeded'
                : persistError.message}
            </span>
          )}
        </div>
        <FeatureTreeView
          lang={treeLang}
          tree={featureTree}
          selectedId={selectedFeatureId}
          onSelect={handleSelectNode}
          onToggleSuppress={handleToggleSuppress}
          onDelete={handleDeleteNode}
          onReorder={handleReorderNodes}
        />
        {showPlanner && (
          <div
            data-testid="solver-planner-panel-host"
            style={{ marginTop: 8 }}
          >
            <FeatureTreePlannerPanel
              lang={plannerLang}
              currentTree={featureTree}
              onApply={handlePlannerApply}
              llmIntentFetcher={effectivePlannerFetcher}
            />
          </div>
        )}
        {showExamples && (
          <div
            data-testid="solver-planner-examples-host"
            style={{ marginTop: 8 }}
          >
            <IntentExamplesPanel
              lang={plannerLang}
              onSelectExample={handleSelectExample}
            />
            {examplePrefill !== null && (
              <div
                data-testid="solver-planner-examples-selected"
                style={{
                  marginTop: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  color: '#1f2937',
                  background: '#f5f3ff',
                  border: '1px solid #c4b5fd',
                  borderRadius: 4,
                }}
              >
                {examplePrefill}
              </div>
            )}
          </div>
        )}
        {showBranches && (
          <div
            data-testid="solver-branches-panel-host"
            style={{ marginTop: 8 }}
          >
            <FeatureTreeBranchManager
              lang={(editorProps.lang ?? 'en') as BranchManagerLang}
              currentTree={featureTree}
              onLoadTree={handleLoadTreeFromBranch}
              storageKeyPrefix={branchStorageKeyPrefix}
            />
          </div>
        )}
        {showStats && (
          <div
            data-testid="solver-stats-panel-host"
            style={{ marginTop: 8 }}
          >
            <FeatureTreeStatsPanel
              lang={statsLang}
              tree={featureTree}
              selectedNodeId={selectedFeatureId}
            />
          </div>
        )}
        {showOptimize && (
          <div
            data-testid="solver-optimize-panel-host"
            style={{ marginTop: 8 }}
          >
            <FeatureTreeOptimizerPanel
              lang={optimizerLang}
              tree={featureTree}
              onOptimized={handleOptimizedTree}
            />
          </div>
        )}
        {plannerToast !== null && (
          <div
            data-testid="solver-planner-toast"
            role="status"
            aria-live="polite"
            style={{
              marginTop: 8,
              padding: '6px 10px',
              fontSize: 12,
              color: '#065f46',
              background: '#d1fae5',
              border: '1px solid #6ee7b7',
              borderRadius: 4,
            }}
          >
            {plannerToast}
          </div>
        )}
      </div>

      {/* Revolve modal (sibling of the Extrude modal) */}
      {revolveOpen && (
        <RevolveModal
          lang={(editorProps.lang ?? 'en') as RevolveLang}
          sketch={sketch}
          axisHint={revolveAxisHint}
          onClose={() => setRevolveOpen(false)}
          revolveFetcher={wrappedRevolveFetcher}
        />
      )}

      {/* Sweep modal (Phase 2.2) */}
      {sweepOpen && (
        <SweepModal
          lang={(editorProps.lang ?? 'en') as SweepLang}
          sketch={sketch}
          onClose={() => setSweepOpen(false)}
          sweepFetcher={wrappedSweepFetcher}
        />
      )}

      {/* Loft modal (Phase 2.2) */}
      {loftOpen && (
        <LoftModal
          lang={(editorProps.lang ?? 'en') as LoftLang}
          sketch={sketch}
          onClose={() => setLoftOpen(false)}
          loftFetcher={wrappedLoftFetcher}
        />
      )}

      {/* Pattern modal (Phase 2.4) */}
      {patternOpen && (
        <PatternModal
          lang={(editorProps.lang ?? 'en') as PatternLang}
          sketch={sketch}
          onClose={() => setPatternOpen(false)}
          patternFetcher={wrappedPatternFetcher}
        />
      )}

      {/* Shell modal (Phase 2.A round 2) */}
      {shellOpen && (
        <ShellModal
          lang={(editorProps.lang ?? 'en') as ShellLang}
          sketch={sketch}
          onClose={() => setShellOpen(false)}
          shellFetcher={wrappedShellFetcher}
        />
      )}

      {/* Hole wizard modal (Phase 2.A round 2) */}
      {holeOpen && (
        <HoleWizardModal
          lang={(editorProps.lang ?? 'en') as HoleWizardLang}
          sketch={sketch}
          onClose={() => setHoleOpen(false)}
          holeFetcher={wrappedHoleFetcher}
        />
      )}

      {/* Fillet modal (Phase 2.2) */}
      {filletOpen && (
        <FilletModal
          lang={(editorProps.lang ?? 'en') as FilletLang}
          sketch={sketch}
          onClose={() => setFilletOpen(false)}
          filletFetcher={wrappedFilletFetcher}
        />
      )}

      {/* Chamfer modal (Phase 2.2) */}
      {chamferOpen && (
        <ChamferModal
          lang={(editorProps.lang ?? 'en') as ChamferLang}
          sketch={sketch}
          onClose={() => setChamferOpen(false)}
          chamferFetcher={wrappedChamferFetcher}
        />
      )}

      {/* STEP import modal (Phase 5.2) — wrapper picks replace/merge mode
          via the radio row above and forwards the imported tree. */}
      {stepImportOpen && (
        <div data-testid="solver-step-import-host">
          <div
            data-testid="solver-step-import-mode-row"
            style={{
              position: 'fixed',
              top: 12,
              right: 12,
              zIndex: 1001,
              padding: '8px 12px',
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            <span style={{ fontWeight: 600 }}>{t.importModeLabel}</span>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name="step-import-mode"
                value="replace"
                checked={stepImportMode === 'replace'}
                onChange={() => setStepImportMode('replace')}
                data-testid="solver-step-import-mode-replace"
              />
              {t.importModeReplace}
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name="step-import-mode"
                value="merge"
                checked={stepImportMode === 'merge'}
                onChange={() => setStepImportMode('merge')}
                data-testid="solver-step-import-mode-merge"
              />
              {t.importModeMerge}
            </label>
          </div>
          <StepImportModal
            lang={(editorProps.lang ?? 'en') as StepImportLang}
            onClose={() => setStepImportOpen(false)}
            onImport={handleStepImport}
            stepImportFetcher={stepImportFetcher}
          />
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          data-testid="solver-extrude-modal"
          role="dialog"
          aria-labelledby="solver-extrude-title"
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{
            background: '#fff',
            padding: 20,
            borderRadius: 8,
            maxWidth: 600,
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <h3 id="solver-extrude-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.modalTitle}</h3>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.depth}
              <input
                type="number"
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                data-testid="solver-extrude-depth-input"
                step="0.1"
                min="0.1"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.direction}
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as ExtrudeDirection)}
                data-testid="solver-extrude-direction-select"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                <option value="one_sided">{t.oneSided}</option>
                <option value="two_sided">{t.twoSided}</option>
                <option value="midplane">{t.midplane}</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.mode}
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ExtrudeMode)}
                data-testid="solver-extrude-mode-select"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                <option value="add">{t.add}</option>
                <option value="cut">{t.cut}</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.draft}
              <input
                type="number"
                value={draftDegrees}
                onChange={(e) => setDraftDegrees(e.target.value)}
                data-testid="solver-extrude-draft-input"
                step="1"
                min="-30"
                max="30"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>

            {hasMultipleLoops && (
              <div
                data-testid="solver-extrude-boolean-section"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 10,
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: 4,
                }}
              >
                <div
                  data-testid="solver-extrude-boolean-banner"
                  style={{ fontSize: 12, fontWeight: 600, color: '#075985' }}
                >
                  {t.multipleLoopsDetected.replace('{N}', String(detectedLoops.length))}
                </div>
                <div style={{ fontSize: 11, color: '#374151' }}>{t.booleanOp}</div>
                <div
                  role="radiogroup"
                  aria-label={t.booleanOp}
                  data-testid="solver-extrude-boolean-op-row"
                  style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}
                >
                  {(
                    [
                      { id: 'union', label: t.opUnion },
                      { id: 'subtract', label: t.opSubtract },
                      { id: 'intersect', label: t.opIntersect },
                      { id: 'separate', label: t.opSeparate },
                    ] as ReadonlyArray<{ id: SketchBooleanOp; label: string }>
                  ).map((entry) => (
                    <label
                      key={entry.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <input
                        type="radio"
                        name="solver-extrude-boolean-op"
                        value={entry.id}
                        checked={booleanOp === entry.id}
                        onChange={() => setBooleanOp(entry.id)}
                        data-testid={`extrude-boolean-op-${entry.id}`}
                      />
                      {entry.label}
                    </label>
                  ))}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: 4,
                    }}
                  >
                    {t.booleanPreviewHeading}
                  </div>
                  <BooleanPreviewSvg
                    loops={combinedPreviewLoops}
                    testid="solver-extrude-boolean-preview"
                  />
                  {combinedPreviewLoops.length === 0 && (
                    <div
                      data-testid="solver-extrude-boolean-empty"
                      role="alert"
                      style={{
                        marginTop: 6,
                        padding: 6,
                        fontSize: 11,
                        color: '#b45309',
                        background: '#fef3c7',
                        border: '1px solid #fde68a',
                        borderRadius: 4,
                      }}
                    >
                      {t.booleanEmptyWarning}
                    </div>
                  )}
                </div>
              </div>
            )}

            {render.status === 'loading' && (
              <div style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
                {t.rendering}
              </div>
            )}

            {render.status === 'error' && (
              <div
                data-testid="solver-extrude-error"
                style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, color: '#dc2626', fontSize: 12 }}
              >
                {render.message}
              </div>
            )}

            {render.status === 'ok' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.scadHeading}</div>
                  <pre
                    data-testid="solver-extrude-scad-preview"
                    style={{
                      padding: 8,
                      background: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'monospace',
                      maxHeight: 200,
                      overflow: 'auto',
                      margin: 0,
                    }}
                  >
                    {render.result.scad}
                  </pre>
                </div>
                {render.result.pngs.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.pngHeading}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {render.result.pngs.map((png, idx) => (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          { }
                          <img
                            data-testid={`solver-extrude-png-preview-${idx}`}
                            src={`data:image/png;base64,${png.base64}`}
                            alt={png.label}
                            style={{ maxWidth: 240, border: '1px solid #d1d5db', borderRadius: 4 }}
                          />
                          <div style={{ fontSize: 10, color: '#6b7280' }}>{png.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {render.result.stl !== undefined && (
                  <div data-testid="solver-extrude-stl-viewer-host">
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>3D</div>
                    <StlViewer stlBase64={render.result.stl} width={400} height={300} />
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                data-testid="solver-extrude-cancel"
                style={{ padding: '8px 16px', fontSize: 13, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={render.status === 'loading'}
                data-testid="solver-extrude-submit"
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: render.status === 'loading' ? '#e5e7eb' : '#16a34a',
                  color: render.status === 'loading' ? '#9ca3af' : '#fff',
                  border: '1px solid #15803d',
                  borderRadius: 4,
                  cursor: render.status === 'loading' ? 'not-allowed' : 'pointer',
                }}
              >
                {t.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
