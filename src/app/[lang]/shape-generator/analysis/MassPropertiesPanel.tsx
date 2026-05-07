'use client';

import React, { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
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

/* ─── i18n ───────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '질량 특성',
    material: '재료',
    volume: '체적',
    surfaceArea: '표면적',
    mass: '질량',
    centerOfMass: '무게중심',
    boundingBox: '바운딩 박스',
    momentsOfInertia: '관성 모멘트',
    radiusOfGyration: '회전 반경',
    copy: '복사',
    copied: '복사됨',
    show: '표시',
    hide: '숨기기',
    empty: '형상을 생성하세요...',
  },
  en: {
    title: 'Mass Properties',
    material: 'Material',
    volume: 'Volume',
    surfaceArea: 'Surface Area',
    mass: 'Mass',
    centerOfMass: 'Center of Mass',
    boundingBox: 'Bounding Box',
    momentsOfInertia: 'Moments of Inertia',
    radiusOfGyration: 'Radius of Gyration',
    copy: 'Copy',
    copied: 'Copied',
    show: 'Show',
    hide: 'Hide',
    empty: 'Generate a shape...',
  },
  ja: {
    title: '質量特性',
    material: '材料',
    volume: '体積',
    surfaceArea: '表面積',
    mass: '質量',
    centerOfMass: '重心',
    boundingBox: 'バウンディングボックス',
    momentsOfInertia: '慣性モーメント',
    radiusOfGyration: '回転半径',
    copy: 'コピー',
    copied: 'コピーしました',
    show: '表示',
    hide: '非表示',
    empty: '形状を生成してください...',
  },
  zh: {
    title: '质量特性',
    material: '材料',
    volume: '体积',
    surfaceArea: '表面积',
    mass: '质量',
    centerOfMass: '质心',
    boundingBox: '边界框',
    momentsOfInertia: '惯性矩',
    radiusOfGyration: '回转半径',
    copy: '复制',
    copied: '已复制',
    show: '显示',
    hide: '隐藏',
    empty: '请生成形状...',
  },
  es: {
    title: 'Propiedades de Masa',
    material: 'Material',
    volume: 'Volumen',
    surfaceArea: 'Área de Superficie',
    mass: 'Masa',
    centerOfMass: 'Centro de Masa',
    boundingBox: 'Caja Delimitadora',
    momentsOfInertia: 'Momentos de Inercia',
    radiusOfGyration: 'Radio de Giro',
    copy: 'Copiar',
    copied: 'Copiado',
    show: 'Mostrar',
    hide: 'Ocultar',
    empty: 'Genera una forma...',
  },
  ar: {
    title: 'خصائص الكتلة',
    material: 'المادة',
    volume: 'الحجم',
    surfaceArea: 'مساحة السطح',
    mass: 'الكتلة',
    centerOfMass: 'مركز الكتلة',
    boundingBox: 'الصندوق المحيط',
    momentsOfInertia: 'عزوم القصور الذاتي',
    radiusOfGyration: 'نصف قطر الدوران',
    copy: 'نسخ',
    copied: 'تم النسخ',
    show: 'إظهار',
    hide: 'إخفاء',
    empty: '...قم بإنشاء شكل',
  },
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
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

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
      `=== ${t.title} ===`,
      `${t.material}: ${isKo ? mat.name.ko : mat.name.en} (${mat.density ?? 0} g/cm3)`,
      `${t.volume}: ${fmtNum(p.volume_cm3)} cm3`,
      `${t.surfaceArea}: ${fmtNum(p.surfaceArea_cm2)} cm2`,
      `${t.mass}: ${fmtMass(p.mass_g)}`,
      `${t.centerOfMass}: (${fmtLen(p.centerOfMass[0], unitSystem)}, ${fmtLen(p.centerOfMass[1], unitSystem)}, ${fmtLen(p.centerOfMass[2], unitSystem)})`,
      `${t.boundingBox}: ${fmtLen(p.boundingBox.size[0], unitSystem)} x ${fmtLen(p.boundingBox.size[1], unitSystem)} x ${fmtLen(p.boundingBox.size[2], unitSystem)}`,
      `${t.momentsOfInertia} (g*mm2): Ixx=${fmtNum(p.momentsOfInertia.Ixx, 1)}, Iyy=${fmtNum(p.momentsOfInertia.Iyy, 1)}, Izz=${fmtNum(p.momentsOfInertia.Izz, 1)}`,
      `${t.radiusOfGyration} (${u}): rx=${fmtLen(p.gyrationRadius.rx, unitSystem)}, ry=${fmtLen(p.gyrationRadius.ry, unitSystem)}, rz=${fmtLen(p.gyrationRadius.rz, unitSystem)}`,
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
            {t.title}
          </div>
        </div>
        <button onClick={handleCopy} style={{ ...btnStyle, background: copied ? '#238636' : C.row, color: copied ? '#fff' : C.text }}>
          {copied ? t.copied : t.copy}
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
          <div style={labelStyle}>{t.material}</div>
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
            {t.empty}
          </div>
        ) : (
          <>
            {/* Volume */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{t.volume}</div>
              <span style={valueStyle}>{fmtNum(properties.volume_cm3)} cm&#179;</span>
            </div>

            {/* Surface Area */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{t.surfaceArea}</div>
              <span style={valueStyle}>{fmtNum(properties.surfaceArea_cm2)} cm&#178;</span>
            </div>

            {/* Mass */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{t.mass}</div>
              <span style={valueStyle}>{fmtMass(properties.mass_g)}</span>
            </div>

            {/* Center of Mass */}
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={labelStyle}>{t.centerOfMass}</div>
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
                    {showingCenterOfMass ? t.hide : t.show}
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
              <div style={labelStyle}>{t.boundingBox}</div>
              <div style={smallValueStyle}>
                {fmtLen(properties.boundingBox.size[0], unitSystem)} {' \u00d7 '}
                {fmtLen(properties.boundingBox.size[1], unitSystem)} {' \u00d7 '}
                {fmtLen(properties.boundingBox.size[2], unitSystem)}
              </div>
            </div>

            {/* Moments of Inertia */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{t.momentsOfInertia} (g&middot;mm&#178;)</div>
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
              <div style={labelStyle}>{t.radiusOfGyration}</div>
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
