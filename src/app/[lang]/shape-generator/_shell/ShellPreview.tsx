'use client';

// Standalone preview of the shell-v2 chrome with mock left/right/viewport content.
// Mounted by page.tsx when `?shell=v2` is on. Lets us iterate on visuals
// without touching ShapeGeneratorInner (the 6,400-line monolith).
// Real integration happens phase-by-phase: Hub (Phase 2),
// Drawing (Phase 3), Render (Phase 4), Modeling chrome swap (Phase 5).

import { useState } from 'react';
import { Shell } from './Shell';
import { NavBar } from './NavBar';
import { I } from './Icons';
import type { ShellMode } from './ModeRibbons';

const MOCK_FEATURES = [
  { id: 'origin', lbl: 'Origin', meta: '0,0,0' },
  { id: 'material', lbl: 'Material · Aluminum 6061' },
  { id: 'sketch1', lbl: 'Sketch1 · XY plane' },
  { id: 'extrude1', lbl: 'Extrude1 · 18 mm' },
  { id: 'hole1', lbl: 'HolePattern · M6 × 4' },
  { id: 'fillet1', lbl: 'Fillet1 · r 2.0' },
  { id: 'shell1', lbl: 'Shell1 · wall 1.5' },
];

export function ShellPreview() {
  const [mode, setMode] = useState<ShellMode>('modeling');
  const [activeTab, setActiveTab] = useState('solid');
  const [selectedId, setSelectedId] = useState('extrude1');
  const [tool, setTool] = useState<string | null>('extrude');
  const [explode, setExplode] = useState(0);

  const modeChip =
    mode === 'sketch' ? 'SKETCH MODE' :
    mode === 'assembly' ? 'ASSEMBLY MODE' :
    mode === 'drawing' ? 'DRAWING MODE' :
    mode === 'render' ? 'RENDER STUDIO' :
    undefined;

  const modeHint =
    mode === 'sketch' ? 'Press S to exit' :
    mode === 'assembly' ? 'Press A to exit' :
    undefined;

  const modePills =
    mode === 'sketch'
      ? [{ id: 'dof', label: 'Fully constrained · solver OK', tone: 'ok' as const }]
      : mode === 'assembly'
      ? [
          { id: 'parts', label: '9 parts · 14 mates' },
          { id: 'interf', label: 'No interference', tone: 'ok' as const },
        ]
      : [
          { id: 'csg', label: 'CSG · OCCT' },
          { id: 'mass', label: '0.482 kg' },
          { id: 'autosave', label: 'Synced', tone: 'ok' as const },
        ];

  return (
    <Shell
      mode={mode}
      titleBar={{
        filename: 'Bracket_v14.nxpart',
        savedAt: 'Saved · 30s ago',
        breadcrumbs: ['Projects', 'Differential Gearbox', 'Bracket_v14.nxpart'],
        mode: modeChip,
        modeHint,
        onExitMode: modeChip && mode !== 'drawing' && mode !== 'render' ? () => setMode('modeling') : undefined,
        avatars: [
          { initials: 'JK', color: '#22e0c8' },
          { initials: 'AM', color: '#ff9b3d' },
          { initials: 'RP', color: '#5e9eff' },
        ],
        canUndo: true,
        canRedo: false,
        onShare: () => {},
        onPublish: () => {},
        publishLabel: 'Publish v14',
      }}
      ribbon={{
        activeTab,
        onTabChange: id => {
          setActiveTab(id);
          if (id === 'drawing') setMode('drawing');
          else if (id === 'render') setMode('render');
          else if (id === 'assembly') setMode('assembly');
          else setMode('modeling');
        },
        onTool: id => setTool(id),
        isActive: id => tool === id,
      }}
      left={<MockFeatureTreePane features={MOCK_FEATURES} selectedId={selectedId} onSelect={setSelectedId} />}
      right={<MockInspectorPane />}
      viewport={
        <MockViewport
          mode={mode}
          onModeSwitch={setMode}
          explode={explode}
          onExplodeChange={setExplode}
        />
      }
      statusBar={{
        left: [
          { id: 'units', items: ['mm · g · MPa'] },
          { id: 'view', items: ['Iso · Shaded with edges'] },
        ],
        pills: modePills,
        right: [{ id: 'fps', items: ['60 fps'] }],
      }}
    />
  );
}

