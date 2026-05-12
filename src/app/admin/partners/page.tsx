'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDateTime } from '@/lib/formatDate';

type PartnerStatus = 'pending' | 'approved' | 'rejected' | 'contacted';

// ─── 액세스 코드 발송 ────────────────────────────────────────────────────────

async function sendAccessCode(partnerId: string, email: string, company: string): Promise<{ ok: boolean; devCode?: string }> {
  const res = await fetch('/api/partner/send-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partnerId, email, company }),
  });
  return res.json();
}

interface Partner {
  id: string;
  date: string;
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  partner_type?: string;
  match_field?: string;
  tech_exp?: string;
  ref_count?: string;
  amount?: string;
  partnerStatus: PartnerStatus;
  adminNote?: string;
  reviewedAt?: string;
}

interface ReviewSummary {
  avgRating: number;
  count: number;
}

interface PartnerKPI {
  factoryId: string;
  quoteCount: number;
  avgResponseHours: number | null;
  winRate: number | null;
  completionRate: number | null;
  activeCount: number;
  completedCount: number;
  avgDaysOverdue: number | null;
  totalRevenue: number;
}

interface TrustAggRow {
  id: string;
  labelKo: string;
  displayKo: string;
  sampleSize: number;
}

const STATUS_LABELS: Record<PartnerStatus, string> = {
  pending: '검토대기',
  approved: '승인',
  rejected: '거절',
  contacted: '연락완료',
};

const STATUS_COLORS: Record<PartnerStatus, string> = {
  pending: 'bg-gray-100 text-gray-600 border-gray-300',
  approved: 'bg-green-100 text-green-700 border-green-300',
  rejected: 'bg-red-100 text-red-700 border-red-300',
  contacted: 'bg-blue-100 text-blue-700 border-blue-300',
};

