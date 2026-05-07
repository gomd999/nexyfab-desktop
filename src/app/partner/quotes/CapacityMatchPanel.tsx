'use client';

import { useState } from 'react';
import { matchCapacity, type PartnerProfile, type OpenRfqInput, type CapacityMatchResult, type MatchedRfq } from './capacityMatch';

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d', border: '#30363d',
  text: '#e6edf3', textDim: '#8b949e', textMuted: '#6e7681',
  accent: '#388bfd', green: '#3fb950', yellow: '#d29922', red: '#f85149',
  purple: '#8b5cf6', teal: '#2dd4bf',
};

const URGENCY_COLOR: Record<string, string> = { high: C.red, medium: C.yellow, low: C.green };

interface Quote {
  id: string;
  rfqId?: string;
  projectName: string;
  estimatedAmount: number;
  dfmScore?: number | null;
  dfmProcess?: string | null;
  validUntil?: string;
}

interface Props {
  quotes: Quote[];
  company?: string;
  onClose: () => void;
}

const PROCESS_OPTIONS = ['CNC Milling', 'CNC Turning', 'Injection Molding', '3D Printing', 'Sheet Metal', 'Die Casting', 'Laser Cutting', 'Welding', 'Forging', 'EDM'];

function won(n: number | null) {
  if (n == null) return '—';
  return n.toLocaleString('ko-KR') + '원';
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? C.green : score >= 45 ? C.yellow : C.red;
  return (
    <div style={{
      width: 42, height: 42, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `${color}20`, border: `2px solid ${color}`, fontSize: 12, fontWeight: 800, color,
    }}>
      {score}
    </div>
  );
}

