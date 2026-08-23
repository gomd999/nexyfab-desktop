// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/platform', () => ({ downloadBlob: vi.fn().mockResolvedValue(undefined) }));
import { downloadBlob } from '@/lib/platform';
import RobotEngineeringAnalysisPanel from './RobotEngineeringAnalysisPanel';
import type { RobotEngineeringAnalysisPacketReport } from '@/lib/ai/robot/robotEngineeringAnalysisPacket';

function report(ready = true) {
  const componentStatus = { requirements: ready, dynamics: ready, thermal: ready, life: ready, structuralCompliance: ready, tcpPrecisionBudget: ready, structuralPrecisionBinding: ready };
  return {
    schema: 'nexyfab.robot-engineering-analysis-packet.v1', applicationHash: 'a'.repeat(64), status: ready ? 'passed' : 'failed', engineeringAnalysisReady: ready, componentStatus,
    errors: ready ? [] : ['thermal blocked'], scope: { onePayloadPathCombination: true, fullRequirementsCoverageComplete: false }, externalValidationComplete: false, releaseReady: false,
    sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false },
  } as unknown as RobotEngineeringAnalysisPacketReport;
}

function uploadAll(view: ReturnType<typeof render>) {
  for (const key of ['requirements', 'dynamicInput', 'dynamicReport', 'thermalInput', 'lifeInput', 'complianceInput', 'precisionInput']) {
    fireEvent.change(view.getByTestId(`robot-engineering-${key}`), { target: { files: [new File(['{}'], `${key}.json`)] } });
  }
}

describe('RobotEngineeringAnalysisPanel', () => {
  it('shows all bound gates and retains physical-validation release blockers', async () => {
    const analyze = vi.fn().mockResolvedValue(report(true));
    const view = render(<RobotEngineeringAnalysisPanel lang="en" analyze={analyze} />);
    uploadAll(view);
    fireEvent.click(view.getByTestId('robot-engineering-run'));
    await waitFor(() => expect(view.getByTestId('robot-engineering-report').textContent).toContain('Single path/payload analysis passed'));
    expect(view.getByTestId('robot-engineering-report').textContent).toContain('structuralPrecisionBinding');
    expect(view.getByTestId('robot-engineering-report').textContent).toContain('physical TCP, stiffness, thermal and life validation');
  });

  it('rejects a contradictory release-bearing response', async () => {
    const unsafe = report(true);
    (unsafe as unknown as { releaseReady: boolean }).releaseReady = true;
    const view = render(<RobotEngineeringAnalysisPanel lang="en" analyze={vi.fn().mockResolvedValue(unsafe)} />);
    uploadAll(view);
    fireEvent.click(view.getByTestId('robot-engineering-run'));
    await waitFor(() => expect(view.getByTestId('robot-engineering-error').textContent).toContain('unsafe or contradictory'));
    expect(view.queryByTestId('robot-engineering-report')).toBeNull();
  });

  it('downloads the immutable application-hash packet', async () => {
    vi.mocked(downloadBlob).mockClear();
    const view = render(<RobotEngineeringAnalysisPanel lang="en" analyze={vi.fn().mockResolvedValue(report(true))} />);
    uploadAll(view);
    fireEvent.click(view.getByTestId('robot-engineering-run'));
    await waitFor(() => expect(view.getByTestId('robot-engineering-report')).toBeTruthy());
    fireEvent.click(view.getByTestId('robot-engineering-download'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(`robot-engineering-analysis-${'a'.repeat(64)}.json`, expect.any(Blob)));
  });
});
