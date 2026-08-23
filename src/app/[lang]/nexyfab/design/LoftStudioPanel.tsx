'use client';

/**
 * LoftStudioPanel — ⓒ 인터랙티브 로프트/스윕 저작 패널 (다중 바디).
 *
 * 사용자가 단면 프로파일(circle/superellipse/naca/roundedRect/polygon)과 축방향 스테이션(로프트)
 * 또는 3D 경로(스윕)를 편집하면 /api/nexyfab/drawing/loft 로 스펙을 보내 매끈한 곡면 mesh 부품을
 * 받아 3D로 본다. 여러 바디를 추가/삭제/선택해 한 어셈블리로 동시에 렌더할 수 있다.
 * polygon 타입은 <canvas> 위에서 제어점을 마우스로 드래그해 커스텀 단면을 직접 저작한다.
 *
 * 정직성:
 *  - 형상 저작만 — 성능/구조 해석 아님(상단 라벨 명시).
 *  - 잘못된 스펙은 지어내지 않고 서버가 돌려준 error 를 그대로 빨강 표시한다.
 *  - 재사용 뷰어(AssemblyViewer3D)에 mesh(verts/faces) 렌더 경로가 있어, 로프트/스윕 곡면의
 *    실제 삼각 메시를 3D로 표시한다(박스 프록시 아님). 회전/확대 가능.
 *
 * API 계약(이미 구현): 단일 바디면 그 바디 스펙, 여러 개면 { name, bodies:[...] } 를 POST.
 *  단일 바디(로프트): { id?, profile, stations:[{at:[x,y,z],scale,rot}], axis }
 *  단일 바디(스윕):   { id?, kind:'sweep', profile, path:[[x,y,z]...], scale }
 *  응답: { ok, assembly:{parts:[...]}, part, parts:<수>, volumeMm3, triCount } | { ok:false, error }
 *
 * i18n: 자매 스튜디오 패널(ParametricPresetPanel/AssemblyPresetPanel)과 동일하게 ko/en 분기.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { isKorean } from '@/lib/i18n/normalize';
import { designPair } from './designI18n';
import type { ViewerPart } from './AssemblyViewer3D';

const AssemblyViewer3D = dynamic(() => import('./AssemblyViewer3D'), { ssr: false });

// ───────────────────────── 상수 ─────────────────────────
const TAU = Math.PI * 2;
const CANVAS = 300;
const HALF = CANVAS / 2;
const VIEW_SCALE = 1; // polygon 편집: 1 프로파일 단위 = 1px (중심 원점)

type ProfileType = 'circle' | 'superellipse' | 'naca' | 'roundedRect' | 'polygon';
type Axis = 'x' | 'y' | 'z';
type BodyMode = 'loft' | 'sweep';
type Pt = [number, number];

type ProfileSpec =
  | { type: 'circle'; r: number; n: number }
  | { type: 'superellipse'; a: number; b: number; n: number; exp: number }
  | { type: 'naca'; code: string; n: number }
  | { type: 'roundedRect'; w: number; h: number; r: number; n: number }
  | { type: 'polygon'; points: number[][] };

interface Station { x: number; y: number; z: number; scale: number; rot: number } // rot: 도(°) — 전송 시 라디안 변환
interface PathPt { x: number; y: number; z: number }

/** 한 바디의 편집 상태 — 프로파일(공용 단면) + 로프트/스윕 각각의 데이터를 모두 보존한다
 *  (모드/타입을 바꿔도 값 손실 없음). */
interface BodyState {
  id: string;
  mode: BodyMode;
  role: string;
  // 프로파일(단면) — 타입별 상태를 모두 유지
  ptype: ProfileType;
  circleP: { r: number; n: number };
  seP: { a: number; b: number; n: number; exp: number };
  nacaP: { code: string; n: number };
  rrP: { w: number; h: number; r: number; n: number };
  poly: Pt[];
  // 로프트
  axis: Axis;
  stations: Station[];
  // 스윕
  path: PathPt[];
  scale: number;
}

// 단일 바디 스펙(로프트 | 스윕) — POST 바디
type LoftBodySpec = {
  id: string;
  profile: ProfileSpec;
  stations: { at: number[]; scale: number; rot: number }[];
  axis: Axis;
  material: string;
  role: string;
};
type SweepBodySpec = {
  id: string;
  kind: 'sweep';
  profile: ProfileSpec;
  path: number[][];
  scale: number;
  material: string;
  role: string;
};
type BodySpec = LoftBodySpec | SweepBodySpec;

