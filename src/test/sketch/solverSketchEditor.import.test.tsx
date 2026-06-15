/** @vitest-environment jsdom */
/**
 * SolverSketchEditor — SVG Import button + SketchImportModal integration.
 *
 * Coverage:
 *   - "Import..." button renders in the title bar with the documented testid
 *   - clicking it mounts the dynamic SketchImportModal
 *   - submitting a valid SVG from inside the modal calls the editor's
 *     import handler → solver gains the parsed entities (points/lines/
 *     circles appear on the canvas via `solver-sketch-entity-*` testids)
 *   - replace vs merge mode: replace clears existing geometry first; merge
 *     keeps it intact
 *   - mode radio defaults to 'merge' and is toggleable
 *   - cancel from the modal does NOT mutate solver state
 *   - 6-lang title-bar button label
 *
 * Async note: createSketchSolver returns a Promise (planegcs WASM init).
 * `mountReady` waits for `data-state="ready"`. Dynamic imports
 * (SketchImportModal) resolve via `findByTestId` with a generous timeout.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import SolverSketchEditor from '@/app/[lang]/shape-generator/sketch/SolverSketchEditor';

async function mountReady(
  lang: 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar' = 'en',
): Promise<HTMLElement> {
  render(<SolverSketchEditor lang={lang} />);
  const editor = await screen.findByTestId('solver-sketch-editor');
  await waitFor(() => expect(editor.getAttribute('data-state')).toBe('ready'), { timeout: 10000 });
  return editor;
}

function clickAt(el: Element, x: number, y: number): void {
  fireEvent.click(el, { clientX: x, clientY: y });
}

/** Open the import modal by clicking the title-bar button. Returns when the
 *  modal's testid resolves (dynamic import landed). */
async function openImportModal(): Promise<void> {
  fireEvent.click(screen.getByTestId('solver-sketch-import-button'));
  await screen.findByTestId('sketch-import-modal', {}, { timeout: 5000 });
}

/** Drop SVG text into the modal's textarea + click Import. */
function submitImport(svg: string): void {
  const ta = screen.getByTestId('sketch-import-textarea') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: svg } });
  fireEvent.click(screen.getByTestId('sketch-import-submit'));
}

// Sample SVG with our Y-flip wrapper + 1 line + 1 circle. Both entities use
// data-sketch-id so we can spot them post-import.
const SAMPLE_SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <g transform="translate(0 200) scale(1 -1)">
    <line x1="10" y1="20" x2="80" y2="20" stroke="#000" data-sketch-id="impL1"/>
    <circle cx="150" cy="100" r="20" fill="none" stroke="#000" data-sketch-id="impC1"/>
  </g>
</svg>`;

afterEach(() => {
  cleanup();
});

describe('SolverSketchEditor — Import button', () => {
  it('renders the Import... button with the documented testid', async () => {
    await mountReady('en');
    const btn = screen.getByTestId('solver-sketch-import-button');
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Import...');
  });

  it('renders the import-mode radio with merge as default', async () => {
    await mountReady('en');
    const merge = screen.getByTestId('solver-sketch-import-mode-merge') as HTMLInputElement;
    const replace = screen.getByTestId('solver-sketch-import-mode-replace') as HTMLInputElement;
    expect(merge.checked).toBe(true);
    expect(replace.checked).toBe(false);
  });

  it('clicking the Import button mounts the SketchImportModal', async () => {
    await mountReady('en');
    expect(screen.queryByTestId('sketch-import-modal')).toBeNull();
    await openImportModal();
    expect(screen.getByTestId('sketch-import-modal')).toBeInTheDocument();
  });
});

describe('SolverSketchEditor — import → solver entities', () => {
  it('submitting valid SVG inserts entities into the solver (merge mode default)', async () => {
    await mountReady('en');
    await openImportModal();
    submitImport(SAMPLE_SVG);
    // Modal closes on success.
    await waitFor(() => {
      expect(screen.queryByTestId('sketch-import-modal')).toBeNull();
    });
    // New entities show up on the canvas. Solver-side ids are namespaced
    // (`p`, `l`, `c` prefixes from SketchSolver.fresh()).
    await waitFor(() => {
      const lines = document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]');
      const circles = document.querySelectorAll('[data-testid^="solver-sketch-entity-c"]');
      expect(lines.length).toBeGreaterThan(0);
      expect(circles.length).toBeGreaterThan(0);
    });
  });

  it('multiple imports accumulate when in merge mode', async () => {
    await mountReady('en');
    // First import.
    await openImportModal();
    submitImport(SAMPLE_SVG);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]').length).toBe(1);
    });
    // Second import — should ADD, not replace.
    await openImportModal();
    submitImport(SAMPLE_SVG);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]').length).toBe(2);
    });
  });
});

describe('SolverSketchEditor — replace vs merge mode', () => {
  it('replace mode clears existing geometry before importing', async () => {
    await mountReady('en');
    // Pre-populate: draw a line via the line tool so we have something to wipe.
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 50, 50);
    clickAt(canvas, 120, 50);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]').length).toBe(1);
    });

    // Switch to replace mode.
    fireEvent.click(screen.getByTestId('solver-sketch-import-mode-replace'));
    const replace = screen.getByTestId('solver-sketch-import-mode-replace') as HTMLInputElement;
    expect(replace.checked).toBe(true);

    // Import the sample (1 line + 1 circle). After import, the pre-existing
    // line should be gone — only the import's geometry survives.
    await openImportModal();
    submitImport(SAMPLE_SVG);

    await waitFor(() => {
      const lines = document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]');
      const circles = document.querySelectorAll('[data-testid^="solver-sketch-entity-c"]');
      // Exactly 1 line + 1 circle from the import; the pre-line was wiped.
      expect(lines.length).toBe(1);
      expect(circles.length).toBe(1);
    });
  });

  it('merge mode preserves existing geometry alongside the import', async () => {
    await mountReady('en');
    fireEvent.click(screen.getByTestId('solver-sketch-tool-line'));
    const canvas = screen.getByTestId('solver-sketch-canvas');
    clickAt(canvas, 50, 50);
    clickAt(canvas, 120, 50);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]').length).toBe(1);
    });

    // Merge is the default; just open + import.
    await openImportModal();
    submitImport(SAMPLE_SVG);

    await waitFor(() => {
      // 1 pre-existing + 1 imported = 2 lines.
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]').length).toBe(2);
      expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-c"]').length).toBe(1);
    });
  });
});

describe('SolverSketchEditor — import cancel + dismiss', () => {
  it('cancel button closes the modal without mutating solver state', async () => {
    await mountReady('en');
    await openImportModal();
    // Pre-import canvas is empty.
    expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]').length).toBe(0);
    fireEvent.click(screen.getByTestId('sketch-import-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('sketch-import-modal')).toBeNull();
    });
    // Still empty.
    expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-l"]').length).toBe(0);
    expect(document.querySelectorAll('[data-testid^="solver-sketch-entity-c"]').length).toBe(0);
  });

  it('import-button title-bar label is translated per language', async () => {
    const cases: Array<['en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar', string]> = [
      ['en', 'Import...'],
      ['ko', '가져오기...'],
      ['ja', 'インポート...'],
      ['zh', '导入...'],
      ['es', 'Importar...'],
      ['ar', 'استيراد...'],
    ];
    for (const [lang, label] of cases) {
      cleanup();
      const fakeUrl = vi.fn();
      void fakeUrl;
      await mountReady(lang);
      const btn = screen.getByTestId('solver-sketch-import-button');
      expect(btn.textContent).toBe(label);
    }
  });
});
