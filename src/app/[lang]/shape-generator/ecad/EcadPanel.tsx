'use client';

/**
 * EcadPanel.tsx — PCB import / preview + enclosure envelope CTA.
 */

import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { parseIdf, pcbBoundingBox, maxComponentHeight, clearanceEnvelope, type PcbBoard } from './pcbImport';

interface EcadPanelProps {
  lang: string;
  onClose?: () => void;
  /** Caller emits resulting envelope so the modeler can sketch
   *  a matching enclosure. */
  onCreateEnvelope?: (envelope: { min: [number, number, number]; max: [number, number, number] }) => void;
}

const COPY = {
  ko: {
    title: 'PCB Import',
    paste: 'IDF 텍스트 붙여넣기',
    parse: '파싱',
    bbox: '보드 크기',
    components: '컴포넌트',
    topHeight: '상단 컴포넌트 최대 높이',
    bottomHeight: '하단 컴포넌트 최대 높이',
    clearance: 'Clearance (mm)',
    createEnvelope: 'Enclosure 외곽 생성',
    invalid: '잘못된 IDF 파일',
  },
  en: {
    title: 'PCB Import',
    paste: 'Paste IDF text',
    parse: 'Parse',
    bbox: 'Board size',
    components: 'Components',
    topHeight: 'Max top component height',
    bottomHeight: 'Max bottom component height',
    clearance: 'Clearance (mm)',
    createEnvelope: 'Create enclosure envelope',
    invalid: 'Invalid IDF file',
  },
  ja: {
    title: 'PCB インポート',
    paste: 'IDF テキストを貼り付け',
    parse: '解析',
    bbox: 'ボードサイズ',
    components: 'コンポーネント',
    topHeight: '上面コンポーネントの最大高さ',
    bottomHeight: '下面コンポーネントの最大高さ',
    clearance: 'クリアランス (mm)',
    createEnvelope: 'エンクロージャ外形を生成',
    invalid: '不正な IDF ファイル',
  },
  zh: {
    title: 'PCB 导入',
    paste: '粘贴 IDF 文本',
    parse: '解析',
    bbox: '板尺寸',
    components: '元件',
    topHeight: '顶面元件最大高度',
    bottomHeight: '底面元件最大高度',
    clearance: '间隙 (mm)',
    createEnvelope: '生成外壳轮廓',
    invalid: 'IDF 文件无效',
  },
  es: {
    title: 'Importar PCB',
    paste: 'Pegar texto IDF',
    parse: 'Analizar',
    bbox: 'Tamaño de la placa',
    components: 'Componentes',
    topHeight: 'Altura máx. de componentes superiores',
    bottomHeight: 'Altura máx. de componentes inferiores',
    clearance: 'Holgura (mm)',
    createEnvelope: 'Crear envolvente de la carcasa',
    invalid: 'Archivo IDF no válido',
  },
  ar: {
    title: 'استيراد PCB',
    paste: 'لصق نص IDF',
    parse: 'تحليل',
    bbox: 'مقاس اللوحة',
    components: 'المكوّنات',
    topHeight: 'أقصى ارتفاع للمكوّنات العلوية',
    bottomHeight: 'أقصى ارتفاع للمكوّنات السفلية',
    clearance: 'الخلوص (مم)',
    createEnvelope: 'إنشاء غلاف الحاوية',
    invalid: 'ملف IDF غير صالح',
  },
} as const;

export default function EcadPanel({ lang, onClose, onCreateEnvelope }: EcadPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: `ko ? COPY.ko : COPY.en` 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [text, setText] = useState('');
  const [board, setBoard] = useState<PcbBoard | null>(null);
  const [clearance, setClearance] = useState(2);

  const handleParse = () => {
    const r = parseIdf(text);
    if (!r) { alert(t.invalid); return; }
    setBoard(r);
  };

  const bbox = board ? pcbBoundingBox(board) : null;
  const heights = board ? maxComponentHeight(board) : null;

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t.paste}
        rows={6}
        style={textareaStyle()}
      />
      <button onClick={handleParse} style={primaryBtn()}>{t.parse}</button>

      {board && bbox && heights && (
        <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.6 }}>
          <div><strong>{t.bbox}:</strong> {(bbox.max[0] - bbox.min[0]).toFixed(1)} × {(bbox.max[1] - bbox.min[1]).toFixed(1)} × {board.thicknessMm} mm</div>
          <div><strong>{t.components}:</strong> {board.components.length}</div>
          <div><strong>{t.topHeight}:</strong> {heights.top.toFixed(1)} mm</div>
          <div><strong>{t.bottomHeight}:</strong> {heights.bottom.toFixed(1)} mm</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <span>{t.clearance}:</span>
            <input
              type="number" value={clearance}
              onChange={e => setClearance(Number(e.target.value))}
              style={{ ...fieldStyle(), width: 60 }}
            />
          </div>
          {onCreateEnvelope && (
            <button
              style={{ ...primaryBtn(), marginTop: 8 }}
              onClick={() => onCreateEnvelope(clearanceEnvelope(board, clearance))}
            >
              {t.createEnvelope}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// right: 336 clears the 320px right property pane (2026-06-12)
function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 340, zIndex: 700, width: 320, background: 'var(--nx-panel)', color: 'var(--nx-text)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 16 }; }
function textareaStyle(): React.CSSProperties { return { width: '100%', background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }; }
function fieldStyle(): React.CSSProperties { return { background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '3px 6px', fontSize: 11 }; }
function primaryBtn(): React.CSSProperties { return { width: '100%', marginTop: 6, background: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
