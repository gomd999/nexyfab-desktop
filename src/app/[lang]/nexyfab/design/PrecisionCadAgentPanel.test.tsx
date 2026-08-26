/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { approveToolCall, createAgentRun, planRun, queueRun, requestToolCall, type AgentRun } from '@/lib/precision-cad-agent/runState';
import type { PrecisionCadAgentController } from '@/lib/precision-cad-agent/usePrecisionCadAgentController';
import PrecisionCadAgentPanel from './PrecisionCadAgentPanel';

const request = { request: 'Build the approved bracket', provider: 'openai' as const, model: 'gpt-test' };
const call = { callId: 'call-1', toolName: 'build_assembly', arguments: { projectId: 'project-1', thicknessMm: 4 }, scope: 'apply' as const };

function approvalRun(): AgentRun {
  const planned = planRun(createAgentRun(request, 'run-1'));
  if (!planned.ok) throw new Error('plan failed');
  const pending = requestToolCall(planned.run, call);
  if (!pending.ok) throw new Error('request failed');
  return pending.run;
}

function controller(run: AgentRun): PrecisionCadAgentController {
  return {
    run,
    catalog: [{ name: 'build_assembly', description: 'Build', parameters: { type: 'object' }, scope: 'apply' }],
    loadingCatalog: false,
    locale: 'en',
    loadCatalog: vi.fn(), start: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn(), resume: vi.fn(), retry: vi.fn(),
  };
}

describe('PrecisionCadAgentPanel governed lifecycle', () => {
  it('shows exact approval scope and immutable arguments hash before mutation', () => {
    const run = approvalRun();
    render(<PrecisionCadAgentPanel lang="en" controller={controller(run)} />);
    expect(screen.getByTestId('precision-cad-agent-lifecycle')).toHaveTextContent(/Plan.*Review.*Approve.*Execute.*Verify.*Recover/);
    expect(screen.getByText(/arguments [a-f0-9]{8}/)).toBeInTheDocument();
    expect(screen.getByText(/CAD is unchanged before approval/)).toBeInTheDocument();
  });

  it('stops at a durable queue and explains revision-preserving recovery', () => {
    const pending = approvalRun();
    const approved = approveToolCall(pending, pending.pendingApproval!.token);
    if (!approved.ok) throw new Error('approval failed');
    const queued = queueRun(approved.run, {
      execution: { mode: 'durable_commercial_queue', status: 'queued', executionId: 'execution-1' },
      persistence: { ok: false, code: 'PENDING', releaseReady: false, artifacts: [] },
    });
    if (!queued.ok) throw new Error('queue failed');
    render(<PrecisionCadAgentPanel lang="en" controller={controller(queued.run)} />);
    expect(screen.getByTestId('precision-cad-agent-queued')).toHaveTextContent('Browser continuation is stopped');
    expect(screen.getByTestId('precision-cad-agent-recovery')).toHaveTextContent('immutable revision');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});
