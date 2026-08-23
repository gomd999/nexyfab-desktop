// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';
import { saveSpatialDesignBriefHandoff } from '@/lib/ai/spatialDesignBriefHandoff';
import { saveSpatialCadDraftHandoff } from '@/lib/ai/spatialDesignBriefBuilder';
import { CivilCadWorkspaceTyped } from './CivilCadWorkspaceTyped';
import { dispatchSpatialCadCommand } from './spatialCadCommands';

vi.mock('../../../nexyfab/design/AssemblyViewer3D', () => ({
  default: ({ parts }: { parts: unknown[] }) => <div data-testid="mock-civil-viewer">parts:{parts.length}</div>,
}));

const renderCivil = () => render(<CivilCadWorkspaceTyped lang="en" onAiDesign={vi.fn()} />);

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' });
});

describe('CivilCadWorkspaceTyped', () => {
  it('restores legacy label-key v1 values without losing the typed document', async () => {
    saveSpatialDesignBriefHandoff(window.sessionStorage, {
      domain: 'civil', unit: 'm', verification: 'NOT_RUN', missingAuthority: ['survey'],
      parameters: { epsg: 5186, 'alignment length (m)': 150, 'drain inlet count': 3 },
    });
    renderCivil();
    await waitFor(() => expect(screen.getByLabelText('Alignment length (m)')).toHaveValue(150));
    expect(screen.getByLabelText('Drain inlet count')).toHaveValue(3);
  });

  it('commits manual edits, inlet commands, reset and undo as typed revisions', async () => {
    renderCivil();
    const length = screen.getByLabelText('Alignment length (m)');
    fireEvent.change(length, { target: { value: '150' } });
    fireEvent.blur(length);
    await waitFor(() => expect(length).toHaveValue(150));
    expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r1');

    act(() => { dispatchSpatialCadCommand('spatial.add.inlet'); });
    await waitFor(() => expect(screen.getByLabelText('Drain inlet count')).toHaveValue(2));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Reset concept' })); });
    await waitFor(() => expect(length).toHaveValue(120));
    act(() => { fireEvent.click(screen.getByTestId('spatial-undo')); });
    await waitFor(() => expect(length).toHaveValue(150));
    expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r4');
  });

  it('does not select request-only scope from focus without a committed edit', async () => {
    renderCivil();
    const length = screen.getByLabelText('Alignment length (m)');
    fireEvent.focus(length);
    act(() => { window.dispatchEvent(new Event('nexyfab:spatial-ai-handoff-request')); });
    await waitFor(() => {
      const handoff = JSON.parse(window.sessionStorage.getItem('nexyfab:spatial-design-brief-handoff:v2') ?? 'null') as { selectedParameterPath?: string | null } | null;
      expect(handoff?.selectedParameterPath ?? null).toBeNull();
    });
  });

  it('writes machine-key v2 handoff with the selected parameter scope', async () => {
    await saveSpatialCadDraftHandoff({
      domain: 'civil', unit: 'm', verification: 'NOT_RUN', missingAuthority: ['survey'],
      parameters: { epsg: 5186, lengthM: 120, corridorWidthM: 7 },
      baseDocumentRevision: 0, documentId: 'spatial:civil:test', selectedParameterPath: 'lengthM',
    });
    const handoff = JSON.parse(window.sessionStorage.getItem('nexyfab:spatial-design-brief-handoff:v2')!) as { parameterPaths: string[]; parameters: Record<string, unknown> };
    expect(handoff.parameterPaths).toEqual(['lengthM']);
    expect(handoff.parameters).toHaveProperty('lengthM', 120);
    expect(handoff.parameters).not.toHaveProperty('Alignment length (m)');
  });

  it('round-trips a revision-bound machine-key v2 handoff', async () => {
    await saveSpatialCadDraftHandoff({
      domain: 'civil', unit: 'm', verification: 'NOT_RUN', missingAuthority: ['survey'],
      parameters: { epsg: 5186, lengthM: 155, corridorWidthM: 8, surfaceWidthM: 24, startElevationM: 10, endElevationM: 11, crossSlopePercent: 2, drainDiameterMm: 450, drainInletCount: 2 },
      baseDocumentRevision: 4, documentId: 'spatial:civil:test', selectedParameterPath: 'lengthM',
    });
    renderCivil();
    await waitFor(() => expect(screen.getByLabelText('Alignment length (m)')).toHaveValue(155));
    expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r4');
  });
});
