'use client';

/**
 * QuoteNegotiatorPanel — Phase 8-1 (customer-side).
 *
 * Mounted inside the existing QuoteCompareModal. Shows:
 *   - AI-ranked quote table (best price / fastest / balanced tags)
 *   - Recommendation banner
 *   - Per-supplier negotiation email drafts the user can copy or review
 */

import { useState } from 'react';
import { negotiateQuotes, type QuoteInput, type RfqContext, type NegotiatorResult, type NegotiationDraft } from './quoteNegotiator';

const C = {
  bg: '#0d1117',
  surface: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  textDim: '#8b949e',
  textMuted: '#6e7681',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#8b5cf6',
  gold: '#f0883e',
};

const TAG_META: Record<string, { label: string; labelKo: string; color: string }> = {
  best_price: { label: 'BEST PRICE', labelKo: '최저가', color: C.green },
  fastest:    { label: 'FASTEST',    labelKo: '최단납기', color: C.accent },
  balanced:   { label: 'BALANCED',   labelKo: '균형',    color: C.purple },
  expensive:  { label: 'HIGH',       labelKo: '고가',    color: C.yellow },
};

interface Props {
  rfq: RfqContext;
  quotes: QuoteInput[];
  isKo: boolean;
  onClose: () => void;
}

function CopyButton({ text, isKo }: { text: string; isKo: boolean }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handle}
      style={{
        padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
        border: `1px solid ${copied ? C.green : C.border}`,
        background: copied ? `${C.green}18` : 'transparent',
        color: copied ? C.green : C.textMuted, cursor: 'pointer',
      }}
    >
      {copied ? (isKo ? '복사됨 ✓' : 'Copied ✓') : (isKo ? '복사' : 'Copy')}
    </button>
  );
}

