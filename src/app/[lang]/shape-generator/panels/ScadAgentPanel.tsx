'use client';

// B1 — SCAD coding agent chat panel.
//
// Streams /api/nexyfab/scad-agent SSE events into a thread view. Each user
// turn shows: model narration, tool call badges, tool result summaries.
// On `done`, the final SCAD source is handed back via `onResult` so the
// caller can render it in the main viewport.
//
// State is intentionally per-component (no zustand): the agent session is
// big and ephemeral. If the user closes the panel mid-run, AbortController
// kills the stream cleanly.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { streamScadAgent } from '@/lib/ai/scad-agent/sseClient';
import type { AgentEvent, AgentSession, ToolCall, ToolResult } from '@/lib/ai/scad-agent/types';
import { RichResult } from './ScadAgentRichResult';
import ScadAgentCheatsheet from './ScadAgentCheatsheet';
import ScadAgentSessionInspector from './ScadAgentSessionInspector';
import ScadAgentCheckpointTimeline from './ScadAgentCheckpointTimeline';
import ScadAgentTemplateGallery from './ScadAgentTemplateGallery';
import ScadAgentPresence from './ScadAgentPresence';
import ScadAgentAssemblyTree from './ScadAgentAssemblyTree';
import ScadAgentFeatureTree from './ScadAgentFeatureTree';
import BetaBanner from '@/components/nexyfab/BetaBanner';
import { useAnalysisStore } from '../store/analysisStore';
import type { SpecVerificationResult } from '@/lib/ai/scad-agent/specVerification';

