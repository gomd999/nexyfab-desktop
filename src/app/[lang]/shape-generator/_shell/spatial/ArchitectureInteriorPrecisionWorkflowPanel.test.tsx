// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, ArchitectureInteriorPrecisionWorkflowPanel } from './ArchitectureInteriorPrecisionWorkflowPanel';

const workspace = { projectId: 'project-1', workspace: { revision: 0, contentHash: 'c'.repeat(64), track: 'ai_design', maturity: 'concept' } };
const agentResponse = { ok: true, session: { revision: 0, contentHash: 'c'.repeat(64), role: 'editor' }, workspace };

afterEach(() => vi.restoreAllMocks());

describe('ArchitectureInteriorPrecisionWorkflowPanel', () => {
  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'])('renders localized RTL-aware workflow for %s', lang => {
    render(<ArchitectureInteriorPrecisionWorkflowPanel lang={lang} projectId={null} />);
    expect(screen.getByTestId('architecture-interior-precision-workflow-panel')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('loads server workspace truth and performs exact approval as two explicit requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(agentResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, exact: { status: 'not_run' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'APPROVAL_REQUIRED', approval: { token: 'x'.repeat(43) } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, revision: 1, contentHash: 'd'.repeat(64), exact: { status: 'passed' }, compliance: { status: 'not_run' }, release: { status: 'not_run' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(agentResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, exact: { status: 'passed' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorPrecisionWorkflowPanel lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-precision-workspace')).toHaveTextContent('Revision: 0'));
    expect(screen.getByTestId('architecture-interior-precision-workflow-panel')).toHaveTextContent('AI design');
    fireEvent.click(screen.getByTestId('architecture-interior-precision-exact'));
    await waitFor(() => expect(screen.getByTestId('architecture-interior-precision-status')).toHaveTextContent('Exact geometry: Passed'));
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toMatchObject({ approved: true, approvalToken: 'x'.repeat(43), expectedWorkspaceRevision: 0 });
  });

  it('generates selected artifacts only after the server challenge and keeps downstream gates NOT_RUN', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(agentResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, exact: { status: 'not_run' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'APPROVAL_REQUIRED', approval: { token: 'y'.repeat(43) } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bundle: { bundleHash: 'e'.repeat(64) }, exact: { status: 'not_run' }, pricing: { status: 'not_run' }, ifcRoundtrip: { status: 'not_run' }, release: { status: 'not_run' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorPrecisionWorkflowPanel lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-precision-artifacts')).toBeEnabled());
    fireEvent.click(screen.getByTestId('architecture-interior-precision-kind-ifc')); fireEvent.click(screen.getByTestId('architecture-interior-precision-artifacts'));
    await waitFor(() => expect(screen.getByTestId('architecture-interior-precision-status')).toHaveTextContent('IFC roundtrip: Not run'));
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toMatchObject({ approved: true, requestedKinds: ['quantity', 'drawing'], approvalToken: 'y'.repeat(43) });
  });

  it('disables exact promotion when the server reports an already-exact workspace and reloads after a workspace event', async () => {
    const exactWorkspace = { ...workspace, workspace: { ...workspace.workspace, track: 'precision_cad', maturity: 'exact' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...agentResponse, workspace: exactWorkspace, session: { ...agentResponse.session, revision: 2, contentHash: 'f'.repeat(64) } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, exact: { status: 'passed' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...agentResponse, workspace: exactWorkspace, session: { ...agentResponse.session, revision: 3, contentHash: 'g'.repeat(64) } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, exact: { status: 'passed' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorPrecisionWorkflowPanel lang="en" projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId('architecture-interior-precision-exact')).toBeDisabled());
    expect(screen.getByTestId('architecture-interior-precision-status')).toHaveTextContent('Exact geometry: Passed');
    act(() => { window.dispatchEvent(new CustomEvent(ARCHITECTURE_INTERIOR_WORKSPACE_CHANGED_EVENT, { detail: { projectId: 'project-1' } })); });
    await waitFor(() => expect(screen.getByTestId('architecture-interior-precision-workspace')).toHaveTextContent('Revision: 3'));
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
