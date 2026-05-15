'use client';

// Drawing view (Phase 3) — shell-v2 styled standalone drafting screen.
// Mounted at /[lang]/shape-generator/drawing.
// Reuses existing freemium gate for PDF export. The Three.js ortho viewport
// integration with DimensionOverlay arrives in Phase 6 — Phase 3 ships the
// route + IA + commercial CTAs (PDF / Print) so marketing can showcase it.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from './Shell';
import { I } from './Icons';
import { useShellBridge } from './shellBridgeStore';
import { useFreemiumGate } from '../hooks/useFreemiumGate';

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

  const sheets: SheetTreeNode[] = [
    { id: 'sheet1', lbl: 'Sheet 1 · A3', kind: 'sheet' },
    { id: 'view.top', lbl: 'Top', kind: 'view', meta: '1:2' },
    { id: 'view.front', lbl: 'Front', kind: 'view', meta: '1:2' },
    { id: 'view.right', lbl: 'Right', kind: 'view', meta: '1:2' },
    { id: 'view.iso', lbl: 'Isometric', kind: 'view', meta: '1:2' },
    { id: 'view.section', lbl: 'Section A-A', kind: 'view', meta: '1:1' },
  ];

  const onExportPDF = () => {
    gate.requirePro('share', () => {
      // Phase 6 will wire actual PDF generation via useScreenshot
      alert(isKo ? '도면 PDF 생성 (Phase 6에서 연결 예정)' : 'Drawing PDF export (wired in Phase 6)');
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
          onTool: id => setActiveTool(id),
          isActive: id => activeTool === id,
        }}
        leftWidth={240}
        rightWidth={300}
        left={<DrawingTreePane nodes={sheets} selectedId={selectedView} onSelect={setSelectedView} isKo={isKo} />}
        right={<DrawingPropsPane isKo={isKo} selectedView={selectedView} />}
        viewport={
          <DrawingCanvas
            isKo={isKo}
            onBackToModeling={() =>
              router.push(`/${lang}/shape-generator?shell=v2${projectId ? `&project=${projectId}` : ''}`)
            }
          />
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
  onBackToModeling,
}: {
  isKo: boolean;
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
        {/* 4 ortho view boxes */}
        <div
          style={{
            position: 'absolute',
            inset: '6% 6% 18% 6%',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: 12,
          }}
        >
          {[
            isKo ? '평면' : 'Top',
            isKo ? '아이소' : 'Isometric',
            isKo ? '정면' : 'Front',
            isKo ? '우측' : 'Right',
          ].map(label => (
            <div
              key={label}
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
                {label}
              </span>
              <svg viewBox="0 0 100 60" width="60%" height="60%">
                <rect x="20" y="15" width="60" height="30" fill="#dcd8cc" stroke="#666" strokeWidth="0.5" />
                <rect x="20" y="15" width="60" height="6" fill="#c4bfa9" stroke="#666" strokeWidth="0.5" />
                <circle cx="30" cy="18" r="1.4" fill="#666" />
                <circle cx="50" cy="18" r="1.4" fill="#666" />
                <circle cx="70" cy="18" r="1.4" fill="#666" />
              </svg>
            </div>
          ))}
        </div>

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
