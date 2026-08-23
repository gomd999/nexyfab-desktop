// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArchitectureInteriorAgentStatusPanel, type ArchitectureInteriorAgentStatusPanelProps } from './ArchitectureInteriorAgentStatusPanel';

const baseProps: ArchitectureInteriorAgentStatusPanelProps = {
  lang: 'en', track: 'ai_design', maturity: 'concept',
  geometryVerification: { status: 'not_run' }, remoteProfile: { exposable: false },
};

describe('ArchitectureInteriorAgentStatusPanel', () => {
  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'])('renders a complete localized panel for %s', lang => {
    render(<ArchitectureInteriorAgentStatusPanel {...baseProps} lang={lang} />);
    const panel = screen.getByTestId('architecture-interior-agent-status-panel');
    expect(screen.getByTestId('architecture-interior-agent-status-panel-title')).not.toHaveTextContent('');
    expect(screen.getByTestId('architecture-interior-agent-status-panel-operation')).not.toHaveTextContent('undefined');
    expect(panel).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  });

  it('does not present contract-only geometry as successful work', () => {
    render(<ArchitectureInteriorAgentStatusPanel {...baseProps} track="precision_cad" maturity="exact" geometryVerification={{ status: 'contract_only' }} remoteProfile={{ exposable: true }} />);
    const panel = screen.getByTestId('architecture-interior-agent-status-panel');
    expect(panel).toHaveAttribute('data-state', 'contract_only');
    expect(screen.getByTestId('architecture-interior-agent-status-panel-status')).toHaveAttribute('data-status', 'contract_only');
    expect(screen.getByTestId('architecture-interior-agent-status-panel-blockers')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-interior-agent-status-panel-operation')).not.toHaveTextContent(/ready|execute the precision CAD agent/i);
  });

  it('shows maturity and remote blockers for precision CAD', () => {
    render(<ArchitectureInteriorAgentStatusPanel {...baseProps} track="precision_cad" maturity="concept" geometryVerification={{ status: 'verified' }} remoteProfile={{ exposable: false, blocker: 'Remote approval is required.' }} />);
    expect(screen.getByTestId('architecture-interior-agent-status-panel')).toHaveAttribute('data-state', 'blocked');
    expect(screen.getByTestId('architecture-interior-agent-status-panel-blockers')).toHaveTextContent(/maturity|exact|release/i);
  });

  it('exposes pending state without claiming readiness', () => {
    render(<ArchitectureInteriorAgentStatusPanel {...baseProps} pending />);
    const panel = screen.getByTestId('architecture-interior-agent-status-panel');
    expect(panel).toHaveAttribute('data-state', 'pending');
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('architecture-interior-agent-status-panel-status')).not.toHaveTextContent(/ready|준비|実行可能/);
  });
});
