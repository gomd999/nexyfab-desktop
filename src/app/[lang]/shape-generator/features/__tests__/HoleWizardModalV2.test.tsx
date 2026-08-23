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

  // W6 flag flip — default is now V2. The flag-off placeholder only renders
  // when `forceFlagV1` is set (or `?hole-wizard=v1` is in the URL).
  it('renders V2 by default after the W6 flag flip (no force flags)', () => {
    render(<HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} />);
    expect(screen.queryByTestId('hole-wizard-v2-flag-off')).toBeNull();
    expect(screen.getByTestId('hole-wizard-v2-root')).toBeTruthy();
  });

  it('renders the flag-off placeholder when forceFlagV1 is set (rollback path)', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagV1 />,
    );
    expect(screen.getByTestId('hole-wizard-v2-flag-off')).toBeTruthy();
    expect(screen.queryByTestId('hole-wizard-v2-root')).toBeNull();
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

// ─── Track C3 — Termination + Preview tabs (5-tab navigation) ──────────────

describe('HoleWizardModalV2 — Termination + Preview tabs (W3)', () => {
  it('renders all 5 tab buttons including Termination + Preview', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    expect(screen.getByTestId('hole-wizard-v2-tab-type')).toHaveTextContent('Type');
    expect(screen.getByTestId('hole-wizard-v2-tab-size')).toHaveTextContent('Size');
    expect(screen.getByTestId('hole-wizard-v2-tab-position')).toHaveTextContent('Position');
    expect(screen.getByTestId('hole-wizard-v2-tab-termination')).toHaveTextContent('Termination');
    expect(screen.getByTestId('hole-wizard-v2-tab-preview')).toHaveTextContent('Preview');
  });

  it('Termination tab shows 4 mode tiles (blind / through / upToNext / upToFace)', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    expect(screen.getByTestId('hole-wizard-v2-termination-blind')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-termination-through')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-termination-upToNext')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-termination-upToFace')).toBeTruthy();
  });

  it('Blind mode exposes depth + bottom-shape + tip-angle controls', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-blind'));
    expect(screen.getByTestId('hole-wizard-v2-termination-blind-detail')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-termination-depth')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-termination-bottom-flat')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-termination-bottom-conical')).toBeTruthy();
    // Conical default → tip-angle visible
    expect(screen.getByTestId('hole-wizard-v2-termination-tipangle')).toBeTruthy();
  });

  it('Flat-bottom selection hides the drill tip-angle control', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-blind'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-bottom-flat'));
    expect(screen.queryByTestId('hole-wizard-v2-termination-tipangle')).toBeNull();
  });

  it('Up-to-next reports automatic boundary termination without a face picker', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-upToNext'));
    expect(screen.getByTestId('hole-wizard-v2-termination-upToNext-detail')).toHaveTextContent('Up to next');
    expect(screen.queryByTestId('hole-wizard-v2-termination-upToNext-picker')).toBeNull();
  });

  it('Up-to-face renders a disabled face-picker placeholder and disables Apply', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-upToFace'));
    const picker = screen.getByTestId('hole-wizard-v2-termination-upToFace-picker') as HTMLButtonElement;
    expect(picker.disabled).toBe(true);
    // Apply should be disabled — validator flags UPTOFACE_FACE_MISSING.
    const apply = screen.getByTestId('hole-wizard-v2-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('Up-to-face accepts the selected persistent face and commits its id', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2
        open
        lang="en"
        onClose={() => {}}
        onApply={onApply}
        selectedFaceId="face-7"
        forceFlagOpen
      />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-upToFace'));
    expect(screen.getByTestId('hole-wizard-v2-termination-upToFace-picker')).toHaveTextContent('face-7');
    const apply = screen.getByTestId('hole-wizard-v2-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].terminationParams).toEqual({
      kind: 'upToFace',
      faceId: 'face-7',
    });
  });

  it('Preview tab renders the SVG cross-section + summary block', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-preview'));
    expect(screen.getByTestId('hole-wizard-v2-panel-preview')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-preview-summary')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-preview-svg')).toBeTruthy();
  });

  it('Preview SVG re-renders when the hole type changes (drilled → counterbore)', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    // Pick counterbore on Type tab.
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-counterbore'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-preview'));
    const summary = screen.getByTestId('hole-wizard-v2-preview-summary');
    // Counterbore-specific labels appear in the summary.
    expect(summary.textContent).toContain('Counterbore');
  });

  it('Switching Termination → Blind updates the Preview tab depth annotation', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-blind'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-termination-depth'), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-preview'));
    const summary = screen.getByTestId('hole-wizard-v2-preview-summary');
    expect(summary.textContent).toContain('15');
  });

  it('Apply with Blind termination delivers a definition carrying terminationParams.depth', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={onApply} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-blind'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-termination-depth'), {
      target: { value: '12.5' },
    });
    fireEvent.click(screen.getByTestId('hole-wizard-v2-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const def = onApply.mock.calls[0][0];
    expect(def.terminationKind).toBe('blind');
    expect(def.terminationParams.kind).toBe('blind');
    expect(def.terminationParams.depth).toBe(12.5);
    expect(def.holeSpecDetail).toBeDefined();
    expect(def.holeSpecDetail.kind).toBe('drilled');
  });

  it('Apply with counterbore Type delivers a definition with holeSpecDetail.kind=counterbore', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={onApply} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-counterbore'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const def = onApply.mock.calls[0][0];
    expect(def.holeSpecDetail.kind).toBe('counterbore');
    expect(def.holeSpecDetail.headDiameter).toBeGreaterThan(def.holeSpecDetail.diameter);
  });
});

