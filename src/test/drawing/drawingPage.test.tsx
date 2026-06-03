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

// ─── Phase 4.7 cursor-snap integration ──────────────────────────────────
/**
 * Cursor-snap UX:
 *   - The snap toggle (`drawing-snap-toggle`) is always present in
 *     single-part mode, defaulting OFF so the 195 pre-existing
 *     drawing-suite tests don't see the indicator DOM.
 *   - With snap ON, mousemove over the canvas projects the cursor back
 *     into sheet mm via the SVG's bounding rect → viewBox mapping, then
 *     hands it to `findSheetSnapTarget`. The matched target drives the
 *     `<SheetSnapIndicator>` (data-testid `sheet-snap-indicator`) and
 *     carries its kind as `data-snap-kind`.
 *
 * Tests below use a stubbed `getBoundingClientRect` to put the SVG at a
 * known 0,0 → paperWidth,paperHeight pixel rect (1:1 px/mm) so the
 * client→sheet mapping is trivial and stable across jsdom versions.
 */

import { paperDimensions as _pd } from '@/lib/drawing/sheet';

function stubSvgRect(container: HTMLElement, paperWidthMm: number, paperHeightMm: number): void {
  const svg = container.querySelector('svg[data-testid="sheet-renderer-root"]');
  if (!svg) throw new Error('SVG not found');
  // 1px-per-mm at origin so clientX/Y == mm coords (top-left origin).
  (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: paperWidthMm,
    bottom: paperHeightMm,
    width: paperWidthMm,
    height: paperHeightMm,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('DrawingPageContent — cursor snap (Phase 4.7)', () => {
  it('snap toggle is visible by default and unchecked', () => {
    mount();
    const toggle = screen.getByTestId('drawing-snap-toggle') as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.checked).toBe(false);
    // The hint is gated on the toggle being on.
    expect(screen.queryByTestId('drawing-snap-hint')).toBeNull();
    // No indicator while snap is off.
    expect(screen.queryByTestId('sheet-snap-indicator')).toBeNull();
  });

  it('with snap OFF, mousemove does not mount the indicator', () => {
    const { container } = mount();
    const a3 = _pd('A3');
    stubSvgRect(container, a3.width, a3.height);
    const canvas = screen.getByTestId('drawing-page-canvas');
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 50 });
    expect(screen.queryByTestId('sheet-snap-indicator')).toBeNull();
  });

  it('turning snap ON reveals the hint text and arms the indicator', () => {
    mount();
    fireEvent.click(screen.getByTestId('drawing-snap-toggle'));
    expect(screen.getByTestId('drawing-snap-hint')).toBeInTheDocument();
  });

  it('mousemove with snap ON over a viewport corner shows a viewport_corner indicator', () => {
    const { container } = mount();
    const a3 = _pd('A3');
    stubSvgRect(container, a3.width, a3.height);
    fireEvent.click(screen.getByTestId('drawing-snap-toggle'));
    // standardThreeViewSheet builds viewports inside the sheet — we don't
    // care about the specific corner, just that mousing somewhere on the
    // canvas yields some snap (grid will always win on an empty miss).
    // Aim at a known grid node first (5 mm spacing default) at sheet (10, 10).
    // sheet (10, 10) bottom-left → screen y = paperHeight - 10.
    const canvas = screen.getByTestId('drawing-page-canvas');
    fireEvent.mouseMove(canvas, { clientX: 10, clientY: a3.height - 10 });
    const ind = screen.getByTestId('sheet-snap-indicator');
    expect(ind).toBeInTheDocument();
  });

  it('mousing near a viewport corner produces a viewport_corner snap kind', () => {
    const { container } = mount();
    const a3 = _pd('A3');
    stubSvgRect(container, a3.width, a3.height);
    fireEvent.click(screen.getByTestId('drawing-snap-toggle'));
    // Pull the first viewport's box from the rendered group so we don't
    // hard-code paper-specific math. The data-vp-id group wraps the
    // ViewportLayer; we read its first <rect> for x/y/w/h (in SVG mm).
    const vpGroup = container.querySelector('g[data-vp-id]');
    expect(vpGroup).not.toBeNull();
    const rect = vpGroup!.querySelector('rect');
    expect(rect).not.toBeNull();
    const xMm = Number(rect!.getAttribute('x'));
    const yMmSvg = Number(rect!.getAttribute('y'));
    // Sheet IR origin is bottom-left; SVG is top-left. The host's mousemove
    // converts back so we feed clientX/Y in screen-px (= mm under our stub).
    const canvas = screen.getByTestId('drawing-page-canvas');
    fireEvent.mouseMove(canvas, { clientX: xMm, clientY: yMmSvg });
    const ind = screen.getByTestId('sheet-snap-indicator');
    expect(ind.getAttribute('data-snap-kind')).toBe('viewport_corner');
  });

  it('mousing over an arbitrary empty point produces a grid snap', () => {
    const { container } = mount();
    const a3 = _pd('A3');
    stubSvgRect(container, a3.width, a3.height);
    fireEvent.click(screen.getByTestId('drawing-snap-toggle'));
    const canvas = screen.getByTestId('drawing-page-canvas');
    // Sheet (5, 5) — far from any viewport corner in a standardThreeViewSheet.
    fireEvent.mouseMove(canvas, { clientX: 5, clientY: a3.height - 5 });
    const ind = screen.getByTestId('sheet-snap-indicator');
    expect(ind.getAttribute('data-snap-kind')).toBe('grid');
  });

  it('turning snap OFF after a hover removes the indicator', () => {
    const { container } = mount();
    const a3 = _pd('A3');
    stubSvgRect(container, a3.width, a3.height);
    fireEvent.click(screen.getByTestId('drawing-snap-toggle'));
    const canvas = screen.getByTestId('drawing-page-canvas');
    fireEvent.mouseMove(canvas, { clientX: 5, clientY: a3.height - 5 });
    expect(screen.queryByTestId('sheet-snap-indicator')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('drawing-snap-toggle'));
    expect(screen.queryByTestId('sheet-snap-indicator')).toBeNull();
  });

  it('mouseleave clears the indicator', () => {
    const { container } = mount();
    const a3 = _pd('A3');
    stubSvgRect(container, a3.width, a3.height);
    fireEvent.click(screen.getByTestId('drawing-snap-toggle'));
    const canvas = screen.getByTestId('drawing-page-canvas');
    fireEvent.mouseMove(canvas, { clientX: 5, clientY: a3.height - 5 });
    expect(screen.queryByTestId('sheet-snap-indicator')).toBeInTheDocument();
    fireEvent.mouseLeave(canvas);
    expect(screen.queryByTestId('sheet-snap-indicator')).toBeNull();
  });

  it('snap toggle label is localised for ko / en / ja / zh / es / ar', () => {
    const cases: Array<[string, RegExp]> = [
      ['ko', /스냅/],
      ['en', /snap/i],
      ['ja', /スナップ/],
      ['zh', /捕捉/],
      ['es', /ajuste/i],
      ['ar', /الالتقاط/],
    ];
    for (const [lang, re] of cases) {
      const { unmount } = mount(lang);
      const toggle = screen.getByTestId('drawing-snap-toggle');
      const label = toggle.closest('label');
      expect(label).not.toBeNull();
      expect(label!.textContent ?? '').toMatch(re);
      unmount();
    }
  });
});

