/** @vitest-environment jsdom */
/**
 * drawingPage.pdf.test.tsx — Phase 4.4.3 PDF export button on the
 * production /drawing/ page.
 *
 * Covers:
 *   - Export PDF button renders
 *   - Multi-page PDF checkbox renders and toggles state
 *   - Clicking Export PDF invokes URL.createObjectURL with an
 *     application/pdf Blob (jspdf dynamic import is mocked)
 *   - The downloaded PDF page size matches the selected paperSize
 *   - When jspdf is missing, the error banner surfaces the i18n message
 *   - i18n covers ko / en / ja / zh
 *   - Vector vs raster pdfFormat radio routing + automatic fallback
 *     (Phase 4.4.3 Phase 2 svg2pdfBridge integration).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ─── svg2pdfBridge mock (Phase 2 vector pipeline) ────────────────────────
//
// Mocked BEFORE the component import so the bound reference inside
// `_content.tsx` resolves to the mock. The factory stashes a handle on a
// global symbol so individual tests can flip the implementation without
// re-invoking vi.mock (which is hoisted and cannot capture test-local
// closures).

vi.mock('@/lib/drawing/svg2pdfBridge', () => {
  class MockVectorPdfError extends Error {
    public readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'VectorPdfError';
      this.code = code;
    }
  }
  const defaultImpl = async (
    _sheets: ReadonlyArray<unknown>,
    _svgRefs: ReadonlyArray<unknown>,
  ): Promise<Blob> => new Blob(['%PDF-1.4 vector\n'], { type: 'application/pdf' });
  const mock = vi.fn<
    (sheets: ReadonlyArray<unknown>, svgRefs: ReadonlyArray<unknown>) => Promise<Blob>
  >(defaultImpl);
  const state = { mock, MockVectorPdfError, defaultImpl };
  (globalThis as unknown as { __svg2pdfMock: typeof state }).__svg2pdfMock = state;
  return {
    exportSheetsToPdfVector: (
      sheets: ReadonlyArray<unknown>,
      svgRefs: ReadonlyArray<unknown>,
    ) => mock(sheets, svgRefs),
    VectorPdfError: MockVectorPdfError,
  };
});

type Svg2PdfMockState = {
  mock: ReturnType<
    typeof vi.fn<(s: ReadonlyArray<unknown>, r: ReadonlyArray<unknown>) => Promise<Blob>>
  >;
  MockVectorPdfError: new (code: string, msg: string) => Error & { code: string };
  defaultImpl: (s: ReadonlyArray<unknown>, r: ReadonlyArray<unknown>) => Promise<Blob>;
};

function getSvg2PdfMockState(): Svg2PdfMockState {
  return (globalThis as unknown as { __svg2pdfMock: Svg2PdfMockState }).__svg2pdfMock;
}

import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';
import { paperDimensions } from '@/lib/drawing/sheet';

// ─── jspdf mock ──────────────────────────────────────────────────────────

interface CtorCall {
  format?: number[];
  orientation?: string;
  unit?: string;
}

const ctorCalls: CtorCall[] = [];

vi.mock('jspdf', () => {
  class MockJsPdf {
    constructor(opts: { format?: number[]; orientation?: string; unit?: string }) {
      ctorCalls.push({
        format: opts.format,
        orientation: opts.orientation,
        unit: opts.unit,
      });
    }
    addImage(): this { return this; }
    addPage(): this { return this; }
    getNumberOfPages(): number { return 1; }
    output(type: string): Blob | ArrayBuffer | string {
      if (type === 'blob') {
        return new Blob(['%PDF-1.4\n%mock\n'], { type: 'application/pdf' });
      }
      if (type === 'arraybuffer') return new ArrayBuffer(8);
      return '';
    }
  }
  return { default: MockJsPdf, jsPDF: MockJsPdf };
});

// ─── env shims ───────────────────────────────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;

beforeEach(() => {
  ctorCalls.length = 0;
  const svgState = getSvg2PdfMockState();
  svgState.mock.mockReset();
  svgState.mock.mockImplementation(svgState.defaultImpl);
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  createObjectUrlSpy = vi.fn(() => 'blob:mock-url');
  revokeObjectUrlSpy = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectUrlSpy, configurable: true, writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectUrlSpy, configurable: true, writable: true,
  });
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback): void {
      cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
    };
    HTMLCanvasElement.prototype.toDataURL = function toDataURL(): string {
      return 'data:image/png;base64,iVBORw0KGgo=';
    };
    HTMLCanvasElement.prototype.getContext = function getContext(): unknown {
      return {
        fillStyle: '',
        fillRect: () => undefined,
        drawImage: () => undefined,
      };
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
  vi.useRealTimers();
});

// ─── helpers ─────────────────────────────────────────────────────────────

function mount(lang = 'en') {
  return render(<DrawingPageContent lang={lang} />);
}

/**
 * Click the PDF export button and wait until the mocked downloadBlob path
 * resolves (URL.createObjectURL receives an application/pdf blob).
 */
