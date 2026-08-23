'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAdminI18n } from '../AdminI18nProvider';

interface RunSummary {
  id: string;
  createdAt: number;
  createdBy: string | null;
  promptId: string;
  promptVersion: string | null;
  maxTokens: number | null;
  temperature: number | null;
  userInput: string;
  providers: string[];
}

interface CompareResult {
  provider: string;
  configured: boolean;
  ok: boolean;
  text?: string;
  model?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
  errorClass?: string;
}

interface RunDetail extends RunSummary {
  results: unknown;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString();
}

export default function PromptCompareHistoryPage() {
  const { copy } = useAdminI18n();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [filter, setFilter] = useState('');
  const [createdByFilter, setCreatedByFilter] = useState('');
  const [sinceFilter, setSinceFilter] = useState('');
  const [untilFilter, setUntilFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const url = new URL('/api/nexyfab/admin/prompt-compare-history', window.location.origin);
      url.searchParams.set('limit', '100');
      if (filter.trim()) url.searchParams.set('promptId', filter.trim());
      if (createdByFilter.trim()) url.searchParams.set('createdBy', createdByFilter.trim());
      // datetime-local format ('YYYY-MM-DDTHH:MM') — Date.parse handles it directly.
      if (sinceFilter.trim()) url.searchParams.set('since', sinceFilter.trim());
      if (untilFilter.trim()) url.searchParams.set('until', untilFilter.trim());
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const j = await res.json() as { runs: RunSummary[] };
      setRuns(j.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter, createdByFilter, sinceFilter, untilFilter]);

  useEffect(() => { void load(); }, [load]);

  const openRun = useCallback(async (id: string) => {
    setDetailLoading(true); setError(null); setSelected(null);
    try {
      const url = new URL('/api/nexyfab/admin/prompt-compare-history', window.location.origin);
      url.searchParams.set('id', id);
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const j = await res.json() as { run: RunDetail };
      setSelected(j.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const detailResults: CompareResult[] = Array.isArray(selected?.results) ? (selected!.results as CompareResult[]) : [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold">{copy.pageTitles.promptHistory}</h1>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <input
              type="text"
              placeholder="promptId"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 w-44"
            />
            <input
              type="text"
              placeholder="createdBy (userId)"
              value={createdByFilter}
              onChange={e => setCreatedByFilter(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 w-48"
            />
            <label className="text-gray-500 text-xs">Since</label>
            <input
              type="datetime-local"
              value={sinceFilter}
              onChange={e => setSinceFilter(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            />
            <label className="text-gray-500 text-xs">Until</label>
            <input
              type="datetime-local"
              value={untilFilter}
              onChange={e => setUntilFilter(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
            />
            <button onClick={() => void load()} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded">
              Reload
            </button>
            <button
              onClick={() => {
                setFilter(''); setCreatedByFilter(''); setSinceFilter(''); setUntilFilter('');
              }}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
            >Clear</button>
          </div>
        </div>

        {loading && <p className="text-gray-500 text-sm">Loading…</p>}
        {error && <p className="text-red-400 text-sm">Error: {error}</p>}

        {/* Run list */}
        {runs && runs.length === 0 && (
          <p className="text-gray-500 text-sm">No saved runs yet. Use <Link href="/admin/prompt-compare" className="text-indigo-400">/admin/prompt-compare</Link> to create one.</p>
        )}
        {runs && runs.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-800">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Prompt @ ver</th>
                  <th className="text-left px-3 py-2">Providers</th>
                  <th className="text-left px-3 py-2 max-w-[26rem]">Input</th>
                  <th className="text-left px-3 py-2">By</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/40">
                    <td className="px-3 py-2 text-xs text-gray-400 font-mono">{fmtDate(r.createdAt)}</td>
                    <td className="px-3 py-2 text-xs font-mono">
                      {r.promptId}
                      <span className="text-gray-600 ml-1">@{r.promptVersion ?? '?'}</span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-400">{r.providers.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-300 truncate max-w-[26rem]" title={r.userInput}>
                      {r.userInput.slice(0, 100)}{r.userInput.length > 100 ? '…' : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono">{r.createdBy ?? 'unknown'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => void openRun(r.id)}
                        className="text-xs px-2 py-0.5 bg-indigo-700/60 hover:bg-indigo-600 rounded"
                      >Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Detail modal — inline expansion below the list. */}
        {(detailLoading || selected) && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">
                Run detail
                {selected && <span className="font-mono ml-2 text-gray-500">{selected.id}</span>}
              </h2>
              <button
                onClick={() => setSelected(null)}
                className="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded"
              >Close</button>
            </div>
            {detailLoading && <p className="text-gray-500 text-sm">Loading…</p>}
            {selected && (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  <span className="font-mono">{selected.promptId}@{selected.promptVersion}</span>
                  {' · '}maxTokens={selected.maxTokens ?? '?'}
                  {' · '}temp={selected.temperature ?? '?'}
                  {' · '}{fmtDate(selected.createdAt)} by {selected.createdBy ?? 'unknown'}
                </p>
                <pre className="text-xs bg-gray-950 border border-gray-800 rounded p-2 mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {selected.userInput}
                </pre>
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${detailResults.length || 1}, minmax(0, 1fr))` }}>
                  {detailResults.map(r => (
                    <div key={r.provider} className="bg-gray-950 border border-gray-800 rounded">
                      <header className="px-3 py-1.5 bg-gray-800/40 border-b border-gray-800 flex justify-between text-xs">
                        <span className="font-mono">{r.provider}</span>
                        <span className={r.ok ? 'text-emerald-400' : 'text-red-400'}>
                          {r.ok ? '✓' : '✗'}
                        </span>
                      </header>
                      <div className="p-2 text-xs text-gray-400 space-y-1">
                        <div className="flex justify-between">
                          <span>{r.model ?? '—'}</span>
                          <span>{typeof r.latencyMs === 'number' ? `${r.latencyMs} ms` : '—'}</span>
                        </div>
                        {r.ok ? (
                          <pre className="bg-gray-950 border border-gray-800 rounded p-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap">
                            {r.text ?? ''}
                          </pre>
                        ) : (
                          <div className="text-red-300/80">{r.errorClass ?? 'error'}: {r.error}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
