'use client';

/**
 * WeldingSymbolPicker.tsx — Dialog for inserting a welding symbol
 * into a drawing.
 *
 * Used by the drawing surface: user clicks an edge on a view +
 * "Add weld symbol" toolbar button → this dialog. Configures the
 * symbol type + dimensions + tail; on submit, caller anchors
 * the resulting WeldSymbol at the clicked location.
 */

import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import {
  formatWeldSymbol, WELD_GLYPH, type WeldSymbol, type WeldType,
} from './weldingSymbols';

interface WeldingSymbolPickerProps {
  lang: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (symbol: WeldSymbol) => void;
}

const COPY = {
  ko: {
    title: '용접 기호',
    type: '종류',
    sizeArrow: '크기 (화살표)',
    sizeOther: '크기 (반대측)',
    length: '길이',
    pitch: '피치',
    allAround: '전둘레 ⊙',
    fieldWeld: '현장용접 ⚑',
    tail: '메모',
    process: '공정',
    cancel: '취소',
    apply: '추가',
    preview: '미리보기',
  },
  en: {
    title: 'Welding Symbol',
    type: 'Type',
    sizeArrow: 'Size (Arrow)',
    sizeOther: 'Size (Other)',
    length: 'Length',
    pitch: 'Pitch',
    allAround: 'All Around ⊙',
    fieldWeld: 'Field Weld ⚑',
    tail: 'Tail Note',
    process: 'Process',
    cancel: 'Cancel',
    apply: 'Add',
    preview: 'Preview',
  },
  ja: {
    title: '溶接記号',
    type: '種類',
    sizeArrow: 'サイズ (矢印側)',
    sizeOther: 'サイズ (反対側)',
    length: '長さ',
    pitch: 'ピッチ',
    allAround: '全周 ⊙',
    fieldWeld: '現場溶接 ⚑',
    tail: '尾部注記',
    process: '溶接法',
    cancel: 'キャンセル',
    apply: '追加',
    preview: 'プレビュー',
  },
  zh: {
    title: '焊接符号',
    type: '类型',
    sizeArrow: '尺寸（箭头侧）',
    sizeOther: '尺寸（另一侧）',
    length: '长度',
    pitch: '间距',
    allAround: '全周 ⊙',
    fieldWeld: '现场焊 ⚑',
    tail: '尾部标注',
    process: '焊接方法',
    cancel: '取消',
    apply: '添加',
    preview: '预览',
  },
  es: {
    title: 'Símbolo de soldadura',
    type: 'Tipo',
    sizeArrow: 'Tamaño (lado flecha)',
    sizeOther: 'Tamaño (lado opuesto)',
    length: 'Longitud',
    pitch: 'Paso',
    allAround: 'Todo alrededor ⊙',
    fieldWeld: 'Soldadura en obra ⚑',
    tail: 'Cola (nota)',
    process: 'Proceso',
    cancel: 'Cancelar',
    apply: 'Añadir',
    preview: 'Vista previa',
  },
  ar: {
    title: 'رمز اللحام',
    type: 'النوع',
    sizeArrow: 'المقاس (جهة السهم)',
    sizeOther: 'المقاس (الجهة المقابلة)',
    length: 'الطول',
    pitch: 'الخطوة',
    allAround: 'محيط كامل ⊙',
    fieldWeld: 'لحام موقعي ⚑',
    tail: 'ملاحظة الذيل',
    process: 'طريقة اللحام',
    cancel: 'إلغاء',
    apply: 'إضافة',
    preview: 'معاينة',
  },
} as const;

const TYPES: WeldType[] = ['fillet', 'square-groove', 'v-groove', 'u-groove', 'j-groove', 'bevel-groove', 'plug', 'slot', 'spot', 'seam'];