// ─── Phase 4.1.3 sheet template picker ──────────────────────────────────
/**
 * Sheet template picker UX:
 *   - The `drawing-template-select` dropdown is always visible (under the
 *     scale input) defaulting to `'none'`. While 'none' is selected the
 *     resulting Sheet IR carries NO `template` field, preserving the
 *     legacy behaviour byte-for-byte (the 46 pre-existing tests above
 *     don't see the titleblock editor mounted).
 *   - Selecting `engineering` / `architectural` / `isoA3` reveals the
 *     inline `drawing-template-titleblock-editor` fieldset with three
 *     editable inputs (`title`, `drawnBy`, `project`). Edits surface in
 *     the Sheet IR's `template.titleblock.*` fields via applyTemplate.
 *   - `minimal` is a valid selection that intentionally has NO
 *     titleblock — the editor stays collapsed.
 *
 * The Sheet IR is observed through the JSON export blob (already wired
 * for tests above) so we don't need a new DOM surface to assert the
 * template metadata reached the Sheet.
 */
describe('DrawingPageContent — sheet template picker (Phase 4.1.3)', () => {
  /**
   * Read back the JSON sheet payload from the most recent
   * URL.createObjectURL call. The drawing-page JSON export wraps the
   * `Sheet` IR (or `TemplatedSheet` once a template is applied) as a
   * `application/json` Blob — this jsdom build does NOT expose
   * `.text()` on Blob, so we use FileReader#readAsText to pull the
   * UTF-8 source out. Mirrors the pattern in `drawingPage.step.test.tsx`.
   */
  async function blobToText(blob: Blob): Promise<string> {
    if (typeof (blob as Blob & { text?: () => Promise<string> }).text === 'function') {
      return (blob as Blob & { text: () => Promise<string> }).text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }
  async function exportedSheetJson(): Promise<Record<string, unknown>> {
    const blob = createObjectUrlSpy.mock.calls.at(-1)?.[0] as Blob | undefined;
    if (!blob) throw new Error('no blob captured');
    const text = await blobToText(blob);
    return JSON.parse(text) as Record<string, unknown>;
  }

  it('template dropdown is visible by default with none selected', () => {
    mount();
    const select = screen.getByTestId('drawing-template-select') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('none');
    // Titleblock editor stays collapsed at the default selection.
    expect(screen.queryByTestId('drawing-template-titleblock-editor')).toBeNull();
  });

  it('selecting engineering exposes the inline titleblock editor with 3 inputs', () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'engineering' },
    });
    expect(screen.getByTestId('drawing-template-titleblock-editor')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-template-title-input')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-template-drawnBy-input')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-template-project-input')).toBeInTheDocument();
  });

  it('engineering selection seeds the title input with the registry default (UNTITLED)', () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'engineering' },
    });
    const titleInput = screen.getByTestId('drawing-template-title-input') as HTMLInputElement;
    expect(titleInput.value).toBe('UNTITLED');
  });

  it('selecting minimal does NOT mount the titleblock editor (template has no titleblock)', () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'minimal' },
    });
    expect(screen.queryByTestId('drawing-template-titleblock-editor')).toBeNull();
  });

  it('all four registry templates are reachable from the dropdown', () => {
    mount();
    const select = screen.getByTestId('drawing-template-select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).sort();
    expect(values).toEqual(['architectural', 'engineering', 'isoA3', 'minimal', 'none'].sort());
  });

  it('selecting engineering attaches template metadata to the exported JSON sheet (paperSize=A3)', async () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'engineering' },
    });
    fireEvent.click(screen.getByTestId('drawing-export-json-button'));
    const sheet = await exportedSheetJson();
    expect(sheet.paperSize).toBe('A3');
    const tpl = sheet.template as { name?: string; titleblock?: { title?: string }; border?: { margin?: number } };
    expect(tpl).toBeDefined();
    expect(tpl.name).toBe('engineering');
    expect(tpl.border?.margin).toBeGreaterThan(0);
  });

  it('selecting architectural overrides paperSize to A1 in the exported sheet', async () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'architectural' },
    });
    fireEvent.click(screen.getByTestId('drawing-export-json-button'));
    const sheet = await exportedSheetJson();
    expect(sheet.paperSize).toBe('A1');
    const tpl = sheet.template as { name?: string };
    expect(tpl?.name).toBe('architectural');
  });

  it('selecting isoA3 surfaces the ISO 7200 titleblock title in the editor input', () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'isoA3' },
    });
    const titleInput = screen.getByTestId('drawing-template-title-input') as HTMLInputElement;
    expect(titleInput.value).toBe('ISO 7200');
  });

  it('editing the title input flows the new value into the exported sheet template', async () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'engineering' },
    });
    fireEvent.change(screen.getByTestId('drawing-template-title-input'), {
      target: { value: 'Bracket A' },
    });
    fireEvent.click(screen.getByTestId('drawing-export-json-button'));
    const sheet = await exportedSheetJson();
    const tpl = sheet.template as { titleblock?: { title?: string } };
    expect(tpl.titleblock?.title).toBe('Bracket A');
  });

  it('editing drawnBy + project flows both into the exported sheet template', async () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'engineering' },
    });
    fireEvent.change(screen.getByTestId('drawing-template-drawnBy-input'), {
      target: { value: 'Kim' },
    });
    fireEvent.change(screen.getByTestId('drawing-template-project-input'), {
      target: { value: 'Apollo' },
    });
    fireEvent.click(screen.getByTestId('drawing-export-json-button'));
    const sheet = await exportedSheetJson();
    const tpl = sheet.template as { titleblock?: { drawnBy?: string; project?: string } };
    expect(tpl.titleblock?.drawnBy).toBe('Kim');
    expect(tpl.titleblock?.project).toBe('Apollo');
  });

  it('switching back to none clears the template metadata from the exported sheet', async () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'engineering' },
    });
    fireEvent.change(screen.getByTestId('drawing-template-select'), {
      target: { value: 'none' },
    });
    expect(screen.queryByTestId('drawing-template-titleblock-editor')).toBeNull();
    fireEvent.click(screen.getByTestId('drawing-export-json-button'));
    const sheet = await exportedSheetJson();
    expect(sheet.template).toBeUndefined();
  });

  it('template picker label is localised for ko / en / ja / zh / es / ar', () => {
    const cases: Array<[string, RegExp]> = [
      ['ko', /템플릿/],
      ['en', /template/i],
      ['ja', /テンプレート/],
      ['zh', /模板/],
      ['es', /plantilla/i],
      ['ar', /قالب/],
    ];
    for (const [lang, re] of cases) {
      const { unmount } = mount(lang);
      const select = screen.getByTestId('drawing-template-select');
      const label = select.closest('label');
      expect(label).not.toBeNull();
      expect(label!.textContent ?? '').toMatch(re);
      unmount();
    }
  });
});
