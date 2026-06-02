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
import type { FeatureTree } from '@/lib/cad/featureTree';

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
