'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useSceneStore } from '../store/sceneStore';
import { useUIStore } from '../store/uiStore';
import { useTheme } from '../ThemeContext';
import { SHAPES, type ShapeConfig, type ShapeResult } from '../shapes';
import type { SketchProfile, ConstraintType, SketchConstraint, SketchDimension } from '../sketch/types';
import type { SketchHistoryEntry } from '../sketch/SketchHistory';
import type { ExprVariable } from '../ExpressionEngine';
import type { RenderSettings } from '../rendering/RenderPanel';
import type { BomPartResult } from '../ShapePreview';
import type { Face, OptResult } from '../topology/optimizer/types';
import type { FeatureHistory } from '../useFeatureStack';
import type { FeatureInstance, FeatureType } from '../features/types';
import dynamic from 'next/dynamic';
import type * as THREE from 'three';
import type { DFMParamWarning } from '../analysis/dfmParamMapper';
import type { UnitSystem } from '../units';

const SketchHistoryPanel = dynamic(() => import('../sketch/SketchHistoryPanel'), { ssr: false });
const SketchPanel = dynamic(() => import('../sketch/SketchPanel'), { ssr: false });
const MaterialPicker = dynamic(() => import('../MaterialPicker'), { ssr: false });
const RenderPanel = dynamic(() => import('../rendering/RenderPanel'), { ssr: false });
const ConditionPanel = dynamic(() => import('../topology/ConditionPanel'), { ssr: false });
const SectionPropertiesPanel = dynamic(() => import('../SectionPropertiesPanel'), { ssr: false });
const CotsSizePreset = dynamic(() => import('../CotsSizePreset'), { ssr: false });
const ExpressionInput = dynamic(() => import('../ExpressionInput'), { ssr: false });
import SidebarResizer from '../SidebarResizer';
import { RAIL_WIDTH } from '../hooks/useSidebarLayout';
import { prefGetJson, prefSetJson, PREF_KEYS } from '@/lib/platform';

// ─── i18n dict ────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    browser: '브라우저',
    sliceLinkedBadge: '슬라이스 ↔ 3D 단면',
    designTree: '디자인 트리',
    newSketch: '스케치 시작',
    addFeatureHint: '솔리드 탭에서 피처를 추가하세요',
    sketch: '스케치 속성',
    properties: '속성',
    searchShapes: 'shape 검색...',
    favorites: '즐겨찾기',
    recent: '최근 사용',
    all: '전체',
    noResults: '결과 없음',
    removeFavorite: '즐겨찾기 제거',
    addFavorite: '즐겨찾기 추가',
    material: '재질',
    materialHint: '형상을 먼저 생성하면 재질을 선택할 수 있습니다',
    geometry: '형상 정보',
    imported: '임포트된 파일',
    formulaExit: '슬라이더로 전환 (수식 모드 끄기)',
    formulaEnter: '수식 입력 모드로 전환 (예: sin(x)*10)',
    configuration: '설정 (변형)',
    configWorking: '— 작업 중 (마스터) —',
    configAdd: '현재 상태로 변형 추가',
    configDelete: '선택 변형 삭제',
    configHint: '치수·피처 억제 스냅샷. .nfab에 저장됩니다.',
    configNamePlaceholder: '변형 이름',
    configRenameSave: '이름 저장',
  },
  en: {
    browser: 'Browser',
    sliceLinkedBadge: 'Slice ↔ 3D section',
    designTree: 'Design Tree',
    newSketch: 'New Sketch',
    addFeatureHint: 'Add features from the Solid tab',
    sketch: 'Sketch',
    properties: 'Properties',
    searchShapes: 'Search shapes...',
    favorites: 'Favorites',
    recent: 'Recent',
    all: 'All',
    noResults: 'No results',
    removeFavorite: 'Remove favorite',
    addFavorite: 'Add favorite',
    material: 'Material',
    materialHint: 'Generate a shape to select material',
    geometry: 'Geometry',
    imported: 'Imported File',
    formulaExit: 'Back to slider (exit formula mode)',
    formulaEnter: 'Switch to formula mode (e.g. sin(x)*10)',
    configuration: 'Configuration',
    configWorking: '— Working (master) —',
    configAdd: 'Add variant from current',
    configDelete: 'Delete selected variant',
    configHint: 'Snapshot of params + feature suppress. Saved in .nfab.',
    configNamePlaceholder: 'Variant name',
    configRenameSave: 'Save name',
  },
  ja: {
    browser: 'ブラウザ',
    sliceLinkedBadge: 'スライス ↔ 3D 断面',
    designTree: 'デザインツリー',
    newSketch: '新規スケッチ',
    addFeatureHint: 'ソリッドタブから追加',
    sketch: 'スケッチ',
    properties: 'プロパティ',
    searchShapes: '形状を検索...',
    favorites: 'お気に入り',
    recent: '最近',
    all: '全て',
    noResults: '結果なし',
    removeFavorite: 'お気に入りから削除',
    addFavorite: 'お気に入りに追加',
    material: '材質',
    materialHint: '形状を生成すると材質を選択できます',
    geometry: '形状情報',
    imported: 'インポート済ファイル',
    formulaExit: 'スライダーに戻る',
    formulaEnter: '数式モードに切替 (例: sin(x)*10)',
    configuration: '構成',
    configWorking: '— 編集中 (マスター) —',
    configAdd: '現在の状態でバリアント追加',
    configDelete: '選択バリアント削除',
    configHint: '寸法・抑制のスナップショット。.nfab に保存。',
    configNamePlaceholder: 'バリアント名',
    configRenameSave: '名前を保存',
  },
  zh: {
    browser: '浏览器',
    sliceLinkedBadge: '切片 ↔ 三维剖切',
    designTree: '设计树',
    newSketch: '新建草图',
    addFeatureHint: '从「实体」选项卡添加特征',
    sketch: '草图',
    properties: '属性',
    searchShapes: '搜索形状...',
    favorites: '收藏',
    recent: '最近',
    all: '全部',
    noResults: '无结果',
    removeFavorite: '移除收藏',
    addFavorite: '添加收藏',
    material: '材质',
    materialHint: '生成形状后可选择材质',
    geometry: '几何信息',
    imported: '导入的文件',
    formulaExit: '返回滑块 (退出公式模式)',
    formulaEnter: '切换到公式模式 (例: sin(x)*10)',
    configuration: '配置',
    configWorking: '— 工作中 (主模型) —',
    configAdd: '从当前状态添加变体',
    configDelete: '删除所选变体',
    configHint: '参数与特征抑制快照，保存在 .nfab。',
    configNamePlaceholder: '变体名称',
    configRenameSave: '保存名称',
  },
  es: {
    browser: 'Explorador',
    sliceLinkedBadge: 'Corte ↔ sección 3D',
    designTree: 'Árbol de Diseño',
    newSketch: 'Nuevo Croquis',
    addFeatureHint: 'Añade funciones desde la pestaña Sólido',
    sketch: 'Croquis',
    properties: 'Propiedades',
    searchShapes: 'Buscar formas...',
    favorites: 'Favoritos',
    recent: 'Recientes',
    all: 'Todo',
    noResults: 'Sin resultados',
    removeFavorite: 'Quitar favorito',
    addFavorite: 'Añadir favorito',
    material: 'Material',
    materialHint: 'Genera una forma para seleccionar material',
    geometry: 'Geometría',
    imported: 'Archivo Importado',
    formulaExit: 'Volver al deslizador',
    formulaEnter: 'Cambiar a modo fórmula (ej: sin(x)*10)',
    configuration: 'Configuración',
    configWorking: '— Trabajo (maestro) —',
    configAdd: 'Añadir variante desde actual',
    configDelete: 'Eliminar variante',
    configHint: 'Instantánea de params y supresión. En .nfab.',
    configNamePlaceholder: 'Nombre variante',
    configRenameSave: 'Guardar nombre',
  },
  ar: {
    browser: 'المستعرض',
    sliceLinkedBadge: 'شريحة ↔ مقطع ثلاثي الأبعاد',
    designTree: 'شجرة التصميم',
    newSketch: 'رسم جديد',
    addFeatureHint: 'أضف الميزات من تبويب الصلب',
    sketch: 'الرسم',
    properties: 'الخصائص',
    searchShapes: 'بحث عن أشكال...',
    favorites: 'المفضلة',
    recent: 'الأخيرة',
    all: 'الكل',
    noResults: 'لا نتائج',
    removeFavorite: 'إزالة من المفضلة',
    addFavorite: 'أضف إلى المفضلة',
    material: 'المادة',
    materialHint: 'أنشئ شكلاً لاختيار المادة',
    geometry: 'الهندسة',
    imported: 'ملف مستورد',
    formulaExit: 'العودة إلى المنزلقة',
    formulaEnter: 'التبديل إلى وضع الصيغة (مثال: sin(x)*10)',
    configuration: 'التكوين',
    configWorking: '— العمل (الرئيسي) —',
    configAdd: 'إضافة متغير من الحالي',
    configDelete: 'حذف المتغير',
    configHint: 'لقطة للمعاملات والتعليق. في .nfab.',
    configNamePlaceholder: 'اسم المتغير',
    configRenameSave: 'حفظ الاسم',
  },
} as const;

