/** @vitest-environment jsdom */
/**
 * StepImportModal — standalone modal tests (Phase 5.2 STEP import).
 *
 * The modal is wholly self-contained: file picker + paste-source toggle
 * + import button + result panel. Tests inject a mock fetcher to avoid
 * hitting /api/step-import.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import StepImportModal, {
  type StepImportResponse,
} from '@/app/[lang]/shape-generator/sketch/StepImportModal';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';

function rectTree(): FeatureTree {
  return {
    nodes: [
      {
        id: 'imported_0',
        name: 'Imported Solid 1',
        dependencies: [],
        payload: {
          kind: 'extrude',
          loop: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 0, y: 5 },
          ],
          depth: 3,
          direction: 'one_sided',
          mode: 'add',
        },
      },
    ],
  };
}

function triangleTree(): FeatureTree {
  return {
    nodes: [
      {
        id: 'imported_0',
        name: 'Imported Solid 1',
        dependencies: [],
        payload: {
          kind: 'extrude',
          loop: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 8 },
          ],
          depth: 3,
          direction: 'one_sided',
          mode: 'add',
        },
      },
    ],
  };
}

function pickFile(input: HTMLInputElement, content: string, name = 'part.step'): void {
  const blob = new Blob([content], { type: 'application/octet-stream' });
  // jsdom File constructor preserves .name and .size, which the modal reads.
  const file = new File([blob], name, { type: 'application/octet-stream' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('StepImportModal — render + basic interactions', () => {
  it('renders the file picker + submit + cancel buttons', () => {
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('step-import-modal')).toBeInTheDocument();
    expect(screen.getByTestId('step-import-file-input')).toBeInTheDocument();
    expect(screen.getByTestId('step-import-submit')).toBeInTheDocument();
    expect(screen.getByTestId('step-import-cancel')).toBeInTheDocument();
  });

  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={onClose}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click closes the modal', () => {
    const onClose = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={onClose}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('toggle button switches between file picker and paste textarea', () => {
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    // Starts in file-picker mode — no textarea yet.
    expect(screen.queryByTestId('step-import-source-textarea')).toBeNull();
    fireEvent.click(screen.getByTestId('step-import-toggle-paste'));
    expect(screen.getByTestId('step-import-source-textarea')).toBeInTheDocument();
    // File input is now hidden.
    expect(screen.queryByTestId('step-import-file-input')).toBeNull();
    // Toggle back.
    fireEvent.click(screen.getByTestId('step-import-toggle-paste'));
    expect(screen.getByTestId('step-import-file-input')).toBeInTheDocument();
    expect(screen.queryByTestId('step-import-source-textarea')).toBeNull();
  });
});

describe('StepImportModal — submit flow (file picker)', () => {
  beforeEach(() => {
    // No window.fetch needed — we always inject stepImportFetcher.
  });

  it('submit without picking a file shows BAD_REQUEST error (no fetch)', async () => {
    const fetcher = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('step-import-error');
      expect(err.textContent).toMatch(/Bad request/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('picking a file + submit fires the fetcher with FormData', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: rectTree(),
      warnings: [],
      unsupported: [],
    } satisfies StepImportResponse);
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(
      screen.getByTestId('step-import-file-input') as HTMLInputElement,
      'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n',
    );
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const body = fetcher.mock.calls[0]![0];
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('success response invokes onImport with tree+warnings+unsupported and shows summary', async () => {
    const tree = rectTree();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: ['heal:normalize_line_endings_lf'],
      unsupported: [],
    });
    const onImport = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={onImport}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'step source');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0]![0]).toBe(tree);
    expect(onImport.mock.calls[0]![1]).toEqual(['heal:normalize_line_endings_lf']);
    expect(onImport.mock.calls[0]![2]).toEqual([]);
    const summary = await screen.findByTestId('step-import-summary');
    expect(summary.textContent).toMatch(/Imported 1 solid/);
    expect(summary.textContent).toMatch(/1 box/);
  });

  it('polygon prism summary mentions vertex count', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: triangleTree(),
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const summary = await screen.findByTestId('step-import-summary');
    expect(summary.textContent).toMatch(/3-vertex polygon prism/);
  });

  it('error response (PARSE_ERROR) shows localised error copy', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      error: 'PARSE_ERROR',
      message: 'no_data_section: missing DATA; section',
    });
    const onImport = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={onImport}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'garbage');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('step-import-error');
      expect(err.textContent).toMatch(/Could not parse STEP file/);
    });
    expect(onImport).not.toHaveBeenCalled();
  });

  it('warnings list renders each warning entry', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: rectTree(),
      warnings: ['heal:add_missing_end_iso', 'parse:no_closed_shell'],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => expect(screen.getByTestId('step-import-warnings')).toBeInTheDocument());
    expect(screen.getByTestId('step-import-warning-0').textContent).toMatch(/end_iso/);
    expect(screen.getByTestId('step-import-warning-1').textContent).toMatch(/no_closed_shell/);
  });

  it('unsupported list renders each entry', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: { nodes: [] },
      warnings: [],
      unsupported: ['#25: CYLINDRICAL_SURFACE (Phase 2)'],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => expect(screen.getByTestId('step-import-unsupported')).toBeInTheDocument());
    expect(screen.getByTestId('step-import-unsupported-0').textContent).toMatch(/CYLINDRICAL/);
  });
});

describe('StepImportModal — size cap + paste mode + i18n', () => {
  it('5MB+ pasted source triggers client-side PAYLOAD_TOO_LARGE before fetcher', async () => {
    const fetcher = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    // Switch to paste mode.
    fireEvent.click(screen.getByTestId('step-import-toggle-paste'));
    const ta = screen.getByTestId('step-import-source-textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'A'.repeat(5 * 1024 * 1024 + 1) } });
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('step-import-error');
      expect(err.textContent).toMatch(/too large|5MB/i);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('paste mode submit fires fetcher with { source } JSON body', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: rectTree(),
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-toggle-paste'));
    const ta = screen.getByTestId('step-import-source-textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'ISO-10303-21; ...' } });
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const body = fetcher.mock.calls[0]![0];
    expect(body).not.toBeInstanceOf(FormData);
    expect((body as { source: string }).source).toMatch(/^ISO-10303-21/);
  });

  it('Korean lang shows 가져오기 (Import) and 취소 (Cancel)', () => {
    render(
      <StepImportModal
        lang="ko"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('step-import-submit').textContent).toMatch(/가져오기/);
    expect(screen.getByTestId('step-import-cancel').textContent).toMatch(/취소/);
  });

  it('Japanese lang error message uses localised PARSE_ERROR copy', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      error: 'PARSE_ERROR',
      message: 'malformed_entity',
    });
    render(
      <StepImportModal
        lang="ja"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'broken');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => {
      const err = screen.getByTestId('step-import-error');
      expect(err.textContent).toMatch(/解析できません/);
    });
  });

  it('Chinese lang summary mentions box', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: rectTree(),
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="zh"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const summary = await screen.findByTestId('step-import-summary');
    expect(summary.textContent).toMatch(/已导入 1 个实体/);
    expect(summary.textContent).toMatch(/长方体/);
  });
});

// ─── Phase 3 sweep + entry kind labels + Phase 3 wishlist ─────────────────
// VVVVVV (Phase 3) added BREP sweep recognition (SURFACE_OF_LINEAR_EXTRUSION
// + 2 PLANE caps, or direct SWEPT_AREA_SOLID / EXTRUDED_AREA_SOLID). The
// modal now needs to:
//   1. label each imported entry by kind (Box / Polygon prism / Cylinder /
//      Body of revolution / Linear prism),
//   2. count kinds in the summary ("Imported N: 2 boxes, 1 cylinder, 1 sweep"),
//   3. surface a Phase 3 wishlist of known-unsupported features under the
//      unsupported list so users understand which limitations are known.

/** Build a BREP cylinder node — VVVVVV emits these with the canonical
 *  rectangle [(0,0),(r,0),(r,h),(0,h)] in the rotate_extrude frame. */
