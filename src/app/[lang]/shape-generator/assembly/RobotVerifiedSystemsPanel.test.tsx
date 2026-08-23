// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/platform', () => ({ downloadBlob: vi.fn().mockResolvedValue(undefined) }));
import RobotVerifiedSystemsPanel from './RobotVerifiedSystemsPanel';

const safe = (extra: Record<string, unknown>) => ({ schema: 'report.v1', status: 'passed', errors: [], releaseReady: false as const, sideEffects: { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }, ...extra });
function upload(view: ReturnType<typeof render>, ids: string[]) { for (const id of ids) fireEvent.change(view.getByTestId(id), { target: { files: [new File(['{}'], `${id}.json`)] } }); }

describe('RobotVerifiedSystemsPanel', () => {
  it('uses Korean copy for the canonical kr route locale', () => {
    const view = render(<RobotVerifiedSystemsPanel lang="kr" />);
    expect(view.getByTestId('robot-verified-systems').textContent).toContain('전체 검증');
  });

  it('runs full engineering coverage only after manifest and artifacts are present', async () => {
    const verify = vi.fn().mockResolvedValue(safe({ coverageReady: true, coverageHash: 'a'.repeat(64) }));
    const view = render(<RobotVerifiedSystemsPanel lang="en" verify={verify} />);
    upload(view, ['robot-verified-engineering-requirements', 'robot-verified-engineering-manifest', 'robot-verified-engineering-artifacts']);
    fireEvent.click(view.getByTestId('robot-verified-engineering-run'));
    await waitFor(() => expect(view.getByTestId('robot-verified-engineering-report').textContent).toContain('passed'));
    expect(verify).toHaveBeenCalledWith('engineering', expect.objectContaining({ requirements: expect.any(File), manifest: expect.any(File) }), [expect.any(File)]);
  });

  it('rejects release-bearing or side-effecting stage responses', async () => {
    const verify = vi.fn().mockResolvedValue({ ...safe({ motionCoverageReady: true }), releaseReady: true });
    const view = render(<RobotVerifiedSystemsPanel lang="en" verify={verify} />);
    upload(view, ['robot-verified-motion-requirements', 'robot-verified-motion-motionInput', 'robot-verified-motion-artifacts']);
    fireEvent.click(view.getByTestId('robot-verified-motion-run'));
    await waitFor(() => expect(view.getByTestId('robot-verified-motion-error').textContent).toContain('unsafe or contradictory'));
    expect(view.queryByTestId('robot-verified-motion-report')).toBeNull();
  });

  it('requires issuer, signature and target hash for a ready audit', async () => {
    const verify = vi.fn().mockResolvedValue(safe({ schema: 'nexyfab.robot-verified-systems-release-audit.v2', status: 'ready_for_final_review', releaseTargetHash: 'a'.repeat(64) }));
    const view = render(<RobotVerifiedSystemsPanel lang="en" verify={verify} />);
    upload(view, ['robot-verified-audit-postIntegration', 'robot-verified-audit-exactCadEvidence', 'robot-verified-audit-manufacturingEvidence', 'robot-verified-audit-engineeringCoverage', 'robot-verified-audit-motionCoverage', 'robot-verified-audit-cableLife', 'robot-verified-audit-safetyElectrical', 'robot-verified-audit-physicalReceipt', 'robot-verified-audit-systemBinding', 'robot-verified-audit-artifacts']);
    fireEvent.click(view.getByTestId('robot-verified-audit-run'));
    await waitFor(() => expect(view.getByTestId('robot-verified-audit-error').textContent).toContain('unsafe or contradictory'));
  });
});