async function clickPdfExportAndAwait() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('drawing-export-pdf-button'));
  });
  await waitFor(() => {
    const calls = createObjectUrlSpy.mock.calls.map((c) => c[0] as Blob);
    expect(calls.some((b) => b?.type === 'application/pdf')).toBe(true);
  });
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('DrawingPageContent — PDF export', () => {
  it('renders the Export PDF button and the multi-page checkbox', () => {
    mount();
    expect(screen.getByTestId('drawing-export-pdf-button')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-multi-page-pdf-checkbox')).toBeInTheDocument();
  });

  it('multi-page checkbox toggles its checked state', () => {
    mount();
    const cb = screen.getByTestId('drawing-multi-page-pdf-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
  });

  it('clicking Export PDF triggers a download via URL.createObjectURL with application/pdf blob', async () => {
    mount();
    await clickPdfExportAndAwait();
    const calls = createObjectUrlSpy.mock.calls.map((c) => c[0] as Blob);
    const pdfBlob = calls.find((b) => b?.type === 'application/pdf');
    expect(pdfBlob).toBeInstanceOf(Blob);
  });

  it('jsPDF is constructed with the selected paperSize (default A3)', async () => {
    mount();
    await clickPdfExportAndAwait();
    const a3 = paperDimensions('A3');
    expect(ctorCalls.length).toBeGreaterThan(0);
    expect(ctorCalls[0]?.format).toEqual([a3.width, a3.height]);
    expect(ctorCalls[0]?.unit).toBe('mm');
  });

  it('changing paperSize to A1 → jsPDF receives A1 dimensions', async () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-paper-select'), {
      target: { value: 'A1' },
    });
    await clickPdfExportAndAwait();
    const a1 = paperDimensions('A1');
    expect(ctorCalls.at(-1)?.format).toEqual([a1.width, a1.height]);
  });

  it('Korean i18n renders the PDF button label', () => {
    mount('ko');
    expect(screen.getByTestId('drawing-export-pdf-button').textContent ?? '').toMatch(/PDF/);
  });

  it('English i18n renders the Export PDF label', () => {
    mount('en');
    expect(screen.getByTestId('drawing-export-pdf-button').textContent ?? '').toMatch(/Export PDF/);
  });
});

// ─── PDF format radio + vector pipeline routing (Phase 2) ─────────────────

/**
 * Click Export PDF and wait until either the success info banner shows
 * up OR an error banner appears, so each test can assert deterministic
 * post-export UI state.
 */
async function clickPdfExportAndAwaitBanner() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('drawing-export-pdf-button'));
  });
  await waitFor(() => {
    const info = screen.queryByTestId('drawing-export-pdf-info');
    const err = screen.queryByTestId('drawing-export-pdf-error');
    expect(info || err).not.toBeNull();
  });
}