interface LoftPart {
  id: string;
  type: string;
  material: string;
  role: string;
  at?: { tx?: number; ty?: number; tz?: number };
  params: { volumeMm3: number; triCount: number; aabb: { min: number[]; max: number[] }; verts: number[][]; faces: number[][] };
}

interface LoftResp {
  ok: boolean;
  part?: LoftPart;
  assembly?: { parts: LoftPart[] };
  parts?: number;
  volumeMm3?: number;
  triCount?: number;
  error?: string;
  stage?: string;
}

interface GenResult { parts: LoftPart[]; count: number; volumeMm3: number; triCount: number }

// ───────── 프로파일 미리보기 생성기(loft.mjs 미러 — 캔버스 표시용, 실패 시 빈 배열) ─────────
function genCircle(r: number, n: number): Pt[] {
  if (!(r > 0)) return [];
  const N = Math.max(3, Math.floor(n) || 3);
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) { const a = (TAU * i) / N; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  return pts;
}
function genSuperellipse(a: number, b: number, n: number, exp: number): Pt[] {
  if (!(a > 0) || !(b > 0) || !(exp > 0)) return [];
  const N = Math.max(3, Math.floor(n) || 3);
  const p = 2 / exp;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const t = (TAU * i) / N; const c = Math.cos(t), s = Math.sin(t);
    pts.push([a * Math.sign(c) * Math.abs(c) ** p, b * Math.sign(s) * Math.abs(s) ** p]);
  }
  return pts;
}
function genNaca(code: string, n: number): Pt[] {
  if (!/^\d{4}$/.test(code)) return [];
  if (!Number.isInteger(n) || n < 6 || n % 2 !== 0) return [];
  const mC = parseInt(code[0], 10) / 100;
  const pC = (parseInt(code[1], 10) || 1) / 10;
  const tC = parseInt(code.slice(2), 10) / 100;
  const yt = (x: number) => 5 * tC * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const cam = (x: number) => (x < pC ? (mC / (pC * pC)) * (2 * pC * x - x * x) : (mC / ((1 - pC) ** 2)) * (1 - 2 * pC + 2 * pC * x - x * x));
  const half = n / 2;
  const pts: Pt[] = [];
  for (let i = 0; i <= half; i++) { const x = i / half; pts.push([x, cam(x) + yt(x)]); }
  for (let i = half - 1; i > 0; i--) { const x = i / half; pts.push([x, cam(x) - yt(x)]); }
  return pts;
}
function genRoundedRect(w: number, h: number, rr: number, n: number): Pt[] {
  if (!(w > 0) || !(h > 0)) return [];
  const r = Math.max(0, Math.min(rr, Math.min(w, h) / 2));
  const N = Math.max(4, Math.floor(n) || 4);
  const hw = w / 2, hh = h / 2;
  const straightX = w - 2 * r, straightY = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const cc: number[][] = [[hw - r, hh - r], [-(hw - r), hh - r], [-(hw - r), -(hh - r)], [hw - r, -(hh - r)]];
  const segs: Array<{ len: number; fn: (u: number) => Pt }> = [
    { len: straightY, fn: (u) => [hw, -straightY / 2 + u] },
    { len: arc, fn: (u) => { const a = (u / (arc || 1)) * (Math.PI / 2); return [cc[0][0] + r * Math.cos(a), cc[0][1] + r * Math.sin(a)]; } },
    { len: straightX, fn: (u) => [straightX / 2 - u, hh] },
    { len: arc, fn: (u) => { const a = Math.PI / 2 + (u / (arc || 1)) * (Math.PI / 2); return [cc[1][0] + r * Math.cos(a), cc[1][1] + r * Math.sin(a)]; } },
    { len: straightY, fn: (u) => [-hw, straightY / 2 - u] },
    { len: arc, fn: (u) => { const a = Math.PI + (u / (arc || 1)) * (Math.PI / 2); return [cc[2][0] + r * Math.cos(a), cc[2][1] + r * Math.sin(a)]; } },
    { len: straightX, fn: (u) => [-straightX / 2 + u, -hh] },
    { len: arc, fn: (u) => { const a = 3 * Math.PI / 2 + (u / (arc || 1)) * (Math.PI / 2); return [cc[3][0] + r * Math.cos(a), cc[3][1] + r * Math.sin(a)]; } },
  ];
  const total = segs.reduce((s, seg) => s + seg.len, 0);
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    let d = (total * i) / N;
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      if (d <= seg.len || si === segs.length - 1) { pts.push(seg.fn(Math.min(d, seg.len))); break; }
      d -= seg.len;
    }
  }
  return pts;
}

