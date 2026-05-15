'use client';

// Modeling mode right pane — Inspector / Nexy AI / Comments 3-tab matching
// mockup #29. Inspector exposes GEOMETRY / EDGES / APPEARANCE / PARAMETERS
// / ANALYZE sections; ANALYZE rows open the BottomDrawer with the existing
// DFM/FEA/Cost/Variants panels via the `analyze:open` custom event.

import { useState } from 'react';
import { SidePanel, PropSection, PropRow, PropNumber, PropSelect, PropCheck, PropItemRow } from './';
import { I } from '../Icons';
import { useShellBridge } from '../shellBridgeStore';

export interface ModelerRightPaneProps {
  isKo: boolean;
}

type Tab = 'inspector' | 'ai' | 'comments';

export function ModelerRightPane({ isKo }: ModelerRightPaneProps) {
  const [activeTab, setActiveTab] = useState<Tab>('inspector');
  const selectedLabel = useShellBridge(s => s.selectedLabel);
  const selectionCount = useShellBridge(s => s.selectionCount);
  const volume = useShellBridge(s => s.volume);
  const triangleCount = useShellBridge(s => s.triangleCount);

  return (
    <SidePanel
      side="right"
      tabs={[
        { id: 'inspector', label: isKo ? '인스펙터' : 'Inspector', icon: <I.tree size={12} /> },
        { id: 'ai', label: isKo ? 'Nexy AI' : 'Nexy AI', icon: <I.ai size={12} /> },
        { id: 'comments', label: isKo ? '코멘트' : 'Comments', icon: <I.comments size={12} />, badge: 3 },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as Tab)}
    >
      {activeTab === 'inspector' && (
        <InspectorTab
          isKo={isKo}
          selectedLabel={selectedLabel}
          selectionCount={selectionCount}
          volume={volume}
          triangleCount={triangleCount}
        />
      )}
      {activeTab === 'ai' && <AiTab isKo={isKo} />}
      {activeTab === 'comments' && <CommentsTab isKo={isKo} />}
    </SidePanel>
  );
}

// ─── Inspector tab ─────────────────────────────────────────────────────────

function InspectorTab({
  isKo, selectedLabel, selectionCount, volume, triangleCount,
}: {
  isKo: boolean;
  selectedLabel: string | null;
  selectionCount: number;
  volume: number | null;
  triangleCount: number;
}) {
  // Empty state when nothing selected.
  if (!selectedLabel) {
    return (
      <div style={{ padding: '20px 16px', fontSize: 11, color: 'var(--nx-text-3)', textAlign: 'center', lineHeight: 1.5 }}>
        {isKo ? '피처나 엣지를 선택해 속성을 표시합니다.' : 'Select a feature or edge to inspect.'}
      </div>
    );
  }

  return (
    <>
      {/* Header — selected entity summary */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--nx-border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--nx-accent-soft)' }}>
        <I.fillet size={16} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text)' }}>{selectedLabel}</div>
          {selectionCount > 0 && (
            <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
              {isKo ? `${selectionCount}개 엣지 · 엣지 그룹` : `Edge group · ${selectionCount} edges`}
            </div>
          )}
        </div>
      </div>

      <PropSection title={isKo ? '지오메트리' : 'Geometry'}>
        <PropRow label={isKo ? '유형' : 'Type'}>
          <PropSelect
            value="constant"
            onChange={() => { /* TODO wire to feature */ }}
            options={[
              { value: 'constant', label: isKo ? '일정 반경' : 'Constant radius' },
              { value: 'variable', label: isKo ? '가변 반경' : 'Variable radius' },
            ]}
          />
        </PropRow>
        <PropRow label={isKo ? '반경' : 'Radius'}>
          <PropNumber value={2.0} onChange={() => { /* TODO */ }} suffix="mm" />
        </PropRow>
        <PropRow label={isKo ? '접선' : 'Tangent prop.'}>
          <PropCheck checked onChange={() => { /* TODO */ }} label={isKo ? '켜짐' : 'On'} />
        </PropRow>
        <PropRow label={isKo ? '오버플로' : 'Overflow'}>
          <PropSelect
            value="default"
            onChange={() => { /* TODO */ }}
            options={[
              { value: 'default', label: isKo ? '기본' : 'Default' },
              { value: 'tangent', label: isKo ? '접선' : 'Tangent' },
              { value: 'keep', label: isKo ? '엣지 유지' : 'Keep edge' },
            ]}
          />
        </PropRow>
      </PropSection>

      <PropSection title={isKo ? `엣지 (${selectionCount})` : `Edges (${selectionCount})`} defaultExpanded={false}>
        {Array.from({ length: Math.min(selectionCount, 6) }, (_, i) => (
          <PropItemRow
            key={i}
            bullet="●"
            label={`Edge.${42 + i}`}
            meta={i % 2 === 0 ? 'top outer' : 'top inner'}
            onRemove={() => { /* TODO */ }}
          />
        ))}
        {selectionCount > 6 && (
          <div style={{ fontSize: 10, color: 'var(--nx-accent)', padding: '4px 0', cursor: 'pointer' }}>
            + {isKo ? `엣지 추가 (${selectionCount - 6}개 더)` : `Add edges (+${selectionCount - 6} more)`}
          </div>
        )}
      </PropSection>

      <PropSection title={isKo ? '외형' : 'Appearance'} defaultExpanded={false}>
        <PropRow label={isKo ? '상속' : 'Inherit'}>
          <PropCheck checked onChange={() => { /* TODO */ }} label={isKo ? '본체에서' : 'From body'} />
        </PropRow>
        <PropRow label={isKo ? '재질' : 'Material'}>
          <button
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '2px 8px', height: 22,
              background: 'var(--nx-bg)', border: '1px solid var(--nx-border)',
              borderRadius: 3, fontSize: 11, color: 'var(--nx-text)',
              cursor: 'pointer', width: '100%',
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 2, background: '#cdd2d8', flex: '0 0 12px' }} />
            <span style={{ flex: 1, textAlign: 'left' }}>Aluminum 6061-T6</span>
          </button>
        </PropRow>
      </PropSection>

      <PropSection title={isKo ? '파라미터' : 'Parameters'}>
        <PropRow label="d12 (r)">
          <PropNumber value={2.0} onChange={() => { /* TODO */ }} suffix="mm" />
        </PropRow>
        <PropRow label="d13 (overflow)">
          <PropNumber value={0.0} onChange={() => { /* TODO */ }} suffix="mm" />
        </PropRow>
        <div style={{ fontSize: 10, color: 'var(--nx-accent)', padding: '4px 0' }}>
          ⊳ {isKo ? '연결됨' : 'Linked to'} <span className="mono">global.cornerRad</span>
        </div>
      </PropSection>

      <PropSection title={isKo ? '분석' : 'Analyze'} defaultExpanded>
        <AnalyzeRow label={isKo ? 'DFM 검사' : 'DFM check'} meta={isKo ? '경고 2개' : '2 warns'} drawer="dfm" />
        <AnalyzeRow label={isKo ? 'FEA · 정적' : 'FEA — static'} meta={isKo ? '실행' : 'run'} drawer="fea" />
        <AnalyzeRow label={isKo ? '비용 예상' : 'Cost estimate'} meta={volume ? `≈ ${(volume * 0.003).toFixed(2)} g` : ''} drawer="cost" />
        <AnalyzeRow label={isKo ? '설계 변형' : 'Design variants'} meta={isKo ? '3개' : '3'} drawer="variants" />
        <PropRow label={isKo ? '삼각형' : 'Triangles'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {Math.round(triangleCount).toLocaleString()}
          </span>
        </PropRow>
      </PropSection>

      {/* Cancel / Apply CTA mirroring mockup. Both no-op until wired. */}
      <div style={{
        position: 'sticky', bottom: 0,
        display: 'flex', gap: 6, padding: '10px 12px',
        background: 'var(--nx-panel)',
        borderTop: '1px solid var(--nx-border)',
      }}>
        <button style={btnStyle('ghost')}>{isKo ? '취소' : 'Cancel'}</button>
        <button style={btnStyle('primary')}>{isKo ? '✓ 적용' : '✓ Apply'}</button>
      </div>
    </>
  );
}

