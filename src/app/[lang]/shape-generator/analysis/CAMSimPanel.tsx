'use client';

/**
 * CAMSimPanel — toolpath replay viewer with time-slider.
 *
 * 2D top-down (XZ) canvas view + 3D Isometric SVG view, toggled via tabs.
 * THREE.js is NOT used in this component — only the Vector3 type from camLite.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { CAMResult, CAMOperation } from './camLite';

interface CAMSimPanelProps {
  result: CAMResult;
  operation: CAMOperation;
  lang: string;
  onClose: () => void;
}

const C = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  accent: '#388bfd',
  accentBright: '#58a6ff',
  text: '#c9d1d9',
  dim: '#8b949e',
  green: '#3fb950',
  red: '#f85149',
};

/** Depth layer palette — wraps modulo 5 */
const LAYER_COLORS = ['#388bfd', '#3fb950', '#f0883e', '#a371f7', '#e3b341'];

function t(lang: string, ko: string, en: string) { return lang === 'ko' ? ko : en; }

/** Point type extended with Y coordinate for 3D projection. */
type TimelinePoint = { x: number; y: number; z: number; pathIdx: number; segIdx: number };

/** Flatten all toolpath segments into a single ordered list with cumulative distance. */
function buildTimeline(result: CAMResult) {
  const points: TimelinePoint[] = [];
  const cumDist: number[] = [0];
  let total = 0;
  for (let pi = 0; pi < result.toolpaths.length; pi++) {
    const path = result.toolpaths[pi];
    for (let si = 0; si < path.length; si++) {
      const v = path[si];
      if (si > 0) {
        const prev = path[si - 1];
        const dx = v.x - prev.x;
        const dz = v.z - prev.z;
        const dy = v.y - prev.y;
        total += Math.sqrt(dx * dx + dz * dz + dy * dy);
      }
      points.push({ x: v.x, y: v.y, z: v.z, pathIdx: pi, segIdx: si });
      cumDist.push(total);
    }
  }
  return { points, cumDist, totalDist: total };
}

/** Get interpolated tool position at normalized time t ∈ [0,1]. Returns {x,y,z}. */
function toolPosAt(
  t: number,
  points: TimelinePoint[],
  cumDist: number[],
  totalDist: number,
) {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  const target = t * totalDist;
  let lo = 0, hi = cumDist.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid + 1] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.min(lo, points.length - 2);
  const segLen = cumDist[i + 1] - cumDist[i];
  const frac = segLen < 1e-6 ? 0 : (target - cumDist[i]) / segLen;
  return {
    x: points[i].x + (points[i + 1].x - points[i].x) * frac,
    y: points[i].y + (points[i + 1].y - points[i].y) * frac,
    z: points[i].z + (points[i + 1].z - points[i].z) * frac,
  };
}

/** Isometric projection: world (x,y,z) → SVG (sx, sy).
 *  Standard iso: isoX = (x - z) * 0.866, isoY = (x + z) * 0.5 - y
 *  Then scale + offset to fit the SVG viewport.
 */
function toIso(wx: number, wy: number, wz: number, scale: number, offX: number, offY: number) {
  const sx = (wx - wz) * 0.866 * scale + offX;
  const sy = ((wx + wz) * 0.5 - wy) * scale + offY;
  return { sx, sy };
}

