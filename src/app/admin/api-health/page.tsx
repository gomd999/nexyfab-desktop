'use client';

// API Health — observability dashboard for external API calls.
//
// v1 (Phase 2): adds time-bucketed charts (calls / cost / errors over
// time), per-endpoint drilldown table, provider filter, and 1-min
// streaming when the window is set to 1h.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TimeseriesChart from '@/components/nexyfab/TimeseriesChart';

interface ProviderStats {
  provider: string;
  calls: number;
  errors: number;
  errorRate: number;
  totalTokensIn: number | null;
  totalTokensOut: number | null;
  totalCostUsd: number | null;
  avgLatencyMs: number;
  p95LatencyMs: number | null;
}

interface RecentError {
  provider: string;
  endpoint: string | null;
  message: string;
  calledAt: number;
}

interface FeatureRow {
  feature: string | null;
  calls: number;
  costUsd: number;
}

interface ApiResp {
  window: { hours: number; sinceMs: number };
  providers: ProviderStats[];
  recentErrors: RecentError[];
  topFeatures: FeatureRow[];
  forecast?: {
    costPerMinute: number;
    hourlyEtaMin: number | null;
    dailyEtaMin: number | null;
    hourlyCap: number | null;
    dailyCap: number | null;
  };
}

interface UserCostRow {
  userId: string;
  email: string | null;
  plan: string | null;
  calls: number;
  errors: number;
  errorRate: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

interface UserCostResp {
  totals: { cost: number; calls: number };
  rows: UserCostRow[];
}

interface SeriesPoint {
  ts: number;
  calls: number;
  errors: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  avgLatencyMs: number;
}

interface SeriesResp {
  window: { hours: number; bucketMinutes: number; sinceMs: number };
  provider: string | null;
  series: SeriesPoint[];
}

interface EndpointRow {
  provider: string;
  endpoint: string | null;
  calls: number;
  errors: number;
  errorRate: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
}

interface EndpointResp {
  window: { hours: number };
  rows: EndpointRow[];
}

interface ProviderHealth {
  provider: string;
  recentErrors: number;
  recentTotal: number;
  errorRate: number;
  degraded: boolean;
  degradedUntilMs: number;
  lastError?: string;
}

interface BreakerResp {
  breaker: { scope: string; untilMs: number; remainingMs: number; reason: string } | null;
  providers: ProviderHealth[];
}

const WINDOW_OPTIONS = [
  { label: '1h', value: 1 },
  { label: '6h', value: 6 },
  { label: '24h', value: 24 },
  { label: '7d', value: 24 * 7 },
  { label: '30d', value: 24 * 30 },
];

const PROVIDER_COLORS: Record<string, string> = {
  deepseek:  '#79c0ff',
  anthropic: '#a371f7',
  openai:    '#3fb950',
  gemini:    '#d29922',
  toss:      '#f85149',
  resend:    '#58a6ff',
  r2:        '#8b949e',
};

export default function ApiHealthPage() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [series, setSeries] = useState<SeriesResp | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointResp | null>(null);
  const [windowH, setWindowH] = useState<number>(24);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Bucket size scales with window so the chart always has 24-720 buckets:
  //   1h → 1m, 6h → 5m, 24h → 60m, 7d → 360m, 30d → 1440m
  const bucketM = useMemo(() => {
    if (windowH <= 1) return 1;
    if (windowH <= 6) return 5;
    if (windowH <= 24) return 60;
    if (windowH <= 24 * 7) return 360;
    return 1440;
  }, [windowH]);
  // 1-min streaming mode for the live 1h view; everything else 30s polls.
  const refreshIntervalMs = windowH <= 1 ? 60_000 : 30_000;

