import { describe, expect, it } from 'vitest';
import type { AiDesignComplexWorkspaceViewModelV1 } from './aiDesignComplexWorkspaceViewModel';
import { AI_DESIGN_COMPLEX_TREE_WINDOW_MAX, createAiDesignComplexWorkspaceUxV2, type AiDesignComplexWorkspaceUxSourceV2 } from './aiDesignComplexWorkspaceUxV2';

function source(count = 5_000, mode: 'desktop' | 'mobile' = 'desktop', stale = false): AiDesignComplexWorkspaceUxSourceV2 {
  const workspace = {
    base: { layout: { mode } },
    assemblyTree: Array.from({ length: count }, (_, index) => ({
      nodeId: `node-${index}`, label: `Part ${index}`, depth: index === 0 ? 0 : 1, childCount: index === 0 ? count - 1 : 0,
      expandable: index === 0, selected: index === 12, heat: index === 12 ? 'critical' : 'none', reasons: index === 12 ? ['unresolved_cross_domain_conflict'] : [],
    })),
    scale: { graphPartitionCount: 256 },
    inspector: { stickyActionBar: mode === 'mobile', selectedNodeId: 'node-12' },
    assemblyGauges: [{ gaugeId: 'gauge-1' }],
    changeHeatmap: [{ structureNodeId: 'node-12', heat: 'critical', reasons: ['unresolved_cross_domain_conflict'] }],
  } as unknown as AiDesignComplexWorkspaceViewModelV1;
  return {
    projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4, complexRevision: 8, staleAgainstRuntime: stale,
    workspace, precision: { status: stale ? 'STALE' : 'NOT_RUN', manufacturingReleaseReady: false },
  };
}

describe('AI Design complex workspace UX V2', () => {
  it('virtualizes a 5,000-node tree into a bounded accessible window', () => {
    const ux = createAiDesignComplexWorkspaceUxV2(source(), { treeOffset: 10, treeLimit: AI_DESIGN_COMPLEX_TREE_WINDOW_MAX, locale: 'en' });
    expect(ux.assemblyTreeWindow).toMatchObject({ offset: 10, limit: 200, total: 5_000, hasPrevious: true, hasNext: true });
    expect(ux.assemblyTreeWindow.rows).toHaveLength(200);
    expect(ux.assemblyTreeWindow.rows[2]).toMatchObject({ nodeId: 'node-12', ariaLevel: 2, ariaSelected: true, heatText: 'Critical conflict' });
    expect(ux.assemblyTreeWindow.rows[2]?.statusText).toContain('unresolved_cross_domain_conflict');
    expect(ux.accessibility).toMatchObject({ colorOnlyCommunicationForbidden: true, statusLiveRegion: 'polite', errorsLiveRegion: 'assertive' });
    expect(ux.partitionWindow).toMatchObject({ total: 256, progressiveLoading: true, request: { type: 'LOAD_PARTITION_WINDOW', offset: 16 } });
    expect(ux.stateContinuity).toMatchObject({ selectedNodeId: 'node-12', preservesSelectionAcrossWindows: true, heatmapPartialUpdates: [{ nodeId: 'node-12', heat: 'critical' }] });
    expect(ux.history).toMatchObject({ aiViewStateUndoRedoSupported: true, precisionCadCommitsUndoable: false });
    expect(ux.accessibility).toMatchObject({ supportsBrowserZoomPercent: 200, reflowWithoutTwoDimensionalScroll: true });
  });

  it('exposes mobile controls, Arabic RTL and safe offline recovery without enabling mutations', () => {
    const ux = createAiDesignComplexWorkspaceUxV2(source(20, 'mobile'), { locale: 'ar', connection: 'offline' });
    expect(ux).toMatchObject({ direction: 'rtl', mobile: { enabled: true, touchTargetMinPx: 44, focusTrap: true, numericEditor: { inputMode: 'decimal' } } });
    expect(ux.recovery).toMatchObject({ state: 'offline', mutationEnabled: false, safeActions: ['RETRY', 'WORK_OFFLINE_READ_ONLY'] });
    expect(ux.trust.manufacturingStatus).toContain('غير');
    expect(ux.terminology.gauge).toContain('مقياس');
  });

  it('normalizes cn to zh, converts stale runtime state into a blocking refresh, and rejects oversized windows', () => {
    const ux = createAiDesignComplexWorkspaceUxV2(source(10, 'desktop', true), { locale: 'cn' });
    expect(ux).toMatchObject({ locale: 'zh', recovery: { state: 'stale_revision', blocking: true, mutationEnabled: false, safeActions: ['REFRESH_SERVER_STATE'] } });
    expect(() => createAiDesignComplexWorkspaceUxV2(source(), { treeLimit: 201 })).toThrow('AI_DESIGN_COMPLEX_UX_WINDOW_INVALID');
    expect(() => createAiDesignComplexWorkspaceUxV2(source(), { partitionLimit: 33 })).toThrow('AI_DESIGN_COMPLEX_UX_WINDOW_INVALID');
  });
});
