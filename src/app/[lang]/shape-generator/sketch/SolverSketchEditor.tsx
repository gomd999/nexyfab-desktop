'use client';

/**
 * SolverSketchEditor — Phase 1.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Solver-backed parametric 2D sketch editor. Sibling to the v1.lite
 * `SketchEditor` (which stays in place as a regression sandbox).
 *
 * What's different from v1.lite:
 *   - Every geometric entity is mirrored in `SketchSolver` (planegcs WASM).
 *   - Constraints are first-class: horizontal/vertical/perpendicular/parallel/
 *     coincident/dimension(distance) exposed via toolbar. Adding a constraint
 *     immediately re-solves and the canvas reflects the solver's solution.
 *   - Drag a point → solver re-solves on every mouse-move; constraints hold.
 *   - DoF readout shows under/fully/over-constrained state authoritatively
 *     via `gcs.dof()`.
 *   - Conflicting/redundant constraints surfaced as a red status pill.
 *
 * Out of scope (Phase 1.4+):
 *   - Arc tool (placeholder), tangent constraint UI, snap-to-grid, undo/redo,
 *     sketch ↔ 3D plane mapping (Phase 1.4), persistence, multi-profile.
 *
 * Test surface (data-testids):
 *   solver-sketch-editor, solver-sketch-canvas,
 *   solver-sketch-tool-{select|line|circle|arc|rect|dimension},
 *   solver-sketch-constraint-{horizontal|vertical|perpendicular|parallel|coincident},
 *   solver-sketch-entity-{id},
 *   solver-sketch-dof, solver-sketch-status,
 *   solver-sketch-close.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createSketchSolver,
  type SketchSolver,
  type PointId,
  type LineId,
  type CircleId,
  type SolveResult,
} from '@/lib/sketch/solver';

// ─── public types ─────────────────────────────────────────────────────────

export type EditorLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export type EntityTool =
  | 'select'
  | 'line'
  | 'circle'
  | 'arc'
  | 'rect'
  | 'dimension'
  | 'trim'
  | 'extend'
  | 'offset';

export type ConstraintTool =
  | 'horizontal'
  | 'vertical'
  | 'perpendicular'
  | 'parallel'
  | 'coincident';

export interface SolverSketchEditorProps {
  lang?: EditorLang;
  width?: number;
  height?: number;
  onClose?: () => void;
  /**
   * Fires whenever the sketch's points or lines change. Used by wrapper
   * components (e.g., SolverSketchEditorWithExtrude) that need a mirror
   * of the current geometry without poking at internal state.
   */
  onSketchChange?: (state: {
    points: ReadonlyArray<{ id: string; x: number; y: number }>;
    lines: ReadonlyArray<{ id: string; p1: string; p2: string }>;
  }) => void;
}

// ─── i18n (6 langs) ───────────────────────────────────────────────────────

interface Dict {
  title: string;
  select: string; line: string; circle: string; arc: string; rect: string; dimension: string;
  trim: string; extend: string; offset: string;
  horizontal: string; vertical: string; perpendicular: string; parallel: string; coincident: string;
  close: string;
  loading: string;
  error: string;
  dofUnder: string; dofFull: string; dofOver: string;
  dofLabel: string;
  statusReady: string;
  statusSolving: string;
  statusConflict: string;
  statusRedundant: string;
  promptDistance: string;
  promptOffset: string;
  hint: string;
}

