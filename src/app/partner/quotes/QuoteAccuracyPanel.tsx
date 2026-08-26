'use client';

import { useEffect, useState } from 'react';
import { analyzeQuoteAccuracy, type QuoteEntry, type QuoteAccuracyResult, type ProcessBias, type AccuracySuggestion } from './quoteAccuracy';
import { usePartnerLang, type PartnerLang } from '../_lib/partnerLang';
import { quotePanelsDict, type QuotePanelsDict } from '../_lib/dicts/quotePanels';

/** 입력 폼용 — draftAmount가 아직 미입력일 수 있어 null 허용 */
interface InputEntry {
  process?: string;
  draftAmount: number | null;
  acceptedAmount?: number | null;
  actualCost?: number | null;
}

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d', border: '#30363d',
  text: '#e6edf3', textDim: '#8b949e', textMuted: '#6e7681',
  accent: '#388bfd', green: '#3fb950', yellow: '#d29922', red: '#f85149',
  purple: '#8b5cf6', orange: '#f97316',
};

interface Props {
  onClose: () => void;
  /** 파트너 세션 토큰 — 있으면 수락된 견적을 DB에서 자동 로드 */
  session?: string;
  /** 분석 완료 시 전체 보정 편향% 전달 (양수 = 과대견적, 음수 = 과소견적) */
  onResult?: (overallBiasPercent: number) => void;
}

const EMPTY_ENTRY = (): InputEntry => ({
  process: '',
  draftAmount: null,
  acceptedAmount: null,
  actualCost: null,
});

function AccuracyGauge({ score, t }: { score: number; t: QuotePanelsDict }) {
  const color = score >= 75 ? C.green : score >= 50 ? C.yellow : C.red;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%', margin: '0 auto 6px',
        background: `conic-gradient(${color} ${score * 3.6}deg, #30363d 0deg)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%', background: C.surface,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 900, color,
        }}>
          {score}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 10, color: C.textMuted }}>{t.qaAccuracyLabel}</p>
    </div>
  );
}

function BiasBadge({ bias, t }: { bias: number; t: QuotePanelsDict }) {
  const color = Math.abs(bias) < 5 ? C.green : Math.abs(bias) < 15 ? C.yellow : C.red;
  const label = bias > 0 ? t.qaBiasOver(bias) : bias < 0 ? t.qaBiasUnder(bias) : t.qaBiasExact;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{bias > 0 ? '+' : ''}{bias}%</div>
      <p style={{ margin: '2px 0 0', fontSize: 10, color: C.textMuted }}>{label}</p>
    </div>
  );
}

function ProcessBiasRow({ pb, t, lang }: { pb: ProcessBias; t: QuotePanelsDict; lang: PartnerLang }) {
  const color = Math.abs(pb.biasPercent) < 5 ? C.green : Math.abs(pb.biasPercent) < 15 ? C.yellow : C.red;
  const barW = Math.min(100, Math.abs(pb.biasPercent) * 2);
  return (
    <div style={{ background: C.card, borderRadius: 9, padding: '10px 12px', border: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{pb.process}</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: C.textMuted }}>{t.qaSampleSuffix(pb.sampleCount)}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color }}>
            {pb.biasPercent > 0 ? '+' : ''}{pb.biasPercent}%
          </span>
          <span style={{ fontSize: 10, color: C.textMuted }}>{t.qaAccuracyShort(pb.avgAccuracy)}</span>
        </div>
      </div>
      {/* Bias bar */}
      <div style={{ height: 5, background: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 5 }}>
        <div style={{ height: '100%', width: `${barW}%`, background: color, borderRadius: 3, marginLeft: pb.biasPercent < 0 ? `${100 - barW}%` : 0 }} />
      </div>
      <p style={{ margin: 0, fontSize: 11, color: C.textDim }}>{lang === 'ko' ? pb.recommendationKo : pb.recommendation}</p>
    </div>
  );
}

function SuggestionCard({ s, lang }: { s: AccuracySuggestion; lang: PartnerLang }) {
  const color = s.adjustmentPercent > 0 ? C.green : s.adjustmentPercent < 0 ? C.red : C.textMuted;
  return (
    <div style={{ background: C.card, borderRadius: 9, padding: '10px 12px', border: `1px solid ${C.border}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        minWidth: 42, height: 42, borderRadius: 8, background: `${color}20`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 900, color,
      }}>
        {s.adjustmentPercent > 0 ? '+' : ''}{s.adjustmentPercent !== 0 ? `${s.adjustmentPercent}%` : '💡'}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ margin: '0 0 3px', fontSize: 12, fontWeight: 700, color: C.text }}>{lang === 'ko' ? s.titleKo : s.title}</p>
        <p style={{ margin: 0, fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>{lang === 'ko' ? s.detailKo : s.detail}</p>
      </div>
    </div>
  );
}

