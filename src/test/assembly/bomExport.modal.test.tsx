/** @vitest-environment jsdom */
/**
 * AssemblyBrowserModal — BOM export integration tests (Phase 4.5).
 *
 * Verifies the modal footer's "Export BOM" button opens a CSV/JSON
 * sub-menu and that clicking either sub-option triggers a download blob
 * whose body matches what bomToCsv / bomToJson would produce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AssemblyBrowserModal, {
  type AssemblyBrowserLang,
} from '@/app/[lang]/shape-generator/assembly/AssemblyBrowserModal';
import { IDENTITY_QUAT, type AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── jsdom blob plumbing ────────────────────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;
let capturedBlobs: Blob[];
let lastDownloadFilename: string | null;

async function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  capturedBlobs = [];
  lastDownloadFilename = null;
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  createObjectUrlSpy = vi.fn((b: Blob) => {
    capturedBlobs.push(b);
    return 'blob:mock-url';
  });
  revokeObjectUrlSpy = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectUrlSpy,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectUrlSpy,
    configurable: true,
    writable: true,
  });
  // Capture the synthetic <a download="..."> filename so tests can assert it.
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = origCreateElement(tag);
    if (tag.toLowerCase() === 'a') {
      const anchor = el as HTMLAnchorElement;
      // Capture the download property when set.
      const desc = Object.getOwnPropertyDescriptor(
        HTMLAnchorElement.prototype,
        'download',
      );
      Object.defineProperty(anchor, 'download', {
        configurable: true,
        get() {
          return desc?.get?.call(this) ?? '';
        },
        set(v) {
          lastDownloadFilename = String(v);
          desc?.set?.call(this, v);
        },
      });
      // Stub click() so jsdom doesn't try to navigate.
      anchor.click = vi.fn();
    }
    return el;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCreate) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreate,
      configurable: true,
      writable: true,
    });
  }
  if (originalRevoke) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevoke,
      configurable: true,
      writable: true,
    });
  }
});

// ─── fixtures ────────────────────────────────────────────────────────────

const SQUARE_10x10: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function seedState(): AssemblyState {
  return {
    parts: [
      {
        id: 'p_base',
        name: 'Base',
        partTemplateId: 'tpl_base',
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
        fixed: true,
      },
      {
        id: 'p_arm',
        name: 'Arm',
        partTemplateId: 'tpl_arm',
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
      },
    ],
    mates: [],
  };
}

function seedFeatureTrees(): Record<string, FeatureTree> {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: SQUARE_10x10,
    depth: 5,
    direction: 'one_sided',
    mode: 'add',
  };
  return {
    p_base: { nodes: [{ id: 'e1', name: 'e1', dependencies: [], payload }] },
    p_arm: { nodes: [{ id: 'e2', name: 'e2', dependencies: [], payload }] },
  };
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('AssemblyBrowserModal — BOM export', () => {
  it('shows the Export BOM button in the footer', () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    const btn = screen.getByTestId('solver-assembly-export-bom');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/Export BOM/i);
  });

  it('clicking Export BOM toggles the CSV / JSON sub-menu', () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    expect(screen.queryByTestId('solver-assembly-export-bom-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    const menu = screen.getByTestId('solver-assembly-export-bom-menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-export-bom-csv')).toBeInTheDocument();
    expect(screen.getByTestId('solver-assembly-export-bom-json')).toBeInTheDocument();
    // toggle off
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    expect(screen.queryByTestId('solver-assembly-export-bom-menu')).toBeNull();
  });

  it('clicking CSV triggers a download with CSV content', async () => {
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        initialFeatureTrees={seedFeatureTrees()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom-csv'));
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(capturedBlobs).toHaveLength(1);
    const text = await blobToText(capturedBlobs[0]!);
    // CSV header + 2 part rows
    const lines = text.split('\r\n');
    expect(lines[0]).toContain('partId');
    expect(lines[0]).toContain('quantity');
    expect(text).toContain('p_base');
    expect(text).toContain('Base');
    expect(text).toContain('p_arm');
    expect(text).toContain('Arm');
    // 100 mm² × 5 mm = 500 mm³
    expect(text).toContain('500');
    // filename ends in .csv
    expect(lastDownloadFilename).toMatch(/\.csv$/);
  });

  it('clicking JSON triggers a download with JSON content', async () => {
    render(
      <AssemblyBrowserModal
        lang="en"
        initialState={seedState()}
        initialFeatureTrees={seedFeatureTrees()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom-json'));
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const text = await blobToText(capturedBlobs[0]!);
    const parsed = JSON.parse(text);
    expect(parsed.totalParts).toBe(2);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0].partId).toBe('p_base');
    expect(parsed.entries[0].volume).toBe(500);
    expect(parsed.entries[1].partId).toBe('p_arm');
    expect(lastDownloadFilename).toMatch(/\.json$/);
  });

  it('Export BOM works with zero parts (emits an empty entries CSV)', async () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom-csv'));
    expect(capturedBlobs).toHaveLength(1);
    const text = await blobToText(capturedBlobs[0]!);
    const lines = text.split('\r\n');
    // header only
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('partId');
  });

  it('closes the sub-menu after a successful download', async () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    expect(screen.getByTestId('solver-assembly-export-bom-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom-csv'));
    expect(screen.queryByTestId('solver-assembly-export-bom-menu')).toBeNull();
  });

  it('uses the projectId in the downloaded filename when supplied', () => {
    render(
      <AssemblyBrowserModal
        lang="en"
        projectId="gearbox-v3"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom-json'));
    expect(lastDownloadFilename).toBe('gearbox-v3-bom.json');
  });

  it('renders Export BOM button in all 6 supported languages', () => {
    const langs: AssemblyBrowserLang[] = ['en', 'ko', 'ja', 'zh', 'es', 'ar'];
    for (const lang of langs) {
      const { unmount } = render(
        <AssemblyBrowserModal lang={lang} onClose={vi.fn()} />,
      );
      const btn = screen.getByTestId('solver-assembly-export-bom');
      expect(btn).toBeInTheDocument();
      // text content non-empty for every locale
      expect(btn.textContent ?? '').not.toBe('');
      unmount();
    }
  });

  it('CSV blob uses text/csv MIME type and JSON uses application/json', () => {
    render(<AssemblyBrowserModal lang="en" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom-csv'));
    expect(capturedBlobs[0]!.type).toContain('text/csv');
    // re-open menu and try JSON
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom'));
    fireEvent.click(screen.getByTestId('solver-assembly-export-bom-json'));
    expect(capturedBlobs[1]!.type).toContain('application/json');
  });
});