const dict: Record<EditorLang, Dict> = {
  ko: {
    title: '솔버 스케치',
    select: '선택', line: '선', circle: '원', arc: '호', rect: '사각형', dimension: '치수',
    trim: '자르기', extend: '연장', offset: '간격복사',
    horizontal: '수평', vertical: '수직', perpendicular: '수직(L)', parallel: '평행', coincident: '일치',
    close: '닫기',
    loading: '솔버 로딩 중...',
    error: '솔버 로딩 실패',
    dofUnder: '미정의', dofFull: '완전 정의', dofOver: '과정의',
    dofLabel: 'DoF',
    statusReady: '준비됨',
    statusSolving: '풀이 중',
    statusConflict: '충돌 제약',
    statusRedundant: '중복 제약',
    promptDistance: '거리 (mm):',
    promptOffset: '간격복사 거리 (mm):',
    hint: '도구를 선택하고 캔버스를 클릭하세요',
  },
  en: {
    title: 'Solver Sketch',
    select: 'Select', line: 'Line', circle: 'Circle', arc: 'Arc', rect: 'Rect', dimension: 'Dim',
    trim: 'Trim', extend: 'Extend', offset: 'Offset',
    horizontal: 'Horiz', vertical: 'Vert', perpendicular: 'Perp', parallel: 'Para', coincident: 'Coinc',
    close: 'Close',
    loading: 'Loading solver...',
    error: 'Solver failed to load',
    dofUnder: 'under-constrained', dofFull: 'fully constrained', dofOver: 'over-constrained',
    dofLabel: 'DoF',
    statusReady: 'ready',
    statusSolving: 'solving',
    statusConflict: 'conflicting constraints',
    statusRedundant: 'redundant constraints',
    promptDistance: 'Distance (mm):',
    promptOffset: 'Offset distance (mm):',
    hint: 'Pick a tool and click the canvas',
  },
  ja: {
    title: 'ソルバースケッチ',
    select: '選択', line: '線', circle: '円', arc: '弧', rect: '矩形', dimension: '寸法',
    trim: 'トリム', extend: '延長', offset: 'オフセット',
    horizontal: '水平', vertical: '垂直', perpendicular: '直角', parallel: '平行', coincident: '一致',
    close: '閉じる',
    loading: 'ソルバー読込中...',
    error: 'ソルバー読込失敗',
    dofUnder: '未定義', dofFull: '完全定義', dofOver: '過定義',
    dofLabel: 'DoF',
    statusReady: '準備完了',
    statusSolving: '計算中',
    statusConflict: '矛盾制約',
    statusRedundant: '冗長制約',
    promptDistance: '距離 (mm):',
    promptOffset: 'オフセット距離 (mm):',
    hint: 'ツールを選びキャンバスをクリック',
  },
  zh: {
    title: '求解器草图',
    select: '选择', line: '线', circle: '圆', arc: '弧', rect: '矩形', dimension: '尺寸',
    trim: '修剪', extend: '延伸', offset: '偏移',
    horizontal: '水平', vertical: '垂直', perpendicular: '垂直(L)', parallel: '平行', coincident: '重合',
    close: '关闭',
    loading: '加载求解器...',
    error: '求解器加载失败',
    dofUnder: '未约束', dofFull: '完全约束', dofOver: '过约束',
    dofLabel: 'DoF',
    statusReady: '就绪',
    statusSolving: '求解中',
    statusConflict: '冲突约束',
    statusRedundant: '冗余约束',
    promptDistance: '距离 (mm):',
    promptOffset: '偏移距离 (mm):',
    hint: '选择工具并点击画布',
  },
  es: {
    title: 'Boceto con solver',
    select: 'Sel', line: 'Línea', circle: 'Círc', arc: 'Arco', rect: 'Rect', dimension: 'Cota',
    trim: 'Recortar', extend: 'Extender', offset: 'Desfase',
    horizontal: 'Horiz', vertical: 'Vert', perpendicular: 'Perp', parallel: 'Paral', coincident: 'Coinc',
    close: 'Cerrar',
    loading: 'Cargando solver...',
    error: 'Solver falló al cargar',
    dofUnder: 'subrestringido', dofFull: 'totalmente restringido', dofOver: 'sobrerrestringido',
    dofLabel: 'DoF',
    statusReady: 'listo',
    statusSolving: 'resolviendo',
    statusConflict: 'restricciones en conflicto',
    statusRedundant: 'restricciones redundantes',
    promptDistance: 'Distancia (mm):',
    promptOffset: 'Distancia de desfase (mm):',
    hint: 'Elige herramienta y haz clic',
  },
  ar: {
    title: 'رسم بمحلل',
    select: 'تحديد', line: 'خط', circle: 'دائرة', arc: 'قوس', rect: 'مستطيل', dimension: 'بعد',
    trim: 'قص', extend: 'تمديد', offset: 'إزاحة',
    horizontal: 'أفقي', vertical: 'رأسي', perpendicular: 'متعامد', parallel: 'متوازي', coincident: 'متطابق',
    close: 'إغلاق',
    loading: 'تحميل المحلل...',
    error: 'فشل تحميل المحلل',
    dofUnder: 'ناقص القيود', dofFull: 'مقيد كاملاً', dofOver: 'مفرط القيود',
    dofLabel: 'DoF',
    statusReady: 'جاهز',
    statusSolving: 'يحل',
    statusConflict: 'قيود متعارضة',
    statusRedundant: 'قيود زائدة',
    promptDistance: 'المسافة (مم):',
    promptOffset: 'مسافة الإزاحة (مم):',
    hint: 'اختر أداة وانقر على اللوحة',
  },
};

// ─── view-side entity model (mirrors solver state for SVG render) ─────────

type EntityKind = 'point' | 'line' | 'circle';

interface ViewPoint {
  id: PointId;
  kind: 'point';
  x: number;
  y: number;
  fixed: boolean;
}
interface ViewLine {
  id: LineId;
  kind: 'line';
  p1: PointId;
  p2: PointId;
}
interface ViewCircle {
  id: CircleId;
  kind: 'circle';
  center: PointId;
  radius: number;
}
type ViewEntity = ViewPoint | ViewLine | ViewCircle;

// ─── tool button registry ─────────────────────────────────────────────────

interface EntityToolDef {
  id: EntityTool;
  label: (t: Dict) => string;
}
interface ConstraintToolDef {
  id: ConstraintTool;
  label: (t: Dict) => string;
  /** How many entities of which kind (in order) are required. */
  requires: ReadonlyArray<EntityKind>;
}

const ENTITY_TOOLS: EntityToolDef[] = [
  { id: 'select', label: (t) => t.select },
  { id: 'line', label: (t) => t.line },
  { id: 'circle', label: (t) => t.circle },
  { id: 'arc', label: (t) => t.arc },
  { id: 'rect', label: (t) => t.rect },
  { id: 'dimension', label: (t) => t.dimension },
  { id: 'trim', label: (t) => t.trim },
  { id: 'extend', label: (t) => t.extend },
  { id: 'offset', label: (t) => t.offset },
];

