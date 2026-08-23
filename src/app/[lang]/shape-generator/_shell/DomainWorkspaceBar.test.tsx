// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainWorkspaceBar } from './DomainWorkspaceBar';
import { getDomainWorkspaceSelection, resetDomainWorkspaceSession } from './domainWorkspaceStore';
import { protectManualEdit, resetManualEditProtectionSession } from '../ai/manualEditProtectionStore';

describe('DomainWorkspaceBar', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/ko/shape-generator?expert=1');
    window.sessionStorage.clear();
    resetDomainWorkspaceSession();
    resetManualEditProtectionSession();
  });

  it('keeps Space Design Labs in a separately labelled beta selector', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    window.history.replaceState({}, '', '/ko/shape-generator?expert=1&domain=building');
    render(<DomainWorkspaceBar lang="ko" />);
    expect(screen.getByTestId('space-labs-beta')).toHaveTextContent('부가 Beta');
    fireEvent.change(screen.getByRole('combobox', { name: 'Space Design Labs' }), { target: { value: 'civil' } });
    expect(screen.getByText('선형 수정')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '정밀 CAD' }));
    expect(screen.getByText('surface breakline')).toBeTruthy();
    expect(screen.queryByText('sketch')).toBeNull();
    expect(screen.getByTestId('same-design-revision').textContent).toContain('같은 설계 이력');
    expect(getDomainWorkspaceSelection()).toEqual({ domain: 'civil', experience: 'expert', workMode: 'precision_cad' });
    expect(JSON.parse(window.sessionStorage.getItem('nexyfab:domain-workspace:v1') ?? 'null')).toEqual({ domain: 'civil', experience: 'expert', workMode: 'precision_cad' });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'nexyfab:domain-workspace-change' }));
    expect(screen.getByTestId('domain-current-stage').textContent).toContain('정밀 검증');
    expect(screen.getByTestId('guided-domain-return')).toHaveAttribute('href', '/ko/nexyfab/design/?domain=civil&handoff=1');
  });

  it('restores all precision CAD context from a guided-design deep link', () => {
    window.history.replaceState({}, '', '/ko/shape-generator?expert=1&mode=expert&domain=interior&experience=expert&workMode=precision_cad');
    render(<DomainWorkspaceBar lang="ko" />);
    expect(getDomainWorkspaceSelection()).toEqual({ domain: 'interior', experience: 'expert', workMode: 'precision_cad' });
    expect(screen.getByRole('combobox', { name: 'Space Design Labs' })).toHaveValue('interior');
    expect(screen.getByText(/인테리어 모델/)).toBeTruthy();
  });

  it('keeps the public Korean route segment on the return link', () => {
    window.history.replaceState({}, '', '/kr/shape-generator?expert=1&domain=landscape');
    render(<DomainWorkspaceBar lang="kr" />);
    expect(screen.getByRole('combobox', { name: 'Space Design Labs' })).toHaveValue('landscape');
    expect(screen.getByTestId('guided-domain-return')).toHaveAttribute('href', '/kr/nexyfab/design/?domain=landscape&handoff=1');
  });

  it('keeps read-only selections immutable', () => {
    render(<DomainWorkspaceBar lang="en" readOnly />);
    expect(screen.getByTestId('mechanical-core-domain')).toHaveTextContent('AI Mechanical CAD');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'AI design' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Manual edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Precision CAD' })).toBeDisabled();
  });

  it('restores the standard level and shows honest workspace truth states', () => {
    window.history.replaceState({}, '', '/en/shape-generator?experience=standard&workMode=manual');
    render(<DomainWorkspaceBar lang="en" />);
    expect(screen.getByRole('button', { name: 'Manual edit' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('CAD PREVIEW');
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('CHECK NOT_RUN');
    expect(screen.getByTestId('workspace-truth-strip')).toHaveTextContent('RELEASE BLOCKED');
  });

  it('does not expose spatial disciplines as peers in the mechanical workspace', () => {
    render(<DomainWorkspaceBar lang="ko" />);
    expect(screen.getByTestId('mechanical-core-domain')).toHaveTextContent('AI 기계 CAD');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('건축')).toBeNull();
    expect(screen.queryByText('토목')).toBeNull();
  });

  it('surfaces protected user values and only releases them after confirmation', () => {
    protectManualEdit({ kind: 'parameter', objectId: 'feature-1', field: 'height' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DomainWorkspaceBar lang="ko" />);
    expect(screen.getByTestId('manual-edit-lock-count').textContent).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: '잠금 해제' }));
    expect(screen.queryByTestId('manual-edit-lock-count')).toBeNull();
  });
});
