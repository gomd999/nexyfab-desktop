/** @vitest-environment jsdom */
/**
 * OpenScadPanel — Image-to-CAD section UX glue.
 *
 * Heavy contract lives in imageIntentRoute.test.ts. These two cases just
 * lock down that (1) the toggle reveals the file input + extract button,
 * and (2) a failed extraction surfaces the localized error message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

// JSCAD worker would otherwise try to spin up a Web Worker in jsdom.
vi.mock('@/app/[lang]/shape-generator/workers/useJscadWorker', () => ({
  useJscadWorker: () => ({ runJscad: vi.fn(async () => { throw new Error('worker disabled in tests'); }) }),
}));

vi.mock('@/lib/platform', () => ({
  downloadBlob: vi.fn(async () => {}),
}));

import OpenScadPanel from '@/app/[lang]/shape-generator/openscad/OpenScadPanel';

describe('OpenScadPanel — image-to-CAD section', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/nexyfab/orgs')) {
        return new Response(JSON.stringify({ orgs: [] }), { status: 200 });
      }
      if (url.includes('/api/nexyfab/intent-from-image')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Image-to-CAD requires Pro plan', code: 'PLAN_LOCKED' }),
          { status: 403 },
        );
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

  it('toggling "Image-to-CAD" reveals the file input + hint field + extract button', () => {
    mount();
    switchToOpenscadTab();
    expect(screen.queryByTestId('image-intent-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('image-intent-toggle'));
    expect(screen.getByTestId('image-intent-section')).toBeInTheDocument();
    expect(screen.getByTestId('image-intent-file')).toBeInTheDocument();
    expect(screen.getByTestId('image-intent-hint')).toBeInTheDocument();
    const extractBtn = screen.getByTestId('image-intent-extract');
    expect(extractBtn).toBeInTheDocument();
    // Extract button stays disabled until a file is picked.
    expect((extractBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('a 403 PLAN_LOCKED response surfaces a localized error in the inline error slot', async () => {
    mount();
    switchToOpenscadTab();
    fireEvent.click(screen.getByTestId('image-intent-toggle'));

    // Simulate a successful FileReader so the dataURL gets populated.
    class StubReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';
        // Defer to the next tick so React's setState is in a batch.
        setTimeout(() => this.onload?.(), 0);
      }
    }
    const origReader = global.FileReader;
    (global as unknown as { FileReader: typeof FileReader }).FileReader = StubReader as unknown as typeof FileReader;
    try {
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'part.png', { type: 'image/png' });
      const input = screen.getByTestId('image-intent-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [file] });
      await act(async () => {
        fireEvent.change(input);
        // Let the StubReader's setTimeout fire so onload runs.
        await new Promise(r => setTimeout(r, 0));
      });

      // Now the extract button should be enabled.
      const extractBtn = screen.getByTestId('image-intent-extract') as HTMLButtonElement;
      await waitFor(() => expect(extractBtn.disabled).toBe(false));

      await act(async () => {
        fireEvent.click(extractBtn);
      });
      // Wait for fetch + state update.
      const errBox = await screen.findByTestId('image-intent-error');
      expect(errBox.textContent ?? '').toMatch(/Pro plan/i);
    } finally {
      global.FileReader = origReader;
    }
  });
});
