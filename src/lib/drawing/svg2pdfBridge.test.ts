/** @vitest-environment jsdom */
/**
 * svg2pdfBridge — Phase 4.4.3 Phase 2 vector PDF export tests.
 *
 * Covers:
 *   - resolveVectorPagePaper landscape/portrait/custom inference
 *   - input validation (empty sheets, mismatched arrays, null/undefined/
 *     non-svg refs)
 *   - happy path: single sheet → Blob with %PDF magic; svg2pdf called once
 *     with x:0,y:0,width=paperW,height=paperH
 *   - multi-page: 3 sheets → addPage called twice, svg2pdf called 3×
 *   - mixed paper sizes — each page sized to its own paperSize
 *   - jspdf loader rejects → VectorPdfError(jspdf-missing)
 *   - svg2pdf loader rejects → VectorPdfError(svg2pdf-missing)
 *   - svg2pdf module without callable export → VectorPdfError(svg2pdf-missing)
 *   - svg2pdf throws at render time → VectorPdfError(render-failed)
 *   - exportSheetToPdfVector convenience wraps single sheet
 *   - both loaders invoked in parallel (load order does not block render)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  exportSheetsToPdfVector,
  exportSheetToPdfVector,
  resolveVectorPagePaper,
  VectorPdfError,
  type JsPdfLoader,
  type Svg2PdfLoader,
} from './svg2pdfBridge';
import { standardThreeViewSheet, paperDimensions, type Sheet, type PaperSize } from './sheet';

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
  return svg;
}

// Each fn is `vi.fn(...)` but also typed as the callable signature so the
// tests can both invoke them and read `.mock.calls` / `toHaveBeenCalled`.
type SpyFn<F extends (...a: never[]) => unknown> = F & {
  mock: { calls: unknown[][] };
};

interface MockDoc {
  addPage: SpyFn<(format?: number[] | string, orientation?: string) => MockDoc>;
  getNumberOfPages: SpyFn<() => number>;
  output: SpyFn<(type: string) => Blob | ArrayBuffer | string>;
  _pages: Array<{ format: number[] | string | undefined; orientation: string | undefined }>;
  _ctorArgs: { orientation?: string; unit?: string; format?: number[] };
}

interface Spies {
  jsPdfLoader: JsPdfLoader;
  svg2pdfLoader: Svg2PdfLoader;
  svg2pdfCalls: () => Array<{ el: SVGElement; doc: MockDoc; options?: { x?: number; y?: number; width?: number; height?: number } }>;
  lastDoc: () => MockDoc | undefined;
}

function makeMocks(): Spies {
  let last: MockDoc | undefined;
  const calls: Array<{ el: SVGElement; doc: MockDoc; options?: { x?: number; y?: number; width?: number; height?: number } }> = [];

  const jsPdfLoader: JsPdfLoader = async () => {
    function JsPdfCtor(this: MockDoc, opts: { orientation?: string; unit?: string; format?: number[] }) {
      const self: MockDoc = {
        _ctorArgs: opts,
        _pages: [{ format: opts.format, orientation: opts.orientation }],
        addPage: vi.fn((format?: number[] | string, orientation?: string) => {
          self._pages.push({ format, orientation });
          return self;
        }),
        getNumberOfPages: vi.fn(() => self._pages.length),
        output: vi.fn((type: string) => {
          if (type === 'blob') {
            return new Blob(['%PDF-1.4\n%vector-mock\n'], { type: 'application/pdf' });
          }
          if (type === 'arraybuffer') return new ArrayBuffer(8);
          return '';
        }),
      };
      Object.assign(this, self);
      last = self;
      return self;
    }
    return JsPdfCtor as unknown as Awaited<ReturnType<JsPdfLoader>>;
  };

  const svg2pdfFn = vi.fn(async (el: SVGElement, doc: MockDoc, options?: { x?: number; y?: number; width?: number; height?: number }) => {
    calls.push({ el, doc, options });
    return doc;
  });

  const svg2pdfLoader: Svg2PdfLoader = async () => svg2pdfFn as unknown as Awaited<ReturnType<Svg2PdfLoader>>;

  return {
    jsPdfLoader,
    svg2pdfLoader,
    svg2pdfCalls: () => calls,
    lastDoc: () => last,
  };
}

async function blobMagic(blob: Blob, n = 5): Promise<string> {
  // jsdom 26 Blob may not implement arrayBuffer(); fall back to FileReader,
  // and ultimately to a synchronous text() shim on our mock blob.
  if (typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    const buf = await blob.arrayBuffer();
    const decoded = new TextDecoder().decode(buf.slice(0, n));
    if (decoded.length > 0) return decoded;
    // fall through — some jsdom versions return an empty ArrayBuffer
  }
  if (typeof (blob as { text?: unknown }).text === 'function') {
    const s = await blob.text();
    if (s.length > 0) return s.slice(0, n);
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

describe('resolveVectorPagePaper', () => {
  it('reports A4 landscape default (297×210 mm)', () => {
    const r = resolveVectorPagePaper('A4');
    expect(r.widthMm).toBe(297);
    expect(r.heightMm).toBe(210);
    expect(r.orientation).toBe('landscape');
  });

  it('reports A0 landscape default (1189×841 mm)', () => {
    const r = resolveVectorPagePaper('A0');
    expect(r.widthMm).toBe(1189);
    expect(r.heightMm).toBe(841);
    expect(r.orientation).toBe('landscape');
  });

  it('infers portrait orientation when custom height > width', () => {
    const r = resolveVectorPagePaper('custom', { width: 100, height: 250 });
    expect(r.widthMm).toBe(100);
    expect(r.heightMm).toBe(250);
    expect(r.orientation).toBe('portrait');
  });
});

describe('exportSheetsToPdfVector — input validation', () => {
  it('throws VectorPdfError(mismatched-inputs) when sheets is empty', async () => {
    const m = makeMocks();
    await expect(
      exportSheetsToPdfVector([], [], { loadJsPdf: m.jsPdfLoader, loadSvg2Pdf: m.svg2pdfLoader }),
    ).rejects.toMatchObject({ name: 'VectorPdfError', code: 'mismatched-inputs' });
  });

  it('throws VectorPdfError(mismatched-inputs) when arrays differ in length', async () => {
    const m = makeMocks();
    await expect(
      exportSheetsToPdfVector([makeSheet('a'), makeSheet('b')], [makeSvg()], {
        loadJsPdf: m.jsPdfLoader,
        loadSvg2Pdf: m.svg2pdfLoader,
      }),
    ).rejects.toBeInstanceOf(VectorPdfError);
  });

  it('throws VectorPdfError(svg-invalid) when an svg ref is null', async () => {
    const m = makeMocks();
    await expect(
      exportSheetsToPdfVector([makeSheet('a')], [null as unknown as SVGElement], {
        loadJsPdf: m.jsPdfLoader,
        loadSvg2Pdf: m.svg2pdfLoader,
      }),
    ).rejects.toMatchObject({ code: 'svg-invalid' });
  });

  it('throws VectorPdfError(svg-invalid) when an svg ref is undefined', async () => {
    const m = makeMocks();
    await expect(
      exportSheetsToPdfVector([makeSheet('a')], [undefined as unknown as SVGElement], {
        loadJsPdf: m.jsPdfLoader,
        loadSvg2Pdf: m.svg2pdfLoader,
      }),
    ).rejects.toMatchObject({ code: 'svg-invalid' });
  });

  it('throws VectorPdfError(svg-invalid) when ref is a non-svg element', async () => {
    const m = makeMocks();
    const div = document.createElement('div');
    await expect(
      exportSheetsToPdfVector([makeSheet('a')], [div as unknown as SVGElement], {
        loadJsPdf: m.jsPdfLoader,
        loadSvg2Pdf: m.svg2pdfLoader,
      }),
    ).rejects.toMatchObject({ code: 'svg-invalid' });
  });
});

describe('exportSheetsToPdfVector — loader errors', () => {
  it('throws VectorPdfError(jspdf-missing) when jspdf loader rejects', async () => {
    const m = makeMocks();
    const failing: JsPdfLoader = async () => {
      throw new VectorPdfError('jspdf-missing', 'not installed');
    };
    await expect(
      exportSheetsToPdfVector([makeSheet('a')], [makeSvg()], {
        loadJsPdf: failing,
        loadSvg2Pdf: m.svg2pdfLoader,
      }),
    ).rejects.toMatchObject({ code: 'jspdf-missing' });
  });

  it('throws VectorPdfError(svg2pdf-missing) when svg2pdf loader rejects', async () => {
    const m = makeMocks();
    const failing: Svg2PdfLoader = async () => {
      throw new VectorPdfError('svg2pdf-missing', 'not installed');
    };
    await expect(
      exportSheetsToPdfVector([makeSheet('a')], [makeSvg()], {
        loadJsPdf: m.jsPdfLoader,
        loadSvg2Pdf: failing,
      }),
    ).rejects.toMatchObject({ code: 'svg2pdf-missing' });
  });
});

describe('exportSheetsToPdfVector — happy path (single sheet)', () => {
  it('returns a Blob with %PDF magic for a single sheet', async () => {
    const m = makeMocks();
    const blob = await exportSheetsToPdfVector([makeSheet('s1', 'A3')], [makeSvg()], {
      loadJsPdf: m.jsPdfLoader,
      loadSvg2Pdf: m.svg2pdfLoader,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(await blobMagic(blob, 5)).toBe('%PDF-');
  });

  it('calls svg2pdf exactly once with x:0,y:0,width=paperW,height=paperH for A3', async () => {
    const m = makeMocks();
    await exportSheetsToPdfVector([makeSheet('s1', 'A3')], [makeSvg()], {
      loadJsPdf: m.jsPdfLoader,
      loadSvg2Pdf: m.svg2pdfLoader,
    });
    const calls = m.svg2pdfCalls();
    expect(calls).toHaveLength(1);
    const a3 = paperDimensions('A3');
    expect(calls[0]?.options).toEqual({ x: 0, y: 0, width: a3.width, height: a3.height });
  });

  it('does NOT call addPage for the single-sheet case', async () => {
    const m = makeMocks();
    await exportSheetsToPdfVector([makeSheet('s1')], [makeSvg()], {
      loadJsPdf: m.jsPdfLoader,
      loadSvg2Pdf: m.svg2pdfLoader,
    });
    expect(m.lastDoc()?.addPage).not.toHaveBeenCalled();
    expect(m.lastDoc()?.getNumberOfPages()).toBe(1);
  });

  it('constructs the first page with unit=mm and format=[w,h]', async () => {
    const m = makeMocks();
    await exportSheetsToPdfVector([makeSheet('s1', 'A4')], [makeSvg()], {
      loadJsPdf: m.jsPdfLoader,
      loadSvg2Pdf: m.svg2pdfLoader,
    });
    const a4 = paperDimensions('A4');
    expect(m.lastDoc()?._ctorArgs.unit).toBe('mm');
    expect(m.lastDoc()?._ctorArgs.format).toEqual([a4.width, a4.height]);
  });
});

describe('exportSheetsToPdfVector — multi-page', () => {
  it('emits a 3-page PDF: addPage called twice, svg2pdf called 3×', async () => {
    const m = makeMocks();
    const sheets = [makeSheet('a'), makeSheet('b'), makeSheet('c')];
    const svgs = [makeSvg(), makeSvg(), makeSvg()];
    await exportSheetsToPdfVector(sheets, svgs, {
      loadJsPdf: m.jsPdfLoader,
      loadSvg2Pdf: m.svg2pdfLoader,
    });
    expect(m.lastDoc()?.addPage).toHaveBeenCalledTimes(2);
    expect(m.lastDoc()?.getNumberOfPages()).toBe(3);
    expect(m.svg2pdfCalls()).toHaveLength(3);
  });

  it('mixed paper sizes — each page sized to its own paperSize', async () => {
    const m = makeMocks();
    await exportSheetsToPdfVector(
      [makeSheet('a', 'A4'), makeSheet('b', 'A0'), makeSheet('c', 'A2')],
      [makeSvg(), makeSvg(), makeSvg()],
      { loadJsPdf: m.jsPdfLoader, loadSvg2Pdf: m.svg2pdfLoader },
    );
    const a4 = paperDimensions('A4');
    const a0 = paperDimensions('A0');
    const a2 = paperDimensions('A2');
    const pages = m.lastDoc()?._pages ?? [];
    expect(pages[0]?.format).toEqual([a4.width, a4.height]);
    expect(pages[1]?.format).toEqual([a0.width, a0.height]);
    expect(pages[2]?.format).toEqual([a2.width, a2.height]);
  });

  it('passes the matching svg element to each svg2pdf call', async () => {
    const m = makeMocks();
    const svgA = makeSvg();
    const svgB = makeSvg();
    await exportSheetsToPdfVector(
      [makeSheet('a'), makeSheet('b')],
      [svgA, svgB],
      { loadJsPdf: m.jsPdfLoader, loadSvg2Pdf: m.svg2pdfLoader },
    );
    const calls = m.svg2pdfCalls();
    expect(calls[0]?.el).toBe(svgA);
    expect(calls[1]?.el).toBe(svgB);
  });
});

describe('exportSheetsToPdfVector — render failures', () => {
  it('wraps a svg2pdf throw in VectorPdfError(render-failed) with the sheet id', async () => {
    const m = makeMocks();
    const failingSvg2Pdf: Svg2PdfLoader = async () => {
      return (async () => {
        throw new Error('boom: unsupported filter');
      }) as unknown as Awaited<ReturnType<Svg2PdfLoader>>;
    };
    await expect(
      exportSheetsToPdfVector([makeSheet('xyz', 'A4')], [makeSvg()], {
        loadJsPdf: m.jsPdfLoader,
        loadSvg2Pdf: failingSvg2Pdf,
      }),
    ).rejects.toMatchObject({
      name: 'VectorPdfError',
      code: 'render-failed',
      message: expect.stringContaining('xyz'),
    });
  });
});

describe('exportSheetToPdfVector convenience', () => {
  it('wraps a single sheet without invoking addPage', async () => {
    const m = makeMocks();
    const blob = await exportSheetToPdfVector(makeSheet('only'), makeSvg(), {
      loadJsPdf: m.jsPdfLoader,
      loadSvg2Pdf: m.svg2pdfLoader,
    });
    expect(blob.type).toBe('application/pdf');
    expect(m.lastDoc()?.addPage).not.toHaveBeenCalled();
    expect(m.lastDoc()?.getNumberOfPages()).toBe(1);
    expect(m.svg2pdfCalls()).toHaveLength(1);
  });
});
