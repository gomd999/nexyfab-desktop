'use client';

// Embedded AI chat panel — replaces the modal-trigger placeholder in the
// Nexy AI tab. Sends user prompts to the existing /api/nexyfab/scad-agent
// endpoint and renders responses with an "Apply" button that dispatches a
// tool intent for Inner to materialise.

import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { AiModelSelector, useAiModelPreference } from '@/components/nexyfab/AiModelSelector';
import { I } from '../Icons';
import { useLang } from '../../hooks/useLang';
import { loc } from '../../lib/loc';
import { buildScadAgentBody, precisionCadBootstrapEndpoint, SCAD_AGENT_ENDPOINT, textFromAgentEvent, type AiChatWireEvent, type ScadAgentExecutionMode } from './aiChatTransport';
import { useDomainWorkspaceSelection } from '../domainWorkspaceStore';
import {
  answerGuidedBriefQuestion,
  buildGuidedDesignBrief,
  composeGuidedDesignPrompt,
  inferRequestedMaturity,
  isNewDesignPrompt,
  seedGuidedBriefInputs,
  buildGuidedRequirementGate,
  type GuidedDesignBrief,
  type GuidedRequirementGate,
} from '@/lib/ai/guidedDesignBrief';
import type { AiCanonicalCandidate, AiCandidateKind } from '@/lib/ai/aiCanonicalCandidate';
import { protectManualEdit, useManualEditProtectionLocks } from '../../ai/manualEditProtectionStore';
import { useProjectsStore } from '@/hooks/useProjects';
import { useShellBridge } from '../shellBridgeStore';
import { RequirementConfirmationGate } from './RequirementConfirmationGate';
import { GENERATION_EXECUTION_PLAN_KEY } from '../../ai/generationSessionClient';
import { parsePrecisionCadAgentTask } from '@/lib/ai/precisionCadAgentTask';
import type { AgentSession } from '@/lib/ai/scad-agent/types';
import { DIRECT_PRECISION_ENTRY_DRAFT_KEY, parsePrecisionEntryDraft } from '@/lib/precisionEntryDraft';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Optional Stage 2 diagnostics surfaced from intentToScad result. */
  diagnostics?: { severity: 'info' | 'warn' | 'error'; message: string }[];
  /** Optional suggested intent payload — drives the Apply button. */
  intent?: Record<string, unknown>;
  /** Pattern suggestion from Stage 2 — Apply uses the pattern's seed. */
  pattern?: { id: string; title: string };
  /** Revision-bound proposal returned by the modeler. It is inert until Apply. */
  candidate?: AiCanonicalCandidate;
  candidateFeedback?: string;
  requirementGate?: GuidedRequirementGate;
  executionPath?: 'cloud_ai' | 'local_deterministic';
  localUndoAvailable?: boolean;
  undoState?: 'WORKING' | 'UNDONE' | 'BLOCKED';
  loading?: boolean;
  aiExecution?: {
    selectedModelLabel?: string;
    textModel?: string;
    visionModel?: string | null;
    visionAutoRouted?: boolean;
    parallelAssistantModel?: string | null;
    parallelAssistantTasks?: string[];
  };
}

export interface AiChatPanelProps {
  isKo: boolean;
}

export const AI_RUN_FAILED_COPY = {
  ko: '선택한 AI 모델이 설계 실행을 완료하지 못했습니다. 모델은 변경되지 않았습니다.',
  en: 'The selected AI model did not complete the design run. The model was not changed.',
  ja: '選択した AI モデルは設計実行を完了できませんでした。モデルは変更されていません。',
  zh: '所选 AI 模型未完成设计运行。模型未更改。',
  es: 'El modelo de IA seleccionado no completó la ejecución de diseño. El modelo no cambió.',
  ar: 'لم يكمل نموذج الذكاء الاصطناعي المحدد تشغيل التصميم. لم يتغير النموذج.',
} as const;

export const PRECISION_CAD_AUTO_PROMPT_COPY = {
  ko: '관리된 범위에서 AI 정밀 CAD 작업을 계속하고 내부 CAD 도구로 결과를 검증하세요.',
  en: 'Continue the governed AI precision CAD task and verify the result with internal CAD tools.',
  ja: '管理された範囲で AI 精密 CAD タスクを続行し、内部 CAD ツールで結果を検証してください。',
  zh: '继续执行受控范围内的 AI 精密 CAD 任务，并使用内部 CAD 工具验证结果。',
  es: 'Continúa la tarea de CAD de precisión con IA dentro del alcance controlado y verifica el resultado con las herramientas CAD internas.',
  ar: 'تابع مهمة CAD الدقيقة بالذكاء الاصطناعي ضمن النطاق المحكوم وتحقق من النتيجة باستخدام أدوات CAD الداخلية.',
} as const;

export const PRECISION_CAD_PROJECT_REQUIRED_COPY = {
  ko: '정밀 CAD 작업에는 인증된 프로젝트가 필요합니다.',
  en: 'Precision CAD requires an authenticated project.',
  ja: '精密 CAD には認証済みプロジェクトが必要です。',
  zh: '精密 CAD 需要经过身份验证的项目。',
  es: 'CAD de precisión requiere un proyecto autenticado.',
  ar: 'يتطلب CAD الدقيق مشروعًا موثقًا.',
} as const;

export const PRECISION_CAD_TASK_UNAVAILABLE_COPY = {
  ko: '정밀 CAD 작업 범위가 없거나 오래되었습니다. 관리된 작업을 다시 생성한 후 계속하세요.',
  en: 'The precision CAD task is unavailable or stale. Regenerate the governed task before continuing.',
  ja: '精密 CAD タスクがないか古くなっています。管理対象タスクを再生成してから続行してください。',
  zh: '精密 CAD 任务不可用或已过期。请重新生成受控任务后再继续。',
  es: 'La tarea de CAD de precisión no está disponible o está obsoleta. Regenera la tarea controlada antes de continuar.',
  ar: 'مهمة CAD الدقيقة غير متاحة أو قديمة. أعد إنشاء المهمة المحكومة قبل المتابعة.',
} as const;

export const PRECISION_CAD_BOOTSTRAP_FAILED_COPY = {
  ko: '정밀 CAD 프로젝트 확인에 실패했습니다. 최신 프로젝트를 다시 열어 주세요.',
  en: 'Precision CAD bootstrap failed. Reopen the current project and try again.',
  ja: '精密 CAD プロジェクトの準備に失敗しました。最新のプロジェクトを開き直してください。',
  zh: '精密 CAD 项目准备失败。请重新打开当前项目后重试。',
  es: 'Falló la preparación del proyecto CAD de precisión. Vuelve a abrir el proyecto actual e inténtalo de nuevo.',
  ar: 'تعذر تجهيز مشروع CAD الدقيق. أعد فتح المشروع الحالي وحاول مرة أخرى.',
} as const;

