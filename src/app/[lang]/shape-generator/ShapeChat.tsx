'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/components/ToastProvider';
import type { FeatureType } from './features/types';
import type { SketchProfile, SketchConfig } from './sketch/types';
import type { Face } from './topology/optimizer/types';

/* ─── Data types ─────────────────────────────────────────────────────────── */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BomPart {
  name: string;
  description: string;
  shapeId: string;
  params: Record<string, number>;
  features: Array<{ type: FeatureType; params: Record<string, number> }>;
  quantity: number;
  suggestedMaterial: string;
  suggestedProcess: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

interface SingleResult {
  mode: 'single';
  shapeId: string | null;
  params: Record<string, number>;
  features: Array<{ type: FeatureType; params: Record<string, number> }>;
  message: string;
  error?: string;
}

interface BomResult {
  mode: 'bom';
  productName: string;
  parts: BomPart[];
  message: string;
  error?: string;
}

export interface SketchResult {
  mode: 'sketch';
  profile: SketchProfile;
  config: Partial<SketchConfig>;
  message: string;
  error?: string;
}

export interface OptimizeResult {
  mode: 'optimize';
  dimX: number;
  dimY: number;
  dimZ: number;
  materialKey: string;
  fixedFaces: Face[];
  loads: Array<{ face: Face; force: [number, number, number] }>;
  volfrac: number;
  resolution?: 'low' | 'medium' | 'high';
  message: string;
  error?: string;
}

export interface ModifyResult {
  mode: 'modify';
  actions: Array<{
    type: 'param' | 'feature';
    key?: string;
    value?: number;
    featureType?: FeatureType;
    params?: Record<string, number>;
    description: string;
  }>;
  message: string;
  error?: string;
}

type ChatResult = SingleResult | BomResult | SketchResult | OptimizeResult | ModifyResult;

/* ─── Props ──────────────────────────────────────────────────────────────── */

/** Current design state passed to AI for context-aware responses */
export interface DesignContext {
  /** Current shape or null if blank sketch */
  shapeId: string | null;
  /** Current shape params */
  params: Record<string, number>;
  /** Applied features */
  features: Array<{ type: FeatureType; params: Record<string, number> }>;
  /** Whether in sketch mode */
  isSketchMode: boolean;
  /** Whether a sketch result (3D) exists */
  hasSketchResult: boolean;
  /** Current bounding box if geometry exists */
  bbox: { w: number; h: number; d: number } | null;
  /** Volume in cm³ */
  volume_cm3: number | null;
  /** Best DFM manufacturability score (0-100), null if not yet analyzed */
  dfmScore: number | null;
  /** Top DFM issues for AI context (max 5) */
  dfmIssues: Array<{ type: string; severity: string; description: string }> | null;
  // ── Phase C: multimodal context ──
  /** FEA max Von Mises stress (MPa), null if FEA not run */
  feaMaxStressMPa: number | null;
  /** FEA safety factor (yield / maxStress), null if FEA not run */
  feaSafetyFactor: number | null;
  /** Estimated mass in grams (volume × material density), null if no geometry */
  massG: number | null;
  /** Cheapest process unit cost estimate in USD, null if no geometry */
  estimatedUnitCostUSD: number | null;
}

interface ShapeChatProps {
  onApplySingle: (result: SingleResult) => void;
  onApplyBom: (parts: BomPart[], productName?: string) => void;
  onBomPreview?: (parts: BomPart[], productName: string) => void;
  onApplySketch?: (profile: SketchProfile, config: Partial<SketchConfig>) => void;
  onApplyOptimize?: (result: OptimizeResult) => void;
  onApplyModify?: (result: ModifyResult) => void;
  /** Called after a modify result is auto-applied — provides action count for undo toast */
  onModifyAutoApplied?: (actionCount: number) => void;
  /** Preview callback — show transparent preview before applying */
  onPreview?: (result: ChatResult) => void;
  /** Cancel preview callback */
  onCancelPreview?: () => void;
  activeTab?: 'design' | 'optimize';
  t: Record<string, string>;
  /** If provided, auto-sends this message on mount (from gallery chat bar) */
  initialMessage?: string;
  /** Current design state for context-aware AI */
  designContext?: DesignContext;
  /** Pre-populated message history (from cloud restore) */
  initialMessages?: ChatMessage[];
  /** Called whenever messages change (for persistence) */
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

/* ─── Icons ──────────────────────────────────────────────────────────────── */

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔩', pipe: '🔧', lBracket: '📐',
  flange: '⚙️', plateBend: '🔨', gear: '⚙️', fanBlade: '🌀',
  sprocket: '🔗', pulley: '🎡',
};

const MODE_BADGES: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  single: { icon: '🧊', label: 'Part', color: '#58a6ff', bg: '#1a2332' },
  bom: { icon: '📋', label: 'BOM', color: '#39d2e0', bg: '#0d2a2e' },
  sketch: { icon: '✏️', label: 'Sketch', color: '#bc8cff', bg: '#1e1533' },
  optimize: { icon: '🔬', label: 'Optimize', color: '#3fb950', bg: '#0d2818' },
  modify: { icon: '🔧', label: 'Modify', color: '#d29922', bg: '#2a1f0a' },
};

