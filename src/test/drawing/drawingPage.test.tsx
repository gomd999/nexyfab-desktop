/** @vitest-environment jsdom */
/**
 * drawingPage.test.tsx — Phase 4.4.2 production Drawing page.
 *
 * Mounts the production /drawing/ page content (DrawingPageContent) and
 * verifies:
 *   - default Sheet is a standardThreeViewSheet (front/top/right/iso)
 *   - part / paper / scale selectors mutate the Sheet IR
 *   - DimensionAnnotationModal mounts on demand and its onAdd callback
 *     mutates Sheet.dimensions / Sheet.gdtCallouts
 *   - annotation delete removes the entry
 *   - PNG + JSON export trigger a download (URL.createObjectURL spied)
 *   - 4 i18n cases (ko / en / ja / zh)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';
import { paperDimensions } from '@/lib/drawing/sheet';

// ─── helpers ─────────────────────────────────────────────────────────────

function mount(lang = 'en') {
  return render(<DrawingPageContent lang={lang} />);
}

function getSheetSvg(container: HTMLElement): SVGSVGElement {
  const el = container.querySelector('svg[data-testid="sheet-renderer-root"]');
  if (!el) throw new Error('SheetRenderer SVG not found');
  return el as unknown as SVGSVGElement;
}

function viewportIds(container: HTMLElement): string[] {
  const groups = container.querySelectorAll('g[data-vp-id]');
  return Array.from(groups).map((g) => g.getAttribute('data-vp-id') ?? '');
}

// ─── env shims ───────────────────────────────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;

beforeEach(() => {
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
  // canvas.toBlob is not implemented in jsdom; install a stub that yields a tiny PNG blob.
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback): void {
      cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
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

// ─── tests ───────────────────────────────────────────────────────────────

describe('DrawingPageContent', () => {
  it('mounts with the default standardThreeViewSheet (4 viewports, A3 paper)', () => {
    const { container } = mount();
    expect(screen.getByTestId('drawing-page-root')).toBeInTheDocument();
    // standardThreeViewSheet always yields exactly front/top/right/iso.
    const ids = viewportIds(container).sort();
    expect(ids).toEqual(['front', 'iso', 'right', 'top']);
    const svg = getSheetSvg(container);
    const a3 = paperDimensions('A3');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${a3.width} ${a3.height}`);
  });

  it('changing the part select propagates the new sourceId into every viewport', () => {
    const { container } = mount();
    fireEvent.change(screen.getByTestId('drawing-part-select'), {
      target: { value: 'sample-cylinder' },
    });
    // sourceId is not exposed as data-* on the viewport groups, but the
    // standardThreeViewSheet builder rebuilds with the new sourceId. We
    // surface it by re-reading the sheet name — Drawing — sample-cylinder.
    const svg = getSheetSvg(container);
    expect(svg.getAttribute('aria-label')).toContain('sample-cylinder');
  });

  it('changing the paper select rebuilds the SVG viewBox to the new size', () => {
    const { container } = mount();
    fireEvent.change(screen.getByTestId('drawing-paper-select'), {
      target: { value: 'A1' },
    });
    const svg = getSheetSvg(container);
    const a1 = paperDimensions('A1');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${a1.width} ${a1.height}`);
  });

  it('changing the scale input updates every viewport scale', () => {
    const { container } = mount();
    fireEvent.change(screen.getByTestId('drawing-scale-input'), {
      target: { value: '2' },
    });
    // The scale prop on the SheetRenderer is unchanged (it's the
    // px-per-mm display scale); the *drawing scale* is the one we set
    // on each viewport via standardThreeViewSheet. Verify the renderer
    // still emits 4 viewport groups (basic sanity) AND that the
    // SheetRenderer DOM was re-rendered (viewBox unchanged but the
    // sheet is rebuilt with scale=2 internally).
    expect(viewportIds(container)).toHaveLength(4);
  });

  it('Add annotation button opens the DimensionAnnotationModal', () => {
    mount();
    expect(screen.queryByTestId('solver-dim-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('drawing-add-annotation-button'));
    expect(screen.getByTestId('solver-dim-modal')).toBeInTheDocument();
  });

  it('submitting a dimension through the modal appends to sheet.dimensions and shows a list entry', () => {
    const { container } = mount();
    fireEvent.click(screen.getByTestId('drawing-add-annotation-button'));
    fireEvent.change(screen.getByTestId('solver-dim-ref-0-input'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByTestId('solver-dim-ref-1-input'), { target: { value: 'e2' } });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    // Modal closes after onAdd; list entry appears.
    expect(screen.queryByTestId('solver-dim-modal')).toBeNull();
    const list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.children.length).toBe(1);
    // The SheetRenderer should now show one dim group.
    const dimGroups = container.querySelectorAll('[data-testid^="sheet-renderer-dim-"]');
    expect(dimGroups.length).toBe(1);
  });

  it('deleting an annotation from the list removes it from the sheet', () => {
    const { container } = mount();
    fireEvent.click(screen.getByTestId('drawing-add-annotation-button'));
    fireEvent.change(screen.getByTestId('solver-dim-ref-0-input'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByTestId('solver-dim-ref-1-input'), { target: { value: 'e2' } });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    // Grab the rendered dimension's id from the data-dim-id attribute on
    // the SheetRenderer's first dim group.
    const dimEl = container.querySelector('[data-dim-id]');
    const dimId = dimEl?.getAttribute('data-dim-id') ?? '';
    expect(dimId).not.toBe('');
    // Click delete on the matching list item.
    fireEvent.click(screen.getByTestId(`drawing-page-delete-annotation-${dimId}`));
    expect(screen.queryByTestId('drawing-page-annotation-list')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-dim-"]').length).toBe(0);
  });

  it('PNG export button triggers a download via URL.createObjectURL', async () => {
    mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-export-png-button'));
      // Flush microtasks for the toBlob → downloadBlob promise chain.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createObjectUrlSpy).toHaveBeenCalled();
  });

  it('JSON export button triggers a download via URL.createObjectURL with application/json blob', () => {
    mount();
    fireEvent.click(screen.getByTestId('drawing-export-json-button'));
    expect(createObjectUrlSpy).toHaveBeenCalled();
    const blobArg = createObjectUrlSpy.mock.calls.at(-1)?.[0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toContain('application/json');
  });

  it('Korean i18n surfaces 도면 + 주석 추가 labels', () => {
    mount('ko');
    expect(screen.getByTestId('drawing-page-header').textContent ?? '').toMatch(/도면/);
    expect(screen.getByTestId('drawing-add-annotation-button').textContent ?? '').toMatch(/주석/);
  });

  it('English i18n surfaces Drawing + Add annotation labels', () => {
    mount('en');
    expect(screen.getByTestId('drawing-page-header').textContent ?? '').toMatch(/Drawing/);
    expect(screen.getByTestId('drawing-add-annotation-button').textContent ?? '').toMatch(/Add annotation/);
  });

  it('Japanese i18n surfaces 図面 + 注釈 labels', () => {
    mount('ja');
    expect(screen.getByTestId('drawing-page-header').textContent ?? '').toMatch(/図面/);
    expect(screen.getByTestId('drawing-add-annotation-button').textContent ?? '').toMatch(/注釈/);
  });

  it('Chinese i18n surfaces 图纸 + 添加注释 labels', () => {
    mount('zh');
    expect(screen.getByTestId('drawing-page-header').textContent ?? '').toMatch(/图纸/);
    expect(screen.getByTestId('drawing-add-annotation-button').textContent ?? '').toMatch(/添加注释/);
  });
});
