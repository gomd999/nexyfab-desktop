import type { AiDesignComplexWorkspaceViewModelV1, AiDesignHeatLevel } from './aiDesignComplexWorkspaceViewModel';

export const AI_DESIGN_COMPLEX_WORKSPACE_UX_SCHEMA = 'nexyfab.ai-design-complex-workspace-ux.v2' as const;
export const AI_DESIGN_COMPLEX_TREE_WINDOW_MAX = 200;

export type AiDesignWorkspaceLocale = 'ko' | 'en' | 'ja' | 'zh' | 'cn' | 'es' | 'ar';
export type AiDesignWorkspaceConnectionState = 'online' | 'offline' | 'reconnecting' | 'stale_revision' | 'conflict' | 'interrupted';

export interface AiDesignComplexWorkspaceUxSourceV2 {
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  complexRevision: number;
  staleAgainstRuntime: boolean;
  workspace: AiDesignComplexWorkspaceViewModelV1;
  precision: {
    status: 'NOT_RUN' | 'PASS' | 'FAIL' | 'STALE';
    manufacturingReleaseReady: false;
  };
}

export interface AiDesignComplexWorkspaceUxOptionsV2 {
  locale?: AiDesignWorkspaceLocale;
  treeOffset?: number;
  treeLimit?: number;
  partitionOffset?: number;
  partitionLimit?: number;
  connection?: AiDesignWorkspaceConnectionState;
}

export interface AiDesignComplexWorkspaceUxV2 {
  schema: typeof AI_DESIGN_COMPLEX_WORKSPACE_UX_SCHEMA;
  locale: Exclude<AiDesignWorkspaceLocale, 'cn'>;
  direction: 'ltr' | 'rtl';
  revisions: { runtime: number; complex: number; stale: boolean };
  assemblyTreeWindow: {
    offset: number;
    limit: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
    rows: readonly {
      nodeId: string;
      label: string;
      ariaLabel: string;
      ariaLevel: number;
      ariaSelected: boolean;
      ariaExpanded: boolean | null;
      heat: AiDesignHeatLevel;
      heatText: string;
      statusText: string;
    }[];
  };
  partitionWindow: {
    offset: number;
    limit: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
    progressiveLoading: true;
    request: { type: 'LOAD_PARTITION_WINDOW'; offset: number; limit: number } | null;
  };
  stateContinuity: {
    selectedNodeId: string | null;
    selectionStorageKey: string;
    gaugeDraftStorageKeys: readonly string[];
    preservesSelectionAcrossWindows: true;
    preservesGaugeDraftsAcrossReconnect: true;
    heatmapPartialUpdates: readonly { stableKey: string; nodeId: string; heat: AiDesignHeatLevel; reasons: readonly string[] }[];
  };
  mobile: {
    enabled: boolean;
    pattern: 'modal-bottom-sheet';
    snapPointsPercent: readonly [35, 68, 94];
    closeOnEscape: true;
    focusTrap: true;
    restoreFocus: true;
    stickyActionBar: boolean;
    touchTargetMinPx: 44;
    numericEditor: { inputMode: 'decimal'; enterKeyHint: 'done'; unitAlwaysVisible: true; coarseAndFineControls: true };
  };
  recovery: {
    state: AiDesignWorkspaceConnectionState;
    blocking: boolean;
    title: string;
    message: string;
    safeActions: readonly ('RETRY' | 'REFRESH_SERVER_STATE' | 'RESUME' | 'OPEN_CONFLICT_REVIEW' | 'WORK_OFFLINE_READ_ONLY')[];
    mutationEnabled: boolean;
  };
  trust: {
    heading: string;
    conceptStatus: string;
    exactCadStatus: string;
    manufacturingStatus: string;
    nonColorSummary: string;
  };
  accessibility: {
    landmarkLabel: string;
    treeLabel: string;
    statusLiveRegion: 'polite';
    errorsLiveRegion: 'assertive';
    keyboardNavigation: readonly ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Space'];
    colorOnlyCommunicationForbidden: true;
    reducedMotionSafe: true;
    supportsBrowserZoomPercent: 200;
    reflowWithoutTwoDimensionalScroll: true;
  };
  history: {
    aiViewStateUndoRedoSupported: true;
    undoCommand: 'UNDO_AI_VIEW_STATE';
    redoCommand: 'REDO_AI_VIEW_STATE';
    precisionCadCommitsUndoable: false;
    exactReceiptsUndoable: false;
  };
  terminology: { assembly: string; interface: string; constraint: string; gauge: string; verification: string };
}

