'use client';

// Drawing view (Phase 3) — shell-v2 styled standalone drafting screen.
// Mounted at /[lang]/shape-generator/drawing.
// Reuses existing freemium gate for PDF export. The Three.js ortho viewport
// integration with DimensionOverlay arrives in Phase 6 — Phase 3 ships the
// route + IA + commercial CTAs (PDF / Print) so marketing can showcase it.

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';
import { Shell } from './Shell';
import { I } from './Icons';
import { useShellBridge } from './shellBridgeStore';
import { useFreemiumGate } from '../hooks/useFreemiumGate';
import { readGeometry } from './geometryBridge';
import { DrawingLeftPane } from './sidebars/DrawingLeftPane';
import { DrawingRightPane } from './sidebars/DrawingRightPane';
import { generateAutoDimensions } from './autoDimension';

interface DrawingFrameProps {
  lang: string;
  isKo: boolean;
  projectId?: string;
}

interface SheetTreeNode {
  id: string;
  lbl: string;
  kind: 'sheet' | 'view' | 'layer';
  meta?: string;
  selected?: boolean;
}

export function DrawingFrame({ lang, isKo, projectId }: DrawingFrameProps) {
  const router = useRouter();
  const gate = useFreemiumGate();
  const [activeTab, setActiveTab] = useState('drawing');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState('view.iso');
  // Real geometry bridged from modeler via sessionStorage. Falls back to
  // primitive silhouette when not present (route visited directly).
  // Re-hydrate when the user navigates here from the modeler (sessionStorage
  // may have been updated mid-session).
  const [hydrateNonce, setHydrateNonce] = useState(0);
  useEffect(() => {
    const onFocus = () => setHydrateNonce(n => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const { edges, bbox } = useDrawingGeometry(projectId, hydrateNonce);
  // Multi-sheet pagination — defaults to 1, user can add more via +button.
  // Per-sheet state — each sheet has its own layout. Sheet1 = 4-view ortho,
  // subsequent sheets cycle through layouts so the multi-sheet UI is not
  // just visual chrome. Real per-sheet view editing is a follow-up.
  type SheetLayout = 'ortho4' | 'iso-only' | 'section' | 'detail';
  interface Sheet { id: string; title: string; layout: SheetLayout }
  const [sheets, setSheetsState] = useState<Sheet[]>([
    { id: 'sheet1', title: 'Sheet 1 · A3', layout: 'ortho4' },
  ]);
  const sheetIds = sheets.map(s => s.id);
  const [activeSheet, setActiveSheet] = useState('sheet1');
  const addSheet = () => {
    const next = sheets.length + 1;
    const cycle: SheetLayout[] = ['ortho4', 'iso-only', 'section', 'detail'];
    const layout = cycle[(next - 1) % cycle.length];
    const id = `sheet${next}`;
    const titles: Record<SheetLayout, string> = {
      'ortho4': `Sheet ${next} · A3 · 4-view`,
      'iso-only': `Sheet ${next} · A3 · Isometric`,
      'section': `Sheet ${next} · A3 · Section`,
      'detail': `Sheet ${next} · A3 · Detail`,
    };
    setSheetsState(prev => [...prev, { id, title: titles[layout], layout }]);
    setActiveSheet(id);
  };
  const activeSheetMeta = sheets.find(s => s.id === activeSheet) ?? sheets[0];

  const langSeg = lang === 'ko' ? 'kr' : lang;
  const project = projectId ? `?project=${projectId}` : '';

  // Cross-mode tab navigation — clicking File/Solid/Assembly/Inspect/Render/
  // View from inside Drawing jumps to the relevant route (or back to modeler).
  const handleTabChange = (id: string) => {
    setActiveTab(id);
    if (id === 'render') router.push(`/${langSeg}/shape-generator/render${project}`);
    else if (id === 'solid' || id === 'file' || id === 'inspect' || id === 'view')
      router.push(`/${langSeg}/shape-generator${project}`);
    else if (id === 'assembly')
      router.push(`/${langSeg}/shape-generator${project ? project + '&mode=assembly' : '?mode=assembly'}`);
  };

  // Sheet tree nodes — one entry per sheet plus its view children (built
  // from the per-sheet layout).
  const sheetTreeNodes: SheetTreeNode[] = sheets.flatMap(s => {
    const sheetNode: SheetTreeNode = { id: s.id, lbl: s.title, kind: 'sheet', selected: s.id === activeSheet };
    if (s.layout === 'ortho4') {
      return [
        sheetNode,
        { id: `${s.id}.top`, lbl: 'Top', kind: 'view', meta: '1:2' },
        { id: `${s.id}.front`, lbl: 'Front', kind: 'view', meta: '1:2' },
        { id: `${s.id}.right`, lbl: 'Right', kind: 'view', meta: '1:2' },
        { id: `${s.id}.iso`, lbl: 'Isometric', kind: 'view', meta: '1:2' },
      ];
    }
    if (s.layout === 'iso-only') {
      return [sheetNode, { id: `${s.id}.iso`, lbl: 'Isometric', kind: 'view', meta: '1:1' }];
    }
    if (s.layout === 'section') {
      return [sheetNode, { id: `${s.id}.section`, lbl: 'Section A-A', kind: 'view', meta: '1:1' }];
    }
    return [sheetNode, { id: `${s.id}.detail`, lbl: 'Detail', kind: 'view', meta: '2:1' }];
  });

  const onExportPDF = () => {
    gate.requirePro('share', async () => {
      if (typeof window === 'undefined') return;
      if (edges && bbox) {
        // Real vector PDF — projects each ortho view to SVG paths and
        // rasterizes them onto an A3 jspdf document. Vector preservation
        // means CAD users can scale without quality loss.
        try {
          const { jsPDF } = await import('jspdf');
          const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
          const views: { v: 'top' | 'front' | 'right' | 'iso'; x: number; y: number; label: string }[] = [
            { v: 'top',   x: 25,  y: 20,  label: 'TOP' },
            { v: 'iso',   x: 220, y: 20,  label: 'ISOMETRIC' },
            { v: 'front', x: 25,  y: 145, label: 'FRONT' },
            { v: 'right', x: 220, y: 145, label: 'RIGHT' },
          ];
          const W = 170, H = 110;
          doc.setLineWidth(0.25);
          doc.setDrawColor(40);
          for (const { v, x, y, label } of views) {
            // Frame
            doc.setLineWidth(0.15);
            doc.setDrawColor(160);
            doc.rect(x, y, W, H);
            // Re-project at PDF mm resolution so vector strokes stay crisp.
            const d = projectEdgesToSvg(edges, bbox, v, W, H);
            // Parse the M/L path data and emit jspdf line segments.
            doc.setLineWidth(0.25);
            doc.setDrawColor(20);
            const re = /M([\-\d.]+) ([\-\d.]+)L([\-\d.]+) ([\-\d.]+)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(d)) !== null) {
              const x1 = parseFloat(m[1]) + x;
              const y1 = parseFloat(m[2]) + y;
              const x2 = parseFloat(m[3]) + x;
              const y2 = parseFloat(m[4]) + y;
              doc.line(x1, y1, x2, y2);
            }
            // View label
            doc.setFontSize(8);
            doc.setTextColor(80);
            doc.text(label, x + 2, y + H - 2);
          }
          // Title block
          doc.setFontSize(7);
          doc.setTextColor(40);
          doc.text(`NexyFab Drawing  ·  Generated ${new Date().toISOString().slice(0, 10)}`, 25, 285);
          doc.save(`nexyfab-drawing-${Date.now()}.pdf`);
          return;
        } catch (e) {
          console.warn('jspdf export failed, falling back to print', e);
        }
      }
      // Fallback (no geometry bridged or jspdf load failed) — browser print.
      window.print();
    });
  };

  const onExportDXF = () => {
    gate.requirePro('export', () => {
      if (typeof window === 'undefined' || !edges || !bbox) return;
      // Emit a minimal AutoCAD R12-compatible DXF with the front-view
      // edges as LINE entities. Enough for downstream CAM tools to consume.
      const W = 1000, H = 700;
      const d = projectEdgesToSvg(edges, bbox, 'front', W, H);
      const re = /M([\-\d.]+) ([\-\d.]+)L([\-\d.]+) ([\-\d.]+)/g;
      const lines: string[] = [];
      lines.push('0\nSECTION\n2\nENTITIES');
      let m: RegExpExecArray | null;
      while ((m = re.exec(d)) !== null) {
        const x1 = parseFloat(m[1]);
        const y1 = H - parseFloat(m[2]); // flip Y to CAD convention
        const x2 = parseFloat(m[3]);
        const y2 = H - parseFloat(m[4]);
        lines.push(`0\nLINE\n8\n0\n10\n${x1.toFixed(3)}\n20\n${y1.toFixed(3)}\n30\n0\n11\n${x2.toFixed(3)}\n21\n${y2.toFixed(3)}\n31\n0`);
      }
      lines.push('0\nENDSEC\n0\nEOF');
      const blob = new Blob([lines.join('\n')], { type: 'application/dxf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexyfab-drawing-${Date.now()}.dxf`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <>
      <Shell
        mode="drawing"
        titleBar={{
          filename: isKo ? '도면 — 무제 파트' : 'Drawing — Untitled Part',
          savedAt: isKo ? '자동 저장됨' : 'Auto-saved',
          breadcrumbs: ['Projects', 'Drawing', isKo ? '도면 1' : 'Sheet 1'],
          mode: isKo ? '도면 모드' : 'DRAWING MODE',
          canUndo: true,
          canRedo: false,
          onShare: () => {},
          onPublish: onExportPDF,
          publishLabel: isKo ? 'PDF 내보내기' : 'Export PDF',
        }}
        ribbon={{
          activeTab,
          onTabChange: handleTabChange,
          onTool: id => {
            // Drawing-specific tool handlers — intercept export commands.
            if (id === 'file.export-pdf') onExportPDF();
            else if (id === 'file.export-dxf') onExportDXF();
            else setActiveTool(id);
          },
          isActive: id => activeTool === id,
        }}
        leftWidth={240}
        rightWidth={300}
        left={<DrawingLeftPane
          isKo={isKo}
          sheets={sheets}
          activeSheet={activeSheet}
          onSelectSheet={setActiveSheet}
          onAddSheet={addSheet}
        />}
        right={<DrawingRightPane
          isKo={isKo}
          onExportPdf={onExportPDF}
          onExportDxf={onExportDXF}
        />}
        viewport={
          <>
            <SheetTabs
              sheets={sheetIds}
              activeSheet={activeSheet}
              onSelect={setActiveSheet}
              onAdd={addSheet}
              isKo={isKo}
            />
            <DrawingCanvas
              isKo={isKo}
              edges={edges}
              bbox={bbox}
              layout={activeSheetMeta?.layout ?? 'ortho4'}
              onBackToModeling={() =>
                router.push(`/${lang}/shape-generator?shell=v2${projectId ? `&project=${projectId}` : ''}`)
              }
            />
          </>
        }
        statusBar={{
          left: [
            { id: 'sheet', items: [isKo ? '시트 1 · A3 · 297×420 mm' : 'Sheet 1 · A3 · 297×420 mm'] },
            { id: 'scale', items: [isKo ? '축척 1:2' : 'Scale 1:2'] },
          ],
          pills: [
            { id: 'standard', label: 'ISO 128' },
            { id: 'units', label: 'mm' },
          ],
        }}
      />

      {/* Freemium upgrade prompt — wired to the existing modal indirectly */}
      {gate.showUpgradePrompt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
          }}
          onClick={() => gate.setShowUpgradePrompt(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--nx-panel)',
              border: '1px solid var(--nx-border-strong)',
              borderRadius: 10,
              padding: 24,
              maxWidth: 420,
              color: 'var(--nx-text)',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>
              {isKo ? 'Pro 플랜 기능' : 'Pro feature'}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--nx-text-2)' }}>
              {gate.upgradeFeature}{' '}
              {isKo ? '은(는) Pro 플랜 이상에서 사용할 수 있습니다.' : 'is available on Pro and above.'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="nx-pillbtn"
                onClick={() => gate.setShowUpgradePrompt(false)}
              >
                {isKo ? '나중에' : 'Later'}
              </button>
              <button
                type="button"
                className="nx-pillbtn primary"
                onClick={() => router.push(`/${lang}/nexyfab/pricing`)}
              >
                {isKo ? 'Pro 업그레이드' : 'Upgrade to Pro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Pagination tabs across the top of the drawing canvas — mockup #17 shows
// "Sheet 1-A3 / Sheet 2 / Sheet 3 / +". Active tab + add button.
function SheetTabs({
  sheets,
  activeSheet,
  onSelect,
  onAdd,
  isKo,
}: {
  sheets: string[];
  activeSheet: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  isKo: boolean;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 12,
        right: 12,
        height: 28,
        display: 'flex',
        gap: 2,
        zIndex: 5,
        pointerEvents: 'auto',
      }}
    >
      {sheets.map((id, idx) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className={`nx-pillbtn${activeSheet === id ? ' primary' : ''}`}
          style={{ height: 22, padding: '0 12px', fontSize: 10 }}
        >
          {isKo ? `시트 ${idx + 1}` : `Sheet ${idx + 1}`}
          {idx === 0 && (
            <span className="mono" style={{ marginLeft: 6, fontSize: 9, opacity: 0.7 }}>
              A3
            </span>
          )}
        </button>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="nx-pillbtn"
        style={{ height: 22, padding: '0 8px', fontSize: 10 }}
        title={isKo ? '시트 추가' : 'Add sheet'}
      >
        +
      </button>
    </div>
  );
}

// Reads the geometry bridge once on mount + when projectId/nonce changes.
// Drawing route is separate from modeler so we hydrate via sessionStorage.
function useDrawingGeometry(projectId: string | undefined, nonce: number = 0): {
  edges: THREE.EdgesGeometry | null;
  bbox: THREE.Box3 | null;
} {
  return useMemo(() => {
    if (typeof window === 'undefined') return { edges: null, bbox: null };
    const result = readGeometry(projectId ?? 'local');
    if (!result) return { edges: null, bbox: null };
    const edges = new THREE.EdgesGeometry(result.geometry, 15);
    const bbox = new THREE.Box3().setFromBufferAttribute(
      result.geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    return { edges, bbox };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, nonce]);
}

// Projects 3D edges to 2D for a given orthographic view. Returns SVG path data.
function projectEdgesToSvg(
  edges: THREE.EdgesGeometry,
  bbox: THREE.Box3,
  view: 'top' | 'front' | 'right' | 'iso',
  width: number,
  height: number,
): string {
  const positions = edges.getAttribute('position') as THREE.BufferAttribute;
  if (!positions) return '';

  // Pick 2D axes per view (CAD convention: top = XY plane looking -Z,
  // front = XZ looking -Y, right = YZ looking -X).
  const project = (x: number, y: number, z: number): [number, number] => {
    switch (view) {
      case 'top':   return [x, -y];
      case 'front': return [x, -z];
      case 'right': return [y, -z];
      case 'iso': {
        // Standard 30°/30° iso (Z up).
        const cos30 = Math.cos(Math.PI / 6);
        const sin30 = Math.sin(Math.PI / 6);
        return [(x - y) * cos30, -z - (x + y) * sin30];
      }
    }
  };

  // Get 2D bounds.
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const allX: number[] = [];
  const allY: number[] = [];
  const corners = [
    [bbox.min.x, bbox.min.y, bbox.min.z], [bbox.max.x, bbox.min.y, bbox.min.z],
    [bbox.min.x, bbox.max.y, bbox.min.z], [bbox.max.x, bbox.max.y, bbox.min.z],
    [bbox.min.x, bbox.min.y, bbox.max.z], [bbox.max.x, bbox.min.y, bbox.max.z],
    [bbox.min.x, bbox.max.y, bbox.max.z], [bbox.max.x, bbox.max.y, bbox.max.z],
  ];
  for (const [x, y, z] of corners) {
    const [u, v] = project(x, y, z);
    allX.push(u); allY.push(v);
  }
  const u0 = Math.min(...allX), u1 = Math.max(...allX);
  const v0 = Math.min(...allY), v1 = Math.max(...allY);
  const du = u1 - u0 || 1, dv = v1 - v0 || 1;
  const padding = 8;
  const sx = (width - padding * 2) / du;
  const sy = (height - padding * 2) / dv;
  const s = Math.min(sx, sy);
  const ox = width / 2 - (u0 + du / 2) * s;
  const oy = height / 2 - (v0 + dv / 2) * s;

  const lines: string[] = [];
  // EdgesGeometry stores pairs of vertices (each edge = 2 positions).
  for (let i = 0; i < positions.count; i += 2) {
    const ax = positions.getX(i), ay = positions.getY(i), az = positions.getZ(i);
    const bx = positions.getX(i + 1), by = positions.getY(i + 1), bz = positions.getZ(i + 1);
    const [pu, pv] = project(ax, ay, az);
    const [qu, qv] = project(bx, by, bz);
    const x1 = (pu * s + ox).toFixed(2);
    const y1 = (pv * s + oy).toFixed(2);
    const x2 = (qu * s + ox).toFixed(2);
    const y2 = (qv * s + oy).toFixed(2);
    lines.push(`M${x1} ${y1}L${x2} ${y2}`);
  }
  // Suppress unused-var lint for `size` / `center` (kept for future centering).
  void size; void center;
  return lines.join('');
}

function OrthoSvgReal({
  view,
  edges,
  bbox,
  autoDim = true,
}: {
  view: 'top' | 'front' | 'right' | 'iso';
  edges: THREE.EdgesGeometry;
  bbox: THREE.Box3;
  autoDim?: boolean;
}) {
  const W = 100, H = 60;
  const d = useMemo(() => projectEdgesToSvg(edges, bbox, view, W, H), [edges, bbox, view]);
  const dims = useMemo(
    () => autoDim ? generateAutoDimensions(edges, bbox, view, W, H) : [],
    [edges, bbox, view, autoDim],
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="90%" height="90%" preserveAspectRatio="xMidYMid meet">
      <path d={d} fill="none" stroke="#222" strokeWidth="0.4" strokeLinecap="round" strokeLinejoin="round" />
      {dims.map((dim, i) => (
        <DimensionOverlay key={i} dim={dim} />
      ))}
    </svg>
  );
}

function DimensionOverlay({ dim }: { dim: ReturnType<typeof generateAutoDimensions>[number] }) {
  const stroke = '#2d6cdf';
  if (dim.kind === 'diameter' || dim.kind === 'radius') {
    return (
      <g>
        <circle cx={dim.x} cy={dim.y} r={dim.length / 2} fill="none" stroke={stroke} strokeWidth="0.25" strokeDasharray="0.6 0.4" />
        <text x={dim.x} y={dim.y - dim.length / 2 - 1} fontSize="2.5" textAnchor="middle" fill={stroke}>
          {dim.label ?? `${dim.value.toFixed(2)}`}
        </text>
      </g>
    );
  }
  if (dim.kind === 'horizontal') {
    return (
      <g>
        <line x1={dim.x - dim.length / 2} y1={dim.y} x2={dim.x + dim.length / 2} y2={dim.y} stroke={stroke} strokeWidth="0.25" />
        <line x1={dim.x - dim.length / 2} y1={dim.y - 1.5} x2={dim.x - dim.length / 2} y2={dim.y + 1.5} stroke={stroke} strokeWidth="0.25" />
        <line x1={dim.x + dim.length / 2} y1={dim.y - 1.5} x2={dim.x + dim.length / 2} y2={dim.y + 1.5} stroke={stroke} strokeWidth="0.25" />
        <text x={dim.x} y={dim.y - 1.2} fontSize="2.5" textAnchor="middle" fill={stroke}>
          {dim.value.toFixed(2)}
        </text>
      </g>
    );
  }
  return (
    <g>
      <line x1={dim.x} y1={dim.y - dim.length / 2} x2={dim.x} y2={dim.y + dim.length / 2} stroke={stroke} strokeWidth="0.25" />
      <line x1={dim.x - 1.5} y1={dim.y - dim.length / 2} x2={dim.x + 1.5} y2={dim.y - dim.length / 2} stroke={stroke} strokeWidth="0.25" />
      <line x1={dim.x - 1.5} y1={dim.y + dim.length / 2} x2={dim.x + 1.5} y2={dim.y + dim.length / 2} stroke={stroke} strokeWidth="0.25" />
      <text x={dim.x - 1.5} y={dim.y} fontSize="2.5" textAnchor="end" fill={stroke}>
        {dim.value.toFixed(2)}
      </text>
    </g>
  );
}

// Picks a primitive SVG silhouette based on selectedId so each ortho view
// roughly matches the user's part type. Used as a fallback when no real
// geometry has been bridged from the modeler yet.
function OrthoSvg({
  view,
  selectedLabel,
}: {
  view: 'top' | 'front' | 'right' | 'iso';
  selectedLabel: string | null;
}) {
  const id = (selectedLabel ?? '').toLowerCase();
  const isCyl = /(cyl|rod|shaft|hole)/.test(id);
  const isSphere = /(sphere|ball)/.test(id);
  const isCone = /cone/.test(id);
  const isTorus = /(torus|ring)/.test(id);
  // Default: box.
  const stroke = '#444';
  const fill = '#dcd8cc';
  return (
    <svg viewBox="0 0 100 60" width="70%" height="70%">
      {isCyl ? (
        view === 'top' ? (
          <circle cx={50} cy={30} r={20} fill={fill} stroke={stroke} strokeWidth="0.6" />
        ) : (
          <rect x={32} y={10} width={36} height={40} fill={fill} stroke={stroke} strokeWidth="0.6" rx={1} />
        )
      ) : isSphere ? (
        <circle cx={50} cy={30} r={22} fill={fill} stroke={stroke} strokeWidth="0.6" />
      ) : isCone ? (
        view === 'top' ? (
          <circle cx={50} cy={30} r={20} fill={fill} stroke={stroke} strokeWidth="0.6" />
        ) : (
          <polygon points="50,8 70,52 30,52" fill={fill} stroke={stroke} strokeWidth="0.6" />
        )
      ) : isTorus ? (
        view === 'top' ? (
          <g fill="none" stroke={stroke} strokeWidth="0.6">
            <circle cx={50} cy={30} r={22} fill={fill} />
            <circle cx={50} cy={30} r={10} fill="#f7f5ef" />
          </g>
        ) : (
          <ellipse cx={50} cy={30} rx={26} ry={6} fill={fill} stroke={stroke} strokeWidth="0.6" />
        )
      ) : view === 'iso' ? (
        // 3/4 box iso projection
        <g fill={fill} stroke={stroke} strokeWidth="0.6">
          <polygon points="20,32 50,18 80,32 50,46" fill="#c4bfa9" />
          <polygon points="20,32 50,46 50,52 20,38" />
          <polygon points="80,32 50,46 50,52 80,38" />
        </g>
      ) : (
        <g fill={fill} stroke={stroke} strokeWidth="0.6">
          <rect x={20} y={15} width={60} height={30} />
          <circle cx={32} cy={22} r={1.4} fill={stroke} />
          <circle cx={68} cy={22} r={1.4} fill={stroke} />
          <circle cx={32} cy={38} r={1.4} fill={stroke} />
          <circle cx={68} cy={38} r={1.4} fill={stroke} />
        </g>
      )}
    </svg>
  );
}

function DrawingTreePane({
  nodes,
  selectedId,
  onSelect,
  isKo,
}: {
  nodes: SheetTreeNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  isKo: boolean;
}) {
  return (
    <>
      <div className="nx-panel-h">
        <I.layers size={14} />
        {isKo ? '시트 · 뷰' : 'Sheets · Views'}
      </div>
      <div className="nx-panel-tabs">
        <button type="button" className="t active">
          {isKo ? '시트' : 'Sheets'}
        </button>
        <button type="button" className="t">
          {isKo ? '뷰' : 'Views'}
        </button>
        <button type="button" className="t">
          {isKo ? '레이어' : 'Layers'}
        </button>
      </div>
      <div className="nx-tree" style={{ flex: 1, overflow: 'auto' }}>
        {nodes.map(n => {
          const indent = n.kind === 'view' ? 18 : 0;
          return (
            <div
              key={n.id}
              className={`nx-tree-row ${selectedId === n.id ? 'selected' : ''}`}
              style={{ paddingLeft: 8 + indent }}
              onClick={() => onSelect(n.id)}
            >
              <span className={`twist ${n.kind === 'sheet' ? 'expanded' : 'leaf'}`}>▶</span>
              <span className="ico">
                {n.kind === 'sheet' ? <I.doc size={12} /> : <I.plane size={12} />}
              </span>
              <span className="lbl">{n.lbl}</span>
              {n.meta && <span className="meta">{n.meta}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DrawingPropsPane({ isKo, selectedView }: { isKo: boolean; selectedView: string }) {
  return (
    <>
      <div className="nx-panel-h">
        <I.cog size={14} />
        {isKo ? '뷰 속성' : 'View Properties'}
      </div>
      <div className="nx-props" style={{ padding: '8px 0' }}>
        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {isKo ? '선택된 뷰' : 'Selected view'}
          </div>
          <div className="row">
            <span className="k">{isKo ? '뷰' : 'View'}</span>
            <span className="v">{selectedView}</span>
          </div>
          <div className="row">
            <span className="k">{isKo ? '축척' : 'Scale'}</span>
            <span className="v">
              <input className="input short" defaultValue="1:2" />
            </span>
          </div>
          <div className="row">
            <span className="k">{isKo ? '스타일' : 'Style'}</span>
            <span className="v">{isKo ? '음영 + 모서리' : 'Shaded + edges'}</span>
          </div>
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>GD&T
          </div>
          <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--nx-text-3)' }}>
            {isKo
              ? '치수에 우클릭하여 위치도·평면도·진원도 등을 추가하세요.'
              : 'Right-click a dimension to add position, flatness, circularity callouts.'}
          </div>
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {isKo ? '타이틀 블록' : 'Title block'}
          </div>
          <div className="row">
            <span className="k">{isKo ? '도면 번호' : 'Part №'}</span>
            <span className="v">
              <input className="input" defaultValue="NXF-0001-A" />
            </span>
          </div>
          <div className="row">
            <span className="k">{isKo ? '재질' : 'Material'}</span>
            <span className="v">
              <input className="input" defaultValue="Al 6061-T6" />
            </span>
          </div>
          <div className="row">
            <span className="k">{isKo ? '제작자' : 'Drawn by'}</span>
            <span className="v">
              <input className="input" defaultValue="—" />
            </span>
          </div>
          <div className="row">
            <span className="k">{isKo ? '리비전' : 'Revision'}</span>
            <span className="v">
              <input className="input short" defaultValue="A" />
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function DrawingCanvas({
  isKo,
  edges,
  bbox,
  layout,
  onBackToModeling,
}: {
  isKo: boolean;
  edges: THREE.EdgesGeometry | null;
  bbox: THREE.Box3 | null;
  layout: 'ortho4' | 'iso-only' | 'section' | 'detail';
  onBackToModeling: () => void;
}) {
  // Pull modeler stats from the bridge — if the user has the modeler open
  // in another tab/route, these reflect real data; otherwise they're zero.
  const selectedLabel = useShellBridge(s => s.selectedLabel);
  const volume = useShellBridge(s => s.volume);
  const triangleCount = useShellBridge(s => s.triangleCount);

  // A3 paper aspect 297:420 → fits within available space.
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          background: '#f7f5ef',
          color: '#222',
          width: 'min(100%, 1100px)',
          aspectRatio: '297 / 210',
          boxShadow: 'var(--nx-shadow)',
          position: 'relative',
          borderRadius: 2,
          fontFamily: 'var(--font-inter), sans-serif',
        }}
      >
        {/* View boxes — count and arrangement depend on the active sheet's layout */}
        {(() => {
          const layoutViews: Record<typeof layout, ('top' | 'front' | 'right' | 'iso')[]> = {
            ortho4: ['top', 'iso', 'front', 'right'],
            'iso-only': ['iso'],
            section: ['front'],
            detail: ['iso'],
          };
          const views = layoutViews[layout];
          const cols = views.length === 1 ? '1fr' : '1fr 1fr';
          const rows = views.length <= 2 ? '1fr' : '1fr 1fr';
          return (
        <div
          style={{
            position: 'absolute',
            inset: '6% 6% 18% 6%',
            display: 'grid',
            gridTemplateColumns: cols,
            gridTemplateRows: rows,
            gap: 12,
          }}
        >
          {views.map(view => (
            <div
              key={view}
              style={{
                border: '1px dashed #aaa',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#555',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: 6,
                  fontSize: 9,
                  color: '#888',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {view === 'top' ? (isKo ? '평면' : 'Top') :
                 view === 'iso' ? (isKo ? '아이소' : 'Isometric') :
                 view === 'front' ? (isKo ? '정면' : 'Front') :
                 (isKo ? '우측' : 'Right')}
              </span>
              {edges && bbox ? (
                <OrthoSvgReal view={view} edges={edges} bbox={bbox} />
              ) : (
                <OrthoSvg view={view} selectedLabel={selectedLabel} />
              )}
            </div>
          ))}
        </div>
          );
        })()}

        {/* Title block */}
        <div
          style={{
            position: 'absolute',
            right: '6%',
            bottom: '4%',
            width: '38%',
            height: '12%',
            border: '1.5px solid #555',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            fontSize: 10,
            color: '#222',
          }}
        >
          {[
            {
              k: isKo ? '도면명' : 'Title',
              v: selectedLabel ?? (isKo ? '무제 파트' : 'Untitled Part'),
            },
            {
              k: isKo ? '도면 번호' : 'Part №',
              v: selectedLabel ? `NXF-${selectedLabel.slice(0, 6).toUpperCase()}` : 'NXF-0001-A',
            },
            {
              k: isKo ? '볼륨' : 'Volume',
              v: volume !== null ? `${volume.toFixed(1)} cm³` : '—',
            },
            {
              k: isKo ? '삼각형' : 'Triangles',
              v: triangleCount > 0 ? `${Math.round(triangleCount).toLocaleString()}` : '—',
            },
          ].map(c => (
            <div key={c.k} style={{ borderRight: '1px solid #999', borderBottom: '1px solid #999', padding: '4px 6px' }}>
              <div style={{ fontSize: 8, color: '#999', textTransform: 'uppercase' }}>{c.k}</div>
              <div style={{ fontWeight: 600, marginTop: 1 }}>{c.v}</div>
            </div>
          ))}
        </div>

        {/* Brand corner */}
        <div
          style={{
            position: 'absolute',
            left: '6%',
            bottom: '4%',
            fontSize: 10,
            color: '#666',
            letterSpacing: '0.1em',
          }}
        >
          NEXYFAB
        </div>
      </div>

      {/* Back-to-modeling floater */}
      <div className="nx-floater" style={{ bottom: 12, left: 12 }}>
        <button type="button" className="nx-pillbtn" onClick={onBackToModeling}>
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
            <I.caret_r size={12} />
          </span>
          {isKo ? '모델링으로 돌아가기' : 'Back to Modeling'}
        </button>
      </div>
    </div>
  );
}
