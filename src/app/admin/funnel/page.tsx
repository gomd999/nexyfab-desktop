'use client';

import { useEffect, useState, useCallback } from 'react';

interface FunnelStep {
  eventType: string;
  uniqueUsers: number;
  totalEvents: number;
  conversionFromPrev: number | null;
}

interface FunnelResponse {
  sinceDays: number;
  sinceMs: number;
  untilMs: number;
  steps: FunnelStep[];
  sources?: Array<{ source: string; signups: number }>;
  cohortSource?: string;
  cohortSteps?: FunnelStep[];
}

function csvEscape(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportFunnelCsv(data: FunnelResponse) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const lines: string[] = [];
  lines.push(`# NexyFab funnel — ${data.sinceDays}d window`);
  lines.push('# All-traffic steps');
  lines.push(['eventType', 'uniqueUsers', 'totalEvents', 'conversionFromPrev'].join(','));
  for (const s of data.steps) {
    lines.push([
      s.eventType, s.uniqueUsers, s.totalEvents,
      s.conversionFromPrev === null ? '' : s.conversionFromPrev.toFixed(4),
    ].map(v => csvEscape(String(v))).join(','));
  }
  if (data.sources && data.sources.length > 0) {
    lines.push('');
    lines.push('# Top UTM sources');
    lines.push(['source', 'signups'].join(','));
    for (const s of data.sources) {
      lines.push([s.source, s.signups].map(v => csvEscape(String(v))).join(','));
    }
  }
  if (data.cohortSteps && data.cohortSource) {
    lines.push('');
    lines.push(`# Cohort: ${data.cohortSource}`);
    lines.push(['eventType', 'uniqueUsers', 'totalEvents', 'conversionFromPrev'].join(','));
    for (const s of data.cohortSteps) {
      lines.push([
        s.eventType, s.uniqueUsers, s.totalEvents,
        s.conversionFromPrev === null ? '' : s.conversionFromPrev.toFixed(4),
      ].map(v => csvEscape(String(v))).join(','));
    }
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nexyfab_funnel_${stamp}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

const STEP_LABELS: Record<string, string> = {
  signup_complete:            '① 회원가입 완료',
  shape_generator_first_open: '② 3D 툴 첫 진입',
  first_shape_created:        '③ 첫 도형 추가',
  first_save:                 '④ 첫 저장',
  paywall_shown:              '⑤ Paywall 노출',
  paywall_upgrade_clicked:    '⑥ 업그레이드 클릭',
  upgrade_completed:          '⑦ 결제 완료',
};

export default function FunnelPage() {
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [sinceDays, setSinceDays] = useState(30);
  const [cohortSource, setCohortSource] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const url = new URL('/api/nexyfab/admin/funnel', window.location.origin);
      url.searchParams.set('sinceDays', String(sinceDays));
      if (cohortSource) url.searchParams.set('source', cohortSource);
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const j = await res.json() as FunnelResponse;
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sinceDays, cohortSource]);

  useEffect(() => { void load(); }, [load]);

  // Width %: bar size scales by uniqueUsers / max(uniqueUsers).
  const max = data?.steps.reduce((m, s) => Math.max(m, s.uniqueUsers), 0) ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold">Onboarding Funnel</h1>
          <div className="flex items-center gap-2 text-sm">
            <label>Last</label>
            <select
              value={sinceDays}
              onChange={e => setSinceDays(parseInt(e.target.value, 10))}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
            </select>
            <button onClick={() => void load()} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded">
              Reload
            </button>
            <button
              onClick={() => data && exportFunnelCsv(data)}
              disabled={!data}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-xs"
              title="Download funnel + sources + cohort as CSV"
            >
              ⬇ CSV
            </button>
          </div>
        </div>

        {loading && <p className="text-gray-500 text-sm">Loading…</p>}
        {err && <p className="text-red-400 text-sm">Error: {err}</p>}

        {data && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <p className="text-xs text-gray-500">
              Window: {new Date(data.sinceMs).toLocaleDateString()} → {new Date(data.untilMs).toLocaleDateString()}
            </p>

            {/* Trapezoid funnel chart — visual drop-off. Each step's width
                normalizes against step 0 (signup_complete) so the funnel
                narrows realistically as users disappear. */}
            {(() => {
              const top = data.steps[0]?.uniqueUsers ?? 0;
              if (top === 0) return null;
              const w = 720, h = 120;
              const stepCount = data.steps.length;
              const sliceW = w / stepCount;
              const widths = data.steps.map(s => Math.max(2, (s.uniqueUsers / top) * (h - 16)));
              return (
                <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: '#0d1117', borderRadius: 6 }}>
                  {data.steps.map((s, i) => {
                    const x = i * sliceW;
                    const y = (h - widths[i]) / 2;
                    const next = data.steps[i + 1];
                    const nextWidth = next ? Math.max(2, (next.uniqueUsers / top) * (h - 16)) : widths[i];
                    const polygon = [
                      `${x},${y}`,
                      `${x + sliceW},${(h - nextWidth) / 2}`,
                      `${x + sliceW},${(h + nextWidth) / 2}`,
                      `${x},${y + widths[i]}`,
                    ].join(' ');
                    const fillTone = s.conversionFromPrev !== null && s.conversionFromPrev < 0.3
                      ? '#ef4444' : s.conversionFromPrev !== null && s.conversionFromPrev < 0.6
                      ? '#f59e0b' : '#10b981';
                    return (
                      <g key={s.eventType}>
                        <polygon points={polygon} fill={fillTone} fillOpacity="0.55" stroke="#0d1117" strokeWidth="1" />
                        <text x={x + sliceW / 2} y={h - 4} fontSize="9" fill="#94a3b8"
                              textAnchor="middle" fontFamily="monospace">
                          {s.uniqueUsers}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              );
            })()}

            {data.steps.map(s => {
              const pct = max > 0 ? (s.uniqueUsers / max) * 100 : 0;
              const conv = s.conversionFromPrev;
              const convPct = conv === null ? null : (conv * 100).toFixed(1);
              const dropTone = conv !== null && conv < 0.3 ? 'text-red-400'
                : conv !== null && conv < 0.6 ? 'text-amber-400'
                : 'text-emerald-400';
              return (
                <div key={s.eventType} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">
                      {STEP_LABELS[s.eventType] ?? s.eventType}
                    </span>
                    <span className="text-xs font-mono text-gray-400">
                      {s.uniqueUsers.toLocaleString()} users
                      <span className="text-gray-600 ml-2">({s.totalEvents.toLocaleString()} events)</span>
                      {convPct !== null && (
                        <span className={`ml-3 ${dropTone}`}>{convPct}% from prev</span>
                      )}
                    </span>
                  </div>
                  <div className="bg-gray-800 rounded h-2 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-gray-600 pt-2 border-t border-gray-800">
              Conversion = unique users at this step ÷ unique users at previous step. Red &lt;30%, amber &lt;60%, green ≥60%.
            </p>
          </section>
        )}

        {data?.sources && data.sources.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-300">Signups by UTM source (top 10)</h2>
              {cohortSource && (
                <button
                  onClick={() => setCohortSource('')}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
                >
                  Clear cohort
                </button>
              )}
            </div>
            {(() => {
              const max = Math.max(...data.sources.map(s => s.signups));
              return (
                <div className="space-y-1">
                  {data.sources.map(s => {
                    const active = s.source === cohortSource;
                    return (
                      <button
                        key={s.source}
                        onClick={() => setCohortSource(active ? '' : s.source)}
                        className={`w-full flex items-center gap-3 text-sm text-left px-2 py-1 rounded transition ${active ? 'bg-emerald-900/40 ring-1 ring-emerald-600/40' : 'hover:bg-gray-800/50'}`}
                      >
                        <span className="font-mono text-xs text-gray-300 w-32 truncate" title={s.source}>{s.source}</span>
                        <div className="flex-1 bg-gray-800 rounded h-2 overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${(s.signups / max) * 100}%` }} />
                        </div>
                        <span className="text-xs font-mono text-gray-400 w-12 text-right">{s.signups}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <p className="text-xs text-gray-600 pt-1">
              Click a source to drill into its cohort funnel. &quot;(direct)&quot; = no UTM params present.
            </p>
          </section>
        )}

        {data?.cohortSteps && data.cohortSource && (
          <section className="bg-emerald-950/30 border border-emerald-700/30 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold text-emerald-200">
              Cohort funnel — <span className="font-mono">{data.cohortSource}</span>
            </h2>
            {(() => {
              const cohortMax = data.cohortSteps.reduce((m, s) => Math.max(m, s.uniqueUsers), 0);
              return data.cohortSteps.map(s => {
                const pct = cohortMax > 0 ? (s.uniqueUsers / cohortMax) * 100 : 0;
                const conv = s.conversionFromPrev;
                const convPct = conv === null ? null : (conv * 100).toFixed(1);
                const tone = conv !== null && conv < 0.3 ? 'text-red-400'
                  : conv !== null && conv < 0.6 ? 'text-amber-400'
                  : 'text-emerald-300';
                return (
                  <div key={s.eventType} className="space-y-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium text-emerald-100">
                        {STEP_LABELS[s.eventType] ?? s.eventType}
                      </span>
                      <span className="text-xs font-mono text-emerald-200/70">
                        {s.uniqueUsers.toLocaleString()} users
                        {convPct !== null && (
                          <span className={`ml-3 ${tone}`}>{convPct}% from prev</span>
                        )}
                      </span>
                    </div>
                    <div className="bg-emerald-900/40 rounded h-2 overflow-hidden">
                      <div className="h-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              });
            })()}
            <p className="text-xs text-emerald-200/50 pt-1">
              Filtered to users whose first-touch UTM source matched. Compare drop-off vs the all-traffic funnel above.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