type Copy = {
  workspace: string;
  assembly: string;
  concept: string;
  exact: Record<AiDesignComplexWorkspaceUxSourceV2['precision']['status'], string>;
  manufacturing: string;
  terms: AiDesignComplexWorkspaceUxV2['terminology'];
  heat: Record<AiDesignHeatLevel, string>;
  recovery: Record<AiDesignWorkspaceConnectionState, { title: string; message: string }>;
};

const COPY: Record<Exclude<AiDesignWorkspaceLocale, 'cn'>, Copy> = {
  ko: {
    workspace: 'AI 설계 작업공간', assembly: '제품 조립 구조', concept: '개념 설계 — 공학 검증 전',
    exact: { NOT_RUN: '정밀 CAD 검증 안 됨', PASS: '정밀 CAD 영수증 통과', FAIL: '정밀 CAD 검증 실패', STALE: '정밀 CAD 결과가 오래됨' },
    manufacturing: '제조 승인 안 됨', heat: { none: '영향 없음', attention: '주의', high: '높은 변경 영향', critical: '치명적 충돌' },
    terms: { assembly: '조립체', interface: '인터페이스', constraint: '제약조건', gauge: '파라미터 게이지', verification: '검증' },
    recovery: {
      online: { title: '온라인', message: '서버 상태와 동기화되었습니다.' }, offline: { title: '오프라인', message: '읽기만 가능하며 변경은 연결 후 다시 시도합니다.' },
      reconnecting: { title: '재연결 중', message: '서버 상태를 다시 확인하고 있습니다.' }, stale_revision: { title: '새 버전 발견', message: '서버 상태를 새로 불러온 뒤 변경해야 합니다.' },
      conflict: { title: '변경 충돌', message: '자동 병합하지 않고 명시적으로 선택해야 합니다.' }, interrupted: { title: '작업 중단', message: '저장된 서버 체크포인트에서 재개할 수 있습니다.' },
    },
  },
  en: {
    workspace: 'AI design workspace', assembly: 'Product assembly structure', concept: 'Concept design — engineering not verified',
    exact: { NOT_RUN: 'Precision CAD not verified', PASS: 'Precision CAD receipt passed', FAIL: 'Precision CAD verification failed', STALE: 'Precision CAD result is stale' },
    manufacturing: 'Not approved for manufacturing', heat: { none: 'No impact', attention: 'Attention', high: 'High change impact', critical: 'Critical conflict' },
    terms: { assembly: 'Assembly', interface: 'Interface', constraint: 'Constraint', gauge: 'Parameter gauge', verification: 'Verification' },
    recovery: {
      online: { title: 'Online', message: 'Synchronized with server state.' }, offline: { title: 'Offline', message: 'Read-only until the connection returns.' },
      reconnecting: { title: 'Reconnecting', message: 'Checking authoritative server state.' }, stale_revision: { title: 'Newer revision found', message: 'Refresh server state before changing the design.' },
      conflict: { title: 'Change conflict', message: 'Choose explicitly; no automatic merge is allowed.' }, interrupted: { title: 'Work interrupted', message: 'Resume from the saved server checkpoint.' },
    },
  },
  ja: {
    workspace: 'AI設計ワークスペース', assembly: '製品アセンブリ構造', concept: 'コンセプト設計 — 工学検証前',
    exact: { NOT_RUN: '精密CAD未検証', PASS: '精密CADレシート合格', FAIL: '精密CAD検証失敗', STALE: '精密CAD結果が古い' },
    manufacturing: '製造承認前', heat: { none: '影響なし', attention: '注意', high: '変更影響大', critical: '重大な競合' },
    terms: { assembly: 'アセンブリ', interface: 'インターフェース', constraint: '制約条件', gauge: 'パラメータゲージ', verification: '検証' },
    recovery: {
      online: { title: 'オンライン', message: 'サーバー状態と同期済みです。' }, offline: { title: 'オフライン', message: '接続が戻るまで読み取り専用です。' },
      reconnecting: { title: '再接続中', message: 'サーバー状態を確認しています。' }, stale_revision: { title: '新しい版があります', message: '変更前にサーバー状態を更新してください。' },
      conflict: { title: '変更の競合', message: '自動統合せず明示的に選択してください。' }, interrupted: { title: '作業中断', message: '保存済みチェックポイントから再開できます。' },
    },
  },
  zh: {
    workspace: 'AI设计工作区', assembly: '产品装配结构', concept: '概念设计 — 尚未工程验证',
    exact: { NOT_RUN: '精密CAD未验证', PASS: '精密CAD回执通过', FAIL: '精密CAD验证失败', STALE: '精密CAD结果已过期' },
    manufacturing: '未获制造批准', heat: { none: '无影响', attention: '注意', high: '高变更影响', critical: '严重冲突' },
    terms: { assembly: '装配体', interface: '接口', constraint: '约束条件', gauge: '参数量规', verification: '验证' },
    recovery: {
      online: { title: '在线', message: '已与服务器状态同步。' }, offline: { title: '离线', message: '恢复连接前仅可查看。' },
      reconnecting: { title: '正在重连', message: '正在检查服务器状态。' }, stale_revision: { title: '发现新版本', message: '修改前请刷新服务器状态。' },
      conflict: { title: '变更冲突', message: '禁止自动合并，请明确选择。' }, interrupted: { title: '工作中断', message: '可从已保存的服务器检查点恢复。' },
    },
  },
  es: {
    workspace: 'Espacio de diseño IA', assembly: 'Estructura de ensamblaje', concept: 'Diseño conceptual — sin verificación de ingeniería',
    exact: { NOT_RUN: 'CAD de precisión sin verificar', PASS: 'Recibo de CAD de precisión aprobado', FAIL: 'Falló la verificación CAD', STALE: 'El resultado CAD está obsoleto' },
    manufacturing: 'No aprobado para fabricación', heat: { none: 'Sin impacto', attention: 'Atención', high: 'Alto impacto', critical: 'Conflicto crítico' },
    terms: { assembly: 'Ensamblaje', interface: 'Interfaz', constraint: 'Restricción', gauge: 'Control paramétrico', verification: 'Verificación' },
    recovery: {
      online: { title: 'En línea', message: 'Sincronizado con el servidor.' }, offline: { title: 'Sin conexión', message: 'Solo lectura hasta recuperar la conexión.' },
      reconnecting: { title: 'Reconectando', message: 'Comprobando el estado del servidor.' }, stale_revision: { title: 'Hay una revisión nueva', message: 'Actualice antes de cambiar el diseño.' },
      conflict: { title: 'Conflicto de cambios', message: 'Elija explícitamente; no se combina automáticamente.' }, interrupted: { title: 'Trabajo interrumpido', message: 'Reanude desde el punto guardado.' },
    },
  },
  ar: {
    workspace: 'مساحة عمل التصميم بالذكاء الاصطناعي', assembly: 'هيكل تجميع المنتج', concept: 'تصميم مفاهيمي — غير متحقق هندسياً',
    exact: { NOT_RUN: 'لم يتم التحقق عبر CAD الدقيق', PASS: 'اجتاز إيصال CAD الدقيق', FAIL: 'فشل تحقق CAD الدقيق', STALE: 'نتيجة CAD الدقيق قديمة' },
    manufacturing: 'غير معتمد للتصنيع', heat: { none: 'لا تأثير', attention: 'انتباه', high: 'تأثير تغيير مرتفع', critical: 'تعارض حرج' },
    terms: { assembly: 'تجميع', interface: 'واجهة', constraint: 'قيد', gauge: 'مقياس المعلمة', verification: 'تحقق' },
    recovery: {
      online: { title: 'متصل', message: 'تمت المزامنة مع الخادم.' }, offline: { title: 'غير متصل', message: 'القراءة فقط حتى عودة الاتصال.' },
      reconnecting: { title: 'إعادة الاتصال', message: 'جارٍ التحقق من حالة الخادم.' }, stale_revision: { title: 'يوجد إصدار أحدث', message: 'حدّث حالة الخادم قبل التغيير.' },
      conflict: { title: 'تعارض تغييرات', message: 'اختر صراحةً؛ الدمج التلقائي غير مسموح.' }, interrupted: { title: 'توقف العمل', message: 'استأنف من نقطة تحقق الخادم المحفوظة.' },
    },
  },
};

