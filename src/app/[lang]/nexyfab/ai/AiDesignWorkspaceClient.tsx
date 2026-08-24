'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatchAiDesignChatAction, type AiDesignChatActionCardV1, type AiDesignChatActionId } from '@/lib/ai/aiDesignChatActionCards';
import {
  createAiDesignUnifiedWorkspaceControllerV1,
  reduceAiDesignUnifiedWorkspaceControllerV1,
  type AiDesignUnifiedWorkspaceControllerEventV1,
  type AiDesignUnifiedWorkspaceControllerV1,
} from '@/lib/ai/aiDesignUnifiedWorkspaceControllerV1';
import type { AiDesignComplexWorkspaceReadModelV4 } from '@/lib/ai/aiDesignComplexWorkspaceService';
import {
  createAiDesignConceptNodesV10,
  createAiDesignUnifiedWorkspaceSnapshotV10,
} from '@/lib/ai/aiDesignWorkspaceIntegrationV10';
import { AiDesignWorkspaceSurface, type AiDesignSurfaceGaugeV10 } from './AiDesignWorkspaceSurface';
import styles from './AiDesignWorkspace.module.css';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  if (!response.ok || !record(value)) throw new Error(record(value) && typeof value.error === 'string' ? value.error : `HTTP_${response.status}`);
  return value;
}