const DEFAULT_POLY: Pt[] = Array.from({ length: 6 }, (_, i) => {
  const a = (TAU * i) / 6 - Math.PI / 2;
  return [Math.round(60 * Math.cos(a)), Math.round(60 * Math.sin(a))] as Pt;
});

// ───────── 기본 바디 팩토리 ─────────
function makeBody(id: string): BodyState {
  return {
    id,
    mode: 'loft',
    role: 'body',
    ptype: 'circle',
    circleP: { r: 50, n: 32 },
    seP: { a: 60, b: 40, n: 48, exp: 2.5 },
    nacaP: { code: '2412', n: 40 },
    rrP: { w: 120, h: 80, r: 20, n: 48 },
    poly: DEFAULT_POLY.map((p) => [p[0], p[1]] as Pt),
    axis: 'z',
    stations: [
      { x: 0, y: 0, z: 0, scale: 1, rot: 0 },
      { x: 0, y: 0, z: 200, scale: 1, rot: 0 },
    ],
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 150 },
      { x: 80, y: 0, z: 220 },
    ],
    scale: 1,
  };
}

// 현재 프로파일 상태 → 미리보기 점(polygon 은 poly 그대로, 그 외는 생성기)
function previewOf(b: BodyState): Pt[] {
  switch (b.ptype) {
    case 'circle': return genCircle(b.circleP.r, b.circleP.n);
    case 'superellipse': return genSuperellipse(b.seP.a, b.seP.b, b.seP.n, b.seP.exp);
    case 'naca': return genNaca(b.nacaP.code, b.nacaP.n);
    case 'roundedRect': return genRoundedRect(b.rrP.w, b.rrP.h, b.rrP.r, b.rrP.n);
    case 'polygon': return b.poly;
    default: return [];
  }
}

// 프로파일 상태 → 전송용 스펙
function profileOf(b: BodyState): ProfileSpec {
  switch (b.ptype) {
    case 'circle': return { type: 'circle', r: b.circleP.r, n: b.circleP.n };
    case 'superellipse': return { type: 'superellipse', a: b.seP.a, b: b.seP.b, n: b.seP.n, exp: b.seP.exp };
    case 'naca': return { type: 'naca', code: b.nacaP.code, n: b.nacaP.n };
    case 'roundedRect': return { type: 'roundedRect', w: b.rrP.w, h: b.rrP.h, r: b.rrP.r, n: b.rrP.n };
    case 'polygon': return { type: 'polygon', points: b.poly.map(([u, v]) => [u, v]) };
  }
}

// 바디 상태 → 단일 바디 스펙(로프트 | 스윕)
function bodySpecOf(b: BodyState): BodySpec {
  const profile = profileOf(b);
  if (b.mode === 'sweep') {
    return {
      id: b.id, kind: 'sweep', profile,
      path: b.path.map((p) => [p.x, p.y, p.z]),
      scale: b.scale, material: 'composite', role: b.role,
    };
  }
  return {
    id: b.id, profile,
    stations: b.stations.map((s) => ({ at: [s.x, s.y, s.z], scale: s.scale, rot: (s.rot * Math.PI) / 180 })),
    axis: b.axis, material: 'composite', role: b.role,
  };
}

