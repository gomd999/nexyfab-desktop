// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AgenticCadContractSummary from './AgenticCadContractSummary';

describe('AgenticCadContractSummary', () => {
  it('keeps legacy completion NOT_RUN and supports every locale direction', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh', 'es', 'ar']) {
      const view = render(<AgenticCadContractSummary lang={lang} result={{ ok: true, rawIssue: 'secret' }} />);
      const panel = screen.getByTestId('agentic-cad-contract-summary');
      expect(panel).toHaveAttribute('data-state', 'NOT_RUN');
      expect(panel).not.toHaveTextContent('secret');
      expect(screen.getByTestId('agentic-cad-authority-warning')).toBeInTheDocument();
      expect(panel).toHaveTextContent(/CAD|CAD/);
      expect(panel).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      view.unmount();
    }
  });

  it('renders only bounded metadata and marks sandbox pass non-authoritative', () => {
    render(<AgenticCadContractSummary lang="en" result={null} viewModel={{
      state: 'SANDBOX_PASS', cadPass: false, authoritative: false, release: 'HOLD', sandboxPassed: true,
      planSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      receiptSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      toolId: 'feature.preview', highestRisk: 'R2', blocker: null,
    }} />);
    expect(screen.getByTestId('agentic-cad-authority-warning')).toHaveTextContent('NOT_AUTHORITATIVE');
    expect(screen.getByTestId('agentic-cad-authority-warning')).toHaveTextContent('HOLD');
    expect(screen.getByTestId('agentic-cad-contract-summary')).toHaveTextContent('abcdef01…');
    expect(screen.getByTestId('agentic-cad-contract-summary')).not.toHaveTextContent('abcdef0123456789abcdef0123456789');
  });
});