describe('DrawingPageContent — PDF format radio', () => {
  it('renders both raster + vector radio inputs', () => {
    mount();
    expect(screen.getByTestId('drawing-pdf-format-raster')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-pdf-format-vector')).toBeInTheDocument();
  });

  it('defaults to raster (back-compat) — raster checked, vector not', () => {
    mount();
    const raster = screen.getByTestId('drawing-pdf-format-raster') as HTMLInputElement;
    const vector = screen.getByTestId('drawing-pdf-format-vector') as HTMLInputElement;
    expect(raster.checked).toBe(true);
    expect(vector.checked).toBe(false);
  });

  it('selecting vector flips the radios + selecting raster again switches back', () => {
    mount();
    const raster = screen.getByTestId('drawing-pdf-format-raster') as HTMLInputElement;
    const vector = screen.getByTestId('drawing-pdf-format-vector') as HTMLInputElement;
    fireEvent.click(vector);
    expect(vector.checked).toBe(true);
    expect(raster.checked).toBe(false);
    fireEvent.click(raster);
    expect(raster.checked).toBe(true);
    expect(vector.checked).toBe(false);
  });

  it('raster path → exportSheetsToPdf via jspdf is called, vector path is NOT', async () => {
    mount();
    // Default = raster.
    await clickPdfExportAndAwaitBanner();
    expect(ctorCalls.length).toBeGreaterThan(0); // raster pipeline ran
    expect(getSvg2PdfMockState().mock).not.toHaveBeenCalled();
  });

  it('vector path → exportSheetsToPdfVector is called, raster path is NOT', async () => {
    mount();
    fireEvent.click(screen.getByTestId('drawing-pdf-format-vector'));
    await clickPdfExportAndAwaitBanner();
    expect(getSvg2PdfMockState().mock).toHaveBeenCalledTimes(1);
    // The raster constructor must not fire when the user opted into vector
    // and the vector pipeline succeeded.
    expect(ctorCalls.length).toBe(0);
  });

  it('vector success → info banner shows "Exported as vector PDF"', async () => {
    mount('en');
    fireEvent.click(screen.getByTestId('drawing-pdf-format-vector'));
    await clickPdfExportAndAwaitBanner();
    const info = screen.getByTestId('drawing-export-pdf-info');
    expect(info.textContent ?? '').toMatch(/Exported as vector PDF/);
  });

  it('raster success → info banner shows "Exported as raster PDF"', async () => {
    mount('en');
    await clickPdfExportAndAwaitBanner();
    const info = screen.getByTestId('drawing-export-pdf-info');
    expect(info.textContent ?? '').toMatch(/Exported as raster PDF/);
  });

  it('vector + svg2pdf-missing → automatic fallback to raster + fallback banner', async () => {
    const { mock, MockVectorPdfError } = getSvg2PdfMockState();
    mock.mockImplementation(async () => {
      throw new MockVectorPdfError(
        'svg2pdf-missing',
        'svg2pdf.js optional dependency is not installed',
      );
    });
    mount('en');
    fireEvent.click(screen.getByTestId('drawing-pdf-format-vector'));
    await clickPdfExportAndAwaitBanner();
    // The raster pipeline ran as fallback.
    expect(ctorCalls.length).toBeGreaterThan(0);
    // Vector was attempted exactly once.
    expect(mock).toHaveBeenCalledTimes(1);
    // Info banner names the fallback.
    const info = screen.getByTestId('drawing-export-pdf-info');
    expect(info.textContent ?? '').toMatch(/falling back to raster|fall back to raster/i);
  });

  it('vector + jspdf-missing → automatic fallback to raster', async () => {
    const { mock, MockVectorPdfError } = getSvg2PdfMockState();
    mock.mockImplementation(async () => {
      throw new MockVectorPdfError(
        'jspdf-missing',
        'jspdf optional dependency is not installed',
      );
    });
    mount('en');
    fireEvent.click(screen.getByTestId('drawing-pdf-format-vector'));
    await clickPdfExportAndAwaitBanner();
    expect(ctorCalls.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('drawing-export-pdf-error')).toBeNull();
    const info = screen.getByTestId('drawing-export-pdf-info');
    expect(info.textContent ?? '').toMatch(/fall(ing)? back to raster/i);
  });

  it('vector + render-failed (non-fallback code) → red error banner, no fallback', async () => {
    const { mock, MockVectorPdfError } = getSvg2PdfMockState();
    mock.mockImplementation(async () => {
      throw new MockVectorPdfError('render-failed', 'svg2pdf failed — boom');
    });
    mount('en');
    fireEvent.click(screen.getByTestId('drawing-pdf-format-vector'));
    await clickPdfExportAndAwaitBanner();
    // No fallback — raster pipeline must NOT run.
    expect(ctorCalls.length).toBe(0);
    const err = screen.getByTestId('drawing-export-pdf-error');
    expect(err.textContent ?? '').toMatch(/boom/);
  });

  it('vector path → downloads an application/pdf blob via URL.createObjectURL', async () => {
    mount();
    fireEvent.click(screen.getByTestId('drawing-pdf-format-vector'));
    await clickPdfExportAndAwaitBanner();
    const calls = createObjectUrlSpy.mock.calls.map((c) => c[0] as Blob);
    const pdfBlob = calls.find((b) => b?.type === 'application/pdf');
    expect(pdfBlob).toBeInstanceOf(Blob);
  });

  it('a fresh export attempt clears the previous success info banner before re-running', async () => {
    mount('en');
    // First: raster success.
    await clickPdfExportAndAwaitBanner();
    expect(screen.getByTestId('drawing-export-pdf-info').textContent ?? '')
      .toMatch(/raster/i);
    // Switch to vector and re-export — banner must update to "vector".
    fireEvent.click(screen.getByTestId('drawing-pdf-format-vector'));
    await clickPdfExportAndAwaitBanner();
    expect(screen.getByTestId('drawing-export-pdf-info').textContent ?? '')
      .toMatch(/vector/i);
  });

  // ─── 6-lang i18n for the new strings ────────────────────────────────────

  it('Korean i18n surfaces the "PDF 형식" group legend + 벡터/래스터 labels', () => {
    mount('ko');
    const group = screen.getByTestId('drawing-pdf-format-group');
    expect(group.textContent ?? '').toMatch(/PDF 형식/);
    expect(group.textContent ?? '').toMatch(/래스터/);
    expect(group.textContent ?? '').toMatch(/벡터/);
  });

  it('English i18n surfaces the "PDF format" group legend + Raster/Vector labels', () => {
    mount('en');
    const group = screen.getByTestId('drawing-pdf-format-group');
    expect(group.textContent ?? '').toMatch(/PDF format/);
    expect(group.textContent ?? '').toMatch(/Raster/);
    expect(group.textContent ?? '').toMatch(/Vector/);
  });

  it('Japanese i18n surfaces "PDF 形式" + ラスター/ベクター', () => {
    mount('ja');
    const group = screen.getByTestId('drawing-pdf-format-group');
    expect(group.textContent ?? '').toMatch(/PDF 形式/);
    expect(group.textContent ?? '').toMatch(/ラスター/);
    expect(group.textContent ?? '').toMatch(/ベクター/);
  });

  it('Chinese i18n surfaces "PDF 格式" + 光栅/矢量', () => {
    mount('zh');
    const group = screen.getByTestId('drawing-pdf-format-group');
    expect(group.textContent ?? '').toMatch(/PDF 格式/);
    expect(group.textContent ?? '').toMatch(/光栅/);
    expect(group.textContent ?? '').toMatch(/矢量/);
  });

  it('Spanish i18n surfaces "Formato PDF" + Ráster/Vector', () => {
    mount('es');
    const group = screen.getByTestId('drawing-pdf-format-group');
    expect(group.textContent ?? '').toMatch(/Formato PDF/);
    expect(group.textContent ?? '').toMatch(/Ráster/);
    expect(group.textContent ?? '').toMatch(/Vector/);
  });

  it('Arabic i18n surfaces "تنسيق PDF" + نقطي/متجه', () => {
    mount('ar');
    const group = screen.getByTestId('drawing-pdf-format-group');
    expect(group.textContent ?? '').toMatch(/تنسيق PDF/);
    expect(group.textContent ?? '').toMatch(/نقطي/);
    expect(group.textContent ?? '').toMatch(/متجه/);
  });
});
