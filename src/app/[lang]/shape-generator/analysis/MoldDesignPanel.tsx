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
    split: '코어/캐비티 분할', parts: '표준 금형 부품 라이브러리', exportPackage: '제조 패키지 (ZIP) 내보내기',
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
    split: 'Core/Cavity Split', parts: 'Standard Mold Parts', exportPackage: 'Export Mfg Package (ZIP)',
  },
  ja: {
    title: '金型キャビティ & 抜き勾配解析',
    desc: '現在のパートからコア/キャビティブロックを生成し、抜き勾配を解析します。',
    createCavity: 'キャビティブロックを生成',
    draftAnalysis: '抜き勾配解析 (ヒートマップ)',
    draftAngleLabel: '最小抜き勾配 (°)',
    moldSizeLabel: '金型の余裕幅 (mm)',
    running: '生成中...',
    done: '金型分割が完了しました',
    split: 'コア／キャビティを分割', parts: '標準金型部品ライブラリ', exportPackage: '製造パッケージ（ZIP）を出力',
  },
  zh: {
    title: '模具型腔与拔模分析',
    desc: '基于当前零件生成型芯/型腔块并分析拔模斜度。',
    createCavity: '生成型腔块',
    draftAnalysis: '拔模分析（热力图）',
    draftAngleLabel: '最小拔模斜度 (°)',
    moldSizeLabel: '模具余量 (mm)',
    running: '生成中...',
    done: '模具分型完成',
    split: '分割型芯／型腔', parts: '标准模具零件库', exportPackage: '导出制造包（ZIP）',
  },
  es: {
    title: 'Cavidad de molde y análisis de desmoldeo',
    desc: 'Genera los bloques de macho/cavidad a partir de la pieza actual y analiza los ángulos de desmoldeo.',
    createCavity: 'Generar bloque de cavidad',
    draftAnalysis: 'Análisis de desmoldeo (mapa de calor)',
    draftAngleLabel: 'Ángulo mínimo de desmoldeo (°)',
    moldSizeLabel: 'Margen del molde (mm)',
    running: 'Procesando...',
    done: 'Partición del molde completada',
    split: 'Separar macho/cavidad', parts: 'Biblioteca de piezas de molde estándar', exportPackage: 'Exportar paquete de fabricación (ZIP)',
  },
  ar: {
    title: 'تجويف القالب وتحليل زاوية السحب',
    desc: 'يولّد كتلتي القلب والتجويف من القطعة الحالية ويحلّل زوايا السحب.',
    createCavity: 'توليد كتلة التجويف',
    draftAnalysis: 'تحليل زاوية السحب (خريطة حرارية)',
    draftAngleLabel: 'أدنى زاوية سحب (°)',
    moldSizeLabel: 'هامش القالب (مم)',
    running: 'جارٍ التوليد...',
    done: 'اكتمل تقسيم القالب',
    split: 'تقسيم القلب/التجويف', parts: 'مكتبة أجزاء القوالب القياسية', exportPackage: 'تصدير حزمة التصنيع (ZIP)',
  },
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
            background: 'var(--nx-ok)', color: 'var(--nx-text)', border: '1px solid rgba(255,255,255,0.1)',
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
              padding: '8px', borderRadius: 6, background: 'var(--nx-accent)', color: 'var(--nx-text)',
              border: 'none', fontWeight: 600, cursor: 'pointer'
            }}
          >
            {t.split}
          </button>
          
          <button
            onClick={onOpenStandardParts}
            style={{
              padding: '8px', borderRadius: 6, background: 'var(--nx-border)', color: 'var(--nx-text)',
              border: '1px solid var(--nx-border-strong)', fontWeight: 600, cursor: 'pointer'
            }}
          >
            {t.parts}
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
            {t.exportPackage}
          </button>
        </div>
      </div>
    </div>
  );
}
