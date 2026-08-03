'use client';

/**
 * ChatHero — 채팅-우선 랜딩 히어로 (Genspark/GPT형).
 *
 * 중앙 채팅 입력 + 하단 5개 분야 칩(기계설계·토목·건축·조경·인테리어).
 * 사용자가 자연어로 물으면 /api/eng-chat 을 도메인과 함께 호출해 실제 AI 응답을
 * 인라인으로 렌더한다. 전문가 CAD(expert)는 사람에게 직접 노출하지 않고, 여기서
 * AI가 상담·안내한 뒤 필요한 경우에만 결정론 데모/견적/스튜디오로 이어 준다.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type * as ThreeNS from 'three';
import { DomainIcon } from './_domainIcons';
import Md from '@/components/nexyfab/Md';
import { ACCEPT_RASTER, imageFromTransfer, isAcceptedRaster } from '@/lib/drawingInput';

// three/R3F 뷰어는 SSR 불가 → 클라이언트에서만 로드.
const ChatCadViewer = dynamic(() => import('./ChatCadViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: 240, borderRadius: 10, background: '#0b1020', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>3D…</div>
  ),
});

type Domain = 'mechanical' | 'civil' | 'architecture' | 'landscape' | 'interior';
type CheckRow = { name: string; pass: boolean; detail: string };
type CalcResult = { verdict: string; title: string; checks: CheckRow[]; refs: string[]; remaining?: number; error?: string };
type ComposeIntent = { name?: string; features?: Array<Record<string, unknown>> };
type AssemblyPlan = { name?: string; parts?: Array<Record<string, unknown>> };
// 기계 CAD 결과. 단일부품(compose→STEP) 또는 멀티바디 조립체(assemble→GA) 스테이지.
type CadResult = {
  composing?: boolean;          // 생성 진행 중(십수 초)
  error?: string;
  scad?: string;
  gateErrors?: string[];         // 결정론 게이트 위반(빈배열=통과)
  spec?: string[];               // 사람이 검토할 치수 사양/부품목록(체크포인트)
  // 단일부품
  composeIntent?: ComposeIntent; // export-step 입력
  // 멀티바디 조립체
  isAssembly?: boolean;
  assembly?: AssemblyPlan;       // render-html 입력
  partsAabb?: Array<{ id: string; aabb: { min: number[]; max: number[] } }>; // P1 픽킹(부품 프록시)
  scadDraft?: string; partsAabbDraft?: CadResult['partsAabb']; // #1 LOD 1차 골격
  interferences?: Array<Record<string, unknown>>;
  contacts?: Array<Record<string, unknown>>;
  welds?: Array<Record<string, unknown>>;  // 용접 조인트 개산
  weldTotalMm?: number;
  structural?: StructuralResult;            // 형상기반 자동 구조검증
};
type StructuralResult = {
  totalMassKg?: number; cgHeightM?: number; maxSupportKg?: number;
  tipover?: { staticAngleDeg?: number; seismicG?: number; seismicFS?: number };
  warnings?: string[];
};
type CableRow = { from?: unknown; to?: unknown; type?: unknown; cores?: unknown; mm2?: unknown; lengthM?: unknown; note?: unknown };
type Msg = { role: 'user' | 'assistant'; content: string; calc?: CalcResult; cad?: CadResult; wiring?: CableRow[]; image?: string; calcId?: string; calcInput?: Record<string, unknown>; genImage?: string; genSrc?: string; genFromImage?: boolean };
type Attached = { dataUrl: string; base64: string; mime: string; name: string };
// 챗 스레드 (좌측 사이드바 — 게스트 localStorage·회원 서버 동기화)
type Thread = { id: string; title: string; domain: Domain; at: number; updated: number; pinned?: boolean; badge?: string | null; aiTitled?: boolean; msgs: Msg[] };
const THREADS_KEY = 'nf_chat_threads_v1';
const newThreadId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const titleFrom = (text: string) => { const t2 = text.replace(/\s+/g, ' ').trim(); return t2.length <= 26 ? t2 : t2.slice(0, 26) + '…'; };
const GHOST_BTN = { padding: '3px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(148,163,184,0.9)' };
// 챗 도메인 → 스튜디오 분야 슬러그 (Studio 핸드오프에 분야를 함께 넘긴다)
const STUDIO_DOMAIN: Record<string, string> = { mechanical: 'mech', civil: 'civil', architecture: 'building', landscape: 'landscape', interior: 'interior' };
// 스레드 분야 아이콘(2026-07-16) — 색점 대신 한눈에 구분
const scadKey = (x: string) => { let h = 5381; for (let i = 0; i < x.length; i += 37) h = ((h << 5) + h + x.charCodeAt(i)) | 0; return h + ':' + x.length; };
const DOMAIN_EMOJI_TH: Record<string, string> = { mechanical: '🔧', civil: '🌉', architecture: '🏢', landscape: '🌳', interior: '🪑' };
const badgeFrom = (msgs: Msg[]): string | null => { for (let i = msgs.length - 1; i >= 0; i--) { const v = (msgs[i].calc as { verdict?: string } | undefined)?.verdict; if (v) return v; } return null; };
function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (raw) return (JSON.parse(raw) as Thread[]).filter((t2) => Array.isArray(t2.msgs));
    const old = localStorage.getItem('nf_chat_v1');
    if (old) {
      const saved = JSON.parse(old) as { domain?: Domain; messages?: Msg[] };
      if (saved.messages?.length) {
        const first = saved.messages.find((m) => m.role === 'user');
        const th: Thread = { id: newThreadId(), title: titleFrom(first?.content ?? 'Chat'), domain: (saved.domain ?? 'mechanical') as Domain, at: Date.now(), updated: Date.now(), badge: badgeFrom(saved.messages), msgs: saved.messages };
        localStorage.setItem(THREADS_KEY, JSON.stringify([th]));
        localStorage.removeItem('nf_chat_v1');
        return [th];
      }
    }
  } catch { /* ignore */ }
  return [];
}
function saveThreadsLocal(list: Thread[]) {
  try {
    const trimmed = list.slice(0, 50).map((t2) => ({ ...t2, msgs: t2.msgs.slice(-60).map((m) => (m.image || m.genImage ? { ...m, image: undefined, genImage: undefined, content: m.content || '📎' } : m)) }));
    localStorage.setItem(THREADS_KEY, JSON.stringify(trimmed));
    try { window.dispatchEvent(new Event('nf-threads-updated')); } catch { /* 사이드바 같은 탭 갱신 */ }
  } catch { /* quota — skip */ }
}

// 실행형 도메인(엔진 연동). 인테리어는 얕아 대화만(스트리밍 유지).
const ACTION_DOMAINS: Domain[] = ['civil', 'architecture', 'landscape', 'mechanical'];
const ENG_API = 'https://nexyfab-eng-api.gomd999.workers.dev';

/**
 * feature kind(box/prism/hole/…) → 표시명, 6개 언어 전부.
 * ★260801 — summarizeFeatures() 가 이 이름들을 한국어로 **고정 하드코딩**하고 있었다
 *   (박스·프리즘·구멍·실린더·구·원뿔·회전체…). 이 결과(spec)는 cadSpecTitle 체크포인트 카드에
 *   그대로 렌더되는데 언어 분기가 전혀 없어 en/ja/cn/es/ar 사용자에게도 한국어가 나갔다
 *   (CHECK_LABELS_I18N 과 동일 유형, 같은 파일 안에서 재발).
 */
export const FEATURE_KIND_I18N: Record<string, Record<Lang, string>> = {
  box: { kr: '박스', en: 'Box', ja: 'ボックス', cn: '箱体', es: 'Caja', ar: 'صندوق' },
  prism: { kr: '프리즘', en: 'Prism', ja: 'プリズム', cn: '棱柱', es: 'Prisma', ar: 'منشور' },
  hole: { kr: '구멍', en: 'Hole', ja: '穴', cn: '孔', es: 'Orificio', ar: 'ثقب' },
  cylinder: { kr: '실린더', en: 'Cylinder', ja: '円柱', cn: '圆柱', es: 'Cilindro', ar: 'أسطوانة' },
  sphere: { kr: '구', en: 'Sphere', ja: '球', cn: '球体', es: 'Esfera', ar: 'كرة' },
  cone: { kr: '원뿔', en: 'Cone', ja: '円錐', cn: '圆锥', es: 'Cono', ar: 'مخروط' },
  revolve: { kr: '회전체(단면 프로파일)', en: 'Revolved solid (cross-section profile)', ja: '回転体(断面プロファイル)', cn: '回转体(截面轮廓)', es: 'Sólido de revolución (perfil de sección)', ar: 'مجسم دوراني (مقطع عرضي)' },
};

// compose intent → 사람이 읽을 치수 사양 라인(체크포인트 검토용).
function summarizeFeatures(intent: ComposeIntent | undefined, lang: Lang): string[] {
  const feats = intent?.features;
  if (!Array.isArray(feats)) return [];
  const L = (k: string) => FEATURE_KIND_I18N[k]?.[lang] ?? k;
  return feats.map((f) => {
    const kind = String(f.kind ?? '');
    const sub = f.op === 'subtract';
    const pre = sub ? '− ' : '';
    const sz = Array.isArray(f.size) ? (f.size as unknown[]).join('×') : null;
    const d = f.diameter ?? f.d; const h = f.height ?? f.h;
    if ((kind === 'box' || kind === 'prism') && sz) return `${pre}${L(kind)} ${sz} mm`;
    if (kind === 'cylinder' || kind === 'pipe') return `${pre}${sub ? L('hole') : L('cylinder')} ⌀${d ?? '?'}${h ? `×${h}` : ''} mm`;
    if (kind === 'sphere') return `${pre}${L('sphere')} ⌀${d ?? '?'} mm`;
    if (kind === 'cone') return `${pre}${L('cone')} ⌀${d ?? '?'}×${h ?? '?'} mm`;
    if (kind === 'revolve' || kind === 'polygon') return `${pre}${L('revolve')}`;
    return `${pre}${kind || 'feature'}`;
  });
}

// compose intent 의 주(main) box 치수 [w,d,h] 추출 (정투상 도면용).
function mainBoxDims(intent: ComposeIntent | undefined): [number, number, number] | null {
  const feats = intent?.features;
  if (!Array.isArray(feats)) return null;
  let best: [number, number, number] | null = null, bestVol = -1;
  for (const f of feats) {
    if ((f.kind === 'box' || f.kind === 'prism') && Array.isArray(f.size) && f.size.length >= 3) {
      const [w, d, h] = (f.size as unknown[]).map(Number);
      if ([w, d, h].every(n => Number.isFinite(n) && n > 0)) { const v = w * d * h; if (v > bestVol) { bestVol = v; best = [w, d, h]; } }
    }
  }
  return best;
}
function holeCount(intent: ComposeIntent | undefined): number {
  const feats = intent?.features;
  return Array.isArray(feats) ? feats.filter(f => (f.kind === 'cylinder' || f.kind === 'hole') && f.op === 'subtract').length : 0;
}
// subtract 구멍의 위치(at.translate)+지름 수집 — 정투상 평면뷰에 원으로 표시.
function collectHoles(intent: ComposeIntent | undefined): Array<{ x: number; y: number; d: number }> {
  const feats = intent?.features;
  if (!Array.isArray(feats)) return [];
  const out: Array<{ x: number; y: number; d: number }> = [];
  for (const f of feats) {
    if ((f.kind === 'cylinder' || f.kind === 'hole') && f.op === 'subtract') {
      const tr = (f.at as { translate?: unknown } | undefined)?.translate;
      const x = Array.isArray(tr) ? Number(tr[0]) || 0 : 0;
      const y = Array.isArray(tr) ? Number(tr[1]) || 0 : 0;
      const d = Number(f.diameter ?? (f as { d?: unknown }).d) || 0;
      if (d > 0) out.push({ x, y, d });
    }
  }
  return out;
}
// 정투상(3각법) 2뷰 SVG — 정면(W×H)+평면(W×D) + 전체치수. 프리즘형 개요도(비법정).
// 순수 숫자만 템플릿에 삽입(주입 위험 없음). 구멍 위치는 compose 한계로 개수만 표기.
function buildDrawingSvg(intent: ComposeIntent | undefined): string | null {
  const box = mainBoxDims(intent);
  if (!box) return null;
  const [w, d, h] = box;
  const s = 130 / Math.max(w, d, h);        // 스케일(최대변 130px)
  const fw = +(w * s).toFixed(1), fh = +(h * s).toFixed(1), tt = +(d * s).toFixed(1);
  const ox = 60, oy = 26, gap = 34;          // 원점·뷰 간격
  const topY = oy + fh + gap;
  const dim = (x1: number, y1: number, x2: number, y2: number, txt: string, below = false) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="0.6"/>` +
    `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + (below ? 11 : -4)}" fill="#93c5fd" font-size="9" text-anchor="middle" font-family="ui-monospace,monospace">${txt}</text>`;
  const holes = collectHoles(intent);
  // 위치가 부여된(원점 아닌) 구멍만 평면뷰에 원으로 — 원점겹침(0,0)은 미배치로 간주.
  const placed = holes.filter(hh => hh.x > 0 || hh.y > 0);
  const holeCircles = placed
    .filter(hh => hh.x <= w && hh.y <= d)
    .map(hh => `<circle cx="${(ox + hh.x * s).toFixed(1)}" cy="${(topY + hh.y * s).toFixed(1)}" r="${Math.max(1.2, (hh.d * s) / 2).toFixed(1)}" fill="none" stroke="#93c5fd" stroke-width="0.9"/><line x1="${(ox + hh.x * s - 3).toFixed(1)}" y1="${(topY + hh.y * s).toFixed(1)}" x2="${(ox + hh.x * s + 3).toFixed(1)}" y2="${(topY + hh.y * s).toFixed(1)}" stroke="#93c5fd" stroke-width="0.4"/>`)
    .join('');
  const note = placed.length < holes.length ? `⌀ holes ×${holes.length} (${holes.length - placed.length} 위치 미부여)` : (holes.length ? `⌀ holes ×${holes.length}` : '');
  return `<svg viewBox="0 0 ${ox + fw + 60} ${topY + tt + 30}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#0b1020;border-radius:8px">
    <text x="${ox}" y="14" fill="#8b949e" font-size="9" font-family="ui-monospace,monospace">FRONT (정면)</text>
    <rect x="${ox}" y="${oy}" width="${fw}" height="${fh}" fill="none" stroke="#cbd5e1" stroke-width="1.1"/>
    ${dim(ox, oy - 8, ox + fw, oy - 8, `${w}`)}
    ${dim(ox - 10, oy, ox - 10, oy + fh, `${h}`)}
    <text x="${ox}" y="${topY - 8}" fill="#8b949e" font-size="9" font-family="ui-monospace,monospace">TOP (평면)</text>
    <rect x="${ox}" y="${topY}" width="${fw}" height="${tt}" fill="none" stroke="#cbd5e1" stroke-width="1.1"/>
    ${holeCircles}
    ${dim(ox - 10, topY, ox - 10, topY + tt, `${d}`)}
    ${note ? `<text x="${ox}" y="${topY + tt + 20}" fill="#6e7681" font-size="9" font-family="ui-monospace,monospace">${note}</text>` : ''}
  </svg>`;
}