function integerInRange(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('AI_DESIGN_COMPLEX_UX_WINDOW_INVALID');
  return value;
}

function recoveryActions(state: AiDesignWorkspaceConnectionState): AiDesignComplexWorkspaceUxV2['recovery']['safeActions'] {
  if (state === 'offline') return ['RETRY', 'WORK_OFFLINE_READ_ONLY'];
  if (state === 'reconnecting') return ['WORK_OFFLINE_READ_ONLY'];
  if (state === 'stale_revision') return ['REFRESH_SERVER_STATE'];
  if (state === 'conflict') return ['OPEN_CONFLICT_REVIEW', 'REFRESH_SERVER_STATE'];
  if (state === 'interrupted') return ['RESUME', 'REFRESH_SERVER_STATE'];
  return [];
}

/** Produces a renderer-neutral, virtualized and accessible V2 consumption contract. */
export function createAiDesignComplexWorkspaceUxV2(
  source: AiDesignComplexWorkspaceUxSourceV2,
  options: AiDesignComplexWorkspaceUxOptionsV2 = {},
): AiDesignComplexWorkspaceUxV2 {
  const locale = options.locale === 'cn' ? 'zh' : options.locale ?? 'ko';
  const copy = COPY[locale];
  if (!copy) throw new Error('AI_DESIGN_COMPLEX_UX_LOCALE_INVALID');
  const total = source.workspace.assemblyTree.length;
  const requestedOffset = integerInRange(options.treeOffset, 0, 0, Math.max(total, 0));
  const offset = Math.min(requestedOffset, Math.max(total - 1, 0));
  const limit = integerInRange(options.treeLimit, source.workspace.base.layout.mode === 'mobile' ? 80 : 160, 1, AI_DESIGN_COMPLEX_TREE_WINDOW_MAX);
  const partitionTotal = source.workspace.scale.graphPartitionCount;
  const requestedPartitionOffset = integerInRange(options.partitionOffset, 0, 0, Math.max(partitionTotal, 0));
  const partitionOffset = Math.min(requestedPartitionOffset, Math.max(partitionTotal - 1, 0));
  const partitionLimit = integerInRange(options.partitionLimit, 16, 1, 32);
  const connection = source.staleAgainstRuntime && (options.connection ?? 'online') === 'online' ? 'stale_revision' : options.connection ?? 'online';
  const recovery = copy.recovery[connection];
  const rows = source.workspace.assemblyTree.slice(offset, offset + limit).map(row => {
    const heatText = copy.heat[row.heat];
    return {
      nodeId: row.nodeId,
      label: row.label,
      ariaLabel: `${row.label}; ${heatText}; ${row.childCount} ${copy.assembly}`,
      ariaLevel: row.depth + 1,
      ariaSelected: row.selected,
      ariaExpanded: row.expandable ? true : null,
      heat: row.heat,
      heatText,
      statusText: row.reasons.length ? `${heatText}: ${row.reasons.join(', ')}` : heatText,
    };
  });
  const exact = copy.exact[source.precision.status];
  const visibleNodeIds = new Set(rows.map(row => row.nodeId));
  const ux: AiDesignComplexWorkspaceUxV2 = {
    schema: AI_DESIGN_COMPLEX_WORKSPACE_UX_SCHEMA,
    locale,
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    revisions: { runtime: source.runtimeRevision, complex: source.complexRevision, stale: source.staleAgainstRuntime },
    assemblyTreeWindow: { offset, limit, total, hasPrevious: offset > 0, hasNext: offset + rows.length < total, rows },
    partitionWindow: {
      offset: partitionOffset, limit: partitionLimit, total: partitionTotal, hasPrevious: partitionOffset > 0,
      hasNext: partitionOffset + partitionLimit < partitionTotal, progressiveLoading: true,
      request: partitionTotal > 0 && partitionOffset + partitionLimit < partitionTotal
        ? { type: 'LOAD_PARTITION_WINDOW', offset: partitionOffset + partitionLimit, limit: partitionLimit }
        : null,
    },
    stateContinuity: {
      selectedNodeId: source.workspace.inspector.selectedNodeId,
      selectionStorageKey: `${source.projectId}:${source.sessionId}:selection`,
      gaugeDraftStorageKeys: source.workspace.assemblyGauges.map(gauge => `${source.projectId}:${source.sessionId}:gauge:${gauge.gaugeId}`),
      preservesSelectionAcrossWindows: true, preservesGaugeDraftsAcrossReconnect: true,
      heatmapPartialUpdates: source.workspace.changeHeatmap.filter(row => visibleNodeIds.has(row.structureNodeId)).map(row => ({
        stableKey: `${source.complexRevision}:${row.structureNodeId}`, nodeId: row.structureNodeId, heat: row.heat, reasons: row.reasons,
      })),
    },
    mobile: {
      enabled: source.workspace.base.layout.mode === 'mobile', pattern: 'modal-bottom-sheet', snapPointsPercent: [35, 68, 94],
      closeOnEscape: true, focusTrap: true, restoreFocus: true, stickyActionBar: source.workspace.inspector.stickyActionBar,
      touchTargetMinPx: 44, numericEditor: { inputMode: 'decimal', enterKeyHint: 'done', unitAlwaysVisible: true, coarseAndFineControls: true },
    },
    recovery: {
      state: connection, blocking: ['stale_revision', 'conflict'].includes(connection), title: recovery.title, message: recovery.message,
      safeActions: recoveryActions(connection), mutationEnabled: connection === 'online',
    },
    trust: {
      heading: copy.workspace, conceptStatus: copy.concept, exactCadStatus: exact, manufacturingStatus: copy.manufacturing,
      nonColorSummary: `${copy.concept}. ${exact}. ${copy.manufacturing}.`,
    },
    accessibility: {
      landmarkLabel: copy.workspace, treeLabel: copy.assembly, statusLiveRegion: 'polite', errorsLiveRegion: 'assertive',
      keyboardNavigation: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Space'],
      colorOnlyCommunicationForbidden: true, reducedMotionSafe: true, supportsBrowserZoomPercent: 200, reflowWithoutTwoDimensionalScroll: true,
    },
    history: { aiViewStateUndoRedoSupported: true, undoCommand: 'UNDO_AI_VIEW_STATE', redoCommand: 'REDO_AI_VIEW_STATE', precisionCadCommitsUndoable: false, exactReceiptsUndoable: false },
    terminology: copy.terms,
  };
  return Object.freeze(ux);
}
