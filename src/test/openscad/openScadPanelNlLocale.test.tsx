/** @vitest-environment jsdom */
/**
 * OpenScadPanel — non-Korean locale regression for the natural-language SCAD
 * section (260802 i18n audit, shape-generator batch 4).
 *
 * Three real bugs were found and fixed here:
 *  1. The "Free-form" / "Image" checkbox labels bypassed the dict and did a
 *     bare `lang === 'ko' ? KOREAN : ENGLISH` ternary, so ja/zh/es/ar users
 *     saw English instead of their own language.
 *  2. The oversized-image error message was a hardcoded Korean string with
 *     no language branch at all — every locale saw Korean.
 *  3. `EXAMPLE_PROMPTS` (the clickable chip suggestions on the generate tab)
 *     was a single Korean-only array rendered for every locale.
 *
 * These tests mount the panel on a non-en/non-ko route (`/ja/...`) and
 * assert the Japanese dict strings render instead of the English or Korean
 * fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/ja/nexyfab/shape',
}));

// JSCAD worker would otherwise try to spin up a Web Worker in jsdom.
vi.mock('@/app/[lang]/shape-generator/workers/useJscadWorker', () => ({
  useJscadWorker: () => ({ runJscad: vi.fn(async () => { throw new Error('worker disabled in tests'); }) }),
}));

vi.mock('@/lib/platform', () => ({
  downloadBlob: vi.fn(async () => {}),
}));

import OpenScadPanel from '@/app/[lang]/shape-generator/openscad/OpenScadPanel';

describe('OpenScadPanel — ja locale for the SCAD-from-NL section', () => {
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

  it('shows the Japanese "自由形式" / "画像" labels instead of the English fallback', () => {
    mount();
    switchToOpenscadTab();
    expect(screen.getByText(/自由形式/)).toBeInTheDocument();
    expect(screen.getByText(/🖼️\s*画像/)).toBeInTheDocument();
    expect(screen.queryByText(/^Free-form$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Image$/)).not.toBeInTheDocument();
  });

  it('shows a localized Japanese error for an oversized image instead of a hardcoded Korean string', async () => {
    mount();
    switchToOpenscadTab();
    const fileInput = document.querySelector('input.hidden[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const bigFile = new File([new Uint8Array(7 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [bigFile] });
    await act(async () => {
      fireEvent.change(fileInput);
    });
    expect(await screen.findByText(/画像が大きすぎます/)).toBeInTheDocument();
    expect(screen.queryByText(/이미지가 너무 큽니다/)).not.toBeInTheDocument();
  });

  it('renders localized Japanese example-prompt chips on the generate tab, not the Korean-only originals', () => {
    mount();
    // Default tab is 'generate', where the example chips render.
    expect(screen.getByText('ボルト穴4つの bracket 50×30×5mm')).toBeInTheDocument();
    expect(screen.queryByText('볼트 구멍 4개 있는 브라켓 50×30×5mm')).not.toBeInTheDocument();
  });
});
