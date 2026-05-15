'use client';

// Ribbon variants per editor mode.
// Each one renders a set of <Grp><Tool/></Grp> groups inside <Ribbon>.
// Action callbacks come from the parent (page or route) so the existing
// CommandToolbar / sketch handlers can be reused unmodified.

import { Grp, Ribbon, Tool, type RibbonTabDef } from './Ribbon';
import type { IconName } from './Icons';

export type ShellMode = 'modeling' | 'sketch' | 'assembly' | 'drawing' | 'render';

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
        { id: 'chamfer', lbl: 'Chamfer', ico: 'chamfer' },
        { id: 'shell', lbl: 'Shell', ico: 'shell' },
        { id: 'draft', lbl: 'Draft', ico: 'draft' },
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
const DRAWING_GROUPS: { title: string; rows: RibbonAction[][] }[] = [
  {
    title: 'Views',
    rows: [
      [
        { id: 'view.base', lbl: 'Base view', ico: 'plane', hasCaret: true },
        { id: 'view.projection', lbl: 'Projection', ico: 'cube' },
        { id: 'view.section', lbl: 'Section', ico: 'section' },
        { id: 'view.detail', lbl: 'Detail', ico: 'zoom_in' },
      ],
    ],
  },
  {
    title: 'Dimensions',
    rows: [
      [
        { id: 'dim.smart', lbl: 'Smart Dim', ico: 'dim', hasCaret: true },
        { id: 'dim.linear', lbl: 'Linear', ico: 'dim' },
        { id: 'dim.radial', lbl: 'Radial', ico: 'circle' },
      ],
    ],
  },
  {
    title: 'Annotate',
    rows: [
      [
        { id: 'note.gdt', lbl: 'GD&T', ico: 'constraint' },
        { id: 'note.note', lbl: 'Note', ico: 'comments' },
        { id: 'note.symbol', lbl: 'Symbol', ico: 'pin' },
      ],
    ],
  },
  {
    title: 'Sheet',
    rows: [
      [
        { id: 'sheet.new', lbl: 'New sheet', ico: 'plus' },
        { id: 'sheet.format', lbl: 'Format', ico: 'doc', hasCaret: true },
      ],
    ],
  },
  {
    title: 'Output',
    rows: [
      [
        { id: 'output.pdf', lbl: 'PDF', ico: 'doc' },
        { id: 'output.print', lbl: 'Print', ico: 'print' },
      ],
    ],
  },
];

// ── Render ───────────────────────────────────────────────────────────────────
const RENDER_GROUPS: { title: string; rows: RibbonAction[][] }[] = [
  {
    title: 'Studio',
    rows: [
      [
        { id: 'studio.scene', lbl: 'Scene', ico: 'cube', hasCaret: true },
        { id: 'studio.env', lbl: 'Environment', ico: 'globe' },
      ],
    ],
  },
  {
    title: 'Materials',
    rows: [
      [
        { id: 'mat.library', lbl: 'Library', ico: 'paint', hasCaret: true },
        { id: 'mat.apply', lbl: 'Apply', ico: 'check' },
        { id: 'mat.edit', lbl: 'Edit PBR', ico: 'sketch' },
      ],
    ],
  },
  {
    title: 'Camera',
    rows: [
      [
        { id: 'cam.lens', lbl: 'Lens', ico: 'zoom_in' },
        { id: 'cam.dof', lbl: 'Depth of field', ico: 'eye' },
      ],
    ],
  },
  {
    title: 'Output',
    rows: [
      [
        { id: 'render.preview', lbl: 'Preview', ico: 'sun', hasCaret: true },
        { id: 'render.final', lbl: 'Final · 4K', ico: 'bolt' },
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
};

export function ModeRibbon({ mode, tabs, activeTab, onTabChange, onTool, isActive }: ModeRibbonProps) {
  const groups = GROUPS_BY_MODE[mode];
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
    { id: 'drawing', label: 'Drawing' },
    { id: 'inspect', label: 'Inspect' },
    { id: 'render', label: 'Render' },
    { id: 'view', label: 'View' },
  ],
  sketch: [{ id: 'sketch', label: 'Sketch', mode: true }],
  assembly: [
    { id: 'file', label: 'File' },
    { id: 'assembly', label: 'Assembly', mode: true },
    { id: 'inspect', label: 'Inspect' },
    { id: 'view', label: 'View' },
  ],
  drawing: [
    { id: 'file', label: 'File' },
    { id: 'drawing', label: 'Drawing', mode: true },
    { id: 'annotate', label: 'Annotate' },
    { id: 'output', label: 'Output' },
  ],
  render: [
    { id: 'file', label: 'File' },
    { id: 'render', label: 'Render', mode: true },
    { id: 'materials', label: 'Materials' },
    { id: 'camera', label: 'Camera' },
  ],
};