// ─── Constants ────────────────────────────────────────────────────────────────

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔩', sphere: '🔮', cone: '🔺', torus: '🍩', wedge: '🔻',
  pipe: '🔧', lBracket: '📐', flange: '⚙️', plateBend: '🔨',
  gear: '⚙️', fanBlade: '🌀', sprocket: '🔗', pulley: '🎡',
  sweep: '🔀', loft: '🔄',
  bolt: '🔩', spring: '🌀', tSlot: '⊓',
  hexNut: '⬡', washer: '⭕', iBeam: 'Ⅰ', bearing: '⊚',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface LeftPanelProps {
  // i18n
  lang: string;
  t: Record<string, string>;
  gt: Record<string, string>;

  // Responsive
  isMobile: boolean;
  isTablet: boolean;

  // Computed shape lists
  tier1: ShapeConfig[];
  tier2: ShapeConfig[];

  // Effective result (sketchResult || parametric result)
  effectiveResult: ShapeResult | null;

  // Feature tree
  featureHistory: FeatureHistory | null;
  features: FeatureInstance[];
  rollbackTo: (id: string) => void;
  startEditing: (id: string) => void;
  finishEditing: () => void;
  toggleExpanded: (id: string) => void;
  ensureExpanded?: (ids: string[]) => void;
  toggleFeature: (id: string) => void;
  removeNode: (id: string) => void;
  updateFeatureParam: (id: string, key: string, value: number) => void;
  addFeature: (type: FeatureType) => void;
  moveFeatureByIds?: (fromId: string, toId: string) => void;

  // Sketch local state
  sketchProfiles: SketchProfile[];
  activeProfileIdx: number;
  sketchOperation: 'add' | 'subtract';
  sketchPlaneOffset: number;
  showSketchHistory: boolean;
  editingSketchFeatureId: string | null;
  sketchHistory: SketchHistoryEntry[];

  // Sketch handlers
  onSketchModeStart: () => void;
  onSketchViewModeChange: (mode: '2d' | '3d' | 'drawing') => void;
  onSketchPlaneChange: (p: 'xy' | 'xz' | 'yz') => void;
  onSketchOperationChange: (op: 'add' | 'subtract') => void;
  onSketchPlaneOffsetChange: (v: number) => void;
  onToggleSketchHistory: () => void;
  onLoadSketchFromHistory: (entry: SketchHistoryEntry) => void;
  onDeleteSketchHistoryEntry: (id: string) => void;
  onSketchClear: () => void;
  onSketchUndo: () => void;
  onSketchGenerate: () => void;
  sketchStep?: 'draw' | 'setup3d';
  onSketchStepChange?: (step: 'draw' | 'setup3d') => void;
  onSetActiveProfile: (idx: number) => void;
  onAddHoleProfile: () => void;
  onDeleteProfile: (idx: number) => void;
  onAddSketchFeature: () => void;
  onEditSketchFeature: (featureId: string) => void;

  // Constraint status
  constraints?: SketchConstraint[];
  dimensions?: SketchDimension[];
  onAddConstraint?: (constraint: import('../sketch/types').SketchConstraint) => void;
  onRemoveConstraint?: (id: string) => void;
  onDimensionChange?: (id: string, value: number) => void;
  onRemoveDimension?: (id: string) => void;
  selectedConstraintType?: ConstraintType;
  onConstraintTypeChange?: (type: ConstraintType) => void;
  autoSolve?: boolean;
  onAutoSolveChange?: (v: boolean) => void;
  onSolveConstraints?: () => void;

  constraintStatus?: 'ok' | 'over-defined' | 'under-defined' | 'inconsistent';
  constraintDiagnostic?: {
    dof?: number;
    residual?: number;
    message?: string;
    unsatisfiedCount?: number;
  };

  // Shape / param handlers
  onSelectShape: (s: ShapeConfig) => void;
  onParamChange: (key: string, value: number) => void;
  onExpressionChange: (key: string, expr: string) => void;
  onParamCommit: () => void;
  onShapeReset: () => void;
  /** Formula text values for shapes with formulaFields */
  formulaValues?: Record<string, string>;
  onFormulaChange?: (key: string, value: string) => void;
  /** User-defined model variables available in expression formulas */
  modelVars?: ExprVariable[];

  // BOM export
  bomParts: BomPartResult[];
  bomLabel: string;
  showBomExportMenu: boolean;
  onToggleBomExportMenu: () => void;
  onExportBomCSV: () => void;
  onExportBomExcel: () => void;

  // Cart items count (for BOM visibility check)
  cartItemsCount: number;

  // Imported file info
  importedFilename: string | null;

  // Render panel
  renderSettings: RenderSettings;
  onRenderSettingsChange: (s: RenderSettings) => void;
  onRenderCapture: () => void;
  onHighResCapture?: () => void;

  // Optimize tab props
  customDomainGeometry: THREE.BufferGeometry | null;
  /** DFM 경고 맵: paramKey → warning. 슬라이더 레이블 옆 인라인 배지에 사용 */
  dfmParamWarnings?: Record<string, DFMParamWarning>;
  useCustomDomain: boolean;
  onUseCustomDomainChange: (v: boolean) => void;
  dimX: number;
  dimY: number;
  dimZ: number;
  onDimChange: (key: 'dimX' | 'dimY' | 'dimZ', value: number) => void;
  materialKey: string;
  unitSystem?: UnitSystem;
  /** Notified when a feature is double-clicked in the tree (for selection highlight). */
  onSelectFeatureFromTree?: (id: string) => void;
  onMaterialKeyChange: (k: string) => void;
  fixedFaces: Face[];
  loads: Array<{ face: Face; force: [number, number, number] }>;
  selectionMode: 'none' | 'fixed' | 'load';
  onSelectionModeChange: (mode: 'none' | 'fixed' | 'load') => void;
  onRemoveFixed: (face: Face) => void;
  onRemoveLoad: (face: Face) => void;
  activeLoadForce: [number, number, number];
  onActiveLoadForceChange: (force: [number, number, number]) => void;
  volfrac: number;
  onVolfracChange: (v: number) => void;
  resolution: 'low' | 'medium' | 'high';
  onResolutionChange: (r: 'low' | 'medium' | 'high') => void;
  penal: number;
  onPenalChange: (v: number) => void;
  rmin: number;
  onRminChange: (v: number) => void;
  maxIter: number;
  onMaxIterChange: (v: number) => void;
  isOptimizing: boolean;
  onGenerate: () => void;
  onOptReset: () => void;
  optResult: OptResult | null;
  resultMesh: boolean;
  weightInfo: { originalWeight: number; optimizedWeight: number; reduction: number } | null;
  convergenceChart: React.ReactNode | null;
  onExportOptSTL: () => void;
  onSendOptToQuote: () => void;

  // ── Layout (optional — omit for legacy defaults) ──
  /** Width in px when not collapsed. */
  layoutWidth?: number;
  /** Collapse to rail. */
  collapsed?: boolean;
  /** Render as floating overlay instead of inline flex child. */
  overlay?: boolean;
  /** Which side this panel is on (affects borders + resize handle edge). */
  side?: 'left' | 'right';
  onToggleCollapse?: () => void;
  onResize?: (nextWidth: number) => void;

  /** Sketch palette slice guide is linked to 3D section clipping. */
  sketchSliceLinked?: boolean;

  /** Named design configurations (CAD data model — variants). */
  configurationsList?: Array<{ id: string; name: string }>;
  activeConfigurationId?: string | null;
  onConfigurationSelect?: (id: string | null) => void;
  onConfigurationAdd?: (name: string) => void;
  onConfigurationRename?: (id: string, name: string) => void;
  onConfigurationDelete?: (id: string) => void;
}

