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

  it('switches domain, audience and precision mode on the same design revision', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    render(<DomainWorkspaceBar lang="ko" />);
    fireEvent.change(screen.getByRole('combobox', { name: '설계 분야' }), { target: { value: 'civil' } });
    expect(screen.getByText('선형 수정')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '전문가' }));
    expect(screen.getByText('surface breakline')).toBeTruthy();
    expect(screen.queryByText('sketch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '정밀 CAD' }));
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
    expect(screen.getByRole('combobox', { name: '설계 분야' })).toHaveValue('interior');
    expect(screen.getByText(/인테리어 모델/)).toBeTruthy();
  });

  it('keeps the public Korean route segment on the return link', () => {
    window.history.replaceState({}, '', '/kr/shape-generator?expert=1&domain=landscape');
    render(<DomainWorkspaceBar lang="kr" />);
    expect(screen.getByRole('combobox', { name: '설계 분야' })).toHaveValue('landscape');
    expect(screen.getByTestId('guided-domain-return')).toHaveAttribute('href', '/kr/nexyfab/design/?domain=landscape&handoff=1');
  });

  it('keeps read-only selections immutable', () => {
    render(<DomainWorkspaceBar lang="en" readOnly />);
    expect(screen.getByRole('combobox', { name: 'Design domain' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Expert' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Precision CAD' })).toBeDisabled();
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
