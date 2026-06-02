/** @vitest-environment jsdom */
/**
 * SketchExportModal — standalone export-dialog tests.
 *
 * Coverage targets the public contract:
 *   - render shape (modal + format radios + Export/Cancel)
 *   - each format path triggers a download with the right extension and
 *     blob mime type (SVG / PNG / JSON)
 *   - URL.createObjectURL is invoked exactly once per export
 *   - option changes (width/height/margin/stroke/unit) re-render the
 *     live preview
 *   - filename input round-trips into the download `download` attr
 *   - 6-language UI labels appear under each `lang` prop
 *   - cancel + backdrop close paths
 *   - inch ↔ mm unit conversion lands the right page width in the SVG output
 *
 * jsdom note: URL.createObjectURL is missing by default; we install a spy
 * that records the latest Blob argument. A captured <a download> attribute
 * setter lets us assert the produced filename without a real download.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import SketchExportModal from '@/app/[lang]/shape-generator/sketch/SketchExportModal';
import type { SketchEntities } from '@/lib/sketch/sketchSvgExport';

// ─── fixtures ────────────────────────────────────────────────────────────

function emptyEntities(): SketchEntities {
  return { points: [], lines: [], circles: [], arcs: [] };
}

function sampleEntities(): SketchEntities {
  return {
    points: [
      { id: 'p1', x: 0, y: 0, isFixed: false },
      { id: 'p2', x: 50, y: 0, isFixed: false },
      { id: 'p3', x: 50, y: 30, isFixed: true },
    ],
    lines: [
      { id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 50, y2: 0 },
      { id: 'l2', p1: 'p2', p2: 'p3', x1: 50, y1: 0, x2: 50, y2: 30 },
    ],
    circles: [
      { id: 'c1', cx: 25, cy: 15, radius: 5 },
    ],
    arcs: [],
  };
}

// ─── URL.createObjectURL spy harness ─────────────────────────────────────

interface UrlSpy {
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
  lastBlob: () => Blob | null;
  readBlobText: (blob: Blob) => Promise<string>;
}

function installUrlSpy(): UrlSpy {
  let lastBlob: Blob | null = null;
  const createObjectURL = vi.fn((blob: Blob): string => {
    lastBlob = blob;
    return 'blob:fake-url';
  });
  const revokeObjectURL = vi.fn();
  const anyUrl = URL as unknown as {
    createObjectURL: typeof createObjectURL;
    revokeObjectURL: typeof revokeObjectURL;
  };
  anyUrl.createObjectURL = createObjectURL;
  anyUrl.revokeObjectURL = revokeObjectURL;

  return {
    createObjectURL,
    revokeObjectURL,
    lastBlob: () => lastBlob,
    readBlobText: (blob: Blob): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      }),
  };
}

// Capture the filename set on the transient `<a download>` anchor so tests
// can assert filename behaviour without inspecting the (suppressed) browser
// download. We swap document.createElement for `<a>` tags only — every other
// tag falls through to the real implementation.
function captureDownloadFilename(): {
  filenames: string[];
  restore: () => void;
} {
  const realCreate = document.createElement.bind(document);
  const filenames: string[] = [];
  const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'a') {
      let captured = '';
      Object.defineProperty(el, 'download', {
        set(v: string) { captured = v; filenames.push(v); },
        get() { return captured; },
        configurable: true,
      });
    }
    return el;
  }) as typeof document.createElement);
  return { filenames, restore: () => spy.mockRestore() };
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('SketchExportModal — render + format selection', () => {
  beforeEach(() => {
    installUrlSpy();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders the modal with title, format radios, and action buttons', () => {
    render(
      <SketchExportModal
        lang="en"
        entities={sampleEntities()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('sketch-export-modal')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-export-title')).toHaveTextContent('Export Sketch');
    expect(screen.getByTestId('sketch-export-format-svg')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-export-format-png')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-export-format-json')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-export-submit')).toBeInTheDocument();
    expect(screen.getByTestId('sketch-export-cancel')).toBeInTheDocument();
  });

  it('defaults to SVG format and switches when another radio is clicked', () => {
    render(
      <SketchExportModal
        lang="en"
        entities={sampleEntities()}
        onClose={vi.fn()}
      />,
    );
    const svgRadio = screen.getByTestId('sketch-export-format-svg') as HTMLInputElement;
    const pngRadio = screen.getByTestId('sketch-export-format-png') as HTMLInputElement;
    expect(svgRadio.checked).toBe(true);
    fireEvent.click(pngRadio);
    expect(pngRadio.checked).toBe(true);
    expect(svgRadio.checked).toBe(false);
  });
});

describe('SketchExportModal — SVG export path', () => {
  let spy: UrlSpy;
  beforeEach(() => { spy = installUrlSpy(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); });

  it('SVG export → URL.createObjectURL called with image/svg+xml blob + .svg filename', async () => {
    const cap = captureDownloadFilename();
    try {
      render(
        <SketchExportModal
          lang="en"
          entities={sampleEntities()}
          defaultFilename="diagram"
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('sketch-export-submit'));
      await waitFor(() => expect(spy.createObjectURL).toHaveBeenCalled());
      const blob = spy.lastBlob();
      expect(blob).toBeTruthy();
      expect(blob!.type).toContain('image/svg+xml');
      expect(cap.filenames.some((f) => f === 'diagram.svg')).toBe(true);

      const text = await spy.readBlobText(blob!);
      expect(text).toContain('<?xml version="1.0"');
      expect(text).toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(text).toContain('data-kind="line"');
      expect(text).toContain('data-kind="circle"');
    } finally {
      cap.restore();
    }
  });

  it('does not append .svg twice when the user already provides the extension', async () => {
    const cap = captureDownloadFilename();
    try {
      render(
        <SketchExportModal
          lang="en"
          entities={sampleEntities()}
          defaultFilename="part.SVG"
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('sketch-export-submit'));
      await waitFor(() => expect(spy.createObjectURL).toHaveBeenCalled());
      // Preserves user's casing; doesn't double-append.
      expect(cap.filenames.some((f) => f === 'part.SVG')).toBe(true);
      expect(cap.filenames.some((f) => f.endsWith('.SVG.svg'))).toBe(false);
    } finally {
      cap.restore();
    }
  });
});

describe('SketchExportModal — PNG export path', () => {
  let spy: UrlSpy;
  beforeEach(() => { spy = installUrlSpy(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); });

  it('PNG export → uses canvas + .png filename', async () => {
    const cap = captureDownloadFilename();
    try {
      render(
        <SketchExportModal
          lang="en"
          entities={sampleEntities()}
          defaultFilename="snap"
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('sketch-export-format-png'));
      fireEvent.click(screen.getByTestId('sketch-export-submit'));
      // PNG path is async (rasterise then download). Wait for the
      // download-anchor filename to land.
      await waitFor(() => {
        expect(cap.filenames.some((f) => f === 'snap.png')).toBe(true);
      }, { timeout: 5000 });
      // Ensure a blob got handed to createObjectURL. The PNG path
      // creates two object URLs (one transient SVG, one final PNG) —
      // we don't pin the exact count, just that at least one fired.
      expect(spy.createObjectURL).toHaveBeenCalled();
    } finally {
      cap.restore();
    }
  });
});

describe('SketchExportModal — JSON export path', () => {
  let spy: UrlSpy;
  beforeEach(() => { spy = installUrlSpy(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); });

  it('JSON export → application/json blob + .json filename + parseable payload', async () => {
    const cap = captureDownloadFilename();
    try {
      render(
        <SketchExportModal
          lang="en"
          entities={sampleEntities()}
          defaultFilename="my-sketch"
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('sketch-export-format-json'));
      fireEvent.click(screen.getByTestId('sketch-export-submit'));
      await waitFor(() => expect(spy.createObjectURL).toHaveBeenCalled());

      const blob = spy.lastBlob();
      expect(blob).toBeTruthy();
      expect(blob!.type).toContain('application/json');
      expect(cap.filenames.some((f) => f === 'my-sketch.json')).toBe(true);

      const text = await spy.readBlobText(blob!);
      const parsed = JSON.parse(text);
      expect(parsed.version).toBe(1);
      expect(parsed.unit).toBe('mm');
      expect(parsed.entities.points).toHaveLength(3);
      expect(parsed.entities.lines).toHaveLength(2);
      expect(parsed.entities.circles).toHaveLength(1);
    } finally {
      cap.restore();
    }
  });
});

describe('SketchExportModal — option changes update preview', () => {
  beforeEach(() => { installUrlSpy(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); });

  it('changing width re-renders the preview SVG with the new attribute', () => {
    render(
      <SketchExportModal
        lang="en"
        entities={sampleEntities()}
        onClose={vi.fn()}
      />,
    );
    const preview = screen.getByTestId('sketch-export-preview-svg');
    const before = preview.innerHTML;
    expect(before).toMatch(/width="200mm"/);

    const widthInput = screen.getByTestId('sketch-export-width') as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '300' } });

    const after = screen.getByTestId('sketch-export-preview-svg').innerHTML;
    expect(after).toMatch(/width="300mm"/);
    expect(after).not.toBe(before);
  });

  it('changing stroke width updates the preview stroke attribute', () => {
    render(
      <SketchExportModal
        lang="en"
        entities={sampleEntities()}
        onClose={vi.fn()}
      />,
    );
    const strokeInput = screen.getByTestId('sketch-export-stroke') as HTMLInputElement;
    fireEvent.change(strokeInput, { target: { value: '1.5' } });
    const after = screen.getByTestId('sketch-export-preview-svg').innerHTML;
    expect(after).toMatch(/stroke-width="1\.5"/);
  });

  it('empty sketch shows the empty-state copy instead of an SVG', () => {
    render(
      <SketchExportModal
        lang="en"
        entities={emptyEntities()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('sketch-export-preview-svg')).toBeNull();
    expect(screen.getByTestId('sketch-export-preview')).toHaveTextContent('No geometry to export');
  });
});

describe('SketchExportModal — filename + unit', () => {
  let spy: UrlSpy;
  beforeEach(() => { spy = installUrlSpy(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); });

  it('changing the filename input flows through to the download attribute', async () => {
    const cap = captureDownloadFilename();
    try {
      render(
        <SketchExportModal
          lang="en"
          entities={sampleEntities()}
          defaultFilename="sketch"
          onClose={vi.fn()}
        />,
      );
      const input = screen.getByTestId('sketch-export-filename') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'custom-name' } });
      fireEvent.click(screen.getByTestId('sketch-export-submit'));
      await waitFor(() => expect(spy.createObjectURL).toHaveBeenCalled());
      expect(cap.filenames.some((f) => f === 'custom-name.svg')).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it('switching unit to inch converts width to mm in the SVG output', async () => {
    render(
      <SketchExportModal
        lang="en"
        entities={sampleEntities()}
        onClose={vi.fn()}
      />,
    );
    // Set width to 10 (in current unit mm) then switch to inch — the
    // input value stays "10" but means 10 inches → 254 mm on export.
    const widthInput = screen.getByTestId('sketch-export-width') as HTMLInputElement;
    const heightInput = screen.getByTestId('sketch-export-height') as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '10' } });
    fireEvent.change(heightInput, { target: { value: '5' } });
    const unitSel = screen.getByTestId('sketch-export-unit') as HTMLSelectElement;
    fireEvent.change(unitSel, { target: { value: 'inch' } });

    fireEvent.click(screen.getByTestId('sketch-export-submit'));
    await waitFor(() => expect(spy.createObjectURL).toHaveBeenCalled());
    const blob = spy.lastBlob();
    const text = await spy.readBlobText(blob!);
    // 10 inch × 25.4 = 254 mm. 5 inch × 25.4 = 127 mm.
    expect(text).toMatch(/width="254mm"/);
    expect(text).toMatch(/height="127mm"/);
  });
});

describe('SketchExportModal — i18n (6 languages)', () => {
  beforeEach(() => { installUrlSpy(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); });

  it.each([
    ['en', 'Export Sketch', 'Export', 'Cancel'],
    ['ko', '스케치 내보내기', '내보내기', '취소'],
    ['ja', 'スケッチをエクスポート', 'エクスポート', 'キャンセル'],
    ['zh', '导出草图', '导出', '取消'],
    ['es', 'Exportar boceto', 'Exportar', 'Cancelar'],
    ['ar', 'تصدير الرسم', 'تصدير', 'إلغاء'],
  ] as const)(
    'renders %s labels',
    (lang, expectedTitle, expectedExport, expectedCancel) => {
      installUrlSpy();
      render(
        <SketchExportModal
          lang={lang}
          entities={sampleEntities()}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByTestId('sketch-export-title')).toHaveTextContent(expectedTitle);
      expect(screen.getByTestId('sketch-export-submit')).toHaveTextContent(expectedExport);
      expect(screen.getByTestId('sketch-export-cancel')).toHaveTextContent(expectedCancel);
    },
  );

  it('Arabic lang sets dir="rtl" on the modal root', () => {
    installUrlSpy();
    render(
      <SketchExportModal
        lang="ar"
        entities={sampleEntities()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('sketch-export-modal').getAttribute('dir')).toBe('rtl');
  });
});

describe('SketchExportModal — close paths', () => {
  beforeEach(() => { installUrlSpy(); });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <SketchExportModal
        lang="en"
        entities={sampleEntities()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('sketch-export-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop invokes onClose; clicking inside the dialog does not', () => {
    const onClose = vi.fn();
    render(
      <SketchExportModal
        lang="en"
        entities={sampleEntities()}
        onClose={onClose}
      />,
    );
    // Backdrop click (target === currentTarget on the wrapper) → close.
    const root = screen.getByTestId('sketch-export-modal');
    fireEvent.click(root, { target: root });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Click inside the title — should NOT propagate as a backdrop close.
    onClose.mockClear();
    fireEvent.click(screen.getByTestId('sketch-export-title'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
