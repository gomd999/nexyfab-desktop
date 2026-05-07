'use client';

import { use, useEffect, useState, useCallback } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  quoteCount: number;
  winRate: number | null;
  activeOrders: number;
  totalRevenueMYR: number;
  avgResponseHours: number | null;
}

interface RfqItem {
  id: string;
  shape_name: string | null;
  status: string;
  created_at: number;
  assigned_at: number | null;
  quantity: number | null;
  material: string | null;
}

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface DaySchedule {
  enabled: boolean;
  from: string;
  to: string;
}

interface DashboardData {
  factory: { id: string; name: string; region: string };
  kpis: KPIs;
  rfqs: RfqItem[];
  availability: { schedule: Record<DayKey, DaySchedule> };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS: { key: DayKey; ko: string; en: string }[] = [
  { key: 'mon', ko: '월', en: 'Mon' },
  { key: 'tue', ko: '화', en: 'Tue' },
  { key: 'wed', ko: '수', en: 'Wed' },
  { key: 'thu', ko: '목', en: 'Thu' },
  { key: 'fri', ko: '금', en: 'Fri' },
  { key: 'sat', ko: '토', en: 'Sat' },
  { key: 'sun', ko: '일', en: 'Sun' },
];

const DEFAULT_SCHEDULE: Record<DayKey, DaySchedule> = {
  mon: { enabled: true,  from: '09:00', to: '18:00' },
  tue: { enabled: true,  from: '09:00', to: '18:00' },
  wed: { enabled: true,  from: '09:00', to: '18:00' },
  thu: { enabled: true,  from: '09:00', to: '18:00' },
  fri: { enabled: true,  from: '09:00', to: '18:00' },
  sat: { enabled: false, from: '09:00', to: '13:00' },
  sun: { enabled: false, from: '09:00', to: '13:00' },
};

const MOCK_DATA: DashboardData = {
  factory: { id: 'mock', name: 'My Factory', region: 'Malaysia' },
  kpis: {
    quoteCount: 24,
    winRate: 62,
    activeOrders: 5,
    totalRevenueMYR: 148_500,
    avgResponseHours: 4,
  },
  rfqs: [
    { id: 'rfq-001', shape_name: 'Bracket', status: 'quoted', created_at: Date.now() - 2 * 86400000, assigned_at: Date.now() - 2 * 86400000 + 3600000, quantity: 100, material: 'Aluminum 6061' },
    { id: 'rfq-002', shape_name: 'Gear Housing', status: 'contracted', created_at: Date.now() - 5 * 86400000, assigned_at: Date.now() - 5 * 86400000 + 7200000, quantity: 20, material: 'Steel' },
    { id: 'rfq-003', shape_name: 'Shaft', status: 'assigned', created_at: Date.now() - 1 * 86400000, assigned_at: Date.now() - 86400000 + 1800000, quantity: 50, material: 'Stainless Steel' },
    { id: 'rfq-004', shape_name: 'Cover Plate', status: 'completed', created_at: Date.now() - 14 * 86400000, assigned_at: Date.now() - 14 * 86400000 + 5400000, quantity: 200, material: 'HDPE' },
    { id: 'rfq-005', shape_name: 'Flange', status: 'quoted', created_at: Date.now() - 3 * 86400000, assigned_at: Date.now() - 3 * 86400000 + 2700000, quantity: 30, material: 'Titanium' },
  ],
  availability: { schedule: DEFAULT_SCHEDULE },
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  page: {
    padding: '28px 32px',
    minHeight: '100%',
    background: '#0d1117',
    color: '#c9d1d9',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as React.CSSProperties,
  header: {
    marginBottom: '28px',
  } as React.CSSProperties,
  title: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#e6edf3',
    margin: 0,
  } as React.CSSProperties,
  subtitle: {
    fontSize: '13px',
    color: '#8b949e',
    marginTop: '4px',
  } as React.CSSProperties,
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '16px',
    marginBottom: '28px',
  } as React.CSSProperties,
  kpiCard: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: '10px',
    padding: '18px 20px',
  } as React.CSSProperties,
  kpiLabel: {
    fontSize: '11px',
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '8px',
  } as React.CSSProperties,
  kpiValue: {
    fontSize: '26px',
    fontWeight: 700,
    color: '#e6edf3',
    lineHeight: 1,
  } as React.CSSProperties,
  kpiSub: {
    fontSize: '11px',
    color: '#8b949e',
    marginTop: '4px',
  } as React.CSSProperties,
  section: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: '10px',
    marginBottom: '24px',
    overflow: 'hidden',
  } as React.CSSProperties,
  sectionHeader: {
    padding: '14px 20px',
    borderBottom: '1px solid #30363d',
    fontSize: '13px',
    fontWeight: 600,
    color: '#e6edf3',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
  } as React.CSSProperties,
  th: {
    padding: '10px 20px',
    textAlign: 'left' as const,
    color: '#8b949e',
    fontWeight: 500,
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '1px solid #30363d',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  td: {
    padding: '12px 20px',
    borderBottom: '1px solid #21262d',
    color: '#c9d1d9',
    verticalAlign: 'middle' as const,
  } as React.CSSProperties,
  badge: (status: string): React.CSSProperties => {
    const map: Record<string, string> = {
      assigned: '#1f6feb',
      quoted: '#388bfd',
      contracted: '#a371f7',
      in_progress: '#f0883e',
      quality_check: '#d29922',
      completed: '#238636',
      rejected: '#da3633',
      cancelled: '#6e7681',
    };
    return {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: 600,
      background: (map[status] ?? '#30363d') + '33',
      color: map[status] ?? '#8b949e',
      border: `1px solid ${map[status] ?? '#30363d'}55`,
    };
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: number, isKo: boolean) {
  return new Date(ts).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtMYR(n: number) {
  return 'MYR ' + n.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ─── Availability Save API ────────────────────────────────────────────────────

async function saveAvailability(schedule: Record<DayKey, DaySchedule>): Promise<boolean> {
  try {
    const res = await fetch('/api/nexyfab/manufacturers/availability', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PartnerDashboardPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Record<DayKey, DaySchedule>>(DEFAULT_SCHEDULE);
  const [savingAvail, setSavingAvail] = useState(false);
  const [availToast, setAvailToast] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/nexyfab/manufacturers/dashboard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as DashboardData;
      setData(json);
      if (json.availability?.schedule && Object.keys(json.availability.schedule).length > 0) {
        setSchedule(json.availability.schedule as Record<DayKey, DaySchedule>);
      }
    } catch {
      // Use mock data when API fails (e.g. not yet authenticated or server error)
      setData(MOCK_DATA);
      setSchedule(MOCK_DATA.availability.schedule);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const handleSaveAvailability = async () => {
    setSavingAvail(true);
    const ok = await saveAvailability(schedule);
    setSavingAvail(false);
    setAvailToast(
      ok
        ? (isKo ? '가용성 일정이 저장되었습니다.' : 'Availability schedule saved.')
        : (isKo ? '저장 실패. 다시 시도해주세요.' : 'Save failed. Please try again.'),
    );
    setTimeout(() => setAvailToast(null), 3500);
  };

  const kpis = data?.kpis ?? MOCK_DATA.kpis;
  const rfqs = data?.rfqs ?? MOCK_DATA.rfqs;
  const factoryName = data?.factory.name ?? '';

  // Performance bar chart data (win rate, completion estimates)
  const barData = [
    { label: isKo ? '견적 제출' : 'Quotes Sent', value: kpis.quoteCount, max: Math.max(kpis.quoteCount, 1), color: '#388bfd' },
    { label: isKo ? '수주율 %' : 'Win Rate %', value: kpis.winRate ?? 0, max: 100, color: '#a371f7' },
    { label: isKo ? '활성 주문' : 'Active Orders', value: kpis.activeOrders, max: Math.max(kpis.activeOrders, 1, 10), color: '#f0883e' },
    { label: isKo ? '평균 응답(h)' : 'Avg Response (h)', value: kpis.avgResponseHours ?? 0, max: Math.max(kpis.avgResponseHours ?? 0, 24), color: '#3fb950' },
  ];

  return (
    <div style={S.page}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={S.header}>
        <h1 style={S.title}>
          {isKo ? '파트너 대시보드' : 'Partner Dashboard'}
        </h1>
        <p style={S.subtitle}>
          {factoryName
            ? (isKo ? `${factoryName} — 내 제조사 성과 현황` : `${factoryName} — Your manufacturing performance`)
            : (isKo ? '내 제조사 성과 현황' : 'Your manufacturing performance overview')}
        </p>
      </div>

      {loading && (
        <div style={{ color: '#8b949e', fontSize: '14px', padding: '40px 0', textAlign: 'center' }}>
          {isKo ? '데이터 불러오는 중…' : 'Loading dashboard…'}
        </div>
      )}

      {!loading && (
        <>
          {/* ── KPI Cards ──────────────────────────────────────────────────── */}
          <div style={S.kpiGrid}>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>{isKo ? '총 견적 수' : 'Total Quotes'}</div>
              <div style={S.kpiValue}>{kpis.quoteCount}</div>
              <div style={S.kpiSub}>{isKo ? '누적' : 'Cumulative'}</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>{isKo ? '수주율' : 'Win Rate'}</div>
              <div style={{ ...S.kpiValue, color: '#a371f7' }}>
                {kpis.winRate !== null ? `${kpis.winRate}%` : '—'}
              </div>
              <div style={S.kpiSub}>{isKo ? '수락된 계약 / 견적' : 'Accepted / Quoted'}</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>{isKo ? '활성 주문' : 'Active Orders'}</div>
              <div style={{ ...S.kpiValue, color: '#f0883e' }}>{kpis.activeOrders}</div>
              <div style={S.kpiSub}>{isKo ? '진행 중' : 'In progress'}</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>{isKo ? '총 수익' : 'Total Revenue'}</div>
              <div style={{ ...S.kpiValue, fontSize: '20px', color: '#3fb950' }}>
                {fmtMYR(kpis.totalRevenueMYR)}
              </div>
              <div style={S.kpiSub}>{isKo ? '완료 + 진행 계약' : 'Completed + active'}</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>{isKo ? '평균 응답 시간' : 'Avg Response'}</div>
              <div style={{ ...S.kpiValue, color: '#58a6ff' }}>
                {kpis.avgResponseHours !== null ? `${kpis.avgResponseHours}h` : '—'}
              </div>
              <div style={S.kpiSub}>{isKo ? '배정 → 첫 견적' : 'Assigned → First quote'}</div>
            </div>
          </div>

          {/* ── Performance chart (CSS bars) ──────────────────────────────── */}
          <div style={S.section}>
            <div style={S.sectionHeader}>
              📊 {isKo ? '성과 지표' : 'Performance Overview'}
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {barData.map((item) => {
                const pct = item.max > 0 ? Math.min(100, (item.value / item.max) * 100) : 0;
                return (
                  <div key={item.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '12px', color: '#8b949e' }}>{item.label}</span>
                      <span style={{ fontSize: '12px', color: '#c9d1d9', fontWeight: 600 }}>{item.value}</span>
                    </div>
                    <div style={{ height: '8px', background: '#21262d', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: item.color,
                          borderRadius: '4px',
                          transition: 'width 0.6s ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Recent RFQs Table ─────────────────────────────────────────── */}
          <div style={S.section}>
            <div style={S.sectionHeader}>
              📋 {isKo ? '최근 RFQ 목록' : 'Recent RFQs'}
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#8b949e', fontWeight: 400 }}>
                {isKo ? `최근 ${rfqs.length}건` : `Last ${rfqs.length} items`}
              </span>
            </div>
            {rfqs.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: '#8b949e', fontSize: '13px' }}>
                {isKo ? '배정된 RFQ가 없습니다.' : 'No RFQs assigned yet.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>RFQ ID</th>
                      <th style={S.th}>{isKo ? '형상명' : 'Shape Name'}</th>
                      <th style={S.th}>{isKo ? '상태' : 'Status'}</th>
                      <th style={S.th}>{isKo ? '생성일' : 'Created'}</th>
                      <th style={S.th}>{isKo ? '배정일' : 'Assigned'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfqs.map((rfq) => (
                      <tr key={rfq.id} style={{ cursor: 'default' }}>
                        <td style={S.td}>
                          <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#58a6ff' }}>
                            {rfq.id.length > 14 ? rfq.id.slice(0, 14) + '…' : rfq.id}
                          </span>
                        </td>
                        <td style={S.td}>{rfq.shape_name ?? '—'}</td>
                        <td style={S.td}>
                          <span style={S.badge(rfq.status)}>{rfq.status}</span>
                        </td>
                        <td style={{ ...S.td, color: '#8b949e' }}>
                          {fmtDate(rfq.created_at, isKo)}
                        </td>
                        <td style={{ ...S.td, color: '#8b949e' }}>
                          {rfq.assigned_at ? fmtDate(rfq.assigned_at, isKo) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Availability Settings ─────────────────────────────────────── */}
          <div style={S.section}>
            <div style={S.sectionHeader}>
              🗓️ {isKo ? '주간 가용성 설정' : 'Weekly Availability'}
            </div>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {DAYS.map(({ key, ko, en }) => {
                  const day = schedule[key] ?? DEFAULT_SCHEDULE[key];
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                      {/* Checkbox */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minWidth: '52px' }}>
                        <input
                          type="checkbox"
                          checked={day.enabled}
                          onChange={(e) =>
                            setSchedule((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], enabled: e.target.checked },
                            }))
                          }
                          style={{ accentColor: '#388bfd', width: '15px', height: '15px' }}
                        />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: day.enabled ? '#e6edf3' : '#6e7681', width: '24px' }}>
                          {isKo ? ko : en}
                        </span>
                      </label>
                      {/* Time range */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: day.enabled ? 1 : 0.4 }}>
                        <input
                          type="time"
                          value={day.from}
                          disabled={!day.enabled}
                          onChange={(e) =>
                            setSchedule((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], from: e.target.value },
                            }))
                          }
                          style={{
                            background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px',
                            padding: '4px 8px', color: '#c9d1d9', fontSize: '13px', cursor: 'pointer',
                          }}
                        />
                        <span style={{ color: '#6e7681', fontSize: '13px' }}>—</span>
                        <input
                          type="time"
                          value={day.to}
                          disabled={!day.enabled}
                          onChange={(e) =>
                            setSchedule((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], to: e.target.value },
                            }))
                          }
                          style={{
                            background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px',
                            padding: '4px 8px', color: '#c9d1d9', fontSize: '13px', cursor: 'pointer',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  onClick={handleSaveAvailability}
                  disabled={savingAvail}
                  style={{
                    background: '#238636', border: '1px solid #2ea043', borderRadius: '6px',
                    padding: '8px 18px', color: '#fff', fontSize: '13px', fontWeight: 600,
                    cursor: savingAvail ? 'not-allowed' : 'pointer', opacity: savingAvail ? 0.7 : 1,
                  }}
                >
                  {savingAvail
                    ? (isKo ? '저장 중…' : 'Saving…')
                    : (isKo ? '가용성 저장' : 'Save Availability')}
                </button>
                {availToast && (
                  <span style={{ fontSize: '12px', color: availToast.includes('failed') || availToast.includes('실패') ? '#f85149' : '#3fb950' }}>
                    {availToast}
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {error && !loading && (
        <div style={{ color: '#f85149', fontSize: '13px', padding: '12px 16px', background: '#f8514922', border: '1px solid #f8514944', borderRadius: '8px', marginTop: '16px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