type PanelSectionsState = {
  tree: boolean;
  config: boolean;
  props: boolean;
  geometry: boolean;
  bom: boolean;
};

/** Collapsible panel section header — module scope so it is not recreated each render */
function LeftPanelSectionHeader({
  label,
  sectionKey,
  sections,
  onToggleSection,
  theme,
  extra,
}: {
  label: string;
  sectionKey: keyof PanelSectionsState;
  sections: PanelSectionsState;
  onToggleSection: (key: keyof PanelSectionsState) => void;
  theme: { text: string; textMuted: string };
  extra?: React.ReactNode;
}) {
  const expanded = sections[sectionKey];
  return (
    <div
      onClick={() => onToggleSection(sectionKey)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        padding: '5px 0',
        marginBottom: expanded ? 6 : 0,
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: theme.text, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {extra}
        <span style={{ color: theme.textMuted, fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

function LeftPanel({
  lang,
  t,
  gt,
  isMobile,
  isTablet,
  tier1,
  tier2,
  effectiveResult,
  featureHistory: _featureHistory,
  features,
  rollbackTo: _rollbackTo,
  startEditing: _startEditing,
  finishEditing: _finishEditing,
  toggleExpanded: _toggleExpanded,
  ensureExpanded: _ensureExpanded,
  toggleFeature: _toggleFeature,
  removeNode: _removeNode,
  updateFeatureParam: _updateFeatureParam,
  addFeature: _addFeature,
  moveFeatureByIds: _moveFeatureByIds,
  sketchProfiles,
  activeProfileIdx,
  sketchOperation,
  sketchPlaneOffset,
  showSketchHistory,
  editingSketchFeatureId,
  sketchHistory,
  onSketchModeStart,
  onSketchViewModeChange,
  onSketchPlaneChange,
  onSketchOperationChange,
  onSketchPlaneOffsetChange,
  onToggleSketchHistory,
  onLoadSketchFromHistory,
  onDeleteSketchHistoryEntry,
  onSketchClear,
  onSketchUndo,
  onSketchGenerate,
  sketchStep,
  onSketchStepChange,
  onSetActiveProfile,
  onAddHoleProfile,
  onDeleteProfile,
  onAddSketchFeature,
  onEditSketchFeature,
  constraints, dimensions,
  onAddConstraint, onRemoveConstraint, onDimensionChange, onRemoveDimension,
  selectedConstraintType, onConstraintTypeChange,
  autoSolve, onAutoSolveChange, onSolveConstraints,
  constraintStatus,
  constraintDiagnostic,
  onSelectShape,
  onParamChange,
  onExpressionChange,
  onParamCommit,
  onShapeReset,
  formulaValues,
  onFormulaChange,
  bomParts,
  bomLabel: _bomLabel,
  showBomExportMenu,
  onToggleBomExportMenu,
  onExportBomCSV,
  onExportBomExcel,
  cartItemsCount,
  importedFilename,
  renderSettings,
  onRenderSettingsChange,
  onRenderCapture,
  onHighResCapture,
  customDomainGeometry,
  dfmParamWarnings,
  useCustomDomain,
  onUseCustomDomainChange,
  dimX,
  dimY,
  dimZ,
  onDimChange,
  materialKey,
  unitSystem,
  onSelectFeatureFromTree: _onSelectFeatureFromTree,
  onMaterialKeyChange,
  fixedFaces,
  loads,
  selectionMode,
  onSelectionModeChange,
  onRemoveFixed,
  onRemoveLoad,
  activeLoadForce,
  onActiveLoadForceChange,
  volfrac,
  onVolfracChange,
  resolution,
  onResolutionChange,
  penal,
  onPenalChange,
  rmin,
  onRminChange,
  maxIter,
  onMaxIterChange,
  isOptimizing,
  onGenerate,
  onOptReset,
  optResult,
  resultMesh,
  weightInfo,
  convergenceChart,
  onExportOptSTL,
  onSendOptToQuote,
  modelVars,
  layoutWidth,
  collapsed = false,
  overlay = false,
  side = 'left',
  onToggleCollapse,
  onResize,
  sketchSliceLinked = false,
  configurationsList,
  activeConfigurationId = null,
  onConfigurationSelect,
  onConfigurationAdd,
  onConfigurationRename,
  onConfigurationDelete,
}: LeftPanelProps) {
  // i18n
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? (lang === 'ko' ? 'ko' : 'en')];

  const [newVariantName, setNewVariantName] = React.useState('');
  React.useEffect(() => {
    setNewVariantName(`Variant ${(configurationsList?.length ?? 0) + 1}`);
  }, [configurationsList?.length]);

  const [renameDraft, setRenameDraft] = React.useState('');
  React.useEffect(() => {
    const c = configurationsList?.find(x => x.id === activeConfigurationId);
    setRenameDraft(c?.name ?? '');
  }, [activeConfigurationId, configurationsList]);

  // Read from stores directly
  const { theme } = useTheme();
  const activeTab = useUIStore(s => s.activeTab);
  const tabletLeftOpen = useUIStore(s => s.tabletLeftOpen);

  const selectedId = useSceneStore(s => s.selectedId);
  const params = useSceneStore(s => s.params);
  const paramExpressions = useSceneStore(s => s.paramExpressions);
  const materialId = useSceneStore(s => s.materialId);

  // Formula mode toggle per param key
  const [formulaMode, setFormulaMode] = React.useState<Set<string>>(new Set());
  const setMaterialId = useSceneStore(s => s.setMaterialId);
  const isSketchMode = useSceneStore(s => s.isSketchMode);
  const sketchViewMode = useSceneStore(s => s.sketchViewMode);
  const sketchPlane = useSceneStore(s => s.sketchPlane);
  const sketchProfile = useSceneStore(s => s.sketchProfile);
  const sketchConfig = useSceneStore(s => s.sketchConfig);
  const setSketchConfig = useSceneStore(s => s.setSketchConfig);
  const sketchTool = useSceneStore(s => s.sketchTool);
  const setSketchTool = useSceneStore(s => s.setSketchTool);
  const renderMode = useSceneStore(s => s.renderMode);

  // Derived
  const shape = SHAPES.find(s => s.id === selectedId)!;

  // ── Shape search + favorites + recent ───────────────────────────────────────
  const [shapeSearch, setShapeSearch] = React.useState('');
  const [shapeFavorites, setShapeFavorites] = React.useState<string[]>(() => prefGetJson<string[]>(PREF_KEYS.shapeFavorites) ?? []);
  const [recentShapes, setRecentShapes] = React.useState<string[]>(() => prefGetJson<string[]>(PREF_KEYS.shapeRecent) ?? []);

  const toggleFavorite = React.useCallback((id: string) => {
    setShapeFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev];
      try { prefSetJson(PREF_KEYS.shapeFavorites, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const trackRecentShape = React.useCallback((id: string) => {
    setRecentShapes(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, 6);
      try { prefSetJson(PREF_KEYS.shapeRecent, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ── Accordion state ──────────────────────────────────────────────────────────
  const [sections, setSections] = React.useState<PanelSectionsState>({
    tree: true,
    config: true,
    props: true,
    geometry: false,
    bom: false,
  });
  const toggleSection = (key: keyof PanelSectionsState) =>
    setSections(s => ({ ...s, [key]: !s[key] }));

  // Auto-expand props panel when entering sketch mode
  React.useEffect(() => {
    if (isSketchMode) setSections(s => s.props ? s : { ...s, props: true });
  }, [isSketchMode]);

  // ── Browser Folders State ────────────────────────────────────────────────────
  const [browserExpanded, setBrowserExpanded] = React.useState({
    docSettings: false,
    namedViews: false,
    origin: false,
    sketches: true,
    bodies: true,
  });
  const toggleBrowser = (key: keyof typeof browserExpanded) =>
    setBrowserExpanded(s => ({ ...s, [key]: !s[key] }));

  const folderStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 6px', borderRadius: 4, cursor: 'pointer',
    userSelect: 'none', transition: 'background 0.12s'
  };
  const arrowStyle: React.CSSProperties = {
    fontSize: 10, color: theme.textMuted, display: 'inline-block', width: 14, textAlign: 'center', transition: 'transform 0.15s'
  };

  const effectiveWidth = collapsed ? RAIL_WIDTH : (layoutWidth ?? (isTablet ? 240 : 260));
  const hiddenOnDevice = isMobile ? true : (isTablet && !tabletLeftOpen);
  const borderKey = side === 'right' ? 'borderLeft' : 'borderRight';
  const overlayStyle: React.CSSProperties = overlay
    ? {
        position: 'absolute' as const, top: 44, bottom: 0, zIndex: 55,
        [side === 'right' ? 'right' : 'left']: 0,
        boxShadow: side === 'right' ? '-4px 0 20px rgba(0,0,0,0.35)' : '4px 0 20px rgba(0,0,0,0.35)',
      }
    : {};
  const tabletOverlay: React.CSSProperties = isTablet
    ? { position: 'absolute' as const, top: 44, left: 0, bottom: 0, zIndex: 50, boxShadow: '4px 0 20px rgba(0,0,0,0.3)' }
    : {};

  if (collapsed) {
    return (
      <div style={{
        width: RAIL_WIDTH, flexShrink: 0, background: theme.panelBg,
        [borderKey]: `1px solid ${theme.border}`,
        display: hiddenOnDevice ? 'none' : 'flex',
        flexDirection: 'column', alignItems: 'center',
        padding: '8px 0', gap: 6, position: 'relative',
        ...overlayStyle,
      }}>
        <button
          onClick={onToggleCollapse}
          aria-label="Expand panel"
          title="Expand (펼치기)"
          style={{
            width: 32, height: 32, borderRadius: 6, border: `1px solid ${theme.border}`,
            background: theme.cardBg, color: theme.text, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14,
          }}
        >{side === 'right' ? '◀' : '▶'}</button>
        <div style={{ fontSize: 10, color: theme.textMuted, writingMode: 'vertical-rl' as const, marginTop: 4 }}>
          {activeTab === 'design' ? tt.designTree : 'Optimize'}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: effectiveWidth,
      flexShrink: 0,
      background: theme.panelBg,
      [borderKey]: `1px solid ${theme.border}`,
      display: hiddenOnDevice ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      ...(isTablet ? tabletOverlay : overlayStyle),
    }}>
      {onResize && !isTablet && !isMobile && (
        <SidebarResizer
          edge={side === 'right' ? 'left' : 'right'}
          width={effectiveWidth}
          onResize={onResize}
        />
      )}
      {onToggleCollapse && !isTablet && !isMobile && (
        <button
          onClick={onToggleCollapse}
          aria-label="Collapse panel"
          title="Collapse (접기)"
          style={{
            position: 'absolute', top: 4,
            [side === 'right' ? 'left' : 'right']: 4,
            width: 22, height: 22, borderRadius: 4, border: 'none',
            background: 'transparent', color: theme.textMuted, cursor: 'pointer',
            fontSize: 12, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >{side === 'right' ? '▶' : '◀'}</button>
      )}
      <div className="nf-scroll" style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>

        {activeTab === 'design' ? (
          <>
            {/* ── FeatureManager Design Tree ── */}
            {!isSketchMode && (
              <div data-tour="feature-tree" style={{ padding: '0 4px' }}>
                <LeftPanelSectionHeader
                  label={`${tt.browser} · ${tt.designTree}`}
                  sectionKey="tree"
                  sections={sections}
                  onToggleSection={toggleSection}
                  theme={theme}
                  extra={
                    <button
                      data-tour="sketch-btn"
                      onClick={e => { e.stopPropagation(); onSketchModeStart(); }}
                      title={tt.newSketch}
                      style={{
                        padding: '2px 6px', borderRadius: 4, border: `1px solid ${theme.border}`,
                        background: theme.inputBg, color: theme.textMuted, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      ✏️
                    </button>
                  }
                />
                {sections.tree && (
                  <>
                    {/* Base shape header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4, background: theme.hoverBg, border: 'none', marginBottom: 6 }}>
                      <span style={{ fontSize: 13 }}>{SHAPE_ICONS[selectedId] || '🧊'}</span>
                      <span
                        style={{ fontSize: 12, fontWeight: 600, color: theme.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                        title={t[`shapeName_${selectedId}`] || selectedId}
                      >{t[`shapeName_${selectedId}`] || selectedId}</span>
                      <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: 'monospace' }}>{effectiveResult ? `${effectiveResult.bbox.w.toFixed(0)}×${effectiveResult.bbox.h.toFixed(0)}×${effectiveResult.bbox.d.toFixed(0)}` : ''}</span>
                    </div>
                    {/* Fusion 360-style Foldered Browser */}
                    <div style={{ marginLeft: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      
                      {/* Document Settings */}
                      <div>
                        <div onClick={() => toggleBrowser('docSettings')} style={folderStyle} onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span style={{ transform: browserExpanded.docSettings ? 'rotate(90deg)' : 'rotate(0deg)', ...arrowStyle }}>▶</span>
                          <span style={{ fontSize: 13 }}>⚙️</span>
                          <span style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>Document Settings</span>
                        </div>
                        {browserExpanded.docSettings && (
                          <div style={{ marginLeft: 26, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12 }}>📐</span>
                            <span style={{ fontSize: 11, color: theme.textMuted }}>Units: {unitSystem?.toLowerCase() || 'mm'}</span>
                          </div>
                        )}
                      </div>

                      {/* Named Views */}
                      <div>
                        <div onClick={() => toggleBrowser('namedViews')} style={folderStyle} onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span style={{ transform: browserExpanded.namedViews ? 'rotate(90deg)' : 'rotate(0deg)', ...arrowStyle }}>▶</span>
                          <span style={{ fontSize: 13 }}>👁️</span>
                          <span style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>Named Views</span>
                        </div>
                        {browserExpanded.namedViews && ['Top', 'Front', 'Right', 'Home'].map(view => (
                          <div key={view} style={{ marginLeft: 26, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <span style={{ fontSize: 12, opacity: 0.7 }}>🧊</span>
                            <span style={{ fontSize: 11, color: theme.textMuted }}>{view}</span>
                          </div>
                        ))}
                      </div>

                      {/* Origin */}
                      <div>
                        <div onClick={() => toggleBrowser('origin')} style={folderStyle} onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span style={{ transform: browserExpanded.origin ? 'rotate(90deg)' : 'rotate(0deg)', ...arrowStyle }}>▶</span>
                          <span style={{ fontSize: 13 }}>🎯</span>
                          <span style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>Origin</span>
                        </div>
                      </div>

                      {/* Sketches */}
                      <div>
                        <div onClick={() => toggleBrowser('sketches')} style={folderStyle} onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span style={{ transform: browserExpanded.sketches ? 'rotate(90deg)' : 'rotate(0deg)', ...arrowStyle }}>▶</span>
                          <span style={{ fontSize: 13 }}>✏️</span>
                          <span style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>Sketches</span>
                        </div>
                        {browserExpanded.sketches && features.filter(f => f.type === 'sketch').map(sk => (
                          <div key={sk.id} onClick={() => onEditSketchFeature(sk.id)} style={{ marginLeft: 26, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', borderRadius: 4 }} onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <span style={{ fontSize: 12, color: theme.accent }}>✏️</span>
                            <span style={{ fontSize: 11, color: theme.text }}>{sk.params.name || sk.id}</span>
                          </div>
                        ))}
                        {browserExpanded.sketches && features.filter(f => f.type === 'sketch').length === 0 && (
                          <div style={{ marginLeft: 26, padding: '4px 6px', fontSize: 11, color: theme.textMuted, fontStyle: 'italic' }}>No sketches</div>
                        )}
                      </div>

                      {/* Bodies */}
                      <div>
                        <div onClick={() => toggleBrowser('bodies')} style={folderStyle} onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span style={{ transform: browserExpanded.bodies ? 'rotate(90deg)' : 'rotate(0deg)', ...arrowStyle }}>▶</span>
                          <span style={{ fontSize: 13 }}>🧊</span>
                          <span style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>Bodies</span>
                        </div>
                        {browserExpanded.bodies && bomParts.map((bp, bi) => (
                          <div key={`${bp.name}-${bi}`} style={{ marginLeft: 26, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 4, cursor: 'default' }} onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <span style={{ fontSize: 12, color: theme.accent }}>🧊</span>
                            <span style={{ fontSize: 11, color: theme.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bp.name}</span>
                            {bp.color && <span style={{ fontSize: 9, padding: '1px 4px', background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: 3, color: theme.textMuted }}>{bp.color}</span>}
                          </div>
                        ))}
                        {browserExpanded.bodies && bomParts.length === 0 && (
                          <div style={{ marginLeft: 26, padding: '4px 6px', fontSize: 11, color: theme.textMuted, fontStyle: 'italic' }}>No bodies</div>
                        )}
                      </div>

                    </div>
                  </>
                )}
              </div>
            )}

            {!isSketchMode && onConfigurationAdd && (
              <div style={{ padding: '8px 4px 0', borderTop: `1px solid ${theme.border}` }}>
                <LeftPanelSectionHeader
                  label={tt.configuration}
                  sectionKey="config"
                  sections={sections}
                  onToggleSection={toggleSection}
                  theme={theme}
                />
                {sections.config && (
                  <>
                    <p style={{ fontSize: 11, color: theme.textMuted, margin: '0 0 8px', lineHeight: 1.45 }}>{tt.configHint}</p>
                    <select
                      value={activeConfigurationId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        onConfigurationSelect?.(v === '' ? null : v);
                      }}
                      aria-label={tt.configuration}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        marginBottom: 8,
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.inputBg,
                        color: theme.text,
                        fontSize: 12,
                        outline: 'none',
                      }}
                    >
                      <option value="">{tt.configWorking}</option>
                      {(configurationsList ?? []).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {activeConfigurationId && onConfigurationRename && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={e => setRenameDraft(e.target.value)}
                          placeholder={tt.configNamePlaceholder}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: '1px solid #30363d',
                            background: '#0d1117',
                            color: '#c9d1d9',
                            fontSize: 11,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => onConfigurationRename(activeConfigurationId, renameDraft)}
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: '1px solid #30363d',
                            background: '#21262d',
                            color: '#8b949e',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {tt.configRenameSave}
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                      <input
                        type="text"
                        value={newVariantName}
                        onChange={e => setNewVariantName(e.target.value)}
                        placeholder={tt.configNamePlaceholder}
                        style={{
                          flex: '1 1 120px',
                          minWidth: 0,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1px solid #30363d',
                          background: '#0d1117',
                          color: '#c9d1d9',
                          fontSize: 11,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          onConfigurationAdd(newVariantName.trim() || `Variant ${(configurationsList?.length ?? 0) + 1}`);
                        }}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 6,
                          border: '1px solid #30363d',
                          background: '#21262d',
                          color: '#58a6ff',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {tt.configAdd}
                      </button>
                      {activeConfigurationId && onConfigurationDelete && (
                        <button
                          type="button"
                          onClick={() => onConfigurationDelete(activeConfigurationId)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: '1px solid #f85149',
                            background: 'transparent',
                            color: '#f85149',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {tt.configDelete}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── PropertyManager ── */}
            <div style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
              <LeftPanelSectionHeader
                label={isSketchMode ? tt.sketch : tt.properties}
                sectionKey="props"
                sections={sections}
                onToggleSection={toggleSection}
                theme={theme}
              />

              {sections.props && (
                isSketchMode ? (
                  <>
                    {/* 2D / 3D / Drawing mode toggle */}
                    <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                      {([['2d', '2D'], ['3d', '3D'], ['drawing', (t as any).drawingView || '2D Drawing']] as const).map(([mode, label]) => (
                        <button key={mode} onClick={() => onSketchViewModeChange(mode)}
                          style={{
                            flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                            border: sketchViewMode === mode ? '2px solid #388bfd' : '1px solid #30363d',
                            background: sketchViewMode === mode ? '#388bfd22' : '#0d1117',
                            color: sketchViewMode === mode ? '#388bfd' : '#8b949e',
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {sketchSliceLinked && sketchViewMode === '2d' && (
                      <div style={{
                        marginBottom: 8,
                        padding: '5px 8px',
                        borderRadius: 6,
                        background: 'rgba(234,88,12,0.12)',
                        border: '1px solid rgba(234,88,12,0.35)',
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#fb923c',
                        textAlign: 'center',
                      }}>
                        {tt.sliceLinkedBadge}
                      </div>
                    )}

                    <div style={{ position: 'relative' }}>
                      {showSketchHistory && (
                        <SketchHistoryPanel
                          entries={sketchHistory}
                          onLoad={onLoadSketchFromHistory}
                          onDelete={onDeleteSketchHistoryEntry}
                          onClose={() => onToggleSketchHistory()}
                          t={t as any}
                        />
                      )}
                      <div data-tour="sketch-toolbox" style={{ display: 'contents' }}>
                      <SketchPanel
                        profile={sketchProfile} config={sketchConfig}
                        onConfigChange={setSketchConfig} activeTool={sketchTool}
                        onToolChange={setSketchTool} onClear={onSketchClear}
                        onUndo={onSketchUndo} onGenerate={onSketchGenerate}
                        canGenerate={sketchProfiles[0]?.closed && sketchProfiles[0]?.segments.length >= 3}
                        sketchStep={sketchStep}
                        onSketchStepChange={onSketchStepChange}
                        t={t as any}
                        multiSketch={{ profiles: sketchProfiles, activeProfileIndex: activeProfileIdx }}
                        onSetActiveProfile={onSetActiveProfile}
                        onAddHoleProfile={onAddHoleProfile}
                        onDeleteProfile={onDeleteProfile}
                        sketchPlane={sketchPlane as 'xy' | 'xz' | 'yz'}
                        onSketchPlaneChange={onSketchPlaneChange}
                        sketchPlaneOffset={sketchPlaneOffset}
                        onSketchPlaneOffsetChange={onSketchPlaneOffsetChange}
                        sketchOperation={sketchOperation}
                        onSketchOperationChange={onSketchOperationChange}
                        onAddSketchFeature={onAddSketchFeature}
                        showSketchHistory={showSketchHistory}
                        onToggleSketchHistory={sketchHistory.length >= 2 ? onToggleSketchHistory : undefined}
                        editingFeatureId={editingSketchFeatureId}
                        constraints={constraints}
                        dimensions={dimensions}
                        onAddConstraint={onAddConstraint}
                        onRemoveConstraint={onRemoveConstraint}
                        onDimensionChange={onDimensionChange}
                        onRemoveDimension={onRemoveDimension}
                        selectedConstraintType={selectedConstraintType}
                        onConstraintTypeChange={onConstraintTypeChange}
                        autoSolve={autoSolve}
                        onAutoSolveChange={onAutoSolveChange}
                        onSolveConstraints={onSolveConstraints}
                        constraintStatus={constraintStatus}
                        constraintDiagnostic={constraintDiagnostic}
                        isKo={lang === 'ko'}
                      />
                      </div>{/* /sketch-toolbox */}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Shape selector — search + favorites + recent + grid */}
                    <div data-tour="shape-selector">
                      {/* Search bar */}
                      <div style={{ position: 'relative', marginBottom: 6 }}>
                        <svg style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input
                          type="text"
                          value={shapeSearch}
                          onChange={e => setShapeSearch(e.target.value)}
                          placeholder={tt.searchShapes}
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
                            color: '#c9d1d9', fontSize: 11, padding: '5px 8px 5px 22px',
                            outline: 'none',
                          }}
                        />
                        {shapeSearch && (
                          <button onClick={() => setShapeSearch('')} style={{
                            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                            background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0,
                          }}>✕</button>
                        )}
                      </div>

                      {/* Favorites row */}
                      {!shapeSearch && shapeFavorites.length > 0 && (
                        <div style={{ marginBottom: 5 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                            {tt.favorites}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
                            {shapeFavorites.map(id => {
                              const s = [...tier1, ...tier2].find(x => x.id === id);
                              if (!s) return null;
                              const active = s.id === selectedId;
                              return (
                                <button key={s.id}
                                  onClick={() => { onSelectShape(s); trackRecentShape(s.id); }}
                                  title={t[`shapeName_${s.id}`] || s.id}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '5px 0', borderRadius: 6, fontSize: 16,
                                    border: active ? '2px solid #f59e0b' : '1px solid #78350f44',
                                    background: active ? '#f59e0b22' : '#0d1117',
                                    cursor: 'pointer', transition: 'all 0.12s',
                                  }}
                                >{SHAPE_ICONS[s.id] || s.icon}</button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Recent row */}
                      {!shapeSearch && recentShapes.length > 0 && (
                        <div style={{ marginBottom: 5 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                            {tt.recent}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
                            {recentShapes.map(id => {
                              const s = [...tier1, ...tier2].find(x => x.id === id);
                              if (!s) return null;
                              const active = s.id === selectedId;
                              return (
                                <button key={s.id}
                                  onClick={() => { onSelectShape(s); trackRecentShape(s.id); }}
                                  title={t[`shapeName_${s.id}`] || s.id}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '5px 0', borderRadius: 6, fontSize: 16,
                                    border: active ? '2px solid #388bfd' : '1px solid #30363d',
                                    background: active ? '#388bfd22' : '#0d1117',
                                    cursor: 'pointer', transition: 'all 0.12s',
                                  }}
                                >{SHAPE_ICONS[s.id] || s.icon}</button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* All shapes grid (filtered by search) */}
                      {(() => {
                        const allShapes = [...tier1, ...tier2];
                        const filtered = shapeSearch
                          ? allShapes.filter(s =>
                              (t[`shapeName_${s.id}`] || s.id).toLowerCase().includes(shapeSearch.toLowerCase()) ||
                              s.id.toLowerCase().includes(shapeSearch.toLowerCase())
                            )
                          : allShapes;
                        return (
                          <div style={{ marginBottom: 4 }}>
                            {!shapeSearch && (
                              <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                                {tt.all}
                              </div>
                            )}
                            {filtered.length === 0 ? (
                              <div style={{ fontSize: 11, color: '#484f58', textAlign: 'center', padding: '8px 0' }}>
                                {tt.noResults}
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
                                {filtered.map(s => {
                                  const active = s.id === selectedId;
                                  const isFav = shapeFavorites.includes(s.id);
                                  return (
                                    <div key={s.id} style={{ position: 'relative' }}>
                                      <button
                                        type="button"
                                        data-testid={s.id === 'box' ? 'm4-pick-box' : undefined}
                                        onClick={() => { onSelectShape(s); trackRecentShape(s.id); }}
                                        title={t[`shapeName_${s.id}`] || s.id}
                                        style={{
                                          width: '100%',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          padding: '5px 0', borderRadius: 6, fontSize: 16,
                                          border: active ? '2px solid #388bfd' : '1px solid #30363d',
                                          background: active ? '#388bfd22' : '#0d1117',
                                          cursor: 'pointer', transition: 'all 0.12s',
                                        }}
                                      >{SHAPE_ICONS[s.id] || s.icon}</button>
                                      {/* Star button */}
                                      <button
                                        onClick={e => { e.stopPropagation(); toggleFavorite(s.id); }}
                                        title={isFav ? tt.removeFavorite : tt.addFavorite}
                                        style={{
                                          position: 'absolute', top: 1, right: 1,
                                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                          fontSize: 8, lineHeight: 1, opacity: isFav ? 1 : 0,
                                          color: isFav ? '#f59e0b' : '#6b7280',
                                          transition: 'opacity 0.15s',
                                        }}
                                        className="shape-star-btn"
                                      >★</button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* ── Material — inline under shape selector ── */}
                    {effectiveResult ? (
                      <div data-tour="material-picker" style={{ borderTop: '1px solid #30363d', paddingTop: 6, marginBottom: 6 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                          {tt.material}
                        </div>
                        <MaterialPicker selectedId={materialId} onSelect={setMaterialId} lang={lang} />
                      </div>
                    ) : (
                      <div style={{ borderTop: '1px solid #21262d', paddingTop: 6, marginBottom: 6, fontSize: 10, color: '#484f58', textAlign: 'center', fontStyle: 'italic' }}>
                        {tt.materialHint}
                      </div>
                    )}

                    {/* COTS 표준 사이즈 프리셋 (hexNut / washer / bearing) */}
                    <CotsSizePreset
                      shapeId={selectedId}
                      isKo={lang === 'ko'}
                      onSelect={(preset) => {
                        Object.entries(preset).forEach(([key, val]) => onParamChange(key, val));
                      }}
                    />

                    {/* Parameters — compact single-row: label | slider | number | fx */}
                    <div data-tour="param-panel">
                      {shape.params.map(sp => {
                        const label = t[sp.labelKey] || sp.key;
                        const val = params[sp.key] ?? sp.default;
                        const isFx = formulaMode.has(sp.key);
                        const expr = paramExpressions[sp.key] ?? String(val);
                        const allVars: ExprVariable[] = [
                          ...Object.entries(params)
                            .filter(([k]) => k !== sp.key)
                            .map(([name, value]) => ({ name, value })),
                          ...(modelVars ?? []),
                        ];

                        const dfmWarn = dfmParamWarnings?.[sp.key];
                        const warnColor = dfmWarn?.severity === 'error' ? '#f85149'
                          : dfmWarn?.severity === 'warning' ? '#d29922'
                          : dfmWarn?.severity === 'info' ? '#79c0ff'
                          : undefined;

                        return (
                          <div key={sp.key} style={{ marginBottom: 3 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 40px 20px', alignItems: 'center', gap: 4 }}>
                              <label
                                style={{ fontSize: 10, fontWeight: 600, color: warnColor ?? '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                title={dfmWarn ? `DFM: ${dfmWarn.message}` : label}
                              >
                                {dfmWarn && (
                                  <span style={{ marginRight: 2, fontSize: 9 }}>
                                    {dfmWarn.severity === 'error' ? '🔴' : dfmWarn.severity === 'warning' ? '🟡' : '🔵'}
                                  </span>
                                )}
                                {label}
                              </label>
                              {isFx ? (
                                <ExpressionInput
                                  expression={expr}
                                  variables={allVars}
                                  onValueChange={(v) => onParamChange(sp.key, v)}
                                  onExpressionChange={(e) => onExpressionChange(sp.key, e)}
                                  onCommit={onParamCommit}
                                  min={sp.min} max={sp.max} step={sp.step}
                                  unit={sp.unit ?? ''}
                                  unitSystem={unitSystem}
                                  expressionLabel={label}
                                />
                              ) : (
                                <>
                                  <input
                                    type="range"
                                    min={sp.min} max={sp.max} step={sp.step}
                                    value={val}
                                    data-testid={shape.id === 'box' && sp.key === 'width' ? 'm4-box-width-range' : undefined}
                                    onChange={e => onParamChange(sp.key, parseFloat(e.target.value))}
                                    onTouchEnd={onParamCommit}
                                    onMouseDown={e => { e.currentTarget.style.accentColor = '#818cf8'; e.currentTarget.style.height = isMobile ? '8px' : '5px'; }}
                                    onMouseUp={e => { e.currentTarget.style.accentColor = '#6366f1'; e.currentTarget.style.height = isMobile ? '6px' : '3px'; onParamCommit(); }}
                                    onMouseLeave={e => { if (e.buttons === 0) { e.currentTarget.style.accentColor = '#6366f1'; e.currentTarget.style.height = isMobile ? '6px' : '3px'; } }}
                                    style={{ width: '100%', accentColor: '#6366f1', height: isMobile ? 6 : 3, borderRadius: 3, cursor: 'pointer', transition: 'height 0.1s' }}
                                  />
                                  {isMobile ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <button
                                        onClick={() => { const nv = Math.max(sp.min, val - sp.step); onParamChange(sp.key, nv); onParamCommit(); }}
                                        aria-label="Decrease"
                                        style={{
                                          minWidth: 36, minHeight: 36, padding: 0,
                                          borderRadius: 6, border: '1px solid #30363d',
                                          background: '#21262d', color: '#c9d1d9',
                                          fontSize: 18, fontWeight: 700, cursor: 'pointer',
                                          touchAction: 'manipulation',
                                        }}
                                      >−</button>
                                    <input
                                      type="number"
                                      value={val}
                                      step={sp.step}
                                      inputMode="decimal"
                                      data-testid={shape.id === 'box' && sp.key === 'width' ? 'm4-box-width-number' : undefined}
                                      onChange={e => onParamChange(sp.key, parseFloat(e.target.value))}
                                      onBlur={onParamCommit}
                                      style={{
                                        flex: 1, minWidth: 60, minHeight: 36, padding: '6px 8px',
                                        borderRadius: 6, border: '1px solid #30363d',
                                        background: '#0d1117', color: '#c9d1d9',
                                        fontSize: 14, textAlign: 'center', fontFamily: 'monospace',
                                      }}
                                    />
                                      <button
                                        onClick={() => { const nv = Math.min(sp.max, val + sp.step); onParamChange(sp.key, nv); onParamCommit(); }}
                                        aria-label="Increase"
                                        style={{
                                          minWidth: 36, minHeight: 36, padding: 0,
                                          borderRadius: 6, border: '1px solid #30363d',
                                          background: '#21262d', color: '#c9d1d9',
                                          fontSize: 18, fontWeight: 700, cursor: 'pointer',
                                          touchAction: 'manipulation',
                                        }}
                                      >+</button>
                                    </div>
                                  ) : (
                                    <input
                                      type="number"
                                      value={val}
                                      step={sp.step}
                                      data-testid={shape.id === 'box' && sp.key === 'width' ? 'm4-box-width-number' : undefined}
                                      onChange={e => onParamChange(sp.key, parseFloat(e.target.value))}
                                      onBlur={onParamCommit}
                                      style={{
                                        width: 40, padding: '1px 4px', borderRadius: 3,
                                        border: '1px solid #30363d', background: '#0d1117',
                                        color: '#c9d1d9', fontSize: 10, textAlign: 'right',
                                        fontFamily: 'monospace',
                                      }}
                                    />
                                  )}
                                </>
                              )}
                              {/* fx toggle */}
                              <button
                                title={isFx ? tt.formulaExit : tt.formulaEnter}
                                aria-label={isFx ? 'Exit formula mode' : 'Enter formula mode'}
                                onClick={() => setFormulaMode(prev => {
                                  const next = new Set(prev);
                                  if (next.has(sp.key)) next.delete(sp.key); else next.add(sp.key);
                                  return next;
                                })}
                                style={{
                                  padding: '0 3px', height: 18, minWidth: 20,
                                  borderRadius: 3,
                                  border: isFx ? '1px solid rgba(99,102,241,0.5)' : '1px solid transparent',
                                  background: isFx ? 'rgba(99,102,241,0.3)' : 'transparent',
                                  color: isFx ? '#818cf8' : '#6e7681',
                                  fontSize: 9, fontWeight: 800, cursor: 'pointer',
                                  lineHeight: 1, fontFamily: 'monospace',
                                  transition: 'all 0.12s',
                                }}
                                onMouseEnter={e => { if (!isFx) { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.borderColor = '#30363d'; } }}
                                onMouseLeave={e => { if (!isFx) { e.currentTarget.style.color = '#6e7681'; e.currentTarget.style.borderColor = 'transparent'; } }}
                              >
                                fx
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* ── Formula fields (text input for function-driven shapes) ── */}
                      {shape.formulaFields && shape.formulaFields.length > 0 && (
                        <div style={{ marginTop: 6, borderTop: '1px solid #21262d', paddingTop: 6 }}>
                          {shape.formulaFields.map(ff => {
                            const label = t[ff.labelKey] || ff.key;
                            const currentVal = formulaValues?.[ff.key] ?? ff.default;
                            return (
                              <div key={ff.key} style={{ marginBottom: 6 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', marginBottom: 3, fontFamily: 'monospace' }}>
                                  ∿ {label}
                                </div>
                                <textarea
                                  value={currentVal}
                                  onChange={e => onFormulaChange?.(ff.key, e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onParamCommit(); } }}
                                  placeholder={ff.placeholder ?? ff.default}
                                  spellCheck={false}
                                  rows={2}
                                  style={{
                                    width: '100%',
                                    padding: '5px 7px',
                                    borderRadius: 5,
                                    border: '1px solid #3b4048',
                                    background: '#0d1117',
                                    color: '#79c0ff',
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    lineHeight: 1.4,
                                    resize: 'vertical',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                  }}
                                />
                                {ff.hint && (
                                  <div style={{ fontSize: 9, color: '#484f58', marginTop: 2, lineHeight: 1.4 }}>
                                    {ff.hint}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <button
                        onClick={onShapeReset}
                        style={{ width: '100%', padding: '4px', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#8b949e', fontSize: 10, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}
                      >
                        {t.resetParams}
                      </button>

                      {/* 단면 물성 패널 */}
                      <div style={{ marginTop: 8, borderTop: '1px solid #21262d', paddingTop: 6 }}>
                        <SectionPropertiesPanel
                          shapeId={selectedId}
                          params={params}
                          isKo={lang === 'ko'}
                        />
                      </div>
                    </div>
                  </>
                )
              )}
            </div>


            {/* ── Render Settings Panel ── */}
            {renderMode === 'photorealistic' && (
              <RenderPanel
                settings={renderSettings}
                onChange={onRenderSettingsChange}
                onCapture={onRenderCapture}
                onHighResCapture={onHighResCapture}
                lang={lang}
              />
            )}

            {/* ── Geometry info ── */}
            {effectiveResult && (
              <div style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
                <LeftPanelSectionHeader
                  label={tt.geometry}
                  sectionKey="geometry"
                  sections={sections}
                  onToggleSection={toggleSection}
                  theme={theme}
                />
                {sections.geometry && (
                  <div style={{ fontSize: 10, color: '#c9d1d9', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span><span style={{ color: '#9ca3af' }}>Vol </span><b>{effectiveResult.volume_cm3.toFixed(2)}</b> cm³</span>
                      <span><span style={{ color: '#9ca3af' }}>Surf </span><b>{effectiveResult.surface_area_cm2.toFixed(2)}</b> cm²</span>
                    </div>
                    <div><span style={{ color: '#9ca3af' }}>Size </span><b style={{ color: '#58a6ff' }}>{effectiveResult.bbox.w.toFixed(1)}×{effectiveResult.bbox.h.toFixed(1)}×{effectiveResult.bbox.d.toFixed(1)} mm</b></div>
                  </div>
                )}
              </div>
            )}

            {/* ── Export BOM — only show when cart has items ── */}
            {(bomParts.length > 0 || cartItemsCount > 0) && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={onToggleBomExportMenu}
                  aria-expanded={showBomExportMenu}
                  aria-haspopup="true"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #30363d', background: '#21262d', color: '#c9d1d9', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.background = '#30363d'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.background = '#21262d'; }}
                >
                  <span style={{ fontSize: 13 }}>📋</span>
                  {(t as any).exportBom || 'Export BOM'}
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: '#6e7681' }}>{showBomExportMenu ? '▲' : '▼'}</span>
                </button>
                {showBomExportMenu && (
                  // #7: Escape to close + role=menu for keyboard nav
                  <div
                    role="menu"
                    onKeyDown={e => { if (e.key === 'Escape') onToggleBomExportMenu(); }}
                    style={{ display: 'flex', gap: 6, marginTop: 4 }}
                  >
                    <button
                      role="menuitem"
                      onClick={onExportBomCSV}
                      autoFocus
                      style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#3fb950', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s' }}
                      onKeyDown={e => { if (e.key === 'Escape') onToggleBomExportMenu(); }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#0d2818'; e.currentTarget.style.borderColor = '#3fb950'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#0d1117'; e.currentTarget.style.borderColor = '#30363d'; }}
                    >CSV</button>
                    <button
                      role="menuitem"
                      onClick={onExportBomExcel}
                      style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid #30363d', background: '#0d1117', color: '#58a6ff', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s' }}
                      onKeyDown={e => { if (e.key === 'Escape') onToggleBomExportMenu(); }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a2332'; e.currentTarget.style.borderColor = '#58a6ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#0d1117'; e.currentTarget.style.borderColor = '#30363d'; }}
                    >Excel</button>
                  </div>
                )}
              </div>
            )}

            {/* ── Imported file info ── */}
            {importedFilename && (
              <div style={{ background: '#0d1117', borderRadius: 8, border: '1px solid #1f6feb', padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  {tt.imported}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#79c0ff' }}>{importedFilename}</div>
              </div>
            )}
          </>
        ) : (
          /* ── OPTIMIZE TAB LEFT ── */
          <>
            {customDomainGeometry && (
              <div style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Domain</div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[['Box', false], ['Custom', true]].map(([label, val]) => (
                    <button key={String(label)} onClick={() => onUseCustomDomainChange(val as boolean)} style={{
                      flex: 1, padding: '5px', borderRadius: 6, border: useCustomDomain === val ? '2px solid #388bfd' : '1px solid #30363d',
                      background: useCustomDomain === val ? '#388bfd22' : '#0d1117', fontSize: 11, fontWeight: 700,
                      color: useCustomDomain === val ? '#388bfd' : '#8b949e', cursor: 'pointer',
                    }}>{label as string}</button>
                  ))}
                </div>
              </div>
            )}
            <ConditionPanel
              dimX={dimX} dimY={dimY} dimZ={dimZ} onDimChange={onDimChange}
              materialKey={materialKey} onMaterialChange={onMaterialKeyChange}
              fixedFaces={fixedFaces} loads={loads}
              selectionMode={selectionMode} onSelectionModeChange={onSelectionModeChange}
              onRemoveFixed={onRemoveFixed} onRemoveLoad={onRemoveLoad}
              activeLoadForce={activeLoadForce} onActiveLoadForceChange={onActiveLoadForceChange}
              volfrac={volfrac} onVolfracChange={onVolfracChange}
              resolution={resolution} onResolutionChange={onResolutionChange}
              penal={penal} onPenalChange={onPenalChange}
              rmin={rmin} onRminChange={onRminChange}
              maxIter={maxIter} onMaxIterChange={onMaxIterChange}
              isOptimizing={isOptimizing} onGenerate={onGenerate} onReset={onOptReset}
              t={gt}
            />
            {optResult && !isOptimizing && (
              <div style={{ background: '#21262d', borderRadius: 8, border: '1px solid #30363d', padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Results</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, marginBottom: 8 }}>
                  <div><span style={{ color: '#9ca3af' }}>Iter:</span> <b>{optResult.iterations}</b></div>
                  <div><span style={{ color: '#9ca3af' }}>Vol:</span> <b>{(optResult.finalVolumeFraction * 100).toFixed(1)}%</b></div>
                </div>
                {weightInfo && (
                  <div style={{ background: '#0d1117', borderRadius: 6, padding: 8, fontSize: 11, border: '1px solid #30363d', color: '#c9d1d9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b949e' }}>Original</span><b>{weightInfo.originalWeight.toFixed(3)} kg</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b949e' }}>Optimized</span><b>{weightInfo.optimizedWeight.toFixed(3)} kg</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#3fb950', fontWeight: 800, borderTop: '1px solid #30363d', paddingTop: 4, marginTop: 4 }}><span>Reduction</span><span>-{weightInfo.reduction.toFixed(1)}%</span></div>
                  </div>
                )}
                {convergenceChart && <div style={{ marginTop: 8 }}>{convergenceChart}</div>}
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  <button onClick={onExportOptSTL} disabled={!resultMesh} style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1px solid #388bfd', background: '#0d1117', color: '#58a6ff', fontSize: 11, fontWeight: 700, cursor: resultMesh ? 'pointer' : 'default' }}>Export STL</button>
                  <button onClick={onSendOptToQuote} style={{ flex: 1, padding: '7px', borderRadius: 6, border: 'none', background: '#388bfd', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Quote</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default React.memo(LeftPanel);
