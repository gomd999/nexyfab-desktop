'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';

interface SeriesPoint { day: string; cents: number; calls: number }
interface TopUser { userId: string; cents: number; calls: number }
interface ApiResponse {
  days: number;
  series: SeriesPoint[];
  topUsers: TopUser[];
  products?: Array<{ product: string; cents: number; calls: number }>;
  userId?: string;
  product?: string;
}

function fmtCents(c: number) {
  if (c < 100) return `${c.toFixed(2)}¢`;
  return `$${(c / 100).toFixed(2)}`;
}

function csvEscape(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV from the current data and trigger a browser download. */
function exportCsv(data: ApiResponse) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const lines: string[] = [];
  lines.push('# Daily series');
  lines.push(['day', 'cents', 'calls'].join(','));
  for (const p of data.series) {
    lines.push([p.day, p.cents.toFixed(2), p.calls].map(v => csvEscape(String(v))).join(','));
  }
  if (data.topUsers && data.topUsers.length > 0) {
    lines.push('');
    lines.push('# Top users');
    lines.push(['userId', 'cents', 'calls'].join(','));
    for (const u of data.topUsers) {
      lines.push([u.userId, u.cents.toFixed(2), u.calls].map(v => csvEscape(String(v))).join(','));
    }
  }
  if (data.products && data.products.length > 0) {
    lines.push('');
    lines.push('# By product');
    lines.push(['product', 'cents', 'calls'].join(','));
    for (const p of data.products) {
      lines.push([p.product, p.cents.toFixed(2), p.calls].map(v => csvEscape(String(v))).join(','));
    }
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nexyfab_ai_usage_${stamp}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

export default function AIUsagePage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [days, setDays] = useState(30);
  const [userFilter, setUserFilter] = useState('');
  const [productFilter, setProductFilter] = useState<'' | 'nexyfab' | 'nexyflow' | 'nexywise'>('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // hoveredIdx tracks the day the mouse is currently over so we can render
  // a tooltip + crosshair line. Null when the cursor is off the chart.
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const url = new URL('/api/nexyfab/admin/ai-usage-timeseries', window.location.origin);
      url.searchParams.set('days', String(days));
      if (userFilter.trim()) url.searchParams.set('userId', userFilter.trim());
      if (productFilter) url.searchParams.set('product', productFilter);
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const j = await res.json() as ApiResponse;
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days, userFilter, productFilter]);

  useEffect(() => { void load(); }, [load]);

  // Inline SVG line chart — keeps the dashboard build dependency-free.
  // Two stacked traces: cost (cents) on top, calls on bottom.
  const chart = useMemo(() => {
    if (!data || data.series.length === 0) return null;
    const w = 800, h = 220, pad = 28;
    const maxCents = Math.max(1, ...data.series.map(p => p.cents));
    const maxCalls = Math.max(1, ...data.series.map(p => p.calls));
    const xStep = (w - pad * 2) / Math.max(1, data.series.length - 1);
    const yMid = h / 2;
    const costPath = data.series.map((p, i) => {
      const x = pad + i * xStep;
      const y = pad + (yMid - pad) * (1 - p.cents / maxCents);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const callsPath = data.series.map((p, i) => {
      const x = pad + i * xStep;
      const y = yMid + (h - pad - yMid) * (p.calls / maxCalls);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    return { w, h, pad, costPath, callsPath, maxCents, maxCalls, yMid };
  }, [data]);

  const total = data?.series.reduce((s, p) => s + p.cents, 0) ?? 0;
  const totalCalls = data?.series.reduce((s, p) => s + p.calls, 0) ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold">AI Usage Timeseries</h1>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <select
              value={productFilter}
              onChange={e => setProductFilter(e.target.value as typeof productFilter)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
              title="Filter by product"
            >
              <option value="">All products</option>
              <option value="nexyfab">NexyFab</option>
              <option value="nexyflow">NexyFlow</option>
              <option value="nexywise">NexyWise</option>
            </select>
            <input
              type="text"
              placeholder="userId filter (optional)"
              value={userFilter}
              onChange={e => setUserFilter(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 w-56 font-mono text-xs"
            />
            <select
              value={days}
              onChange={e => setDays(parseInt(e.target.value, 10))}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
            <button onClick={() => void load()} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded">
              Reload
            </button>
            <button
              onClick={() => data && exportCsv(data)}
              disabled={!data}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-xs"
              title="Download series + top users + product breakdown as CSV"
            >
              ⬇ CSV
            </button>
          </div>
        </div>

        {loading && <p className="text-gray-500 text-sm">Loading…</p>}
        {err && <p className="text-red-400 text-sm">Error: {err}</p>}

        {data && (
          <>
            <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-baseline gap-6 mb-3">
                <div>
                  <div className="text-xs text-gray-500">Total cost</div>
                  <div className="text-xl font-mono font-bold">{fmtCents(total)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Total calls</div>
                  <div className="text-xl font-mono font-bold">{totalCalls.toLocaleString()}</div>
                </div>
                {data.userId && (
                  <div>
                    <div className="text-xs text-gray-500">Filtered by</div>
                    <div className="text-xs font-mono">{data.userId}</div>
                  </div>
                )}
              </div>
              {chart && data && (() => {
                const series = data.series;
                const xStep = (chart.w - chart.pad * 2) / Math.max(1, series.length - 1);
                const hover = hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < series.length
                  ? series[hoveredIdx]
                  : null;
                const hoverX = hoveredIdx !== null ? chart.pad + hoveredIdx * xStep : null;
                return (
                  <svg
                    width="100%"
                    viewBox={`0 0 ${chart.w} ${chart.h}`}
                    style={{ background: '#0d1117', cursor: 'crosshair' }}
                    onMouseMove={e => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const localX = ((e.clientX - rect.left) / rect.width) * chart.w;
                      const idx = Math.round((localX - chart.pad) / xStep);
                      if (idx >= 0 && idx < series.length) setHoveredIdx(idx);
                      else setHoveredIdx(null);
                    }}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    <line x1={chart.pad} y1={chart.yMid} x2={chart.w - chart.pad} y2={chart.yMid}
                          stroke="#30363d" strokeDasharray="2,3" />
                    <path d={chart.costPath} fill="none" stroke="#f97316" strokeWidth="2" />
                    <path d={chart.callsPath} fill="none" stroke="#388bfd" strokeWidth="2" />
                    {hoverX !== null && (
                      <line x1={hoverX} y1={chart.pad} x2={hoverX} y2={chart.h - chart.pad}
                            stroke="#8b949e" strokeWidth="0.5" strokeDasharray="2,2" />
                    )}
                    <text x={chart.pad} y={chart.pad - 8} fill="#f97316" fontSize="10" fontFamily="monospace">
                      cost (max {fmtCents(chart.maxCents)})
                    </text>
                    <text x={chart.pad} y={chart.h - 6} fill="#388bfd" fontSize="10" fontFamily="monospace">
                      calls (max {chart.maxCalls})
                    </text>
                    {hover && hoverX !== null && (
                      <g>
                        {/* Background pad */}
                        <rect
                          x={Math.min(hoverX + 6, chart.w - 156)}
                          y={chart.pad}
                          width={150}
                          height={56}
                          rx={4}
                          fill="rgba(13,17,23,0.95)"
                          stroke="#30363d"
                        />
                        <text
                          x={Math.min(hoverX + 12, chart.w - 150)}
                          y={chart.pad + 16}
                          fill="#c9d1d9" fontSize="11" fontFamily="monospace"
                        >{hover.day}</text>
                        <text
                          x={Math.min(hoverX + 12, chart.w - 150)}
                          y={chart.pad + 32}
                          fill="#f97316" fontSize="11" fontFamily="monospace"
                        >cost: {fmtCents(hover.cents)}</text>
                        <text
                          x={Math.min(hoverX + 12, chart.w - 150)}
                          y={chart.pad + 48}
                          fill="#388bfd" fontSize="11" fontFamily="monospace"
                        >calls: {hover.calls.toLocaleString()}</text>
                      </g>
                    )}
                  </svg>
                );
              })()}
            </section>

            {!data.userId && data.topUsers.length > 0 && (
              <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
                <h2 className="text-sm font-semibold text-gray-300">Top {data.topUsers.length} users by cost</h2>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 border-b border-gray-800">
                    <tr>
                      <th className="text-left px-2 py-1">User</th>
                      <th className="text-right px-2 py-1">Cost</th>
                      <th className="text-right px-2 py-1">Calls</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topUsers.map(u => (
                      <tr key={u.userId} className="border-b border-gray-800/40">
                        <td className="px-2 py-1 text-xs font-mono text-gray-300">{u.userId.slice(0, 16)}</td>
                        <td className="px-2 py-1 text-xs text-right font-mono">{fmtCents(u.cents)}</td>
                        <td className="px-2 py-1 text-xs text-right font-mono text-gray-400">{u.calls.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            onClick={() => setUserFilter(u.userId)}
                            className="text-xs text-indigo-400 hover:text-indigo-300"
                          >Drill in</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