  const [breaker, setBreaker] = useState<BreakerResp | null>(null);
  const [users, setUsers] = useState<UserCostResp | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = providerFilter ? `&provider=${encodeURIComponent(providerFilter)}` : '';
      const [summaryRes, seriesRes, endpointsRes, breakerRes, usersRes] = await Promise.all([
        fetch(`/api/admin/api-health?windowH=${windowH}${qs}`, { credentials: 'include' }),
        fetch(`/api/admin/api-health/timeseries?windowH=${windowH}&bucketM=${bucketM}${qs}`, { credentials: 'include' }),
        fetch(`/api/admin/api-health/by-endpoint?windowH=${windowH}${qs}`, { credentials: 'include' }),
        fetch('/api/admin/breaker', { credentials: 'include' }),
        fetch(`/api/admin/api-health/by-user?windowH=${windowH}${qs}&limit=20`, { credentials: 'include' }),
      ]);
      if (summaryRes.ok)   setData(await summaryRes.json() as ApiResp);
      if (seriesRes.ok)    setSeries(await seriesRes.json() as SeriesResp);
      if (endpointsRes.ok) setEndpoints(await endpointsRes.json() as EndpointResp);
      if (breakerRes.ok)   setBreaker(await breakerRes.json() as BreakerResp);
      if (usersRes.ok)     setUsers(await usersRes.json() as UserCostResp);
    } finally {
      setLoading(false);
    }
  }, [windowH, providerFilter, bucketM]);

  const tripManual = async () => {
    const reason = prompt('차단 사유 (선택):') ?? '운영자 수동 차단';
    const res = await fetch('/api/admin/breaker', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) await load();
    else alert(`실패: ${(await res.json().catch(() => ({})))?.error ?? res.status}`);
  };

  const clearScope = async (scope: string) => {
    if (!confirm(`${scope} 차단 해제?`)) return;
    const res = await fetch(`/api/admin/breaker?scope=${scope}&resetHealth=1`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) await load();
    else alert(`실패: ${(await res.json().catch(() => ({})))?.error ?? res.status}`);
  };

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => void load(), refreshIntervalMs);
    return () => clearInterval(id);
  }, [load, refreshIntervalMs]);

  const totalCost = data?.providers.reduce((s, p) => s + (p.totalCostUsd ?? 0), 0) ?? 0;
  const totalCalls = data?.providers.reduce((s, p) => s + p.calls, 0) ?? 0;
  const totalErrors = data?.providers.reduce((s, p) => s + p.errors, 0) ?? 0;
  const overallErrorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>📊 API Health</h1>
      <p style={subtitleStyle}>
        외부 API 호출 (AI / Toss / Resend / R2) 사용량 + 비용 + 실패율 관측. 30초마다 자동 새로고침.
      </p>

      {/* Window picker */}
      <div style={filterRowStyle}>
        <div style={tabBarStyle}>
          {WINDOW_OPTIONS.map(w => (
            <button key={w.value} onClick={() => setWindowH(w.value)} style={{
              ...tabBtnStyle,
              background: windowH === w.value ? '#1f6feb' : 'transparent',
              color: windowH === w.value ? '#fff' : '#9ca3af',
            }}>{w.label}</button>
          ))}
        </div>
        {/* Provider filter — populated from current data */}
        {data && data.providers.length > 0 && (
          <select
            value={providerFilter ?? ''}
            onChange={e => setProviderFilter(e.target.value || null)}
            style={selectStyle}
          >
            <option value="">전체 provider</option>
            {data.providers.map(p => (
              <option key={p.provider} value={p.provider}>{p.provider}</option>
            ))}
          </select>
        )}
        <span style={{ fontSize: 11, color: '#6e7681' }}>
          bucket {bucketM}m · 갱신 {refreshIntervalMs / 1000}s
          {windowH <= 1 && <span style={{ color: '#3fb950', marginLeft: 6 }}>● LIVE</span>}
        </span>
        <button onClick={() => void load()} style={refreshBtnStyle}>↻</button>
      </div>

      {/* Circuit breaker — top-priority because it changes how AI calls behave */}
      {breaker && (
        <div style={{
          ...panelStyle,
          background: breaker.breaker ? '#3a1c1c' : '#0e2615',
          borderColor: breaker.breaker ? '#f85149' : '#3fb95040',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ ...panelTitleStyle, margin: 0, color: breaker.breaker ? '#f85149' : '#3fb950' }}>
              {breaker.breaker
                ? `🚨 AI 차단 활성 (${breaker.breaker.scope})`
                : '✓ AI 차단 비활성 — 모든 호출 정상'}
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {breaker.breaker ? (
                <button onClick={() => void clearScope(breaker.breaker!.scope)} style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 700,
                  background: '#3fb950', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                }}>차단 해제</button>
              ) : (
                <button onClick={() => void tripManual()} style={{
                  padding: '6px 14px', fontSize: 12,
                  background: 'transparent', color: '#f85149',
                  border: '1px solid #f85149', borderRadius: 6, cursor: 'pointer',
                }}>수동 차단</button>
              )}
            </div>
          </div>
          {breaker.breaker && (
            <div style={{ fontSize: 12, color: '#c9d1d9', lineHeight: 1.6 }}>
              <div>이유: {breaker.breaker.reason}</div>
              <div style={{ color: '#8b949e' }}>
                만료: {new Date(breaker.breaker.untilMs).toLocaleString('ko-KR')}
                {' '}(D-{Math.ceil(breaker.breaker.remainingMs / 60000)}분)
              </div>
            </div>
          )}
          {/* Provider degraded chips */}
          {breaker.providers.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {breaker.providers.map(p => (
                <span key={p.provider} style={{
                  padding: '3px 10px', fontSize: 11, fontWeight: 700,
                  borderRadius: 12,
                  background: p.degraded ? '#7f1d1d' : '#0e2615',
                  color: p.degraded ? '#fff' : '#3fb950',
                  border: `1px solid ${p.degraded ? '#f85149' : '#3fb95040'}`,
                }}>
                  {p.provider} {p.degraded ? '⚠ degraded' : '✓ healthy'}
                  {' · '}{p.recentErrors}/{p.recentTotal} 실패
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Forecast — ETA to auto-trip based on last 1h trend */}
      {data?.forecast && (data.forecast.hourlyEtaMin !== null || data.forecast.dailyEtaMin !== null) && (
        <div style={{
          ...panelStyle,
          background: '#1a1610',
          borderColor: '#d2992240',
          marginBottom: 16,
          padding: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#d29922', marginBottom: 6 }}>
            🔮 비용 추세 예측 (last 1h 기준)
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#c9d1d9', flexWrap: 'wrap' }}>
            <span>속도: <b>${data.forecast.costPerMinute.toFixed(4)}/min</b></span>
            {data.forecast.hourlyEtaMin !== null && (
              <span>
                시간당 cap 도달까지: <b style={{
                  color: data.forecast.hourlyEtaMin <= 15 ? '#f85149' : data.forecast.hourlyEtaMin <= 60 ? '#d29922' : '#3fb950',
                }}>
                  {data.forecast.hourlyEtaMin === 0 ? '이미 초과' : `${data.forecast.hourlyEtaMin}분`}
                </b>
              </span>
            )}
            {data.forecast.dailyEtaMin !== null && (
              <span>
                일일 cap 도달까지: <b style={{
                  color: data.forecast.dailyEtaMin <= 60 ? '#f85149' : data.forecast.dailyEtaMin <= 360 ? '#d29922' : '#3fb950',
                }}>
                  {data.forecast.dailyEtaMin === 0 ? '이미 초과'
                    : data.forecast.dailyEtaMin >= 60 ? `${Math.round(data.forecast.dailyEtaMin / 60)}시간` : `${data.forecast.dailyEtaMin}분`}
                </b>
              </span>
            )}
            <span style={{ flex: 1 }} />
            <a
              href={`/api/admin/api-health/export?windowH=${windowH}${providerFilter ? `&provider=${providerFilter}` : ''}`}
              download
              style={{ color: '#79c0ff', textDecoration: 'underline', fontSize: 11 }}
            >
              📥 CSV 다운로드 ({windowH}h)
            </a>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div style={summaryRowStyle}>
        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>총 호출 수</div>
          <div style={summaryValueStyle}>{totalCalls.toLocaleString()}</div>
        </div>
        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>총 비용 (AI)</div>
          <div style={{ ...summaryValueStyle, color: '#d29922' }}>${totalCost.toFixed(4)}</div>
        </div>
        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>실패율</div>
          <div style={{
            ...summaryValueStyle,
            color: overallErrorRate >= 0.05 ? '#f85149' : overallErrorRate >= 0.01 ? '#d29922' : '#3fb950',
          }}>{(overallErrorRate * 100).toFixed(2)}%</div>
        </div>
        <div style={summaryCardStyle}>
          <div style={summaryLabelStyle}>윈도우</div>
          <div style={{ ...summaryValueStyle, fontSize: 16, color: '#8b949e' }}>last {windowH}h</div>
        </div>
      </div>

      {loading && <div style={mutedStyle}>불러오는 중…</div>}

      {/* Time-bucketed charts */}
      {series && series.series.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12, marginBottom: 16 }}>
          <TimeseriesChart
            data={series.series.map(s => ({ ts: s.ts, value: s.calls }))}
            color="#79c0ff"
            mode="bar"
            title="호출 수"
            subtitle={`${series.window.bucketMinutes}분 bucket · ${providerFilter ?? '모든 provider'}`}
          />
          <TimeseriesChart
            data={series.series.map(s => ({ ts: s.ts, value: s.costUsd }))}
            color="#d29922"
            mode="bar"
            title="비용 (USD)"
            subtitle={`총 $${series.series.reduce((a, b) => a + b.costUsd, 0).toFixed(4)}`}
            formatY={v => `$${v.toFixed(4)}`}
          />
          <TimeseriesChart
            data={series.series.map(s => ({ ts: s.ts, value: s.errors }))}
            color="#f85149"
            mode="bar"
            title="실패 수"
            subtitle={`총 ${series.series.reduce((a, b) => a + b.errors, 0)}건`}
          />
          <TimeseriesChart
            data={series.series.map(s => ({ ts: s.ts, value: s.avgLatencyMs }))}
            color="#3fb950"
            mode="line"
            title="평균 latency"
            subtitle="bucket 별 평균"
            formatY={v => `${Math.round(v)}ms`}
          />
        </div>
      )}

      {/* Providers table */}
      {data && data.providers.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
          <div>이 윈도우에 기록된 호출이 없습니다.</div>
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 6 }}>
            새 마이그레이션 (v84) 적용 직후라면 데이터가 누적될 때까지 잠시 기다려 주세요.
          </div>
        </div>
      )}

      {data && data.providers.length > 0 && (
        <div style={panelStyle}>
          <h3 style={panelTitleStyle}>Provider별 사용량 (행 클릭 → 필터)</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Provider</th>
                <th style={thRightStyle}>호출</th>
                <th style={thRightStyle}>실패</th>
                <th style={thRightStyle}>실패율</th>
                <th style={thRightStyle}>입력 토큰</th>
                <th style={thRightStyle}>출력 토큰</th>
                <th style={thRightStyle}>비용 (USD)</th>
                <th style={thRightStyle}>평균 latency</th>
                <th style={thRightStyle}>p95</th>
              </tr>
            </thead>
            <tbody>
              {data.providers.map(p => (
                <tr
                  key={p.provider}
                  style={{
                    ...trStyle,
                    cursor: 'pointer',
                    background: providerFilter === p.provider ? '#1f6feb22' : 'transparent',
                  }}
                  onClick={() => setProviderFilter(providerFilter === p.provider ? null : p.provider)}
                  title="클릭 시 이 provider로 필터"
                >
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: PROVIDER_COLORS[p.provider] ?? '#6e7681', marginRight: 8,
                    }} />
                    {p.provider}
                  </td>
                  <td style={tdRightStyle}>{p.calls.toLocaleString()}</td>
                  <td style={{ ...tdRightStyle, color: p.errors > 0 ? '#f85149' : '#6e7681' }}>{p.errors}</td>
                  <td style={{
                    ...tdRightStyle,
                    color: p.errorRate >= 0.05 ? '#f85149' : p.errorRate >= 0.01 ? '#d29922' : '#3fb950',
                  }}>{(p.errorRate * 100).toFixed(2)}%</td>
                  <td style={tdRightStyle}>{p.totalTokensIn?.toLocaleString() ?? '-'}</td>
                  <td style={tdRightStyle}>{p.totalTokensOut?.toLocaleString() ?? '-'}</td>
                  <td style={tdRightStyle}>{p.totalCostUsd ? `$${p.totalCostUsd.toFixed(4)}` : '-'}</td>
                  <td style={tdRightStyle}>{p.avgLatencyMs}ms</td>
                  <td style={tdRightStyle}>{p.p95LatencyMs ? `${p.p95LatencyMs}ms` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-endpoint drilldown */}
      {endpoints && endpoints.rows.length > 0 && (
        <div style={panelStyle}>
          <h3 style={panelTitleStyle}>
            Endpoint 상세 ({endpoints.rows.length}건{providerFilter ? ` · ${providerFilter}` : ''})
          </h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Provider</th>
                <th style={thStyle}>Endpoint</th>
                <th style={thRightStyle}>호출</th>
                <th style={thRightStyle}>실패율</th>
                <th style={thRightStyle}>비용</th>
                <th style={thRightStyle}>평균</th>
                <th style={thRightStyle}>최대</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.rows.map((r, i) => (
                <tr key={`${r.provider}-${r.endpoint ?? '-'}-${i}`} style={trStyle}>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                      background: PROVIDER_COLORS[r.provider] ?? '#6e7681', marginRight: 6,
                    }} />
                    {r.provider}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{r.endpoint ?? '(none)'}</td>
                  <td style={tdRightStyle}>{r.calls.toLocaleString()}</td>
                  <td style={{
                    ...tdRightStyle,
                    color: r.errorRate >= 0.05 ? '#f85149' : r.errorRate >= 0.01 ? '#d29922' : '#6e7681',
                  }}>{(r.errorRate * 100).toFixed(2)}%</td>
                  <td style={tdRightStyle}>{r.costUsd > 0 ? `$${r.costUsd.toFixed(4)}` : '-'}</td>
                  <td style={tdRightStyle}>{r.avgLatencyMs}ms</td>
                  <td style={tdRightStyle}>{r.maxLatencyMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top features by cost */}
      {data && data.topFeatures.length > 0 && (
        <div style={panelStyle}>
          <h3 style={panelTitleStyle}>비용 상위 Feature</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Feature</th>
                <th style={thRightStyle}>호출</th>
                <th style={thRightStyle}>비용 (USD)</th>
              </tr>
            </thead>
            <tbody>
              {data.topFeatures.map(f => (
                <tr key={f.feature ?? '(unknown)'} style={trStyle}>
                  <td style={tdStyle}>{f.feature ?? '(unknown)'}</td>
                  <td style={tdRightStyle}>{f.calls.toLocaleString()}</td>
                  <td style={tdRightStyle}>${f.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top users by cost — abuse detection */}
      {users && users.rows.length > 0 && (
        <div style={panelStyle}>
          <h3 style={panelTitleStyle}>
            비용 상위 사용자 (last {windowH}h{providerFilter ? ` · ${providerFilter}` : ''})
          </h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Plan</th>
                <th style={thRightStyle}>호출</th>
                <th style={thRightStyle}>실패율</th>
                <th style={thRightStyle}>토큰</th>
                <th style={thRightStyle}>비용</th>
                <th style={thRightStyle}>점유율</th>
              </tr>
            </thead>
            <tbody>
              {users.rows.map(u => {
                const sharePct = users.totals.cost > 0 ? (u.costUsd / users.totals.cost) * 100 : 0;
                return (
                  <tr key={u.userId} style={trStyle}>
                    <td style={tdStyle}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9' }}>{u.email ?? '(no email)'}</div>
                      <div style={{ fontSize: 10, color: '#6e7681', fontFamily: 'monospace' }}>{u.userId.slice(0, 16)}</div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '1px 6px', fontSize: 10, fontWeight: 700,
                        background: u.plan === 'enterprise' ? '#8b5cf633'
                                  : u.plan === 'team' ? '#1f6feb33'
                                  : u.plan === 'pro' ? '#3fb95033'
                                  : '#30363d',
                        color: u.plan === 'enterprise' ? '#a371f7'
                             : u.plan === 'team' ? '#79c0ff'
                             : u.plan === 'pro' ? '#3fb950'
                             : '#9ca3af',
                        borderRadius: 3,
                      }}>{u.plan ?? 'free'}</span>
                    </td>
                    <td style={tdRightStyle}>{u.calls.toLocaleString()}</td>
                    <td style={{
                      ...tdRightStyle,
                      color: u.errorRate >= 0.05 ? '#f85149' : u.errorRate >= 0.01 ? '#d29922' : '#6e7681',
                    }}>{(u.errorRate * 100).toFixed(1)}%</td>
                    <td style={tdRightStyle}>
                      {u.tokensIn > 0 || u.tokensOut > 0
                        ? `${(u.tokensIn + u.tokensOut).toLocaleString()}`
                        : '-'}
                    </td>
                    <td style={tdRightStyle}>${u.costUsd.toFixed(4)}</td>
                    <td style={{
                      ...tdRightStyle,
                      color: sharePct >= 30 ? '#f85149' : sharePct >= 10 ? '#d29922' : '#6e7681',
                    }}>{sharePct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {users.rows.length > 0 && users.rows[0].costUsd > 0 && (users.rows[0].costUsd / users.totals.cost) > 0.5 && (
            <div style={{ marginTop: 8, padding: 8, background: '#3a1c1c', borderRadius: 6, fontSize: 11, color: '#f85149' }}>
              ⚠️ 1명 사용자가 전체 비용의 50%+ 차지 — 어뷰즈 가능성 검토 필요
            </div>
          )}
        </div>
      )}

      {/* Recent errors */}
      {data && data.recentErrors.length > 0 && (
        <div style={panelStyle}>
          <h3 style={panelTitleStyle}>최근 실패 ({data.recentErrors.length}건)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.recentErrors.map((e, i) => (
              <div key={i} style={errorRowStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: PROVIDER_COLORS[e.provider] ?? '#f85149' }}>
                    {e.provider} {e.endpoint && <span style={{ color: '#8b949e', fontWeight: 400 }}>· {e.endpoint}</span>}
                  </span>
                  <span style={{ fontSize: 10, color: '#6e7681' }}>{new Date(e.calledAt).toLocaleString('ko-KR')}</span>
                </div>
                <div style={{ fontSize: 11, color: '#c9d1d9', fontFamily: 'monospace' }}>{e.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24, color: '#e6edf3',
  fontFamily: 'system-ui, sans-serif', background: '#0d1117', minHeight: '100vh',
};
const titleStyle: React.CSSProperties = { fontSize: 24, fontWeight: 800, marginBottom: 4 };
const subtitleStyle: React.CSSProperties = { fontSize: 13, color: '#8b949e', margin: '0 0 20px' };
const filterRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 };
const tabBarStyle: React.CSSProperties = {
  display: 'flex', gap: 4, background: '#161b22',
  padding: 4, borderRadius: 8, border: '1px solid #30363d',
};
const tabBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 4,
  border: 'none', cursor: 'pointer', transition: 'all 0.12s',
};
const refreshBtnStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12,
  background: 'transparent', border: '1px solid #30363d',
  borderRadius: 6, color: '#9ca3af', cursor: 'pointer',
};
const summaryRowStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12, marginBottom: 20,
};
const summaryCardStyle: React.CSSProperties = {
  padding: 16, background: '#161b22',
  border: '1px solid #30363d', borderRadius: 10,
};
const summaryLabelStyle: React.CSSProperties = { fontSize: 11, color: '#8b949e', marginBottom: 4 };
const summaryValueStyle: React.CSSProperties = { fontSize: 24, fontWeight: 800 };
const panelStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
  padding: 16, marginBottom: 16,
};
const panelTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: '0 0 12px' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #30363d',
  color: '#8b949e', fontWeight: 600, fontSize: 11,
};
const thRightStyle: React.CSSProperties = { ...thStyle, textAlign: 'right' };
const trStyle: React.CSSProperties = { borderBottom: '1px solid #21262d' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', color: '#c9d1d9' };
const tdRightStyle: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontFamily: 'monospace' };
const mutedStyle: React.CSSProperties = { color: '#8b949e', fontSize: 13, padding: 24, textAlign: 'center' };
const emptyStyle: React.CSSProperties = {
  padding: 48, textAlign: 'center', background: '#161b22',
  borderRadius: 10, color: '#8b949e', fontSize: 14,
};
const selectStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, background: '#161b22',
  border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', outline: 'none',
};
const errorRowStyle: React.CSSProperties = {
  padding: 10, background: '#1c1110',
  borderLeft: '3px solid #f85149', borderRadius: 6,
};
