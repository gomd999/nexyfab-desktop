'use client';

/**
 * SustainabilityReport.tsx — Carbon footprint panel.
 *
 * Lets users compute material / process / transport breakdown +
 * compare against alternate materials.
 */

import React, { useMemo, useState } from 'react';
import {
  computeCarbonFootprint, compareMaterials,
  carEquivalentKm, treesYearEquivalent,
  type CarbonInput,
} from './carbonFootprint';

interface SustainabilityReportProps {
  lang: string;
  defaultMassKg?: number;
  onClose?: () => void;
}

const COPY = {
  ko: {
    title: '탄소 발자국',
    mass: '질량 (kg)',
    material: '재료', process: '공정',
    moldTemp: '몰드 온도',
    grid: '그리드 GWP', transport: '운송 (km)', mode: '운송 수단',
    run: '계산',
    materialEmissions: '재료',
    manufacturingEmissions: '제조',
    transportEmissions: '운송',
    total: '합계',
    equivalent: '환산',
    carKm: '자동차 km',
    treesYear: '나무 1년 흡수',
    compare: '재료 비교',
  },
  en: {
    title: 'Carbon Footprint',
    mass: 'Mass (kg)',
    material: 'Material', process: 'Process',
    moldTemp: 'Mold temp',
    grid: 'Grid GWP', transport: 'Transport (km)', mode: 'Mode',
    run: 'Compute',
    materialEmissions: 'Material',
    manufacturingEmissions: 'Manufacturing',
    transportEmissions: 'Transport',
    total: 'Total',
    equivalent: 'Equivalent',
    carKm: 'Car km',
    treesYear: 'Trees/year',
    compare: 'Compare materials',
  },
} as const;

const MATERIALS = [
  'steel-mild', 'steel-stainless', 'aluminum-recycled', 'aluminum-virgin',
  'copper', 'brass', 'titanium', 'plastic-abs', 'plastic-pp', 'plastic-pet',
  'plastic-pla', 'wood-pine', 'rubber', 'glass',
] as const;

const PROCESSES = [
  'cnc-milling', '3d-print-fdm', '3d-print-sla', 'injection-molding',
  'sheet-metal', 'die-casting', 'lathe', 'forging',
] as const;

export default function SustainabilityReport({
  lang, defaultMassKg = 0.5, onClose,
}: SustainabilityReportProps) {
  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;
  const [input, setInput] = useState<CarbonInput>({
    massKg: defaultMassKg,
    material: 'aluminum-recycled',
    process: 'cnc-milling',
  });
  const [comparison, setComparison] = useState<typeof MATERIALS[number] | null>(null);

  const result = useMemo(() => computeCarbonFootprint(input), [input]);
  const compareResult = useMemo(() =>
    comparison ? compareMaterials(input, { ...input, material: comparison }) : null,
    [input, comparison]);

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>

      <Row label={t.mass}>
        <input type="number" value={input.massKg}
          onChange={e => setInput({ ...input, massKg: Number(e.target.value) })}
          style={fieldStyle()} />
      </Row>
      <Row label={t.material}>
        <select value={input.material}
          onChange={e => setInput({ ...input, material: e.target.value as typeof MATERIALS[number] })}
          style={fieldStyle()}>
          {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </Row>
      <Row label={t.process}>
        <select value={input.process}
          onChange={e => setInput({ ...input, process: e.target.value as typeof PROCESSES[number] })}
          style={fieldStyle()}>
          {PROCESSES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </Row>

      <div style={{ marginTop: 14, padding: '10px 12px', background: '#1e293b', borderRadius: 6, fontSize: 11, lineHeight: 1.7 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t.materialEmissions}:</span>
          <strong>{result.material.kgCO2e.toFixed(2)} kgCO₂e</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t.manufacturingEmissions}:</span>
          <strong>{result.manufacturing.kgCO2e.toFixed(2)} kgCO₂e</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t.transportEmissions}:</span>
          <strong>{result.transport.kgCO2e.toFixed(2)} kgCO₂e</strong>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid #334155', margin: '6px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span><strong>{t.total}:</strong></span>
          <strong style={{ color: '#22c55e' }}>{result.total.toFixed(2)} kgCO₂e</strong>
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
        <strong>{t.equivalent}:</strong>
        <div>{t.carKm}: {carEquivalentKm(result.total).toFixed(1)} km</div>
        <div>{t.treesYear}: {treesYearEquivalent(result.total).toFixed(2)}</div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{t.compare}:</div>
        <select value={comparison ?? ''}
          onChange={e => setComparison((e.target.value || null) as typeof MATERIALS[number] | null)}
          style={fieldStyle()}>
          <option value="">—</option>
          {MATERIALS.filter(m => m !== input.material).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {compareResult && (
          <div style={{ marginTop: 6, fontSize: 11, padding: 8, background: compareResult.deltaKgCO2e > 0 ? '#22c55e22' : '#dc262622', borderRadius: 6 }}>
            Δ = {compareResult.deltaKgCO2e.toFixed(2)} kgCO₂e ({compareResult.pctReduction.toFixed(1)}%)
          </div>
        )}
      </div>
    </div>
  );
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
    <span style={{ width: 90, fontSize: 11, color: '#94a3b8' }}>{label}</span>
    <span style={{ flex: 1 }}>{children}</span>
  </div>
);

function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 20, zIndex: 700, width: 340, background: '#0f172a', color: '#f1f5f9', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }; }
function fieldStyle(): React.CSSProperties { return { width: '100%', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 4, padding: '4px 6px', fontSize: 11 }; }
