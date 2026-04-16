'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type {
  SketchProfile, SketchPoint, SketchSegment, SketchTool,
  SketchConstraint, SketchDimension, ConstraintType,
} from './types';

type SketchLang = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

const SKETCH_MSG = {
  toolSwitchSaved: {
    ko: (n: number) => `선 ${n}개 자동 저장됨`,
    en: (n: number) => `Auto-saved ${n} line${n > 1 ? 's' : ''}`,
    ja: (n: number) => `線 ${n}本 自動保存`,
    cn: (n: number) => `自动保存 ${n} 条线`,
    es: (n: number) => `${n} línea${n > 1 ? 's' : ''} guardadas`,
    ar: (n: number) => `تم حفظ ${n} خط تلقائياً`,
  },
  discarded: {
    ko: (n: number) => `진행 중 ${n}점 취소됨 (Ctrl+Z로 복구)`,
    en: (n: number) => `Discarded ${n} in-progress point${n > 1 ? 's' : ''} (Ctrl+Z to undo)`,
    ja: (n: number) => `進行中の ${n} 点を破棄 (Ctrl+Zで復元)`,
    cn: (n: number) => `已丢弃 ${n} 个进行中的点 (Ctrl+Z 撤销)`,
    es: (n: number) => `${n} punto${n > 1 ? 's' : ''} descartado${n > 1 ? 's' : ''} (Ctrl+Z)`,
    ar: (n: number) => `تم التخلص من ${n} نقطة (Ctrl+Z للتراجع)`,
  },
  cancelled: {
    ko: '그리기 취소됨', en: 'Drawing cancelled', ja: '描画キャンセル',
    cn: '取消绘制', es: 'Dibujo cancelado', ar: 'تم إلغاء الرسم',
  },
  toSelect: {
    ko: '선택 도구로 전환', en: 'Switched to Select', ja: '選択ツールに切替',
    cn: '切换到选择工具', es: 'Herramienta seleccionar', ar: 'أداة التحديد',
  },
  closed: {
    ko: '프로파일이 닫혔습니다', en: 'Profile closed', ja: 'プロファイルを閉じました',
    cn: '轮廓已闭合', es: 'Perfil cerrado', ar: 'تم إغلاق الملف',
  },
  deleted: {
    ko: (n: number) => `${n}개 세그먼트 삭제됨`,
    en: (n: number) => `Deleted ${n} segment${n > 1 ? 's' : ''}`,
    ja: (n: number) => `${n} セグメント削除`,
    cn: (n: number) => `已删除 ${n} 个线段`,
    es: (n: number) => `${n} segmento${n > 1 ? 's' : ''} eliminado${n > 1 ? 's' : ''}`,
    ar: (n: number) => `تم حذف ${n} مقاطع`,
  },
  intersect: {
    ko: '⚠ 자기 교차 감지 — 돌출 전 수정하세요',
    en: '⚠ Self-intersection detected — fix before extrude',
    ja: '⚠ 自己交差を検出 — 押し出し前に修正',
    cn: '⚠ 检测到自相交 — 拉伸前修正',
    es: '⚠ Auto-intersección detectada',
    ar: '⚠ تقاطع ذاتي مكتشف',
  },
  dimHint: {
    ko: '숫자 입력 → Enter: 정확한 길이',
    en: 'Type number → Enter for exact length',
    ja: '数値入力 → Enterで正確な長さ',
    cn: '输入数字 → Enter 精确长度',
    es: 'Número → Enter para longitud exacta',
    ar: 'اكتب رقمًا → Enter لطول دقيق',
  },
} as const;

interface SketchCanvasProps {
  profile: SketchProfile;
  onProfileChange: (profile: SketchProfile) => void;
  activeTool: SketchTool;
  width: number;
  height: number;
  lang?: SketchLang;
  onUndo?: () => void;
  // Existing tool params
  circleRadius?: number;
  rectWidth?: number;
  rectHeight?: number;
  polygonSides?: number;
  // New tool params
  ellipseRx?: number;
  ellipseRy?: number;
  slotRadius?: number;
  filletRadius?: number;
  // Constraint / dimension state
  constraints?: SketchConstraint[];
  dimensions?: SketchDimension[];
  onAddConstraint?: (constraint: SketchConstraint) => void;
  onAddDimension?: (dimension: SketchDimension) => void;
  selectedConstraintType?: ConstraintType;
  // Multi-profile: other profiles shown as dimmed reference outlines
  otherProfiles?: SketchProfile[];
  onToolChange?: (tool: SketchTool) => void;
  // Grid visibility
  showGrid?: boolean;
}

// ─── Named constants ─────────────────────────────────────────────────────────

const SNAP_GRID_SIZE = 5;        // grid cell size in mm
const SNAP_GRID_PX = 8;          // grid snap threshold in pixels
const SNAP_POINT_PX = 12;        // endpoint snap radius in pixels
const ENDPOINT_EPSILON = 1e-10;  // floating point equality tolerance

