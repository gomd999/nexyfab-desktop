// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGuidedDesignBrief, buildGuidedRequirementGate, seedGuidedBriefInputs } from '@/lib/ai/guidedDesignBrief';
import type { AiCanonicalCandidate } from '@/lib/ai/aiCanonicalCandidate';
import type { FeatureEditIntent, FeatureStoreApi } from './featureEditDispatcher';
import { buildGuidedLocalMechanicalPlan } from './guidedLocalMechanicalPlan';
import AiAssistantShell from './AiAssistantShell';

let floatingAiPrompt = 'change selected feature';

vi.mock('./FloatingAiPrompt', () => ({
  default: ({ onSubmit }: { onSubmit: (prompt: string) => Promise<string | null> }) => (
    <button type="button" data-testid="floating-ai-submit" onClick={() => void onSubmit(floatingAiPrompt)}>Submit</button>
  ),
}));
vi.mock('./useVoiceInput', () => ({ useVoiceInput: () => ({ stop: vi.fn() }) }));
vi.mock('./generationSessionClient', () => ({ updateGenerationSessionForEdit: vi.fn() }));
vi.mock('./manualEditProtectionStore', () => ({ useManualEditProtectionLocks: () => [] }));

function request<T>(requestName: string, responseName: string, detail: Record<string, unknown>): Promise<T> {
  return new Promise(resolve => {
    const listener = (event: Event) => {
      window.removeEventListener(responseName, listener);
      resolve((event as CustomEvent<T>).detail);
    };
    window.addEventListener(responseName, listener);
    window.dispatchEvent(new CustomEvent(requestName, { detail }));
  });
}

const prompt = 'Design an exact L-bracket with 100 mm × 50 mm legs, length 40 mm, thickness 5 mm, ±0.1 mm tolerance, 6061-T6 aluminum, CNC milling';

