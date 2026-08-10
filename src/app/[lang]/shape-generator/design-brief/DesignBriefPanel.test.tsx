// @vitest-environment jsdom
/**
 * DesignBriefPanel — WA-D3 web entry tests.
 *
 * Verifies: the form submits to the design-brief API (mocked fetch), renders a
 * verified-package summary on 200, renders an explicit refusal on 422, and
 * always mounts the WA-C AiReviewQueuePanel (empty state when no AI runs).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { downloadBlob } from '@/lib/platform';
import { DesignBriefPanel } from './DesignBriefPanel';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/shape-generator' }));
vi.mock('@/lib/platform', () => ({ downloadBlob: vi.fn().mockResolvedValue(undefined) }));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

const OK_PAYLOAD = {
  ok: true,
  planId: 'fixture-l-bracket',
  execution: { mode: 'ai-generated', assuranceLevel: 'engineering-screening', manufacturingReleaseReady: false, workspaceApplied: false, humanReviewRequired: true, exactCadRequiredForRelease: true, releaseBlockers: [] },
  workspaceCandidate: {
    schema: 'nexyfab.editable-workspace-candidate.v1', sourcePlanId: 'fixture-l-bracket', target: 'modeler-feature-tree', supported: true, blockers: [],
    program: { part: 'L-Bracket', features: [{ id: 'base', type: 'sketchExtrude', profile: [[0, 0], [60, 0], [60, 8], [8, 8], [8, 40], [0, 40]], height: 20 }] },
    reverificationRequired: true, inheritedVerification: false, manufacturingReleaseReady: false,
  },
  package: {
    planId: 'fixture-l-bracket',
    parts: [{
      partId: 'bracket',
      volumeMm3: 14720,
      dxf: '0\nSECTION\n',
      dimensions: [{ id: 'd_width', kind: 'linear', value: 60, unit: 'mm', expected: 60, deviation: 0 }],
      exactCad: {
        exactVolumeMm3: 14720,
        bodies: [{
          bodyId: 'bracket-body', source: 'direct-extrude', volumeMm3: 14720,
          faceCount: 8, edgeCount: 18, degeneratedEdgeCount: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0,
          analyticCylinder: false, roundTripVolumeRelError: 0,
          roundTripDegeneratedEdgeCount: 0, roundTripBoundaryEdgeCount: 0, roundTripNonManifoldEdgeCount: 0,
          step: 'ISO-10303-21;\nEND-ISO-10303-21;',
        }],
      },
      exactDrawing: {
        views: [{
          bodyId: 'bracket-body', view: 'front', method: 'replicad-hlr',
          visiblePathCount: 6, hiddenPathCount: 2, analyticCurveEvidence: false,
          sourceStepSha256: 'a'.repeat(64), svgSha256: 'b'.repeat(64),
          svg: '<?xml version="1.0"?><svg viewBox="0 0 10 10"></svg>',
          curveRecordSha256: 'c'.repeat(64), curveCount: 6, curveTypes: [1, 2],
          exactDxfSha256: 'd'.repeat(64), exactDxf: '0\nSECTION\n0\nEOF\n',
        }],
      },
      manufacturingDrawing: {
        releaseEligible: false,
        releaseBlockers: ['engineering checker approval signature is missing'],
        plannedDimensionCount: 1,
        includedDimensionCount: 1,
        sheets: [{
          bodyId: 'bracket-body', role: 'geometry-and-dimensions', sheetNumber: 1, sheetCount: 1,
          exactViewCount: 3, dimensionCount: 1, releaseStatus: 'engineering-review-required',
          svgSha256: 'c'.repeat(64), svg: '<?xml version="1.0"?><svg viewBox="0 0 420 297"></svg>',
        }],
      },
    }],
    report: { allPassed: true, gates: [{ id: 'geometry:bracket', kind: 'geometry', pass: true, metrics: {}, notes: [] }], approximations: ['tessellation note'], limitations: ['PDF 미포함'] },
  },
};

const REFUSAL_PAYLOAD = {
  ok: false,
  execution: { mode: 'ai-generated', assuranceLevel: 'engineering-screening', manufacturingReleaseReady: false, workspaceApplied: false, humanReviewRequired: true, exactCadRequiredForRelease: true, releaseBlockers: [] },
  refusal: { stage: 'plan', reason: "fixturePlanner: unknown brief 'nope'", failedGateIds: [] },
  gates: [],
};

describe('DesignBriefPanel (WA-D3 web entry)', () => {
  it('mounts the AI review queue (empty state) even before any submit', () => {
    const { getByTestId } = render(<DesignBriefPanel fetchImpl={vi.fn()} />);
    expect(getByTestId('db-review-queue')).toBeTruthy();
    expect(getByTestId('db-scope-notice').textContent).toMatch(/closed beta|클로즈드 베타/i);
    expect((getByTestId('db-fixture') as HTMLSelectElement).value).toBe('');
    // AiReviewQueuePanel empty state (no AI runs recorded).
    expect(getByTestId('arq-empty')).toBeTruthy();
  });

  it('submit → calls the design-brief API and renders the verified package summary', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, OK_PAYLOAD));
    const { getByTestId, queryByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);

    fireEvent.change(getByTestId('db-text'), { target: { value: 'L-Bracket 60×40×8' } });
    fireEvent.submit(getByTestId('db-form'));

    await waitFor(() => expect(getByTestId('db-package')).toBeTruthy());

    // Fetch hit the right endpoint with the brief body.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/nexyfab/design-brief');
    expect(JSON.parse((init as RequestInit).body as string).brief.text).toBe('L-Bracket 60×40×8');
    expect(JSON.parse((init as RequestInit).body as string).brief.params).toBeUndefined();

    // Package summary shows the measured part + gate rows; no refusal.
    expect(getByTestId('db-part').textContent).toContain('bracket');
    expect(getByTestId('db-gates').textContent).toContain('geometry:bracket');
    expect(getByTestId('db-execution-disclosure').textContent).toContain('MANUFACTURING RELEASE: BLOCKED');
    expect(getByTestId('db-exact-cad-evidence').textContent).toContain('EXACT OCCT B-REP: PASSED');
    expect(getByTestId('db-exact-cad-evidence').textContent).toContain('STEP ROUND-TRIP: CLOSED');
    expect(getByTestId('db-exact-drawing-evidence').textContent).toContain('EXACT STEP HLR: PASSED');
    expect(getByTestId('db-manufacturing-drawing-evidence').textContent).toContain('COMPLETE FOR REVIEW');
    expect(getByTestId('db-manufacturing-drawing-evidence').textContent).toContain('NOT RELEASED');
    expect(queryByTestId('db-refusal')).toBeNull();
  });

  it('downloads the exact STEP and clearly-labeled drawing preview artifacts', async () => {
    vi.mocked(downloadBlob).mockClear();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, OK_PAYLOAD));
    const { getByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);

    fireEvent.change(getByTestId('db-text'), { target: { value: 'L-Bracket 60×40×8' } });
    fireEvent.submit(getByTestId('db-form'));
    await waitFor(() => expect(getByTestId('db-step-download')).toBeTruthy());

    fireEvent.click(getByTestId('db-step-download'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith('bracket-bracket-body.step', expect.any(Blob)));
    fireEvent.click(getByTestId('db-dxf-download'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith('bracket-drawing-preview.dxf', expect.any(Blob)));
    fireEvent.click(getByTestId('db-hlr-svg-download'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith('bracket-bracket-body-front-exact-hlr.svg', expect.any(Blob)));
    fireEvent.click(getByTestId('db-hlr-dxf-download'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith('bracket-bracket-body-front-exact-hlr.dxf', expect.any(Blob)));
    fireEvent.click(getByTestId('db-manufacturing-svg-download'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith('bracket-bracket-body-engineering-review-1-of-1.svg', expect.any(Blob)));
    expect(getByTestId('db-part').textContent).toContain('NOT RELEASED');
  });

  it('reference fixture mode is explicit and sends the selected fixture key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
      ...OK_PAYLOAD,
      execution: { ...OK_PAYLOAD.execution, mode: 'reference-fixture', assuranceLevel: 'deterministic-reference' },
    }));
    const { getByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);
    fireEvent.change(getByTestId('db-text'), { target: { value: 'reference run' } });
    fireEvent.change(getByTestId('db-fixture'), { target: { value: 'l-bracket' } });
    expect(getByTestId('db-mode-notice').textContent).toMatch(/reference|참조/i);
    fireEvent.submit(getByTestId('db-form'));
    await waitFor(() => expect(getByTestId('db-package')).toBeTruthy());
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).brief.params.fixture).toBe('l-bracket');
    expect(getByTestId('db-execution-disclosure').textContent).toContain('REFERENCE FIXTURE');
  });

  it('requires a second explicit click before applying an editable revision', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, OK_PAYLOAD));
    const apply = vi.fn().mockResolvedValue({ ok: true, revisionId: 'rev-1' });
    const { getByTestId } = render(
      <DesignBriefPanel
        fetchImpl={fetchImpl}
        onApplyWorkspaceCandidate={apply}
        workspaceRevisionVerification={{
          revisionId: 'rev-1',
          status: 'passed',
          exactKernel: true,
          manufacturingReleaseReady: false,
        }}
      />,
    );
    fireEvent.change(getByTestId('db-text'), { target: { value: 'L-Bracket 60×40×8' } });
    fireEvent.submit(getByTestId('db-form'));
    await waitFor(() => expect(getByTestId('db-apply-workspace')).toBeTruthy());
    fireEvent.click(getByTestId('db-apply-workspace'));
    expect(apply).not.toHaveBeenCalled();
    expect(getByTestId('db-apply-workspace').textContent).toMatch(/confirm|확인/i);
    fireEvent.click(getByTestId('db-apply-workspace'));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(getByTestId('db-workspace-apply-result').textContent).toContain('verification reset');
    expect(getByTestId('db-workspace-verification').textContent).toContain('exact OCCT B-rep rebuild passed');
    expect(getByTestId('db-workspace-verification').textContent).toContain('manufacturing release still blocked');
  });

  it('422 refusal → renders explicit refusal (stage + reason), no package', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, REFUSAL_PAYLOAD));
    const { getByTestId, queryByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);

    fireEvent.change(getByTestId('db-text'), { target: { value: 'a spaceship' } });
    fireEvent.submit(getByTestId('db-form'));

    await waitFor(() => expect(getByTestId('db-refusal')).toBeTruthy());
    expect(getByTestId('db-refusal').textContent).toContain('plan');
    expect(getByTestId('db-refusal').textContent).toContain('unknown brief');
    expect(queryByTestId('db-package')).toBeNull();
  });

  it('401 → surfaces a sign-in message, no package/refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
    const { getByTestId, queryByTestId } = render(<DesignBriefPanel fetchImpl={fetchImpl} />);

    fireEvent.change(getByTestId('db-text'), { target: { value: 'L-Bracket' } });
    fireEvent.submit(getByTestId('db-form'));

    await waitFor(() => expect(getByTestId('db-error')).toBeTruthy());
    expect(queryByTestId('db-package')).toBeNull();
    expect(queryByTestId('db-refusal')).toBeNull();
  });
});
