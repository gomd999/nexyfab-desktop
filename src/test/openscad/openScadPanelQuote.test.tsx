/** @vitest-environment jsdom */
/**
 * OpenScadPanel — CAD-only product boundary.
 * Quote/RFQ controls must not be exposed from the modeling workspace.
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

describe('OpenScadPanel — quote flow removed', () => {
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

  it('does not expose quote controls from the OpenSCAD workspace', () => {
    mount();
    switchToOpenscadTab();
    expect(screen.queryByTestId('quote-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quote-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quote-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quote-provider')).not.toBeInTheDocument();
  });
});
