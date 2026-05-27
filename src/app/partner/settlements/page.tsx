'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { formatDate } from '@/lib/formatDate';
import { usePartnerLang } from '../_lib/partnerLang';
import { settlementsDict, type SettlementsDict } from '../_lib/dicts/settlements';

interface Partner { partnerId: string; email: string; company: string; }
interface Contract {
  id: string; projectName: string; factoryName?: string;
  contractAmount: number;   // amount agreed at contract time
  actualAmount?: number;    // actual settlement amount once delivered
  status: string; contractDate?: string;
}

function statusLabel(s: string, t: SettlementsDict): string {
  switch (s) {
    case 'contracted':    return t.statusContracted;
    case 'in_progress':   return t.statusInProgress;
    case 'quality_check': return t.statusQuality;
    case 'delivered':     return t.statusDelivered;
    case 'completed':     return t.statusCompleted;
    case 'cancelled':     return t.statusCancelled;
    default:              return s;
  }
}

function fmtMoney(n: number | undefined, lang: string) {
  if (n == null) return '-';
  const locale: Record<string, string> = {
    ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
  };
  try {
    return new Intl.NumberFormat(locale[lang] ?? 'en-US', {
      style: 'currency', currency: 'KRW', maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₩${n.toLocaleString()}`;
  }
}

export default function PartnerSettlementsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const lang = usePartnerLang();
  const t = settlementsDict(lang);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);

  const fetchData = useCallback(async (session: string) => {
    const res = await fetch('/api/partner/contracts', { headers: { Authorization: `Bearer ${session}` } });
    const data = await res.json();
    setContracts(data.contracts || []);
  }, []);

  useEffect(() => {
    const session = localStorage.getItem('partnerSession');
    if (!session) { router.replace(`/partner/login?lang=${lang}`); return; }

    if (session === 'demo') {
      setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
      setContracts([
        { id: 'demo-s1', projectName: 'EV 배터리 케이스 외주 제조', factoryName: '한국제조 (주)', contractAmount: 28000000, actualAmount: 29500000, status: 'completed', contractDate: new Date(Date.now() - 90 * 86400000).toISOString() },
        { id: 'demo-s2', projectName: '항공우주 브라켓 가공', factoryName: '선진정밀 (주)', contractAmount: 55000000, actualAmount: 55000000, status: 'completed', contractDate: new Date(Date.now() - 150 * 86400000).toISOString() },
        { id: 'demo-s3', projectName: 'IoT 모듈 PCB 조립', factoryName: '대한정밀 (주)', contractAmount: 42000000, status: 'in_progress', contractDate: new Date(Date.now() - 30 * 86400000).toISOString() },
      ]);
      setLoading(false);
      return;
    }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(d => {
        if (!d.valid) { router.replace(`/partner/login?lang=${lang}`); return; }
        setPartner(d.partner);
        fetchData(session).finally(() => setLoading(false));
      })
      .catch(() => router.replace(`/partner/login?lang=${lang}`));
  }, [router, fetchData, lang]);

  void partner; // wired in future header

  async function downloadPdf(contractId: string) {
    setPdfLoading(contractId);
    try {
      const session = localStorage.getItem('partnerSession') || '';
      const res = await fetch(`/api/partner/settlement-pdf?contractId=${contractId}`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) { toast('error', t.errPdf); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `settlement-${contractId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast('error', t.errGeneric); }
    finally { setPdfLoading(null); }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">{t.loading}</p>
    </div>
  );

  const completed = contracts.filter(c => c.status === 'completed');
  const active = contracts.filter(c => !['completed', 'cancelled'].includes(c.status));

  const totalContracted = completed.reduce((s, c) => s + (c.contractAmount || 0), 0);
  const totalActual = completed.reduce((s, c) => s + (c.actualAmount ?? c.contractAmount ?? 0), 0);
  const totalDiff = totalActual - totalContracted;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-6 overflow-auto pb-20 md:pb-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">{t.pageTitle}</h1>
            <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="text-2xl mb-2" aria-hidden="true">✅</div>
              <div className="text-xl font-black text-gray-800">{completed.length}{t.sumCompletedUnit}</div>
              <div className="text-xs text-gray-500 mt-1 font-semibold">{t.sumCompletedCount}</div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="text-2xl mb-2" aria-hidden="true">📋</div>
              <div className="text-xl font-black text-blue-700">{fmtMoney(totalContracted, lang)}</div>
              <div className="text-xs text-gray-500 mt-1 font-semibold">{t.sumContractedAmount}</div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="text-2xl mb-2" aria-hidden="true">💰</div>
              <div className="text-xl font-black text-emerald-600">{fmtMoney(totalActual, lang)}</div>
              <div className="text-xs text-gray-500 mt-1 font-semibold flex items-center gap-1.5">
                {t.sumActualAmount}
                {totalDiff !== 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${totalDiff > 0 ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-500'}`}>
                    {totalDiff > 0 ? '+' : ''}{fmtMoney(totalDiff, lang)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Active contracts */}
          {active.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{t.sectionInProgress} ({active.length})</h2>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {active.map((c, i) => (
                  <div key={c.id} className={`flex items-center gap-4 px-5 py-4 ${i < active.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{c.projectName}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{statusLabel(c.status, t)} · {formatDate(c.contractDate)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-gray-900">{fmtMoney(c.contractAmount, lang)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completed contracts */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{t.sectionCompleted} ({completed.length})</h2>
            {completed.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center text-gray-400 text-sm">
                {t.emptyCompleted}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {completed.map((c, i) => (
                  <div key={c.id} className={`px-5 py-4 ${i < completed.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-sm font-bold text-gray-900">{c.projectName}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{formatDate(c.contractDate)}</div>
                      </div>
                      <button onClick={() => downloadPdf(c.id)} disabled={pdfLoading === c.id}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition disabled:opacity-50">
                        {pdfLoading === c.id ? t.btnReceiptLoading : t.btnReceipt}
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 items-center">
                      <div className="bg-gray-50 rounded-xl px-3 py-2">
                        <div className="text-[10px] text-gray-400 font-semibold mb-1">{t.cardContractAmount}</div>
                        <div className="text-sm font-black text-gray-700">{fmtMoney(c.contractAmount, lang)}</div>
                      </div>
                      <div className="text-gray-300 text-sm" aria-hidden="true">→</div>
                      <div className="bg-emerald-50 rounded-xl px-3 py-2">
                        <div className="text-[10px] text-emerald-600 font-semibold mb-1">{t.cardActualAmount}</div>
                        <div className="text-sm font-black text-emerald-700">
                          {c.actualAmount != null ? fmtMoney(c.actualAmount, lang) : <span className="text-gray-400 font-semibold">{t.cardPending}</span>}
                        </div>
                      </div>
                      {c.actualAmount != null && c.actualAmount !== c.contractAmount && (
                        <div className={`text-xs font-bold px-2 py-1 rounded-full ${c.actualAmount > c.contractAmount ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-500'}`}>
                          {c.actualAmount > c.contractAmount ? '+' : ''}{fmtMoney(c.actualAmount - c.contractAmount, lang)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
