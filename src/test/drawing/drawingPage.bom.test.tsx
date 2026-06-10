/** @vitest-environment jsdom */
/**
 * drawingPage.bom.test.tsx — SolidWorks-parity Phase 3: assembly-mode
 * "BOM + balloons" toggle on the production /drawing/ page.
 *
 * Covers:
 *   - toggle renders in assembly mode, defaults OFF, no BOM canvas
 *   - toggle ON → BOM overview canvas mounts with BOM table + balloons
 *     (one balloon per part instance, deduped table rows)
 *   - toggle OFF → canvas unmounts
 *   - PDF export prepends the BOM sheet to the bundle (IR + svg aligned)
 *   - BOM sheet alone (no part sheets) is exportable
 *   - sample switch resets the toggle
 *   - 6-lang i18n surfaces the toggle label
 *
 * exportSheetsToPdf is mocked (same pattern as drawingPage.assembly.test).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// DrawingPageContent's back-to-editor button calls useRouter() (next/navigation);
// jsdom has no app router mounted, so stub it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

// ─── pdfExport mock (hoisted; state stashed on a global symbol) ───────────

vi.mock('@/lib/drawing/pdfExport', () => {
  class MockPdfExportError extends Error {
    public readonly code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'PdfExportError';
      this.code = code;
    }
  }
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

// Component must be imported AFTER vi.mock so its bound reference resolves
// to the mock function.
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';
import type { Sheet } from '@/lib/drawing/sheet';

// ─── env shims ───────────────────────────────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;

beforeEach(() => {
  const pdfState = getPdfMockState();
  pdfState.mock.mockReset();
  pdfState.mock.mockImplementation(pdfState.defaultImpl);
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  createObjectUrlSpy = vi.fn(() => 'blob:mock-url');
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectUrlSpy, configurable: true, writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(), configurable: true, writable: true,
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

function enableBom() {
  fireEvent.click(screen.getByTestId('drawing-assembly-bom-toggle'));
}

function selectSample(name: string) {
  fireEvent.change(screen.getByTestId('drawing-assembly-sample-select'), {
    target: { value: name },
  });
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('DrawingPageContent — BOM + balloons toggle', () => {
  it('renders the toggle in assembly mode, defaults OFF, no BOM canvas', () => {
    mount();
    // Not present in the single-part flow.
    expect(screen.queryByTestId('drawing-assembly-bom-toggle')).toBeNull();
    enableAssemblyMode();
    const toggle = screen.getByTestId('drawing-assembly-bom-toggle') as HTMLInputElement;
    expect(toggle.type).toBe('checkbox');
    expect(toggle.checked).toBe(false);
    expect(screen.queryByTestId('drawing-assembly-bom-canvas')).toBeNull();
  });

  it('toggle ON → BOM canvas mounts with the BOM table + one balloon per part', () => {
    mount();
    enableAssemblyMode();
    enableBom();
    const canvas = screen.getByTestId('drawing-assembly-bom-canvas');
    expect(canvas).toBeInTheDocument();
    const table = canvas.querySelector('[data-testid="sheet-renderer-bom-table"]')!;
    expect(table).not.toBeNull();
    // two-cubes-concentric: Cube A + Cube B → 2 distinct rows.
    expect(table.getAttribute('data-rows')).toBe('2');
    const balloons = canvas.querySelector('[data-testid="sheet-renderer-balloons"]')!;
    expect(balloons.getAttribute('data-count')).toBe('2');
  });

  it("three-cubes-chain → 3 balloons + 3 BOM rows", () => {
    mount();
    enableAssemblyMode();
    selectSample('three-cubes-chain');
    enableBom();
    const canvas = screen.getByTestId('drawing-assembly-bom-canvas');
    expect(
      canvas.querySelector('[data-testid="sheet-renderer-bom-table"]')!.getAttribute('data-rows'),
    ).toBe('3');
    expect(
      canvas.querySelector('[data-testid="sheet-renderer-balloons"]')!.getAttribute('data-count'),
    ).toBe('3');
  });

  it('the BOM viewport draws the real projected assembly edges (geometry wired)', () => {
    mount();
    enableAssemblyMode();
    enableBom();
    const canvas = screen.getByTestId('drawing-assembly-bom-canvas');
    const geom = canvas.querySelector('[data-testid="sheet-renderer-vp-geometry-asm-front"]');
    expect(geom).not.toBeNull();
    expect(Number(geom!.getAttribute('data-visible'))).toBeGreaterThan(0);
  });

  it('toggle OFF removes the BOM canvas', () => {
    mount();
    enableAssemblyMode();
    enableBom();
    expect(screen.getByTestId('drawing-assembly-bom-canvas')).toBeInTheDocument();
    enableBom(); // second click = off
    expect(screen.queryByTestId('drawing-assembly-bom-canvas')).toBeNull();
  });

  it('sample switch resets the toggle (no stale BOM canvas)', () => {
    mount();
    enableAssemblyMode();
    enableBom();
    expect(screen.getByTestId('drawing-assembly-bom-canvas')).toBeInTheDocument();
    selectSample('hinge-pair');
    expect(
      (screen.getByTestId('drawing-assembly-bom-toggle') as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.queryByTestId('drawing-assembly-bom-canvas')).toBeNull();
  });
});

// ─── PDF export integration ────────────────────────────────────────────────

describe('DrawingPageContent — BOM sheet in the assembly PDF export', () => {
  it('toggle ON + 2 part sheets → exporter receives 3 sheets, BOM sheet FIRST', async () => {
    mount();
    enableAssemblyMode();
    enableBom();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_b-sheet'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(getPdfMockState().mock).toHaveBeenCalledTimes(1);
    });
    const [sheets, svgRefs] = getPdfMockState().mock.mock.calls[0] as [
      ReadonlyArray<Sheet>,
      ReadonlyArray<SVGElement>,
    ];
    expect(sheets.length).toBe(3);
    expect(svgRefs.length).toBe(3);
    // BOM overview sheet is the cover page and carries the BOM + balloons IR.
    expect(sheets[0].id).toBe('assembly-bom-two-cubes-concentric');
    expect(sheets[0].bom?.length).toBe(2);
    expect(sheets[0].balloons?.length).toBe(2);
    // Its paired SVG contains the rendered BOM table + balloons.
    expect(
      svgRefs[0].querySelector('[data-testid="sheet-renderer-bom-table"]'),
    ).not.toBeNull();
    expect(
      svgRefs[0]
        .querySelector('[data-testid="sheet-renderer-balloons"]')
        ?.getAttribute('data-count'),
    ).toBe('2');
    // Remaining pages are the per-part sheets, untouched.
    expect(sheets.slice(1).map((s) => s.id).sort()).toEqual([
      'assembly-sheet-cube_a',
      'assembly-sheet-cube_b',
    ]);
  });

  it('toggle ON with NO part sheets → button enabled, exporter receives just the BOM sheet', async () => {
    mount();
    enableAssemblyMode();
    const btn = screen.getByTestId('drawing-assembly-export-pdf') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    enableBom();
    expect(btn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => {
      expect(getPdfMockState().mock).toHaveBeenCalledTimes(1);
    });
    const [sheets] = getPdfMockState().mock.mock.calls[0] as [ReadonlyArray<Sheet>, ReadonlyArray<SVGElement>];
    expect(sheets.length).toBe(1);
    expect(sheets[0].bom?.length).toBe(2);
  });

  it('toggle OFF (default) → export bundle is unchanged (regression)', async () => {
    mount();
    enableAssemblyMode();
    fireEvent.click(screen.getByTestId('drawing-assembly-part-cube_a-sheet'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      expect(getPdfMockState().mock).toHaveBeenCalledTimes(1);
    });
    const [sheets] = getPdfMockState().mock.mock.calls[0] as [ReadonlyArray<Sheet>, ReadonlyArray<SVGElement>];
    expect(sheets.length).toBe(1);
    expect(sheets[0].id).toBe('assembly-sheet-cube_a');
    expect(sheets[0].bom).toBeUndefined();
  });

  it('export downloads an application/pdf blob with the BOM sheet included', async () => {
    mount();
    enableAssemblyMode();
    enableBom();
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawing-assembly-export-pdf'));
    });
    await waitFor(() => {
      const calls = createObjectUrlSpy.mock.calls.map((c) => c[0] as Blob);
      expect(calls.some((b) => b?.type === 'application/pdf')).toBe(true);
    });
  });
});

// ─── i18n (6 langs — interface-enforced) ───────────────────────────────────

describe('DrawingPageContent — BOM toggle i18n', () => {
  const cases: ReadonlyArray<[string, RegExp]> = [
    ['ko', /BOM \+ 벌룬/],
    ['en', /BOM \+ balloons/],
    ['ja', /BOM \+ バルーン/],
    ['zh', /BOM \+ 球标/],
    ['es', /BOM \+ globos/],
    ['ar', /BOM \+ بالونات/],
  ];
  for (const [lang, re] of cases) {
    it(`${lang} surfaces the toggle label`, () => {
      mount(lang);
      enableAssemblyMode();
      const label = screen.getByTestId('drawing-assembly-bom-toggle').parentElement;
      expect(label?.textContent ?? '').toMatch(re);
    });
  }
});
