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
import { loc } from '../lib/loc';

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
      router.push(`/${langSeg}/shape-generator${project ? project + '&entry=assembly' : '?entry=assembly'}`);
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
    // Guest gate first → signup modal. Authenticated users still hit the
    // Pro gate as before for plan-tier paywalls.
    if (!gate.requireSignup('pdf-export', () => { /* proceed below */ })) return;
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
    if (!gate.requireSignup('dxf-export', () => { /* proceed */ })) return;
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
          filename: loc(lang, { ko: '도면 — 무제 파트', en: 'Drawing — Untitled Part', ja: '図面 — 無題パート', zh: '图纸 — 未命名零件', es: 'Plano — Pieza sin título', ar: 'رسم — قطعة بدون عنوان' }),
          savedAt: loc(lang, { ko: '자동 저장됨', en: 'Auto-saved', ja: '自動保存済み', zh: '已自动保存', es: 'Guardado automáticamente', ar: 'تم الحفظ تلقائيًا' }),
          breadcrumbs: ['Projects', 'Drawing', loc(lang, { ko: '도면 1', en: 'Sheet 1', ja: 'シート 1', zh: '图框 1', es: 'Hoja 1', ar: 'الورقة 1' })],
          onBrandClick: () => router.push(`/${langSeg}/nexyfab/hub`),
          mode: loc(lang, { ko: '도면 모드', en: 'DRAWING MODE', ja: '図面モード', zh: '图纸模式', es: 'MODO PLANO', ar: 'وضع الرسم' }),
          // No file/undo/share plumbing on this surface yet — TitleBar hides
          // quick buttons + Share when their handlers are omitted.
          onPublish: onExportPDF,
          publishLabel: loc(lang, { ko: 'PDF 내보내기', en: 'Export PDF', ja: 'PDF 書き出し', zh: '导出 PDF', es: 'Exportar PDF', ar: 'تصدير PDF' }),
        }}
        ribbon={{
          activeTab,
          onTabChange: handleTabChange,
          onTool: id => {
            // Every remaining DRAWING_GROUPS id maps to a real capability;
            // decorative ids were removed from the ribbon (honest wiring).
            if (id === 'output.pdf') onExportPDF();
            else if (id === 'output.dxf') onExportDXF();
            else if (id === 'output.print') { if (typeof window !== 'undefined') window.print(); }
            else if (id === 'sheet.new') addSheet();
          },
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
              lang={lang}
            />
            <DrawingCanvas
              isKo={isKo}
              lang={lang}
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
            { id: 'sheet', items: [loc(lang, { ko: '시트 1 · A3 · 297×420 mm', en: 'Sheet 1 · A3 · 297×420 mm', ja: 'シート 1 · A3 · 297×420 mm', zh: '图框 1 · A3 · 297×420 mm', es: 'Hoja 1 · A3 · 297×420 mm', ar: 'الورقة 1 · A3 · 297×420 مم' })] },
            { id: 'scale', items: [loc(lang, { ko: '축척 1:2', en: 'Scale 1:2', ja: '尺度 1:2', zh: '比例 1:2', es: 'Escala 1:2', ar: 'المقياس 1:2' })] },
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
              {loc(lang, { ko: 'Pro 플랜 기능', en: 'Pro feature', ja: 'Pro 機能', zh: 'Pro 功能', es: 'Función Pro', ar: 'ميزة Pro' })}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--nx-text-2)' }}>
              {gate.upgradeFeature}{' '}
              {loc(lang, { ko: '은(는) Pro 플랜 이상에서 사용할 수 있습니다.', en: 'is available on Pro and above.', ja: 'は Pro 以上でご利用いただけます。', zh: '在 Pro 及以上版本中可用。', es: 'está disponible en Pro y superiores.', ar: 'متاح في Pro وما فوق.' })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="nx-pillbtn"
                onClick={() => gate.setShowUpgradePrompt(false)}
              >
                {loc(lang, { ko: '나중에', en: 'Later', ja: '後で', zh: '稍后', es: 'Más tarde', ar: 'لاحقًا' })}
              </button>
              <button
                type="button"
                className="nx-pillbtn primary"
                onClick={() => router.push(`/${lang}/nexyfab/pricing`)}
              >
                {loc(lang, { ko: 'Pro 업그레이드', en: 'Upgrade to Pro', ja: 'Pro にアップグレード', zh: '升级到 Pro', es: 'Actualizar a Pro', ar: 'الترقية إلى Pro' })}
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
  lang,
}: {
  sheets: string[];
  activeSheet: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  isKo: boolean;
  lang: string;
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
          {loc(lang, { ko: `시트 ${idx + 1}`, en: `Sheet ${idx + 1}`, ja: `シート ${idx + 1}`, zh: `图框 ${idx + 1}`, es: `Hoja ${idx + 1}`, ar: `الورقة ${idx + 1}` })}
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
        title={loc(lang, { ko: '시트 추가', en: 'Add sheet', ja: 'シートを追加', zh: '添加图框', es: 'Añadir hoja', ar: 'إضافة ورقة' })}
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
  lang,
}: {
  nodes: SheetTreeNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  isKo: boolean;
  lang: string;
}) {
  return (
    <>
      <div className="nx-panel-h">
        <I.layers size={14} />
        {loc(lang, { ko: '시트 · 뷰', en: 'Sheets · Views', ja: 'シート · ビュー', zh: '图框 · 视图', es: 'Hojas · Vistas', ar: 'الأوراق · العروض' })}
      </div>
      <div className="nx-panel-tabs">
        <button type="button" className="t active">
          {loc(lang, { ko: '시트', en: 'Sheets', ja: 'シート', zh: '图框', es: 'Hojas', ar: 'الأوراق' })}
        </button>
        <button type="button" className="t">
          {loc(lang, { ko: '뷰', en: 'Views', ja: 'ビュー', zh: '视图', es: 'Vistas', ar: 'العروض' })}
        </button>
        <button type="button" className="t">
          {loc(lang, { ko: '레이어', en: 'Layers', ja: 'レイヤー', zh: '图层', es: 'Capas', ar: 'الطبقات' })}
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

function DrawingPropsPane({ isKo, lang, selectedView }: { isKo: boolean; lang: string; selectedView: string }) {
  return (
    <>
      <div className="nx-panel-h">
        <I.cog size={14} />
        {loc(lang, { ko: '뷰 속성', en: 'View Properties', ja: 'ビュー プロパティ', zh: '视图属性', es: 'Propiedades de vista', ar: 'خصائص العرض' })}
      </div>
      <div className="nx-props" style={{ padding: '8px 0' }}>
        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {loc(lang, { ko: '선택된 뷰', en: 'Selected view', ja: '選択中のビュー', zh: '所选视图', es: 'Vista seleccionada', ar: 'العرض المحدد' })}
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '뷰', en: 'View', ja: 'ビュー', zh: '视图', es: 'Vista', ar: 'العرض' })}</span>
            <span className="v">{selectedView}</span>
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '축척', en: 'Scale', ja: '尺度', zh: '比例', es: 'Escala', ar: 'المقياس' })}</span>
            <span className="v">
              <input className="input short" defaultValue="1:2" />
            </span>
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '스타일', en: 'Style', ja: 'スタイル', zh: '样式', es: 'Estilo', ar: 'النمط' })}</span>
            <span className="v">{loc(lang, { ko: '음영 + 모서리', en: 'Shaded + edges', ja: 'シェーディング + エッジ', zh: '着色 + 边线', es: 'Sombreado + aristas', ar: 'مظلل + حواف' })}</span>
          </div>
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>GD&T
          </div>
          <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--nx-text-3)' }}>
            {loc(lang, {
              ko: '치수에 우클릭하여 위치도·평면도·진원도 등을 추가하세요.',
              en: 'Right-click a dimension to add position, flatness, circularity callouts.',
              ja: '寸法を右クリックして、位置度・平面度・真円度などの公差記号を追加します。',
              zh: '右键单击尺寸以添加位置度、平面度、圆度等形位公差标注。',
              es: 'Haga clic derecho en una cota para añadir indicaciones de posición, planitud y circularidad.',
              ar: 'انقر بزر الفأرة الأيمن على البُعد لإضافة رموز الموضع والاستواء والاستدارة.',
            })}
          </div>
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {loc(lang, { ko: '타이틀 블록', en: 'Title block', ja: '表題欄', zh: '标题栏', es: 'Cuadro de rotulación', ar: 'خانة العنوان' })}
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '도면 번호', en: 'Part №', ja: '部品番号', zh: '零件号', es: 'N.º de pieza', ar: 'رقم القطعة' })}</span>
            <span className="v">
              <input className="input" defaultValue="NXF-0001-A" />
            </span>
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '재질', en: 'Material', ja: '材質', zh: '材料', es: 'Material', ar: 'المادة' })}</span>
            <span className="v">
              <input className="input" defaultValue="Al 6061-T6" />
            </span>
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '제작자', en: 'Drawn by', ja: '作図者', zh: '制图', es: 'Dibujado por', ar: 'رسم بواسطة' })}</span>
            <span className="v">
              <input className="input" defaultValue="—" />
            </span>
          </div>
          <div className="row">
            <span className="k">{loc(lang, { ko: '리비전', en: 'Revision', ja: 'リビジョン', zh: '版本', es: 'Revisión', ar: 'المراجعة' })}</span>
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
  lang,
  edges,
  bbox,
  layout,
  onBackToModeling,
}: {
  isKo: boolean;
  lang: string;
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
                {view === 'top' ? loc(lang, { ko: '평면', en: 'Top', ja: '平面', zh: '俯视', es: 'Superior', ar: 'علوي' }) :
                 view === 'iso' ? loc(lang, { ko: '아이소', en: 'Isometric', ja: '等角', zh: '等轴测', es: 'Isométrica', ar: 'متساوي القياس' }) :
                 view === 'front' ? loc(lang, { ko: '정면', en: 'Front', ja: '正面', zh: '主视', es: 'Frontal', ar: 'أمامي' }) :
                 loc(lang, { ko: '우측', en: 'Right', ja: '右側面', zh: '右视', es: 'Derecha', ar: 'يمين' })}
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
              k: loc(lang, { ko: '도면명', en: 'Title', ja: '図面名', zh: '图名', es: 'Título', ar: 'العنوان' }),
              v: selectedLabel ?? loc(lang, { ko: '무제 파트', en: 'Untitled Part', ja: '無題パート', zh: '未命名零件', es: 'Pieza sin título', ar: 'قطعة بدون عنوان' }),
            },
            {
              k: loc(lang, { ko: '도면 번호', en: 'Part №', ja: '部品番号', zh: '零件号', es: 'N.º de pieza', ar: 'رقم القطعة' }),
              v: selectedLabel ? `NXF-${selectedLabel.slice(0, 6).toUpperCase()}` : 'NXF-0001-A',
            },
            {
              k: loc(lang, { ko: '볼륨', en: 'Volume', ja: '体積', zh: '体积', es: 'Volumen', ar: 'الحجم' }),
              v: volume !== null ? `${volume.toFixed(1)} cm³` : '—',
            },
            {
              k: loc(lang, { ko: '삼각형', en: 'Triangles', ja: '三角形', zh: '三角面', es: 'Triángulos', ar: 'المثلثات' }),
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
          {loc(lang, { ko: '모델링으로 돌아가기', en: 'Back to Modeling', ja: 'モデリングに戻る', zh: '返回建模', es: 'Volver al modelado', ar: 'العودة إلى النمذجة' })}
        </button>
      </div>
    </div>
  );
}
