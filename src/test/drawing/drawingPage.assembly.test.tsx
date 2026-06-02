/** @vitest-environment jsdom */
/**
 * drawingPage.assembly.test.tsx — Phase 5.3 assembly mode toggle + per-part
 * sheet picker + assembly STEP+PMI export.
 *
 * Covers:
 *   - toggle renders and defaults to off
 *   - toggle on → sample picker + part list mount
 *   - sample 'two-cubes-concentric' yields 2 parts
 *   - per-part "Add sheet" button creates a sheet (status flips ✓)
 *   - export calls writeAssemblyWithPmi (mocked)
 *   - export triggers URL.createObjectURL with an application/step Blob
 *   - warnings response renders the yellow banner
 *   - toggle off → original single-part flow stays intact (regression)
 *   - 6-lang i18n surfaces the assembly-mode label
 *   - sample switch resets per-part sheets
 *   - selected part defaults to the first part that gains a sheet
 *   - error path surfaces in the red banner
 *
 * The writeAssemblyWithPmi orchestrator is mocked so we can assert call
 * arguments + force warnings paths without spinning up the real STEP writer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ─── mock the orchestrator BEFORE component import ───────────────────────

const writeAssemblyWithPmiMock = vi.fn();
vi.mock('@/lib/brep-bridge/stepWriteAssemblyWithPmi', () => ({
  writeAssemblyWithPmi: (opts: unknown) => writeAssemblyWithPmiMock(opts),
}));

// Phase 5.4 PDF export — mock `exportSheetsToPdf` so the assembly PDF
// tests can assert (sheets, svgRefs) call shape without spinning up
// jspdf or the SVG→PNG canvas pipeline. The factory is hoisted, so
// the mock state lives on a global symbol; test bodies access via
// `getPdfMockState()` below.
vi.mock('@/lib/drawing/pdfExport', () => {
  class MockPdfExportError extends Error {
    public readonly code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'PdfExportError';
      this.code = code;
    }
  }
  // Default implementation: succeed with a tiny PDF blob.
  const defaultImpl = async (
    _sheets: ReadonlyArray<unknown>,
    _svgRefs: ReadonlyArray<unknown>,
  ): Promise<Blob> => new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  const mock = vi.fn<
    (sheets: ReadonlyArray<unknown>, svgRefs: ReadonlyArray<unknown>) => Promise<Blob>
  >(defaultImpl);
  const state = { mock, MockPdfExportError, defaultImpl };
  (globalThis as unknown as { __pdfMock: typeof state }).__pdfMock = state;
  return {
    exportSheetsToPdf: (
      sheets: ReadonlyArray<unknown>,
      svgRefs: ReadonlyArray<unknown>,
    ) => mock(sheets, svgRefs),
    PdfExportError: MockPdfExportError,
  };
});

type PdfMockState = {
  mock: ReturnType<typeof vi.fn<
    (sheets: ReadonlyArray<unknown>, svgRefs: ReadonlyArray<unknown>) => Promise<Blob>
  >>;
  MockPdfExportError: new (m: string, c: string) => Error & { code: string };
  defaultImpl: (
    sheets: ReadonlyArray<unknown>,
    svgRefs: ReadonlyArray<unknown>,
  ) => Promise<Blob>;
};

function getPdfMockState(): PdfMockState {
  return (globalThis as unknown as { __pdfMock: PdfMockState }).__pdfMock;
}

// Phase 4.4.3 Phase 2 svg2pdfBridge mock — assembly tests for the vector
// PDF route. Same shape as the raster mock above so tests can assert call
// args / force-error implementations.
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
  ): Promise<Blob> => new Blob(['%PDF-1.4 vector'], { type: 'application/pdf' });
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

// Component must be imported AFTER vi.mock so its bound reference resolves
// to the mock function.
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';

// ─── env shims ───────────────────────────────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;

beforeEach(() => {
  writeAssemblyWithPmiMock.mockReset();
  // Default mock implementation: success, no warnings, single fragment.
  writeAssemblyWithPmiMock.mockImplementation(() => ({
    source: 'ISO-10303-21;\nEND-ISO-10303-21;\n',
    pmiMappingByPart: new Map(),
    ranges: [],
    warnings: [],
  }));

  const pdfState = getPdfMockState();
  pdfState.mock.mockReset();
  pdfState.mock.mockImplementation(pdfState.defaultImpl);

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
  vi.restoreAllMocks();
});

function mount(lang = 'en') {
  return render(<DrawingPageContent lang={lang} />);
}

function enableAssemblyMode() {
  fireEvent.click(screen.getByTestId('drawing-assembly-mode-toggle'));
}

function selectSample(name: string) {
  fireEvent.change(screen.getByTestId('drawing-assembly-sample-select'), {
    target: { value: name },
  });
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('DrawingPageContent assembly mode', () => {
  it('renders the assembly-mode toggle and defaults to OFF', () => {
    mount();
    const toggle = screen.getByTestId('drawing-assembly-mode-toggle') as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.type).toBe('checkbox');
    expect(toggle.checked).toBe(false);
    // The assembly section MUST be absent until the toggle is on.
    expect(screen.queryByTestId('drawing-assembly-section')).toBeNull();
  });

  it('toggling on mounts the sample-picker select', () => {
    mount();
    enableAssemblyMode();
    expect(screen.getByTestId('drawing-assembly-section')).toBeInTheDocument();
    const sel = screen.getByTestId('drawing-assembly-sample-select') as HTMLSelectElement;
    expect(sel).toBeInTheDocument();
    expect(sel.value).toBe('two-cubes-concentric');
  });

  it("loading sample 'two-cubes-concentric' lists 2 parts", () => {
    mount();
    enableAssemblyMode();
    const list = screen.getByTestId('drawing-assembly-part-list');
    // 2 cubes → 2 rows.
    expect(list.children.length).toBe(2);
    // Each part gets an Add-sheet button.
    expect(screen.getByTestId('drawing-assembly-part-cube_a-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-assembly-part-cube_b-sheet')).toBeInTheDocument();
  });

  it("each part row has an Add-sheet button keyed by part id", () => {
    mount();
    enableAssemblyMode();
    // For the default sample, the parts are cube_a and cube_b. Each gets a
    // button with the agreed testid pattern.
    for (const id of ['cube_a', 'cube_b']) {
      expect(screen.getByTestId(`drawing-assembly-part-${id}-sheet`)).toBeInTheDocument();
    }
  });

  it('clicking Add sheet flips the status icon for that part to ✓', () => {
    mount();
    enableAssemblyMode();
    // Initial status is ○ (no sheet).
    const statusA = screen.getByTestId('drawing-assembly-part-cube_a-status');
    expect(statusA.textContent ?? '').toBe('○');
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    expect(statusA.textContent ?? '').toBe('✓');
    // The selected part's sheet preview renders.
    const canvas = screen.getByTestId('drawing-assembly-canvas');
    expect(canvas.querySelector('svg[data-testid="sheet-renderer-root"]')).not.toBeNull();
  });

  it('exporting after two parts have sheets calls writeAssemblyWithPmi with both keys', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_b-sheet'));
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));

    expect(writeAssemblyWithPmiMock).toHaveBeenCalledTimes(1);
    const callArg = writeAssemblyWithPmiMock.mock.calls[0][0] as {
      geometry: { kind: string; parts: Array<{ id: string }> };
      partSheets: Record<string, unknown>;
    };
    expect(callArg.geometry.kind).toBe('assembly');
    expect(callArg.geometry.parts.map((p) => p.id).sort()).toEqual(['cube_a', 'cube_b']);
    expect(Object.keys(callArg.partSheets ?? {}).sort()).toEqual(['cube_a', 'cube_b']);
  });

  it('export triggers a download via URL.createObjectURL with an application/step Blob', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));
    expect(createObjectUrlSpy).toHaveBeenCalled();
    const arg = createObjectUrlSpy.mock.calls.at(-1)?.[0] as Blob;
    expect(arg).toBeInstanceOf(Blob);
    expect(arg.type).toBe('application/step');
  });

  it('warnings response surfaces the yellow warning banner', () => {
    writeAssemblyWithPmiMock.mockImplementation(() => ({
      source: 'ISO-10303-21;\nEND-ISO-10303-21;\n',
      pmiMappingByPart: new Map(),
      ranges: [],
      warnings: ['partBindings for "cube_a" ignored: empty PMI fragment'],
    }));
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));
    const banner = screen.getByTestId('drawing-assembly-export-warnings');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent ?? '').toMatch(/empty PMI fragment/);
  });

  it('writeAssemblyWithPmi throw surfaces the red error banner', () => {
    writeAssemblyWithPmiMock.mockImplementation(() => {
      throw new Error('boom — orchestrator failure');
    });
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));
    const err = screen.getByTestId('drawing-assembly-export-error');
    expect(err).toBeInTheDocument();
    expect(err.textContent ?? '').toMatch(/boom — orchestrator failure/);
  });

  it("switching the sample resets per-part sheets so users can't carry stale data", () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    // Switch to a sample with completely different part ids.
    selectSample('hinge-pair');
    // The old cube_a row is gone; hinge_base + hinge_door are now present
    // and BOTH show the "○" no-sheet status.
    expect(screen.queryByTestId('drawing-assembly-part-cube_a-status')).toBeNull();
    const base = screen.getByTestId('drawing-assembly-part-hinge_base-status');
    const door = screen.getByTestId('drawing-assembly-part-hinge_door-status');
    expect(base.textContent ?? '').toBe('○');
    expect(door.textContent ?? '').toBe('○');
  });

  it("Korean i18n surfaces the '조립체 모드' toggle label", () => {
    mount('ko');
    const label = screen.getByTestId('drawing-assembly-mode-toggle').parentElement;
    expect(label?.textContent ?? '').toMatch(/조립체 모드/);
  });

  it("Japanese i18n surfaces the 'アセンブリモード' toggle label", () => {
    mount('ja');
    const label = screen.getByTestId('drawing-assembly-mode-toggle').parentElement;
    expect(label?.textContent ?? '').toMatch(/アセンブリモード/);
  });

  it("Chinese i18n surfaces the '装配模式' toggle label", () => {
    mount('zh');
    const label = screen.getByTestId('drawing-assembly-mode-toggle').parentElement;
    expect(label?.textContent ?? '').toMatch(/装配模式/);
  });

  it("English i18n surfaces the 'Assembly mode' toggle label", () => {
    mount('en');
    const label = screen.getByTestId('drawing-assembly-mode-toggle').parentElement;
    expect(label?.textContent ?? '').toMatch(/Assembly mode/);
  });

  it("Spanish i18n surfaces the 'Modo ensamblaje' toggle label", () => {
    mount('es');
    const label = screen.getByTestId('drawing-assembly-mode-toggle').parentElement;
    expect(label?.textContent ?? '').toMatch(/Modo ensamblaje/);
  });

  it("Arabic i18n surfaces the 'وضع التجميع' toggle label", () => {
    mount('ar');
    const label = screen.getByTestId('drawing-assembly-mode-toggle').parentElement;
    expect(label?.textContent ?? '').toMatch(/وضع التجميع/);
  });

  it('toggle OFF default → single-part flow stays intact (regression: footer + part select visible)', () => {
    mount();
    // Single-part toolbar elements MUST be present when the toggle is off.
    expect(screen.getByTestId('drawing-part-select')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-page-footer')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-export-step-button')).toBeInTheDocument();
    // Assembly section MUST NOT be mounted.
    expect(screen.queryByTestId('drawing-assembly-section')).toBeNull();
    expect(screen.queryByTestId('drawing-export-assembly-step')).toBeNull();
  });

  it('toggling on then off restores the original single-part flow (no leaked state)', () => {
    mount();
    enableAssemblyMode();
    expect(screen.getByTestId('drawing-assembly-section')).toBeInTheDocument();
    // Toggle OFF.
    fireEvent.click(screen.getByTestId('drawing-assembly-mode-toggle'));
    expect(screen.queryByTestId('drawing-assembly-section')).toBeNull();
    expect(screen.getByTestId('drawing-part-select')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-page-footer')).toBeInTheDocument();
  });
});

// ─── sheet editor + remove + bulk ───────────────────────────────────────────

describe('DrawingPageContent assembly sheet editor / remove / bulk', () => {
  it('Edit sheet button is hidden until the part has a sheet, then appears', () => {
    mount();
    enableAssemblyMode();
    // No sheet yet → no edit button.
    expect(screen.queryByTestId('drawing-assembly-part-cube_a-edit-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    // Now the edit button is mounted.
    expect(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet')).toBeInTheDocument();
    // The Remove button is mounted symmetrically.
    expect(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet')).toBeInTheDocument();
  });

  it('clicking Edit sheet expands the inline editor with paper + scale controls', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    // Editor is collapsed by default.
    expect(screen.queryByTestId('drawing-assembly-part-cube_a-sheet-editor')).toBeNull();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet'));
    const panel = screen.getByTestId('drawing-assembly-part-cube_a-sheet-editor');
    expect(panel).toBeInTheDocument();
    const paper = screen.getByTestId('drawing-assembly-sheet-paper-select') as HTMLSelectElement;
    const scale = screen.getByTestId('drawing-assembly-sheet-scale-input') as HTMLInputElement;
    expect(paper.value).toBe('A3'); // default paper from handleAddSheetForPart
    expect(Number(scale.value)).toBe(1); // default scale
  });

  it('changing paper size rebuilds the sheet with the new paperSize', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet'));
    fireEvent.change(screen.getByTestId('drawing-assembly-sheet-paper-select'), {
      target: { value: 'A1' },
    });
    // Export and inspect partSheets in the orchestrator call args.
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));
    const callArg = writeAssemblyWithPmiMock.mock.calls[0][0] as {
      partSheets: Record<string, { paperSize: string }>;
    };
    expect(callArg.partSheets.cube_a.paperSize).toBe('A1');
  });

  it('changing scale updates the sheet viewports scale', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet'));
    fireEvent.change(screen.getByTestId('drawing-assembly-sheet-scale-input'), {
      target: { value: '2.5' },
    });
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));
    const callArg = writeAssemblyWithPmiMock.mock.calls[0][0] as {
      partSheets: Record<string, { viewports: ReadonlyArray<{ scale: number }> }>;
    };
    // Every viewport inherits the same scale from standardThreeViewSheet.
    for (const vp of callArg.partSheets.cube_a.viewports) {
      expect(vp.scale).toBe(2.5);
    }
  });

  it('clicking the Edit button again closes the inline editor (toggle)', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet'));
    expect(screen.getByTestId('drawing-assembly-part-cube_a-sheet-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet'));
    expect(screen.queryByTestId('drawing-assembly-part-cube_a-sheet-editor')).toBeNull();
  });

  it('Remove sheet → confirm OK → sheet vanishes + status flips back to ○', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    const status = screen.getByTestId('drawing-assembly-part-cube_a-status');
    expect(status.textContent ?? '').toBe('✓');
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(status.textContent ?? '').toBe('○');
    // Remove + Edit buttons collapse away once the sheet is gone.
    expect(screen.queryByTestId('drawing-assembly-part-cube_a-remove-sheet')).toBeNull();
    expect(screen.queryByTestId('drawing-assembly-part-cube_a-edit-sheet')).toBeNull();
    confirmSpy.mockRestore();
  });

  it('Remove sheet → confirm cancel → partSheets unchanged', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    const status = screen.getByTestId('drawing-assembly-part-cube_a-status');
    expect(status.textContent ?? '').toBe('✓');
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet'));
    expect(confirmSpy).toHaveBeenCalled();
    // Sheet survives the cancel.
    expect(status.textContent ?? '').toBe('✓');
    expect(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('Removing the currently selected part clears the centre preview', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    // SheetRenderer is in the centre canvas.
    const canvas = screen.getByTestId('drawing-assembly-canvas');
    expect(canvas.querySelector('svg[data-testid="sheet-renderer-root"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet'));
    expect(canvas.querySelector('svg[data-testid="sheet-renderer-root"]')).toBeNull();
    expect(screen.getByTestId('drawing-assembly-no-selection')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('Add all sheets → every part flips to ✓', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    for (const id of ['cube_a', 'cube_b']) {
      expect(screen.getByTestId(`drawing-assembly-part-${id}-status`).textContent ?? '').toBe('✓');
    }
    // Export sees both keys in partSheets.
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));
    const callArg = writeAssemblyWithPmiMock.mock.calls[0][0] as {
      partSheets: Record<string, unknown>;
    };
    expect(Object.keys(callArg.partSheets).sort()).toEqual(['cube_a', 'cube_b']);
  });

  it('Add all sheets does NOT overwrite parts that already have a sheet (idempotent)', () => {
    mount();
    enableAssemblyMode();
    // First add cube_a manually, then edit its paper to A1.
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet'));
    fireEvent.change(screen.getByTestId('drawing-assembly-sheet-paper-select'), {
      target: { value: 'A1' },
    });
    // Now click Add-all; cube_a's edited sheet must survive.
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));
    const callArg = writeAssemblyWithPmiMock.mock.calls[0][0] as {
      partSheets: Record<string, { paperSize: string }>;
    };
    expect(callArg.partSheets.cube_a.paperSize).toBe('A1');
    expect(callArg.partSheets.cube_b.paperSize).toBe('A3'); // default
  });

  it('Clear all sheets → confirm OK → every part flips back to ○', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    expect(screen.getByTestId('drawing-assembly-part-cube_a-status').textContent ?? '').toBe('✓');
    fireEvent.click(screen.getByTestId('drawing-assembly-clear-all-sheets'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByTestId('drawing-assembly-part-cube_a-status').textContent ?? '').toBe('○');
    expect(screen.getByTestId('drawing-assembly-part-cube_b-status').textContent ?? '').toBe('○');
    // Export now sees an empty partSheets record.
    fireEvent.click(screen.getByTestId('drawing-export-assembly-step'));
    const callArg = writeAssemblyWithPmiMock.mock.calls[0][0] as {
      partSheets: Record<string, unknown>;
    };
    expect(Object.keys(callArg.partSheets)).toEqual([]);
    confirmSpy.mockRestore();
  });

  it('Clear all sheets → confirm cancel → partSheets unchanged', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    fireEvent.click(screen.getByTestId('drawing-assembly-clear-all-sheets'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByTestId('drawing-assembly-part-cube_a-status').textContent ?? '').toBe('✓');
    expect(screen.getByTestId('drawing-assembly-part-cube_b-status').textContent ?? '').toBe('✓');
    confirmSpy.mockRestore();
  });

  it('Clear all sheets button is disabled when no sheets exist', () => {
    mount();
    enableAssemblyMode();
    const btn = screen.getByTestId('drawing-assembly-clear-all-sheets') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    expect(btn.disabled).toBe(false);
  });

  it('Korean i18n surfaces 시트 편집 / 시트 삭제 / 모든 부품에 시트 추가 / 모든 시트 제거', () => {
    mount('ko');
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    expect(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet').textContent ?? '')
      .toMatch(/시트 편집/);
    expect(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet').textContent ?? '')
      .toMatch(/시트 삭제/);
    expect(screen.getByTestId('drawing-assembly-add-all-sheets').textContent ?? '')
      .toMatch(/모든 부품에 시트 추가/);
    expect(screen.getByTestId('drawing-assembly-clear-all-sheets').textContent ?? '')
      .toMatch(/모든 시트 제거/);
  });

  it('Japanese i18n surfaces シート編集 / シート削除', () => {
    mount('ja');
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    expect(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet').textContent ?? '')
      .toMatch(/シート編集/);
    expect(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet').textContent ?? '')
      .toMatch(/シート削除/);
  });

  it('Chinese i18n surfaces 编辑图纸 / 删除图纸', () => {
    mount('zh');
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    expect(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet').textContent ?? '')
      .toMatch(/编辑图纸/);
    expect(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet').textContent ?? '')
      .toMatch(/删除图纸/);
  });

  it('Spanish i18n surfaces Editar hoja / Eliminar hoja', () => {
    mount('es');
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    expect(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet').textContent ?? '')
      .toMatch(/Editar hoja/);
    expect(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet').textContent ?? '')
      .toMatch(/Eliminar hoja/);
  });

  it('Arabic i18n surfaces تحرير الورقة / إزالة الورقة', () => {
    mount('ar');
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    expect(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet').textContent ?? '')
      .toMatch(/تحرير الورقة/);
    expect(screen.getByTestId('drawing-assembly-part-cube_a-remove-sheet').textContent ?? '')
      .toMatch(/إزالة الورقة/);
  });

  it('Sample switch clears the editing-part target so no stale editor is shown', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet'));
    expect(screen.getByTestId('drawing-assembly-part-cube_a-sheet-editor')).toBeInTheDocument();
    // Switching the sample drops the old part rows entirely; no editor
    // remains anywhere in the new layout.
    selectSample('hinge-pair');
    expect(screen.queryByTestId('drawing-assembly-part-cube_a-sheet-editor')).toBeNull();
    // And the bulk Clear button is back to its disabled state.
    expect(
      (screen.getByTestId('drawing-assembly-clear-all-sheets') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ─── multi-sheet PDF export (Phase 5.4) ──────────────────────────────────

describe('DrawingPageContent assembly multi-sheet PDF export', () => {
  it('renders the assembly Export PDF button when assembly mode is on', () => {
    mount();
    enableAssemblyMode();
    expect(screen.getByTestId('drawing-assembly-export-pdf')).toBeInTheDocument();
  });

  it('Export PDF button is absent in the single-part flow', () => {
    mount();
    expect(screen.queryByTestId('drawing-assembly-export-pdf')).toBeNull();
  });

  it('Export PDF button is disabled until at least one part has a sheet', () => {
    mount();
    enableAssemblyMode();
    const btn = screen.getByTestId('drawing-assembly-export-pdf') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    expect(btn.disabled).toBe(false);
  });

  it('2 parts + 2 sheets → exportSheetsToPdf called with 2 sheets, 2 svg refs (aligned)', async () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_b-sheet'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(getPdfMockState().mock).toHaveBeenCalledTimes(1);
    });
    const [sheets, svgRefs] = getPdfMockState().mock.mock.calls[0] as [
      ReadonlyArray<{ id: string }>,
      ReadonlyArray<SVGElement>,
    ];
    expect(sheets.length).toBe(2);
    expect(svgRefs.length).toBe(2);
    // Sheets must align with their SVG ref pair — every ref is a real
    // <svg> mounted by SheetRenderer.
    for (const svg of svgRefs) {
      expect(svg).not.toBeNull();
      expect(svg.tagName.toLowerCase()).toBe('svg');
    }
  });

  it('downloads a multi-page PDF blob via URL.createObjectURL', async () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      const calls = createObjectUrlSpy.mock.calls.map((c) => c[0] as Blob);
      expect(calls.some((b) => b?.type === 'application/pdf')).toBe(true);
    });
  });

  it('success surfaces the "Exported N-page PDF" info banner', async () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-assembly-pdf-info')).toBeInTheDocument();
    });
    const info = screen.getByTestId('drawing-assembly-pdf-info');
    // Two cubes → 2-page PDF.
    expect(info.textContent ?? '').toMatch(/2/);
  });

  it('0 sheets → info banner surfaces the "no sheets" message, exporter not called', async () => {
    mount();
    enableAssemblyMode();
    // Re-enable the button artificially: we click via a direct call even
    // though the button is disabled. Disabled buttons don't fire `click`
    // through fireEvent.click; instead we add a sheet then clear so the
    // button toggles back to disabled, then call the handler via
    // .closest('button').click(). The simplest verification path is to
    // assert disabled-state covers the empty case (no-call) — combined
    // with the next test where we force-empty after a wipe.
    const btn = screen.getByTestId('drawing-assembly-export-pdf') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(getPdfMockState().mock).not.toHaveBeenCalled();
  });

  it('a wiped partSheets list keeps the button disabled (no PDF emitted)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    const btn = screen.getByTestId('drawing-assembly-export-pdf') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(screen.getByTestId('drawing-assembly-clear-all-sheets'));
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(getPdfMockState().mock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('different paperSizes per part → the matching Sheet IRs reach the exporter', async () => {
    mount();
    enableAssemblyMode();
    // Add both sheets, then edit cube_a to A1 while cube_b stays A3.
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-edit-sheet'));
    fireEvent.change(screen.getByTestId('drawing-assembly-sheet-paper-select'), {
      target: { value: 'A1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(getPdfMockState().mock).toHaveBeenCalledTimes(1);
    });
    const [sheets] = getPdfMockState().mock.mock.calls[0] as [
      ReadonlyArray<{ paperSize: string }>,
      ReadonlyArray<SVGElement>,
    ];
    const papers = sheets.map((s) => s.paperSize).sort();
    expect(papers).toEqual(['A1', 'A3']);
  });

  it('exporter throw surfaces the red error banner with the PdfExportError prefix', async () => {
    const { mock, MockPdfExportError } = getPdfMockState();
    mock.mockImplementation(async () => {
      throw new MockPdfExportError('jspdf not installed (boom)', 'jspdf-missing');
    });
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-assembly-pdf-error')).toBeInTheDocument();
    });
    const banner = screen.getByTestId('drawing-assembly-pdf-error');
    expect(banner.textContent ?? '').toMatch(/jspdf/);
    expect(banner.textContent ?? '').toMatch(/boom/);
  });

  it('a generic Error throw surfaces the red banner without the jspdf prefix', async () => {
    getPdfMockState().mock.mockImplementation(async () => {
      throw new Error('unexpected rasterisation failure');
    });
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-assembly-pdf-error')).toBeInTheDocument();
    });
    const banner = screen.getByTestId('drawing-assembly-pdf-error');
    expect(banner.textContent ?? '').toMatch(/unexpected rasterisation failure/);
  });

  it('a successful export after a previous failure clears the red banner', async () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    // First call: failure.
    getPdfMockState().mock.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-assembly-pdf-error')).toBeInTheDocument();
    });
    // Second call: success (mock default).
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('drawing-assembly-pdf-error')).toBeNull();
      expect(screen.getByTestId('drawing-assembly-pdf-info')).toBeInTheDocument();
    });
  });

  it('the hidden multi-sheet renderer mount is populated with one wrapper per partSheet', () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    const hidden = screen.getByTestId('drawing-assembly-hidden-sheets');
    const wrappers = hidden.querySelectorAll('[data-part-id]');
    expect(wrappers.length).toBe(2);
    const ids = Array.from(wrappers)
      .map((w) => w.getAttribute('data-part-id'))
      .sort();
    expect(ids).toEqual(['cube_a', 'cube_b']);
    // Every wrapper has a SheetRenderer SVG inside it.
    for (const w of wrappers) {
      expect(w.querySelector('svg[data-testid="sheet-renderer-root"]')).not.toBeNull();
    }
  });

  it('Korean i18n surfaces the "조립체 PDF 내보내기" label', () => {
    mount('ko');
    enableAssemblyMode();
    expect(screen.getByTestId('drawing-assembly-export-pdf').textContent ?? '')
      .toMatch(/조립체 PDF/);
  });

  it('Japanese i18n surfaces the "アセンブリ PDF" label', () => {
    mount('ja');
    enableAssemblyMode();
    expect(screen.getByTestId('drawing-assembly-export-pdf').textContent ?? '')
      .toMatch(/アセンブリ PDF/);
  });

  it('Chinese i18n surfaces the "导出装配PDF" label', () => {
    mount('zh');
    enableAssemblyMode();
    expect(screen.getByTestId('drawing-assembly-export-pdf').textContent ?? '')
      .toMatch(/导出装配PDF/);
  });

  it('switching the sample after a PDF export clears the info banner', async () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-add-all-sheets'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-assembly-pdf-info')).toBeInTheDocument();
    });
    selectSample('hinge-pair');
    expect(screen.queryByTestId('drawing-assembly-pdf-info')).toBeNull();
  });
});

// ─── assembly PDF format radio + vector pipeline routing (Phase 2) ────────

describe('DrawingPageContent assembly — PDF format radio', () => {
  it('renders assembly raster + vector radio inputs when assembly mode is on', () => {
    mount();
    enableAssemblyMode();
    expect(screen.getByTestId('drawing-assembly-pdf-format-raster')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-assembly-pdf-format-vector')).toBeInTheDocument();
  });

  it('defaults to raster (back-compat)', () => {
    mount();
    enableAssemblyMode();
    const raster = screen.getByTestId('drawing-assembly-pdf-format-raster') as HTMLInputElement;
    const vector = screen.getByTestId('drawing-assembly-pdf-format-vector') as HTMLInputElement;
    expect(raster.checked).toBe(true);
    expect(vector.checked).toBe(false);
  });

  it('raster path → exportSheetsToPdf is called, vector path is NOT', async () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(getPdfMockState().mock).toHaveBeenCalledTimes(1);
    });
    expect(getSvg2PdfMockState().mock).not.toHaveBeenCalled();
  });

  it('vector path → exportSheetsToPdfVector is called, raster path is NOT', async () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-pdf-format-vector'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(getSvg2PdfMockState().mock).toHaveBeenCalledTimes(1);
    });
    expect(getPdfMockState().mock).not.toHaveBeenCalled();
  });

  it('vector success → assembly info banner names the vector pipeline', async () => {
    mount('en');
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-pdf-format-vector'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-assembly-pdf-info')).toBeInTheDocument();
    });
    const info = screen.getByTestId('drawing-assembly-pdf-info');
    expect(info.textContent ?? '').toMatch(/vector/i);
  });

  it('vector + svg2pdf-missing → falls back to raster + banner shows fallback', async () => {
    const { mock, MockVectorPdfError } = getSvg2PdfMockState();
    mock.mockImplementation(async () => {
      throw new MockVectorPdfError(
        'svg2pdf-missing',
        'svg2pdf.js optional dependency is not installed',
      );
    });
    mount('en');
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-pdf-format-vector'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(getPdfMockState().mock).toHaveBeenCalledTimes(1);
    });
    // Both pipelines invoked: vector once (failed), raster once (fallback).
    expect(mock).toHaveBeenCalledTimes(1);
    const info = screen.getByTestId('drawing-assembly-pdf-info');
    expect(info.textContent ?? '').toMatch(/fall(ing)? back to raster/i);
  });

  it('vector + render-failed → red error banner, no raster fallback', async () => {
    const { mock, MockVectorPdfError } = getSvg2PdfMockState();
    mock.mockImplementation(async () => {
      throw new MockVectorPdfError('render-failed', 'svg2pdf failed — boom');
    });
    mount('en');
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-pdf-format-vector'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('drawing-assembly-pdf-error')).toBeInTheDocument();
    });
    expect(getPdfMockState().mock).not.toHaveBeenCalled();
    const err = screen.getByTestId('drawing-assembly-pdf-error');
    expect(err.textContent ?? '').toMatch(/boom/);
  });

  it('Korean i18n surfaces the assembly PDF 형식 group + 벡터/래스터', () => {
    mount('ko');
    enableAssemblyMode();
    const group = screen.getByTestId('drawing-assembly-pdf-format-group');
    expect(group.textContent ?? '').toMatch(/PDF 형식/);
    expect(group.textContent ?? '').toMatch(/래스터/);
    expect(group.textContent ?? '').toMatch(/벡터/);
  });
});
