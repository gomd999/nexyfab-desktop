/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/navigation to avoid the App-Router context requirement.
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
  useSearchParams: () => new URLSearchParams(),
}));

import HoleWizardModalV2 from '../HoleWizardModalV2';

/**
 * Track C2 modal skeleton render test. We use `forceFlagOpen` to bypass the
 * `?hole-wizard=v2` query-string gate so the same suite can run in jsdom
 * without polluting global window state.
 */

describe('HoleWizardModalV2 — skeleton render', () => {
  it('returns nothing visible when open=false', () => {
    const { container } = render(
      <HoleWizardModalV2 open={false} lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the flag-off placeholder when the flag is missing', () => {
    render(<HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} />);
    expect(screen.getByTestId('hole-wizard-v2-flag-off')).toBeTruthy();
  });

  it('renders all three tabs with the EN labels', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    expect(screen.getByTestId('hole-wizard-v2-tab-type')).toHaveTextContent('Type');
    expect(screen.getByTestId('hole-wizard-v2-tab-size')).toHaveTextContent('Size');
    expect(screen.getByTestId('hole-wizard-v2-tab-position')).toHaveTextContent('Position');
  });

  it('opens the Type panel by default', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    expect(screen.getByTestId('hole-wizard-v2-panel-type')).toBeTruthy();
    expect(screen.queryByTestId('hole-wizard-v2-panel-size')).toBeNull();
    expect(screen.queryByTestId('hole-wizard-v2-panel-position')).toBeNull();
  });

  it('switches to the Size panel when its tab is clicked', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    expect(screen.getByTestId('hole-wizard-v2-panel-size')).toBeTruthy();
    expect(screen.queryByTestId('hole-wizard-v2-panel-type')).toBeNull();
  });

  it('switches to the Position panel and shows linear-pattern inputs', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    // Default position kind is 'linear'
    expect(screen.getByTestId('hole-wizard-v2-linear-count')).toBeTruthy();
  });

  it('renders all six hole-type tiles', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    for (const k of ['drilled', 'counterbore', 'countersink', 'counterdrill', 'tap', 'pipeTap'] as const) {
      expect(screen.getByTestId(`hole-wizard-v2-type-${k}`)).toBeTruthy();
    }
  });

  it('reflows the Size catalog after switching series (ISO → NPT)', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    // M3 designation exists in ISO catalog
    expect(screen.getByTestId('hole-wizard-v2-designation-M3')).toBeTruthy();
    fireEvent.click(screen.getByTestId('hole-wizard-v2-series-NPT'));
    // After switching, M3 disappears (NPT has its own designations)
    expect(screen.queryByTestId('hole-wizard-v2-designation-M3')).toBeNull();
  });

  it('switching Position kind reseeds the panel inputs (linear → circular)', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    expect(screen.getByTestId('hole-wizard-v2-linear-count')).toBeTruthy();
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-circular'));
    expect(screen.queryByTestId('hole-wizard-v2-linear-count')).toBeNull();
    expect(screen.getByTestId('hole-wizard-v2-circular-radius')).toBeTruthy();
  });

  it('Apply button delivers a HoleArrayDefinition with the picked size + position kind', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={onApply} forceFlagOpen />,
    );
    // Pick M5 via Size tab
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-designation-M5'));
    // Switch to circular on Position tab
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-circular'));
    // Apply
    fireEvent.click(screen.getByTestId('hole-wizard-v2-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const def = onApply.mock.calls[0][0];
    expect(def.kind).toBe('circular');
    expect(def.holeSpec.series).toBe('ISO');
    expect(def.holeSpec.designation).toBe('M5');
  });

  it('renders KR (Korean) labels when lang=ko on /ko/... pathname', () => {
    // Re-import via a fresh module mock with KR pathname
    vi.resetModules();
    vi.doMock('next/navigation', () => ({
      usePathname: () => '/ko/nexyfab/shape',
      useSearchParams: () => new URLSearchParams(),
    }));
    return import('../HoleWizardModalV2').then((mod) => {
      const KrModal = mod.default;
      render(
        <KrModal open lang="ko" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
      );
      // 유형 = Type in Korean
      expect(screen.getByTestId('hole-wizard-v2-tab-type')).toHaveTextContent('유형');
    });
  });

  it('disables Apply when validation fails (linear with count=0)', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    const countInput = screen.getByTestId('hole-wizard-v2-linear-count') as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '0' } });
    const apply = screen.getByTestId('hole-wizard-v2-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });
});