function AnalyzeRow({ label, meta, drawer }: { label: string; meta?: string; drawer: 'dfm' | 'fea' | 'cost' | 'variants' }) {
  return (
    <div
      onClick={() => {
        // Dispatch a custom event the ModelerShell listens for to open the
        // BottomDrawer on the target tab.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:analyze-open', { detail: { drawer } }));
        }
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 0', cursor: 'pointer',
        color: 'var(--nx-text)',
      }}
    >
      <span style={{ flex: '0 0 auto', color: 'var(--nx-accent)' }}>◆</span>
      <span style={{ flex: 1, fontSize: 11 }}>{label}</span>
      {meta && <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{meta}</span>}
      <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>→</span>
    </div>
  );
}

// ─── AI tab ────────────────────────────────────────────────────────────────

function AiTab({ isKo }: { isKo: boolean }) {
  return (
    <div style={{ padding: '16px 12px', fontSize: 11, color: 'var(--nx-text-2)', lineHeight: 1.6 }}>
      <div style={{ fontWeight: 600, color: 'var(--nx-text)', marginBottom: 8 }}>Nexy AI</div>
      <p>{isKo
        ? '자연어로 모델 변경, DFM 검토, 토폴로지 제안을 요청할 수 있습니다.'
        : 'Ask in natural language to edit your model, run DFM checks, or get topology suggestions.'}</p>
      <button
        style={{ ...btnStyle('primary'), marginTop: 12, width: '100%' }}
        onClick={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('nexyfab:open-ai-assistant'));
          }
        }}
      >
        {isKo ? 'AI 어시스턴트 열기' : 'Open AI Assistant'}
      </button>
    </div>
  );
}

// ─── Comments tab ──────────────────────────────────────────────────────────

function CommentsTab({ isKo }: { isKo: boolean }) {
  return (
    <div style={{ padding: '16px 12px', fontSize: 11, color: 'var(--nx-text-2)', lineHeight: 1.6 }}>
      <div style={{ fontWeight: 600, color: 'var(--nx-text)', marginBottom: 8 }}>
        {isKo ? '핀 코멘트' : 'Pin Comments'}
      </div>
      <p>{isKo
        ? '뷰포트의 특정 위치에 핀을 꽂아 협업자와 의견을 남길 수 있습니다.'
        : 'Drop pins on the model to discuss design changes with collaborators.'}</p>
      <button
        style={{ ...btnStyle('ghost'), marginTop: 12, width: '100%' }}
        onClick={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('nexyfab:open-comments'));
          }
        }}
      >
        {isKo ? '코멘트 보기' : 'View comments'}
      </button>
    </div>
  );
}

// ─── Shared button style ───────────────────────────────────────────────────

function btnStyle(kind: 'primary' | 'ghost'): React.CSSProperties {
  if (kind === 'primary') {
    return {
      flex: 1, height: 26, padding: '0 12px',
      border: 0, borderRadius: 4,
      background: 'var(--nx-accent)', color: '#fff',
      fontSize: 11, fontWeight: 600, cursor: 'pointer',
    };
  }
  return {
    flex: 1, height: 26, padding: '0 12px',
    border: '1px solid var(--nx-border)', borderRadius: 4,
    background: 'transparent', color: 'var(--nx-text)',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  };
}
