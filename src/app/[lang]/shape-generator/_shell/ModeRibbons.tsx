'use client';

// Ribbon variants per editor mode.
// Each one renders a set of <Grp><Tool/></Grp> groups inside <Ribbon>.
// Action callbacks come from the parent (page or route) so the existing
// CommandToolbar / sketch handlers can be reused unmodified.

import { Grp, Ribbon, Tool, type RibbonTabDef } from './Ribbon';
import type { IconName } from './Icons';

export type ShellMode = 'modeling' | 'sketch' | 'assembly' | 'drawing' | 'render' | 'sheetmetal';

// Generic tool-button descriptor used by each ribbon definition.
export interface RibbonAction {
  id: string;
  lbl: string;
  ico: IconName;
  big?: boolean;
  hasCaret?: boolean;
}

// Parent supplies handler/active-state for any tool id it cares about.
export type RibbonHandler = (id: string) => void;
export type RibbonActiveCheck = (id: string) => boolean;

export interface ModeRibbonProps {
  mode: ShellMode;
  tabs: RibbonTabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onTool: RibbonHandler;
  isActive?: RibbonActiveCheck;
}

// ── Solid (Modeling) ─────────────────────────────────────────────────────────
const SOLID_GROUPS: { title: string; rows: RibbonAction[][] }[] = [
  {
    title: 'Sketch',
    rows: [
      [{ id: 'sketch', lbl: 'Create Sketch', ico: 'sketch', hasCaret: true }],
      [
        { id: 'sketch.line', lbl: 'Line', ico: 'line', big: false },
        { id: 'sketch.rect', lbl: 'Rectangle', ico: 'rect', big: false },
        { id: 'sketch.circle', lbl: 'Circle', ico: 'circle', big: false },
      ],
    ],
  },
  {
    title: 'Create',
    rows: [
      [
        { id: 'extrude', lbl: 'Extrude', ico: 'extrude', hasCaret: true },
        { id: 'revolve', lbl: 'Revolve', ico: 'revolve' },
        { id: 'sweep', lbl: 'Sweep', ico: 'sweep' },
        { id: 'loft', lbl: 'Loft', ico: 'loft' },
        { id: 'hole', lbl: 'Hole', ico: 'hole', hasCaret: true },
      ],
    ],
  },
  {
    title: 'Modify',
    rows: [
      [
        { id: 'fillet', lbl: 'Fillet', ico: 'fillet', hasCaret: true },
        // Variable-radius fillet (start→end radius along the edge) — the F3
        // OCCT B-rep capability. Select an edge first, like uniform Fillet.
        { id: 'variableFillet', lbl: 'Variable Fillet', ico: 'fillet' },
        { id: 'chamfer', lbl: 'Chamfer', ico: 'chamfer' },
        { id: 'shell', lbl: 'Shell', ico: 'shell' },
        { id: 'draft', lbl: 'Draft', ico: 'draft' },
        // Phase-1 entry — opens the push/pull gizmo on the selected face.
        // The drag → upstream-parameter mapping is wired up in phase-2 (#233).
        { id: 'push-pull', lbl: 'Push/Pull', ico: 'extrude' },
      ],
      [
        // Direct editing (Phase 1) — both operate on a pre-selected face.
        // Delete Face = boss/pocket/hole removal + planar healing (B-rep);
        // Offset Face = planar face offset along its normal (±).
        { id: 'direct.delete-face', lbl: 'Delete Face', ico: 'combine', big: false },
        { id: 'direct.offset-face', lbl: 'Offset Face', ico: 'draft', big: false },
      ],
    ],
  },
  {
    title: 'Pattern',
    rows: [
      [
        { id: 'pattern.linear', lbl: 'Linear', ico: 'pattern', hasCaret: true },
        { id: 'mirror', lbl: 'Mirror', ico: 'mirror' },
        { id: 'combine', lbl: 'Combine', ico: 'combine' },
      ],
    ],
  },
  {
    title: 'Inspect',
    rows: [
      [{ id: 'measure', lbl: 'Measure', ico: 'ruler', hasCaret: true }],
      [
        { id: 'section', lbl: 'Section view', ico: 'section', big: false },
        { id: 'mass-props', lbl: 'Mass props', ico: 'globe', big: false },
        { id: 'interference', lbl: 'Interference', ico: 'bolt', big: false },
      ],
    ],
  },
  {
    title: 'Nexy AI',
    rows: [
      [{ id: 'ai.suggest', lbl: 'Suggest', ico: 'ai', hasCaret: true }],
      [
        { id: 'ai.lighten', lbl: 'Lighten −30%', ico: 'ai', big: false },
        { id: 'ai.ribs', lbl: 'Add ribs', ico: 'ai', big: false },
        { id: 'ai.fillet', lbl: 'Auto-fillet', ico: 'ai', big: false },
      ],
    ],
  },
  {
    title: 'OpenSCAD',
    rows: [
      // Toggleable read-only projection of the feature tree as OpenSCAD code.
      [{ id: 'view.scad', lbl: 'View SCAD', ico: 'doc' }],
    ],
  },
];