// ─── Track C4 — fromSketch + tap class + TAP_BOTTOM_RISK (W4) ──────────────

const SAMPLE_SKETCHES = [
  {
    featureId: 'sketch-1',
    label: 'Top face sketch',
    points: [
      { id: 'p1', x: 10, y: 10 },
      { id: 'p2', x: 30, y: 10 },
      { id: 'p3', x: 10, y: 50 },
      { id: 'p4', x: 30, y: 50 },
    ],
  },
  {
    featureId: 'sketch-2',
    label: 'Side face sketch',
    points: [{ id: 'q1', x: 0, y: 0 }],
  },
];

describe('HoleWizardModalV2 — fromSketch Position mode (W4)', () => {
  it('renders an empty-state when no sketches are available', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-fromSketch'));
    expect(screen.getByTestId('hole-wizard-v2-fromSketch-empty')).toBeTruthy();
  });

  it('renders a sketch picker dropdown when sketches are provided', () => {
    render(
      <HoleWizardModalV2
        open
        lang="en"
        onClose={() => {}}
        onApply={() => {}}
        forceFlagOpen
        availableSketches={SAMPLE_SKETCHES}
      />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-fromSketch'));
    const picker = screen.getByTestId('hole-wizard-v2-fromSketch-picker') as HTMLSelectElement;
    expect(picker).toBeTruthy();
    // 2 sketches + 1 empty-option
    expect(picker.options.length).toBe(3);
  });

  it('selecting a sketch shows its point count + bounding box', () => {
    render(
      <HoleWizardModalV2
        open
        lang="en"
        onClose={() => {}}
        onApply={() => {}}
        forceFlagOpen
        availableSketches={SAMPLE_SKETCHES}
      />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-fromSketch'));
    const picker = screen.getByTestId('hole-wizard-v2-fromSketch-picker') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'sketch-1' } });
    expect(screen.getByTestId('hole-wizard-v2-fromSketch-pointCount').textContent).toContain('4');
    // Bounding box: 30-10 = 20 wide, 50-10 = 40 tall.
    expect(screen.getByTestId('hole-wizard-v2-fromSketch-bbox').textContent).toContain('20');
    expect(screen.getByTestId('hole-wizard-v2-fromSketch-bbox').textContent).toContain('40');
  });

  it('Apply with fromSketch delivers a definition with the picked sketch id', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2
        open
        lang="en"
        onClose={() => {}}
        onApply={onApply}
        forceFlagOpen
        availableSketches={SAMPLE_SKETCHES}
      />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-fromSketch'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-fromSketch-picker'), {
      target: { value: 'sketch-1' },
    });
    fireEvent.click(screen.getByTestId('hole-wizard-v2-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const def = onApply.mock.calls[0][0];
    expect(def.kind).toBe('fromSketch');
    expect(def.params.kind).toBe('fromSketch');
    expect(def.params.data.sketchFeatureId).toBe('sketch-1');
  });

  it('footer reflects the live sketch-point count for the selected sketch', () => {
    render(
      <HoleWizardModalV2
        open
        lang="en"
        onClose={() => {}}
        onApply={() => {}}
        forceFlagOpen
        availableSketches={SAMPLE_SKETCHES}
      />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-fromSketch'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-fromSketch-picker'), {
      target: { value: 'sketch-1' },
    });
    // sketch-1 has 4 points → footer should report 4 positions
    expect(screen.getByTestId('hole-wizard-v2-count').textContent).toContain('4');
  });
});

