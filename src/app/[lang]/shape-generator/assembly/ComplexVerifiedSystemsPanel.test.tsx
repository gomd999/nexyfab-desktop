// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/platform', () => ({ downloadBlob: vi.fn().mockResolvedValue(undefined) }));
import ComplexVerifiedSystemsPanel from './ComplexVerifiedSystemsPanel';

const noEffects = { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false };
const graphReport = (extra: Record<string, unknown> = {}) => ({ schema: 'nexyfab.complex-system-graph-report.v2', status: 'passed' as const, graphReady: true, familyContractRequired: true, physicalValidationRequired: true, graphHash: 'a'.repeat(64), errors: [], blockers: ['product_family_contract_required'], releaseReady: false, sideEffects: noEffects, ...extra });
const gearboxReport = (extra: Record<string, unknown> = {}) => ({ schema: 'nexyfab.gearbox-family-contract-report.v1', status: 'passed' as const, familyContractReady: true, physicalValidationComplete: false, finalExpertReviewComplete: false, applicationHash: 'b'.repeat(64), errors: [], blockers: ['gearbox_physical_validation_required'], releaseReady: false, sideEffects: noEffects, ...extra });
function uploadBase(view: ReturnType<typeof render>) { fireEvent.change(view.getByTestId('complex-verified-graph-file'), { target: { files: [new File(['{}'], 'graph.json')] } }); fireEvent.change(view.getByTestId('complex-verified-artifacts'), { target: { files: [new File(['raw'], 'evidence.bin')] } }); }

