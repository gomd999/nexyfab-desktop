'use client';

import React, { useMemo, useState } from 'react';
import type { MassProperties } from './massProperties';
import { MATERIAL_PRESETS, type MaterialPreset } from '../materials';
import type { UnitSystem } from '../units';
import { convertToDisplay } from '../units';

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  panelBg: '#0d1117',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  row: '#21262d',
};

const panelStyle: React.CSSProperties = {
  width: 320,
  flexShrink: 0,
  borderLeft: `1px solid ${C.border}`,
  background: C.panelBg,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontSize: 12,
  color: C.text,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 12px',
  borderBottom: `1px solid ${C.border}`,
  gap: 8,
  background: C.bg,
};

const sectionStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: `1px solid ${C.border}`,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: C.textDim,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 13,
  fontWeight: 600,
  color: '#58a6ff',
};

const smallValueStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  color: C.text,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '3px 6px',
  fontWeight: 700,
  color: C.textDim,
  fontSize: 10,
  borderBottom: `1px solid ${C.border}`,
};

const tdStyle: React.CSSProperties = {
  padding: '3px 6px',
  fontFamily: 'monospace',
  fontSize: 11,
  color: C.text,
};

const btnStyle: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: 4,
  border: 'none',
  background: C.row,
  color: C.text,
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.12s',
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function fmtNum(v: number, decimals = 2): string {
  if (Math.abs(v) >= 1e6) return v.toExponential(2);
  return v.toFixed(decimals);
}

function fmtLen(mm: number, unit: UnitSystem, decimals = 2): string {
  const v = convertToDisplay(mm, unit);
  return `${fmtNum(v, decimals)} ${unit === 'mm' ? 'mm' : 'in'}`;
}