export default function QuoteAccuracyPanel({ onClose, session, onResult }: Props) {
  const lang = usePartnerLang();
  const t = quotePanelsDict(lang);
  const [entries, setEntries] = useState<InputEntry[]>([EMPTY_ENTRY()]);
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteAccuracyResult | null>(null);

  useEffect(() => {
    if (!session || session === 'demo') return;
    setAutoLoading(true);
    fetch('/api/partner/quotes?status=accepted&limit=50', {
      headers: { Authorization: `Bearer ${session}` },
      cache: 'no-store',
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { quotes?: Array<{ projectName?: string; dfmProcess?: string; estimatedAmount?: number; partnerResponse?: { estimatedAmount?: number } }> } | null) => {
        if (!data?.quotes?.length) return;
        const loaded: InputEntry[] = data.quotes.map(q => ({
          process: q.dfmProcess ?? '',
          draftAmount: q.estimatedAmount ?? null,
          acceptedAmount: q.partnerResponse?.estimatedAmount ?? null,
          actualCost: null,
        }));
        setEntries(loaded);
        setAutoLoaded(true);
      })
      .catch(() => { /* 조용히 실패 — 수동 입력 가능 */ })
      .finally(() => setAutoLoading(false));
  }, [session]);

  function addEntry() {
    setEntries(prev => [...prev, EMPTY_ENTRY()]);
  }

  function removeEntry(i: number) {
    setEntries(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateEntry(i: number, patch: Partial<InputEntry>) {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  }

  async function run() {
    const valid: QuoteEntry[] = entries
      .filter(e => e.draftAmount != null && e.draftAmount > 0)
      .map(e => ({ ...e, draftAmount: e.draftAmount as number }));
    if (valid.length === 0) {
      setError(t.qaErrorMinEntries);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await analyzeQuoteAccuracy({ entries: valid, lang });
      setResult(r);
      onResult?.(r.overallBiasPercent);
    } catch (e) {
      const err = e as Error & { requiresPro?: boolean };
      setError(err.requiresPro ? t.qaErrorPro : (err.message || t.qaErrorGeneric));
    } finally {
      setLoading(false);
    }
  }

  const numField = (val: number | null | undefined, onChange: (n: number | null) => void, placeholder: string) => (
    <input
      type="number"
      value={val ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      placeholder={placeholder}
      min={0}
      style={{ width: '100%', padding: '5px 7px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box', background: C.bg, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}
    />
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9200, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, width: '100%', maxWidth: 720, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg, #1e1a30, #1a1e30)' }}>
          <span style={{ fontSize: 18 }} aria-hidden="true">📊</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>{t.qaHeader}</p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>{t.qaHeaderSubtitle}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* 이력 입력 테이블 */}
          {!result && (
            <div>
              {autoLoading && (
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: `2px solid ${C.accent}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                  {t.qaDbLoading}
                </div>
              )}
              {autoLoaded && !autoLoading && (
                <div style={{ fontSize: 11, color: C.green, marginBottom: 8, background: `${C.green}12`, border: `1px solid ${C.green}30`, borderRadius: 6, padding: '5px 10px' }}>
                  {t.qaDbLoaded(entries.length)}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.textDim }}>{t.qaInputTitle}</p>
                <button
                  onClick={addEntry}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.accent, cursor: 'pointer', fontWeight: 700 }}
                >
                  {t.qaAddRow}
                </button>
              </div>

              {/* Header row */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 28px', gap: 5, padding: '4px 0', marginBottom: 4 }}>
                {[t.qaColProcess, t.qaColDraft, t.qaColAccepted, t.qaColActual, ''].map((h, i) => (
                  <span key={i} style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>{h}</span>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {entries.map((e, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr 28px', gap: 5, alignItems: 'center' }}>
                    <input
                      type="text"
                      value={e.process ?? ''}
                      onChange={ev => updateEntry(i, { process: ev.target.value })}
                      placeholder={t.qaPhProcess}
                      style={{ padding: '5px 7px', borderRadius: 6, fontSize: 11, background: C.bg, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}
                    />
                    {numField(e.draftAmount, v => updateEntry(i, { draftAmount: v }), t.qaPhRequired)}
                    {numField(e.acceptedAmount, v => updateEntry(i, { acceptedAmount: v }), t.qaPhOptional)}
                    {numField(e.actualCost,     v => updateEntry(i, { actualCost: v }),     t.qaPhOptional)}
                    <button
                      onClick={() => removeEntry(i)}
                      disabled={entries.length === 1}
                      style={{ background: 'none', border: 'none', color: entries.length === 1 ? C.textMuted : C.red, fontSize: 14, cursor: entries.length === 1 ? 'default' : 'pointer', padding: 0 }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <p style={{ margin: '8px 0 0', fontSize: 10, color: C.textMuted }}>
                {t.qaInputHint}
              </p>
            </div>
          )}

          {error && (
            <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}

          {/* 결과 */}
          {result && (
            <>
              {/* 요약 카드 */}
              <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 10 }}>
                  <AccuracyGauge score={result.overallAccuracy} t={t} />
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <BiasBadge bias={result.overallBiasPercent} t={t} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: C.accent }}>{result.entriesAnalysed}</div>
                    <p style={{ margin: '2px 0 0', fontSize: 10, color: C.textMuted }}>{t.qaSampleCount}</p>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: C.textDim, textAlign: 'center', lineHeight: 1.5 }}>
                  {lang === 'ko' ? result.summaryKo : result.summary}
                </p>
              </div>

              {/* 공정별 편향 */}
              {result.processBias.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>{t.qaProcessBiasTitle}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {result.processBias.map((pb, i) => <ProcessBiasRow key={i} pb={pb} t={t} lang={lang} />)}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {result.suggestions.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>{t.qaSuggestionsTitle}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {result.suggestions.map((s, i) => <SuggestionCard key={i} s={s} lang={lang} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 18px', display: 'flex', gap: 8 }}>
          {!result ? (
            <button
              onClick={run}
              disabled={loading}
              style={{
                flex: 1, padding: 10, borderRadius: 8, border: 'none',
                background: loading ? `${C.purple}66` : `linear-gradient(135deg, ${C.purple}, #3b82f6)`,
                color: '#fff', fontSize: 13, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
              }}
            >
              {loading ? t.qaRunning : t.qaRunBtn}
            </button>
          ) : (
            <button
              onClick={() => setResult(null)}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              {t.qaRerunBtn}
            </button>
          )}
          <button
            onClick={onClose}
            style={{ padding: '10px 18px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {t.qaClose}
          </button>
        </div>
      </div>
    </div>
  );
}