describe('ComplexVerifiedSystemsPanel', () => {
  it('reuses the graph and artifact set for graph verification', async () => {
    const verify = vi.fn().mockResolvedValue(graphReport());
    const view = render(<ComplexVerifiedSystemsPanel lang="en" verify={verify} />);
    uploadBase(view);
    fireEvent.click(view.getByTestId('complex-verified-graph-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-graph-report').textContent).toContain('passed'));
    expect(verify).toHaveBeenCalledWith('graph', expect.any(File), null, [expect.any(File)]);
    expect(view.getByTestId('complex-verified-graph-report').textContent).toContain('release false');
  });

  it('keeps a passing family calculation visibly blocked on physical validation', async () => {
    const verify = vi.fn().mockResolvedValue(gearboxReport());
    const view = render(<ComplexVerifiedSystemsPanel lang="ko" verify={verify} />);
    uploadBase(view);
    fireEvent.change(view.getByTestId('complex-verified-gearbox-contract'), { target: { files: [new File(['{}'], 'gearbox.json')] } });
    fireEvent.click(view.getByTestId('complex-verified-gearbox-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-gearbox-report').textContent).toContain('passed'));
    expect(view.getByTestId('complex-verified-gearbox-report').textContent).toContain('시험 리그 실증');
  });

  it('uses Korean copy for the canonical kr route locale', () => {
    const view = render(<ComplexVerifiedSystemsPanel lang="kr" />);
    expect(view.getByTestId('complex-verified-systems').textContent).toContain('복잡 제품');
  });

  it('surfaces HTTP status for a non-JSON proxy failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    );
    const view = render(<ComplexVerifiedSystemsPanel lang="en" />);
    uploadBase(view);
    fireEvent.click(view.getByTestId('complex-verified-graph-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-graph-error').textContent).toContain('HTTP 502'));
    expect(view.getByTestId('complex-verified-graph-error').textContent).toContain('non-JSON response');
  });

  it('rejects release-bearing and contradictory responses', async () => {
    const verify = vi.fn().mockResolvedValue(gearboxReport({ releaseReady: true }));
    const view = render(<ComplexVerifiedSystemsPanel lang="en" verify={verify} />);
    uploadBase(view);
    fireEvent.change(view.getByTestId('complex-verified-gearbox-contract'), { target: { files: [new File(['{}'], 'gearbox.json')] } });
    fireEvent.click(view.getByTestId('complex-verified-gearbox-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-gearbox-error').textContent).toContain('unsafe or contradictory'));
    expect(view.queryByTestId('complex-verified-gearbox-report')).toBeNull();
  });

  it('invalidates every report when the shared graph changes', async () => {
    const verify = vi.fn().mockResolvedValue(graphReport());
    const view = render(<ComplexVerifiedSystemsPanel lang="en" verify={verify} />);
    uploadBase(view);
    fireEvent.click(view.getByTestId('complex-verified-graph-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-graph-report')).toBeTruthy());
    fireEvent.change(view.getByTestId('complex-verified-graph-file'), { target: { files: [new File(['{\"revision\":2}'], 'graph-v2.json')] } });
    expect(view.queryByTestId('complex-verified-graph-report')).toBeNull();
  });

  it('shows a server-computed partial dependency cone while keeping release blocked', async () => {
    const impact = { schema: 'nexyfab.complex-system-change-impact-report.v1' as const, status: 'passed' as const, impactPlanReady: true, scope: 'partial' as const, applicationHash: 'c'.repeat(64), affectedNodeIds: ['part', 'assembly'], affectedEdgeIds: ['contains'], invalidatedEvidenceIds: ['strength'], reusableEvidenceIds: ['coating'], requiredReverificationKinds: ['calculation'], revalidationRequired: true, errors: [], blockers: ['affected_evidence_reverification_required'], releaseReady: false, sideEffects: noEffects };
    const verifyImpact = vi.fn().mockResolvedValue(impact), view = render(<ComplexVerifiedSystemsPanel lang="en" verifyImpact={verifyImpact} />);
    uploadBase(view);
    fireEvent.change(view.getByTestId('complex-verified-impact-base-graph'), { target: { files: [new File(['{}'], 'base.json')] } });
    fireEvent.change(view.getByTestId('complex-verified-impact-base-artifacts'), { target: { files: [new File(['raw'], 'base.bin')] } });
    fireEvent.click(view.getByTestId('complex-verified-impact-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-impact-report').textContent).toContain('partial'));
    expect(view.getByTestId('complex-verified-impact-report').textContent).toContain('stale evidence 1');
    expect(view.getByTestId('complex-verified-impact-report').textContent).toContain('release false');
    expect(verifyImpact).toHaveBeenCalledWith(expect.any(File), expect.any(File), [expect.any(File)], [expect.any(File)]);
  });

  it('rejects a no-change impact response that secretly invalidates evidence', async () => {
    const unsafe = { schema: 'nexyfab.complex-system-change-impact-report.v1' as const, status: 'passed' as const, impactPlanReady: true, scope: 'none' as const, applicationHash: 'd'.repeat(64), affectedNodeIds: [], affectedEdgeIds: [], invalidatedEvidenceIds: ['hidden-stale'], reusableEvidenceIds: [], requiredReverificationKinds: [], revalidationRequired: false, errors: [], blockers: ['final_expert_review_required'], releaseReady: false, sideEffects: noEffects };
    const view = render(<ComplexVerifiedSystemsPanel lang="en" verifyImpact={vi.fn().mockResolvedValue(unsafe)} />);
    uploadBase(view);
    fireEvent.change(view.getByTestId('complex-verified-impact-base-graph'), { target: { files: [new File(['{}'], 'base.json')] } });
    fireEvent.change(view.getByTestId('complex-verified-impact-base-artifacts'), { target: { files: [new File(['raw'], 'base.bin')] } });
    fireEvent.click(view.getByTestId('complex-verified-impact-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-impact-error').textContent).toContain('unsafe or contradictory'));
  });

  it('shows all four recomputed scale tiers without claiming independent approval', async () => {
    const report = { schema: 'nexyfab.complex-assembly-scale-benchmark-report.v1' as const, status: 'passed' as const, benchmarkExecutionReady: true, benchmarkHash: 'e'.repeat(64), tierSummaries: [20, 100, 500, 1000].map(occurrenceCount => ({ occurrenceCount, workflow: 'test', slaPassed: true })), errors: [], blockers: ['independent_benchmark_approval_required'], independentBenchmarkApprovalComplete: false, releaseReady: false, sideEffects: noEffects };
    const verifyScale = vi.fn().mockResolvedValue(report), view = render(<ComplexVerifiedSystemsPanel lang="en" verifyScale={verifyScale} />);
    fireEvent.change(view.getByTestId('complex-verified-scale-benchmark'), { target: { files: [new File(['{}'], 'scale.json')] } });
    fireEvent.change(view.getByTestId('complex-verified-scale-artifacts'), { target: { files: [new File(['raw'], 'timing.jsonl')] } });
    fireEvent.click(view.getByTestId('complex-verified-scale-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-scale-report').textContent).toContain('20/100/500/1000'));
    expect(view.getByTestId('complex-verified-scale-report').textContent).toContain('independent approval pending');
    expect(view.getByTestId('complex-verified-scale-report').textContent).toContain('release false');
  });

  it('rejects a scale report that omits a required tier', async () => {
    const unsafe = { schema: 'nexyfab.complex-assembly-scale-benchmark-report.v1' as const, status: 'passed' as const, benchmarkExecutionReady: true, benchmarkHash: 'f'.repeat(64), tierSummaries: [20, 100, 500].map(occurrenceCount => ({ occurrenceCount, workflow: 'test', slaPassed: true })), errors: [], blockers: ['independent_benchmark_approval_required'], independentBenchmarkApprovalComplete: false, releaseReady: false, sideEffects: noEffects };
    const view = render(<ComplexVerifiedSystemsPanel lang="en" verifyScale={vi.fn().mockResolvedValue(unsafe)} />);
    fireEvent.change(view.getByTestId('complex-verified-scale-benchmark'), { target: { files: [new File(['{}'], 'scale.json')] } });
    fireEvent.change(view.getByTestId('complex-verified-scale-artifacts'), { target: { files: [new File(['raw'], 'timing.jsonl')] } });
    fireEvent.click(view.getByTestId('complex-verified-scale-run'));
    await waitFor(() => expect(view.getByTestId('complex-verified-scale-error').textContent).toContain('unsafe or contradictory'));
  });
});
