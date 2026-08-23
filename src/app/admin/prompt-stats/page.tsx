'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';

interface VariantStats {
  promptId: string;
  promptVersion?: string;
  count: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyMean: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostCents: number;
  avgCostCents: number;
  topErrorClass: string | null;
  topProvider: string | null;
}

interface ApiResponse {
  sinceDays: number;
  sampleSize: number;
  truncated: boolean;
  stats: VariantStats[];
}

function fmtPct(x: number) { return `${(x * 100).toFixed(1)}%`; }
function fmtMs(x: number) { return x === 0 ? '—' : `${x.toLocaleString()} ms`; }
function fmtNum(x: number) { return x.toLocaleString(); }
function fmtUsd(cents: number): string {
  if (cents === 0) return '—';
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Highlight one variant against a baseline. Used for A/B comparison rows. */
function delta(current: number, baseline: number): string {
  if (baseline === 0) return '—';
  const ratio = current / baseline;
  const pct = (ratio - 1) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export default function PromptStatsPage() {
  const { copy } = useAdminI18n();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinceDays, setSinceDays] = useState(7);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const url = new URL('/api/nexyfab/admin/prompt-stats', window.location.origin);
      url.searchParams.set('sinceDays', String(sinceDays));
      if (filter.trim()) url.searchParams.set('promptId', filter.trim());
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      setData(await res.json() as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sinceDays, filter]);

  useEffect(() => { void load(); }, [load]);

  // Group stats by base prompt id (everything before the ":") so A/B rows
  // appear adjacent to their baseline.
  const grouped = new Map<string, VariantStats[]>();
  for (const s of data?.stats ?? []) {
    const base = s.promptId.split(':')[0];
    if (!grouped.has(base)) grouped.set(base, []);
    grouped.get(base)!.push(s);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{copy.pageTitles.promptStats}</h1>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-400">Last</label>
            <select
              value={sinceDays}
              onChange={e => setSinceDays(parseInt(e.target.value, 10))}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
            <input
              type="text"
              placeholder="Filter by promptId (e.g. shape-chat)"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 w-72"
            />
            <button onClick={() => void load()} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded">
              Reload
            </button>
          </div>
        </div>

        {loading && <p className="text-gray-500">Loading…</p>}
        {error && <p className="text-red-400 text-sm">Error: {error}</p>}
        {data && (
          <p className="text-xs text-gray-500">
            Sample size: {fmtNum(data.sampleSize)}{data.truncated ? ' (truncated to 50k)' : ''} · Range: last {data.sinceDays} day(s)
          </p>
        )}

        {Array.from(grouped.entries()).map(([baseId, rows]) => {
          // Baseline is the row whose promptId equals the base (no ":" suffix).
          const baseline = rows.find(r => r.promptId === baseId) ?? rows[0];
          return (
            <section key={baseId} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <header className="px-4 py-2 bg-gray-800/60 border-b border-gray-800 flex items-center justify-between">
                <span className="font-mono text-sm">{baseId}</span>
                <span className="text-xs text-gray-500">{rows.length} variant{rows.length === 1 ? '' : 's'}</span>
              </header>
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 border-b border-gray-800">
                  <tr>
                    <th className="text-left px-4 py-2">Variant @ ver</th>
                    <th className="text-right px-4 py-2">Calls</th>
                    <th className="text-right px-4 py-2">Success</th>
                    <th className="text-right px-4 py-2">p50</th>
                    <th className="text-right px-4 py-2">p95</th>
                    <th className="text-right px-4 py-2">Δ p95</th>
                    <th className="text-right px-4 py-2">Tokens (in/out)</th>
                    <th className="text-right px-4 py-2">Cost (total / avg)</th>
                    <th className="text-left px-4 py-2 pl-4">Top err / provider</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {rows.map(s => (
                    <tr key={`${s.promptId}@${s.promptVersion}`} className="border-b border-gray-800/50 last:border-0">
                      <td className="px-4 py-2">
                        {s.promptId === baseId
                          ? <span className="text-gray-400">{s.promptId}</span>
                          : <span className="text-amber-300">{s.promptId.replace(`${baseId}:`, ':')}</span>}
                        <span className="text-gray-600 ml-1">@{s.promptVersion ?? '?'}</span>
                      </td>
                      <td className="text-right px-4 py-2">{fmtNum(s.count)}</td>
                      <td className={`text-right px-4 py-2 ${s.successRate < 0.95 ? 'text-red-400' : s.successRate < 0.99 ? 'text-amber-300' : 'text-emerald-400'}`}>{fmtPct(s.successRate)}</td>
                      <td className="text-right px-4 py-2">{fmtMs(s.latencyP50)}</td>
                      <td className="text-right px-4 py-2">{fmtMs(s.latencyP95)}</td>
                      <td className={`text-right px-4 py-2 ${
                        s.promptId === baseId ? 'text-gray-600' :
                        s.latencyP95 > baseline.latencyP95 * 1.2 ? 'text-red-400' :
                        s.latencyP95 < baseline.latencyP95 * 0.8 ? 'text-emerald-400' : 'text-gray-400'
                      }`}>
                        {s.promptId === baseId ? '—' : delta(s.latencyP95, baseline.latencyP95)}
                      </td>
                      <td className="text-right px-4 py-2 text-gray-400">
                        {fmtNum(s.totalPromptTokens)} / {fmtNum(s.totalCompletionTokens)}
                      </td>
                      <td className="text-right px-4 py-2 text-emerald-300/80">
                        {fmtUsd(s.totalCostCents)} <span className="text-gray-500 text-xs">/ {fmtUsd(s.avgCostCents)}</span>
                      </td>
                      <td className="text-left px-4 py-2 text-gray-500 text-xs">
                        {s.topErrorClass ?? '—'} · {s.topProvider ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}

        {data && data.stats.length === 0 && (
          <p className="text-gray-500 text-sm">No prompt_call telemetry in the selected range. Generate some AI traffic first.</p>
        )}
      </div>
    </div>
  );
}