// ISO 2768-m 일반 선형공차 (결정론·표준, 모호성 없음). 개별 GD&T 는 앱(§12.6).
function iso2768m(dim: number): number {
  const a = Math.abs(dim);
  if (a <= 6) return 0.1;
  if (a <= 30) return 0.2;
  if (a <= 120) return 0.3;
  if (a <= 400) return 0.5;
  if (a <= 1000) return 0.8;
  return 1.2;
}
// intent/assembly 를 순회해 선형 치수만 수집(위치 tx/ty/tz·각도·좌표 제외).
function collectDims(obj: unknown): number[] {
  const out: number[] = [];
  const skip = new Set(['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'x', 'y', 'op', 'kind', 'type', 'id', 'name', 'boltCount']);
  const walk = (v: unknown) => {
    if (typeof v === 'number' && isFinite(v) && v > 0) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (!skip.has(k)) walk(val);
  };
  walk(obj);
  return out;
}
function toleranceRange(obj: unknown): string | null {
  const tols = collectDims(obj).map(iso2768m);
  if (!tols.length) return null;
  const lo = Math.min(...tols), hi = Math.max(...tols);
  return lo === hi ? `±${lo}` : `±${lo}~±${hi} mm`;
}

// compose assembly → 부품 목록(독립 body) 사양 라인.
function summarizeParts(assembly: AssemblyPlan | undefined): string[] {
  const parts = assembly?.parts;
  if (!Array.isArray(parts)) return [];
  return parts.map((p) => {
    const id = String(p.id ?? p.type ?? 'part');
    const type = String(p.type ?? '');
    const at = p.at as Record<string, unknown> | undefined;
    const pos = at ? ` @(${Number(at.tx ?? 0)},${Number(at.ty ?? 0)},${Number(at.tz ?? 0)})` : '';
    return `${id} · ${type}${pos}`;
  });
}

// 기계 멀티바디: 자연어 → drawing/assemble(AI 어셈블리 + 게이트-교정 + 간섭검사).
async function runAssemblePipeline(prompt: string, signal?: AbortSignal): Promise<CadResult> {
  const r = await fetch('/api/nexyfab/drawing/assemble/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: prompt }),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) {
    const ge = Array.isArray(j?.gateErrors) ? j.gateErrors.join(', ') : '';
    return { error: (j && (j.error || ge)) || '조립체 생성에 실패했어요.' };
  }
  return {
    isAssembly: true,
    assembly: j.assembly as AssemblyPlan,
    partsAabb: Array.isArray(j.parts) ? (j.parts as CadResult['partsAabb']) : undefined,
    scadDraft: typeof (j as { draft?: { openscad?: string } }).draft?.openscad === 'string' ? (j as { draft: { openscad: string } }).draft.openscad : undefined,
    partsAabbDraft: Array.isArray((j as { draft?: { parts?: unknown[] } }).draft?.parts) ? ((j as { draft: { parts: unknown[] } }).draft.parts as CadResult['partsAabb']) : undefined,
    composeIntent: (j.composeIntent && typeof j.composeIntent === 'object') ? j.composeIntent as ComposeIntent : undefined,
    scad: typeof j.openscad === 'string' ? j.openscad : undefined,
    interferences: Array.isArray(j.interferences) ? j.interferences : [],
    contacts: Array.isArray(j.contacts) ? j.contacts : [],
    welds: Array.isArray(j.welds) ? j.welds : [],
    weldTotalMm: typeof j.weldTotalMm === 'number' ? j.weldTotalMm : 0,
    structural: (j.structural && typeof j.structural === 'object') ? j.structural as StructuralResult : undefined,
    gateErrors: [],
    spec: summarizeParts(j.assembly as AssemblyPlan),
  };
}

// P2 픽킹: edit-part/face-drag 응답 → CadResult 정규화(공용)
function cadFromEditResp(j: Record<string, unknown>): CadResult {
  return {
    isAssembly: true,
    assembly: j.assembly as AssemblyPlan,
    scad: typeof j.openscad === 'string' ? j.openscad : undefined,
    partsAabb: Array.isArray(j.parts) ? (j.parts as CadResult['partsAabb']) : undefined,
    interferences: Array.isArray(j.interferences) ? (j.interferences as CadResult['interferences']) : [],
    contacts: Array.isArray(j.contacts) ? (j.contacts as CadResult['contacts']) : [],
    welds: Array.isArray(j.welds) ? (j.welds as CadResult['welds']) : [],
    weldTotalMm: typeof j.weldTotalMm === 'number' ? j.weldTotalMm : 0,
    structural: j.structural && typeof j.structural === 'object' ? (j.structural as StructuralResult) : undefined,
    gateErrors: [],
    spec: summarizeParts(j.assembly as AssemblyPlan),
  };
}
const faceTag = (n: number[]) => { const a = Math.abs(n[0]) > 0.5 ? 0 : Math.abs(n[1]) > 0.5 ? 1 : 2; return 'xyz'[a] + (n[a] > 0 ? '+' : '−'); };
// OpenSCAD rotate([rx,ry,rz]) 순서(Rx→Ry→Rz)로 벡터 회전 — OBB 프록시 로컬 노멀→CAD 월드(#3)
function rotCadVec(rot: number[], v: number[]): number[] {
  let [x, y, z] = v;
  const rad = Math.PI / 180;
  const [rx, ry, rz] = rot;
  if (rx) { const c = Math.cos(rx * rad), s = Math.sin(rx * rad); const y2 = y * c - z * s, z2 = y * s + z * c; y = y2; z = z2; }
  if (ry) { const c = Math.cos(ry * rad), s = Math.sin(ry * rad); const x2 = x * c + z * s, z2 = -x * s + z * c; x = x2; z = z2; }
  if (rz) { const c = Math.cos(rz * rad), s = Math.sin(rz * rad); const x2 = x * c - y * s, y2 = x * s + y * c; x = x2; y = y2; }
  return [x, y, z];
}
type PartProxy = { id: string; aabb: { min: number[]; max: number[] }; obb?: { local: { min: number[]; max: number[] }; at: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number } } };

// 입력 A(이미지): 도면·스케치 → drawing/extract(Vision 판독 + 결정론 게이트) → 체크포인트.
// 성공 시 단일부품 compose intent 를 그대로 CadCard 로 렌더(승인→STEP 은 export-step 재사용).
type Recognized = { label: string; confidence: number; estimatedFields?: string[]; missingFields?: string[] };

/**
 * 불확실한 치수를 **이름으로** 덧붙인다.
 * ⚠ 치수 이름(width·thickness…)은 **번역하지 않는다** — 그 이름 그대로 3D 파라미터·
 *   견적·도면에 쓰이므로, 화면에서만 다른 말로 부르면 사용자가 대조할 수 없다.
 * ⚠ 없으면 아무것도 붙이지 않는다 — 「불확실 없음」을 매번 알릴 필요는 없다.
 */
function uncertaintyLine(r: Recognized, t: (typeof DICT)[Lang]): string {
  const parts: string[] = [];
  if (r.missingFields?.length) parts.push(`${t.imgUnread}: ${r.missingFields.join(', ')}`);
  if (r.estimatedFields?.length) parts.push(`${t.imgEstimated}: ${r.estimatedFields.join(', ')}`);
  return parts.length ? `

⚠ ${parts.join(' · ')} — ${t.imgCheckDims}.` : '';
}

async function runExtractPipeline(att: Attached, lang: Lang): Promise<{ cad: CadResult; recognized?: Recognized }> {
  const r = await fetch('/api/nexyfab/drawing/extract/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageBase64: att.base64, mimeType: att.mime }),
  });
  const j = await r.json().catch(() => ({}));
  const recognized = j?.recognized && typeof j.recognized === 'object'
    ? {
        label: String(j.recognized.label ?? j.recognized.type ?? ''),
        confidence: Number(j.recognized.confidence) || 0,
        // ⚠ 여기서 버리면 **판독기가 정직해도 사용자는 모른다.** 어느 치수가 불확실한지 옮긴다.
        ...(Array.isArray(j.recognized.estimatedFields) ? { estimatedFields: j.recognized.estimatedFields.map(String) } : {}),
        ...(Array.isArray(j.recognized.missingFields) ? { missingFields: j.recognized.missingFields.map(String) } : {}),
      }
    : undefined;
  if (!r.ok || !j?.ok || !j.intent) {
    const ge = Array.isArray(j?.gateErrors) ? j.gateErrors.join(', ') : '';
    return { cad: { error: (j && (j.error || ge)) || '도면을 3D로 변환하지 못했어요.' }, recognized };
  }
  return {
    cad: {
      composeIntent: j.intent as ComposeIntent,
      scad: typeof j.scad === 'string' ? j.scad : undefined,
      gateErrors: [],
      spec: Array.isArray(j.spec) ? (j.spec as string[]) : summarizeFeatures(j.intent as ComposeIntent, lang),
    },
    recognized,
  };
}

// 기계 스테이지1: 자연어 → drawing/compose(AI 조합 + 결정론 게이트) → intent+SCAD.
// 체크포인트로 반환(정밀 3D/STEP은 사용자 승인 후 export-step).
async function runComposePipeline(prompt: string, lang: Lang, signal?: AbortSignal): Promise<CadResult> {
  const r = await fetch('/api/nexyfab/drawing/compose/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: prompt }),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok || !j.intent) {
    const ge = Array.isArray(j?.gateErrors) ? j.gateErrors.join(', ') : '';
    return { error: (j && (j.error || ge)) || '형상 생성에 실패했어요.' };
  }
  return {
    composeIntent: j.intent as ComposeIntent,
    scad: typeof j.scad === 'string' ? j.scad : undefined,
    gateErrors: Array.isArray(j.gateErrors) ? j.gateErrors : [],
    spec: summarizeFeatures(j.intent as ComposeIntent, lang),
  };
}

/**
 * 검토 항목 키 → 표시명, 6개 언어 전부(없으면 키 그대로).
 * ★260801 — 이전엔 CHECK_LABELS 가 한국어 문자열로 **고정 하드코딩**돼 있어 언어 분기가
 *   전혀 없었다. ChatHero 자체는 DICT(6개 언어)로 완결된 다국어 페이지인데, 계산 카드의
 *   검토항목 이름(휨·전단·처짐…)만 en/ja/cn/es/ar 사용자에게도 한국어로 그대로 나갔다
 *   (simulator RISK_SCENARIOS, 7fa0516e 와 동일 유형).
 */
export const CHECK_LABELS_I18N: Record<string, Record<Lang, string>> = {
  flexure: { kr: '휨', en: 'Flexure', ja: '曲げ', cn: '弯曲', es: 'Flexión', ar: 'الانحناء' },
  shear: { kr: '전단', en: 'Shear', ja: 'せん断', cn: '剪切', es: 'Cortante', ar: 'القص' },
  deflection: { kr: '처짐', en: 'Deflection', ja: 'たわみ', cn: '挠度', es: 'Deflexión', ar: 'الترخيم' },
  axial: { kr: '축력', en: 'Axial', ja: '軸力', cn: '轴力', es: 'Axial', ar: 'القوة المحورية' },
  buckling: { kr: '좌굴', en: 'Buckling', ja: '座屈', cn: '屈曲', es: 'Pandeo', ar: 'الانبعاج' },
  overturning: { kr: '전도', en: 'Overturning', ja: '転倒', cn: '倾覆', es: 'Vuelco', ar: 'الانقلاب' },
  sliding: { kr: '활동', en: 'Sliding', ja: '滑動', cn: '滑移', es: 'Deslizamiento', ar: 'الانزلاق' },
  bearing: { kr: '지지력', en: 'Bearing', ja: '支持力', cn: '承载力', es: 'Capacidad portante', ar: 'قدرة التحمل' },
  eccentricity: { kr: '편심', en: 'Eccentricity', ja: '偏心', cn: '偏心', es: 'Excentricidad', ar: 'اللامركزية' },
  moment: { kr: '휨모멘트', en: 'Moment', ja: '曲げモーメント', cn: '弯矩', es: 'Momento flector', ar: 'عزم الانحناء' },
  combined: { kr: '조합', en: 'Combined', ja: '組合せ', cn: '组合', es: 'Combinado', ar: 'مركب' },
  drift: { kr: '횡변위', en: 'Drift', ja: '層間変位', cn: '层间位移', es: 'Desplazamiento lateral', ar: 'الإزاحة الجانبية' },
  bolt_shear: { kr: '볼트전단', en: 'Bolt shear', ja: 'ボルトせん断', cn: '螺栓剪切', es: 'Cortante de perno', ar: 'قص البرغي' },
  bolt_bearing: { kr: '지압', en: 'Bolt bearing', ja: '支圧', cn: '承压', es: 'Aplastamiento de perno', ar: 'سحق البرغي' },
};

function parseChecks(checks: Record<string, Record<string, unknown>> | undefined, lang: Lang): CheckRow[] {
  return Object.entries(checks ?? {}).map(([key, c]) => {
    let detail = '';
    if (typeof c.ratio === 'number') detail = `${(c.ratio * 100).toFixed(0)}%`;
    else if (typeof c.FS === 'number') detail = `FS ${(c.FS as number).toFixed(2)}${typeof c.min === 'number' ? ` / ≥${c.min}` : ''}`;
    else if (typeof c.qmax_kPa === 'number') detail = `q_max ${(c.qmax_kPa as number).toFixed(0)} kPa${typeof c.allow_kPa === 'number' ? ` / ≤${c.allow_kPa}` : ''}`;
    else if (typeof c.e_m === 'number') detail = `e ${(c.e_m as number).toFixed(2)} m${typeof c.limit_m === 'number' ? ` / ≤${(c.limit_m as number).toFixed(2)}` : ''}`;
    return { name: CHECK_LABELS_I18N[key]?.[lang] ?? key, pass: c.pass === true, detail };
  });
}