const dict = {
  ko: {
    title: 'AI 에이전트 (OpenSCAD)',
    placeholder: '예) M8 볼트 머리에 직경 4mm 구멍 4개를 코너에 뚫어줘',
    send: '보내기',
    cancel: '중단',
    new: '새 세션',
    busy: '에이전트 작업 중…',
    wedgeTitle: 'AI가 막혔어요',
    wedgeBody: '3번 연속 렌더 실패로 자동 중단됐습니다. 더 구체적으로 다시 요청해보세요.',
    wedgeRestart: '새 세션',
    budgetTitle: '예산 한도',
    budgetBody: '이 세션의 토큰/턴 한도에 도달했습니다. 새 세션으로 다시 시도하세요.',
    networkErr: '네트워크 오류',
    emptyHint: '에이전트는 OpenSCAD 코드를 직접 작성하고 렌더 결과를 보고 자가 수정합니다.',
    runReady: '결과 캔버스 반영 준비됨',
    yourTurn: '응답 완료. 다음 요청을 보내세요.',
    statsTokens: '토큰',
    statsTurns: '턴',
    statsTools: '도구 호출',
    sourceLabel: '현재 SCAD 소스',
    sendToCanvas: '캔버스에 띄우기',
    copySource: '복사',
    copied: '복사됨',
  },
  en: {
    title: 'AI Agent (OpenSCAD)',
    placeholder: 'e.g. "Drill four 4mm holes in the corners of an M8 bolt head"',
    send: 'Send',
    cancel: 'Cancel',
    new: 'New session',
    busy: 'Agent working…',
    wedgeTitle: 'AI got stuck',
    wedgeBody: '3 consecutive render failures — auto-aborted. Try a more specific request.',
    wedgeRestart: 'New session',
    budgetTitle: 'Budget reached',
    budgetBody: 'This session hit the token/turn limit. Start a new session to continue.',
    networkErr: 'Network error',
    emptyHint: 'The agent writes OpenSCAD directly and self-corrects from render results.',
    runReady: 'Result ready to render',
    yourTurn: 'Done. Send your next request.',
    statsTokens: 'tokens',
    statsTurns: 'turns',
    statsTools: 'tool calls',
    sourceLabel: 'Current SCAD source',
    sendToCanvas: 'Show in canvas',
    copySource: 'Copy',
    copied: 'Copied',
  },
  ja: {
    title: 'AIエージェント (OpenSCAD)',
    placeholder: '例) M8ボルト頭部の四隅に直径4mmの穴をあけて',
    send: '送信',
    cancel: '中止',
    new: '新セッション',
    busy: 'エージェント処理中…',
    wedgeTitle: 'AIが停止しました',
    wedgeBody: 'レンダー失敗3回で自動中断。より具体的に再依頼してください。',
    wedgeRestart: '新セッション',
    budgetTitle: '予算上限',
    budgetBody: 'このセッションのトークン/ターン上限に達しました。新セッションで再開してください。',
    networkErr: 'ネットワークエラー',
    emptyHint: 'エージェントはOpenSCADを直接書き、レンダー結果から自己修正します。',
    runReady: 'キャンバスへ反映可能',
    yourTurn: '完了。次の依頼を送信してください。',
    statsTokens: 'トークン',
    statsTurns: 'ターン',
    statsTools: 'ツール呼出',
    sourceLabel: '現在のSCADソース',
    sendToCanvas: 'キャンバスに表示',
    copySource: 'コピー',
    copied: 'コピー済',
  },
  zh: {
    title: 'AI 智能体 (OpenSCAD)',
    placeholder: '例：M8 螺栓头四角钻 4mm 孔',
    send: '发送',
    cancel: '中止',
    new: '新会话',
    busy: '智能体处理中…',
    wedgeTitle: 'AI 卡住了',
    wedgeBody: '连续 3 次渲染失败 — 已自动中断。请更具体地重新请求。',
    wedgeRestart: '新会话',
    budgetTitle: '预算已用尽',
    budgetBody: '本会话已达令牌/回合上限。请开始新会话以继续。',
    networkErr: '网络错误',
    emptyHint: '智能体直接编写 OpenSCAD 并根据渲染结果自我修正。',
    runReady: '可渲染到画布',
    yourTurn: '完成。发送下一个请求。',
    statsTokens: '令牌',
    statsTurns: '回合',
    statsTools: '工具调用',
    sourceLabel: '当前 SCAD 源码',
    sendToCanvas: '显示在画布',
    copySource: '复制',
    copied: '已复制',
  },
  es: {
    title: 'Agente IA (OpenSCAD)',
    placeholder: 'p. ej. "Cuatro agujeros de 4mm en las esquinas de la cabeza de un perno M8"',
    send: 'Enviar',
    cancel: 'Cancelar',
    new: 'Nueva sesión',
    busy: 'Agente trabajando…',
    wedgeTitle: 'IA atascada',
    wedgeBody: '3 fallos de renderizado seguidos — auto-cancelado. Sé más específico.',
    wedgeRestart: 'Nueva sesión',
    budgetTitle: 'Presupuesto agotado',
    budgetBody: 'Esta sesión alcanzó el límite. Inicia una nueva para continuar.',
    networkErr: 'Error de red',
    emptyHint: 'El agente escribe OpenSCAD directamente y se autocorrige.',
    runReady: 'Listo para renderizar',
    yourTurn: 'Hecho. Envía tu siguiente solicitud.',
    statsTokens: 'tokens',
    statsTurns: 'turnos',
    statsTools: 'llamadas',
    sourceLabel: 'Fuente SCAD actual',
    sendToCanvas: 'Mostrar en lienzo',
    copySource: 'Copiar',
    copied: 'Copiado',
  },
  ar: {
    title: 'وكيل الذكاء الاصطناعي (OpenSCAD)',
    placeholder: 'مثال: اجعل أربعة ثقوب بقطر 4 مم في زوايا رأس مسمار M8',
    send: 'إرسال',
    cancel: 'إلغاء',
    new: 'جلسة جديدة',
    busy: 'الوكيل يعمل…',
    wedgeTitle: 'الذكاء الاصطناعي توقف',
    wedgeBody: 'فشل العرض 3 مرات متتالية — تم الإلغاء تلقائياً. حاول بطلب أكثر تحديداً.',
    wedgeRestart: 'جلسة جديدة',
    budgetTitle: 'تم استنفاد الميزانية',
    budgetBody: 'وصلت هذه الجلسة إلى الحد. ابدأ جلسة جديدة للمتابعة.',
    networkErr: 'خطأ في الشبكة',
    emptyHint: 'الوكيل يكتب OpenSCAD مباشرة ويصحح نفسه من نتائج العرض.',
    runReady: 'جاهز للعرض',
    yourTurn: 'تم. أرسل طلبك التالي.',
    statsTokens: 'رموز',
    statsTurns: 'جولات',
    statsTools: 'استدعاءات',
    sourceLabel: 'مصدر SCAD الحالي',
    sendToCanvas: 'عرض في اللوحة',
    copySource: 'نسخ',
    copied: 'تم النسخ',
  },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface ScadAgentPanelProps {
  lang: string;
  /** Fired when the agent produced a SCAD source the user wants to render in main viewport. */
  onApplyScad?: (scad: string) => void;
  /** W6 — Fired when the user clicks "Show in canvas" on a B-rep tool result.
   *  The host fetches /api/nexyfab/scad-agent/brep-mesh and renders it. */
  onShowBrepHandle?: (handle: string) => void | Promise<void>;
  /** UI variant — 'embedded' fits inside the AI sidebar; 'floating' is a standalone modal. */
  variant?: 'embedded' | 'floating';
}

interface ThreadEntry {
  kind: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  /** Tool call meta — used to render badges. */
  tool?: { name: string; ok: boolean; brief: string };
  /** C1 — code/diff preview body for write_scad / apply_diff / write_module
   *  so the user can verify what's about to be applied. Hidden by default;
   *  click the badge to expand. */
  preview?: { lang: 'scad' | 'diff' | 'json'; body: string } | null;
  /** W1 — full ToolResult for rich rendering (per-tool visualization). */
  result?: { ok: boolean; output: string; meta?: Record<string, unknown> } | null;
  /** Stable id for keying. */
  id: string;
}

let nextEntryId = 0;
const newId = () => `e_${Date.now().toString(36)}_${(++nextEntryId).toString(36)}`;

function summarizeToolResult(name: string, result: ToolResult): string {
  if (result.ok) {
    const out = result.output;
    return out.length > 140 ? out.slice(0, 137) + '…' : out;
  }
  return `${result.code ?? 'ERROR'}: ${result.error.length > 120 ? result.error.slice(0, 117) + '…' : result.error}`;
}

/** C1 — extract the code/diff body for inline preview (when the tool emits one). */
function extractPreview(name: string, args: Record<string, unknown>): { lang: 'scad' | 'diff' | 'json'; body: string } | null {
  if (name === 'write_scad' || name === 'write_module') {
    const code = typeof args.code === 'string' ? args.code : '';
    return code ? { lang: 'scad', body: code.length > 8000 ? code.slice(0, 8000) + '\n... (truncated)' : code } : null;
  }
  if (name === 'apply_diff') {
    const diff = typeof args.diff === 'string' ? args.diff : '';
    return diff ? { lang: 'diff', body: diff.length > 8000 ? diff.slice(0, 8000) + '\n... (truncated)' : diff } : null;
  }
  if (name === 'compose_assembly' || name === 'add_feature_intent') {
    return { lang: 'json', body: JSON.stringify(args, null, 2).slice(0, 8000) };
  }
  return null;
}

function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
  if (name === 'write_scad') {
    const code = typeof args.code === 'string' ? args.code : '';
    return `${code.length} bytes of SCAD`;
  }
  if (name === 'apply_diff') {
    const diff = typeof args.diff === 'string' ? args.diff : '';
    return `${diff.split('\n').length}-line diff`;
  }
  if (name === 'add_feature_intent') {
    const intent = (args.intent as Record<string, unknown> | undefined) ?? {};
    return `intent ${(intent.shapeId as string) ?? '?'}`;
  }
  if (name === 'search_bosl2') {
    return `query "${args.query as string}"`;
  }
  return '';
}

