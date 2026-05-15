'use client';
import React, { useState } from 'react';
import type { BufferGeometry } from 'three';

const lt = {
  ko: {
    title: '금형 캐비티 & 구배 분석',
    desc: '현재 파트를 기반으로 코어/캐비티 블록을 생성하고 구배 각도(Draft Angle)를 분석합니다.',
    createCavity: '캐비티(Cavity) 블록 생성',
    draftAnalysis: '구배 분석 (히트맵)',
    draftAngleLabel: '최소 구배 각도 (°)',
    moldSizeLabel: '금형 여유 폭 (mm)',
    running: '생성 중...',
    done: '금형 분할 완료',
  },
  en: {
    title: 'Mold Cavity & Draft Analysis',
    desc: 'Generate core/cavity blocks based on the current part and analyze draft angles.',
    createCavity: 'Generate Cavity Block',
    draftAnalysis: 'Draft Analysis (Heatmap)',
    draftAngleLabel: 'Min Draft Angle (°)',
    moldSizeLabel: 'Mold Margin (mm)',
    running: 'Processing...',
    done: 'Mold split complete',
  }
};

interface MoldDesignPanelProps {
  lang: string;
  geometry: BufferGeometry | null;
  onClose: () => void;
  onGenerateCavity: (margin: number) => void;
  onShowDraftAnalysis: (minAngle: number) => void;
  onSplitBody: () => void;
  onOpenStandardParts: () => void;
  onExportPackage: () => void;
}

export default function MoldDesignPanel({ lang, geometry, onClose, onGenerateCavity, onShowDraftAnalysis, onSplitBody, onOpenStandardParts, onExportPackage }: MoldDesignPanelProps) {
  const t = lt[lang as keyof typeof lt] ?? lt.en;
  const [margin, setMargin] = useState(20);
  const [draftAngle, setDraftAngle] = useState(1.5);
  const [loading, _setLoading] = useState(false);

  return (
    <div style={{
      width: 320, background: 'var(--nx-bg)', border: '1px solid var(--nx-border)',
      borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      display: 'flex', flexDirection: 'column', color: 'var(--nx-text)',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--nx-panel-2)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🛠️</span>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{t.title}</h3>
        </div>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', color: 'var(--nx-text-3)', cursor: 'pointer'
        }}>✕</button>
      </div>

      <div style={{ padding: 16, fontSize: 12 }}>
        <p style={{ margin: '0 0 16px', color: 'var(--nx-text-2)', lineHeight: 1.4 }}>{t.desc}</p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t.moldSizeLabel}</span>
            <span style={{ color: 'var(--nx-accent-2)' }}>{margin} mm</span>
          </label>
          <input
            type="range" min="5" max="100" step="5"
            value={margin} onChange={e => setMargin(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--nx-accent)' }}
          />
        </div>

        <button
          onClick={() => onGenerateCavity(margin)}
          disabled={!geometry || loading}
          style={{
            width: '100%', padding: '8px', borderRadius: 6,
            background: '#238636', color: 'var(--nx-text)', border: '1px solid rgba(255,255,255,0.1)',
            fontWeight: 600, cursor: (!geometry || loading) ? 'not-allowed' : 'pointer',
            opacity: (!geometry || loading) ? 0.6 : 1, marginBottom: 24
          }}
        >
          {t.createCavity}
        </button>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t.draftAngleLabel}</span>
            <span style={{ color: 'var(--nx-warn)' }}>{draftAngle}°</span>
          </label>
          <input
            type="range" min="0" max="10" step="0.5"
            value={draftAngle} onChange={e => setDraftAngle(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--nx-warn)' }}
          />
        </div>

        <button
          onClick={() => onShowDraftAnalysis(draftAngle)}
          disabled={!geometry}
          style={{
            width: '100%', padding: '8px', borderRadius: 6,
            background: 'transparent', color: 'var(--nx-warn)', border: '1px solid #f0883e',
            fontWeight: 600, cursor: !geometry ? 'not-allowed' : 'pointer',
            opacity: !geometry ? 0.6 : 1, marginBottom: 24
          }}
        >
          {t.draftAnalysis}
        </button>

        <div style={{ borderTop: '1px solid var(--nx-panel-2)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onSplitBody}
            style={{
              padding: '8px', borderRadius: 6, background: '#1f6feb', color: 'var(--nx-text)',
              border: 'none', fontWeight: 600, cursor: 'pointer'
            }}
          >
            {lang === 'ko' ? '코어/캐비티 분할' : 'Core/Cavity Split'}
          </button>
          
          <button
            onClick={onOpenStandardParts}
            style={{
              padding: '8px', borderRadius: 6, background: 'var(--nx-border)', color: 'var(--nx-text)',
              border: '1px solid var(--nx-border-strong)', fontWeight: 600, cursor: 'pointer'
            }}
          >
            {lang === 'ko' ? '표준 금형 부품 라이브러리' : 'Standard Mold Parts'}
          </button>
          
          <button
            onClick={onExportPackage}
            disabled={!geometry}
            style={{
              padding: '8px', borderRadius: 6, background: 'transparent', color: 'var(--nx-ok)',
              border: '1px solid var(--nx-ok)', fontWeight: 600, cursor: !geometry ? 'not-allowed' : 'pointer',
              opacity: !geometry ? 0.6 : 1
            }}
          >
            {lang === 'ko' ? '제조 패키지 (ZIP) 내보내기' : 'Export Mfg Package (ZIP)'}
          </button>
        </div>
      </div>
    </div>
  );
}
