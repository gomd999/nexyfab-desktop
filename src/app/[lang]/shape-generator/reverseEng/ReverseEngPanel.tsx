'use client';

/**
 * ReverseEngPanel.tsx — Point cloud import + primitive fit panel.
 */

import React, { useState } from 'react';
import { parseXyz, fitPlane, fitSphere, type PointCloud } from './pointCloud';

interface ReverseEngPanelProps {
  lang: string;
  onClose?: () => void;
  /** When the fit succeeds, parent can convert it to a sketch/feature. */
  onFitResult?: (kind: 'plane' | 'sphere', data: object) => void;
}

const COPY = {
  ko: {
    title: '역설계 (Point Cloud)',
    paste: 'XYZ 데이터 붙여넣기',
    parse: '파싱',
    fit: '피팅',
    plane: '평면',
    sphere: '구',
    bbox: '범위',
    points: '점',
    radius: '반경',
    rms: 'RMS 오차',
  },
  en: {
    title: 'Reverse Engineering',
    paste: 'Paste XYZ data',
    parse: 'Parse',
    fit: 'Fit',
    plane: 'Plane',
    sphere: 'Sphere',
    bbox: 'BBox',
    points: 'Points',
    radius: 'Radius',
    rms: 'RMS error',
  },
} as const;

export default function ReverseEngPanel({ lang, onClose, onFitResult }: ReverseEngPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;
  const [text, setText] = useState('');
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [planeResult, setPlaneResult] = useState<ReturnType<typeof fitPlane>>(null);
  const [sphereResult, setSphereResult] = useState<ReturnType<typeof fitSphere>>(null);

  const handleParse = () => {
    const c = parseXyz(text);
    if (c.points.length === 0) { alert('No points parsed'); return; }
    setCloud(c);
    setPlaneResult(null);
    setSphereResult(null);
  };

  const handleFitPlane = () => {
    if (!cloud) return;
    const r = fitPlane(cloud);
    setPlaneResult(r);
    if (r) onFitResult?.('plane', r);
  };

  const handleFitSphere = () => {
    if (!cloud) return;
    const r = fitSphere(cloud);
    setSphereResult(r);
    if (r) onFitResult?.('sphere', r);
  };

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

      {cloud && (
        <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6 }}>
          <div><strong>{t.points}:</strong> {cloud.points.length}</div>
          <div><strong>{t.bbox}:</strong> {(cloud.bbox.max[0] - cloud.bbox.min[0]).toFixed(1)} × {(cloud.bbox.max[1] - cloud.bbox.min[1]).toFixed(1)} × {(cloud.bbox.max[2] - cloud.bbox.min[2]).toFixed(1)}</div>

          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={handleFitPlane} style={secondaryBtn()}>{t.fit} {t.plane}</button>
            <button onClick={handleFitSphere} style={secondaryBtn()}>{t.fit} {t.sphere}</button>
          </div>

          {planeResult && (
            <div style={resultBoxStyle()}>
              <strong>{t.plane}:</strong>
              <div>normal: ({planeResult.normal.map(n => n.toFixed(3)).join(', ')})</div>
              <div>{t.rms}: {planeResult.rmsError.toFixed(4)} mm</div>
            </div>
          )}
          {sphereResult && (
            <div style={resultBoxStyle()}>
              <strong>{t.sphere}:</strong>
              <div>center: ({sphereResult.center.map(n => n.toFixed(2)).join(', ')})</div>
              <div>{t.radius}: {sphereResult.radius.toFixed(2)} mm</div>
              <div>{t.rms}: {sphereResult.rmsError.toFixed(4)} mm</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// right: 340 clears the 320px right property pane (2026-06-12)
function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 340, zIndex: 700, width: 340, background: 'var(--nx-panel)', color: 'var(--nx-text)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 16 }; }
function textareaStyle(): React.CSSProperties { return { width: '100%', background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }; }
function primaryBtn(): React.CSSProperties { return { width: '100%', marginTop: 6, background: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
function secondaryBtn(): React.CSSProperties { return { flex: 1, background: 'var(--nx-panel-2)', color: 'var(--nx-text-2)', border: '1px solid var(--nx-border)', padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }; }
function resultBoxStyle(): React.CSSProperties { return { marginTop: 8, padding: '8px 10px', background: 'var(--nx-panel-2)', borderRadius: 6, fontSize: 11, fontFamily: 'monospace' }; }