function cylinderNode(id: string, r: number, h: number): FeatureNode {
  return {
    id,
    name: `Imported Revolved Solid (cyl)`,
    dependencies: [],
    payload: {
      kind: 'revolve',
      loop: [
        { x: 0, y: 0 },
        { x: r, y: 0 },
        { x: r, y: h },
        { x: 0, y: h },
      ],
      angleDegrees: 360,
      mode: 'add',
    },
  };
}

/** Build a non-rectangular revolve (i.e. an actual body of revolution, not
 *  the canonical cylinder rectangle). */
function bodyOfRevolutionNode(id: string): FeatureNode {
  return {
    id,
    name: `Imported Revolved Solid (vase)`,
    dependencies: [],
    payload: {
      kind: 'revolve',
      loop: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 8, y: 5 },
        { x: 3, y: 10 },
        { x: 0, y: 10 },
      ],
      angleDegrees: 360,
      mode: 'add',
    },
  };
}

/** Build a sweep (linear prism) node — VVVVVV's Phase 3 output for a
 *  SURFACE_OF_LINEAR_EXTRUSION BREP or a SWEPT_AREA_SOLID. */
function sweepNode(id: string): FeatureNode {
  return {
    id,
    name: `Imported Swept Solid`,
    dependencies: [],
    payload: {
      kind: 'sweep',
      profile: {
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
      },
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 10 },
      ],
      mode: 'add',
    },
  };
}

