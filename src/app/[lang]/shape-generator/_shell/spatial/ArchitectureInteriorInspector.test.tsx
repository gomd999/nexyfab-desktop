// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureDocument, InteriorDocument } from '@/lib/ai/architectureInteriorDocuments';
import { createArchitectureInteriorSelection, type ArchitectureInteriorSelectionSource } from '@/lib/ai/architectureInteriorSelection';
import { ArchitectureInteriorInspector } from './ArchitectureInteriorInspector';

function source(): ArchitectureInteriorSelectionSource {
  const architecture: ArchitectureDocument = {
    schema: 'nexyfab.architecture.v1',
    revision: 3,
    storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
    spaces: [{ id: 'space-1', storeyId: 'storey-1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: [], slabId: 'slab-1', ceilingId: 'ceiling-1' }],
    walls: [], slabs: [], ceilings: [], openings: [],
  };
  const interior: InteriorDocument = {
    schema: 'nexyfab.interior.v1', revision: 3, architectureDocumentId: 'architecture-1',
    lights: [], furniture: [{ id: 'furniture-1', spaceId: 'space-1', positionMm: [1000, 1200, 0], sizeMm: [1200, 600, 750], clearanceMm: 100, rotationDeg: 0 }], finishes: [],
  };
  return { projectId: 'project-1', architectureDocumentId: 'architecture-1', interiorDocumentId: 'interior-1', architecture, interior };
}

function selectionFor(current = source()) {
  const created = createArchitectureInteriorSelection(current, 'furniture', 'furniture-1', 'interior');
  if (!created.ok) throw new Error(created.code);
  return created.value.selection;
}

describe('ArchitectureInteriorInspector', () => {
  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'])('renders a truthful empty/source state in %s', lang => {
    render(<ArchitectureInteriorInspector selection={null} source={null} lang={lang} />);
    expect(screen.getByTestId('architecture-interior-inspector-empty')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-interior-inspector')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  });

  it('shows only resolved furniture fields, keeps identity/hosts readonly, and commits through the supplied transaction', async () => {
    const current = source();
    const onCommit = vi.fn().mockResolvedValue(true);
    render(<ArchitectureInteriorInspector selection={selectionFor(current)} source={current} lang="en" onCommit={onCommit} />);
    expect(screen.getByTestId('architecture-interior-selection-id')).toHaveTextContent('furniture-1');
    expect(screen.getByTestId('architecture-interior-selection-hosts')).toHaveTextContent('space-1');
    expect(screen.getByTestId('architecture-interior-field-positionMm')).toBeInTheDocument();
    expect(screen.queryByLabelText('spaceId')).toBeNull();
    const positionX = screen.getByLabelText('positionMm 1');
    fireEvent.change(positionX, { target: { value: '2200' } });
    fireEvent.blur(positionX);
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(onCommit.mock.calls[0]?.[1]).toEqual({ positionMm: [2200, 1200, 0] });
    expect(screen.getByTestId('architecture-interior-inspector-saved')).toBeInTheDocument();
  });

  it('is read-only without a reviewed transaction and clears stale selection fail-closed', async () => {
    const current = source();
    const view = render(<ArchitectureInteriorInspector selection={selectionFor(current)} source={current} lang="en" />);
    expect(screen.getByTestId('architecture-interior-inspector-readonly')).toBeInTheDocument();
    expect(screen.getByLabelText('positionMm 1')).toBeDisabled();

    const stale = source();
    stale.architecture.revision = 4;
    stale.interior.revision = 4;
    const onInvalidSelection = vi.fn();
    view.rerender(<ArchitectureInteriorInspector selection={selectionFor(current)} source={stale} lang="ar" onInvalidSelection={onInvalidSelection} />);
    expect(screen.getByTestId('architecture-interior-inspector-invalid')).toBeInTheDocument();
    await waitFor(() => expect(onInvalidSelection).toHaveBeenCalledOnce());
    expect(screen.getByTestId('architecture-interior-inspector')).toHaveAttribute('dir', 'rtl');
  });

  it('rejects incomplete numeric drafts and blocks duplicate commits while saving', async () => {
    const current = source();
    let finish: ((value: boolean) => void) | undefined;
    const onCommit = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<ArchitectureInteriorInspector selection={selectionFor(current)} source={current} lang="en" onCommit={onCommit} />);
    const clearance = screen.getByLabelText('clearanceMm');
    fireEvent.change(clearance, { target: { value: '' } });
    fireEvent.blur(clearance);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('architecture-interior-inspector-failed')).toBeInTheDocument();

    fireEvent.change(clearance, { target: { value: '150' } });
    fireEvent.blur(clearance);
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(clearance).toBeDisabled();
    fireEvent.blur(clearance);
    expect(onCommit).toHaveBeenCalledOnce();
    finish?.(true);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-inspector-saved')).toBeInTheDocument());
  });
});
