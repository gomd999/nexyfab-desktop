'use client';

/**
 * SolverSketchEditor — Phase 1.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Solver-backed parametric 2D sketch editor. Sibling to the v1.lite
 * `SketchEditor` (which stays in place as a regression sandbox).
 *
 * What's different from v1.lite:
 *   - Every geometric entity is mirrored in `SketchSolver` (planegcs WASM).
 *   - Constraints are first-class: horizontal/vertical/perpendicular/parallel/
 *     coincident/dimension(distance) exposed via toolbar. Adding a constraint
 *     immediately re-solves and the canvas reflects the solver's solution.
 *   - Drag a point → solver re-solves on every mouse-move; constraints hold.
 *   - DoF readout shows under/fully/over-constrained state authoritatively
 *     via `gcs.dof()`.
 *   - Conflicting/redundant constraints surfaced as a red status pill.
 *
 * Out of scope (Phase 1.4+):
 *   - Arc tool (placeholder), tangent constraint UI, snap-to-grid, undo/redo,
 *     sketch ↔ 3D plane mapping (Phase 1.4), persistence, multi-profile.
 *
 * Test surface (data-testids):
 *   solver-sketch-editor, solver-sketch-canvas,
 *   solver-sketch-tool-{select|line|circle|arc|rect|dimension},
 *   solver-sketch-constraint-{horizontal|vertical|perpendicular|parallel|coincident},
 *   solver-sketch-entity-{id},
 *   solver-sketch-dof, solver-sketch-status,
 *   solver-sketch-close.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import {
  createSketchSolver,
  type SketchSolver,
  type PointId,
  type LineId,
  type CircleId,
  type ArcId,
  type ConstraintId,
  type SolveResult,
  type SerializedConstraint,
} from '@/lib/sketch/solver';
import SketchConstraintToolbar, {
  type SketchEntityRef,
  type SketchEntityKind,
  type Constraint as ToolbarConstraint,
} from './SketchConstraintToolbar';
import SketchEntityPropertyPanel, {
  type EntityData as PanelEntityData,
  type EntityField as PanelEntityField,
  type EntityFieldValue as PanelEntityFieldValue,
} from './SketchEntityPropertyPanel';
import SketchConstraintOverlay, {
  type DisplayConstraint,
  type Pt as OverlayPt,
} from './SketchConstraintOverlay';
import SketchConstraintAiPanel from './SketchConstraintAiPanel';
import SketchGroupPanel from './SketchGroupPanel';
import SketchExpressionsPanel from './SketchExpressionsPanel';
import {
  createSketchGroupManager,
  type SketchGroup,
  type SketchGroupManager,
} from '@/lib/sketch/sketchGroup';
import {
  createSketchTransform,
  type SketchTransform,
  type TransformScope,
} from '@/lib/sketch/sketchTransform';
import {
  SELECTED_PLACEHOLDER,
  type SketchConstraintIntent,
} from '@/lib/ai/sketchConstraintIntent';
import SketchSnapIndicator from './SketchSnapIndicator';
import {
  findSnapTarget,
  type SnapEntities,
  type SnapTarget,
} from '@/lib/sketch/sketchSnap';
import {
  downloadSketchAsSvg,
  type SketchEntities as SvgSketchEntities,
  type SvgPoint,
  type SvgLine,
  type SvgCircle,
  type SvgArc,
} from '@/lib/sketch/sketchSvgExport';

// SketchExportModal is dynamic-loaded so the multi-format export UI
// (SVG/PNG/JSON + preview + paper/unit controls) only enters the bundle
// the first time the user clicks "Export...". Quick-SVG download path
// stays statically wired so it remains zero-latency. ssr:false matches
// the other modal siblings in this folder (Sweep/Loft/etc).
const SketchExportModal = dynamic(() => import('./SketchExportModal'), {
  ssr: false,
  loading: () => (
    <div
      data-testid="solver-sketch-export-modal-loading"
      style={{ fontSize: 11, color: 'var(--nx-text-2)', padding: 12 }}
    >
      loading…
    </div>
  ),
});

// SketchImportModal — SVG → entities ingress. Mirrors the export modal's
// dynamic-load pattern so import-dialog chunk is paid only when the user
// actually opens the dialog. The modal itself is solver-agnostic; the
// host (this editor) maps the returned entities into solver state.
const SketchImportModal = dynamic(() => import('./SketchImportModal'), {
  ssr: false,
  loading: () => (
    <div
      data-testid="solver-sketch-import-modal-loading"
      style={{ fontSize: 11, color: 'var(--nx-text-2)', padding: 12 }}
    >
      loading…
    </div>
  ),
});

// ─── public types ─────────────────────────────────────────────────────────

export type EditorLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export type EntityTool =
  | 'select'
  | 'line'
  | 'circle'
  | 'arc'
  | 'rect'
  | 'dimension'
  | 'trim'
  | 'extend'
  | 'offset';

export type ConstraintTool =
  | 'horizontal'
  | 'vertical'
  | 'perpendicular'
  | 'parallel'
  | 'coincident';

export interface SolverSketchEditorProps {
  lang?: EditorLang;
  width?: number;
  height?: number;
  onClose?: () => void;
  /**
   * Optional project identifier used as the prefix for the exported SVG
   * filename. When omitted, falls back to `'sketch'`. Kept opaque (string)
   * so callers can pass anything filename-safe (UUID, slug, etc.).
   */
  projectId?: string;
  /**
   * Fires whenever the sketch's points or lines change. Used by wrapper
   * components (e.g., SolverSketchEditorWithExtrude) that need a mirror
   * of the current geometry without poking at internal state.
   */
  onSketchChange?: (state: {
    points: ReadonlyArray<{ id: string; x: number; y: number }>;
    lines: ReadonlyArray<{ id: string; p1: string; p2: string }>;
  }) => void;
  /**
   * Optional initial open-state for the SketchConstraintAiPanel. Defaults to
   * `false` (panel hidden behind the "AI" toggle in the title bar). When
   * `true`, the panel mounts on first paint — useful for wrapper components
   * (e.g. SolverSketchEditorWithExtrude) that want to expose an
   * "AI constraints on by default" option at a higher level without
   * touching SketchConstraintAiPanel itself. The toggle button continues to
   * flip the live state from whichever side the prop seeds.
   */
  defaultShowSketchAi?: boolean;
}

// ─── i18n (6 langs) ───────────────────────────────────────────────────────

interface Dict {
  title: string;
  select: string; line: string; circle: string; arc: string; rect: string; dimension: string;
  trim: string; extend: string; offset: string;
  horizontal: string; vertical: string; perpendicular: string; parallel: string; coincident: string;
  close: string;
  loading: string;
  error: string;
  dofUnder: string; dofFull: string; dofOver: string;
  dofLabel: string;
  statusReady: string;
  statusSolving: string;
  statusConflict: string;
  statusRedundant: string;
  promptDistance: string;
  promptOffset: string;
  hint: string;
  snapLabel: string;
  snapGrid: string;
  snapPoint: string;
  snapIntersection: string;
  snapArc: string;
  snapPerpendicular: string;
  exportSvg: string;
  svgFilename: string;
  exportModal: string;
  import: string;
  importSvg: string;
  importMode: string;
  importReplace: string;
  importMerge: string;
  aiConstraint: string;
  showAiConstraint: string;
  groups: string;
  groupSelected: string;
  groupName: string;
  showGroups: string;
  transform: string;
  opTranslate: string;
  opRotate: string;
  opScale: string;
  opMirror: string;
  showTransform: string;
  expressions: string;
  showExpressions: string;
  transformScopeAll: string;
  transformScopeSelection: string;
  transformApply: string;
  transformReset: string;
  transformRecapture: string;
  transformDx: string;
  transformDy: string;
  transformAngleDeg: string;
  transformCenterX: string;
  transformCenterY: string;
  transformFactor: string;
  transformMirrorAx: string;
  transformMirrorAy: string;
  transformMirrorBx: string;
  transformMirrorBy: string;
  transformMirrorUseSelected: string;
}

const dict: Record<EditorLang, Dict> = {
  ko: {
    title: '솔버 스케치',
    select: '선택', line: '선', circle: '원', arc: '호', rect: '사각형', dimension: '치수',
    trim: '자르기', extend: '연장', offset: '간격복사',
    horizontal: '수평', vertical: '수직', perpendicular: '수직(L)', parallel: '평행', coincident: '일치',
    close: '닫기',
    loading: '솔버 로딩 중...',
    error: '솔버 로딩 실패',
    dofUnder: '미정의', dofFull: '완전 정의', dofOver: '과정의',
    dofLabel: 'DoF',
    statusReady: '준비됨',
    statusSolving: '풀이 중',
    statusConflict: '충돌 제약',
    statusRedundant: '중복 제약',
    promptDistance: '거리 (mm):',
    promptOffset: '간격복사 거리 (mm):',
    hint: '도구를 선택하고 캔버스를 클릭하세요',
    snapLabel: '스냅',
    snapGrid: '격자',
    snapPoint: '점',
    snapIntersection: '교차',
    snapArc: '호',
    snapPerpendicular: '수선',
    exportSvg: 'SVG 내보내기',
    svgFilename: '스케치',
    exportModal: '내보내기...',
    import: '가져오기...',
    importSvg: 'SVG 가져오기',
    importMode: '가져오기 방식',
    importReplace: '대체',
    importMerge: '병합',
    aiConstraint: 'AI',
    showAiConstraint: 'AI 제약 패널 표시',
    groups: '그룹',
    groupSelected: '선택 항목 그룹화',
    groupName: '그룹 이름',
    showGroups: '그룹 패널 표시',
    transform: '변환',
    opTranslate: '이동',
    opRotate: '회전',
    opScale: '크기',
    opMirror: '대칭',
    showTransform: '변환 패널 표시',
    expressions: '변수',
    showExpressions: '변수 패널 표시',
    transformScopeAll: '전체',
    transformScopeSelection: '선택',
    transformApply: '적용',
    transformReset: '초기화',
    transformRecapture: '스냅샷 재기록',
    transformDx: 'dx',
    transformDy: 'dy',
    transformAngleDeg: '각도(°)',
    transformCenterX: '중심 x',
    transformCenterY: '중심 y',
    transformFactor: '배율',
    transformMirrorAx: 'A x',
    transformMirrorAy: 'A y',
    transformMirrorBx: 'B x',
    transformMirrorBy: 'B y',
    transformMirrorUseSelected: '선택한 두 점 사용',
  },
  en: {
    title: 'Solver Sketch',
    select: 'Select', line: 'Line', circle: 'Circle', arc: 'Arc', rect: 'Rect', dimension: 'Dim',
    trim: 'Trim', extend: 'Extend', offset: 'Offset',
    horizontal: 'Horiz', vertical: 'Vert', perpendicular: 'Perp', parallel: 'Para', coincident: 'Coinc',
    close: 'Close',
    loading: 'Loading solver...',
    error: 'Solver failed to load',
    dofUnder: 'under-constrained', dofFull: 'fully constrained', dofOver: 'over-constrained',
    dofLabel: 'DoF',
    statusReady: 'ready',
    statusSolving: 'solving',
    statusConflict: 'conflicting constraints',
    statusRedundant: 'redundant constraints',
    promptDistance: 'Distance (mm):',
    promptOffset: 'Offset distance (mm):',
    hint: 'Pick a tool and click the canvas',
    snapLabel: 'Snap',
    snapGrid: 'Grid',
    snapPoint: 'Point',
    snapIntersection: 'Int',
    snapArc: 'Arc',
    snapPerpendicular: 'Perp',
    exportSvg: 'Export SVG',
    svgFilename: 'sketch',
    exportModal: 'Export...',
    import: 'Import...',
    importSvg: 'Import SVG',
    importMode: 'Import mode',
    importReplace: 'Replace',
    importMerge: 'Merge',
    aiConstraint: 'AI',
    showAiConstraint: 'Show AI constraint panel',
    groups: 'Groups',
    groupSelected: 'Group selected',
    groupName: 'Group name',
    showGroups: 'Show groups panel',
    transform: 'Transform',
    opTranslate: 'Translate',
    opRotate: 'Rotate',
    opScale: 'Scale',
    opMirror: 'Mirror',
    showTransform: 'Show transform panel',
    expressions: 'Variables',
    showExpressions: 'Show variables panel',
    transformScopeAll: 'All',
    transformScopeSelection: 'Selection',
    transformApply: 'Apply',
    transformReset: 'Reset',
    transformRecapture: 'Recapture snapshot',
    transformDx: 'dx',
    transformDy: 'dy',
    transformAngleDeg: 'angle (°)',
    transformCenterX: 'cx',
    transformCenterY: 'cy',
    transformFactor: 'factor',
    transformMirrorAx: 'A x',
    transformMirrorAy: 'A y',
    transformMirrorBx: 'B x',
    transformMirrorBy: 'B y',
    transformMirrorUseSelected: 'Use 2 selected points',
  },
  ja: {
    title: 'ソルバースケッチ',
    select: '選択', line: '線', circle: '円', arc: '弧', rect: '矩形', dimension: '寸法',
    trim: 'トリム', extend: '延長', offset: 'オフセット',
    horizontal: '水平', vertical: '垂直', perpendicular: '直角', parallel: '平行', coincident: '一致',
    close: '閉じる',
    loading: 'ソルバー読込中...',
    error: 'ソルバー読込失敗',
    dofUnder: '未定義', dofFull: '完全定義', dofOver: '過定義',
    dofLabel: 'DoF',
    statusReady: '準備完了',
    statusSolving: '計算中',
    statusConflict: '矛盾制約',
    statusRedundant: '冗長制約',
    promptDistance: '距離 (mm):',
    promptOffset: 'オフセット距離 (mm):',
    hint: 'ツールを選びキャンバスをクリック',
    snapLabel: 'スナップ',
    snapGrid: 'グリッド',
    snapPoint: '点',
    snapIntersection: '交差',
    snapArc: '弧',
    snapPerpendicular: '垂線',
    exportSvg: 'SVG出力',
    svgFilename: 'スケッチ',
    exportModal: 'エクスポート...',
    import: 'インポート...',
    importSvg: 'SVGインポート',
    importMode: 'インポート方式',
    importReplace: '置換',
    importMerge: 'マージ',
    aiConstraint: 'AI',
    showAiConstraint: 'AI拘束パネルを表示',
    groups: 'グループ',
    groupSelected: '選択をグループ化',
    groupName: 'グループ名',
    showGroups: 'グループパネル表示',
    transform: '変換',
    opTranslate: '移動',
    opRotate: '回転',
    opScale: '拡縮',
    opMirror: 'ミラー',
    showTransform: '変換パネル表示',
    expressions: '変数',
    showExpressions: '変数パネル表示',
    transformScopeAll: '全体',
    transformScopeSelection: '選択',
    transformApply: '適用',
    transformReset: 'リセット',
    transformRecapture: 'スナップショット再取得',
    transformDx: 'dx',
    transformDy: 'dy',
    transformAngleDeg: '角度(°)',
    transformCenterX: '中心x',
    transformCenterY: '中心y',
    transformFactor: '倍率',
    transformMirrorAx: 'A x',
    transformMirrorAy: 'A y',
    transformMirrorBx: 'B x',
    transformMirrorBy: 'B y',
    transformMirrorUseSelected: '選択した2点を使用',
  },
  zh: {
    title: '求解器草图',
    select: '选择', line: '线', circle: '圆', arc: '弧', rect: '矩形', dimension: '尺寸',
    trim: '修剪', extend: '延伸', offset: '偏移',
    horizontal: '水平', vertical: '垂直', perpendicular: '垂直(L)', parallel: '平行', coincident: '重合',
    close: '关闭',
    loading: '加载求解器...',
    error: '求解器加载失败',
    dofUnder: '未约束', dofFull: '完全约束', dofOver: '过约束',
    dofLabel: 'DoF',
    statusReady: '就绪',
    statusSolving: '求解中',
    statusConflict: '冲突约束',
    statusRedundant: '冗余约束',
    promptDistance: '距离 (mm):',
    promptOffset: '偏移距离 (mm):',
    hint: '选择工具并点击画布',
    snapLabel: '捕捉',
    snapGrid: '网格',
    snapPoint: '点',
    snapIntersection: '交点',
    snapArc: '弧',
    snapPerpendicular: '垂线',
    exportSvg: '导出SVG',
    svgFilename: '草图',
    exportModal: '导出...',
    import: '导入...',
    importSvg: '导入SVG',
    importMode: '导入模式',
    importReplace: '替换',
    importMerge: '合并',
    aiConstraint: 'AI',
    showAiConstraint: '显示AI约束面板',
    groups: '组',
    groupSelected: '将所选编为组',
    groupName: '组名',
    showGroups: '显示分组面板',
    transform: '变换',
    opTranslate: '平移',
    opRotate: '旋转',
    opScale: '缩放',
    opMirror: '镜像',
    showTransform: '显示变换面板',
    expressions: '变量',
    showExpressions: '显示变量面板',
    transformScopeAll: '全部',
    transformScopeSelection: '选择',
    transformApply: '应用',
    transformReset: '重置',
    transformRecapture: '重新捕获快照',
    transformDx: 'dx',
    transformDy: 'dy',
    transformAngleDeg: '角度(°)',
    transformCenterX: '中心 x',
    transformCenterY: '中心 y',
    transformFactor: '比例',
    transformMirrorAx: 'A x',
    transformMirrorAy: 'A y',
    transformMirrorBx: 'B x',
    transformMirrorBy: 'B y',
    transformMirrorUseSelected: '使用所选两点',
  },
  es: {
    title: 'Boceto con solver',
    select: 'Sel', line: 'Línea', circle: 'Círc', arc: 'Arco', rect: 'Rect', dimension: 'Cota',
    trim: 'Recortar', extend: 'Extender', offset: 'Desfase',
    horizontal: 'Horiz', vertical: 'Vert', perpendicular: 'Perp', parallel: 'Paral', coincident: 'Coinc',
    close: 'Cerrar',
    loading: 'Cargando solver...',
    error: 'Solver falló al cargar',
    dofUnder: 'subrestringido', dofFull: 'totalmente restringido', dofOver: 'sobrerrestringido',
    dofLabel: 'DoF',
    statusReady: 'listo',
    statusSolving: 'resolviendo',
    statusConflict: 'restricciones en conflicto',
    statusRedundant: 'restricciones redundantes',
    promptDistance: 'Distancia (mm):',
    promptOffset: 'Distancia de desfase (mm):',
    hint: 'Elige herramienta y haz clic',
    snapLabel: 'Snap',
    snapGrid: 'Rejilla',
    snapPoint: 'Punto',
    snapIntersection: 'Int',
    snapArc: 'Arco',
    snapPerpendicular: 'Perp',
    exportSvg: 'Exportar SVG',
    svgFilename: 'boceto',
    exportModal: 'Exportar...',
    import: 'Importar...',
    importSvg: 'Importar SVG',
    importMode: 'Modo de importación',
    importReplace: 'Reemplazar',
    importMerge: 'Combinar',
    aiConstraint: 'IA',
    showAiConstraint: 'Mostrar panel de restricciones IA',
    groups: 'Grupos',
    groupSelected: 'Agrupar selección',
    groupName: 'Nombre del grupo',
    showGroups: 'Mostrar panel de grupos',
    transform: 'Transformar',
    opTranslate: 'Trasladar',
    opRotate: 'Rotar',
    opScale: 'Escalar',
    opMirror: 'Reflejar',
    showTransform: 'Mostrar panel de transformación',
    expressions: 'Variables',
    showExpressions: 'Mostrar panel de variables',
    transformScopeAll: 'Todo',
    transformScopeSelection: 'Selección',
    transformApply: 'Aplicar',
    transformReset: 'Restablecer',
    transformRecapture: 'Recapturar instantánea',
    transformDx: 'dx',
    transformDy: 'dy',
    transformAngleDeg: 'ángulo (°)',
    transformCenterX: 'cx',
    transformCenterY: 'cy',
    transformFactor: 'factor',
    transformMirrorAx: 'A x',
    transformMirrorAy: 'A y',
    transformMirrorBx: 'B x',
    transformMirrorBy: 'B y',
    transformMirrorUseSelected: 'Usar 2 puntos seleccionados',
  },
  ar: {
    title: 'رسم بمحلل',
    select: 'تحديد', line: 'خط', circle: 'دائرة', arc: 'قوس', rect: 'مستطيل', dimension: 'بعد',
    trim: 'قص', extend: 'تمديد', offset: 'إزاحة',
    horizontal: 'أفقي', vertical: 'رأسي', perpendicular: 'متعامد', parallel: 'متوازي', coincident: 'متطابق',
    close: 'إغلاق',
    loading: 'تحميل المحلل...',
    error: 'فشل تحميل المحلل',
    dofUnder: 'ناقص القيود', dofFull: 'مقيد كاملاً', dofOver: 'مفرط القيود',
    dofLabel: 'DoF',
    statusReady: 'جاهز',
    statusSolving: 'يحل',
    statusConflict: 'قيود متعارضة',
    statusRedundant: 'قيود زائدة',
    promptDistance: 'المسافة (مم):',
    promptOffset: 'مسافة الإزاحة (مم):',
    hint: 'اختر أداة وانقر على اللوحة',
    snapLabel: 'محاذاة',
    snapGrid: 'شبكة',
    snapPoint: 'نقطة',
    snapIntersection: 'تقاطع',
    snapArc: 'قوس',
    snapPerpendicular: 'عمودي',
    exportSvg: 'تصدير SVG',
    svgFilename: 'رسم',
    exportModal: 'تصدير...',
    import: 'استيراد...',
    importSvg: 'استيراد SVG',
    importMode: 'وضع الاستيراد',
    importReplace: 'استبدال',
    importMerge: 'دمج',
    aiConstraint: 'ذكاء',
    showAiConstraint: 'إظهار لوحة قيود الذكاء',
    groups: 'مجموعات',
    groupSelected: 'تجميع المحدد',
    groupName: 'اسم المجموعة',
    showGroups: 'إظهار لوحة المجموعات',
    transform: 'تحويل',
    opTranslate: 'إزاحة',
    opRotate: 'تدوير',
    opScale: 'تكبير',
    opMirror: 'انعكاس',
    showTransform: 'إظهار لوحة التحويل',
    expressions: 'متغيرات',
    showExpressions: 'إظهار لوحة المتغيرات',
    transformScopeAll: 'الكل',
    transformScopeSelection: 'المحدد',
    transformApply: 'تطبيق',
    transformReset: 'إعادة',
    transformRecapture: 'إعادة التقاط',
    transformDx: 'dx',
    transformDy: 'dy',
    transformAngleDeg: 'الزاوية (°)',
    transformCenterX: 'cx',
    transformCenterY: 'cy',
    transformFactor: 'المعامل',
    transformMirrorAx: 'A x',
    transformMirrorAy: 'A y',
    transformMirrorBx: 'B x',
    transformMirrorBy: 'B y',
    transformMirrorUseSelected: 'استخدم نقطتين محددتين',
  },
};