function rectNode(id: string): FeatureNode {
  return {
    id,
    name: `Imported Solid (box)`,
    dependencies: [],
    payload: {
      kind: 'extrude',
      loop: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 0, y: 5 },
      ],
      depth: 3,
      direction: 'one_sided',
      mode: 'add',
    },
  };
}

describe('StepImportModal — Phase 3 sweep + entry labels + wishlist', () => {
  it('sweep entry renders "Linear prism" label', async () => {
    const tree: FeatureTree = { nodes: [sweepNode('imported_sweep_0')] };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const entries = await screen.findByTestId('step-import-entries');
    expect(entries).toBeInTheDocument();
    const entry0 = screen.getByTestId('step-import-entry-0');
    expect(entry0.textContent).toMatch(/Linear prism/);
    expect(entry0.getAttribute('data-entry-kind')).toBe('sweep');
  });

  it('cylinder entry renders "Cylinder" label (canonical rectangle revolve)', async () => {
    const tree: FeatureTree = { nodes: [cylinderNode('imported_revolve_0', 4, 7)] };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const entry0 = await screen.findByTestId('step-import-entry-0');
    expect(entry0.textContent).toMatch(/Cylinder/);
    expect(entry0.getAttribute('data-entry-kind')).toBe('cylinder');
  });

  it('non-canonical revolve entry renders "Body of revolution" label', async () => {
    const tree: FeatureTree = { nodes: [bodyOfRevolutionNode('imported_revolve_0')] };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const entry0 = await screen.findByTestId('step-import-entry-0');
    expect(entry0.textContent).toMatch(/Body of revolution/);
    expect(entry0.getAttribute('data-entry-kind')).toBe('revolve');
  });

  it('summary count is accurate for mixed entries (2 boxes + 1 cylinder + 1 sweep)', async () => {
    const tree: FeatureTree = {
      nodes: [
        rectNode('imported_0'),
        rectNode('imported_1'),
        cylinderNode('imported_revolve_0', 3, 5),
        sweepNode('imported_sweep_0'),
      ],
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const summary = await screen.findByTestId('step-import-summary');
    expect(summary.textContent).toMatch(/Imported 4 solids/);
    // Pluralised box count.
    expect(summary.textContent).toMatch(/2 boxes/);
    // Singular cylinder.
    expect(summary.textContent).toMatch(/1 cylinder/);
    // Sweep count.
    expect(summary.textContent).toMatch(/1 sweep/);
  });

  it('mixed entries list renders one row per node with correct kinds', async () => {
    const tree: FeatureTree = {
      nodes: [
        rectNode('imported_0'),
        cylinderNode('imported_revolve_0', 2, 8),
        sweepNode('imported_sweep_0'),
      ],
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await screen.findByTestId('step-import-entries');
    expect(screen.getByTestId('step-import-entry-0').getAttribute('data-entry-kind')).toBe('box');
    expect(screen.getByTestId('step-import-entry-1').getAttribute('data-entry-kind')).toBe('cylinder');
    expect(screen.getByTestId('step-import-entry-2').getAttribute('data-entry-kind')).toBe('sweep');
  });

  it('entry tooltip surfaces kind detail (cylinder radius + height)', async () => {
    const tree: FeatureTree = { nodes: [cylinderNode('imported_revolve_0', 4, 7)] };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const entry0 = await screen.findByTestId('step-import-entry-0');
    const tooltip = entry0.getAttribute('title');
    expect(tooltip).toMatch(/radius/);
    expect(tooltip).toMatch(/4/);
    expect(tooltip).toMatch(/height/);
    expect(tooltip).toMatch(/7/);
  });

  it('entry tooltip for sweep mentions vertex count + length', async () => {
    const tree: FeatureTree = { nodes: [sweepNode('imported_sweep_0')] };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const entry0 = await screen.findByTestId('step-import-entry-0');
    const tooltip = entry0.getAttribute('title');
    expect(tooltip).toMatch(/4-vertex/);
    expect(tooltip).toMatch(/length 10/);
  });

  it('unsupported list shows Phase 3 wishlist hints below the unsupported entries', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: { nodes: [] },
      warnings: [],
      unsupported: ['#42: SWEPT_DISK_SOLID (pipe / hose primitive)'],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await screen.findByTestId('step-import-unsupported');
    const wishlist = screen.getByTestId('step-import-phase3-wishlist');
    expect(wishlist).toBeInTheDocument();
    // The wishlist must mention SWEPT_DISK_SOLID as a known Phase 3 limit.
    expect(wishlist.textContent).toMatch(/SWEPT_DISK_SOLID/);
    // Multiple specific wishlist items are surfaced.
    expect(screen.getByTestId('step-import-wishlist-0')).toBeInTheDocument();
    expect(screen.getByTestId('step-import-wishlist-1')).toBeInTheDocument();
  });

  it('wishlist is hidden when there are no unsupported entries', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree: { nodes: [sweepNode('imported_sweep_0')] },
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await screen.findByTestId('step-import-entries');
    expect(screen.queryByTestId('step-import-phase3-wishlist')).toBeNull();
  });

  it('Korean lang sweep label uses 선형 프리즘', async () => {
    const tree: FeatureTree = { nodes: [sweepNode('imported_sweep_0')] };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    render(
      <StepImportModal
        lang="ko"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={fetcher}
      />,
    );
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    const entry0 = await screen.findByTestId('step-import-entry-0');
    expect(entry0.textContent).toMatch(/선형 프리즘/);
    const summary = screen.getByTestId('step-import-summary');
    expect(summary.textContent).toMatch(/선형 프리즘/);
  });
});