// ── Sketch ───────────────────────────────────────────────────────────────────
const SKETCH_GROUPS: { title: string; rows: RibbonAction[][] }[] = [
  {
    title: 'Draw',
    rows: [
      [
        { id: 'sketch.line', lbl: 'Line', ico: 'line' },
        { id: 'sketch.rect', lbl: 'Rectangle', ico: 'rect' },
        { id: 'sketch.circle', lbl: 'Circle', ico: 'circle' },
        { id: 'sketch.arc', lbl: 'Arc', ico: 'arc' },
        { id: 'sketch.poly', lbl: 'Polygon', ico: 'poly' },
        { id: 'sketch.spline', lbl: 'Spline', ico: 'spline' },
      ],
    ],
  },
  {
    title: 'Modify',
    rows: [
      [
        { id: 'sketch.trim', lbl: 'Trim', ico: 'trim' },
        { id: 'sketch.offset', lbl: 'Offset', ico: 'offset' },
        { id: 'sketch.mirror', lbl: 'Mirror', ico: 'mirror' },
      ],
    ],
  },
  {
    title: 'Constrain',
    rows: [
      [
        { id: 'sketch.dim', lbl: 'Dimension', ico: 'dim', hasCaret: true },
        { id: 'sketch.constraint', lbl: 'Constraint', ico: 'constraint', hasCaret: true },
      ],
    ],
  },
  {
    title: 'Project',
    rows: [[{ id: 'sketch.project', lbl: 'Project geom', ico: 'plane' }]],
  },
  {
    title: 'Body',
    rows: [
      [
        // Multi-body workflow — extrude only the active profile, stay in
        // sketch so the next profile can be extruded separately.
        { id: 'sketch.extrude-active', lbl: 'Body & continue', ico: 'extrude' },
        // Direct revolve from the open sketch — uses the same active
        // profile + sketchConfig.revolveAxis as the action menu path,
        // so this is "Revolve" without leaving sketch mode.
        { id: 'sketch.revolve', lbl: 'Revolve', ico: 'revolve' },
        // Sweep path tool — canvas clicks append to config.sweepPath.points;
        // ESC returns to select, switching tool away auto-commits the path.
        { id: 'sketch.sweep-path', lbl: 'Sweep path', ico: 'sweep' },
      ],
    ],
  },
  {
    title: 'Finish',
    rows: [[{ id: 'sketch.finish', lbl: 'Finish Sketch', ico: 'check' }]],
  },
];

// ── Assembly ─────────────────────────────────────────────────────────────────
const ASSEMBLY_GROUPS: { title: string; rows: RibbonAction[][] }[] = [
  {
    title: 'Components',
    rows: [
      [
        { id: 'asm.insert', lbl: 'Insert', ico: 'plus', hasCaret: true },
        { id: 'asm.replace', lbl: 'Replace', ico: 'cube' },
        { id: 'asm.subassembly', lbl: 'Sub-asm', ico: 'cube' },
      ],
    ],
  },
  {
    title: 'Mate',
    rows: [
      [
        { id: 'mate.coincident', lbl: 'Coincident', ico: 'link', hasCaret: true },
        { id: 'mate.concentric', lbl: 'Concentric', ico: 'circle' },
        { id: 'mate.distance', lbl: 'Distance', ico: 'dim' },
        { id: 'mate.angle', lbl: 'Angle', ico: 'constraint' },
      ],
      [
        { id: 'mate.hinge', lbl: 'Hinge', ico: 'rotate' },
        { id: 'mate.gear', lbl: 'Gear', ico: 'circle' },
        { id: 'mate.limitDistance', lbl: 'Limit', ico: 'dim' },
        { id: 'mate.width', lbl: 'Width', ico: 'constraint' },
      ],
    ],
  },
  {
    title: 'Motion',
    rows: [[{ id: 'motion.drive', lbl: 'Drive', ico: 'rotate', hasCaret: true }]],
  },
  {
    title: 'Inspect',
    rows: [
      [{ id: 'asm.interference', lbl: 'Interference', ico: 'bolt' }],
      [
        { id: 'asm.section', lbl: 'Section view', ico: 'section', big: false },
        { id: 'asm.measure', lbl: 'Measure', ico: 'ruler', big: false },
      ],
    ],
  },
  {
    title: 'BOM',
    rows: [
      [
        { id: 'bom.show', lbl: 'BOM', ico: 'doc' },
        { id: 'bom.export', lbl: 'Export', ico: 'share' },
      ],
    ],
  },
];