// ─── view-side entity model (mirrors solver state for SVG render) ─────────

type EntityKind = 'point' | 'line' | 'circle';

interface ViewPoint {
  id: PointId;
  kind: 'point';
  x: number;
  y: number;
  fixed: boolean;
}
interface ViewLine {
  id: LineId;
  kind: 'line';
  p1: PointId;
  p2: PointId;
}
interface ViewCircle {
  id: CircleId;
  kind: 'circle';
  center: PointId;
  radius: number;
}
type ViewEntity = ViewPoint | ViewLine | ViewCircle;

// ─── tool button registry ─────────────────────────────────────────────────

interface EntityToolDef {
  id: EntityTool;
  label: (t: Dict) => string;
}
interface ConstraintToolDef {
  id: ConstraintTool;
  label: (t: Dict) => string;
  /** How many entities of which kind (in order) are required. */
  requires: ReadonlyArray<EntityKind>;
}

const ENTITY_TOOLS: EntityToolDef[] = [
  { id: 'select', label: (t) => t.select },
  { id: 'line', label: (t) => t.line },
  { id: 'circle', label: (t) => t.circle },
  { id: 'arc', label: (t) => t.arc },
  { id: 'rect', label: (t) => t.rect },
  { id: 'dimension', label: (t) => t.dimension },
  { id: 'trim', label: (t) => t.trim },
  { id: 'extend', label: (t) => t.extend },
  { id: 'offset', label: (t) => t.offset },
];

const CONSTRAINT_TOOLS: ConstraintToolDef[] = [
  { id: 'horizontal', label: (t) => t.horizontal, requires: ['line'] },
  { id: 'vertical', label: (t) => t.vertical, requires: ['line'] },
  { id: 'perpendicular', label: (t) => t.perpendicular, requires: ['line', 'line'] },
  { id: 'parallel', label: (t) => t.parallel, requires: ['line', 'line'] },
  { id: 'coincident', label: (t) => t.coincident, requires: ['point', 'point'] },
];

// ─── coordinate helper (same shape as v1.lite) ────────────────────────────

function eventToSvgPoint(
  evt: React.MouseEvent<SVGElement>,
  svg: SVGSVGElement | null,
): { x: number; y: number } {
  if (!svg) return { x: evt.clientX, y: evt.clientY };
  try {
    if (typeof svg.createSVGPoint !== 'function') {
      return { x: evt.clientX, y: evt.clientY };
    }
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    if (!ctm) return { x: evt.clientX, y: evt.clientY };
    const tx = pt.matrixTransform(ctm.inverse());
    return { x: tx.x, y: tx.y };
  } catch {
    return { x: evt.clientX, y: evt.clientY };
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Intersection of two infinite lines defined by (a1→a2) and (b1→b2).
 * Returns the intersection point + the parameter `t` along the first line
 * (0 = a1, 1 = a2, >1 = past a2 in the a1→a2 direction).
 * Returns null when the lines are parallel (denominator ~0).
 */
function lineLineIntersection(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): { x: number; y: number; t: number } | null {
  const dxA = a2.x - a1.x;
  const dyA = a2.y - a1.y;
  const dxB = b2.x - b1.x;
  const dyB = b2.y - b1.y;
  const denom = dxA * dyB - dyA * dxB;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * dyB - (b1.y - a1.y) * dxB) / denom;
  return { x: a1.x + dxA * t, y: a1.y + dyA * t, t };
}

/**
 * Perpendicular offset of a line segment by `distance` toward the side of
 * `clickPoint`. Returns the two offset endpoints.
 */
function offsetLine(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  distance: number,
  clickPoint: { x: number; y: number },
): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  // Unit perpendicular (rotated 90° CCW).
  const nx = -dy / len;
  const ny = dx / len;
  // Side test: sign of dot((click - p1), normal). Positive → same side as +normal.
  const side = (clickPoint.x - p1.x) * nx + (clickPoint.y - p1.y) * ny;
  const sign = side >= 0 ? 1 : -1;
  const ox = nx * distance * sign;
  const oy = ny * distance * sign;
  return {
    a: { x: p1.x + ox, y: p1.y + oy },
    b: { x: p2.x + ox, y: p2.y + oy },
  };
}

// ─── pending tool state ───────────────────────────────────────────────────

interface PendingLine { kind: 'line'; start: { x: number; y: number } }
interface PendingCircle { kind: 'circle'; center: { x: number; y: number } }
interface PendingRect { kind: 'rect'; corner: { x: number; y: number } }
interface PendingDimension { kind: 'dimension'; firstPoint: PointId }
type Pending = PendingLine | PendingCircle | PendingRect | PendingDimension | null;

// ─── grid ─────────────────────────────────────────────────────────────────

const GRID_MINOR = 5;
const GRID_MAJOR = 25;

function Grid({ width, height }: { width: number; height: number }): React.ReactElement {
  const out: React.ReactElement[] = [];
  for (let x = 0; x <= width; x += GRID_MINOR) {
    const major = x % GRID_MAJOR === 0;
    out.push(<line key={`vx-${x}`} x1={x} y1={0} x2={x} y2={height} stroke={major ? '#d4d4d8' : '#ececef'} strokeWidth={major ? 0.6 : 0.4} />);
  }
  for (let y = 0; y <= height; y += GRID_MINOR) {
    const major = y % GRID_MAJOR === 0;
    out.push(<line key={`hy-${y}`} x1={0} y1={y} x2={width} y2={y} stroke={major ? '#d4d4d8' : '#ececef'} strokeWidth={major ? 0.6 : 0.4} />);
  }
  return <g aria-hidden="true">{out}</g>;
}

// ─── DoF panel ────────────────────────────────────────────────────────────

function dofState(dof: number): 'under' | 'full' | 'over' {
  if (dof > 0) return 'under';
  if (dof < 0) return 'over';
  return 'full';
}

function dofColor(state: 'under' | 'full' | 'over'): string {
  if (state === 'full') return '#16a34a';
  if (state === 'over') return '#dc2626';
  return '#2563eb';
}

// ─── main component ───────────────────────────────────────────────────────

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

