// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DOMAIN_PRODUCT_QUALIFICATION_PANEL_SCHEMA,
  DomainProductQualificationPanel,
  type DomainProductQualificationPanelResult,
} from './DomainProductQualificationPanel';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function result(overrides: Partial<DomainProductQualificationPanelResult> = {}): DomainProductQualificationPanelResult {
  return {
    schema: DOMAIN_PRODUCT_QUALIFICATION_PANEL_SCHEMA,
    status: 'HOLD',
    eligibleState: null,
    releaseEligible: false,
    projectId: 'project-1',
    domain: 'interior',
    revisionId: 'revision-1',
    revisionSequence: 7,
    contentSha256: HASH_A,
    artifactSha256: HASH_B,
    receiptSha256: HASH_C,
    blockerCodes: ['QUALIFICATION_INCOMPLETE'],
    blockerCount: 1,
    ...overrides,
  };
}

describe('DomainProductQualificationPanel', () => {
  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'])('renders localized accessible empty state for %s', lang => {
    render(<DomainProductQualificationPanel lang={lang} />);
    const panel = screen.getByTestId('domain-product-qualification-panel');
    expect(panel).toHaveAttribute('data-state', 'NOT_RUN');
    expect(panel).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    expect(screen.getByRole('status')).toHaveTextContent(lang === 'en' ? 'NOT_RUN' : /.+/);
    expect(screen.getByTestId('domain-product-qualification-hold')).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('PRODUCT_QUALIFIED');
    expect(panel).not.toHaveTextContent(/release eligible/i);
  });

  it('requires the exact qualified PASS combination before showing release eligibility', () => {
    const { rerender } = render(<DomainProductQualificationPanel lang="en" result={result({ status: 'PASS', releaseEligible: true })} />);
    expect(screen.getByTestId('domain-product-qualification-panel')).toHaveAttribute('data-state', 'INVALID');
    expect(screen.queryByTestId('domain-product-release-eligible')).not.toBeInTheDocument();

    rerender(<DomainProductQualificationPanel lang="en" result={result({ status: 'PASS', eligibleState: 'PRODUCT_QUALIFIED', releaseEligible: true, blockerCodes: [], blockerCount: 0 })} />);
    expect(screen.getByTestId('domain-product-qualification-claim')).toHaveTextContent('PRODUCT_QUALIFIED');
    expect(screen.getByTestId('domain-product-release-eligible')).toBeInTheDocument();
    expect(screen.getByTestId('domain-product-qualification-identity')).toHaveTextContent('revision-1 @7');
  });

  it('fails closed for malformed results and exposes only bounded stable metadata', () => {
    render(<DomainProductQualificationPanel lang="en" result={result({ status: 'STALE', blockerCodes: ['REVISION_STALE', 'raw blocker text', 'A'.repeat(100)], blockerCount: 99, domain: 'building', revisionId: 'rev:2', artifactSha256: 'bad' })} />);
    const panel = screen.getByTestId('domain-product-qualification-panel');
    expect(panel).toHaveAttribute('data-state', 'STALE');
    expect(panel).toHaveTextContent('REVISION_STALE');
    expect(panel).not.toHaveTextContent('raw blocker text');
    expect(screen.getByTestId('domain-product-qualification-blocker-count')).toHaveTextContent('99');
    expect(panel).toHaveTextContent('aaaaaaaa…');
    expect(panel).not.toHaveTextContent('bad');
  });

  it('maps unknown serialized state to INVALID without claiming product qualification', () => {
    render(<DomainProductQualificationPanel lang="en" result={{ ...result({ status: 'PASS', eligibleState: 'PRODUCT_QUALIFIED', releaseEligible: true, blockerCodes: [], blockerCount: 0 }), status: 'SUCCESS', error: 'secret raw error' }} />);
    const panel = screen.getByTestId('domain-product-qualification-panel');
    expect(panel).toHaveAttribute('data-state', 'INVALID');
    expect(panel).not.toHaveTextContent('secret raw error');
    expect(panel).not.toHaveTextContent('PRODUCT_QUALIFIED');
    expect(panel).not.toHaveTextContent(/release eligible/i);
  });
});
