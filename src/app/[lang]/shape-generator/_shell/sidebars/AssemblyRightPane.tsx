'use client';

// Assembly mode right pane — MATES ON [part] + BILL OF MATERIALS sections,
// matching mockup #31's right side.

import { SidePanel, PropSection } from './';
import { MateList } from './AssemblyLeftPane';
import { useShellBridge } from '../shellBridgeStore';
import { I } from '../Icons';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';
import { fmtShell, pickShellDict, type ShellDict } from '../shellDict';

function asmCatalogDict(d: ShellDict): CatalogPanelDict {
  return {
    catalogTitle: d.catAsmTitle, catalogLoading: d.loading, catalogReady: d.catReady,
    catalogRun: d.catRun, catalogFailed: d.catFailed, catalogEmpty: d.catEmpty,
  };
}

export interface AssemblyRightPaneProps {
  lang: string;
}

export function AssemblyRightPane({ lang }: AssemblyRightPaneProps) {
  const d = pickShellDict(lang);
  const selectedLabel = useShellBridge(s => s.selectedLabel);
  const items = useShellBridge(s => s.assemblyItems);
  const mates = useShellBridge(s => s.assemblyMates);
  const isEmpty = items.length === 0;
  const totalCount = items.reduce((a, i) => a + i.count, 0);
  const totalMass = items.reduce((a, i) => a + (i.massG ?? 0) * i.count, 0);
  const title = selectedLabel
    ? fmtShell(d.matesOn, { name: selectedLabel })
    : d.asmTitle;

  return (
    <SidePanel
      side="right"
      title={title}
      titleIcon={<I.link size={12} />}
    >
      <PropSection title={d.tabMates}>
        <MateList mates={mates} isEmpty={isEmpty} d={d} />
      </PropSection>

      <PropSection title={d.billOfMaterials}>
        {isEmpty ? (
          <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: 11, color: 'var(--nx-text-3)' }}>
            {d.bomEmpty}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'var(--nx-panel-2)' }}>
                <th style={th}>#</th>
                <th style={th}>{d.thPart}</th>
                <th style={{ ...th, textAlign: 'right' }}>{d.thQty}</th>
                <th style={{ ...th, textAlign: 'right' }}>{d.thMass}</th>
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
                <td style={td} colSpan={2}>{d.totalRow}</td>
                <td style={{ ...td, textAlign: 'right' }}>{totalCount} parts</td>
                <td style={{ ...td, textAlign: 'right' }}>{totalMass.toFixed(1)} g</td>
              </tr>
            </tbody>
          </table>
        )}
      </PropSection>

      <PropSection title={d.calculatorsLive}>
        <FeatureCatalogPanel
          route="assembly"
          license="pro"
          dict={asmCatalogDict(d)}
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
