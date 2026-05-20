'use client';

/**
 * PlasticFlowPanel.tsx — Mold flow analysis controls + result heat-map.
 *
 * Inputs:
 *   - Gate vertex (click on viewport)
 *   - Polymer (drop-down)
 *   - Mold + melt temperatures
 *   - Wall thicknesses (auto-detected from geometry or user-set uniform)
 *
 * Outputs:
 *   - Fill time map (heat-map color)
 *   - Weld lines (overlay segments)
 *   - Air traps (red dots)
 *   - Cooling time + sink-mark risk
 */

import React, { useMemo, useState } from 'react';
import { simulateFill, DEFAULT_FLOW_VELOCITY, type FlowMesh } from './fillSimulation';
import { detectWeldLines, detectAirTraps, type WeldLineEdge, type AirTrap } from './weldLineDetection';
import { buildCoolingMap, sinkMarkRisk, POLYMERS } from './coolingTime';

interface PlasticFlowPanelProps {
  lang: string;
  mesh: FlowMesh | null;
  /** Optional per-vertex wall thickness array (mm). When omitted,
   *  the panel uses a uniform default that the user can set. */
  thicknesses?: number[];
  onClose?: () => void;
  /** Caller subscribes to result for heat-map rendering. */
  onResult?: (result: PlasticFlowResult) => void;
  /** Trigger viewport gate-pick mode. */
  onPickGate?: (cb: (vertexIdx: number) => void) => void;
}

export interface PlasticFlowResult {
  fillTimes: number[];
  weldLines: WeldLineEdge[];
  airTraps: AirTrap[];
  meanCoolingSec: number;
  hotSpotVertices: number[];
  sinkRisk: number;
  totalCycleSec: number;
}

const COPY = {
  ko: {
    title: '사출 분석',
    gate: '게이트',
    pickGate: '게이트 선택',
    polymer: '폴리머',
    moldTemp: '몰드 온도 (°C)',
    thickness: '균일 두께 (mm)',
    run: '분석 실행',
    fillTime: '충진 시간',
    cooling: '냉각 시간',
    cycle: '총 사이클',
    welds: '용접선', traps: '에어 트랩',
    sinkRisk: '싱크 위험',
  },
  en: {
    title: 'Mold Flow Analysis',
    gate: 'Gate',
    pickGate: 'Pick Gate',
    polymer: 'Polymer',
    moldTemp: 'Mold Temp (°C)',
    thickness: 'Uniform Thickness (mm)',
    run: 'Run',
    fillTime: 'Fill time',
    cooling: 'Cooling',
    cycle: 'Cycle total',
    welds: 'Weld lines', traps: 'Air traps',
    sinkRisk: 'Sink risk',
  },
} as const;

type PolymerKey = keyof typeof POLYMERS;
const POLYMER_KEYS = Object.keys(POLYMERS) as PolymerKey[];

export default function PlasticFlowPanel({
  lang, mesh, thicknesses, onClose, onResult, onPickGate,
}: PlasticFlowPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;
  const [gateVertex, setGateVertex] = useState<number | null>(null);
  const [polymer, setPolymer] = useState<PolymerKey>('ABS');
  const [moldTempC, setMoldTempC] = useState(50);
  const [uniformThicknessMm, setUniformThicknessMm] = useState(2);
  const [result, setResult] = useState<PlasticFlowResult | null>(null);

  const flowVelocity = DEFAULT_FLOW_VELOCITY[polymer] ?? 300;
  const canRun = mesh !== null && gateVertex !== null;

  const computedThicknesses = useMemo(() =>
    thicknesses ?? (mesh ? new Array(mesh.vertices.length).fill(uniformThicknessMm) : []),
    [thicknesses, mesh, uniformThicknessMm]);

  const handleRun = () => {
    if (!mesh || gateVertex === null) return;
    const fill = simulateFill(mesh, { gateVertex, flowVelocityMmS: flowVelocity });
    const welds = detectWeldLines(mesh, fill);
    const traps = detectAirTraps(mesh, fill);
    const cooling = buildCoolingMap(computedThicknesses, { polymer, moldTempC });
    const risk = sinkMarkRisk(computedThicknesses);
    const out: PlasticFlowResult = {
      fillTimes: fill.fillTimes,
      weldLines: welds,
      airTraps: traps,
      meanCoolingSec: cooling.meanSec,
      hotSpotVertices: cooling.hotSpots,
      sinkRisk: risk,
      totalCycleSec: fill.totalFillSec + cooling.meanSec,
    };
    setResult(out);
    onResult?.(out);
  };

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>

      <Row label={t.gate}>
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {gateVertex !== null ? `#${gateVertex}` : '—'}
          </span>
          {onPickGate && (
            <button
              onClick={() => onPickGate((v) => setGateVertex(v))}
              style={smallBtn()}
            >
              {t.pickGate}
            </button>
          )}
        </div>
      </Row>

      <Row label={t.polymer}>
        <select value={polymer} onChange={e => setPolymer(e.target.value as PolymerKey)} style={fieldStyle()}>
          {POLYMER_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </Row>

      <Row label={t.moldTemp}>
        <input type="number" value={moldTempC} onChange={e => setMoldTempC(Number(e.target.value))} style={fieldStyle()} />
      </Row>

      {!thicknesses && (
        <Row label={t.thickness}>
          <input type="number" value={uniformThicknessMm} onChange={e => setUniformThicknessMm(Number(e.target.value))} style={fieldStyle()} />
        </Row>
      )}

      <button
        onClick={handleRun}
        disabled={!canRun}
        style={{ ...primaryBtn(), opacity: canRun ? 1 : 0.5, marginTop: 8 }}
      >
        {t.run}
      </button>

      {result && (
        <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.7 }}>
          <div><strong>{t.fillTime}:</strong> {result.fillTimes[result.fillTimes.length - 1]?.toFixed(2) ?? '0'} s</div>
          <div><strong>{t.cooling}:</strong> {result.meanCoolingSec.toFixed(1)} s</div>
          <div><strong>{t.cycle}:</strong> {result.totalCycleSec.toFixed(1)} s</div>
          <div><strong>{t.welds}:</strong> {result.weldLines.length}</div>
          <div><strong>{t.traps}:</strong> {result.airTraps.length}</div>
          <div><strong>{t.sinkRisk}:</strong> {(result.sinkRisk * 100).toFixed(1)}%</div>
        </div>
      )}
    </div>
  );
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
    <span style={{ width: 110, fontSize: 11, color: '#94a3b8' }}>{label}</span>
    <span style={{ flex: 1 }}>{children}</span>
  </div>
);

function panelStyle(): React.CSSProperties {
  return {
    position: 'fixed', top: 80, right: 20, zIndex: 700, width: 320,
    background: '#0f172a', color: '#f1f5f9',
    borderRadius: 10, padding: '14px 16px',
    boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
    fontFamily: 'system-ui, sans-serif',
  };
}
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }; }
function fieldStyle(): React.CSSProperties { return { width: '100%', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 4, padding: '3px 6px', fontSize: 11 }; }
function smallBtn(): React.CSSProperties { return { background: '#3b82f6', color: 'white', border: 'none', padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer' }; }
function primaryBtn(): React.CSSProperties { return { width: '100%', background: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
