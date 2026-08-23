// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShellBridge } from '../shellBridgeStore';
import { ModelerLeftPane } from './ModelerLeftPane';
import { ModelerRightPane } from './ModelerRightPane';
import { resetDomainWorkspaceSession, setDomainWorkspaceSelection } from '../domainWorkspaceStore';

describe('precision CAD modeler panes', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    resetDomainWorkspaceSession();
    setDomainWorkspaceSelection({ domain: 'mechanical', experience: 'standard', workMode: 'manual' });
    useShellBridge.setState({
      baseShapeItem: {
        id: 'base:box',
        label: 'Box',
        type: 'baseShape',
        params: { width: 50, height: 30, depth: 20 },
        paramDefs: {
          width: { label: 'Width', min: 1, max: 500, step: 1, unit: 'mm' },
          height: { label: 'Height', min: 1, max: 500, step: 1, unit: 'mm' },
          depth: { label: 'Depth', min: 1, max: 500, step: 1, unit: 'mm' },
        },
      },
      featureItems: [{ id: 'fillet-1', label: 'Fillet', type: 'fillet', params: { radius: 2 } }],
      selectedFeatureId: 'base:box',
      selectedLabel: 'Box',
      volume: 30,
      triangleCount: 12,
    });
  });

  it('shows the base solid as the feature-tree root alongside downstream features', () => {
    render(<ModelerLeftPane lang="en" />);
    expect(screen.getByText('Box')).toBeTruthy();
    expect(screen.getByText('Fillet')).toBeTruthy();
  });

  it('edits base dimensions through the same shell event with real bounds and field identity', () => {
    const listener = vi.fn();
    window.addEventListener('nexyfab:update-feature-param', listener);
    render(<ModelerRightPane lang="en" />);

    const width = screen.getByRole('spinbutton', { name: 'baseShape width' });
    expect(width).toHaveAttribute('id', 'inspector-base-box-width');
    expect(width).toHaveAttribute('name', 'base:box.width');
    expect(width).toHaveAttribute('min', '1');
    expect(width).toHaveAttribute('max', '500');
    expect(width).toHaveAttribute('step', '1');

    fireEvent.change(width, { target: { value: '55' } });
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({ id: 'base:box', key: 'width', value: 55 });
    window.removeEventListener('nexyfab:update-feature-param', listener);
  });

  it('opens the real embedded AI pane from the global Studio action', () => {
    render(<ModelerRightPane lang="en" />);
    act(() => window.dispatchEvent(new CustomEvent('nexyfab:open-right-pane', { detail: { tab: 'ai' } })));
    expect(screen.getByRole('tab', { name: /Nexy AI/i })).toHaveAttribute('aria-selected', 'true');
  });
});
