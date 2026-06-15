/** @vitest-environment jsdom */
/**
 * pdfExport — Phase 4.4.3 multi-page PDF export tests.
 *
 * Covers:
 *   - single sheet → Blob with PDF magic bytes
 *   - 2 sheets → 2-page PDF (mock jsPDF instrumented for addPage calls)
 *   - paperSize A3/A4/A0 → page dimensions passed to jsPDF match
 *   - mixed-paper sheets → each page uses its own format
 *   - svgRefs.length !== sheets.length → PdfExportError(mismatched-inputs)
 *   - empty sheets → PdfExportError(mismatched-inputs)
 *   - missing jspdf loader → PdfExportError(jspdf-missing)
 *   - convenience exportSheetToPdf wraps single sheet
 *   - resolvePagePaper landscape vs portrait inference
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportSheetsToPdf,
  exportSheetToPdf,
  resolvePagePaper,
  PdfExportError,
  type JsPdfLoader,
} from './pdfExport';
import { standardThreeViewSheet, paperDimensions, type Sheet, type PaperSize } from './sheet';

// ─── jsdom canvas stubs ──────────────────────────────────────────────────
// jsdom doesn't ship a real 2D canvas backend; svgToPngDataUrl needs
// getContext + toDataURL to return something so the happy-path branches
// reach the jsPDF.addImage call.
beforeEach(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = function getContext(): unknown {
      return {
        fillStyle: '',
        fillRect: () => undefined,
        drawImage: () => undefined,
      };
    } as never;
    HTMLCanvasElement.prototype.toDataURL = function toDataURL(): string {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    };
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────

function makeSheet(id: string, paperSize: PaperSize = 'A3'): Sheet {
  return standardThreeViewSheet({
    id,
    name: `Sheet ${id}`,
    sourceId: 'sample-cube',
    paperSize,
    scale: 1,
  });
}

function makeSvg(width = 420, height = 297): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '50');
  rect.setAttribute('height', '50');
  rect.setAttribute('fill', '#000');
  svg.appendChild(rect);
  return svg;
}

// Each fn is `vi.fn(...)` but also typed as the callable signature so the
// tests can both invoke them and read `.mock.calls` / `toHaveBeenCalled`.
type SpyFn<F extends (...a: never[]) => unknown> = F & {
  mock: { calls: unknown[][] };
};

interface MockDoc {
  addImage: SpyFn<(...args: unknown[]) => MockDoc>;
  addPage: SpyFn<(format?: number[] | string, orientation?: string) => MockDoc>;
  getNumberOfPages: SpyFn<() => number>;
  output: SpyFn<(type: string) => Blob | ArrayBuffer | string>;
  _pages: Array<{ format: number[] | string | undefined; orientation: string | undefined }>;
  _ctorArgs: { orientation?: string; unit?: string; format?: number[] };
}

function mockLoader(): { loader: JsPdfLoader; lastDoc: () => MockDoc | undefined } {
  let last: MockDoc | undefined;
  const loader: JsPdfLoader = async () => {
    return function JsPdfCtor(this: MockDoc, opts: { orientation?: string; unit?: string; format?: number[] }) {
      const self: MockDoc = {
        _ctorArgs: opts,
        _pages: [{ format: opts.format, orientation: opts.orientation }],
        addImage: vi.fn(() => self),
        addPage: vi.fn((format?: number[] | string, orientation?: string) => {
          self._pages.push({ format, orientation });
          return self;
        }),
        getNumberOfPages: vi.fn(() => self._pages.length),
        output: vi.fn((type: string) => {
          if (type === 'blob') {
            // Minimum valid-looking PDF: starts with %PDF-1.4 magic bytes.
            const header = '%PDF-1.4\n%mock\n';
            return new Blob([header], { type: 'application/pdf' });
          }
          if (type === 'arraybuffer') return new ArrayBuffer(8);
          return '';
        }),
      };
      Object.assign(this, self);
      last = self;
      return self;
    } as unknown as Awaited<ReturnType<JsPdfLoader>>;
  };
  return { loader, lastDoc: () => last };
}

async function blobMagic(blob: Blob, n = 8): Promise<string> {
  // jsdom 26 Blob may not implement arrayBuffer(); fall back to FileReader,
  // and ultimately to a synchronous text() shim on our mock blob.
  if (typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    const buf = await blob.arrayBuffer();
    return new TextDecoder().decode(buf.slice(0, n));
  }
  if (typeof (blob as { text?: unknown }).text === 'function') {
    const s = await blob.text();
    return s.slice(0, n);
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new TextDecoder().decode(buf.slice(0, n)));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('resolvePagePaper', () => {
  it('reports A4 landscape default (297×210 mm)', () => {
    const r = resolvePagePaper('A4');
    expect(r.widthMm).toBe(297);
    expect(r.heightMm).toBe(210);
    expect(r.orientation).toBe('landscape');
  });

  it('reports custom portrait when height > width', () => {
    const r = resolvePagePaper('custom', { width: 100, height: 200 });
    expect(r.widthMm).toBe(100);
    expect(r.heightMm).toBe(200);
    expect(r.orientation).toBe('portrait');
  });
});

describe('exportSheetsToPdf — input validation', () => {
  it('throws PdfExportError(mismatched-inputs) when arrays differ in length', async () => {
    const sheet = makeSheet('s1');
    const { loader } = mockLoader();
    await expect(
      exportSheetsToPdf([sheet, sheet], [makeSvg()], { loadJsPdf: loader }),
    ).rejects.toMatchObject({
      name: 'PdfExportError',
      code: 'mismatched-inputs',
    });
  });

  it('throws PdfExportError(mismatched-inputs) when sheets array is empty', async () => {
    const { loader } = mockLoader();
    await expect(
      exportSheetsToPdf([], [], { loadJsPdf: loader }),
    ).rejects.toBeInstanceOf(PdfExportError);
  });

  it('throws PdfExportError(jspdf-missing) when loader rejects', async () => {
    const sheet = makeSheet('s1');
    const failingLoader: JsPdfLoader = async () => {
      throw new PdfExportError('not installed', 'jspdf-missing');
    };
    await expect(
      exportSheetsToPdf([sheet], [makeSvg()], { loadJsPdf: failingLoader }),
    ).rejects.toMatchObject({ code: 'jspdf-missing' });
  });
});

describe('exportSheetsToPdf — happy path', () => {
  it('produces a Blob with PDF magic bytes for a single sheet', async () => {
    const { loader } = mockLoader();
    const blob = await exportSheetsToPdf([makeSheet('s1')], [makeSvg()], {
      loadJsPdf: loader,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(await blobMagic(blob, 5)).toBe('%PDF-');
  });

  it('emits a 2-page PDF for 2 sheets (addPage called once)', async () => {
    const { loader, lastDoc } = mockLoader();
    await exportSheetsToPdf(
      [makeSheet('a'), makeSheet('b')],
      [makeSvg(), makeSvg()],
      { loadJsPdf: loader },
    );
    const doc = lastDoc();
    expect(doc?.addPage).toHaveBeenCalledTimes(1);
    expect(doc?.getNumberOfPages()).toBe(2);
    expect(doc?.addImage).toHaveBeenCalledTimes(2);
  });

  it('sizes the first page to the sheet paperSize (A3 = 420×297 mm)', async () => {
    const { loader, lastDoc } = mockLoader();
    await exportSheetsToPdf([makeSheet('s1', 'A3')], [makeSvg()], {
      loadJsPdf: loader,
    });
    const a3 = paperDimensions('A3');
    expect(lastDoc()?._ctorArgs.format).toEqual([a3.width, a3.height]);
    expect(lastDoc()?._ctorArgs.unit).toBe('mm');
  });

  it('mixed paper sizes — each page uses its own format', async () => {
    const { loader, lastDoc } = mockLoader();
    await exportSheetsToPdf(
      [makeSheet('a', 'A4'), makeSheet('b', 'A0')],
      [makeSvg(), makeSvg()],
      { loadJsPdf: loader },
    );
    const a4 = paperDimensions('A4');
    const a0 = paperDimensions('A0');
    const pages = lastDoc()?._pages ?? [];
    expect(pages[0]?.format).toEqual([a4.width, a4.height]);
    expect(pages[1]?.format).toEqual([a0.width, a0.height]);
  });

  it('addImage is called with full page mm extent (origin 0,0)', async () => {
    const { loader, lastDoc } = mockLoader();
    await exportSheetsToPdf([makeSheet('s1', 'A4')], [makeSvg()], {
      loadJsPdf: loader,
    });
    const a4 = paperDimensions('A4');
    const call = lastDoc()?.addImage.mock.calls[0];
    expect(call?.[1]).toBe('PNG');
    expect(call?.[2]).toBe(0);
    expect(call?.[3]).toBe(0);
    expect(call?.[4]).toBe(a4.width);
    expect(call?.[5]).toBe(a4.height);
    // dataURL passed as the first arg should be a PNG data URL string.
    expect(typeof call?.[0]).toBe('string');
    expect(String(call?.[0])).toMatch(/^data:image\/png/);
  });

  it('exportSheetToPdf convenience wraps single sheet', async () => {
    const { loader, lastDoc } = mockLoader();
    const blob = await exportSheetToPdf(makeSheet('s1'), makeSvg(), {
      loadJsPdf: loader,
    });
    expect(blob.type).toBe('application/pdf');
    expect(lastDoc()?.addPage).not.toHaveBeenCalled();
    expect(lastDoc()?.getNumberOfPages()).toBe(1);
  });
});
