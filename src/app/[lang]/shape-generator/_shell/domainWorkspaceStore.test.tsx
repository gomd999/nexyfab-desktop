// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DOMAIN_WORKSPACE_STORAGE_KEY,
  getDomainWorkspaceSelection,
  resetDomainWorkspaceSession,
  setDomainWorkspaceSelection,
  useDomainWorkspaceSelection,
} from './domainWorkspaceStore';

describe('domain workspace shared state', () => {
  beforeEach(() => resetDomainWorkspaceSession());

  it('hydrates a valid session selection for every workspace consumer', () => {
    window.sessionStorage.setItem(DOMAIN_WORKSPACE_STORAGE_KEY, JSON.stringify({ domain: 'interior', experience: 'expert' }));
    const { result } = renderHook(() => useDomainWorkspaceSelection());
    expect(result.current[0]).toEqual({ domain: 'interior', experience: 'expert', workMode: 'ai_assisted' });
  });

  it('rejects invalid state and publishes valid changes', () => {
    window.sessionStorage.setItem(DOMAIN_WORKSPACE_STORAGE_KEY, JSON.stringify({ domain: 'unknown', experience: 'expert' }));
    renderHook(() => useDomainWorkspaceSelection());
    expect(getDomainWorkspaceSelection()).toEqual({ domain: 'mechanical', experience: 'guided', workMode: 'ai_assisted' });
    act(() => setDomainWorkspaceSelection({ domain: 'landscape', experience: 'guided' }));
    expect(getDomainWorkspaceSelection().domain).toBe('landscape');
  });

  it('shares AI, manual and precision CAD modes without changing domain or experience', () => {
    act(() => setDomainWorkspaceSelection(current => ({ ...current, workMode: 'precision_cad' })));
    expect(getDomainWorkspaceSelection()).toEqual({ domain: 'mechanical', experience: 'guided', workMode: 'precision_cad' });
  });
});