describe('HoleWizardModalV2 — tap class picker (W4)', () => {
  it('tap-class panel is hidden when holeType !== tap', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    expect(screen.queryByTestId('hole-wizard-v2-tap-class-panel')).toBeNull();
  });

  it('tap-class panel appears when Type=tap and shows 4 tile buttons', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-tap'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    expect(screen.getByTestId('hole-wizard-v2-tap-class-panel')).toBeTruthy();
    for (const c of ['6H', '6G', '2B', '3B']) {
      expect(screen.getByTestId(`hole-wizard-v2-tapclass-${c}`)).toBeTruthy();
    }
  });

  it('Apply with tap class override carries the override into holeSpecDetail.tapClass', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={onApply} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-tap'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tapclass-6G'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const def = onApply.mock.calls[0][0];
    expect(def.holeSpecDetail.kind).toBe('tap');
    expect(def.holeSpecDetail.tapClass).toBe('6G');
  });
});

describe('HoleWizardModalV2 — TAP_BOTTOM_RISK warning (W4)', () => {
  it('shows the warning banner when blind+tap+tapDepth too close to drill bottom', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-tap'));
    // Pick M6 (pitch 1.0, tap-drill 5) — default tap depth = 10 mm.
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-designation-M6'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-blind'));
    // Drill depth 11 mm → margin 1 mm < 2 × pitch (2.0) → warning trips.
    fireEvent.change(screen.getByTestId('hole-wizard-v2-termination-depth'), {
      target: { value: '11' },
    });
    expect(screen.getByTestId('hole-wizard-v2-tap-bottom-risk')).toBeTruthy();
  });

  it('does NOT show the warning for through-all tap (rule scoped to blind)', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-tap'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    // Default termination is 'through' — warning must not appear.
    expect(screen.queryByTestId('hole-wizard-v2-tap-bottom-risk')).toBeNull();
  });

  it('does NOT show the warning for drilled hole even with same depth (rule scoped to tap)', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    // Default holeType = drilled.
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-blind'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-termination-depth'), {
      target: { value: '5' },
    });
    expect(screen.queryByTestId('hole-wizard-v2-tap-bottom-risk')).toBeNull();
  });

  it('warning clears when depth grows past the 2×pitch threshold', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-tap'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-designation-M6'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-termination'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-termination-blind'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-termination-depth'), {
      target: { value: '11' },
    });
    expect(screen.getByTestId('hole-wizard-v2-tap-bottom-risk')).toBeTruthy();
    // Increase depth to 20 → margin = 10 mm >> 2 mm → warning clears.
    fireEvent.change(screen.getByTestId('hole-wizard-v2-termination-depth'), {
      target: { value: '20' },
    });
    expect(screen.queryByTestId('hole-wizard-v2-tap-bottom-risk')).toBeNull();
  });
});

describe('HoleWizardModalV2 — counterdrill Preview (W4)', () => {
  it('Preview summary lists middle-step diameter + depth for counterdrill', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-counterdrill'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-preview'));
    const summary = screen.getByTestId('hole-wizard-v2-preview-summary');
    expect(summary.textContent).toContain('Middle');
  });
});

// ─── W5 — Track C5: linear2D + CSV paste + pipe-tap class picker ───────────

describe('HoleWizardModalV2 — linear2D Position mode (W5)', () => {
  it('renders a linear2D tile in the position-kind picker', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    expect(screen.getByTestId('hole-wizard-v2-position-linear2D')).toBeTruthy();
  });

  it('switching to linear2D shows row/col + dxRow/dyRow/dxCol/dyCol inputs', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-linear2D'));
    expect(screen.getByTestId('hole-wizard-v2-linear2D-panel')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-linear2D-rows')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-linear2D-cols')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-linear2D-dxRow')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-linear2D-dyRow')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-linear2D-dxCol')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-linear2D-dyCol')).toBeTruthy();
  });

  it('Apply with linear2D delivers a definition kind=linear2D', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={onApply} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-linear2D'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const def = onApply.mock.calls[0][0];
    expect(def.kind).toBe('linear2D');
    expect(def.params.kind).toBe('linear2D');
  });

  it('count footer reflects 2×3=6 positions for default linear2D', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-linear2D'));
    // Default rows=2, cols=3 → 6 positions
    expect(screen.getByTestId('hole-wizard-v2-count').textContent).toContain('6');
  });
});

