'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';

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

interface ConsolidationHint {
  type: 'consolidate_cheaper';
  keep: { provider: string; model: string; costCents: number };
  drop: { provider: string; model: string; costCents: number };
  similarity: number;
  savingsRatio: number;
}

interface CompareResponse {
  promptId: string;
  promptVersion: string;
  maxTokens: number;
  temperature: number;
  results: CompareResult[];
  /** Symmetric pairwise cosine similarity matrix (rows/cols match `similarityProviders`). */
  similarity?: number[][];
  similarityProviders?: string[];
  consolidationHints?: ConsolidationHint[];
  runId?: string;
}

const PROVIDER_OPTIONS = ['deepseek', 'anthropic', 'openai', 'local'] as const;

function fmtMs(ms: number | undefined) {
  if (ms === undefined) return '—';
  return `${ms.toLocaleString()} ms`;
}

function fmtUsd(cents: number) {
  if (cents < 1) return '<1¢';
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Trigger a browser download for a Blob. Common helper for JSON + CSV. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function downloadJson(result: CompareResponse, userInput: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob(
    [JSON.stringify({ ...result, userInput, exportedAt: Date.now() }, null, 2)],
    { type: 'application/json' },
  );
  downloadBlob(blob, `prompt-compare_${result.promptId.replace(/[:/]/g, '-')}_${stamp}.json`);
}

function csvEscape(s: string): string {
  // Wrap fields containing comma / quote / newline in double quotes; escape
  // embedded quotes by doubling them. Standard RFC 4180 behavior.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(result: CompareResponse) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const headers = ['provider', 'configured', 'ok', 'model', 'latencyMs', 'promptTokens', 'completionTokens', 'errorClass', 'error', 'text'];
  const rows = result.results.map(r => [
    r.provider,
    String(r.configured),
    String(r.ok),
    r.model ?? '',
    r.latencyMs?.toString() ?? '',
    r.promptTokens?.toString() ?? '',
    r.completionTokens?.toString() ?? '',
    r.errorClass ?? '',
    r.error ?? '',
    r.text ?? '',
  ].map(csvEscape).join(','));
  const csv = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `prompt-compare_${result.promptId.replace(/[:/]/g, '-')}_${stamp}.csv`);
}