/* ─── Animated typing dots ────────────────────────────────────────────────── */

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ animation: 'nf-dot 1.2s infinite 0s', display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#8b949e' }} />
      <span style={{ animation: 'nf-dot 1.2s infinite 0.2s', display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#8b949e' }} />
      <span style={{ animation: 'nf-dot 1.2s infinite 0.4s', display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#8b949e' }} />
    </span>
  );
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function ShapeChat({
  onApplySingle, onApplyBom, onBomPreview,
  onApplySketch, onApplyOptimize, onApplyModify, onModifyAutoApplied,
  onPreview, onCancelPreview,
  activeTab = 'design', t, initialMessage, designContext,
  initialMessages, onMessagesChange,
}: ShapeChatProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages ?? []);
  const [loading, setLoading] = useState(false);
  const onMessagesChangeRef = useRef(onMessagesChange);
  useEffect(() => { onMessagesChangeRef.current = onMessagesChange; }, [onMessagesChange]);

  // initialMessages가 바뀌면(프로젝트 로드) 히스토리 교체
  const initialMessagesRef = useRef(initialMessages);
  useEffect(() => {
    if (initialMessages && initialMessages !== initialMessagesRef.current) {
      initialMessagesRef.current = initialMessages;
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  // messages 변경 시 콜백 (최대 60개 유지)
  const updateMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages(prev => {
      const next = updater(prev).slice(-60);
      onMessagesChangeRef.current?.(next);
      return next;
    });
  }, []);
  const [streamingText, setStreamingText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [bomResult, setBomResult] = useState<BomResult | null>(null);
  const [lastMode, setLastMode] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<ChatResult | null>(null);
  const [lastShapeId, setLastShapeId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialSent = useRef(false);

  /* ── Keep lastShapeId in sync with designContext ── */
  useEffect(() => {
    if (designContext?.shapeId) setLastShapeId(designContext.shapeId);
  }, [designContext?.shapeId]);

  /* ── Quick-prompt chips based on selected shape ── */
  const quickChips = [
    { key: 'aiSuggestion1', fallback: '더 크게 만들어' },
    { key: 'aiSuggestion2', fallback: '구멍 추가해줘' },
    { key: 'aiSuggestion3', fallback: '둥글게 다듬어줘' },
    { key: 'aiSuggestion4', fallback: '최적화해줘' },
  ];

  /** Parse a streaming SSE/NDJSON response and return full message text */
  const readStream = useCallback(async (res: Response): Promise<string> => {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let accumulated = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // SSE lines: "data: {...}\n"
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            const delta = obj.choices?.[0]?.delta?.content ?? '';
            accumulated += delta;
            setStreamingText(accumulated);
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } catch {
      // Stream disconnected mid-response
      if (accumulated) {
        toast('error', 'AI 응답이 중간에 끊겼습니다. 다시 시도해주세요.');
      }
    }
    return accumulated;
  }, [toast]);

  /** Parse the full JSON response text into a ChatResult */
  const parseResult = useCallback((raw: string): ChatResult => {
    let jsonStr = raw;
    jsonStr = jsonStr.replace(/```json?\s*/g, '').replace(/```/g, '');
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonStr.trim());
    // Basic validation: must be a non-null object
    if (typeof parsed !== 'object' || parsed === null) {
      throw new SyntaxError('AI response is not a valid object');
    }
    return parsed as ChatResult;
  }, []);

  /** Core send function — can be called programmatically */
  const sendMessage = useCallback(async (text: string, history: ChatMessage[]) => {
    setExpanded(true);
    setBomResult(null);
    setLastMode(null);
    setErrorMsg(null);
    setLastFailedText(null);
    setStreamingText('');
    const userMsg: ChatMessage = { role: 'user', content: text };
    // Keep only last 6 messages (3 user + 3 assistant) for context
    const trimmedHistory = history.slice(-6);
    updateMessages(prev => [...prev, userMsg]);
    setLoading(true);

    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);

    try {
      const res = await fetch('/api/shape-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: trimmedHistory, context: designContext || null }),
      });

      if (!res.ok) {
        const statusMsg = res.status === 429 ? 'Rate limit exceeded / 요청 한도 초과'
          : res.status >= 500 ? 'Server error / 서버 오류'
          : res.status === 401 ? 'Authentication required / 인증 필요'
          : `HTTP ${res.status}`;
        throw new Error(statusMsg);
      }

      let data: ChatResult;

      // Check if the response is a stream (SSE) or plain JSON
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        const rawText = await readStream(res);
        setStreamingText('');
        try {
          data = parseResult(rawText);
        } catch {
          const assistantMsg: ChatMessage = { role: 'assistant', content: rawText };
          updateMessages(prev => [...prev, assistantMsg]);
          setLoading(false);
          return;
        }
      } else {
        data = await res.json();
      }

      setStreamingText('');
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.message || (data as unknown as Record<string, unknown>).error as string || 'No response',
      };
      updateMessages(prev => [...prev, assistantMsg]);
      setLastMode(data.mode);

      // Track last shape for multi-turn context banner
      if (data.mode === 'single' && (data as SingleResult).shapeId) {
        setLastShapeId((data as SingleResult).shapeId);
      }

      if (data.mode === 'bom' && (data as BomResult).parts?.length > 0) {
        const bomData = data as BomResult;
        setBomResult(bomData);
        if (onBomPreview) onBomPreview(bomData.parts, bomData.productName);
      } else if (data.mode === 'modify' && onApplyModify && !data.error) {
        // Auto-apply modify immediately — no confirm needed, undo via Ctrl+Z
        onApplyModify(data as ModifyResult);
        onModifyAutoApplied?.((data as ModifyResult).actions.length);
      } else if (!data.error) {
        setPendingResult(data);
        onPreview?.(data);
      }

      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 100);

    } catch (err) {
      setStreamingText('');
      let msg = 'AI 연결 실패 / Error connecting to AI';
      if (err instanceof TypeError && err.message.includes('fetch')) {
        msg = '네트워크 연결을 확인해주세요 / Check your network connection';
      } else if (err instanceof SyntaxError) {
        msg = 'AI 응답 파싱 오류 / AI response parse error';
      } else if (err instanceof Error && err.message.includes('timeout')) {
        msg = '요청 시간 초과 / Request timed out';
      } else if (err instanceof Error && err.message) {
        msg = err.message;
      }
      setErrorMsg(msg);
      setLastFailedText(text);
      updateMessages(prev => [...prev, { role: 'assistant', content: msg }]);
      toast('error', 'AI 응답에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, [onApplySingle, onApplySketch, onApplyOptimize, onApplyModify, onModifyAutoApplied, onBomPreview, designContext, readStream, parseResult, toast]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    await sendMessage(text, messages);
  }, [input, loading, messages, sendMessage]);

  // Auto-send initial message from gallery
  React.useEffect(() => {
    if (initialMessage && !initialSent.current) {
      initialSent.current = true;
      sendMessage(initialMessage, []);
    }
  }, [initialMessage, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /** Retry last failed request */
  const handleRetry = useCallback(() => {
    if (!lastFailedText) return;
    const text = lastFailedText;
    setErrorMsg(null);
    setLastFailedText(null);
    // Remove the last assistant error message before retrying
    updateMessages(prev => {
      const copy = [...prev];
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') copy.pop();
      return copy;
    });
    sendMessage(text, messages.slice(0, -1));
  }, [lastFailedText, messages, sendMessage]);

  // ── Preview Apply / Cancel ──
  const handleApplyPreview = useCallback(() => {
    if (!pendingResult) return;
    if (pendingResult.mode === 'single' && (pendingResult as SingleResult).shapeId) {
      onApplySingle(pendingResult as SingleResult);
    } else if (pendingResult.mode === 'sketch' && (pendingResult as SketchResult).profile) {
      onApplySketch?.((pendingResult as SketchResult).profile, (pendingResult as SketchResult).config || {});
    } else if (pendingResult.mode === 'optimize') {
      onApplyOptimize?.(pendingResult as OptimizeResult);
    } else if (pendingResult.mode === 'modify') {
      onApplyModify?.(pendingResult as ModifyResult);
    }
    setPendingResult(null);
  }, [pendingResult, onApplySingle, onApplySketch, onApplyOptimize, onApplyModify]);

  const handleCancelPreview = useCallback(() => {
    setPendingResult(null);
    onCancelPreview?.();
  }, [onCancelPreview]);

  const handleAddAllToCart = useCallback(() => {
    if (!bomResult) return;
    onApplyBom(bomResult.parts, bomResult.productName);
    setBomResult(null);
  }, [bomResult, onApplyBom]);

  const handleApplyPart = useCallback((part: BomPart) => {
    onApplySingle({
      mode: 'single',
      shapeId: part.shapeId,
      params: part.params,
      features: part.features,
      message: part.name,
    });
  }, [onApplySingle]);

  const handleExampleClick = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  // Context-aware examples based on active tab and design state
  const isBlank = designContext?.shapeId === null && designContext?.isSketchMode;
  const hasShape = !!designContext?.shapeId || designContext?.hasSketchResult;

  const blankExamples = [
    { text: 'M6 볼트홀 4개 있는 마운팅 플레이트', icon: '📦' },
    { text: 'I-빔 단면 300mm 돌출', icon: '✏️' },
    { text: '꽃병 프로파일 회전체', icon: '🏺' },
    { text: '탁상 선풍기 조립체', icon: '🌀' },
    { text: '기어 모듈3 치수20', icon: '⚙️' },
    { text: '알루미늄 브라켓 경량화 설계', icon: '🔬' },
  ];

  const modifyExamples = [
    { text: '모서리 둥글게 R3 필렛', icon: '🔧' },
    { text: '중앙에 Ø10 관통홀 추가', icon: '🕳️' },
    { text: '두께를 절반으로 줄여줘', icon: '📐' },
    { text: '볼트홀 4개 원형 패턴', icon: '🔩' },
    { text: '사각 슬롯 추가 (boolean)', icon: '📦' },
    { text: '가볍게 만들어줘 (shell)', icon: '⚡' },
  ];

  const designExamples = [
    { text: t.chatExample1 || '직경 50mm, 높이 100mm 실린더', icon: '🔩' },
    { text: t.chatExample2 || '100x60x30 박스에 관통홀', icon: '📦' },
    { text: '별 모양 단면 20mm 돌출', icon: '✏️' },
    { text: '박스에 원형 홈 파기 (boolean)', icon: '🔧' },
    { text: t.chatExample4 || '선풍기 만들어줘', icon: '🌀' },
    { text: '꽃병 프로파일 회전체', icon: '🏺' },
  ];

  const optimizeExamples = [
    { text: '알루미늄 200x100x200 빔 최적화', icon: '🔬' },
    { text: '바닥 고정, 위에 1000N 하중', icon: '📐' },
    { text: '체적 30%로 경량화 해줘', icon: '⚡' },
    { text: '티타늄 브라켓 위상 최적화', icon: '🏗️' },
  ];

  const examples = activeTab === 'optimize'
    ? optimizeExamples
    : isBlank
      ? blankExamples
      : hasShape
        ? modifyExamples
        : designExamples;

  // Multi-turn: show "Continuing from: [shape]" banner when user follows up with a shape in context
  const showContinuingBanner = messages.length > 0 && !loading && lastShapeId && hasShape;

  return (
    <div style={{
      background: '#161b22', borderRadius: 16, border: '1px solid #30363d',
      overflow: 'hidden',
      maxWidth: 800, margin: '0 auto 24px',
    }}>
      {/* Chat messages */}
      {expanded && messages.length > 0 && (
        <div ref={scrollRef} style={{
          maxHeight: 260, overflowY: 'auto', padding: '12px 16px',
          display: 'flex', flexDirection: 'column', gap: 8,
          borderBottom: '1px solid #30363d',
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 6 }}>
              {msg.role === 'assistant' && <span style={{ fontSize: 16, marginTop: 4, flexShrink: 0 }}>🤖</span>}
              <div style={{
                maxWidth: '85%', padding: '8px 14px', borderRadius: 14,
                fontSize: 13, lineHeight: 1.6,
                background: msg.role === 'user' ? '#388bfd' : '#21262d',
                color: msg.role === 'user' ? '#fff' : '#c9d1d9',
                borderBottomRightRadius: msg.role === 'user' ? 4 : 14,
                borderBottomLeftRadius: msg.role === 'assistant' ? 4 : 14,
              }}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Streaming token display */}
          {loading && streamingText && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6 }}>
              <span style={{ fontSize: 16, marginTop: 4, flexShrink: 0 }}>🤖</span>
              <div style={{
                maxWidth: '85%', padding: '8px 14px', borderRadius: 14,
                fontSize: 13, lineHeight: 1.6,
                background: '#21262d', color: '#c9d1d9',
                borderBottomLeftRadius: 4,
              }}>
                {streamingText}
                <span style={{ display: 'inline-block', width: 2, height: 13, background: '#58a6ff', marginLeft: 3, animation: 'nf-blink 0.8s step-end infinite', verticalAlign: 'text-bottom' }} />
              </div>
            </div>
          )}

          {/* Preview Apply/Cancel card */}
          {!loading && pendingResult && MODE_BADGES[pendingResult.mode] && (
            <div style={{
              margin: '4px 0', padding: '10px 14px', borderRadius: 12,
              background: '#21262d',
              border: '2px solid #388bfd', position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: MODE_BADGES[pendingResult.mode].bg, color: MODE_BADGES[pendingResult.mode].color,
                }}>
                  {MODE_BADGES[pendingResult.mode].icon} {MODE_BADGES[pendingResult.mode].label}
                </span>
                <span style={{ fontSize: 11, color: '#58a6ff', fontWeight: 700 }}>
                  {t.aiPreviewReady || '미리보기 준비됨 — 뷰포트에서 확인하세요'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleApplyPreview} style={{
                  flex: 1, padding: '9px 0', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                  color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(22,163,74,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  ✓ {t.aiPreviewApply || '적용'}
                </button>
                <button onClick={handleCancelPreview} style={{
                  padding: '9px 20px', borderRadius: 10,
                  border: '1px solid #30363d', background: '#0d1117',
                  color: '#ef4444', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}>
                  ✕ {t.aiPreviewCancel || '취소'}
                </button>
              </div>
            </div>
          )}

          {/* Error card with Retry button */}
          {!loading && errorMsg && (
            <div style={{
              margin: '4px 0', padding: '10px 14px', borderRadius: 12,
              background: '#2a1515', border: '1px solid #6e2424',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ fontSize: 12, color: '#f87171' }}>⚠️ {errorMsg}</span>
              {lastFailedText && (
                <button onClick={handleRetry} style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none',
                  background: '#388bfd', color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', flexShrink: 0,
                }}>
                  ↺ {t.aiRetry || '다시 시도'}
                </button>
              )}
            </div>
          )}

          {/* Mode badge (only when no pending preview and no error) */}
          {!loading && !pendingResult && !errorMsg && lastMode && MODE_BADGES[lastMode] && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', paddingLeft: 28 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: MODE_BADGES[lastMode].bg, color: MODE_BADGES[lastMode].color,
              }}>
                {MODE_BADGES[lastMode].icon} {MODE_BADGES[lastMode].label} applied
              </span>
            </div>
          )}

          {/* Typing indicator (no streaming text yet) */}
          {loading && !streamingText && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6 }}>
              <span style={{ fontSize: 16, marginTop: 4 }}>🤖</span>
              <div style={{ padding: '10px 14px', borderRadius: 14, background: '#21262d', fontSize: 13, color: '#8b949e', borderBottomLeftRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{t.aiTyping || 'AI가 입력 중'}</span>
                <TypingDots />
              </div>
            </div>
          )}
        </div>
      )}

      {/* BOM Result Card */}
      {bomResult && bomResult.parts.length > 0 && (
        <div style={{ padding: '16px', borderBottom: '1px solid #30363d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>📋</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#c9d1d9' }}>
                {bomResult.productName} BOM
              </div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>
                {bomResult.parts.length}{t.bomParts || '개 부품으로 분해'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {bomResult.parts.map((part, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 12,
                background: '#0d1117', border: '1px solid #30363d',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
                onClick={() => handleApplyPart(part)}
                onMouseEnter={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.borderColor = '#58a6ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0d1117'; e.currentTarget.style.borderColor = '#30363d'; }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', background: '#388bfd',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>{idx + 1}</div>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{SHAPE_ICONS[part.shapeId] || '🧊'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9' }}>
                    {part.name}
                    {part.quantity > 1 && <span style={{ fontSize: 11, color: '#58a6ff', marginLeft: 6 }}>×{part.quantity}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#8b949e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {part.description}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap' }}>
                  {part.suggestedMaterial && (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: '#1a2332', color: '#58a6ff' }}>{part.suggestedMaterial}</span>
                  )}
                  {part.suggestedProcess && (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: '#0d2818', color: '#3fb950' }}>{part.suggestedProcess}</span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: '#58a6ff', flexShrink: 0 }}>→</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAddAllToCart}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #388bfd 0%, #58a6ff 100%)',
                color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(56,139,253,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              🛒 {t.bomAddAll || '전체 장바구니에 담기'} ({bomResult.parts.reduce((s, p) => s + (p.quantity || 1), 0)}{t.cartPcs || '개'})
            </button>
            <button
              onClick={() => setBomResult(null)}
              style={{
                padding: '11px 16px', borderRadius: 12,
                border: '1px solid #30363d', background: '#0d1117',
                color: '#8b949e', fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}
            >✕</button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div style={{ padding: '12px 16px' }}>
        {/* Multi-turn context banner */}
        {showContinuingBanner && (
          <div style={{
            fontSize: 11, color: '#8b949e', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#21262d', borderRadius: 8, padding: '5px 10px',
          }}>
            <span style={{ color: '#58a6ff', fontWeight: 700 }}>
              {t.aiContinuing || '이어서:'}
            </span>
            <span style={{ color: '#c9d1d9', fontWeight: 600 }}>
              {SHAPE_ICONS[lastShapeId!] || '🧊'} {lastShapeId}
            </span>
          </div>
        )}

        {/* Contextual hint */}
        {messages.length > 0 && !loading && !showContinuingBanner && (
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>Try:</span>
            {activeTab === 'design' ? (
              hasShape ? (
                <>
                  <span style={{ color: '#58a6ff' }}>"모서리 R2 필렛"</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#d29922' }}>"홀 추가"</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#bc8cff' }}>"50% 크기로"</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#3fb950' }}>"shell로 가볍게"</span>
                </>
              ) : (
                <>
                  <span style={{ color: '#58a6ff' }}>"브라켓 설계"</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#bc8cff' }}>"별 모양 스케치"</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#39d2e0' }}>"선풍기 조립체"</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#3fb950' }}>"꽃병 회전체"</span>
                </>
              )
            ) : (
              <>
                <span style={{ color: '#3fb950' }}>"왼쪽 고정, 오른쪽에 하중"</span>
                <span style={{ color: '#484f58' }}>·</span>
                <span style={{ color: '#3fb950' }}>"체적 20%로 줄여줘"</span>
              </>
            )}
          </div>
        )}

        {/* Example chips (shown before first message) */}
        {messages.length === 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {examples.map((ex, i) => (
              <button key={i} onClick={() => handleExampleClick(ex.text)} style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: '1px solid #30363d', background: '#21262d', color: '#8b949e',
                cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
                onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <span style={{ fontSize: 13 }}>{ex.icon}</span> {ex.text}
              </button>
            ))}
          </div>
        )}

        {/* Quick-prompt chips (shown after first message, when shape is loaded) */}
        {messages.length > 0 && !loading && hasShape && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {quickChips.map((chip, i) => (
              <button key={i} onClick={() => handleExampleClick(t[chip.key] || chip.fallback)} style={{
                padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 600,
                border: '1px solid #30363d', background: '#21262d', color: '#8b949e',
                cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = '#388bfd22'; e.currentTarget.style.borderColor = '#388bfd'; e.currentTarget.style.color = '#58a6ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
              >
                {t[chip.key] || chip.fallback}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>🤖</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeTab === 'optimize'
              ? (t.chatPlaceholderOpt || '"알루미늄 빔 최적화" 또는 "바닥 고정, 위에 하중"')
              : isBlank
                ? '만들고 싶은 부품을 설명하세요... (예: "브라켓", "기어", "I-빔")'
                : hasShape
                  ? '현재 형상을 수정하세요... (예: "구멍 추가", "모서리 둥글게", "더 크게")'
                  : (t.chatPlaceholder || '"선풍기 만들어줘" 또는 "직경 50mm 실린더"')
            }
            disabled={loading}
            style={{
              flex: 1, padding: '11px 16px', borderRadius: 12,
              border: '2px solid #30363d', fontSize: 14, outline: 'none',
              color: '#c9d1d9',
              background: loading ? '#161b22' : '#0d1117',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(56,139,253,0.15)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.boxShadow = 'none'; }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            style={{
              padding: '11px 18px', borderRadius: 12, border: 'none',
              background: input.trim() && !loading
                ? '#388bfd'
                : '#30363d',
              color: '#fff', fontWeight: 700, fontSize: 16,
              cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s', flexShrink: 0,
              boxShadow: input.trim() && !loading ? '0 2px 8px rgba(56,139,253,0.3)' : 'none',
            }}
          >↑</button>
        </div>

        {/* Capability bar */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {Object.entries(MODE_BADGES).map(([key, badge]) => (
            <span key={key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
              background: badge.bg, color: badge.color, opacity: 0.7,
            }}>
              {badge.icon} {badge.label}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes nf-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes nf-dot { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }
        @keyframes nf-blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  );
}
