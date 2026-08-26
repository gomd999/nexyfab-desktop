// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { AI_AUTH_REQUIRED_COPY, AI_RUN_FAILED_COPY, AI_RUN_FAILURE_DETAIL_COPY, PRECISION_CAD_AUTO_PROMPT_COPY, PRECISION_CAD_BOOTSTRAP_FAILED_COPY, PRECISION_CAD_PROJECT_REQUIRED_COPY, PRECISION_CAD_TASK_UNAVAILABLE_COPY, AiChatPanel } from './AiChatPanel';
import { GENERATION_EXECUTION_PLAN_KEY } from '../../ai/generationSessionClient';
import { resetDomainWorkspaceSession, setDomainWorkspaceSelection } from '../domainWorkspaceStore';
import { createAiCanonicalCandidate, markAiCanonicalCandidateApplied } from '@/lib/ai/aiCanonicalCandidate';
import { useShellBridge } from '../shellBridgeStore';
import { resetManualEditProtectionSession } from '../../ai/manualEditProtectionStore';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/shape-generator' }));

function send(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'AI message input' }), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('AiChatPanel guided design intake', () => {
  it('ships new AI run failure copy in all six supported languages', () => {
    expect(Object.keys(AI_RUN_FAILED_COPY).sort()).toEqual(['ar', 'en', 'es', 'ja', 'ko', 'zh']);
    expect(Object.values(AI_RUN_FAILED_COPY).every(value => value.trim().length > 0)).toBe(true);
    expect(Object.keys(PRECISION_CAD_AUTO_PROMPT_COPY).sort()).toEqual(['ar', 'en', 'es', 'ja', 'ko', 'zh']);
    expect(Object.values(PRECISION_CAD_AUTO_PROMPT_COPY).every(value => value.trim().length > 0)).toBe(true);
    for (const dictionary of [PRECISION_CAD_PROJECT_REQUIRED_COPY, PRECISION_CAD_TASK_UNAVAILABLE_COPY, PRECISION_CAD_BOOTSTRAP_FAILED_COPY, AI_RUN_FAILURE_DETAIL_COPY, AI_AUTH_REQUIRED_COPY]) {
      expect(Object.keys(dictionary).sort()).toEqual(['ar', 'en', 'es', 'ja', 'ko', 'zh']);
      expect(Object.values(dictionary).every(value => value.trim().length > 0)).toBe(true);
    }
  });

  it('automatically starts a newly governed precision CAD task once', async () => {
    window.sessionStorage.setItem(GENERATION_EXECUTION_PLAN_KEY, JSON.stringify({
      schema: 'nexyfab.adaptive-complex-product-execution.v1',
      nextAction: 'run_ai_managed_precision_cad',
      activeStage: 'assembly_solve',
      affectedPartIds: ['arm'],
      reasonCodes: ['PRECISE_INTERFERENCE_PRESENT'],
      precisionCad: { required: true, executionMode: 'ai_managed', scope: 'assembly_or_product' },
    }));
    const fetchMock = vi.fn().mockImplementation(async (url: string) => String(url).includes('/precision-cad-agent/bootstrap')
      ? {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ ok: true, binding: { projectId: 'project-1' }, session: { cadBootstrap: { projectId: 'project-1' } } }),
        }
      : {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ text: 'Precision task complete.' }),
        });
    vi.stubGlobal('fetch', fetchMock);
    render(<AiChatPanel isKo={false} />);

    const agentCalls = () => fetchMock.mock.calls.filter(call => String(call[0]).includes('/scad-agent/'));
    await waitFor(() => expect(agentCalls()).toHaveLength(1));
    const body = JSON.parse(String((agentCalls()[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.executionMode).toBe('precision_cad');
    expect(body.precisionTask).toMatchObject({ activeStage: 'assembly_solve', affectedPartIds: ['arm'] });
    window.dispatchEvent(new CustomEvent('nexyfab:complex-execution-plan', { detail: JSON.parse(window.sessionStorage.getItem(GENERATION_EXECUTION_PLAN_KEY)!) }));
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(agentCalls()).toHaveLength(1);
  });

  it('does not invoke SCAD when a precision task is missing', async () => {
    setDomainWorkspaceSelection({ domain: 'mechanical', experience: 'standard', workMode: 'precision_cad' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AiChatPanel isKo={false} />);
    send('Edit the current part');
    expect(await screen.findByText(/precision CAD task is unavailable or stale/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not invoke SCAD when the server bootstrap is stale or cross-project', async () => {
    setDomainWorkspaceSelection({ domain: 'mechanical', experience: 'standard', workMode: 'precision_cad' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true, binding: { projectId: 'other-project' }, session: { cadBootstrap: { projectId: 'other-project' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AiChatPanel isKo={false} />);
    window.sessionStorage.setItem(GENERATION_EXECUTION_PLAN_KEY, JSON.stringify({
      schema: 'nexyfab.adaptive-complex-product-execution.v1', nextAction: 'run_ai_managed_precision_cad',
      activeStage: 'assembly_solve', affectedPartIds: ['arm'], reasonCodes: ['STALE'],
      precisionCad: { required: true, executionMode: 'ai_managed', scope: 'affected_parts_only' },
    }));
    send('Edit the current part');
    expect(await screen.findByText(/Precision CAD bootstrap failed/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    window.sessionStorage.clear();
    resetDomainWorkspaceSession();
    resetManualEditProtectionSession();
    useShellBridge.setState({ contentRevision: '' });
    setDomainWorkspaceSelection({ domain: 'mechanical', experience: 'guided', workMode: 'ai_assisted' });
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/en/shape-generator?project=project-1');
  });

  it('collects missing exact inputs before invoking the model service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ text: 'Design proposal ready.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AiChatPanel isKo={false} />);

    send('Design an exact bracket');
    expect(await screen.findByTestId('requirement-item-mechanical-critical_dimensions')).toHaveTextContent('MISSING');
    expect(screen.getByTestId('requirement-item-mechanical-functional_requirements')).toHaveAttribute('data-locked', 'true');
    expect(fetchMock).not.toHaveBeenCalled();

    send('100×50×5 mm, ±0.1 mm');
    await waitFor(() => expect(screen.getByTestId('requirement-item-mechanical-critical_dimensions')).toHaveTextContent('AUTHORITATIVE'));
    expect(screen.getByRole('alert')).toHaveTextContent('Material and manufacturing process');
    expect(fetchMock).not.toHaveBeenCalled();

    send('6061-T6 aluminum, CNC milled');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(String(request.body)).toContain('mechanical.critical_dimensions [user_confirmed]');
    expect(String(request.body)).toContain('mechanical.material_process [user_confirmed]');
  });

  it('records an assumption but does not promote it to exact evidence', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AiChatPanel isKo={false} />);

    send('Design an exact bracket');
    await screen.findByTestId('requirement-item-mechanical-critical_dimensions');
    send('assume a reasonable size');

    expect(await screen.findByText(/assumption was recorded/i)).toBeTruthy();
    expect(screen.getAllByText(/Critical dimensions and tolerances/).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an unresolved dimension choice blocked and asks for one authoritative value', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AiChatPanel isKo={false} />);

    send('Design an exact bracket');
    await screen.findByTestId('requirement-item-mechanical-critical_dimensions');
    send('100 mm or 120 mm');

    expect(await screen.findByText(/confirm one value and remove unresolved alternatives/i)).toBeTruthy();
    expect(screen.getByTestId('requirement-gate-state')).toHaveTextContent('BLOCKED');
    expect(within(screen.getByTestId('requirement-item-mechanical-critical_dimensions')).getByText('CONFLICT')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires Review and an explicit Apply before dispatching a canonical mutation', async () => {
    setDomainWorkspaceSelection({ domain: 'mechanical', experience: 'standard', workMode: 'precision_cad' });
    useShellBridge.setState({ contentRevision: 'revision-7' });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => String(url).includes('/precision-cad-agent/bootstrap')
      ? { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, binding: { projectId: 'project-1' }, session: { cadBootstrap: { projectId: 'project-1' } } }) }
      : { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ text: 'I prepared a width change.', intent: { shapeId: 'box', params: { width: 120 } } }) }));
    const applyListener = vi.fn();
    const onReview = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId: string; candidateId: string; kind: 'intent'; payload: Record<string, unknown>; summary: string }>).detail;
      const candidate = createAiCanonicalCandidate({ id: detail.candidateId, kind: detail.kind, payload: detail.payload, summary: detail.summary, baseRevision: 'revision-7' });
      window.dispatchEvent(new CustomEvent('nexyfab:ai-candidate-reviewed', { detail: { requestId: detail.requestId, ok: true, candidate } }));
    };
    const onApply = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId: string; candidate: ReturnType<typeof createAiCanonicalCandidate> }>).detail;
      applyListener(event);
      window.dispatchEvent(new CustomEvent('nexyfab:ai-candidate-apply-result', { detail: { requestId: detail.requestId, ok: true, candidate: markAiCanonicalCandidateApplied(detail.candidate) } }));
    };
    window.addEventListener('nexyfab:review-ai-candidate', onReview);
    window.addEventListener('nexyfab:apply-ai-candidate', onApply);
    render(<AiChatPanel isKo={false} />);
    window.sessionStorage.setItem(GENERATION_EXECUTION_PLAN_KEY, JSON.stringify({
      schema: 'nexyfab.adaptive-complex-product-execution.v1',
      nextAction: 'run_ai_managed_precision_cad',
      activeStage: 'assembly_solve',
      affectedPartIds: ['arm'],
      reasonCodes: ['MANUAL_PRECISION_EDIT'],
      precisionCad: { required: true, executionMode: 'ai_managed', scope: 'affected_parts_only' },
    }));

    send('Change the current width to 120 mm');
    await screen.findByText('I prepared a width change.');
    expect(applyListener).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Review changes/ }));
    expect(await screen.findByTestId('ai-candidate-state')).toHaveTextContent('PREVIEW');
    expect(applyListener).not.toHaveBeenCalled();
    act(() => useShellBridge.setState({ contentRevision: 'revision-8' }));
    expect(await screen.findByTestId('ai-candidate-revision-blocker')).toHaveTextContent('stale_workspace_revision');
    expect(screen.getByTestId('ai-candidate-apply')).toBeDisabled();
    act(() => useShellBridge.setState({ contentRevision: 'revision-7' }));
    await waitFor(() => expect(screen.getByTestId('ai-candidate-apply')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ai-candidate-apply'));
    await waitFor(() => expect(applyListener).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('ai-candidate-state')).toHaveTextContent('APPLIED');

    window.removeEventListener('nexyfab:review-ai-candidate', onReview);
    window.removeEventListener('nexyfab:apply-ai-candidate', onApply);
  });

  it('routes a fully specified guided design through the selected AI model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ text: 'AI design generated and ready for review.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<AiChatPanel isKo={false} />);

    send('Design an exact L-bracket with 100 mm × 50 mm legs, length 40 mm, thickness 5 mm, ±0.1 mm tolerance, 6061-T6 aluminum, CNC milling');
    expect(await screen.findByText('AI design generated and ready for review.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.executionMode).toBe('ai_design');
    expect(body.designDomain).toBe('mechanical');
    expect(String(body.userPrompt)).toContain('mechanical.critical_dimensions [user_confirmed]');
    expect(screen.queryByTestId('guided-local-execution-truth')).toBeNull();
    expect((await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
  });

  it('explains that authentication is required when the AI route returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    }));
    render(<AiChatPanel isKo={false} />);

    send('Design an exact L-bracket with 100 mm × 50 mm legs, length 40 mm, thickness 5 mm, ±0.1 mm tolerance, 6061-T6 aluminum, CNC milling');

    expect(await screen.findByText(/Sign in to run AI design, then try again\./)).toBeTruthy();
  });
});
