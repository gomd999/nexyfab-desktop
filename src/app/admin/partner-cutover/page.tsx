'use client';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

// Admin: legacy → SSO cutover dashboard.
//
// Visualises `nf_partner_legacy_session_hits` so the platform team can
// see how many partners still authenticate via the deprecated
// access-code session and pick a cutover date with confidence.
//
// Surface:
//   - 4 KPI cards (total, distinct partners, 7d, 30d)
//   - 30-day sparkline + table
//   - Top 20 partners still on legacy with email/company resolved
//
// Korean canonical (admin UI is KR-only by convention).

import { useCallback, useEffect, useMemo, useState } from 'react';

interface DailyRow { day: string; hits: number; partners: number; }
interface TopRow {
  partner_id: string;
  hits: number;
  lastDay: string;
  email?: string;
  company?: string;
}
interface Totals {
  totalHits: number;
  distinctPartners: number;
  last7DayHits: number;
  last30DayHits: number;
}

interface CutoverResp {
  daily: DailyRow[];
  topPartners: TopRow[];
  totals: Totals;
  asOf: string;
}

function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

function fmtDay(day: string): string {
  // day is `YYYY-MM-DD`. Show as `MM/DD`.
  return day.slice(5).replace('-', '/');
}

function Sparkline({ data }: { data: DailyRow[] }) {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  if (data.length === 0) return <div className="text-xs text-gray-400">{L('데이터 없음', 'No data')}</div>;
  const sorted = [...data].sort((a, b) => a.day.localeCompare(b.day));
  const max = Math.max(1, ...sorted.map(d => d.hits));
  const w = 600;
  const h = 80;
  const step = sorted.length > 1 ? w / (sorted.length - 1) : 0;
  const points = sorted.map((d, i) => `${i * step},${h - (d.hits / max) * (h - 8) - 4}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
      />
      {sorted.map((d, i) => (
        <circle
          key={d.day}
          cx={i * step}
          cy={h - (d.hits / max) * (h - 8) - 4}
          r="2.5"
          fill="#2563eb"
        >
          <title>{L(d.day + ': ' + d.hits + ' hits / ' + d.partners + ' partners', d.day + ': ' + d.hits + ' hits / ' + d.partners + ' partners')}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function PartnerCutoverPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [resp, setResp] = useState<CutoverResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/admin/partner-cutover?days=${days}&top=20`, { cache: 'no-store' });
      if (!r.ok) {
        setError(r.status === 403 ? L('권한이 없습니다.', 'You do not have permission.') : L('데이터를 불러오지 못했습니다.', 'Unable to load data.'));
        return;
      }
      const data = (await r.json()) as CutoverResp;
      setResp(data);
    } catch {
      setError(L('서버 오류가 발생했습니다.', 'A server error occurred.'));
    } finally {
      setLoading(false);
    }
  }, [days, L]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{L('파트너 SSO 컷오버', 'Partner SSO cutover')}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {L('legacy 액세스 코드 세션 사용 현황. NexySys 통합 SSO 전환 시기를 판단합니다.', 'Legacy access-code session usage. Use this to decide when to move to NexySys unified SSO.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600"
          >
            <option value={7}>{L('최근 7일', 'Last 7 days')}</option>
            <option value={30}>{L('최근 30일', 'Last 30 days')}</option>
            <option value={90}>{L('최근 90일', 'Last 90 days')}</option>
          </select>
          <button
            onClick={load}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {L('새로고침', 'Refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-semibold">
          {error}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="p-4 rounded-xl border border-gray-200 bg-white">
          <div className="text-xs text-gray-500">{L('총 legacy hit', 'Total legacy hits')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(resp?.totals.totalHits ?? 0, locale)}</div>
        </div>
        <div className="p-4 rounded-xl border border-gray-200 bg-white">
          <div className="text-xs text-gray-500">{L('distinct 파트너', 'Distinct partners')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(resp?.totals.distinctPartners ?? 0, locale)}</div>
        </div>
        <div className="p-4 rounded-xl border border-gray-200 bg-white">
          <div className="text-xs text-gray-500">{L('최근 7일 hit', 'Hits in the last 7 days')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(resp?.totals.last7DayHits ?? 0, locale)}</div>
        </div>
        <div className="p-4 rounded-xl border border-gray-200 bg-white">
          <div className="text-xs text-gray-500">{L('최근 30일 hit', 'Hits in the last 30 days')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(resp?.totals.last30DayHits ?? 0, locale)}</div>
        </div>
      </div>

      {/* Sparkline */}
      <div className="mb-6 p-4 rounded-xl border border-gray-200 bg-white">
        <div className="text-sm font-semibold text-gray-700 mb-3">{L('일별 legacy hit 추이', 'Daily legacy hit trend')}</div>
        {loading && !resp ? (
          <div className="text-xs text-gray-400">{L('불러오는 중...', 'Loading…')}</div>
        ) : (
          <Sparkline data={resp?.daily ?? []} />
        )}
      </div>

      {/* Daily table */}
      <div className="mb-6 p-4 rounded-xl border border-gray-200 bg-white">
        <div className="text-sm font-semibold text-gray-700 mb-3">{L('일별 상세', 'Daily details')}</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="py-2 pr-3 font-semibold">{L('날짜', 'Date')}</th>
              <th className="py-2 pr-3 font-semibold text-right">hits</th>
              <th className="py-2 font-semibold text-right">{L('distinct 파트너', 'Distinct partners')}</th>
            </tr>
          </thead>
          <tbody>
            {(resp?.daily ?? []).map(d => (
              <tr key={d.day} className="border-b border-gray-50">
                <td className="py-2 pr-3 text-gray-700 font-mono text-xs">{fmtDay(d.day)}</td>
                <td className="py-2 pr-3 text-right text-gray-900 font-semibold">{fmt(d.hits, locale)}</td>
                <td className="py-2 text-right text-gray-500">{fmt(d.partners, locale)}</td>
              </tr>
            ))}
            {(resp?.daily ?? []).length === 0 && !loading && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-xs text-gray-400">{L('데이터 없음 (모든 파트너가 이미 SSO 전환 완료)', 'No data (all partners have already moved to SSO)')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Top partners */}
      <div className="p-4 rounded-xl border border-gray-200 bg-white">
        <div className="text-sm font-semibold text-gray-700 mb-1">
          {L('legacy 세션을 가장 많이 쓰는 파트너 (Top 20)', 'Partners using legacy sessions the most (Top 20)')}
        </div>
        <p className="text-xs text-gray-400 mb-3">
          {L('개별 알림 / 영업 컨택 후보. 마지막 hit 날짜 기준으로 비활성 여부를 판단하세요.', 'Candidates for individual alerts or sales contact. Check activity using the last hit date.')}
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="py-2 pr-3 font-semibold">{L('회사', 'Company')}</th>
              <th className="py-2 pr-3 font-semibold">{L('이메일', 'Email')}</th>
              <th className="py-2 pr-3 font-semibold text-right">hits</th>
              <th className="py-2 font-semibold">{L('마지막 사용일', 'Last used')}</th>
            </tr>
          </thead>
          <tbody>
            {(resp?.topPartners ?? []).map(p => (
              <tr key={p.partner_id} className="border-b border-gray-50">
                <td className="py-2 pr-3 text-gray-800 font-medium">{p.company || <span className="text-gray-400">—</span>}</td>
                <td className="py-2 pr-3 text-gray-600">{p.email || <span className="text-gray-400 font-mono text-xs">{p.partner_id.slice(0, 12)}…</span>}</td>
                <td className="py-2 pr-3 text-right text-gray-900 font-semibold">{fmt(p.hits, locale)}</td>
                <td className="py-2 text-gray-500 font-mono text-xs">{p.lastDay}</td>
              </tr>
            ))}
            {(resp?.topPartners ?? []).length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-xs text-gray-400">{L('대상 파트너 없음', 'No target partners')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {resp?.asOf && (
        <p className="mt-4 text-right text-[11px] text-gray-400">
          {L('기준 시각:', 'As of:')} {new Date(resp.asOf).toLocaleString(locale)}
        </p>
      )}
    </div>
  );
}
