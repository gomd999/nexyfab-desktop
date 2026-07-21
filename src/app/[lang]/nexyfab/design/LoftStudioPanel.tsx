'use client';

/**
 * LoftStudioPanel — ⓒ 인터랙티브 로프트 저작 패널.
 *
 * 사용자가 단면 프로파일(circle/superellipse/naca/roundedRect/polygon)과 축방향 스테이션을
 * 편집하면 /api/nexyfab/drawing/loft 로 스펙을 보내 매끈한 곡면 mesh 부품을 받아 3D로 본다.
 * polygon 타입은 <canvas> 위에서 제어점을 마우스로 드래그해 커스텀 단면을 직접 저작한다.
 *
 * 정직성:
 *  - 형상 저작만 — 성능/구조 해석 아님(상단 라벨 명시).
 *  - 잘못된 스펙은 지어내지 않고 서버가 돌려준 error 를 그대로 빨강 표시한다.
 *  - 재사용 뷰어(AssemblyViewer3D)에 mesh(verts/faces) 렌더 경로가 추가되어, 로프트 곡면의
 *    실제 삼각 메시가 3D로 표시된다(박스 프록시 아님). 회전/확대 가능.
 *
 * i18n: 자매 스튜디오 패널(ParametricPresetPanel/AssemblyPresetPanel)과 동일하게 ko/en 분기.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { isKorean } from '@/lib/i18n/normalize';
import type { ViewerPart } from './AssemblyViewer3D';

const AssemblyViewer3D = dynamic(() => import('./AssemblyViewer3D'), { ssr: false });

// ───────────────────────── 상수 ─────────────────────────
const TAU = Math.PI * 2;
const CANVAS = 300;
const HALF = CANVAS / 2;
const VIEW_SCALE = 1; // polygon 편집: 1 프로파일 단위 = 1px (중심 원점)

type ProfileType = 'circle' | 'superellipse' | 'naca' | 'roundedRect' | 'polygon';
type Axis = 'x' | 'y' | 'z';
type Pt = [number, number];

type ProfileSpec =
  | { type: 'circle'; r: number; n: number }
  | { type: 'superellipse'; a: number; b: number; n: number; exp: number }
  | { type: 'naca'; code: string; n: number }
  | { type: 'roundedRect'; w: number; h: number; r: number; n: number }
  | { type: 'polygon'; points: number[][] };

interface Station { x: number; y: number; z: number; scale: number; rot: number } // rot: 도(°) — 전송 시 라디안 변환

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
  volumeMm3?: number;
  triCount?: number;
  error?: string;
  stage?: string;
}

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

export default function LoftStudioPanel({ lang }: { lang: string }) {
  const ko = isKorean(lang);

  // 프로파일 상태
  const [ptype, setPtype] = useState<ProfileType>('circle');
  const [circleP, setCircleP] = useState({ r: 50, n: 32 });
  const [seP, setSeP] = useState({ a: 60, b: 40, n: 48, exp: 2.5 });
  const [nacaP, setNacaP] = useState({ code: '2412', n: 40 });
  const [rrP, setRrP] = useState({ w: 120, h: 80, r: 20, n: 48 });
  const [poly, setPoly] = useState<Pt[]>(DEFAULT_POLY);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // 스테이션 + 축
  const [axis, setAxis] = useState<Axis>('z');
  const [stations, setStations] = useState<Station[]>([
    { x: 0, y: 0, z: 0, scale: 1, rot: 0 },
    { x: 0, y: 0, z: 200, scale: 1, rot: 0 },
  ]);

  // 생성 결과
  const [part, setPart] = useState<LoftPart | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef<number | null>(null);

  // 현재 프로파일의 미리보기 점(polygon 은 poly 그대로, 그 외는 생성기)
  const previewPts = useMemo<Pt[]>(() => {
    switch (ptype) {
      case 'circle': return genCircle(circleP.r, circleP.n);
      case 'superellipse': return genSuperellipse(seP.a, seP.b, seP.n, seP.exp);
      case 'naca': return genNaca(nacaP.code, nacaP.n);
      case 'roundedRect': return genRoundedRect(rrP.w, rrP.h, rrP.r, rrP.n);
      case 'polygon': return poly;
      default: return [];
    }
  }, [ptype, circleP, seP, nacaP, rrP, poly]);

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

  // ───────── polygon 마우스 편집 ─────────
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
    setPoly((prev) => prev.map((p, i) => (i === idx ? [wx, wy] as Pt : p)));
  };
  const endDrag = () => { draggingRef.current = null; };

  const addPoint = () => {
    setPoly((prev) => {
      const a = prev[prev.length - 1], b = prev[0];
      return [...prev, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)] as Pt];
    });
  };
  const delPoint = () => {
    setPoly((prev) => {
      if (prev.length <= 3) return prev;
      const idx = selectedIdx != null && selectedIdx < prev.length ? selectedIdx : prev.length - 1;
      return prev.filter((_, i) => i !== idx);
    });
    setSelectedIdx(null);
  };

  // ───────── 스테이션 편집 ─────────
  const updateStation = (i: number, key: keyof Station, val: number) => {
    setStations((prev) => prev.map((s, j) => (j === i ? { ...s, [key]: val } : s)));
  };
  const addStation = () => {
    setStations((prev) => {
      const last = prev[prev.length - 1];
      const s: Station = { ...last };
      if (axis === 'x') s.x = last.x + 100; else if (axis === 'y') s.y = last.y + 100; else s.z = last.z + 100;
      return [...prev, s];
    });
  };
  const dupStation = (i: number) => setStations((prev) => [...prev.slice(0, i + 1), { ...prev[i] }, ...prev.slice(i + 1)]);
  const delStation = (i: number) => setStations((prev) => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)));

  // ───────── 스펙 조립 + 생성 ─────────
  const buildProfile = useCallback((): ProfileSpec => {
    switch (ptype) {
      case 'circle': return { type: 'circle', r: circleP.r, n: circleP.n };
      case 'superellipse': return { type: 'superellipse', a: seP.a, b: seP.b, n: seP.n, exp: seP.exp };
      case 'naca': return { type: 'naca', code: nacaP.code, n: nacaP.n };
      case 'roundedRect': return { type: 'roundedRect', w: rrP.w, h: rrP.h, r: rrP.r, n: rrP.n };
      case 'polygon': return { type: 'polygon', points: poly.map(([u, v]) => [u, v]) };
    }
  }, [ptype, circleP, seP, nacaP, rrP, poly]);

  const generate = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        id: 'loft',
        profile: buildProfile(),
        stations: stations.map((s) => ({ at: [s.x, s.y, s.z], scale: s.scale, rot: (s.rot * Math.PI) / 180 })),
        axis,
        material: 'composite',
        role: 'body',
      };
      const res = await fetch('/api/nexyfab/drawing/loft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as LoftResp;
      if (data.ok && data.part) {
        setPart(data.part);
        setErr(null);
      } else {
        setPart(null);
        setErr(data.error ?? (ko ? '알 수 없는 오류' : 'Unknown error'));
      }
    } catch (e) {
      setPart(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [buildProfile, stations, axis, ko]);

  // 마운트 1회 자동 생성 — 기본 스펙은 항상 유효(빈 미리보기 방지)
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 뷰어용 파트 — 재사용 뷰어는 top-level aabb(박스)를 렌더하므로 params.aabb 를 승격
  const viewerParts = useMemo<ViewerPart[]>(() => {
    if (!part) return [];
    return [{ id: part.id, type: part.type, role: part.role, material: part.material, at: part.at, params: part.params, aabb: part.params.aabb }];
  }, [part]);

  return (
    <div style={panelStyle}>
      {/* 상단 정직 라벨 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>
          {ko ? '로프트 스튜디오' : 'Loft studio'}
          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
            {ko ? '형상 저작 — 성능/구조 해석 아님' : 'Shape authoring — not performance/structural analysis'}
          </span>
        </div>
      </div>

      {/* 1) 프로파일 선택 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
        <span style={labelText}>{ko ? '단면 프로파일' : 'Section profile'}</span>
        <select value={ptype} onChange={(e) => { setPtype(e.target.value as ProfileType); setSelectedIdx(null); }} style={inpStyle}>
          <option value="circle">{ko ? '원 (circle)' : 'Circle'}</option>
          <option value="superellipse">{ko ? '초타원 (superellipse)' : 'Superellipse'}</option>
          <option value="naca">{ko ? 'NACA 에어포일' : 'NACA airfoil'}</option>
          <option value="roundedRect">{ko ? '라운드 사각 (roundedRect)' : 'Rounded rect'}</option>
          <option value="polygon">{ko ? '다각형 (직접 편집)' : 'Polygon (custom)'}</option>
        </select>
      </label>

      {/* 프로파일 파라미터 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        {ptype === 'circle' && (<>
          {numField(ko ? '반지름 r' : 'Radius r', circleP.r, (v) => setCircleP((s) => ({ ...s, r: v })))}
          {numField(ko ? '분할 n' : 'Segments n', circleP.n, (v) => setCircleP((s) => ({ ...s, n: v })))}
        </>)}
        {ptype === 'superellipse' && (<>
          {numField(ko ? '반축 a' : 'Semi-axis a', seP.a, (v) => setSeP((s) => ({ ...s, a: v })))}
          {numField(ko ? '반축 b' : 'Semi-axis b', seP.b, (v) => setSeP((s) => ({ ...s, b: v })))}
          {numField(ko ? '분할 n' : 'Segments n', seP.n, (v) => setSeP((s) => ({ ...s, n: v })))}
          {numField(ko ? '지수 exp' : 'Exponent', seP.exp, (v) => setSeP((s) => ({ ...s, exp: v })), 0.1)}
        </>)}
        {ptype === 'naca' && (<>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
            <span style={labelText}>{ko ? '코드(4자리)' : 'Code (4-digit)'}</span>
            <input value={nacaP.code} inputMode="numeric" maxLength={4}
              onChange={(e) => setNacaP((s) => ({ ...s, code: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
              style={inpStyle} />
          </label>
          {numField(ko ? '분할 n (짝수)' : 'Segments n (even)', nacaP.n, (v) => setNacaP((s) => ({ ...s, n: v })))}
        </>)}
        {ptype === 'roundedRect' && (<>
          {numField(ko ? '폭 w' : 'Width w', rrP.w, (v) => setRrP((s) => ({ ...s, w: v })))}
          {numField(ko ? '높이 h' : 'Height h', rrP.h, (v) => setRrP((s) => ({ ...s, h: v })))}
          {numField(ko ? '코너 r' : 'Corner r', rrP.r, (v) => setRrP((s) => ({ ...s, r: v })))}
          {numField(ko ? '분할 n' : 'Segments n', rrP.n, (v) => setRrP((s) => ({ ...s, n: v })))}
        </>)}
        {ptype === 'polygon' && (
          <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>
            {ko ? '아래 캔버스에서 점을 드래그해 단면을 편집하세요. 점 추가/삭제 버튼으로 개수를 바꿉니다.'
                : 'Drag points on the canvas below to edit the section. Use add/remove to change point count.'}
          </div>
        )}
      </div>

      {/* 2) 인터랙티브 커브 캔버스 */}
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
            <button type="button" onClick={addPoint} style={miniBtn}>{ko ? '+ 점 추가' : '+ Add point'}</button>
            <button type="button" onClick={delPoint} style={miniBtn}>{ko ? '− 점 삭제' : '− Remove point'}</button>
            <span style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', alignSelf: 'center' }}>
              {ko ? `${poly.length}점` : `${poly.length} pts`}
            </span>
          </div>
        )}
      </div>

      {/* 3) 스테이션 편집 */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700 }}>{ko ? '스테이션' : 'Stations'}</span>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <span style={labelText}>{ko ? '축' : 'Axis'}</span>
            <select value={axis} onChange={(e) => setAxis(e.target.value as Axis)} style={{ ...inpStyle, width: 'auto' }}>
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
                {['#', 'x', 'y', 'z', ko ? '배율' : 'scale', ko ? '회전°' : 'rot°', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stations.map((s, i) => (
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
                    <button type="button" onClick={() => dupStation(i)} title={ko ? '복제' : 'Duplicate'} style={iconBtn}>⧉</button>
                    <button type="button" onClick={() => delStation(i)} title={ko ? '삭제' : 'Delete'} disabled={stations.length <= 2} style={iconBtn}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addStation} style={{ ...miniBtn, marginTop: 6 }}>{ko ? '+ 스테이션 추가' : '+ Add station'}</button>
      </div>

      {/* 4) 생성 버튼 */}
      <button type="button" onClick={() => void generate()} disabled={busy} style={genStyle}>
        {busy ? (ko ? '생성 중…' : 'Generating…') : (ko ? '로프트 생성' : 'Generate loft')}
      </button>

      {/* 오류(정직: 서버 사유 그대로) */}
      {err && (
        <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 7, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 11 }}>
          {ko ? '스펙 오류: ' : 'Spec error: '}{err}
        </div>
      )}

      {/* 5) 라이브 3D 미리보기 */}
      {part && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', marginBottom: 2 }}>
            {ko ? '3D 미리보기 (로프트 곡면 실측 렌더 · 회전/확대 가능)' : '3D preview (real lofted surface · orbit/zoom)'}
          </div>
          <AssemblyViewer3D parts={viewerParts} height={320} />
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--nx-text-2, #46505e)' }}>
            {ko ? '체적' : 'Volume'}: {fmtVol(part.params.volumeMm3)} · {ko ? '삼각형' : 'Triangles'}: {part.params.triCount.toLocaleString()}
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