// ─── B31.2 Image tab (SketchInferFromImagePanel integration) ──────────────
// The modal now exposes a tab strip at the top with two tabs: STEP (default,
// active for back-compat) and Image. The Image tab mounts the standalone
// SketchInferFromImagePanel; its onAccept(SolverViewState) is forwarded to
// the modal's onImageAccept prop verbatim. STEP tab path is untouched ‒
// zero regression for callers that never set onImageAccept.

describe('StepImportModal — B31.2 Image tab', () => {
  it('renders the tab strip with both STEP and Image tabs', () => {
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('step-import-tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('step-import-tab-step')).toBeInTheDocument();
    expect(screen.getByTestId('step-import-tab-image')).toBeInTheDocument();
  });

  it('STEP tab is active by default (back-compat)', () => {
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('step-import-tab-step').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('step-import-tab-image').getAttribute('data-active')).toBe('false');
    // STEP form elements visible on default tab.
    expect(screen.getByTestId('step-import-file-input')).toBeInTheDocument();
    expect(screen.getByTestId('step-import-submit')).toBeInTheDocument();
    // Image panel NOT mounted.
    expect(screen.queryByTestId('solver-sketch-infer-panel')).toBeNull();
  });

  it('clicking the Image tab mounts SketchInferFromImagePanel + unmounts the STEP form', () => {
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-tab-image'));
    // Image panel mounted.
    expect(screen.getByTestId('solver-sketch-infer-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sketch-infer-file-input')).toBeInTheDocument();
    // STEP form elements gone.
    expect(screen.queryByTestId('step-import-file-input')).toBeNull();
    expect(screen.queryByTestId('step-import-submit')).toBeNull();
    expect(screen.queryByTestId('step-import-toggle-paste')).toBeNull();
    // Active state flipped.
    expect(screen.getByTestId('step-import-tab-image').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('step-import-tab-step').getAttribute('data-active')).toBe('false');
  });

  it('switching back to STEP tab unmounts the image panel + restores STEP form', () => {
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-tab-image'));
    expect(screen.getByTestId('solver-sketch-infer-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('step-import-tab-step'));
    expect(screen.queryByTestId('solver-sketch-infer-panel')).toBeNull();
    expect(screen.getByTestId('step-import-file-input')).toBeInTheDocument();
    expect(screen.getByTestId('step-import-submit')).toBeInTheDocument();
  });

  it('image panel forwards onAccept → onImageAccept (SolverViewState contract)', async () => {
    const onImageAccept = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
        onImageAccept={onImageAccept}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-tab-image'));

    // Pick a tiny image so the panel's file-reader path lights up the
    // Infer button.
    const input = screen.getByTestId('solver-sketch-infer-file-input') as HTMLInputElement;
    const file = new File([new Uint8Array(64)], 'tiny.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    // Wait for FileReader to produce the data URL → image preview renders.
    await waitFor(() => {
      expect(screen.getByTestId('solver-sketch-infer-image-preview')).toBeInTheDocument();
    });

    // Click Infer → the Phase-1 fallback grid is returned synchronously by
    // the inferer (no detector → 4-corner deterministic mock).
    fireEvent.click(screen.getByTestId('solver-sketch-infer-infer-button'));
    await waitFor(() => {
      expect(screen.getByTestId('solver-sketch-infer-svg-preview')).toBeInTheDocument();
    });

    // Click Accept → onAccept forwards verbatim to our onImageAccept.
    fireEvent.click(screen.getByTestId('solver-sketch-infer-accept-button'));
    expect(onImageAccept).toHaveBeenCalledTimes(1);
    const arg = onImageAccept.mock.calls[0]![0];
    // Contract: SolverViewState shape — { points: [...], lines: [...] }.
    expect(arg).toHaveProperty('points');
    expect(arg).toHaveProperty('lines');
    expect(Array.isArray(arg.points)).toBe(true);
    expect(Array.isArray(arg.lines)).toBe(true);
  });

  it('STEP tab path is not regressed — STEP submit + onImport still fires', async () => {
    const tree = rectTree();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      tree,
      warnings: [],
      unsupported: [],
    });
    const onImport = vi.fn();
    const onImageAccept = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={onImport}
        stepImportFetcher={fetcher}
        onImageAccept={onImageAccept}
      />,
    );
    // Confirm default tab is STEP (no tab click).
    pickFile(screen.getByTestId('step-import-file-input') as HTMLInputElement, 'src');
    fireEvent.click(screen.getByTestId('step-import-submit'));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    // onImageAccept must NOT fire from the STEP-tab path.
    expect(onImageAccept).not.toHaveBeenCalled();
  });

  it('tab strip is i18n-aware — Korean labels render', () => {
    render(
      <StepImportModal
        lang="ko"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    expect(screen.getByTestId('step-import-tab-step').textContent).toMatch(/STEP/);
    expect(screen.getByTestId('step-import-tab-image').textContent).toMatch(/이미지/);
  });

  it('tab strip is i18n-aware — Japanese/Chinese/Spanish/Arabic labels', () => {
    const cases: Array<{ lang: 'ja' | 'zh' | 'es' | 'ar'; image: RegExp }> = [
      { lang: 'ja', image: /画像/ },
      { lang: 'zh', image: /图像/ },
      { lang: 'es', image: /Imagen/ },
      { lang: 'ar', image: /صورة/ },
    ];
    for (const c of cases) {
      const { unmount } = render(
        <StepImportModal
          lang={c.lang}
          onClose={vi.fn()}
          onImport={vi.fn()}
          stepImportFetcher={vi.fn()}
        />,
      );
      expect(screen.getByTestId('step-import-tab-image').textContent).toMatch(c.image);
      unmount();
    }
  });

  it('Image tab keeps the Cancel button visible (modal close still works)', () => {
    const onClose = vi.fn();
    render(
      <StepImportModal
        lang="en"
        onClose={onClose}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-tab-image'));
    expect(screen.getByTestId('step-import-cancel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('step-import-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Image tab without onImageAccept prop renders panel but disables Accept', async () => {
    render(
      <StepImportModal
        lang="en"
        onClose={vi.fn()}
        onImport={vi.fn()}
        stepImportFetcher={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('step-import-tab-image'));
    const input = screen.getByTestId('solver-sketch-infer-file-input') as HTMLInputElement;
    const file = new File([new Uint8Array(32)], 'tiny.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(screen.getByTestId('solver-sketch-infer-image-preview')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('solver-sketch-infer-infer-button'));
    await waitFor(() => {
      expect(screen.getByTestId('solver-sketch-infer-svg-preview')).toBeInTheDocument();
    });
    // Accept button is rendered but disabled because no onImageAccept was supplied.
    const acceptBtn = screen.getByTestId('solver-sketch-infer-accept-button') as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(true);
  });
});
