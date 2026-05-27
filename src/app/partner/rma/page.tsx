'use client';

/**
 * /partner/rma — Partner defects & RMA triage.
 *
 * Three sections: actionable (reported/under_review/disputed),
 * in-progress (approved), closed (resolved/rejected).
 *
 * Allowed transitions (partner):
 *   reported     → under_review
 *   under_review → approved   (+ rmaInstructions, auto RMA #)
 *   under_review → rejected   (+ partnerResponse)
 *   disputed     → approved   (+ rmaInstructions)
 *   disputed     → rejected   (+ partnerResponse)
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePartnerLang } from '../_lib/partnerLang';
import { rmaDict, type RmaDict } from '../_lib/dicts/rma';

type DefectStatus =
  | 'reported' | 'under_review' | 'approved' | 'rejected' | 'resolved' | 'disputed';
type DefectSeverity = 'minor' | 'major' | 'critical';
type DefectKind =
  | 'wrong_part' | 'damaged' | 'out_of_spec' | 'missing_quantity' | 'late_delivery' | 'other';

interface Defect {
  id: string;
  orderId: string;
  reporterEmail: string;
  partnerEmail: string | null;
  status: DefectStatus;
  severity: DefectSeverity;
  kind: DefectKind;
  description: string;
  photoKeys: string[];
  rmaNumber: string | null;
  rmaInstructions: string | null;
  partnerResponse: string | null;
  resolutionNote: string | null;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const STATUS_TONE: Record<DefectStatus, string> = {
  reported: 'bg-rose-100 text-rose-700',
  under_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-gray-100 text-gray-600',
  resolved: 'bg-blue-100 text-blue-700',
  disputed: 'bg-purple-100 text-purple-700',
};

const SEVERITY_TONE: Record<DefectSeverity, string> = {
  minor: 'bg-gray-100 text-gray-700',
  major: 'bg-amber-100 text-amber-700',
  critical: 'bg-rose-100 text-rose-700',
};

const statusLabel = (s: DefectStatus, t: RmaDict) => t[`status_${s}` as keyof RmaDict] as string;
const severityLabel = (s: DefectSeverity, t: RmaDict) => t[`severity_${s}` as keyof RmaDict] as string;
const kindLabel = (k: DefectKind, t: RmaDict) => t[`kind_${k}` as keyof RmaDict] as string;

const LOCALE_FOR_LANG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};

function relTime(ts: number, t: RmaDict, lang: string) {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < 60_000) return t.timelineRelJustNow;
  if (diff < 3_600_000) return t.timelineRelMinutes(Math.round(diff / 60_000));
  if (diff < day) return t.timelineRelHours(Math.round(diff / 3_600_000));
  if (diff < 7 * day) return t.timelineRelDays(Math.round(diff / day));
  return new Date(ts).toLocaleDateString(LOCALE_FOR_LANG[lang] ?? 'en-US');
}

export default function PartnerRmaPage() {
  const router = useRouter();
  const lang = usePartnerLang();
  const t = rmaDict(lang);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Defect | null>(null);
  const [rmaInput, setRmaInput] = useState('');
  const [responseInput, setResponseInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const session = () => (typeof window !== 'undefined' ? localStorage.getItem('partnerSession') ?? '' : '');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (session() === 'demo') {
        const now = Date.now();
        setDefects([
          { id: 'DEF-2026-A1B2C3', orderId: 'ORD-2026-D44E5F', reporterEmail: 'buyer@example.com',
            partnerEmail: 'demo', status: 'reported', severity: 'major', kind: 'damaged',
            description: '배송 박스 파손과 함께 하우징 모서리에 균열이 있습니다. 사진 첨부합니다.',
            photoKeys: ['defects/demo-1.jpg'], rmaNumber: null, rmaInstructions: null,
            partnerResponse: null, resolutionNote: null, resolvedAt: null,
            createdAt: now - 2 * 3_600_000, updatedAt: now - 2 * 3_600_000 },
          { id: 'DEF-2026-E4F5G6', orderId: 'ORD-2026-J11K2L', reporterEmail: 'buyer2@example.com',
            partnerEmail: 'demo', status: 'under_review', severity: 'minor', kind: 'out_of_spec',
            description: '드로잉 상 ±0.05mm 지정이었으나 실측 +0.08mm. 미세 허용 가능 여부 확인 요청.',
            photoKeys: [], rmaNumber: null, rmaInstructions: null,
            partnerResponse: null, resolutionNote: null, resolvedAt: null,
            createdAt: now - 1 * 86_400_000, updatedAt: now - 1 * 86_400_000 },
          { id: 'DEF-2026-H7I8J9', orderId: 'ORD-2026-M88N7P', reporterEmail: 'buyer3@example.com',
            partnerEmail: 'demo', status: 'approved', severity: 'critical', kind: 'wrong_part',
            description: '모델 A 주문했는데 모델 B 가 배송됨. 전량 교체 필요.', photoKeys: [],
            rmaNumber: 'RMA-2026-XYZ123', rmaInstructions: '착불 반품 후 재생산 5영업일 소요.',
            partnerResponse: null, resolutionNote: null, resolvedAt: null,
            createdAt: now - 4 * 86_400_000, updatedAt: now - 3 * 86_400_000 },
        ]);
        return;
      }
      const res = await fetch('/api/partner/defects?limit=100', {
        headers: { Authorization: `Bearer ${session()}` },
      });
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setDefects(data.defects ?? []);
    } catch (err) {
      console.error('[partner/rma] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session()) { router.replace(`/partner/login?lang=${lang}`); return; }
    load();
  }, [router, load, lang]);

  function openDefect(d: Defect) {
    setSelected(d);
    setRmaInput(d.rmaInstructions ?? '');
    setResponseInput(d.partnerResponse ?? '');
  }

  async function transition(next: DefectStatus) {
    if (!selected) return;
    if (next === 'approved' && !rmaInput.trim()) {
      alert(t.errNeedRmaInstructions);
      return;
    }
    if (next === 'rejected' && !responseInput.trim()) {
      alert(t.errNeedRejectReason);
      return;
    }
    setSubmitting(true);
    try {
      if (session() === 'demo') {
        const patch: Partial<Defect> = {
          status: next,
          rmaInstructions: next === 'approved' ? rmaInput : selected.rmaInstructions,
          rmaNumber: next === 'approved' && !selected.rmaNumber
            ? `RMA-${new Date().getFullYear()}-DEMO${Math.floor(Math.random() * 1000)}`
            : selected.rmaNumber,
          partnerResponse: next === 'rejected' ? responseInput : selected.partnerResponse,
          updatedAt: Date.now(),
        };
        setDefects(prev => prev.map(x => x.id === selected.id ? { ...x, ...patch } as Defect : x));
        setSelected(prev => prev ? { ...prev, ...patch } as Defect : prev);
        return;
      }
      const body: Record<string, unknown> = { status: next };
      if (next === 'approved') body.rmaInstructions = rmaInput.trim();
      if (next === 'rejected') body.partnerResponse = responseInput.trim();
      const res = await fetch(`/api/nexyfab/defects/${selected.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session()}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? t.errProcess);
        return;
      }
      const data = await res.json();
      if (data.defect) {
        setDefects(prev => prev.map(x => x.id === selected.id ? data.defect : x));
        setSelected(data.defect);
      }
    } catch (err) {
      console.error('[partner/rma] transition failed:', err);
      alert(t.errProcess);
    } finally {
      setSubmitting(false);
    }
  }

  const actionable = defects.filter(d => d.status === 'reported' || d.status === 'under_review' || d.status === 'disputed');
  const inProgress = defects.filter(d => d.status === 'approved');
  const closed = defects.filter(d => d.status === 'resolved' || d.status === 'rejected');

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-6 overflow-auto pb-24 md:pb-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-black text-gray-900">{t.pageTitle}</h1>
              <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-700 font-bold">{t.chipActionable(actionable.length)}</span>
              <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold">{t.chipInProgress(inProgress.length)}</span>
              <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-bold">{t.chipClosed(closed.length)}</span>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-20 text-gray-400 text-sm">{t.loading}</div>
          ) : defects.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
              <div className="text-4xl mb-2" aria-hidden="true">✨</div>
              <div className="text-base font-bold text-gray-700">{t.emptyTitle}</div>
              <div className="text-xs text-gray-400 mt-1">{t.emptyHint}</div>
            </div>
          ) : (
            <div className="space-y-6">
              <Section title={t.sectionActionable} tone="rose" items={actionable} onOpen={openDefect} emptyHint={t.sectionActionableEmpty} t={t} lang={lang} />
              <Section title={t.sectionInProgress} tone="emerald" items={inProgress} onOpen={openDefect} emptyHint={t.sectionInProgressEmpty} t={t} lang={lang} />
              <Section title={t.sectionClosed} tone="gray" items={closed} onOpen={openDefect} emptyHint={t.sectionClosedEmpty} t={t} lang={lang} />
            </div>
          )}
        </div>
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-end" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="bg-gray-900 text-white px-6 py-5 sticky top-0 z-10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-gray-400 font-mono">{selected.id}</div>
                  <h2 className="text-lg font-black mt-0.5">{kindLabel(selected.kind, t)}</h2>
                  <div className="text-xs text-gray-300 mt-1">
                    {t.drawerOrderPrefix} <span className="font-mono">{selected.orderId}</span> · {relTime(selected.createdAt, t, lang)} {t.drawerReceivedSuffix}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} aria-label={t.closeLabel} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_TONE[selected.status]}`}>{statusLabel(selected.status, t)}</span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${SEVERITY_TONE[selected.severity]}`}>{severityLabel(selected.severity, t)}</span>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{t.drawerBuyerContent}</h3>
                <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {selected.description}
                </div>
                <div className="text-[11px] text-gray-400 mt-1.5">{t.drawerBuyerSubmitter(selected.reporterEmail)}</div>
                {selected.photoKeys.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500">{t.drawerAttachments(selected.photoKeys.length)}</div>
                )}
              </section>

              {selected.rmaNumber && (
                <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <div className="text-xs font-bold text-emerald-700 mb-1">{t.drawerRmaNumberLabel}</div>
                  <div className="font-mono font-bold text-emerald-900">{selected.rmaNumber}</div>
                  {selected.rmaInstructions && (
                    <div className="text-xs text-emerald-800 mt-2 whitespace-pre-wrap">{selected.rmaInstructions}</div>
                  )}
                </section>
              )}

              {selected.partnerResponse && (
                <section>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{t.drawerPartnerComment}</h3>
                  <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 whitespace-pre-wrap">{selected.partnerResponse}</div>
                </section>
              )}

              {selected.resolutionNote && (
                <section>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{t.drawerBuyerNote}</h3>
                  <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-900 whitespace-pre-wrap">{selected.resolutionNote}</div>
                </section>
              )}

              {(selected.status === 'reported' || selected.status === 'under_review' || selected.status === 'disputed') && (
                <section className="border-t border-gray-100 pt-5">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">{t.drawerActionTitle}</h3>

                  {selected.status === 'reported' && (
                    <button
                      onClick={() => transition('under_review')}
                      disabled={submitting}
                      className="w-full px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold disabled:opacity-50"
                    >
                      {t.drawerBtnStartReview}
                    </button>
                  )}

                  {(selected.status === 'under_review' || selected.status === 'disputed') && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                          {t.drawerLabelRmaInstructions}
                        </label>
                        <textarea
                          value={rmaInput}
                          onChange={e => setRmaInput(e.target.value)}
                          rows={3}
                          placeholder={t.drawerPlaceholderRmaInstructions}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-400"
                        />
                        <button
                          onClick={() => transition('approved')}
                          disabled={submitting || !rmaInput.trim()}
                          className="mt-2 w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50"
                        >
                          {t.drawerBtnApprove}
                        </button>
                      </div>

                      <div className="border-t border-gray-100 pt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                          {t.drawerLabelRejectReason}
                        </label>
                        <textarea
                          value={responseInput}
                          onChange={e => setResponseInput(e.target.value)}
                          rows={3}
                          placeholder={t.drawerPlaceholderRejectReason}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-rose-400"
                        />
                        <button
                          onClick={() => transition('rejected')}
                          disabled={submitting || !responseInput.trim()}
                          className="mt-2 w-full px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-800 text-white text-sm font-bold disabled:opacity-50"
                        >
                          {t.drawerBtnReject}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {selected.status === 'approved' && (
                <section className="border-t border-gray-100 pt-5 text-xs text-gray-500">
                  {t.drawerFooterApproved}
                </section>
              )}

              {(selected.status === 'resolved' || selected.status === 'rejected') && (
                <section className="border-t border-gray-100 pt-5 text-xs text-gray-500">
                  {t.drawerFooterClosed}
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title, tone, items, onOpen, emptyHint, t, lang,
}: {
  title: string;
  tone: 'rose' | 'emerald' | 'gray';
  items: Defect[];
  onOpen: (d: Defect) => void;
  emptyHint: string;
  t: RmaDict;
  lang: string;
}) {
  const toneClass = tone === 'rose' ? 'border-rose-200 bg-rose-50/30'
                  : tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/30'
                  : 'border-gray-200 bg-gray-50/30';
  return (
    <div className={`rounded-2xl border ${toneClass} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        <span className="text-xs text-gray-500">{items.length}{t.sectionCountSuffix}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 py-4 text-center">{emptyHint}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {items.map(d => (
            <button
              key={d.id}
              onClick={() => onOpen(d)}
              className="block w-full text-left bg-white rounded-xl p-3.5 border border-gray-100 hover:border-blue-200 hover:shadow-md transition"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_TONE[d.status]}`}>{statusLabel(d.status, t)}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${SEVERITY_TONE[d.severity]}`}>{severityLabel(d.severity, t)}</span>
              </div>
              <div className="text-sm font-bold text-gray-900 truncate">{kindLabel(d.kind, t)}</div>
              <div className="text-xs text-gray-500 mt-0.5 truncate">{t.drawerOrderPrefix} {d.orderId}</div>
              <div className="text-xs text-gray-600 mt-2 line-clamp-2">{d.description}</div>
              <div className="text-[11px] text-gray-400 mt-2 flex items-center justify-between">
                <span>{relTime(d.createdAt, t, lang)}</span>
                {d.rmaNumber && <span className="font-mono text-emerald-700">{d.rmaNumber}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
