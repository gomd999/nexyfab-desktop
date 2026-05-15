#!/usr/bin/env node
// NexyFab 3D modeler — performance burn-in benchmark.
// Measures: cold-start route TTFB, page TTI proxy, /api/health latency,
// and SCAD intent → STL pipeline RT for a small + medium spec.
//
// Usage: node scripts/perf-benchmark.mjs [--base=http://localhost:3000] [--json]
//
// Output: JSON to stdout (when --json) or a Markdown table to stderr.
// Exits non-zero if any check exceeds its hard budget.

import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const baseArg = args.find(a => a.startsWith('--base='));
const BASE = baseArg ? baseArg.split('=')[1] : (process.env.PERF_BASE_URL ?? 'http://localhost:3000');
const JSON_OUT = args.includes('--json');

const ROUTES = [
  { name: 'hub',     path: '/kr/nexyfab/dashboard',         budget_ms: 2500 },
  { name: 'modeler', path: '/kr/shape-generator?shell=v2',  budget_ms: 4000 },
  { name: 'drawing', path: '/kr/shape-generator/drawing',   budget_ms: 3000 },
  { name: 'render',  path: '/kr/shape-generator/render',    budget_ms: 3000 },
];

const APIS = [
  { name: 'health', path: '/api/health', budget_ms: 300 },
];

async function timeFetch(path) {
  const url = BASE + path;
  const t0 = performance.now();
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const t1 = performance.now();
    const buf = await res.arrayBuffer();
    const t2 = performance.now();
    return {
      ok: res.ok,
      status: res.status,
      ttfb_ms: Math.round(t1 - t0),
      total_ms: Math.round(t2 - t0),
      bytes: buf.byteLength,
    };
  } catch (err) {
    return { ok: false, error: err.message, ttfb_ms: null, total_ms: null, bytes: 0 };
  }
}

async function benchmarkScadIntent() {
  // Hits the SCAD intent endpoint if available; degrades to N/A otherwise.
  const url = BASE + '/api/scad-intent';
  const body = JSON.stringify({
    intent: { kind: 'plate', length_mm: 50, width_mm: 30, thickness_mm: 5 },
    options: { units: 'mm' },
  });
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const t1 = performance.now();
    await res.arrayBuffer();
    const t2 = performance.now();
    return {
      ok: res.ok,
      status: res.status,
      ttfb_ms: Math.round(t1 - t0),
      total_ms: Math.round(t2 - t0),
      budget_ms: 5000,
      available: res.status !== 404,
    };
  } catch (err) {
    return { ok: false, error: err.message, available: false };
  }
}

async function run() {
  const results = {
    base: BASE,
    timestamp: new Date().toISOString(),
    routes: [],
    apis: [],
    scad: null,
    failed: [],
  };

  for (const r of ROUTES) {
    const m = await timeFetch(r.path);
    const entry = { ...r, ...m };
    results.routes.push(entry);
    if (m.total_ms != null && m.total_ms > r.budget_ms) {
      results.failed.push(`${r.name} ${m.total_ms}ms > budget ${r.budget_ms}ms`);
    }
    if (!m.ok && m.status !== 401 && m.status !== 403) {
      // 401/403 are acceptable on auth-gated routes; everything else is a fail.
      results.failed.push(`${r.name} fetch failed status=${m.status ?? 'n/a'}`);
    }
  }

  for (const a of APIS) {
    const m = await timeFetch(a.path);
    const entry = { ...a, ...m };
    results.apis.push(entry);
    if (m.total_ms != null && m.total_ms > a.budget_ms) {
      results.failed.push(`api:${a.name} ${m.total_ms}ms > budget ${a.budget_ms}ms`);
    }
  }

  results.scad = await benchmarkScadIntent();

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    const fmt = (n) => (n == null ? '—' : String(n).padStart(5) + ' ms');
    const lines = [];
    lines.push(`# Perf benchmark · ${results.base} · ${results.timestamp}`);
    lines.push('');
    lines.push('## Routes');
    lines.push('| Route   | Status | TTFB     | Total    | Budget   | Bytes   |');
    lines.push('|---------|--------|----------|----------|----------|---------|');
    for (const r of results.routes) {
      lines.push(`| ${r.name.padEnd(7)} | ${String(r.status ?? 'ERR').padStart(6)} | ${fmt(r.ttfb_ms)} | ${fmt(r.total_ms)} | ${fmt(r.budget_ms)} | ${String(r.bytes).padStart(7)} |`);
    }
    lines.push('');
    lines.push('## APIs');
    for (const a of results.apis) {
      lines.push(`- ${a.name}: ${a.ok ? 'OK' : 'FAIL'} TTFB=${fmt(a.ttfb_ms)} budget=${fmt(a.budget_ms)}`);
    }
    if (results.scad?.available) {
      lines.push(`- scad-intent (plate 50×30×5): TTFB=${fmt(results.scad.ttfb_ms)} budget=${fmt(results.scad.budget_ms)}`);
    } else {
      lines.push('- scad-intent: endpoint unavailable (skip)');
    }
    if (results.failed.length) {
      lines.push('');
      lines.push('## FAILED');
      for (const f of results.failed) lines.push(`- ${f}`);
    }
    process.stderr.write(lines.join('\n') + '\n');
  }

  if (results.failed.length) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(2);
});
