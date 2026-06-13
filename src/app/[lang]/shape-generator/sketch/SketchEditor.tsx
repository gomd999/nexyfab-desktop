'use client';

/**
 * SketchEditor — v1.lite preview of a clean, headless-testable 2D sketch
 * editor. Intentionally minimal sibling of the production `SketchCanvas`
 * (3,470 LoC, full feature set). DOES NOT replace it.
 *
 * Why a sibling:
 *   - SketchCanvas is too feature-rich to unit-test render-level behaviour
 *     (snap, multi-profile, dimensions, palette, etc.). This component is a
 *     small reference editor with a clean entity model that maps 1:1 onto
 *     the agent-side `SketchEntity` shape (`src/lib/ai/scad-agent/types.ts`).
 *   - Foundation for a parametric sketch → feature workflow. Rect is local
 *     to the UI; export to the agent decomposes it to 4 lines (the agent's
 *     `SketchEntityKind` is point|line|circle|arc only).
 *
 * Scope (do NOT extend without an explicit plan):
 *   - 4 tools: select / line / circle / rect
 *   - SVG canvas, fixed 800×600, light grid (5mm minor, 25mm major)
 *   - Click-click-creates for line/rect; click + drag-or-second-click for
 *     circle. Live preview while drawing.
 *   - Click entity to select (select tool); Delete key removes selection.
 *   - 6-lang i18n title bar; close button clears all state.
 *
 * Out of scope (future phases — DO NOT add here):
 *   - Snap, dimensions, constraints, undo, multi-profile, arc, polygon,
 *     ellipse, slot, fillet, mirror, trim, construction lines, extrude,
 *     CRDT, palette, radial menu — those all live in SketchCanvas.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────

/** Display languages — matches the project's 6-lang policy. */
export type EditorLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

/** Tools exposed in the lite toolbar. */
export type EditorTool = 'select' | 'line' | 'circle' | 'rect';

/** Local UI entity. Maps onto agent `SketchEntity` as follows:
 *    line   → kind:'line',   points:[start, end]
 *    circle → kind:'circle', points:[center], radius
 *    rect   → 4× kind:'line' (decomposed at export time)
 *  We keep rect as a first-class UI primitive because it's the most common
 *  drawing op and decomposition is trivial. */
export type EditorEntity =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number }
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number };

export interface SketchEditorProps {
  lang?: EditorLang;
  /** Canvas dimensions in pixels (1px = 1mm for v1.lite). */
  width?: number;
  height?: number;
  /** Called when the user hits the close button. Parent typically unmounts. */
  onClose?: () => void;
  /** Initial entities, e.g. when re-opening a draft. Optional. */
  initialEntities?: EditorEntity[];
}

// ─── i18n dict (6 langs) ──────────────────────────────────────────────────

