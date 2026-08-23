// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoordinationCadWorkspace } from './CoordinationCadWorkspace';
import { useAuthStore } from '@/hooks/useAuth';

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' });
});
afterEach(() => vi.restoreAllMocks());

describe('CoordinationCadWorkspace', () => {
  it('exposes keyboard-operable browser and inspector resize handles', () => {
    render(<CoordinationCadWorkspace lang="en" />);
    const left = screen.getByTestId('spatial-left-panel-resizer');
    const right = screen.getByTestId('spatial-right-panel-resizer');
    expect(left).toHaveAttribute('role', 'separator');
    expect(right).toHaveAttribute('role', 'separator');
    expect(left).toHaveAttribute('aria-valuenow', '230');
    expect(right).toHaveAttribute('aria-valuenow', '310');
    fireEvent.keyDown(left, { key: 'ArrowRight' });
    fireEvent.keyDown(right, { key: 'ArrowLeft' });
    expect(left).toHaveAttribute('aria-valuenow', '240');
    expect(right).toHaveAttribute('aria-valuenow', '320');
  });

  it('blocks without coordinates and never fabricates exact clash evidence', () => {
    render(<CoordinationCadWorkspace lang="en" />);
    fireEvent.click(screen.getByTestId('coordination-run-check'));
    expect(screen.getByTestId('coordination-results')).toHaveTextContent('Verification state: BLOCKED');
    expect(screen.getByTestId('coordination-results')).toHaveTextContent('Exact B-Rep clash: NOT_RUN');
    expect(screen.getByTestId('coordination-results')).toHaveTextContent('coordinate_system_not_connected');
  });

  it('blocks exact clash job preparation until every model has hash-bound B-Rep evidence', () => {
    render(<CoordinationCadWorkspace lang="en" />);
    fireEvent.click(screen.getByTestId('coordination-exact-job'));
    expect(screen.getByTestId('coordination-exact-job-status')).toHaveTextContent('JOB BLOCKED · EXECUTION NOT_RUN · RELEASE NOT_RUN');
    expect(screen.getByTestId('coordination-exact-job-status')).toHaveTextContent('exact_brep_required:architecture');
    expect(screen.getByTestId('coordination-exact-job-status')).toHaveTextContent('coordinate_system_not_connected');
  });

  it('records CRS as a typed revision and returns only PREVIEW candidates', async () => {
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { document: { revision: number } };
      return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: body.document.revision + 1 } } }), { status: 200 });
    });
    render(<CoordinationCadWorkspace lang="en" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'EPSG code' }), { target: { value: '5186' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'EPSG code' }));
    await waitFor(() => expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r1'));
    fireEvent.click(screen.getByTestId('coordination-run-check'));
    expect(screen.getByTestId('coordination-results')).toHaveTextContent('Verification state: PREVIEW');
    expect(screen.getByTestId('coordination-results')).toHaveTextContent('Exact B-Rep clash: NOT_RUN');
  });

  it('keeps numeric edits as drafts until blur commits one revision', async () => {
    render(<CoordinationCadWorkspace lang="en" />);
    const tolerance = screen.getByRole('spinbutton', { name: 'Clash tolerance (mm)' });

    fireEvent.change(tolerance, { target: { value: '75' } });
    expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r0');

    fireEvent.blur(tolerance);
    await waitFor(() => expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Local semantic model r1'));
    expect(screen.getByTestId('coordination-results')).toHaveTextContent('Verification state: NOT_RUN');
  });

  it('creates only preview-labelled local issues and marks them stale after a model edit', async () => {
    render(<CoordinationCadWorkspace lang="en" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'EPSG code' }), { target: { value: '5186' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'EPSG code' }));
    fireEvent.click(screen.getByTestId('coordination-run-check'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Create PREVIEW issue' })[0]!);

    expect(screen.getByTestId('coordination-issue-ISS-001')).toHaveTextContent('OPEN · BOUNDS_PREVIEW · r1 · AUTH_REQUIRED');
    fireEvent.click(screen.getByRole('button', { name: /ISS-001/ }));
    expect(screen.getByTestId('coordination-issue-ISS-001')).toHaveTextContent('RESOLVED');

    const tolerance = screen.getByRole('spinbutton', { name: 'Clash tolerance (mm)' });
    fireEvent.change(tolerance, { target: { value: '80' } });
    fireEvent.blur(tolerance);
    await waitFor(() => expect(screen.getByTestId('coordination-issue-ISS-001')).toHaveTextContent('STALE r1'));
  });

  it('persists a preview issue through an authenticated project without promoting exact evidence', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!init?.method && url.includes('/spatial-cad/issues')) return new Response(JSON.stringify({ ok: true, issues: [] }), { status: 200 });
      if (!init?.method && url.includes('/spatial-cad?domain=coordination')) return new Response(JSON.stringify({ error: 'Draft not found' }), { status: 404 });
      if (url === '/api/cad/v1/spatial/command/') {
        const body = JSON.parse(String(init?.body)) as { document: { revision: number } };
        return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: body.document.revision + 1 } } }), { status: 200 });
      }
      if (url.endsWith('/spatial-cad') && init?.method === 'POST') return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 0 } }), { status: 201 });
      return new Response(JSON.stringify({ ok: true, issue: { id: 'SCI-1', status: 'OPEN', updatedAt: 10 } }), { status: 201 });
    });
    render(<CoordinationCadWorkspace lang="en" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'EPSG code' }), { target: { value: '5186' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'EPSG code' }));
    await waitFor(() => expect(screen.getByTestId('spatial-transaction-status')).toHaveTextContent('Project draft saved'));
    fireEvent.click(screen.getByTestId('coordination-run-check'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Create PREVIEW issue' })[0]!);
    await waitFor(() => expect(screen.getByTestId('coordination-issue-SCI-1')).toHaveTextContent('OPEN · BOUNDS_PREVIEW · r1 · SAVED'));
    expect(screen.getByTestId('coordination-results')).toHaveTextContent('Exact B-Rep clash: NOT_RUN');
  });

  it('binds a server-listed project CAD revision without treating the remaining concept models as exact', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    const revision = { artifactId: 'artifact-building-1', revision: 4, domain: 'building', lineageId: 'lineage-1', geometryContentHash: 'a'.repeat(64), shapeIdentityHash: 'b'.repeat(64), kernelId: 'occt-7.9' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!init?.method && url.includes('/cad-revisions?list=1')) return new Response(JSON.stringify({ ok: true, revisions: [revision] }), { status: 200 });
      if (!init?.method && url.includes('/spatial-cad/issues')) return new Response(JSON.stringify({ ok: true, issues: [] }), { status: 200 });
      if (!init?.method && url.includes('/spatial-cad?domain=coordination')) return new Response(JSON.stringify({ error: 'Draft not found' }), { status: 404 });
      if (url === '/api/cad/v1/spatial/command/') {
        const body = JSON.parse(String(init?.body)) as { document: { revision: number } };
        return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: body.document.revision + 1 } } }), { status: 200 });
      }
      if (url.endsWith('/spatial-cad') && init?.method === 'POST') return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 0 } }), { status: 201 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    render(<CoordinationCadWorkspace lang="en" />);
    const selector = await screen.findByRole('combobox', { name: 'architecture exact project revision' });
    fireEvent.change(selector, { target: { value: revision.artifactId } });
    await waitFor(() => expect(selector).toHaveValue(revision.artifactId));
    fireEvent.click(screen.getByTestId('coordination-exact-job'));
    expect(screen.getByTestId('coordination-exact-job-status')).not.toHaveTextContent('exact_brep_required:architecture');
    expect(screen.getByTestId('coordination-exact-job-status')).toHaveTextContent('exact_brep_required:mep');
  });

  it('sends a stable idempotency key and accepts a reused queued job response', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    let exactHeaders: Record<string, string> | undefined;
    const revision = { artifactId: 'artifact-building-1', revision: 4, domain: 'building', lineageId: 'lineage-1', geometryContentHash: 'a'.repeat(64), shapeIdentityHash: 'b'.repeat(64), kernelId: 'occt-7.9' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/spatial-cad/jobs') && init?.method === 'POST') {
        exactHeaders = init.headers as Record<string, string>;
        return new Response(JSON.stringify({ ok: true, reused: true, job: { id: 'SCJ-1', status: 'QUEUED', execution: 'NOT_RUN' } }), { status: 200 });
      }
      if (!init?.method && url.endsWith('/spatial-cad/jobs')) return new Response(JSON.stringify({ ok: true, jobs: [] }), { status: 200 });
      if (!init?.method && url.includes('/cad-revisions?list=1')) return new Response(JSON.stringify({ ok: true, revisions: [revision] }), { status: 200 });
      if (!init?.method && url.includes('/spatial-cad/issues')) return new Response(JSON.stringify({ ok: true, issues: [] }), { status: 200 });
      if (!init?.method && url.includes('/spatial-cad?domain=coordination')) return new Response(JSON.stringify({ error: 'Draft not found' }), { status: 404 });
      if (url === '/api/cad/v1/spatial/command/') {
        const body = JSON.parse(String(init?.body)) as { document: { revision: number } };
        return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: body.document.revision + 1 } } }), { status: 200 });
      }
      if (url.endsWith('/spatial-cad') && init?.method === 'POST') return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 0 } }), { status: 201 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    render(<CoordinationCadWorkspace lang="en" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'EPSG code' }), { target: { value: '5186' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'EPSG code' }));
    const selectors = await screen.findAllByRole('combobox');
    for (const selector of selectors) fireEvent.change(selector, { target: { value: revision.artifactId } });
    await waitFor(() => expect(selectors[2]).toHaveValue(revision.artifactId));
    fireEvent.click(screen.getByTestId('coordination-exact-job'));
    await waitFor(() => expect(screen.getByTestId('coordination-exact-job-status')).toHaveTextContent('JOB QUEUED'));
    expect(exactHeaders?.['Idempotency-Key']).toMatch(/^exact-clash-[a-f0-9]{64}$/);
  });

  it('shows authoritative active usage and transitions a queued job to CANCELLED', async () => {
    window.history.replaceState({}, '', '/?project=project-1');
    useAuthStore.setState({ token: 'test.token', sessionStatus: 'authenticated' });
    const revisions = [1, 2, 3].map(index => ({ artifactId: `artifact-${index}`, revision: index, domain: 'building', lineageId: `lineage-${index}`, geometryContentHash: String(index).repeat(64), shapeIdentityHash: String(index + 3).repeat(64), kernelId: 'occt-7.9' }));
    let cancelBody: unknown;
    let cancelAttempts = 0;
    let queued = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/spatial-cad/jobs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === 'cancel') {
          cancelAttempts += 1;
          cancelBody = body;
          if (cancelAttempts === 1) return new Response(JSON.stringify({ ok: false, code: 'CANCEL_CONFLICT', issues: ['spatial_cad_cancel_compare_and_swap_failed'], usage: { active: 2, limit: 2 } }), { status: 409 });
          queued = false;
          return new Response(JSON.stringify({ ok: true, job: { id: 'SCJ-1', status: 'CANCELLED', execution: 'NOT_RUN' }, usage: { active: 1, limit: 2 } }), { status: 200 });
        }
        queued = true;
        return new Response(JSON.stringify({ ok: true, job: { id: 'SCJ-1', status: 'QUEUED', execution: 'NOT_RUN' }, usage: { active: 2, limit: 2 } }), { status: 202 });
      }
      if (!init?.method && url.endsWith('/spatial-cad/jobs')) return new Response(JSON.stringify({ ok: true, canEdit: true, jobs: queued ? [{ id: 'SCJ-1', status: 'QUEUED', execution: 'NOT_RUN' }] : [], usage: { active: queued ? 2 : 1, limit: 2 } }), { status: 200 });
      if (!init?.method && url.includes('/cad-revisions?list=1')) return new Response(JSON.stringify({ ok: true, revisions }), { status: 200 });
      if (!init?.method && url.includes('/spatial-cad/issues')) return new Response(JSON.stringify({ ok: true, issues: [] }), { status: 200 });
      if (!init?.method && url.includes('/spatial-cad?domain=coordination')) return new Response(JSON.stringify({ error: 'Draft not found' }), { status: 404 });
      if (url === '/api/cad/v1/spatial/command/') return new Response(JSON.stringify({ ok: true, transaction: { document: { revision: 1 } } }), { status: 200 });
      if (url.endsWith('/spatial-cad') && init?.method === 'POST') return new Response(JSON.stringify({ ok: true, draft: { projectRevision: 0 } }), { status: 201 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    render(<CoordinationCadWorkspace lang="en" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'EPSG code' }), { target: { value: '5186' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'EPSG code' }));
    const selectors = await screen.findAllByRole('combobox');
    for (const [index, selector] of selectors.entries()) fireEvent.change(selector, { target: { value: revisions[index]!.artifactId } });
    await waitFor(() => expect(selectors[2]).toHaveValue(revisions[2]!.artifactId));
    fireEvent.click(screen.getByTestId('coordination-exact-job'));
    await waitFor(() => expect(screen.getByTestId('coordination-exact-job-status')).toHaveTextContent('JOB QUEUED'));
    expect(screen.getByTestId('coordination-exact-job-usage')).toHaveTextContent('Exact clash project active jobs (concurrency cap, not billing quota): 2 / 2');
    fireEvent.click(screen.getByTestId('coordination-exact-job-cancel'));
    await waitFor(() => expect(cancelAttempts).toBe(1));
    expect(screen.getByTestId('coordination-exact-job-status')).toHaveTextContent('JOB QUEUED');
    fireEvent.click(screen.getByTestId('coordination-exact-job-cancel'));
    await waitFor(() => expect(screen.getByTestId('coordination-exact-job-status')).toHaveTextContent('JOB CANCELLED'));
    expect(screen.getByTestId('coordination-exact-job-usage')).toHaveTextContent('Exact clash project active jobs (concurrency cap, not billing quota): 1 / 2');
    expect(cancelBody).toEqual({ action: 'cancel', jobId: 'SCJ-1' });
  });
});
