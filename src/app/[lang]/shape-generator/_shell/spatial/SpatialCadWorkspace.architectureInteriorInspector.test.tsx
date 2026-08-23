// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureDocument, InteriorDocument } from '@/lib/ai/architectureInteriorDocuments';
import { createArchitectureInteriorSelection, type ArchitectureInteriorSelectionSource } from '@/lib/ai/architectureInteriorSelection';
import { SpatialCadWorkspace } from './SpatialCadWorkspace';

vi.mock('../../../nexyfab/design/InteriorPlanEditor', () => ({ default: () => <div data-testid="mock-interior-plan" /> }));
vi.mock('../../../nexyfab/design/AssemblyViewer3D', () => ({ default: () => <div data-testid="mock-spatial-viewer" /> }));

function source(): ArchitectureInteriorSelectionSource {
  const architecture: ArchitectureDocument = {
    schema: 'nexyfab.architecture.v1', revision: 1,
    storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
    spaces: [{ id: 'space-1', storeyId: 'storey-1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: [], slabId: 'slab-1', ceilingId: 'ceiling-1' }],
    walls: [], slabs: [], ceilings: [], openings: [],
  };
  const interior: InteriorDocument = {
    schema: 'nexyfab.interior.v1', revision: 1, architectureDocumentId: 'architecture-1', lights: [],
    furniture: [{ id: 'furniture-1', spaceId: 'space-1', positionMm: [1000, 1200, 0], sizeMm: [1200, 600, 750], clearanceMm: 100, rotationDeg: 0 }], finishes: [],
  };
  return { projectId: 'project-1', architectureDocumentId: 'architecture-1', interiorDocumentId: 'interior-1', architecture, interior };
}

describe('SpatialCadWorkspace architecture/interior Inspector integration', () => {
  it('renders the governed Inspector only when a structured selection source is supplied', async () => {
    const current = source();
    const created = createArchitectureInteriorSelection(current, 'furniture', 'furniture-1', 'interior');
    if (!created.ok) throw new Error(created.code);
    const { container } = render(<SpatialCadWorkspace domain="interior" lang="en" experience="standard" onAiDesign={vi.fn()} architectureInteriorInspector={{ selection: created.value.selection, source: current }} />);
    expect(await screen.findByTestId('mock-interior-plan')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="architecture-interior-inspector"]')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-interior-inspector-readonly')).toBeInTheDocument();
  });
});
