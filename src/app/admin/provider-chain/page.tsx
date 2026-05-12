'use client';

import { useEffect, useState, useCallback } from 'react';

interface OverrideRow {
  provider: string;
  position: number;
  updatedAt: number;
  updatedBy: string | null;
}

interface AuditRow {
  id: string;
  changedAt: number;
  changedBy: string | null;
  chain: string[];
}

interface ApiResponse {
  override: OverrideRow[];
  envPrimary: string[];
  envFallbacks: string[];
  valid: string[];
  audit?: AuditRow[];
}

export default function ProviderChainPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [chain, setChain] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Always include audit so the timeline below stays fresh.
      const res = await fetch('/api/nexyfab/admin/provider-chain?audit=1&auditLimit=20', { credentials: 'include' });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const j = await res.json() as ApiResponse;
      setData(j);
      // Initialize editor from existing override; if empty, seed from env.
      const initial = j.override.length > 0
        ? j.override.map(o => o.provider)
        : Array.from(new Set([...j.envPrimary, ...j.envFallbacks]));
      setChain(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= chain.length) return;
    const next = chain.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setChain(next);
  };

  const remove = (idx: number) => {
    setChain(chain.filter((_, i) => i !== idx));
  };

  const add = (p: string) => {
    if (chain.includes(p)) return;
    setChain([...chain, p]);
  };

  const save = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/nexyfab/admin/provider-chain', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server ${res.status}`);
      }
      setSavedAt(Date.now());
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [chain, load]);

  const clearOverride = useCallback(async () => {
    if (!confirm('Clear DB override and revert to env defaults?')) return;
    setChain([]);
    // Save immediately with empty array.
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/nexyfab/admin/provider-chain', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: [] }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      setSavedAt(Date.now());
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [load]);

  const available = (data?.valid ?? []).filter(p => !chain.includes(p));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">AI Provider Chain</h1>
        <p className="text-sm text-gray-500">
          Active runtime chain. DB override (when set) wins over env. Reorder, add, or remove
          providers and click <em>Save</em>. Cache propagates to all instances within ~30s.
        </p>

        {error && <p className="text-red-400 text-sm">Error: {error}</p>}
        {loading && <p className="text-gray-500 text-sm">Loading…</p>}
        {savedAt && (
          <p className="text-xs text-emerald-400">Saved at {new Date(savedAt).toLocaleTimeString()}</p>
        )}

        {data && (
          <>
            <section className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <h2 className="text-sm font-semibold mb-2">Active chain (edit)</h2>
              {chain.length === 0 ? (
                <p className="text-xs text-gray-500 italic mb-2">No override — env defaults apply (see below).</p>
              ) : (
                <ol className="space-y-1 mb-3">
                  {chain.map((p, idx) => (
                    <li key={p} className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded px-2 py-1.5">
                      <span className="text-xs text-gray-500 w-6">{idx + 1}.</span>
                      <span className="font-mono text-sm flex-1">{p}</span>
                      <button
                        onClick={() => move(idx, -1)} disabled={idx === 0}
                        className="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded"
                      >↑</button>
                      <button
                        onClick={() => move(idx, 1)} disabled={idx === chain.length - 1}
                        className="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded"
                      >↓</button>
                      <button
                        onClick={() => remove(idx)}
                        className="text-xs px-2 py-0.5 bg-red-950/60 hover:bg-red-900/60 text-red-300 rounded"
                      >Remove</button>
                    </li>
                  ))}
                </ol>
              )}

              {available.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-gray-500 mr-1">Add:</span>
                  {available.map(p => (
                    <button
                      key={p}
                      onClick={() => add(p)}
                      className="text-xs font-mono px-2 py-0.5 bg-indigo-900/40 hover:bg-indigo-800/60 border border-indigo-700/50 rounded"
                    >+ {p}</button>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => void save()}
                  disabled={loading}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded text-sm font-medium"
                >Save chain</button>
                <button
                  onClick={() => void clearOverride()}
                  disabled={loading || data.override.length === 0}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-sm"
                >Clear override (use env)</button>
              </div>
            </section>

            <section className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-xs">
              <h2 className="text-sm font-semibold mb-2 text-gray-300">Env defaults</h2>
              <p className="text-gray-500">
                <code className="text-gray-300">AI_PROVIDER_PRIMARY</code>: {data.envPrimary.join(', ') || '(unset)'}
              </p>
              <p className="text-gray-500">
                <code className="text-gray-300">AI_PROVIDER_FALLBACKS</code>: {data.envFallbacks.join(', ') || '(unset)'}
              </p>
              <p className="text-gray-500 mt-2">
                When DB override is empty, the runtime chain is the dedup of primary + fallbacks.
              </p>
            </section>

            {data.audit && data.audit.length > 0 && (
              <section className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <h2 className="text-sm font-semibold mb-2 text-gray-300">Change history</h2>
                <ol className="space-y-1 text-xs">
                  {data.audit.map(a => (
                    <li key={a.id} className="flex items-start gap-3 px-2 py-1.5 bg-gray-950 border border-gray-800 rounded">
                      <span className="text-gray-500 font-mono shrink-0" style={{ minWidth: 130 }}>
                        {new Date(a.changedAt).toLocaleString()}
                      </span>
                      <span className="text-amber-300 font-mono shrink-0" style={{ minWidth: 80 }}>
                        {a.changedBy ?? 'unknown'}
                      </span>
                      <span className="text-gray-300 font-mono">
                        {a.chain.length > 0 ? a.chain.join(' → ') : <em className="text-gray-500">cleared (env)</em>}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