describe('HoleWizardModalV2 — circular partialAngle + direction (W5)', () => {
  it('renders partialAngle + direction inputs for circular position kind', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-circular'));
    expect(screen.getByTestId('hole-wizard-v2-circular-partialAngle')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-circular-direction-ccw')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-circular-direction-cw')).toBeTruthy();
  });

  it('setting direction=CW updates the live position count without breaking it', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-circular'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-circular-direction-cw'));
    // Full circle still produces count=6 positions for the default factory.
    expect(screen.getByTestId('hole-wizard-v2-count').textContent).toContain('6');
  });
});

describe('HoleWizardModalV2 — CSV paste sub-mode (W5)', () => {
  it('manual mode shows Edit + CSV sub-mode toggle buttons', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-manual'));
    expect(screen.getByTestId('hole-wizard-v2-manual-submode-edit')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-manual-submode-csv')).toBeTruthy();
  });

  it('CSV sub-mode renders a textarea + Parse button', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-manual'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-manual-submode-csv'));
    expect(screen.getByTestId('hole-wizard-v2-csv-textarea')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-csv-parse')).toBeTruthy();
  });

  it('pasting + parsing valid CSV shows a preview with the parsed point count', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-manual'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-manual-submode-csv'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-csv-textarea'), {
      target: { value: '10, 20\n30, 40\n50, 60' },
    });
    fireEvent.click(screen.getByTestId('hole-wizard-v2-csv-parse'));
    expect(screen.getByTestId('hole-wizard-v2-csv-preview')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-csv-parsed-count').textContent).toContain('3');
  });

  it('Use-as-Manual swaps the parsed points into the manual mode table', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-manual'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-manual-submode-csv'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-csv-textarea'), {
      target: { value: '10, 20\n30, 40' },
    });
    fireEvent.click(screen.getByTestId('hole-wizard-v2-csv-parse'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-csv-use'));
    // After commit, we flip back to edit mode and see the manual table.
    expect(screen.getByTestId('hole-wizard-v2-manual-table')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-manual-x-0')).toBeTruthy();
    expect(screen.getByTestId('hole-wizard-v2-manual-x-1')).toBeTruthy();
  });

  it('malformed CSV row is reported with line number', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-position'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-position-manual'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-manual-submode-csv'));
    fireEvent.change(screen.getByTestId('hole-wizard-v2-csv-textarea'), {
      target: { value: '10, 20\nfoo, bar\n30, 40' },
    });
    fireEvent.click(screen.getByTestId('hole-wizard-v2-csv-parse'));
    expect(screen.getByTestId('hole-wizard-v2-csv-errors')).toBeTruthy();
    // Error message mentions "line 2"
    expect(screen.getByTestId('hole-wizard-v2-csv-error-0').textContent).toContain('line 2');
  });
});

describe('HoleWizardModalV2 — pipe-tap class picker (W5)', () => {
  it('pipe-tap class panel is hidden when holeType !== pipeTap', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    expect(screen.queryByTestId('hole-wizard-v2-pipetap-class-panel')).toBeNull();
  });

  it('pipe-tap class panel appears when Type=pipeTap with 4 buttons', () => {
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={() => {}} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-pipeTap'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    expect(screen.getByTestId('hole-wizard-v2-pipetap-class-panel')).toBeTruthy();
    for (const pc of ['NPT', 'NPSM', 'BSP_taper', 'BSP_parallel']) {
      expect(screen.getByTestId(`hole-wizard-v2-pipetapclass-${pc}`)).toBeTruthy();
    }
  });

  it('Apply with pipe-tap NPSM override carries pipeTapClass=NPSM + taperAngle=0', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={onApply} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-pipeTap'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-tab-size'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-pipetapclass-NPSM'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const def = onApply.mock.calls[0][0];
    expect(def.holeSpecDetail.kind).toBe('pipe_tap');
    expect(def.holeSpecDetail.pipeTapClass).toBe('NPSM');
    expect(def.holeSpecDetail.taperAngle).toBe(0);
  });

  it('default pipe-tap Apply (no override) carries pipeTapClass=NPT + taperAngle≈1.7833', () => {
    const onApply = vi.fn();
    render(
      <HoleWizardModalV2 open lang="en" onClose={() => {}} onApply={onApply} forceFlagOpen />,
    );
    fireEvent.click(screen.getByTestId('hole-wizard-v2-type-pipeTap'));
    fireEvent.click(screen.getByTestId('hole-wizard-v2-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const def = onApply.mock.calls[0][0];
    expect(def.holeSpecDetail.pipeTapClass).toBe('NPT');
    expect(def.holeSpecDetail.taperAngle).toBeCloseTo(1.7833, 4);
  });
});
