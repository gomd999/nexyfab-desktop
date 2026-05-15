'use client';

// Render Studio view (Phase 4) — shell-v2 styled photoreal preview screen.
// Mounted at /[lang]/shape-generator/render.
// Reuses existing useFreemiumGate.requirePhotoReal for the 1-use Free demo;
// real Three.js PBR viewport and HDRI sphere come in Phase 6.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from './Shell';
import { I, type IconName } from './Icons';
import { useFreemiumGate } from '../hooks/useFreemiumGate';
import { PbrSpherePreview } from './PbrSpherePreview';

interface RenderFrameProps {
  lang: string;
  isKo: boolean;
  projectId?: string;
}

interface MaterialSwatch {
  id: string;
  lbl: string;
  color: string;
  group: 'metal' | 'plastic' | 'wood' | 'glass';
}

const MATERIAL_LIBRARY: MaterialSwatch[] = [
  { id: 'aluminum', lbl: 'Aluminum', color: '#cdd2d8', group: 'metal' },
  { id: 'steel-brushed', lbl: 'Steel · brushed', color: '#a8acb1', group: 'metal' },
  { id: 'steel-mirror', lbl: 'Steel · mirror', color: '#dde0e3', group: 'metal' },
  { id: 'anodized-black', lbl: 'Anodized black', color: '#22262b', group: 'metal' },
  { id: 'copper', lbl: 'Copper', color: '#c97f50', group: 'metal' },
  { id: 'brass', lbl: 'Brass', color: '#caa15e', group: 'metal' },
  { id: 'plastic-white', lbl: 'Plastic · white', color: '#eaeaea', group: 'plastic' },
  { id: 'plastic-black', lbl: 'Plastic · black', color: '#1a1a1a', group: 'plastic' },
  { id: 'carbon', lbl: 'Carbon weave', color: '#262a30', group: 'plastic' },
  { id: 'walnut', lbl: 'Walnut', color: '#5a3a23', group: 'wood' },
  { id: 'oak', lbl: 'Oak', color: '#b9956a', group: 'wood' },
  { id: 'glass-clear', lbl: 'Glass · clear', color: '#b6d8e5', group: 'glass' },
];

const FILTER_GROUPS: { id: MaterialSwatch['group'] | 'all'; lbl: string; lblKo: string }[] = [
  { id: 'all', lbl: 'All', lblKo: '전체' },
  { id: 'metal', lbl: 'Metals', lblKo: '금속' },
  { id: 'plastic', lbl: 'Plastics', lblKo: '플라스틱' },
  { id: 'wood', lbl: 'Wood', lblKo: '목재' },
  { id: 'glass', lbl: 'Glass', lblKo: '유리' },
];

const HDRI_PRESETS: { id: string; lbl: string; lblKo: string; ico: IconName }[] = [
  { id: 'studio', lbl: 'Studio', lblKo: '스튜디오', ico: 'sun' },
  { id: 'workshop', lbl: 'Workshop', lblKo: '작업장', ico: 'cog' },
  { id: 'overcast', lbl: 'Overcast', lblKo: '흐림', ico: 'moon' },
  { id: 'warehouse', lbl: 'Warehouse', lblKo: '창고', ico: 'cube' },
];

