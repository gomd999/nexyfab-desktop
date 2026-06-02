/** @vitest-environment jsdom */
/**
 * SolverSketchEditor — Export SVG button + sketchSvgExport integration.
 *
 * Confirms the toolbar wires:
 *   - `solver-sketch-export-svg` button renders next to Close in all 6 langs
 *   - clicking it invokes `URL.createObjectURL` with a Blob (download path)
 *   - blob payload is a well-formed SVG document containing every entity
 *     currently in the sketch (points, lines, circles → arcs stay empty
 *     until Phase 2 wires arc creation)
 *   - filename pattern `{projectId|'sketch'}-{YYYYMMDDTHHMMSS}.svg` is used
 *
 * jsdom note: `URL.createObjectURL` is absent by default. We install a spy
 * that returns a fake URL string + capture the blob argument so we can
 * read back the serialized SVG and assert on it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

async function mountReady(
  lang: 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar' = 'en',
  projectId?: string,
): Promise<HTMLElement> {
  render(<SolverSketchEditor lang={lang} projectId={projectId} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
  return editor;
}

function clickAt(el: Element, x: number, y: number): void {
  fireEvent.click(el, { clientX: x, clientY: y });
}

interface UrlSpy {
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
  readSvg: () => Promise<string | null>;
}

// jsdom doesn't ship `Blob.prototype.text`, so we capture the latest blob
// passed to URL.createObjectURL and read its contents via FileReader (which
// IS available in jsdom). This keeps the production path identical to the
// real browser flow — we don't shim Blob itself.
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
    readSvg: async (): Promise<string | null> => {
      if (!lastBlob) return null;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(lastBlob as Blob);
      });
    },
  };
}

describe('SolverSketchEditor — Export SVG button', () => {
  let spy: UrlSpy;

  beforeEach(() => {
    spy = installUrlSpy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Export SVG button alongside Close', async () => {
    await mountReady();
    const btn = screen.getByTestId('solver-sketch-export-svg');
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Export SVG');
  });

  it('clicking Export SVG with an empty sketch still produces a valid SVG blob', async () => {
    await mountReady();
    const btn = screen.getByTestId('solver-sketch-export-svg');
    fireEvent.click(btn);
    expect(spy.createObjectURL).toHaveBeenCalledTimes(1);
    const svg = await spy.readSvg();
    expect(svg).toBeTruthy();
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('</svg>');
    // Empty sketch → no content entities.
    expect(svg).not.toContain('data-kind="point"');
    expect(svg).not.toContain('data-kind="line"');
    expect(svg).not.toContain('data-kind="circle"');
  });

  it('export includes point + line + circle entities currently in the sketch', async () => {
    await mountReady();
    // Draw a line.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 100, 100);
    clickAt(canvas, 200, 100);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]').length).toBeGreaterThan(0);
    });
    // Draw a circle.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-circle'));
    clickAt(canvas, 300, 300);
    clickAt(canvas, 320, 300);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-c"]').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByTestId('solver-sketch-export-svg'));
    expect(spy.createObjectURL).toHaveBeenCalled();
    const svg = await spy.readSvg();
    expect(svg).toBeTruthy();
    // Each kind shows up at least once.
    expect(svg).toContain('data-kind="line"');
    expect(svg).toContain('data-kind="circle"');
    expect(svg).toContain('data-kind="point"');
  });

  it('uses Blob with image/svg+xml mime type', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-export-svg'));
    expect(spy.createObjectURL).toHaveBeenCalledTimes(1);
    const arg = spy.createObjectURL.mock.calls[0]![0] as Blob;
    expect(arg).toBeInstanceOf(Blob);
    expect(arg.type).toContain('image/svg+xml');
  });

  it('filename follows `${projectId}-{timestamp}.svg` format when projectId is supplied', async () => {
    await mountReady('en', 'proj-42');
    // Spy on anchor click via a document.createElement intercept so we
    // capture the `download` attribute that gets set.
    const realCreate = document.createElement.bind(document);
    let captured: string | null = null;
    const ceSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'download', {
          set(v: string) { captured = v; },
          get() { return captured ?? ''; },
          configurable: true,
        });
      }
      return el;
    }) as typeof document.createElement);

    fireEvent.click(screen.getByTestId('solver-sketch-export-svg'));
    expect(captured).toBeTruthy();
    expect(captured).toMatch(/^proj-42-\d{14}\.svg$/);
    ceSpy.mockRestore();
  });

  it('filename falls back to `sketch-{timestamp}.svg` when projectId is omitted', async () => {
    await mountReady('en');
    const realCreate = document.createElement.bind(document);
    let captured: string | null = null;
    const ceSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'download', {
          set(v: string) { captured = v; },
          get() { return captured ?? ''; },
          configurable: true,
        });
      }
      return el;
    }) as typeof document.createElement);

    fireEvent.click(screen.getByTestId('solver-sketch-export-svg'));
    expect(captured).toBeTruthy();
    expect(captured).toMatch(/^sketch-\d{14}\.svg$/);
    ceSpy.mockRestore();
  });

  it('button label is translated for each of the 6 supported languages', async () => {
    const langs: Array<['en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar', string]> = [
      ['en', 'Export SVG'],
      ['ko', 'SVG 내보내기'],
      ['ja', 'SVG出力'],
      ['zh', '导出SVG'],
      ['es', 'Exportar SVG'],
      ['ar', 'تصدير SVG'],
    ];
    for (const [lang, expected] of langs) {
      const { unmount } = render(<SolverSketchEditor lang={lang} />);
      const editor = await screen.findByTestId('solver-sketch-editor');
      await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
      const btn = screen.getByTestId('solver-sketch-export-svg');
      expect(btn.textContent).toBe(expected);
      unmount();
    }
  });

  it('SVG output uses mm units on the document (CAD-grade scale)', async () => {
    await mountReady();
    fireEvent.click(screen.getByTestId('solver-sketch-export-svg'));
    const svg = await spy.readSvg();
    expect(svg).toBeTruthy();
    expect(svg).toMatch(/width="200mm"/);
    expect(svg).toMatch(/height="150mm"/);
  });

  it('does not throw when URL.createObjectURL is unavailable (graceful fallback)', async () => {
    // Strip the method to simulate a non-DOM-ish env.
    const anyUrl = URL as unknown as { createObjectURL?: unknown };
    const saved = anyUrl.createObjectURL;
    anyUrl.createObjectURL = undefined;
    try {
      await mountReady();
      const btn = screen.getByTestId('solver-sketch-export-svg');
      // Should not throw — handler swallows internally.
      expect(() => fireEvent.click(btn)).not.toThrow();
    } finally {
      anyUrl.createObjectURL = saved;
    }
  });

  it('repeated clicks each invoke createObjectURL (no caching/dedupe)', async () => {
    await mountReady();
    const btn = screen.getByTestId('solver-sketch-export-svg');
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(spy.createObjectURL).toHaveBeenCalledTimes(3);
  });

  it('exported SVG includes a <title> with the project-prefixed filename', async () => {
    await mountReady('en', 'demo');
    fireEvent.click(screen.getByTestId('solver-sketch-export-svg'));
    const svg = await spy.readSvg();
    expect(svg).toBeTruthy();
    // Title is "NexyFab Sketch — {filename}" — assert the prefix shows up.
    expect(svg).toMatch(/<title>NexyFab Sketch — demo-\d{14}<\/title>/);
  });
});
