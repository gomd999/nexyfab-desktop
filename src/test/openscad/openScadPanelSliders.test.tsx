/** @vitest-environment jsdom */
/**
 * OpenScadPanel — live-preview slider section under "Verify spec".
 *
 * These tests pin the visibility gate (no verify → no sliders) and the
 * core interactions (apply / reset / auto-verify toggle). Debounce timing
 * is asserted via vi.useFakeTimers + a runVerify spy through `fetch`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

vi.mock('@/app/[lang]/shape-generator/workers/useJscadWorker', () => ({
  useJscadWorker: () => ({ runJscad: vi.fn(async () => { throw new Error('worker disabled in tests'); }) }),
}));

vi.mock('@/lib/platform', () => ({
  downloadBlob: vi.fn(async () => {}),
}));

import OpenScadPanel, {
  extractNumericPaths,
  applySliderValuesToIntent,
  intentToJsonString,
} from '@/app/[lang]/shape-generator/openscad/OpenScadPanel';
import type { SpecVerificationResult } from '@/lib/ai/scad-agent/specVerification';

const VALID_INTENT_JSON = JSON.stringify({
  shapeId: 'box',
  params: { width: 50, height: 60, depth: 50 },
  features: [
    { type: 'hole', params: { diameter: 8, x: 10, y: 10 } },
  ],
});

function mkVerifyOkResult(): SpecVerificationResult {
  return {
    ok: true,
    verifiable: true,
    mismatches: [],
    expected: { wMm: 50, hMm: 60, dMm: 50 } as unknown as SpecVerificationResult['expected'],
    measured: { wMm: 50, hMm: 60, dMm: 50 },
  };
}

function mkVerifyNotVerifiable(): SpecVerificationResult {
  return {
    ok: false,
    verifiable: false,
    skipReason: 'bbox unknowable',
    mismatches: [],
  };
}

describe('OpenScadPanel helpers', () => {
  it('extractNumericPaths walks params + features[*].params', () => {
    const intent = {
      shapeId: 'box',
      params: { width: 50, label: 'ignore-me', height: 60 },
      features: [
        { type: 'hole', params: { diameter: 8, deep: true } },
        { type: 'fillet', params: { radius: 2 } },
      ],
    };
    const rows = extractNumericPaths(intent);
    const paths = rows.map(r => r.path).sort();
    expect(paths).toEqual([
      'features[0].params.diameter',
      'features[1].params.radius',
      'params.height',
      'params.width',
    ]);
    const width = rows.find(r => r.path === 'params.width');
    expect(width?.minRange).toBeCloseTo(5);
    expect(width?.maxRange).toBeCloseTo(250);
  });

  it('extractNumericPaths handles non-object / missing fields safely', () => {
    expect(extractNumericPaths(null)).toEqual([]);
    expect(extractNumericPaths('nope')).toEqual([]);
    expect(extractNumericPaths({})).toEqual([]);
    expect(extractNumericPaths({ params: 'not-object' })).toEqual([]);
    expect(extractNumericPaths({ features: [{ params: { x: 1 } }] })).toEqual([
      { path: 'features[0].params.x', value: 1, minRange: 0.1, maxRange: 5 },
    ]);
  });

  it('applySliderValuesToIntent plugs values at the right paths without mutating original', () => {
    const intent = {
      shapeId: 'box',
      params: { width: 50, height: 60 },
      features: [{ type: 'hole', params: { diameter: 8 } }],
    };
    const updated = applySliderValuesToIntent(intent, new Map([
      ['params.width', 75],
      ['features[0].params.diameter', 10],
      ['unknown.path', 999],
    ])) as typeof intent;
    expect(updated.params.width).toBe(75);
    expect(updated.params.height).toBe(60);
    expect(updated.features[0].params.diameter).toBe(10);
    // Original is untouched.
    expect(intent.params.width).toBe(50);
    expect(intent.features[0].params.diameter).toBe(8);
  });

  it('intentToJsonString round-trips through JSON.parse', () => {
    const intent = { shapeId: 'box', params: { width: 50 } };
    const str = intentToJsonString(intent);
    expect(JSON.parse(str)).toEqual(intent);
    expect(str).toContain('\n'); // pretty-printed
  });
});

describe('OpenScadPanel — slider UI integration', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let verifyCallCount: number;
  let verifyResultToReturn: SpecVerificationResult;

  beforeEach(() => {
    verifyCallCount = 0;
    verifyResultToReturn = mkVerifyOkResult();
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/nexyfab/orgs')) {
        return new Response(JSON.stringify({ orgs: [] }), { status: 200 });
      }
      if (url.includes('/api/nexyfab/verify-spec')) {
        verifyCallCount++;
        return new Response(
          JSON.stringify({ ok: true, result: verifyResultToReturn }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  function mount() {
    return render(<OpenScadPanel onGeometryReady={vi.fn()} />);
  }

  function switchToOpenscadTab() {
    fireEvent.click(screen.getByRole('button', { name: /🧊 OpenSCAD/ }));
  }

  function openVerifySection() {
    fireEvent.click(screen.getByTestId('verify-spec-toggle'));
  }

  async function pasteAndVerify(jsonStr: string = VALID_INTENT_JSON) {
    fireEvent.change(screen.getByTestId('verify-intent-json'), {
      target: { value: jsonStr },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('verify-run-button'));
    });
  }

  it('sliders are hidden BEFORE the first successful verify', () => {
    mount();
    switchToOpenscadTab();
    openVerifySection();
    // Paste valid intent but don't click verify.
    fireEvent.change(screen.getByTestId('verify-intent-json'), {
      target: { value: VALID_INTENT_JSON },
    });
    expect(screen.queryByTestId('verify-sliders-section')).not.toBeInTheDocument();
  });

  it('sliders are hidden when verify returns verifiable=false', async () => {
    verifyResultToReturn = mkVerifyNotVerifiable();
    mount();
    switchToOpenscadTab();
    openVerifySection();
    await pasteAndVerify();
    expect(screen.queryByTestId('verify-sliders-section')).not.toBeInTheDocument();
  });

  it('sliders appear with one row per numeric param after successful verify', async () => {
    mount();
    switchToOpenscadTab();
    openVerifySection();
    await pasteAndVerify();
    expect(screen.getByTestId('verify-sliders-section')).toBeInTheDocument();
    // Intent has 3 params (w/h/d) + 3 feature params (diameter/x/y) = 6 rows.
    expect(screen.getByTestId('verify-slider-params.width')).toBeInTheDocument();
    expect(screen.getByTestId('verify-slider-params.height')).toBeInTheDocument();
    expect(screen.getByTestId('verify-slider-params.depth')).toBeInTheDocument();
    expect(screen.getByTestId('verify-slider-features[0].params.diameter')).toBeInTheDocument();
  });

  it('"Apply to JSON" rewrites the textarea with current slider values', async () => {
    mount();
    switchToOpenscadTab();
    openVerifySection();
    await pasteAndVerify();
    // Move width slider to 75.
    fireEvent.change(screen.getByTestId('verify-slider-params.width'), {
      target: { value: '75' },
    });
    // Click Apply.
    fireEvent.click(screen.getByTestId('verify-slider-apply'));
    const textarea = screen.getByTestId('verify-intent-json') as HTMLTextAreaElement;
    const parsed = JSON.parse(textarea.value);
    expect(parsed.params.width).toBe(75);
    expect(parsed.params.height).toBe(60);
  });

  it('Auto-verify OFF: slider change does NOT trigger /verify-spec', async () => {
    vi.useFakeTimers();
    mount();
    switchToOpenscadTab();
    openVerifySection();
    // Initial verify (uses real timers via act-microtask is fine).
    await pasteAndVerify();
    const callsAfterInitial = verifyCallCount;
    // Turn auto-verify OFF.
    fireEvent.click(screen.getByTestId('verify-slider-auto-toggle'));
    // Move a slider.
    fireEvent.change(screen.getByTestId('verify-slider-params.width'), {
      target: { value: '70' },
    });
    // Advance well past the 800ms debounce.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(verifyCallCount).toBe(callsAfterInitial);
  });

  it('Reset restores snapshot values after slider edits', async () => {
    mount();
    switchToOpenscadTab();
    openVerifySection();
    await pasteAndVerify();
    const widthSlider = screen.getByTestId('verify-slider-params.width') as HTMLInputElement;
    expect(widthSlider.value).toBe('50');
    fireEvent.change(widthSlider, { target: { value: '75' } });
    expect((screen.getByTestId('verify-slider-params.width') as HTMLInputElement).value).toBe('75');
    fireEvent.click(screen.getByTestId('verify-slider-reset'));
    expect((screen.getByTestId('verify-slider-params.width') as HTMLInputElement).value).toBe('50');
  });

  it('Auto-verify ON: slider change triggers /verify-spec after 800ms debounce', async () => {
    vi.useFakeTimers();
    mount();
    switchToOpenscadTab();
    openVerifySection();
    await pasteAndVerify();
    const callsAfterInitial = verifyCallCount;
    // Move slider.
    fireEvent.change(screen.getByTestId('verify-slider-params.width'), {
      target: { value: '70' },
    });
    // Less than 800ms — no call yet.
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(verifyCallCount).toBe(callsAfterInitial);
    // Cross the 800ms threshold.
    await act(async () => { vi.advanceTimersByTime(400); });
    // Allow the awaited fetch promise to settle.
    await act(async () => { await Promise.resolve(); });
    expect(verifyCallCount).toBeGreaterThan(callsAfterInitial);
  });
});
