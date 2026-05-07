'use client';

import React, { useState, useEffect } from 'react';

interface EmptyCanvasGuideProps {
  lang: string;
  onStartSketch: () => void;
  onImportFile: () => void;
  onSelectShape: (shape: string) => void;
  onStartTutorial: () => void;
  /** Set to true while a file import is in progress — disables import button */
  isImporting?: boolean;
}

const L: Record<string, Record<string, string>> = {
  ko: { title: '디자인을 시작해보세요', desc: '스케치를 그리거나, 기본 형상을 선택하거나, 파일을 불러오세요', sketch: '스케치 시작', import: '파일 불러오기', importing: '불러오는 중...', pickShape: '또는 기본 형상 선택', tutorial: '튜토리얼 시작하기', keyboardHints: 'Ctrl+K 명령 · ? 단축키 · M 측정(형상 생성 후)', box: '박스', cylinder: '실린더', sphere: '구', gear: '기어', cone: '원뿔', torus: '토러스', wedge: '쐐기' },
  en: { title: 'Start Your Design', desc: 'Draw a sketch, pick a base shape, or import a file', sketch: 'Sketch', import: 'Import', importing: 'Importing...', pickShape: 'Or pick a shape', tutorial: 'Start Tutorial', keyboardHints: 'Ctrl+K command · ? shortcuts · M measure (after geometry)', box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', gear: 'Gear', cone: 'Cone', torus: 'Torus', wedge: 'Wedge' },
  ja: { title: 'デザインを始めましょう', desc: 'スケッチを描くか、基本形状を選択するか、ファイルをインポートしてください', sketch: 'スケッチ開始', import: 'インポート', importing: 'インポート中...', pickShape: 'または基本形状を選択', tutorial: 'チュートリアル開始', keyboardHints: 'Ctrl+K コマンド · ? ショートカット · M 測定（形状後）', box: 'ボックス', cylinder: 'シリンダー', sphere: '球', gear: 'ギア', cone: '円錐', torus: 'トーラス', wedge: 'ウェッジ' },
  cn: { title: '开始您的设计', desc: '绘制草图、选择基本形状或导入文件', sketch: '开始草图', import: '导入', importing: '导入中...', pickShape: '或选择基本形状', tutorial: '开始教程', keyboardHints: 'Ctrl+K 命令 · ? 快捷键 · M 测量（有几何后）', box: '长方体', cylinder: '圆柱体', sphere: '球体', gear: '齿轮', cone: '圆锥', torus: '圆环', wedge: '楔' },
  es: { title: 'Comience su Diseño', desc: 'Dibuje un boceto, elija una forma base o importe un archivo', sketch: 'Boceto', import: 'Importar', importing: 'Importando...', pickShape: 'O elija una forma', tutorial: 'Iniciar Tutorial', keyboardHints: 'Ctrl+K comando · ? atajos · M medir (con geometría)', box: 'Caja', cylinder: 'Cilindro', sphere: 'Esfera', gear: 'Engranaje', cone: 'Cono', torus: 'Toro', wedge: 'Cuña' },
  ar: { title: 'ابدأ تصميمك', desc: 'ارسم مخططًا أو اختر شكلاً أساسيًا أو استورد ملفًا', sketch: 'بدء الرسم', import: 'استيراد', importing: 'جاري الاستيراد...', pickShape: 'أو اختر شكلاً', tutorial: 'بدء الدليل التعليمي', keyboardHints: 'Ctrl+K أوامر · ? اختصارات · M قياس (بعد الشكل)', box: 'صندوق', cylinder: 'أسطوانة', sphere: 'كرة', gear: 'ترس', cone: 'مخروط', torus: 'طارة', wedge: 'إسفين' },
};

function t(lang: string, key: string): string {
  return (L[lang] ?? L.en)[key] ?? (L.en[key] ?? key);
}

const QUICK_SHAPES = [
  { id: 'box',      icon: '📦', key: 'box' },
  { id: 'cylinder', icon: '🔩', key: 'cylinder' },
  { id: 'sphere',   icon: '🔮', key: 'sphere' },
  { id: 'gear',     icon: '⚙️', key: 'gear' },
  { id: 'cone',     icon: '🔺', key: 'cone' },
  { id: 'torus',    icon: '🍩', key: 'torus' },
  { id: 'wedge',    icon: '🔻', key: 'wedge' },
];

export default function EmptyCanvasGuide({
  lang, onStartSketch, onImportFile, onSelectShape, onStartTutorial, isImporting = false,
}: EmptyCanvasGuideProps) {
  // #15: fade-in animation on mount
  const [visible, setVisible] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(id); }, []);

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, rgba(56,139,253,0.04) 0%, transparent 70%)',
      pointerEvents: 'none',
      direction: lang === 'ar' ? 'rtl' : 'ltr',
      // #15: smooth fade-in
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.25s ease',
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 16, pointerEvents: 'auto', maxWidth: 400,
        // #15: slide-up on appear
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'linear-gradient(135deg, rgba(56,139,253,0.2), rgba(139,92,246,0.2))',
          border: '1px solid rgba(56,139,253,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28,
        }}>🧊</div>

        <div style={{ textAlign: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#e6edf3', marginBottom: 8, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            {t(lang, 'title')}
          </h3>
          <p style={{ margin: 0, fontSize: 14, color: '#8b949e', lineHeight: 1.6, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            {t(lang, 'desc')}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {/* Sketch button */}
          <button
            onClick={onStartSketch}
            aria-label={t(lang, 'sketch')}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '12px 16px', borderRadius: 10,
              border: '1px solid rgba(56,139,253,0.3)',
              background: 'rgba(56,139,253,0.08)', color: '#58a6ff',
              cursor: 'pointer', fontSize: 13, fontWeight: 700,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              transition: 'all 0.15s',
              minWidth: 88, minHeight: 52,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(56,139,253,0.15)'; e.currentTarget.style.borderColor = '#388bfd'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(56,139,253,0.08)'; e.currentTarget.style.borderColor = 'rgba(56,139,253,0.3)'; }}
          >
            <span style={{ fontSize: 22 }}>✏️</span>
            {t(lang, 'sketch')}
          </button>

          {/* Import button — #3: disabled + spinner when importing */}
          <button
            onClick={isImporting ? undefined : onImportFile}
            disabled={isImporting}
            aria-label={isImporting ? t(lang, 'importing') : t(lang, 'import')}
            aria-busy={isImporting}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '12px 16px', borderRadius: 10,
              border: `1px solid ${isImporting ? 'rgba(63,185,80,0.15)' : 'rgba(63,185,80,0.3)'}`,
              background: isImporting ? 'rgba(63,185,80,0.04)' : 'rgba(63,185,80,0.08)',
              color: isImporting ? '#3fb95088' : '#3fb950',
              cursor: isImporting ? 'default' : 'pointer', fontSize: 11, fontWeight: 700,
              transition: 'all 0.15s',
              minWidth: 80, minHeight: 44,
            }}
            onMouseEnter={e => { if (!isImporting) { e.currentTarget.style.background = 'rgba(63,185,80,0.15)'; e.currentTarget.style.borderColor = '#3fb950'; } }}
            onMouseLeave={e => { if (!isImporting) { e.currentTarget.style.background = 'rgba(63,185,80,0.08)'; e.currentTarget.style.borderColor = 'rgba(63,185,80,0.3)'; } }}
          >
            <span style={{ fontSize: 22 }}>
              {isImporting ? <span className="__nf_exporting" style={{ display: 'inline-block' }}>⟳</span> : '📁'}
            </span>
            {isImporting ? t(lang, 'importing') : t(lang, 'import')}
          </button>
        </div>

        {/* Quick shapes — #1: 44px tap targets, #2: aria-label */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#6e7681', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            {t(lang, 'pickShape')}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 340 }}>
            {QUICK_SHAPES.map(s => (
              <button
                key={s.id}
                type="button"
                data-testid={s.id === 'box' ? 'm4-pick-box' : undefined}
                onClick={() => onSelectShape(s.id)}
                title={t(lang, s.key)}
                aria-label={t(lang, s.key)}
                style={{
                  // #1: 44×44 minimum touch target
                  width: 44, height: 44, borderRadius: 8,
                  border: '1px solid #21262d', background: '#0d1117',
                  color: '#c9d1d9', cursor: 'pointer', fontSize: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.background = '#161b22'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#21262d'; e.currentTarget.style.background = '#0d1117'; }}
              >
                {s.icon}
              </button>
            ))}
          </div>
        </div>

        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: '#6e7681',
            textAlign: 'center',
            lineHeight: 1.5,
            maxWidth: 380,
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {t(lang, 'keyboardHints')}
        </p>

        <button
          onClick={onStartTutorial}
          aria-label={t(lang, 'tutorial')}
          style={{
            padding: '6px 14px', borderRadius: 6,
            border: '1px solid #21262d', background: 'transparent',
            color: '#6e7681', fontSize: 12, fontWeight: 600,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            transition: 'all 0.12s',
            minHeight: 36,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.borderColor = '#30363d'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#6e7681'; e.currentTarget.style.borderColor = '#21262d'; }}
        >
          💡 {t(lang, 'tutorial')}
        </button>
      </div>
    </div>
  );
}