async function runDemoCalc(id: string, input: Record<string, unknown>, lang: Lang): Promise<CalcResult> {
  const res = await fetch(`${ENG_API}/v1/demo/calc/${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || 'calc failed');
  return {
    verdict: j.verdict ?? (j.checks && Object.values(j.checks as Record<string, { pass?: boolean }>).every(c => c.pass) ? 'PASS' : 'FAIL'),
    title: j.calculator ?? id,
    checks: parseChecks(j.checks, lang),
    refs: Array.isArray(j.refs) ? j.refs.slice(0, 3) : [],
    remaining: typeof j.remainingToday === 'number' ? j.remainingToday : undefined,
  };
}

const DOMAINS: Domain[] = ['mechanical', 'civil', 'architecture', 'landscape', 'interior'];
const DOMAIN_ACCENT: Record<Domain, string> = {
  mechanical: '#3b82f6', civil: '#8b5cf6', architecture: '#f59e0b', landscape: '#22c55e', interior: '#ec4899',
};

type Lang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
const toLang = (l: string): Lang => (['kr', 'en', 'ja', 'cn', 'es', 'ar'].includes(l) ? (l as Lang) : 'en');

const DICT: Record<Lang, {
  title: string; sub: string; placeholder: string; send: string; thinking: string;
  disclaimer: string; error: string; reset: string; trust: string;
  calcRunning: string; calcPass: string; calcFail: string; calcRefs: string;
  cadGenerating: string; cadNoPreview: string; cadDownload: string;
  cadSpecTitle: string; cadConfirm: string; cadBuilding: string; cadStepDownload: string; cadGate: string;
  cadAssemblyTitle: string; cadParts: string; cadInterfNone: string; cadInterf: string; cadOpenGA: string; cadStlDownload: string; cadDfm: string;
  cadWeld: string; cadWeldTotal: string; cadTol: string; cadGdt: string; cadWiringTitle: string; cadWiringNote: string; cadDrawing: string;
  attach: string; uploadHint: string; imgReading: string; imgRecognized: string; imgConfidence: string;
  /**
   * ★260731 — 추출기는 **못 읽은 치수**와 **추정한 치수**를 구별해 내보내는데,
   *   화면은 신뢰도 숫자만 보여 줬다. 「60%」만으로는 **무엇을 확인해야 하는지** 알 수 없다.
   *   실측: l_bracket 두께(정답 4mm, 치수선 9.6px)가 10 으로 나가면서 모델 스스로
   *   「추정」이라고 표시하는데, 그 표시가 화면까지 오지 않았다.
   */
  imgEstimated: string; imgUnread: string; imgCheckDims: string;
  quoteThis: string; saveSignup: string; signup: string; cadStructural: string; cadPackage: string;
  chips: Record<Domain, string>;
  actDemo: string; actQuote: string; actContact: string;
  newChat: string; guestNote: string; guestLimit: string;
  stop: string; copyMsg: string; copied: string; regen: string;
  clashWarn: string; fuFixClash: string;
  threadLimit: string; proCta: string;
  cadContacts: string; photoHint: string; attachDrawing: string; attachPhoto: string;
  genImg: string; genImgMaking: string; genImgNote: string; genImgUse: string; genImgLimit: string;
  pickSel: string; pickEdited: string;
  stageAnalyze: string; stageCalc: string; stageCad: string;
  fuText: string[]; fuCalc: string[]; fuCad: string[];
}> = {
  kr: {
    title: '무엇을 설계할까요?',
    sub: '설계하고 싶은 것을 자연어로 설명하거나, 도면·스케치 이미지를 올려보세요. 기계설계부터 토목·건축·조경·인테리어까지.',
    placeholder: '예: 200L 스테인리스 응집 탱크를 설계하고 싶어요 / H-300 보 6m 스팬 검토',
    send: '보내기', thinking: '생각 중…',
    disclaimer: 'AI 응답은 비법정 참고자료입니다. 최종 검토·서명은 유자격 기술자의 책임입니다.',
    error: '응답을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
    reset: '새 대화',
    trust: '결정론 계산 엔진 · 엔지니어링 코퍼스 · 결과엔 기준 조항 근거 표시',
    chips: { mechanical: '기계설계', civil: '토목', architecture: '건축', landscape: '조경', interior: '인테리어' },
    actDemo: '검증 엔진 데모', actQuote: '정밀 견적 요청', actContact: '전문가 상담',
    newChat: '새 대화', guestNote: '게스트: 대화는 이 기기에만 저장', guestLimit: '대화가 이 기기에만 저장됩니다 — 가입하면 어디서나 이어집니다',
    stop: '중단', copyMsg: '복사', copied: '복사됨 ✓', regen: '다시 생성',
    stageAnalyze: '요청 분석 중…', stageCalc: '계산 실행 중…', stageCad: '3D 모델 생성 중…',
    fuText: ['더 자세히 설명해줘', '핵심만 요약해줘', '관련 기준(KDS 등)은?'], fuCalc: ['이 결과의 근거를 설명해줘', '어떤 조건이면 부적합이 되나?'], fuCad: ['이 설계의 제조 리스크는?', '적합한 재질을 추천해줘'],
    clashWarn: '부품이 겹칩니다 — 아직 완성체가 아닙니다. 아래 칩으로 교정을 요청하거나 치수를 알려주세요.', fuFixClash: '간섭(부품 겹침)을 해결하도록 배치를 수정해줘', threadLimit: '이 대화는 무료 한도({n}회)에 도달했어요 — 새 대화로 계속하거나 Pro에서 무제한으로 이어가세요.', proCta: 'Pro 보기', cadContacts: '접촉 {n}', photoHint: '📷 사진은 형태 힌트로만 씁니다(치수는 읽지 않아요). {label}(으)로 보입니다. 핵심 치수를 알려주시면 생성할게요.', attachDrawing: '도면', attachPhoto: '사진',
    pickSel: '선택: {id} — 다음 메시지는 이 부품만 수정해요', pickEdited: '🎯 {id} 수정 적용 — 게이트 통과',
    genImg: '시안', genImgMaking: '시안 이미지를 생성하는 중…(흰 배경 규격)', genImgNote: 'AI 시안(흰 배경) — 치수·형상 근거가 아니에요. 마음에 들면 아래 버튼으로 도안→3D로 진행하세요. (오늘 남은 생성 {n}회)', genImgUse: '이 시안으로 도안→3D', genImgLimit: '오늘 이미지 생성 한도({n}회)를 모두 썼어요 — 내일 다시 오시거나 Pro(50회/일)로 올려보세요.',
    calcRunning: '검토 실행 중…', calcPass: '적합', calcFail: '부적합', calcRefs: '근거',
    cadGenerating: '3D 모델 생성 중…', cadNoPreview: '이 형상의 3D 미리보기는 배포 환경에서 제공됩니다. 아래 SCAD로 확인하세요.', cadDownload: 'SCAD 다운로드',
    cadSpecTitle: '이 사양으로 정밀 3D를 생성할까요?', cadConfirm: '확인 · 정밀 3D 생성', cadBuilding: '정밀 형상(STEP) 생성 중…', cadStepDownload: 'STEP 다운로드', cadGate: '결정론 게이트',
    cadAssemblyTitle: '이 조립체로 생성할까요?', cadParts: '부품 (독립 body)', cadInterfNone: '간섭 없음', cadInterf: '간섭 {n}건', cadOpenGA: 'GA 프레젠테이션 열기', cadStlDownload: 'STL 다운로드', cadDfm: 'DFM·견적',
    cadWeld: '용접 개산', cadWeldTotal: '총 용접선', cadTol: '일반공차 ISO 2768-m', cadGdt: '개별 GD&T는 정밀검토(앱)', cadWiringTitle: '전기 결선표 (개산)', cadWiringNote: '개산 · 규격/길이 확인 필요 · 3D 하네스는 별도 ECAD', cadDrawing: '정투상 도면',
    attach: '도면·스케치 첨부', uploadHint: '도면·스케치를 올리면 정투상을 읽어 3D로 변환해요 (지원: 평판·브래킷·플랜지·파이프·각관·봉·거셋·베이스판 등)', imgReading: '도면을 판독하는 중…', imgRecognized: '도면에서 인식', imgConfidence: '신뢰도', imgEstimated: '추정한 치수', imgUnread: '못 읽은 치수', imgCheckDims: '제작 전에 확인해 주세요',
    quoteThis: '이 설계로 견적 받기', saveSignup: '결과를 프로젝트로 저장하고 이어서 편집하려면 무료 가입하세요.', signup: '무료 가입', cadStructural: '자동 구조검증', cadPackage: '설계 패키지',
  },
  en: {
    title: 'What do you want to design?',
    sub: 'Describe what you want to design in plain language, or upload a drawing/sketch. From mechanical to civil, architecture, landscape and interior.',
    placeholder: 'e.g. Design a 200L stainless coagulation tank / Check an H-300 beam over a 6m span',
    send: 'Send', thinking: 'Thinking…',
    disclaimer: 'AI replies are non-statutory references. Final review and sign-off remain a licensed engineer’s responsibility.',
    error: 'Could not get a reply. Please try again shortly.',
    reset: 'New chat',
    trust: 'Deterministic calc engine · engineering corpus · every result cites its code clause',
    chips: { mechanical: 'Mechanical', civil: 'Civil', architecture: 'Architecture', landscape: 'Landscape', interior: 'Interior' },
    actDemo: 'Verification engine demo', actQuote: 'Request a quote', actContact: 'Talk to an expert',
    newChat: 'New chat', guestNote: 'Guest: chats stay on this device', guestLimit: 'Chats are saved on this device only — sign up to sync',
    stop: 'Stop', copyMsg: 'Copy', copied: 'Copied ✓', regen: 'Regenerate',
    stageAnalyze: 'Analyzing request…', stageCalc: 'Running calculation…', stageCad: 'Generating 3D model…',
    fuText: ['Explain in more detail', 'Summarize the key points', 'Which codes/standards apply?'], fuCalc: ['Explain the basis of this result', 'Under what conditions would it fail?'], fuCad: ['What are the manufacturing risks?', 'Recommend a suitable material'],
    clashWarn: 'Parts overlap — this is not a finished assembly yet. Ask for a fix below or give exact dims.', fuFixClash: 'Fix the interferences by adjusting part placement', threadLimit: 'This chat reached the free limit ({n} turns) — start a new chat or go unlimited with Pro.', proCta: 'See Pro', cadContacts: '{n} contacts', photoHint: '📷 Photos are shape hints only (no dims read). Looks like {label}. Give key dims and I will generate.', attachDrawing: 'Drawing', attachPhoto: 'Photo',
    pickSel: 'Selected: {id} — the next message edits only this part', pickEdited: '🎯 {id} edited — gates passed',
    genImg: 'Concept', genImgMaking: 'Generating concept image… (white-background spec)', genImgNote: 'AI concept (white background) — not a source of dims/geometry. Like it? Continue to drawing→3D below. ({n} left today)', genImgUse: 'Drawing→3D from this concept', genImgLimit: 'Daily image limit ({n}) reached — come back tomorrow or go Pro (50/day).',
    calcRunning: 'Running check…', calcPass: 'PASS', calcFail: 'FAIL', calcRefs: 'Refs',
    cadGenerating: 'Generating 3D model…', cadNoPreview: 'A 3D preview of this shape is available in the deployed environment — see the SCAD below.', cadDownload: 'Download SCAD',
    cadSpecTitle: 'Generate the precise 3D from this spec?', cadConfirm: 'Confirm · build 3D', cadBuilding: 'Building precise geometry (STEP)…', cadStepDownload: 'Download STEP', cadGate: 'Deterministic gate',
    cadAssemblyTitle: 'Generate this assembly?', cadParts: 'Parts (independent bodies)', cadInterfNone: 'No interference', cadInterf: '{n} interference(s)', cadOpenGA: 'Open GA presentation', cadStlDownload: 'Download STL', cadDfm: 'DFM · estimate',
    cadWeld: 'Weld estimate', cadWeldTotal: 'Total weld', cadTol: 'General tol. ISO 2768-m', cadGdt: 'per-feature GD&T in app', cadWiringTitle: 'Cable schedule (est.)', cadWiringNote: 'Estimate · verify spec/length · 3D harness = separate ECAD', cadDrawing: 'Orthographic drawing',
    attach: 'Attach drawing/sketch', uploadHint: 'Upload a drawing/sketch and we read the orthographic views into 3D (supported: plate · bracket · flange · pipe · rect tube · bar · gusset · base plate, etc.)', imgReading: 'Reading the drawing…', imgRecognized: 'Recognized from drawing', imgConfidence: 'confidence', imgEstimated: 'Estimated dimensions', imgUnread: 'Could not read', imgCheckDims: 'please confirm before manufacturing',
    quoteThis: 'Get a quote for this design', saveSignup: 'Sign up free to save this as a project and keep editing.', signup: 'Sign up free', cadStructural: 'Auto structural check', cadPackage: 'Design package',
  },
  ja: {
    title: '何を設計しますか？',
    sub: '設計したいものを自然文で説明するか、図面・スケッチ画像をアップロードしてください。機械設計から土木・建築・造園・インテリアまで。',
    placeholder: '例：200Lステンレス凝集タンクを設計したい / H-300 梁 6mスパンの検討',
    send: '送信', thinking: '考え中…',
    disclaimer: 'AIの回答は非法定の参考資料です。最終確認と署名は有資格技術者の責任です。',
    error: '回答を取得できませんでした。しばらくして再試行してください。',
    reset: '新しいチャット',
    trust: '決定論的計算エンジン · エンジニアリングコーパス · 結果に基準条項の根拠を明示',
    chips: { mechanical: '機械設計', civil: '土木', architecture: '建築', landscape: '造園', interior: 'インテリア' },
    actDemo: '検証エンジンのデモ', actQuote: '見積もり依頼', actContact: '専門家に相談',
    newChat: '新しいチャット', guestNote: 'ゲスト：会話はこの端末のみに保存', guestLimit: '会話はこの端末のみに保存 — 登録で同期できます',
    stop: '停止', copyMsg: 'コピー', copied: 'コピー済み ✓', regen: '再生成',
    stageAnalyze: 'リクエスト分析中…', stageCalc: '計算実行中…', stageCad: '3Dモデル生成中…',
    fuText: ['もっと詳しく説明して', '要点をまとめて', '関連する基準は?'], fuCalc: ['この結果の根拠を説明して', 'どんな条件で不適合になる?'], fuCad: ['この設計の製造リスクは?', '適した材質を提案して'],
    clashWarn: '部品が干渉しています — まだ完成形ではありません。下のチップで修正を依頼するか寸法を指定してください。', fuFixClash: '干渉を解消するよう配置を修正して', threadLimit: 'この会話は無料上限({n}回)に達しました — 新しいチャットで続けるか、Proで無制限に。', proCta: 'Proを見る', cadContacts: '接触 {n}', photoHint: '📷 写真は形状ヒントのみ(寸法は読みません)。{label}のようです。主要寸法を教えてください。', attachDrawing: '図面', attachPhoto: '写真',
    pickSel: '選択: {id} — 次のメッセージはこの部品だけ修正します', pickEdited: '🎯 {id} 修正適用 — ゲート通過', genImg: '試案', genImgMaking: '試案画像を生成中…（白背景規格）', genImgNote: 'AI試案（白背景）— 寸法・形状の根拠ではありません。気に入ったら下のボタンで図面→3Dへ。（本日残り{n}回）', genImgUse: 'この試案で図面→3D', genImgLimit: '本日の画像生成上限({n}回)に達しました — 明日再度、またはPro(50回/日)へ。',
    calcRunning: '検討を実行中…', calcPass: '適合', calcFail: '不適合', calcRefs: '根拠',
    cadGenerating: '3Dモデル生成中…', cadNoPreview: 'この形状の3Dプレビューは本番環境で提供されます。下のSCADをご確認ください。', cadDownload: 'SCADをダウンロード',
    cadSpecTitle: 'この仕様で精密3Dを生成しますか？', cadConfirm: '確認 · 精密3D生成', cadBuilding: '精密形状(STEP)を生成中…', cadStepDownload: 'STEPをダウンロード', cadGate: '決定論ゲート',
    cadAssemblyTitle: 'この組立体で生成しますか？', cadParts: '部品 (独立ボディ)', cadInterfNone: '干渉なし', cadInterf: '干渉 {n}件', cadOpenGA: 'GAプレゼンを開く', cadStlDownload: 'STLをダウンロード', cadDfm: 'DFM・見積',
    cadWeld: '溶接概算', cadWeldTotal: '総溶接長', cadTol: '普通公差 ISO 2768-m', cadGdt: '個別GD&Tはアプリ', cadWiringTitle: '結線表(概算)', cadWiringNote: '概算·仕様/長さ要確認·3DハーネスはECAD別途', cadDrawing: '正投影図',
    attach: '図面・スケッチを添付', uploadHint: '図面・スケッチをアップロードすると正投影を読み取り3D化します（対応：平板・ブラケット・フランジ・パイプ・角管・棒・ガセット・ベースプレート等）', imgReading: '図面を判読中…', imgRecognized: '図面から認識', imgConfidence: '信頼度', imgEstimated: '推定した寸法', imgUnread: '読めなかった寸法', imgCheckDims: '製作前にご確認ください',
    quoteThis: 'この設計で見積もり', saveSignup: '結果をプロジェクトとして保存し編集を続けるには無料登録を。', signup: '無料登録', cadStructural: '自動構造検証', cadPackage: '設計パッケージ',
  },
  cn: {
    title: '您想设计什么？',
    sub: '用自然语言描述您想设计的东西，或上传图纸·草图。从机械设计到土木、建筑、景观和室内。',
    placeholder: '例如：设计一个 200L 不锈钢混凝罐 / 复核 6m 跨度的 H-300 梁',
    send: '发送', thinking: '思考中…',
    disclaimer: 'AI 回复为非法定参考资料。最终审核与签署由持证工程师负责。',
    error: '未能获取回复，请稍后重试。',
    reset: '新对话',
    trust: '确定性计算引擎 · 工程语料库 · 结果标注规范条款依据',
    chips: { mechanical: '机械设计', civil: '土木', architecture: '建筑', landscape: '景观', interior: '室内' },
    actDemo: '验证引擎演示', actQuote: '请求报价', actContact: '咨询专家',
    newChat: '新对话', guestNote: '访客：对话仅保存在本设备', guestLimit: '对话仅保存在本设备 — 注册后可同步',
    stop: '停止', copyMsg: '复制', copied: '已复制 ✓', regen: '重新生成',
    stageAnalyze: '正在分析请求…', stageCalc: '正在执行计算…', stageCad: '正在生成3D模型…',
    fuText: ['再详细解释一下', '总结要点', '适用哪些规范/标准?'], fuCalc: ['解释这个结果的依据', '什么条件下会不合格?'], fuCad: ['这个设计的制造风险是什么?', '推荐合适的材料'],
    clashWarn: '部件重叠 — 尚未是完整装配体。请用下方按钮要求修正或提供准确尺寸。', fuFixClash: '调整部件位置以消除干涉', threadLimit: '本对话已达免费上限({n}次) — 新建对话继续，或升级 Pro 无限使用。', proCta: '查看 Pro', cadContacts: '接触 {n}', photoHint: '📷 照片仅用作形状提示(不读取尺寸)。看起来是{label}。请提供关键尺寸即可生成。', attachDrawing: '图纸', attachPhoto: '照片',
    pickSel: '已选: {id} — 下一条消息仅修改此部件', pickEdited: '🎯 {id} 修改已应用 — 通过校核', genImg: '概念图', genImgMaking: '正在生成概念图…（白色背景规范）', genImgNote: 'AI概念图（白底）— 不作为尺寸·形状依据。满意的话用下方按钮进入图纸→3D。（今日剩余{n}次）', genImgUse: '用此概念图转图纸→3D', genImgLimit: '今日图片生成额度({n}次)已用完 — 明天再来，或升级Pro(50次/日)。',
    calcRunning: '正在计算…', calcPass: '合格', calcFail: '不合格', calcRefs: '依据',
    cadGenerating: '正在生成3D模型…', cadNoPreview: '该形状的3D预览在部署环境中提供，请查看下方SCAD。', cadDownload: '下载SCAD',
    cadSpecTitle: '按此规格生成精确3D？', cadConfirm: '确认 · 生成3D', cadBuilding: '正在生成精确几何(STEP)…', cadStepDownload: '下载STEP', cadGate: '确定性门控',
    cadAssemblyTitle: '按此组件生成？', cadParts: '零件 (独立实体)', cadInterfNone: '无干涉', cadInterf: '干涉 {n}处', cadOpenGA: '打开GA演示', cadStlDownload: '下载STL', cadDfm: 'DFM·估价',
    cadWeld: '焊接估算', cadWeldTotal: '总焊缝', cadTol: '一般公差 ISO 2768-m', cadGdt: '单项GD&T在应用', cadWiringTitle: '电缆清单(估算)', cadWiringNote: '估算·核对规格/长度·3D线束另属ECAD', cadDrawing: '正投影图',
    attach: '附加图纸·草图', uploadHint: '上传图纸·草图，我们读取正投影并转为3D（支持：平板·支架·法兰·管·方管·棒·加劲板·底板 等）', imgReading: '正在判读图纸…', imgRecognized: '从图纸识别', imgConfidence: '置信度', imgEstimated: '推测的尺寸', imgUnread: '未能读取的尺寸', imgCheckDims: '制作前请确认',
    quoteThis: '按此设计报价', saveSignup: '免费注册即可保存为项目并继续编辑。', signup: '免费注册', cadStructural: '自动结构校核', cadPackage: '设计包',
  },
  es: {
    title: '¿Qué quieres diseñar?',
    sub: 'Describe lo que quieres diseñar en lenguaje natural, o sube un plano/boceto. De lo mecánico a civil, arquitectura, paisajismo e interiores.',
    placeholder: 'ej.: Diseñar un tanque de coagulación de 200L / Verificar una viga H-300 en 6m',
    send: 'Enviar', thinking: 'Pensando…',
    disclaimer: 'Las respuestas de IA son referencias no normativas. La revisión y firma final son responsabilidad de un ingeniero colegiado.',
    error: 'No se pudo obtener respuesta. Inténtalo de nuevo en unos momentos.',
    reset: 'Nuevo chat',
    trust: 'Motor de cálculo determinista · corpus de ingeniería · cada resultado cita su norma',
    chips: { mechanical: 'Mecánico', civil: 'Civil', architecture: 'Arquitectura', landscape: 'Paisajismo', interior: 'Interior' },
    actDemo: 'Demo del motor de verificación', actQuote: 'Solicitar presupuesto', actContact: 'Hablar con un experto',
    newChat: 'Nuevo chat', guestNote: 'Invitado: los chats quedan en este dispositivo', guestLimit: 'Los chats se guardan solo aquí — regístrate para sincronizar',
    stop: 'Detener', copyMsg: 'Copiar', copied: 'Copiado ✓', regen: 'Regenerar',
    stageAnalyze: 'Analizando solicitud…', stageCalc: 'Ejecutando cálculo…', stageCad: 'Generando modelo 3D…',
    fuText: ['Explica con más detalle', 'Resume los puntos clave', '¿Qué normas aplican?'], fuCalc: ['Explica la base de este resultado', '¿En qué condiciones fallaría?'], fuCad: ['¿Riesgos de fabricación?', 'Recomienda un material adecuado'],
    clashWarn: 'Las piezas se superponen — aún no es un conjunto terminado. Pide una corrección abajo o da cotas exactas.', fuFixClash: 'Corrige las interferencias ajustando la posición de las piezas', threadLimit: 'Este chat alcanzó el límite gratis ({n} turnos) — abre un chat nuevo o pásate a Pro sin límites.', proCta: 'Ver Pro', cadContacts: '{n} contactos', photoHint: '📷 Las fotos son solo pista de forma (sin cotas). Parece {label}. Dame las cotas clave y lo genero.', attachDrawing: 'Plano', attachPhoto: 'Foto',
    pickSel: 'Seleccionado: {id} — el próximo mensaje edita solo esta pieza', pickEdited: '🎯 {id} editado — pasa las verificaciones', genImg: 'Concepto', genImgMaking: 'Generando imagen de concepto… (fondo blanco)', genImgNote: 'Concepto IA (fondo blanco) — no es base de cotas/geometría. ¿Te gusta? Continúa a plano→3D abajo. (Quedan {n} hoy)', genImgUse: 'Plano→3D con este concepto', genImgLimit: 'Límite diario de imágenes ({n}) alcanzado — vuelve mañana o pasa a Pro (50/día).',
    calcRunning: 'Calculando…', calcPass: 'CUMPLE', calcFail: 'NO CUMPLE', calcRefs: 'Refs',
    cadGenerating: 'Generando modelo 3D…', cadNoPreview: 'La vista 3D de esta forma está disponible en el entorno desplegado — consulta el SCAD abajo.', cadDownload: 'Descargar SCAD',
    cadSpecTitle: '¿Generar el 3D preciso con esta especificación?', cadConfirm: 'Confirmar · generar 3D', cadBuilding: 'Generando geometría precisa (STEP)…', cadStepDownload: 'Descargar STEP', cadGate: 'Compuerta determinista',
    cadAssemblyTitle: '¿Generar este ensamblaje?', cadParts: 'Piezas (cuerpos independientes)', cadInterfNone: 'Sin interferencia', cadInterf: '{n} interferencia(s)', cadOpenGA: 'Abrir presentación GA', cadStlDownload: 'Descargar STL', cadDfm: 'DFM · estimación',
    cadWeld: 'Estimación de soldadura', cadWeldTotal: 'Soldadura total', cadTol: 'Tol. general ISO 2768-m', cadGdt: 'GD&T por rasgo en la app', cadWiringTitle: 'Lista de cables (est.)', cadWiringNote: 'Estimación · verificar · arnés 3D = ECAD aparte', cadDrawing: 'Vista ortográfica',
    attach: 'Adjuntar plano/boceto', uploadHint: 'Sube un plano/boceto y leemos las vistas ortográficas a 3D (soportado: placa · escuadra · brida · tubo · tubo rect. · barra · cartela · placa base, etc.)', imgReading: 'Leyendo el plano…', imgRecognized: 'Reconocido del plano', imgConfidence: 'confianza', imgEstimated: 'Cotas estimadas', imgUnread: 'No se pudieron leer', imgCheckDims: 'confirme antes de fabricar',
    quoteThis: 'Cotizar este diseño', saveSignup: 'Regístrate gratis para guardar esto como proyecto y seguir editando.', signup: 'Registro gratis', cadStructural: 'Verif. estructural', cadPackage: 'Paquete de diseño',
  },
  ar: {
    title: 'ماذا تريد أن تُصمّم؟',
    sub: 'صِف ما تريد تصميمه بلغة طبيعية، أو ارفع رسمًا/مخططًا. من التصميم الميكانيكي إلى المدني والمعماري والمناظر والديكور.',
    placeholder: 'مثال: تصميم خزان تخثّر ستانلس 200 لتر / فحص جائز H-300 على بحر 6م',
    send: 'إرسال', thinking: 'يفكّر…',
    disclaimer: 'ردود الذكاء الاصطناعي مراجع غير قانونية. المراجعة والاعتماد النهائي مسؤولية مهندس مرخّص.',
    error: 'تعذّر الحصول على رد. حاول مرة أخرى بعد قليل.',
    reset: 'محادثة جديدة',
    trust: 'محرك حساب حتمي · مكتبة هندسية · كل نتيجة تُسنَد إلى بند الكود',
    chips: { mechanical: 'ميكانيكي', civil: 'مدني', architecture: 'معماري', landscape: 'مناظر', interior: 'ديكور' },
    actDemo: 'عرض محرّك التحقق', actQuote: 'اطلب عرض سعر', actContact: 'تحدث مع خبير',
    newChat: 'محادثة جديدة', guestNote: 'ضيف: تُحفظ المحادثات على هذا الجهاز فقط', guestLimit: 'تُحفظ المحادثات هنا فقط — سجّل للمزامنة',
    stop: 'إيقاف', copyMsg: 'نسخ', copied: 'تم النسخ ✓', regen: 'إعادة التوليد',
    stageAnalyze: 'جارٍ تحليل الطلب…', stageCalc: 'جارٍ تنفيذ الحساب…', stageCad: 'جارٍ إنشاء النموذج ثلاثي الأبعاد…',
    fuText: ['اشرح بمزيد من التفصيل', 'لخّص النقاط الأساسية', 'ما المعايير ذات الصلة؟'], fuCalc: ['اشرح أساس هذه النتيجة', 'في أي ظروف تصبح غير مطابقة؟'], fuCad: ['ما مخاطر التصنيع لهذا التصميم؟', 'اقترح مادة مناسبة'],
    clashWarn: 'الأجزاء متداخلة — ليست مجموعة مكتملة بعد. اطلب تصحيحًا أدناه أو حدّد الأبعاد.', fuFixClash: 'عالج التداخل بتعديل مواضع الأجزاء', threadLimit: 'وصلت هذه المحادثة إلى الحد المجاني ({n} رسائل) — ابدأ محادثة جديدة أو انتقل إلى Pro بلا حدود.', proCta: 'عرض Pro', cadContacts: 'تماس {n}', photoHint: '📷 الصور تلميح شكلي فقط (بدون أبعاد). يبدو {label}. أعطني الأبعاد الرئيسية للإنشاء.', attachDrawing: 'مخطط', attachPhoto: 'صورة',
    pickSel: 'محدد: {id} — الرسالة التالية تعدل هذا الجزء فقط', pickEdited: '🎯 تم تعديل {id} — اجتاز البوابات', genImg: 'تصور', genImgMaking: 'جارٍ إنشاء صورة التصور… (خلفية بيضاء)', genImgNote: 'تصور بالذكاء الاصطناعي (خلفية بيضاء) — ليس مرجعًا للأبعاد أو الشكل. إن أعجبك تابع إلى مخطط→3D أدناه. (المتبقي اليوم {n})', genImgUse: 'مخطط→3D من هذا التصور', genImgLimit: 'استُنفد حد إنشاء الصور اليومي ({n}) — عد غدًا أو انتقل إلى Pro (50/يوم).',
    calcRunning: 'جارٍ الفحص…', calcPass: 'مطابق', calcFail: 'غير مطابق', calcRefs: 'المراجع',
    cadGenerating: 'جارٍ إنشاء النموذج ثلاثي الأبعاد…', cadNoPreview: 'تتوفر معاينة ثلاثية الأبعاد لهذا الشكل في بيئة النشر — راجع SCAD أدناه.', cadDownload: 'تنزيل SCAD',
    cadSpecTitle: 'هل تُنشئ نموذجًا دقيقًا بهذه المواصفات؟', cadConfirm: 'تأكيد · بناء 3D', cadBuilding: 'جارٍ بناء الشكل الدقيق (STEP)…', cadStepDownload: 'تنزيل STEP', cadGate: 'بوابة حتمية',
    cadAssemblyTitle: 'هل تُنشئ هذا التجميع؟', cadParts: 'الأجزاء (أجسام مستقلة)', cadInterfNone: 'لا تداخل', cadInterf: '{n} تداخل', cadOpenGA: 'افتح عرض GA', cadStlDownload: 'تنزيل STL', cadDfm: 'DFM · تقدير',
    cadWeld: 'تقدير اللحام', cadWeldTotal: 'إجمالي اللحام', cadTol: 'تفاوت عام ISO 2768-m', cadGdt: 'GD&T لكل عنصر في التطبيق', cadWiringTitle: 'جدول الكابلات (تقديري)', cadWiringNote: 'تقديري · تحقّق · تسليك 3D = ECAD منفصل', cadDrawing: 'مسقط هندسي',
    attach: 'إرفاق رسم/مخطط', uploadHint: 'ارفع رسمًا/مخططًا وسنقرأ المساقط الهندسية إلى نموذج ثلاثي الأبعاد (المدعوم: لوح · زاوية · شفة · أنبوب · أنبوب مربّع · قضيب · لوح تقوية · لوح قاعدة، إلخ)', imgReading: 'جارٍ قراءة الرسم…', imgRecognized: 'تم التعرف من الرسم', imgConfidence: 'الثقة', imgEstimated: 'أبعاد مُقدَّرة', imgUnread: 'تعذّرت قراءتها', imgCheckDims: 'يرجى التأكد قبل التصنيع',
    quoteThis: 'اطلب عرض سعر لهذا التصميم', saveSignup: 'سجّل مجانًا لحفظ هذا كمشروع ومتابعة التحرير.', signup: 'تسجيل مجاني', cadStructural: 'فحص إنشائي تلقائي', cadPackage: 'حزمة التصميم',
  },
};

// 분야별 시작 예시 프롬프트 (대화 시작 전 노출, 클릭 시 즉시 전송)
const SUGGEST: Record<Lang, Record<Domain, string[]>> = {
  kr: {
    mechanical: ['200L 스테인리스 응집 탱크 설계 포인트 알려줘', 'H형 브래킷을 판금으로 만들 때 DFM 주의점은?', '기어박스 하우징 재질을 알루미늄 vs 주철로 비교해줘'],
    civil: ['H=4m 옹벽 안정성 검토 항목 정리해줘', '경간 6m 단순보 처짐 검토는 어떻게?', '우수관로 관경 산정 흐름 알려줘'],
    architecture: ['RC 슬래브 두께 결정 기준은?', '소규모 근생 건물 피난 체크포인트 알려줘', 'BIM으로 물량 산출하는 워크플로우는?'],
    landscape: ['옥상정원 방수·배수 설계 포인트는?', '가로수 식재 간격과 토심 기준 알려줘', '우수 저류형 조경 방법 정리해줘'],
    interior: ['20평 카페 좌석 배치와 동선 제안해줘', '주방 마감재 선정 기준 알려줘', '간접조명 계획 시 고려사항은?'],
  },
  en: {
    mechanical: ['Key design points for a 200L stainless coagulation tank', 'DFM tips for making an H-bracket from sheet metal', 'Compare aluminum vs cast iron for a gearbox housing'],
    civil: ['Stability checks for a 4m retaining wall', 'How to check deflection of a 6m simple beam', 'Walk me through sizing a stormwater pipe'],
    architecture: ['How is RC slab thickness decided?', 'Egress checkpoints for a small commercial building', 'A BIM workflow for quantity take-off'],
    landscape: ['Waterproofing and drainage for a rooftop garden', 'Street-tree spacing and soil depth standards', 'Methods for stormwater-retention landscaping'],
    interior: ['Seating layout and flow for a 60㎡ cafe', 'How to choose kitchen finish materials', 'What to consider when planning indirect lighting'],
  },
  ja: {
    mechanical: ['200Lステンレス凝集タンクの設計ポイントは？', 'Hブラケットを板金で作る際のDFM注意点は？', 'ギヤボックス筐体をアルミvs鋳鉄で比較して'],
    civil: ['H=4mの擁壁の安定検討項目を整理して', 'スパン6mの単純梁のたわみ検討は？', '雨水管の管径算定の流れを教えて'],
    architecture: ['RCスラブ厚さの決定基準は？', '小規模店舗の避難チェックポイントは？', 'BIMで数量算出するワークフローは？'],
    landscape: ['屋上庭園の防水・排水の設計ポイントは？', '街路樹の植栽間隔と土壌深さの基準は？', '雨水貯留型ランドスケープの手法を整理して'],
    interior: ['60㎡カフェの座席配置と動線を提案して', 'キッチン仕上げ材の選定基準は？', '間接照明計画で考慮すべき点は？'],
  },
  cn: {
    mechanical: ['200L不锈钢混凝罐的设计要点', 'H型支架用钣金制作的DFM注意事项', '齿轮箱壳体铝合金与铸铁的对比'],
    civil: ['H=4m挡土墙的稳定性验算项目', '跨度6m简支梁的挠度如何验算', '雨水管管径计算流程'],
    architecture: ['RC楼板厚度的确定依据', '小型商业建筑的疏散检查要点', '用BIM进行工程量计算的流程'],
    landscape: ['屋顶花园的防水与排水设计要点', '行道树的种植间距与土层深度标准', '雨水滞留型景观的做法'],
    interior: ['60㎡咖啡馆的座位布置与动线', '厨房饰面材料的选择依据', '间接照明规划的注意事项'],
  },
  es: {
    mechanical: ['Puntos clave para un tanque de coagulación de 200L', 'Consejos DFM para un soporte en H de chapa', 'Aluminio vs fundición para la carcasa de un reductor'],
    civil: ['Verificaciones de estabilidad de un muro de 4m', 'Cómo revisar la flecha de una viga simple de 6m', 'Cálculo del diámetro de una tubería pluvial'],
    architecture: ['¿Cómo se decide el espesor de una losa de RC?', 'Puntos de evacuación de un local pequeño', 'Un flujo BIM para el cómputo de cantidades'],
    landscape: ['Impermeabilización y drenaje de un jardín en azotea', 'Separación de arbolado y profundidad de suelo', 'Métodos de paisajismo de retención pluvial'],
    interior: ['Distribución y circulación de un café de 60㎡', 'Cómo elegir los acabados de cocina', 'Qué considerar al planificar luz indirecta'],
  },
  ar: {
    mechanical: ['نقاط تصميم خزان تخثّر ستانلس 200 لتر', 'نصائح DFM لصنع كتيفة على شكل H من الصفائح', 'مقارنة الألمنيوم بالحديد الزهر لغلاف صندوق التروس'],
    civil: ['بنود فحص ثبات جدار استنادي بارتفاع 4م', 'كيفية فحص ترخيم جائز بسيط بحر 6م', 'خطوات حساب قطر أنبوب تصريف الأمطار'],
    architecture: ['كيف يُحدَّد سُمك بلاطة خرسانية مسلّحة؟', 'نقاط فحص إخلاء لمبنى تجاري صغير', 'سير عمل BIM لحصر الكميات'],
    landscape: ['نقاط تصميم العزل والتصريف لحديقة سطح', 'معايير تباعد أشجار الشوارع وعمق التربة', 'طرق تنسيق مواقع لاحتجاز مياه الأمطار'],
    interior: ['توزيع المقاعد ومسارات الحركة لمقهى 60م²', 'معايير اختيار تشطيبات المطبخ', 'ما يجب مراعاته عند تخطيط الإضاءة غير المباشرة'],
  },
};

// 결정론 계산 결과 카드 (eng-api demo 응답 → PASS/FAIL + 검토항목 + 근거).
function CalcCard({ calc, t, isRtl, consultHref, onRerun, onPrint }: { calc: CalcResult; t: (typeof DICT)[Lang]; isRtl: boolean; consultHref: string; onRerun?: () => void; onPrint?: () => void }) {
  if (calc.error) {
    return (
      <div style={{ maxWidth: '92%', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '11px 14px', fontSize: 12.5, color: '#fca5a5', textAlign: isRtl ? 'right' : 'left' }}>
        ⚠️ {calc.error}
      </div>
    );
  }
  const pass = calc.verdict === 'PASS';
  return (
    <div style={{ maxWidth: '92%', background: '#0d1117', border: `1px solid ${pass ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`, borderRadius: 14, padding: '14px 16px', textAlign: isRtl ? 'right' : 'left', boxShadow: '0 6px 24px rgba(0,0,0,0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, background: pass ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)', color: pass ? '#4ade80' : '#f87171' }}>{pass ? `✓ ${t.calcPass}` : `✕ ${t.calcFail}`}</span>
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{calc.title}</span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {calc.checks.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 11px', borderRadius: 8, background: c.pass ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${c.pass ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0' }}>{c.pass ? '✓' : '✕'} {c.name}</span>
            <span style={{ fontSize: 11.5, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{c.detail}</span>
          </div>
        ))}
      </div>
      {calc.refs.length > 0 && (
        <p style={{ marginTop: 10, fontSize: 10.5, color: '#8b949e', lineHeight: 1.6 }}>
          <strong style={{ color: '#94a3b8' }}>{t.calcRefs}:</strong> {calc.refs.join(' · ')}
        </p>
      )}
      <a href={consultHref} style={{ display: 'inline-block', marginTop: 10, fontSize: 12, fontWeight: 700, color: '#93c5fd', textDecoration: 'none' }}>{t.actContact} →</a>
      <p style={{ marginTop: 6, fontSize: 10, color: '#6e7681', lineHeight: 1.5 }}>{t.disclaimer}</p>
      {(onRerun || onPrint) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {onRerun && <button type="button" onClick={onRerun} style={{ fontSize: 11, background: 'rgba(59,130,246,0.15)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>↻ Re-run</button>}
          {onPrint && <button type="button" onClick={onPrint} style={{ fontSize: 11, background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>🖨</button>}
        </div>
      )}
    </div>
  );
}

// 공용 버튼 스타일
const btnPrimary = (accent: string): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: accent, color: '#fff', border: 'none' });
const btnGhost: React.CSSProperties = { padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.14)' };

function download(text: string, name: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// 기계 CAD 결과 카드 — 단일부품(체크포인트→STEP 3D) / 멀티바디(부품목록+간섭→GA).
// 출력: STEP·STL·SCAD·GA(render-html). 기본 DFM/견적(fab).

/* SCAD 인라인 3D 미리보기 — STEP 승인 전에도 채팅 안에서 바로 본다(2026-07-16 사용자 요청).
   렌더는 클라 결정론(openscad-wasm→STL→three). 최신 카드만 auto, 과거 카드는 버튼(스레드
   복원 시 일괄 렌더 방지). three/wasm은 클릭·auto 시점에 동적 로드(랜딩 번들 비대화 방지). */
function MiniScadViewer({ scad, auto, accent, height = 240, parts, selectedId, onPick, onFaceDrag }: { scad: string; auto?: boolean; accent: string; height?: number; parts?: Array<{ id: string; aabb: { min: number[]; max: number[] } }>; selectedId?: string | null; onPick?: (id: string | null, normal?: number[] | null) => void; onFaceDrag?: (id: string, normal: number[], deltaMm: number) => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const cleanupRef = useRef<(() => void) | null>(null);
  const apiRef = useRef<{ select: (id: string | null) => void } | null>(null);
  const start = useCallback(async () => {
    if (!mountRef.current) return;
    cleanupRef.current?.(); // 재시도 시 이전 renderer·리스너 정리(누수 방지)
    cleanupRef.current = null;
    setSt('busy');
    try {
      const [wr, im, THREE] = await Promise.all([
        import('@/app/[lang]/studio/wasmRender'),
        import('@/app/[lang]/shape-generator/io/importers'),
        import('three'),
      ]);
      if (!wr.wasmAvailable()) throw new Error('3D unavailable in this browser');
      const r = await wr.renderScadWasm(scad);
      if (!r.ok || !r.data) throw new Error(r.error ?? 'render failed');
      const buf = r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
      const geom = im.parseSTL(buf);
      geom.computeVertexNormals();
      geom.computeBoundingBox();
      const mount = mountRef.current;
      if (!mount) return;
      const W = mount.clientWidth || 320, H = height;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(W, H);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      mount.innerHTML = '';
      mount.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b1020);
      const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 200000);
      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const dl = new THREE.DirectionalLight(0xffffff, 1.1); dl.position.set(1, 1, 1.4); scene.add(dl);
      const bb = geom.boundingBox!;
      const size = new THREE.Vector3(); bb.getSize(size);
      const center = new THREE.Vector3(); bb.getCenter(center);
      const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x60a5fa, metalness: 0.15, roughness: 0.6 }));
      mesh.position.sub(center);
      scene.add(mesh);
      const R0 = (Math.max(size.x, size.y, size.z) || 100) * 1.7;
      let R = R0;
      let theta = Math.PI / 4, phi = Math.PI / 3, drag = false, px = 0, py = 0, dx0 = 0, dy0 = 0;
      const draw = () => {
        cam.position.set(R * Math.sin(phi) * Math.cos(theta), R * Math.sin(phi) * Math.sin(theta), R * Math.cos(phi));
        cam.up.set(0, 0, 1); cam.lookAt(0, 0, 0);
        renderer.render(scene, cam);
      };
      // P1 픽킹: 부품 AABB 프록시(투명) 레이캐스트 → 선택=엣지 하이라이트
      const pickGroup = new THREE.Group();
      if (parts?.length) {
        for (const p of parts as PartProxy[]) {
          let pm: InstanceType<typeof THREE.Mesh>;
          const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
          if (p.obb) {
            // #3 OBB: 회전 부품=로컬 치수 박스에 부품 회전 적용(옆 부품 오픽 방지)
            const lm = p.obb.local.min, lx2 = p.obb.local.max;
            pm = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, lx2[0] - lm[0]), Math.max(1, lx2[1] - lm[1]), Math.max(1, lx2[2] - lm[2])), mat);
            const { tx, ty, tz, rx, ry, rz } = p.obb.at;
            const R = new THREE.Matrix4().makeRotationZ((rz * Math.PI) / 180)
              .multiply(new THREE.Matrix4().makeRotationY((ry * Math.PI) / 180))
              .multiply(new THREE.Matrix4().makeRotationX((rx * Math.PI) / 180));
            pm.setRotationFromMatrix(R);
            const lc = new THREE.Vector3((lm[0] + lx2[0]) / 2, (lm[1] + lx2[1]) / 2, (lm[2] + lx2[2]) / 2).applyMatrix4(R);
            pm.position.set(tx + lc.x - center.x, ty + lc.y - center.y, tz + lc.z - center.z);
            pm.userData.rot = [rx, ry, rz];
          } else {
            const mn = p.aabb.min, mx = p.aabb.max;
            pm = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, mx[0] - mn[0]), Math.max(1, mx[1] - mn[1]), Math.max(1, mx[2] - mn[2])), mat);
            pm.position.set((mn[0] + mx[0]) / 2 - center.x, (mn[1] + mx[1]) / 2 - center.y, (mn[2] + mx[2]) / 2 - center.z);
            pm.userData.rot = null;
          }
          pm.userData.pid = p.id;
          pickGroup.add(pm);
        }
        scene.add(pickGroup);
      }
      let hl: InstanceType<typeof THREE.LineSegments> | null = null;
      let selCur: string | null = null; // 클로저 내 현재 선택(프롭은 마운트 시점 고정 — 스테일 방지)
      const select = (id: string | null) => {
        selCur = id;
        if (hl) { scene.remove(hl); hl.geometry.dispose(); (hl.material as { dispose: () => void }).dispose(); hl = null; }
        const box = pickGroup.children.find((c) => c.userData.pid === id) as InstanceType<typeof THREE.Mesh> | undefined;
        if (box) {
          hl = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry as never), new THREE.LineBasicMaterial({ color: new THREE.Color(accent) }));
          hl.position.copy(box.position);
          hl.quaternion.copy(box.quaternion); // OBB(#3) — 회전 부품 하이라이트 정합
          scene.add(hl);
        }
        draw();
      };
      apiRef.current = { select };
      if (selectedId) select(selectedId); // 리마운트(수정 적용 후) 시 선택 하이라이트 복원
      const ray = new THREE.Raycaster();
      const castAt = (cx2: number, cy2: number) => {
        const rect = renderer.domElement.getBoundingClientRect();
        if (cx2 < rect.left || cx2 > rect.right || cy2 < rect.top || cy2 > rect.bottom) return null;
        ray.setFromCamera({ x: ((cx2 - rect.left) / rect.width) * 2 - 1, y: -((cy2 - rect.top) / rect.height) * 2 + 1 } as never, cam);
        return ray.intersectObjects(pickGroup.children, false)[0] ?? null;
      };
      // P2 면 푸시풀: 선택된 부품 위에서 드래그 시작=면 드래그(노멀 방향 mm), 그 외=궤도
      let df: { id: string; n: number[]; axis: number; sign: number; dir2: [number, number]; mmPerPx: number; delta: number } | null = null;
      const dfTip = document.createElement('div');
      dfTip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:5;background:rgba(15,23,42,.9);color:#fff;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:700';
      mount.style.position = 'relative';
      mount.appendChild(dfTip);
      // #6 모바일: 포인터 2개=핀치 줌(궤도·푸시풀 억제) · 탭=픽(포인터 이벤트라 터치 공통)
      renderer.domElement.style.touchAction = 'none';
      const ptrs = new Map<number, [number, number]>();
      let pinch0: number | null = null, pinchR0 = R;
      const pDist = () => { const v = [...ptrs.values()]; return Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); };
      const onDown = (e: PointerEvent) => {
        ptrs.set(e.pointerId, [e.clientX, e.clientY]);
        if (ptrs.size === 2) { drag = false; df = null; dfTip.style.display = 'none'; pinch0 = pDist(); pinchR0 = R; return; }
        drag = true; px = e.clientX; py = e.clientY; dx0 = e.clientX; dy0 = e.clientY;
        df = null;
        if (!parts?.length || !onFaceDrag || !selCur) return;
        const hit = castAt(e.clientX, e.clientY);
        if (!hit || String(hit.object.userData.pid) !== selCur || !hit.face) return;
        const nL = hit.face.normal.clone(); // 프록시 로컬(=CAD 로컬 — OBB 는 회전 적용됨)
        const n = nL.clone().applyQuaternion(hit.object.quaternion); // 월드(화면 투영용)
        const axis = Math.abs(nL.x) > 0.5 ? 0 : Math.abs(nL.y) > 0.5 ? 1 : 2;
        const sign = [nL.x, nL.y, nL.z][axis] > 0 ? 1 : -1;
        // 노멀의 화면 투영 방향 + mm/px 환산(히트 깊이 기준)
        const p0 = hit.point.clone(), p1 = hit.point.clone().add(n.clone().multiplyScalar(100));
        const s0 = p0.clone().project(cam), s1 = p1.clone().project(cam);
        const rect = renderer.domElement.getBoundingClientRect();
        const v2: [number, number] = [(s1.x - s0.x) * rect.width / 2, -(s1.y - s0.y) * rect.height / 2];
        const L2 = Math.hypot(v2[0], v2[1]);
        if (L2 < 2) return; // 화면과 수직에 가까움 — 궤도로
        const rot = hit.object.userData.rot as number[] | null;
        const nCad = rot ? rotCadVec(rot, [nL.x, nL.y, nL.z]) : [n.x, n.y, n.z]; // 서버=CAD 월드 노멀
        df = { id: selCur, n: nCad, axis, sign, dir2: [v2[0] / L2, v2[1] / L2], mmPerPx: 100 / L2, delta: 0 };
      };
      const onMove = (e: PointerEvent) => {
        if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
        if (ptrs.size === 2 && pinch0) {
          const d2 = pDist();
          if (d2 > 8) { R = Math.max(R0 * 0.15, Math.min(R0 * 6, pinchR0 * (pinch0 / d2))); draw(); }
          return;
        }
        if (!drag) return;
        if (df) {
          // #4 드래그 스냅 — 5mm 그리드
          df.delta = Math.round((((e.clientX - dx0) * df.dir2[0] + (e.clientY - dy0) * df.dir2[1]) * df.mmPerPx) / 5) * 5;
          if (hl) { // 하이라이트 박스를 해당 축으로 신축(라이브 프리뷰 — 실적용은 서버 게이트)
            const box = pickGroup.children.find((c) => c.userData.pid === df!.id) as InstanceType<typeof THREE.Mesh> | undefined;
            if (box) {
              const bg = box.geometry as unknown as { parameters: { width: number; height: number; depth: number } };
              const dims = [bg.parameters.width, bg.parameters.height, bg.parameters.depth];
              const sc = Math.max(0.05, (dims[df.axis] + df.delta) / dims[df.axis]);
              hl.scale.setComponent(df.axis, sc);
              hl.position.copy(box.position);
              const eAx = new THREE.Vector3(df.axis === 0 ? 1 : 0, df.axis === 1 ? 1 : 0, df.axis === 2 ? 1 : 0).applyQuaternion(box.quaternion);
              hl.position.addScaledVector(eAx, (df.sign * df.delta) / 2); // 회전 부품=로컬 축의 월드 방향
            }
          }
          const rect = renderer.domElement.getBoundingClientRect();
          dfTip.style.display = 'block';
          dfTip.style.left = `${e.clientX - rect.left + 14}px`;
          dfTip.style.top = `${e.clientY - rect.top - 10}px`;
          dfTip.textContent = `${df.delta >= 0 ? '+' : ''}${Math.round(df.delta)}mm`;
          draw();
          return;
        }
        theta -= (e.clientX - px) * 0.01;
        phi = Math.min(Math.PI - 0.1, Math.max(0.1, phi - (e.clientY - py) * 0.01));
        px = e.clientX; py = e.clientY; draw();
      };
      const onUp = (e: PointerEvent) => {
        ptrs.delete(e.pointerId);
        if (pinch0 !== null) { if (ptrs.size < 2) pinch0 = null; return; } // 핀치 종료 — 클릭 오발동 방지
        const was = drag; drag = false;
        dfTip.style.display = 'none';
        if (df) {
          const { id, n, delta } = df;
          df = null;
          if (hl) { hl.scale.set(1, 1, 1); }
          if (Math.abs(delta) >= 2 && onFaceDrag) { onFaceDrag(id, n, Math.round(delta)); return; }
          select(selCur); // 미적용 — 원위치
          return;
        }
        if (!was || !parts?.length || !onPick) return;
        if (Math.hypot(e.clientX - dx0, e.clientY - dy0) > 6) return; // 드래그≠클릭
        const hit = castAt(e.clientX, e.clientY);
        const id = hit ? String(hit.object.userData.pid ?? '') || null : null;
        select(id);
        const rotU = hit?.object.userData.rot as number[] | null | undefined;
        const nP = hit?.face
          ? (rotU ? rotCadVec(rotU, [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z]) : [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z])
          : null;
        onPick(id, nP);
      };
      const onWheel = (e: WheelEvent) => { e.preventDefault(); R = Math.max(R0 * 0.15, Math.min(R0 * 6, R * (e.deltaY > 0 ? 1.12 : 0.89))); draw(); };
      renderer.domElement.addEventListener('pointerdown', onDown);
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        renderer.domElement.removeEventListener('wheel', onWheel);
        apiRef.current = null;
        renderer.dispose();
        geom.dispose();
      };
      draw();
      setSt('ok');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setSt('err');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scad, parts, onPick, accent, height]);
  useEffect(() => () => { cleanupRef.current?.(); }, []);
  useEffect(() => { apiRef.current?.select(selectedId ?? null); }, [selectedId]);
  useEffect(() => { if (auto && st === 'idle') void start(); /* 최신 카드만 자동 */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);
  return (
    <div style={{ marginBottom: 10 }}>
      {st !== 'ok' && (
        <button type="button" onClick={() => void start()} disabled={st === 'busy'}
          style={{ padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: st === 'busy' ? 'wait' : 'pointer', border: `1px solid ${accent}55`, background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
          {st === 'busy' ? '⏳ 3D…' : '▶ 3D'}
        </button>
      )}
      {st === 'err' && <div style={{ marginTop: 4, fontSize: 11, color: '#f87171' }}>{errMsg}</div>}
      <div ref={mountRef} style={{ width: '100%', borderRadius: 12, overflow: 'hidden', display: st === 'ok' ? 'block' : 'none', border: '1px solid rgba(255,255,255,0.08)' }} />
    </div>
  );
}

function CadCard({ cad, t, accent, isRtl, preview }: { cad: CadResult; t: (typeof DICT)[Lang]; accent: string; isRtl: boolean; preview?: boolean }) {
  const [stepText, setStepText] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState('');
  const [geos, setGeos] = useState<unknown[] | null>(null);
  const [gaBusy, setGaBusy] = useState(false);
  const [dfm, setDfm] = useState<{ mass?: number; cost?: number; dxf?: string } | null>(null);
  const [dfmBusy, setDfmBusy] = useState(false);
  const [pkgBusy, setPkgBusy] = useState(false);

  // 설계 패키지 자동생성 — 어셈블리 → GA 3D·2D 도면·구조·SCAD 일괄 다운로드.
  const downloadPackage = async () => {
    if (!cad.assembly) return;
    setPkgBusy(true); setErr('');
    try {
      const r = await fetch('/api/nexyfab/drawing/package/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assembly: cad.assembly, options: { member: { section: 'SHS50x50x3', spanMm: 1000 } } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || (Array.isArray(j?.gateErrors) ? j.gateErrors.join(', ') : '패키지 생성 실패'));
      if (typeof j.zipBase64 === 'string') {
        const bin = atob(j.zipBase64); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        const a = document.createElement('a'); a.href = url; a.download = 'design_package.zip'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } else if (Array.isArray(j.files)) {
        for (const f of j.files as Array<{ name: string; content: string; mime?: string }>) download(f.content, f.name, f.mime ?? 'text/html');
      } else throw new Error('패키지 생성 실패');
    } catch (e) { setErr(e instanceof Error ? e.message : t.error); } finally { setPkgBusy(false); }
  };

  const confirmStep = async () => {
    if (!cad.composeIntent) return;
    setBuilding(true); setErr('');
    try {
      const r = await fetch('/api/nexyfab/drawing/export-step/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: cad.composeIntent }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || typeof j.step !== 'string') throw new Error(j?.error || 'STEP build failed');
      setStepText(j.step);
    } catch (e) { setErr(e instanceof Error ? e.message : t.error); } finally { setBuilding(false); }
  };

  const openGA = async () => {
    setGaBusy(true); setErr('');
    try {
      const body = cad.isAssembly ? { assembly: cad.assembly } : { intent: cad.composeIntent };
      const r = await fetch('/api/nexyfab/drawing/render-html/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || typeof j.html !== 'string') throw new Error(j?.error || 'GA build failed');
      const url = URL.createObjectURL(new Blob([j.html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setErr(e instanceof Error ? e.message : t.error); } finally { setGaBusy(false); }
  };

  const downloadStl = async () => {
    if (!geos || !geos.length) return;
    const THREE = await import('three');
    const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
    const group = new THREE.Group();
    for (const g of geos) group.add(new THREE.Mesh(g as ThreeNS.BufferGeometry));
    download(new STLExporter().parse(group), 'model.stl', 'model/stl');
  };

  const runDfm = async () => {
    const intent = cad.composeIntent; if (!intent) return;
    setDfmBusy(true); setErr('');
    try {
      const r = await fetch('/api/nexyfab/drawing/fab/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'DFM failed');
      const est = (j.estimate ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
      setDfm({ mass: num(est.massKg ?? est.mass ?? j.massKg), cost: num(est.total ?? est.cost ?? j.cost), dxf: typeof j.dxf === 'string' ? j.dxf : undefined });
    } catch (e) { setErr(e instanceof Error ? e.message : t.error); } finally { setDfmBusy(false); }
  };

  const card: React.CSSProperties = { width: 'min(92%, 540px)', background: '#0d1117', border: `1px solid ${accent}44`, borderRadius: 14, padding: 14, textAlign: isRtl ? 'right' : 'left', boxShadow: '0 6px 24px rgba(0,0,0,0.3)' };
  if (cad.error) return <div style={{ ...card, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: 12.5 }}>⚠️ {cad.error}</div>;
  if (cad.composing) return <div style={{ ...card, color: '#93c5fd', fontSize: 13 }}>{t.cadGenerating}</div>;

  const gateOk = !cad.gateErrors || cad.gateErrors.length === 0;
  const specBlock = cad.spec && cad.spec.length > 0 && (
    <div style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
      {cad.spec.map((s, i) => (
        <div key={i} style={{ fontSize: 12.5, color: '#cbd5e1', padding: '6px 11px', borderRadius: 8, background: '#0b1020', border: '1px solid rgba(255,255,255,0.07)', fontVariantNumeric: 'tabular-nums' }}>{s}</div>
      ))}
    </div>
  );
  const gateBadge = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, marginBottom: 12, padding: '3px 10px', borderRadius: 999, background: gateOk ? 'rgba(34,197,94,0.14)' : 'rgba(245,158,11,0.14)', color: gateOk ? '#4ade80' : '#fbbf24' }}>
      {gateOk ? '✓' : '!'} {t.cadGate}{!gateOk && `: ${cad.gateErrors!.join(', ')}`}
    </div>
  );
  const drawingSvg = !cad.isAssembly ? buildDrawingSvg(cad.composeIntent) : null;
  const tolStr = toleranceRange(cad.isAssembly ? cad.assembly : cad.composeIntent);
  const tolBadge = tolStr && (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, marginBottom: 12, padding: '3px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.12)', color: '#93c5fd' }}>
      📐 {t.cadTol} {tolStr} · <span style={{ opacity: 0.75 }}>{t.cadGdt}</span>
    </div>
  );
  const scadDetails = cad.scad && (
    <details style={{ marginBottom: 12 }}>
      <summary style={{ fontSize: 12, color: '#8b949e', cursor: 'pointer', fontWeight: 600 }}>SCAD</summary>
      <pre style={{ marginTop: 8, maxHeight: 150, overflow: 'auto', fontSize: 11, lineHeight: 1.5, color: '#7dd3fc', background: '#0b1020', padding: '10px 12px', borderRadius: 8, fontFamily: 'ui-monospace, monospace' }}>{cad.scad}</pre>
    </details>
  );
  const dfmBlock = dfm && (
    <div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1', background: '#0b1020', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '8px 11px' }}>
      {dfm.mass !== undefined && <span>≈ {dfm.mass.toFixed(1)} kg&nbsp;&nbsp;</span>}
      {dfm.cost !== undefined && <span>≈ ₩{Math.round(dfm.cost).toLocaleString()}&nbsp;&nbsp;</span>}
      {dfm.dxf && <button onClick={() => download(dfm.dxf!, 'flat.dxf', 'application/dxf')} style={{ ...btnGhost, padding: '3px 10px' }}>⭳ DXF</button>}
      <div style={{ marginTop: 4, fontSize: 10, color: '#6e7681' }}>개산(비법정) · 조인트/용접 정량은 다음 단계</div>
    </div>
  );
  // 맥락형 전환 — 결과 안에서 자연스럽게 견적으로(별도 CTA 버튼 대신).
  // '이 설계로 견적 받기' 링크 제거(2026-07-16 사용자 결정) — 견적은 챗·스튜디오 흐름 안에서.

  // ── 멀티바디 조립체 ──
  if (cad.isAssembly) {
    const nInterf = cad.interferences?.length ?? 0;
    return (
      <div style={card}>
        {stepText && (
          <div style={{ marginBottom: 12 }}>
            <ChatCadViewer stepText={stepText} accent={accent} onReady={setGeos} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={() => download(stepText, 'assembly.step', 'application/step')} style={btnPrimary(accent)}>⭳ {t.cadStepDownload}</button>
              {geos && <button onClick={downloadStl} style={btnGhost}>⭳ {t.cadStlDownload}</button>}
            </div>
          </div>
        )}
        {!stepText && cad.scad && <MiniScadViewer scad={cad.scad} auto={preview} accent={accent} />}
        {nInterf > 0 && (
          <div style={{ margin: '0 0 10px', padding: '8px 11px', borderRadius: 9, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', fontSize: 12, lineHeight: 1.55 }}>
            ⚠ <b>{t.cadInterf.replace('{n}', String(nInterf))}</b> — {t.clashWarn}
          </div>
        )}
        <div style={{ fontSize: 13, fontWeight: 800, color: '#e6edf3', marginBottom: 10 }}>{t.cadAssemblyTitle}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', marginBottom: 6 }}>{t.cadParts}</div>
        {specBlock}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {gateBadge}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: nInterf ? 'rgba(239,68,68,0.14)' : 'rgba(34,197,94,0.14)', color: nInterf ? '#f87171' : '#4ade80' }}>
            {nInterf ? `✕ ${t.cadInterf.replace('{n}', String(nInterf))}` : `✓ ${t.cadInterfNone}`}
          </div>
          {(cad.contacts?.length ?? 0) > 0 && (
            <div title="접촉/체결 후보(관통 ≤2mm) — 조인트 선언 정밀검증 후속" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'rgba(148,163,184,0.14)', color: '#94a3b8' }}>
            ◦ {t.cadContacts.replace('{n}', String(cad.contacts!.length))}
          </div>
          )}
          {tolBadge}
        </div>
        {cad.welds && cad.welds.length > 0 && (
          <div style={{ marginBottom: 12, fontSize: 12, color: '#cbd5e1', background: '#0b1020', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 12px' }}>
            <div style={{ fontWeight: 700, marginBottom: 5 }}>🔩 {t.cadWeld} · {t.cadWeldTotal} ≈ {(cad.weldTotalMm ?? 0).toLocaleString()} mm</div>
            <div style={{ display: 'grid', gap: 2 }}>
              {cad.welds.slice(0, 8).map((w, i) => (
                <div key={i} style={{ fontSize: 11.5, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                  {String(w.a)}–{String(w.b)}: {Number(w.lengthMm)}mm · 필렛 {Number(w.legMm)}mm · 목 {Number(w.throatMm)}mm · {Number(w.throatAreaMm2).toLocaleString()}mm²
                </div>
              ))}
            </div>
            <div style={{ marginTop: 5, fontSize: 10, color: '#6e7681' }}>전둘레 필렛 개산 · AABB 접촉 기준 · 비법정(정밀은 조인트 선언 후속)</div>
          </div>
        )}
        {cad.structural && typeof cad.structural.totalMassKg === 'number' && (() => {
          const s = cad.structural!; const warn = (s.warnings?.length ?? 0) > 0;
          return (
            <div style={{ marginBottom: 12, fontSize: 12, color: '#cbd5e1', background: '#0b1020', border: `1px solid ${warn ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.25)'}`, borderRadius: 8, padding: '9px 12px' }}>
              <div style={{ fontWeight: 700, marginBottom: 5 }}>🏗️ {t.cadStructural} {warn ? '⚠️' : '✓'}</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
                <span>질량 ≈ {s.totalMassKg} kg</span>
                {typeof s.cgHeightM === 'number' && <span>CG {s.cgHeightM} m</span>}
                {typeof s.maxSupportKg === 'number' && <span>지지 ≤ {s.maxSupportKg} kg</span>}
                {s.tipover && <span>전도 {s.tipover.staticAngleDeg}° · {s.tipover.seismicG}g FS {s.tipover.seismicFS}</span>}
              </div>
              {warn && <div style={{ marginTop: 5, color: '#fbbf24', fontSize: 11, lineHeight: 1.5 }}>{s.warnings!.map((w, i) => <div key={i}>• {w}</div>)}</div>}
              <div style={{ marginTop: 5, fontSize: 10, color: '#6e7681' }}>형상기반 자동 산출 · 강체/단순보 근사 · 비법정(상세 FEA 후속)</div>
            </div>
          );
        })()}
        {scadDetails}
        {err && <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 8 }}>⚠️ {err}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={downloadPackage} disabled={pkgBusy} style={btnPrimary(accent)}>{pkgBusy ? '…' : `📦 ${t.cadPackage}`}</button>
          <button onClick={openGA} disabled={gaBusy} style={btnGhost}>{gaBusy ? '…' : `⤢ ${t.cadOpenGA}`}</button>
          {cad.composeIntent && !stepText && <button onClick={confirmStep} disabled={building} style={btnGhost}>{building ? t.cadBuilding : `⬢ ${t.cadStepDownload}`}</button>}
          {cad.scad && <button onClick={() => download(cad.scad!, 'assembly.scad')} style={btnGhost}>⭳ {t.cadDownload}</button>}
        </div>
        <p style={{ marginTop: 10, fontSize: 10, color: '#6e7681', lineHeight: 1.5 }}>{t.disclaimer}</p>
      </div>
    );
  }

  // ── 단일부품: STEP 3D (승인 후) ──
  if (stepText) {
    return (
      <div style={card}>
        <ChatCadViewer stepText={stepText} accent={accent} onReady={setGeos} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button onClick={() => download(stepText, 'model.step', 'application/step')} style={btnPrimary(accent)}>⭳ {t.cadStepDownload}</button>
          {geos && <button onClick={downloadStl} style={btnGhost}>⭳ {t.cadStlDownload}</button>}
          {cad.scad && <button onClick={() => download(cad.scad!, 'model.scad')} style={btnGhost}>⭳ {t.cadDownload}</button>}
          <button onClick={openGA} disabled={gaBusy} style={btnGhost}>{gaBusy ? '…' : `⤢ ${t.cadOpenGA}`}</button>
          <button onClick={runDfm} disabled={dfmBusy} style={btnGhost}>{dfmBusy ? '…' : t.cadDfm}</button>
        </div>
        {dfmBlock}
        {err && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8 }}>⚠️ {err}</div>}
      </div>
    );
  }

  // ── 단일부품: 체크포인트(치수 사양 검토 → 승인) ──
  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#e6edf3', marginBottom: 10 }}>{t.cadSpecTitle}</div>
      {cad.scad && <MiniScadViewer scad={cad.scad} auto={preview} accent={accent} />}
      {specBlock}
      {drawingSvg && (
        <details open style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 12, color: '#8b949e', cursor: 'pointer', fontWeight: 600 }}>📐 {t.cadDrawing}</summary>
          <div style={{ marginTop: 8, maxWidth: 300 }} dangerouslySetInnerHTML={{ __html: drawingSvg }} />
        </details>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{gateBadge}{tolBadge}</div>
      {scadDetails}
      {err && <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 10 }}>⚠️ {err}</div>}
      <button onClick={confirmStep} disabled={building} style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: building ? 'wait' : 'pointer', background: building ? 'rgba(148,163,184,0.4)' : `linear-gradient(135deg, ${accent}, #6366f1)`, color: '#fff', border: 'none' }}>
        {building ? t.cadBuilding : `${t.cadConfirm} →`}
      </button>
      <p style={{ marginTop: 10, fontSize: 10, color: '#6e7681', lineHeight: 1.5 }}>{t.disclaimer}</p>
    </div>
  );
}