export default function LoftStudioPanel({ lang }: { lang: string }) {
  const ko = isKorean(lang);
  const t = (koText: string, enText: string) => designPair(lang, koText, enText);

  // 바디 리스트(기본 1개 = 기존 단일 바디 동작 유지)
  const [bodies, setBodies] = useState<BodyState[]>(() => [makeBody('body1')]);
  const [selId, setSelId] = useState('body1');
  const seqRef = useRef(1); // 바디 id 생성 카운터

  const sel = useMemo(() => bodies.find((b) => b.id === selId) ?? bodies[0], [bodies, selId]);

  // polygon 제어점 선택(선택 바디 편집 UI 상태)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // 생성 결과(어셈블리 전체)
  const [result, setResult] = useState<GenResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef<number | null>(null);

  // ───────── 선택 바디 갱신 헬퍼 ─────────
  const patchSel = useCallback((fn: (b: BodyState) => BodyState) => {
    setBodies((prev) => prev.map((b) => (b.id === selId ? fn(b) : b)));
  }, [selId]);

  const previewPts = useMemo<Pt[]>(() => previewOf(sel), [sel]);
  const ptype = sel.ptype;
  const poly = sel.poly;

  // ───────── 캔버스 렌더 ─────────
  const draw = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);
    // 격자
    ctx.strokeStyle = '#e5e9f0';
    ctx.lineWidth = 1;
    for (let g = 0; g <= W; g += 30) {
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke();
    }

    const isPoly = ptype === 'polygon';
    let toPx: (p: Pt) => Pt;
    if (isPoly) {
      toPx = ([x, y]) => [x * VIEW_SCALE + HALF, HALF - y * VIEW_SCALE];
    } else {
      // 자동 맞춤(균일 스케일 — 종횡비 보존)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of previewPts) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
      const pad = 26;
      const bw = Math.max(1e-6, maxX - minX), bh = Math.max(1e-6, maxY - minY);
      const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      toPx = ([x, y]) => [W / 2 + (x - cx) * s, H / 2 - (y - cy) * s];
    }

    const pts = isPoly ? poly : previewPts;
    if (pts.length >= 2) {
      ctx.beginPath();
      pts.forEach((p, i) => { const [px, py] = toPx(p); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.closePath();
      ctx.fillStyle = 'rgba(37,99,235,0.10)';
      ctx.fill();
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (isPoly) {
      poly.forEach((p, i) => {
        const [px, py] = toPx(p);
        ctx.beginPath();
        ctx.arc(px, py, i === selectedIdx ? 7 : 5, 0, TAU);
        ctx.fillStyle = i === selectedIdx ? '#dc2626' : '#2563eb';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }
  }, [ptype, poly, previewPts, selectedIdx]);

  useEffect(() => { draw(); }, [draw]);

  // ───────── polygon 마우스 편집(선택 바디에 적용) ─────────
  const canvasXY = (e: React.MouseEvent<HTMLCanvasElement>): Pt => {
    const cvs = canvasRef.current;
    if (!cvs) return [0, 0];
    const rect = cvs.getBoundingClientRect();
    const sx = cvs.width / rect.width, sy = cvs.height / rect.height;
    return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy];
  };
  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (ptype !== 'polygon') return;
    const [mx, my] = canvasXY(e);
    let best = -1, bd = 14;
    poly.forEach((p, i) => {
      const px = p[0] * VIEW_SCALE + HALF, py = HALF - p[1] * VIEW_SCALE;
      const d = Math.hypot(px - mx, py - my);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { setSelectedIdx(best); draggingRef.current = best; }
  };
  const onMoveCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (ptype !== 'polygon') return;
    const idx = draggingRef.current;
    if (idx == null) return;
    const [mx, my] = canvasXY(e);
    const wx = +((mx - HALF) / VIEW_SCALE).toFixed(2);
    const wy = +((HALF - my) / VIEW_SCALE).toFixed(2);
    patchSel((b) => ({ ...b, poly: b.poly.map((p, i) => (i === idx ? [wx, wy] as Pt : p)) }));
  };
  const endDrag = () => { draggingRef.current = null; };

  const addPoint = () => {
    patchSel((b) => {
      const a = b.poly[b.poly.length - 1], c = b.poly[0];
      return { ...b, poly: [...b.poly, [Math.round((a[0] + c[0]) / 2), Math.round((a[1] + c[1]) / 2)] as Pt] };
    });
  };
  const delPoint = () => {
    patchSel((b) => {
      if (b.poly.length <= 3) return b;
      const idx = selectedIdx != null && selectedIdx < b.poly.length ? selectedIdx : b.poly.length - 1;
      return { ...b, poly: b.poly.filter((_, i) => i !== idx) };
    });
    setSelectedIdx(null);
  };

  // ───────── 스테이션(로프트) 편집 ─────────
  const updateStation = (i: number, key: keyof Station, val: number) => {
    patchSel((b) => ({ ...b, stations: b.stations.map((s, j) => (j === i ? { ...s, [key]: val } : s)) }));
  };
  const addStation = () => {
    patchSel((b) => {
      const last = b.stations[b.stations.length - 1];
      const s: Station = { ...last };
      if (b.axis === 'x') s.x = last.x + 100; else if (b.axis === 'y') s.y = last.y + 100; else s.z = last.z + 100;
      return { ...b, stations: [...b.stations, s] };
    });
  };
  const dupStation = (i: number) => patchSel((b) => ({ ...b, stations: [...b.stations.slice(0, i + 1), { ...b.stations[i] }, ...b.stations.slice(i + 1)] }));
  const delStation = (i: number) => patchSel((b) => (b.stations.length <= 2 ? b : { ...b, stations: b.stations.filter((_, j) => j !== i) }));

  // ───────── 경로(스윕) 편집 ─────────
  const updatePath = (i: number, key: keyof PathPt, val: number) => {
    patchSel((b) => ({ ...b, path: b.path.map((p, j) => (j === i ? { ...p, [key]: val } : p)) }));
  };
  const addPathPt = () => {
    patchSel((b) => {
      const last = b.path[b.path.length - 1];
      return { ...b, path: [...b.path, { x: last.x, y: last.y, z: last.z + 100 }] };
    });
  };
  const dupPathPt = (i: number) => patchSel((b) => ({ ...b, path: [...b.path.slice(0, i + 1), { ...b.path[i] }, ...b.path.slice(i + 1)] }));
  const delPathPt = (i: number) => patchSel((b) => (b.path.length <= 2 ? b : { ...b, path: b.path.filter((_, j) => j !== i) }));

  // ───────── 바디 리스트 편집 ─────────
  const addBody = () => {
    seqRef.current += 1;
    const id = `body${seqRef.current}`;
    setBodies((prev) => [...prev, makeBody(id)]);
    setSelId(id);
    setSelectedIdx(null);
  };
  const delBody = (id: string) => {
    if (bodies.length <= 1) return;
    const next = bodies.filter((b) => b.id !== id);
    setBodies(next);
    if (id === selId) { setSelId(next[0].id); setSelectedIdx(null); }
  };
  const selectBody = (id: string) => { setSelId(id); setSelectedIdx(null); };

  // ───────── 스펙 조립 + 생성 ─────────
  const generate = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      // 단일 바디면 그 바디 스펙을, 여러 개면 { name, bodies:[...] } 를 POST.
      const body = bodies.length === 1
        ? bodySpecOf(bodies[0])
        : { name: 'loft', bodies: bodies.map(bodySpecOf) };
      const res = await fetch('/api/nexyfab/drawing/loft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as LoftResp;
      if (data.ok && data.assembly?.parts?.length) {
        setResult({
          parts: data.assembly.parts,
          count: data.parts ?? data.assembly.parts.length,
          volumeMm3: data.volumeMm3 ?? data.assembly.parts.reduce((s, p) => s + (p.params.volumeMm3 || 0), 0),
          triCount: data.triCount ?? data.assembly.parts.reduce((s, p) => s + (p.params.triCount || 0), 0),
        });
        setErr(null);
      } else {
        setResult(null);
        setErr(data.error ?? t('알 수 없는 오류', 'Unknown error'));
      }
    } catch (e) {
      setResult(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [bodies, ko]);

  // 마운트 1회 자동 생성 — 기본 스펙은 항상 유효(빈 미리보기 방지)
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 뷰어용 파트 — 어셈블리 전체(여러 바디). mesh 렌더는 params.verts/faces, aabb 는 승격.
  const viewerParts = useMemo<ViewerPart[]>(() => {
    if (!result) return [];
    return result.parts.map((p) => ({ id: p.id, type: p.type, role: p.role, material: p.material, at: p.at, params: p.params, aabb: p.params.aabb }));
  }, [result]);

  return (
    <div style={panelStyle}>
      {/* 상단 정직 라벨 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>
          {t('로프트/스윕 스튜디오', 'Loft / sweep studio')}
          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
            {t('형상 저작 — 성능/구조 해석 아님', 'Shape authoring — not performance/structural analysis')}
          </span>
        </div>
      </div>

      {/* 0) 바디 리스트(다중 바디) */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
          {t('바디', 'Bodies')}
          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
            {t(`${bodies.length}개 · 선택 바디를 편집`, `${bodies.length} · editing selected`)}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {bodies.map((b, i) => {
            const active = b.id === selId;
            return (
              <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => selectBody(b.id)}
                  style={{
                    padding: '4px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--nx-accent, #2563eb)' : 'var(--nx-border, #dfe3e8)'}`,
                    background: active ? 'var(--nx-accent, #2563eb)' : 'var(--nx-panel, #fff)',
                    color: active ? '#fff' : 'inherit',
                  }}
                >
                  {`#${i + 1}`} · {b.mode === 'sweep' ? t('스윕', 'sweep') : t('로프트', 'loft')}
                </button>
                {bodies.length > 1 && (
                  <button type="button" onClick={() => delBody(b.id)} title={t('바디 삭제', 'Delete body')}
                    style={{ ...iconBtn, marginLeft: 2 }}>✕</button>
                )}
              </span>
            );
          })}
          <button type="button" onClick={addBody} style={miniBtn}>{t('+ 바디 추가', '+ Add body')}</button>
        </div>
      </div>

      {/* 0b) 모드 토글(선택 바디) */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['loft', 'sweep'] as BodyMode[]).map((m) => {
          const active = sel.mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => patchSel((b) => ({ ...b, mode: m }))}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--nx-accent, #2563eb)' : 'var(--nx-border, #dfe3e8)'}`,
                background: active ? 'var(--nx-accent-soft, #eef4ff)' : 'var(--nx-panel, #fff)',
                color: active ? 'var(--nx-accent, #2563eb)' : 'inherit',
              }}
            >
              {m === 'loft' ? t('로프트 (스테이션)', 'Loft (stations)') : t('스윕 (경로 압출)', 'Sweep (path)')}
            </button>
          );
        })}
      </div>

      {/* 1) 프로파일 선택(두 모드 공용 = 단면) */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
        <span style={labelText}>{t('단면 프로파일', 'Section profile')}</span>
        <select value={ptype} onChange={(e) => { patchSel((b) => ({ ...b, ptype: e.target.value as ProfileType })); setSelectedIdx(null); }} style={inpStyle}>
          <option value="circle">{t('원 (circle)', 'Circle')}</option>
          <option value="superellipse">{t('초타원 (superellipse)', 'Superellipse')}</option>
          <option value="naca">{t('NACA 에어포일', 'NACA airfoil')}</option>
          <option value="roundedRect">{t('라운드 사각 (roundedRect)', 'Rounded rect')}</option>
          <option value="polygon">{t('다각형 (직접 편집)', 'Polygon (custom)')}</option>
        </select>
      </label>

      {/* 프로파일 파라미터 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        {ptype === 'circle' && (<>
          {numField(t('반지름 r', 'Radius r'), sel.circleP.r, (v) => patchSel((b) => ({ ...b, circleP: { ...b.circleP, r: v } })))}
          {numField(t('분할 n', 'Segments n'), sel.circleP.n, (v) => patchSel((b) => ({ ...b, circleP: { ...b.circleP, n: v } })))}
        </>)}
        {ptype === 'superellipse' && (<>
          {numField(t('반축 a', 'Semi-axis a'), sel.seP.a, (v) => patchSel((b) => ({ ...b, seP: { ...b.seP, a: v } })))}
          {numField(t('반축 b', 'Semi-axis b'), sel.seP.b, (v) => patchSel((b) => ({ ...b, seP: { ...b.seP, b: v } })))}
          {numField(t('분할 n', 'Segments n'), sel.seP.n, (v) => patchSel((b) => ({ ...b, seP: { ...b.seP, n: v } })))}
          {numField(t('지수 exp', 'Exponent'), sel.seP.exp, (v) => patchSel((b) => ({ ...b, seP: { ...b.seP, exp: v } })), 0.1)}
        </>)}
        {ptype === 'naca' && (<>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
            <span style={labelText}>{t('코드(4자리)', 'Code (4-digit)')}</span>
            <input value={sel.nacaP.code} inputMode="numeric" maxLength={4}
              onChange={(e) => { const code = e.target.value.replace(/\D/g, '').slice(0, 4); patchSel((b) => ({ ...b, nacaP: { ...b.nacaP, code } })); }}
              style={inpStyle} />
          </label>
          {numField(t('분할 n (짝수)', 'Segments n (even)'), sel.nacaP.n, (v) => patchSel((b) => ({ ...b, nacaP: { ...b.nacaP, n: v } })))}
        </>)}
        {ptype === 'roundedRect' && (<>
          {numField(t('폭 w', 'Width w'), sel.rrP.w, (v) => patchSel((b) => ({ ...b, rrP: { ...b.rrP, w: v } })))}
          {numField(t('높이 h', 'Height h'), sel.rrP.h, (v) => patchSel((b) => ({ ...b, rrP: { ...b.rrP, h: v } })))}
          {numField(t('코너 r', 'Corner r'), sel.rrP.r, (v) => patchSel((b) => ({ ...b, rrP: { ...b.rrP, r: v } })))}
          {numField(t('분할 n', 'Segments n'), sel.rrP.n, (v) => patchSel((b) => ({ ...b, rrP: { ...b.rrP, n: v } })))}
        </>)}
        {ptype === 'polygon' && (
          <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>
            {t('아래 캔버스에서 점을 드래그해 단면을 편집하세요. 점 추가/삭제 버튼으로 개수를 바꿉니다.', 'Drag points on the canvas below to edit the section. Use add/remove to change point count.')}
          </div>
        )}
      </div>

      {/* 2) 인터랙티브 커브 캔버스(선택 바디의 단면) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 }}>
        <canvas
          ref={canvasRef}
          width={CANVAS}
          height={CANVAS}
          onMouseDown={onDown}
          onMouseMove={onMoveCanvas}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          style={{
            width: '100%', maxWidth: CANVAS, aspectRatio: '1 / 1',
            border: '1px solid var(--nx-border, #dfe3e8)', borderRadius: 8,
            cursor: ptype === 'polygon' ? 'crosshair' : 'default', touchAction: 'none',
          }}
        />
        {ptype === 'polygon' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" onClick={addPoint} style={miniBtn}>{t('+ 점 추가', '+ Add point')}</button>
            <button type="button" onClick={delPoint} style={miniBtn}>{t('− 점 삭제', '− Remove point')}</button>
            <span style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', alignSelf: 'center' }}>
              {t(`${poly.length}점`, `${poly.length} pts`)}
            </span>
          </div>
        )}
      </div>

      {/* 3a) 스테이션 편집(로프트 모드) */}
      {sel.mode === 'loft' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>{t('스테이션', 'Stations')}</span>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <span style={labelText}>{t('축', 'Axis')}</span>
              <select value={sel.axis} onChange={(e) => patchSel((b) => ({ ...b, axis: e.target.value as Axis }))} style={{ ...inpStyle, width: 'auto' }}>
                <option value="z">Z</option>
                <option value="x">X</option>
                <option value="y">Y</option>
              </select>
            </label>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--nx-text-3, #6b7684)' }}>
                  {['#', 'x', 'y', 'z', t('배율', 'scale'), t('회전°', 'rot°'), ''].map((h, i) => (
                    <th key={i} style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sel.stations.map((s, i) => (
                  <tr key={i}>
                    <td style={{ padding: '2px 4px', color: 'var(--nx-text-3, #6b7684)' }}>{i + 1}</td>
                    {(['x', 'y', 'z', 'scale', 'rot'] as const).map((key) => (
                      <td key={key} style={{ padding: '2px 2px' }}>
                        <input
                          type="number" inputMode="decimal" value={Number.isFinite(s[key]) ? s[key] : ''}
                          step={key === 'scale' ? 0.1 : 1}
                          onChange={(e) => updateStation(i, key, Number(e.target.value))}
                          style={{ ...inpStyle, width: 56, padding: '3px 4px' }}
                        />
                      </td>
                    ))}
                    <td style={{ padding: '2px 2px', whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => dupStation(i)} title={t('복제', 'Duplicate')} style={iconBtn}>⧉</button>
                      <button type="button" onClick={() => delStation(i)} title={t('삭제', 'Delete')} disabled={sel.stations.length <= 2} style={iconBtn}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addStation} style={{ ...miniBtn, marginTop: 6 }}>{t('+ 스테이션 추가', '+ Add station')}</button>
        </div>
      )}

      {/* 3b) 경로 편집(스윕 모드) */}
      {sel.mode === 'sweep' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>{t('경로 (path)', 'Path')}</span>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <span style={labelText}>{t('단면 배율', 'Section scale')}</span>
              <input
                type="number" inputMode="decimal" step={0.1}
                value={Number.isFinite(sel.scale) ? sel.scale : ''}
                onChange={(e) => patchSel((b) => ({ ...b, scale: Number(e.target.value) }))}
                style={{ ...inpStyle, width: 64 }}
              />
            </label>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--nx-text-3, #6b7684)' }}>
                  {['#', 'x', 'y', 'z', ''].map((h, i) => (
                    <th key={i} style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sel.path.map((p, i) => (
                  <tr key={i}>
                    <td style={{ padding: '2px 4px', color: 'var(--nx-text-3, #6b7684)' }}>{i + 1}</td>
                    {(['x', 'y', 'z'] as const).map((key) => (
                      <td key={key} style={{ padding: '2px 2px' }}>
                        <input
                          type="number" inputMode="decimal" value={Number.isFinite(p[key]) ? p[key] : ''}
                          step={1}
                          onChange={(e) => updatePath(i, key, Number(e.target.value))}
                          style={{ ...inpStyle, width: 62, padding: '3px 4px' }}
                        />
                      </td>
                    ))}
                    <td style={{ padding: '2px 2px', whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => dupPathPt(i)} title={t('복제', 'Duplicate')} style={iconBtn}>⧉</button>
                      <button type="button" onClick={() => delPathPt(i)} title={t('삭제', 'Delete')} style={iconBtn}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addPathPt} style={{ ...miniBtn, marginTop: 6 }}>{t('+ 경로점 추가', '+ Add path point')}</button>
          <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>
            {t('단면이 경로 접선에 수직으로 유지되며 압출됩니다(회전-최소화 프레임). 경로점 ≥2 필요.', 'The section is extruded perpendicular to the path tangent (rotation-minimizing frame). Needs ≥2 path points.')}
          </div>
        </div>
      )}

      {/* 4) 생성 버튼 */}
      <button type="button" onClick={() => void generate()} disabled={busy} style={genStyle}>
        {busy ? t('생성 중…', 'Generating…') : (bodies.length > 1 ? t('어셈블리 생성', 'Generate assembly') : t('생성', 'Generate'))}
      </button>

      {/* 오류(정직: 서버 사유 그대로) */}
      {err && (
        <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 7, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 11 }}>
          {t('스펙 오류: ', 'Spec error: ')}{err}
        </div>
      )}

      {/* 5) 라이브 3D 미리보기(어셈블리 전체) */}
      {result && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', marginBottom: 2 }}>
            {t('3D 미리보기 (곡면 실측 렌더 · 회전/확대 가능)', '3D preview (real surface · orbit/zoom)')}
          </div>
          <AssemblyViewer3D parts={viewerParts} height={340} />
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--nx-text-2, #46505e)' }}>
            {t('바디', 'Bodies')}: {result.count.toLocaleString()} · {t('체적', 'Volume')}: {fmtVol(result.volumeMm3)} · {t('삼각형', 'Triangles')}: {result.triCount.toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 헬퍼 UI ─────────────────────────
function numField(label: string, value: number, onChange: (v: number) => void, step = 1) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
      <span style={labelText}>{label}</span>
      <input
        type="number" inputMode="decimal" step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value))}
        style={inpStyle}
      />
    </label>
  );
}

function fmtVol(mm3: number): string {
  if (!Number.isFinite(mm3)) return '—';
  if (mm3 >= 1e6) return `${(mm3 / 1e3).toLocaleString(undefined, { maximumFractionDigits: 0 })} cm³`;
  return `${mm3.toLocaleString(undefined, { maximumFractionDigits: 0 })} mm³`;
}

// ───────────────────────── 스타일 ─────────────────────────
const panelStyle: React.CSSProperties = {
  marginBottom: 12, padding: 12, borderRadius: 8,
  background: 'var(--nx-accent-soft, #eef4ff)', border: '1px solid var(--nx-border, #dfe3e8)',
};
const labelText: React.CSSProperties = { color: 'var(--nx-text-2, #46505e)' };
const inpStyle: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 6, fontSize: 12, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
};
const genStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 7, border: 'none',
  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const miniBtn: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit',
};
const iconBtn: React.CSSProperties = {
  padding: '2px 6px', marginLeft: 2, borderRadius: 5, fontSize: 11, cursor: 'pointer',
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit',
};