const CONSTRAINT_TOOLS: ConstraintToolDef[] = [
  { id: 'horizontal', label: (t) => t.horizontal, requires: ['line'] },
  { id: 'vertical', label: (t) => t.vertical, requires: ['line'] },
  { id: 'perpendicular', label: (t) => t.perpendicular, requires: ['line', 'line'] },
  { id: 'parallel', label: (t) => t.parallel, requires: ['line', 'line'] },
  { id: 'coincident', label: (t) => t.coincident, requires: ['point', 'point'] },
];

// ─── coordinate helper (same shape as v1.lite) ────────────────────────────

function eventToSvgPoint(
  evt: React.MouseEvent<SVGElement>,
  svg: SVGSVGElement | null,
): { x: number; y: number } {
  if (!svg) return { x: evt.clientX, y: evt.clientY };
  try {
    if (typeof svg.createSVGPoint !== 'function') {
      return { x: evt.clientX, y: evt.clientY };
    }
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    if (!ctm) return { x: evt.clientX, y: evt.clientY };
    const tx = pt.matrixTransform(ctm.inverse());
    return { x: tx.x, y: tx.y };
  } catch {
    return { x: evt.clientX, y: evt.clientY };
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Intersection of two infinite lines defined by (a1→a2) and (b1→b2).
 * Returns the intersection point + the parameter `t` along the first line
 * (0 = a1, 1 = a2, >1 = past a2 in the a1→a2 direction).
 * Returns null when the lines are parallel (denominator ~0).
 */
function lineLineIntersection(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): { x: number; y: number; t: number } | null {
  const dxA = a2.x - a1.x;
  const dyA = a2.y - a1.y;
  const dxB = b2.x - b1.x;
  const dyB = b2.y - b1.y;
  const denom = dxA * dyB - dyA * dxB;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * dyB - (b1.y - a1.y) * dxB) / denom;
  return { x: a1.x + dxA * t, y: a1.y + dyA * t, t };
}

/**
 * Perpendicular offset of a line segment by `distance` toward the side of
 * `clickPoint`. Returns the two offset endpoints.
 */
function offsetLine(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  distance: number,
  clickPoint: { x: number; y: number },
): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  // Unit perpendicular (rotated 90° CCW).
  const nx = -dy / len;
  const ny = dx / len;
  // Side test: sign of dot((click - p1), normal). Positive → same side as +normal.
  const side = (clickPoint.x - p1.x) * nx + (clickPoint.y - p1.y) * ny;
  const sign = side >= 0 ? 1 : -1;
  const ox = nx * distance * sign;
  const oy = ny * distance * sign;
  return {
    a: { x: p1.x + ox, y: p1.y + oy },
    b: { x: p2.x + ox, y: p2.y + oy },
  };
}

// ─── pending tool state ───────────────────────────────────────────────────

interface PendingLine { kind: 'line'; start: { x: number; y: number } }
interface PendingCircle { kind: 'circle'; center: { x: number; y: number } }
interface PendingRect { kind: 'rect'; corner: { x: number; y: number } }
interface PendingDimension { kind: 'dimension'; firstPoint: PointId }
type Pending = PendingLine | PendingCircle | PendingRect | PendingDimension | null;

// ─── grid ─────────────────────────────────────────────────────────────────

const GRID_MINOR = 5;
const GRID_MAJOR = 25;

function Grid({ width, height }: { width: number; height: number }): React.ReactElement {
  const out: React.ReactElement[] = [];
  for (let x = 0; x <= width; x += GRID_MINOR) {
    const major = x % GRID_MAJOR === 0;
    out.push(<line key={`vx-${x}`} x1={x} y1={0} x2={x} y2={height} stroke={major ? '#d4d4d8' : '#ececef'} strokeWidth={major ? 0.6 : 0.4} />);
  }
  for (let y = 0; y <= height; y += GRID_MINOR) {
    const major = y % GRID_MAJOR === 0;
    out.push(<line key={`hy-${y}`} x1={0} y1={y} x2={width} y2={y} stroke={major ? '#d4d4d8' : '#ececef'} strokeWidth={major ? 0.6 : 0.4} />);
  }
  return <g aria-hidden="true">{out}</g>;
}

// ─── DoF panel ────────────────────────────────────────────────────────────

function dofState(dof: number): 'under' | 'full' | 'over' {
  if (dof > 0) return 'under';
  if (dof < 0) return 'over';
  return 'full';
}

function dofColor(state: 'under' | 'full' | 'over'): string {
  if (state === 'full') return '#16a34a';
  if (state === 'over') return '#dc2626';
  return '#2563eb';
}

// ─── main component ───────────────────────────────────────────────────────

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