export function RenderFrame({ lang, isKo, projectId }: RenderFrameProps) {
  const router = useRouter();
  const gate = useFreemiumGate();
  const [activeTab, setActiveTab] = useState('render');
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const langSeg = lang === 'ko' ? 'kr' : lang;
  const project = projectId ? `?project=${projectId}` : '';

  // Cross-mode tab navigation — clicking File/Solid/Assembly/Drawing/Inspect/
  // View from inside Render jumps to the relevant route (or back to modeler).
  const handleTabChange = (id: string) => {
    setActiveTab(id);
    if (id === 'drawing') router.push(`/${langSeg}/shape-generator/drawing${project}`);
    else if (id === 'solid' || id === 'file' || id === 'inspect' || id === 'view')
      router.push(`/${langSeg}/shape-generator${project}`);
    else if (id === 'assembly')
      router.push(`/${langSeg}/shape-generator${project ? project + '&mode=assembly' : '?mode=assembly'}`);
  };
  const [matFilter, setMatFilter] = useState<MaterialSwatch['group'] | 'all'>('all');
  const [selectedMaterial, setSelectedMaterial] = useState('aluminum');
  const [hdri, setHdri] = useState('studio');
  const [roughness, setRoughness] = useState(0.35);
  const [metalness, setMetalness] = useState(0.85);
  const [exposure, setExposure] = useState(1.0);
  const [hdriRot, setHdriRot] = useState(0);
  const [lens, setLens] = useState(50);

  const visibleMats = MATERIAL_LIBRARY.filter(m => matFilter === 'all' || m.group === matFilter);

  const onRenderFinal = () => {
    gate.requirePhotoReal(() => {
      // Real wiring in Phase 6 via useScreenshot
      alert(isKo ? '4K 256 spp 렌더 시작 (Phase 6에서 연결 예정)' : 'Final 4K · 256 spp render (wired in Phase 6)');
    });
  };

  return (
    <>
      <Shell
        mode="render"
        titleBar={{
          filename: isKo ? '렌더 — 무제 파트' : 'Render — Untitled Part',
          savedAt: isKo ? '자동 저장됨' : 'Auto-saved',
          breadcrumbs: ['Projects', 'Render Studio'],
          mode: isKo ? '렌더 모드' : 'RENDER STUDIO',
          onShare: () => {},
          onPublish: onRenderFinal,
          publishLabel: isKo ? '최종 렌더 · 4K' : 'Render · Final 4K',
        }}
        ribbon={{
          activeTab,
          onTabChange: handleTabChange,
          onTool: id => setActiveTool(id),
          isActive: id => activeTool === id,
        }}
        leftWidth={280}
        rightWidth={320}
        left={
          <MaterialLibraryPane
            isKo={isKo}
            materials={visibleMats}
            selectedId={selectedMaterial}
            onSelect={setSelectedMaterial}
            filter={matFilter}
            onFilter={setMatFilter}
          />
        }
        right={
          <RenderPropsPane
            isKo={isKo}
            roughness={roughness}
            setRoughness={setRoughness}
            metalness={metalness}
            setMetalness={setMetalness}
            exposure={exposure}
            setExposure={setExposure}
            hdri={hdri}
            setHdri={setHdri}
            hdriRot={hdriRot}
            setHdriRot={setHdriRot}
            lens={lens}
            setLens={setLens}
          />
        }
        viewport={
          <RenderCanvas
            isKo={isKo}
            material={selectedMaterial}
            color={MATERIAL_LIBRARY.find(m => m.id === selectedMaterial)?.color ?? '#888'}
            roughness={roughness}
            metalness={metalness}
            exposure={exposure}
            hdri={hdri}
            onBackToModeling={() =>
              router.push(`/${lang}/shape-generator?shell=v2${projectId ? `&project=${projectId}` : ''}`)
            }
          />
        }
        statusBar={{
          left: [
            { id: 'cam', items: [`${lens}mm`] },
            { id: 'hdri', items: [`HDRI · ${hdri}`] },
          ],
          pills: [
            { id: 'engine', label: 'PBR · WebGL2' },
            { id: 'spp', label: '32 spp preview' },
          ],
        }}
      />

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
              {isKo ? '사실적 렌더는 Pro 기능입니다' : 'Photoreal render is a Pro feature'}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--nx-text-2)' }}>
              {isKo
                ? '무료 플랜은 기기당 1회 체험이 제공됩니다. 무제한 렌더링은 Pro 이상에서 사용할 수 있습니다.'
                : 'Free plan gets 1 photoreal render per device. Upgrade for unlimited.'}
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

function MaterialLibraryPane({
  isKo,
  materials,
  selectedId,
  onSelect,
  filter,
  onFilter,
}: {
  isKo: boolean;
  materials: MaterialSwatch[];
  selectedId: string;
  onSelect: (id: string) => void;
  filter: MaterialSwatch['group'] | 'all';
  onFilter: (id: MaterialSwatch['group'] | 'all') => void;
}) {
  return (
    <>
      <div className="nx-panel-h">
        <I.paint size={14} />
        {isKo ? '머티리얼 라이브러리' : 'Material Library'}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--nx-border)',
          flexWrap: 'wrap',
        }}
      >
        {FILTER_GROUPS.map(g => (
          <button
            key={g.id}
            type="button"
            className="nx-chip"
            style={{
              cursor: 'pointer',
              borderColor: filter === g.id ? 'var(--nx-accent-line)' : 'var(--nx-border)',
              color: filter === g.id ? 'var(--nx-accent)' : 'var(--nx-text-2)',
              background: filter === g.id ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
            }}
            onClick={() => onFilter(g.id)}
          >
            {isKo ? g.lblKo : g.lbl}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 10,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          alignContent: 'start',
        }}
      >
        {materials.map(m => (
          <button
            type="button"
            key={m.id}
            onClick={() => onSelect(m.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'center',
              padding: 8,
              background: selectedId === m.id ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
              border: `1px solid ${selectedId === m.id ? 'var(--nx-accent-line)' : 'var(--nx-border)'}`,
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--nx-text)',
            }}
          >
            <div
              style={{
                width: 56,
                height: 40,
                borderRadius: 4,
                background: `radial-gradient(ellipse at 30% 30%, ${shade(m.color, 0.15)}, ${m.color} 60%, ${shade(m.color, -0.25)})`,
                border: '1px solid rgba(0,0,0,0.25)',
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: 'var(--nx-text-2)',
                textAlign: 'center',
                lineHeight: 1.2,
              }}
            >
              {m.lbl}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function RenderPropsPane({
  isKo,
  roughness,
  setRoughness,
  metalness,
  setMetalness,
  exposure,
  setExposure,
  hdri,
  setHdri,
  hdriRot,
  setHdriRot,
  lens,
  setLens,
}: {
  isKo: boolean;
  roughness: number;
  setRoughness: (v: number) => void;
  metalness: number;
  setMetalness: (v: number) => void;
  exposure: number;
  setExposure: (v: number) => void;
  hdri: string;
  setHdri: (v: string) => void;
  hdriRot: number;
  setHdriRot: (v: number) => void;
  lens: number;
  setLens: (v: number) => void;
}) {
  return (
    <>
      <div className="nx-panel-h">
        <I.cog size={14} />
        {isKo ? '렌더 설정' : 'Render Settings'}
      </div>

      <div className="nx-props" style={{ padding: '8px 0' }}>
        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>PBR
          </div>
          <SliderRow lbl={isKo ? '거칠기' : 'Roughness'} value={roughness} onChange={setRoughness} />
          <SliderRow lbl={isKo ? '금속성' : 'Metalness'} value={metalness} onChange={setMetalness} />
          <SliderRow lbl={isKo ? '클리어코트' : 'Clearcoat'} value={0.2} onChange={() => {}} disabled />
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {isKo ? '환경 HDRI' : 'Environment'}
          </div>
          <div
            style={{
              padding: '4px 10px 8px',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 4,
            }}
          >
            {HDRI_PRESETS.map(h => {
              const Icon = I[h.ico] ?? I.sun;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHdri(h.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: 6,
                    fontSize: 9,
                    color: hdri === h.id ? 'var(--nx-accent)' : 'var(--nx-text-2)',
                    background: hdri === h.id ? 'var(--nx-accent-soft)' : 'transparent',
                    border: `1px solid ${hdri === h.id ? 'var(--nx-accent-line)' : 'var(--nx-border)'}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={14} />
                  {isKo ? h.lblKo : h.lbl}
                </button>
              );
            })}
          </div>
          <SliderRow lbl={isKo ? '회전' : 'Rotation'} value={hdriRot} max={360} step={1} unit="°" onChange={setHdriRot} />
          <SliderRow lbl={isKo ? '노출' : 'Exposure'} value={exposure} max={2} step={0.05} onChange={setExposure} />
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {isKo ? '카메라' : 'Camera'}
          </div>
          <SliderRow lbl={isKo ? '렌즈' : 'Lens'} value={lens} max={200} min={20} step={1} unit="mm" onChange={setLens} />
          <SliderRow lbl={isKo ? '심도' : 'DoF'} value={0.0} max={1} step={0.05} onChange={() => {}} disabled />
        </div>

        <div className="sect">
          <div className="sect-h">
            <span className="tg">▼</span>
            {isKo ? '출력' : 'Output'}
          </div>
          <div className="row">
            <span className="k">{isKo ? '해상도' : 'Resolution'}</span>
            <span className="v">3840 × 2160</span>
          </div>
          <div className="row">
            <span className="k">{isKo ? '샘플' : 'Samples'}</span>
            <span className="v">256 spp</span>
          </div>
        </div>
      </div>
    </>
  );
}

function SliderRow({
  lbl,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  unit,
  disabled,
}: {
  lbl: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <div className="row" style={{ opacity: disabled ? 0.45 : 1 }}>
      <span className="k">{lbl}</span>
      <span className="v" style={{ gap: 6, alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--nx-accent)' }}
        />
        <span className="mono" style={{ fontSize: 10, minWidth: 40, textAlign: 'right' }}>
          {step >= 1 ? Math.round(value) : value.toFixed(2)}
          {unit ?? ''}
        </span>
      </span>
    </div>
  );
}

function RenderCanvas({
  isKo,
  material,
  color,
  roughness,
  metalness,
  exposure,
  hdri,
  onBackToModeling,
}: {
  isKo: boolean;
  material: string;
  color: string;
  roughness: number;
  metalness: number;
  exposure: number;
  hdri: string;
  onBackToModeling: () => void;
}) {
  return (
    <>
      <div className="nx-viewport-overlay">
        <div className="nx-readout tl">
          <div>
            <span className="k">MATERIAL</span> <span className="v mono">{material}</span>
          </div>
          <div>
            <span className="k">R/M</span> <span className="v mono">{roughness.toFixed(2)} / {metalness.toFixed(2)}</span>
          </div>
          <div>
            <span className="k">HDRI</span> <span className="v mono">{hdri}</span>
          </div>
        </div>
        <div className="nx-readout bl">
          <div>{isKo ? '실시간 PBR · WebGL2' : 'Live PBR · WebGL2'}</div>
        </div>
      </div>

      <div style={{ position: 'absolute', inset: 0 }}>
        <PbrSpherePreview
          color={color}
          roughness={roughness}
          metalness={metalness}
          exposure={exposure}
          hdri={hdri}
        />
      </div>

      <div className="nx-floater" style={{ bottom: 12, left: 12 }}>
        <button type="button" className="nx-pillbtn" onClick={onBackToModeling}>
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
            <I.caret_r size={12} />
          </span>
          {isKo ? '모델링으로 돌아가기' : 'Back to Modeling'}
        </button>
      </div>
    </>
  );
}

// Naive color shading helper for swatch previews.
function shade(hex: string, amt: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amt)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amt)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(255 * amt)));
  return `rgb(${r}, ${g}, ${b})`;
}
