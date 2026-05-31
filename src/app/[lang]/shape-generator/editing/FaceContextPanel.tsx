'use client';

/**
 * FaceContextPanel — sibling of EdgeContextPanel, mounts when the user
 * selects a face while in face-edit mode. Two deterministic operations:
 *
 *   • Face Offset — translates the selected face along its normal by N mm.
 *     Reuses `applyFaceOps.offsetFace` (mesh-only, instant, no OCCT round-
 *     trip). The SelectionInfoBadge already exposed a `faceOffset` label
 *     that routed through AI chat; this panel makes it a one-click
 *     numeric-input op.
 *
 *   • Shell — hollows the whole solid with N-mm uniform wall thickness.
 *     Reuses `applyFaceOps.shellWhole` → `shellFeature.applyAsync`
 *     (OCCT-preferred, mesh-CSG fallback). Optional `openFace` removes the
 *     top or bottom cap.
 *
 * Wiring contract mirrors EdgeContextPanel so the host overlay-mount
 * pattern (data-testid="face-context-panel-overlay" + conditional render
 * + close clears selection) is consistent.
 *
 * Localised across the 6 langs the shape-generator ships (ko/en/ja/zh/es/ar).
 *
 * NOT modified per phase constraint: SelectionInfoBadge, brep_shell,
 * BrepAdapter, directEditing internals. This panel only adds new wiring.
 */
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import type { UniqueFace } from './useFaceEditing';

const dict = {
  ko: {
    faceEdit: '면 편집',
    faceId: '면 ID',
    normal: '법선',
    genGeomFirst: '형상을 먼저 생성하세요',
    offsetTitle: '면 오프셋 (Face Offset)',
    shellTitle: '쉘 (Shell — 속 비우기)',
    distance: '거리',
    thickness: '두께',
    openFace: '개방 면',
    openNone: '닫힘',
    openTop: '상단(+Y)',
    openBottom: '하단(-Y)',
    applyOffset: '오프셋 적용',
    applyShell: '쉘 적용',
  },
  en: {
    faceEdit: 'Face Edit',
    faceId: 'Face ID',
    normal: 'Normal',
    genGeomFirst: 'Please generate geometry first',
    offsetTitle: 'Face Offset',
    shellTitle: 'Shell (Hollow Out)',
    distance: 'Distance',
    thickness: 'Wall Thickness',
    openFace: 'Open Face',
    openNone: 'Closed',
    openTop: 'Top (+Y)',
    openBottom: 'Bottom (-Y)',
    applyOffset: 'Apply Offset',
    applyShell: 'Apply Shell',
  },
  ja: {
    faceEdit: '面編集',
    faceId: '面ID',
    normal: '法線',
    genGeomFirst: '先に形状を生成してください',
    offsetTitle: '面オフセット (Face Offset)',
    shellTitle: 'シェル (Shell — 中空化)',
    distance: '距離',
    thickness: '肉厚',
    openFace: '開放面',
    openNone: '閉じる',
    openTop: '上 (+Y)',
    openBottom: '下 (-Y)',
    applyOffset: 'オフセット適用',
    applyShell: 'シェル適用',
  },
  zh: {
    faceEdit: '面编辑',
    faceId: '面ID',
    normal: '法线',
    genGeomFirst: '请先生成几何',
    offsetTitle: '面偏移 (Face Offset)',
    shellTitle: '抽壳 (Shell — 中空化)',
    distance: '距离',
    thickness: '壁厚',
    openFace: '开放面',
    openNone: '闭合',
    openTop: '顶部 (+Y)',
    openBottom: '底部 (-Y)',
    applyOffset: '应用偏移',
    applyShell: '应用抽壳',
  },
  es: {
    faceEdit: 'Editar Cara',
    faceId: 'ID de Cara',
    normal: 'Normal',
    genGeomFirst: 'Genere la geometría primero',
    offsetTitle: 'Desplazar Cara',
    shellTitle: 'Vaciar (Shell)',
    distance: 'Distancia',
    thickness: 'Espesor de Pared',
    openFace: 'Cara Abierta',
    openNone: 'Cerrado',
    openTop: 'Superior (+Y)',
    openBottom: 'Inferior (-Y)',
    applyOffset: 'Aplicar Desplazamiento',
    applyShell: 'Aplicar Vaciado',
  },
  ar: {
    faceEdit: 'تحرير الوجه',
    faceId: 'معرف الوجه',
    normal: 'العمودي',
    genGeomFirst: 'يرجى إنشاء الهندسة أولاً',
    offsetTitle: 'إزاحة الوجه',
    shellTitle: 'تجويف (Shell)',
    distance: 'المسافة',
    thickness: 'سُمك الجدار',
    openFace: 'الوجه المفتوح',
    openNone: 'مغلق',
    openTop: 'علوي (+Y)',
    openBottom: 'سفلي (-Y)',
    applyOffset: 'تطبيق الإزاحة',
    applyShell: 'تطبيق التجويف',
  },
};