function fmtMass(g: number): string {
  if (g >= 1000) return `${fmtNum(g / 1000, 3)} kg`;
  return `${fmtNum(g, 2)} g`;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

interface MassPropertiesPanelProps {
  properties: MassProperties | null;
  materialId: string;
  onMaterialChange: (id: string) => void;
  unitSystem: UnitSystem;
  isKo: boolean;
  onClose: () => void;
  onShowCenterOfMass?: (pos: [number, number, number] | null) => void;
  showingCenterOfMass?: boolean;
}

export default function MassPropertiesPanel({
  properties,
  materialId,
  onMaterialChange,
  unitSystem,
  isKo,
  onClose,
  onShowCenterOfMass,
  showingCenterOfMass,
}: MassPropertiesPanelProps) {
  const [copied, setCopied] = useState(false);

  const mat = useMemo(
    () => MATERIAL_PRESETS.find(m => m.id === materialId) ?? MATERIAL_PRESETS[0],
    [materialId],
  );

  const handleCopy = () => {
    if (!properties) return;
    const p = properties;
    const u = unitSystem === 'mm' ? 'mm' : 'in';
    const lines = [
      `=== ${isKo ? '질량 특성' : 'Mass Properties'} ===`,
      `${isKo ? '재료' : 'Material'}: ${isKo ? mat.name.ko : mat.name.en} (${mat.density ?? 0} g/cm3)`,
      `${isKo ? '체적' : 'Volume'}: ${fmtNum(p.volume_cm3)} cm3`,
      `${isKo ? '표면적' : 'Surface Area'}: ${fmtNum(p.surfaceArea_cm2)} cm2`,
      `${isKo ? '질량' : 'Mass'}: ${fmtMass(p.mass_g)}`,
      `${isKo ? '무게중심' : 'Center of Mass'}: (${fmtLen(p.centerOfMass[0], unitSystem)}, ${fmtLen(p.centerOfMass[1], unitSystem)}, ${fmtLen(p.centerOfMass[2], unitSystem)})`,
      `${isKo ? '바운딩 박스' : 'Bounding Box'}: ${fmtLen(p.boundingBox.size[0], unitSystem)} x ${fmtLen(p.boundingBox.size[1], unitSystem)} x ${fmtLen(p.boundingBox.size[2], unitSystem)}`,
      `${isKo ? '관성 모멘트' : 'Moments of Inertia'} (g*mm2): Ixx=${fmtNum(p.momentsOfInertia.Ixx, 1)}, Iyy=${fmtNum(p.momentsOfInertia.Iyy, 1)}, Izz=${fmtNum(p.momentsOfInertia.Izz, 1)}`,
      `${isKo ? '회전 반경' : 'Radius of Gyration'} (${u}): rx=${fmtLen(p.gyrationRadius.rx, unitSystem)}, ry=${fmtLen(p.gyrationRadius.ry, unitSystem)}, rz=${fmtLen(p.gyrationRadius.rz, unitSystem)}`,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: 14 }}>&#9878;</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.text }}>
            {isKo ? '질량 특성' : 'Mass Properties'}
          </div>
        </div>
        <button onClick={handleCopy} style={{ ...btnStyle, background: copied ? '#238636' : C.row, color: copied ? '#fff' : C.text }}>
          {copied ? (isKo ? '복사됨' : 'Copied') : (isKo ? '복사' : 'Copy')}
        </button>
        <button
          onClick={onClose}
          style={{
            border: 'none', background: C.row, cursor: 'pointer', fontSize: 12, color: C.textDim,
            width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          &#10005;
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Material selector */}
        <div style={sectionStyle}>
          <div style={labelStyle}>{isKo ? '재료' : 'Material'}</div>
          <select
            value={materialId}
            onChange={e => onMaterialChange(e.target.value)}
            style={{
              width: '100%', padding: '5px 8px', borderRadius: 5,
              border: `1px solid ${C.border}`, background: C.row, color: C.text,
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {MATERIAL_PRESETS.map(m => (
              <option key={m.id} value={m.id}>
                {isKo ? m.name.ko : m.name.en} ({m.density ?? '?'} g/cm&#179;)
              </option>
            ))}
          </select>
        </div>

        {!properties ? (
          <div style={{ padding: 24, textAlign: 'center', color: C.textDim }}>
            {isKo ? '형상을 생성하세요...' : 'Generate a shape...'}
          </div>
        ) : (
          <>
            {/* Volume */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{isKo ? '체적' : 'Volume'}</div>
              <span style={valueStyle}>{fmtNum(properties.volume_cm3)} cm&#179;</span>
            </div>

            {/* Surface Area */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{isKo ? '표면적' : 'Surface Area'}</div>
              <span style={valueStyle}>{fmtNum(properties.surfaceArea_cm2)} cm&#178;</span>
            </div>

            {/* Mass */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{isKo ? '질량' : 'Mass'}</div>
              <span style={valueStyle}>{fmtMass(properties.mass_g)}</span>
            </div>

            {/* Center of Mass */}
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={labelStyle}>{isKo ? '무게중심' : 'Center of Mass'}</div>
                {onShowCenterOfMass && (
                  <button
                    onClick={() => onShowCenterOfMass(showingCenterOfMass ? null : properties.centerOfMass)}
                    style={{
                      ...btnStyle,
                      background: showingCenterOfMass ? C.accent : C.row,
                      color: showingCenterOfMass ? '#fff' : C.text,
                      marginBottom: 4,
                    }}
                  >
                    {showingCenterOfMass ? (isKo ? '숨기기' : 'Hide') : (isKo ? '표시' : 'Show')}
                  </button>
                )}
              </div>
              <div style={smallValueStyle}>
                X: {fmtLen(properties.centerOfMass[0], unitSystem)}{' '}
                Y: {fmtLen(properties.centerOfMass[1], unitSystem)}{' '}
                Z: {fmtLen(properties.centerOfMass[2], unitSystem)}
              </div>
            </div>

            {/* Bounding Box */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{isKo ? '바운딩 박스' : 'Bounding Box'}</div>
              <div style={smallValueStyle}>
                {fmtLen(properties.boundingBox.size[0], unitSystem)} {' \u00d7 '}
                {fmtLen(properties.boundingBox.size[1], unitSystem)} {' \u00d7 '}
                {fmtLen(properties.boundingBox.size[2], unitSystem)}
              </div>
            </div>

            {/* Moments of Inertia */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{isKo ? '관성 모멘트' : 'Moments of Inertia'} (g&middot;mm&#178;)</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Ixx</th>
                    <th style={thStyle}>Iyy</th>
                    <th style={thStyle}>Izz</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tdStyle}>{fmtNum(properties.momentsOfInertia.Ixx, 1)}</td>
                    <td style={tdStyle}>{fmtNum(properties.momentsOfInertia.Iyy, 1)}</td>
                    <td style={tdStyle}>{fmtNum(properties.momentsOfInertia.Izz, 1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Radius of Gyration */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{isKo ? '회전 반경' : 'Radius of Gyration'}</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>rx</th>
                    <th style={thStyle}>ry</th>
                    <th style={thStyle}>rz</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tdStyle}>{fmtLen(properties.gyrationRadius.rx, unitSystem)}</td>
                    <td style={tdStyle}>{fmtLen(properties.gyrationRadius.ry, unitSystem)}</td>
                    <td style={tdStyle}>{fmtLen(properties.gyrationRadius.rz, unitSystem)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
