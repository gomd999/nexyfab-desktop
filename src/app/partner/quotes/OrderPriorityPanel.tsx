'use client';

/**
 * OrderPriorityPanel — Phase 8-2 (partner-side).
 *
 * Modal that takes the partner's current pending quotes and ranks them
 * by expected margin × DFM fit × deadline urgency × process match.
 * Shows a ranked list with tags, margin estimate, risk flags, and reasons.
 */

import { useState } from 'react';
import { scoreOrderPriority, type IncomingQuote, type PartnerProfile, type PriorityResult, type RankedQuote } from './orderPriority';
import { usePartnerLang } from '../_lib/partnerLang';
import { quotePanelsDict, type QuotePanelsDict } from '../_lib/dicts/quotePanels';

const TAG_COLORS: Record<RankedQuote['tag'], { color: string; bg: string }> = {
  priority:  { color: '#3fb950', bg: '#3fb95020' },
  good_fit:  { color: '#388bfd', bg: '#388bfd20' },
  consider:  { color: '#d29922', bg: '#d2992220' },
  pass:      { color: '#f85149', bg: '#f8514920' },
};

function tagLabel(tag: RankedQuote['tag'], t: QuotePanelsDict): string {
  switch (tag) {
    case 'priority': return t.opTagPriority;
    case 'good_fit': return t.opTagGoodFit;
    case 'consider': return t.opTagConsider;
    case 'pass':     return t.opTagPass;
  }
}

interface Props {
  quotes: IncomingQuote[];
  defaultPartner?: PartnerProfile;
  onClose: () => void;
  onSelectQuote?: (id: string) => void;
}

const LOCALE_FOR_LANG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};

function fmtMoney(n: number, lang: string) {
  try {
    return new Intl.NumberFormat(LOCALE_FOR_LANG[lang] ?? 'en-US', {
      style: 'currency', currency: 'KRW', maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₩${n.toLocaleString()}`;
  }
}

export default function OrderPriorityPanel({ quotes, defaultPartner, onClose, onSelectQuote }: Props) {
  const lang = usePartnerLang();
  const t = quotePanelsDict(lang);
  const [partner, setPartner] = useState<PartnerProfile>({
    hourlyRateKrw: defaultPartner?.hourlyRateKrw ?? 80000,
    materialMargin: defaultPartner?.materialMargin ?? 0.35,
    leadCapacityDays: defaultPartner?.leadCapacityDays ?? 20,
    currentBacklogDays: defaultPartner?.currentBacklogDays ?? 5,
    processes: defaultPartner?.processes ?? [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PriorityResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await scoreOrderPriority({ quotes, partner });
      setResult(r);
    } catch (e) {
      const err = e as Error & { requiresPro?: boolean };
      setError(err.requiresPro ? t.opErrorPro : (err.message || t.opErrorGeneric));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">{t.opHeader}</h2>
            <p className="text-xs text-emerald-100 mt-0.5">
              {t.opSubtitleCount(quotes.length)}
            </p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Capacity inputs */}
          {!result && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">{t.opFieldHourlyRate}</label>
                <input
                  type="number"
                  value={partner.hourlyRateKrw ?? 80000}
                  onChange={e => setPartner(p => ({ ...p, hourlyRateKrw: Number(e.target.value) }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">{t.opFieldMargin}</label>
                <input
                  type="number" step="0.05"
                  value={partner.materialMargin ?? 0.35}
                  onChange={e => setPartner(p => ({ ...p, materialMargin: Number(e.target.value) }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">{t.opFieldBacklog}</label>
                <input
                  type="number"
                  value={partner.currentBacklogDays ?? 5}
                  onChange={e => setPartner(p => ({ ...p, currentBacklogDays: Number(e.target.value) }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">{t.opFieldCapacity}</label>
                <input
                  type="number"
                  value={partner.leadCapacityDays ?? 20}
                  onChange={e => setPartner(p => ({ ...p, leadCapacityDays: Number(e.target.value) }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-400"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}

          {result && (
            <>
              {/* Top pick banner */}
              {result.topPickKo && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-emerald-700 mb-0.5">{t.opTopPick}</p>
                  <p className="text-sm text-emerald-900 font-semibold">{result.topPickKo}</p>
                  <p className="text-xs text-emerald-600 mt-0.5">{result.summaryKo}</p>
                </div>
              )}

              {/* Ranked list */}
              <div className="space-y-2">
                {result.ranked.map((r, i) => {
                  const tagMeta = TAG_COLORS[r.tag];
                  const isExp = expanded === r.id;
                  return (
                    <div
                      key={r.id}
                      className="border border-gray-100 rounded-xl overflow-hidden"
                      style={{ borderColor: i === 0 ? '#10b981' : undefined }}
                    >
                      <button
                        onClick={() => setExpanded(isExp ? null : r.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
                      >
                        <span className="text-xs font-black text-gray-400 w-5">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{r.projectName}</p>
                          <p className="text-xs text-gray-500">{fmtMoney(r.estimatedAmount, lang)}</p>
                        </div>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                          style={{ color: tagMeta.color, background: tagMeta.bg }}
                        >
                          {tagLabel(r.tag, t)}
                        </span>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-black" style={{ color: r.score >= 70 ? '#10b981' : r.score >= 50 ? '#3b82f6' : '#9ca3af' }}>
                            {r.score}pt
                          </p>
                          <p className="text-[10px] text-gray-400">{t.opMarginShort(r.marginPct)}</p>
                        </div>
                        <span className="text-xs text-gray-400">{isExp ? '▲' : '▼'}</span>
                      </button>

                      {isExp && (
                        <div className="border-t border-gray-100 px-4 py-3 space-y-2 bg-gray-50">
                          <div className="flex justify-between text-xs text-gray-600">
                            <span>{t.opMarginEst}</span>
                            <span className="font-bold text-emerald-700">{fmtMoney(r.estimatedMarginKrw, lang)} (~{r.marginPct}%)</span>
                          </div>
                          {r.reasonsKo.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 mb-1">{t.opReasons}</p>
                              <ul className="space-y-0.5">
                                {r.reasonsKo.map((reason, j) => (
                                  <li key={j} className="text-xs text-gray-600">• {reason}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {r.riskFlagsKo.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-amber-500 mb-1">{t.opRisks}</p>
                              <ul className="space-y-0.5">
                                {r.riskFlagsKo.map((flag, j) => (
                                  <li key={j} className="text-xs text-amber-700">• {flag}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {onSelectQuote && (r.tag === 'priority' || r.tag === 'good_fit') && (
                            <button
                              onClick={() => { onSelectQuote(r.id); onClose(); }}
                              className="w-full py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition mt-1"
                            >
                              {t.opSubmitThis}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3 flex gap-2">
          {!result ? (
            <button
              onClick={run}
              disabled={loading}
              className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition"
            >
              {loading ? t.opAnalyzing : t.opRunBtn}
            </button>
          ) : (
            <button
              onClick={() => setResult(null)}
              className="flex-1 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              {t.opRetry}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            {t.opClose}
          </button>
        </div>
      </div>
    </div>
  );
}