function PitchCard({ match, isKo }: { match: MatchedRfq; isKo: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'subject' | 'body' | null>(null);
  const subject = isKo ? match.pitchSubjectKo : match.pitchSubject;
  const body = isKo ? match.pitchBodyKo : match.pitchBody;

  function copy(type: 'subject' | 'body', text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      {/* Summary row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <ScoreBadge score={match.matchScore} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{match.projectName}</p>
          <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>RFQ: {match.rfqId.slice(0, 8)}</p>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 8,
          background: `${URGENCY_COLOR[match.urgency]}20`, color: URGENCY_COLOR[match.urgency],
        }}>
          {match.urgencyKo}
        </span>
        {match.estimatedMarginKrw != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>
            +{won(match.estimatedMarginKrw)}
          </span>
        )}
        <span style={{ color: C.textMuted, fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${C.border}` }}>
          {/* Match reasons */}
          <div style={{ marginTop: 10, marginBottom: 10 }}>
            <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
              {isKo ? '매칭 이유' : 'Match Reasons'}
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {(isKo ? match.matchReasonsKo : match.matchReasons).map((r, i) => (
                <li key={i} style={{ fontSize: 11, color: C.textDim, display: 'flex', gap: 6 }}>
                  <span style={{ color: C.accent }}>·</span>{r}
                </li>
              ))}
            </ul>
          </div>

          {/* Pitch email */}
          <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
            {isKo ? '자동 제안 이메일' : 'Auto-Pitch Email'}
          </p>
          <div style={{ background: C.bg, borderRadius: 7, padding: '8px 10px', border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.textDim, fontWeight: 600 }}>{subject}</span>
              <button
                onClick={() => copy('subject', subject)}
                style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: copied === 'subject' ? C.green : C.textMuted, cursor: 'pointer' }}
              >
                {copied === 'subject' ? '✓' : isKo ? '복사' : 'Copy'}
              </button>
            </div>
            <pre style={{ margin: 0, fontSize: 10, color: C.textDim, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'inherit' }}>
              {body}
            </pre>
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <button
                onClick={() => copy('body', body)}
                style={{ fontSize: 9, padding: '3px 10px', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: copied === 'body' ? C.green : C.textMuted, cursor: 'pointer' }}
              >
                {copied === 'body' ? '✓ 복사됨' : isKo ? '본문 복사' : 'Copy Body'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CapacityMatchPanel({ quotes, company, onClose }: Props) {
  const isKo = true;

  const [processes, setProcesses] = useState<string[]>([]);
  const [customProcess, setCustomProcess] = useState('');
  const [certs, setCerts] = useState('');
  const [idleDays, setIdleDays] = useState(7);
  const [hourlyRate, setHourlyRate] = useState('');
  const [leadDays, setLeadDays] = useState(14);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CapacityMatchResult | null>(null);

  function toggleProcess(p: string) {
    setProcesses(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  }

  async function run() {
    const allProcesses = [...processes, ...(customProcess.trim() ? [customProcess.trim()] : [])];
    if (allProcesses.length === 0) {
      setError('하나 이상의 공정을 선택해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const partner: PartnerProfile = {
        processes: allProcesses,
        certifications: certs.split(',').map(c => c.trim()).filter(Boolean),
        idleWindowDays: idleDays,
        hourlyRateKrw: hourlyRate ? Number(hourlyRate) : undefined,
        leadCapacityDays: leadDays,
        company,
      };

      const openRfqs: OpenRfqInput[] = quotes.map(q => ({
        rfqId: q.rfqId ?? q.id,
        projectName: q.projectName,
        process: q.dfmProcess ?? undefined,
        dfmScore: q.dfmScore ?? null,
        budgetKrw: q.estimatedAmount,
        deadlineDate: q.validUntil,
      }));

      const r = await matchCapacity({ partner, openRfqs, lang: 'ko' });
      setResult(r);
    } catch (e) {
      const err = e as Error & { requiresPro?: boolean };
      setError(err.requiresPro ? 'Pro 플랜이 필요합니다.' : (err.message || '오류가 발생했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, width: '100%', maxWidth: 660, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg, #1a2535, #1a2030)' }}>
          <span style={{ fontSize: 18 }}>🔗</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>캐파 매칭</p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>유휴 캐파를 오픈 RFQ와 매칭하고 자동 제안 이메일을 생성합니다.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!result && (
            <>
              {/* Process chips */}
              <div>
                <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.textDim }}>보유 공정 (복수 선택)</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PROCESS_OPTIONS.map(p => (
                    <button
                      key={p}
                      onClick={() => toggleProcess(p)}
                      style={{
                        padding: '5px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${processes.includes(p) ? C.teal : C.border}`,
                        background: processes.includes(p) ? `${C.teal}20` : 'transparent',
                        color: processes.includes(p) ? C.teal : C.textMuted,
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={customProcess}
                  onChange={e => setCustomProcess(e.target.value)}
                  placeholder="기타 공정 직접 입력..."
                  style={{ marginTop: 8, width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box', background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}
                />
              </div>

              {/* Capacity params */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <p style={{ margin: '0 0 5px', fontSize: 11, fontWeight: 700, color: C.textDim }}>유휴 기간 (일)</p>
                  <input
                    type="number"
                    value={idleDays}
                    onChange={e => setIdleDays(Number(e.target.value))}
                    min={1}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box', background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}
                  />
                </div>
                <div>
                  <p style={{ margin: '0 0 5px', fontSize: 11, fontWeight: 700, color: C.textDim }}>납품 가능 기간 (일)</p>
                  <input
                    type="number"
                    value={leadDays}
                    onChange={e => setLeadDays(Number(e.target.value))}
                    min={1}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box', background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}
                  />
                </div>
                <div>
                  <p style={{ margin: '0 0 5px', fontSize: 11, fontWeight: 700, color: C.textDim }}>시간당 단가 (원, 선택)</p>
                  <input
                    type="number"
                    value={hourlyRate}
                    onChange={e => setHourlyRate(e.target.value)}
                    min={0}
                    placeholder="예: 80000"
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box', background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}
                  />
                </div>
                <div>
                  <p style={{ margin: '0 0 5px', fontSize: 11, fontWeight: 700, color: C.textDim }}>보유 인증 (쉼표 구분)</p>
                  <input
                    type="text"
                    value={certs}
                    onChange={e => setCerts(e.target.value)}
                    placeholder="ISO 9001, IATF 16949..."
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box', background: C.card, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}
                  />
                </div>
              </div>

              {quotes.length === 0 && (
                <div style={{ background: `${C.yellow}12`, border: `1px solid ${C.yellow}30`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.yellow }}>
                  현재 배정된 RFQ가 없습니다. RFQ가 배정되면 캐파 매칭을 활용하세요.
                </div>
              )}
            </>
          )}

          {error && (
            <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}

          {result && (
            <>
              {/* Summary */}
              <div style={{ background: C.card, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
                {result.summaryKo}
              </div>

              {result.matches.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: C.textMuted, fontSize: 13 }}>
                  매칭 결과가 없습니다.
                </div>
              ) : (
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                    매칭된 RFQ ({result.totalMatched}건) — 클릭하여 제안 이메일 확인
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {result.matches.map(m => (
                      <PitchCard key={m.rfqId} match={m} isKo={isKo} />
                    ))}
                  </div>
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
              disabled={loading || quotes.length === 0}
              title={quotes.length === 0 ? '배정된 RFQ가 없어 매칭을 실행할 수 없습니다.' : undefined}
              style={{
                flex: 1, padding: 10, borderRadius: 8, border: 'none',
                background: loading || quotes.length === 0 ? `${C.teal}44` : `linear-gradient(135deg, #0d9488, ${C.teal})`,
                color: '#fff', fontSize: 13, fontWeight: 800,
                cursor: loading || quotes.length === 0 ? 'not-allowed' : 'pointer',
                opacity: quotes.length === 0 ? 0.5 : 1,
              }}
            >
              {loading ? '분석 중...' : quotes.length === 0 ? '🔗 RFQ 없음' : '🔗 캐파 매칭 실행'}
            </button>
          ) : (
            <button
              onClick={() => setResult(null)}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              🔄 다시 매칭
            </button>
          )}
          <button
            onClick={onClose}
            style={{ padding: '10px 18px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