export const AI_RUN_FAILURE_DETAIL_COPY = {
  ko: 'AI 실행이 차단되었습니다. 모델과 프로젝트는 변경되지 않았습니다.',
  en: 'The AI run was blocked. The model and project were not changed.',
  ja: 'AI 実行がブロックされました。モデルとプロジェクトは変更されていません。',
  zh: 'AI 运行已被阻止。模型和项目未更改。',
  es: 'La ejecución de IA fue bloqueada. El modelo y el proyecto no cambiaron.',
  ar: 'تم حظر تشغيل الذكاء الاصطناعي. لم يتغير النموذج أو المشروع.',
} as const;

export const AI_AUTH_REQUIRED_COPY = {
  ko: 'AI 설계 실행은 로그인이 필요합니다. 로그인한 뒤 다시 시도하세요.',
  en: 'Sign in to run AI design, then try again.',
  ja: 'AI 設計を実行するにはログインが必要です。ログインしてから再試行してください。',
  zh: '运行 AI 设计需要登录。请登录后重试。',
  es: 'Inicia sesión para ejecutar el diseño con IA y vuelve a intentarlo.',
  ar: 'سجّل الدخول لتشغيل التصميم بالذكاء الاصطناعي، ثم حاول مرة أخرى.',
} as const;

const PRECISION_CAD_AUTO_RUN_KEY = 'nexyfab:precision-cad-agent-auto-run:v1';

interface CandidateResponse {
  requestId: string;
  ok: boolean;
  candidate?: AiCanonicalCandidate;
  error?: string;
  undoAvailable?: boolean;
  restoredRevision?: string;
}

