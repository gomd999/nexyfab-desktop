/** @vitest-environment jsdom */
/**
 * OpenScadPanel — spec-verify toggle + parse-error short-circuit.
 *
 * These two tests just lock down the "verify spec" section's UX glue —
 * the heavy contract live in verifySpecRoute.test.ts (route) and
 * verifySpecPanel.test.tsx (presentational).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

// JSCAD worker would otherwise try to spin up a Web Worker in jsdom.
vi.mock('@/app/[lang]/shape-generator/workers/useJscadWorker', () => ({
  useJscadWorker: () => ({ runJscad: vi.fn(async () => { throw new Error('worker disabled in tests'); }) }),
}));

// platform download (writes to disk via showSaveFilePicker) — stub.
vi.mock('@/lib/platform', () => ({
  downloadBlob: vi.fn(async () => {}),
}));

import OpenScadPanel from '@/app/[lang]/shape-generator/openscad/OpenScadPanel';

describe('OpenScadPanel — verify spec section', () => {
  beforeEach(() => {
    // Fresh fetch spy per test so we can assert it was (or wasn't) called.
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      // Initial orgs probe fires on mount — return empty so the panel renders.
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/nexyfab/orgs')) {
        return new Response(JSON.stringify({ orgs: [] }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });
  });

  function mount() {
    return render(<OpenScadPanel onGeometryReady={vi.fn()} />);
  }

  /** The verify section only renders inside the openscad tab, and the
   *  toggle button is gated by scadSource having content — both true on
   *  initial mount (default `cube(...)`). Switch to that tab. */
  function switchToOpenscadTab() {
    // Tab uses the label "🧊 OpenSCAD(.scad)" — match exactly so we don't
    // collide with the runtime-engine note paragraph that also mentions OpenSCAD.
    const tabBtn = screen.getByRole('button', { name: /🧊 OpenSCAD/ });
    fireEvent.click(tabBtn);
  }

  it('toggling "Verify spec" reveals the intent textarea and run button', () => {
    mount();
    switchToOpenscadTab();
    // Section is dormant by default.
    expect(screen.queryByTestId('verify-spec-section')).not.toBeInTheDocument();
    // Click the toggle.
    fireEvent.click(screen.getByTestId('verify-spec-toggle'));
    // Now the section + textarea + button are visible.
    expect(screen.getByTestId('verify-spec-section')).toBeInTheDocument();
    expect(screen.getByTestId('verify-intent-json')).toBeInTheDocument();
    expect(screen.getByTestId('verify-run-button')).toBeInTheDocument();
  });

  it('clicking "Run verify" with invalid JSON shows the parse error and does NOT call /verify-spec', async () => {
    mount();
    switchToOpenscadTab();
    fireEvent.click(screen.getByTestId('verify-spec-toggle'));
    // Type clearly-malformed JSON into the intent textarea.
    fireEvent.change(screen.getByTestId('verify-intent-json'), {
      target: { value: '{ this is not json' },
    });
    // Click run.
    await act(async () => {
      fireEvent.click(screen.getByTestId('verify-run-button'));
    });
    // Parse error surfaced.
    const errBox = screen.getByTestId('verify-error');
    expect(errBox.textContent ?? '').toMatch(/Intent JSON could not be parsed/i);
    // Network was never hit for the verify-spec route.
    const fetchCalls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    for (const [url] of fetchCalls) {
      expect(String(url)).not.toContain('/api/nexyfab/verify-spec');
    }
  });
});
