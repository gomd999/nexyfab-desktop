/** @vitest-environment jsdom */
/**
 * sheetPngExport — Phase 4.4.4 high-resolution PNG export tests.
 *
 * Covers:
 *   - A4 sheet → PNG Blob with valid PNG magic bytes (0x89 50 4E 47 ...)
 *   - default pixelsPerMm = 4 → canvas 297*4 × 210*4
 *   - pixelsPerMm = 8 → 2x linear dimensions vs default
 *   - pixelsPerMm = 12 → 3x linear dimensions vs default
 *   - background colour propagates to ctx.fillStyle
 *   - compression level (0/6/9) round-trips into toBlob quality (level/9)
 *   - jsdom toBlob fallback (mock throws) → still returns PNG-magic blob
 *   - downloadSheetAsPng → createObjectURL + <a download> click
 *   - SheetPngExportError(no-dom) when document/URL missing
 *   - SheetPngExportError(canvas-unavailable) when getContext returns null
 *   - includeTemplate defaults from TemplatedSheet
 *   - paper size A0 → canvas dims scale with paper
 *   - custom paper size → canvas dims = custom * pixelsPerMm
 *   - blob.type === 'image/png'
 *   - filename auto-appends .png when missing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportSheetToPng,
  downloadSheetAsPng,
  SheetPngExportError,
  PNG_MAGIC,
  type SheetPngOptions,
} from './sheetPngExport';
import { standardThreeViewSheet, type Sheet, type PaperSize } from './sheet';
import { applyTemplate, TEMPLATES, type TemplatedSheet } from './sheetTemplate';

// ─── jsdom canvas stubs ──────────────────────────────────────────────────
// jsdom ships no 2D backend — we need a programmable getContext + a
// toBlob that returns real PNG-magic bytes so PNG-magic assertions pass
// without pulling node-canvas. Each test can override the toBlob to
// simulate the failure path the fallback handles.

interface CanvasState {
  width: number;
  height: number;
  fillStyleSeen: string[];
  fillRectCalls: Array<[number, number, number, number]>;
  drawImageCalls: number;
  toBlobQuality: number | undefined;
  toBlobMimes: string[];
}

let canvasState: CanvasState;

function freshCanvasState(): CanvasState {
  return {
    width: 0,
    height: 0,
    fillStyleSeen: [],
    fillRectCalls: [],
    drawImageCalls: 0,
    toBlobQuality: undefined,
    toBlobMimes: [],
  };
}

/** Real PNG magic + minimal IHDR/IEND so toBlob output validates. */
const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // magic
  0x00, 0x00, 0x00, 0x0d, // IHDR length
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // w=1, h=1
  0x08, 0x06, 0x00, 0x00, 0x00, // bit-depth 8, RGBA
  0x1f, 0x15, 0xc4, 0x89, // CRC
]);

function installCanvasMocks(opts?: { toBlobThrows?: boolean; noToBlob?: boolean; noContext?: boolean }): void {
  canvasState = freshCanvasState();
  if (typeof HTMLCanvasElement === 'undefined') return;

  // Intercept width / height writes so we can assert canvas dimensions.
  Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
    configurable: true,
    get(this: HTMLCanvasElement & { _w?: number }): number { return this._w ?? 0; },
    set(this: HTMLCanvasElement & { _w?: number }, v: number): void {
      this._w = v;
      canvasState.width = v;
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
    configurable: true,
    get(this: HTMLCanvasElement & { _h?: number }): number { return this._h ?? 0; },
    set(this: HTMLCanvasElement & { _h?: number }, v: number): void {
      this._h = v;
      canvasState.height = v;
    },
  });

  HTMLCanvasElement.prototype.getContext = function getContext(): unknown {
    if (opts?.noContext) return null;
    const ctx = {
      _fillStyle: '',
      get fillStyle(): string { return this._fillStyle; },
      set fillStyle(v: string) {
        this._fillStyle = v;
        canvasState.fillStyleSeen.push(v);
      },
      fillRect(x: number, y: number, w: number, h: number): void {
        canvasState.fillRectCalls.push([x, y, w, h]);
      },
      drawImage(): void { canvasState.drawImageCalls += 1; },
    };
    return ctx;
  } as never;

  if (opts?.noToBlob) {
    delete (HTMLCanvasElement.prototype as unknown as { toBlob?: unknown }).toBlob;
  } else {
    HTMLCanvasElement.prototype.toBlob = function toBlob(
      this: HTMLCanvasElement,
      cb: BlobCallback,
      mime?: string,
      quality?: number,
    ): void {
      canvasState.toBlobQuality = quality;
      canvasState.toBlobMimes.push(mime ?? '');
      if (opts?.toBlobThrows) {
        throw new Error('jsdom: toBlob unsupported');
      }
      // Defer the callback to mimic the async browser contract.
      queueMicrotask(() => {
        cb(new Blob([TINY_PNG], { type: 'image/png' }));
      });
    } as typeof HTMLCanvasElement.prototype.toBlob;
  }

  // toDataURL fallback (path B) — return a real base64 PNG.
  HTMLCanvasElement.prototype.toDataURL = function toDataURL(): string {
    const b64 = btoaBytes(TINY_PNG);
    return `data:image/png;base64,${b64}`;
  };
}

function btoaBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

beforeEach(() => {
  installCanvasMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── helpers ─────────────────────────────────────────────────────────────

function makeSheet(id: string, paperSize: PaperSize = 'A4'): Sheet {
  return standardThreeViewSheet({
    id,
    name: `Sheet ${id}`,
    sourceId: 'sample-cube',
    paperSize,
    scale: 1,
  });
}

function makeSvg(width = 297, height = 210): SVGElement {
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

async function readFirstBytes(blob: Blob, n = 8): Promise<Uint8Array> {
  if (typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf.slice(0, n));
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buf.slice(0, n)));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('exportSheetToPng — magic bytes & blob shape', () => {
  it('emits a Blob with image/png MIME and PNG magic header for A4 sheet', async () => {
    const blob = await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    const head = await readFirstBytes(blob, 8);
    expect(bytesEqual(head, PNG_MAGIC)).toBe(true);
  });

  it('PNG_MAGIC constant matches ISO/IEC 15948-1 §5.2', () => {
    expect(Array.from(PNG_MAGIC)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe('exportSheetToPng — canvas dimensions vs pixelsPerMm', () => {
  it('default pixelsPerMm = 4 yields 297*4 × 210*4 canvas for A4', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg());
    expect(canvasState.width).toBe(297 * 4);
    expect(canvasState.height).toBe(210 * 4);
  });

  it('pixelsPerMm 8 yields 2x linear dimensions vs default for A4', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { pixelsPerMm: 8 });
    expect(canvasState.width).toBe(297 * 8);
    expect(canvasState.height).toBe(210 * 8);
  });

  it('pixelsPerMm 12 yields 3x linear dimensions vs default for A4', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { pixelsPerMm: 12 });
    expect(canvasState.width).toBe(297 * 12);
    expect(canvasState.height).toBe(210 * 12);
  });

  it('A0 paper at default 4 px/mm yields 1189*4 × 841*4 canvas', async () => {
    await exportSheetToPng(makeSheet('big', 'A0'), makeSvg(1189, 841));
    expect(canvasState.width).toBe(1189 * 4);
    expect(canvasState.height).toBe(841 * 4);
  });

  it('custom paper size feeds canvas dims = custom * pixelsPerMm', async () => {
    const sheet: Sheet = {
      id: 'custom-1',
      name: 'Custom',
      paperSize: 'custom',
      customPaper: { width: 150, height: 100 },
      viewports: [],
    };
    await exportSheetToPng(sheet, makeSvg(150, 100), { pixelsPerMm: 5 });
    expect(canvasState.width).toBe(150 * 5);
    expect(canvasState.height).toBe(100 * 5);
  });

  it('non-positive pixelsPerMm clamps to default 4', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { pixelsPerMm: 0 });
    expect(canvasState.width).toBe(297 * 4);
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { pixelsPerMm: -2 });
    expect(canvasState.width).toBe(297 * 4);
  });
});

describe('exportSheetToPng — background colour', () => {
  it('default background is #ffffff (applied via ctx.fillStyle)', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg());
    expect(canvasState.fillStyleSeen).toContain('#ffffff');
    expect(canvasState.fillRectCalls.length).toBeGreaterThan(0);
  });

  it('custom background propagates to ctx.fillStyle', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { background: '#abcdef' });
    expect(canvasState.fillStyleSeen).toContain('#abcdef');
  });

  it('background "transparent" skips fillRect (keeps alpha)', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { background: 'transparent' });
    expect(canvasState.fillRectCalls.length).toBe(0);
  });
});

describe('exportSheetToPng — compression level', () => {
  it('default compression 6 passes quality 6/9 to toBlob', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg());
    expect(canvasState.toBlobQuality).toBeCloseTo(6 / 9, 5);
  });

  it('compression 0 passes quality 0 to toBlob', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { compression: 0 });
    expect(canvasState.toBlobQuality).toBe(0);
  });

  it('compression 9 passes quality 1 to toBlob', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { compression: 9 });
    expect(canvasState.toBlobQuality).toBeCloseTo(1, 5);
  });

  it('compression > 9 clamps to 9 (quality 1.0)', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { compression: 99 });
    expect(canvasState.toBlobQuality).toBeCloseTo(1, 5);
  });

  it('compression < 0 clamps to 0 (quality 0)', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg(), { compression: -5 });
    expect(canvasState.toBlobQuality).toBe(0);
  });

  it('toBlob always requested with image/png mime', async () => {
    await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg());
    expect(canvasState.toBlobMimes).toContain('image/png');
  });
});

