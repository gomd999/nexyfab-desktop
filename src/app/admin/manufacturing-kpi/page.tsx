'use client';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { formatMoney, formatNumber } from '@/lib/i18n/format';

import { useEffect, useState, useCallback, useMemo } from 'react';

interface ManufacturingKPI {
  funnel: {
    rfqTotal: number; rfqAssigned: number; rfqMtd: number; rfqMtdAssigned: number;
    quoteTotal: number; quoteMtd: number; quoteAccepted: number;
    contractTotal: number; contractRevenue: number;
  };
  rates: { assignRate: number; quoteRate: number; contractRate: number };
  avgResponseHours: number | null;
  rfqByStatus: Record<string, number>;
  quoteByStatus: Record<string, number>;
  contractByStatus: Record<string, number>;
  topFactories: { factory_id: string; factory_name: string; cnt: number; quoted: number }[];
  monthlyFunnel: { month: string; rfq_cnt: number }[];
}

function FunnelStep({
  label, value, subLabel, color, rate,
}: { label: string; value: string; subLabel?: string; color: string; rate?: string }) {
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="relative">
        <div style={{ background: color }} className="rounded-xl p-5 text-white text-center shadow-sm">
          <div className="text-3xl font-black mb-1">{value}</div>
          <div className="text-xs font-semibold opacity-80">{label}</div>
          {subLabel && <div className="text-[10px] opacity-60 mt-1">{subLabel}</div>}
        </div>
        {rate !== undefined && (
          <div className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 bg-white border border-gray-200 rounded-full text-xs font-bold text-gray-700 px-2 py-1 shadow-sm whitespace-nowrap">
            {rate}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusTable({ title, data, colors, labelForStatus, formatCount }: {
  title: string;
  data: Record<string, number>;
  colors: Record<string, string>;
  labelForStatus?: (status: string) => string;
  formatCount?: (count: number) => string;
}) {
  const total = Object.values(data).reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-1.5">
        {Object.entries(data).sort((a, b) => b[1] - a[1]).map(([status, cnt]) => (
          <div key={status} className="flex items-center gap-2">
            <div className="text-xs text-gray-600 w-28 truncate">{labelForStatus?.(status) ?? status}</div>
            <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
              <div
                style={{
                  width: `${Math.round((cnt / total) * 100)}%`,
                  background: colors[status] ?? '#6b7280',
                }}
                className="h-full rounded-full transition-all"
              />
            </div>
            <div className="text-xs font-bold text-gray-700 w-8 text-right">{formatCount?.(cnt) ?? cnt}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ManufacturingKpiPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const number = (value: number) => formatNumber(value, locale) ?? String(value);
  const percent = (value: number) => `${formatNumber(value, locale, { maximumFractionDigits: 1 }) ?? value}%`;
  const count = (value: number) => L(`${number(value)}건`, `${number(value)} records`);
  const statusLabel = (status: string) => ({
    pending: L('대기', 'Pending'), assigned: L('배정됨', 'Assigned'), quoted: L('견적됨', 'Quoted'),
    accepted: L('채택됨', 'Accepted'), rejected: L('거절됨', 'Rejected'), responded: L('응답함', 'Responded'),
    expired: L('만료됨', 'Expired'), contracted: L('계약 완료', 'Contracted'), in_progress: L('제조 중', 'In production'),
    quality_check: L('품질 검수', 'Quality check'), delivered: L('납품 완료', 'Delivered'),
    completed: L('완료', 'Completed'), cancelled: L('취소됨', 'Cancelled'),
  })[status] ?? status;
  const [data, setData] = useState<ManufacturingKPI | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/manufacturing-kpi');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{L('제조 퍼널 KPI', 'Manufacturing funnel KPI')}</h1>
        <div className="text-center py-20 text-gray-400">{L('불러오는 중...', 'Loading…')}</div>
      </div>
    );
  }

  const { funnel, rates, avgResponseHours, rfqByStatus, quoteByStatus, contractByStatus, topFactories, monthlyFunnel } = data;

  const RFQ_COLORS: Record<string, string> = {
    pending: '#6b7280', assigned: '#3b82f6', quoted: '#8b5cf6', accepted: '#10b981', rejected: '#ef4444',
  };
  const QUOTE_COLORS: Record<string, string> = {
    pending: '#6b7280', responded: '#3b82f6', accepted: '#10b981', rejected: '#ef4444', expired: '#9ca3af',
  };
  const CONTRACT_COLORS: Record<string, string> = {
    contracted: '#3b82f6', in_progress: '#f59e0b', quality_check: '#f97316',
    delivered: '#8b5cf6', completed: '#10b981', cancelled: '#ef4444',
  };

  // Monthly bar chart max
  const maxRfq = Math.max(...monthlyFunnel.map(m => m.rfq_cnt), 1);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{L('제조 퍼널 KPI', 'Manufacturing funnel KPI')}</h1>
          <p className="text-sm text-gray-500 mt-1">{L('RFQ → 배정 → 견적 → 계약 전환율 분석', 'Analyze conversion from RFQ → assignment → quote → contract')}</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
          {L('새로고침', 'Refresh')}
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: L('총 누적 RFQ', 'Total RFQs'), value: count(funnel.rfqTotal), color: 'text-blue-700' },
          { label: L('총 견적', 'Total quotes'), value: count(funnel.quoteTotal), color: 'text-purple-700' },
          { label: L('총 계약', 'Total contracts'), value: count(funnel.contractTotal), color: 'text-green-700' },
          { label: L('총 계약 금액', 'Total contract value'), value: formatMoney(funnel.contractRevenue, locale, 'KRW', { notation: 'compact', maximumFractionDigits: 1 }) ?? '-', color: 'text-emerald-700' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs text-gray-400 mb-1">{c.label}</div>
            <div className={`text-lg font-black ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Funnel */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="text-sm font-bold text-gray-700 mb-5">{L('전환 퍼널', 'Conversion funnel')}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <FunnelStep label="RFQ" value={number(funnel.rfqTotal)} subLabel={L(`이번 달 ${count(funnel.rfqMtd)}`, `This month ${count(funnel.rfqMtd)}`)} color="#3b82f6" rate={percent(rates.assignRate)} />
          <div className="text-gray-300 text-xl font-light hidden sm:block">→</div>
          <FunnelStep label={L('배정 완료', 'Assigned')} value={number(funnel.rfqAssigned)} subLabel={L(`이번 달 ${count(funnel.rfqMtdAssigned)}`, `This month ${count(funnel.rfqMtdAssigned)}`)} color="#8b5cf6" rate={percent(rates.quoteRate)} />
          <div className="text-gray-300 text-xl font-light hidden sm:block">→</div>
          <FunnelStep label={L('견적 접수', 'Quotes received')} value={number(funnel.quoteTotal)} subLabel={L(`이번 달 ${count(funnel.quoteMtd)}`, `This month ${count(funnel.quoteMtd)}`)} color="#f59e0b" rate={percent(rates.contractRate)} />
          <div className="text-gray-300 text-xl font-light hidden sm:block">→</div>
          <FunnelStep label={L('계약 체결', 'Contracts signed')} value={number(funnel.contractTotal)} subLabel={L(`채택 ${count(funnel.quoteAccepted)}`, `${count(funnel.quoteAccepted)} accepted`)} color="#10b981" />
        </div>

        {/* Conversion rate summary */}
        <div className="flex flex-wrap gap-4 mt-6 pt-4 border-t border-gray-100">
          {[
            { label: L('배정 전환율', 'Assignment conversion'), value: percent(rates.assignRate), color: '#8b5cf6' },
            { label: L('견적 전환율', 'Quote conversion'), value: percent(rates.quoteRate), color: '#f59e0b' },
            { label: L('계약 전환율', 'Contract conversion'), value: percent(rates.contractRate), color: '#10b981' },
            { label: L('평균 응답 시간', 'Average response time'), value: avgResponseHours != null ? L(`${number(avgResponseHours)}시간`, `${number(avgResponseHours)}h`) : '—', color: '#6b7280' },
          ].map(c => (
            <div key={c.label} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
              <span className="text-xs text-gray-500">{c.label}:</span>
              <span className="text-sm font-bold" style={{ color: c.color }}>{c.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status breakdown + Top factories */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Status breakdown */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="text-sm font-bold text-gray-700 mb-4">{L('상태별 분포', 'Distribution by status')}</div>
          <div className="space-y-5">
            <StatusTable title={L('RFQ 상태', 'RFQ status')} data={rfqByStatus} colors={RFQ_COLORS} labelForStatus={statusLabel} formatCount={number} />
            <StatusTable title={L('견적 상태', 'Quote status')} data={quoteByStatus} colors={QUOTE_COLORS} labelForStatus={statusLabel} formatCount={number} />
            <StatusTable title={L('계약 상태', 'Contract status')} data={contractByStatus} colors={CONTRACT_COLORS} labelForStatus={statusLabel} formatCount={number} />
          </div>
        </div>

        {/* Top factories */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="text-sm font-bold text-gray-700 mb-4">{L('배정 많은 공장 TOP 5', 'Top 5 factories by assignments')}</div>
          {topFactories.length === 0 ? (
            <p className="text-gray-400 text-sm py-8 text-center">{L('데이터 없음', 'No data')}</p>
          ) : (
            <div className="space-y-3">
              {topFactories.map((f, i) => {
                const quoteRate = f.cnt > 0 ? Math.round((f.quoted / f.cnt) * 100) : 0;
                return (
                  <div key={f.factory_id} className="flex items-center gap-3">
                    <span className="text-lg font-black text-gray-200 w-6 text-center">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800 truncate">{f.factory_name}</div>
                      <div className="text-xs text-gray-400">{L(`${count(f.cnt)} 배정 · 견적 ${count(f.quoted)} (${percent(quoteRate)})`, `${count(f.cnt)} assigned · ${count(f.quoted)} quoted (${percent(quoteRate)})`)}</div>
                    </div>
                    <div className="w-24">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${quoteRate}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Monthly RFQ trend */}
      {monthlyFunnel.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="text-sm font-bold text-gray-700 mb-4">{L('월별 RFQ 추이 (최근 6개월)', 'Monthly RFQ trend (last 6 months)')}</div>
          <div className="flex items-end gap-3 h-32">
            {monthlyFunnel.map(m => {
              const pct = Math.round((m.rfq_cnt / maxRfq) * 100);
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold text-blue-700">{number(m.rfq_cnt)}</span>
                  <div className="w-full bg-blue-500 rounded-t-md transition-all" style={{ height: `${Math.max(4, pct)}%` }} />
                  <span className="text-[9px] text-gray-400 whitespace-nowrap">{m.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
