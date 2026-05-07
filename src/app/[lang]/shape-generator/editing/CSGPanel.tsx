'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import type { CSGOperation, CSGToolShape, CSGToolParams } from './CSGOperations';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CSGPanelProps {
  lang: string;
  onApply: (op: CSGOperation, toolParams: CSGToolParams) => void;
  onClose: () => void;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: 'Boolean 연산',
    union: 'Union',
    subtract: 'Difference',
    intersect: 'Intersect',
    toolShape: '도구 형태',
    box: '박스',
    sphere: '구',
    cylinder: '실린더',
    dimensions: '치수 (mm)',
    width: '너비',
    height: '높이',
    depth: '깊이',
    position: '위치 오프셋 (mm)',
    posX: 'X',
    posY: 'Y',
    posZ: 'Z',
    rotY: 'Y 회전 (°)',
    apply: '적용',
    cancel: '취소',
  },
  en: {
    title: 'Boolean Operations',
    union: 'Union',
    subtract: 'Difference',
    intersect: 'Intersect',
    toolShape: 'Tool Shape',
    box: 'Box',
    sphere: 'Sphere',
    cylinder: 'Cylinder',
    dimensions: 'Dimensions (mm)',
    width: 'Width',
    height: 'Height',
    depth: 'Depth',
    position: 'Position Offset (mm)',
    posX: 'X',
    posY: 'Y',
    posZ: 'Z',
    rotY: 'Y Rotation (°)',
    apply: 'Apply',
    cancel: 'Cancel',
  },
  ja: {
    title: 'Boolean 演算',
    union: 'Union',
    subtract: 'Difference',
    intersect: 'Intersect',
    toolShape: 'ツール形状',
    box: 'ボックス',
    sphere: '球',
    cylinder: 'シリンダー',
    dimensions: '寸法 (mm)',
    width: '幅',
    height: '高さ',
    depth: '奥行き',
    position: '位置オフセット (mm)',
    posX: 'X',
    posY: 'Y',
    posZ: 'Z',
    rotY: 'Y 回転 (°)',
    apply: '適用',
    cancel: 'キャンセル',
  },
  zh: {
    title: 'Boolean 运算',
    union: 'Union',
    subtract: 'Difference',
    intersect: 'Intersect',
    toolShape: '工具形状',
    box: '方块',
    sphere: '球体',
    cylinder: '圆柱',
    dimensions: '尺寸 (mm)',
    width: '宽度',
    height: '高度',
    depth: '深度',
    position: '位置偏移 (mm)',
    posX: 'X',
    posY: 'Y',
    posZ: 'Z',
    rotY: 'Y 旋转 (°)',
    apply: '应用',
    cancel: '取消',
  },
  es: {
    title: 'Operaciones Boolean',
    union: 'Union',
    subtract: 'Difference',
    intersect: 'Intersect',
    toolShape: 'Forma Herramienta',
    box: 'Caja',
    sphere: 'Esfera',
    cylinder: 'Cilindro',
    dimensions: 'Dimensiones (mm)',
    width: 'Ancho',
    height: 'Alto',
    depth: 'Profundidad',
    position: 'Desplazamiento (mm)',
    posX: 'X',
    posY: 'Y',
    posZ: 'Z',
    rotY: 'Rotación Y (°)',
    apply: 'Aplicar',
    cancel: 'Cancelar',
  },
  ar: {
    title: 'عمليات Boolean',
    union: 'Union',
    subtract: 'Difference',
    intersect: 'Intersect',
    toolShape: 'شكل الأداة',
    box: 'صندوق',
    sphere: 'كرة',
    cylinder: 'أسطوانة',
    dimensions: 'الأبعاد (mm)',
    width: 'العرض',
    height: 'الارتفاع',
    depth: 'العمق',
    position: 'إزاحة الموضع (mm)',
    posX: 'X',
    posY: 'Y',
    posZ: 'Z',
    rotY: 'دوران Y (°)',
    apply: 'تطبيق',
    cancel: 'إلغاء',
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
      {children}
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
      <span style={{ fontSize: 11, color: '#8b949e' }}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        style={{
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 4,
          color: '#e6edf3',
          fontSize: 13,
          padding: '4px 8px',
          width: '100%',
          boxSizing: 'border-box',
          outline: 'none',
        }}
      />
    </label>
  );
}

