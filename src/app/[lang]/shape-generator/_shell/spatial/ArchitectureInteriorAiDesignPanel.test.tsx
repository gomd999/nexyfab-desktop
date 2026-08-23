// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchitectureInteriorAiDesignPanel } from './ArchitectureInteriorAiDesignPanel';

const authority = { wallThickness: 200, slabThickness: 200, ceilingThickness: 150 };
const candidate = { architecture: { storeys: [{ id: 'level-1', heightMm: 3000 }], spaces: [{ id: 'space-1', usageKey: 'living', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] }] }, interior: { furniture: [{ id: 'f-1' }], lights: [{ id: 'l-1' }], finishes: [{ id: 'm-1' }] } };

afterEach(() => { vi.restoreAllMocks(); });

describe('ArchitectureInteriorAiDesignPanel', () => {
  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'])('renders localized and direction-aware UI for %s', lang => {
    render(<ArchitectureInteriorAiDesignPanel lang={lang} projectId="project-1" construction={authority} />);
    const panel = screen.getByTestId('architecture-interior-ai-design-panel');
    expect(panel).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    expect(screen.getByTestId('architecture-interior-ai-submit')).toBeDisabled();
    expect(screen.getByTestId('architecture-interior-ai-brief')).toBeInTheDocument();
  });

  it('does not call the endpoint when an authoritative thickness is missing', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorAiDesignPanel lang="en" projectId="project-1" construction={{ ...authority, ceilingThickness: null }} />);
    fireEvent.change(screen.getByTestId('architecture-interior-ai-brief'), { target: { value: 'A small library with quiet reading spaces.' } });
    expect(screen.getByTestId('architecture-interior-ai-submit')).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/wall, slab and ceiling/i);
  });

  it('sends only server-owned request fields and keeps the candidate non-persisted', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).not.toHaveProperty('provider'); expect(body).not.toHaveProperty('model');
      expect(body).toMatchObject({ proposalId: 'ai-design-1', sourceLength: 'mm', construction: authority, constraints: { maximumFootprintWidth: 9000 } });
      return new Response(JSON.stringify({ ok: true, candidate, persisted: false, exact: { status: 'not_run' }, compliance: { status: 'not_run' }, release: { status: 'not_run' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorAiDesignPanel lang="en" projectId="project-1" construction={authority} constraints={{ maximumFootprintWidth: 9000 }} />);
    fireEvent.change(screen.getByTestId('architecture-interior-ai-brief'), { target: { value: 'A compact public library with daylight.' } });
    fireEvent.click(screen.getByTestId('architecture-interior-ai-submit'));
    await waitFor(() => expect(screen.getByTestId('architecture-interior-ai-candidate')).toBeInTheDocument());
    expect(screen.getByTestId('architecture-interior-ai-candidate')).toHaveTextContent(/Not persisted/);
    expect(screen.getByTestId('architecture-interior-ai-candidate')).toHaveTextContent(/Exact geometry: NOT_RUN/);
    expect(screen.queryByRole('button', { name: /apply|적용|aplicar|应用|適用|تطبيق/i })).not.toBeInTheDocument();
  });

  it('requires an explicit localized approval click before committing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, candidate, persisted: false, approval: { status: 'ready', token: 'approval-token', proposalId: 'p-1', proposalHash: 'a'.repeat(64), candidateHash: 'b'.repeat(64) } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, code: 'CONCEPT_COMMITTED', persisted: true, exact: { status: 'not_run' }, compliance: { status: 'not_run' }, release: { status: 'not_run' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ArchitectureInteriorAiDesignPanel lang="en" projectId="project-1" construction={authority} />);
    fireEvent.change(screen.getByTestId('architecture-interior-ai-brief'), { target: { value: 'A small gallery with flexible lighting.' } });
    fireEvent.click(screen.getByTestId('architecture-interior-ai-submit'));
    await waitFor(() => expect(screen.getByTestId('architecture-interior-ai-approve-save')).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('architecture-interior-ai-approve-save'));
    await waitFor(() => expect(screen.getByTestId('architecture-interior-ai-candidate')).toHaveTextContent(/Approved and saved/));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/commit');
  });
});
