'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { usePartnerLang } from '../_lib/partnerLang';
import { portfolioDict } from '../_lib/dicts/portfolio';

interface Partner {
  partnerId: string;
  email: string;
  company: string;
}

interface Attachment {
  id: string;
  filename: string;
  originalName: string;
  type: 'image' | 'model' | 'document';
  url: string;
}

interface Contract {
  id: string;
  projectName: string;
  factoryName?: string;
  contractAmount: number;
  status: string;
  completedAt?: string;
  contractDate?: string;
  attachments?: Attachment[];
}

const LOCALE_FOR_LANG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};

const CURRENCY_FOR_LANG: Record<string, string> = {
  ko: 'KRW', en: 'KRW', ja: 'KRW', cn: 'KRW', es: 'KRW', ar: 'KRW',
};

function fmtMoney(n: number, lang: string): string {
  const locale = LOCALE_FOR_LANG[lang] ?? 'en-US';
  const currency = CURRENCY_FOR_LANG[lang] ?? 'KRW';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return n.toLocaleString(locale) + ' KRW';
  }
}

function fmtDate(iso: string, lang: string) {
  if (!iso) return '-';
  const locale = LOCALE_FOR_LANG[lang] ?? 'en-US';
  return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function PartnerPortfolioPage() {
  const router = useRouter();
  const lang = usePartnerLang();
  const t = portfolioDict(lang);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [completed, setCompleted] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  function amountLabel(amount: number): string {
    if (!amount) return t.amountUndisclosed;
    if (amount < 5_000_000) return t.amountSmall;
    if (amount < 30_000_000) return t.amountMidSmall;
    if (amount < 100_000_000) return t.amountMid;
    if (amount < 500_000_000) return t.amountLarge;
    return t.amountXLarge;
  }

  const getSession = () => localStorage.getItem('partnerSession') || '';

  const fetchContracts = useCallback(async (session: string) => {
    const res = await fetch('/api/partner/contracts', {
      headers: { Authorization: `Bearer ${session}` },
    });
    const data = await res.json();
    const all: Contract[] = data.contracts || [];
    setCompleted(all.filter(c => c.status === 'completed'));
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace(`/partner/login?lang=${lang}`); return; }

    if (session === 'demo') {
      queueMicrotask(() => {
        setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
        setCompleted([
          { id: 'demo-p1', projectName: 'EV 배터리 케이스 외주 제조', factoryName: '한국제조 (주)', contractAmount: 28000000, status: 'completed', completedAt: new Date(Date.now() - 10 * 86400000).toISOString(), contractDate: new Date(Date.now() - 90 * 86400000).toISOString() },
          { id: 'demo-p2', projectName: '항공우주 브라켓 가공', factoryName: '선진정밀 (주)', contractAmount: 55000000, status: 'completed', completedAt: new Date(Date.now() - 60 * 86400000).toISOString(), contractDate: new Date(Date.now() - 150 * 86400000).toISOString() },
          { id: 'demo-p3', projectName: '의료 임플란트 티타늄 가공', factoryName: '메디컬파츠', contractAmount: 12000000, status: 'completed', completedAt: new Date(Date.now() - 120 * 86400000).toISOString(), contractDate: new Date(Date.now() - 180 * 86400000).toISOString() },
        ]);
        setLoading(false);
      });
      return;
    }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(d => {
        if (!d.valid) { router.replace(`/partner/login?lang=${lang}`); return; }
        setPartner(d.partner);
        fetchContracts(session).finally(() => setLoading(false));
      })
      .catch(() => router.replace(`/partner/login?lang=${lang}`));
  }, [router, fetchContracts, lang]);

  // Silence unused-var lint — partner state may be wired into a header later.
  void partner;

  const totalAmount = completed.reduce((s, c) => s + (c.contractAmount || 0), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">{t.loading}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-6 overflow-auto pb-20 md:pb-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">{t.pageTitle}</h1>
            <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">{t.statsCompletedCount}</p>
              <p className="text-3xl font-black text-gray-900">{completed.length}<span className="text-lg font-semibold text-gray-500 ml-1">{t.statsCompletedUnit}</span></p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">{t.statsTotalAmount}</p>
              <p className="text-2xl font-black text-blue-600 truncate">{fmtMoney(totalAmount, lang)}</p>
            </div>
          </div>

          {completed.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-20 text-center text-gray-400 text-sm">
              <p className="text-4xl mb-3" aria-hidden="true">🏆</p>
              <p>{t.emptyTitle}</p>
              <p className="text-xs mt-1 text-gray-300">{t.emptyHint}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {completed.map(contract => {
                const images = (contract.attachments || []).filter(a => a.type === 'image');
                const thumbUrl = images[0]?.url || null;

                return (
                  <div key={contract.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    {/* Thumbnail */}
                    {thumbUrl ? (
                      <div
                        className="relative w-full h-40 bg-gray-100 cursor-pointer overflow-hidden"
                        onClick={() => setLightboxUrl(thumbUrl)}
                      >
                        <Image
                          src={thumbUrl}
                          alt={contract.projectName}
                          fill
                          className="object-cover hover:scale-105 transition-transform"
                          sizes="(max-width: 768px) 100vw, 480px"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="w-full h-40 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                        <span className="text-4xl" aria-hidden="true">🏭</span>
                      </div>
                    )}

                    {/* Card body */}
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">{t.statusCompleted}</span>
                        {contract.completedAt && (
                          <span className="text-xs text-gray-400">{fmtDate(contract.completedAt, lang)}</span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-gray-900 mb-1 truncate">{contract.projectName}</h3>
                      {contract.factoryName && (
                        <p className="text-xs text-gray-500 mb-2 truncate">{contract.factoryName}</p>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                          {amountLabel(contract.contractAmount)}
                        </span>
                        {images.length > 1 && (
                          <span className="text-xs text-gray-400">📎 {images.length}{t.attachmentsSuffix}</span>
                        )}
                      </div>
                    </div>

                    {/* Image thumbnail preview (multi) */}
                    {images.length > 1 && (
                      <div className="px-4 pb-4 grid grid-cols-4 gap-1">
                        {images.slice(1, 5).map(img => (
                          <div
                            key={img.id}
                            className="relative h-12 w-full rounded overflow-hidden cursor-pointer"
                            onClick={() => setLightboxUrl(img.url)}
                          >
                            <Image
                              src={img.url}
                              alt={img.originalName}
                              fill
                              className="object-cover hover:opacity-80 transition"
                              sizes="80px"
                              unoptimized
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t.lightboxAlt}
        >
          <Image
            src={lightboxUrl}
            alt={t.lightboxAlt}
            width={1600}
            height={1200}
            className="max-h-[90vh] w-auto max-w-full object-contain rounded-xl shadow-2xl"
            unoptimized
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-2xl font-bold hover:text-gray-300"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