export default function CAMSimPanel({ result, operation, lang, onClose }: CAMSimPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);   // 0..1
  const [playing, setPlaying] = useState(false);
  const [view3d, setView3d] = useState(false);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [speedFactor, setSpeedFactor] = useState(10);

  const { points, cumDist, totalDist } = useMemo(() => buildTimeline(result), [result]);

  // Bounding box of all toolpath points (XYZ)
  const bounds = useMemo(() => {
    if (points.length === 0) return { minX: -50, maxX: 50, minY: 0, maxY: 10, minZ: -50, maxZ: 50 };
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const pad = Math.max(20, (maxX - minX) * 0.08, (maxZ - minZ) * 0.08);
    return { minX: minX - pad, maxX: maxX + pad, minY, maxY, minZ: minZ - pad, maxZ: maxZ + pad };
  }, [points]);

  // ── Isometric SVG pre-computation ─────────────────────────────────────────

  /** Compute the iso scale and offset so all toolpaths fit inside 638×380. */
  const isoTransform = useMemo(() => {
    const W = 638, H = 380;
    // Project all 8 AABB corners to find the iso bounding box
    const corners = [
      [bounds.minX, bounds.minY, bounds.minZ],
      [bounds.maxX, bounds.minY, bounds.minZ],
      [bounds.minX, bounds.maxY, bounds.minZ],
      [bounds.maxX, bounds.maxY, bounds.minZ],
      [bounds.minX, bounds.minY, bounds.maxZ],
      [bounds.maxX, bounds.minY, bounds.maxZ],
      [bounds.minX, bounds.maxY, bounds.maxZ],
      [bounds.maxX, bounds.maxY, bounds.maxZ],
    ];
    let iMinX = Infinity, iMaxX = -Infinity, iMinY = Infinity, iMaxY = -Infinity;
    for (const [cx, cy, cz] of corners) {
      const sx = (cx - cz) * 0.866;
      const sy = (cx + cz) * 0.5 - cy;
      if (sx < iMinX) iMinX = sx;
      if (sx > iMaxX) iMaxX = sx;
      if (sy < iMinY) iMinY = sy;
      if (sy > iMaxY) iMaxY = sy;
    }
    const isoW = iMaxX - iMinX || 1;
    const isoH = iMaxY - iMinY || 1;
    const margin = 32;
    const scale = Math.min((W - margin * 2) / isoW, (H - margin * 2) / isoH);
    const offX = (W - isoW * scale) / 2 - iMinX * scale;
    const offY = (H - isoH * scale) / 2 - iMinY * scale;
    return { scale, offX, offY };
  }, [bounds]);

  /** Pre-compute SVG polyline point strings for each toolpath. */
  const isoPolylines = useMemo(() => {
    return result.toolpaths.map((path) => {
      const pts = path.map(v =>
        toIso(v.x, v.y, v.z, isoTransform.scale, isoTransform.offX, isoTransform.offY)
      );
      return pts.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');
    });
  }, [result.toolpaths, isoTransform]);

  // ── 2D Canvas draw ────────────────────────────────────────────────────────

  const draw = useCallback((prog: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    const toCanvas = (wx: number, wz: number) => ({
      x: ((wx - bounds.minX) / (bounds.maxX - bounds.minX)) * W,
      y: ((wz - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * H,
    });

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1c2028';
    ctx.lineWidth = 1;
    const gridStep = 10;
    const startX = Math.floor(bounds.minX / gridStep) * gridStep;
    const startZ = Math.floor(bounds.minZ / gridStep) * gridStep;
    for (let gx = startX; gx <= bounds.maxX; gx += gridStep) {
      const { x } = toCanvas(gx, 0);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let gz = startZ; gz <= bounds.maxZ; gz += gridStep) {
      const { y } = toCanvas(0, gz);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const targetDist = prog * totalDist;

    // Draw toolpaths: completed = accent, future = dim
    let distSoFar = 0;
    for (let pi = 0; pi < result.toolpaths.length; pi++) {
      const path = result.toolpaths[pi];
      if (path.length < 2) continue;

      for (let si = 1; si < path.length; si++) {
        const prev = path[si - 1];
        const cur = path[si];
        const dx = cur.x - prev.x;
        const dz = cur.z - prev.z;
        const segLen = Math.sqrt(dx * dx + dz * dz);
        const segStart = distSoFar;
        const segEnd = distSoFar + segLen;

        const pFrom = toCanvas(prev.x, prev.z);
        const pTo = toCanvas(cur.x, cur.z);

        if (segEnd <= targetDist) {
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(pFrom.x, pFrom.y);
          ctx.lineTo(pTo.x, pTo.y);
          ctx.stroke();
        } else if (segStart < targetDist) {
          const frac = segLen < 1e-6 ? 0 : (targetDist - segStart) / segLen;
          const midX = pFrom.x + (pTo.x - pFrom.x) * frac;
          const midY = pFrom.y + (pTo.y - pFrom.y) * frac;
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(pFrom.x, pFrom.y); ctx.lineTo(midX, midY); ctx.stroke();
          ctx.strokeStyle = '#2d333b';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(midX, midY); ctx.lineTo(pTo.x, pTo.y); ctx.stroke();
        } else {
          ctx.strokeStyle = '#2d333b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pFrom.x, pFrom.y);
          ctx.lineTo(pTo.x, pTo.y);
          ctx.stroke();
        }
        distSoFar += segLen;
      }
    }

    // Draw tool head
    if (totalDist > 0) {
      const toolPos = toolPosAt(prog, points, cumDist, totalDist);
      const tp = toCanvas(toolPos.x, toolPos.z);
      const toolPx = Math.max(4, (operation.toolDiameter / (bounds.maxX - bounds.minX)) * W);
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, toolPx / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6b35cc';
      ctx.fill();
      ctx.strokeStyle = '#ff6b35';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Origin marker
    const origin = toCanvas(0, 0);
    ctx.strokeStyle = '#ff000088';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(origin.x - 6, origin.y); ctx.lineTo(origin.x + 6, origin.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(origin.x, origin.y - 6); ctx.lineTo(origin.x, origin.y + 6); ctx.stroke();
  }, [bounds, result.toolpaths, totalDist, points, cumDist, operation.toolDiameter]);

  // Redraw 2D canvas whenever progress changes
  useEffect(() => {
    if (!view3d) draw(progress);
  }, [draw, progress, view3d]);

  // Redraw once when switching back to 2D
  useEffect(() => {
    if (!view3d) draw(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view3d]);

  // Playback loop
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return; }
    const simDurationMs = (result.estimatedTime * 60 * 1000) / speedFactor;
    const step = (now: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = now;
      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;
      setProgress(prev => {
        const next = prev + dt / simDurationMs;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, result.estimatedTime, speedFactor]);

  const reset = () => { setPlaying(false); setProgress(0); lastTimeRef.current = 0; };

  const togglePlay = () => {
    if (progress >= 1) reset();
    lastTimeRef.current = 0;
    setPlaying(v => !v);
  };

  // ── 3D tool head position (reactive to progress) ──────────────────────────
  const isoToolPos = useMemo(() => {
    if (totalDist === 0 || points.length === 0) return null;
    const wp = toolPosAt(progress, points, cumDist, totalDist);
    return toIso(wp.x, wp.y, wp.z, isoTransform.scale, isoTransform.offX, isoTransform.offY);
  }, [progress, points, cumDist, totalDist, isoTransform]);

  // How many distinct layer colors to show in legend (capped at 5)
  const legendCount = Math.min(result.toolpaths.length, 5);

  const distNow = progress * totalDist;
  const timeNow = progress * result.estimatedTime;

  // Tab button shared styles
  const tabBase: React.CSSProperties = {
    padding: '4px 14px', borderRadius: '6px 6px 0 0', fontSize: 11, fontWeight: 700,
    border: `1px solid ${C.border}`, borderBottom: 'none',
    cursor: 'pointer', transition: 'background 0.15s',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000000aa',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9000,
    }}>
      <div style={{
        width: 640, background: C.panel, borderRadius: 12,
        border: `1px solid ${C.border}`, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '10px 14px',
          borderBottom: `1px solid ${C.border}`, gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>⚙️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
              {t(lang, 'CAM 시뮬레이션', 'CAM Simulation')}
            </div>
            <div style={{ fontSize: 9, color: C.dim }}>
              {result.toolpaths.length}{t(lang, '개 패스 · 공구 Ø', ' passes · Tool Ø')}{operation.toolDiameter}mm
            </div>
          </div>
          <button onClick={onClose} style={{
            border: 'none', background: '#30363d', cursor: 'pointer',
            color: C.dim, width: 24, height: 24, borderRadius: 6, fontSize: 12,
          }}>✕</button>
        </div>

        {/* View toggle tabs */}
        <div style={{
          display: 'flex', gap: 4, padding: '6px 14px 0',
          background: C.panel, borderBottom: `1px solid ${C.border}`,
        }}>
          <button
            onClick={() => setView3d(false)}
            style={{
              ...tabBase,
              background: !view3d ? C.bg : 'transparent',
              color: !view3d ? C.accentBright : C.dim,
              borderColor: !view3d ? C.border : 'transparent',
            }}
          >
            {t(lang, '2D 상면', '2D Top-down')}
          </button>
          <button
            onClick={() => setView3d(true)}
            style={{
              ...tabBase,
              background: view3d ? C.bg : 'transparent',
              color: view3d ? C.accentBright : C.dim,
              borderColor: view3d ? C.border : 'transparent',
            }}
          >
            {t(lang, '3D 등각', '3D Isometric')}
          </button>
        </div>

        {/* Viewport: 2D canvas or 3D SVG */}
        <div style={{ position: 'relative', background: C.bg, lineHeight: 0 }}>
          {/* 2D Canvas — always mounted, hidden when in 3D view */}
          <canvas
            ref={canvasRef}
            width={638}
            height={380}
            style={{ display: view3d ? 'none' : 'block', background: C.bg }}
          />

          {/* 3D Isometric SVG — only rendered when view3d is true */}
          {view3d && (
            <svg
              width={638}
              height={380}
              style={{ display: 'block', background: C.bg }}
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Grid floor hint — faint horizontal lines at each Y level */}
              {result.toolpaths.map((path, pi) => {
                if (path.length < 2) return null;
                const color = LAYER_COLORS[pi % 5];
                return (
                  <polyline
                    key={pi}
                    points={isoPolylines[pi]}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeOpacity="0.65"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                );
              })}

              {/* "Completed path" overlay — same color but fully opaque up to progress */}
              {(() => {
                const targetDist = progress * totalDist;
                let distSoFar = 0;
                const segments: React.ReactNode[] = [];
                for (let pi = 0; pi < result.toolpaths.length; pi++) {
                  const path = result.toolpaths[pi];
                  const color = LAYER_COLORS[pi % 5];
                  for (let si = 1; si < path.length; si++) {
                    const prev = path[si - 1];
                    const cur = path[si];
                    const dx = cur.x - prev.x;
                    const dz = cur.z - prev.z;
                    const dy = cur.y - prev.y;
                    const segLen = Math.sqrt(dx * dx + dz * dz + dy * dy);
                    const segStart = distSoFar;
                    const segEnd = distSoFar + segLen;

                    if (segEnd <= targetDist) {
                      const a = toIso(prev.x, prev.y, prev.z, isoTransform.scale, isoTransform.offX, isoTransform.offY);
                      const b = toIso(cur.x, cur.y, cur.z, isoTransform.scale, isoTransform.offX, isoTransform.offY);
                      segments.push(
                        <line
                          key={`${pi}-${si}`}
                          x1={a.sx.toFixed(1)} y1={a.sy.toFixed(1)}
                          x2={b.sx.toFixed(1)} y2={b.sy.toFixed(1)}
                          stroke={color} strokeWidth="2"
                          strokeLinecap="round"
                        />
                      );
                    } else if (segStart < targetDist) {
                      const frac = segLen < 1e-6 ? 0 : (targetDist - segStart) / segLen;
                      const mx = prev.x + (cur.x - prev.x) * frac;
                      const my = prev.y + (cur.y - prev.y) * frac;
                      const mz = prev.z + (cur.z - prev.z) * frac;
                      const a = toIso(prev.x, prev.y, prev.z, isoTransform.scale, isoTransform.offX, isoTransform.offY);
                      const m = toIso(mx, my, mz, isoTransform.scale, isoTransform.offX, isoTransform.offY);
                      segments.push(
                        <line
                          key={`${pi}-${si}-p`}
                          x1={a.sx.toFixed(1)} y1={a.sy.toFixed(1)}
                          x2={m.sx.toFixed(1)} y2={m.sy.toFixed(1)}
                          stroke={color} strokeWidth="2"
                          strokeLinecap="round"
                        />
                      );
                    }
                    distSoFar += segLen;
                  }
                }
                return segments;
              })()}

              {/* Tool head */}
              {isoToolPos && (
                <g>
                  <circle
                    cx={isoToolPos.sx.toFixed(1)}
                    cy={isoToolPos.sy.toFixed(1)}
                    r="6"
                    fill="#ff6b35cc"
                    stroke="#ff6b35"
                    strokeWidth="1.5"
                  />
                  {/* Cross-hair */}
                  <line
                    x1={(isoToolPos.sx - 9).toFixed(1)} y1={isoToolPos.sy.toFixed(1)}
                    x2={(isoToolPos.sx + 9).toFixed(1)} y2={isoToolPos.sy.toFixed(1)}
                    stroke="#ff6b3588" strokeWidth="1"
                  />
                  <line
                    x1={isoToolPos.sx.toFixed(1)} y1={(isoToolPos.sy - 9).toFixed(1)}
                    x2={isoToolPos.sx.toFixed(1)} y2={(isoToolPos.sy + 9).toFixed(1)}
                    stroke="#ff6b3588" strokeWidth="1"
                  />
                </g>
              )}

              {/* Depth legend */}
              <g>
                {Array.from({ length: legendCount }, (_, i) => (
                  <g key={i} transform={`translate(10, ${10 + i * 18})`}>
                    <rect width="12" height="10" rx="2" fill={LAYER_COLORS[i]} />
                    <text x="16" y="9" fontSize="9" fill={C.dim} fontFamily="monospace">
                      {t(lang, `레이어 ${i + 1}`, `Layer ${i + 1}`)}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          )}
        </div>

        {/* Controls */}
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Progress bar / scrubber */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: C.dim, width: 52, flexShrink: 0 }}>
              {timeNow.toFixed(1)}{t(lang, '분', 'min')}
            </span>
            <input
              type="range" min={0} max={1000} value={Math.round(progress * 1000)}
              onChange={e => { setPlaying(false); lastTimeRef.current = 0; setProgress(parseInt(e.target.value) / 1000); }}
              style={{ flex: 1, accentColor: C.accent }}
            />
            <span style={{ fontSize: 10, color: C.dim, width: 52, textAlign: 'right', flexShrink: 0 }}>
              {result.estimatedTime.toFixed(1)}{t(lang, '분', 'min')}
            </span>
          </div>

          {/* Buttons + stats */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={reset} style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer',
            }}>⏮</button>
            <button onClick={togglePlay} style={{
              padding: '5px 16px', borderRadius: 6, fontSize: 12, fontWeight: 800,
              border: 'none',
              background: playing ? C.red : `linear-gradient(135deg, ${C.accent}, #1f6feb)`,
              color: '#fff', cursor: 'pointer',
            }}>
              {playing ? t(lang, '⏸ 일시정지', '⏸ Pause') : t(lang, '▶ 재생', '▶ Play')}
            </button>

            {/* Speed selector */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: C.dim }}>{t(lang, '속도', 'Speed')}</span>
              {([5, 10, 50, 200] as const).map(s => (
                <button key={s} onClick={() => setSpeedFactor(s)} style={{
                  padding: '3px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  border: `1px solid ${speedFactor === s ? C.accent : C.border}`,
                  background: speedFactor === s ? `${C.accent}22` : 'transparent',
                  color: speedFactor === s ? C.accentBright : C.dim, cursor: 'pointer',
                }}>{s}×</button>
              ))}
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 16, fontSize: 10, color: C.dim }}>
            <span>{t(lang, '경로 길이', 'Path')}: <strong style={{ color: C.text }}>{distNow.toFixed(0)}/{result.totalLength.toFixed(0)} mm</strong></span>
            <span>{t(lang, '패스', 'Passes')}: <strong style={{ color: C.text }}>{result.passes}</strong></span>
            <span>{t(lang, '이송속도', 'Feed')}: <strong style={{ color: C.text }}>{operation.feedRate} mm/min</strong></span>
            <span>{t(lang, '회전수', 'RPM')}: <strong style={{ color: C.text }}>{operation.spindleSpeed}</strong></span>
          </div>

          {result.warnings.length > 0 && (
            <div style={{ fontSize: 10, color: '#d29922' }}>
              {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
