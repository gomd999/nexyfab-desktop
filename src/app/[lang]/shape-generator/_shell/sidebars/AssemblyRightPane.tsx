'use client';

// Assembly mode right pane — MATES ON [part] + BILL OF MATERIALS sections,
// matching mockup #31's right side.

import { SidePanel, PropSection } from './';
import { MateList } from './AssemblyLeftPane';
import { useShellBridge } from '../shellBridgeStore';
import { I } from '../Icons';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';

const ASM_CATALOG_DICT_KO: CatalogPanelDict = {
  catalogTitle: '체결/끼워맞춤 계산기', catalogLoading: '불러오는 중…', catalogReady: '준비됨',
  catalogRun: '실행', catalogFailed: '불러오기 실패', catalogEmpty: '해당 기능이 없습니다',
};
const ASM_CATALOG_DICT_EN: CatalogPanelDict = {
  catalogTitle: 'Joint / Fit Calculators', catalogLoading: 'Loading…', catalogReady: 'Ready',
  catalogRun: 'Run', catalogFailed: 'Load failed', catalogEmpty: 'No matching feature',
};

export interface AssemblyRightPaneProps {
  isKo: boolean;
}

export function AssemblyRightPane({ isKo }: AssemblyRightPaneProps) {
  const selectedLabel = useShellBridge(s => s.selectedLabel);
  const items = useShellBridge(s => s.assemblyItems);
  const mates = useShellBridge(s => s.assemblyMates);
  const isEmpty = items.length === 0;
  const totalCount = items.reduce((a, i) => a + i.count, 0);
  const totalMass = items.reduce((a, i) => a + (i.massG ?? 0) * i.count, 0);
  const title = selectedLabel
    ? (isKo ? `${selectedLabel} 메이트` : `MATES ON ${selectedLabel}`)
    : (isKo ? '어셈블리' : 'ASSEMBLY');

  return (
    <SidePanel
      side="right"
      title={title}
      titleIcon={<I.link size={12} />}
    >
      <PropSection title={isKo ? '메이트' : 'Mates'}>
        <MateList mates={mates} isEmpty={isEmpty} isKo={isKo} />
      </PropSection>

      <PropSection title={isKo ? '재료 명세서' : 'Bill of Materials'}>
        {isEmpty ? (
          <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: 11, color: 'var(--nx-text-3)' }}>
            {isKo ? '부품이 없어 BOM이 비어 있습니다.' : 'No parts — the BOM is empty.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'var(--nx-panel-2)' }}>
                <th style={th}>#</th>
                <th style={th}>{isKo ? '부품' : 'PART'}</th>
                <th style={{ ...th, textAlign: 'right' }}>{isKo ? '수량' : 'QTY'}</th>
                <th style={{ ...th, textAlign: 'right' }}>{isKo ? '중량' : 'MASS'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--nx-border)' }}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}>{row.label}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{row.count}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{row.massG ? `${row.massG.toFixed(1)} g` : '—'}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: '1px solid var(--nx-border-strong)' }}>
                <td style={td} colSpan={2}>{isKo ? '합계' : 'TOTAL'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{totalCount} parts</td>
                <td style={{ ...td, textAlign: 'right' }}>{totalMass.toFixed(1)} g</td>
              </tr>
            </tbody>
          </table>
        )}
      </PropSection>

      <PropSection title={isKo ? '계산기 (라이브)' : 'Calculators (live)'}>
        <FeatureCatalogPanel
          route="assembly"
          license="pro"
          dict={isKo ? ASM_CATALOG_DICT_KO : ASM_CATALOG_DICT_EN}
          onRun={(featureId, entryFn) => {
             
            console.info(`[catalog] run ${featureId} via ${entryFn}()`);
          }}
        />
      </PropSection>
    </SidePanel>
  );
}

const th: React.CSSProperties = { padding: '4px 6px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: 'var(--nx-text-3)', textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '3px 6px', color: 'var(--nx-text)' };
