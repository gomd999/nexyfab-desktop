// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpatialAiCandidate } from '@/lib/ai/spatialAiCandidate';
import { createSpatialCadDocument } from '@/lib/cad/spatialCadCommand';
import { SpatialAiCandidateBridge } from './SpatialAiCandidateBridge';
import { resetManualEditProtectionSession } from '../../ai/manualEditProtectionStore';

const handoff = {
  schema: 'nexyfab.spatial-design-brief-handoff.v2' as const, createdAt: Date.now(), domain: 'building' as const, unit: 'mm' as const,
  parameters: { width: 1000 }, missingAuthority: [], verification: 'NOT_RUN' as const, baseDocumentRevision: 0,
  contentHash: 'a'.repeat(64), documentId: 'building-doc', parameterPaths: ['width'], locks: [], mode: 'request_only_edit' as const,
};

describe('SpatialAiCandidateBridge', () => {
  beforeEach(() => resetManualEditProtectionSession());
  it('shows an exact diff and commits once after live guards pass', () => {
    const candidate = createSpatialAiCandidate({ handoff, operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'bridge-1', summary: 'resize' });
    const onCommit = vi.fn(() => true);
    render(<SpatialAiCandidateBridge candidate={candidate} currentDocument={createSpatialCadDocument('building', { width: 1000 })} currentDocumentId="building-doc" currentContentHash={'a'.repeat(64)} currentLocks={[]} onCommit={onCommit} onDiscard={vi.fn()} lang="en" />);
    expect(screen.getByTestId('spatial-ai-candidate-bridge')).toHaveTextContent('1000');
    fireEvent.click(screen.getByTestId('spatial-ai-candidate-apply'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0] as unknown as [{ width?: number }] | undefined;
    expect(committed?.[0]?.width).toBe(1200);
  });

  it('keeps state unchanged when the current hash is stale', () => {
    const candidate = createSpatialAiCandidate({ handoff, operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'bridge-2', summary: 'resize' });
    const onCommit = vi.fn(() => true);
    render(<SpatialAiCandidateBridge candidate={candidate} currentDocument={createSpatialCadDocument('building', { width: 1000 })} currentDocumentId="building-doc" currentContentHash={'b'.repeat(64)} currentLocks={[]} onCommit={onCommit} onDiscard={vi.fn()} lang="en" />);
    fireEvent.click(screen.getByTestId('spatial-ai-candidate-apply'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText('stale_spatial_document_hash')).toBeInTheDocument();
  });

  it('rechecks the exact current document locks before apply', () => {
    const candidate = createSpatialAiCandidate({ handoff, operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'bridge-lock', summary: 'resize' });
    const onCommit = vi.fn(() => true);
    render(<SpatialAiCandidateBridge candidate={candidate} currentDocument={createSpatialCadDocument('building', { width: 1000 })} currentDocumentId="building-doc" currentContentHash={'a'.repeat(64)} currentLocks={[{ id: 'lock-width', target: { kind: 'parameter', objectId: 'building-doc', field: 'width' } }]} onCommit={onCommit} onDiscard={vi.fn()} lang="en" />);
    fireEvent.click(screen.getByTestId('spatial-ai-candidate-apply'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/protected_user_or_authority_value/)).toBeInTheDocument();
  });

  it('keeps the reviewed candidate when authoritative server commit rejects', async () => {
    const candidate = createSpatialAiCandidate({ handoff, operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'bridge-server-reject', summary: 'resize' });
    const onAuthoritativeCommit = vi.fn(async () => false);
    render(<SpatialAiCandidateBridge candidate={candidate} currentDocument={createSpatialCadDocument('building', { width: 1000 })} currentDocumentId="building-doc" currentContentHash={'a'.repeat(64)} currentLocks={[]} onCommit={vi.fn(() => true)} onAuthoritativeCommit={onAuthoritativeCommit} onDiscard={vi.fn()} lang="en" />);
    fireEvent.click(screen.getByTestId('spatial-ai-candidate-apply'));
    await waitFor(() => expect(screen.getByText('spatial_transaction_commit_failed')).toBeInTheDocument());
    expect(screen.getByTestId('spatial-ai-candidate-bridge')).toBeInTheDocument();
  });

  it('discards only after authoritative success', async () => {
    const candidate = createSpatialAiCandidate({ handoff, operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'bridge-server-success', summary: 'resize' });
    const onDiscard = vi.fn();
    render(<SpatialAiCandidateBridge candidate={candidate} currentDocument={createSpatialCadDocument('building', { width: 1000 })} currentDocumentId="building-doc" currentContentHash={'a'.repeat(64)} currentLocks={[]} onCommit={vi.fn(() => true)} onAuthoritativeCommit={vi.fn(async () => true)} onDiscard={onDiscard} lang="en" />);
    fireEvent.click(screen.getByTestId('spatial-ai-candidate-apply'));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1));
  });

  it('retains the candidate and releases busy state when authoritative commit throws', async () => {
    const candidate = createSpatialAiCandidate({ handoff, operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'bridge-server-error', summary: 'resize' });
    const onDiscard = vi.fn();
    render(<SpatialAiCandidateBridge candidate={candidate} currentDocument={createSpatialCadDocument('building', { width: 1000 })} currentDocumentId="building-doc" currentContentHash={'a'.repeat(64)} currentLocks={[]} onCommit={vi.fn(() => true)} onAuthoritativeCommit={vi.fn(async () => { throw new Error('offline'); })} onDiscard={onDiscard} lang="en" />);
    fireEvent.click(screen.getByTestId('spatial-ai-candidate-apply'));
    await waitFor(() => expect(screen.getByText('offline')).toBeInTheDocument());
    expect(screen.getByTestId('spatial-ai-candidate-apply')).toBeEnabled();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
