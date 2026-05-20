'use client';

// Assembly mode right pane — MATES ON [part] + BILL OF MATERIALS sections,
// matching mockup #31's right side.

import { SidePanel, PropSection, PropItemRow } from './';
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
  const selectedLabel = useShellBridge(s => s.selectedLabel) ?? 'BRACKET_V14';
  const items = useShellBridge(s => s.assemblyItems);
  const totalCount = items.length > 0 ? items.reduce((a, i) => a + i.count, 0) : 24;
  const totalMass = items.length > 0
    ? items.reduce((a, i) => a + (i.massG ?? 0) * i.count, 0)
    : 612.4;

  return (
    <SidePanel
      side="right"
      title={isKo ? `${selectedLabel} 메이트` : `MATES ON ${selectedLabel}`}
      titleIcon={<I.link size={12} />}
    >
      <PropSection title={isKo ? '메이트' : 'Mates'}>
        <PropItemRow bullet="◎" label="Concentric" meta="Bracket.hole_1 ↔ Housing_Bot.boss_a" />
        <PropItemRow bullet="≡" label="Coincident" meta="Bracket.face_base ↔ Housing_Bot.face_top" />
        <PropItemRow bullet="↔" label="Distance" meta="2.0 mm · Bracket.face_back ↔ Housing_Bot.face_wall" />
        <PropItemRow bullet="∥" label="Parallel" meta="Bracket.axis_y ↔ Housing_Top.axis_y" />
        <PropItemRow bullet="◎" label="Concentric" meta={isKo ? '⚠ 충돌' : '⚠ conflict'} />
      </PropSection>

      <PropSection title={isKo ? '재료 명세서' : 'Bill of Materials'}>
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
            {(items.length > 0 ? items : DEFAULT).map((row, i) => (
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
      </PropSection>

      <PropSection title={isKo ? '계산기 (라이브)' : 'Calculators (live)'}>
        <FeatureCatalogPanel
          route="assembly"
          license="pro"
          dict={isKo ? ASM_CATALOG_DICT_KO : ASM_CATALOG_DICT_EN}
          onRun={(featureId, entryFn) => {
            // eslint-disable-next-line no-console
            console.info(`[catalog] run ${featureId} via ${entryFn}()`);
          }}
        />
      </PropSection>
    </SidePanel>
  );
}

const DEFAULT = [
  { id: 'p1', label: 'Housing_Top', count: 1, massG: 82.4 },
  { id: 'p2', label: 'Housing_Bot', count: 1, massG: 96.1 },
  { id: 'p3', label: 'Bearing 6202-RS', count: 4, massG: 12.0 },
  { id: 'p4', label: 'InputShaft', count: 1, massG: 24.2 },
  { id: 'p5', label: 'Gear_24T_M1', count: 1, massG: 12.8 },
  { id: 'p6', label: 'Gear_48T_M1', count: 1, massG: 38.4 },
  { id: 'p7', label: 'OutputShaft', count: 1, massG: 28.4 },
  { id: 'p8', label: 'Bolt M5×20', count: 12, massG: 0.55 },
  { id: 'p9', label: 'Bracket_v14', count: 1, massG: 184.3 },
];

const th: React.CSSProperties = { padding: '4px 6px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: 'var(--nx-text-3)', textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '3px 6px', color: 'var(--nx-text)' };