export default function AiDesignWorkspaceClient({ lang, projectId, sessionId }: { lang: string; projectId: string; sessionId: string }) {
  const [controller, setController] = useState<AiDesignUnifiedWorkspaceControllerV1 | null>(null);
  const controllerRef = useRef<AiDesignUnifiedWorkspaceControllerV1 | null>(null);
  const [model, setModel] = useState<AiDesignComplexWorkspaceReadModelV4 | null>(null);
  const [decisionCard, setDecisionCard] = useState<AiDesignChatActionCardV1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [gaugeMode, setGaugeMode] = useState<'fine' | 'coarse'>('fine');
  const [gaugeDirection, setGaugeDirection] = useState<1 | -1>(1);

  const publish = useCallback((next: AiDesignUnifiedWorkspaceControllerV1) => {
    controllerRef.current = next;
    setController(next);
    return next;
  }, []);

  const transition = useCallback((event: AiDesignUnifiedWorkspaceControllerEventV1, base = controllerRef.current) => {
    if (!base) return null;
    const result = reduceAiDesignUnifiedWorkspaceControllerV1(base, event);
    if (!result.ok) throw new Error(result.error);
    return publish(result.state);
  }, [publish]);

  const loadWorkspace = useCallback(async (completedRequestId?: string) => {
    const params = new URLSearchParams({ projectId, sessionId, locale: lang });
    const payload = await responseJson(await fetch(`/api/nexyfab/ai-design/workspace-session/complex-workspace?${params}`, { credentials: 'same-origin', cache: 'no-store' }));
    const snapshot = createAiDesignUnifiedWorkspaceSnapshotV10(payload);
    setModel(snapshot.source as AiDesignComplexWorkspaceReadModelV4);
    const current = controllerRef.current;
    if (!current) {
      const initial = publish(createAiDesignUnifiedWorkspaceControllerV1(snapshot));
      const modelId = snapshot.workspace.model.publicModelId;
      if (modelId) transition({ type: 'MODEL_FALLBACK_CONTEXT_SET', modelIds: [modelId] }, initial);
    } else if (snapshot.runtimeRevision > current.client.server.runtimeRevision
      || snapshot.runtimeRevision === current.client.server.runtimeRevision && snapshot.complexRevision > current.client.server.complexRevision) {
      transition({ type: 'SERVER_SNAPSHOT_RECEIVED', snapshot, completedRequestId }, current);
    }
    setNotice(null);
    return payload;
  }, [lang, projectId, publish, sessionId, transition]);

  useEffect(() => {
    let active = true;
    setBusy(true);
    loadWorkspace().catch(error => {
      if (active) setNotice(error instanceof Error ? error.message : 'AI_DESIGN_WORKSPACE_LOAD_FAILED');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [loadWorkspace]);

  const post = useCallback(async (path: string, body: unknown) => responseJson(await fetch(path, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })), []);

  const handleAction = useCallback(async (card: AiDesignChatActionCardV1, actionId: AiDesignChatActionId) => {
    const current = controllerRef.current;
    if (!current || busy) return;
    if (card.actions.find(item => item.id === actionId)?.requiresConfirmation
      && !window.confirm(lang === 'ko' || lang === 'kr' ? '현재 서버 revision에 이 요청을 적용할까요?' : 'Apply this request to the current server revision?')) return;
    setBusy(true);
    setNotice(null);
    try {
      let base = current;
      if (actionId === 'PREVIEW_CHANGE') {
        const gauge = model?.workspace.assemblyGauges.find(item => item.gaugeId === card.references.gaugeId)
          ?? model?.workspace.base.gauges.find(item => item.gaugeId === card.references.gaugeId);
        if (!gauge) throw new Error('AI_DESIGN_GAUGE_NOT_FOUND');
        const step = 'fineStep' in gauge ? (gaugeMode === 'fine' ? gauge.fineStep : gauge.coarseStep) : 1;
        base = transition({ type: 'BEGIN_GAUGE_DRAFT', draft: {
          id: `draft:${crypto.randomUUID()}`, baseRuntimeRevision: current.client.server.runtimeRevision,
          gaugeId: gauge.gaugeId, value: gauge.targetValue, originalValue: gauge.targetValue, unit: gauge.unit,
        } }, base) ?? base;
        base = transition({ type: 'UPDATE_GAUGE_DRAFT', value: gauge.targetValue + step * gaugeDirection }, base) ?? base;
      }
      const dispatched = dispatchAiDesignChatAction({
        card, actionId, effectId: `effect:${actionId}:${crypto.randomUUID()}`,
        expectedRuntimeRevision: base.client.server.runtimeRevision,
      });
      if (!dispatched.ok) throw new Error(dispatched.error);
      const explicitConfirmation = card.actions.find(item => item.id === actionId)?.requiresConfirmation === true;
      const advanced = transition({
        type: 'DISPATCH_CHAT_EFFECT', effect: dispatched.effect, explicitConfirmation,
        options: actionId === 'START_GENERATION'
          ? { runId: `run:${crypto.randomUUID()}`, modelSelection: { mode: 'auto', modelId: base.client.server.workspace.model.publicModelId } }
          : actionId === 'PREVIEW_CHANGE' ? { gauge: { mode: gaugeMode, direction: gaugeDirection } } : undefined,
      }, base);
      const pending = advanced?.pending;
      if (!pending) return;
      if (pending.kind === 'local-instruction') {
        if (pending.instruction === 'REFRESH_SERVER_STATE') await loadWorkspace();
        else if (pending.instruction === 'OPEN_CANDIDATE_COMPARISON') transition({ type: 'VIEW_CHANGED', panel: 'comparison', canvasMode: 'split' }, advanced);
        else if (pending.instruction === 'REJECT_CONCEPT_PREVIEW') setDecisionCard(null);
        else setNotice(`${pending.instruction} · local UI only`);
        transition({ type: 'CLEAR_PENDING' });
      } else if (pending.kind === 'server-request') {
        await post('/api/nexyfab/ai-design/workspace-session/actions', pending.command);
        await loadWorkspace(pending.command.commandId);
      } else if (pending.kind === 'concept-preview-request') {
        const payload = await post(`/api/nexyfab/ai-design/workspace-session/preview?locale=${encodeURIComponent(lang)}`, { request: pending });
        if (!record(payload.evidence) || !record(payload.decisionCard)) throw new Error('AI_DESIGN_CONCEPT_PREVIEW_RESPONSE_INVALID');
        transition({ type: 'PREVIEW_RECEIVED', requestId: pending.requestId, evidence: payload.evidence as never });
        setDecisionCard(payload.decisionCard as unknown as AiDesignChatActionCardV1);
      } else if (pending.kind === 'concept-apply-request') {
        const payload = await post(`/api/nexyfab/ai-design/workspace-session/concept-apply?locale=${encodeURIComponent(lang)}`, { request: pending, explicitConfirmation: true });
        const snapshot = createAiDesignUnifiedWorkspaceSnapshotV10(payload);
        setModel(snapshot.source as AiDesignComplexWorkspaceReadModelV4);
        transition({ type: 'SERVER_SNAPSHOT_RECEIVED', snapshot, completedRequestId: pending.requestId });
        setDecisionCard(null);
      } else if (pending.kind === 'precision-cad-handoff') {
        const payload = await post(`/api/nexyfab/ai-design/workspace-session/precision-handoff?locale=${encodeURIComponent(lang)}`, { handoff: pending, explicitConfirmation: true });
        const snapshot = createAiDesignUnifiedWorkspaceSnapshotV10(payload);
        setModel(snapshot.source as AiDesignComplexWorkspaceReadModelV4);
        transition({ type: 'SERVER_SNAPSHOT_RECEIVED', snapshot, completedRequestId: pending.requestId });
        setNotice(lang === 'ko' || lang === 'kr' ? 'Precision CAD 요청이 접수되었습니다. 정확 형상 실행과 PASS는 아직 아닙니다.' : 'Precision CAD request accepted. Exact execution and PASS have not occurred.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI_DESIGN_ACTION_FAILED');
    } finally {
      setBusy(false);
    }
  }, [busy, gaugeDirection, gaugeMode, lang, loadWorkspace, model, post, transition]);

  if (!controller || !model) return <div className={styles.loading} role="status">{notice ?? 'Loading synchronized AI Design workspace…'}</div>;
  const nodes = createAiDesignConceptNodesV10(model);
  const gauges: readonly AiDesignSurfaceGaugeV10[] = model.workspace.assemblyGauges.length
    ? model.workspace.assemblyGauges
    : model.workspace.base.gauges.map(item => ({ ...item, fineStep: 1, coarseStep: 5 }));

  return <AiDesignWorkspaceSurface
    lang={lang} workspace={controller.client.server.workspace} controller={controller}
    nodes={nodes} gauges={gauges} decisionCard={decisionCard} busy={busy} notice={notice}
    gaugeMode={gaugeMode} gaugeDirection={gaugeDirection}
    onAction={handleAction}
    onSelect={(id, kind) => transition({ type: 'SELECTION_CHANGED', selection: { kind, id } })}
    onCanvasMode={mode => transition({ type: 'VIEW_CHANGED', canvasMode: mode, panel: 'canvas' })}
    onGaugeMode={setGaugeMode} onGaugeDirection={setGaugeDirection}
    onRefresh={() => { setBusy(true); loadWorkspace().catch(error => setNotice(error instanceof Error ? error.message : 'AI_DESIGN_WORKSPACE_LOAD_FAILED')).finally(() => setBusy(false)); }}
  />;
}