function NegotiationCard({ draft, isKo }: { draft: NegotiationDraft; isKo: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [toEmail, setToEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<'ok' | 'error' | null>(null);
  const subject = isKo ? draft.subjectKo : draft.subject;
  const body = isKo ? draft.bodyKo : draft.body;
  const asks = isKo ? draft.asksKo : draft.asks;

  async function handleSend() {
    if (!toEmail.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/nexyfab/send-negotiation-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ to: toEmail.trim(), subject, body }),
      });
      setSendResult(res.ok ? 'ok' : 'error');
    } catch {
      setSendResult('error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{
      background: C.card, borderRadius: 10, border: `1px solid ${C.border}`,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', color: C.text,
        }}
      >
        <span style={{ fontSize: 16 }}>✉️</span>
        <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 700 }}>
          {draft.supplierName}
        </span>
        <span style={{ fontSize: 10, color: C.textMuted }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
              {isKo ? '제목' : 'Subject'}
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: C.surface, borderRadius: 6, padding: '6px 10px',
            }}>
              <span style={{ flex: 1, fontSize: 12, color: C.text }}>{subject}</span>
              <CopyButton text={subject} isKo={isKo} />
            </div>
          </div>

          <div>
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
              {isKo ? '협상 포인트' : 'Negotiation Asks'}
            </p>
            <ul style={{ margin: 0, padding: '0 0 0 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {asks.map((a, i) => (
                <li key={i} style={{ fontSize: 12, color: C.textDim }}>{a}</li>
              ))}
            </ul>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                {isKo ? '이메일 본문' : 'Email Body'}
              </p>
              <CopyButton text={`${subject}\n\n${body}`} isKo={isKo} />
            </div>
            <pre style={{
              margin: 0, background: C.surface, borderRadius: 6, padding: '10px 12px',
              fontSize: 11, color: C.textDim, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontFamily: 'system-ui, sans-serif', lineHeight: 1.6,
              maxHeight: 200, overflowY: 'auto',
            }}>
              {body}
            </pre>
          </div>

          {/* 실제 발송 영역 */}
          {!sendOpen ? (
            <button
              onClick={() => setSendOpen(true)}
              style={{
                alignSelf: 'flex-start', padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                border: `1px solid ${C.accent}`, background: `${C.accent}12`, color: C.accent, cursor: 'pointer',
              }}
            >
              {isKo ? '📤 실제 발송' : '📤 Send Email'}
            </button>
          ) : (
            <div style={{ background: C.surface, borderRadius: 8, padding: '10px 12px', border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                {isKo ? '수신자 이메일 주소' : 'Recipient Email'}
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="email"
                  value={toEmail}
                  onChange={e => setToEmail(e.target.value)}
                  placeholder="supplier@example.com"
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 12,
                    background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none',
                  }}
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={sending || !toEmail.trim()}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 800,
                    border: 'none', background: sending ? `${C.accent}66` : C.accent,
                    color: '#fff', cursor: sending || !toEmail.trim() ? 'default' : 'pointer',
                    opacity: !toEmail.trim() ? 0.5 : 1,
                  }}
                >
                  {sending ? '...' : (isKo ? '발송' : 'Send')}
                </button>
                <button
                  onClick={() => { setSendOpen(false); setSendResult(null); }}
                  style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, cursor: 'pointer' }}
                >
                  {isKo ? '취소' : 'Cancel'}
                </button>
              </div>
              {sendResult === 'ok' && (
                <p style={{ margin: 0, fontSize: 11, color: C.green }}>✅ {isKo ? '이메일이 발송되었습니다.' : 'Email sent successfully.'}</p>
              )}
              {sendResult === 'error' && (
                <p style={{ margin: 0, fontSize: 11, color: C.red }}>❌ {isKo ? '발송 실패. Pro 플랜 또는 SMTP 설정이 필요합니다.' : 'Send failed. Pro plan or SMTP config required.'}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function QuoteNegotiatorPanel({ rfq, quotes, isKo, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NegotiatorResult | null>(null);
  const [goal, setGoal] = useState<'price' | 'leadtime' | 'both'>('both');
  const [negotiateWith, setNegotiateWith] = useState<string[]>([]);

  const allSelected = negotiateWith.length === 0;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await negotiateQuotes({
        rfq,
        quotes,
        goal,
        negotiateWith: negotiateWith.length ? negotiateWith : undefined,
        lang: isKo ? 'ko' : 'en',
      });
      setResult(r);
    } catch (e) {
      const err = e as Error & { requiresPro?: boolean };
      setError(err.requiresPro ? (isKo ? 'Pro 플랜으로 업그레이드해주세요.' : 'Upgrade to Pro.') : (err.message || 'Error'));
    } finally {
      setLoading(false);
    }
  }

  const toggleTarget = (id: string) => {
    setNegotiateWith(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
        width: '100%', maxWidth: 620, maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(135deg, #1e2430, #1a1f2e)',
        }}>
          <span style={{ fontSize: 18 }}>⚖️</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>
              {isKo ? 'AI 견적 비교 · 협상 어시스턴트' : 'AI Quote Comparison · Negotiation'}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>{rfq.projectName}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Config */}
          {!result && (
            <>
              <div>
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                  {isKo ? '협상 목표' : 'Negotiation Goal'}
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['price', 'leadtime', 'both'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setGoal(g)}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 700,
                        border: `1px solid ${goal === g ? C.accent : C.border}`,
                        background: goal === g ? `${C.accent}20` : 'transparent',
                        color: goal === g ? C.accent : C.textMuted, cursor: 'pointer',
                      }}
                    >
                      {g === 'price' ? (isKo ? '💰 가격' : '💰 Price') :
                       g === 'leadtime' ? (isKo ? '⏱ 납기' : '⏱ Lead Time') :
                       (isKo ? '⚖️ 둘 다' : '⚖️ Both')}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                  {isKo ? '협상 대상 (선택 안 하면 전체)' : 'Negotiate with (blank = all)'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {quotes.map(q => (
                    <button
                      key={q.id}
                      onClick={() => toggleTarget(q.id)}
                      style={{
                        padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        border: `1px solid ${negotiateWith.includes(q.id) ? C.gold : C.border}`,
                        background: negotiateWith.includes(q.id) ? `${C.gold}18` : 'transparent',
                        color: negotiateWith.includes(q.id) ? C.gold : C.textMuted, cursor: 'pointer',
                      }}
                    >
                      {q.factoryName}
                    </button>
                  ))}
                </div>
                {allSelected && (
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: C.textMuted }}>
                    {isKo ? '* 전체 공급사에 대한 협상 초안이 생성됩니다.' : '* Drafts will be generated for all non-best suppliers.'}
                  </p>
                )}
              </div>
            </>
          )}

          {error && (
            <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}

          {result && (
            <>
              {/* Summary banner */}
              <div style={{ background: `${C.accent}12`, border: `1px solid ${C.accent}30`, borderRadius: 8, padding: '10px 14px' }}>
                <p style={{ margin: 0, fontSize: 12, color: C.accent, lineHeight: 1.5 }}>
                  {isKo ? result.recommendationKo : result.recommendation}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 10, color: C.textMuted }}>
                  {isKo ? result.summaryKo : result.summary}
                </p>
              </div>

              {/* Ranked table */}
              <div>
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                  {isKo ? '순위' : 'Ranking'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {result.ranked.map((r, i) => {
                    const tagMeta = r.tag ? TAG_META[r.tag] : null;
                    return (
                      <div key={r.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: C.card, borderRadius: 8, padding: '8px 12px',
                        border: `1px solid ${i === 0 ? C.accent + '55' : C.border}`,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: C.textMuted, minWidth: 18 }}>#{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: C.text }}>{r.factoryName}</span>
                        {tagMeta && (
                          <span style={{
                            fontSize: 9, padding: '2px 6px', borderRadius: 10,
                            background: `${tagMeta.color}20`, color: tagMeta.color, fontWeight: 800,
                          }}>
                            {isKo ? tagMeta.labelKo : tagMeta.label}
                          </span>
                        )}
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                          {r.estimatedAmount.toLocaleString()}원
                        </span>
                        {r.estimatedDays && (
                          <span style={{ fontSize: 11, color: C.textMuted }}>⏱{r.estimatedDays}d</span>
                        )}
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          color: r.score >= 80 ? C.green : r.score >= 60 ? C.yellow : C.red,
                        }}>
                          {r.score}pt
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Negotiation drafts */}
              {result.negotiations.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                    {isKo ? '협상 이메일 초안' : 'Negotiation Drafts'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {result.negotiations.map(draft => (
                      <NegotiationCard key={draft.supplierId} draft={draft} isKo={isKo} />
                    ))}
                  </div>
                </div>
              )}

              {result.negotiations.length === 0 && (
                <div style={{ textAlign: 'center', padding: '12px 0', color: C.textMuted, fontSize: 12 }}>
                  {isKo ? '최저가가 이미 선택됨 — 추가 협상 불필요.' : 'Best price already selected — no negotiation needed.'}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 18px', display: 'flex', gap: 8 }}>
          {!result ? (
            <button
              onClick={run}
              disabled={loading}
              style={{
                flex: 1, padding: '10px', borderRadius: 8, border: 'none',
                background: loading ? '#388bfd66' : 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                color: '#fff', fontSize: 13, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
              }}
            >
              {loading ? (isKo ? '분석 중...' : 'Analysing...') : (isKo ? '⚖️ AI 분석 시작' : '⚖️ Run AI Analysis')}
            </button>
          ) : (
            <button
              onClick={() => setResult(null)}
              style={{
                flex: 1, padding: '10px', borderRadius: 8,
                border: `1px solid ${C.border}`, background: 'transparent',
                color: C.textDim, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {isKo ? '🔄 다시 분석' : '🔄 Re-run'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '10px 18px', borderRadius: 8,
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {isKo ? '닫기' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