// 전기 결선표 카드 (개산) — from-to 케이블 목록. 3D 하네스는 별도 ECAD(정직 표기).
function WiringCard({ wiring, t, accent, isRtl }: { wiring: CableRow[]; t: (typeof DICT)[Lang]; accent: string; isRtl: boolean }) {
  return (
    <div style={{ width: 'min(92%, 540px)', background: '#0d1117', border: `1px solid ${accent}44`, borderRadius: 14, padding: 14, textAlign: isRtl ? 'right' : 'left', boxShadow: '0 6px 24px rgba(0,0,0,0.3)' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#e6edf3', marginBottom: 8 }}>🔌 {t.cadWiringTitle}</div>
      <div style={{ display: 'grid', gap: 4 }}>
        {wiring.map((w, i) => (
          <div key={i} style={{ fontSize: 12, color: '#cbd5e1', padding: '6px 11px', borderRadius: 8, background: '#0b1020', border: '1px solid rgba(255,255,255,0.07)', fontVariantNumeric: 'tabular-nums' }}>
            <b style={{ color: '#e6edf3' }}>{String(w.from ?? '')}</b> → <b style={{ color: '#e6edf3' }}>{String(w.to ?? '')}</b>
            {w.type ? ` · ${String(w.type)}` : ''}{w.cores ? ` ${Number(w.cores)}C` : ''}{w.mm2 ? `×${Number(w.mm2)}㎟` : ''}{Number(w.lengthM) > 0 ? ` · ${Number(w.lengthM)}m` : ''}
            {w.note ? <span style={{ color: '#8b949e' }}> · {String(w.note)}</span> : null}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: '#6e7681', lineHeight: 1.5 }}>{t.cadWiringNote}</div>
    </div>
  );
}

// appMode(2026-07-16): /nexyfab/ai 전용 앱 창 — 통합 사이드바(채팅 섹션)가 스레드를 담당하므로
// 내부 스레드 사이드바를 숨기고, 마케팅 헤더가 없는 만큼 패딩을 줄인다. 랜딩(/)은 기존 그대로.
export default function ChatHero({ langCode, appMode = false }: { langCode: string; appMode?: boolean }) {
  const lang = toLang(langCode);
  const t = DICT[lang];
  const isRtl = lang === 'ar';
  const [domain, setDomain] = useState<Domain>('mechanical');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attached, setAttached] = useState<Attached | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null); // null=미확인, false=게스트, true=회원
  const [plan, setPlan] = useState<string>('free'); // 스레드당 무료 3회 게이트용(Pro 계열=무제한)
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [threadQ, setThreadQ] = useState('');
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachModeRef = useRef<'drawing' | 'photo'>('drawing'); // §3 역할 분리(2026-07-16)
  const [scaleMm, setScaleMm] = useState(''); // #5 사진/시안 기준 치수(사용자 제공값 — 치수 날조 아님)

  const accent = DOMAIN_ACCENT[domain];
  const started = messages.length > 0;
  const consultHref = `/${langCode}/contact/`;

  // 로그인 여부(게스트 가입 유도 판단용). httpOnly 쿠키라 세션 API로만 확인.
  useEffect(() => {
    let live = true;
    fetch('/api/auth/session').then(async (r) => {
      if (!live) return;
      setAuthed(r.ok);
      if (r.ok) {
        try { const j = await r.json(); setPlan(String(j?.user?.plan ?? 'free')); } catch { /* ignore */ }
      }
    }).catch(() => { if (live) setAuthed(false); });
    return () => { live = false; };
  }, []);

  // 대화 시작 시 = 전용 채팅 화면. 랜딩 하위 마케팅 섹션을 숨겨 "별도 채팅창"처럼.
  useEffect(() => {
    document.body.setAttribute('data-nf-chat', started ? 'on' : 'off');
    if (started) window.scrollTo({ top: 0 });
    return () => { document.body.removeAttribute('data-nf-chat'); };
  }, [started]);

  // 대화 지속성 — 새로고침에도 유지. 이미지 dataUrl·진행중 상태는 저장 제외(용량·정합).
  useEffect(() => {
    const list = loadThreads();
    setThreads(list);
    const tParam = new URLSearchParams(window.location.search).get('t');
    const th = tParam ? list.find((x) => x.id === tParam) : null;
    if (th) {
      setActiveId(th.id);
      setDomain(th.domain);
      setMessages(th.msgs.map((m) => (m.cad?.composing ? { ...m, cad: undefined } : m)).filter((m) => m.content || m.calc || m.cad || m.wiring));
    }
    const onPop = () => {
      const t2 = new URLSearchParams(window.location.search).get('t');
      if (!t2) { setActiveId(null); setMessages([]); }
      else {
        const cur = loadThreads().find((x) => x.id === t2);
        if (cur) { setActiveId(cur.id); setDomain(cur.domain); setMessages(cur.msgs.map((m) => (m.cad?.composing ? { ...m, cad: undefined } : m))); }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // 활성 스레드 동기화 — 부작용(URL·저장·서버)은 업데이터 밖(React 순수성)
  useEffect(() => {
    if (!messages.length) return;
    let id = activeId;
    if (!id) {
      id = newThreadId();
      setActiveId(id);
      try { window.history.pushState({ t: id }, '', '?t=' + id); } catch { /* ignore */ }
    }
    const tid = id;
    setThreads((prev) => {
      const exists = prev.some((x) => x.id === tid);
      if (exists) return prev.map((t2) => (t2.id === tid ? { ...t2, msgs: messages, domain, updated: Date.now(), badge: badgeFrom(messages) } : t2));
      const first = messages.find((m) => m.role === 'user');
      return [{ id: tid, title: titleFrom(first?.content ?? 'Chat'), domain, at: Date.now(), updated: Date.now(), badge: badgeFrom(messages), msgs: messages }, ...prev];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, domain]);

  // 저장·서버 업서트(디바운스) — threads 변경 시 1곳에서 처리.
  // 로컬 저장도 디바운스: 스트리밍 중 토큰마다 전체 직렬화(50스레드×60msg)하면 잰크.
  const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!threads.length) return;
    if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    localSaveTimer.current = setTimeout(() => saveThreadsLocal(threads), 400);
    if (authed && activeId) {
      const th = threads.find((x) => x.id === activeId);
      if (th && th.msgs.length) {
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => {
          void fetch('/api/nexyfab/chat-threads/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ thread: { ...th, msgs: th.msgs.slice(-60) } }) }).catch(() => {});
        }, 1500);
      }
    }
  }, [threads, authed, activeId]);

  // 스레드 제목 AI 요약 — 첫 문답 완료 후 스레드당 1회. 실패하면 절단 제목 그대로.
  const titledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (loading || !activeId || titledRef.current.has(activeId)) return;
    const th = threads.find((x) => x.id === activeId);
    if (!th || th.aiTitled) return;
    const firstUser = th.msgs.find((m) => m.role === 'user');
    const firstAsst = th.msgs.find((m) => m.role === 'assistant' && m.content && !m.content.startsWith('⚠️'));
    if (!firstUser || !firstAsst) return;
    titledRef.current.add(activeId);
    const tid = activeId;
    void fetch('/api/eng-chat/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'title', domain, message: firstUser.content.slice(0, 600) + '\n---\n' + firstAsst.content.slice(0, 400) }),
    }).then((r) => r.json()).then((j: { title?: string | null }) => {
      const tt = (j?.title ?? '').trim();
      if (tt) setThreads((prev) => prev.map((x) => (x.id === tid ? { ...x, title: tt, aiTitled: true } : x)));
    }).catch(() => { /* 폴백: 절단 제목 유지 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, activeId, threads]);


  // 로그인 시: 서버 스레드 로드 + 게스트 스레드 1회 이관
  useEffect(() => {
    if (!authed) return;
    (async () => {
      try {
        const local = loadThreads();
        if (local.length && !localStorage.getItem('nf_chat_migrated_v1')) {
          await fetch('/api/nexyfab/chat-threads/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ migrate: local.map((t2) => ({ ...t2, msgs: t2.msgs.slice(-60) })) }) }).catch(() => {});
          localStorage.setItem('nf_chat_migrated_v1', '1');
        }
        const r = await fetch('/api/nexyfab/chat-threads/');
        if (r.ok) {
          const j = (await r.json()) as { ok: boolean; threads?: Thread[] };
          if (j.ok && j.threads?.length) {
            setThreads((prev) => {
              const ids = new Set(prev.map((x) => x.id));
              const merged = [...prev, ...(j.threads ?? []).filter((x) => !ids.has(x.id))].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
              saveThreadsLocal(merged);
              return merged;
            });
          }
        }
      } catch { /* offline — local only */ }
    })();
  }, [authed]);

  const openThread = (id: string) => {
    const th = threads.find((x) => x.id === id);
    if (!th) return;
    setActiveId(id); setDomain(th.domain); setMessages(th.msgs.map((m) => (m.cad?.composing ? { ...m, cad: undefined } : m))); setSideOpen(false);
    try { window.history.pushState({ t: id }, '', '?t=' + id); } catch { /* ignore */ }
  };
  const newThread = () => {
    setActiveId(null); setMessages([]); setInput(''); setSideOpen(false);
    try { window.history.pushState({}, '', window.location.pathname); } catch { /* ignore */ }
  };
  const deleteThread = (id: string) => {
    setThreads((prev) => prev.filter((x) => x.id !== id));
    if (authed) void fetch('/api/nexyfab/chat-threads/?id=' + id, { method: 'DELETE' }).catch(() => {});
    if (activeId === id) newThread();
  };
  const togglePin = (id: string) => setThreads((prev) => prev.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)));

  // 계산 카드 액션 — 재실행(동일 입력·새 카드)·간이 인쇄(원본 JSON 전사)
  const rerunCalc = async (calcId: string, calcInput: Record<string, unknown>) => {
    setMessages(m => [...m, { role: 'assistant', content: '↻ ' + calcId }]);
    try {
      const calc = await runDemoCalc(calcId, calcInput, lang);
      setMessages(m => {
        const copy = m.slice();
        for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], calc, calcId, calcInput }; break; } }
        return copy;
      });
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: '⚠️ ' + (e instanceof Error ? e.message : t.error) }]);
    }
  };
  const printCalc = (m: Msg) => {
    if (!m.calc) return;
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>NexyFab 검토 카드</title><style>body{font-family:system-ui;font-size:12px;padding:24px}pre{background:#f1f5f9;padding:12px;border-radius:8px;white-space:pre-wrap;font-size:11px}</style></head><body><h2>NexyFab 검토 결과(참고자료·비법정)</h2>' + (m.calcId ? '<p>계산기: <b>' + esc(m.calcId) + '</b></p><h3>입력</h3><pre>' + esc(JSON.stringify(m.calcInput ?? {}, null, 1)) + '</pre>' : '') + '<h3>결과(엔진 원본)</h3><pre>' + esc(JSON.stringify(m.calc, null, 1)) + '</pre><p style="color:#64748b">정식 계산서 양식은 /design 계산기 스튜디오에서 — 본 출력은 대화 카드 전사.</p></body></html>');
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  // 마지막 assistant 메시지 content 를 갱신 (스트리밍 토큰 누적).
  const updateLastAssistant = (content: string) => setMessages(m => {
    const copy = m.slice();
    for (let i = copy.length - 1; i >= 0; i--) {
      if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], content }; break; }
    }
    return copy;
  });

  const abortRef = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // appMode 분할 화면(사용자 제안 2026-07-16): 넓은 화면 + CAD 결과가 있으면
  // 채팅은 좌측, 우측에 상시 3D 패널(Genspark/Canvas 문법). 좁은 화면은 인라인 카드 유지.
  const [wideScreen, setWideScreen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(appMode ? '(min-width: 1380px)' : '(min-width: 1100px)'); // appMode=사이드바 220px 감안(1100~1380 잘림 방지)
    const on = () => setWideScreen(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [appMode]);
  const latestCad = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const c = messages[i].cad;
      if (c && !c.error && c.scad) return c;
    }
    return null;
  }, [messages]);
  const splitMode = appMode && wideScreen && started && !!latestCad;
  const stopGen = () => { try { abortRef.current?.abort(); } catch { /* ignore */ } };

  const send = useCallback(async (override?: string, historyOverride?: Msg[]) => {
    const text = (override ?? input).trim();
    if (!text || loading) return;
    if (threadLimitReached) return; // 스레드당 무료 3회(클라 게이트 — UI 배너와 동일 조건)
    setError('');
    const history = historyOverride ?? messages.slice(-8);
    setMessages(m => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const autoscroll = () => requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
    try {
      if (ACTION_DOMAINS.includes(domain)) {
        setStage(t.stageAnalyze);
        // ── 실행형: 의도추출 → (calc면) 라이브 엔진 실행 → 결과카드 ──
        const res = await fetch('/api/eng-chat/action/', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: text, domain, history,
            // 증분 수정(2026-07-16): 직전 설계 스펙을 동봉 — "방금 그거 높이만 바꿔"가 동작
            lastSpec: (() => { const lc = [...messages].reverse().find((mm) => mm.cad && !mm.cad.error); const sp = lc?.cad?.spec; return Array.isArray(sp) ? sp.join('\n') : typeof sp === 'string' ? sp : undefined; })(),
          }),
          signal: ac.signal,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j?.error || t.error);
          setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${j?.error || t.error}` }]);
        } else if (j.type === 'calc' && j.id) {
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply || t.calcRunning) }]);
          autoscroll();
          try {
            setStage(t.stageCalc);
            const calcInput = (j.input ?? {}) as Record<string, unknown>;
            const calc = await runDemoCalc(String(j.id), calcInput, lang);
            setMessages(m => {
              const copy = m.slice();
              for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], calc, calcId: String(j.id), calcInput }; break; } }
              return copy;
            });
          } catch (e) {
            const em = e instanceof Error ? e.message : t.error;
            setMessages(m => {
              const copy = m.slice();
              for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], calc: { verdict: 'ERROR', title: String(j.id), checks: [], refs: [], error: em } }; break; } }
              return copy;
            });
          }
        } else if ((j.type === 'scad' || j.type === 'assembly') && j.prompt) {
          setStage(t.stageCad);
          // ── 기계: 단일부품(compose→STEP) 또는 멀티바디(assemble→GA) ──
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply || t.cadGenerating), cad: { composing: true } }]);
          autoscroll();
          const setCad = (cad: CadResult) => setMessages(m => {
            const copy = m.slice();
            for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], cad }; break; } }
            return copy;
          });
          try {
            setCad(j.type === 'assembly'
              ? await runAssemblePipeline(String(j.prompt), ac.signal)
              : await runComposePipeline(String(j.prompt), lang, ac.signal));
          } catch (e) {
            if ((e as Error)?.name === 'AbortError') {
              // 사용자가 "중단"을 눌렀다 — 진행 카드를 에러로 덮지 않고 그대로 둔다.
            } else {
              setCad({ error: e instanceof Error ? e.message : t.error });
            }
          }
        } else if (j.type === 'wiring' && Array.isArray(j.cables)) {
          // ── 전기 결선표(개산) — from-to 케이블 목록 ──
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply || ''), wiring: j.cables as CableRow[] }]);
        } else {
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply || t.error) }]);
        }
      } else {
      // ── 대화형(기계·인테리어): 스트리밍. 트레일링 슬래시 필수(308 회피) ──
      setStage(t.stageAnalyze);
      const res = await fetch('/api/eng-chat/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, domain, history, stream: true }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j?.error || t.error;
        setError(msg);
        setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${msg}` }]);
      } else if (res.headers.get('x-stream') === '1' && res.body) {
        setStage(null); // 첫 바이트부터는 본문이 곧 진행 표시
        // 스트리밍: 빈 assistant 메시지에 토큰을 누적
        setMessages(m => [...m, { role: 'assistant', content: '' }]);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          updateLastAssistant(acc);
          autoscroll();
        }
        if (!acc.trim()) { setError(t.error); updateLastAssistant(`⚠️ ${t.error}`); }
      } else {
        // 비스트리밍 JSON 폴백
        const j = await res.json().catch(() => ({}));
        if (!j?.reply) {
          setError(j?.error || t.error);
          setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${j?.error || t.error}` }]);
        } else {
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply) }]);
        }
      }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // 사용자 중단 — 이미 흘러나온 부분 응답은 그대로 둔다
      } else {
        setError(t.error);
        setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${t.error}` }]);
      }
    } finally {
      setLoading(false);
      setStage(null);
      abortRef.current = null;
      autoscroll();
    }
  }, [input, loading, messages, domain, t, plan, lang]);

  // 마지막 user 발화 이후를 걷어내고 재전송 — 히스토리에서 직전 답을 제외해 같은 답 재생산을 피한다
  const regen = () => {
    if (loading || threadLimitReached) return; // 한도 도달 시 regen은 삭제만 하고 재생성 안 됨(감사 HIGH) — 선차단
    let ui = -1;
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { ui = i; break; } }
    if (ui < 0) return;
    if (messages[ui].image || !messages[ui].content.trim()) return; // 이미지 턴은 재생성 미지원(삭제 손실 방지)
    const text = messages[ui].content;
    const hist = messages.slice(0, ui).slice(-8);
    setMessages(messages.slice(0, ui));
    void send(text, hist);
  };

  /**
   * 입력 A(이미지) — 도면/스케치를 첨부해 Vision 판독 → 3D 체크포인트로 잇는다.
   *
   * ★260803 — **파일선택·붙여넣기·드래그가 같은 함수를 지난다.**
   * 실무에서 도면은 대개 **캡처해서 붙여넣기**다. 파일로 저장했다가 버튼을 눌러 고르는
   * 흐름은 한 단계가 더 많고, 그 한 단계에서 사람이 떨어진다.
   * ⚠ 허용 타입·크기는 `@/lib/drawingInput` 단일 소스다 — 종전에는 같은 목록이
   *   **여섯 곳**에 흩어져 있었다(라우트 3 · accept 속성 2 · 클라 정규식 1).
   */
  const acceptFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    const v = isAcceptedRaster(f);
    if (!v.ok) {
      setError(v.reason === 'type' ? 'PNG·JPG·WebP 이미지만 지원합니다.' : '이미지가 너무 큽니다(6MB 이하).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setAttached({ dataUrl, base64: dataUrl.replace(/^data:[^,]+,/, ''), mime: f.type, name: f.name });
      setError('');
    };
    reader.readAsDataURL(f);
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택 허용
    acceptFile(f);
  };

  /** 붙여넣기(Ctrl+V) — 스크린샷은 `clipboardData.items` 로 온다. */
  const onPasteImage = useCallback((e: React.ClipboardEvent) => {
    const f = imageFromTransfer(e.clipboardData);
    if (!f) return; // 이미지가 아니면 평소대로 텍스트 붙여넣기
    e.preventDefault();
    acceptFile(f);
  }, [acceptFile]);

  /** 드래그&드롭 — 파일 탐색기에서 온 것은 `dataTransfer.files` 다. */
  const [dragOver, setDragOver] = useState(false);
  const onDropImage = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(imageFromTransfer(e.dataTransfer));
  }, [acceptFile]);

  const sendImage = useCallback(async () => {
    if (!attached || loading) return;
    setError('');
    const att = attached;
    setMessages(m => [...m, { role: 'user', content: input.trim(), image: att.dataUrl }, { role: 'assistant', content: t.imgReading }]);
    setInput(''); setAttached(null); setLoading(true);
    const autoscroll = () => requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
    autoscroll();
    const setLast = (patch: Partial<Msg>) => setMessages(m => {
      const copy = m.slice();
      for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], ...patch }; break; } }
      return copy;
    });
    try {
      if (attachModeRef.current === 'photo') {
        // 사진 = 형태 힌트만(§3): 유형 분류만 받고 치수는 버린다 → 핵심 치수 되묻기
        const rp = await fetch('/api/nexyfab/drawing/extract-preset/', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ imageBase64: att.base64, mimeType: att.mime, domain: STUDIO_DOMAIN[domain] ?? 'mech' }),
        });
        const jp = (await rp.json()) as { ok?: boolean; labelKo?: string; labelEn?: string; templateId?: string; error?: string };
        const label = jp.ok ? ((lang === 'kr' ? jp.labelKo : jp.labelEn) ?? jp.templateId ?? '?') : '?';
        setLast({ content: jp.ok ? t.photoHint.replace('{label}', String(label)) : '⚠️ ' + (jp.error ?? t.error) });
        // #5 기준 치수(사용자 제공값): 다음 생성 문장에 프리필 — 스케일이 실제 생성 텍스트에 실리게(투명)
        if (jp.ok && scaleMm && parseFloat(scaleMm) > 0) { setInput(`기준 최장변 ${parseFloat(scaleMm)}mm 기준 — `); setScaleMm(''); }
        return;
      }
      const { cad, recognized } = await runExtractPipeline(att, lang);
      // 성공/실패 모두 인식 결과를 노출(무엇을 읽었는지) — 실패 시 이유는 카드로.
      const line = recognized
        ? `${t.imgRecognized}: **${recognized.label}** · ${t.imgConfidence} ${Math.round(recognized.confidence * 100)}%${uncertaintyLine(recognized, t)}`
        : (cad.error ? '' : t.cadSpecTitle);
      setLast({ content: line, cad });
    } catch (e) {
      setLast({ content: '', cad: { error: e instanceof Error ? e.message : t.error } });
    } finally {
      setLoading(false); autoscroll();
    }
  }, [attached, input, loading, t, domain, lang, scaleMm]);

  // ✨ 시안 이미지 생성 — text→시안→도안→3D · 사진→흰배경 정리→도안→3D (2026-07-18)
  // 입력 커스텀은 서버(buildGenImagePrompt)가 담당 — 클라는 원문+첨부만 보낸다.
  const sendGenImage = useCallback(async () => {
    if (loading || threadLimitReached) return;
    const text = input.trim();
    const att = attached;
    if (!text && !att) return;
    setError('');
    setMessages(m => [...m, { role: 'user', content: text || '✨', ...(att ? { image: att.dataUrl } : {}) }, { role: 'assistant', content: t.genImgMaking }]);
    setInput(''); setAttached(null); setLoading(true);
    const autoscroll = () => requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
    autoscroll();
    const setLast = (patch: Partial<Msg>) => setMessages(m => {
      const copy = m.slice();
      for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], ...patch }; break; } }
      return copy;
    });
    try {
      const r = await fetch('/api/nexyfab/drawing/genimage/', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: text, imageBase64: att?.base64, mimeType: att?.mime, domain: STUDIO_DOMAIN[domain] ?? 'mech' }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; imageBase64?: string; mime?: string; quota?: { remaining?: number; limit?: number }; code?: string; limit?: number; error?: string };
      if (!r.ok || !j.ok || !j.imageBase64) {
        if (j.code === 'IMAGE_QUOTA') setLast({ content: t.genImgLimit.replace('{n}', String(j.limit ?? '')) });
        else setLast({ content: '⚠️ ' + (j.error ?? t.error) });
        return;
      }
      const dataUrl = `data:${j.mime ?? 'image/png'};base64,${j.imageBase64}`;
      const remain = typeof j.quota?.remaining === 'number' ? String(j.quota.remaining) : '?';
      setLast({ content: t.genImgNote.replace('{n}', remain), genImage: dataUrl, genSrc: text, genFromImage: !!att });
    } catch (e) {
      setLast({ content: '⚠️ ' + (e instanceof Error ? e.message : t.error) });
    } finally {
      setLoading(false); autoscroll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached, input, loading, t, domain]);

  // 시안 카드 → 도안→3D 진행: 사진 유래=정리된 시안을 도면 판독(extract, 게이트가 신뢰도 검증),
  // 텍스트 유래=원문으로 compose(치수는 텍스트가 근거 — 시안 이미지에서 치수를 읽지 않는다, 날조 금지).
  const proceedFromGen = useCallback(async (m: Msg) => {
    if (loading || !m.genImage) return;
    setMessages(prev => [...prev, { role: 'assistant', content: m.genFromImage ? t.imgReading : t.cadGenerating }]);
    setLoading(true);
    const autoscroll = () => requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
    autoscroll();
    const setLast = (patch: Partial<Msg>) => setMessages(prev => {
      const copy = prev.slice();
      for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], ...patch }; break; } }
      return copy;
    });
    try {
      if (m.genFromImage) {
        const base64 = m.genImage.replace(/^data:[^,]+,/, '');
        const { cad, recognized } = await runExtractPipeline({ dataUrl: m.genImage, base64, mime: 'image/png', name: 'concept.png' }, lang);
        const line = recognized
          ? `${t.imgRecognized}: **${recognized.label}** · ${t.imgConfidence} ${Math.round(recognized.confidence * 100)}%${uncertaintyLine(recognized, t)}`
          : (cad.error ? '' : t.cadSpecTitle);
        setLast({ content: line, cad });
      } else {
        const cad = await runComposePipeline(m.genSrc || '', lang);
        setLast({ content: cad.error ? '' : t.cadSpecTitle, cad });
      }
    } catch (e) {
      setLast({ content: '', cad: { error: e instanceof Error ? e.message : t.error } });
    } finally {
      setLoading(false); autoscroll();
    }

  }, [loading, t, lang]);

  // 🎯 P1 픽킹 편집(260719): 우측 3D에서 부품 클릭=선택 → 다음 메시지는 그 부품만 수정
  // (edit-part — AI=패치 이해만, 적용·게이트=서버 결정론. 대상 외 부품 불변은 코드 보장)
  const [pickedPart, setPickedPart] = useState<string | null>(null);
  const [pickedNormal, setPickedNormal] = useState<number[] | null>(null); // P2 면 컨텍스트
  // #1 LOD: draft(1차 골격)가 있는 카드면 골격 먼저 — 🧩 버튼으로 2차 전환
  const [lodFull, setLodFull] = useState(true);
  useEffect(() => { setLodFull(!latestCad?.scadDraft); }, [latestCad]);
  const dragUndoRef = useRef<CadResult[]>([]); // #1 푸시풀 언두 스택(≤5 — in-place 갱신 복원용)
  const [dragUndoN, setDragUndoN] = useState(0);
  const undoFaceDrag = useCallback(() => {
    const prev = dragUndoRef.current.pop();
    setDragUndoN(dragUndoRef.current.length);
    if (!prev) return;
    setMessages((m) => {
      const copy = m.slice();
      for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].cad?.assembly) { copy[i] = { ...copy[i], cad: prev }; break; } }
      return copy;
    });
  }, []);
  // P2 면 푸시풀: 뷰어 드래그 → 결정론 face-drag → 최신 CAD 카드 in-place 갱신(대화 오염 없음)
  const applyFaceDrag = useCallback(async (partId: string, normal: number[], deltaMm: number) => {
    const asmCad = latestCad;
    if (!asmCad?.assembly || loading) return;
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/nexyfab/drawing/face-drag/', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assembly: asmCad.assembly, partId, normal, deltaMm }),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok || !j.ok) { setError(String((j as { error?: string }).error ?? 'face-drag')); return; }
      if (asmCad) { dragUndoRef.current.push(asmCad); if (dragUndoRef.current.length > 5) dragUndoRef.current.shift(); setDragUndoN(dragUndoRef.current.length); }
      const cad = cadFromEditResp(j);
      setMessages((m) => {
        const copy = m.slice();
        for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].cad?.assembly) { copy[i] = { ...copy[i], cad }; break; } }
        return copy;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'face-drag');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  const sendPartEdit = useCallback(async () => {
    const text = input.trim();
    const asmCad = latestCad;
    if (!text || !pickedPart || !asmCad?.assembly || loading) return;
    setError('');
    setMessages(m => [...m, { role: 'user', content: `🎯 ${pickedPart}: ${text}` }, { role: 'assistant', content: t.thinking }]);
    setInput(''); setLoading(true);
    const autoscroll = () => requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
    autoscroll();
    const setLast = (patch: Partial<Msg>) => setMessages(m => {
      const copy = m.slice();
      for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], ...patch }; break; } }
      return copy;
    });
    try {
      const r = await fetch('/api/nexyfab/drawing/edit-part/', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assembly: asmCad.assembly, partId: pickedPart, instruction: text, ...(pickedNormal ? { face: { normal: pickedNormal } } : {}) }),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok || !j.ok) {
        const ge = Array.isArray(j.gateErrors) ? ` (${(j.gateErrors as string[]).slice(0, 2).join('; ')})` : '';
        setLast({ content: '⚠️ ' + String((j as { error?: string }).error ?? t.error) + ge });
        return;
      }
      setLast({ content: t.pickEdited.replace('{id}', pickedPart) + (j.note ? ` — ${String(j.note)}` : ''), cad: cadFromEditResp(j) });
    } catch (e) {
      setLast({ content: '⚠️ ' + (e instanceof Error ? e.message : t.error) });
    } finally {
      setLoading(false); autoscroll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, pickedPart, pickedNormal, loading, t]);
  // 선택 부품이 최신 어셈블리에 없으면 자동 해제(스레드 전환·재생성 대비)
  useEffect(() => {
    if (pickedPart && !latestCad?.partsAabb?.some((p) => p.id === pickedPart)) { setPickedPart(null); setPickedNormal(null); }
  }, [latestCad, pickedPart]);

  const FREE_TURNS_PER_THREAD = 3; // 비회원·무료회원 공통(2026-07-16) — Pro 계열 무제한
  const isPaidPlan = plan === 'pro' || plan === 'team' || plan === 'enterprise';
  const userTurns = useMemo(() => messages.filter((m) => m.role === 'user').length, [messages]);
  const threadLimitReached = !isPaidPlan && userTurns >= FREE_TURNS_PER_THREAD;
  const submit = () => { if (threadLimitReached) return; if (attached) void sendImage(); else if (pickedPart && latestCad?.assembly) void sendPartEdit(); else void send(); };
  const canSend = !threadLimitReached && (attached ? !loading : (!loading && !!input.trim()));

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <section id="nf-chat" dir={isRtl ? 'rtl' : 'ltr'} style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1b3e 45%, #0b1a38 100%)',
      minHeight: '100dvh', display: 'flex', alignItems: started ? 'stretch' : 'center', justifyContent: 'center',
      padding: appMode
        ? (started ? '20px 16px 16px' : '48px 20px 48px')
        : (started ? '84px 16px 20px' : '104px 20px 64px'),
      transition: 'padding .25s',
      ...(appMode ? { flex: 1, minWidth: 0 } : {}),
    }}>
      {/* 채팅 활성 시 랜딩 하위 섹션·푸터 숨김 → 전용 채팅 화면 */}
      <style>{`body[data-nf-chat="on"] #nf-chat ~ section, body[data-nf-chat="on"] #nf-chat ~ footer { display: none !important; }`}</style>
      {!appMode && <style>{`
        .nf-side { position: fixed; left: 0; top: 64px; bottom: 0; width: 264px; z-index: 40; background: rgba(10,15,30,0.96); border-right: 1px solid rgba(148,163,184,0.15); backdrop-filter: blur(8px); display: flex; flex-direction: column; padding: 12px 10px; transform: translateX(-100%); transition: transform .2s; }
        .nf-side[data-open="1"] { transform: translateX(0); }
        @media (min-width: 1100px) { body[data-nf-chat="on"] .nf-side { transform: translateX(0); } body[data-nf-chat="on"] .nf-chat-main { margin-left: 264px; } .nf-side-toggle { display: none !important; } }
        .nf-th { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px; cursor: pointer; color: #cbd5e1; font-size: 13px; text-align: left; width: 100%; background: transparent; border: none; }
        .nf-th:hover { background: rgba(59,130,246,0.12); }
        .nf-th[data-active="1"] { background: rgba(59,130,246,0.2); color: #fff; }
        .nf-th .del, .nf-th .pin { opacity: 0; font-size: 11px; background: none; border: none; color: #94a3b8; cursor: pointer; }
        .nf-th:hover .del, .nf-th:hover .pin { opacity: 1; }
      `}</style>}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.06, backgroundImage: 'linear-gradient(rgba(59,130,246,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.5) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      <div style={{ position: 'absolute', top: '12%', left: '50%', transform: 'translateX(-50%)', width: 640, height: 640, background: `radial-gradient(circle, ${accent}22 0%, transparent 70%)`, borderRadius: '50%', filter: 'blur(90px)', transition: 'background .4s' }} />

      {/* 좌측 스레드 사이드바 (챗 모드) — 게스트=이 기기 저장·회원=서버 동기화.
          appMode에선 통합 사이드바의 채팅 섹션이 이 역할이라 렌더하지 않음 */}
      {started && !appMode && (
        <>
          <button type="button" className="nf-side-toggle" onClick={() => setSideOpen(o => !o)} aria-label="threads"
            style={{ position: 'fixed', left: 12, top: 74, zIndex: 41, background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(148,163,184,0.3)', color: '#cbd5e1', borderRadius: 8, padding: '6px 9px', cursor: 'pointer', fontSize: 14 }}>☰</button>
          {sideOpen && <div onClick={() => setSideOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 39, background: 'rgba(0,0,0,0.4)' }} />}
          <aside className="nf-side" data-open={sideOpen ? '1' : '0'} dir={isRtl ? 'rtl' : 'ltr'}>
            <button type="button" className="nf-th" style={{ border: '1px dashed rgba(148,163,184,0.35)', justifyContent: 'center', fontWeight: 700 }} onClick={newThread}>＋ {t.newChat}</button>
            <input value={threadQ} onChange={(e) => setThreadQ(e.target.value)} placeholder="🔍"
              style={{ margin: '8px 0', background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {threads
                .filter((th) => !threadQ || th.title.toLowerCase().includes(threadQ.toLowerCase()))
                .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.updated - a.updated))
                .map((th) => (
                  <div key={th.id} className="nf-th" data-active={th.id === activeId ? '1' : '0'} onClick={() => openThread(th.id)} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') openThread(th.id); }}>
                    <span aria-hidden style={{ fontSize: 12, flex: '0 0 16px', textAlign: 'center' }}>{DOMAIN_EMOJI_TH[th.domain] ?? '💬'}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{th.pinned ? '📌 ' : ''}{th.title}</span>
                    {th.badge && <span style={{ fontSize: 9, fontWeight: 800, color: th.badge === 'PASS' ? '#4ade80' : th.badge === 'FAIL' ? '#f87171' : '#94a3b8' }}>{th.badge === 'PASS' ? '✓' : th.badge === 'FAIL' ? '✗' : 'ⓘ'}</span>}
                    <button type="button" className="pin" onClick={(e) => { e.stopPropagation(); togglePin(th.id); }} aria-label="pin">📌</button>
                    <button type="button" className="del" onClick={(e) => { e.stopPropagation(); deleteThread(th.id); }} aria-label="delete">✕</button>
                  </div>
                ))}
            </div>
            {authed === false && (
              <div style={{ fontSize: 10.5, color: '#94a3b8', padding: '8px 6px', borderTop: '1px solid rgba(148,163,184,0.15)' }}>
                {threads.length >= 10
                  ? <a href="/register" style={{ color: '#60a5fa' }}>{t.guestLimit}</a>
                  : (t.guestNote)}
              </div>
            )}
          </aside>
        </>
      )}

      <div className="nf-chat-main" style={{
        position: 'relative', zIndex: 1, width: '100%', maxWidth: splitMode ? 640 : 780, margin: splitMode ? '0' : '0 auto', textAlign: 'center', transition: 'margin .2s',
        ...(started ? { display: 'flex', flexDirection: 'column', height: appMode ? 'calc(100dvh - 36px)' : 'calc(100dvh - 104px)' } : {}),
      }}>
        {!started && (
          <>
            {/* 브랜드 락업 — N 모노그램 + 워드마크 */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
              <span style={{
                width: 34, height: 34, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 4px 16px rgba(59,130,246,0.4)',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false"><path d="M5 19V5l14 14V5" /></svg>
              </span>
              <span style={{ fontSize: 19, fontWeight: 800, color: '#f0f4ff', letterSpacing: '-0.02em' }}>NexyFab</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(28px, 4.5vw, 46px)', fontWeight: 900, lineHeight: 1.18,
              color: '#f0f4ff', letterSpacing: '-0.03em', marginBottom: 14, wordBreak: 'keep-all',
            }}>{t.title}</h1>
            <p style={{ fontSize: 'clamp(14px, 2vw, 17px)', lineHeight: 1.7, color: 'rgba(203,213,225,0.82)', maxWidth: 600, margin: '0 auto 18px', wordBreak: 'keep-all' }}>{t.sub}</p>

            {/* 신뢰 한 줄 — 실측 가능한 차별점만 (수치 과장 없음) */}
            <div dir={isRtl ? 'rtl' : 'ltr'} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 30, padding: '5px 14px',
              borderRadius: 999, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.22)',
              fontSize: 12, fontWeight: 500, color: 'rgba(147,197,253,0.92)', maxWidth: '92%', lineHeight: 1.5,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" style={{ flexShrink: 0 }}><path d="M12 2l7 3v6c0 4.5-3 8.2-7 9.5-4-1.3-7-5-7-9.5V5z" /><path d="M9 12l2 2 4-4" /></svg>
              <span style={{ wordBreak: 'keep-all' }}>{t.trust}</span>
            </div>
          </>
        )}

        {/* 대화 패널 */}
        {started && (
          <div ref={scrollRef} style={{
            textAlign: isRtl ? 'right' : 'left', flex: 1, minHeight: 0, overflowY: 'auto',
            marginBottom: 14, padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            {messages.map((m, i) => {
              const alignEnd = m.role === 'user' ? !isRtl : isRtl;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: alignEnd ? 'flex-end' : 'flex-start', gap: 8 }}>
                  {m.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt="" style={{ maxWidth: 220, maxHeight: 220, objectFit: 'contain', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: '#0b1020' }} />
                  )}
                  {m.genImage && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: alignEnd ? 'flex-end' : 'flex-start' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.genImage} alt="" style={{ maxWidth: 300, maxHeight: 300, objectFit: 'contain', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: '#fff' }} />
                      <button onClick={() => { void proceedFromGen(m); }} disabled={loading} style={{
                        padding: '7px 14px', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
                        border: `1px solid ${accent}66`, background: `${accent}22`, color: '#e2e8f0', fontSize: 12.5, fontWeight: 700,
                      }}>▶ {t.genImgUse}</button>
                    </div>
                  )}
                  {m.content && (
                    <div style={{
                      maxWidth: '86%', padding: '11px 15px', borderRadius: 14, fontSize: 14, lineHeight: 1.7,
                      whiteSpace: m.role === 'user' ? 'pre-wrap' : 'normal', wordBreak: 'break-word',
                      background: m.role === 'user' ? accent : 'rgba(255,255,255,0.07)',
                      color: m.role === 'user' ? '#fff' : '#e2e8f0',
                      border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                    }}>{m.role === 'assistant' ? <Md text={m.content} /> : m.content}</div>
                  )}
                  {m.role === 'assistant' && m.content && !m.content.startsWith('⚠️') && !(loading && i === messages.length - 1) && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { void navigator.clipboard?.writeText(m.content).then(() => { setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 1200); }).catch(() => {}); }} style={GHOST_BTN}>{copiedIdx === i ? t.copied : t.copyMsg}</button>
                      {!loading && i === messages.length - 1 && !(messages[i - 1]?.image) && (
                        <button onClick={regen} style={GHOST_BTN}>↻ {t.regen}</button>
                      )}
                    </div>
                  )}
                  {m.calc && <CalcCard calc={m.calc} t={t} isRtl={isRtl} consultHref={consultHref}
                    onRerun={m.calcId ? () => { void rerunCalc(m.calcId!, m.calcInput ?? {}); } : undefined}
                    onPrint={() => printCalc(m)} />}
                  {m.cad && (
                    <>
                      <CadCard cad={m.cad} t={t} accent={accent} isRtl={isRtl} preview={i === messages.length - 1 && !splitMode} />
                      {!m.cad.error && (
                        <a href={'/' + langCode + '/nexyfab/design/?domain=' + (STUDIO_DOMAIN[domain] ?? 'mech')}
                          onClick={() => { try { sessionStorage.setItem('nf-chat-handoff', JSON.stringify({ spec: m.cad?.spec ?? m.content ?? '', at: Date.now(), type: m.cad?.isAssembly ? 'assembly' : 'part' })); } catch { /* ignore */ } }}
                          style={{ display: 'inline-block', marginTop: 6, fontSize: 11.5, color: '#93c5fd', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 7, padding: '4px 10px', textDecoration: 'none' }}>
                          🛠 Studio →
                        </a>
                      )}
                    </>
                  )}
                  {m.wiring && m.wiring.length > 0 && <WiringCard wiring={m.wiring} t={t} accent={accent} isRtl={isRtl} />}
                </div>
              );
            })}
            {loading && (stage !== null || !(messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].content.length > 0)) && (
              <div style={{ display: 'flex', justifyContent: isRtl ? 'flex-end' : 'flex-start' }}>
                <div style={{ padding: '11px 15px', borderRadius: 14, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#93c5fd', fontSize: 13 }}>{stage ?? t.thinking}</div>
              </div>
            )}
            {!loading && messages.length > 0 && (() => {
              const last = messages[messages.length - 1];
              if (last.role !== 'assistant' || !last.content || last.content.startsWith('⚠️')) return null;
              const chips = last.calc && !last.calc.error ? t.fuCalc : last.cad && !last.cad.error ? (((last.cad.interferences?.length ?? 0) > 0 ? [t.fuFixClash] : []).concat(t.fuCad)) : t.fuText;
              return (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: isRtl ? 'flex-end' : 'flex-start' }}>
                  {chips.map((c, ci) => (
                    <button key={ci} onClick={() => send(c)} style={{
                      padding: '6px 13px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                      border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: 'rgba(203,213,225,0.9)',
                    }}>{c}</button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* 게스트 가입 유도 — 결과가 나왔고 비로그인일 때만(값은 막지 않고 저장을 권유) */}
        {started && authed === false && messages.some(m => (m.cad && !m.cad.error) || (m.calc && !m.calc.error) || (m.wiring && m.wiring.length > 0)) && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 12px', padding: '9px 14px', borderRadius: 12, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}>
            <span style={{ fontSize: 12.5, color: '#cbd5e1' }}>{t.saveSignup}</span>
            <a href="/register" style={{ fontSize: 12.5, fontWeight: 800, color: '#fff', background: accent, padding: '6px 14px', borderRadius: 9, textDecoration: 'none', whiteSpace: 'nowrap' }}>{t.signup} →</a>
          </div>
        )}

        {/* 스레드당 무료 3회 한도 배너 — 새 대화 or Pro */}
        {threadLimitReached && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 12px', padding: '10px 14px', borderRadius: 12, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)' }}>
            <span style={{ fontSize: 12.5, color: '#fcd34d' }}>{t.threadLimit.replace('{n}', String(FREE_TURNS_PER_THREAD))}</span>
            <button type="button" onClick={() => { newThread(); }} style={{ fontSize: 12.5, fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', padding: '6px 14px', borderRadius: 9, cursor: 'pointer' }}>＋ {t.newChat}</button>
            <a href={`/${langCode}/pricing/`} style={{ fontSize: 12.5, fontWeight: 800, color: '#fff', background: accent, padding: '6px 14px', borderRadius: 9, textDecoration: 'none', whiteSpace: 'nowrap' }}>{t.proCta} →</a>
          </div>
        )}

        {/* 입력 카드 */}
        <div style={{
          background: 'rgba(255,255,255,0.06)', border: `1px solid ${accent}55`,
          borderRadius: 18, padding: 12, boxShadow: `0 12px 48px rgba(0,0,0,0.4)`,
          backdropFilter: 'blur(8px)', transition: 'border-color .3s', flexShrink: 0,
        }}>
          <input ref={fileRef} type="file" accept={ACCEPT_RASTER} onChange={onPickFile} style={{ display: 'none' }} />

          {/* 첨부 도면 미리보기 */}
          {attached && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px 8px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attached.dataUrl} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)' }} />
              <span style={{ fontSize: 12, color: '#cbd5e1', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attached.name}</span>
              <input value={scaleMm} onChange={(e) => setScaleMm(e.target.value)} placeholder="기준 최장변(mm, 선택)" inputMode="decimal"
                title="사진/시안엔 스케일이 없어요 — 실물의 가장 긴 변을 알려주시면 그 기준으로 생성합니다(사용자 제공값)"
                style={{ width: 140, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 11.5 }} />
              <button onClick={() => { setAttached(null); setScaleMm(''); }} aria-label="remove" style={{ marginInlineStart: 'auto', width: 24, height: 24, borderRadius: 999, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', cursor: 'pointer', lineHeight: 1, fontSize: 13 }}>×</button>
            </div>
          )}

          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPasteImage}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropImage}
            placeholder={attached ? (t.imgRecognized + '…') : t.placeholder}
            rows={started ? 2 : 3}
            style={{
              width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent',
              color: '#f0f4ff', fontSize: 15, lineHeight: 1.6, padding: '8px 8px 4px', boxSizing: 'border-box',
              fontFamily: 'inherit',
              // 드래그 중임을 보여준다 — 아무 반응이 없으면 「안 되는 줄」 알고 손을 뗀다
              ...(dragOver ? { background: 'rgba(56,189,248,0.08)', outline: '1px dashed #38bdf8' } : {}),
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 4px 2px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {/* 도면·스케치 첨부 (입력 A) — 기계설계 전용(Vision 어휘가 기계부품). */}
              {/* §3 역할 분리 — 📐도면(치수 판독, 기계 어휘)·📷사진(형태 힌트, 전 분야) */}
              {domain === 'mechanical' && (
                <button onClick={() => { attachModeRef.current = 'drawing'; fileRef.current?.click(); }} title={t.attachDrawing} aria-label={t.attachDrawing} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10, cursor: 'pointer',
                  border: `1px solid ${accent}55`, background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', fontSize: 12.5, fontWeight: 600,
                }}>
                  📐<span style={{ display: started ? 'none' : 'inline' }}>{t.attachDrawing}</span>
                </button>
              )}
              {domain === 'mechanical' && (
                <button onClick={() => { void sendGenImage(); }} disabled={loading || threadLimitReached || (!input.trim() && !attached)} title={t.genImg} aria-label={t.genImg} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10,
                  cursor: loading || threadLimitReached || (!input.trim() && !attached) ? 'not-allowed' : 'pointer',
                  border: `1px solid ${accent}55`, background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', fontSize: 12.5, fontWeight: 600,
                  opacity: loading || threadLimitReached || (!input.trim() && !attached) ? 0.5 : 1,
                }}>
                  ✨<span style={{ display: started ? 'none' : 'inline' }}>{t.genImg}</span>
                </button>
              )}
              <button onClick={() => { attachModeRef.current = 'photo'; fileRef.current?.click(); }} title={t.attachPhoto} aria-label={t.attachPhoto} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10, cursor: 'pointer',
                border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', fontSize: 12.5, fontWeight: 600,
              }}>
                📷<span style={{ display: started ? 'none' : 'inline' }}>{t.attachPhoto}</span>
              </button>
              <span style={{ color: accent, display: 'inline-flex' }}><DomainIcon name={domain} size={20} /></span>
              {pickedPart && (
                <span title={t.pickSel.replace('{id}', pickedPart)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999,
                  border: `1px solid ${accent}77`, background: `${accent}1d`, color: '#e2e8f0', fontSize: 12, fontWeight: 700, maxWidth: 220,
                }}>
                  🎯 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickedPart}{pickedNormal ? ` · ${faceTag(pickedNormal)}` : ''}</span>
                  <button onClick={() => { setPickedPart(null); setPickedNormal(null); }} aria-label="clear" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
                </span>
              )}
            </div>
            {loading ? (
              <button onClick={stopGen} style={{
                padding: '9px 22px', borderRadius: 12, cursor: 'pointer',
                fontSize: 14, fontWeight: 800, color: '#fca5a5',
                border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.12)',
              }}>■ {t.stop}</button>
            ) : (
              <button onClick={submit} disabled={!canSend} style={{
                padding: '9px 22px', borderRadius: 12, border: 'none',
                cursor: !canSend ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 800, color: '#fff',
                background: !canSend ? 'rgba(148,163,184,0.4)' : `linear-gradient(135deg, ${accent}, #6366f1)`,
                transition: 'background .2s',
              }}>{t.send}</button>
            )}
          </div>
        </div>

        {/* 업로드 안내 (대화 시작 전, 기계설계 전용) */}
        {!started && domain === 'mechanical' && (
          <p style={{ marginTop: 10, fontSize: 11.5, color: 'rgba(148,163,184,0.7)', lineHeight: 1.5, maxWidth: 560, margin: '10px auto 0', wordBreak: 'keep-all' }}>{t.uploadHint}</p>
        )}

        {/* 분야 칩 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
          {DOMAINS.map(d => {
            const on = d === domain;
            const c = DOMAIN_ACCENT[d];
            return (
              <button key={d} onClick={() => { setDomain(d); if (d !== 'mechanical') setAttached(null); }} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
                fontSize: 13, fontWeight: on ? 800 : 600,
                border: `1.5px solid ${on ? c : 'rgba(255,255,255,0.14)'}`,
                background: on ? `${c}22` : 'rgba(255,255,255,0.04)',
                color: on ? '#fff' : 'rgba(203,213,225,0.85)', transition: 'all .18s',
              }}>
                <span style={{ color: on ? c : 'inherit', display: 'inline-flex' }}><DomainIcon name={d} size={16} /></span>
                {t.chips[d]}
              </button>
            );
          })}
        </div>

        {/* 분야별 시작 예시 (대화 시작 전) */}
        {!started && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            {SUGGEST[lang][domain].map((s, i) => (
              <button key={i} onClick={() => send(s)} disabled={loading} style={{
                padding: '8px 14px', borderRadius: 12, cursor: loading ? 'wait' : 'pointer',
                fontSize: 12.5, fontWeight: 500, textAlign: isRtl ? 'right' : 'left',
                border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.035)',
                color: 'rgba(203,213,225,0.9)', maxWidth: 340, lineHeight: 1.45, transition: 'all .18s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = `${accent}1e`; e.currentTarget.style.borderColor = `${accent}55`; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
              >{s}</button>
            ))}
          </div>
        )}

        {/* 새 대화 (GPT형 — 후속 CTA 제거, 채팅 안에서 결과·다운로드가 완결) */}
        {started && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            {/* 반드시 newThread() — messages만 비우면 activeId가 남아 다음 대화가 이전 스레드를 덮어쓴다 */}
            <button onClick={() => { newThread(); setError(''); setAttached(null); }} style={{
              padding: '8px 18px', borderRadius: 11, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.14)',
            }}>+ {t.reset}</button>
          </div>
        )}

        <p style={{ marginTop: 22, fontSize: 11, color: 'rgba(148,163,184,0.72)', lineHeight: 1.6, maxWidth: 560, margin: '22px auto 0', wordBreak: 'keep-all' }}>{t.disclaimer}</p>
      </div>

      {/* 우측 상시 3D 패널(appMode·넓은 화면·CAD 결과 존재 시) — 최신 결과를 크게 */}
      {splitMode && latestCad?.scad && (
        <aside style={{ position: 'relative', zIndex: 1, width: 'min(44%, 620px)', marginInlineStart: 18, display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 36px)', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#e2e8f0' }}>🧊 3D</span>
            {(latestCad.interferences?.length ?? 0) > 0
              ? <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 9px', borderRadius: 999, background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>✕ {t.cadInterf.replace('{n}', String(latestCad.interferences!.length))}</span>
              : latestCad.isAssembly
                ? <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 9px', borderRadius: 999, background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>✓ {t.cadInterfNone}</span>
                : null}
            {dragUndoN > 0 && (
              <button onClick={undoFaceDrag} title="푸시풀 되돌리기" style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 9px', borderRadius: 999, border: '1px solid rgba(148,163,184,0.4)', background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', cursor: 'pointer' }}>↩ {dragUndoN}</button>
            )}
            {latestCad.scadDraft && !lodFull && (
              <button onClick={() => setLodFull(true)} title="1차 골격 표시 중 — 2차 상세로 전환" style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 9px', borderRadius: 999, border: `1px solid ${accent}66`, background: `${accent}1d`, color: '#bfdbfe', cursor: 'pointer' }}>🧩 2차 상세</button>
            )}
            <a href={'/' + langCode + '/nexyfab/design/?domain=' + (STUDIO_DOMAIN[domain] ?? 'mech')}
              onClick={() => { try { sessionStorage.setItem('nf-chat-handoff', JSON.stringify({ spec: latestCad.spec ?? '', at: Date.now(), type: latestCad.isAssembly ? 'assembly' : 'part' })); } catch { /* ignore */ } }}
              style={{ marginInlineStart: 'auto', fontSize: 11, color: '#93c5fd', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 7, padding: '3px 10px', textDecoration: 'none' }}>
              🛠 Studio →
            </a>
          </div>
          <MiniScadViewer key={scadKey(latestCad.scad ?? '') + ':' + (latestCad.interferences?.length ?? 0) + ':' + (lodFull ? 'f' : 'd')} scad={(lodFull ? latestCad.scad : latestCad.scadDraft) ?? latestCad.scad!} auto accent={accent} height={520} parts={lodFull ? latestCad.partsAabb : (latestCad.partsAabbDraft ?? latestCad.partsAabb)} selectedId={pickedPart} onPick={(id, normal) => { setPickedPart(id); setPickedNormal(normal ?? null); }} onFaceDrag={applyFaceDrag} />
        </aside>
      )}
    </section>
  );
}