type OpenFaceOpt = 0 | 1 | 2;

interface FaceContextPanelProps {
  /** The face the user has currently selected. Panel is mounted by the host
   *  only when this is non-null, so we can render unconditionally inside. */
  selectedFace: UniqueFace;
  /** Working geometry the operation runs on. Passed straight to the helpers. */
  geometry: THREE.BufferGeometry | null;
  lang: string;
  /** Apply an N-mm offset along the face normal. The host runs `offsetFace`
   *  and dispatches `onGeometryApply` + status toast. */
  onApplyOffset: (distance: number) => void;
  /** Apply a uniform-wall shell with the chosen open face. The host runs
   *  `shellWhole` (OCCT-preferred, mesh fallback) and dispatches. */
  onApplyShell: (thickness: number, openFace: OpenFaceOpt) => void;
  onClose: () => void;
}

export default function FaceContextPanel({
  selectedFace,
  geometry,
  lang,
  onApplyOffset,
  onApplyShell,
  onClose,
}: FaceContextPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? langMap[lang] ?? 'en'];

  const [offsetDist, setOffsetDist] = useState(2);
  const [shellThickness, setShellThickness] = useState(2);
  const [openFace, setOpenFace] = useState<OpenFaceOpt>(0);

  const posAttr = geometry?.getAttribute('position');
  const vertexCount = posAttr ? posAttr.count : 0;
  const hasInsufficientGeometry = vertexCount < 4;

  const [nx, ny, nz] = selectedFace.normal;

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 80,
    right: 20,
    zIndex: 500,
    width: 280,
    backgroundColor: 'var(--nx-panel)',
    border: '1px solid var(--nx-border)',
    borderRadius: 12,
    color: 'var(--nx-text)',
    fontFamily: 'sans-serif',
    fontSize: 13,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--nx-border)',
    fontWeight: 600,
    fontSize: 14,
  };

  const closeBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'var(--nx-text-2)',
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    padding: '0 2px',
  };

  const bodyStyle: React.CSSProperties = {
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  };

  const infoBoxStyle: React.CSSProperties = {
    backgroundColor: 'var(--nx-bg)',
    border: '1px solid var(--nx-border)',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 12,
    color: 'var(--nx-text-2)',
    lineHeight: 1.6,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontWeight: 600,
    fontSize: 12,
    color: 'var(--nx-text-2)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 8,
  };

  const sectionBoxStyle: React.CSSProperties = {
    backgroundColor: 'var(--nx-bg)',
    border: '1px solid var(--nx-border)',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };

  const labelRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    color: 'var(--nx-text)',
  };

  const sliderStyle: React.CSSProperties = {
    width: '100%',
    accentColor: 'var(--nx-accent-2)',
    cursor: 'pointer',
  };

  const applyBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 0',
    backgroundColor: 'var(--nx-accent)',
    border: 'none',
    borderRadius: 6,
    color: 'var(--nx-text)',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
  };

  const segmentBtnBase: React.CSSProperties = {
    flex: 1,
    padding: '4px 0',
    border: '1px solid var(--nx-border)',
    borderRadius: 5,
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: 500,
  };

  const warningStyle: React.CSSProperties = {
    backgroundColor: '#2d1c1c',
    border: '1px solid #5a1d1d',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 12,
    color: 'var(--nx-error)',
    textAlign: 'center',
  };

  return (
    <div style={panelStyle} data-testid="face-context-panel">
      {/* Header */}
      <div style={headerStyle}>
        <span>{t.faceEdit}</span>
        <button
          style={closeBtnStyle}
          onClick={onClose}
          title="Close"
          data-testid="face-context-panel-close"
        >
          ×
        </button>
      </div>

      <div style={bodyStyle}>
        {/* Face info */}
        <div style={infoBoxStyle}>
          <div>
            {t.faceId}: <strong style={{ color: 'var(--nx-text)' }}>{selectedFace.id}</strong>
          </div>
          <div>
            {t.normal}:{' '}
            <strong style={{ color: 'var(--nx-text)' }}>
              ({nx.toFixed(2)}, {ny.toFixed(2)}, {nz.toFixed(2)})
            </strong>
          </div>
        </div>

        {hasInsufficientGeometry && (
          <div style={warningStyle}>{t.genGeomFirst}</div>
        )}

        {/* Face Offset Section */}
        <div>
          <div style={sectionTitleStyle}>{t.offsetTitle}</div>
          <div style={sectionBoxStyle}>
            <div>
              <div style={labelRowStyle}>
                <span>{t.distance}</span>
                <span style={{ color: 'var(--nx-accent-2)', fontWeight: 600 }}>
                  {offsetDist.toFixed(1)} mm
                </span>
              </div>
              <input
                type="range"
                min={-20}
                max={20}
                step={0.5}
                value={offsetDist}
                onChange={(e) => setOffsetDist(parseFloat(e.target.value))}
                style={sliderStyle}
                data-testid="face-offset-slider"
              />
            </div>
            <button
              style={applyBtnStyle}
              disabled={hasInsufficientGeometry || offsetDist === 0}
              onClick={() => onApplyOffset(offsetDist)}
              data-testid="apply-face-offset-button"
            >
              {t.applyOffset}
            </button>
          </div>
        </div>

        {/* Shell Section */}
        <div>
          <div style={sectionTitleStyle}>{t.shellTitle}</div>
          <div style={sectionBoxStyle}>
            <div>
              <div style={labelRowStyle}>
                <span>{t.thickness}</span>
                <span style={{ color: 'var(--nx-accent-2)', fontWeight: 600 }}>
                  {shellThickness.toFixed(1)} mm
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={20}
                step={0.5}
                value={shellThickness}
                onChange={(e) => setShellThickness(parseFloat(e.target.value))}
                style={sliderStyle}
                data-testid="shell-thickness-slider"
              />
            </div>
            <div>
              <div style={{ ...labelRowStyle, marginBottom: 6 }}>
                <span>{t.openFace}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(
                  [
                    [0, t.openNone],
                    [1, t.openTop],
                    [2, t.openBottom],
                  ] as ReadonlyArray<readonly [OpenFaceOpt, string]>
                ).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setOpenFace(val)}
                    style={{
                      ...segmentBtnBase,
                      backgroundColor: openFace === val ? '#6e40c9' : 'var(--nx-panel)',
                      borderColor: openFace === val ? '#7948d0' : 'var(--nx-border)',
                      color: openFace === val ? 'var(--nx-text)' : 'var(--nx-text-2)',
                    }}
                    data-testid={`shell-open-face-${val}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button
              style={applyBtnStyle}
              disabled={hasInsufficientGeometry}
              onClick={() => onApplyShell(shellThickness, openFace)}
              data-testid="apply-shell-button"
            >
              {t.applyShell}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