function _StarDisplay({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={`text-sm leading-none ${i <= Math.round(value) ? 'text-yellow-400' : 'text-gray-200'}`}>
          ★
        </span>
      ))}
    </span>
  );
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PartnerStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState<string | null>(null);
  const [codeMsg, setCodeMsg] = useState<Record<string, string>>({});
  const [reviewSummaries, setReviewSummaries] = useState<Record<string, ReviewSummary>>({});
  const [kpiMap, setKpiMap] = useState<Record<string, PartnerKPI>>({});
  const [trustModal, setTrustModal] = useState<{ email: string; label: string } | null>(null);
  const [trustRows, setTrustRows] = useState<TrustAggRow[] | null>(null);
  const [trustLoading, setTrustLoading] = useState(false);

  const openTrustModal = useCallback(async (email: string, label: string) => {
    setTrustModal({ email, label });
    setTrustRows(null);
    setTrustLoading(true);
    try {
      const res = await fetch(
        `/api/nexyfab/partner-trust-aggregates?email=${encodeURIComponent(email)}&windowDays=90`,
      );
      const j = (await res.json()) as { dimensions?: TrustAggRow[] };
      setTrustRows(Array.isArray(j.dimensions) ? j.dimensions : []);
    } catch {
      setTrustRows([]);
    } finally {
      setTrustLoading(false);
    }
  }, []);

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/partners');
      const data = await res.json();
      setPartners(data.partners || []);
      const n: Record<string, string> = {};
      (data.partners || []).forEach((p: Partner) => { n[p.id] = p.adminNote || ''; });
      setNotes(n);

      // 승인된 파트너들의 평점 일괄 조회
      const approved = (data.partners || []).filter((p: Partner) => p.email && p.partnerStatus === 'approved');
      const summaryResults = await Promise.allSettled(
        approved.map((p: Partner) =>
          fetch(`/api/reviews?summary=1&partnerEmail=${encodeURIComponent(p.email!)}`)
            .then(r => r.json())
            .then(d => ({ email: p.email!, summary: d as ReviewSummary }))
        )
      );
      const summaries: Record<string, ReviewSummary> = {};
      summaryResults.forEach(result => {
        if (result.status === 'fulfilled') {
          summaries[result.value.email] = result.value.summary;
        }
      });
      setReviewSummaries(summaries);

      // KPI 데이터 일괄 조회
      const kpiRes = await fetch('/api/admin/partner-kpi').catch(() => null);
      if (kpiRes?.ok) {
        const kpiData = await kpiRes.json().catch(() => ({}));
        const km: Record<string, PartnerKPI> = {};
        for (const k of (kpiData.partners ?? [])) {
          if (k.partnerEmail) km[k.partnerEmail] = k;
        }
        setKpiMap(km);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  const updateStatus = async (id: string, status: PartnerStatus) => {
    setSaving(id);
    try {
      await fetch('/api/partners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, note: notes[id] || '' }),
      });
      setPartners(prev => prev.map(p => p.id === id ? { ...p, partnerStatus: status } : p));
    } finally {
      setSaving(null);
    }
  };

  const saveNote = async (id: string) => {
    setSaving(id + '_note');
    try {
      const partner = partners.find(p => p.id === id);
      await fetch('/api/partners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: partner?.partnerStatus || 'pending', note: notes[id] || '' }),
      });
    } finally {
      setSaving(null);
    }
  };

  const filtered = partners.filter(p => {
    const matchFilter = filter === 'all' || p.partnerStatus === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || [p.name, p.company, p.email, p.match_field].some(v => v?.toLowerCase().includes(q));
    return matchFilter && matchSearch;
  });

  const counts = {
    all: partners.length,
    pending: partners.filter(p => p.partnerStatus === 'pending').length,
    approved: partners.filter(p => p.partnerStatus === 'approved').length,
    rejected: partners.filter(p => p.partnerStatus === 'rejected').length,
    contacted: partners.filter(p => p.partnerStatus === 'contacted').length,
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">파트너 관리</h1>
          <p className="text-gray-500 text-sm mt-1">파트너 등록 신청 검토 및 승인</p>
        </div>
        <button onClick={fetchPartners} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">새로고침</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {(['pending', 'approved', 'contacted', 'rejected'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s === filter ? 'all' : s)}
            className={`p-3 rounded-xl border text-center transition-all ${filter === s ? 'ring-2 ring-blue-500' : 'hover:border-blue-300'} ${STATUS_COLORS[s]}`}>
            <div className="text-xl font-bold">{counts[s]}</div>
            <div className="text-xs mt-0.5">{STATUS_LABELS[s]}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="이름, 회사, 이메일, 분야 검색..."
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
        <button onClick={() => { setFilter('all'); setSearch(''); }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">초기화</button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">파트너 신청이 없습니다</div>
      ) : (
        <div className="space-y-4">
          {filtered.map(partner => {
            const review = partner.email ? reviewSummaries[partner.email] : null;
            const kpi = partner.email ? kpiMap[partner.email] : null;
            return (
              <div key={partner.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Header */}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-gray-900">{partner.company || partner.name || '—'}</span>
                        {partner.partner_type && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{partner.partner_type}</span>
                        )}
                        {/* 평점 배지 */}
                        {review && review.count > 0 && (
                          <span className="flex items-center gap-1 text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 px-2 py-0.5 rounded-full font-semibold">
                            ★ {review.avgRating.toFixed(1)} / 리뷰 {review.count}건
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        {partner.name && <span>{partner.name}</span>}
                        {partner.email && <a href={`mailto:${partner.email}`} className="ml-2 text-blue-600 hover:underline">{partner.email}</a>}
                        {partner.phone && <span className="ml-2 text-gray-400">{partner.phone}</span>}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">신청일: {formatDateTime(partner.date)}</div>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border shrink-0 ${STATUS_COLORS[partner.partnerStatus]}`}>
                      {STATUS_LABELS[partner.partnerStatus]}
                    </span>
                  </div>

                  {/* KPI row */}
                  {kpi && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {[
                        { label: '견적', value: kpi.quoteCount + '건', color: 'text-blue-700 bg-blue-50 border-blue-200' },
                        { label: '응답', value: kpi.avgResponseHours != null ? kpi.avgResponseHours + 'h' : '—', color: 'text-gray-700 bg-gray-50 border-gray-200' },
                        { label: '승률', value: kpi.winRate != null ? kpi.winRate + '%' : '—', color: kpi.winRate != null && kpi.winRate >= 50 ? 'text-green-700 bg-green-50 border-green-200' : 'text-orange-700 bg-orange-50 border-orange-200' },
                        { label: '완료율', value: kpi.completionRate != null ? kpi.completionRate + '%' : '—', color: 'text-purple-700 bg-purple-50 border-purple-200' },
                        { label: '진행', value: kpi.activeCount + '건', color: 'text-amber-700 bg-amber-50 border-amber-200' },
                        { label: '완료', value: kpi.completedCount + '건', color: 'text-green-700 bg-green-50 border-green-200' },
                        ...(kpi.avgDaysOverdue ? [{ label: '평균연체', value: '+' + kpi.avgDaysOverdue + '일', color: 'text-red-700 bg-red-50 border-red-200' }] : []),
                      ].map(c => (
                        <span key={c.label} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>
                          {c.label} {c.value}
                        </span>
                      ))}
                      {kpi.totalRevenue > 0 && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border text-teal-700 bg-teal-50 border-teal-200">
                          매출 {kpi.totalRevenue >= 1_000_000 ? (kpi.totalRevenue / 1_000_000).toFixed(0) + '만' : kpi.totalRevenue.toLocaleString()}원
                        </span>
                      )}
                    </div>
                  )}

                  {/* Key info */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                    {partner.match_field && (
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs text-gray-400">매칭분야</div>
                        <div className="text-sm font-medium text-gray-800 truncate">{partner.match_field}</div>
                      </div>
                    )}
                    {partner.ref_count && (
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs text-gray-400">레퍼런스</div>
                        <div className="text-sm font-medium text-gray-800">{partner.ref_count}건</div>
                      </div>
                    )}
                    {partner.amount && (
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs text-gray-400">누적금액</div>
                        <div className="text-sm font-medium text-gray-800">{partner.amount}</div>
                      </div>
                    )}
                  </div>

                  {/* Tech/Experience (expandable) */}
                  {partner.tech_exp && (
                    <button onClick={() => setExpanded(expanded === partner.id ? null : partner.id)}
                      className="flex items-center gap-1 mt-3 text-xs text-blue-600 hover:underline">
                      {expanded === partner.id ? '▲ 기술/경험 접기' : '▼ 기술/경험 보기'}
                    </button>
                  )}
                  {expanded === partner.id && partner.tech_exp && (
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-700 whitespace-pre-wrap">{partner.tech_exp}</div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-4 flex-wrap">
                    {(['pending', 'contacted', 'approved', 'rejected'] as const).map(s => (
                      <button key={s} onClick={() => updateStatus(partner.id, s)}
                        disabled={partner.partnerStatus === s || saving === partner.id}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 ${
                          partner.partnerStatus === s
                            ? STATUS_COLORS[s] + ' border'
                            : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}>
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                    {/* 액세스 코드 발송 — 승인된 파트너에게만 */}
                    {partner.partnerStatus === 'approved' && partner.email && (
                      <>
                        <button
                          type="button"
                          onClick={() => void openTrustModal(partner.email!, partner.company || partner.name || partner.email!)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
                        >
                          차원별 신뢰 (7-5)
                        </button>
                        <button
                          onClick={async () => {
                            setSendingCode(partner.id);
                            setCodeMsg(prev => ({ ...prev, [partner.id]: '' }));
                            try {
                              const result = await sendAccessCode(partner.id, partner.email!, partner.company || partner.name || '');
                              if (result.ok) {
                                const msg = result.devCode
                                  ? `코드를 발송했습니다. [개발] 코드: ${result.devCode}`
                                  : '코드를 발송했습니다.';
                                setCodeMsg(prev => ({ ...prev, [partner.id]: msg }));
                              }
                            } catch {
                              setCodeMsg(prev => ({ ...prev, [partner.id]: '발송에 실패했습니다.' }));
                            } finally {
                              setSendingCode(null);
                            }
                          }}
                          disabled={sendingCode === partner.id}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        >
                          {sendingCode === partner.id ? '발송 중...' : '액세스 코드 발송'}
                        </button>
                      </>
                    )}
                  </div>
                  {codeMsg[partner.id] && (
                    <p className="mt-2 text-xs font-semibold text-blue-700">{codeMsg[partner.id]}</p>
                  )}

                  {/* Admin note */}
                  <div className="mt-3 flex gap-2">
                    <input value={notes[partner.id] || ''} onChange={e => setNotes(n => ({ ...n, [partner.id]: e.target.value }))}
                      placeholder="관리자 메모..."
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
                    <button onClick={() => saveNote(partner.id)} disabled={saving === partner.id + '_note'}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-white disabled:opacity-50">
                      저장
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {trustModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { setTrustModal(null); setTrustRows(null); }}
          onKeyDown={e => { if (e.key === 'Escape') { setTrustModal(null); setTrustRows(null); } }}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-100 p-5"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="trust-modal-title"
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <h2 id="trust-modal-title" className="text-base font-bold text-gray-900">차원별 신뢰 (Phase 7-5)</h2>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{trustModal.label}</p>
                <p className="text-[11px] text-gray-400 mt-0.5 font-mono truncate">{trustModal.email}</p>
              </div>
              <button
                type="button"
                onClick={() => { setTrustModal(null); setTrustRows(null); }}
                className="shrink-0 px-2 py-1 text-xs font-semibold rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
              >
                닫기
              </button>
            </div>
            <p className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1.5 mb-3">
              단일 신용점수 없음 — 축별로만 표시합니다.
            </p>
            {trustLoading || trustRows === null ? (
              <p className="text-sm text-gray-400 py-6 text-center">불러오는 중...</p>
            ) : trustRows.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">집계 데이터가 없습니다.</p>
            ) : (
              <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
                {trustRows.map(row => (
                  <li key={row.id} className="border border-gray-100 rounded-xl px-3 py-2">
                    <p className="text-xs font-bold text-gray-700">{row.labelKo}</p>
                    <p className="text-sm text-gray-900 mt-0.5">{row.displayKo}</p>
                    <p className="text-[10px] text-gray-400 mt-1">샘플 {row.sampleSize}건</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
