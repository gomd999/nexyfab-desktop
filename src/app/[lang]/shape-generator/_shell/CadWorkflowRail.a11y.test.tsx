// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CadWorkflowRail, getCadWorkflowGuidance } from './CadWorkflowRail';

const handlers = () => ({
  onAiDesign: vi.fn(),
  onPreciseCad: vi.fn(),
  onVerify: vi.fn(),
  onExportEvidencePackage: vi.fn(),
});

describe('CadWorkflowRail accessible guidance', () => {
  it('announces an honest next action and does not expose STEP export as release evidence', () => {
    const actions = handlers();
    render(<CadWorkflowRail lang="en" hasModel dfmWarningCount={0} {...actions} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Now: PREVIEW');
    expect(status).toHaveTextContent('Next: Run accuracy checks');
    expect(screen.getByRole('button', { name: /4 Release/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /3 Accuracy gates/ })).toHaveAttribute('aria-current', 'step');

    fireEvent.click(screen.getByTestId('cad-workflow-next-action'));
    expect(actions.onVerify).toHaveBeenCalledTimes(1);
    expect(actions.onExportEvidencePackage).not.toHaveBeenCalled();
  });

  it('keeps active AI execution in WORKING with no fabricated next action', () => {
    expect(getCadWorkflowGuidance({
      hasModel: false,
      dfmWarningCount: null,
      executionPlan: { status: 'ai_building' } as never,
    })).toEqual({ step: 'ai', truth: 'WORKING', action: null });
  });

  it('reports a failed verification as BLOCKED and routes repair back to AI', () => {
    const actions = handlers();
    render(<CadWorkflowRail lang="en" hasModel dfmWarningCount={2} {...actions} />);
    expect(screen.getByRole('status')).toHaveTextContent('Now: BLOCKED');
    fireEvent.click(screen.getByTestId('cad-workflow-next-action'));
    expect(actions.onAiDesign).toHaveBeenCalledTimes(1);
  });
});