export default function SolverSketchEditor({
  lang = 'en',
  onSketchChange,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  onClose,
}: SolverSketchEditorProps): React.ReactElement {
  const t = dict[lang];
  const svgRef = useRef<SVGSVGElement | null>(null);

  // ─── solver lifecycle ───
  const [solver, setSolver] = useState<SketchSolver | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    let instance: SketchSolver | null = null;
    (async () => {
      try {
        const s = await createSketchSolver();
        if (canceled) {
          s.destroy();
          return;
        }
        instance = s;
        setSolver(s);
      } catch (e) {
        if (!canceled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      canceled = true;
      instance?.destroy();
    };
  }, []);

  // ─── view state mirrors solver state ───
  const [entities, setEntities] = useState<ViewEntity[]>([]);
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [tool, setTool] = useState<EntityTool>('select');
  const [pending, setPending] = useState<Pending>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [drag, setDrag] = useState<{ pointId: PointId } | null>(null);

  // ─── helper: refresh view entities from solver after a solve ───
  const refreshFromSolver = useCallback((s: SketchSolver, current: ViewEntity[]): ViewEntity[] => {
    return current.map((ent) => {
      if (ent.kind === 'point') {
        const p = s.point(ent.id);
        return { ...ent, x: p.x, y: p.y };
      }
      return ent;
    });
  }, []);

  // ─── helper: solve and update both view + result ───
  const solveAndApply = useCallback(
    (next?: ViewEntity[]) => {
      if (!solver) return;
      const result = solver.solve();
      setSolveResult(result);
      setEntities((prev) => refreshFromSolver(solver, next ?? prev));
    },
    [solver, refreshFromSolver],
  );

  // ─── tool switching ───
  const changeTool = useCallback((next: EntityTool): void => {
    setTool(next);
    setPending(null);
    if (next !== 'select') setSelected([]);
  }, []);

  // ─── entity creation: line ───
  const commitLine = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }): void => {
      if (!solver) return;
      const p1 = solver.addPoint(start.x, start.y);
      const p2 = solver.addPoint(end.x, end.y);
      const l = solver.addLine(p1, p2);
      const next: ViewEntity[] = [
        ...entities,
        { id: p1, kind: 'point', x: start.x, y: start.y, fixed: false },
        { id: p2, kind: 'point', x: end.x, y: end.y, fixed: false },
        { id: l, kind: 'line', p1, p2 },
      ];
      solveAndApply(next);
    },
    [solver, entities, solveAndApply],
  );

  // ─── entity creation: circle (center + edge-point defines radius) ───
  const commitCircle = useCallback(
    (center: { x: number; y: number }, edge: { x: number; y: number }): void => {
      if (!solver) return;
      const r = dist(center.x, center.y, edge.x, edge.y);
      if (r < 0.5) return;
      const c = solver.addPoint(center.x, center.y);
      const circle = solver.addCircle(c, r);
      const next: ViewEntity[] = [
        ...entities,
        { id: c, kind: 'point', x: center.x, y: center.y, fixed: false },
        { id: circle, kind: 'circle', center: c, radius: r },
      ];
      solveAndApply(next);
    },
    [solver, entities, solveAndApply],
  );

  // ─── entity creation: rect (4 lines + 4 coincidents at corners) ───
  const commitRect = useCallback(
    (a: { x: number; y: number }, b: { x: number; y: number }): void => {
      if (!solver) return;
      const x1 = Math.min(a.x, b.x);
      const y1 = Math.min(a.y, b.y);
      const x2 = Math.max(a.x, b.x);
      const y2 = Math.max(a.y, b.y);
      if (x2 - x1 < 0.5 || y2 - y1 < 0.5) return;

      // 4 corner points + 4 lines + horizontal/vertical pinning makes a robust rect.
      const p1 = solver.addPoint(x1, y1);
      const p2 = solver.addPoint(x2, y1);
      const p3 = solver.addPoint(x2, y2);
      const p4 = solver.addPoint(x1, y2);
      const top = solver.addLine(p1, p2);
      const right = solver.addLine(p2, p3);
      const bot = solver.addLine(p4, p3);
      const left = solver.addLine(p1, p4);
      solver.addHorizontal(top);
      solver.addHorizontal(bot);
      solver.addVertical(left);
      solver.addVertical(right);

      const next: ViewEntity[] = [
        ...entities,
        { id: p1, kind: 'point', x: x1, y: y1, fixed: false },
        { id: p2, kind: 'point', x: x2, y: y1, fixed: false },
        { id: p3, kind: 'point', x: x2, y: y2, fixed: false },
        { id: p4, kind: 'point', x: x1, y: y2, fixed: false },
        { id: top, kind: 'line', p1, p2 },
        { id: right, kind: 'line', p1: p2, p2: p3 },
        { id: bot, kind: 'line', p1: p4, p2: p3 },
        { id: left, kind: 'line', p1, p2: p4 },
      ];
      solveAndApply(next);
    },
    [solver, entities, solveAndApply],
  );

  // ─── modification tool: trim (Phase 2 — SW-style "trim to nearest intersection") ───
  // Click a line; find the nearest intersection (segment-segment, not infinite-line)
  // to the click point; move the endpoint on the click side to that intersection,
  // collapsing the click-side stub. If no intersection exists the legacy behavior
  // (remove the whole line) kicks in. Phase 1 limitation: a click that falls
  // between two intersections still removes one whole side — true split (one
  // line → two lines, dropping the middle) is deferred.
  const TRIM_TOLERANCE = 10; // sketch units; matches task spec
  const commitTrim = useCallback(
    (lineId: string, clickPoint: { x: number; y: number }): void => {
      if (!solver) return;
      const ent = entities.find((e) => e.id === lineId);
      // Phase 1 supports lines only; clicks on circles/arcs/points are no-ops.
      if (!ent || ent.kind !== 'line') return;

      const p1 = entities.find((e) => e.id === ent.p1);
      const p2 = entities.find((e) => e.id === ent.p2);
      if (!p1 || !p2 || p1.kind !== 'point' || p2.kind !== 'point') return;

      const a1 = { x: p1.x, y: p1.y };
      const a2 = { x: p2.x, y: p2.y };
      const dxA = a2.x - a1.x;
      const dyA = a2.y - a1.y;
      const lenSq = dxA * dxA + dyA * dyA;
      if (lenSq < 1e-9) return; // zero-length line

      // Project click onto the line. tClick in [0,1] = within segment.
      const tClick = ((clickPoint.x - a1.x) * dxA + (clickPoint.y - a1.y) * dyA) / lenSq;
      const perpX = clickPoint.x - (a1.x + dxA * tClick);
      const perpY = clickPoint.y - (a1.y + dyA * tClick);
      const perpDist = Math.hypot(perpX, perpY);
      // Too far from the line, or click effectively at an endpoint → no-op.
      if (perpDist > TRIM_TOLERANCE) return;
      if (tClick < 0.02 || tClick > 0.98) return;

      // Find all OTHER lines that intersect this one as a true segment-segment
      // intersection. Use lineLineIntersection (returns `t` along a1→a2); also
      // re-derive the param `u` along the other line to confirm 0<u<1.
      const otherLines = entities.filter(
        (e): e is ViewLine => e.kind === 'line' && e.id !== ent.id,
      );
      const hits: Array<{ t: number; x: number; y: number }> = [];
      for (const other of otherLines) {
        const ob1 = entities.find((e) => e.id === other.p1);
        const ob2 = entities.find((e) => e.id === other.p2);
        if (!ob1 || !ob2 || ob1.kind !== 'point' || ob2.kind !== 'point') continue;
        const hit = lineLineIntersection(a1, a2, { x: ob1.x, y: ob1.y }, { x: ob2.x, y: ob2.y });
        if (!hit) continue; // parallel
        // Verify hit is within the clicked segment.
        if (hit.t <= 0 || hit.t >= 1) continue;
        // Re-derive u along the other line — must also be within (0,1) for a
        // true crossing (skip when the other segment doesn't reach this line).
        const dxB = ob2.x - ob1.x;
        const dyB = ob2.y - ob1.y;
        const lenSqB = dxB * dxB + dyB * dyB;
        if (lenSqB < 1e-9) continue;
        const u = ((hit.x - ob1.x) * dxB + (hit.y - ob1.y) * dyB) / lenSqB;
        if (u <= 0 || u >= 1) continue;
        hits.push({ t: hit.t, x: hit.x, y: hit.y });
      }

      if (hits.length === 0) {
        // No intersection → legacy behavior: drop the whole line entity.
        console.warn(
          `[SolverSketchEditor.trim] no intersection found on line ${lineId}; removing whole line`,
        );
        const next = entities.filter((e) => e.id !== lineId);
        solveAndApply(next);
        return;
      }

      // Pick the intersection nearest to the click (in parameter space — same
      // order as Euclidean distance on a straight segment).
      let nearest = hits[0]!;
      for (const h of hits) {
        if (Math.abs(h.t - tClick) < Math.abs(nearest.t - tClick)) nearest = h;
      }
      // Move whichever endpoint sits on the click side of the intersection.
      // tClick > tNearest → click is on the p2 side → collapse p2 to intersection.
      const moveTargetId = tClick > nearest.t ? ent.p2 : ent.p1;
      try {
        solver.movePoint(moveTargetId as PointId, nearest.x, nearest.y);
        solveAndApply();
      } catch {
        // Endpoint is fixed (e.g. dimension-pinned) — skip silently; better UX
        // than throwing in the middle of a click handler.
      }
    },
    [solver, entities, solveAndApply],
  );

  // ─── modification tool: extend (move endpoint to nearest line intersection) ───
  const commitExtend = useCallback(
    (pointId: string): void => {
      if (!solver) return;
      const pt = entities.find((e) => e.id === pointId);
      if (!pt || pt.kind !== 'point') return;

      // Find lines that use this point as an endpoint.
      const lines = entities.filter((e): e is ViewLine => e.kind === 'line');
      const owning = lines.filter((l) => l.p1 === pt.id || l.p2 === pt.id);
      if (owning.length === 0) return;
      // Pick the first owning line — the "extended" line is unambiguous when
      // a single segment terminates at the point. (Multi-line junction is
      // Phase 2: would need disambiguation UI.)
      const line = owning[0]!;
      const other = lines.find((l) => l.id !== line.id);
      if (!other) return;

      const a1 = entities.find((e) => e.id === line.p1);
      const a2 = entities.find((e) => e.id === line.p2);
      const b1 = entities.find((e) => e.id === other.p1);
      const b2 = entities.find((e) => e.id === other.p2);
      if (
        !a1 || !a2 || !b1 || !b2 ||
        a1.kind !== 'point' || a2.kind !== 'point' ||
        b1.kind !== 'point' || b2.kind !== 'point'
      ) return;

      const hit = lineLineIntersection(
        { x: a1.x, y: a1.y },
        { x: a2.x, y: a2.y },
        { x: b1.x, y: b1.y },
        { x: b2.x, y: b2.y },
      );
      if (!hit) return; // parallel

      // We want to move `pt` (the clicked endpoint) to the intersection,
      // but only if the intersection lies past the endpoint (i.e. extending
      // outward, not shrinking). If it's between the two endpoints that's a
      // shrink — disallow in Phase 1.
      const isP1 = line.p1 === pt.id;
      // Param `t` is along a1→a2. If extending p1, intersection must be at t<0;
      // if extending p2, intersection must be at t>1.
      if (isP1 && hit.t > 0) return;
      if (!isP1 && hit.t < 1) return;

      try {
        solver.movePoint(pt.id as PointId, hit.x, hit.y);
        solveAndApply();
      } catch {
        /* fixed point — ignore */
      }
    },
    [solver, entities, solveAndApply],
  );

  // ─── modification tool: offset (parallel line at perpendicular distance) ───
  const commitOffset = useCallback(
    (lineId: string, clickPoint: { x: number; y: number }): void => {
      if (!solver) return;
      const ent = entities.find((e) => e.id === lineId);
      if (!ent || ent.kind !== 'line') return;
      const p1 = entities.find((e) => e.id === ent.p1);
      const p2 = entities.find((e) => e.id === ent.p2);
      if (!p1 || !p2 || p1.kind !== 'point' || p2.kind !== 'point') return;

      const raw = window.prompt(t.promptOffset);
      if (raw === null) return;
      const d = Number(raw);
      if (!Number.isFinite(d) || d <= 0) return;

      const off = offsetLine(
        { x: p1.x, y: p1.y },
        { x: p2.x, y: p2.y },
        d,
        clickPoint,
      );
      if (!off) return;

      const np1 = solver.addPoint(off.a.x, off.a.y);
      const np2 = solver.addPoint(off.b.x, off.b.y);
      const nl = solver.addLine(np1, np2);
      const next: ViewEntity[] = [
        ...entities,
        { id: np1, kind: 'point', x: off.a.x, y: off.a.y, fixed: false },
        { id: np2, kind: 'point', x: off.b.x, y: off.b.y, fixed: false },
        { id: nl, kind: 'line', p1: np1, p2: np2 },
      ];
      solveAndApply(next);
    },
    [solver, entities, solveAndApply, t.promptOffset],
  );

  // ─── canvas click ───
  const handleCanvasClick = useCallback(
    (evt: React.MouseEvent<SVGSVGElement>): void => {
      if (!solver) return;
      const pt = eventToSvgPoint(evt, svgRef.current);

      if (tool === 'select') {
        setSelected([]);
        return;
      }

      if (tool === 'line') {
        if (!pending || pending.kind !== 'line') {
          setPending({ kind: 'line', start: pt });
        } else {
          commitLine(pending.start, pt);
          setPending(null);
        }
        return;
      }
      if (tool === 'circle') {
        if (!pending || pending.kind !== 'circle') {
          setPending({ kind: 'circle', center: pt });
        } else {
          commitCircle(pending.center, pt);
          setPending(null);
        }
        return;
      }
      if (tool === 'rect') {
        if (!pending || pending.kind !== 'rect') {
          setPending({ kind: 'rect', corner: pt });
        } else {
          commitRect(pending.corner, pt);
          setPending(null);
        }
        return;
      }
      // arc: not yet wired — Phase 1.4 placeholder.
      // dimension: needs entity selection; canvas-empty click does nothing.
    },
    [solver, tool, pending, commitLine, commitCircle, commitRect],
  );

  // ─── canvas move (preview + drag) ───
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const handleCanvasMove = useCallback(
    (evt: React.MouseEvent<SVGSVGElement>): void => {
      const pt = eventToSvgPoint(evt, svgRef.current);
      setCursor(pt);
      if (drag && solver) {
        try {
          solver.movePoint(drag.pointId, pt.x, pt.y);
          solveAndApply();
        } catch {
          /* fixed point or solver not ready */
        }
      }
    },
    [drag, solver, solveAndApply],
  );

  const handleCanvasMouseUp = useCallback((): void => {
    if (drag) setDrag(null);
  }, [drag]);

  // ─── entity click ───
  const handleEntityClick = useCallback(
    (id: string, evt: React.MouseEvent<SVGElement>): void => {
      evt.stopPropagation();
      if (tool === 'select') {
        setSelected((prev) => {
          // Toggle: click selected = deselect; click unselected = add (up to 2 for constraints).
          if (prev.includes(id)) return prev.filter((x) => x !== id);
          return [...prev, id].slice(-2);
        });
        return;
      }
      if (tool === 'dimension') {
        const ent = entities.find((e) => e.id === id);
        if (!ent || ent.kind !== 'point') return;
        if (!pending || pending.kind !== 'dimension') {
          setPending({ kind: 'dimension', firstPoint: ent.id });
          return;
        }
        // Second point → prompt for distance.
        const distance = window.prompt(t.promptDistance);
        if (distance !== null && solver) {
          const d = Number(distance);
          if (Number.isFinite(d) && d > 0) {
            solver.addDistance(pending.firstPoint, ent.id, d);
            solveAndApply();
          }
        }
        setPending(null);
        return;
      }
      if (tool === 'trim') {
        const pt = eventToSvgPoint(evt as React.MouseEvent<SVGElement>, svgRef.current);
        commitTrim(id, pt);
        return;
      }
      if (tool === 'extend') {
        commitExtend(id);
        return;
      }
      if (tool === 'offset') {
        const pt = eventToSvgPoint(evt as React.MouseEvent<SVGElement>, svgRef.current);
        commitOffset(id, pt);
        return;
      }
    },
    [tool, entities, pending, solver, solveAndApply, t.promptDistance, commitTrim, commitExtend, commitOffset],
  );

  // ─── point mousedown → start drag ───
  const handlePointMouseDown = useCallback(
    (id: PointId, evt: React.MouseEvent<SVGElement>): void => {
      if (tool !== 'select') return;
      evt.stopPropagation();
      setDrag({ pointId: id });
    },
    [tool],
  );

  // ─── apply geometric constraint to current selection ───
  const applyConstraint = useCallback(
    (kind: ConstraintTool): void => {
      if (!solver) return;
      const def = CONSTRAINT_TOOLS.find((c) => c.id === kind);
      if (!def) return;
      const sel = selected
        .map((id) => entities.find((e) => e.id === id))
        .filter((e): e is ViewEntity => !!e);
      if (sel.length !== def.requires.length) return;
      // Type-check selection against requirements.
      for (let i = 0; i < def.requires.length; i++) {
        if (sel[i]!.kind !== def.requires[i]) return;
      }
      try {
        if (kind === 'horizontal' && sel[0]!.kind === 'line') {
          solver.addHorizontal(sel[0]!.id as LineId);
        } else if (kind === 'vertical' && sel[0]!.kind === 'line') {
          solver.addVertical(sel[0]!.id as LineId);
        } else if (kind === 'perpendicular' && sel[0]!.kind === 'line' && sel[1]!.kind === 'line') {
          solver.addPerpendicular(sel[0]!.id as LineId, sel[1]!.id as LineId);
        } else if (kind === 'parallel' && sel[0]!.kind === 'line' && sel[1]!.kind === 'line') {
          solver.addParallel(sel[0]!.id as LineId, sel[1]!.id as LineId);
        } else if (kind === 'coincident' && sel[0]!.kind === 'point' && sel[1]!.kind === 'point') {
          solver.addCoincident(sel[0]!.id as PointId, sel[1]!.id as PointId);
        }
        solveAndApply();
        setSelected([]);
      } catch (e) {
        /* solver rejected — ignore */
        void e;
      }
    },
    [solver, selected, entities, solveAndApply],
  );

  // ─── close ───
  const handleClose = useCallback((): void => {
    onClose?.();
  }, [onClose]);

  // ─── derived UI state ───
  const dof = solveResult?.dof ?? 0;
  const dofKind = dofState(dof);
  const dofText = dofKind === 'full' ? t.dofFull : dofKind === 'over' ? t.dofOver : t.dofUnder;
  const hasConflicts = (solveResult?.conflicting?.length ?? 0) > 0;
  const hasRedundant = (solveResult?.redundant?.length ?? 0) > 0;
  const statusText = hasConflicts
    ? t.statusConflict
    : hasRedundant
      ? t.statusRedundant
      : t.statusReady;

  const constraintEligible = useCallback(
    (def: ConstraintToolDef): boolean => {
      if (selected.length !== def.requires.length) return false;
      for (let i = 0; i < def.requires.length; i++) {
        const e = entities.find((x) => x.id === selected[i]);
        if (!e || e.kind !== def.requires[i]) return false;
      }
      return true;
    },
    [selected, entities],
  );

  // ─── points / lines / circles for render ───
  const renderPoints = useMemo(
    () => entities.filter((e): e is ViewPoint => e.kind === 'point'),
    [entities],
  );
  const renderLines = useMemo(
    () => entities.filter((e): e is ViewLine => e.kind === 'line'),
    [entities],
  );

  // ─── notify parent of geometry changes (Phase 2.A extrude wrapper hook) ──
  useEffect(() => {
    if (!onSketchChange) return;
    onSketchChange({
      points: renderPoints.map((p) => ({ id: p.id as string, x: p.x, y: p.y })),
      lines: renderLines.map((l) => ({ id: l.id as string, p1: l.p1 as string, p2: l.p2 as string })),
    });
  }, [renderPoints, renderLines, onSketchChange]);
  const renderCircles = useMemo(
    () => entities.filter((e): e is ViewCircle => e.kind === 'circle'),
    [entities],
  );

  const pointById = useMemo(() => {
    const m = new Map<PointId, ViewPoint>();
    for (const p of renderPoints) m.set(p.id, p);
    return m;
  }, [renderPoints]);

  if (loadError) {
    return (
      <div data-testid="solver-sketch-editor" data-state="error" style={{ padding: 12, color: '#dc2626' }}>
        {t.error}: {loadError}
      </div>
    );
  }
  if (!solver) {
    return (
      <div data-testid="solver-sketch-editor" data-state="loading" style={{ padding: 12, color: '#6b7280' }}>
        {t.loading}
      </div>
    );
  }

  return (
    <div
      data-testid="solver-sketch-editor"
      data-state="ready"
      tabIndex={0}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: '#fafafa',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        outline: 'none',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Title bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#111827' }}>{t.title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            data-testid="solver-sketch-dof"
            data-dof-state={dofKind}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              background: '#fff',
              border: `1px solid ${dofColor(dofKind)}`,
              color: dofColor(dofKind),
            }}
          >
            {t.dofLabel}: {dof} ({dofText})
          </span>
          <button
            type="button"
            onClick={handleClose}
            data-testid="solver-sketch-close"
            style={{ padding: '4px 10px', fontSize: 12, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.close}
          </button>
        </div>
      </div>

      {/* Entity toolbar */}
      <div role="toolbar" aria-label="entity tools" style={{ display: 'flex', gap: 4 }}>
        {ENTITY_TOOLS.map((b) => {
          const active = tool === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => changeTool(b.id)}
              data-testid={`solver-sketch-tool-${b.id}`}
              aria-pressed={active}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                background: active ? '#2563eb' : '#fff',
                color: active ? '#fff' : '#111827',
                border: '1px solid ' + (active ? '#2563eb' : '#d1d5db'),
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {b.label(t)}
            </button>
          );
        })}
      </div>

      {/* Constraint toolbar (enabled only when selection matches requires) */}
      <div role="toolbar" aria-label="constraint tools" style={{ display: 'flex', gap: 4 }}>
        {CONSTRAINT_TOOLS.map((c) => {
          const enabled = constraintEligible(c);
          return (
            <button
              key={c.id}
              type="button"
              disabled={!enabled}
              onClick={() => applyConstraint(c.id)}
              data-testid={`solver-sketch-constraint-${c.id}`}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                background: enabled ? '#fff' : '#f3f4f6',
                color: enabled ? '#111827' : '#9ca3af',
                border: '1px solid ' + (enabled ? '#d1d5db' : '#e5e7eb'),
                borderRadius: 4,
                cursor: enabled ? 'pointer' : 'not-allowed',
              }}
            >
              {c.label(t)}
            </button>
          );
        })}
      </div>

      {/* Canvas */}
      <svg
        ref={svgRef}
        data-testid="solver-sketch-canvas"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        style={{ background: '#ffffff', border: '1px solid #d1d5db', display: 'block' }}
      >
        <Grid width={width} height={height} />

        {/* lines */}
        {renderLines.map((l) => {
          const a = pointById.get(l.p1);
          const b = pointById.get(l.p2);
          if (!a || !b) return null;
          const isSel = selected.includes(l.id);
          return (
            <line
              key={l.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={isSel ? '#2563eb' : '#111827'}
              strokeWidth={isSel ? 2.4 : 1.6}
              data-testid={`solver-sketch-entity-${l.id}`}
              aria-selected={isSel}
              onClick={(e) => handleEntityClick(l.id, e)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}

        {/* circles */}
        {renderCircles.map((c) => {
          const ctr = pointById.get(c.center);
          if (!ctr) return null;
          const isSel = selected.includes(c.id);
          return (
            <circle
              key={c.id}
              cx={ctr.x}
              cy={ctr.y}
              r={c.radius}
              fill="none"
              stroke={isSel ? '#2563eb' : '#111827'}
              strokeWidth={isSel ? 2.4 : 1.6}
              data-testid={`solver-sketch-entity-${c.id}`}
              aria-selected={isSel}
              onClick={(e) => handleEntityClick(c.id, e)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}

        {/* points (draw last so they're on top) */}
        {renderPoints.map((p) => {
          const isSel = selected.includes(p.id);
          return (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r={isSel ? 4 : 3}
              fill={p.fixed ? '#dc2626' : isSel ? '#2563eb' : '#111827'}
              data-testid={`solver-sketch-entity-${p.id}`}
              data-point-fixed={p.fixed}
              aria-selected={isSel}
              onMouseDown={(e) => handlePointMouseDown(p.id, e)}
              onClick={(e) => handleEntityClick(p.id, e)}
              style={{ cursor: tool === 'select' ? 'move' : 'pointer' }}
            />
          );
        })}

        {/* in-progress preview */}
        {pending && cursor && pending.kind === 'line' && (
          <line x1={pending.start.x} y1={pending.start.y} x2={cursor.x} y2={cursor.y} stroke="#9ca3af" strokeWidth={1.4} strokeDasharray="4 3" />
        )}
        {pending && cursor && pending.kind === 'circle' && (
          <circle cx={pending.center.x} cy={pending.center.y} r={dist(pending.center.x, pending.center.y, cursor.x, cursor.y)} fill="none" stroke="#9ca3af" strokeWidth={1.4} strokeDasharray="4 3" />
        )}
        {pending && cursor && pending.kind === 'rect' && (() => {
          const x = Math.min(pending.corner.x, cursor.x);
          const y = Math.min(pending.corner.y, cursor.y);
          const w = Math.abs(cursor.x - pending.corner.x);
          const h = Math.abs(cursor.y - pending.corner.y);
          return <rect x={x} y={y} width={w} height={h} fill="none" stroke="#9ca3af" strokeWidth={1.4} strokeDasharray="4 3" />;
        })()}
      </svg>

      {/* status bar */}
      <div
        data-testid="solver-sketch-status"
        data-status={hasConflicts ? 'conflict' : hasRedundant ? 'redundant' : 'ready'}
        style={{
          fontSize: 11,
          color: hasConflicts ? '#dc2626' : hasRedundant ? '#d97706' : '#6b7280',
          textAlign: 'center',
        }}
      >
        {entities.length === 0 && !pending ? t.hint : statusText}
      </div>
    </div>
  );
}
