/** @vitest-environment jsdom */
/**
 * SheetPngExportButton — standalone button + resolution picker tests.
 *
 * Covers (per task brief):
 *   - Button renders + carries the i18n label
 *   - Click → exportSheetToPng called once
 *   - Resolution dropdown change → opts.pixelsPerMm reflects DPI / 25.4
 *   - Spinner appears while exporting and clears on resolve
 *   - Download triggered via URL.createObjectURL + anchor click
 *   - onExported callback receives the raw PNG bytes
 *   - Error path surfaces inline alert + iOS canvas-cap hint
 *   - 6-lang i18n labels (en / ko / ja / zh / es / ar)
 *   - default filename pattern {sheet.name}-{YYYYMMDDHHMMSS}.png
 *   - explicit filename overrides default
 *   - .png extension auto-appended when missing
 *   - resolution prop respected as the initial value
 *   - button disabled during export (prevents double-click stacking)
 *
 * jsdom note:
 *   jsdom ships no canvas backend, so we install programmable mocks for
 *   getContext + toBlob (mirroring sheetPngExport.test.ts) and spy
 *   URL.createObjectURL so we can read back the PNG blob the button
 *   feeds to the temporary <a download>. The anchor click is a no-op in
 *   jsdom — we monkey-patch HTMLAnchorElement.prototype.click so the
 *   spy can count invocations without dispatching anything real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

import { SheetPngExportButton } from '@/app/[lang]/shape-generator/drawing/SheetPngExportButton';
import { standardThreeViewSheet, type Sheet } from '@/lib/drawing/sheet';

// ─── exportSheetToPng spy ────────────────────────────────────────────────

vi.mock('@/lib/drawing/sheetPngExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/drawing/sheetPngExport')>();
  const calls: Array<{
    sheetId: string;
    pixelsPerMm: number | undefined;
    opts: unknown;
  }> = [];
  const blobBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
    0xde, 0xad, 0xbe, 0xef, // payload sentinel
  ]);
  type Fn = (
    sheet: Sheet,
    svg: SVGElement,
    opts?: { pixelsPerMm?: number },
  ) => Promise<Blob>;
  const impl = vi.fn<Fn>(
    async (sheet, _svg, opts) => {
      calls.push({
        sheetId: sheet.id,
        pixelsPerMm: opts?.pixelsPerMm,
        opts,
      });
      return new Blob([blobBytes.buffer as ArrayBuffer], { type: 'image/png' });
    },
  );
  (globalThis as unknown as { __pngExportSpy: { impl: typeof impl; calls: typeof calls; blobBytes: Uint8Array } })
    .__pngExportSpy = { impl, calls, blobBytes };
  return {
    ...actual,
    exportSheetToPng: impl,
  };
});

type PngExportFn = (
  sheet: Sheet,
  svg: SVGElement,
  opts?: { pixelsPerMm?: number },
) => Promise<Blob>;

type PngExportSpyState = {
  impl: ReturnType<typeof vi.fn<PngExportFn>>;
  calls: Array<{ sheetId: string; pixelsPerMm: number | undefined; opts: unknown }>;
  blobBytes: Uint8Array;
};

function getSpy(): PngExportSpyState {
  return (globalThis as unknown as { __pngExportSpy: PngExportSpyState })
    .__pngExportSpy;
}

// ─── URL.createObjectURL + anchor click spies ───────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn<(blob: Blob | MediaSource) => string>>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn<(url: string) => void>>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;
let anchorClickSpy: ReturnType<typeof vi.fn<(download: string, href: string) => void>>;
let originalAnchorClick: typeof HTMLAnchorElement.prototype.click;

beforeEach(() => {
  const spy = getSpy();
  spy.impl.mockClear();
  spy.calls.length = 0;

  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  createObjectUrlSpy = vi.fn<(blob: Blob | MediaSource) => string>(() => 'blob:mock-png-url');
  revokeObjectUrlSpy = vi.fn<(url: string) => void>();
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectUrlSpy, configurable: true, writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectUrlSpy, configurable: true, writable: true,
  });

  // Anchor click — count + swallow (jsdom no-ops it anyway, but we want
  // a stable spy callsite).
  anchorClickSpy = vi.fn<(download: string, href: string) => void>();
  originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function clickPatched(this: HTMLAnchorElement): void {
    anchorClickSpy(this.download, this.href);
  };

  // Minimal canvas mocks so SheetRenderer + exportSheetToPng don't blow up
  // (the export call is mocked, but the SheetRenderer mount path still
  // touches the DOM).
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = function getContext(): unknown {
      return { fillStyle: '', fillRect: () => undefined, drawImage: () => undefined };
    } as never;
  }
});

afterEach(() => {
  if (originalCreate) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreate, configurable: true, writable: true,
    });
  }
  if (originalRevoke) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevoke, configurable: true, writable: true,
    });
  }
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  vi.useRealTimers();
});

// ─── fixtures ────────────────────────────────────────────────────────────

function makeSheet(id = 'sheet-1', name = 'Demo Sheet'): Sheet {
  return standardThreeViewSheet({
    id,
    name,
    sourceId: 'sample-cube',
    paperSize: 'A4',
    scale: 1,
  });
}

async function clickAndWait(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('drawing-png-export-button'));
  });
  await waitFor(() => {
    expect(getSpy().impl).toHaveBeenCalled();
  });
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('SheetPngExportButton — render', () => {
  it('renders the export button + resolution select', () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    expect(screen.getByTestId('drawing-png-export-button')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-png-export-resolution-select')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-png-export-button').textContent ?? '')
      .toMatch(/Export PNG/);
  });

  it('resolution select offers 72 / 96 / 150 / 300 with 150 default', () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    const select = screen.getByTestId('drawing-png-export-resolution-select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['72', '96', '150', '300']);
    expect(select.value).toBe('150');
  });

  it('respects an explicit resolution prop as the initial DPI', () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} resolution={300} />);
    const select = screen.getByTestId('drawing-png-export-resolution-select') as HTMLSelectElement;
    expect(select.value).toBe('300');
  });

  it('falls back to 150 when an unsupported resolution prop is passed', () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} resolution={42} />);
    const select = screen.getByTestId('drawing-png-export-resolution-select') as HTMLSelectElement;
    expect(select.value).toBe('150');
  });
});

describe('SheetPngExportButton — click triggers exportSheetToPng', () => {
  it('click → exportSheetToPng called exactly once with the supplied sheet', async () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet('the-id')} />);
    await clickAndWait();
    const spy = getSpy();
    expect(spy.impl).toHaveBeenCalledTimes(1);
    expect(spy.calls[0]?.sheetId).toBe('the-id');
  });

  it('default DPI 150 → pixelsPerMm ≈ 150 / 25.4', async () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    await clickAndWait();
    const ppm = getSpy().calls[0]?.pixelsPerMm ?? 0;
    expect(ppm).toBeCloseTo(150 / 25.4, 5);
  });

  it('changing resolution → pixelsPerMm reflects new DPI / 25.4', async () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    fireEvent.change(screen.getByTestId('drawing-png-export-resolution-select'), {
      target: { value: '300' },
    });
    await clickAndWait();
    const ppm = getSpy().calls[0]?.pixelsPerMm ?? 0;
    expect(ppm).toBeCloseTo(300 / 25.4, 5);
  });

  it('72 DPI → pixelsPerMm ≈ 72 / 25.4', async () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    fireEvent.change(screen.getByTestId('drawing-png-export-resolution-select'), {
      target: { value: '72' },
    });
    await clickAndWait();
    const ppm = getSpy().calls[0]?.pixelsPerMm ?? 0;
    expect(ppm).toBeCloseTo(72 / 25.4, 5);
  });
});

describe('SheetPngExportButton — download path', () => {
  it('triggers download via URL.createObjectURL with the image/png blob', async () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    await clickAndWait();
    await waitFor(() => {
      const calls = createObjectUrlSpy.mock.calls.map((c) => c[0] as Blob);
      expect(calls.some((b) => b?.type === 'image/png')).toBe(true);
    });
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
  });

  it('default filename matches {sheet.name}-{YYYYMMDDHHMMSS}.png', async () => {
    render(<SheetPngExportButton lang="en" sheet={makeSheet('s1', 'My Sheet')} />);
    await clickAndWait();
    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalled());
    const downloadAttr = anchorClickSpy.mock.calls[0]?.[0] as string;
    expect(downloadAttr).toMatch(/^My_Sheet-\d{14}\.png$/);
  });

  it('explicit filename overrides the default', async () => {
    render(
      <SheetPngExportButton lang="en" sheet={makeSheet()} filename="custom-name.png" />,
    );
    await clickAndWait();
    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalled());
    const downloadAttr = anchorClickSpy.mock.calls[0]?.[0] as string;
    expect(downloadAttr).toBe('custom-name.png');
  });

  it('auto-appends .png when the supplied filename lacks one', async () => {
    render(
      <SheetPngExportButton lang="en" sheet={makeSheet()} filename="no-ext" />,
    );
    await clickAndWait();
    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalled());
    const downloadAttr = anchorClickSpy.mock.calls[0]?.[0] as string;
    expect(downloadAttr).toBe('no-ext.png');
  });
});

describe('SheetPngExportButton — onExported callback', () => {
  it('invokes onExported with the raw PNG bytes (PNG magic head)', async () => {
    const onExported = vi.fn<(bytes: Uint8Array) => void>();
    render(
      <SheetPngExportButton lang="en" sheet={makeSheet()} onExported={onExported} />,
    );
    await clickAndWait();
    await waitFor(() => expect(onExported).toHaveBeenCalledTimes(1));
    const bytes = onExported.mock.calls[0]?.[0] as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    // PNG magic — bytes[0..8) must match the iso 15948 header.
    expect(Array.from(bytes.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});

describe('SheetPngExportButton — spinner + busy state', () => {
  it('shows spinner + disables button + flips label to "Exporting..." during work', async () => {
    // Hold the mock pending so we can observe the mid-export UI.
    const spy = getSpy();
    let release: (b: Blob) => void = () => undefined;
    spy.impl.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          release = resolve;
        }),
    );
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-png-export-button'));
    });
    expect(screen.getByTestId('drawing-png-export-spinner')).toBeInTheDocument();
    const btn = screen.getByTestId('drawing-png-export-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent ?? '').toMatch(/Exporting/);

    // Resolve + flush.
    await act(async () => {
      release(new Blob([spy.blobBytes.buffer as ArrayBuffer], { type: 'image/png' }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('drawing-png-export-spinner')).toBeNull();
    });
    expect((screen.getByTestId('drawing-png-export-button') as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('double-click while exporting does NOT stack a second exportSheetToPng call', async () => {
    const spy = getSpy();
    let release: (b: Blob) => void = () => undefined;
    spy.impl.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          release = resolve;
        }),
    );
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-png-export-button'));
      fireEvent.click(screen.getByTestId('drawing-png-export-button'));
      fireEvent.click(screen.getByTestId('drawing-png-export-button'));
    });
    expect(spy.impl).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(new Blob([spy.blobBytes.buffer as ArrayBuffer], { type: 'image/png' }));
    });
  });
});

describe('SheetPngExportButton — error path', () => {
  it('exportSheetToPng throws → inline alert appears with the i18n header', async () => {
    const spy = getSpy();
    spy.impl.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-png-export-button'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-png-export-error')).toBeInTheDocument();
    });
    const alert = screen.getByTestId('drawing-png-export-error');
    expect(alert.textContent ?? '').toMatch(/PNG export failed/);
    expect(alert.textContent ?? '').toMatch(/boom/);
  });

  it('canvas-unavailable error surfaces the iOS 16MP cap hint', async () => {
    const { SheetPngExportError } = await import('@/lib/drawing/sheetPngExport');
    const spy = getSpy();
    spy.impl.mockImplementationOnce(async () => {
      throw new SheetPngExportError('no ctx', 'canvas-unavailable');
    });
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-png-export-button'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-png-export-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('drawing-png-export-error').textContent ?? '')
      .toMatch(/16 megapixels|16메가|16メガ|1600万|16 megapíxeles|16 ميجابكسل/);
  });

  it('clears the previous error before re-running on next click', async () => {
    const spy = getSpy();
    spy.impl.mockImplementationOnce(async () => {
      throw new Error('first');
    });
    render(<SheetPngExportButton lang="en" sheet={makeSheet()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-png-export-button'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-png-export-error')).toBeInTheDocument();
    });
    // Next click succeeds (mock returns to default impl).
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-png-export-button'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('drawing-png-export-error')).toBeNull();
    });
  });
});

describe('SheetPngExportButton — 6-lang i18n', () => {
  const cases: Array<[string, RegExp]> = [
    ['en', /Export PNG/],
    ['ko', /PNG 내보내기/],
    ['kr', /PNG 내보내기/],   // route alias
    ['ja', /PNGエクスポート/],
    ['zh', /导出PNG/],
    ['cn', /导出PNG/],         // route alias
    ['es', /Exportar PNG/],
    ['ar', /تصدير PNG/],
  ];
  it.each(cases)('lang=%s renders the localised button label', (lang, pattern) => {
    render(<SheetPngExportButton lang={lang} sheet={makeSheet()} />);
    expect(screen.getByTestId('drawing-png-export-button').textContent ?? '')
      .toMatch(pattern);
  });

  it('falls back to English for an unknown lang code', () => {
    render(<SheetPngExportButton lang="xx" sheet={makeSheet()} />);
    expect(screen.getByTestId('drawing-png-export-button').textContent ?? '')
      .toMatch(/Export PNG/);
  });
});