function MockFeatureTreePane({
  features,
  selectedId,
  onSelect,
}: {
  features: { id: string; lbl: string; meta?: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="nx-panel-h">
        <I.tree size={14} />
        Feature tree
        <div className="actions">
          <button type="button" title="Collapse">
            <I.caret_d size={12} />
          </button>
          <button type="button" title="More">
            <I.more size={14} />
          </button>
        </div>
      </div>
      <div className="nx-panel-tabs">
        <button type="button" className="t active">
          <I.tree size={12} /> Tree
        </button>
        <button type="button" className="t">
          <I.history size={12} /> History
        </button>
        <button type="button" className="t">
          <I.layers size={12} /> Bodies
        </button>
      </div>
      <div className="nx-tree" style={{ flex: 1, overflow: 'auto' }}>
        {features.map(f => (
          <div
            key={f.id}
            className={`nx-tree-row ${selectedId === f.id ? 'selected' : ''}`}
            onClick={() => onSelect(f.id)}
          >
            <span className="twist leaf">▶</span>
            <span className="ico">
              <I.cube size={12} />
            </span>
            <span className="lbl">{f.lbl}</span>
            {f.meta && <span className="meta">{f.meta}</span>}
            <span className="vis">
              <I.eye size={12} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function MockInspectorPane() {
  return (
    <>
      <div className="nx-panel-h">
        <I.cog size={14} />
        Inspector
      </div>
      <div className="nx-panel-tabs">
        <button type="button" className="t active">
          Inspector
        </button>
        <button type="button" className="t">
          <I.ai size={12} /> Nexy AI
        </button>
        <button type="button" className="t">
          <I.comments size={12} /> Comments
        </button>
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 10,
          fontSize: 11,
          color: 'var(--nx-text-2)',
          lineHeight: 1.6,
        }}
      >
        <div style={{ color: 'var(--nx-text)', fontWeight: 600, marginBottom: 8 }}>
          Extrude1 · 18 mm
        </div>
        <div>Depth · 18.000 mm</div>
        <div>Direction · Symmetric</div>
        <div>Profile · Sketch1</div>
        <div>Operation · Add</div>
        <div style={{ marginTop: 12, color: 'var(--nx-text-3)' }}>
          Mock content — Phase 1 visual preview. The real Inspector content lives in
          the existing <code>RightPanel.tsx</code>.
        </div>
      </div>
    </>
  );
}

function MockViewport({
  mode,
  onModeSwitch,
  explode,
  onExplodeChange,
}: {
  mode: ShellMode;
  onModeSwitch: (m: ShellMode) => void;
  explode: number;
  onExplodeChange: (v: number) => void;
}) {
  return (
    <>
      <div className="nx-viewport-overlay">
        <div className="nx-readout tl">
          <div>
            <span className="k">UNITS</span> <span className="v mono">mm · g · MPa</span>
          </div>
          <div>
            <span className="k">VIEW</span> <span className="v mono">Iso · 35°</span>
          </div>
        </div>
        <div className="nx-readout bl">
          <div>
            <span className="k">MASS</span> <span className="v mono">0.482 kg</span>
          </div>
          <div>
            <span className="k">VOLUME</span> <span className="v mono">178 421 mm³</span>
          </div>
          <div>
            <span className="k">CG</span>{' '}
            <span className="v mono">(34.1, 22.8, 9.4)</span>
          </div>
        </div>

        {/* Assembly-mode explode slider (mockup pattern) */}
        {mode === 'assembly' && (
          <div
            className="nx-floater"
            style={{
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>Explode</span>
            <input
              type="range"
              min={0}
              max={100}
              value={explode}
              onChange={e => onExplodeChange(parseInt(e.target.value, 10))}
              style={{ width: 160, accentColor: 'var(--nx-accent)' }}
            />
            <span className="mono" style={{ fontSize: 10, minWidth: 32, textAlign: 'right' }}>
              {explode}%
            </span>
          </div>
        )}

        {/* Sketch-mode tool prompt (mockup pattern) */}
        {mode === 'sketch' && (
          <div
            className="nx-floater"
            style={{
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <I.line size={14} />
            <span style={{ fontSize: 11 }}>Line · click to place points</span>
            <span className="nx-chip mono" style={{ fontSize: 9 }}>
              ESC
            </span>
            <span style={{ color: 'var(--nx-text-3)', fontSize: 10 }}>cancel</span>
          </div>
        )}

        <NavBar />
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          color: 'var(--nx-text-2)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: 14, color: 'var(--nx-text)', fontWeight: 600 }}>
          Shell v2 Preview · {mode}
        </div>
        <div style={{ fontSize: 11, maxWidth: 360, textAlign: 'center' }}>
          The real Three.js viewport wires in Phase 6.
          Mode chips/ribbons/status pills already react to the mode switch below.
        </div>
        <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto', marginTop: 8 }}>
          {(['modeling', 'sketch', 'assembly', 'drawing', 'render'] as ShellMode[]).map(m => (
            <button
              key={m}
              type="button"
              className={`nx-pillbtn ${mode === m ? 'primary' : ''}`}
              onClick={() => onModeSwitch(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
