'use client';

/**
 * 계산기 스튜디오 — CALC_CATALOG(자동생성 38종)를 읽어 스키마→폼 자동 생성.
 * 계산기 추가 시 UI 코드 수정 없이 카탈로그 재생성만으로 노출된다.
 *
 * 정직성: 결과는 engineering-core 원본(verdict/checks/refs/status/disclaimer) 그대로.
 * 입력 게이트 오류(422)는 해당 필드로 안내(값을 지어내지 않음). 계산서 출력은
 * "참고자료(비법정) — 책임구조기술자 검토·날인" 문구를 인쇄본에 고정 포함.
 * 배근 전개도는 rc_beam/rc_column 결과 옆에서 치수 입력으로 생성(도면 소스 — 판정 없음).
 */

import { useMemo, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';
import { CALC_CATALOG, type CalcSpec, type CalcParam } from '@/app/api/eng-chat/calcCatalog';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
interface CalcRunResult {
  verdict?: string; checks?: Json; intermediate?: Json; notes?: string[]; refs?: string[];
  status?: string; disclaimer?: string; attribution?: string; [k: string]: Json | undefined;
}

const DOMAIN_LABEL: Record<string, [string, string]> = {
  mechanical: ['기계', 'Mechanical'], architecture: ['건축', 'Architecture'], civil: ['토목', 'Civil'],
  bridge: ['교량', 'Bridge'], landscape: ['조경', 'Landscape'], interior: ['인테리어', 'Interior'],
  building: ['건축', 'Building'], structure: ['구조', 'Structure'],
};

function isNumericParam(p: CalcParam): boolean {
  return p.type === 'number' || p.type === 'integer';
}

function renderValue(v: Json): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  return JSON.stringify(v);
}