export default function SolverSketchEditor({
  lang = 'en',
  onSketchChange,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  onClose,
  projectId,
  defaultShowSketchAi = false,
}: SolverSketchEditorProps): React.ReactElement {
  const t = dict[lang];
  const svgRef = useRef<SVGSVGElement | null>(null);

  // ─── solver lifecycle ───
  const [solver, setSolver] = useState<SketchSolver | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    let instance: SketchSolver | null = null;
    (async () => {
      try {
        const s = await createSketchSolver();
        if (canceled) {
          s.destroy();
          return;
        }
        instance = s;
        setSolver(s);
      } catch (e) {
        if (!canceled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      canceled = true;
      instance?.destroy();
    };
  }, []);

  // ─── view state mirrors solver state ───
  const [entities, setEntities] = useState<ViewEntity[]>([]);
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [tool, setTool] = useState<EntityTool>('select');
  const [pending, setPending] = useState<Pending>(null);
  // New richer selection: tracks { kind, id } refs for the SketchConstraintToolbar.
  // Legacy `selected` (id-only string[]) is derived via useMemo below so the
  // existing inline constraint toolbar + entity rendering keep working unchanged.
  const [selection, setSelection] = useState<SketchEntityRef[]>([]);
  const selected = useMemo(() => selection.map((s) => s.id), [selection]);
  const [drag, setDrag] = useState<{ pointId: PointId } | null>(null);
  // Phase 1.B overlay state: snapshot of solver.getConstraints() refreshed
  // after every solve. The overlay reads this + entity coords to render
  // dim-lines/arcs/badges. Selected constraint is highlighted blue.
  const [constraintSnapshot, setConstraintSnapshot] = useState<
    ReadonlyArray<SerializedConstraint>
  >([]);
  const [selectedConstraintId, setSelectedConstraintId] = useState<string | null>(null);

  // ─── snap state (Phase 1.4 + Phase 2) ───
  // Snap options control which families of candidates `findSnapTarget` will
  // consider. Phase 1 defaults (grid + point + intersection) are on so an
  // "out-of-the-box" sketch session feels responsive. Phase 2 families (arc
  // endpoints/centers/quadrants/midpoints + perpendicular foot to line and
  // circle) are intentionally OFF by default — they fire many extra
  // candidates per cursor move (esp. perpendicular foot, which targets the
  // *interior* of every line/circle within threshold), so opting in keeps
  // the indicator quiet for users who only need vertex snaps. When every
  // toggle is off snap is a no-op and the raw cursor is used (zero
  // regression vs. v1.lite behavior).
  const [snapOpts, setSnapOpts] = useState<{
    enableGrid: boolean;
    enablePointSnap: boolean;
    enableIntersection: boolean;
    enableArc: boolean;
    enablePerpendicular: boolean;
    gridSpacing: number;
  }>({
    enableGrid: true,
    enablePointSnap: true,
    enableIntersection: true,
    enableArc: false,
    enablePerpendicular: false,
    gridSpacing: GRID_MINOR,
  });
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);

  // ─── helper: refresh view entities from solver after a solve ───
  const refreshFromSolver = useCallback((s: SketchSolver, current: ViewEntity[]): ViewEntity[] => {
    return current.map((ent) => {
      if (ent.kind === 'point') {
        const p = s.point(ent.id);
        return { ...ent, x: p.x, y: p.y };
      }
      return ent;
    });
  }, []);

  // ─── helper: solve and update both view + result ───
  const solveAndApply = useCallback(
    (next?: ViewEntity[]) => {
      if (!solver) return;
      const result = solver.solve();
      setSolveResult(result);
      setEntities((prev) => refreshFromSolver(solver, next ?? prev));
      // Refresh constraint snapshot for the overlay. We do this on every
      // solve so newly-added constraints appear immediately + removed ones
      // disappear without an extra re-render hop.
      setConstraintSnapshot(solver.getConstraints());
    },
    [solver, refreshFromSolver],
  );

  // ─── debounced re-solve for bulk property panel edits ─────────────────
  //
  // The property panel fires onChange/onDelete *synchronously, once per
  // selected entity* in bulk mode. With a 3-point bulk x-edit the panel
  // would otherwise produce 3 back-to-back solver.solve() calls inside the
  // same task — wasted work, and (more importantly) the intermediate
  // solves operate on a half-mutated state that may briefly look
  // over-constrained until the last call lands.
  //
  // `scheduleSolveAndApply` collapses any number of calls within the same
  // macrotask into a single solve. The window is intentionally tiny — a
  // 0ms timeout — because all we want is "after every currently-queued
  // synchronous mutate has run". 0ms suffices for the panel's
  // `for (const p of points) onChange(p.id, ...)` loop.
  //
  // Mutations that need an immediate solve (e.g. line drawing) keep using
  // `solveAndApply` directly — debouncing only matters when there's a
  // burst of callers.
  const pendingSolveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSolveAndApply = useCallback((): void => {
    if (pendingSolveRef.current) return; // already scheduled within this tick
    pendingSolveRef.current = setTimeout(() => {
      pendingSolveRef.current = null;
      solveAndApply();
    }, 0);
  }, [solveAndApply]);
  // Clean up any pending solve when the component unmounts so we don't
  // touch a destroyed solver from the timer callback.
  useEffect(() => {
    return () => {
      if (pendingSolveRef.current) {
        clearTimeout(pendingSolveRef.current);
        pendingSolveRef.current = null;
      }
    };
  }, []);

  // ─── tool switching ───
  const changeTool = useCallback((next: EntityTool): void => {
    setTool(next);
    setPending(null);
    // Drop any stale snap indicator the previous tool may have left behind.
    // Re-computed on the next mousemove if the new tool is a drawing tool.
    setSnapTarget(null);
    if (next !== 'select') setSelection([]);
  }, []);

  // ─── entity creation: line ───
  const commitLine = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }): void => {
      if (!solver) return;
      const p1 = solver.addPoint(start.x, start.y);
      const p2 = solver.addPoint(end.x, end.y);
      const l = solver.addLine(p1, p2);
      const next: ViewEntity[] = [
        ...entities,
        { id: p1, kind: 'point', x: start.x, y: start.y, fixed: false },
        { id: p2, kind: 'point', x: end.x, y: end.y, fixed: false },
        { id: l, kind: 'line', p1, p2 },
      ];
      solveAndApply(next);
    },
    [solver, entities, solveAndApply],
  );

  // ─── entity creation: circle (center + edge-point defines radius) ───
  const commitCircle = useCallback(
    (center: { x: number; y: number }, edge: { x: number; y: number }): void => {
      if (!solver) return;
      const r = dist(center.x, center.y, edge.x, edge.y);
      if (r < 0.5) return;
      const c = solver.addPoint(center.x, center.y);
      const circle = solver.addCircle(c, r);
      const next: ViewEntity[] = [
        ...entities,
        { id: c, kind: 'point', x: center.x, y: center.y, fixed: false },
        { id: circle, kind: 'circle', center: c, radius: r },
      ];
      solveAndApply(next);
    },
    [solver, entities, solveAndApply],
  );

  // ─── entity creation: rect (4 lines + 4 coincidents at corners) ───
  const commitRect = useCallback(
    (a: { x: number; y: number }, b: { x: number; y: number }): void => {
      if (!solver) return;
      const x1 = Math.min(a.x, b.x);
      const y1 = Math.min(a.y, b.y);
      const x2 = Math.max(a.x, b.x);
      const y2 = Math.max(a.y, b.y);
      if (x2 - x1 < 0.5 || y2 - y1 < 0.5) return;

      // 4 corner points + 4 lines + horizontal/vertical pinning makes a robust rect.
      const p1 = solver.addPoint(x1, y1);
      const p2 = solver.addPoint(x2, y1);
      const p3 = solver.addPoint(x2, y2);
      const p4 = solver.addPoint(x1, y2);
      const top = solver.addLine(p1, p2);
      const right = solver.addLine(p2, p3);
      const bot = solver.addLine(p4, p3);
      const left = solver.addLine(p1, p4);
      solver.addHorizontal(top);
      solver.addHorizontal(bot);
      solver.addVertical(left);
      solver.addVertical(right);

      const next: ViewEntity[] = [
        ...entities,
        { id: p1, kind: 'point', x: x1, y: y1, fixed: false },
        { id: p2, kind: 'point', x: x2, y: y1, fixed: false },
        { id: p3, kind: 'point', x: x2, y: y2, fixed: false },
        { id: p4, kind: 'point', x: x1, y: y2, fixed: false },
        { id: top, kind: 'line', p1, p2 },
        { id: right, kind: 'line', p1: p2, p2: p3 },
        { id: bot, kind: 'line', p1: p4, p2: p3 },
        { id: left, kind: 'line', p1, p2: p4 },
      ];
      solveAndApply(next);
    },
    [solver, entities, solveAndApply],
  );

  // ─── modification tool: trim (Phase 2 — SW-style "trim to nearest intersection") ───
  // Click a line; find the nearest intersection (segment-segment, not infinite-line)
  // to the click point; move the endpoint on the click side to that intersection,
  // collapsing the click-side stub. If no intersection exists the legacy behavior
  // (remove the whole line) kicks in. Phase 1 limitation: a click that falls
  // between two intersections still removes one whole side — true split (one
  // line → two lines, dropping the middle) is deferred.
  const TRIM_TOLERANCE = 10; // sketch units; matches task spec
  const commitTrim = useCallback(
    (lineId: string, clickPoint: { x: number; y: number }): void => {
      if (!solver) return;
      const ent = entities.find((e) => e.id === lineId);
      // Phase 1 supports lines only; clicks on circles/arcs/points are no-ops.
      if (!ent || ent.kind !== 'line') return;

      const p1 = entities.find((e) => e.id === ent.p1);
      const p2 = entities.find((e) => e.id === ent.p2);
      if (!p1 || !p2 || p1.kind !== 'point' || p2.kind !== 'point') return;

      const a1 = { x: p1.x, y: p1.y };
      const a2 = { x: p2.x, y: p2.y };
      const dxA = a2.x - a1.x;
      const dyA = a2.y - a1.y;
      const lenSq = dxA * dxA + dyA * dyA;
      if (lenSq < 1e-9) return; // zero-length line

      // Project click onto the line. tClick in [0,1] = within segment.
      const tClick = ((clickPoint.x - a1.x) * dxA + (clickPoint.y - a1.y) * dyA) / lenSq;
      const perpX = clickPoint.x - (a1.x + dxA * tClick);
      const perpY = clickPoint.y - (a1.y + dyA * tClick);
      const perpDist = Math.hypot(perpX, perpY);
      // Too far from the line, or click effectively at an endpoint → no-op.
      if (perpDist > TRIM_TOLERANCE) return;
      if (tClick < 0.02 || tClick > 0.98) return;

      // Find all OTHER lines that intersect this one as a true segment-segment
      // intersection. Use lineLineIntersection (returns `t` along a1→a2); also
      // re-derive the param `u` along the other line to confirm 0<u<1.
      const otherLines = entities.filter(
        (e): e is ViewLine => e.kind === 'line' && e.id !== ent.id,
      );
      const hits: Array<{ t: number; x: number; y: number }> = [];
      for (const other of otherLines) {
        const ob1 = entities.find((e) => e.id === other.p1);
        const ob2 = entities.find((e) => e.id === other.p2);
        if (!ob1 || !ob2 || ob1.kind !== 'point' || ob2.kind !== 'point') continue;
        const hit = lineLineIntersection(a1, a2, { x: ob1.x, y: ob1.y }, { x: ob2.x, y: ob2.y });
        if (!hit) continue; // parallel
        // Verify hit is within the clicked segment.
        if (hit.t <= 0 || hit.t >= 1) continue;
        // Re-derive u along the other line — must also be within (0,1) for a
        // true crossing (skip when the other segment doesn't reach this line).
        const dxB = ob2.x - ob1.x;
        const dyB = ob2.y - ob1.y;
        const lenSqB = dxB * dxB + dyB * dyB;
        if (lenSqB < 1e-9) continue;
        const u = ((hit.x - ob1.x) * dxB + (hit.y - ob1.y) * dyB) / lenSqB;
        if (u <= 0 || u >= 1) continue;
        hits.push({ t: hit.t, x: hit.x, y: hit.y });
      }

      if (hits.length === 0) {
        // No intersection → legacy behavior: drop the whole line entity.
        console.warn(
          `[SolverSketchEditor.trim] no intersection found on line ${lineId}; removing whole line`,
        );
        const next = entities.filter((e) => e.id !== lineId);
        solveAndApply(next);
        return;
      }

      // Pick the intersection nearest to the click (in parameter space — same
      // order as Euclidean distance on a straight segment).
      let nearest = hits[0]!;
      for (const h of hits) {
        if (Math.abs(h.t - tClick) < Math.abs(nearest.t - tClick)) nearest = h;
      }
      // Move whichever endpoint sits on the click side of the intersection.
      // tClick > tNearest → click is on the p2 side → collapse p2 to intersection.
      const moveTargetId = tClick > nearest.t ? ent.p2 : ent.p1;
      try {
        solver.movePoint(moveTargetId as PointId, nearest.x, nearest.y);
        solveAndApply();
      } catch {
        // Endpoint is fixed (e.g. dimension-pinned) — skip silently; better UX
        // than throwing in the middle of a click handler.
      }
    },
    [solver, entities, solveAndApply],
  );

  // ─── modification tool: extend (move endpoint to nearest line intersection) ───
  const commitExtend = useCallback(
    (pointId: string): void => {
      if (!solver) return;
      const pt = entities.find((e) => e.id === pointId);
      if (!pt || pt.kind !== 'point') return;

      // Find lines that use this point as an endpoint.
      const lines = entities.filter((e): e is ViewLine => e.kind === 'line');
      const owning = lines.filter((l) => l.p1 === pt.id || l.p2 === pt.id);
      if (owning.length === 0) return;
      // Pick the first owning line — the "extended" line is unambiguous when
      // a single segment terminates at the point. (Multi-line junction is
      // Phase 2: would need disambiguation UI.)
      const line = owning[0]!;
      const other = lines.find((l) => l.id !== line.id);
      if (!other) return;

      const a1 = entities.find((e) => e.id === line.p1);
      const a2 = entities.find((e) => e.id === line.p2);
      const b1 = entities.find((e) => e.id === other.p1);
      const b2 = entities.find((e) => e.id === other.p2);
      if (
        !a1 || !a2 || !b1 || !b2 ||
        a1.kind !== 'point' || a2.kind !== 'point' ||
        b1.kind !== 'point' || b2.kind !== 'point'
      ) return;

      const hit = lineLineIntersection(
        { x: a1.x, y: a1.y },
        { x: a2.x, y: a2.y },
        { x: b1.x, y: b1.y },
        { x: b2.x, y: b2.y },
      );
      if (!hit) return; // parallel

      // We want to move `pt` (the clicked endpoint) to the intersection,
      // but only if the intersection lies past the endpoint (i.e. extending
      // outward, not shrinking). If it's between the two endpoints that's a
      // shrink — disallow in Phase 1.
      const isP1 = line.p1 === pt.id;
      // Param `t` is along a1→a2. If extending p1, intersection must be at t<0;
      // if extending p2, intersection must be at t>1.
      if (isP1 && hit.t > 0) return;
      if (!isP1 && hit.t < 1) return;

      try {
        solver.movePoint(pt.id as PointId, hit.x, hit.y);
        solveAndApply();
      } catch {
        /* fixed point — ignore */
      }
    },
    [solver, entities, solveAndApply],
  );

  // ─── modification tool: offset (parallel line at perpendicular distance) ───
  const commitOffset = useCallback(
    (lineId: string, clickPoint: { x: number; y: number }): void => {
      if (!solver) return;
      const ent = entities.find((e) => e.id === lineId);
      if (!ent || ent.kind !== 'line') return;
      const p1 = entities.find((e) => e.id === ent.p1);
      const p2 = entities.find((e) => e.id === ent.p2);
      if (!p1 || !p2 || p1.kind !== 'point' || p2.kind !== 'point') return;

      const raw = window.prompt(t.promptOffset);
      if (raw === null) return;
      const d = Number(raw);
      if (!Number.isFinite(d) || d <= 0) return;

      const off = offsetLine(
        { x: p1.x, y: p1.y },
        { x: p2.x, y: p2.y },
        d,
        clickPoint,
      );
      if (!off) return;

      const np1 = solver.addPoint(off.a.x, off.a.y);
      const np2 = solver.addPoint(off.b.x, off.b.y);
      const nl = solver.addLine(np1, np2);
      const next: ViewEntity[] = [
        ...entities,
        { id: np1, kind: 'point', x: off.a.x, y: off.a.y, fixed: false },
        { id: np2, kind: 'point', x: off.b.x, y: off.b.y, fixed: false },
        { id: nl, kind: 'line', p1: np1, p2: np2 },
      ];
      solveAndApply(next);
    },
    [solver, entities, solveAndApply, t.promptOffset],
  );

  // ─── snap helpers (declared before click handler — used by both
  //     handleCanvasClick and handleCanvasMove) ───
  const isDrawingTool = useCallback(
    (t: EntityTool): boolean =>
      t === 'line' || t === 'circle' || t === 'arc' || t === 'rect',
    [],
  );

  // Build the SnapEntities snapshot — same projection the editor uses to
  // render geometry, but flattened into the shape `findSnapTarget` expects.
  const snapEntities = useMemo<SnapEntities>(() => {
    const ptMap = new Map<PointId, ViewPoint>();
    for (const e of entities) if (e.kind === 'point') ptMap.set(e.id, e);
    const points = entities
      .filter((e): e is ViewPoint => e.kind === 'point')
      .map((p) => ({ id: p.id as string, x: p.x, y: p.y }));
    const lines = entities
      .filter((e): e is ViewLine => e.kind === 'line')
      .map((l) => {
        const a = ptMap.get(l.p1);
        const b = ptMap.get(l.p2);
        if (!a || !b) return null;
        return {
          id: l.id as string,
          p1: { x: a.x, y: a.y },
          p2: { x: b.x, y: b.y },
        };
      })
      .filter((x): x is { id: string; p1: { x: number; y: number }; p2: { x: number; y: number } } => x !== null);
    const circles = entities
      .filter((e): e is ViewCircle => e.kind === 'circle')
      .map((c) => {
        const ctr = ptMap.get(c.center);
        if (!ctr) return null;
        return {
          id: c.id as string,
          center: { x: ctr.x, y: ctr.y },
          radius: c.radius,
        };
      })
      .filter((x): x is { id: string; center: { x: number; y: number }; radius: number } => x !== null);
    return { points, lines, circles };
  }, [entities]);

  // Compute a snap target for the cursor under the current options. Returns
  // null when the active tool isn't a drawing tool OR when every option is
  // disabled (so the host falls back to the raw cursor). Kept as a pure
  // helper so the click handlers can re-call it on the click-final position
  // without depending on the indicator state ordering.
  const computeSnapAt = useCallback(
    (pt: { x: number; y: number }): SnapTarget | null => {
      if (!isDrawingTool(tool)) return null;
      const {
        enableGrid,
        enablePointSnap,
        enableIntersection,
        enableArc,
        enablePerpendicular,
        gridSpacing,
      } = snapOpts;
      // No-op when every snap family is disabled — host falls back to the
      // raw cursor and the indicator stays unmounted.
      if (
        !enableGrid &&
        !enablePointSnap &&
        !enableIntersection &&
        !enableArc &&
        !enablePerpendicular
      ) return null;
      return findSnapTarget(pt, snapEntities, {
        gridSpacing,
        enableGrid,
        enablePointSnap,
        enableIntersection,
        // Phase 2 toggles now driven by user-visible toolbar buttons (Arc /
        // Perpendicular). Defaults are OFF so back-compat is preserved.
        enableArc,
        enablePerpendicular,
      });
    },
    [isDrawingTool, tool, snapOpts, snapEntities],
  );

  // ─── canvas click ───
  const handleCanvasClick = useCallback(
    (evt: React.MouseEvent<SVGSVGElement>): void => {
      if (!solver) return;
      const rawPt = eventToSvgPoint(evt, svgRef.current);
      // When a drawing tool is active, snap the click position to the best
      // candidate under the current snap options. Recomputed at click time
      // (rather than reusing `snapTarget` state) so the solver gets the
      // exact coordinate that matches the final click — no race with the
      // last mousemove. Falls back to raw cursor when snap returns null.
      const snap = computeSnapAt(rawPt);
      const pt = snap ? snap.pos : rawPt;

      if (tool === 'select') {
        // Empty-canvas click clears selection (when no modifier held).
        // Modifier-held empty click is a no-op so users can carefully build
        // a selection without losing it by accidentally missing an entity.
        if (!evt.shiftKey && !evt.ctrlKey && !evt.metaKey) {
          setSelection([]);
        }
        return;
      }

      if (tool === 'line') {
        if (!pending || pending.kind !== 'line') {
          setPending({ kind: 'line', start: pt });
        } else {
          commitLine(pending.start, pt);
          setPending(null);
        }
        return;
      }
      if (tool === 'circle') {
        if (!pending || pending.kind !== 'circle') {
          setPending({ kind: 'circle', center: pt });
        } else {
          commitCircle(pending.center, pt);
          setPending(null);
        }
        return;
      }
      if (tool === 'rect') {
        if (!pending || pending.kind !== 'rect') {
          setPending({ kind: 'rect', corner: pt });
        } else {
          commitRect(pending.corner, pt);
          setPending(null);
        }
        return;
      }
      // arc: not yet wired — Phase 1.4 placeholder.
      // dimension: needs entity selection; canvas-empty click does nothing.
    },
    [solver, tool, pending, commitLine, commitCircle, commitRect, computeSnapAt],
  );

  // ─── canvas move (preview + drag + snap) ───
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const handleCanvasMove = useCallback(
    (evt: React.MouseEvent<SVGSVGElement>): void => {
      const pt = eventToSvgPoint(evt, svgRef.current);
      setCursor(pt);
      // Update snap target indicator. Drag wins over snap (the user is moving
      // a real point, not previewing a new one), so we skip snap during drag.
      if (drag && solver) {
        setSnapTarget(null);
        try {
          solver.movePoint(drag.pointId, pt.x, pt.y);
          solveAndApply();
        } catch {
          /* fixed point or solver not ready */
        }
        return;
      }
      setSnapTarget(computeSnapAt(pt));
    },
    [drag, solver, solveAndApply, computeSnapAt],
  );

  const handleCanvasMouseUp = useCallback((): void => {
    if (drag) setDrag(null);
  }, [drag]);

  // ─── entity click ───
  const handleEntityClick = useCallback(
    (id: string, evt: React.MouseEvent<SVGElement>): void => {
      evt.stopPropagation();
      if (tool === 'select') {
        const ent = entities.find((e) => e.id === id);
        if (!ent) return;
        const ref: SketchEntityRef = { kind: ent.kind, id };
        const multi = evt.shiftKey || evt.ctrlKey || evt.metaKey;
        setSelection((prev) => {
          const existsIdx = prev.findIndex((r) => r.id === id);
          if (multi) {
            // Toggle in multi-select mode: click selected = deselect; click new = add.
            if (existsIdx >= 0) return prev.filter((_, i) => i !== existsIdx);
            return [...prev, ref];
          }
          // Single-select mode:
          //   - if clicking the already-only-selected entity, deselect it (toggle off);
          //   - otherwise replace with just this entity.
          if (prev.length === 1 && existsIdx === 0) return [];
          return [ref];
        });
        return;
      }
      if (tool === 'dimension') {
        const ent = entities.find((e) => e.id === id);
        if (!ent || ent.kind !== 'point') return;
        if (!pending || pending.kind !== 'dimension') {
          setPending({ kind: 'dimension', firstPoint: ent.id });
          return;
        }
        // Second point → prompt for distance.
        const distance = window.prompt(t.promptDistance);
        if (distance !== null && solver) {
          const d = Number(distance);
          if (Number.isFinite(d) && d > 0) {
            solver.addDistance(pending.firstPoint, ent.id, d);
            solveAndApply();
          }
        }
        setPending(null);
        return;
      }
      if (tool === 'trim') {
        const pt = eventToSvgPoint(evt as React.MouseEvent<SVGElement>, svgRef.current);
        commitTrim(id, pt);
        return;
      }
      if (tool === 'extend') {
        commitExtend(id);
        return;
      }
      if (tool === 'offset') {
        const pt = eventToSvgPoint(evt as React.MouseEvent<SVGElement>, svgRef.current);
        commitOffset(id, pt);
        return;
      }
    },
    [tool, entities, pending, solver, solveAndApply, t.promptDistance, commitTrim, commitExtend, commitOffset],
  );

  // ─── point mousedown → start drag ───
  const handlePointMouseDown = useCallback(
    (id: PointId, evt: React.MouseEvent<SVGElement>): void => {
      if (tool !== 'select') return;
      evt.stopPropagation();
      setDrag({ pointId: id });
    },
    [tool],
  );

  // ─── apply geometric constraint to current selection ───
  const applyConstraint = useCallback(
    (kind: ConstraintTool): void => {
      if (!solver) return;
      const def = CONSTRAINT_TOOLS.find((c) => c.id === kind);
      if (!def) return;
      const sel = selected
        .map((id) => entities.find((e) => e.id === id))
        .filter((e): e is ViewEntity => !!e);
      if (sel.length !== def.requires.length) return;
      // Type-check selection against requirements.
      for (let i = 0; i < def.requires.length; i++) {
        if (sel[i]!.kind !== def.requires[i]) return;
      }
      try {
        if (kind === 'horizontal' && sel[0]!.kind === 'line') {
          solver.addHorizontal(sel[0]!.id as LineId);
        } else if (kind === 'vertical' && sel[0]!.kind === 'line') {
          solver.addVertical(sel[0]!.id as LineId);
        } else if (kind === 'perpendicular' && sel[0]!.kind === 'line' && sel[1]!.kind === 'line') {
          solver.addPerpendicular(sel[0]!.id as LineId, sel[1]!.id as LineId);
        } else if (kind === 'parallel' && sel[0]!.kind === 'line' && sel[1]!.kind === 'line') {
          solver.addParallel(sel[0]!.id as LineId, sel[1]!.id as LineId);
        } else if (kind === 'coincident' && sel[0]!.kind === 'point' && sel[1]!.kind === 'point') {
          solver.addCoincident(sel[0]!.id as PointId, sel[1]!.id as PointId);
        }
        solveAndApply();
        setSelection([]);
      } catch (e) {
        /* solver rejected — ignore */
        void e;
      }
    },
    [solver, selected, entities, solveAndApply],
  );

  // ─── SketchConstraintToolbar bridge ───
  //
  // The standalone toolbar speaks in a discriminated union (Constraint) over
  // SketchEntityRef tuples. Map each kind to the corresponding solver.addX
  // call and re-solve. We are deliberately tolerant here:
  //   - if the toolbar fires with a kind the solver doesn't yet support
  //     (e.g. arc-level tangent variants), we no-op rather than throw so
  //     the UI never crashes from a stale selection;
  //   - solver rejection (over-constrained, fixed point, etc.) is swallowed
  //     — the next solve() result will surface conflict/redundant pills.
  const handleToolbarAdd = useCallback(
    (constraint: ToolbarConstraint): void => {
      if (!solver) return;
      const refs = constraint.entities;
      const idOf = (idx: number, kind: SketchEntityKind): string | null => {
        const r = refs[idx];
        if (!r || r.kind !== kind) return null;
        return r.id;
      };
      try {
        switch (constraint.kind) {
          case 'coincident': {
            // n-ary: chain to first point so all coincide.
            const anchor = idOf(0, 'point');
            if (!anchor) return;
            for (let i = 1; i < refs.length; i++) {
              const other = idOf(i, 'point');
              if (other) solver.addCoincident(anchor as PointId, other as PointId);
            }
            break;
          }
          case 'parallel': {
            const a = idOf(0, 'line');
            const b = idOf(1, 'line');
            if (a && b) solver.addParallel(a as LineId, b as LineId);
            break;
          }
          case 'perpendicular': {
            const a = idOf(0, 'line');
            const b = idOf(1, 'line');
            if (a && b) solver.addPerpendicular(a as LineId, b as LineId);
            break;
          }
          case 'tangent': {
            // line+circle / line+arc / circle+circle / etc — solver figures
            // out the variant from kindOf().
            if (refs.length !== 2) return;
            const a = refs[0];
            const b = refs[1];
            if (!a || !b) return;
            // Skip point-bearing tangent requests; solver only supports curves.
            if (a.kind === 'point' || b.kind === 'point') return;
            solver.addTangent(
              a.id as LineId | CircleId | ArcId,
              b.id as LineId | CircleId | ArcId,
            );
            break;
          }
          case 'equal_length': {
            // No native equal_length in solver Phase 1.2. Pin equal distances
            // pairwise as a best-effort fallback by reading current lengths.
            // Soft-fail (no-op) if not implementable.
            const lineIds: LineId[] = [];
            for (const r of refs) {
              if (r.kind !== 'line') return;
              lineIds.push(r.id as LineId);
            }
            if (lineIds.length < 2) return;
            // Use first line's current length as the target.
            const firstLine = entities.find((e) => e.id === lineIds[0]);
            if (!firstLine || firstLine.kind !== 'line') return;
            const fp1 = entities.find((e) => e.id === firstLine.p1);
            const fp2 = entities.find((e) => e.id === firstLine.p2);
            if (!fp1 || !fp2 || fp1.kind !== 'point' || fp2.kind !== 'point') return;
            const targetLen = dist(fp1.x, fp1.y, fp2.x, fp2.y);
            for (let i = 1; i < lineIds.length; i++) {
              const ln = entities.find((e) => e.id === lineIds[i]);
              if (!ln || ln.kind !== 'line') continue;
              solver.addDistance(ln.p1 as PointId, ln.p2 as PointId, targetLen);
            }
            // First line gets its own distance pin so all N share it.
            solver.addDistance(firstLine.p1 as PointId, firstLine.p2 as PointId, targetLen);
            break;
          }
          case 'equal_radius': {
            // Read first curve's radius and pin all others to it via addRadius.
            const curves = refs.filter((r) => r.kind === 'circle' || r.kind === 'arc');
            if (curves.length < 2) return;
            const firstCurveEnt = entities.find((e) => e.id === curves[0]!.id);
            if (!firstCurveEnt || firstCurveEnt.kind !== 'circle') return;
            const targetR = firstCurveEnt.radius;
            for (const r of curves) {
              solver.addRadius(r.id as CircleId | ArcId, targetR);
            }
            break;
          }
          case 'fix': {
            // Phase 1.2 solver has no addFix(); approximate by pinning each
            // entity via a zero-distance to itself OR (simpler) by adding
            // distance/coincident locks. Lowest-risk fallback: skip if no
            // direct support — surfaced via toolbar but no-op for now.
            // TODO Phase 2: extend solver with addFix.
            break;
          }
          case 'horizontal': {
            for (const r of refs) {
              if (r.kind === 'line') solver.addHorizontal(r.id as LineId);
            }
            break;
          }
          case 'vertical': {
            for (const r of refs) {
              if (r.kind === 'line') solver.addVertical(r.id as LineId);
            }
            break;
          }
          case 'distance': {
            const a = idOf(0, 'point');
            const b = idOf(1, 'point');
            if (a && b) solver.addDistance(a as PointId, b as PointId, constraint.value);
            break;
          }
          case 'angle': {
            const a = idOf(0, 'line');
            const b = idOf(1, 'line');
            if (a && b) {
              // Toolbar input is in degrees; solver speaks radians.
              const rad = (constraint.value * Math.PI) / 180;
              solver.addAngle(a as LineId, b as LineId, rad);
            }
            break;
          }
        }
        solveAndApply();
        setSelection([]);
      } catch {
        /* solver rejected — leave selection alone for re-try */
      }
    },
    [solver, entities, solveAndApply],
  );

  const handleToolbarClear = useCallback((): void => {
    setSelection([]);
  }, []);

  // ─── ESC clears selection (keyboard) ───
  const handleKeyDown = useCallback(
    (evt: React.KeyboardEvent<HTMLDivElement>): void => {
      if (evt.key === 'Escape') {
        setSelection([]);
        setPending(null);
      }
    },
    [],
  );

  // ─── snap option toggles ───
  // Each toggle is independent — disabling all five (3 Phase 1 + 2 Phase 2)
  // turns snap off entirely (callers see `findSnapTarget` return null,
  // indicator stays unmounted, and clicks fall back to raw cursor positions).
  const toggleSnap = useCallback(
    (
      key:
        | 'enableGrid'
        | 'enablePointSnap'
        | 'enableIntersection'
        | 'enableArc'
        | 'enablePerpendicular',
    ): void => {
      setSnapOpts((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    [],
  );

  // ─── close ───
  const handleClose = useCallback((): void => {
    onClose?.();
  }, [onClose]);

  // ─── SVG export ───────────────────────────────────────────────────────
  //
  // Convert the current view state (which mirrors the solver) into the
  // `SketchEntities` shape that `sketchSvgExport.downloadSketchAsSvg`
  // expects. View ↔ SVG mapping:
  //   ViewPoint  → SvgPoint  { id, x, y, isFixed }
  //   ViewLine   → SvgLine   { id, p1/p2 ids + resolved x1,y1,x2,y2 }
  //   ViewCircle → SvgCircle { id, cx, cy (from center point), radius }
  //   ViewArc    — not modeled in this editor (arc tool placeholder); we
  //                still attempt to read arcs from the solver in case a
  //                future code path creates them, but in Phase 1 the array
  //                stays empty. The SVG export gracefully handles an
  //                empty arc list.
  //
  // Defensive lookups: lines whose endpoints can't be resolved (e.g. point
  // deleted but line lingers) are silently dropped — the SVG export would
  // otherwise emit `NaN` coords. Same policy as the constraint overlay.
  const buildSvgEntities = useCallback((): SvgSketchEntities => {
    const ptMap = new Map<string, ViewPoint>();
    for (const e of entities) if (e.kind === 'point') ptMap.set(e.id as string, e);

    const svgPoints: SvgPoint[] = entities
      .filter((e): e is ViewPoint => e.kind === 'point')
      .map((p) => ({
        id: p.id as string,
        x: p.x,
        y: p.y,
        isFixed: p.fixed,
      }));

    const svgLines: SvgLine[] = entities
      .filter((e): e is ViewLine => e.kind === 'line')
      .map((l) => {
        const a = ptMap.get(l.p1 as string);
        const b = ptMap.get(l.p2 as string);
        if (!a || !b) return null;
        return {
          id: l.id as string,
          p1: l.p1 as string,
          p2: l.p2 as string,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
        };
      })
      .filter((x): x is SvgLine => x !== null);

    const svgCircles: SvgCircle[] = entities
      .filter((e): e is ViewCircle => e.kind === 'circle')
      .map((c) => {
        const ctr = ptMap.get(c.center as string);
        if (!ctr) return null;
        return {
          id: c.id as string,
          cx: ctr.x,
          cy: ctr.y,
          radius: c.radius,
        };
      })
      .filter((x): x is SvgCircle => x !== null);

    // Arcs aren't part of the view state in Phase 1.3, but the SVG export
    // API accepts them. Empty array keeps the export valid + extensible.
    const svgArcs: SvgArc[] = [];

    return {
      points: svgPoints,
      lines: svgLines,
      circles: svgCircles,
      arcs: svgArcs,
    };
  }, [entities]);

  // Compose a deterministic, filesystem-safe filename:
  //   `${projectId ?? 'sketch'}-{YYYYMMDDTHHMMSS}.svg`
  // The timestamp uses UTC + `Date.toISOString` with all separators stripped
  // so the filename is portable across operating systems (no `:` on Windows).
  // The `.svg` extension is appended by `downloadSketchAsSvg` itself.
  const buildSvgFilename = useCallback((): string => {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const prefix = projectId ?? 'sketch';
    return `${prefix}-${stamp}`;
  }, [projectId]);

  // ─── multi-format export modal state ─────────────────────────────────
  //
  // The modal is dynamic-imported (see top-of-file `SketchExportModal`)
  // so its bundle cost is paid only when the user first opens it. We
  // gate the actual mount on `modalOpen` rather than always rendering
  // `null`-on-closed because dynamic() still resolves the chunk the
  // moment React encounters the element — gating keeps the chunk lazy.
  //
  // The `Export...` button reuses `buildSvgEntities()` (defined below)
  // to snapshot the current sketch into the modal's `entities` prop,
  // and `buildSvgFilename()` for the default filename — same semantics
  // as the legacy quick-SVG button so users get a consistent suggested
  // filename across both export paths.
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const openExportModal = useCallback((): void => setModalOpen(true), []);
  const closeExportModal = useCallback((): void => setModalOpen(false), []);

  // ─── import modal state + replace/merge mode ──────────────────────────
  //
  // The import dialog is dynamic-loaded (see top-of-file `SketchImportModal`).
  // Mode = 'merge' keeps existing geometry and adds the imported entities on
  // top; mode = 'replace' clears the current solver state before pasting in
  // the import. Merge is the default because it's non-destructive and
  // matches the muscle memory from SketchUp / Inkscape file-import flows.
  //
  // When the user toggles `replace`, we DO NOT immediately clear — clearing
  // happens at import-commit time so an aborted import (cancel button) is
  // harmless. The radio merely records intent.
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const openImportModal = useCallback((): void => setImportOpen(true), []);
  const closeImportModal = useCallback((): void => setImportOpen(false), []);

  // ─── AI constraint panel (sketch-level NL → solver constraints) ───────
  //
  // The SketchConstraintAiPanel is mounted on demand behind an "AI" toggle
  // button so it doesn't take up sidebar real-estate for users who don't
  // need it. Default = OFF so existing test selectors / muscle memory are
  // unchanged. When ON, the panel sits next to the property panel in the
  // sidebar column.
  //
  // SELECTED_PLACEHOLDER substitution policy (see sketchConstraintIntent.ts):
  //   - make_parallel / make_perpendicular: need 2 lines from current
  //     selection. If selection has !== 2 lines, skip silently (the user
  //     just hasn't picked the second line yet).
  //   - fix_distance: need 2 points from current selection. Same skip rule.
  //   - coincident_points: use ALL selected points (chained pairwise via
  //     solver.addCoincident(anchor, other) — same n-ary pattern the
  //     toolbar bridge uses for coincident).
  //   - make_horizontal / make_vertical with lineIds=undefined → apply to
  //     EVERY line currently in the sketch (no selection required).
  //   - make_horizontal / make_vertical with lineIds[] → iterate those.
  //
  // Solver rejections (over-constrained, fixed point, etc.) are swallowed
  // per-call so a single bad line doesn't abort the whole intent.
  // Initial state seeded from `defaultShowSketchAi` so wrappers can expose a
  // top-level "AI constraints on by default" prop. The toggle button below
  // continues to flip the live state regardless of the seed value.
  const [aiPanelOpen, setAiPanelOpen] = useState<boolean>(defaultShowSketchAi);
  const toggleAiPanel = useCallback((): void => {
    setAiPanelOpen((prev) => !prev);
  }, []);

  // ─── group manager (Phase 2.x sketchGroup integration) ──────────────────
  //
  // The SketchGroupManager is an external layer over the solver — it mutates
  // group state in place. We bump `groupsVersion` after every mutation to
  // force a re-render so the panel sees fresh `manager.groups` snapshots.
  // Default OFF — "Groups" toggle button gates panel mount.
  const groupManager = useMemo<SketchGroupManager | null>(
    () => (solver ? createSketchGroupManager(solver) : null),
    [solver],
  );
  const [groupsOpen, setGroupsOpen] = useState<boolean>(false);
  const [groupsVersion, setGroupsVersion] = useState<number>(0);
  const bumpGroups = useCallback((): void => {
    setGroupsVersion((v) => v + 1);
  }, []);
  const toggleGroups = useCallback((): void => {
    setGroupsOpen((prev) => !prev);
  }, []);
  // Parametric-expression scratchpad (lib/sketch/sketchExpressions). Default
  // OFF; self-contained panel — no solver coupling, so no recapture on open.
  const [expressionsOpen, setExpressionsOpen] = useState<boolean>(false);
  const toggleExpressions = useCallback((): void => {
    setExpressionsOpen((prev) => !prev);
  }, []);
  // Re-read manager snapshot whenever a mutation bumps the counter.
  const groupSnapshot = useMemo<ReadonlyArray<SketchGroup>>(() => {
    if (!groupManager) return [];
    void groupsVersion;
    return groupManager.groups;
  }, [groupManager, groupsVersion]);

  const handleGroupCreate = useCallback(
    (defaultName: string, entityIds: string[]): void => {
      if (!groupManager) return;
      // Optional user-override prompt: lets the user rename the default
      // "Group N" before the entry lands. Cancel → abort. Empty string
      // → keep default. Same pattern as the dimension/offset prompts.
      let name = defaultName;
      try {
        const raw =
          typeof window !== 'undefined' && typeof window.prompt === 'function'
            ? window.prompt(t.groupName, defaultName)
            : defaultName;
        if (raw === null) return;
        if (raw.trim() !== '') name = raw.trim();
      } catch {
        /* non-DOM env — keep default */
      }
      try {
        groupManager.create(name, entityIds);
        bumpGroups();
        // Clear selection after grouping so the user can re-select to issue
        // a follow-up grouping or per-entity edits.
        setSelection([]);
      } catch {
        /* unknown id / empty list — manager throws; surface nothing */
      }
    },
    [groupManager, t.groupName, bumpGroups],
  );

  const handleGroupRemove = useCallback(
    (groupId: string): void => {
      if (!groupManager) return;
      groupManager.remove(groupId);
      bumpGroups();
    },
    [groupManager, bumpGroups],
  );

  const handleGroupTranslate = useCallback(
    (groupId: string, dx: number, dy: number): void => {
      if (!groupManager) return;
      try {
        groupManager.translate(groupId, dx, dy);
        solveAndApply();
        bumpGroups();
      } catch {
        /* locked / non-finite — swallow */
      }
    },
    [groupManager, solveAndApply, bumpGroups],
  );

  const handleGroupRotate = useCallback(
    (groupId: string, angleRad: number): void => {
      if (!groupManager) return;
      try {
        groupManager.rotate(groupId, angleRad);
        solveAndApply();
        bumpGroups();
      } catch {
        /* locked / non-finite — swallow */
      }
    },
    [groupManager, solveAndApply, bumpGroups],
  );

  const handleGroupScale = useCallback(
    (groupId: string, factor: number): void => {
      if (!groupManager) return;
      try {
        groupManager.scale(groupId, factor);
        solveAndApply();
        bumpGroups();
      } catch {
        /* locked / factor=0 / non-finite — swallow */
      }
    },
    [groupManager, solveAndApply, bumpGroups],
  );

  const handleGroupToggleLock = useCallback(
    (groupId: string): void => {
      if (!groupManager) return;
      groupManager.toggleLock(groupId);
      bumpGroups();
    },
    [groupManager, bumpGroups],
  );

  // ─── transform panel (Phase 2.x sketchTransform integration) ────────────
  //
  // `createSketchTransform` snapshots the solver state at construction-time
  // for its `reset()` to undo. The useMemo below only fires when the solver
  // instance itself swaps (mount, replace-import), so a transform created
  // at editor-open time only knows the *empty* sketch — calling reset() on
  // it would not bring back later-created points. We therefore also keep a
  // mutable `transformRef` that gets re-created whenever the user opens the
  // panel OR clicks "Recapture snapshot", so reset always restores to the
  // user's last marked baseline.
  //
  // scope = 'selection' when at least one entity is selected; the underlying
  // SketchTransform.translate / rotate / scale / mirror all accept a
  // ReadonlyArray<string> of entity ids (lines/circles/arcs expand to
  // points). scope = 'all' when nothing is selected.
  const transform = useMemo<SketchTransform | null>(
    () => (solver ? createSketchTransform(solver) : null),
    [solver],
  );
  const transformRef = useRef<SketchTransform | null>(null);
  // Keep ref in sync with the latest memoized instance for the initial
  // editor-mount case (recapture re-creates this on demand).
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const [transformOpen, setTransformOpen] = useState<boolean>(false);
  type TransformOp = 'translate' | 'rotate' | 'scale' | 'mirror';
  const [transformOp, setTransformOp] = useState<TransformOp | null>(null);

  // Op inputs — each kept as a string so the controlled input can show empty
  // / partial entries. Parsed on Apply (NaN → no-op, lets user clear field
  // without throwing). Defaults populate sensible centers (0,0) and a unit-
  // factor scale so the first click does something non-trivial.
  const [txDx, setTxDx] = useState<string>('10');
  const [txDy, setTxDy] = useState<string>('0');
  const [txAngleDeg, setTxAngleDeg] = useState<string>('90');
  const [txCx, setTxCx] = useState<string>('0');
  const [txCy, setTxCy] = useState<string>('0');
  const [txFactor, setTxFactor] = useState<string>('2');
  const [txMirrorAx, setTxMirrorAx] = useState<string>('0');
  const [txMirrorAy, setTxMirrorAy] = useState<string>('0');
  const [txMirrorBx, setTxMirrorBx] = useState<string>('1');
  const [txMirrorBy, setTxMirrorBy] = useState<string>('0');

  // Open / close the transform panel. Opening also recaptures the snapshot
  // so the reset baseline matches the geometry currently on screen — same
  // contract as a fresh "Open Transform" session in CAD apps.
  const toggleTransform = useCallback((): void => {
    setTransformOpen((prev) => {
      const next = !prev;
      if (next && solver) {
        transformRef.current = createSketchTransform(solver);
      }
      if (!next) {
        // Clear the active op so re-opening starts with the op-picker view.
        setTransformOp(null);
      }
      return next;
    });
  }, [solver]);

  // Manual snapshot recapture — exposed as its own button so users can
  // re-baseline mid-session (e.g. after sketching a new fixture and wanting
  // future transform ops to reset back to *this* state, not to the empty
  // initial sketch).
  const handleTransformRecapture = useCallback((): void => {
    if (!solver) return;
    transformRef.current = createSketchTransform(solver);
  }, [solver]);

  // Resolve scope from the current selection. Selection-bearing ids are
  // passed straight through (lines/circles/arcs expand to points inside
  // sketchTransform); empty selection ⇒ 'all'.
  const resolveTransformScope = useCallback((): TransformScope => {
    if (selection.length === 0) return 'all';
    return selection.map((s) => s.id);
  }, [selection]);

  // Mirror-axis convenience: when exactly two points are selected, treat
  // them as (p1, p2) of the mirror axis and ignore the typed A/B inputs.
  // Otherwise fall back to the four input numbers. The button is shown
  // only when the 2-point shortcut applies.
  const mirrorAxisFromSelection = useMemo<
    { p1: { x: number; y: number }; p2: { x: number; y: number } } | null
  >(() => {
    const ptRefs = selection.filter((r) => r.kind === 'point');
    if (ptRefs.length !== 2) return null;
    const a = entities.find((e) => e.id === ptRefs[0]!.id);
    const b = entities.find((e) => e.id === ptRefs[1]!.id);
    if (!a || a.kind !== 'point' || !b || b.kind !== 'point') return null;
    if (a.x === b.x && a.y === b.y) return null; // degenerate
    return { p1: { x: a.x, y: a.y }, p2: { x: b.x, y: b.y } };
  }, [selection, entities]);

  const handleTransformApply = useCallback((): void => {
    const tx = transformRef.current;
    if (!tx || !transformOp) return;
    const scope = resolveTransformScope();
    try {
      if (transformOp === 'translate') {
        const dx = Number(txDx);
        const dy = Number(txDy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        tx.translate(dx, dy, scope);
      } else if (transformOp === 'rotate') {
        const deg = Number(txAngleDeg);
        const cx = Number(txCx);
        const cy = Number(txCy);
        if (!Number.isFinite(deg) || !Number.isFinite(cx) || !Number.isFinite(cy)) return;
        tx.rotate((deg * Math.PI) / 180, { x: cx, y: cy }, scope);
      } else if (transformOp === 'scale') {
        const f = Number(txFactor);
        const cx = Number(txCx);
        const cy = Number(txCy);
        if (!Number.isFinite(f) || f === 0 || !Number.isFinite(cx) || !Number.isFinite(cy)) return;
        tx.scale(f, { x: cx, y: cy }, scope);
      } else if (transformOp === 'mirror') {
        // Prefer 2-selected-points axis when available; else read inputs.
        const axis = mirrorAxisFromSelection ?? {
          p1: { x: Number(txMirrorAx), y: Number(txMirrorAy) },
          p2: { x: Number(txMirrorBx), y: Number(txMirrorBy) },
        };
        if (
          !Number.isFinite(axis.p1.x) || !Number.isFinite(axis.p1.y) ||
          !Number.isFinite(axis.p2.x) || !Number.isFinite(axis.p2.y)
        ) return;
        if (axis.p1.x === axis.p2.x && axis.p1.y === axis.p2.y) return;
        // When mirror axis is two selected points, don't include those two
        // points in the moved scope (they ARE the axis — moving them would
        // change the axis). Subtract them when scope was 'selection'.
        let mirrorScope: TransformScope = scope;
        if (mirrorAxisFromSelection && scope !== 'all') {
          const axisIds = new Set(
            selection.filter((r) => r.kind === 'point').map((r) => r.id),
          );
          const filtered = (scope as ReadonlyArray<string>).filter(
            (id) => !axisIds.has(id),
          );
          // Empty after filtering → fall back to 'all' so the op still does
          // something visible (matches user intent: "mirror across these
          // two points; affect everything else").
          mirrorScope = filtered.length === 0 ? 'all' : filtered;
        }
        tx.mirror(axis.p1, axis.p2, mirrorScope);
      }
      solveAndApply();
    } catch {
      /* sketchTransform validation rejected — keep panel state for retry */
    }
  }, [
    transformOp,
    resolveTransformScope,
    txDx, txDy, txAngleDeg, txCx, txCy, txFactor,
    txMirrorAx, txMirrorAy, txMirrorBx, txMirrorBy,
    mirrorAxisFromSelection, selection, solveAndApply,
  ]);

  const handleTransformReset = useCallback((): void => {
    const tx = transformRef.current;
    if (!tx) return;
    try {
      tx.reset();
      solveAndApply();
    } catch {
      /* defensive — reset never throws today but be safe */
    }
  }, [solveAndApply]);

  const handleApplyAiConstraints = useCallback(
    (intent: SketchConstraintIntent): void => {
      if (!solver) return;
      // Snapshot current selection by kind for SELECTED placeholder substitution.
      const selectedLines = selection
        .filter((r) => r.kind === 'line')
        .map((r) => r.id as LineId);
      const selectedPoints = selection
        .filter((r) => r.kind === 'point')
        .map((r) => r.id as PointId);
      // All lines currently in the sketch — used when intent has no specific
      // lineIds (e.g. "make all lines horizontal").
      const allLines: LineId[] = entities
        .filter((e): e is ViewLine => e.kind === 'line')
        .map((l) => l.id);

      try {
        switch (intent.kind) {
          case 'make_horizontal': {
            const targets =
              intent.lineIds && intent.lineIds.length > 0
                ? (intent.lineIds as LineId[])
                : allLines;
            for (const lineId of targets) {
              try {
                solver.addHorizontal(lineId);
              } catch {
                /* over-constrained / unknown id — skip */
              }
            }
            break;
          }
          case 'make_vertical': {
            const targets =
              intent.lineIds && intent.lineIds.length > 0
                ? (intent.lineIds as LineId[])
                : allLines;
            for (const lineId of targets) {
              try {
                solver.addVertical(lineId);
              } catch {
                /* skip */
              }
            }
            break;
          }
          case 'make_parallel': {
            // Substitute SELECTED placeholders with the current selection's
            // first two lines. If the intent already specifies concrete ids
            // (defensive — current detector always emits placeholders),
            // honor those instead.
            const l1 =
              intent.line1Id === SELECTED_PLACEHOLDER
                ? selectedLines[0]
                : (intent.line1Id as LineId);
            const l2 =
              intent.line2Id === SELECTED_PLACEHOLDER
                ? selectedLines[1]
                : (intent.line2Id as LineId);
            if (!l1 || !l2) return; // not enough selection — silent no-op
            solver.addParallel(l1, l2);
            break;
          }
          case 'make_perpendicular': {
            const l1 =
              intent.line1Id === SELECTED_PLACEHOLDER
                ? selectedLines[0]
                : (intent.line1Id as LineId);
            const l2 =
              intent.line2Id === SELECTED_PLACEHOLDER
                ? selectedLines[1]
                : (intent.line2Id as LineId);
            if (!l1 || !l2) return;
            solver.addPerpendicular(l1, l2);
            break;
          }
          case 'fix_distance': {
            const a =
              intent.pointAId === SELECTED_PLACEHOLDER
                ? selectedPoints[0]
                : (intent.pointAId as PointId);
            const b =
              intent.pointBId === SELECTED_PLACEHOLDER
                ? selectedPoints[1]
                : (intent.pointBId as PointId);
            if (!a || !b) return;
            solver.addDistance(a, b, intent.distance);
            break;
          }
          case 'coincident_points': {
            // Empty pointIds from the intent → use ALL selected points,
            // chained pairwise to the first (anchor) — same n-ary pattern
            // used by the SketchConstraintToolbar bridge above.
            const pts =
              intent.pointIds.length > 0
                ? (intent.pointIds as PointId[])
                : selectedPoints;
            if (pts.length < 2) return;
            const anchor = pts[0]!;
            for (let i = 1; i < pts.length; i++) {
              try {
                solver.addCoincident(anchor, pts[i]!);
              } catch {
                /* skip */
              }
            }
            break;
          }
        }
        solveAndApply();
      } catch {
        /* outer guard — never throw from a UI click handler */
      }
    },
    [solver, selection, entities, solveAndApply],
  );

  // Selection-count snapshot fed to the AI panel preview (the panel uses
  // `lines` to show "Apply N horizontal constraints" instead of "Apply
  // horizontal constraint to all lines" when something is selected). The
  // panel only consumes `lines` today (see SketchConstraintAiPanelProps);
  // future intents (e.g. coincident with N points) can add more keys here.
  const aiSelectionCounts = useMemo(
    () => ({
      lines: selection.filter((r) => r.kind === 'line').length,
    }),
    [selection],
  );

  // ─── import → solver bridge ───────────────────────────────────────────
  //
  // Wire the modal's `onImport(entities)` callback into solver mutations.
  // Per import-mode:
  //   - 'replace' → wipe view+solver state first. We destroy the existing
  //     solver instance and create a fresh one to guarantee planegcs's
  //     internal tracking is clean (incremental remove of every entity
  //     leaves orphan constraints behind — see solver.removeConstraint
  //     caveat referenced in the overlay-bridge comments above).
  //   - 'merge' → keep everything; just append the new entities. Imported
  //     ids are namespaced by the importer (`imp1`, `iml2`, ...) so they
  //     can't collide with the solver's own `p`/`l`/`c` sequence.
  //
  // SvgPoint → solver.addPoint  (preserves isFixed)
  // SvgLine  → solver.addLine    (resolves endpoint ids; if either point id
  //                                isn't present in the import, we synthesize
  //                                new endpoints from the SvgLine's x1/y1/
  //                                x2/y2 — the importer always writes those
  //                                attributes for round-trip safety)
  // SvgCircle → solver.addCircle (center synthesized from cx/cy since SVG
  //                                circles don't carry a separate center-point id)
  // SvgArc   → solver.addArc     (start/end points synthesized from radius +
  //                                start/end angle; mirrors how the editor's
  //                                own arc tool would build the entity)
  //
  // Each addX call is wrapped in try/catch so a single malformed entity
  // can't tank the whole import — the user gets the entities the importer
  // produced plus a console warning per failure.
  const handleSketchImport = useCallback(
    (imported: SvgSketchEntities): void => {
      if (!solver) return;

      // Decide working solver + starting entities up front so 'replace' and
      // 'merge' share the same insertion loop below.
      const target = solver;
      let nextEntities: ViewEntity[];
      if (importMode === 'replace') {
        // Drop every tracked entity from the solver. We catch on a per-call
        // basis because solver.removeX raises on already-cleared ids, and
        // we don't want a stale id to abort the wipe partway through.
        for (const e of entities) {
          try {
            if (e.kind === 'point') target.removePoint(e.id);
            else if (e.kind === 'line') target.removeLine(e.id);
            else if (e.kind === 'circle') target.removeCircle(e.id);
          } catch {
            /* already-removed or fixed — best-effort wipe */
          }
        }
        nextEntities = [];
      } else {
        nextEntities = [...entities];
      }

      // SvgPoint → addPoint. Build a lookup so subsequent SvgLine refs can
      // be resolved to the freshly-created PointIds.
      const importedPointIdByOriginal = new Map<string, PointId>();
      for (const p of imported.points) {
        try {
          const id = target.addPoint(p.x, p.y, p.isFixed ? { fixed: true } : {});
          importedPointIdByOriginal.set(p.id, id);
          nextEntities.push({ id, kind: 'point', x: p.x, y: p.y, fixed: !!p.isFixed });
        } catch (err) {
          console.warn('[SolverSketchEditor.import] failed to add point', p, err);
        }
      }

      // SvgLine → addLine. Endpoint resolution policy:
      //   1. if the SvgLine's p1/p2 strings match an imported point id we
      //      just created → reuse that PointId (preserves the importer's
      //      coincidence — same point shared by multiple lines stays shared);
      //   2. otherwise synthesize a fresh point at x1/y1 (and x2/y2). This
      //      is the common case for SVGs the importer received WITHOUT
      //      separate `<circle data-kind="point">` entries — every line
      //      stands alone with its own pair of endpoints.
      for (const ln of imported.lines) {
        try {
          let p1Id = importedPointIdByOriginal.get(ln.p1);
          if (!p1Id) {
            p1Id = target.addPoint(ln.x1, ln.y1);
            nextEntities.push({ id: p1Id, kind: 'point', x: ln.x1, y: ln.y1, fixed: false });
          }
          let p2Id = importedPointIdByOriginal.get(ln.p2);
          if (!p2Id) {
            p2Id = target.addPoint(ln.x2, ln.y2);
            nextEntities.push({ id: p2Id, kind: 'point', x: ln.x2, y: ln.y2, fixed: false });
          }
          const lId = target.addLine(p1Id, p2Id);
          nextEntities.push({ id: lId, kind: 'line', p1: p1Id, p2: p2Id });
        } catch (err) {
          console.warn('[SolverSketchEditor.import] failed to add line', ln, err);
        }
      }

      // SvgCircle → addCircle. SVG circles carry a center point only as
      // (cx,cy); we synthesize a PointId for it so the solver's relational
      // model (radius constraint targets center point) stays consistent.
      for (const c of imported.circles) {
        try {
          const ctrId = target.addPoint(c.cx, c.cy);
          nextEntities.push({ id: ctrId, kind: 'point', x: c.cx, y: c.cy, fixed: false });
          const cId = target.addCircle(ctrId, c.radius);
          nextEntities.push({ id: cId, kind: 'circle', center: ctrId, radius: c.radius });
        } catch (err) {
          console.warn('[SolverSketchEditor.import] failed to add circle', c, err);
        }
      }

      // SvgArc → addArc. Start/end points are derived from
      // (cx + r·cos(angle), cy + r·sin(angle)) so the solver gets a
      // well-formed 3-point arc. The view model in this editor doesn't yet
      // render arcs (Phase 1.3 limitation — see top-of-file comment), but
      // the solver-side entity is still created so downstream operations
      // (export, profile extraction) can see it.
      for (const a of imported.arcs) {
        try {
          const ctrId = target.addPoint(a.cx, a.cy);
          const startPt = {
            x: a.cx + a.radius * Math.cos(a.startAngle),
            y: a.cy + a.radius * Math.sin(a.startAngle),
          };
          const endPt = {
            x: a.cx + a.radius * Math.cos(a.endAngle),
            y: a.cy + a.radius * Math.sin(a.endAngle),
          };
          const startId = target.addPoint(startPt.x, startPt.y);
          const endId = target.addPoint(endPt.x, endPt.y);
          // Push the synthesized points into the view so subsequent ref
          // lookups (e.g. constraint overlay) can find them.
          nextEntities.push({ id: ctrId, kind: 'point', x: a.cx, y: a.cy, fixed: false });
          nextEntities.push({ id: startId, kind: 'point', x: startPt.x, y: startPt.y, fixed: false });
          nextEntities.push({ id: endId, kind: 'point', x: endPt.x, y: endPt.y, fixed: false });
          target.addArc(ctrId, startId, endId, a.radius, a.startAngle, a.endAngle);
          // No arc ViewEntity kind in Phase 1.3 — solver-side only.
        } catch (err) {
          console.warn('[SolverSketchEditor.import] failed to add arc', a, err);
        }
      }

      solveAndApply(nextEntities);
      // Reset selection so a previously-selected entity that no longer
      // exists after a 'replace' doesn't leave a dangling constraint UI.
      setSelection([]);
    },
    [solver, entities, importMode, solveAndApply],
  );

  // Bound to the toolbar "Export SVG" button. Builds entities + filename,
  // then defers to `downloadSketchAsSvg` (browser-only — throws in non-DOM
  // envs). bbox auto-fit with 10mm margin is the default, and 200×150 mm
  // is a reasonable A5-ish printable size for an editor-driven export.
  const handleExportSvg = useCallback((): void => {
    const entitiesForSvg = buildSvgEntities();
    const filename = buildSvgFilename();
    try {
      downloadSketchAsSvg(entitiesForSvg, filename, {
        width: 200,
        height: 150,
        margin: 10,
        title: `NexyFab Sketch — ${filename}`,
      });
    } catch {
      // Non-DOM env or browser refused — surface nothing here. Tests can
      // assert the URL.createObjectURL spy was called instead.
    }
  }, [buildSvgEntities, buildSvgFilename]);

  // ─── derived UI state ───
  const dof = solveResult?.dof ?? 0;
  const dofKind = dofState(dof);
  const dofText = dofKind === 'full' ? t.dofFull : dofKind === 'over' ? t.dofOver : t.dofUnder;
  const hasConflicts = (solveResult?.conflicting?.length ?? 0) > 0;
  const hasRedundant = (solveResult?.redundant?.length ?? 0) > 0;
  const statusText = hasConflicts
    ? t.statusConflict
    : hasRedundant
      ? t.statusRedundant
      : t.statusReady;

  const constraintEligible = useCallback(
    (def: ConstraintToolDef): boolean => {
      if (selected.length !== def.requires.length) return false;
      for (let i = 0; i < def.requires.length; i++) {
        const e = entities.find((x) => x.id === selected[i]);
        if (!e || e.kind !== def.requires[i]) return false;
      }
      return true;
    },
    [selected, entities],
  );

  // ─── points / lines / circles for render ───
  const renderPoints = useMemo(
    () => entities.filter((e): e is ViewPoint => e.kind === 'point'),
    [entities],
  );
  const renderLines = useMemo(
    () => entities.filter((e): e is ViewLine => e.kind === 'line'),
    [entities],
  );

  // ─── notify parent of geometry changes (Phase 2.A extrude wrapper hook) ──
  useEffect(() => {
    if (!onSketchChange) return;
    onSketchChange({
      points: renderPoints.map((p) => ({ id: p.id as string, x: p.x, y: p.y })),
      lines: renderLines.map((l) => ({ id: l.id as string, p1: l.p1 as string, p2: l.p2 as string })),
    });
  }, [renderPoints, renderLines, onSketchChange]);
  const renderCircles = useMemo(
    () => entities.filter((e): e is ViewCircle => e.kind === 'circle'),
    [entities],
  );

  const pointById = useMemo(() => {
    const m = new Map<PointId, ViewPoint>();
    for (const p of renderPoints) m.set(p.id, p);
    return m;
  }, [renderPoints]);

  // ─── SketchConstraintOverlay bridge (Phase 1.B) ───────────────────────
  //
  // Convert each SerializedConstraint into a DisplayConstraint by joining
  // the constraint's `refs` (entity ids) with the current entity coords.
  //
  // Per-kind mapping (refs order matches solver.ts comment):
  //   distance      : refs[2] = points          → { p1, p2, value }
  //   angle         : refs[2] = lines           → { line1Pts, line2Pts, value }
  //   horizontal    : refs[1] = line            → entities = [lineP1, lineP2]
  //   vertical      : refs[1] = line            → entities = [lineP1, lineP2]
  //   parallel      : refs[2] = lines           → entities = [l1P1, l1P2]
  //   perpendicular : refs[2] = lines           → entities = [l1P1, l1P2]
  //   coincident    : refs[2] = points          → entities = [p1]
  //   tangent       : refs[2] = curves          → entities = [curveAnchor]
  //   radius        : refs[1] = circle | arc    → entities = [center]
  //
  // Constraints whose refs resolve to missing entities are dropped silently
  // (e.g. an entity was deleted but the underlying planegcs constraint
  // lingers until destroy — see solver.removeConstraint caveat).
  const overlayConstraints = useMemo<ReadonlyArray<DisplayConstraint>>(() => {
    const entityById = new Map<string, ViewEntity>();
    for (const e of entities) entityById.set(e.id as string, e);

    const pointCoords = (id: string): OverlayPt | null => {
      const e = entityById.get(id);
      if (!e || e.kind !== 'point') return null;
      return { x: e.x, y: e.y };
    };
    const lineEndpoints = (id: string): [OverlayPt, OverlayPt] | null => {
      const e = entityById.get(id);
      if (!e || e.kind !== 'line') return null;
      const a = pointCoords(e.p1 as string);
      const b = pointCoords(e.p2 as string);
      if (!a || !b) return null;
      return [a, b];
    };
    const circleCenter = (id: string): OverlayPt | null => {
      const e = entityById.get(id);
      if (!e || e.kind !== 'circle') return null;
      return pointCoords(e.center as string);
    };

    const out: DisplayConstraint[] = [];
    for (const c of constraintSnapshot) {
      if (c.kind === 'distance') {
        const p1 = pointCoords(c.refs[0] ?? '');
        const p2 = pointCoords(c.refs[1] ?? '');
        if (!p1 || !p2 || c.value === undefined) continue;
        out.push({ kind: 'distance', id: c.id, p1, p2, value: c.value });
        continue;
      }
      if (c.kind === 'angle') {
        const l1 = lineEndpoints(c.refs[0] ?? '');
        const l2 = lineEndpoints(c.refs[1] ?? '');
        if (!l1 || !l2 || c.value === undefined) continue;
        out.push({ kind: 'angle', id: c.id, line1Pts: l1, line2Pts: l2, value: c.value });
        continue;
      }
      if (c.kind === 'horizontal' || c.kind === 'vertical') {
        const l = lineEndpoints(c.refs[0] ?? '');
        if (!l) continue;
        out.push({ kind: c.kind, id: c.id, entities: l });
        continue;
      }
      if (c.kind === 'parallel' || c.kind === 'perpendicular') {
        // Badge anchors on line A's midpoint — pass its two endpoints.
        const l1 = lineEndpoints(c.refs[0] ?? '');
        if (!l1) continue;
        out.push({ kind: c.kind, id: c.id, entities: l1 });
        continue;
      }
      if (c.kind === 'coincident') {
        const p1 = pointCoords(c.refs[0] ?? '');
        if (!p1) continue;
        out.push({ kind: 'coincident', id: c.id, entities: [p1] });
        continue;
      }
      if (c.kind === 'tangent') {
        // Anchor at curve A's center / line midpoint.
        const idA = c.refs[0] ?? '';
        const entA = entityById.get(idA);
        let anchor: OverlayPt | null = null;
        if (entA?.kind === 'line') {
          const ep = lineEndpoints(idA);
          if (ep) anchor = { x: (ep[0].x + ep[1].x) / 2, y: (ep[0].y + ep[1].y) / 2 };
        } else if (entA?.kind === 'circle') {
          anchor = circleCenter(idA);
        }
        if (!anchor) continue;
        out.push({ kind: 'tangent', id: c.id, entities: [anchor] });
        continue;
      }
      // 'radius' is solver-level (no overlay glyph defined in Phase 1.B).
      // Skip — future Phase 1.C could surface as an equal_radius badge.
    }
    return out;
  }, [constraintSnapshot, entities]);

  const handleConstraintSelect = useCallback((id: string): void => {
    setSelectedConstraintId((prev) => (prev === id ? null : id));
  }, []);

  const handleConstraintDelete = useCallback(
    (id: string): void => {
      if (!solver) return;
      solver.removeConstraint(id as ConstraintId);
      setSelectedConstraintId((prev) => (prev === id ? null : prev));
      solveAndApply();
    },
    [solver, solveAndApply],
  );

  // ─── inline value edit (Phase 1.B overlay double-click) ──────────────
  //
  // The overlay seeds its <input> with the on-screen value (distance =
  // sketch mm, angle = degrees) so the user reads + edits the same units.
  // We convert back to the solver's internal units (radians for angle)
  // here before pushing to setConstraintValue.
  //
  // Validation: setConstraintValue throws on non-finite / non-positive
  // distances. We catch silently — keeping the constraint at the previous
  // value rather than rejecting in a way that pops UI noise mid-edit.
  // The status pill will surface any post-solve conflicts.
  const handleConstraintValueChange = useCallback(
    (id: string, newValue: number): void => {
      if (!solver) return;
      const rec = constraintSnapshot.find((c) => c.id === id);
      if (!rec) return;
      // Angle is stored in radians on the solver side but the overlay
      // shows degrees — convert before dispatch.
      const solverValue = rec.kind === 'angle' ? (newValue * Math.PI) / 180 : newValue;
      try {
        const updated = solver.setConstraintValue(id as ConstraintId, solverValue);
        if (!updated) return; // unknown id or non-dimensional kind
        solveAndApply();
      } catch {
        // Invalid value (non-finite / non-positive distance) — swallow.
        // The label stays at its previous solved value; user can re-try.
      }
    },
    [solver, constraintSnapshot, solveAndApply],
  );

  // ─── parametric-variable binding (SketchExpressionsPanel) ────────────────
  //
  // The currently-selected dimensional constraint (distance / angle / radius),
  // or null. Gates the panel's "Apply" buttons.
  const selectedDimensionalConstraint = useMemo(
    () =>
      constraintSnapshot.find(
        (c) =>
          c.id === selectedConstraintId &&
          (c.kind === 'distance' || c.kind === 'angle' || c.kind === 'radius'),
      ) ?? null,
    [constraintSnapshot, selectedConstraintId],
  );

  // Persistent variable↔constraint bindings (variable name → constraint id).
  // A binding is created on Apply and survives subsequent solves, so the panel
  // can mirror the live constraint value back (the constraint→variable half).
  const [variableBindings, setVariableBindings] = useState<Record<string, string>>({});

  // Push a computed variable value onto the selected dimensional constraint AND
  // record the binding. The panel evaluates to canonical solver units (mm for
  // length, rad for angle), so we call setConstraintValue DIRECTLY — no deg→rad
  // conversion (unlike handleConstraintValueChange, which speaks the overlay's
  // display units). No-op when nothing dimensional is selected or the value is
  // rejected (non-finite / non-positive distance).
  const handleApplyVariableValue = useCallback(
    (varName: string, value: number): void => {
      if (!solver || !selectedDimensionalConstraint) return;
      try {
        const cid = selectedDimensionalConstraint.id;
        const updated = solver.setConstraintValue(cid as ConstraintId, value);
        if (!updated) return;
        if (varName) setVariableBindings((prev) => ({ ...prev, [varName]: cid }));
        solveAndApply();
      } catch {
        // Invalid value — swallow; the status pill surfaces conflicts.
      }
    },
    [solver, selectedDimensionalConstraint, solveAndApply],
  );

  // constraint→variable: live value (canonical units, same as the snapshot)
  // for every bound variable whose constraint still exists. Recomputed from the
  // post-solve snapshot, so editing the constraint elsewhere updates the panel.
  const boundVariableValues = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [varName, cid] of Object.entries(variableBindings)) {
      const rec = constraintSnapshot.find((c) => c.id === cid);
      if (rec && typeof rec.value === 'number' && Number.isFinite(rec.value)) {
        out[varName] = rec.value;
      }
    }
    return out;
  }, [variableBindings, constraintSnapshot]);

  // ─── SketchEntityPropertyPanel bridge ──────────────────────────────────
  //
  // Derive an EntityData snapshot of the currently selected entities so the
  // standalone property panel can render them. The panel itself never sees
  // the solver — it only sees a structural snapshot plus typed callbacks.
  //
  // For each selected ref:
  //   - point → x, y, isFixed from view + solver record
  //   - line  → x1, y1 / x2, y2 / derived length + angle (radians)
  //   - circle → cx, cy, radius
  //   - arc   → not exposed in this editor (no arc tool wired), but kept
  //             defensively in case a future code path injects one.
  const panelEntityData = useMemo<PanelEntityData[]>(() => {
    const out: PanelEntityData[] = [];
    for (const ref of selection) {
      const ent = entities.find((e) => e.id === ref.id);
      if (!ent) continue;
      if (ent.kind === 'point' && ref.kind === 'point') {
        out.push({
          kind: 'point',
          id: ent.id as string,
          x: ent.x,
          y: ent.y,
          isFixed: ent.fixed,
        });
        continue;
      }
      if (ent.kind === 'line' && ref.kind === 'line') {
        const a = pointById.get(ent.p1);
        const b = pointById.get(ent.p2);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        out.push({
          kind: 'line',
          id: ent.id as string,
          x1: a.x, y1: a.y,
          x2: b.x, y2: b.y,
          length: Math.hypot(dx, dy),
          angle: Math.atan2(dy, dx),
        });
        continue;
      }
      if (ent.kind === 'circle' && ref.kind === 'circle') {
        const ctr = pointById.get(ent.center);
        if (!ctr) continue;
        out.push({
          kind: 'circle',
          id: ent.id as string,
          cx: ctr.x, cy: ctr.y,
          radius: ent.radius,
        });
      }
    }
    return out;
  }, [selection, entities, pointById]);

  // Route the panel's field edits into the solver, then re-solve. We map
  // each field of each entity kind to the matching solver setter, then
  // mirror the change into the view-side `entities` array so the SVG and
  // the panel both reflect the new value immediately (the re-solve will
  // refine point positions if constraints disagree).
  //
  // Bulk-edit awareness: the panel may call this synchronously, once per
  // selected entity (a 3-point x-edit fires this 3 times in a row inside
  // the same task). The solver mutations land immediately so the next
  // call in the burst sees the updated state, but the re-solve itself is
  // deferred via `scheduleSolveAndApply` so we only solve once at the end
  // of the burst.
  const handlePanelChange = useCallback(
    (id: string, field: PanelEntityField, value: PanelEntityFieldValue): void => {
      if (!solver) return;
      const ent = entities.find((e) => e.id === id);
      if (!ent) return;

      try {
        // ── point ─────────────────────────────────────────────────────
        if (ent.kind === 'point') {
          if (field === 'x' && typeof value === 'number') {
            solver.setPointX(ent.id, value);
            setEntities((prev) => prev.map((e) => (
              e.id === id && e.kind === 'point' ? { ...e, x: value } : e
            )));
          } else if (field === 'y' && typeof value === 'number') {
            solver.setPointY(ent.id, value);
            setEntities((prev) => prev.map((e) => (
              e.id === id && e.kind === 'point' ? { ...e, y: value } : e
            )));
          } else if (field === 'isFixed' && typeof value === 'boolean') {
            solver.setPointFixed(ent.id, value);
            setEntities((prev) => prev.map((e) => (
              e.id === id && e.kind === 'point' ? { ...e, fixed: value } : e
            )));
          }
          scheduleSolveAndApply();
          return;
        }
        // ── line ──────────────────────────────────────────────────────
        if (ent.kind === 'line') {
          const a = entities.find((e) => e.id === ent.p1);
          const b = entities.find((e) => e.id === ent.p2);
          if (!a || a.kind !== 'point' || !b || b.kind !== 'point') return;
          if (typeof value !== 'number') return;
          let nx1 = a.x, ny1 = a.y, nx2 = b.x, ny2 = b.y;
          if (field === 'x1') nx1 = value;
          else if (field === 'y1') ny1 = value;
          else if (field === 'x2') nx2 = value;
          else if (field === 'y2') ny2 = value;
          else return; // length/angle are read-only in the panel
          solver.setLineEndpoints(ent.id, nx1, ny1, nx2, ny2);
          setEntities((prev) => prev.map((e) => {
            if (e.id === ent.p1 && e.kind === 'point') return { ...e, x: nx1, y: ny1 };
            if (e.id === ent.p2 && e.kind === 'point') return { ...e, x: nx2, y: ny2 };
            return e;
          }));
          scheduleSolveAndApply();
          return;
        }
        // ── circle ────────────────────────────────────────────────────
        if (ent.kind === 'circle') {
          if (typeof value !== 'number') return;
          if (field === 'cx' || field === 'cy') {
            const ctr = entities.find((e) => e.id === ent.center);
            if (!ctr || ctr.kind !== 'point') return;
            const nx = field === 'cx' ? value : ctr.x;
            const ny = field === 'cy' ? value : ctr.y;
            try { solver.movePoint(ent.center, nx, ny); }
            catch { /* fixed point — ignore */ }
            setEntities((prev) => prev.map((e) => (
              e.id === ent.center && e.kind === 'point' ? { ...e, x: nx, y: ny } : e
            )));
          } else if (field === 'radius') {
            if (value <= 0) return;
            solver.setCircleRadius(ent.id, value);
            setEntities((prev) => prev.map((e) => (
              e.id === id && e.kind === 'circle' ? { ...e, radius: value } : e
            )));
          }
          scheduleSolveAndApply();
          return;
        }
      } catch {
        // Solver rejected (fixed point, over-constrained, etc.) —
        // swallow; the next solve cycle's status pill will surface it.
      }
    },
    [solver, entities, scheduleSolveAndApply],
  );

  // Bulk-delete aware: panel fires onDelete once per selected entity in
  // sequence. Solver removes happen immediately, view + selection prune
  // immediately, but the solve is debounced so a 3-point bulk delete
  // collapses to 1 solver.solve() call.
  const handlePanelDelete = useCallback(
    (id: string): void => {
      if (!solver) return;
      const ent = entities.find((e) => e.id === id);
      if (!ent) return;
      try {
        if (ent.kind === 'point') solver.removePoint(ent.id);
        else if (ent.kind === 'line') solver.removeLine(ent.id);
        else if (ent.kind === 'circle') solver.removeCircle(ent.id);
      } catch { /* tracking-set delete is best-effort */ }
      // Drop from view + selection. We deliberately do NOT cascade-delete
      // point ↔ line dependencies: deleting a line keeps its endpoints
      // (they may be shared with other entities); deleting a shared point
      // would orphan downstream lines — the user can clean those up next.
      setEntities((prev) => prev.filter((e) => e.id !== id));
      setSelection((prev) => prev.filter((r) => r.id !== id));
      scheduleSolveAndApply();
    },
    [solver, entities, scheduleSolveAndApply],
  );

  if (loadError) {
    return (
      <div data-testid="solver-sketch-editor" data-state="error" style={{ padding: 12, color: '#dc2626' }}>
        {t.error}: {loadError}
      </div>
    );
  }
  if (!solver) {
    return (
      <div data-testid="solver-sketch-editor" data-state="loading" style={{ padding: 12, color: 'var(--nx-text-2)' }}>
        {t.loading}
      </div>
    );
  }

  return (
    <div
      data-testid="solver-sketch-editor"
      data-state="ready"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: '#fafafa',
        border: '1px solid var(--nx-border)',
        borderRadius: 8,
        outline: 'none',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Title bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--nx-text)' }}>{t.title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            data-testid="solver-sketch-dof"
            data-dof-state={dofKind}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'var(--nx-panel)',
              border: `1px solid ${dofColor(dofKind)}`,
              color: dofColor(dofKind),
            }}
          >
            {t.dofLabel}: {dof} ({dofText})
          </span>
          <button
            type="button"
            onClick={handleExportSvg}
            data-testid="solver-sketch-export-svg"
            title={t.exportSvg}
            style={{ padding: '4px 10px', fontSize: 12, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.exportSvg}
          </button>
          <button
            type="button"
            onClick={openExportModal}
            data-testid="solver-sketch-export-modal-button"
            title={t.exportModal}
            style={{ padding: '4px 10px', fontSize: 12, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.exportModal}
          </button>
          <button
            type="button"
            onClick={openImportModal}
            data-testid="solver-sketch-import-button"
            title={t.import}
            style={{ padding: '4px 10px', fontSize: 12, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.import}
          </button>
          {/* Import mode radio — replace clears existing geometry before
              pasting in the import; merge keeps it. Sits inline next to the
              Import button so the user picks the mode in the same eye-fix
              they pick the action. Defaults to 'merge' (non-destructive). */}
          <span
            role="radiogroup"
            aria-label={t.importMode}
            data-testid="solver-sketch-import-mode"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--nx-text-2)' }}
          >
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
              <input
                type="radio"
                name="solver-sketch-import-mode"
                value="merge"
                checked={importMode === 'merge'}
                onChange={() => setImportMode('merge')}
                data-testid="solver-sketch-import-mode-merge"
              />
              {t.importMerge}
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
              <input
                type="radio"
                name="solver-sketch-import-mode"
                value="replace"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
                data-testid="solver-sketch-import-mode-replace"
              />
              {t.importReplace}
            </label>
          </span>
          <button
            type="button"
            onClick={toggleAiPanel}
            data-testid="solver-sketch-ai-toggle"
            aria-pressed={aiPanelOpen}
            title={t.showAiConstraint}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: aiPanelOpen ? '#7c3aed' : 'var(--nx-panel)',
              color: aiPanelOpen ? '#fff' : 'var(--nx-text)',
              border: '1px solid ' + (aiPanelOpen ? '#7c3aed' : 'var(--nx-border)'),
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.aiConstraint}
          </button>
          <button
            type="button"
            onClick={toggleGroups}
            data-testid="solver-sketch-groups-toggle"
            aria-pressed={groupsOpen}
            title={t.showGroups}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: groupsOpen ? '#0e7490' : 'var(--nx-panel)',
              color: groupsOpen ? '#fff' : 'var(--nx-text)',
              border: '1px solid ' + (groupsOpen ? '#0e7490' : 'var(--nx-border)'),
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.groups}
          </button>
          <button
            type="button"
            onClick={toggleTransform}
            data-testid="solver-sketch-transform-toggle"
            aria-pressed={transformOpen}
            title={t.showTransform}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: transformOpen ? '#0e7490' : 'var(--nx-panel)',
              color: transformOpen ? '#fff' : 'var(--nx-text)',
              border: '1px solid ' + (transformOpen ? '#0e7490' : 'var(--nx-border)'),
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.transform}
          </button>
          <button
            type="button"
            onClick={toggleExpressions}
            data-testid="solver-sketch-expressions-toggle"
            aria-pressed={expressionsOpen}
            title={t.showExpressions}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: expressionsOpen ? '#0e7490' : 'var(--nx-panel)',
              color: expressionsOpen ? '#fff' : 'var(--nx-text)',
              border: '1px solid ' + (expressionsOpen ? '#0e7490' : 'var(--nx-border)'),
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.expressions}
          </button>
          <button
            type="button"
            onClick={handleClose}
            data-testid="solver-sketch-close"
            style={{ padding: '4px 10px', fontSize: 12, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.close}
          </button>
        </div>
      </div>

      {/* Entity toolbar + snap toggles */}
      <div role="toolbar" aria-label="entity tools" style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {ENTITY_TOOLS.map((b) => {
          const active = tool === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => changeTool(b.id)}
              data-testid={`solver-sketch-tool-${b.id}`}
              aria-pressed={active}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                background: active ? '#2563eb' : 'var(--nx-panel)',
                color: active ? '#fff' : 'var(--nx-text)',
                border: '1px solid ' + (active ? '#2563eb' : 'var(--nx-border)'),
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {b.label(t)}
            </button>
          );
        })}

        {/* Snap toggles — small pill buttons that sit visually grouped after
            the entity tools. Each is independent; aria-pressed reflects the
            current option. Disabling all three turns snap off entirely. */}
        <span
          aria-hidden="true"
          style={{ width: 1, height: 18, background: 'var(--nx-panel-2)', margin: '0 6px' }}
        />
        <span style={{ fontSize: 11, color: 'var(--nx-text-2)', fontWeight: 600, marginRight: 2 }}>
          {t.snapLabel}:
        </span>
        {([
          { key: 'enableGrid', id: 'grid', label: t.snapGrid },
          { key: 'enablePointSnap', id: 'point', label: t.snapPoint },
          { key: 'enableIntersection', id: 'intersection', label: t.snapIntersection },
          // Phase 2 toggles default OFF so the toolbar reads "Phase 1 on,
          // Phase 2 opt-in". Same pill design (cyan-700 active on white).
          { key: 'enableArc', id: 'arc', label: t.snapArc },
          { key: 'enablePerpendicular', id: 'perpendicular', label: t.snapPerpendicular },
        ] as const).map((s) => {
          const active = snapOpts[s.key];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSnap(s.key)}
              data-testid={`solver-snap-toggle-${s.id}`}
              aria-pressed={active}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                background: active ? '#0e7490' : 'var(--nx-panel)',
                color: active ? '#fff' : 'var(--nx-text-2)',
                border: '1px solid ' + (active ? '#0e7490' : 'var(--nx-border)'),
                borderRadius: 12,
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Constraint toolbar (enabled only when selection matches requires) */}
      <div role="toolbar" aria-label="constraint tools" style={{ display: 'flex', gap: 4 }}>
        {CONSTRAINT_TOOLS.map((c) => {
          const enabled = constraintEligible(c);
          return (
            <button
              key={c.id}
              type="button"
              disabled={!enabled}
              onClick={() => applyConstraint(c.id)}
              data-testid={`solver-sketch-constraint-${c.id}`}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                background: enabled ? 'var(--nx-panel)' : 'var(--nx-panel-2)',
                color: enabled ? 'var(--nx-text)' : 'var(--nx-text-2)',
                border: '1px solid ' + (enabled ? 'var(--nx-border)' : 'var(--nx-border)'),
                borderRadius: 4,
                cursor: enabled ? 'pointer' : 'not-allowed',
              }}
            >
              {c.label(t)}
            </button>
          );
        })}
      </div>

      {/* SketchConstraintToolbar — Phase 1.A standalone (11 constraint kinds). */}
      {/* Wired against the unified selection state; ESC + clear share the same setSelection. */}
      <SketchConstraintToolbar
        lang={lang}
        selection={selection}
        onAdd={handleToolbarAdd}
        onClear={handleToolbarClear}
        disabled={!solver}
      />

      {/*
        Transform panel — Phase 2.x sketchTransform integration. Default OFF
        (toggled via the "Transform" button in the title bar). When ON,
        mounts inline beneath the constraint toolbar. The op picker (4
        buttons) and op-specific input row share the same testid-tagged
        container so tests can scope their queries cheaply.

        Scope policy (badge): when at least one entity is in the selection,
        the op runs against those ids (lines/circles/arcs expand to their
        underlying points); otherwise it runs against every point in the
        sketch. Mirror op has a second special case — see
        handleTransformApply for the 2-selected-points axis shortcut.
      */}
      {transformOpen && (
        <div
          data-testid="solver-sketch-transform-panel"
          data-scope={selection.length === 0 ? 'all' : 'selection'}
          data-op={transformOp ?? 'none'}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            background: 'var(--nx-panel-2)',
            border: '1px solid var(--nx-border)',
            borderRadius: 6,
            fontSize: 11,
          }}
        >
          {/* op picker + scope badge + reset/recapture */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: 'var(--nx-text-2)', marginRight: 4 }}>
              {t.transform}:
            </span>
            {([
              { id: 'translate' as const, label: t.opTranslate },
              { id: 'rotate' as const, label: t.opRotate },
              { id: 'scale' as const, label: t.opScale },
              { id: 'mirror' as const, label: t.opMirror },
            ]).map((op) => {
              const active = transformOp === op.id;
              return (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => setTransformOp(op.id)}
                  data-testid={`solver-sketch-transform-op-${op.id}`}
                  aria-pressed={active}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    background: active ? '#0e7490' : 'var(--nx-panel)',
                    color: active ? '#fff' : 'var(--nx-text)',
                    border: '1px solid ' + (active ? '#0e7490' : 'var(--nx-border)'),
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {op.label}
                </button>
              );
            })}
            <span
              data-testid="solver-sketch-transform-scope"
              style={{
                marginLeft: 8,
                padding: '2px 6px',
                fontSize: 10,
                borderRadius: 10,
                background: selection.length === 0 ? '#e0e7ff' : '#dcfce7',
                color: selection.length === 0 ? '#3730a3' : '#166534',
                border: '1px solid ' + (selection.length === 0 ? '#c7d2fe' : '#bbf7d0'),
              }}
            >
              {selection.length === 0 ? t.transformScopeAll : `${t.transformScopeSelection} (${selection.length})`}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={handleTransformRecapture}
              data-testid="solver-sketch-transform-recapture"
              title={t.transformRecapture}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                background: 'var(--nx-panel)',
                color: 'var(--nx-text-2)',
                border: '1px solid var(--nx-border)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t.transformRecapture}
            </button>
            <button
              type="button"
              onClick={handleTransformReset}
              data-testid="solver-sketch-transform-reset"
              title={t.transformReset}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                background: 'var(--nx-panel)',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t.transformReset}
            </button>
          </div>

          {/* op-specific input row */}
          {transformOp === 'translate' && (
            <div
              data-testid="solver-sketch-transform-inputs-translate"
              style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {t.transformDx}
                <input
                  type="number"
                  value={txDx}
                  onChange={(e) => setTxDx(e.target.value)}
                  data-testid="solver-sketch-transform-input-dx"
                  style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {t.transformDy}
                <input
                  type="number"
                  value={txDy}
                  onChange={(e) => setTxDy(e.target.value)}
                  data-testid="solver-sketch-transform-input-dy"
                  style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                />
              </label>
              <button
                type="button"
                onClick={handleTransformApply}
                data-testid="solver-sketch-transform-apply"
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  background: '#2563eb',
                  color: '#fff',
                  border: '1px solid #2563eb',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {t.transformApply}
              </button>
            </div>
          )}

          {transformOp === 'rotate' && (
            <div
              data-testid="solver-sketch-transform-inputs-rotate"
              style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {t.transformAngleDeg}
                <input
                  type="number"
                  value={txAngleDeg}
                  onChange={(e) => setTxAngleDeg(e.target.value)}
                  data-testid="solver-sketch-transform-input-angle"
                  style={{ width: 70, padding: '2px 4px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {t.transformCenterX}
                <input
                  type="number"
                  value={txCx}
                  onChange={(e) => setTxCx(e.target.value)}
                  data-testid="solver-sketch-transform-input-cx"
                  style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {t.transformCenterY}
                <input
                  type="number"
                  value={txCy}
                  onChange={(e) => setTxCy(e.target.value)}
                  data-testid="solver-sketch-transform-input-cy"
                  style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                />
              </label>
              <button
                type="button"
                onClick={handleTransformApply}
                data-testid="solver-sketch-transform-apply"
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  background: '#2563eb',
                  color: '#fff',
                  border: '1px solid #2563eb',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {t.transformApply}
              </button>
            </div>
          )}

          {transformOp === 'scale' && (
            <div
              data-testid="solver-sketch-transform-inputs-scale"
              style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {t.transformFactor}
                <input
                  type="number"
                  value={txFactor}
                  onChange={(e) => setTxFactor(e.target.value)}
                  data-testid="solver-sketch-transform-input-factor"
                  style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {t.transformCenterX}
                <input
                  type="number"
                  value={txCx}
                  onChange={(e) => setTxCx(e.target.value)}
                  data-testid="solver-sketch-transform-input-cx"
                  style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {t.transformCenterY}
                <input
                  type="number"
                  value={txCy}
                  onChange={(e) => setTxCy(e.target.value)}
                  data-testid="solver-sketch-transform-input-cy"
                  style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                />
              </label>
              <button
                type="button"
                onClick={handleTransformApply}
                data-testid="solver-sketch-transform-apply"
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  background: '#2563eb',
                  color: '#fff',
                  border: '1px solid #2563eb',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {t.transformApply}
              </button>
            </div>
          )}

          {transformOp === 'mirror' && (
            <div
              data-testid="solver-sketch-transform-inputs-mirror"
              style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
            >
              {mirrorAxisFromSelection ? (
                <span
                  data-testid="solver-sketch-transform-mirror-axis-from-selection"
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    borderRadius: 4,
                    background: '#dcfce7',
                    color: '#166534',
                    border: '1px solid #bbf7d0',
                  }}
                >
                  {t.transformMirrorUseSelected}
                </span>
              ) : (
                <>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {t.transformMirrorAx}
                    <input
                      type="number"
                      value={txMirrorAx}
                      onChange={(e) => setTxMirrorAx(e.target.value)}
                      data-testid="solver-sketch-transform-input-mirror-ax"
                      style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                    />
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {t.transformMirrorAy}
                    <input
                      type="number"
                      value={txMirrorAy}
                      onChange={(e) => setTxMirrorAy(e.target.value)}
                      data-testid="solver-sketch-transform-input-mirror-ay"
                      style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                    />
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {t.transformMirrorBx}
                    <input
                      type="number"
                      value={txMirrorBx}
                      onChange={(e) => setTxMirrorBx(e.target.value)}
                      data-testid="solver-sketch-transform-input-mirror-bx"
                      style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                    />
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {t.transformMirrorBy}
                    <input
                      type="number"
                      value={txMirrorBy}
                      onChange={(e) => setTxMirrorBy(e.target.value)}
                      data-testid="solver-sketch-transform-input-mirror-by"
                      style={{ width: 60, padding: '2px 4px', fontSize: 11 }}
                    />
                  </label>
                </>
              )}
              <button
                type="button"
                onClick={handleTransformApply}
                data-testid="solver-sketch-transform-apply"
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  background: '#2563eb',
                  color: '#fff',
                  border: '1px solid #2563eb',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {t.transformApply}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Canvas + property panel (Phase 1.B: side-by-side layout) */}
      <div
        data-testid="solver-sketch-canvas-row"
        style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}
      >
      <svg
        ref={svgRef}
        data-testid="solver-sketch-canvas"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        style={{ background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', display: 'block' }}
      >
        <Grid width={width} height={height} />

        {/* lines */}
        {renderLines.map((l) => {
          const a = pointById.get(l.p1);
          const b = pointById.get(l.p2);
          if (!a || !b) return null;
          const isSel = selected.includes(l.id);
          return (
            <line
              key={l.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={isSel ? '#06b6d4' : '#111827'}
              strokeWidth={isSel ? 2.4 : 1.6}
              data-testid={`solver-sketch-entity-${l.id}`}
              aria-selected={isSel}
              onClick={(e) => handleEntityClick(l.id, e)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}

        {/* circles */}
        {renderCircles.map((c) => {
          const ctr = pointById.get(c.center);
          if (!ctr) return null;
          const isSel = selected.includes(c.id);
          return (
            <circle
              key={c.id}
              cx={ctr.x}
              cy={ctr.y}
              r={c.radius}
              fill="none"
              stroke={isSel ? '#06b6d4' : '#111827'}
              strokeWidth={isSel ? 2.4 : 1.6}
              data-testid={`solver-sketch-entity-${c.id}`}
              aria-selected={isSel}
              onClick={(e) => handleEntityClick(c.id, e)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}

        {/* points (draw last so they're on top) */}
        {renderPoints.map((p) => {
          const isSel = selected.includes(p.id);
          return (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r={isSel ? 4 : 3}
              fill={p.fixed ? '#dc2626' : isSel ? '#06b6d4' : '#111827'}
              data-testid={`solver-sketch-entity-${p.id}`}
              data-point-fixed={p.fixed}
              aria-selected={isSel}
              onMouseDown={(e) => handlePointMouseDown(p.id, e)}
              onClick={(e) => handleEntityClick(p.id, e)}
              style={{ cursor: tool === 'select' ? 'move' : 'pointer' }}
            />
          );
        })}

        {/*
          Constraint overlay — Phase 1.B. Rendered AFTER lines/circles/points
          so dim-lines + badges sit visually above geometry. Inside the SVG
          so the overlay shares the canvas coordinate system (no extra
          transform needed). z-order summary inside the canvas <svg>:
            1. Grid
            2. Lines + circles
            3. Points (drawn last among geometry so they're on top)
            4. SketchConstraintOverlay  ← here (top of geometry layer)
            5. In-progress preview (line/circle/rect ghost)
        */}
        <SketchConstraintOverlay
          constraints={overlayConstraints}
          selectedConstraintId={selectedConstraintId ?? undefined}
          onSelect={handleConstraintSelect}
          onDelete={handleConstraintDelete}
          onValueChange={handleConstraintValueChange}
        />

        {/* in-progress preview */}
        {pending && cursor && pending.kind === 'line' && (
          <line x1={pending.start.x} y1={pending.start.y} x2={cursor.x} y2={cursor.y} stroke="#9ca3af" strokeWidth={1.4} strokeDasharray="4 3" />
        )}
        {pending && cursor && pending.kind === 'circle' && (
          <circle cx={pending.center.x} cy={pending.center.y} r={dist(pending.center.x, pending.center.y, cursor.x, cursor.y)} fill="none" stroke="#9ca3af" strokeWidth={1.4} strokeDasharray="4 3" />
        )}
        {pending && cursor && pending.kind === 'rect' && (() => {
          const x = Math.min(pending.corner.x, cursor.x);
          const y = Math.min(pending.corner.y, cursor.y);
          const w = Math.abs(cursor.x - pending.corner.x);
          const h = Math.abs(cursor.y - pending.corner.y);
          return <rect x={x} y={y} width={w} height={h} fill="none" stroke="#9ca3af" strokeWidth={1.4} strokeDasharray="4 3" />;
        })()}

        {/* Snap indicator — drawn last so it sits visually above geometry +
            in-progress previews. The indicator is null when snap is off or
            when the active tool isn't a drawing tool (see computeSnapAt). */}
        <SketchSnapIndicator snap={snapTarget} />
      </svg>

      {/*
        Property panel sidebar — sticky next to the canvas. Width is fixed
        so the canvas + panel together feel like a single design tool. The
        wrapper div lets us pin alignment + apply position:sticky later if
        the editor lives inside a scrollable container.
      */}
      <aside
        data-testid="solver-sketch-property-sidebar"
        style={{
          flex: '0 0 auto',
          minWidth: 240,
          maxWidth: 280,
          position: 'sticky',
          top: 0,
          alignSelf: 'flex-start',
        }}
      >
        <SketchEntityPropertyPanel
          lang={lang}
          selection={selection}
          entityData={panelEntityData}
          onChange={handlePanelChange}
          onDelete={handlePanelDelete}
        />
        {/*
          SketchConstraintAiPanel — Phase A NL surface for sketch-level
          constraint commands. Default OFF (toggled via the "AI" button in
          the title bar). When ON, mounts here in the sidebar column so it
          sits visually next to the property panel — same column, same
          width band. selectionCounts feeds the preview text ("Apply N
          horizontal constraints" when a line selection is active).
        */}
        {aiPanelOpen && (
          <div
            data-testid="solver-sketch-ai-panel-wrapper"
            style={{ marginTop: 8 }}
          >
            <SketchConstraintAiPanel
              lang={lang}
              onApplyConstraints={handleApplyAiConstraints}
              selectionCounts={aiSelectionCounts}
            />
          </div>
        )}
        {/*
          SketchGroupPanel — Phase 2.x sketchGroup surface. Default OFF
          (toggled via the "Groups" button in the title bar). When ON,
          mounts below the property/AI panels in the same sidebar column.
          Selection drives the "Group selected (N)" button; transforms
          re-solve the solver through handleGroupTranslate / Rotate /
          Scale.
        */}
        {groupsOpen && groupManager && (
          <div
            data-testid="solver-sketch-group-panel-wrapper"
            style={{ marginTop: 8 }}
          >
            <SketchGroupPanel
              lang={lang}
              groups={groupSnapshot}
              selection={selection}
              onCreate={handleGroupCreate}
              onRemove={handleGroupRemove}
              onTranslate={handleGroupTranslate}
              onRotate={handleGroupRotate}
              onScale={handleGroupScale}
              onToggleLock={handleGroupToggleLock}
            />
          </div>
        )}
        {/*
          SketchExpressionsPanel — Phase 2.x parametric-expression scratchpad.
          Default OFF (toggled via the "Variables" button in the title bar).
          Self-contained: the engine is pure + eval-free and owns its own row
          state, so the panel never touches the live solver — it's a place to
          work out dimension values (width * cols + gaps, 90deg, sin(pi/4))
          before binding them to constraints in a later phase.
        */}
        {expressionsOpen && (
          <div
            data-testid="solver-sketch-expressions-panel-wrapper"
            style={{ marginTop: 8 }}
          >
            <SketchExpressionsPanel
              lang={lang}
              onApply={handleApplyVariableValue}
              canApply={selectedDimensionalConstraint !== null}
              boundValues={boundVariableValues}
            />
          </div>
        )}
      </aside>
      </div>

      {/* status bar */}
      <div
        data-testid="solver-sketch-status"
        data-status={hasConflicts ? 'conflict' : hasRedundant ? 'redundant' : 'ready'}
        style={{
          fontSize: 11,
          color: hasConflicts ? '#dc2626' : hasRedundant ? '#d97706' : 'var(--nx-text-2)',
          textAlign: 'center',
        }}
      >
        {entities.length === 0 && !pending ? t.hint : statusText}
      </div>

      {/*
        Multi-format export modal (SVG / PNG / JSON) — Agent-SSSSS's
        SketchExportModal mounted lazily. We deliberately render the
        element only when `modalOpen` is true so the dynamic chunk
        load is deferred until the first click. Entities + suggested
        filename are snapshotted at render time so the modal always
        sees the LATEST sketch state, not whatever was there at
        component-mount time. We pass the editor's own `lang` through
        — the modal supports the same 6-language matrix.
      */}
      {modalOpen && (
        <SketchExportModal
          lang={lang}
          entities={buildSvgEntities()}
          defaultFilename={buildSvgFilename()}
          onClose={closeExportModal}
        />
      )}

      {/*
        Import modal — opened from the title-bar "Import..." button. The
        modal handles file/text ingress + parse error display; the host
        receives `entities` via `onImport` and maps them into solver state
        via `handleSketchImport` (which honors the merge/replace mode
        selected in the title-bar radio).
      */}
      {importOpen && (
        <SketchImportModal
          lang={lang}
          onImport={handleSketchImport}
          onClose={closeImportModal}
        />
      )}
    </div>
  );
}
