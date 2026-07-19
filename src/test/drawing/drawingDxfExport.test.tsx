/** @vitest-environment jsdom */
/**
 * drawingDxfExport.test.tsx — W1-E R4 wiring.
 *
 * `lib/drawing/dxfExport.sheetToDxf` was implemented + unit-tested but had
 * zero UI callers, so no user could produce a DXF. This suite covers the
 * button that closes that gap.
 *
 * The important assertion is NOT "a download fired" — it is that the
 * downloaded blob carries a real, structurally valid DXF stream. A wiring
 * bug that hands `sheetToDxf` the wrong object (or an empty sheet) would
 * still fire a download and still create an object URL; only reading the
 * bytes back catches it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';

// ─── env shims ───────────────────────────────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;

beforeEach(() => {
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

/**
 * Read the blob handed to the last URL.createObjectURL call.
 *
 * This jsdom build's Blob has no `.text()` (same gap `SheetPngExportButton`
 * documents for `Blob.arrayBuffer`), so go through FileReader.
 */
async function lastDownloadedText(): Promise<string> {
  const blob = createObjectUrlSpy.mock.calls.at(-1)?.[0] as Blob;
  expect(blob).toBeInstanceOf(Blob);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('drawing page — DXF export wiring', () => {
  it('renders a DXF export button', () => {
    render(<DrawingPageContent lang="en" />);
    expect(screen.getByTestId('drawing-export-dxf-button')).toBeTruthy();
  });

  it('clicking it downloads a blob with the DXF mime type', () => {
    render(<DrawingPageContent lang="en" />);
    fireEvent.click(screen.getByTestId('drawing-export-dxf-button'));
    expect(createObjectUrlSpy).toHaveBeenCalled();
    const blob = createObjectUrlSpy.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toContain('dxf');
  });

  it('emits a NON-EMPTY, structurally valid DXF stream', async () => {
    render(<DrawingPageContent lang="en" />);
    fireEvent.click(screen.getByTestId('drawing-export-dxf-button'));
    const text = await lastDownloadedText();

    // Not an empty file — the whole point of the check.
    expect(text.length).toBeGreaterThan(200);

    // DXF R12 envelope.
    expect(text).toContain('SECTION');
    expect(text).toContain('HEADER');
    expect(text).toContain('$ACADVER');
    expect(text).toContain('AC1009');
    expect(text).toContain('ENTITIES');
    expect(text).toContain('ENDSEC');
    expect(text.trimEnd().endsWith('EOF')).toBe(true);

    // Real geometry, not just an envelope: the sheet border rect alone is
    // 4 LINEs, and the default 3-view sheet adds 4 viewports × 4 LINEs.
    const lineCount = (text.match(/\bLINE\b/g) ?? []).length;
    expect(lineCount).toBeGreaterThanOrEqual(8);

    // Layers the serializer assigns — proves the sheet actually flowed in
    // rather than a default/blank Sheet being serialized.
    expect(text).toContain('SHEET_BORDER');
    expect(text).toMatch(/VP_/);
  });

  it('reflects the live sheet: switching paper size changes the DXF extents', async () => {
    render(<DrawingPageContent lang="en" />);

    fireEvent.click(screen.getByTestId('drawing-export-dxf-button'));
    const before = await lastDownloadedText();

    // Change paper size, re-export, and confirm the stream tracked it.
    const paperSelect = screen.getByTestId('drawing-paper-select') as HTMLSelectElement;
    const other = Array.from(paperSelect.options)
      .map((o) => o.value)
      .find((v) => v !== paperSelect.value);
    expect(other).toBeTruthy();
    fireEvent.change(paperSelect, { target: { value: other } });

    fireEvent.click(screen.getByTestId('drawing-export-dxf-button'));
    const after = await lastDownloadedText();

    expect(after).not.toBe(before);
  });

  it('labels the button in Korean and English', () => {
    const { unmount } = render(<DrawingPageContent lang="en" />);
    expect(screen.getByTestId('drawing-export-dxf-button').textContent ?? '')
      .toMatch(/DXF/);
    unmount();

    render(<DrawingPageContent lang="ko" />);
    expect(screen.getByTestId('drawing-export-dxf-button').textContent ?? '')
      .toMatch(/DXF 내보내기/);
  });
});
