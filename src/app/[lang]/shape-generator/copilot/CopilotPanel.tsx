'use client';
/**
 * CopilotPanel — AI CAD assistant chat panel
 *
 * Floating panel that lets the user type natural language commands
 * and see them immediately applied to the feature tree.
 * Shows command history with confidence badges and allows undo.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { parseCommand, dispatchCopilotCommand } from './cadCopilot';
import type { CopilotCommand, FeatureDispatcher } from './cadCopilot';

// ─── i18n ────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: 'CAD 코파일럿',
    placeholder: '자연어로 명령 입력… (예: "100×60×40 박스 추가", "top에 8mm 구멍")',
    send: '실행',
    history: '명령 기록',
    noHistory: '아직 실행된 명령 없음',
    confidence: '신뢰도',
    source: '엔진',
    rule: '규칙', llm: 'AI',
    error: '명령 실패',
    unclear: '명령을 이해하지 못했습니다.',
    hint: '💡 힌트',
    examples: '예시 명령',
    useLlm: 'AI 모드 (느림)',
    applied: '적용됨',
    failed: '실패',
    unknown: '알 수 없음',
  },
  en: {
    title: 'CAD Copilot',
    placeholder: 'Type a command… e.g. "add box 100×60×40", "drill 8mm hole on top"',
    send: 'Run',
    history: 'Command History',
    noHistory: 'No commands yet',
    confidence: 'Conf.',
    source: 'Engine',
    rule: 'Rule', llm: 'AI',
    error: 'Command failed',
    unclear: 'Could not understand that command.',
    hint: '💡 Tip',
    examples: 'Example Commands',
    useLlm: 'AI mode (slower)',
    applied: 'Applied',
    failed: 'Failed',
    unknown: 'Unknown',
  },
} as const;

type Lang = keyof typeof dict;

// ─── Example commands ─────────────────────────────────────────────────────────

const EXAMPLES = [
  'add box 100 × 60 × 40 mm',
  'add cylinder radius 25 height 80',
  'drill hole diameter 8 on top',
  'fillet all edges 3mm',
  'chamfer edge 2mm at 45°',
  'set width to 150',
  'mirror about XZ plane',
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface HistoryItem {
  cmd: CopilotCommand;
  status: 'applied' | 'failed' | 'unknown';
  timestamp: number;
}

// ─── Sub-component ────────────────────────────────────────────────────────────

function ConfBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 75 ? 'var(--nx-ok)' : pct >= 50 ? 'var(--nx-warn)' : 'var(--nx-error)';
  return (
    <span style={{
      background: `${color}22`, border: `1px solid ${color}44`,
      color, borderRadius: 4, fontSize: 9, fontWeight: 800,
      padding: '1px 5px',
    }}>{pct}%</span>
  );
}

function HistoryItemRow({ item, t }: { item: HistoryItem; t: (typeof dict)[Lang] }) {
  const statusColor = item.status === 'applied' ? 'var(--nx-ok)' : item.status === 'failed' ? 'var(--nx-error)' : 'var(--nx-warn)';
  const _statusLabel = item.status === 'applied' ? t.applied : item.status === 'failed' ? t.failed : t.unknown;

  return (
    <div style={{
      padding: '8px 10px', borderBottom: '1px solid var(--nx-panel-2)',
      display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, color: 'var(--nx-text)', fontWeight: 600, flex: 1 }}>
          {item.cmd.description}
        </span>
        <ConfBadge score={item.cmd.confidence} />
        <span style={{
          fontSize: 9, color: 'var(--nx-text-3)', background: 'var(--nx-panel)',
          border: '1px solid var(--nx-border)', borderRadius: 4, padding: '1px 4px',
        }}>
          {item.cmd.source === 'rule' ? t.rule : t.llm}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--nx-border-strong)', paddingLeft: 12, fontFamily: 'monospace' }}>
        {item.cmd.input}
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CopilotPanelProps {
  dispatcher: FeatureDispatcher;
  lang?: string;
  onClose?: () => void;
  visible?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CopilotPanel({
  dispatcher,
  lang = 'en',
  onClose,
  visible = true,
}: CopilotPanelProps) {
  const lk: Lang = lang === 'ko' || lang === 'kr' ? 'ko' : 'en';
  const t = dict[lk];

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [useLlm, setUseLlm] = useState(false);
  const [clarification, setClarification] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  const runCommand = useCallback(async (text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw) return;

    setLoading(true);
    setClarification(null);
    setInput('');

    try {
      const response = await parseCommand(raw, useLlm);
      const cmd = response.commands[0];

      let status: 'applied' | 'failed' | 'unknown' = 'unknown';
      if (cmd.type !== 'unknown') {
        try {
          const handled = dispatchCopilotCommand(cmd, dispatcher);
          status = handled ? 'applied' : 'failed';
        } catch {
          status = 'failed';
        }
      }

      setHistory(prev => [{
        cmd, status, timestamp: Date.now(),
      }, ...prev].slice(0, 30));

      if (response.clarification) setClarification(response.clarification);
    } catch {
      setClarification(t.error);
    } finally {
      setLoading(false);
    }
  }, [input, useLlm, dispatcher, t.error]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runCommand();
    }
  };

  if (!visible) return null;

  return (
    <div style={{
      background: 'var(--nx-bg)', border: '1px solid var(--nx-panel-2)', borderRadius: 14,
      width: 380, fontFamily: 'Inter, system-ui, sans-serif',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      display: 'flex', flexDirection: 'column',
      maxHeight: 560,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--nx-panel-2)',
        background: 'linear-gradient(135deg,rgba(88,166,255,0.08),rgba(63,185,80,0.06))',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 18 }}>🤖</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--nx-text)' }}>{t.title}</div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={useLlm} onChange={e => setUseLlm(e.target.checked)}
            style={{ accentColor: 'var(--nx-accent-2)', width: 12, height: 12 }} />
          <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{t.useLlm}</span>
        </label>
        {onClose && (
          <button onClick={onClose} style={{
            border: 'none', background: 'var(--nx-panel)', color: 'var(--nx-text-3)',
            width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 11,
          }}>✕</button>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--nx-panel-2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={2}
            placeholder={t.placeholder}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--nx-border)', background: 'var(--nx-panel)',
              color: 'var(--nx-text)', fontSize: 12, outline: 'none',
              resize: 'none', fontFamily: 'inherit',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--nx-accent)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--nx-border)'; }}
          />
          <button
            onClick={() => runCommand()}
            disabled={loading || !input.trim()}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none',
              background: loading || !input.trim() ? 'var(--nx-panel-2)' : 'var(--nx-accent)',
              color: loading || !input.trim() ? 'var(--nx-border-strong)' : 'var(--nx-text)',
              fontSize: 12, fontWeight: 700,
              cursor: loading || !input.trim() ? 'default' : 'pointer',
              transition: 'all 0.15s', alignSelf: 'stretch',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {loading ? (
              <span style={{
                width: 12, height: 12, border: '2px solid rgba(255,255,255,0.2)',
                borderTop: '2px solid #fff', borderRadius: '50%',
                display: 'inline-block', animation: 'cpSpin 0.8s linear infinite',
              }} />
            ) : t.send}
            <style>{`@keyframes cpSpin{to{transform:rotate(360deg)}}`}</style>
          </button>
        </div>

        {/* Clarification / hint */}
        {clarification && (
          <div style={{
            marginTop: 8, padding: '6px 10px', borderRadius: 6,
            background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)',
            fontSize: 11, color: 'var(--nx-error)',
          }}>
            {clarification}
          </div>
        )}

        {/* Examples toggle */}
        <button
          onClick={() => setShowExamples(v => !v)}
          style={{
            marginTop: 6, background: 'none', border: 'none',
            color: 'var(--nx-text-3)', fontSize: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 3, padding: 0,
          }}
        >
          {showExamples ? '▾' : '▸'} {t.examples}
        </button>
        {showExamples && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {EXAMPLES.map(ex => (
              <button key={ex} onClick={() => runCommand(ex)} style={{
                background: 'rgba(56,139,253,0.06)', border: '1px solid rgba(56,139,253,0.15)',
                borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                fontSize: 10, color: 'var(--nx-accent-2)', textAlign: 'left',
              }}>
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <div style={{ flex: 1, overflowY: 'auto' }} ref={historyRef}>
        <div style={{
          padding: '8px 16px 4px', fontSize: 10, fontWeight: 700,
          color: 'var(--nx-text-3)', textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {t.history}
        </div>
        {history.length === 0 ? (
          <div style={{ padding: '12px 16px', fontSize: 11, color: 'var(--nx-border-strong)', fontStyle: 'italic' }}>
            {t.noHistory}
          </div>
        ) : (
          history.map((item, i) => (
            <HistoryItemRow key={i} item={item} t={t} />
          ))
        )}
      </div>
    </div>
  );
}