function requestCandidateEvent(
  requestEvent: 'nexyfab:review-ai-candidate' | 'nexyfab:apply-ai-candidate'
    | 'nexyfab:review-guided-local-candidate' | 'nexyfab:apply-guided-local-candidate'
    | 'nexyfab:undo-guided-local-candidate',
  responseEvent: 'nexyfab:ai-candidate-reviewed' | 'nexyfab:ai-candidate-apply-result'
    | 'nexyfab:guided-local-candidate-reviewed' | 'nexyfab:guided-local-candidate-apply-result'
    | 'nexyfab:guided-local-candidate-undo-result',
  detail: Record<string, unknown>,
): Promise<CandidateResponse> {
  return new Promise((resolve, reject) => {
    const requestId = `ai-candidate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onResponse = (event: Event) => {
      const response = (event as CustomEvent<CandidateResponse>).detail;
      if (!response || response.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener(responseEvent, onResponse);
      resolve(response);
    };
    const timeout = window.setTimeout(() => {
      window.removeEventListener(responseEvent, onResponse);
      reject(new Error('The precision workspace did not acknowledge the AI candidate.'));
    }, 8_000);
    window.addEventListener(responseEvent, onResponse);
    window.dispatchEvent(new CustomEvent(requestEvent, { detail: { ...detail, requestId } }));
  });
}

function protectAuthoritativeBriefInputs(gate: GuidedRequirementGate, scope: string): void {
  for (const item of gate.items) {
    if (item.state !== 'AUTHORITATIVE') continue;
    protectManualEdit(
      { kind: 'authoritative_input', objectId: item.lockObjectId, field: item.key },
      {
        scope,
        source: item.sourceRef?.startsWith('chat://') ? 'human' : 'authority',
        reason: `Confirmed design input: ${item.label}`,
      },
    );
  }
}

// Example prompt chips, keyed by route lang (matches useLang()). (2026-06-13 i18n)
const SUGGESTIONS: Record<string, string[]> = {
  ko: ['정밀 L형 브라켓을 설계해줘. 100 mm × 50 mm 다리, 길이 40 mm, 두께 5 mm, 공차 ±0.1 mm, 6061-T6 알루미늄 CNC 밀링', '필렛 반경 2mm 적용', '∅6.5 카운터보어 홀 4개를 모서리에 추가', 'M5 나사 구멍으로 변경'],
  en: ['Design an exact L-bracket with 100 mm × 50 mm legs, length 40 mm, thickness 5 mm, ±0.1 mm tolerance, 6061-T6 aluminum, CNC milling', 'Apply 2 mm fillet to all sharp edges', 'Add 4× ∅6.5 counterbore holes in corners', 'Change holes to tapped M5'],
  ja: ['厚さ5mmのアルミブラケットを作って', 'すべての鋭いエッジに2mmのフィレットを適用', '∅6.5のザグり穴を四隅に4つ追加', '穴をM5タップ穴に変更'],
  cn: ['制作一个5mm厚的铝支架', '对所有尖锐边缘应用2mm圆角', '在四角添加4个∅6.5沉头孔', '将孔改为M5攻丝孔'],
  es: ['Crea un soporte de aluminio de 5 mm', 'Aplica un redondeo de 2 mm a todas las aristas vivas', 'Añade 4 agujeros avellanados ∅6.5 en las esquinas', 'Cambia los agujeros a roscados M5'],
  ar: ['أنشئ حاملاً من الألومنيوم بسماكة 5 مم', 'طبّق تدويرًا 2 مم على كل الحواف الحادة', 'أضف 4 ثقوب غاطسة ∅6.5 في الزوايا', 'غيّر الثقوب إلى ملولبة M5'],
};

export function AiChatPanel({ isKo: _isKo }: AiChatPanelProps) {
  const lang = useLang();
  const userPlan = useAuthStore(state => state.user?.plan ?? 'free');
  const { modelId, pickModel } = useAiModelPreference(userPlan);
  const [domainWorkspace] = useDomainWorkspaceSelection();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: loc(lang, {
        ko: '안녕하세요. 자연어로 모델 편집을 요청하거나 DFM 검토를 부탁할 수 있습니다.',
        en: 'Ask in natural language to edit your model or get a DFM review.',
        ja: '自然言語でモデルの編集を依頼したり、DFM レビューを頼んだりできます。',
        zh: '用自然语言请求编辑模型或进行 DFM 审查。',
        es: 'Pide en lenguaje natural editar tu modelo u obtener una revisión DFM.',
        ar: 'اطلب بلغة طبيعية تعديل نموذجك أو الحصول على مراجعة DFM.',
      }),
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidateBusyId, setCandidateBusyId] = useState<string | null>(null);
  const [requirementGate, setRequirementGate] = useState<GuidedRequirementGate | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const guidedBriefRef = useRef<GuidedDesignBrief | null>(null);
  const sendRef = useRef<((prompt: string, executionMode?: ScadAgentExecutionMode) => Promise<void>) | undefined>(undefined);
  const projects = useProjectsStore(state => state.projects);
  const protectionScope = projects[0]?.id ?? 'local-workspace';
  const protectionLocks = useManualEditProtectionLocks(protectionScope);
  const currentRevision = useShellBridge(state => state.contentRevision);

  const retainBrief = (brief: GuidedDesignBrief | null) => {
    guidedBriefRef.current = brief;
    if (!brief) {
      setRequirementGate(null);
      return null;
    }
    const gate = buildGuidedRequirementGate(brief);
    protectAuthoritativeBriefInputs(gate, protectionScope);
    setRequirementGate(gate);
    return gate;
  };

  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel) return;
    if (typeof panel.scrollTo === 'function') panel.scrollTo({ top: panel.scrollHeight });
    else panel.scrollTop = panel.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const draft = parsePrecisionEntryDraft(window.sessionStorage.getItem(DIRECT_PRECISION_ENTRY_DRAFT_KEY), 'precision-cad');
    if (!draft) return;
    setInput(draft.prompt);
    setMessages(previous => [...previous, {
      id: `precision-entry-${Date.now()}`,
      role: 'assistant',
      content: loc(lang, {
        ko: '랜딩 요청을 복원했습니다. 아직 실행하거나 모델을 변경하지 않았습니다. 요청을 검토한 뒤 전송하세요.',
        en: 'The landing request was restored. Nothing has run and the model has not changed. Review it before sending.',
        ja: 'ランディングの依頼を復元しました。まだ実行されておらず、モデルも変更されていません。確認してから送信してください。',
        zh: '已恢复入口请求。尚未执行，模型也未更改。请检查后再发送。',
        es: 'Se restauró la solicitud inicial. Aún no se ejecutó nada ni se cambió el modelo. Revísala antes de enviarla.',
        ar: 'تمت استعادة طلب البداية. لم يتم تشغيل أي شيء ولم يتغير النموذج. راجعه قبل الإرسال.',
      }),
    }]);
    window.sessionStorage.removeItem(DIRECT_PRECISION_ENTRY_DRAFT_KEY);
  }, [lang]);

  const send = async (prompt: string, executionModeOverride?: ScadAgentExecutionMode) => {
    if (!prompt.trim() || busy) return;
    const visiblePrompt = prompt.trim();
    let executionPrompt = visiblePrompt;
    let requestRequirementGate: GuidedRequirementGate | undefined;

    // Guided users creating a new design go through an explicit brief. Answers
    // are recorded with provenance one at a time; assumptions remain visible
    // and cannot silently satisfy an exact/release gate.
    const activeBrief = guidedBriefRef.current;
    if (activeBrief) {
      const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: visiblePrompt };
      if (/^(cancel|stop|취소|중단|やめ|取消|cancelar|إلغاء)/i.test(visiblePrompt)) {
        retainBrief(null);
        setInput('');
        setMessages(prev => [...prev, userMsg, {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: loc(lang, {
            ko: '설계 브리프 작성을 취소했습니다. 모델은 변경되지 않았습니다.',
            en: 'Design brief intake cancelled. The model was not changed.',
            ja: '設計ブリーフをキャンセルしました。モデルは変更されていません。',
            zh: '已取消设计简报，模型未更改。',
            es: 'Se canceló el informe de diseño. El modelo no se modificó.',
            ar: 'تم إلغاء موجز التصميم ولم يتم تغيير النموذج.',
          }),
        }]);
        return;
      }

      const conceptOverride = /concept|preview|개념|초안|コンセプト|概念|concepto|مفهوم/i.test(visiblePrompt);
      let nextBrief: GuidedDesignBrief;
      if (conceptOverride && activeBrief.requestedStage !== 'concept') {
        nextBrief = buildGuidedDesignBrief({
          prompt: activeBrief.prompt,
          requestedStage: 'concept',
          selectedDomains: activeBrief.plan.domains,
          inputs: activeBrief.inputs,
        });
      } else {
        const question = activeBrief.questions[0];
        if (!question) {
          guidedBriefRef.current = null;
          executionPrompt = composeGuidedDesignPrompt(activeBrief);
          nextBrief = activeBrief;
        } else {
          const assumed = /assum|가정|임의|仮定|假设|supon|افتراض/i.test(visiblePrompt);
          nextBrief = answerGuidedBriefQuestion(activeBrief, question, visiblePrompt, assumed ? 'assumed' : 'user_confirmed');
        }
      }

      if (nextBrief.questions.length > 0) {
        retainBrief(nextBrief);
        setInput('');
        const assumptionBlocked = nextBrief.inputs[nextBrief.questions[0]!.domain]?.[nextBrief.questions[0]!.input.key]?.provenance === 'assumed';
        setMessages(prev => [...prev, userMsg, {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: briefQuestionText(lang, nextBrief, assumptionBlocked),
        }]);
        return;
      }
      requestRequirementGate = retainBrief(nextBrief) ?? undefined;
      guidedBriefRef.current = null;
      executionPrompt = composeGuidedDesignPrompt(nextBrief);
    } else if (domainWorkspace.experience === 'guided' && isNewDesignPrompt(visiblePrompt)) {
      const requestedStage = inferRequestedMaturity(visiblePrompt);
      const brief = buildGuidedDesignBrief({
        prompt: visiblePrompt,
        requestedStage,
        selectedDomains: [domainWorkspace.domain],
        inputs: seedGuidedBriefInputs(visiblePrompt, domainWorkspace.domain),
      });
      const gate = retainBrief(brief);
      if (brief.questions.length > 0) {
        setInput('');
        setMessages(prev => [...prev,
          { id: `u-${Date.now()}`, role: 'user', content: visiblePrompt },
          { id: `a-${Date.now()}`, role: 'assistant', content: briefQuestionText(lang, brief, false) },
        ]);
        return;
      }
      requestRequirementGate = gate ?? undefined;
      guidedBriefRef.current = null;
      executionPrompt = composeGuidedDesignPrompt(brief);
    }

    setInput('');
    setBusy(true);
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: visiblePrompt };
    const assistantId = `a-${Date.now()}`;
    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', loading: true, requirementGate: requestRequirementGate }]);
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 20_000);
    // Keep user-facing guard copy separate from transport/provider errors. The
    // thrown error below is intentionally opaque; this value is the only
    // precision-specific detail allowed into the panel diagnostics.
    let precisionUserError: string | undefined;
    try {
      let precisionTask;
      let precisionSession: AgentSession | undefined;
      const executionMode = executionModeOverride
        ?? (domainWorkspace.workMode === 'precision_cad' ? 'precision_cad' : 'ai_design');
      if (executionMode === 'precision_cad') {
        try {
          const storedPlan = window.sessionStorage.getItem(GENERATION_EXECUTION_PLAN_KEY);
          precisionTask = storedPlan ? parsePrecisionCadAgentTask(JSON.parse(storedPlan)) ?? undefined : undefined;
        } catch {
          // A corrupt/stale browser plan is never sent as an execution scope.
          precisionTask = undefined;
        }
        const projectId = new URLSearchParams(window.location.search).get('project') ?? projects[0]?.id;
        if (!projectId) {
          precisionUserError = loc(lang, PRECISION_CAD_PROJECT_REQUIRED_COPY);
          throw new Error('PRECISION_CAD_PROJECT_REQUIRED');
        }
        if (!precisionTask) {
          precisionUserError = loc(lang, PRECISION_CAD_TASK_UNAVAILABLE_COPY);
          throw new Error('PRECISION_CAD_TASK_UNAVAILABLE');
        }
        const bootstrapResponse = await fetch(precisionCadBootstrapEndpoint(projectId), {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {}),
          },
          body: JSON.stringify({ useCurrentHead: true }),
        });
        const bootstrap = await bootstrapResponse.json().catch(() => null) as {
          ok?: boolean;
          session?: AgentSession;
          binding?: { projectId?: string };
          error?: { code?: string; message?: string };
        } | null;
        if (!bootstrapResponse.ok || !bootstrap?.ok || !bootstrap.session?.cadBootstrap
          || bootstrap.binding?.projectId !== projectId || bootstrap.session.cadBootstrap.projectId !== projectId) {
          precisionUserError = loc(lang, PRECISION_CAD_BOOTSTRAP_FAILED_COPY);
          throw new Error('PRECISION_CAD_BOOTSTRAP_FAILED');
        }
        // The session is copied only from the server response. The browser
        // never creates or edits a signature, ownership map, or project ref.
        precisionSession = bootstrap.session;
      }
      // Streaming-first: ask the endpoint for an SSE/NDJSON stream. Falls
      // back to full-JSON mode if the server doesn't advertise text/event-
      // stream. Token-level rendering means the panel feels native-AI even
      // when the underlying model is slow.
      const res = await fetch(SCAD_AGENT_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream, application/json',
          // Send the access token so a logged-in user is recognised even when the
          // short-lived auth cookie has expired (raw fetch can't refresh) — else
          // the request falls back to guest and hits the daily limit → 401.
          ...(useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {}),
        },
        body: JSON.stringify(buildScadAgentBody(
          executionPrompt,
          modelId,
          executionMode,
          domainWorkspace.domain,
          precisionTask,
          precisionSession,
        )),
      });

      if (!res.ok) {
        const failure = await res.json().catch(() => null) as { error?: string; code?: string } | null;
        if (res.status === 401) precisionUserError = loc(lang, AI_AUTH_REQUIRED_COPY);
        throw new Error(failure?.error ?? `AI request failed (HTTP ${res.status})`);
      }

      const contentType = res.headers.get('content-type') ?? '';
      const isStream = contentType.includes('event-stream') || contentType.includes('ndjson') || contentType.includes('text/plain');

      if (isStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let acc = '';
        const final: { diagnostics?: Message['diagnostics']; intent?: Record<string, unknown>; pattern?: { id: string; title: string } } = {};
        let aiExecution: Message['aiExecution'];
        // Mark first chunk arrival → stop the typing-indicator.
        let firstChunk = true;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse event-stream frames (event:/data:) OR newline-delimited JSON.
          let frame: string | undefined;
          while ((frame = consumeFrame(buffer)) !== undefined) {
            buffer = buffer.slice(frame.length);
            const payload = parseFrame(frame);
            if (!payload) continue;
            if (payload.type === 'model_route') {
              aiExecution = {
                selectedModelLabel: payload.selectedModelLabel,
                textModel: payload.textModel,
                visionModel: payload.visionModel,
                visionAutoRouted: payload.visionAutoRouted,
                parallelAssistantModel: payload.parallelAssistantModel,
                parallelAssistantTasks: payload.parallelAssistantTasks,
              };
              setMessages(prev => prev.map(message => message.id === assistantId
                ? { ...message, aiExecution }
                : message));
            }
            const text = textFromAgentEvent(payload);
            if (text) {
              acc += `${acc ? '\n' : ''}${text}`;
              if (firstChunk) firstChunk = false;
              setMessages(prev => prev.map(m => m.id === assistantId
                ? { ...m, loading: false, content: acc }
                : m));
            }
            if (payload.diagnostics) final.diagnostics = payload.diagnostics as Message['diagnostics'];
            if (payload.intent) final.intent = payload.intent as Record<string, unknown>;
            if (payload.pattern) final.pattern = payload.pattern as { id: string; title: string };
          }
        }
        // Flush any partially-buffered frame.
        if (buffer.trim()) {
          const payload = parseFrame(buffer);
          if (payload?.delta) acc += payload.delta;
        }
        setMessages(prev => prev.map(m => m.id === assistantId ? {
          ...m,
          loading: false,
          content: acc || loc(lang, { ko: '응답 없음', en: 'Empty response', ja: '応答なし', zh: '无响应', es: 'Sin respuesta', ar: 'لا توجد استجابة' }),
          diagnostics: final.diagnostics,
          intent: final.intent,
          pattern: final.pattern,
          aiExecution,
        } : m));
      } else {
        // Non-stream fallback — full JSON.
        const data = await res.json().catch(() => null) as {
          text?: string;
          diagnostics?: Message['diagnostics'];
          intent?: Record<string, unknown>;
          pattern?: { id: string; title: string };
        } | null;
        setMessages(prev => prev.map(m => m.id === assistantId ? {
          ...m,
          loading: false,
          content: data?.text ?? loc(lang, { ko: '응답을 받을 수 없습니다 — 오프라인 모드', en: 'No response — offline mode', ja: '応答を取得できません — オフラインモード', zh: '无法获取响应 — 离线模式', es: 'Sin respuesta — modo sin conexión', ar: 'لا توجد استجابة — وضع عدم الاتصال' }),
          diagnostics: data?.diagnostics,
          intent: data?.intent,
          pattern: data?.pattern,
        } : m));
      }
    } catch {
      // AI Design and Precision CAD are AI-owned workflows. Fail visibly when
      // the selected model cannot run instead of silently substituting a local
      // deterministic editor and presenting that output as AI-created work.
      const safePrecisionMessage = precisionUserError ?? loc(lang, AI_RUN_FAILURE_DETAIL_COPY);
      setMessages(prev => prev.map(m => m.id === assistantId ? {
        ...m,
        loading: false,
        content: loc(lang, AI_RUN_FAILED_COPY),
        diagnostics: [{ severity: 'error', message: safePrecisionMessage }],
      } : m));
    } finally {
      window.clearTimeout(requestTimeout);
      setBusy(false);
    }
  };

  // Parse one frame from the stream buffer — supports SSE "data: {...}\n\n",
  // raw NDJSON "{...}\n", and plain text deltas. Returns the consumed prefix.
  function consumeFrame(buf: string): string | undefined {
    // SSE: terminated by blank line.
    const sseEnd = buf.indexOf('\n\n');
    if (sseEnd !== -1) return buf.slice(0, sseEnd + 2);
    // NDJSON / plain: terminated by single newline.
    const nlEnd = buf.indexOf('\n');
    if (nlEnd !== -1) return buf.slice(0, nlEnd + 1);
    return undefined;
  }

  function parseFrame(frame: string): AiChatWireEvent | null {
    const trimmed = frame.trim();
    if (!trimmed) return null;
    // SSE "data: ..." prefix.
    const dataLine = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (dataLine === '[DONE]') return null;
    if (dataLine.startsWith('{')) {
      try {
        const obj = JSON.parse(dataLine);
        return obj;
      } catch {
        return { delta: dataLine };
      }
    }
    // Plain text — treat as delta.
    return { delta: dataLine + ' ' };
  }

  const review = async (msg: Message) => {
    if (typeof window === 'undefined' || (!msg.intent && !msg.pattern)) return;
    setCandidateBusyId(msg.id);
    try {
      const kind: AiCandidateKind = msg.intent ? 'intent' : 'pattern';
      const payload = (msg.intent ?? msg.pattern) as Record<string, unknown>;
      const response = await requestCandidateEvent('nexyfab:review-ai-candidate', 'nexyfab:ai-candidate-reviewed', {
        candidateId: `chat-${msg.id}`,
        kind,
        payload,
        summary: msg.pattern?.title ?? msg.content.slice(0, 160),
        requirementGate: msg.requirementGate,
      });
      setMessages(previous => previous.map(item => item.id === msg.id ? {
        ...item,
        candidate: response.candidate,
        candidateFeedback: response.ok ? undefined : (response.error ?? 'Candidate review was blocked.'),
      } : item));
    } catch (error) {
      setMessages(previous => previous.map(item => item.id === msg.id ? { ...item, candidateFeedback: error instanceof Error ? error.message : String(error) } : item));
    } finally {
      setCandidateBusyId(null);
    }
  };
  sendRef.current = send;

  useEffect(() => {
    const runPlan = (value: unknown) => {
      const task = parsePrecisionCadAgentTask(value);
      if (!task) return;
      const fingerprint = JSON.stringify(task);
      try {
        if (window.sessionStorage.getItem(PRECISION_CAD_AUTO_RUN_KEY) === fingerprint) return;
        window.sessionStorage.setItem(PRECISION_CAD_AUTO_RUN_KEY, fingerprint);
      } catch {
        return;
      }
      void sendRef.current?.(loc(lang, PRECISION_CAD_AUTO_PROMPT_COPY), 'precision_cad');
    };
    try {
      const storedPlan = window.sessionStorage.getItem(GENERATION_EXECUTION_PLAN_KEY);
      if (storedPlan) runPlan(JSON.parse(storedPlan));
    } catch { /* unavailable or invalid session data */ }
    const onPlan = (event: Event) => runPlan((event as CustomEvent<unknown>).detail);
    window.addEventListener('nexyfab:complex-execution-plan', onPlan);
    return () => window.removeEventListener('nexyfab:complex-execution-plan', onPlan);
  }, [lang]);

  const apply = async (msg: Message) => {
    if (typeof window === 'undefined' || !msg.candidate) return;
    setCandidateBusyId(msg.id);
    try {
      const local = msg.executionPath === 'local_deterministic';
      const response = await requestCandidateEvent(
        local ? 'nexyfab:apply-guided-local-candidate' : 'nexyfab:apply-ai-candidate',
        local ? 'nexyfab:guided-local-candidate-apply-result' : 'nexyfab:ai-candidate-apply-result',
        { candidate: msg.candidate },
      );
      setMessages(previous => previous.map(item => item.id === msg.id ? {
        ...item,
        candidate: response.candidate ?? item.candidate,
        localUndoAvailable: local && response.ok && response.undoAvailable === true,
        candidateFeedback: response.ok
          ? loc(lang, { ko: '새 리비전으로 적용했습니다. 형상·DFM 검증은 NOT_RUN이며 다시 실행해야 합니다.', en: 'Applied as a new revision. Geometry and DFM verification remain NOT_RUN and must be rerun.', ja: '新しいリビジョンとして適用しました。形状と DFM 検証は NOT_RUN で、再実行が必要です。', zh: '已作为新修订应用。几何和 DFM 验证仍为 NOT_RUN，必须重新运行。', es: 'Aplicado como nueva revisión. La verificación geométrica y DFM sigue NOT_RUN y debe repetirse.', ar: 'تم التطبيق كمراجعة جديدة. لا يزال التحقق الهندسي وDFM بحالة NOT_RUN ويجب إعادة تشغيله.' })
          : (response.error ?? 'Candidate apply was blocked.'),
      } : item));
    } catch (error) {
      setMessages(previous => previous.map(item => item.id === msg.id ? { ...item, candidateFeedback: error instanceof Error ? error.message : String(error) } : item));
    } finally {
      setCandidateBusyId(null);
    }
  };

  const undoLocalGuided = async (msg: Message) => {
    if (typeof window === 'undefined' || !msg.candidate || msg.executionPath !== 'local_deterministic') return;
    setMessages(previous => previous.map(item => item.id === msg.id ? { ...item, undoState: 'WORKING' } : item));
    try {
      const response = await requestCandidateEvent(
        'nexyfab:undo-guided-local-candidate',
        'nexyfab:guided-local-candidate-undo-result',
        { candidateId: msg.candidate.id, currentRevision },
      );
      setMessages(previous => previous.map(item => item.id === msg.id ? {
        ...item,
        localUndoAvailable: !response.ok,
        undoState: response.ok ? 'UNDONE' : 'BLOCKED',
        candidateFeedback: response.ok
          ? loc(lang, { ko: '이 로컬 CAD 적용을 되돌렸습니다. 적용 전 FeatureTree 리비전이 복원됩니다.', en: 'This local CAD Apply was undone. The pre-Apply FeatureTree revision is being restored.', ja: 'このローカル CAD 適用を元に戻しました。適用前の FeatureTree リビジョンを復元します。', zh: '已撤销此次本地 CAD 应用。正在恢复应用前的 FeatureTree 修订。', es: 'Se deshizo esta aplicación CAD local. Se restaura la revisión de FeatureTree anterior.', ar: 'تم التراجع عن تطبيق CAD المحلي واستعادة مراجعة FeatureTree السابقة.' })
          : (response.error ?? 'Undo was blocked.'),
      } : item));
    } catch (error) {
      setMessages(previous => previous.map(item => item.id === msg.id ? {
        ...item,
        localUndoAvailable: true,
        undoState: 'BLOCKED',
        candidateFeedback: error instanceof Error ? error.message : String(error),
      } : item));
    }
  };

  const discard = (msg: Message) => {
    if (!msg.candidate || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nexyfab:discard-ai-candidate', { detail: { candidateId: msg.candidate.id } }));
    setMessages(previous => previous.map(item => item.id === msg.id ? { ...item, candidate: undefined, candidateFeedback: loc(lang, { ko: '후보를 폐기했습니다. 모델은 변경되지 않았습니다.', en: 'Candidate discarded. The model was not changed.', ja: '候補を破棄しました。モデルは変更されていません。', zh: '候选方案已丢弃，模型未更改。', es: 'Candidato descartado. El modelo no cambió.', ar: 'تم تجاهل المرشح ولم يتغير النموذج.' }) } : item));
  };

  const suggestions = SUGGESTIONS[lang] ?? SUGGESTIONS.en;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '7px 9px', borderBottom: '1px solid var(--nx-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ minWidth: 0, color: 'var(--nx-text-3)', fontSize: 9.5 }}>
          {loc(lang, {
            ko: 'AI 계획 모델', en: 'AI planning model', ja: 'AI計画モデル', zh: 'AI 规划模型',
            es: 'Modelo de planificación IA', ar: 'نموذج تخطيط الذكاء الاصطناعي',
          })}
        </span>
        <AiModelSelector modelId={modelId} onChange={pickModel} plan={userPlan} lang={lang} compact />
      </div>
      {requirementGate && (
        <div style={{ padding: '8px 10px 0' }}>
          <RequirementConfirmationGate gate={requirementGate} locks={protectionLocks} lang={lang} />
        </div>
      )}
      {/* Messages */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label={loc(lang, { ko: 'AI 대화 내역', en: 'AI conversation history', ja: 'AI 会話履歴', zh: 'AI 对话记录', es: 'Historial de conversación de IA', ar: 'سجل محادثة الذكاء الاصطناعي' })}
        style={{ flex: 1, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {messages.map(m => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              padding: '8px 10px',
              borderRadius: 8,
              background: m.role === 'user' ? 'var(--nx-accent)' : 'var(--nx-panel-2)',
              color: m.role === 'user' ? '#fff' : 'var(--nx-text)',
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.loading ? (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <Dot delay={0} /><Dot delay={150} /><Dot delay={300} />
              </span>
            ) : (
              <>
                <div>{m.content}</div>
                {m.aiExecution && (
                  <div data-testid="precision-ai-execution-model" style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid var(--nx-border)', color: 'var(--nx-text-3)', fontSize: 9 }}>
                    ✦ {m.aiExecution.selectedModelLabel ?? m.aiExecution.textModel ?? 'AI'}
                    {m.aiExecution.visionAutoRouted && ` · Vision → ${m.aiExecution.visionModel ?? 'GPT-5.6 Luna'}`}
                    {!!m.aiExecution.parallelAssistantTasks?.length && ` · Parallel → ${m.aiExecution.parallelAssistantModel ?? 'GPT-5.6 Luna'}`}
                  </div>
                )}
                {m.executionPath === 'local_deterministic' && (
                  <div
                    data-testid="guided-local-execution-truth"
                    aria-label={loc(lang, { ko: '로컬 설계 실행 상태', en: 'Local design execution status', ja: 'ローカル設計実行状態', zh: '本地设计执行状态', es: 'Estado de ejecución del diseño local', ar: 'حالة تنفيذ التصميم المحلي' })}
                    style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}
                  >
                    <strong style={{ padding: '2px 5px', borderRadius: 4, background: 'rgba(14,165,233,.14)', color: 'var(--nx-accent-2)', fontSize: 9 }}>PLAN · LOCAL DETERMINISTIC</strong>
                    <strong style={{ padding: '2px 5px', borderRadius: 4, background: 'rgba(148,163,184,.12)', color: 'var(--nx-text-2)', fontSize: 9 }}>AI MODEL · NOT_RUN</strong>
                  </div>
                )}
                {m.diagnostics && m.diagnostics.length > 0 && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--nx-border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {m.diagnostics.map((d, i) => (
                      <div key={i} style={{
                        fontSize: 10,
                        color: d.severity === 'error' ? 'var(--nx-error, #f85149)'
                          : d.severity === 'warn' ? 'var(--nx-warn, #ffa800)'
                          : 'var(--nx-text-3)',
                      }}>
                        {d.severity === 'error' ? '⚠' : d.severity === 'warn' ? '⚠' : 'ℹ'} {d.message}
                      </div>
                    ))}
                  </div>
                )}
                {m.pattern && (
                  <div style={{ marginTop: 6, fontSize: 10, color: 'var(--nx-accent-2)' }}>
                    {loc(lang, { ko: '추천 패턴', en: 'Pattern', ja: '推奨パターン', zh: '推荐模式', es: 'Patrón', ar: 'النمط' })}: {m.pattern.title}
                  </div>
                )}
                {(m.intent || m.pattern) && !m.candidate && (
                  <button
                    type="button"
                    data-testid={`ai-candidate-review-${m.id}`}
                    disabled={candidateBusyId === m.id}
                    onClick={() => void review(m)}
                    style={{
                      marginTop: 8, padding: '4px 10px',
                      border: '1px solid var(--nx-accent)', borderRadius: 4,
                      background: 'var(--nx-accent-soft)', color: 'var(--nx-accent-2)',
                      fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {candidateBusyId === m.id ? '…' : '⌕ ' + loc(lang, { ko: '변경 검토', en: 'Review changes', ja: '変更を確認', zh: '审查更改', es: 'Revisar cambios', ar: 'مراجعة التغييرات' })}
                  </button>
                )}
                {m.candidate && (
                  <div
                    role="region"
                    aria-label={m.executionPath === 'local_deterministic' ? 'Local deterministic CAD candidate' : 'AI change candidate'}
                    tabIndex={-1}
                    data-testid={`ai-candidate-${m.candidate.id}`}
                    style={{ marginTop: 8, padding: 8, border: `1px solid ${m.candidate.state === 'BLOCKED' ? 'var(--nx-error, #f85149)' : 'var(--nx-accent)'}`, borderRadius: 6, background: 'var(--nx-panel)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, fontWeight: 800 }}>
                      <span>{m.executionPath === 'local_deterministic'
                        ? loc(lang, { ko: '로컬 정밀 CAD 후보', en: 'Local precision CAD candidate', ja: 'ローカル精密 CAD 候補', zh: '本地精密 CAD 候选', es: 'Candidato CAD de precisión local', ar: 'مرشح CAD دقيق محلي' })
                        : loc(lang, { ko: 'AI 변경 후보', en: 'AI change candidate', ja: 'AI 変更候補', zh: 'AI 更改候选', es: 'Candidato de cambio IA', ar: 'مرشح تغيير الذكاء الاصطناعي' })}</span>
                      <span data-testid="ai-candidate-state">{m.candidate.state}</span>
                    </div>
                    <div style={{ marginTop: 5, fontSize: 9.5, color: 'var(--nx-text-2)' }}>
                      base {m.candidate.baseRevision.slice(0, 12)} · {m.candidate.changedTargets.length} change target(s)
                    </div>
                    {m.candidate.requirementGate && <div style={{ marginTop: 6 }}><RequirementConfirmationGate gate={m.candidate.requirementGate} locks={protectionLocks} lang={lang} context="candidate" /></div>}
                    {m.candidate.changedTargets.slice(0, 5).map((target, index) => (
                      <div key={`${target.kind}-${target.objectId}-${target.field ?? ''}-${index}`} style={{ marginTop: 3, fontSize: 9.5 }}>
                        {target.kind} · {target.objectId}{target.field ? ` · ${target.field}` : ''}
                      </div>
                    ))}
                    <div style={{ marginTop: 6, display: 'grid', gap: 3 }}>
                      {m.candidate.evidence.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 9 }}>
                          <span>{m.executionPath === 'local_deterministic' && item.id === 'ai-plan' ? 'Local deterministic plan' : item.label}{item.sourceId ? ` · ${item.sourceId}` : ''}</span><b>{item.status}</b>
                        </div>
                      ))}
                      {m.candidate.metrics.map(metric => (
                        <div key={metric.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 9 }}>
                          <span>{metric.label}{metric.sourceId ? ` · ${metric.sourceId}` : ''}</span><b>{metric.value ?? '—'}{metric.unit ?? ''} · {metric.status}</b>
                        </div>
                      ))}
                    </div>
                    {m.candidate.issues.length > 0 && <div role="alert" style={{ marginTop: 6, color: 'var(--nx-error, #f85149)', fontSize: 9.5 }}>{m.candidate.issues.join(' · ')}{m.candidate.blockedLockIds.length ? ` · ${m.candidate.blockedLockIds.join(', ')}` : ''}</div>}
                    {(m.candidate.state === 'PREVIEW' || m.candidate.state === 'BLOCKED') && (!currentRevision || m.candidate.baseRevision !== currentRevision) && (
                      <div role="alert" data-testid="ai-candidate-revision-blocker" style={{ marginTop: 6, color: 'var(--nx-error, #f85149)', fontSize: 9.5 }}>
                        {!currentRevision ? 'workspace_revision_not_available' : 'stale_workspace_revision'}
                      </div>
                    )}
                    {m.candidate.state === 'APPLIED' && (
                      <div
                        role="status"
                        aria-live="polite"
                        data-testid="ai-candidate-featuretree-revision"
                        style={{ marginTop: 6, color: m.undoState === 'BLOCKED' ? 'var(--nx-error, #f85149)' : 'var(--nx-ok, #4ade80)', fontSize: 9.5 }}
                      >
                        {m.undoState === 'UNDONE'
                          ? `FeatureTree revision · RESTORED ${m.candidate.baseRevision.slice(0, 12)}`
                          : currentRevision && currentRevision !== m.candidate.baseRevision
                            ? `FeatureTree revision · CREATED ${m.candidate.baseRevision.slice(0, 8)} → ${currentRevision.slice(0, 8)}`
                            : 'FeatureTree revision · WORKING'}
                      </div>
                    )}
                    {(m.candidate.state === 'PREVIEW' || m.candidate.state === 'BLOCKED') && (
                      <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
                        <button type="button" data-testid="ai-candidate-apply" disabled={m.candidate.state !== 'PREVIEW' || candidateBusyId === m.id || !currentRevision || m.candidate.baseRevision !== currentRevision || m.candidate.requirementGate?.ready === false} onClick={() => void apply(m)} style={{ flex: 1, minHeight: 26, border: 0, borderRadius: 4, background: 'var(--nx-accent)', color: '#fff', fontSize: 9.5, fontWeight: 800, cursor: m.candidate.state === 'PREVIEW' && currentRevision === m.candidate.baseRevision && m.candidate.requirementGate?.ready !== false ? 'pointer' : 'not-allowed', opacity: m.candidate.state === 'PREVIEW' && currentRevision === m.candidate.baseRevision && m.candidate.requirementGate?.ready !== false ? 1 : .45 }}>
                          {loc(lang, { ko: '명시적 적용', en: 'Explicit Apply', ja: '明示的に適用', zh: '明确应用', es: 'Aplicación explícita', ar: 'تطبيق صريح' })}
                        </button>
                        <button type="button" data-testid="ai-candidate-discard" onClick={() => discard(m)} style={{ minHeight: 26, border: '1px solid var(--nx-border)', borderRadius: 4, background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)', fontSize: 9.5, cursor: 'pointer' }}>
                          {loc(lang, { ko: '폐기', en: 'Discard', ja: '破棄', zh: '丢弃', es: 'Descartar', ar: 'تجاهل' })}
                        </button>
                      </div>
                    )}
                    {m.candidate.state === 'APPLIED' && m.executionPath === 'local_deterministic' && m.localUndoAvailable && (
                      <button
                        type="button"
                        data-testid="ai-candidate-undo"
                        disabled={m.undoState === 'WORKING' || !currentRevision || currentRevision === m.candidate.baseRevision}
                        onClick={() => void undoLocalGuided(m)}
                        style={{ width: '100%', minHeight: 28, marginTop: 7, border: '1px solid var(--nx-border)', borderRadius: 4, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 9.5, fontWeight: 750, cursor: m.undoState === 'WORKING' || !currentRevision || currentRevision === m.candidate.baseRevision ? 'not-allowed' : 'pointer' }}
                      >
                        {m.undoState === 'WORKING' ? '…' : `↶ ${loc(lang, { ko: '이 적용 되돌리기', en: 'Undo this Apply', ja: 'この適用を元に戻す', zh: '撤销此次应用', es: 'Deshacer esta aplicación', ar: 'التراجع عن هذا التطبيق' })}`}
                      </button>
                    )}
                  </div>
                )}
                {m.candidateFeedback && <div role="status" style={{ marginTop: 6, fontSize: 9.5, color: 'var(--nx-text-2)' }}>{m.candidateFeedback}</div>}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div style={{ padding: '0 10px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => send(s)}
              style={{
                textAlign: 'left', padding: '6px 8px',
                border: '1px dashed var(--nx-border)', borderRadius: 4,
                background: 'transparent', color: 'var(--nx-text-2)',
                fontSize: 10, cursor: 'pointer', lineHeight: 1.4,
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={e => { e.preventDefault(); send(input); }}
        style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid var(--nx-border)', background: 'var(--nx-panel)' }}
      >
        <input
          id="nexy-ai-message"
          name="nexyAiMessage"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={loc(lang, { ko: 'AI 에게 요청…', en: 'Ask Nexy AI…', ja: 'Nexy AI に質問…', zh: '向 Nexy AI 提问…', es: 'Pregunta a Nexy AI…', ar: 'اسأل Nexy AI…' })}
          disabled={busy}
          aria-label={loc(lang, { ko: 'AI 메시지 입력', en: 'AI message input', ja: 'AI メッセージ入力', zh: 'AI 消息输入', es: 'Entrada de mensaje de IA', ar: 'إدخال رسالة الذكاء الاصطناعي' })}
          style={{
            flex: 1, height: 28, padding: '0 10px',
            borderRadius: 4, border: '1px solid var(--nx-border)',
            background: 'var(--nx-bg)', color: 'var(--nx-text)',
            fontSize: 12, outline: 'none',
          }}
        />
        <VoiceButton onTranscript={(text) => setInput(prev => prev ? `${prev} ${text}` : text)} disabled={busy} />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={loc(lang, { ko: '보내기', en: 'Send', ja: '送信', zh: '发送', es: 'Enviar', ar: 'إرسال' })}
          style={{
            padding: '0 12px', height: 28, border: 0, borderRadius: 4,
            background: busy ? 'var(--nx-text-3)' : 'var(--nx-accent)',
            color: '#fff', fontSize: 11, fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          <I.ai size={12} />
        </button>
      </form>
    </div>
  );
}

// ─── Voice input ─────────────────────────────────────────────────────────
// Web Speech API microphone capture → transcript → injected into the input.
// Locale follows the i18n setting so Korean speech is recognized as Korean.
// Silently hides on browsers without SpeechRecognition support.

function briefQuestionText(lang: string, brief: GuidedDesignBrief, assumptionBlocked: boolean): string {
  const next = brief.questions[0];
  if (!next) return '';
  const required = brief.plan.subplans.reduce((sum, subplan) => sum + getRequiredCount(brief, subplan.domain), 0);
  const missing = brief.plan.subplans.reduce((sum, subplan) => sum + subplan.missingInputs.length, 0);
  const prefix = assumptionBlocked
    ? loc(lang, {
        ko: '가정값은 기록했지만 정밀/릴리스 근거로 승격하지 않았습니다. 확인된 값을 답하거나 “개념으로 진행”이라고 입력하세요.',
        en: 'The assumption was recorded but was not promoted to exact/release evidence. Confirm a value or reply “continue as concept”.',
        ja: '仮定値は記録しましたが、精密・リリース根拠には昇格していません。確定値を回答するか「コンセプトで進む」と入力してください。',
        zh: '假设值已记录，但不会升级为精确/发布证据。请确认数值或回复“按概念继续”。',
        es: 'La suposición quedó registrada, pero no cuenta como evidencia exacta/de lanzamiento. Confirma un valor o responde «continuar como concepto».',
        ar: 'تم تسجيل الافتراض لكنه لا يُعد دليلاً دقيقاً أو دليلاً للإصدار. أكّد قيمة أو اطلب المتابعة كمفهوم.',
      })
    : loc(lang, {
        ko: '모델을 만들기 전에 설계 브리프를 확인합니다. 답변은 사용자 확인값으로 기록되며 AI가 임의로 바꾸지 않습니다.',
        en: 'Before creating the model, I will confirm the design brief. Your answer is recorded as a user-confirmed value and is not silently replaced by AI.',
        ja: 'モデル作成前に設計ブリーフを確認します。回答はユーザー確認値として記録され、AIが暗黙に置換しません。',
        zh: '创建模型前先确认设计简报。你的回答会记录为用户确认值，AI 不会悄悄替换。',
        es: 'Antes de crear el modelo, confirmaré el informe. Tu respuesta se registra como valor confirmado y la IA no la sustituirá silenciosamente.',
        ar: 'قبل إنشاء النموذج سيتم تأكيد موجز التصميم. تُسجل إجابتك كقيمة مؤكدة ولا يستبدلها الذكاء الاصطناعي بصمت.',
      });
  const status = loc(lang, {
    ko: `요청 수준: ${brief.requestedStage.toUpperCase()} · 확인 ${Math.max(0, required - missing)}/${required}`,
    en: `Requested level: ${brief.requestedStage.toUpperCase()} · confirmed ${Math.max(0, required - missing)}/${required}`,
    ja: `要求レベル: ${brief.requestedStage.toUpperCase()} · 確認 ${Math.max(0, required - missing)}/${required}`,
    zh: `请求级别：${brief.requestedStage.toUpperCase()} · 已确认 ${Math.max(0, required - missing)}/${required}`,
    es: `Nivel solicitado: ${brief.requestedStage.toUpperCase()} · confirmado ${Math.max(0, required - missing)}/${required}`,
    ar: `المستوى المطلوب: ${brief.requestedStage.toUpperCase()} · مؤكد ${Math.max(0, required - missing)}/${required}`,
  });
  const field = briefFieldLabel(lang, next.input.key, next.input.label);
  const question = loc(lang, {
    ko: `${field}을(를) 알려주세요. 모르면 “가정값으로 진행”이라고 답할 수 있지만 정밀/릴리스 검증에는 사용할 수 없습니다.`,
    en: `Please provide ${field}. If it is unknown, you may record an assumption, but it cannot be used as exact or release evidence.`,
    ja: `${field}を入力してください。不明な場合は仮定値を記録できますが、精密・リリース根拠には使用できません。`,
    zh: `请提供${field}。未知时可以记录假设，但不能作为精确或发布证据。`,
    es: `Indica ${field}. Si se desconoce, puede registrarse una suposición, pero no sirve como evidencia exacta ni de lanzamiento.`,
    ar: `يرجى تقديم ${field}. يمكن تسجيل افتراض عند عدم المعرفة، لكنه لا يصلح دليلاً دقيقاً أو دليلاً للإصدار.`,
  });
  return `${prefix}\n\n${status}\n${question}`;
}

const BRIEF_FIELDS_KO: Record<string, string> = {
  functional_requirements: '기능·인터페이스 요구사항', critical_dimensions: '핵심 치수와 공차', material_process: '재료와 제조 공정', loads_motion: '하중·동작·듀티 사이클',
  site_coordinate: '대지 좌표와 수직 기준', program_storeys: '공간 프로그램·층수·목표 면적', occupancy_egress: '용도·피난·접근성 기준', envelope_mep: '외피·MEP 조정 요구사항',
  crs_survey: '좌표계·데이텀·측량 기준점', existing_surface: '기존 지표면과 경계', design_criteria: '선형·배수 설계 기준', ground_staging: '지반·구조·시공 단계 입력',
  site_existing: '대지·지형·기존 조건', planting_soil: '식재 팔레트·성숙 크기·토양 조건', grading_drainage: '정지·배수 기준', water_maintenance: '급수·유지관리 전략',
  field_measurement: '현장 실측과 건축 호스트 리비전', space_users: '공간 용도·사용자·동선', furniture_finishes: '가구·마감·밀워크 사양', ceiling_mep_lighting: '천장·MEP·조명·음향 입력',
};

function briefFieldLabel(lang: string, key: string, fallback: string): string {
  return lang === 'ko' ? BRIEF_FIELDS_KO[key] ?? fallback : fallback;
}

function getRequiredCount(brief: GuidedDesignBrief, domain: GuidedDesignBrief['plan']['domains'][number]): number {
  const supplied = Object.keys(brief.inputs[domain] ?? {}).length;
  const missing = brief.plan.subplans.find(item => item.domain === domain)?.missingInputs.length ?? 0;
  return Math.max(supplied, supplied + missing);
}

interface SpeechRecognitionEvent extends Event {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}

function VoiceButton({ onTranscript, disabled }: {
  onTranscript: (text: string) => void;
  disabled: boolean;
}) {
  const lang = useLang();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  );

  if (!supported) return null;

  const start = () => {
    if (listening || disabled) return;
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = ({ ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA' } as const)[lang] ?? 'en-US';
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      const transcript = Array.from(e.results)
        .filter(x => x.isFinal)
        .map(x => x[0].transcript)
        .join(' ')
        .trim();
      if (transcript) onTranscript(transcript);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recRef.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  };
  const stop = () => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  };

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      disabled={disabled}
      aria-label={loc(lang, { ko: '음성 입력', en: 'Voice input', ja: '音声入力', zh: '语音输入', es: 'Entrada de voz', ar: 'الإدخال الصوتي' })}
      title={loc(lang, { ko: '음성 입력', en: 'Voice input', ja: '音声入力', zh: '语音输入', es: 'Entrada de voz', ar: 'الإدخال الصوتي' })}
      style={{
        padding: '0 10px', height: 28, border: 0, borderRadius: 4,
        background: listening ? 'var(--nx-error, #f85149)' : 'var(--nx-panel-2)',
        color: listening ? '#fff' : 'var(--nx-text-2)',
        fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {listening ? '⏺' : '🎤'}
    </button>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'var(--nx-text-2)',
        animation: 'nx-blink 1.2s infinite',
        animationDelay: `${delay}ms`,
        display: 'inline-block',
      }}
    />
  );
}
