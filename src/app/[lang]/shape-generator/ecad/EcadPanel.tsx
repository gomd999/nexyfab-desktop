'use client';

/**
 * EcadPanel.tsx — PCB import / preview + enclosure envelope CTA.
 */

import React, { useState } from 'react';
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
} as const;

export default function EcadPanel({ lang, onClose, onCreateEnvelope }: EcadPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;
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

function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 20, zIndex: 700, width: 320, background: '#0f172a', color: '#f1f5f9', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }; }
function textareaStyle(): React.CSSProperties { return { width: '100%', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }; }
function fieldStyle(): React.CSSProperties { return { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 4, padding: '3px 6px', fontSize: 11 }; }
function primaryBtn(): React.CSSProperties { return { width: '100%', marginTop: 6, background: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