// ── Drawing ──────────────────────────────────────────────────────────────────
// Honest-wiring policy: only tools backed by a real capability in
// DrawingFrame are listed. Views (base/projection/section/detail),
// Dimensions (smart/linear/radial), Annotate (GD&T/note/symbol) and
// sheet.format were removed 2026-06-10 — no interactive view placement,
// dimension authoring or format picker exists on this surface yet
// (manual annotation lives on the production DrawingPageContent page).
// Re-add each item when its real handler lands.
const DRAWING_GROUPS: { title: string; rows: RibbonAction[][] }[] = [
  {
    title: 'Sheet',
    rows: [
      [
        { id: 'sheet.new', lbl: 'New sheet', ico: 'plus' },
      ],
    ],
  },
  {
    title: 'Output',
    rows: [
      [
        { id: 'output.pdf', lbl: 'PDF', ico: 'doc' },
        { id: 'output.dxf', lbl: 'DXF', ico: 'share' },
        { id: 'output.print', lbl: 'Print', ico: 'print' },
      ],
    ],
  },
];

// ── Render ───────────────────────────────────────────────────────────────────
// Honest-wiring policy: Studio (scene/env), Materials (library/apply/edit),
// Camera (lens/DoF) and render.preview were removed 2026-06-10 — those
// controls already live as always-visible panels (Material Library left
// pane, Environment/Camera sliders right pane) and the viewport itself is
// the live preview, so the ribbon buttons had nothing real to invoke.
// Final · 4K triggers the gated path-traced render (onRenderFinal).
const RENDER_GROUPS: { title: string; rows: RibbonAction[][] }[] = [
  {
    title: 'Output',
    rows: [
      [
        { id: 'render.final', lbl: 'Final · 4K', ico: 'bolt' },
      ],
    ],
  },
];

// ── Sheet Metal ─────────────────────────────────────────────────────────────
const SHEET_METAL_GROUPS: { title: string; rows: RibbonAction[][] }[] = [
  {
    title: 'Bend',
    rows: [
      [
        { id: 'sm.edge-flange', lbl: 'Edge Flange', ico: 'extrude', hasCaret: true },
        { id: 'sm.miter-flange', lbl: 'Miter Flange', ico: 'chamfer' },
        { id: 'sm.bend', lbl: 'Bend', ico: 'fillet' },
        { id: 'sm.unbend', lbl: 'Unbend', ico: 'mirror' },
      ],
    ],
  },
  {
    title: 'Form',
    rows: [
      [
        { id: 'sm.tab', lbl: 'Tab', ico: 'rect' },
        { id: 'sm.cut', lbl: 'Cut', ico: 'combine' },
        { id: 'sm.hem', lbl: 'Hem', ico: 'fillet' },
      ],
    ],
  },
  {
    title: 'Modify',
    rows: [
      [
        { id: 'sm.corner-relief', lbl: 'Corner relief', ico: 'chamfer' },
        { id: 'sm.bend-relief', lbl: 'Bend relief', ico: 'shell' },
      ],
    ],
  },
  {
    title: 'Flat Pattern',
    rows: [
      [
        { id: 'sm.flatten', lbl: 'Flatten', ico: 'plane' },
        { id: 'sm.export-dxf', lbl: 'Export DXF', ico: 'share' },
      ],
    ],
  },
];

const GROUPS_BY_MODE: Record<ShellMode, { title: string; rows: RibbonAction[][] }[]> = {
  modeling: SOLID_GROUPS,
  sketch: SKETCH_GROUPS,
  assembly: ASSEMBLY_GROUPS,
  drawing: DRAWING_GROUPS,
  render: RENDER_GROUPS,
  sheetmetal: SHEET_METAL_GROUPS,
};

// Per-tab filtering for sketch mode — splits the SKETCH_GROUPS into three
// subsets so each top-tab shows only the relevant tools.
const SKETCH_TAB_GROUPS: Record<string, string[]> = {
  'sketch.draw': ['Draw', 'Modify'],
  'sketch.constrain': ['Constrain'],
  'sketch.finish': ['Project', 'Body', 'Finish'],
};

