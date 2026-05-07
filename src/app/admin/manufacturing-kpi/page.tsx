'use client';

import { useEffect, useState, useCallback } from 'react';

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

function won(n: number) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + '억원';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + '만원';
  return n.toLocaleString('ko-KR') + '원';
}

function FunnelStep({
  label, value, subLabel, color, rate,
}: { label: string; value: number; subLabel?: string; color: string; rate?: number }) {
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="relative">
        <div style={{ background: color }} className="rounded-xl p-5 text-white text-center shadow-sm">
          <div className="text-3xl font-black mb-1">{value.toLocaleString()}</div>
          <div className="text-xs font-semibold opacity-80">{label}</div>
          {subLabel && <div className="text-[10px] opacity-60 mt-1">{subLabel}</div>}
        </div>
        {rate !== undefined && (
          <div className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 bg-white border border-gray-200 rounded-full text-xs font-bold text-gray-700 px-2 py-1 shadow-sm whitespace-nowrap">
            {rate}%
          </div>
        )}
      </div>
    </div>
  );
}

function StatusTable({ title, data, colors }: {
  title: string;
  data: Record<string, number>;
  colors: Record<string, string>;
}) {
  const total = Object.values(data).reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-1.5">
        {Object.entries(data).sort((a, b) => b[1] - a[1]).map(([status, cnt]) => (
          <div key={status} className="flex items-center gap-2">
            <div className="text-xs text-gray-600 w-28 truncate">{status}</div>
            <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
              <div
                style={{
                  width: `${Math.round((cnt / total) * 100)}%`,
                  background: colors[status] ?? '#6b7280',
                }}
                className="h-full rounded-full transition-all"
              />
            </div>
            <div className="text-xs font-bold text-gray-700 w-8 text-right">{cnt}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ManufacturingKpiPage() {
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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">제조 퍼널 KPI</h1>
        <div className="text-center py-20 text-gray-400">불러오는 중...</div>
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
          <h1 className="text-2xl font-bold text-gray-900">제조 퍼널 KPI</h1>
          <p className="text-sm text-gray-500 mt-1">RFQ → 배정 → 견적 → 계약 전환율 분석</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
          새로고침
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: '총 누적 RFQ', value: funnel.rfqTotal.toLocaleString() + '건', color: 'text-blue-700' },
          { label: '총 견적', value: funnel.quoteTotal.toLocaleString() + '건', color: 'text-purple-700' },
          { label: '총 계약', value: funnel.contractTotal.toLocaleString() + '건', color: 'text-green-700' },
          { label: '총 계약 금액', value: won(funnel.contractRevenue), color: 'text-emerald-700' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs text-gray-400 mb-1">{c.label}</div>
            <div className={`text-lg font-black ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Funnel */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="text-sm font-bold text-gray-700 mb-5">전환 퍼널</div>
        <div className="flex items-center gap-2 flex-wrap">
          <FunnelStep label="RFQ" value={funnel.rfqTotal} subLabel={`이번달 ${funnel.rfqMtd}건`} color="#3b82f6" rate={rates.assignRate} />
          <div className="text-gray-300 text-xl font-light hidden sm:block">→</div>
          <FunnelStep label="배정 완료" value={funnel.rfqAssigned} subLabel={`이번달 ${funnel.rfqMtdAssigned}건`} color="#8b5cf6" rate={rates.quoteRate} />
          <div className="text-gray-300 text-xl font-light hidden sm:block">→</div>
          <FunnelStep label="견적 접수" value={funnel.quoteTotal} subLabel={`이번달 ${funnel.quoteMtd}건`} color="#f59e0b" rate={rates.contractRate} />
          <div className="text-gray-300 text-xl font-light hidden sm:block">→</div>
          <FunnelStep label="계약 체결" value={funnel.contractTotal} subLabel={`채택 ${funnel.quoteAccepted}건`} color="#10b981" />
        </div>

        {/* Conversion rate summary */}
        <div className="flex flex-wrap gap-4 mt-6 pt-4 border-t border-gray-100">
          {[
            { label: '배정 전환율', value: rates.assignRate + '%', color: '#8b5cf6' },
            { label: '견적 전환율', value: rates.quoteRate + '%', color: '#f59e0b' },
            { label: '계약 전환율', value: rates.contractRate + '%', color: '#10b981' },
            { label: '평균 응답 시간', value: avgResponseHours != null ? avgResponseHours + 'h' : '—', color: '#6b7280' },
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
          <div className="text-sm font-bold text-gray-700 mb-4">상태별 분포</div>
          <div className="space-y-5">
            <StatusTable title="RFQ 상태" data={rfqByStatus} colors={RFQ_COLORS} />
            <StatusTable title="견적 상태" data={quoteByStatus} colors={QUOTE_COLORS} />
            <StatusTable title="계약 상태" data={contractByStatus} colors={CONTRACT_COLORS} />
          </div>
        </div>

        {/* Top factories */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="text-sm font-bold text-gray-700 mb-4">배정 많은 공장 TOP 5</div>
          {topFactories.length === 0 ? (
            <p className="text-gray-400 text-sm py-8 text-center">데이터 없음</p>
          ) : (
            <div className="space-y-3">
              {topFactories.map((f, i) => {
                const quoteRate = f.cnt > 0 ? Math.round((f.quoted / f.cnt) * 100) : 0;
                return (
                  <div key={f.factory_id} className="flex items-center gap-3">
                    <span className="text-lg font-black text-gray-200 w-6 text-center">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800 truncate">{f.factory_name}</div>
                      <div className="text-xs text-gray-400">{f.cnt}건 배정 · 견적 {f.quoted}건 ({quoteRate}%)</div>
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
          <div className="text-sm font-bold text-gray-700 mb-4">월별 RFQ 추이 (최근 6개월)</div>
          <div className="flex items-end gap-3 h-32">
            {monthlyFunnel.map(m => {
              const pct = Math.round((m.rfq_cnt / maxRfq) * 100);
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold text-blue-700">{m.rfq_cnt}</span>
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