/** checks/intermediate 재귀 표 렌더 — 어떤 계산기 결과든 표로. */
function ObjTable({ data }: { data: Json }) {
  if (data === null || typeof data !== 'object') return <span>{renderValue(data)}</span>;
  if (Array.isArray(data)) {
    if (!data.length) return <span>—</span>;
    if (typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])) {
      const cols = Array.from(new Set(data.flatMap((r) => (typeof r === 'object' && r !== null && !Array.isArray(r) ? Object.keys(r) : []))));
      return (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead><tr>{cols.map((c) => <th key={c} className="border border-slate-200 dark:border-slate-700 px-2 py-1 text-left bg-slate-50 dark:bg-slate-800">{c}</th>)}</tr></thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>{cols.map((c) => {
                  const cell = typeof row === 'object' && row !== null && !Array.isArray(row) ? (row as Record<string, Json>)[c] : undefined;
                  return <td key={c} className="border border-slate-200 dark:border-slate-700 px-2 py-1">{typeof cell === 'object' && cell !== null ? <ObjTable data={cell} /> : renderValue(cell as Json)}</td>;
                })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <span className="text-xs">{data.map((x) => renderValue(x)).join(', ')}</span>;
  }
  const entries = Object.entries(data as Record<string, Json>);
  return (
    <table className="text-xs border-collapse w-full">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="border border-slate-200 dark:border-slate-700 px-2 py-1 font-medium bg-slate-50 dark:bg-slate-800 whitespace-nowrap align-top">{k}</td>
            <td className="border border-slate-200 dark:border-slate-700 px-2 py-1">
              {typeof v === 'object' && v !== null ? <ObjTable data={v} /> : renderValue(v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 계산서 인쇄 HTML — 입력→중간값→판정→근거 1장 양식(자기완결·A4). */
function buildSheetHtml(spec: CalcSpec, inputUsed: Record<string, Json>, result: CalcRunResult, opts: { project: string; member: string; svg?: string | null }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const objRows = (o: Json, pfx = ''): string => {
    if (o === null || typeof o !== 'object') return `<tr><td>${esc(pfx)}</td><td>${esc(renderValue(o))}</td></tr>`;
    if (Array.isArray(o)) return `<tr><td>${esc(pfx)}</td><td><pre>${esc(JSON.stringify(o, null, 1))}</pre></td></tr>`;
    return Object.entries(o as Record<string, Json>).map(([k, v]) =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
        ? objRows(v, pfx ? `${pfx}.${k}` : k)
        : `<tr><td>${esc(pfx ? `${pfx}.${k}` : k)}</td><td>${Array.isArray(v) ? `<pre>${esc(JSON.stringify(v, null, 1))}</pre>` : esc(renderValue(v))}</td></tr>`
    ).join('');
  };
  const inputRows = Object.entries(inputUsed).map(([k, v]) => {
    const d = spec.params[k]?.desc ?? '';
    return `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</td><td class="desc">${esc(d)}</td></tr>`;
  }).join('');
  const verdict = result.verdict ?? 'INFO';
  const vColor = verdict === 'PASS' ? '#16a34a' : verdict === 'FAIL' ? '#dc2626' : verdict === 'WARN' ? '#d97706' : '#475569';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>구조계산 검토서 — ${esc(spec.title)}</title>
<style>
@page{size:A4;margin:18mm}body{font-family:'Malgun Gothic',system-ui,sans-serif;font-size:11px;color:#0f172a;margin:0}
h1{font-size:16px;border-bottom:2px solid #0f172a;padding-bottom:6px}h2{font-size:12px;margin:14px 0 4px;border-left:3px solid #0f172a;padding-left:6px}
table{border-collapse:collapse;width:100%;margin:4px 0}td,th{border:1px solid #94a3b8;padding:3px 6px;vertical-align:top}
th{background:#f1f5f9;text-align:left}td.desc{color:#475569;font-size:10px}
.meta td{border:none;padding:1px 4px}.verdict{display:inline-block;padding:2px 14px;border:2px solid ${vColor};color:${vColor};font-weight:700;font-size:14px}
.foot{margin-top:16px;padding-top:8px;border-top:1px solid #94a3b8;font-size:10px;color:#475569}
pre{margin:0;font-size:10px;white-space:pre-wrap}svg{max-width:100%;height:auto}
</style></head><body>
<h1>구조계산 검토서 — ${esc(spec.title)}</h1>
<table class="meta"><tr><td>프로젝트: ${esc(opts.project || '—')}</td><td>부재: ${esc(opts.member || '—')}</td><td>기준: ${esc((result.standard as string) ?? 'KDS')}</td><td>일자: ${new Date().toISOString().slice(0, 10)}</td></tr></table>
<h2>1. 설계 입력</h2>
<table><tr><th>항목</th><th>값</th><th>설명(스키마)</th></tr>${inputRows}</table>
<h2>2. 산출 결과 (검토항목·중간값)</h2>
<table><tr><th>항목</th><th>값</th></tr>${objRows(result.checks ?? null)}${result.intermediate ? objRows(result.intermediate, 'intermediate') : ''}</table>
<h2>3. 판정</h2>
<p><span class="verdict">${esc(verdict)}</span></p>
${result.notes?.length ? `<h2>4. 산정 근거·가정</h2><ul>${result.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<h2>${result.notes?.length ? 5 : 4}. 적용 기준</h2>
<ul>${(result.refs ?? []).map((r) => `<li>${esc(r)}</li>`).join('')}<li>검증 상태: ${esc(result.status ?? '')}</li></ul>
${opts.svg ? `<h2>도면(배근 전개 — 소스)</h2>${opts.svg}` : ''}
<div class="foot">
${esc(result.disclaimer ?? '구조 검토 참고자료(비법정) — 법정 계산서는 기술사 날인 영역')}<br/>
본 검토서는 NexyFab 결정론 계산 엔진 출력의 원본 전사이며, 실시설계 반영 전 책임구조기술자의 검토·서명이 필요합니다.
${result.attribution ? `<br/>${esc(result.attribution)}` : ''}
</div>
</body></html>`;
}

export default function CalcStudioPanel({ lang }: { lang: string }) {
  const ko = isKorean(lang);
  const groups = useMemo(() => {
    const g = new Map<string, CalcSpec[]>();
    for (const c of CALC_CATALOG) {
      const key = c.domain.split('/')[0];
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(c);
    }
    return g;
  }, []);
  const [calcId, setCalcId] = useState('');
  const spec = useMemo(() => CALC_CATALOG.find((c) => c.id === calcId) ?? null, [calcId]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CalcRunResult | null>(null);
  const [inputUsed, setInputUsed] = useState<Record<string, Json>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState('');
  const [member, setMember] = useState('');
  // 배근 전개도(rc_beam/rc_column 전용)
  const [reb, setReb] = useState<Record<string, string>>({ L_mm: '6000', sEnd_mm: '150', sMid_mm: '300', endZone_mm: '', topBars: '2-D22', botBars: '4-D22', stirrup: 'D10' });
  // 케이스 스택 — 부재 여러 개 검토 후 일괄 계산서(장당 1부재, page-break)
  const [cases, setCases] = useState<Array<{ calcId: string; member: string; inputUsed: Record<string, Json>; result: CalcRunResult; svg: string | null }>>([]);
  const [rebSvg, setRebSvg] = useState<string | null>(null);
  const showRebar = calcId === 'rc_beam' || calcId === 'rc_column_pm';

  const pick = (id: string) => { setCalcId(id); setVals({}); setResult(null); setErr(null); setRebSvg(null); };

  const run = async () => {
    if (!spec) return;
    setLoading(true); setErr(null); setResult(null);
    try {
      const input: Record<string, Json> = {};
      for (const [k, p] of Object.entries(spec.params)) {
        const raw = vals[k];
        if (raw === undefined || raw.trim() === '') continue;
        if (isNumericParam(p)) {
          const n = Number(raw);
          if (Number.isNaN(n)) throw new Error(`${k}: ${ko ? '숫자 필요' : 'number required'}`);
          input[k] = n;
        } else if (p.type === 'boolean') input[k] = raw === 'true';
        else if (p.enum) input[k] = raw;
        else if (p.type === 'string') input[k] = raw;
        else {
          try { input[k] = JSON.parse(raw) as Json; } catch { throw new Error(`${k}: ${ko ? 'JSON 형식 오류' : 'invalid JSON'}`); }
        }
      }
      const res = await fetch('/api/nexyfab/drawing/calc/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: spec.id, input }),
      });
      const j = (await res.json()) as { ok: boolean; result?: CalcRunResult; error?: string };
      if (!j.ok || !j.result) { setErr(j.error ?? 'error'); return; }
      setResult(j.result); setInputUsed(input);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  const drawRebar = async (rebOverride?: Record<string, string>) => {
    const r = rebOverride ?? reb;
    const params: Record<string, Json> = {
      type: calcId === 'rc_column_pm' ? 'column' : 'beam',
      L_mm: Number(r.L_mm) || 6000, sEnd_mm: Number(r.sEnd_mm) || 150, sMid_mm: Number(r.sMid_mm) || 300,
      ...(Number(r.endZone_mm) > 0 ? { endZone_mm: Number(r.endZone_mm) } : {}),
      topBars: r.topBars, botBars: r.botBars, stirrup: r.stirrup,
    };
    const res = await fetch('/api/nexyfab/drawing/calc/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawing: { kind: 'rebar_elevation', params } }),
    });
    const j = (await res.json()) as { ok: boolean; svg?: string; error?: string };
    if (j.ok && j.svg) setRebSvg(j.svg); else setErr(j.error ?? 'drawing error');
  };

  const onRebDimClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = (e.target as HTMLElement).closest('[data-param]');
    const key = t?.getAttribute('data-param');
    if (!key) return;
    const nv = window.prompt((ko ? '새 값(mm) — ' : 'New value (mm) — ') + key, reb[key] ?? '');
    if (nv === null || nv.trim() === '' || !Number.isFinite(Number(nv))) return;
    const next = { ...reb, [key]: nv };
    setReb(next);
    void drawRebar(next);
  };

  const printSheet = () => {
    if (!spec || !result) return;
    const html = buildSheetHtml(spec, inputUsed, result, { project, member, svg: rebSvg });
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const addCase = () => {
    if (!spec || !result) return;
    setCases((s) => [...s, { calcId: spec.id, member: member || `부재 ${s.length + 1}`, inputUsed, result, svg: rebSvg }]);
  };

  const printAllCases = () => {
    if (!cases.length) return;
    const bodies = cases.map((c) => {
      const sp = CALC_CATALOG.find((x) => x.id === c.calcId);
      if (!sp) return '';
      const html = buildSheetHtml(sp, c.inputUsed, c.result, { project, member: c.member, svg: c.svg });
      const m = html.match(/<body>([\s\S]*)<\/body>/);
      return `<div style="page-break-after:always">${m ? m[1] : ''}</div>`;
    }).join('');
    const first = buildSheetHtml(CALC_CATALOG.find((x) => x.id === cases[0].calcId)!, cases[0].inputUsed, cases[0].result, { project, member: cases[0].member, svg: cases[0].svg });
    const head = first.slice(0, first.indexOf('<body>') + 6);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(head + bodies + '</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  const savePreset = () => {
    if (!spec) return;
    try { localStorage.setItem(`nf-calc-preset-${spec.id}`, JSON.stringify(vals)); } catch { /* 저장 실패 무시 */ }
  };
  const loadPreset = () => {
    if (!spec) return;
    try {
      const raw = localStorage.getItem(`nf-calc-preset-${spec.id}`);
      if (raw) setVals(JSON.parse(raw) as Record<string, string>);
    } catch { /* 무시 */ }
  };

  const verdict = result?.verdict ?? null;
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold text-sm">{ko ? '계산기 스튜디오 — 전 분야 38종' : 'Calculator Studio — 38 engines'}</h3>
        <span className="text-[11px] text-slate-500">{ko ? '스키마 자동 폼 · 결과는 엔진 원본 그대로(비법정 참고)' : 'Auto-form from schema · raw engine output (non-statutory)'}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from(groups.entries()).map(([dom, list]) => (
          <details key={dom} className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1" open={list.some((c) => c.id === calcId)}>
            <summary className="text-xs font-semibold cursor-pointer">{(DOMAIN_LABEL[dom]?.[ko ? 0 : 1]) ?? dom} ({list.length})</summary>
            <div className="flex flex-wrap gap-1 py-1 max-w-md">
              {list.map((c) => (
                <button key={c.id} onClick={() => pick(c.id)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${calcId === c.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900' : 'border-slate-300 dark:border-slate-600 hover:border-slate-500'}`}>
                  {c.title}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
      {spec && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 dark:text-slate-300">{spec.description}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(spec.params).map(([k, p]) => {
              const required = spec.required.includes(k);
              const isObj = !p.type && !p.enum;
              return (
                <label key={k} className={`text-xs flex flex-col gap-0.5 ${isObj ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
                  <span className="font-medium">{k}{required && <span className="text-rose-500"> *</span>}</span>
                  <span className="text-[10px] text-slate-500 line-clamp-2" title={p.desc}>{p.desc}</span>
                  {p.enum ? (
                    <select value={vals[k] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))}
                      className="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1">
                      <option value="">—</option>
                      {p.enum.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                    </select>
                  ) : p.type === 'boolean' ? (
                    <select value={vals[k] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))}
                      className="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1">
                      <option value="">—</option><option value="true">true</option><option value="false">false</option>
                    </select>
                  ) : isObj ? (
                    <textarea value={vals[k] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))}
                      placeholder={ko ? 'JSON 입력 (설명 참조)' : 'JSON (see description)'} rows={2}
                      className="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 font-mono text-[11px]" />
                  ) : (
                    <input value={vals[k] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))}
                      inputMode={isNumericParam(p) ? 'decimal' : 'text'}
                      placeholder={isNumericParam(p) ? [p.min !== undefined ? `≥${p.min}` : '', p.max !== undefined ? `≤${p.max}` : ''].filter(Boolean).join(' ') : ''}
                      className="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1" />
                  )}
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={run} disabled={loading}
              className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50">
              {loading ? (ko ? '계산 중…' : 'Running…') : (ko ? '계산 실행' : 'Run')}
            </button>
            {result && (
              <>
                <input value={project} onChange={(e) => setProject(e.target.value)} placeholder={ko ? '프로젝트명(계산서)' : 'Project (sheet)'}
                  className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 w-36" />
                <input value={member} onChange={(e) => setMember(e.target.value)} placeholder={ko ? '부재 표기 예: G1' : 'Member e.g. G1'}
                  className="text-xs rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 w-28" />
                <button onClick={printSheet}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                  🖨 {ko ? '계산서 출력(1장 양식)' : 'Print calc sheet'}
                </button>
                <button onClick={addCase}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                  ＋ {ko ? '케이스 저장' : 'Save case'}
                </button>
              </>
            )}
            <span className="mx-1 text-slate-300">|</span>
            <button onClick={savePreset} className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">{ko ? '입력 저장' : 'Save inputs'}</button>
            <button onClick={loadPreset} className="text-[11px] px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">{ko ? '입력 불러오기' : 'Load inputs'}</button>
          </div>
          {cases.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-lg border border-slate-200 dark:border-slate-700 p-2">
              <span className="text-[11px] font-semibold">{ko ? `케이스 ${cases.length}건` : `${cases.length} cases`}</span>
              {cases.map((c, i) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border ${c.result.verdict === 'PASS' ? 'border-green-500 text-green-700' : c.result.verdict === 'FAIL' ? 'border-rose-500 text-rose-700' : 'border-slate-400 text-slate-600'}`}>
                  {c.member}·{c.result.verdict ?? 'INFO'}
                  <button onClick={() => setCases((s) => s.filter((_, j) => j !== i))} className="ml-1 text-slate-400 hover:text-rose-500">×</button>
                </span>
              ))}
              <button onClick={printAllCases} className="text-[11px] font-semibold px-3 py-1 rounded-lg border border-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                🖨 {ko ? '일괄 계산서(부재별 1장)' : 'Print all sheets'}
              </button>
            </div>
          )}
          {err && <p className="text-xs text-rose-600 whitespace-pre-wrap">{err}</p>}
          {result && (
            <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              {verdict && (
                <span className={`inline-block text-xs font-bold px-3 py-0.5 rounded-full border-2 ${verdict === 'PASS' ? 'border-green-600 text-green-700' : verdict === 'FAIL' ? 'border-rose-600 text-rose-700' : verdict === 'WARN' ? 'border-amber-600 text-amber-700' : 'border-slate-500 text-slate-600'}`}>{verdict}</span>
              )}
              {result.checks !== undefined && <ObjTable data={result.checks as Json} />}
              {result.intermediate !== undefined && (
                <details><summary className="text-[11px] text-slate-500 cursor-pointer">{ko ? '중간값' : 'Intermediates'}</summary><ObjTable data={result.intermediate as Json} /></details>
              )}
              {Array.isArray(result.notes) && <ul className="text-[11px] text-slate-600 dark:text-slate-300 list-disc pl-4 space-y-0.5">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              {Array.isArray(result.refs) && <p className="text-[10px] text-slate-500">{result.refs.join(' · ')}</p>}
              {result.status && <p className="text-[10px] text-slate-400">{ko ? '검증 상태: ' : 'Verification: '}{result.status}</p>}
              {result.disclaimer && <p className="text-[10px] text-amber-700 dark:text-amber-400">{result.disclaimer}</p>}
            </div>
          )}
          {showRebar && (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 p-3 space-y-2">
              <p className="text-xs font-semibold">{ko ? '배근 전개도(입면) — 실시도면 소스' : 'Rebar elevation — drawing source'}</p>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {([['L_mm', ko ? '경간/층고' : 'Span/Story'], ['sEnd_mm', ko ? '단부간격' : 'End spacing'], ['sMid_mm', ko ? '중앙간격' : 'Mid spacing'], ['topBars', ko ? '상부근' : 'Top bars'], ['botBars', ko ? '하부근' : 'Bottom bars'], ['stirrup', ko ? '늑근' : 'Stirrup']] as const).map(([k, label]) => (
                  <label key={k} className="flex flex-col">
                    <span className="text-slate-500">{label}</span>
                    <input value={reb[k]} onChange={(e) => setReb((s) => ({ ...s, [k]: e.target.value }))}
                      className="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-0.5 w-24" />
                  </label>
                ))}
                <button onClick={() => drawRebar()} className="self-end text-xs font-semibold px-3 py-1 rounded-lg border border-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">{ko ? '전개도 생성' : 'Draw'}</button>
              </div>
              {rebSvg && <div className="bg-white rounded-lg p-2 overflow-x-auto" onClick={onRebDimClick} dangerouslySetInnerHTML={{ __html: rebSvg }} />}
              {rebSvg && <p className="text-[10px] text-slate-500">{ko ? '정착·이음 상세는 KDS 14 20 52 별도 설계 — 도면 소스(판정 없음). 계산서 출력에 자동 포함.' : 'Anchorage/splice per KDS 14 20 52 separately — drawing source only, included in printed sheet.'}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