export default function ScadAgentPanel({ lang, onApplyScad, onShowBrepHandle, variant = 'embedded' }: ScadAgentPanelProps) {
  const t = dict[langMap[lang] ?? 'en'];

  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [error, setError] = useState<{ kind: 'wedge' | 'budget' | 'network'; message: string } | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  // Y1 — quick-reply chips offered by the agent's last ask_user call.
  // Cleared after the next user send so the chips don't linger after
  // the question is answered.
  const [pendingOptions, setPendingOptions] = useState<string[] | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  // Bridge SCAD agent verify_spec tool_results into the shared analysis
  // store so the OpenScadPanel's verify section can show the same result
  // without the user re-pasting the intent JSON.
  const setLatestVerifySpecResult = useAnalysisStore(s => s.setLatestVerifySpecResult);

  // W8 — stable per-tab user identity for the presence heartbeat.
  // Persists across React re-renders but resets on full page reload — that
  // matches "this browser tab is one viewer" semantics. Real auth user id
  // would be better; for now anon identity gives correct collab UX in
  // multi-tab demos and shared links.
  const presenceUserRef = useRef<{ id: string; label: string } | null>(null);
  if (!presenceUserRef.current) {
    const rand = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    presenceUserRef.current = { id: `tab-${rand}`, label: `User-${rand.slice(0, 4)}` };
  }

  // Auto-scroll to latest entry.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread.length]);

  // Cancel any pending stream when the panel unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const pushEntry = useCallback((entry: Omit<ThreadEntry, 'id'>) => {
    setThread(prev => [...prev, { ...entry, id: newId() }]);
  }, []);

  const handleSend = useCallback(async (overridePrompt?: string) => {
    const prompt = (overridePrompt ?? input).trim();
    if (!prompt || busy) return;
    if (!overridePrompt) setInput('');
    setError(null);
    // Y1 — sending always clears any pending quick-reply chips, since
    // the user's response has now been provided (whether via chip click
    // or freeform reply).
    setPendingOptions(null);

    pushEntry({ kind: 'user', text: prompt });

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    let assistantBuffer = '';
    let assistantId: string | null = null;
    // Track tool_call name by callId so we can recognise verify_spec
    // tool_result events and forward the meta payload to the shared
    // analysis store (consumed by OpenScadPanel's verify section).
    const callIdToName = new Map<string, string>();

    await streamScadAgent({
      userPrompt: prompt,
      session,
      signal: controller.signal,
      onEvent: (ev: AgentEvent) => {
        if (ev.type === 'model_response') {
          assistantBuffer = ev.text;
          assistantId = newId();
          setThread(prev => [
            ...prev,
            { id: assistantId!, kind: 'assistant', text: assistantBuffer || '...' },
          ]);
        } else if (ev.type === 'tool_call') {
          const call = ev.call as ToolCall;
          callIdToName.set(call.id, call.name);
          pushEntry({
            kind: 'tool',
            text: '',
            tool: { name: call.name, ok: true, brief: summarizeToolArgs(call.name, call.args) },
            preview: extractPreview(call.name, call.args),
          });
        } else if (ev.type === 'tool_result') {
          // Bridge verify_spec results to the analysis store so the
          // OpenScadPanel verify section picks them up. The agent's
          // verify_spec tool packs the whole SpecVerificationResult into
          // result.meta — reconstruct by spreading the named sub-fields.
          const toolName = callIdToName.get(ev.callId);
          if (toolName === 'verify_spec' && ev.result.ok && ev.result.meta) {
            const meta = ev.result.meta as Record<string, unknown>;
            const reconstructed: SpecVerificationResult = {
              ok: meta.passed === true,
              verifiable: meta.verifiable === true,
              mismatches: [],
              ...(meta.expected ? { expected: meta.expected as SpecVerificationResult['expected'] } : {}),
              ...(meta.measured ? { measured: meta.measured as SpecVerificationResult['measured'] } : {}),
              ...(meta.holeCount ? { holeCount: meta.holeCount as SpecVerificationResult['holeCount'] } : {}),
              ...(meta.volume ? { volume: meta.volume as SpecVerificationResult['volume'] } : {}),
              ...(meta.surfaceArea ? { surfaceArea: meta.surfaceArea as SpecVerificationResult['surfaceArea'] } : {}),
              ...(meta.holePositions ? { holePositions: meta.holePositions as SpecVerificationResult['holePositions'] } : {}),
              ...(meta.fillet ? { fillet: meta.fillet as SpecVerificationResult['fillet'] } : {}),
              ...(meta.chamfer ? { chamfer: meta.chamfer as SpecVerificationResult['chamfer'] } : {}),
              ...(meta.threads ? { threads: meta.threads as SpecVerificationResult['threads'] } : {}),
              ...(meta.wallThickness ? { wallThickness: meta.wallThickness as SpecVerificationResult['wallThickness'] } : {}),
              ...(meta.intentIssues ? { intentIssues: meta.intentIssues as SpecVerificationResult['intentIssues'] } : {}),
            };
            setLatestVerifySpecResult(reconstructed);
          }
          // Patch the most-recent matching tool entry with the result
          // outcome. We don't index by callId because the badge already
          // sits one step above in thread order — simpler to mutate last.
          setThread(prev => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].kind === 'tool' && next[i].tool && !next[i].tool!.brief.includes(' →')) {
                const old = next[i];
                next[i] = {
                  ...old,
                  tool: {
                    name: old.tool!.name,
                    ok: ev.result.ok,
                    brief: `${old.tool!.brief} → ${summarizeToolResult(old.tool!.name, ev.result)}`,
                  },
                  result: ev.result.ok
                    ? { ok: true, output: ev.result.output, meta: ev.result.meta }
                    : { ok: false, output: ev.result.error },
                };
                break;
              }
            }
            return next;
          });
        } else if (ev.type === 'wedge_detected') {
          setError({ kind: 'wedge', message: t.wedgeBody });
        } else if (ev.type === 'budget_warn') {
          // Soft warning — we don't surface UI for this yet, just log.
          console.info('[scad-agent] budget warning', ev.remainingPct);
        } else if (ev.type === 'done') {
          setSession(ev.session);
        } else if (ev.type === 'awaiting_user') {
          // Y1 — agent paused. Surface the question as a system message
          // so the thread visually anchors it; the user's next send
          // resumes the loop with their answer as the user prompt.
          setSession(ev.session);
          pushEntry({
            kind: 'system',
            text: `🤖 ${ev.question}${ev.options && ev.options.length > 0 ? `\n옵션: ${ev.options.join(' / ')}` : ''}`,
          });
          if (ev.options && ev.options.length > 0) {
            setPendingOptions(ev.options);
          }
        } else if (ev.type === 'error') {
          if (/budget/i.test(ev.message)) {
            setError({ kind: 'budget', message: t.budgetBody });
          } else if (/wedge/i.test(ev.message)) {
            setError({ kind: 'wedge', message: t.wedgeBody });
          } else {
            setError({ kind: 'network', message: ev.message });
          }
        }
      },
      onError: (err) => {
        setError({ kind: 'network', message: err.message });
        void import('@/lib/client-error-capture').then(m => m.captureClientError(err, {
          source: 'scad-agent',
          tags: { action: 'sse-stream' },
        }));
      },
    });

    setBusy(false);
    abortRef.current = null;
    void assistantBuffer;
    void assistantId;
  }, [input, busy, session, pushEntry, t]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    pushEntry({ kind: 'system', text: '— cancelled —' });
  }, [pushEntry]);

  const handleNewSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setSession(null);
    setThread([]);
    setError(null);
  }, []);

  const handleApply = useCallback(() => {
    if (!session?.scadSource) return;
    onApplyScad?.(session.scadSource);
  }, [session, onApplyScad]);

  const handleCopy = useCallback(async () => {
    if (!session?.scadSource) return;
    try {
      await navigator.clipboard.writeText(session.scadSource);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch { /* ignore */ }
  }, [session]);

  const containerStyle: React.CSSProperties = variant === 'floating'
    ? { position: 'fixed', top: 80, right: 16, width: 420, maxHeight: 'calc(100vh - 100px)', zIndex: 700 }
    : { width: '100%', height: '100%', minHeight: 360 };

  return (
    <div style={{
      ...containerStyle,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--nx-bg)',
      border: '1px solid var(--nx-border)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--nx-panel-2)',
        background: 'var(--nx-panel)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text)', flex: 1 }}>{t.title}</span>
        <ScadAgentTemplateGallery
          lang={lang}
          onPick={(p) => { void handleSend(p); }}
        />
        <ScadAgentPresence
          lang={lang}
          sessionId={session?.id ?? null}
          userId={presenceUserRef.current.id}
          userLabel={presenceUserRef.current.label}
        />
        <ScadAgentSessionInspector
          lang={lang}
          session={session}
          onRevertToCheckpoint={(idx) => { void handleSend(`revert to checkpoint #${idx}`); }}
        />
        <ScadAgentAssemblyTree
          lang={lang}
          session={session}
          onQuery={(p) => { setInput(p); }}
        />
        {/* Z1 — Parametric feature tree visualization (SolidWorks
            FeatureManager equivalent). Read-only in this mount —
            inline param edit + delete callbacks are a follow-up that
            will route through tree_set_param / tree_remove_node. */}
        {session?.featureTree && Object.keys(session.featureTree.nodes).length > 0 && (
          <ScadAgentFeatureTree
            lang={lang}
            tree={session.featureTree}
            onParamChange={(nodeId, key, newValue) => {
              // Routes through the agent so tree_set_param fires inside
              // the same session context (single source of truth — no
              // direct client-side mutation that would drift from server).
              const valueStr = typeof newValue === 'string'
                ? JSON.stringify(newValue)
                : String(newValue);
              void handleSend(`Call tree_set_param with nodeId=${nodeId} key=${key} value=${valueStr}`);
            }}
            onRemove={(nodeId) => {
              void handleSend(`Call tree_remove_node with nodeId=${nodeId}`);
            }}
          />
        )}
        <button onClick={handleNewSession}
          disabled={busy && !abortRef.current}
          style={btnSecondary}>
          {t.new}
        </button>
      </div>

      {/* Thread */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        fontSize: 12, color: 'var(--nx-text)',
      }}>
        <BetaBanner feature="scad_agent" lang={lang === 'ko' ? 'ko' : 'en'} />
        {thread.length === 0 && (
          <div style={{ color: 'var(--nx-text-3)', fontSize: 11, padding: '24px 8px', textAlign: 'center' }}>
            {t.emptyHint}
          </div>
        )}
        {thread.map((e) => (
          <ThreadRow key={e.id} entry={e} onShowBrepHandle={onShowBrepHandle} />
        ))}
        {busy && (
          <div style={{ color: 'var(--nx-accent-2)', fontSize: 11, fontStyle: 'italic' }}>
            ⟳ {t.busy}
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Stats + apply */}
      {session && (
        <div style={{
          padding: '6px 12px', fontSize: 10, color: 'var(--nx-text-2)',
          borderTop: '1px solid var(--nx-panel-2)',
          display: 'flex', gap: 12, alignItems: 'center',
        }}>
          <span>{t.statsTurns}: {session.budget.turnsUsed}/{session.budget.turnsCap}</span>
          <span>{t.statsTools}: {session.budget.toolCallsUsed}/{session.budget.toolCallsCap}</span>
          <span>{t.statsTokens}: {session.budget.tokensUsed.toLocaleString()}</span>
          <div style={{ flex: 1 }} />
          {session.scadSource && (
            <>
              <button onClick={handleCopy} style={btnGhost}>
                {copyState === 'copied' ? t.copied : t.copySource}
              </button>
              <button onClick={handleApply} style={btnPrimary} disabled={!onApplyScad}>
                {t.sendToCanvas}
              </button>
            </>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '8px 12px',
          background: error.kind === 'wedge' ? '#3d1519' : error.kind === 'budget' ? '#3d2c19' : 'var(--nx-panel)',
          color: error.kind === 'wedge' ? 'var(--nx-error)' : error.kind === 'budget' ? 'var(--nx-warn)' : 'var(--nx-text-2)',
          fontSize: 11, borderTop: '1px solid var(--nx-panel-2)',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <span style={{ fontWeight: 700 }}>
            {error.kind === 'wedge' ? t.wedgeTitle : error.kind === 'budget' ? t.budgetTitle : t.networkErr}:
          </span>
          <span style={{ flex: 1 }}>{error.message}</span>
          <button onClick={handleNewSession} style={btnGhost}>{t.wedgeRestart}</button>
        </div>
      )}

      {/* W2 — Cheatsheet right above input */}
      {session && session.checkpoints.length > 0 && (
        <ScadAgentCheckpointTimeline
          lang={lang}
          checkpoints={session.checkpoints}
          onRevert={(idx) => { void handleSend(`revert to checkpoint #${idx}`); }}
        />
      )}

      {/* Y1 — Quick-reply chips when the agent has paused on ask_user. */}
      {pendingOptions && pendingOptions.length > 0 && (
        <div style={{
          padding: '6px 10px',
          background: '#0a1f3d',
          borderTop: '1px solid #1f6feb',
          borderBottom: '1px solid #1f6feb',
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-accent-2)' }}>↳</span>
          {pendingOptions.map(opt => (
            <button
              key={opt}
              onClick={() => { void handleSend(opt); }}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                borderRadius: 12,
                border: '1px solid #1f6feb',
                background: 'transparent', color: 'var(--nx-accent-2)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-accent)'; e.currentTarget.style.color = 'var(--nx-text)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--nx-accent-2)'; }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: '6px 8px 0', background: 'var(--nx-panel)', borderTop: '1px solid var(--nx-panel-2)' }}>
        <ScadAgentCheatsheet lang={lang} onPick={(p) => setInput(p)} />
      </div>

      {/* Input */}
      <div style={{
        padding: 8, background: 'var(--nx-panel)',
        display: 'flex', gap: 6, alignItems: 'flex-end',
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t.placeholder}
          disabled={busy}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          style={{
            flex: 1, padding: 8,
            background: 'var(--nx-bg)',
            border: '1px solid var(--nx-border)',
            borderRadius: 6,
            color: 'var(--nx-text)', fontSize: 12, fontFamily: 'inherit',
            resize: 'none', outline: 'none',
          }}
        />
        {busy ? (
          <button onClick={handleCancel} style={btnDanger}>{t.cancel}</button>
        ) : (
          <button onClick={() => handleSend()} disabled={!input.trim()} style={btnPrimary}>
            {t.send}
          </button>
        )}
      </div>
    </div>
  );
}

function ThreadRow({ entry, onShowBrepHandle }: { entry: ThreadEntry; onShowBrepHandle?: (handle: string) => void | Promise<void> }) {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  if (entry.kind === 'tool' && entry.tool) {
    const ok = entry.tool.ok;
    const hasPreview = !!entry.preview;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-start', maxWidth: '100%' }}>
        <div
          onClick={hasPreview ? () => setPreviewOpen(o => !o) : undefined}
          style={{
            display: 'inline-flex', gap: 6, alignItems: 'center',
            padding: '4px 8px',
            borderRadius: 6,
            background: ok ? 'rgba(35, 134, 54, 0.12)' : 'rgba(248, 81, 73, 0.12)',
            border: `1px solid ${ok ? 'var(--nx-ok)' : 'var(--nx-error)'}`,
            color: ok ? 'var(--nx-ok)' : '#ffa198',
            fontSize: 11, fontFamily: 'monospace',
            cursor: hasPreview ? 'pointer' : 'default',
            userSelect: 'none',
          }}
          title={hasPreview ? 'Click to view code/diff' : undefined}
        >
          {hasPreview && (
            <span style={{ fontSize: 9, opacity: 0.8 }}>{previewOpen ? '▼' : '▶'}</span>
          )}
          <span style={{ fontWeight: 700 }}>{ok ? '✓' : '⚠'} {entry.tool.name}</span>
          <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.tool.brief}
          </span>
        </div>
        {hasPreview && previewOpen && entry.preview && (
          <pre style={{
            margin: 0,
            padding: '8px 10px',
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            background: 'var(--nx-bg)',
            border: '1px solid var(--nx-panel-2)',
            borderRadius: 6,
            color: entry.preview.lang === 'diff' ? 'var(--nx-text)' : 'var(--nx-ok)',
            maxHeight: 280,
            overflow: 'auto',
            whiteSpace: 'pre',
            wordBreak: 'normal',
          }}>
            {entry.preview.lang === 'diff'
              ? colorizeDiff(entry.preview.body)
              : entry.preview.body}
          </pre>
        )}
        {/* W1 — rich result card (rendered when result meta is available) */}
        {entry.result && entry.tool && (
          <RichResult
            toolName={entry.tool.name}
            output={entry.result.output}
            meta={entry.result.meta as Parameters<typeof RichResult>[0]['meta']}
            ok={entry.result.ok}
            onShowBrepHandle={onShowBrepHandle}
          />
        )}
      </div>
    );
  }
  if (entry.kind === 'system') {
    return (
      <div style={{ color: 'var(--nx-text-3)', fontSize: 10, fontStyle: 'italic', alignSelf: 'center' }}>
        {entry.text}
      </div>
    );
  }
  if (entry.kind === 'user') {
    return (
      <div style={{
        alignSelf: 'flex-end',
        padding: '6px 10px',
        background: 'var(--nx-accent)',
        color: 'var(--nx-text)',
        borderRadius: 10,
        fontSize: 12,
        maxWidth: '85%',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {entry.text}
      </div>
    );
  }
  // assistant
  return (
    <div style={{
      alignSelf: 'flex-start',
      padding: '6px 10px',
      background: 'var(--nx-panel-2)',
      color: 'var(--nx-text)',
      borderRadius: 10,
      fontSize: 12,
      maxWidth: '95%',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {entry.text}
    </div>
  );
}

/** C1 — color +/- lines in unified diff previews. Returns React fragments
 *  so adjacent lines colorize independently while still copy-pasting clean. */
function colorizeDiff(body: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let color = 'var(--nx-text)';
    if (line.startsWith('+') && !line.startsWith('+++')) color = 'var(--nx-ok)';
    else if (line.startsWith('-') && !line.startsWith('---')) color = '#ffa198';
    else if (line.startsWith('@@')) color = 'var(--nx-accent-2)';
    out.push(
      <span key={i} style={{ color }}>{line}{i < lines.length - 1 ? '\n' : ''}</span>,
    );
  }
  return out;
}

const btnPrimary: React.CSSProperties = {
  padding: '6px 12px', fontSize: 11, fontWeight: 700,
  borderRadius: 6, border: '1px solid #1f6feb',
  background: 'var(--nx-accent)', color: 'var(--nx-text)', cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  padding: '6px 12px', fontSize: 11, fontWeight: 700,
  borderRadius: 6, border: '1px solid var(--nx-error)',
  background: 'var(--nx-error)', color: 'var(--nx-text)', cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '4px 10px', fontSize: 10, fontWeight: 700,
  borderRadius: 6, border: '1px solid var(--nx-border)',
  background: 'transparent', color: 'var(--nx-text-2)', cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '3px 8px', fontSize: 10,
  borderRadius: 4, border: '1px solid var(--nx-border)',
  background: 'transparent', color: 'var(--nx-text-2)', cursor: 'pointer',
};