// ─── ID generator ───────────────────────────────────────────────────────────
// Module-level counter is intentionally stable across re-renders;
// IDs only need to be unique within a session, not across SSR/client.
// genId is called only in event handlers and helper functions (never during render),
// so it does not cause hydration mismatches.
let _idCounter = 0;
function genId(prefix: string = 'e'): string {
  return `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

// ─── Self-intersection detection ────────────────────────────────────────────
// 두 선분 AB, CD가 교차하는지 검사 (끝점 공유는 교차로 간주하지 않음)
function segmentsIntersect(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number }
): boolean {
  const eps = 1e-9;
  // 끝점이 거의 같으면 교차가 아닌 연결점
  const sameEnd = (p: {x:number;y:number}, q: {x:number;y:number}) =>
    Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps;
  if (sameEnd(a, c) || sameEnd(a, d) || sameEnd(b, c) || sameEnd(b, d)) return false;
  const d1 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
  const d2 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  const d3 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d4 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function snap(val: number, gridSize: number, pxThreshold: number, scale: number): number {
  const nearest = Math.round(val / gridSize) * gridSize;
  if (Math.abs(val - nearest) * scale < pxThreshold) return nearest;
  return val;
}

function snapPoint(p: SketchPoint, scale: number): SketchPoint {
  return { x: snap(p.x, SNAP_GRID_SIZE, SNAP_GRID_PX, scale), y: snap(p.y, SNAP_GRID_SIZE, SNAP_GRID_PX, scale) };
}

function dist(a: SketchPoint, b: SketchPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Compute center of a circle through 3 points. Returns null if colinear. */
function circleThrough3(p1: SketchPoint, p2: SketchPoint, p3: SketchPoint): { cx: number; cy: number; r: number } | null {
  const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < ENDPOINT_EPSILON) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  return { cx: ux, cy: uy, r: Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2) };
}

/** Generate SVG arc path from 3 points */
function arcPathFromPoints(start: SketchPoint, through: SketchPoint, end: SketchPoint): string {
  const circle = circleThrough3(start, through, end);
  if (!circle) return `L ${end.x} ${-end.y}`;
  const r = circle.r;
  const cross = (through.x - start.x) * (end.y - start.y) - (through.y - start.y) * (end.x - start.x);
  const sweepFlag = cross > 0 ? 0 : 1;
  const angleStart = Math.atan2(start.y - circle.cy, start.x - circle.cx);
  const angleThrough = Math.atan2(through.y - circle.cy, through.x - circle.cx);
  const angleEnd = Math.atan2(end.y - circle.cy, end.x - circle.cx);

  function normalizeAngle(a: number, ref: number): number {
    while (a < ref) a += 2 * Math.PI;
    while (a > ref + 2 * Math.PI) a -= 2 * Math.PI;
    return a;
  }

  const aEnd = normalizeAngle(angleEnd, angleStart);
  const aThrough = normalizeAngle(angleThrough, angleStart);
  const largeArc = (aThrough < aEnd) ? 0 : 1;
  const largeArcFlag = largeArc ^ sweepFlag;

  return `A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${-end.y}`;
}

/** Approximate arc points for preview */
function sampleArc(start: SketchPoint, through: SketchPoint, end: SketchPoint, n: number = 20): SketchPoint[] {
  const circle = circleThrough3(start, through, end);
  if (!circle) return [start, end];
  const { cx, cy, r } = circle;
  const a1 = Math.atan2(start.y - cy, start.x - cx);
  let a2 = Math.atan2(end.y - cy, end.x - cx);
  const aMid = Math.atan2(through.y - cy, through.x - cx);

  function normAngle(a: number, ref: number): number {
    while (a < ref) a += 2 * Math.PI;
    while (a > ref + 2 * Math.PI) a -= 2 * Math.PI;
    return a;
  }
  a2 = normAngle(a2, a1);
  const aMidN = normAngle(aMid, a1);

  let sweep: number;
  if (aMidN <= a2) {
    sweep = a2 - a1;
  } else {
    sweep = a2 - a1 - 2 * Math.PI;
  }

  const pts: SketchPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a1 + sweep * t;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Generate circle points approximated as line segments */
function generateCircleSegments(center: SketchPoint, radius: number, sides: number = 32): SketchSegment[] {
  const segs: SketchSegment[] = [];
  for (let i = 0; i < sides; i++) {
    const a1 = (2 * Math.PI * i) / sides;
    const a2 = (2 * Math.PI * (i + 1)) / sides;
    segs.push({
      type: 'line',
      points: [
        { x: center.x + radius * Math.cos(a1), y: center.y + radius * Math.sin(a1), id: genId('cp') },
        { x: center.x + radius * Math.cos(a2), y: center.y + radius * Math.sin(a2), id: genId('cp') },
      ],
      id: genId('cseg'),
    });
  }
  return segs;
}

/** Generate rectangle as 4 line segments */
function generateRectSegments(corner1: SketchPoint, corner2: SketchPoint): SketchSegment[] {
  const tl: SketchPoint = { x: Math.min(corner1.x, corner2.x), y: Math.max(corner1.y, corner2.y), id: genId('rp') };
  const tr: SketchPoint = { x: Math.max(corner1.x, corner2.x), y: Math.max(corner1.y, corner2.y), id: genId('rp') };
  const br: SketchPoint = { x: Math.max(corner1.x, corner2.x), y: Math.min(corner1.y, corner2.y), id: genId('rp') };
  const bl: SketchPoint = { x: Math.min(corner1.x, corner2.x), y: Math.min(corner1.y, corner2.y), id: genId('rp') };
  return [
    { type: 'line', points: [tl, tr], id: genId('rseg') },
    { type: 'line', points: [tr, br], id: genId('rseg') },
    { type: 'line', points: [br, bl], id: genId('rseg') },
    { type: 'line', points: [bl, tl], id: genId('rseg') },
  ];
}

/** Generate regular polygon segments */
function generatePolygonSegments(center: SketchPoint, radiusPt: SketchPoint, sides: number): SketchSegment[] {
  const r = dist(center, radiusPt);
  const baseAngle = Math.atan2(radiusPt.y - center.y, radiusPt.x - center.x);
  const segs: SketchSegment[] = [];
  const pts: SketchPoint[] = [];
  for (let i = 0; i < sides; i++) {
    const a = baseAngle + (2 * Math.PI * i) / sides;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a), id: genId('pp') });
  }
  for (let i = 0; i < sides; i++) {
    segs.push({
      type: 'line',
      points: [pts[i], pts[(i + 1) % sides]],
      id: genId('pseg'),
    });
  }
  return segs;
}

/** Generate ellipse approximated as line segments */
function generateEllipseSegments(center: SketchPoint, rx: number, ry: number, sides: number = 36): SketchSegment[] {
  const segs: SketchSegment[] = [];
  for (let i = 0; i < sides; i++) {
    const a1 = (2 * Math.PI * i) / sides;
    const a2 = (2 * Math.PI * (i + 1)) / sides;
    segs.push({
      type: 'line',
      points: [
        { x: center.x + rx * Math.cos(a1), y: center.y + ry * Math.sin(a1), id: genId('ep') },
        { x: center.x + rx * Math.cos(a2), y: center.y + ry * Math.sin(a2), id: genId('ep') },
      ],
      id: genId('eseg'),
    });
  }
  // Store center info on first segment for geometry snap
  if (segs.length > 0) {
    (segs[0] as SketchSegment & { _ellipseCenter?: SketchPoint })._ellipseCenter = center;
  }
  return segs;
}

/** Generate slot: two semicircles + two tangent lines */
function generateSlotSegments(c1: SketchPoint, c2: SketchPoint, radius: number, sides: number = 32): SketchSegment[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return generateEllipseSegments(c1, radius, radius);
  // Perpendicular direction (normalised)
  const nx = -dy / len;
  const ny = dx / len;
  const segs: SketchSegment[] = [];
  const halfSides = Math.floor(sides / 2);
  // Direction angle of c1→c2
  const baseAngle = Math.atan2(dy, dx);
  // Cap 1 (at c1, facing away from c2)
  for (let i = 0; i < halfSides; i++) {
    const a1 = baseAngle + Math.PI / 2 + (Math.PI * i) / halfSides;
    const a2 = baseAngle + Math.PI / 2 + (Math.PI * (i + 1)) / halfSides;
    segs.push({
      type: 'line',
      points: [
        { x: c1.x + radius * Math.cos(a1), y: c1.y + radius * Math.sin(a1), id: genId('sp') },
        { x: c1.x + radius * Math.cos(a2), y: c1.y + radius * Math.sin(a2), id: genId('sp') },
      ],
      id: genId('slseg'),
    });
  }
  // Top tangent line: c1 top → c2 top
  segs.push({
    type: 'line',
    points: [
      { x: c1.x + nx * radius, y: c1.y + ny * radius, id: genId('sp') },
      { x: c2.x + nx * radius, y: c2.y + ny * radius, id: genId('sp') },
    ],
    id: genId('slseg'),
  });
  // Cap 2 (at c2, facing away from c1)
  for (let i = 0; i < halfSides; i++) {
    const a1 = baseAngle - Math.PI / 2 + (Math.PI * i) / halfSides;
    const a2 = baseAngle - Math.PI / 2 + (Math.PI * (i + 1)) / halfSides;
    segs.push({
      type: 'line',
      points: [
        { x: c2.x + radius * Math.cos(a1), y: c2.y + radius * Math.sin(a1), id: genId('sp') },
        { x: c2.x + radius * Math.cos(a2), y: c2.y + radius * Math.sin(a2), id: genId('sp') },
      ],
      id: genId('slseg'),
    });
  }
  // Bottom tangent line: c2 bottom → c1 bottom
  segs.push({
    type: 'line',
    points: [
      { x: c2.x - nx * radius, y: c2.y - ny * radius, id: genId('sp') },
      { x: c1.x - nx * radius, y: c1.y - ny * radius, id: genId('sp') },
    ],
    id: genId('slseg'),
  });
  return segs;
}

/** Apply fillet between two lines meeting at a vertex — replaces the corner with an arc */
function applyFilletAtVertex(
  segments: SketchSegment[],
  vertexPt: SketchPoint,
  radius: number,
  eps: number = 1,
): SketchSegment[] {
  // Find the two line segments that share this vertex
  const sharesVertex = (seg: SketchSegment, pt: SketchPoint): 0 | 1 | -1 => {
    if (seg.type !== 'line' || seg.points.length < 2) return 0;
    if (dist(seg.points[0], pt) < eps) return 1;
    if (dist(seg.points[seg.points.length - 1], pt) < eps) return -1;
    return 0;
  };
  const matched: Array<{ idx: number; end: 0 | 1 | -1 }> = [];
  for (let i = 0; i < segments.length; i++) {
    const e = sharesVertex(segments[i], vertexPt);
    if (e !== 0) matched.push({ idx: i, end: e });
  }
  if (matched.length < 2) return segments;
  const [m0, m1] = matched;
  const s0 = segments[m0.idx];
  const s1 = segments[m1.idx];
  // Direction from vertex along each segment
  const dir0 = m0.end === 1
    ? { x: s0.points[1].x - s0.points[0].x, y: s0.points[1].y - s0.points[0].y }
    : { x: s0.points[0].x - s0.points[s0.points.length - 1].x, y: s0.points[0].y - s0.points[s0.points.length - 1].y };
  const dir1 = m1.end === 1
    ? { x: s1.points[1].x - s1.points[0].x, y: s1.points[1].y - s1.points[0].y }
    : { x: s1.points[0].x - s1.points[s1.points.length - 1].x, y: s1.points[0].y - s1.points[s1.points.length - 1].y };
  const len0 = Math.sqrt(dir0.x ** 2 + dir0.y ** 2);
  const len1 = Math.sqrt(dir1.x ** 2 + dir1.y ** 2);
  if (len0 < 0.01 || len1 < 0.01) return segments;
  const u0 = { x: dir0.x / len0, y: dir0.y / len0 };
  const u1 = { x: dir1.x / len1, y: dir1.y / len1 };
  // Setback distance
  const dot = u0.x * u1.x + u0.y * u1.y;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const setback = angle < 0.01 ? radius : radius / Math.tan(angle / 2);
  if (setback > Math.min(len0, len1) * 0.9) return segments; // radius too large
  // Fillet tangent points
  const tp0: SketchPoint = { x: vertexPt.x + u0.x * setback, y: vertexPt.y + u0.y * setback, id: genId('fp') };
  const tp1: SketchPoint = { x: vertexPt.x + u1.x * setback, y: vertexPt.y + u1.y * setback, id: genId('fp') };
  // Mid-arc point (bisector direction)
  const bisLen = Math.sqrt((u0.x + u1.x) ** 2 + (u0.y + u1.y) ** 2);
  const midDir = bisLen > 0.001
    ? { x: (u0.x + u1.x) / bisLen, y: (u0.y + u1.y) / bisLen }
    : { x: -u0.y, y: u0.x };
  const arcMidDist = radius / Math.max(0.01, Math.cos((Math.PI - angle) / 2));
  const arcMid: SketchPoint = { x: vertexPt.x + midDir.x * arcMidDist * 0.7, y: vertexPt.y + midDir.y * arcMidDist * 0.7, id: genId('fp') };
  // Trim segments
  const newSegs = segments.map((seg, i) => {
    if (i === m0.idx) {
      if (m0.end === 1) return { ...seg, points: [tp0, ...seg.points.slice(1)] };
      const pts = [...seg.points]; pts[pts.length - 1] = tp0; return { ...seg, points: pts };
    }
    if (i === m1.idx) {
      if (m1.end === 1) return { ...seg, points: [tp1, ...seg.points.slice(1)] };
      const pts = [...seg.points]; pts[pts.length - 1] = tp1; return { ...seg, points: pts };
    }
    return seg;
  });
  // Insert fillet arc
  const arcSeg: SketchSegment = { type: 'arc', points: [tp0, arcMid, tp1], id: genId('fillet') };
  const insertIdx = Math.max(m0.idx, m1.idx) + 1;
  newSegs.splice(insertIdx, 0, arcSeg);
  return newSegs;
}

/** Mirror all segments about a vertical or horizontal axis through the given point */
function mirrorSegments(segs: SketchSegment[], axis: 'x' | 'y', pivot: number): SketchSegment[] {
  return segs.map(seg => ({
    ...seg,
    id: genId('mir'),
    points: seg.points.map(p => ({
      ...p,
      id: genId('mirp'),
      x: axis === 'y' ? 2 * pivot - p.x : p.x,
      y: axis === 'x' ? 2 * pivot - p.y : p.y,
    })),
  }));
}

/** Convert N Catmull-Rom control points into line-segment approximations */
function catmullRomToSegments(points: SketchPoint[], tension = 0.5): Array<{ start: SketchPoint; end: SketchPoint }> {
  if (points.length < 2) return [];
  const segs: Array<{ start: SketchPoint; end: SketchPoint }> = [];
  const steps = 12; // line segments per span

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    let prev = p1;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2*p0.x - 5*p1.x + 4*p2.x - p3.x) * t2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2*p0.y - 5*p1.y + 4*p2.y - p3.y) * t2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y) * t3);
      const curr = { x, y };
      segs.push({ start: { ...prev }, end: { ...curr } });
      prev = curr;
    }
  }
  // suppress unused-variable warning for tension param (reserved for future use)
  void tension;
  return segs;
}

/** Find intersection of two line segments. Returns intersection point or null. */
function lineLineIntersect(a1: SketchPoint, a2: SketchPoint, b1: SketchPoint, b2: SketchPoint): SketchPoint | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / cross;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / cross;
  if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/** Trim a line segment at its nearest intersection with any other segment in the profile.
 *  Returns trimmed segment or null if no intersections found. */
function trimSegmentAtIntersections(
  seg: SketchSegment,
  allSegs: SketchSegment[],
  clickPt: SketchPoint,
): SketchSegment | null {
  if (seg.type !== 'line' || seg.points.length < 2) return null;
  const [p0, p1] = seg.points;

  // Collect all intersection points along this segment
  const intersections: Array<{ t: number; pt: SketchPoint }> = [];
  for (const other of allSegs) {
    if (other === seg) continue;
    if (other.type === 'line' && other.points.length >= 2) {
      const ip = lineLineIntersect(p0, p1, other.points[0], other.points[1]);
      if (ip) {
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? ((ip.x - p0.x) * dx + (ip.y - p0.y) * dy) / len2 : 0;
        if (t > 0.001 && t < 0.999) {
          intersections.push({ t, pt: ip });
        }
      }
    }
  }
  if (intersections.length === 0) return null;
  intersections.sort((a, b) => a.t - b.t);

  // Determine which portion the click point is in — find its t
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len2 = dx * dx + dy * dy;
  const clickT = len2 > 0 ? ((clickPt.x - p0.x) * dx + (clickPt.y - p0.y) * dy) / len2 : 0;

  // Find boundary intersections: the first one before and after clickT
  const before = intersections.filter(i => i.t <= clickT);
  const after = intersections.filter(i => i.t > clickT);

  const newP0 = before.length > 0 ? { ...before[before.length - 1].pt, id: genId('tp') } : p0;
  const newP1 = after.length > 0 ? { ...after[0].pt, id: genId('tp') } : p1;

  return { ...seg, points: [newP0, newP1], id: genId('seg') };
}

/** Offset a segment by a perpendicular distance */
function offsetSegment(seg: SketchSegment, distance: number): SketchSegment | null {
  if (seg.type === 'line' && seg.points.length >= 2) {
    const p0 = seg.points[0];
    const p1 = seg.points[1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return null;
    const nx = -dy / len;
    const ny = dx / len;
    return {
      ...seg,
      id: genId('offseg'),
      points: [
        { x: p0.x + nx * distance, y: p0.y + ny * distance, id: genId('offp') },
        { x: p1.x + nx * distance, y: p1.y + ny * distance, id: genId('offp') },
      ],
    };
  }
  if (seg.type === 'arc' && seg.points.length === 3) {
    // Arc: find center, offset radius by distance
    const [start, through, end] = seg.points;
    const ax = start.x, ay = start.y, bx = through.x, by = through.y, cx = end.x, cy = end.y;
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return null;
    const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
    const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
    const r = Math.sqrt((ax-ux)**2 + (ay-uy)**2);
    const newR = r + distance;
    if (newR <= 0) return null;
    // Scale each point outward from center
    const scalePoint = (p: SketchPoint): SketchPoint => {
      const dr = Math.sqrt((p.x-ux)**2 + (p.y-uy)**2);
      if (dr < 0.001) return p;
      const f = newR / dr;
      return { x: ux + (p.x-ux)*f, y: uy + (p.y-uy)*f, id: genId('offp') };
    };
    return { ...seg, id: genId('offseg'), points: [scalePoint(start), scalePoint(through), scalePoint(end)] };
  }
  return null;
}

/** Find nearest segment to a point (in mm coords) */
function findNearestSegment(
  segments: SketchSegment[],
  pt: SketchPoint,
  threshold: number,
): { index: number; distance: number } | null {
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'line' && seg.points.length >= 2) {
      const a = seg.points[0];
      const b = seg.points[1];
      // Point-to-segment distance
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      let t = 0;
      if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
      }
      const proj = { x: a.x + t * dx, y: a.y + t * dy };
      const d = dist(pt, proj);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    } else if (seg.type === 'arc' && seg.points.length >= 3) {
      const circle = circleThrough3(seg.points[0], seg.points[1], seg.points[2]);
      if (circle) {
        const d = Math.abs(dist(pt, { x: circle.cx, y: circle.cy }) - circle.r);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
    }
  }

  if (bestIdx >= 0 && bestDist <= threshold) {
    return { index: bestIdx, distance: bestDist };
  }
  return null;
}

// ─── Component ──────────────────────────────────────────────────────────────

function SketchCanvas({
  profile, onProfileChange, activeTool, width, height, lang = 'en', onUndo,
  circleRadius = 25, rectWidth = 50, rectHeight = 30, polygonSides = 6,
  ellipseRx = 25, ellipseRy = 15, slotRadius = 10, filletRadius = 5,
  constraints = [], dimensions = [],
  onAddConstraint, onAddDimension,
  selectedConstraintType = 'horizontal',
  otherProfiles = [],
  onToolChange,
  showGrid = true,
}: SketchCanvasProps) {
  const L = (key: keyof typeof SKETCH_MSG): any => {
    const m = SKETCH_MSG[key] as any;
    return m[lang] ?? m.en;
  };
  const svgRef = useRef<SVGSVGElement>(null);

  // Track actual rendered SVG size (may differ from props when CSS width/height: 100% is applied)
  const [svgSize, setSvgSize] = useState({ width, height });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0].contentRect;
      if (w > 0 && h > 0) setSvgSize({ width: Math.floor(w), height: Math.floor(h) });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Ctrl+Z undo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (onUndo) {
          onUndo();
        } else if (profile.segments.length > 0) {
          onProfileChange({ segments: profile.segments.slice(0, -1), closed: false });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUndo, profile, onProfileChange]);

  // View state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Canvas controls: grid visibility + snap enabled (internal toggles, initialized from props)
  const [gridVisible, setGridVisible] = useState(showGrid);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Smart dimension pending edit: after clicking a segment, show editable input before committing
  const [pendingDim, setPendingDim] = useState<{
    segIdx: number; entityId: string;
    value: number; editValue: string;
    position: SketchPoint;
  } | null>(null);

  // Drawing state
  const [tempPoints, setTempPoints] = useState<SketchPoint[]>([]);
  const [mousePos, setMousePos] = useState<SketchPoint>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ mx: number; my: number; px: number; py: number }>({ mx: 0, my: 0, px: 0, py: 0 });

  // Hover state for trim tool
  const [hoverSegIdx, setHoverSegIdx] = useState<number>(-1);

  // Selection state (select tool: click segment to select, Delete to remove)
  const [selectedSegIdx, setSelectedSegIdx] = useState<number>(-1);

  // Point drag state (select tool: drag a point to move it, solver will re-constrain)
  const [dragPoint, setDragPoint] = useState<{ segIdx: number; ptIdx: number } | null>(null);
  const isDraggingPointRef = useRef(false);

  // Dimension inline input (line tool: 첫 점 클릭 후 숫자 입력 → Enter로 정확한 길이 커밋)
  const [dimInput, setDimInput] = useState<string>('');

  // Spline control points state
  const [splinePoints, setSplinePoints] = useState<SketchPoint[]>([]);

  // Transient toast for non-silent feedback (tool change discard, ESC cancel, etc.)
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // ── Smart snap state ──────────────────────────────────────────────────────
  const isShiftHeld = useRef(false);
  type SnapType = 'none' | 'grid' | 'endpoint' | 'angle';
  const [snapType, setSnapType] = useState<SnapType>('none');
  const [snapTarget, setSnapTarget] = useState<SketchPoint | null>(null);

  // Track Shift key globally
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { isShiftHeld.current = e.shiftKey; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  }, []);

  // Collect all existing snap points: endpoints + midpoints + circle/ellipse centers
  const allEndpoints = useMemo((): SketchPoint[] => {
    const pts: SketchPoint[] = [];
    for (const seg of profile.segments) {
      if (seg.construction) continue; // skip construction lines for snap
      for (const p of seg.points) pts.push(p);
      // Midpoint of line segments
      if (seg.type === 'line' && seg.points.length === 2) {
        pts.push({
          x: (seg.points[0].x + seg.points[1].x) / 2,
          y: (seg.points[0].y + seg.points[1].y) / 2,
        });
      }
    }
    return pts;
  }, [profile.segments]);

  // Convert screen coords to mm coords
  const screenToMm = useCallback((clientX: number, clientY: number): SketchPoint => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    // Use actual rendered size (rect) instead of props to handle CSS 100% scaling
    const mmX = (sx - rect.width / 2) / zoom + panX;
    const mmY = -((sy - rect.height / 2) / zoom + panY);
    return { x: mmX, y: mmY };
  }, [zoom, panX, panY]);

  // ── Smart snap: endpoint > angle(Shift) > grid ────────────────────────────
  const smartSnap = useCallback((clientX: number, clientY: number): { pt: SketchPoint; type: SnapType } => {
    const raw = screenToMm(clientX, clientY);

    // 1. Endpoint snap (SNAP_POINT_PX screen threshold)
    for (const ep of allEndpoints) {
      if (dist(raw, ep) * zoom < SNAP_POINT_PX) {
        return { pt: { x: ep.x, y: ep.y }, type: 'endpoint' };
      }
    }

    // 2. Angle snap when Shift held and we have a reference point
    const lastPt = (() => {
      if (tempPoints.length > 0) return tempPoints[tempPoints.length - 1];
      if (profile.segments.length > 0) {
        const last = profile.segments[profile.segments.length - 1];
        return last.points[last.points.length - 1];
      }
      return null;
    })();

    if (isShiftHeld.current && lastPt) {
      const dx = raw.x - lastPt.x;
      const dy = raw.y - lastPt.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.1) {
        const angle = Math.atan2(dy, dx);
        // Snap to 45° increments
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const snappedX = snap(lastPt.x + len * Math.cos(snapAngle), 5, 8, zoom);
        const snappedY = snap(lastPt.y + len * Math.sin(snapAngle), 5, 8, zoom);
        return { pt: { x: snappedX, y: snappedY }, type: 'angle' };
      }
    }

    // 3. Grid snap (default) — skip if snap disabled
    if (!snapEnabled) return { pt: raw, type: 'none' };
    return { pt: snapPoint(raw, zoom), type: 'grid' };
  }, [screenToMm, allEndpoints, zoom, tempPoints, profile.segments, snapEnabled]);

  // Get the first point of the entire profile (for closing detection)
  const getFirstPoint = useCallback((): SketchPoint | null => {
    if (profile.segments.length > 0) return profile.segments[0].points[0];
    if (tempPoints.length > 0) return tempPoints[0];
    return null;
  }, [profile.segments, tempPoints]);

  // Get the last placed point
  const getLastPoint = useCallback((): SketchPoint | null => {
    if (tempPoints.length > 0) return tempPoints[tempPoints.length - 1];
    if (profile.segments.length > 0) {
      const last = profile.segments[profile.segments.length - 1];
      return last.points[last.points.length - 1];
    }
    return null;
  }, [tempPoints, profile.segments]);

  // Fit-to-view: compute bounding box of all drawn points and adjust zoom/pan
  const fitToView = useCallback(() => {
    const allPts = [
      ...profile.segments.flatMap(s => s.points),
      ...otherProfiles.flatMap(p => p.segments.flatMap(s => s.points)),
    ];
    if (allPts.length === 0) { setZoom(1); setPanX(0); setPanY(0); return; }
    const xs = allPts.map(p => p.x);
    const ys = allPts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rangeX = Math.max(maxX - minX, 10);
    const rangeY = Math.max(maxY - minY, 10);
    const newZoom = Math.min(
      (svgSize.width * 0.8) / rangeX,
      (svgSize.height * 0.8) / rangeY,
      8,
    );
    setZoom(newZoom);
    setPanX(cx);
    setPanY(-cy); // SVG Y is inverted: center mm Y → -cy in viewBox space
  }, [profile.segments, otherProfiles, svgSize]);

  const isNearFirst = useCallback((p: SketchPoint): boolean => {
    const first = getFirstPoint();
    if (!first) return false;
    return dist(p, first) * zoom < SNAP_POINT_PX;
  }, [getFirstPoint, zoom]);

  // Close the profile
  const closeProfile = useCallback(() => {
    const first = getFirstPoint();
    const last = getLastPoint();
    if (!first || !last) return;
    if (dist(first, last) > 0.01) {
      const newSegments = [...profile.segments, { type: 'line' as const, points: [last, first], id: genId('seg') }];
      onProfileChange({ segments: newSegments, closed: true });
    } else {
      onProfileChange({ ...profile, closed: true });
    }
    setTempPoints([]);
  }, [getFirstPoint, getLastPoint, profile, onProfileChange]);

  // ─── Click handler ──────────────────────────────────────────────────────

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isPanning) return;

    const { pt } = smartSnap(e.clientX, e.clientY);

    // ── Select tool: click nearest segment (Delete 키로 삭제 가능) ──
    if (activeTool === 'select') {
      const nearest = findNearestSegment(profile.segments, pt, 15 / zoom);
      setSelectedSegIdx(nearest ? nearest.index : -1);
      return;
    }

    // ── Line tool ───────────────────────────────────────
    if (activeTool === 'line') {
      if (profile.closed) return;
      // Check if clicking near first point to close
      if ((profile.segments.length > 0 || tempPoints.length > 1) && isNearFirst(pt)) {
        closeProfile();
        return;
      }
      if (tempPoints.length === 0) {
        const last = getLastPoint();
        if (last) {
          const newSeg: SketchSegment = { type: 'line', points: [last, { ...pt, id: genId('p') }], id: genId('seg') };
          onProfileChange({ ...profile, segments: [...profile.segments, newSeg] });
        } else {
          setTempPoints([{ ...pt, id: genId('p') }]);
        }
      } else {
        const start = tempPoints[tempPoints.length - 1];
        const newSeg: SketchSegment = { type: 'line', points: [start, { ...pt, id: genId('p') }], id: genId('seg') };
        onProfileChange({ ...profile, segments: [...profile.segments, newSeg] });
        setTempPoints([]);
      }
      return;
    }

    // ── Arc tool ────────────────────────────────────────
    if (activeTool === 'arc') {
      if (profile.closed) return;
      if ((profile.segments.length > 0 || tempPoints.length > 1) && isNearFirst(pt)) {
        closeProfile();
        return;
      }
      const last = getLastPoint();
      if (tempPoints.length === 0 && !last) {
        setTempPoints([{ ...pt, id: genId('p') }]);
      } else if (tempPoints.length === 0 && last) {
        setTempPoints([last, { ...pt, id: genId('p') }]);
      } else if (tempPoints.length === 1) {
        setTempPoints([tempPoints[0], { ...pt, id: genId('p') }]);
      } else if (tempPoints.length === 2) {
        const newSeg: SketchSegment = { type: 'arc', points: [tempPoints[0], tempPoints[1], { ...pt, id: genId('p') }], id: genId('seg') };
        onProfileChange({ ...profile, segments: [...profile.segments, newSeg] });
        setTempPoints([]);
      }
      return;
    }

    // ── Circle tool ─────────────────────────────────────
    if (activeTool === 'circle') {
      if (tempPoints.length === 0) {
        // First click: center
        setTempPoints([{ ...pt, id: genId('p') }]);
      } else {
        // Second click: radius point
        const center = tempPoints[0];
        const r = dist(center, pt);
        const radius = r > 0.5 ? r : circleRadius;
        const circleSegs = generateCircleSegments(center, radius, 32);
        onProfileChange({ segments: [...profile.segments, ...circleSegs], closed: true });
        setTempPoints([]);
      }
      return;
    }

    // ── Rectangle tool ──────────────────────────────────
    if (activeTool === 'rect') {
      if (tempPoints.length === 0) {
        // First click: corner 1
        setTempPoints([{ ...pt, id: genId('p') }]);
      } else {
        // Second click: corner 2
        const corner1 = tempPoints[0];
        const corner2 = pt;
        // Use actual corners if dragged, otherwise use configured width/height
        let c1 = corner1, c2 = corner2;
        if (dist(corner1, corner2) < 1) {
          c2 = { x: corner1.x + rectWidth, y: corner1.y - rectHeight };
        }
        const rectSegs = generateRectSegments(c1, c2);
        onProfileChange({ segments: [...profile.segments, ...rectSegs], closed: true });
        setTempPoints([]);
      }
      return;
    }

    // ── Polygon tool ────────────────────────────────────
    if (activeTool === 'polygon') {
      if (tempPoints.length === 0) {
        // First click: center
        setTempPoints([{ ...pt, id: genId('p') }]);
      } else {
        // Second click: radius/rotation point
        const center = tempPoints[0];
        const polySegs = generatePolygonSegments(center, pt, polygonSides);
        onProfileChange({ segments: [...profile.segments, ...polySegs], closed: true });
        setTempPoints([]);
      }
      return;
    }

    // ── Ellipse tool ─────────────────────────────────────
    if (activeTool === 'ellipse') {
      if (tempPoints.length === 0) {
        // First click: center
        setTempPoints([{ ...pt, id: genId('p') }]);
      } else if (tempPoints.length === 1) {
        // Second click: defines rx (horizontal)
        const center = tempPoints[0];
        const rx = Math.max(1, Math.abs(pt.x - center.x)) || ellipseRx;
        setTempPoints([center, { x: center.x + rx, y: center.y, id: genId('p') }]);
      } else {
        // Third click: defines ry (vertical)
        const center = tempPoints[0];
        const rx = Math.abs(tempPoints[1].x - center.x) || ellipseRx;
        const ry = Math.max(1, Math.abs(pt.y - center.y)) || ellipseRy;
        const ellipseSegs = generateEllipseSegments(center, rx, ry, 36);
        onProfileChange({ segments: [...profile.segments, ...ellipseSegs], closed: true });
        setTempPoints([]);
      }
      return;
    }

    // ── Slot tool ────────────────────────────────────────
    if (activeTool === 'slot') {
      if (tempPoints.length === 0) {
        // First click: center 1
        setTempPoints([{ ...pt, id: genId('p') }]);
      } else {
        // Second click: center 2
        const c1 = tempPoints[0];
        const c2 = pt;
        const slotSegs = generateSlotSegments(c1, c2, slotRadius, 32);
        onProfileChange({ segments: [...profile.segments, ...slotSegs], closed: true });
        setTempPoints([]);
      }
      return;
    }

    // ── Fillet tool ──────────────────────────────────────
    if (activeTool === 'fillet') {
      // Click near a vertex corner — find the closest vertex in the profile
      let bestPt: SketchPoint | null = null;
      let bestDist = Infinity;
      for (const seg of profile.segments) {
        for (const p of seg.points) {
          const d = dist(p, pt) * zoom;
          if (d < 20 && d < bestDist) { bestDist = d; bestPt = p; }
        }
      }
      if (bestPt) {
        const newSegs = applyFilletAtVertex(profile.segments, bestPt, filletRadius);
        if (newSegs !== profile.segments) {
          onProfileChange({ ...profile, segments: newSegs });
          showToast(lang === 'ko' ? `필렛 r=${filletRadius}mm 적용` : `Fillet r=${filletRadius}mm applied`);
        }
      }
      return;
    }

    // ── Mirror tool ──────────────────────────────────────
    if (activeTool === 'mirror') {
      if (tempPoints.length === 0) {
        // First click: pick axis (X or Y through this point)
        setTempPoints([{ ...pt, id: genId('p') }]);
        showToast(lang === 'ko' ? '미러 기준점 설정. 다시 클릭해 X축 / Shift+클릭해 Y축 미러' : 'Mirror pivot set. Click again for X-mirror, Shift+Click for Y-mirror');
      } else {
        // Second click: perform mirror
        const pivot = tempPoints[0];
        const axisIsY = e.shiftKey; // Shift = mirror about Y axis (x=pivot.x)
        const mirrored = mirrorSegments(profile.segments, axisIsY ? 'y' : 'x', axisIsY ? pivot.x : pivot.y);
        onProfileChange({ segments: [...profile.segments, ...mirrored], closed: profile.closed });
        setTempPoints([]);
        showToast(lang === 'ko' ? `${axisIsY ? 'Y' : 'X'}축 미러 완료` : `Mirrored about ${axisIsY ? 'Y' : 'X'} axis`);
      }
      return;
    }

    // ── Construction toggle ──────────────────────────────
    if (activeTool === 'construction') {
      const nearest = findNearestSegment(profile.segments, pt, 15 / zoom);
      if (nearest) {
        const newSegs = profile.segments.map((s, i) =>
          i === nearest.index ? { ...s, construction: !s.construction } : s
        );
        onProfileChange({ ...profile, segments: newSegs });
        const seg = profile.segments[nearest.index];
        showToast(seg.construction
          ? (lang === 'ko' ? '보조선 → 일반선으로 변환' : 'Construction → Normal line')
          : (lang === 'ko' ? '보조선으로 변환 (형상 생성 시 제외)' : 'Set as construction line (excluded from shape)'));
      }
      return;
    }

    // ── Spline tool ─────────────────────────────────────
    if (activeTool === 'spline') {
      setSplinePoints(prev => [...prev, { ...pt, id: genId('sp') }]);
      return;
    }

    // ── Offset tool ─────────────────────────────────────
    if (activeTool === 'offset') {
      if (tempPoints.length === 0) {
        // First click: select segment
        const nearest = findNearestSegment(profile.segments, pt, 15 / zoom);
        if (nearest) {
          setTempPoints([pt]); // store click point for reference
          setHoverSegIdx(nearest.index);
        }
      } else {
        // Second click: offset distance from original click
        if (hoverSegIdx >= 0 && hoverSegIdx < profile.segments.length) {
          const seg = profile.segments[hoverSegIdx];
          const offsetDist = dist(tempPoints[0], pt);
          // Determine sign from which side of segment the click is
          let sign = 1;
          if (seg.type === 'line' && seg.points.length >= 2) {
            const p0 = seg.points[0], p1 = seg.points[1];
            const cross = (p1.x - p0.x) * (pt.y - p0.y) - (p1.y - p0.y) * (pt.x - p0.x);
            sign = cross > 0 ? 1 : -1;
          } else if (seg.type === 'arc' && seg.points.length === 3) {
            // For arc: sign = outward from center
            const through = seg.points[1];
            const ax = seg.points[0].x, ay = seg.points[0].y;
            const bx = through.x, by = through.y;
            const cx = seg.points[2].x, cy = seg.points[2].y;
            const D = 2 * (ax*(by-cy) + bx*(cy-ay) + cx*(ay-by));
            if (Math.abs(D) > 1e-10) {
              const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
              const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
              const r = Math.sqrt((ax-ux)**2 + (ay-uy)**2);
              const clickR = Math.sqrt((pt.x-ux)**2 + (pt.y-uy)**2);
              sign = clickR > r ? 1 : -1;
            }
          }
          const offsetSeg = offsetSegment(seg, sign * offsetDist);
          if (offsetSeg) {
            onProfileChange({ ...profile, segments: [...profile.segments, offsetSeg] });
          }
        }
        setTempPoints([]);
        setHoverSegIdx(-1);
      }
      return;
    }

    // ── Trim tool ───────────────────────────────────────
    if (activeTool === 'trim') {
      const nearest = findNearestSegment(profile.segments, pt, 10 / zoom);
      if (nearest) {
        const seg = profile.segments[nearest.index];
        const trimmed = trimSegmentAtIntersections(seg, profile.segments, pt);
        if (trimmed) {
          // Replace segment with trimmed version
          const newSegs = profile.segments.map((s, i) => i === nearest.index ? trimmed : s);
          onProfileChange({ segments: newSegs, closed: profile.closed });
        } else {
          // No intersections: delete the segment entirely
          const newSegs = profile.segments.filter((_, i) => i !== nearest.index);
          onProfileChange({ segments: newSegs, closed: newSegs.length > 0 ? profile.closed : false });
        }
      }
      return;
    }

    // ── Dimension tool ──────────────────────────────────
    if (activeTool === 'dimension') {
      // If a pending dim is already open, clicking elsewhere cancels it
      if (pendingDim) { setPendingDim(null); return; }
      const nearest = findNearestSegment(profile.segments, pt, 15 / zoom);
      if (nearest) {
        const seg = profile.segments[nearest.index];
        if (seg.type === 'line' && seg.points.length >= 2) {
          const len = dist(seg.points[0], seg.points[1]);
          const midX = (seg.points[0].x + seg.points[1].x) / 2;
          const midY = (seg.points[0].y + seg.points[1].y) / 2;
          const rounded = Math.round(len * 10) / 10;
          setPendingDim({
            segIdx: nearest.index,
            entityId: seg.id || '',
            value: rounded,
            editValue: String(rounded),
            position: { x: midX, y: midY + 10 },
          });
        }
      }
      return;
    }

    // ── Constraint tool ─────────────────────────────────
    if (activeTool === 'constraint') {
      const nearest = findNearestSegment(profile.segments, pt, 15 / zoom);
      if (nearest && onAddConstraint) {
        const seg = profile.segments[nearest.index];
        const constraintNeedsTwo = ['perpendicular', 'parallel', 'equal', 'symmetric'].includes(selectedConstraintType);

        if (constraintNeedsTwo) {
          if (tempPoints.length === 0) {
            // First entity selection
            setTempPoints([pt]);
            setHoverSegIdx(nearest.index);
          } else {
            // Second entity selection
            const firstSegId = profile.segments[hoverSegIdx]?.id || '';
            const secondSegId = seg.id || '';
            onAddConstraint({
              id: genId('con'),
              type: selectedConstraintType,
              entityIds: [firstSegId, secondSegId],
              satisfied: false,
            });
            setTempPoints([]);
            setHoverSegIdx(-1);
          }
        } else {
          // Single entity constraint
          const segId = seg.id || '';
          const entityIds = selectedConstraintType === 'coincident' && seg.points.length >= 2
            ? [seg.points[0].id || '', seg.points[1].id || '']
            : [segId];
          onAddConstraint({
            id: genId('con'),
            type: selectedConstraintType,
            entityIds,
            satisfied: false,
          });
        }
      }
      return;
    }
  }, [
    isPanning, profile, activeTool, smartSnap, zoom, tempPoints,
    isNearFirst, closeProfile, getLastPoint, onProfileChange,
    circleRadius, rectWidth, rectHeight, polygonSides,
    ellipseRx, ellipseRy, slotRadius, filletRadius,
    hoverSegIdx, onAddConstraint, onAddDimension, selectedConstraintType,
    splinePoints, showToast, lang, pendingDim,
  ]);

  // Double-click to close / finalize spline
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (activeTool === 'line' || activeTool === 'arc') {
      if (profile.segments.length >= 2 || (profile.segments.length >= 1 && tempPoints.length > 0)) {
        closeProfile();
      }
    }
    if (activeTool === 'spline' && splinePoints.length >= 2) {
      const { pt } = smartSnap(e.clientX, e.clientY);
      const allPts = [...splinePoints, { ...pt, id: genId('sp') }];
      const splineSegs = catmullRomToSegments(allPts);
      if (splineSegs.length > 0) {
        const newSegments: SketchSegment[] = splineSegs.map(s => ({
          type: 'line' as const,
          points: [{ ...s.start, id: genId('spp') }, { ...s.end, id: genId('spp') }],
          id: genId('spline'),
        }));
        onProfileChange({ ...profile, segments: [...profile.segments, ...newSegments] });
      }
      setSplinePoints([]);
    }
  }, [activeTool, profile, tempPoints.length, closeProfile, splinePoints, smartSnap, onProfileChange]);

  // Mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      const dx = (e.clientX - panStartRef.current.mx) / zoom;
      const dy = (e.clientY - panStartRef.current.my) / zoom;
      setPanX(panStartRef.current.px - dx);
      setPanY(panStartRef.current.py - dy);
      return;
    }
    // Point drag
    if (isDraggingPointRef.current && dragPoint) {
      const raw = screenToMm(e.clientX, e.clientY);
      const newSegments = profile.segments.map((seg, si) => {
        if (si !== dragPoint.segIdx) return seg;
        return {
          ...seg,
          points: seg.points.map((p, pi) =>
            pi === dragPoint.ptIdx ? { ...p, x: raw.x, y: raw.y } : p
          ),
        };
      });
      onProfileChange({ ...profile, segments: newSegments });
      return;
    }
    const { pt: snapped, type: sType } = smartSnap(e.clientX, e.clientY);
    setMousePos(snapped);
    setSnapType(sType);
    setSnapTarget(sType !== 'grid' ? snapped : null);

    // Trim tool: highlight hovered segment
    if (activeTool === 'trim') {
      const nearest = findNearestSegment(profile.segments, snapped, 10 / zoom);
      setHoverSegIdx(nearest ? nearest.index : -1);
    }
  }, [isPanning, smartSnap, zoom, activeTool, profile.segments, dragPoint, screenToMm, profile, onProfileChange]);

  // Middle-click or right-click pan; left-click in select mode starts point drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = { mx: e.clientX, my: e.clientY, px: panX, py: panY };
      return;
    }
    // Left click in select mode: check if near a point → start drag
    if (e.button === 0 && activeTool === 'select') {
      const raw = screenToMm(e.clientX, e.clientY);
      for (let si = 0; si < profile.segments.length; si++) {
        const seg = profile.segments[si];
        for (let pi = 0; pi < seg.points.length; pi++) {
          if (dist(raw, seg.points[pi]) * zoom < 10) {
            setDragPoint({ segIdx: si, ptIdx: pi });
            isDraggingPointRef.current = true;
            e.preventDefault();
            return;
          }
        }
      }
    }
  }, [panX, panY, activeTool, profile.segments, screenToMm, zoom]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) setIsPanning(false);
    if (isDraggingPointRef.current) {
      isDraggingPointRef.current = false;
      setDragPoint(null);
    }
  }, []);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.1, Math.min(20, prev * factor)));
  }, []);

  // 언마운트 대비 — sketchViewMode가 '2d'→'3d'→'drawing'으로 바뀌면
  // 컴포넌트 자체가 교체되므로 tempPoints가 사라짐. refs로 최신값 추적해서
  // 정리 훅에서 line 2점 이상이면 자동 커밋.
  const tempPointsRef = useRef(tempPoints);
  const activeToolRef = useRef(activeTool);
  const profileRef = useRef(profile);
  const onProfileChangeRef = useRef(onProfileChange);
  useEffect(() => {
    tempPointsRef.current = tempPoints;
    activeToolRef.current = activeTool;
    profileRef.current = profile;
    onProfileChangeRef.current = onProfileChange;
  });
  useEffect(() => {
    return () => {
      const tp = tempPointsRef.current;
      const tool = activeToolRef.current;
      const prof = profileRef.current;
      const onChange = onProfileChangeRef.current;
      if (tool === 'line' && tp.length >= 2) {
        const newSegs: SketchSegment[] = [];
        for (let i = 0; i < tp.length - 1; i++) {
          newSegs.push({ type: 'line', points: [tp[i], tp[i + 1]], id: genId('seg') });
        }
        onChange({ segments: [...prof.segments, ...newSegs], closed: prof.closed });
      }
    };
  }, []);

  // Track previous tool so we can auto-commit or warn on change.
  // P1: If the in-progress 'line' tool has >= 2 points, commit as a polyline
  // so the user doesn't lose work when switching tools mid-draw.
  const prevToolRef = useRef<SketchTool>(activeTool);
  useEffect(() => {
    const prev = prevToolRef.current;
    if (prev === activeTool) return;
    prevToolRef.current = activeTool;

    const hadTemp = tempPoints.length;
    const hadSpline = splinePoints.length;

    // Auto-commit line-in-progress with >= 2 points (polyline → N-1 line segments)
    if (prev === 'line' && hadTemp >= 2) {
      const newSegs: SketchSegment[] = [];
      for (let i = 0; i < tempPoints.length - 1; i++) {
        newSegs.push({
          type: 'line',
          points: [tempPoints[i], tempPoints[i + 1]],
          id: genId('seg'),
        });
      }
      onProfileChange({
        segments: [...profile.segments, ...newSegs],
        closed: profile.closed,
      });
      showToast(L('toolSwitchSaved')(newSegs.length));
    } else if (hadTemp > 0 || hadSpline > 0) {
      showToast(L('discarded')(hadTemp + hadSpline));
    }

    setTempPoints([]);
    setSplinePoints([]);
    setHoverSegIdx(-1);
    setSelectedSegIdx(-1);
    setDimInput('');
    // Intentionally only on activeTool change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // ESC / Enter / K / Delete 통합 키보드 핸들러
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      // ESC: 0) dimInput 우선 정리 1) 진행 중 그리기 취소 2) select 도구로 복귀
      if (e.key === 'Escape') {
        if (dimInput) {
          e.preventDefault();
          setDimInput('');
          return;
        }
        // Close pending smart dimension editor
        if (pendingDim) { setPendingDim(null); return; }
        if (tempPoints.length > 0 || splinePoints.length > 0) {
          e.preventDefault();
          setTempPoints([]);
          setSplinePoints([]);
          setHoverSegIdx(-1);
          showToast(L('cancelled'));
        } else if (activeTool !== 'select') {
          e.preventDefault();
          onToolChange?.('select');
          showToast(L('toSelect'));
        } else if (selectedSegIdx >= 0) {
          setSelectedSegIdx(-1);
        }
        return;
      }

      // 숫자 인라인 입력 (line 도구, 첫 점 찍은 상태)
      if (activeTool === 'line' && tempPoints.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          setDimInput(prev => (prev + e.key).slice(0, 10));
          return;
        }
        if (e.key === '.' && !dimInput.includes('.')) {
          e.preventDefault();
          setDimInput(prev => (prev === '' ? '0.' : prev + '.'));
          return;
        }
        if (e.key === 'Backspace' && dimInput) {
          e.preventDefault();
          setDimInput(prev => prev.slice(0, -1));
          return;
        }
      }

      // Enter: 폴리라인 체인 끊기 / 스플라인 커밋 / 정확한 길이로 세그먼트 커밋
      if (e.key === 'Enter') {
        // 치수 인라인 커밋: line 도구 + 첫 점 + 숫자 입력 존재
        if (activeTool === 'line' && tempPoints.length === 1 && dimInput) {
          const len = parseFloat(dimInput);
          if (len > 0 && isFinite(len)) {
            e.preventDefault();
            const start = tempPoints[0];
            const dx = mousePos.x - start.x;
            const dy = mousePos.y - start.y;
            const m = Math.hypot(dx, dy);
            // 커서 방향이 너무 가까우면 +X 기본 방향
            const ux = m > 0.001 ? dx / m : 1;
            const uy = m > 0.001 ? dy / m : 0;
            const end: SketchPoint = { x: start.x + ux * len, y: start.y + uy * len, id: genId('p') };
            const newSeg: SketchSegment = { type: 'line', points: [start, end], id: genId('seg') };
            onProfileChange({ ...profile, segments: [...profile.segments, newSeg] });
            setTempPoints([{ ...end, id: genId('p') }]);
            setDimInput('');
            return;
          }
        }
        if (activeTool === 'line' && tempPoints.length > 0) {
          e.preventDefault();
          setTempPoints([]);
          setDimInput('');
        } else if (activeTool === 'spline' && splinePoints.length >= 2) {
          e.preventDefault();
          const segs = catmullRomToSegments(splinePoints);
          const newSegs: SketchSegment[] = segs.map(s => ({
            type: 'line',
            points: [{ ...s.start, id: genId('p') }, { ...s.end, id: genId('p') }],
            id: genId('seg'),
          }));
          onProfileChange({ segments: [...profile.segments, ...newSegs], closed: profile.closed });
          setSplinePoints([]);
        }
        return;
      }

      // K: 프로파일 닫기 (마지막 점 → 첫 점)
      if ((e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey) {
        if (profile.segments.length > 0 && !profile.closed) {
          e.preventDefault();
          closeProfile();
          showToast(L('closed'));
        }
        return;
      }

      // Delete / Backspace: 선택된 세그먼트 삭제
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeTool === 'select' && selectedSegIdx >= 0) {
        e.preventDefault();
        onProfileChange({
          segments: profile.segments.filter((_, i) => i !== selectedSegIdx),
          closed: false, // 삭제 후엔 닫힌 상태 해제
        });
        setSelectedSegIdx(-1);
        showToast(L('deleted')(1));
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tempPoints, tempPoints.length, splinePoints.length, splinePoints, activeTool, onToolChange, showToast, selectedSegIdx, profile, onProfileChange, closeProfile, L, dimInput, mousePos, pendingDim]);

  // Auto-detect G1 tangent continuity when new arc segment is added
  useEffect(() => {
    if (!onAddConstraint) return;
    const segs = profile.segments;
    if (segs.length < 2) return;
    const last = segs[segs.length - 1];
    const prev = segs[segs.length - 2];
    if (last.type !== 'arc' && prev.type !== 'arc') return;
    // Check if they share an endpoint
    const lastStart = last.points[0];
    const prevEnd = prev.points[prev.points.length - 1];
    if (dist(lastStart, prevEnd) > 0.5) return;
    // Compute tangent direction at junction
    const getTangentDir = (seg: SketchSegment, atEnd: boolean): { dx: number; dy: number } | null => {
      if (seg.type === 'line' && seg.points.length >= 2) {
        const p0 = atEnd ? seg.points[seg.points.length - 2] : seg.points[0];
        const p1 = atEnd ? seg.points[seg.points.length - 1] : seg.points[1];
        const len = Math.sqrt((p1.x-p0.x)**2 + (p1.y-p0.y)**2);
        if (len < 0.001) return null;
        return { dx: (p1.x-p0.x)/len * (atEnd ? 1 : -1), dy: (p1.y-p0.y)/len * (atEnd ? 1 : -1) };
      }
      return null; // arc tangent direction is complex, skip for now
    };
    const t1 = getTangentDir(prev, true);
    const t2 = getTangentDir(last, false);
    if (!t1 || !t2) return;
    const dot = t1.dx * t2.dx + t1.dy * t2.dy;
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (angleDeg < 5 && prev.id && last.id) {
      // Near-tangent: auto-add tangent constraint
      onAddConstraint({
        id: genId('con'),
        type: 'tangent',
        entityIds: [prev.id, last.id],
        satisfied: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.segments.length]); // Only run when segment count changes

  // ─── Rendering helpers ──────────────────────────────────────────────────

  const viewBoxW = svgSize.width / zoom;
  const viewBoxH = svgSize.height / zoom;
  const vbX = panX - viewBoxW / 2;
  const vbY = panY - viewBoxH / 2;

  // Grid
  const gridLines: React.ReactNode[] = [];
  const gridStep10 = 10;
  const gridStep50 = 50;

  // Only compute grid lines when visible
  const startX = gridVisible ? Math.floor(vbX / gridStep50) * gridStep50 : 0;
  const endX = gridVisible ? Math.ceil((vbX + viewBoxW) / gridStep50) * gridStep50 : 0;
  const startY = gridVisible ? Math.floor(vbY / gridStep50) * gridStep50 : 0;
  const endY = gridVisible ? Math.ceil((vbY + viewBoxH) / gridStep50) * gridStep50 : 0;

  const minor10StartX = gridVisible ? Math.floor(vbX / gridStep10) * gridStep10 : 0;
  const minor10EndX = gridVisible ? Math.ceil((vbX + viewBoxW) / gridStep10) * gridStep10 : 0;
  const minor10StartY = gridVisible ? Math.floor(vbY / gridStep10) * gridStep10 : 0;
  const minor10EndY = gridVisible ? Math.ceil((vbY + viewBoxH) / gridStep10) * gridStep10 : 0;

  for (let x = gridVisible ? minor10StartX : 1; x <= minor10EndX; x += gridStep10) {
    if (x % gridStep50 !== 0) {
      gridLines.push(
        <line key={`vx${x}`} x1={x} y1={vbY} x2={x} y2={vbY + viewBoxH}
          stroke="#2a2a4a" strokeWidth={0.5 / zoom} />
      );
    }
  }
  for (let y = minor10StartY; y <= minor10EndY; y += gridStep10) {
    if (y % gridStep50 !== 0) {
      gridLines.push(
        <line key={`hy${y}`} x1={vbX} y1={y} x2={vbX + viewBoxW} y2={y}
          stroke="#2a2a4a" strokeWidth={0.5 / zoom} />
      );
    }
  }
  for (let x = startX; x <= endX; x += gridStep50) {
    gridLines.push(
      <line key={`Vx${x}`} x1={x} y1={vbY} x2={x} y2={vbY + viewBoxH}
        stroke="#3a3a5a" strokeWidth={1 / zoom} />
    );
  }
  for (let y = startY; y <= endY; y += gridStep50) {
    gridLines.push(
      <line key={`Hy${y}`} x1={vbX} y1={y} x2={vbX + viewBoxW} y2={y}
        stroke="#3a3a5a" strokeWidth={1 / zoom} />
    );
  }

  // Axes
  const axes = (
    <>
      <line x1={vbX} y1={0} x2={vbX + viewBoxW} y2={0} stroke="#ef4444" strokeWidth={1.5 / zoom} opacity={0.6} />
      <line x1={0} y1={vbY} x2={0} y2={vbY + viewBoxH} stroke="#22c55e" strokeWidth={1.5 / zoom} opacity={0.6} />
    </>
  );

  // Build path for existing segments
  let pathD = '';
  const allPoints: SketchPoint[] = [];

  if (profile.segments.length > 0) {
    const first = profile.segments[0].points[0];
    pathD = `M ${first.x} ${-first.y}`;
    allPoints.push(first);

    for (const seg of profile.segments) {
      if (seg.type === 'line') {
        const end = seg.points[1];
        pathD += ` L ${end.x} ${-end.y}`;
        allPoints.push(end);
      } else if (seg.type === 'arc' && seg.points.length === 3) {
        const arcStr = arcPathFromPoints(seg.points[0], seg.points[1], seg.points[2]);
        pathD += ` ${arcStr}`;
        allPoints.push(seg.points[1], seg.points[2]);
      }
    }

    if (profile.closed) pathD += ' Z';
  }

  // Preview rendering
  let previewPath = '';
  const lastPt = getLastPoint();
  const firstPt = getFirstPoint();
  const nearFirst = isNearFirst(mousePos);

  // ── Live dimension (length + angle while drawing line/arc) ────────────────
  let liveDimension: React.ReactNode = null;
  const drawingRefPt = lastPt ?? (tempPoints.length > 0 ? tempPoints[0] : null);
  if (drawingRefPt && (activeTool === 'line' || activeTool === 'arc') && !profile.closed && !nearFirst) {
    const dx = mousePos.x - drawingRefPt.x;
    const dy = mousePos.y - drawingRefPt.y;
    const lenMm = Math.sqrt(dx * dx + dy * dy);
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    if (lenMm > 1) {
      // Midpoint of preview line in SVG coords
      const midX = (drawingRefPt.x + mousePos.x) / 2;
      const midY = -((drawingRefPt.y + mousePos.y) / 2);
      const labelText = `${lenMm.toFixed(1)}mm  ${angleDeg.toFixed(0)}°`;
      const boxW = labelText.length * 5.5 / zoom;
      const boxH = 13 / zoom;
      liveDimension = (
        <g>
          <rect x={midX - boxW / 2} y={midY - boxH - 2 / zoom} width={boxW} height={boxH}
            rx={2 / zoom} fill="#1c2128" stroke="#388bfd" strokeWidth={0.5 / zoom} opacity={0.92} />
          <text x={midX} y={midY - 4 / zoom}
            fill="#58a6ff" fontSize={8 / zoom} fontFamily="monospace" fontWeight="700"
            textAnchor="middle">
            {labelText}
          </text>
        </g>
      );
    }
  }

  // ── Angle snap axis line ───────────────────────────────────────────────────
  let angleAxisLine: React.ReactNode = null;
  if (snapType === 'angle' && drawingRefPt) {
    const dx = mousePos.x - drawingRefPt.x;
    const dy = mousePos.y - drawingRefPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.1) {
      const nx = dx / len;
      const ny = dy / len;
      const ext = Math.max(viewBoxW, viewBoxH);
      const x1 = drawingRefPt.x - nx * ext;
      const y1 = -(drawingRefPt.y - ny * ext);
      const x2 = drawingRefPt.x + nx * ext;
      const y2 = -(drawingRefPt.y + ny * ext);
      angleAxisLine = (
        <line x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="#388bfd" strokeWidth={0.5 / zoom}
          strokeDasharray={`${4 / zoom} ${4 / zoom}`} opacity={0.4} />
      );
    }
  }

  // ── Snap indicator ─────────────────────────────────────────────────────────
  let snapIndicator: React.ReactNode = null;
  if (snapTarget && snapType !== 'grid') {
    const color = snapType === 'endpoint' ? '#3fb950' : '#f0883e';
    const r = snapType === 'endpoint' ? 7 / zoom : 5 / zoom;
    snapIndicator = (
      <g>
        <circle cx={snapTarget.x} cy={-snapTarget.y} r={r}
          fill="none" stroke={color} strokeWidth={1.5 / zoom} opacity={0.9} />
        {snapType === 'endpoint' && (
          <>
            <line x1={snapTarget.x - r} y1={-snapTarget.y} x2={snapTarget.x + r} y2={-snapTarget.y}
              stroke={color} strokeWidth={1 / zoom} opacity={0.7} />
            <line x1={snapTarget.x} y1={-snapTarget.y - r} x2={snapTarget.x} y2={-snapTarget.y + r}
              stroke={color} strokeWidth={1 / zoom} opacity={0.7} />
          </>
        )}
      </g>
    );
  }

  if (!profile.closed && activeTool === 'line') {
    if (lastPt) {
      const target = nearFirst && firstPt ? firstPt : mousePos;
      previewPath = `M ${lastPt.x} ${-lastPt.y} L ${target.x} ${-target.y}`;
    } else if (tempPoints.length === 1) {
      previewPath = `M ${tempPoints[0].x} ${-tempPoints[0].y} L ${mousePos.x} ${-mousePos.y}`;
    }
  } else if (!profile.closed && activeTool === 'arc') {
    if (tempPoints.length === 1) {
      previewPath = `M ${tempPoints[0].x} ${-tempPoints[0].y} L ${mousePos.x} ${-mousePos.y}`;
    } else if (tempPoints.length === 2) {
      const pts = sampleArc(tempPoints[0], tempPoints[1], mousePos, 30);
      if (pts.length > 1) {
        previewPath = `M ${pts[0].x} ${-pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
          previewPath += ` L ${pts[i].x} ${-pts[i].y}`;
        }
      }
    }
  }

  // Circle preview
  let circlePreview: React.ReactNode = null;
  if (activeTool === 'circle' && tempPoints.length === 1) {
    const center = tempPoints[0];
    const r = dist(center, mousePos);
    const previewR = r > 0.5 ? r : circleRadius;
    circlePreview = (
      <circle cx={center.x} cy={-center.y} r={previewR}
        fill="none" stroke="#388bfd" strokeWidth={1.5 / zoom}
        strokeDasharray={`${6 / zoom} ${4 / zoom}`} opacity={0.7} />
    );
  }

  // Rectangle preview
  let rectPreview: React.ReactNode = null;
  if (activeTool === 'rect' && tempPoints.length === 1) {
    const c1 = tempPoints[0];
    const c2 = mousePos;
    const x = Math.min(c1.x, c2.x);
    const y = -Math.max(c1.y, c2.y);
    const w = Math.abs(c2.x - c1.x);
    const h = Math.abs(c2.y - c1.y);
    if (w > 0.5 || h > 0.5) {
      rectPreview = (
        <rect x={x} y={y} width={w} height={h}
          fill="none" stroke="#388bfd" strokeWidth={1.5 / zoom}
          strokeDasharray={`${6 / zoom} ${4 / zoom}`} opacity={0.7} />
      );
    }
  }

  // Polygon preview
  let polyPreview: React.ReactNode = null;
  if (activeTool === 'polygon' && tempPoints.length === 1) {
    const center = tempPoints[0];
    const r = dist(center, mousePos);
    if (r > 0.5) {
      const baseAngle = Math.atan2(mousePos.y - center.y, mousePos.x - center.x);
      let d = '';
      for (let i = 0; i <= polygonSides; i++) {
        const a = baseAngle + (2 * Math.PI * i) / polygonSides;
        const px = center.x + r * Math.cos(a);
        const py = -(center.y + r * Math.sin(a));
        d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
      }
      d += ' Z';
      polyPreview = (
        <path d={d} fill="none" stroke="#388bfd" strokeWidth={1.5 / zoom}
          strokeDasharray={`${6 / zoom} ${4 / zoom}`} opacity={0.7} />
      );
    }
  }

  // Ellipse preview
  let ellipsePreview: React.ReactNode = null;
  if (activeTool === 'ellipse') {
    if (tempPoints.length === 1) {
      // Show default ellipse at center
      const c = tempPoints[0];
      const rx = Math.max(1, Math.abs(mousePos.x - c.x)) || ellipseRx;
      ellipsePreview = (
        <ellipse cx={c.x} cy={-c.y} rx={rx} ry={ellipseRy}
          fill="none" stroke="#388bfd" strokeWidth={1.5 / zoom}
          strokeDasharray={`${6 / zoom} ${4 / zoom}`} opacity={0.7} />
      );
    } else if (tempPoints.length === 2) {
      // rx set, now defining ry
      const c = tempPoints[0];
      const rx = Math.abs(tempPoints[1].x - c.x) || ellipseRx;
      const ry = Math.max(1, Math.abs(mousePos.y - c.y)) || ellipseRy;
      ellipsePreview = (
        <>
          <ellipse cx={c.x} cy={-c.y} rx={rx} ry={ry}
            fill="none" stroke="#388bfd" strokeWidth={1.5 / zoom}
            strokeDasharray={`${6 / zoom} ${4 / zoom}`} opacity={0.7} />
          <line x1={c.x} y1={-c.y} x2={c.x + rx} y2={-c.y}
            stroke="#388bfd" strokeWidth={0.8 / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} opacity={0.5} />
          <line x1={c.x} y1={-c.y} x2={c.x} y2={-c.y - ry}
            stroke="#388bfd" strokeWidth={0.8 / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} opacity={0.5} />
        </>
      );
    }
  }

  // Slot preview
  let slotPreview: React.ReactNode = null;
  if (activeTool === 'slot' && tempPoints.length === 1) {
    const c1 = tempPoints[0];
    const c2 = mousePos;
    const slotSegs = generateSlotSegments(c1, c2, slotRadius, 24);
    if (slotSegs.length > 0) {
      let d = `M ${slotSegs[0].points[0].x} ${-slotSegs[0].points[0].y}`;
      for (const s of slotSegs) {
        d += ` L ${s.points[1].x} ${-s.points[1].y}`;
      }
      d += ' Z';
      slotPreview = <path d={d} fill="none" stroke="#388bfd" strokeWidth={1.5 / zoom}
        strokeDasharray={`${6 / zoom} ${4 / zoom}`} opacity={0.7} />;
    }
  }

  // Fillet preview: highlight nearest vertex
  let filletPreview: React.ReactNode = null;
  if (activeTool === 'fillet') {
    let bestPt: SketchPoint | null = null;
    let bestD = Infinity;
    for (const seg of profile.segments) {
      for (const p of seg.points) {
        const d = dist(p, mousePos) * zoom;
        if (d < 20 && d < bestD) { bestD = d; bestPt = p; }
      }
    }
    if (bestPt) {
      filletPreview = (
        <circle cx={bestPt.x} cy={-bestPt.y} r={filletRadius}
          fill="rgba(56,139,253,0.1)" stroke="#388bfd" strokeWidth={1.5 / zoom} opacity={0.8} />
      );
    }
  }

  // Mirror preview: show axis line through first click point
  let mirrorPreview: React.ReactNode = null;
  if (activeTool === 'mirror' && tempPoints.length === 1) {
    const pivot = tempPoints[0];
    const ext = Math.max(viewBoxW, viewBoxH);
    mirrorPreview = (
      <>
        {/* X-axis mirror (default) */}
        <line x1={vbX} y1={-pivot.y} x2={vbX + viewBoxW} y2={-pivot.y}
          stroke="#f0883e" strokeWidth={1 / zoom} strokeDasharray={`${6/zoom} ${4/zoom}`} opacity={0.6} />
        {/* Y-axis mirror label */}
        <text x={pivot.x + 5 / zoom} y={-pivot.y - 5 / zoom}
          fill="#f0883e" fontSize={9 / zoom} fontFamily="monospace">
          {lang === 'ko' ? '클릭=X축 / Shift+클릭=Y축' : 'Click=X / Shift+Click=Y'}
        </text>
        {/* Center dot */}
        <circle cx={pivot.x} cy={-pivot.y} r={4 / zoom}
          fill="#f0883e" opacity={0.8} />
        {/* Y-axis preview line (faint) */}
        <line x1={pivot.x} y1={vbY} x2={pivot.x} y2={vbY + viewBoxH}
          stroke="#f0883e" strokeWidth={0.5 / zoom} strokeDasharray={`${4/zoom} ${4/zoom}`} opacity={0.3} />
      </>
    );
    void ext;
  }

  // Construction line visual indicator: render existing construction segs as dashed
  const constructionLines: React.ReactNode[] = [];
  for (let i = 0; i < profile.segments.length; i++) {
    const seg = profile.segments[i];
    if (!seg.construction) continue;
    if (seg.type === 'line' && seg.points.length === 2) {
      const p0 = seg.points[0];
      const p1 = seg.points[1];
      constructionLines.push(
        <line key={`con${i}`}
          x1={p0.x} y1={-p0.y} x2={p1.x} y2={-p1.y}
          stroke="#484f58" strokeWidth={1 / zoom}
          strokeDasharray={`${8/zoom} ${4/zoom}`} opacity={0.7} />
      );
    }
  }

  // Spline preview: control points + live curve
  let splinePreview: React.ReactNode = null;
  if (activeTool === 'spline' && splinePoints.length > 0) {
    const controlDots = splinePoints.map((pt, i) => (
      <circle key={`scp${i}`} cx={pt.x} cy={-pt.y} r={4 / zoom}
        fill="#a371f7" stroke="#0d1117" strokeWidth={1 / zoom} />
    ));

    let curvePath: React.ReactNode = null;
    const previewPts = splinePoints.length >= 1 ? [...splinePoints, mousePos] : splinePoints;
    if (previewPts.length >= 2) {
      const previewSegs = catmullRomToSegments(previewPts);
      if (previewSegs.length > 0) {
        let d = `M ${previewSegs[0].start.x} ${-previewSegs[0].start.y}`;
        for (const s of previewSegs) {
          d += ` L ${s.end.x} ${-s.end.y}`;
        }
        curvePath = (
          <path d={d} fill="none" stroke="#a371f7" strokeWidth={1.5 / zoom}
            strokeDasharray={`${4 / zoom} ${4 / zoom}`} opacity={0.8} />
        );
      }
    }

    splinePreview = <>{controlDots}{curvePath}</>;
  }

  // 자기 교차 검출 (line 세그먼트만)
  const selfIntersections = useMemo(() => {
    const hits: Array<{ i: number; j: number }> = [];
    const lineSegs = profile.segments
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => s.type === 'line' && s.points.length >= 2);
    for (let i = 0; i < lineSegs.length; i++) {
      for (let j = i + 1; j < lineSegs.length; j++) {
        const a = lineSegs[i].s.points[0];
        const b = lineSegs[i].s.points[1];
        const c = lineSegs[j].s.points[0];
        const d = lineSegs[j].s.points[1];
        if (segmentsIntersect(a, b, c, d)) {
          hits.push({ i: lineSegs[i].idx, j: lineSegs[j].idx });
        }
      }
    }
    return hits;
  }, [profile.segments]);

  // 교차 지점에 빨간 X 표시
  const intersectionMarkers = useMemo(() => {
    return selfIntersections.map(({ i, j }, k) => {
      const a = profile.segments[i].points[0];
      const b = profile.segments[i].points[1];
      const c = profile.segments[j].points[0];
      const d = profile.segments[j].points[1];
      // 교차점 계산
      const denom = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(denom) < 1e-9) return null;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denom;
      const px = a.x + t * (b.x - a.x);
      const py = a.y + t * (b.y - a.y);
      const r = 6 / zoom;
      return (
        <g key={`ix${k}`}>
          <circle cx={px} cy={-py} r={r} fill="none" stroke="#f85149" strokeWidth={2 / zoom} />
          <line x1={px - r * 0.6} y1={-py - r * 0.6} x2={px + r * 0.6} y2={-py + r * 0.6}
            stroke="#f85149" strokeWidth={2 / zoom} strokeLinecap="round" />
          <line x1={px - r * 0.6} y1={-py + r * 0.6} x2={px + r * 0.6} y2={-py - r * 0.6}
            stroke="#f85149" strokeWidth={2 / zoom} strokeLinecap="round" />
        </g>
      );
    });
  }, [selfIntersections, profile.segments, zoom]);

  // Selected segment highlight (select tool)
  let selectionHighlight: React.ReactNode = null;
  if (activeTool === 'select' && selectedSegIdx >= 0 && selectedSegIdx < profile.segments.length) {
    const seg = profile.segments[selectedSegIdx];
    if (seg.type === 'line' && seg.points.length >= 2) {
      selectionHighlight = (
        <line
          x1={seg.points[0].x} y1={-seg.points[0].y}
          x2={seg.points[1].x} y2={-seg.points[1].y}
          stroke="#f0883e" strokeWidth={4 / zoom} opacity={0.9}
          strokeLinecap="round"
        />
      );
    } else if (seg.type === 'arc' && seg.points.length === 3) {
      const pts = sampleArc(seg.points[0], seg.points[1], seg.points[2], 30);
      if (pts.length > 1) {
        let d = `M ${pts[0].x} ${-pts[0].y}`;
        for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${-pts[i].y}`;
        selectionHighlight = (
          <path d={d} fill="none" stroke="#f0883e" strokeWidth={4 / zoom} opacity={0.9} strokeLinecap="round" />
        );
      }
    }
  }

  // Trim hover highlight
  let trimHighlight: React.ReactNode = null;
  if (activeTool === 'trim' && hoverSegIdx >= 0 && hoverSegIdx < profile.segments.length) {
    const seg = profile.segments[hoverSegIdx];
    if (seg.type === 'line' && seg.points.length >= 2) {
      trimHighlight = (
        <line
          x1={seg.points[0].x} y1={-seg.points[0].y}
          x2={seg.points[1].x} y2={-seg.points[1].y}
          stroke="#f85149" strokeWidth={3 / zoom} opacity={0.8}
        />
      );
    } else if (seg.type === 'arc' && seg.points.length === 3) {
      const pts = sampleArc(seg.points[0], seg.points[1], seg.points[2], 30);
      if (pts.length > 1) {
        let d = `M ${pts[0].x} ${-pts[0].y}`;
        for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${-pts[i].y}`;
        trimHighlight = (
          <path d={d} fill="none" stroke="#f85149" strokeWidth={3 / zoom} opacity={0.8} />
        );
      }
    }
  }

  // ─── Constraint icons ──────────────────────────────────────────────────

  const constraintIcons: React.ReactNode[] = [];
  const iconMap: Record<string, string> = {
    horizontal: 'H', vertical: 'V', perpendicular: '⊥', parallel: '∥',
    tangent: '⌢', coincident: '●', concentric: '◎', equal: '=',
    symmetric: '⇔', midpoint: 'M', fixed: '⊗',
  };

  for (const c of constraints) {
    // Find position from first entity
    const seg = profile.segments.find(s => s.id === c.entityIds[0]);
    if (seg && seg.points.length >= 2) {
      const mx = (seg.points[0].x + seg.points[1].x) / 2;
      const my = (seg.points[0].y + seg.points[1].y) / 2;
      constraintIcons.push(
        <g key={c.id}>
          <rect
            x={mx - 6 / zoom} y={-my - 14 / zoom}
            width={12 / zoom} height={12 / zoom}
            rx={2 / zoom}
            fill={c.satisfied ? '#238636' : '#da3633'}
            opacity={0.9}
          />
          <text
            x={mx} y={-my - 5 / zoom}
            fill="#fff" fontSize={8 / zoom} fontFamily="monospace"
            textAnchor="middle" dominantBaseline="middle"
          >
            {iconMap[c.type] || '?'}
          </text>
        </g>
      );
    }
  }

  // ─── Dimension annotations ─────────────────────────────────────────────

  const dimensionAnnotations: React.ReactNode[] = [];

  for (const d of dimensions) {
    const seg = profile.segments.find(s => s.id === d.entityIds[0]);
    if (seg && seg.type === 'line' && seg.points.length >= 2) {
      const p0 = seg.points[0];
      const p1 = seg.points[1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.01) continue;

      // Perpendicular offset for dimension line
      const nx = -dy / len;
      const ny = dx / len;
      const offset = 12 / zoom;

      const x0 = p0.x + nx * offset;
      const y0 = -(p0.y + ny * offset);
      const x1 = p1.x + nx * offset;
      const y1 = -(p1.y + ny * offset);

      // Extension lines
      const ext0x0 = p0.x + nx * 2 / zoom;
      const ext0y0 = -(p0.y + ny * 2 / zoom);
      const ext1x0 = p1.x + nx * 2 / zoom;
      const ext1y0 = -(p1.y + ny * 2 / zoom);

      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2;

      // Arrow size
      const arrowLen = 5 / zoom;
      const adx = (x1 - x0) / len * arrowLen;
      const ady = (y1 - y0) / len * arrowLen;

      dimensionAnnotations.push(
        <g key={d.id}>
          {/* Extension lines */}
          <line x1={ext0x0} y1={ext0y0} x2={x0} y2={y0}
            stroke="#58a6ff" strokeWidth={0.5 / zoom} opacity={0.6} />
          <line x1={ext1x0} y1={ext1y0} x2={x1} y2={y1}
            stroke="#58a6ff" strokeWidth={0.5 / zoom} opacity={0.6} />
          {/* Dimension line */}
          <line x1={x0} y1={y0} x2={x1} y2={y1}
            stroke="#58a6ff" strokeWidth={1 / zoom} />
          {/* Arrows */}
          <line x1={x0} y1={y0} x2={x0 + adx + ady * 0.3} y2={y0 + ady - adx * 0.3}
            stroke="#58a6ff" strokeWidth={1 / zoom} />
          <line x1={x0} y1={y0} x2={x0 + adx - ady * 0.3} y2={y0 + ady + adx * 0.3}
            stroke="#58a6ff" strokeWidth={1 / zoom} />
          <line x1={x1} y1={y1} x2={x1 - adx + ady * 0.3} y2={y1 - ady - adx * 0.3}
            stroke="#58a6ff" strokeWidth={1 / zoom} />
          <line x1={x1} y1={y1} x2={x1 - adx - ady * 0.3} y2={y1 - ady + adx * 0.3}
            stroke="#58a6ff" strokeWidth={1 / zoom} />
          {/* Value text */}
          <rect
            x={midX - 16 / zoom} y={midY - 7 / zoom}
            width={32 / zoom} height={14 / zoom}
            rx={2 / zoom}
            fill="#0d1117" stroke="#58a6ff" strokeWidth={0.5 / zoom}
          />
          <text
            x={midX} y={midY + 3 / zoom}
            fill="#58a6ff" fontSize={9 / zoom} fontFamily="monospace" fontWeight="700"
            textAnchor="middle"
          >
            {d.value.toFixed(1)}
          </text>
        </g>
      );
    }
  }

  // Point radius in mm space
  const ptR = 4 / zoom;
  const firstPtR = 6 / zoom;

  // Build semi-transparent reference outlines for otherProfiles
  const otherProfilePaths: React.ReactNode[] = otherProfiles.map((op, opIdx) => {
    if (op.segments.length === 0) return null;
    const first = op.segments[0].points[0];
    let d = `M ${first.x} ${-first.y}`;
    for (const seg of op.segments) {
      if (seg.type === 'line') {
        const end = seg.points[1];
        d += ` L ${end.x} ${-end.y}`;
      } else if (seg.type === 'arc' && seg.points.length === 3) {
        d += ` ${arcPathFromPoints(seg.points[0], seg.points[1], seg.points[2])}`;
      }
    }
    if (op.closed) d += ' Z';
    return (
      <path
        key={`other_${opIdx}`}
        d={d}
        fill={op.closed ? 'rgba(100,100,140,0.07)' : 'none'}
        stroke="#6b7280"
        strokeWidth={1.5 / zoom}
        strokeDasharray={`${5 / zoom} ${3 / zoom}`}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.5}
      />
    );
  });

  // Cursor style
  let cursorStyle: string;
  if (isPanning) cursorStyle = 'grabbing';
  else if (activeTool === 'select') cursorStyle = 'default';
  else if (activeTool === 'trim') cursorStyle = 'crosshair';
  else if (activeTool === 'offset') cursorStyle = 'copy';
  else if (activeTool === 'dimension' || activeTool === 'constraint') cursorStyle = 'pointer';
  else cursorStyle = 'crosshair';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0d1117' }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`${vbX} ${vbY} ${viewBoxW} ${viewBoxH}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          cursor: cursorStyle,
          userSelect: 'none',
          touchAction: 'none',
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onDragStart={e => e.preventDefault()}
        onContextMenu={e => e.preventDefault()}
      >
        {/* Grid */}
        {gridLines}
        {axes}

        {/* Angle snap axis guide line */}
        {angleAxisLine}

        {/* Trim hover highlight (behind main path) */}
        {trimHighlight}

        {/* Selection highlight */}
        {selectionHighlight}

        {/* Self-intersection X markers */}
        {intersectionMarkers}

        {/* Other profiles (dimmed reference outlines) */}
        {otherProfilePaths}

        {/* Completed segments */}
        {pathD && (
          <path d={pathD}
            fill={profile.closed ? 'rgba(56,139,253,0.08)' : 'none'}
            stroke="#388bfd" strokeWidth={2 / zoom}
            strokeLinejoin="round" strokeLinecap="round"
          />
        )}

        {/* Preview line */}
        {previewPath && (
          <path d={previewPath} fill="none" stroke="#388bfd" strokeWidth={1.5 / zoom}
            strokeDasharray={`${6 / zoom} ${4 / zoom}`} opacity={0.7} />
        )}

        {/* Live dimension label */}
        {liveDimension}

        {/* Shape previews */}
        {circlePreview}
        {rectPreview}
        {polyPreview}

        {/* Construction lines */}
        {constructionLines}

        {/* Ellipse / slot / fillet / mirror previews */}
        {ellipsePreview}
        {slotPreview}
        {filletPreview}
        {mirrorPreview}

        {/* Spline preview */}
        {splinePreview}

        {/* Constraint icons */}
        {constraintIcons}

        {/* Dimension annotations */}
        {dimensionAnnotations}

        {/* Drag handles — visible in select mode */}
        {activeTool === 'select' && profile.segments.flatMap((seg, si) =>
          seg.points.map((p, pi) => (
            <circle key={`dh${si}_${pi}`} cx={p.x} cy={-p.y} r={8 / zoom}
              fill="rgba(56,139,253,0.08)" stroke="#388bfd55" strokeWidth={1 / zoom}
              style={{ cursor: 'move' }} />
          ))
        )}

        {/* Points */}
        {allPoints.map((p, i) => (
          <circle key={`pt${i}`} cx={p.x} cy={-p.y} r={ptR}
            fill="#388bfd" stroke="#0d1117" strokeWidth={1 / zoom} />
        ))}

        {/* Temp points */}
        {tempPoints.map((p, i) => (
          <circle key={`tp${i}`} cx={p.x} cy={-p.y} r={ptR}
            fill="#f0883e" stroke="#0d1117" strokeWidth={1 / zoom} />
        ))}

        {/* First point highlight for closing */}
        {firstPt && !profile.closed && (profile.segments.length > 0 || tempPoints.length > 1) && (
          <circle cx={firstPt.x} cy={-firstPt.y} r={firstPtR}
            fill={nearFirst ? '#3fb950' : 'transparent'}
            stroke="#3fb950" strokeWidth={2 / zoom} opacity={nearFirst ? 0.9 : 0.5} />
        )}

        {/* Snap indicator */}
        {snapIndicator}

        {/* Cursor crosshair */}
        {!isPanning && !['select', 'trim', 'dimension', 'constraint'].includes(activeTool) && !profile.closed && (
          <>
            <line x1={mousePos.x - 8 / zoom} y1={-mousePos.y} x2={mousePos.x + 8 / zoom} y2={-mousePos.y}
              stroke="#fff" strokeWidth={0.5 / zoom} opacity={0.5} />
            <line x1={mousePos.x} y1={-mousePos.y - 8 / zoom} x2={mousePos.x} y2={-mousePos.y + 8 / zoom}
              stroke="#fff" strokeWidth={0.5 / zoom} opacity={0.5} />
          </>
        )}

        {/* Dimension inline input preview (line tool: first point → exact-length Enter) */}
        {activeTool === 'line' && tempPoints.length === 1 && dimInput && (() => {
          const len = parseFloat(dimInput);
          if (!(len > 0) || !isFinite(len)) return null;
          const start = tempPoints[0];
          const dx = mousePos.x - start.x;
          const dy = mousePos.y - start.y;
          const m = Math.hypot(dx, dy);
          const ux = m > 0.001 ? dx / m : 1;
          const uy = m > 0.001 ? dy / m : 0;
          const ex = start.x + ux * len;
          const ey = start.y + uy * len;
          return (
            <g>
              <line x1={start.x} y1={-start.y} x2={ex} y2={-ey}
                stroke="#e3b341" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${3 / zoom}`} />
              <circle cx={ex} cy={-ey} r={4 / zoom} fill="#e3b341" stroke="#fff" strokeWidth={1 / zoom} />
            </g>
          );
        })()}

        {/* Coordinate readout */}
        <text x={vbX + 8 / zoom} y={vbY + 16 / zoom} fill="#9ca3af" fontSize={12 / zoom} fontFamily="monospace">
          {`(${mousePos.x.toFixed(1)}, ${mousePos.y.toFixed(1)}) mm`}
        </text>
        <text x={vbX + 8 / zoom} y={vbY + 30 / zoom} fill="#6b7280" fontSize={10 / zoom} fontFamily="monospace">
          {`zoom: ${zoom.toFixed(2)}x · Ctrl+Z Undo · Shift=각도고정 · Grid: 5mm`}
        </text>

        {/* Tool indicator */}
        <text x={vbX + viewBoxW - 8 / zoom} y={vbY + 16 / zoom}
          fill="#388bfd" fontSize={11 / zoom} fontFamily="monospace" fontWeight="700" textAnchor="end">
          {activeTool.toUpperCase()}
        </text>
      </svg>

      {/* Dimension inline input overlay */}
      {activeTool === 'line' && tempPoints.length === 1 && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 12, display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 14px', borderRadius: 8,
          background: 'rgba(13,17,23,0.92)',
          border: `1px solid ${dimInput ? '#e3b341' : '#30363d'}`,
          color: '#c9d1d9', fontSize: 13, fontWeight: 600,
          fontFamily: 'system-ui, sans-serif', pointerEvents: 'none',
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        }}>
          {dimInput ? (
            <>
              <span style={{ color: '#e3b341', fontFamily: 'monospace', fontSize: 15 }}>
                {dimInput}<span style={{ opacity: 0.5 }}> mm</span>
              </span>
              <span style={{ color: '#6e7681', fontSize: 10, fontWeight: 400 }}>Enter ↵</span>
            </>
          ) : (
            <span style={{ color: '#6e7681', fontSize: 11, fontWeight: 400 }}>{L('dimHint')}</span>
          )}
        </div>
      )}

      {/* Cursor coordinate overlay */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8, zIndex: 10,
        background: 'rgba(13,17,23,0.85)', border: '1px solid #21262d',
        padding: '3px 10px', borderRadius: 6, pointerEvents: 'none',
        fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <span style={{ color: '#ef4444' }}>X</span><span style={{ color: '#c9d1d9' }}>{mousePos.x.toFixed(1)}</span>
        <span style={{ color: '#22c55e' }}>Y</span><span style={{ color: '#c9d1d9' }}>{mousePos.y.toFixed(1)}</span>
        <span style={{ color: '#484f58' }}>mm</span>
        {snapType !== 'none' && snapType !== 'grid' && (
          <span style={{ color: snapType === 'endpoint' ? '#22c55e' : '#f59e0b', marginLeft: 4, fontSize: 9 }}>
            ● {snapType}
          </span>
        )}
      </div>

      {/* Active tool HUD (bottom-left) */}
      {(() => {
        const toolMeta: Record<SketchTool, { label: string; icon: string; color: string }> = {
          line:         { label: '선',       icon: '/',   color: '#388bfd' },
          arc:          { label: '호',       icon: '⌒',  color: '#58a6ff' },
          circle:       { label: '원',       icon: '○',  color: '#3fb950' },
          rect:         { label: '사각형',   icon: '□',  color: '#f0883e' },
          polygon:      { label: '다각형',   icon: '⬡',  color: '#a371f7' },
          ellipse:      { label: '타원',     icon: '⬭',  color: '#56d364' },
          slot:         { label: '슬롯',     icon: '⬮',  color: '#79c0ff' },
          fillet:       { label: '필렛',     icon: '◜',  color: '#f0883e' },
          mirror:       { label: '미러',     icon: '⇆',  color: '#d2a8ff' },
          construction: { label: '보조선',   icon: '- -', color: '#484f58' },
          spline:       { label: '스플라인', icon: '∿',  color: '#e3b341' },
          offset:       { label: '오프셋',   icon: '⇉',  color: '#79c0ff' },
          trim:         { label: '자르기',   icon: '✂',  color: '#ff7b72' },
          select:       { label: '선택',     icon: '↖',  color: '#8b949e' },
          dimension:    { label: '치수',     icon: '↔',  color: '#d2a8ff' },
          constraint:   { label: '구속',     icon: '⚓',  color: '#ffa657' },
        };
        const meta = toolMeta[activeTool] ?? toolMeta.select;
        const ptCount = tempPoints.length + splinePoints.length;
        return (
          <div style={{
            position: 'absolute', left: 12, bottom: 12, display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 8,
            background: 'rgba(13,17,23,0.85)', border: `1px solid ${meta.color}55`,
            color: meta.color, fontSize: 12, fontWeight: 600,
            fontFamily: 'system-ui, sans-serif', pointerEvents: 'none',
            backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          }}>
            <span style={{ fontSize: 14 }}>{meta.icon}</span>
            <span>{meta.label}</span>
            {ptCount > 0 && (
              <span style={{ color: '#e3b341', fontWeight: 700 }}>· {ptCount}점</span>
            )}
            <span style={{ color: '#6e7681', fontWeight: 400, marginLeft: 4, fontSize: 11 }}>
              ESC 취소
            </span>
          </div>
        );
      })()}

      {/* Self-intersection warning badge */}
      {selfIntersections.length > 0 && (
        <div style={{
          position: 'absolute', left: 12, bottom: 48, padding: '6px 10px',
          borderRadius: 8, background: 'rgba(248,81,73,0.15)',
          border: '1px solid #f8514988', color: '#f85149',
          fontSize: 11, fontWeight: 600, fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
        }}>
          {L('intersect')}
        </div>
      )}

      {/* Transient toast (top-center) */}
      {toast && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 16px', borderRadius: 8,
          background: 'rgba(13,17,23,0.95)', border: '1px solid #388bfd88',
          color: '#e6edf3', fontSize: 12, fontWeight: 600,
          fontFamily: 'system-ui, sans-serif', pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          animation: 'sketch-toast-in 0.2s ease-out',
        }}>
          {toast}
        </div>
      )}
      <style>{`@keyframes sketch-toast-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>

      {/* ── Canvas controls: top-right button bar (grid / snap / fit) ── */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        display: 'flex', gap: 4, zIndex: 20,
      }}>
        {/* Grid toggle */}
        <button
          onClick={() => setGridVisible(v => !v)}
          title={gridVisible ? (lang === 'ko' ? '그리드 숨기기' : 'Hide grid') : (lang === 'ko' ? '그리드 표시' : 'Show grid')}
          style={{
            width: 28, height: 28, borderRadius: 5, border: 'none', cursor: 'pointer',
            background: gridVisible ? 'rgba(56,139,253,0.18)' : 'rgba(255,255,255,0.06)',
            color: gridVisible ? '#388bfd' : '#484f58',
            fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
        >⊞</button>
        {/* Snap toggle */}
        <button
          onClick={() => setSnapEnabled(v => !v)}
          title={snapEnabled ? (lang === 'ko' ? '스냅 끄기' : 'Snap off') : (lang === 'ko' ? '스냅 켜기' : 'Snap on')}
          style={{
            width: 28, height: 28, borderRadius: 5, border: 'none', cursor: 'pointer',
            background: snapEnabled ? 'rgba(56,139,253,0.18)' : 'rgba(255,255,255,0.06)',
            color: snapEnabled ? '#388bfd' : '#484f58',
            fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
        >⊙</button>
        {/* Fit to view */}
        <button
          onClick={fitToView}
          title={lang === 'ko' ? '화면에 맞추기' : 'Fit to view'}
          style={{
            width: 28, height: 28, borderRadius: 5, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)',
            color: '#8b949e',
            fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
        >⊡</button>
      </div>

      {/* ── Smart Dimension inline editor ── */}
      {pendingDim && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 30,
          background: 'rgba(13,17,23,0.97)',
          border: '1px solid #388bfd',
          borderRadius: 10, padding: '12px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200,
        }}>
          <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 700 }}>
            {lang === 'ko' ? '치수 설정 (mm)' : 'Set Dimension (mm)'}
          </div>
          <input
            autoFocus
            type="number"
            value={pendingDim.editValue}
            onChange={e => setPendingDim(d => d ? { ...d, editValue: e.target.value } : d)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = parseFloat(pendingDim.editValue);
                if (isFinite(v) && v > 0 && onAddDimension) {
                  onAddDimension({
                    id: genId('dim'),
                    type: 'linear',
                    entityIds: [pendingDim.entityId],
                    value: Math.round(v * 10) / 10,
                    position: pendingDim.position,
                    locked: true,
                  });
                }
                setPendingDim(null);
              } else if (e.key === 'Escape') {
                setPendingDim(null);
              }
            }}
            style={{
              background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
              color: '#e6edf3', fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
              padding: '6px 10px', outline: 'none', width: '100%', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => {
                const v = parseFloat(pendingDim.editValue);
                if (isFinite(v) && v > 0 && onAddDimension) {
                  onAddDimension({
                    id: genId('dim'), type: 'linear',
                    entityIds: [pendingDim.entityId],
                    value: Math.round(v * 10) / 10,
                    position: pendingDim.position, locked: true,
                  });
                }
                setPendingDim(null);
              }}
              style={{
                flex: 1, padding: '5px 0', borderRadius: 6,
                background: '#388bfd', border: 'none', color: '#fff',
                fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}
            >{lang === 'ko' ? '확인 ↵' : 'OK ↵'}</button>
            <button
              onClick={() => setPendingDim(null)}
              style={{
                padding: '5px 10px', borderRadius: 6,
                background: '#21262d', border: 'none', color: '#8b949e',
                fontWeight: 600, fontSize: 12, cursor: 'pointer',
              }}
            >ESC</button>
          </div>
        </div>
      )}

      {/* HTML empty state overlay (shown when canvas is empty) */}
      {profile.segments.length === 0 && tempPoints.length === 0 && !profile.closed && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 20, pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#388bfd', fontSize: 16, fontWeight: 700, margin: '0 0 6px', opacity: 0.7 }}>
              클릭하여 스케치 시작
            </p>
            <p style={{ color: '#6e7681', fontSize: 12, margin: 0, opacity: 0.6 }}>
              도구를 선택하고 캔버스를 클릭하세요
            </p>
          </div>
          {/* Quick tool buttons */}
          <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
            {([
              { tool: 'line' as SketchTool, label: '/ 선', color: '#388bfd' },
              { tool: 'circle' as SketchTool, label: '○ 원', color: '#3fb950' },
              { tool: 'rect' as SketchTool, label: '□ 사각', color: '#f0883e' },
              { tool: 'polygon' as SketchTool, label: '⬡ 다각', color: '#a371f7' },
            ]).map(({ tool, label, color }) => (
              <button
                key={tool}
                onClick={() => onToolChange?.(tool)}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: `1px solid ${color}33`,
                  background: `${color}11`, color, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                  fontFamily: 'system-ui, sans-serif',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${color}22`; e.currentTarget.style.borderColor = color; }}
                onMouseLeave={e => { e.currentTarget.style.background = `${color}11`; e.currentTarget.style.borderColor = `${color}33`; }}
              >
                {label}
              </button>
            ))}
          </div>
          <p style={{ color: '#484f58', fontSize: 11, margin: 0, opacity: 0.5 }}>
            또는 좌측 패널에서 3D 형상 선택
          </p>
        </div>
      )}
    </div>
  );
}

export default React.memo(SketchCanvas);
