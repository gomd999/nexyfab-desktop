// Curated command palette actions — toggles the most-used panels via uiStore.
// Pulled from the panel list in uiStore.ts. Handlers that require scene state
// (generate, extrude, etc.) are intentionally omitted here — register those
// inline in page.tsx if needed.

import type { Command } from './CommandPalette';

type TogglePanel = (key: string) => void;

export function buildPanelCommands(togglePanel: TogglePanel): Command[] {
  const mk = (
    id: string,
    key: string,
    label: string,
    labelKo: string,
    category: string,
    icon: string,
    shortcut?: string,
  ): Command => ({
    id, label, labelKo, category, shortcut, icon,
    action: () => togglePanel(key),
  });

  return [
    // View
    mk('toggle-planes',    'showPlanes',        'Toggle Reference Planes', '참조 평면 표시',   'View',     '📐'),
    mk('toggle-perf',      'showPerf',          'Toggle Performance HUD',  '성능 HUD',         'View',     '📊'),
    mk('toggle-multiview', 'multiView',         'Toggle Multi-View',       '멀티뷰',           'View',     '⊞'),
    mk('toggle-shortcuts', 'showShortcuts',     'Keyboard Shortcuts Help', '단축키 도움말',     'View',     '⌨️', '?'),

    // Analysis
    mk('toggle-dfm',          'showDFM',              'DFM Analysis',          'DFM 분석',         'Analysis', '🔍'),
    mk('toggle-fea',          'showFEA',              'FEA Panel',             'FEA 패널',         'Analysis', '🧮'),
    mk('toggle-draft',        'showDraftAnalysis',    'Draft Analysis',        '드래프트 분석',     'Analysis', '📐'),
    mk('toggle-mass',         'showMassProps',        'Mass Properties',       '질량 특성',         'Analysis', '⚖️'),
    mk('toggle-print',        'showPrintAnalysis',    '3D Print Analysis',     '3D 프린트 분석',    'Analysis', '🖨️'),
    mk('toggle-costpanel',    'showCostPanel',        'Cost Estimator',        '비용 추정',         'Analysis', '💰'),
    mk('toggle-toleranceStk', 'showToleranceStackup', 'Tolerance Stackup',     '공차 누적',         'Analysis', '📏'),
    mk('toggle-surfaceQual',  'showSurfaceQuality',   'Surface Quality',       '표면 품질',         'Analysis', '🪞'),
    mk('toggle-thermal',      'showThermalPanel',     'Thermal Analysis',      '열 해석',           'Analysis', '🔥'),
    mk('toggle-motion',       'showMotionStudy',      'Motion Study',          '모션 스터디',       'Analysis', '🎬'),
    mk('toggle-modal',        'showModalAnalysis',    'Modal Analysis',        '모달 해석',         'Analysis', '🌊'),
    mk('toggle-sweep',        'showParametricSweep',  'Parametric Sweep',      '파라메트릭 스윕',    'Analysis', '📈'),
    mk('toggle-drawing',      'showAutoDrawing',      'Auto 2D Drawing',       '자동 도면',         'Analysis', '📑'),
    mk('toggle-mfgpipe',      'showMfgPipeline',      'Manufacturing Pipeline','제조 파이프라인',    'Analysis', '🏭'),

    // Features / Tools
    mk('toggle-hole',       'showHoleWizard',      'Hole Wizard',       '홀 마법사',       'Features', '🕳️'),
    mk('toggle-sheetmetal', 'showSheetMetalPanel', 'Sheet Metal Panel', '판금 패널',        'Features', '🔨'),
    mk('toggle-assembly',   'showAssemblyPanel',   'Assembly Panel',    '조립 패널',        'Features', '🧩'),
    mk('toggle-array',      'showArrayPanel',      'Instance Array',    '인스턴스 배열',     'Features', '▦'),
    mk('toggle-gendesign',  'showGenDesign',       'Generative Design', '제너러티브 설계',   'Features', '🧬'),
    mk('toggle-openscad',   'showOpenScad',        'JSCAD / AI code shapes','AI·JSCAD 코드 형상', 'Features', '⚙️'),
    mk('toggle-library',    'showLibrary',         'Shape Library',     '형상 라이브러리',   'Features', '📚'),
    mk('toggle-cots',       'showCOTSPanel',       'COTS Standard Parts','표준 부품',        'Features', '🔩'),
    mk('toggle-ecad',       'showECADPanel',       'ECAD Import',       'ECAD 가져오기',    'Features', '🔌'),

    // AI
    mk('toggle-ai',          'showAIAssistant',       'AI Assistant',         'AI 어시스턴트',   'Tools', '🤖', 'Ctrl+/'),
    mk('toggle-advsupplier', 'showAISupplierMatch',   'AI Supplier Match',    'AI 공급사 매칭',  'Tools', '🎯'),
    mk('toggle-costcopilot', 'showCostCopilot',       'Cost Copilot',         '비용 코파일럿',    'Tools', '💡'),
    mk('toggle-aihistory',   'showAIHistory',         'AI History',           'AI 이력',         'Tools', '📜'),
    mk('toggle-processRtr',  'showProcessRouter',     'Process Router',       '공정 라우터',      'Tools', '🛣️'),

    // Edit
    mk('toggle-version',  'showVersionPanel', 'Version Panel',  '버전 패널',   'Edit', '🕒'),
    mk('toggle-history',  'showHistoryPanel', 'History Panel',  '히스토리',    'Edit', '📋'),
    mk('toggle-annot',    'showAnnotationPanel', 'Annotations',  '주석',       'Edit', '✏️'),
    mk('toggle-validate', 'showValidation',   'Validation',      '검증',        'Edit', '✓'),
    mk('toggle-diff',     'showVersionDiff',  'Version Diff',    '버전 비교',   'Edit', '🔀'),
    mk('toggle-branch',   'showBranchCompare','Branch Compare',  '브랜치 비교',  'Edit', '🌿'),
    mk('toggle-recovery', 'showRecovery',     'Recovery',        '복구',        'Edit', '💾'),
  ];
}
