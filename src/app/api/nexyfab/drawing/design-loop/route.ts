/**
 * POST /api/nexyfab/drawing/design-loop — 전수 설계 루프.
 * { assembly, params, format? } → 부재별 판정표(JSON). format='html'이면 일괄 계산서
 * (판정 요약표 + 부재별 1장 page-break) 인쇄용 HTML 동봉.
 * 교차검증(최악부재=load-path 대표부재 Mu 일치)·제외 파츠·근사 명시를 그대로 전달.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Member {
  id: string; kind: string; section: string; grid?: string; span_mm?: number; trib_m2?: number;
  Mu_kNm?: number; Vu_kN?: number; Pu_kN?: number; method?: string; verdict: string;
  util?: number | null; checks?: Record<string, unknown> | null; error?: string | null;
  As_used?: number | null; Ast_used?: number | null; floorsAbove?: number;
}
interface LoopResult {
  ok: boolean; error?: string; members?: Member[];
  summary?: Record<string, unknown>; crossCheck?: Record<string, unknown>;
  excludedUnverified?: string[]; loads?: Record<string, unknown>; notes?: string[]; disclaimer?: string;
}
interface SuggestResult {
  ok: boolean; error?: string; before?: Record<string, unknown>; afterSummary?: Record<string, unknown> | null;
  suggestions?: Array<Record<string, unknown>>; verified?: boolean; rebarById?: Record<string, unknown>; disclaimer?: string;
}
type LoopModule = {
  designLoop: (assembly: unknown, params: Record<string, unknown>) => LoopResult;
  designSuggest: (assembly: unknown, params: Record<string, unknown>) => SuggestResult;
};

let _mod: LoopModule | null = null;
async function load(): Promise<LoopModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'design-loop.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as LoopModule;
  return _mod;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function objRows(o: unknown, pfx = ''): string {
  if (o === null || o === undefined || typeof o !== 'object') return `<tr><td>${esc(pfx)}</td><td>${esc(o)}</td></tr>`;
  if (Array.isArray(o)) return `<tr><td>${esc(pfx)}</td><td><pre>${esc(JSON.stringify(o, null, 1))}</pre></td></tr>`;
  return Object.entries(o as Record<string, unknown>).map(([k, v]) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? objRows(v, pfx ? `${pfx}.${k}` : k)
      : `<tr><td>${esc(pfx ? `${pfx}.${k}` : k)}</td><td>${Array.isArray(v) ? esc(JSON.stringify(v)) : typeof v === 'boolean' ? (v ? '✓' : '✗') : esc(v)}</td></tr>`).join('');
}

function batchHtml(r: LoopResult, title: string): string {
  const members = r.members ?? [];
  const sumRow = members.map((m, i) =>
    `<tr><td>${i + 1}</td><td>${esc(m.id)}</td><td>${esc(m.kind === 'beam' ? '보' : '기둥')}${m.grid ? ` (${esc(m.grid)})` : ''}</td><td>${esc(m.section)}</td>` +
    `<td>${m.Mu_kNm ?? '—'}</td><td>${m.Vu_kN ?? '—'}</td><td>${m.Pu_kN ?? '—'}</td>` +
    `<td>${m.util !== null && m.util !== undefined ? (m.util * 100).toFixed(0) + '%' : '—'}</td>` +
    `<td style="font-weight:700;color:${m.verdict === 'PASS' ? '#16a34a' : m.verdict === 'FAIL' ? '#dc2626' : '#64748b'}">${esc(m.verdict)}</td></tr>`).join('');
  const sheets = members.map((m, i) => `
<div style="page-break-before:always">
<h1>부재 계산서 ${i + 1}/${members.length} — ${esc(m.id)} (${m.kind === 'beam' ? '보' : '기둥'})</h1>
<table class="meta"><tr><td>단면: ${esc(m.section)}</td><td>${m.span_mm ? `경간: ${m.span_mm}mm` : m.grid ? `위치: ${esc(m.grid)}` : ''}</td><td>분담: ${m.trib_m2 ?? '—'}m²</td><td>판정: <b style="color:${m.verdict === 'PASS' ? '#16a34a' : '#dc2626'}">${esc(m.verdict)}</b></td></tr></table>
<h2>소요 단면력</h2>
<table><tr><th>항목</th><th>값</th></tr>
${m.Mu_kNm !== undefined ? `<tr><td>Mu (kN·m)</td><td>${m.Mu_kNm}${m.method ? ` — ${esc(m.method)}` : ''}</td></tr>` : ''}
${m.Vu_kN !== undefined ? `<tr><td>Vu (kN)</td><td>${m.Vu_kN}</td></tr>` : ''}
${m.Pu_kN !== undefined ? `<tr><td>Pu (kN)${m.floorsAbove ? ` (${m.floorsAbove}층 누적)` : ''}</td><td>${m.Pu_kN}</td></tr>` : ''}
${m.As_used ? `<tr><td>적용 As (mm²)</td><td>${m.As_used}</td></tr>` : ''}${m.Ast_used ? `<tr><td>적용 Ast (mm²)</td><td>${m.Ast_used}</td></tr>` : ''}
</table>
<h2>검토 상세 (엔진 원본)</h2>
<table><tr><th>항목</th><th>값</th></tr>${objRows(m.checks ?? {})}</table>
${m.error ? `<p style="color:#dc2626">오류: ${esc(m.error)}</p>` : ''}
</div>`).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} — 전수 설계 판정표</title>
<style>@page{size:A4;margin:16mm}body{font-family:'Malgun Gothic',system-ui;font-size:11px;color:#0f172a}
h1{font-size:15px;border-bottom:2px solid #0f172a;padding-bottom:5px}h2{font-size:12px;margin:12px 0 4px;border-left:3px solid #0f172a;padding-left:6px}
table{border-collapse:collapse;width:100%;margin:4px 0}td,th{border:1px solid #94a3b8;padding:3px 6px}th{background:#f1f5f9;text-align:left}
.meta td{border:none}pre{margin:0;font-size:9px;white-space:pre-wrap}.foot{margin-top:12px;font-size:10px;color:#475569;border-top:1px solid #94a3b8;padding-top:6px}</style></head><body>
<h1>${esc(title)} — 전수 설계 판정표</h1>
<p>부재 ${members.length}개 · ${esc(JSON.stringify(r.summary))} · 교차검증 ${esc(JSON.stringify(r.crossCheck))}</p>
${(r.excludedUnverified?.length ?? 0) > 0 ? `<p style="color:#d97706">⚠ 비검증 제외 파츠: ${esc((r.excludedUnverified ?? []).join(', '))}</p>` : ''}
<table><tr><th>#</th><th>부재</th><th>구분</th><th>단면</th><th>Mu</th><th>Vu</th><th>Pu</th><th>이용률</th><th>판정</th></tr>${sumRow}</table>
${(r.notes ?? []).map((n) => `<p style="font-size:10px;color:#475569">· ${esc(n)}</p>`).join('')}
${sheets}
<div class="foot">${esc(r.disclaimer ?? '')}<br/>본 판정표·계산서는 결정론 엔진 출력의 원본 전사이며, 실시설계 반영 전 책임구조기술자의 검토·서명이 필요합니다.</div>
</body></html>`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`design-loop:${ip}`, 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });
  try {
    const body = await readBoundedJson<{ assembly?: unknown; params?: Record<string, unknown>; format?: string; title?: string; mode?: string }>(req, MAX_BODY_BYTES);
    if (!body.assembly) return NextResponse.json({ ok: false, error: 'assembly 필요' }, { status: 400 });
    const mod = await load();
    if (body.mode === 'suggest') {
      const sg = mod.designSuggest(body.assembly, body.params ?? {});
      return NextResponse.json(sg, { status: sg.ok ? 200 : 422 });
    }
    const result = mod.designLoop(body.assembly, body.params ?? {});
    if (!result.ok) return NextResponse.json(result, { status: 422 });
    if (body.format === 'html') {
      return NextResponse.json({ ...result, html: batchHtml(result, body.title ?? '전수 설계 루프') });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (boundedJsonError(e)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'assembly가 너무 큽니다.' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'design-loop failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
