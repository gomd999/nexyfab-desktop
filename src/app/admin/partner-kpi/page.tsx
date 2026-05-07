'use client';

import { useEffect, useState, useCallback } from 'react';
interface PartnerKPI {
  factoryId: string;
  factoryName: string;
  partnerEmail: string | null;
  quoteCount: number;
  avgResponseHours: number | null;
  winRate: number | null;
  completionRate: number | null;
  activeCount: number;
  completedCount: number;
  cancelledCount: number;
  avgDaysOverdue: number | null;
  totalRevenue: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtKRW(n: number) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + '억원';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + '만원';
  return n.toLocaleString('ko-KR') + '원';
}

function RateBar({ value, color }: { value: number | null; color: string }) {
  const pct = value ?? 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 32, textAlign: 'right' }}>
        {value != null ? value + '%' : '—'}
      </span>
    </div>
  );
}

function KpiChip({ label, value, unit = '', color = '#6b7280' }: { label: string; value: string | number | null; unit?: string; color?: string }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '8px 14px', minWidth: 90 }}>
      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color }}>
        {value != null ? value + unit : '—'}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PartnerKpiPage() {
  const [kpis, setKpis] = useState<PartnerKPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof PartnerKPI>('completedCount');
  const [sortDesc, setSortDesc] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/partner-kpi');
      const data = await res.json();
      setKpis(data.partners ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: keyof PartnerKPI) => {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  const filtered = kpis
    .filter(k => {
      const q = search.toLowerCase();
      return !q || k.factoryName.toLowerCase().includes(q) || (k.partnerEmail ?? '').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });

  // ── Aggregate stats ──────────────────────────────────────────────────────────
  const totalQuotes = kpis.reduce((s, k) => s + k.quoteCount, 0);
  const totalCompleted = kpis.reduce((s, k) => s + k.completedCount, 0);
  const totalActive = kpis.reduce((s, k) => s + k.activeCount, 0);
  const totalRevenue = kpis.reduce((s, k) => s + k.totalRevenue, 0);
  const avgWinRate = kpis.length > 0
    ? Math.round(kpis.filter(k => k.winRate != null).reduce((s, k) => s + (k.winRate ?? 0), 0) / kpis.filter(k => k.winRate != null).length)
    : null;

  const colBtn = (key: keyof PartnerKPI, label: string) => (
    <button onClick={() => handleSort(key)} style={{
      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
      fontWeight: 600, fontSize: 11, color: sortKey === key ? '#1d4ed8' : '#6b7280',
      display: 'flex', alignItems: 'center', gap: 3,
    }}>
      {label}{sortKey === key ? (sortDesc ? ' ▼' : ' ▲') : ''}
    </button>
  );

  return (
    <div className="max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">파트너 성과 분석</h1>
          <p className="text-sm text-gray-500 mt-1">공장별 응답 속도 · 승률 · 완료율 · 매출 KPI</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {loading ? '로딩 중...' : '새로고침'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: '공장 수', value: kpis.length, unit: '개', color: '#4f46e5' },
          { label: '총 견적', value: totalQuotes, unit: '건', color: '#0284c7' },
          { label: '완료 계약', value: totalCompleted, unit: '건', color: '#16a34a' },
          { label: '진행 중', value: totalActive, unit: '건', color: '#d97706' },
          { label: '평균 승률', value: avgWinRate, unit: '%', color: '#db2777' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
            <div className="text-xs text-gray-400 mb-1">{c.label}</div>
            <div className="text-2xl font-extrabold" style={{ color: c.color }}>
              {c.value != null ? c.value.toLocaleString() + c.unit : '—'}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex items-center gap-4 shadow-sm">
        <div className="text-xs text-gray-400">누적 매출 (비취소 계약)</div>
        <div className="text-xl font-extrabold text-green-700">{fmtKRW(totalRevenue)}</div>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="공장명 또는 이메일 검색..."
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
        {search && (
          <button onClick={() => setSearch('')}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">초기화</button>
        )}
      </div>

      {/* ── Top Performers ───────────────────────────────────────────────────── */}
      {!loading && kpis.filter(k => k.winRate != null).length > 0 && (() => {
        const medals = ['🥇', '🥈', '🥉'];
        const top3 = [...kpis]
          .filter(k => k.winRate != null)
          .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
          .slice(0, 3);
        return (
          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-700 mb-3">Top Performers — 승률 TOP 3</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {top3.map((k, i) => (
                <div key={k.factoryId} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
                  <span style={{ fontSize: 28, lineHeight: 1 }}>{medals[i]}</span>
                  <div className="min-w-0">
                    <div className="font-bold text-gray-900 truncate text-sm">{k.factoryName}</div>
                    {k.partnerEmail && <div className="text-xs text-gray-400 truncate">{k.partnerEmail}</div>}
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-lg font-extrabold text-pink-600">{k.winRate}%</span>
                      <span className="text-xs text-gray-400">승률</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">완료 {k.completedCount}건 · 견적 {k.quoteCount}건</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Needs Attention (overdue) ─────────────────────────────────────────── */}
      {!loading && kpis.filter(k => k.avgDaysOverdue != null && k.avgDaysOverdue > 0).length > 0 && (() => {
        const overdue = kpis.filter(k => k.avgDaysOverdue != null && k.avgDaysOverdue > 0)
          .sort((a, b) => (b.avgDaysOverdue ?? 0) - (a.avgDaysOverdue ?? 0));
        return (
          <div className="mb-6">
            <h2 className="text-sm font-bold text-red-700 mb-3">Needs Attention — 연체 파트너</h2>
            <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden shadow-sm">
              {overdue.map((k, i) => (
                <div key={k.factoryId}
                  className={`flex items-center gap-4 px-5 py-3 text-sm${i < overdue.length - 1 ? ' border-b border-red-100' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-red-900">{k.factoryName}</span>
                    {k.partnerEmail && <span className="text-xs text-red-400 ml-2">{k.partnerEmail}</span>}
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-red-600 bg-red-100 border border-red-300 px-2.5 py-1 rounded-full">
                      평균 +{k.avgDaysOverdue}일 연체
                    </span>
                  </div>
                  <div className="text-xs text-red-400">진행 {k.activeCount}건</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Response Time Leaderboard ─────────────────────────────────────────── */}
      {!loading && kpis.filter(k => k.avgResponseHours != null).length > 0 && (() => {
        const ranked = [...kpis]
          .filter(k => k.avgResponseHours != null)
          .sort((a, b) => (a.avgResponseHours ?? 0) - (b.avgResponseHours ?? 0));
        return (
          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-700 mb-3">Response Time Leaderboard — 응답 속도 순위</h2>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div style={{ display: 'grid', gridTemplateColumns: '40px 2fr 1fr 1fr 1fr' }}
                className="bg-gray-50 border-b px-4 py-2 text-xs font-semibold text-gray-500">
                <div>#</div>
                <div>공장 / 파트너</div>
                <div style={{ textAlign: 'right' }}>평균 응답</div>
                <div style={{ textAlign: 'right' }}>견적 수</div>
                <div style={{ textAlign: 'right' }}>승률</div>
              </div>
              {ranked.map((k, i) => {
                const isFastest = i === 0;
                const hrs = k.avgResponseHours ?? 0;
                const barColor = hrs <= 4 ? '#16a34a' : hrs <= 12 ? '#d97706' : '#dc2626';
                return (
                  <div key={k.factoryId}
                    style={{ display: 'grid', gridTemplateColumns: '40px 2fr 1fr 1fr 1fr' }}
                    className={`px-4 py-2.5 border-b text-sm items-center${isFastest ? ' bg-green-50' : ''}`}>
                    <div className="text-xs font-bold text-gray-400">{i + 1}</div>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate flex items-center gap-1">
                        {isFastest && <span title="Fastest responder">⚡</span>}
                        {k.factoryName}
                      </div>
                      {k.partnerEmail && <div className="text-xs text-gray-400 truncate">{k.partnerEmail}</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="font-bold text-sm" style={{ color: barColor }}>{k.avgResponseHours}h</span>
                    </div>
                    <div style={{ textAlign: 'right' }} className="text-gray-600">{k.quoteCount}건</div>
                    <div style={{ textAlign: 'right' }}>
                      {k.winRate != null
                        ? <span className="font-semibold text-pink-600">{k.winRate}%</span>
                        : <span className="text-gray-300">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">데이터 없음</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 80px', gap: 0 }}
            className="border-b bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-500">
            <div>공장 / 파트너</div>
            <div style={{ textAlign: 'right' }}>{colBtn('quoteCount', '견적')}</div>
            <div style={{ textAlign: 'right' }}>{colBtn('avgResponseHours', '응답h')}</div>
            <div style={{ paddingLeft: 8 }}>{colBtn('winRate', '승률')}</div>
            <div style={{ paddingLeft: 8 }}>{colBtn('completionRate', '완료율')}</div>
            <div style={{ textAlign: 'right' }}>{colBtn('activeCount', '진행')}</div>
            <div style={{ textAlign: 'right' }}>{colBtn('completedCount', '완료')}</div>
            <div style={{ textAlign: 'right' }}>{colBtn('totalRevenue', '매출')}</div>
            <div style={{ textAlign: 'center' }}>연체</div>
          </div>

          {filtered.map(k => (
            <div key={k.factoryId}>
              {/* Row */}
              <div
                onClick={() => setExpanded(expanded === k.factoryId ? null : k.factoryId)}
                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 80px', gap: 0, cursor: 'pointer' }}
                className="px-4 py-3 border-b hover:bg-gray-50 transition-colors text-sm items-center"
              >
                {/* Name */}
                <div>
                  <div className="font-semibold text-gray-900 truncate">{k.factoryName}</div>
                  {k.partnerEmail && (
                    <div className="text-xs text-gray-400 truncate">{k.partnerEmail}</div>
                  )}
                </div>
                {/* Quote count */}
                <div style={{ textAlign: 'right' }} className="font-bold text-blue-700">{k.quoteCount}</div>
                {/* Avg response */}
                <div style={{ textAlign: 'right' }} className="text-gray-700">
                  {k.avgResponseHours != null ? k.avgResponseHours + 'h' : '—'}
                </div>
                {/* Win rate bar */}
                <div style={{ paddingLeft: 8 }}><RateBar value={k.winRate} color="#db2777" /></div>
                {/* Completion rate bar */}
                <div style={{ paddingLeft: 8 }}><RateBar value={k.completionRate} color="#16a34a" /></div>
                {/* Active */}
                <div style={{ textAlign: 'right' }} className="text-amber-600 font-semibold">{k.activeCount}</div>
                {/* Completed */}
                <div style={{ textAlign: 'right' }} className="text-green-700 font-semibold">{k.completedCount}</div>
                {/* Revenue */}
                <div style={{ textAlign: 'right' }} className="text-xs text-gray-700 font-semibold">{fmtKRW(k.totalRevenue)}</div>
                {/* Overdue */}
                <div style={{ textAlign: 'center' }}>
                  {k.avgDaysOverdue != null ? (
                    <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      +{k.avgDaysOverdue}일
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === k.factoryId && (
                <div className="bg-blue-50 border-b px-6 py-4">
                  <div className="flex flex-wrap gap-3 mb-3">
                    <KpiChip label="총 견적" value={k.quoteCount} unit="건" color="#1d4ed8" />
                    <KpiChip label="평균 응답" value={k.avgResponseHours} unit="h" color="#0284c7" />
                    <KpiChip label="승률" value={k.winRate} unit="%" color="#db2777" />
                    <KpiChip label="완료율" value={k.completionRate} unit="%" color="#16a34a" />
                    <KpiChip label="진행 계약" value={k.activeCount} unit="건" color="#d97706" />
                    <KpiChip label="완료 계약" value={k.completedCount} unit="건" color="#16a34a" />
                    <KpiChip label="취소 계약" value={k.cancelledCount} unit="건" color="#6b7280" />
                    <KpiChip label="평균 연체" value={k.avgDaysOverdue} unit="일" color="#dc2626" />
                  </div>
                  <div className="flex gap-4 mt-3 flex-wrap">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">승률</div>
                      <RateBar value={k.winRate} color="#db2777" />
                    </div>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div className="text-xs text-gray-500 mb-1">완료율</div>
                      <RateBar value={k.completionRate} color="#16a34a" />
                    </div>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-green-800">
                    누적 매출: {fmtKRW(k.totalRevenue)}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <a
                      href={`/admin/contracts?factory=${encodeURIComponent(k.factoryName)}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      계약 목록 →
                    </a>
                    {k.partnerEmail && (
                      <a
                        href={`/admin/partners?search=${encodeURIComponent(k.partnerEmail)}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        파트너 상세 →
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          Section 1 — 납기 준수율 랭킹
      ══════════════════════════════════════════════════════════════════════════ */}
      <DeliveryRankingSection kpis={kpis} />

      {/* ══════════════════════════════════════════════════════════════════════════
          Section 2 — 월별 수주 추이 차트
      ══════════════════════════════════════════════════════════════════════════ */}
      <MonthlyOrderChart />

      {/* ══════════════════════════════════════════════════════════════════════════
          Section 3 — 계약 상태 분포
      ══════════════════════════════════════════════════════════════════════════ */}
      <ContractStatusChart />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DeliveryRankingSection({ kpis }: { kpis: PartnerKPI[] }) {
  const rows = [...kpis]
    .filter(k => k.completedCount + k.activeCount > 0)
    .sort((a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0))
    .slice(0, 8)
    .map(k => ({
      name: k.factoryName,
      total: k.completedCount + k.activeCount + k.cancelledCount,
      onTime: k.completedCount,
      rate: k.completionRate ?? 0,
      avgDelayDays: k.avgDaysOverdue,
    }));

  if (rows.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-base font-bold text-gray-800 mb-1">납기 준수율 랭킹</h2>
      <p className="text-xs text-gray-400 mb-4">파트너별 완료 계약 기준 준수율</p>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div
          style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}
          className="bg-gray-50 border-b px-4 py-2.5 text-xs font-semibold text-gray-500"
        >
          <div>파트너명</div>
          <div style={{ textAlign: 'right' }}>총 계약</div>
          <div style={{ textAlign: 'right' }}>완료</div>
          <div style={{ textAlign: 'right' }}>준수율 (%)</div>
          <div style={{ textAlign: 'right' }}>평균 지연일</div>
        </div>
        {rows.map((row, i) => {
          const rateColor = row.rate >= 90 ? '#16a34a' : row.rate >= 75 ? '#d97706' : '#dc2626';
          return (
            <div
              key={row.name}
              style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}
              className={`px-4 py-3 border-b text-sm items-center${i === 0 ? ' bg-green-50' : ''}`}
            >
              <div className="font-semibold text-gray-900 flex items-center gap-2">
                {i === 0 && <span title="Best">🏅</span>}
                {row.name}
              </div>
              <div style={{ textAlign: 'right' }} className="text-gray-600">{row.total}</div>
              <div style={{ textAlign: 'right' }} className="text-gray-600">{row.onTime}</div>
              <div style={{ textAlign: 'right' }}>
                <span className="font-bold" style={{ color: rateColor }}>{row.rate}%</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                {row.avgDelayDays != null
                  ? <span className="text-red-500 font-semibold">+{row.avgDelayDays}일</span>
                  : <span className="text-gray-300">—</span>
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChartsData {
  monthly: { month: string; partners: Record<string, number> }[];
  partnerColors: Record<string, string>;
  statusDist: { label: string; count: number; color: string }[];
}

function MonthlyOrderChart() {
  const [data, setData] = useState<ChartsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/partner-kpi/charts')
      .then(r => r.json())
      .then(d => setData(d as ChartsData))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mt-8 text-sm text-gray-400">차트 로딩 중…</div>;
  if (!data || data.monthly.length === 0) return null;

  const partners = Object.keys(data.partnerColors);
  if (partners.length === 0) return null;

  const maxVal = Math.max(...data.monthly.flatMap(m => partners.map(p => m.partners[p] ?? 0)), 1);
  const chartH = 140;
  const barW = 18;
  const groupGap = 32;
  const leftPad = 32;
  const topPad = 10;
  const totalWidth = leftPad + data.monthly.length * (partners.length * (barW + 3) + groupGap);

  return (
    <div className="mt-8">
      <h2 className="text-base font-bold text-gray-800 mb-1">월별 수주 추이 (Top {partners.length} 파트너)</h2>
      <p className="text-xs text-gray-400 mb-4">최근 6개월 계약 건수</p>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 overflow-x-auto">
        <div className="flex gap-4 mb-4 flex-wrap">
          {partners.map(p => (
            <div key={p} className="flex items-center gap-1.5">
              <div style={{ width: 12, height: 12, borderRadius: 3, background: data.partnerColors[p] }} />
              <span className="text-xs text-gray-600">{p}</span>
            </div>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${totalWidth} ${chartH + topPad + 28}`}
          style={{ width: '100%', minWidth: 480, height: chartH + topPad + 36 }}
          aria-label="월별 수주 추이 차트"
        >
          {[0, 0.25, 0.5, 0.75, 1].map(frac => {
            const y = topPad + chartH - frac * chartH;
            return (
              <g key={frac}>
                <line x1={leftPad - 4} x2={totalWidth - 4} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                <text x={leftPad - 6} y={y + 4} fontSize={9} fill="#9ca3af" textAnchor="end">{Math.round(frac * maxVal)}</text>
              </g>
            );
          })}
          {data.monthly.map((monthData, mi) => {
            const groupX = leftPad + mi * (partners.length * (barW + 3) + groupGap);
            return (
              <g key={monthData.month}>
                {partners.map((p, pi) => {
                  const val = monthData.partners[p] ?? 0;
                  const barH = (val / maxVal) * chartH;
                  const x = groupX + pi * (barW + 3);
                  const y = topPad + chartH - barH;
                  return (
                    <g key={p}>
                      <rect x={x} y={y} width={barW} height={barH} rx={3} fill={data.partnerColors[p]} opacity={0.9} />
                      {val > 0 && <text x={x + barW / 2} y={y - 3} fontSize={8} fill="#6b7280" textAnchor="middle">{val}</text>}
                    </g>
                  );
                })}
                <text x={groupX + (partners.length * (barW + 3)) / 2 - 3} y={topPad + chartH + 16} fontSize={10} fill="#6b7280" textAnchor="middle">
                  {monthData.month}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function ContractStatusChart() {
  const [data, setData] = useState<ChartsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/partner-kpi/charts')
      .then(r => r.json())
      .then(d => setData(d as ChartsData))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!data || data.statusDist.length === 0) return null;

  const total = data.statusDist.reduce((s, q) => s + q.count, 0);
  const max = Math.max(...data.statusDist.map(q => q.count), 1);

  return (
    <div className="mt-8 mb-8">
      <h2 className="text-base font-bold text-gray-800 mb-1">계약 상태 분포</h2>
      <p className="text-xs text-gray-400 mb-4">전체 계약 상태별 건수</p>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="space-y-3">
          {data.statusDist.map(q => {
            const pct = Math.round((q.count / max) * 100);
            const share = total > 0 ? ((q.count / total) * 100).toFixed(1) : '0';
            return (
              <div key={q.label} className="flex items-center gap-3">
                <div className="text-xs font-semibold text-gray-600 shrink-0" style={{ width: 80 }}>{q.label}</div>
                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                  <div style={{ width: `${pct}%`, background: q.color, height: '100%', borderRadius: 4, transition: 'width 0.4s ease' }} />
                </div>
                <span className="text-xs font-bold shrink-0" style={{ color: q.color, minWidth: 28, textAlign: 'right' }}>{q.count}</span>
                <span className="text-xs text-gray-400 shrink-0" style={{ minWidth: 38, textAlign: 'right' }}>{share}%</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400 text-right">
          전체 {total}건
        </div>
      </div>
    </div>
  );
}