export default function WeldingSymbolPicker({
  lang, open, onClose, onConfirm,
}: WeldingSymbolPickerProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [type, setType] = useState<WeldType>('fillet');
  const [sizeArrow, setSizeArrow] = useState(6);
  const [sizeOther, setSizeOther] = useState<number | ''>('');
  const [length, setLength] = useState<number | ''>('');
  const [pitch, setPitch] = useState<number | ''>('');
  const [allAround, setAllAround] = useState(false);
  const [fieldWeld, setFieldWeld] = useState(false);
  const [tail, setTail] = useState('');

  if (!open) return null;

  const symbol: WeldSymbol = {
    type,
    standard: 'AWS',
    arrowSide: {
      sizeMm: sizeArrow,
      lengthMm: typeof length === 'number' ? length : undefined,
      pitchMm: typeof pitch === 'number' ? pitch : undefined,
    },
    otherSide: typeof sizeOther === 'number' ? { sizeMm: sizeOther } : undefined,
    allAround,
    fieldWeld,
    tail: tail.trim() || undefined,
  };

  return (
    <div style={overlayStyle()} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle()}>
        <div style={headerStyle()}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t.title}</h3>
          <button onClick={onClose} style={xBtnStyle()}>✕</button>
        </div>

        <Row label={t.type}>
          <select value={type} onChange={e => setType(e.target.value as WeldType)} style={fieldStyle()}>
            {TYPES.map(tp => (
              <option key={tp} value={tp}>{tp} {WELD_GLYPH[tp]}</option>
            ))}
          </select>
        </Row>
        <Row label={t.sizeArrow}>
          <input type="number" value={sizeArrow} onChange={e => setSizeArrow(Number(e.target.value))} style={fieldStyle()} />
        </Row>
        <Row label={t.sizeOther}>
          <input type="number" value={sizeOther} placeholder="—" onChange={e => setSizeOther(e.target.value ? Number(e.target.value) : '')} style={fieldStyle()} />
        </Row>
        <Row label={t.length}>
          <input type="number" value={length} placeholder="—" onChange={e => setLength(e.target.value ? Number(e.target.value) : '')} style={fieldStyle()} />
        </Row>
        <Row label={t.pitch}>
          <input type="number" value={pitch} placeholder="—" onChange={e => setPitch(e.target.value ? Number(e.target.value) : '')} style={fieldStyle()} />
        </Row>
        <Row label={t.tail}>
          <input type="text" value={tail} placeholder="GMAW / TIG" onChange={e => setTail(e.target.value)} style={fieldStyle()} />
        </Row>

        <div style={{ display: 'flex', gap: 12, margin: '10px 0' }}>
          <label style={checkboxLabelStyle()}>
            <input type="checkbox" checked={allAround} onChange={e => setAllAround(e.target.checked)} /> {t.allAround}
          </label>
          <label style={checkboxLabelStyle()}>
            <input type="checkbox" checked={fieldWeld} onChange={e => setFieldWeld(e.target.checked)} /> {t.fieldWeld}
          </label>
        </div>

        <div style={previewStyle()}>
          <span style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{t.preview}:</span>
          <code style={{ fontSize: 14, marginLeft: 8 }}>{formatWeldSymbol(symbol)}</code>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={cancelBtn()}>{t.cancel}</button>
          <button onClick={() => { onConfirm(symbol); onClose(); }} style={applyBtn()}>{t.apply}</button>
        </div>
      </div>
    </div>
  );
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
    <span style={{ width: 110, fontSize: 12, color: 'var(--nx-text-2)' }}>{label}</span>
    <span style={{ flex: 1 }}>{children}</span>
  </div>
);

function overlayStyle(): React.CSSProperties {
  return {
    position: 'fixed', inset: 0, zIndex: 1100,
    background: 'rgba(15,23,42,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
function dialogStyle(): React.CSSProperties {
  return {
    background: 'var(--nx-panel)', color: 'var(--nx-text)',
    borderRadius: 12, padding: '20px 24px',
    width: 'min(420px, 95vw)',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
  };
}
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 18 }; }
function fieldStyle(): React.CSSProperties { return { width: '100%', background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '4px 6px', fontSize: 12 }; }
function checkboxLabelStyle(): React.CSSProperties { return { fontSize: 12, color: 'var(--nx-text-2)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }; }
function previewStyle(): React.CSSProperties { return { padding: '10px 12px', background: 'var(--nx-panel-2)', borderRadius: 6, marginTop: 8 }; }
function cancelBtn(): React.CSSProperties { return { background: 'transparent', color: 'var(--nx-text-2)', border: 'none', padding: '6px 12px', fontSize: 12, cursor: 'pointer' }; }
function applyBtn(): React.CSSProperties { return { background: '#3b82f6', color: 'white', border: 'none', padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }; }
