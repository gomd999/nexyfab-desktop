/** @vitest-environment jsdom */
/**
 * OpenScadPanel — Request-quote section UX glue.
 *
 * Heavy contract lives in requestQuoteRoute.test.ts + the unit tests for
 * the internal provider. These two cases lock down (1) the toggle reveals
 * the process/material/quantity dropdowns + Get-quote button, and (2) the
 * provider dropdown defaults to "internal" with the "Configured" badge in
 * the option label.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

import OpenScadPanel from '@/app/[lang]/shape-generator/openscad/OpenScadPanel';

describe('OpenScadPanel — request-quote section', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
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

  function switchToOpenscadTab() {
    const tabBtn = screen.getByRole('button', { name: /🧊 OpenSCAD/ });
    fireEvent.click(tabBtn);
  }

  it('toggling "Request quote" reveals process/material/quantity inputs + Get-quote button', () => {
    mount();
    switchToOpenscadTab();
    expect(screen.queryByTestId('quote-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('quote-toggle'));
    expect(screen.getByTestId('quote-section')).toBeInTheDocument();
    expect(screen.getByTestId('quote-process')).toBeInTheDocument();
    expect(screen.getByTestId('quote-material')).toBeInTheDocument();
    expect(screen.getByTestId('quote-quantity')).toBeInTheDocument();
    expect(screen.getByTestId('quote-submit')).toBeInTheDocument();
  });

  it('provider selector defaults to "internal" and shows the Configured badge', () => {
    mount();
    switchToOpenscadTab();
    fireEvent.click(screen.getByTestId('quote-toggle'));
    const providerSel = screen.getByTestId('quote-provider') as HTMLSelectElement;
    expect(providerSel.value).toBe('internal');
    // The configured/not-configured marker is in the option text so the user
    // can see it without a separate badge component.
    const internalOpt = providerSel.querySelector('option[value="internal"]') as HTMLOptionElement;
    const xometryOpt = providerSel.querySelector('option[value="xometry"]') as HTMLOptionElement;
    expect(internalOpt.textContent ?? '').toMatch(/Configured/i);
    expect(xometryOpt.textContent ?? '').toMatch(/Not configured/i);
  });
});