const dict = {
  ko: { title: '스케치 (미리보기)', select: '선택', line: '선', circle: '원', rect: '사각형', close: '닫기', empty: '도구를 선택하고 캔버스를 클릭하세요' },
  en: { title: 'Sketch (preview)', select: 'Select', line: 'Line', circle: 'Circle', rect: 'Rectangle', close: 'Close', empty: 'Select a tool and click the canvas' },
  ja: { title: 'スケッチ (プレビュー)', select: '選択', line: '線', circle: '円', rect: '矩形', close: '閉じる', empty: 'ツールを選択してキャンバスをクリック' },
  zh: { title: '草图 (预览)', select: '选择', line: '线', circle: '圆', rect: '矩形', close: '关闭', empty: '选择工具并点击画布' },
  es: { title: 'Boceto (vista previa)', select: 'Seleccionar', line: 'Línea', circle: 'Círculo', rect: 'Rectángulo', close: 'Cerrar', empty: 'Selecciona una herramienta y haz clic en el lienzo' },
  ar: { title: 'رسم (معاينة)', select: 'تحديد', line: 'خط', circle: 'دائرة', rect: 'مستطيل', close: 'إغلاق', empty: 'اختر أداة ثم انقر على اللوحة' },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_${_idCounter}`;
}

/** Pull SVG-space coordinates from a pointer event. We use the SVG's own
 *  `getScreenCTM` inverse so the math survives any future CSS transform
 *  on the wrapper (zoom/pan would slot in here). */
function eventToSvgPoint(
  evt: React.MouseEvent<SVGElement>,
  svg: SVGSVGElement | null,
): { x: number; y: number } {
  if (!svg) return { x: evt.clientX, y: evt.clientY };
  // jsdom doesn't implement createSVGPoint / getScreenCTM — fall back to
  // raw client coords there. In real browsers the CTM inverse maps the
  // event through any CSS transform the wrapper might add later.
  try {
    if (typeof svg.createSVGPoint !== 'function') {
      return { x: evt.clientX, y: evt.clientY };
    }
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    if (!ctm) return { x: evt.clientX, y: evt.clientY };
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  } catch {
    return { x: evt.clientX, y: evt.clientY };
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Grid renderer ────────────────────────────────────────────────────────

const GRID_MINOR = 5;   // mm
const GRID_MAJOR = 25;  // mm

interface GridProps { width: number; height: number }

function Grid({ width, height }: GridProps): React.ReactElement {
  const lines: React.ReactElement[] = [];
  for (let x = 0; x <= width; x += GRID_MINOR) {
    const isMajor = x % GRID_MAJOR === 0;
    lines.push(
      <line
        key={`vx-${x}`} x1={x} y1={0} x2={x} y2={height}
        stroke={isMajor ? '#d4d4d8' : '#ececef'}
        strokeWidth={isMajor ? 0.6 : 0.4}
      />,
    );
  }
  for (let y = 0; y <= height; y += GRID_MINOR) {
    const isMajor = y % GRID_MAJOR === 0;
    lines.push(
      <line
        key={`hy-${y}`} x1={0} y1={y} x2={width} y2={y}
        stroke={isMajor ? '#d4d4d8' : '#ececef'}
        strokeWidth={isMajor ? 0.6 : 0.4}
      />,
    );
  }
  return <g aria-hidden="true">{lines}</g>;
}

// ─── Entity renderer ──────────────────────────────────────────────────────

interface EntityNodeProps {
  entity: EditorEntity;
  selected: boolean;
  onClick: (id: string, evt: React.MouseEvent<SVGElement>) => void;
}

function EntityNode({ entity, selected, onClick }: EntityNodeProps): React.ReactElement {
  const stroke = selected ? '#2563eb' : '#111827';
  const strokeWidth = selected ? 2.4 : 1.6;
  const handleClick = (e: React.MouseEvent<SVGElement>): void => onClick(entity.id, e);
  const common = {
    stroke,
    strokeWidth,
    fill: 'none' as const,
    onClick: handleClick,
    'data-testid': `sketch-entity-${entity.id}`,
    'aria-selected': selected,
    style: { cursor: 'pointer' as const },
  };

  if (entity.kind === 'line') {
    return <line {...common} x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} />;
  }
  if (entity.kind === 'circle') {
    return <circle {...common} cx={entity.cx} cy={entity.cy} r={entity.r} />;
  }
  // rect
  return <rect {...common} x={entity.x} y={entity.y} width={entity.w} height={entity.h} />;
}

// ─── Preview renderer (in-progress draw) ──────────────────────────────────

interface PreviewState {
  tool: 'line' | 'circle' | 'rect';
  start: { x: number; y: number };
  cursor: { x: number; y: number };
}

function PreviewNode({ state }: { state: PreviewState }): React.ReactElement {
  const common = {
    stroke: '#9ca3af',
    strokeWidth: 1.4,
    strokeDasharray: '4 3',
    fill: 'none' as const,
    pointerEvents: 'none' as const,
  };
  if (state.tool === 'line') {
    return <line {...common} x1={state.start.x} y1={state.start.y} x2={state.cursor.x} y2={state.cursor.y} />;
  }
  if (state.tool === 'circle') {
    const r = dist(state.start.x, state.start.y, state.cursor.x, state.cursor.y);
    return <circle {...common} cx={state.start.x} cy={state.start.y} r={r} />;
  }
  // rect
  const x = Math.min(state.start.x, state.cursor.x);
  const y = Math.min(state.start.y, state.cursor.y);
  const w = Math.abs(state.cursor.x - state.start.x);
  const h = Math.abs(state.cursor.y - state.start.y);
  return <rect {...common} x={x} y={y} width={w} height={h} />;
}

// ─── Main component ───────────────────────────────────────────────────────

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

export default function SketchEditor({
  lang = 'en',
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  onClose,
  initialEntities,
}: SketchEditorProps): React.ReactElement {
  const t = dict[lang];
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [tool, setTool] = useState<EditorTool>('select');
  const [entities, setEntities] = useState<EditorEntity[]>(initialEntities ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // ─── Tool change resets in-progress draw and clears selection ──────────
  const changeTool = useCallback((next: EditorTool): void => {
    setTool(next);
    setPreview(null);
    if (next !== 'select') setSelectedId(null);
  }, []);

  // ─── Canvas click handler ──────────────────────────────────────────────
  const handleCanvasClick = useCallback((evt: React.MouseEvent<SVGSVGElement>): void => {
    const pt = eventToSvgPoint(evt, svgRef.current);

    if (tool === 'select') {
      // Click on empty canvas deselects (entity clicks stopPropagation).
      setSelectedId(null);
      return;
    }

    if (!preview) {
      setPreview({ tool, start: pt, cursor: pt });
      return;
    }

    // Second click — commit the entity.
    if (preview.tool === 'line') {
      const ent: EditorEntity = {
        id: genId('ln'), kind: 'line',
        x1: preview.start.x, y1: preview.start.y,
        x2: pt.x, y2: pt.y,
      };
      setEntities(prev => [...prev, ent]);
    } else if (preview.tool === 'circle') {
      const r = dist(preview.start.x, preview.start.y, pt.x, pt.y);
      if (r > 0.5) {
        const ent: EditorEntity = {
          id: genId('cr'), kind: 'circle',
          cx: preview.start.x, cy: preview.start.y, r,
        };
        setEntities(prev => [...prev, ent]);
      }
    } else {
      const x = Math.min(preview.start.x, pt.x);
      const y = Math.min(preview.start.y, pt.y);
      const w = Math.abs(pt.x - preview.start.x);
      const h = Math.abs(pt.y - preview.start.y);
      if (w > 0.5 && h > 0.5) {
        const ent: EditorEntity = { id: genId('rc'), kind: 'rect', x, y, w, h };
        setEntities(prev => [...prev, ent]);
      }
    }
    setPreview(null);
  }, [tool, preview]);

  const handleCanvasMove = useCallback((evt: React.MouseEvent<SVGSVGElement>): void => {
    if (!preview) return;
    const pt = eventToSvgPoint(evt, svgRef.current);
    setPreview(prev => prev ? { ...prev, cursor: pt } : prev);
  }, [preview]);

  const handleEntityClick = useCallback((id: string, evt: React.MouseEvent<SVGElement>): void => {
    if (tool !== 'select') return;
    evt.stopPropagation();
    setSelectedId(id);
  }, [tool]);

  // ─── Keyboard: Delete removes selection, Escape cancels in-progress draw.
  const handleKeyDown = useCallback((evt: React.KeyboardEvent<HTMLDivElement>): void => {
    if (evt.key === 'Delete' || evt.key === 'Backspace') {
      if (selectedId) {
        setEntities(prev => prev.filter(e => e.id !== selectedId));
        setSelectedId(null);
      }
    } else if (evt.key === 'Escape') {
      setPreview(null);
      setSelectedId(null);
    }
  }, [selectedId]);

  const handleClose = useCallback((): void => {
    setEntities([]);
    setSelectedId(null);
    setPreview(null);
    onClose?.();
  }, [onClose]);

  // ─── Toolbar buttons ───────────────────────────────────────────────────
  const toolButtons: { id: EditorTool; label: string }[] = useMemo(() => [
    { id: 'select', label: t.select },
    { id: 'line', label: t.line },
    { id: 'circle', label: t.circle },
    { id: 'rect', label: t.rect },
  ], [t]);

  return (
    <div
      data-testid="sketch-editor"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: '#fafafa',
        border: '1px solid var(--nx-border)',
        borderRadius: 8,
        outline: 'none',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Title bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--nx-text)' }}>{t.title}</h2>
        <button
          type="button"
          onClick={handleClose}
          data-testid="sketch-close"
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: 'var(--nx-panel)',
            border: '1px solid var(--nx-border)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {t.close}
        </button>
      </div>

      {/* Toolbar */}
      <div role="toolbar" aria-label={t.title} style={{ display: 'flex', gap: 4 }}>
        {toolButtons.map(b => {
          const active = tool === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => changeTool(b.id)}
              data-testid={`sketch-tool-${b.id}`}
              aria-pressed={active}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                background: active ? '#2563eb' : 'var(--nx-panel)',
                color: active ? '#fff' : 'var(--nx-text)',
                border: '1px solid ' + (active ? '#2563eb' : 'var(--nx-border)'),
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {b.label}
            </button>
          );
        })}
      </div>

      {/* Canvas */}
      <svg
        ref={svgRef}
        data-testid="sketch-canvas"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMove}
        style={{ background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', display: 'block' }}
      >
        <Grid width={width} height={height} />
        {entities.map(ent => (
          <EntityNode
            key={ent.id}
            entity={ent}
            selected={selectedId === ent.id}
            onClick={handleEntityClick}
          />
        ))}
        {preview && <PreviewNode state={preview} />}
      </svg>

      {/* Status hint when empty */}
      {entities.length === 0 && !preview && (
        <div
          data-testid="sketch-hint"
          style={{ fontSize: 11, color: 'var(--nx-text-2)', textAlign: 'center' }}
        >
          {t.empty}
        </div>
      )}
    </div>
  );
}