export default function PromptComparePage() {
  const { copy } = useAdminI18n();
  const [promptIds, setPromptIds] = useState<string[]>([]);
  const [promptId, setPromptId] = useState('shape-chat');
  const [userInput, setUserInput] = useState('Make a 100×60×10mm aluminum mounting plate with four M5 bolt holes');
  const [providers, setProviders] = useState<Set<string>>(new Set(PROVIDER_OPTIONS));
  const [maxTokens, setMaxTokens] = useState<number | ''>('');
  const [temperature, setTemperature] = useState<number | ''>('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [applyingHintIdx, setApplyingHintIdx] = useState<number | null>(null);
  const [appliedHints, setAppliedHints] = useState<Map<number, { oldChain: string[]; newChain: string[] }>>(new Map());

  const applyHint = useCallback(async (hint: ConsolidationHint, idx: number) => {
    if (!confirm(
      `Drop ${hint.drop.provider} from the chain and keep ${hint.keep.provider} first?\n\n`
      + `This rewrites the active provider override (writes audit row).`,
    )) return;
    setApplyingHintIdx(idx); setError(null);
    try {
      const res = await fetch('/api/nexyfab/admin/apply-consolidation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          keep: { provider: hint.keep.provider },
          drop: { provider: hint.drop.provider },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server ${res.status}`);
      setAppliedHints(prev => {
        const next = new Map(prev);
        next.set(idx, { oldChain: data.oldChain ?? [], newChain: data.newChain ?? [] });
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingHintIdx(null);
    }
  }, []);

  // Load known prompt ids by hitting prompt-stats? Simpler: hardcode a few or
  // pull a known list — keep hardcoded for now to avoid an extra API.
  useEffect(() => {
    setPromptIds([
      'shape-chat', 'scad-intent-from-nl', 'scad-intent-from-nl:tighter',
      'openscad-gen', 'openscad-gen-generate', 'openscad-gen-refine',
      'openscad-gen-fix', 'openscad-gen-face-op',
      'compose', 'intake-from-text', 'shape-to-jscad',
    ]);
  }, []);

  const toggle = (p: string) => {
    const next = new Set(providers);
    if (next.has(p)) next.delete(p); else next.add(p);
    setProviders(next);
  };

  const run = useCallback(async () => {
    if (!userInput.trim()) return;
    if (providers.size === 0) { setError('Pick at least one provider'); return; }
    setRunning(true); setError(null); setResult(null);
    try {
      const body: Record<string, unknown> = {
        promptId,
        userInput,
        providers: Array.from(providers),
      };
      if (maxTokens !== '') body.maxTokens = maxTokens;
      if (temperature !== '') body.temperature = temperature;

      const res = await fetch('/api/nexyfab/admin/prompt-compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server ${res.status}`);
      setResult(data as CompareResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [promptId, userInput, providers, maxTokens, temperature]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">{copy.pageTitles.promptCompare}</h1>
        <p className="text-xs text-gray-500">
          Runs the chosen prompt + input across every selected provider in parallel. Token cost is real — use sparingly.
        </p>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-xs text-gray-400">Prompt</label>
            <select
              value={promptId}
              onChange={e => setPromptId(e.target.value)}
              className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm font-mono"
            >
              {promptIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>

            <label className="text-xs text-gray-400 ml-2">Providers</label>
            {PROVIDER_OPTIONS.map(p => (
              <label key={p} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={providers.has(p)}
                  onChange={() => toggle(p)}
                />
                {p}
              </label>
            ))}

            <label className="text-xs text-gray-400 ml-2">maxTokens</label>
            <input
              type="number"
              placeholder="default"
              value={maxTokens}
              onChange={e => setMaxTokens(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm w-24"
            />
            <label className="text-xs text-gray-400 ml-2">temp</label>
            <input
              type="number"
              step="0.05"
              placeholder="default"
              value={temperature}
              onChange={e => setTemperature(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm w-20"
            />
          </div>

          <textarea
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            placeholder="User input — what to send as the user message…"
            rows={4}
            className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm"
          />

          <button
            type="button"
            onClick={() => void run()}
            disabled={running || !userInput.trim() || providers.size === 0}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded text-sm font-medium"
          >
            {running ? 'Running…' : `Run on ${providers.size} provider${providers.size === 1 ? '' : 's'}`}
          </button>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {result && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-gray-500">
                Resolved: <span className="font-mono">{result.promptId}@{result.promptVersion}</span> · maxTokens={result.maxTokens} · temp={result.temperature}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => downloadJson(result, userInput)}
                  className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded border border-gray-700"
                >
                  ⬇ JSON
                </button>
                <button
                  type="button"
                  onClick={() => downloadCsv(result)}
                  className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded border border-gray-700"
                >
                  ⬇ CSV
                </button>
              </div>
            </div>
          )}
        </div>

        {result && result.consolidationHints && result.consolidationHints.length > 0 && (
          <section className="bg-amber-950/40 border border-amber-700/50 rounded-lg p-3 space-y-2">
            <h2 className="text-sm font-semibold text-amber-200">
              💡 Consolidation hints
              <span className="text-xs text-amber-300/60 ml-2">High similarity + meaningful cost gap</span>
            </h2>
            <ul className="space-y-2 text-sm">
              {result.consolidationHints.map((h, idx) => {
                const applied = appliedHints.get(idx);
                return (
                  <li key={idx} className="text-amber-100 flex items-start gap-3 flex-wrap">
                    <span className="flex-1 min-w-0">
                      <span className="font-mono">{h.keep.provider}/{h.keep.model}</span>
                      {' '}({fmtUsd(h.keep.costCents)})
                      {' answered '}
                      <span className="font-semibold">{(h.similarity * 100).toFixed(1)}%</span>
                      {' identically to '}
                      <span className="font-mono">{h.drop.provider}/{h.drop.model}</span>
                      {' ('}{fmtUsd(h.drop.costCents)}{') — drop the expensive one to save '}
                      <span className="font-semibold">{(h.savingsRatio * 100).toFixed(0)}%</span>
                    </span>
                    {applied ? (
                      <span className="text-xs px-2 py-1 bg-emerald-900/50 border border-emerald-700/40 rounded text-emerald-200">
                        ✓ applied · chain: {applied.newChain.join(' → ') || '(empty)'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void applyHint(h, idx)}
                        disabled={applyingHintIdx !== null}
                        className="text-xs px-2 py-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 rounded border border-amber-500/40 text-amber-50 whitespace-nowrap"
                        title={`Drop ${h.drop.provider}, keep ${h.keep.provider} at front`}
                      >
                        {applyingHintIdx === idx ? 'Applying…' : `1-click drop ${h.drop.provider}`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {result && result.similarity && result.similarityProviders && result.similarity.length >= 2 && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <h2 className="text-sm font-semibold mb-2 text-gray-300">
              Pairwise similarity (cosine, token freq)
              <span className="text-xs text-gray-500 ml-2">1.0 = identical, 0.0 = nothing in common</span>
            </h2>
            <table className="text-xs font-mono">
              <thead>
                <tr>
                  <th></th>
                  {result.similarityProviders.map(p => (
                    <th key={p} className="px-2 py-1 text-gray-400">{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.similarity.map((row, i) => (
                  <tr key={i}>
                    <th className="px-2 py-1 text-right text-gray-400">{result.similarityProviders![i]}</th>
                    {row.map((v, j) => {
                      const self = i === j;
                      const bg = self
                        ? 'rgba(56,139,253,0.2)'
                        : `rgba(34,197,94,${Math.max(0, v).toFixed(3)})`;
                      return (
                        <td
                          key={j}
                          className="px-2 py-1 text-center"
                          style={{ background: bg }}
                          title={`${result.similarityProviders![i]} vs ${result.similarityProviders![j]}: ${v.toFixed(3)}`}
                        >
                          {self ? '—' : v.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {result && (
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${result.results.length}, minmax(0, 1fr))` }}>
            {result.results.map(r => (
              <div key={r.provider} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                <header className="px-3 py-2 bg-gray-800/60 border-b border-gray-800 flex items-center justify-between">
                  <span className="font-mono text-sm">{r.provider}</span>
                  <span className={`text-xs ${
                    r.ok ? 'text-emerald-400' :
                    !r.configured ? 'text-gray-500' : 'text-red-400'
                  }`}>
                    {r.ok ? '✓' : !r.configured ? '— not configured' : '✗ error'}
                  </span>
                </header>
                <div className="p-3 space-y-2">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{r.model ?? '—'}</span>
                    <span>{fmtMs(r.latencyMs)}</span>
                  </div>
                  {r.ok && (
                    <div className="text-xs text-gray-400">
                      tokens in/out: {r.promptTokens ?? '?'} / {r.completionTokens ?? '?'}
                    </div>
                  )}
                  {r.ok ? (
                    <pre className="text-xs whitespace-pre-wrap break-words bg-gray-950 border border-gray-800 rounded p-2 max-h-[28rem] overflow-y-auto">
                      {r.text ?? ''}
                    </pre>
                  ) : (
                    <div className="text-xs text-red-300/80 bg-red-950/40 border border-red-900/40 rounded p-2 whitespace-pre-wrap">
                      <span className="font-semibold">{r.errorClass ?? 'error'}</span>
                      <br />
                      {r.error ?? ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