export function ModeRibbon({ mode, tabs, activeTab, onTabChange, onTool, isActive }: ModeRibbonProps) {
  let groups = GROUPS_BY_MODE[mode];
  if (mode === 'sketch' && SKETCH_TAB_GROUPS[activeTab]) {
    const titles = new Set(SKETCH_TAB_GROUPS[activeTab]);
    groups = groups.filter(g => titles.has(g.title));
  }
  return (
    <Ribbon tabs={tabs} activeTab={activeTab} onTabChange={onTabChange}>
      {groups.map(g => (
        <Grp key={g.title} title={g.title}>
          {g.rows.map((row, ri) => {
            const isCol = row.every(a => a.big === false);
            const inner = row.map(a => (
              <Tool
                key={a.id}
                ico={a.ico}
                lbl={a.lbl}
                big={a.big ?? true}
                hasCaret={a.hasCaret}
                active={isActive?.(a.id)}
                onClick={() => onTool(a.id)}
              />
            ));
            if (isCol) {
              return (
                <div key={ri} className="col">
                  {inner}
                </div>
              );
            }
            return <span key={ri} style={{ display: 'contents' }}>{inner}</span>;
          })}
        </Grp>
      ))}
    </Ribbon>
  );
}

export const MODE_DEFAULT_TABS: Record<ShellMode, RibbonTabDef[]> = {
  modeling: [
    { id: 'file', label: 'File' },
    { id: 'solid', label: 'Solid' },
    { id: 'assembly', label: 'Assembly' },
    { id: 'sheetmetal', label: 'Sheet Metal' },
    { id: 'drawing', label: 'Drawing' },
    { id: 'inspect', label: 'Inspect' },
    { id: 'render', label: 'Render' },
    { id: 'view', label: 'View' },
  ],
  // 3-tab sketch IA + exit lanes. Draw/Constrain/Finish are the in-sketch
  // sub-tabs (mode:true → highlighted as the active mode); the trailing
  // Solid/Drawing/Render tabs let the user leave sketch in one click. The
  // parent (ModelerShell) intercepts non-sketch tab clicks while in sketch
  // mode and dispatches `sketch.finish` first so the in-progress sketch is
  // committed before the surface swap.
  sketch: [
    { id: 'sketch.draw', label: 'Draw', mode: true },
    { id: 'sketch.constrain', label: 'Constrain', mode: true },
    { id: 'sketch.finish', label: 'Finish', mode: true },
    { id: 'solid', label: 'Solid' },
    { id: 'assembly', label: 'Assembly' },
    { id: 'sheetmetal', label: 'Sheet Metal' },
    { id: 'drawing', label: 'Drawing' },
    { id: 'render', label: 'Render' },
  ],
  // Assembly / Drawing / Render share the same top tabs as Modeling so users
  // can cross-navigate from any route — click "Solid" from inside Drawing to
  // pop back to the modeler, click "Render" from inside Drawing to jump to
  // the render route, etc. The active tab is highlighted by the parent.
  assembly: [
    { id: 'file', label: 'File' },
    { id: 'solid', label: 'Solid' },
    { id: 'assembly', label: 'Assembly' },
    { id: 'sheetmetal', label: 'Sheet Metal' },
    { id: 'drawing', label: 'Drawing' },
    { id: 'inspect', label: 'Inspect' },
    { id: 'render', label: 'Render' },
    { id: 'view', label: 'View' },
  ],
  drawing: [
    { id: 'file', label: 'File' },
    { id: 'solid', label: 'Solid' },
    { id: 'assembly', label: 'Assembly' },
    { id: 'sheetmetal', label: 'Sheet Metal' },
    { id: 'drawing', label: 'Drawing' },
    { id: 'inspect', label: 'Inspect' },
    { id: 'render', label: 'Render' },
    { id: 'view', label: 'View' },
  ],
  render: [
    { id: 'file', label: 'File' },
    { id: 'solid', label: 'Solid' },
    { id: 'assembly', label: 'Assembly' },
    { id: 'sheetmetal', label: 'Sheet Metal' },
    { id: 'drawing', label: 'Drawing' },
    { id: 'inspect', label: 'Inspect' },
    { id: 'render', label: 'Render' },
    { id: 'view', label: 'View' },
  ],
  sheetmetal: [
    { id: 'file', label: 'File' },
    { id: 'sheetmetal', label: 'Sheet Metal', mode: true },
    { id: 'solid', label: 'Solid' },
    { id: 'drawing', label: 'Drawing' },
    { id: 'inspect', label: 'Inspect' },
    { id: 'view', label: 'View' },
  ],
};
