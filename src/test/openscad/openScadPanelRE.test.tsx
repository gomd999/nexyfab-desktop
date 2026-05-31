/** @vitest-environment jsdom */
/**
 * OpenScadPanel — Reverse-engineer section UX glue.
 *
 * Heavy contract lives in reverseEngineerRoute.test.ts. These two cases
 * lock down (1) the toggle reveals the file input + analyze button, and
 * (2) a failed analyze surfaces the localized error message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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

describe('OpenScadPanel — reverse-engineer section', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/nexyfab/orgs')) {
        return new Response(JSON.stringify({ orgs: [] }), { status: 200 });
      }
      if (url.includes('/api/nexyfab/reverse-engineer')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Reverse engineering requires Pro plan', code: 'PLAN_LOCKED' }),
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

  it('toggling "Reverse engineer" reveals the file input + analyze button', () => {
    mount();
    switchToOpenscadTab();
    expect(screen.queryByTestId('reverse-engineer-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reverse-engineer-toggle'));
    expect(screen.getByTestId('reverse-engineer-section')).toBeInTheDocument();
    expect(screen.getByTestId('reverse-engineer-file')).toBeInTheDocument();
    const analyzeBtn = screen.getByTestId('reverse-engineer-analyze');
    expect(analyzeBtn).toBeInTheDocument();
    // Analyze button stays disabled until a file is picked.
    expect((analyzeBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('a 403 PLAN_LOCKED response surfaces a localized error in the inline error slot', async () => {
    mount();
    switchToOpenscadTab();
    fireEvent.click(screen.getByTestId('reverse-engineer-toggle'));

    // Stub FileReader so the dataURL gets populated synchronously enough
    // for the test to drive through to the fetch.
    class StubReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.result = 'data:application/octet-stream;base64,c29saWQgbW9jaw==';
        setTimeout(() => this.onload?.(), 0);
      }
    }
    const origReader = global.FileReader;
    (global as unknown as { FileReader: typeof FileReader }).FileReader = StubReader as unknown as typeof FileReader;
    try {
      const file = new File([new Uint8Array([0x73, 0x6f, 0x6c, 0x69, 0x64])], 'part.stl', { type: 'application/octet-stream' });
      const input = screen.getByTestId('reverse-engineer-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [file] });
      await act(async () => {
        fireEvent.change(input);
        await new Promise(r => setTimeout(r, 0));
      });

      const analyzeBtn = screen.getByTestId('reverse-engineer-analyze') as HTMLButtonElement;
      await waitFor(() => expect(analyzeBtn.disabled).toBe(false));

      await act(async () => {
        fireEvent.click(analyzeBtn);
      });
      const errBox = await screen.findByTestId('reverse-engineer-error');
      expect(errBox.textContent ?? '').toMatch(/Pro plan/i);
    } finally {
      global.FileReader = origReader;
    }
  });
});