// ─── CSGPanel ─────────────────────────────────────────────────────────────────

export default function CSGPanel({ lang, onApply, onClose }: CSGPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? langMap[lang] ?? 'en'];

  const [operation, setOperation] = useState<CSGOperation>('subtract');
  const [toolShape, setToolShape] = useState<CSGToolShape>('box');
  const [width, setWidth] = useState(30);
  const [height, setHeight] = useState(30);
  const [depth, setDepth] = useState(30);
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);
  const [rotY, setRotY] = useState(0);

  const handleApply = () => {
    const toolParams: CSGToolParams = {
      shape: toolShape,
      width,
      height,
      depth,
      posX,
      posY,
      posZ,
      rotY,
    };
    onApply(operation, toolParams);
  };

  // ── Styles ──────────────────────────────────────────────────────────────────

  const opButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '7px 0',
    background: active ? '#1f6feb' : '#21262d',
    border: active ? '1px solid #388bfd' : '1px solid #30363d',
    borderRadius: 6,
    color: active ? '#ffffff' : '#8b949e',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
    fontWeight: active ? 600 : 400,
  });

  const shapeButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '6px 0',
    background: active ? '#272e38' : '#161b22',
    border: active ? '1px solid #388bfd' : '1px solid #30363d',
    borderRadius: 6,
    color: active ? '#58a6ff' : '#8b949e',
    fontSize: 12,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9000,
        width: 360,
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        padding: '20px 20px 16px',
        color: '#e6edf3',
        fontFamily: 'inherit',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#8b949e',
            fontSize: 18,
            cursor: 'pointer',
            lineHeight: 1,
            padding: 2,
          }}
          aria-label="close"
        >
          ×
        </button>
      </div>

      {/* Operation buttons */}
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>{t.union} / {t.subtract} / {t.intersect}</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={opButtonStyle(operation === 'union')} onClick={() => setOperation('union')}>
            ∪ {t.union}
          </button>
          <button style={opButtonStyle(operation === 'subtract')} onClick={() => setOperation('subtract')}>
            − {t.subtract}
          </button>
          <button style={opButtonStyle(operation === 'intersect')} onClick={() => setOperation('intersect')}>
            ∩ {t.intersect}
          </button>
        </div>
      </div>

      {/* Tool shape picker */}
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>{t.toolShape}</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={shapeButtonStyle(toolShape === 'box')} onClick={() => setToolShape('box')}>
            ▭ {t.box}
          </button>
          <button style={shapeButtonStyle(toolShape === 'sphere')} onClick={() => setToolShape('sphere')}>
            ○ {t.sphere}
          </button>
          <button style={shapeButtonStyle(toolShape === 'cylinder')} onClick={() => setToolShape('cylinder')}>
            ⌀ {t.cylinder}
          </button>
        </div>
      </div>

      {/* Dimensions */}
      <div style={{ marginBottom: 14 }}>
        <SectionLabel>{t.dimensions}</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <NumberInput label={t.width} value={width} min={1} max={500} onChange={setWidth} />
          <NumberInput label={t.height} value={height} min={1} max={500} onChange={setHeight} />
          <NumberInput label={t.depth} value={depth} min={1} max={500} onChange={setDepth} />
        </div>
      </div>

      {/* Position offsets */}
      <div style={{ marginBottom: 14 }}>
        <SectionLabel>{t.position}</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <NumberInput label={t.posX} value={posX} min={-500} max={500} onChange={setPosX} />
          <NumberInput label={t.posY} value={posY} min={-500} max={500} onChange={setPosY} />
          <NumberInput label={t.posZ} value={posZ} min={-500} max={500} onChange={setPosZ} />
        </div>
      </div>

      {/* Y Rotation */}
      <div style={{ marginBottom: 20 }}>
        <SectionLabel>{t.rotY}</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <NumberInput label="°" value={rotY} min={-180} max={180} onChange={setRotY} />
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleApply}
          style={{
            flex: 1,
            padding: '9px 0',
            background: 'linear-gradient(135deg, #238636, #2ea043)',
            border: '1px solid #2ea043',
            borderRadius: 6,
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {t.apply}
        </button>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '9px 0',
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#8b949e',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