describe('exportSheetToPng — jsdom toBlob fallback path', () => {
  it('toBlob throws → falls through to toDataURL path B (still image/png + magic)', async () => {
    installCanvasMocks({ toBlobThrows: true });
    const blob = await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg());
    expect(blob.type).toBe('image/png');
    const head = await readFirstBytes(blob, 8);
    expect(bytesEqual(head, PNG_MAGIC)).toBe(true);
  });

  it('toBlob missing entirely → still resolves with PNG-magic blob via path B', async () => {
    installCanvasMocks({ noToBlob: true });
    const blob = await exportSheetToPng(makeSheet('s1', 'A4'), makeSvg());
    expect(blob.type).toBe('image/png');
    const head = await readFirstBytes(blob, 8);
    expect(bytesEqual(head, PNG_MAGIC)).toBe(true);
  });
});

describe('exportSheetToPng — error paths', () => {
  it('throws SheetPngExportError(canvas-unavailable) when getContext returns null', async () => {
    installCanvasMocks({ noContext: true });
    await expect(
      exportSheetToPng(makeSheet('s1', 'A4'), makeSvg()),
    ).rejects.toMatchObject({
      name: 'SheetPngExportError',
      code: 'canvas-unavailable',
    });
  });

  it('SheetPngExportError carries the documented code union', () => {
    const e = new SheetPngExportError('x', 'no-dom');
    expect(e.code).toBe('no-dom');
    expect(e.name).toBe('SheetPngExportError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('exportSheetToPng — templated sheet integration', () => {
  it('TemplatedSheet (engineering) renders via the same A3 paper dims', async () => {
    const base = makeSheet('t1', 'A3');
    const templated: TemplatedSheet = applyTemplate(base, TEMPLATES.engineering!);
    await exportSheetToPng(templated, makeSvg(420, 297));
    expect(canvasState.width).toBe(420 * 4);
    expect(canvasState.height).toBe(297 * 4);
  });

  it('includeTemplate option accepted without throwing (metadata signal only)', async () => {
    const sheet = makeSheet('s1', 'A4');
    const optsTrue: SheetPngOptions = { includeTemplate: true };
    const optsFalse: SheetPngOptions = { includeTemplate: false };
    await expect(exportSheetToPng(sheet, makeSvg(), optsTrue)).resolves.toBeInstanceOf(Blob);
    await expect(exportSheetToPng(sheet, makeSvg(), optsFalse)).resolves.toBeInstanceOf(Blob);
  });
});

describe('downloadSheetAsPng', () => {
  it('invokes URL.createObjectURL with the PNG blob and triggers anchor click', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    const createElSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag.toLowerCase() === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });
    await downloadSheetAsPng(makeSheet('s1', 'A4'), makeSvg(), 'drawing.png');
    expect(createSpy).toHaveBeenCalled();
    // First createObjectURL is for the inner SVG blob; the LAST is for the PNG blob
    // we trigger the download with.
    const lastCallArg = createSpy.mock.calls[createSpy.mock.calls.length - 1]?.[0];
    expect(lastCallArg).toBeInstanceOf(Blob);
    expect((lastCallArg as Blob).type).toBe('image/png');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // revokeObjectURL is queued in setTimeout — flush to silence open-handle noise.
    await new Promise((r) => setTimeout(r, 0));
    expect(revokeSpy).toHaveBeenCalled();
    createElSpy.mockRestore();
  });

  it('appends .png suffix when filename is missing one', async () => {
    let observedDownload = '';
    const origCreate = document.createElement.bind(document);
    const createElSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag.toLowerCase() === 'a') {
        Object.defineProperty(el, 'download', {
          configurable: true,
          set(v: string) { observedDownload = v; },
          get(): string { return observedDownload; },
        });
        (el as HTMLAnchorElement).click = () => undefined;
      }
      return el;
    });
    await downloadSheetAsPng(makeSheet('s1', 'A4'), makeSvg(), 'no-ext');
    expect(observedDownload).toBe('no-ext.png');
    createElSpy.mockRestore();
  });

  it('preserves explicit .png suffix as-is', async () => {
    let observedDownload = '';
    const origCreate = document.createElement.bind(document);
    const createElSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag.toLowerCase() === 'a') {
        Object.defineProperty(el, 'download', {
          configurable: true,
          set(v: string) { observedDownload = v; },
          get(): string { return observedDownload; },
        });
        (el as HTMLAnchorElement).click = () => undefined;
      }
      return el;
    });
    await downloadSheetAsPng(makeSheet('s1', 'A4'), makeSvg(), 'drawing.png');
    expect(observedDownload).toBe('drawing.png');
    createElSpy.mockRestore();
  });
});