describe('AiAssistantShell local guided candidate bridge', () => {
  beforeEach(() => {
    floatingAiPrompt = 'change selected feature';
    vi.clearAllMocks();
  });

  it('reviews without mutation, rejects tampering, then applies and undoes only the bound revision', async () => {
    const brief = buildGuidedDesignBrief({ prompt, requestedStage: 'exact', selectedDomains: ['mechanical'], inputs: seedGuidedBriefInputs(prompt, 'mechanical') });
    const requirementGate = buildGuidedRequirementGate(brief);
    const plan = buildGuidedLocalMechanicalPlan(requirementGate, prompt);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    let revision = 'revision-before';
    let baseShape: { shapeId: string; params: Record<string, number> } = { shapeId: 'box', params: { width: 20 } };
    let renderAppliedRevision = () => {};
    const setBaseShape = vi.fn((shapeId: string, params: Record<string, number>) => {
      baseShape = { shapeId, params };
      revision = 'revision-after';
      // Mirrors the browser ordering: the model mutation renders the new
      // revision before dispatchFeatureEditBatchAtomic resolves.
      renderAppliedRevision();
    });
    const store: FeatureStoreApi = {
      features: [], setBaseShape,
      addFeatureWithParams: vi.fn(), addSketchFeature: vi.fn(), updateFeatureParam: vi.fn(),
      removeFeature: vi.fn(), moveFeature: vi.fn(), toggleFeature: vi.fn(), clearAll: vi.fn(),
    };
    const captureEditSnapshot = () => structuredClone(baseShape);
    const restoreEditSnapshot = vi.fn((snapshot: unknown) => {
      baseShape = structuredClone(snapshot as typeof baseShape);
      revision = 'revision-before';
    });
    const props = {
      lang: 'en', store, promptToIntents: vi.fn(async () => ({ intents: [], explanation: '' })),
      getCurrentRevision: () => revision, captureEditSnapshot, restoreEditSnapshot,
    };
    const view = render(<AiAssistantShell {...props} />);
    renderAppliedRevision = () => view.rerender(<AiAssistantShell {...props} />);

    const reviewPromise = request<{ ok: boolean; candidate: AiCanonicalCandidate }>(
      'nexyfab:review-guided-local-candidate', 'nexyfab:guided-local-candidate-reviewed',
      { requestId: 'review-1', candidateId: 'local-1', payload: plan.payload, summary: plan.summary, requirementGate },
    );
    const reviewed = await reviewPromise;
    expect(reviewed.ok).toBe(true);
    expect(reviewed.candidate.state).toBe('PREVIEW');
    expect(setBaseShape).not.toHaveBeenCalled();

    const tampered = structuredClone(reviewed.candidate);
    ((tampered.payload.intents as Array<{ params: { width: number } }>)[0]!.params).width = 999;
    const rejected = await request<{ ok: boolean; error: string }>(
      'nexyfab:apply-guided-local-candidate', 'nexyfab:guided-local-candidate-apply-result',
      { requestId: 'apply-tampered', candidate: tampered },
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('candidate_changed_after_review');
    expect(setBaseShape).not.toHaveBeenCalled();

    const applied = await request<{ ok: boolean; candidate: AiCanonicalCandidate; undoAvailable: boolean }>(
      'nexyfab:apply-guided-local-candidate', 'nexyfab:guided-local-candidate-apply-result',
      { requestId: 'apply-1', candidate: reviewed.candidate },
    );
    expect(applied).toMatchObject({ ok: true, undoAvailable: true });
    expect(applied.candidate.state).toBe('APPLIED');
    expect(setBaseShape).toHaveBeenCalledWith('lBracket', { width: 100, height: 50, depth: 40, thickness: 5 });
    expect(revision).toBe('revision-after');

    const staleUndo = await request<{ ok: boolean; error: string }>(
      'nexyfab:undo-guided-local-candidate', 'nexyfab:guided-local-candidate-undo-result',
      { requestId: 'undo-stale', candidateId: reviewed.candidate.id, currentRevision: 'other-revision' },
    );
    expect(staleUndo).toEqual(expect.objectContaining({ ok: false, error: 'stale_or_unavailable_local_guided_undo' }));
    expect(restoreEditSnapshot).not.toHaveBeenCalled();

    const undone = await request<{ ok: boolean; restoredRevision: string }>(
      'nexyfab:undo-guided-local-candidate', 'nexyfab:guided-local-candidate-undo-result',
      { requestId: 'undo-1', candidateId: reviewed.candidate.id, currentRevision: 'revision-after' },
    );
    expect(undone).toMatchObject({ ok: true, restoredRevision: 'revision-before' });
    expect(baseShape).toEqual({ shapeId: 'box', params: { width: 20 } });
    expect(revision).toBe('revision-before');
  });

  it('uses an accessible in-app review and never falls back to window.confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const revision = 'revision-before';
    const updateFeatureParam = vi.fn();
    const store: FeatureStoreApi = {
      features: [{ id: 'feature-1', type: 'fillet', params: { radius: 2 }, enabled: true }],
      setBaseShape: vi.fn(), addFeatureWithParams: vi.fn(), addSketchFeature: vi.fn(), updateFeatureParam,
      removeFeature: vi.fn(), moveFeature: vi.fn(), toggleFeature: vi.fn(), clearAll: vi.fn(),
    };
    const view = render(<AiAssistantShell
      lang="en"
      store={store}
      promptToIntents={vi.fn(async () => ({
        intents: [{ kind: 'update_param', featureId: 'feature-1', paramKey: 'radius', value: 4 } satisfies FeatureEditIntent],
        explanation: 'Increase the selected fillet radius.', baseRevision: revision,
        selectionContext: {
          version: 1 as const, projectRevision: revision, assemblyPath: [], featureId: 'feature-1', topology: [],
          sketchEntityIds: [], mateIds: [], coordinateFrame: 'world', units: 'mm' as const,
        },
      }))}
      getCurrentRevision={() => revision}
      captureEditSnapshot={() => ({})}
      restoreEditSnapshot={vi.fn()}
    />);

    fireEvent.click(screen.getByTestId('floating-ai-submit'));
    const review = await screen.findByTestId('ai-plan-review');
    expect(review).toHaveAttribute('role', 'dialog');
    expect(review).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Request-only edit')).toBeInTheDocument();
    expect(screen.getByTestId('ai-plan-review-cancel')).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('ai-plan-review-apply')).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByTestId('ai-plan-review-cancel')).toHaveFocus();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('ai-plan-review-cancel'));
    await waitFor(() => expect(screen.queryByTestId('ai-plan-review')).not.toBeInTheDocument());
    expect(updateFeatureParam).not.toHaveBeenCalled();
    expect(view.unmount).toBeTypeOf('function');
    confirm.mockRestore();
  });

  it('runs an unknown product through the governed generic planner after review', async () => {
    floatingAiPrompt = 'design a quantum widget 12mm';
    let revision = 'generic-before';
    const onGenericPlan = vi.fn(async () => {
      revision = 'generic-after';
      return true;
    });
    const restoreEditSnapshot = vi.fn();
    const store: FeatureStoreApi = {
      features: [], setBaseShape: vi.fn(), addFeatureWithParams: vi.fn(), addSketchFeature: vi.fn(), updateFeatureParam: vi.fn(),
      removeFeature: vi.fn(), moveFeature: vi.fn(), toggleFeature: vi.fn(), clearAll: vi.fn(),
    };
    render(<AiAssistantShell
      lang="en"
      store={store}
      promptToIntents={vi.fn(async () => ({ intents: [], explanation: '' }))}
      getCurrentRevision={() => revision}
      captureEditSnapshot={() => ({ revision })}
      restoreEditSnapshot={restoreEditSnapshot}
      onGenericPlan={onGenericPlan}
    />);

    fireEvent.click(screen.getByTestId('floating-ai-submit'));
    await screen.findByTestId('ai-plan-review');
    fireEvent.click(screen.getByTestId('ai-plan-review-apply'));

    await waitFor(() => expect(onGenericPlan).toHaveBeenCalledTimes(1));
    expect(onGenericPlan).toHaveBeenCalledWith(floatingAiPrompt);
    expect(revision).toBe('generic-after');
    expect(restoreEditSnapshot).not.toHaveBeenCalled();
  });

  it('rolls back a scoped external mesh edit when its atomic executor rejects the mutation', async () => {
    floatingAiPrompt = 'Change the selected imported part width to 80 mm';
    const revision = 'mesh-before';
    const snapshot = { scad: 'original mesh source' };
    const onScadEdit = vi.fn(async () => false);
    const restoreEditSnapshot = vi.fn();
    const store: FeatureStoreApi = {
      features: [], setBaseShape: vi.fn(), addFeatureWithParams: vi.fn(), addSketchFeature: vi.fn(), updateFeatureParam: vi.fn(),
      removeFeature: vi.fn(), moveFeature: vi.fn(), toggleFeature: vi.fn(), clearAll: vi.fn(),
    };
    render(<AiAssistantShell
      lang="en"
      store={store}
      promptToIntents={vi.fn(async () => ({ intents: [], explanation: '' }))}
      getCurrentRevision={() => revision}
      captureEditSnapshot={() => snapshot}
      restoreEditSnapshot={restoreEditSnapshot}
      scadEditActive
      onScadEdit={onScadEdit}
      externalEditScope={{ id: 'mesh-1', label: 'imported housing mesh' }}
    />);

    fireEvent.click(screen.getByTestId('floating-ai-submit'));
    await screen.findByTestId('ai-plan-review');
    fireEvent.click(screen.getByTestId('ai-plan-review-apply'));

    await waitFor(() => expect(onScadEdit).toHaveBeenCalledTimes(1));
    expect(restoreEditSnapshot).toHaveBeenCalledWith(snapshot);
  });
});
