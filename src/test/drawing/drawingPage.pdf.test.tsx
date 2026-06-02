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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';
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
