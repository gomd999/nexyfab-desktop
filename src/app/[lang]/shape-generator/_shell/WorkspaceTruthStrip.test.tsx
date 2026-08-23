// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkspaceTruthStrip } from './WorkspaceTruthStrip';

describe('WorkspaceTruthStrip', () => {
  it('shows exact capability without fabricating a session verification', () => {
    render(<WorkspaceTruthStrip domain="mechanical" workMode="precision_cad" dfmWarningCount={null} />);
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('CAD EXACT');
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('CHECK NOT_RUN');
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('RELEASE BLOCKED');
  });

  it('keeps spatial authoring in preview', () => {
    render(<WorkspaceTruthStrip domain="interior" workMode="precision_cad" dfmWarningCount={0} compact />);
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('CAD PREVIEW');
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('CHECK NOT_RUN');
    expect(screen.getByTestId('workspace-truth-strip')).not.toHaveTextContent('RELEASE');
  });

  it('shows a completed spatial calculation as preview rather than verified', () => {
    render(<WorkspaceTruthStrip domain="interior" workMode="precision_cad" dfmWarningCount={null} sessionVerification="PREVIEW" />);
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('CHECK PREVIEW');
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('RELEASE BLOCKED');
  });
});
