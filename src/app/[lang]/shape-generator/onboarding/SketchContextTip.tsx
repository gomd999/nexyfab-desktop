'use client';

/**
 * SketchContextTip — first-use contextual guide for sketch mode.
 * Shows once when the user enters sketch mode, then is permanently dismissed.
 * Auto-hides after 20 seconds.
 */

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

const langMap: Record<string, string> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'cn', zh: 'cn', es: 'es', ar: 'ar',
};

const LS_KEY = 'nexyfab_sketch_tip_v1';

interface SketchContextTipProps {
  visible: boolean; // = isSketchMode
  lang: string;
  /** When true (e.g. session recovery banner), suppress sketch tip to avoid stacked chrome. */
  recoveryVisible?: boolean;
}

const L: Record<string, {
  closeAria: string;
  title: string;
  s1h: string; s1b: string[];
  s2h: string; s2b: string[];
  s3h: string; s3b: string[];
  got: string; again: string;
  prev: string;
  next: string;
}> = {
  ko: {
    closeAria: '닫기',
    title: '✏️ 스케치 모드 — 시작 가이드',
    s1h: '① 도구 선택', s1b: ['L=선  A=호  C=원  R=사각형', 'P=다각형  E=타원  U=슬롯', 'V=선택  N=치수  Esc=취소'],
    s2h: '② 그리고 닫기', s2b: ['캔버스를 클릭해서 점을 추가하세요', '시작점을 다시 클릭하면 프로파일이 닫힙니다', '그리드 스냅 5mm · Shift=각도 고정'],
    s3h: '③ 3D 돌출', s3b: ['프로파일이 닫히면 하단에', '"돌출" 버튼이 나타납니다', 'S = 스케치 모드 토글  ? = 단축키'],
    got: '알겠어요',
    again: '다시 보지 않기',
    prev: '이전',
    next: '다음',
  },
  en: {
    closeAria: 'Close',
    title: '✏️ Sketch Mode — Quick Guide',
    s1h: '① Pick a Tool', s1b: ['L=Line  A=Arc  C=Circle  R=Rect', 'P=Polygon  E=Ellipse  U=Slot', 'V=Select  N=Dim  Esc=Cancel'],
    s2h: '② Draw & Close', s2b: ['Click canvas to place points', 'Click the first point to close the profile', 'Grid snap 5mm · Shift=lock angle'],
    s3h: '③ Extrude to 3D', s3b: ['Once the profile is closed,', 'an "Extrude" button appears below.', 'S = toggle sketch  ? = shortcuts'],
    got: 'Got it',
    again: "Don't show again",
    prev: 'Back',
    next: 'Next',
  },
  ja: {
    closeAria: '閉じる',
    title: '✏️ スケッチモード — クイックガイド',
    s1h: '① ツール選択', s1b: ['L=線  A=弧  C=円  R=矩形', 'P=多角形  E=楕円  U=スロット', 'V=選択  N=寸法  Esc=キャンセル'],
    s2h: '② 描いて閉じる', s2b: ['クリックして点を追加', '最初の点をクリックで閉合', 'グリッドスナップ5mm · Shift=角度固定'],
    s3h: '③ 3D押し出し', s3b: ['プロファイルを閉じると', '「押し出し」ボタンが表示されます', 'S=スケッチ切替  ?=ショートカット'],
    got: 'わかりました',
    again: '再表示しない',
    prev: '戻る',
    next: '次へ',
  },
  cn: {
    closeAria: '关闭',
    title: '✏️ 草图模式 — 快速指南',
    s1h: '① 选择工具', s1b: ['L=线  A=弧  C=圆  R=矩形', 'P=多边形  E=椭圆  U=槽', 'V=选择  N=尺寸  Esc=取消'],
    s2h: '② 绘制并闭合', s2b: ['点击画布添加点', '点击起始点闭合轮廓', '网格捕捉5mm · Shift=锁定角度'],
    s3h: '③ 拉伸为3D', s3b: ['轮廓闭合后，', '底部会出现"拉伸"按钮', 'S=切换草图  ?=快捷键'],
    got: '明白了',
    again: '不再显示',
    prev: '上一步',
    next: '下一步',
  },
  es: {
    closeAria: 'Cerrar',
    title: '✏️ Modo Boceto — Guía Rápida',
    s1h: '① Elige Herramienta', s1b: ['L=Línea  A=Arco  C=Círculo  R=Rect', 'P=Polígono  E=Elipse  U=Ranura', 'V=Selec  N=Cota  Esc=Cancelar'],
    s2h: '② Dibuja y Cierra', s2b: ['Clic para añadir puntos', 'Clic en el primer punto para cerrar', 'Rejilla 5mm · Shift=bloquear ángulo'],
    s3h: '③ Extruir a 3D', s3b: ['Al cerrar el perfil,', 'aparece el botón "Extruir".', 'S=boceto  ?=atajos'],
    got: 'Entendido',
    again: 'No mostrar más',
    prev: 'Atrás',
    next: 'Siguiente',
  },
  ar: {
    closeAria: 'إغلاق',
    title: '✏️ وضع الرسم — دليل سريع',
    s1h: '① اختر أداة', s1b: ['L=خط  A=قوس  C=دائرة  R=مستطيل', 'P=مضلع  E=قطع ناقص  U=فتحة', 'V=تحديد  N=بعد  Esc=إلغاء'],
    s2h: '② ارسم وأغلق', s2b: ['انقر لإضافة نقاط', 'انقر النقطة الأولى للإغلاق', 'شبكة 5mm · Shift=تثبيت زاوية'],
    s3h: '③ بثق إلى 3D', s3b: ['بعد إغلاق الملف الشخصي،', 'يظهر زر "بثق" في الأسفل.', 'S=تبديل الرسم  ?=اختصارات'],
    got: 'فهمت',
    again: 'لا تعرض مجدداً',
    prev: 'السابق',
    next: 'التالي',
  },
};

export default function SketchContextTip({ visible, lang, recoveryVisible = false }: SketchContextTipProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const resolvedLang = langMap[seg] ?? langMap[lang] ?? 'en';
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = L[resolvedLang] ?? L.en;

  // Show once per browser session (localStorage flag for "don't show again")
  useEffect(() => {
    if (!visible || recoveryVisible) {
      setShown(false);
      setExiting(false);
      setStepIdx(0);
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    try {
      if (localStorage.getItem(LS_KEY)) return; // permanently dismissed
    } catch {}
    // Delay so empty-state canvas copy is readable before the guide appears (reduces stacked onboarding).
    const t = setTimeout(() => { setStepIdx(0); setShown(true); }, 2400);
    return () => clearTimeout(t);
  }, [visible, recoveryVisible]);

  // Auto-dismiss after 20 seconds
  useEffect(() => {
    if (!shown) return;
    timerRef.current = setTimeout(() => dismiss(false), 20000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [shown]);  

  function dismiss(permanent: boolean) {
    setExiting(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (permanent) {
      try { localStorage.setItem(LS_KEY, '1'); } catch {}
    }
    setTimeout(() => { setShown(false); setExiting(false); }, 280);
  }

  if (!shown) return null;

  const cards = [
    { heading: copy.s1h, lines: copy.s1b, icon: '🖊', color: '#388bfd' },
    { heading: copy.s2h, lines: copy.s2b, icon: '📐', color: '#3fb950' },
    { heading: copy.s3h, lines: copy.s3b, icon: '⬆️', color: '#f0883e' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nexyfab-sketch-tip-title"
      style={{
        position: 'absolute', bottom: 56, left: '50%',
        transform: exiting ? 'translateX(-50%) translateY(12px)' : 'translateX(-50%) translateY(0)',
        opacity: exiting ? 0 : 1,
        transition: 'opacity 0.28s ease, transform 0.28s ease',
        zIndex: 300,
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 12,
        padding: '10px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        minWidth: 'min(300px, 94vw)', maxWidth: '94vw',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        // entrance animation via CSS
        animation: 'sct-slide-up 0.32s cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span id="nexyfab-sketch-tip-title" style={{ fontSize: 12, fontWeight: 800, color: '#e6edf3', letterSpacing: -0.2 }}>
          {copy.title}
        </span>
        <button
          type="button"
          onClick={() => dismiss(false)}
          style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#8b949e'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#484f58'; }}
          title={copy.closeAria}
          aria-label={copy.closeAria}
        >×</button>
      </div>

      {/* One step at a time (coach-style) */}
      {(() => {
        const card = cards[stepIdx];
        return (
          <div style={{
            background: '#0d1117', border: `1px solid ${card.color}30`,
            borderRadius: 8, padding: '10px 12px',
            borderTop: `2px solid ${card.color}`,
            marginBottom: 10,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: card.color, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>{card.icon}</span> {card.heading}
              </span>
              <span style={{ fontSize: 10, color: '#484f58', fontWeight: 700 }}>{stepIdx + 1} / 3</span>
            </div>
            {card.lines.map((line, i) => (
              <div key={i} style={{ fontSize: 10.5, color: '#8b949e', lineHeight: 1.6, fontFamily: 'ui-monospace, monospace' }}>
                {line}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Footer: step nav + dismiss */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx(s => Math.max(0, s - 1))}
            style={{
              padding: '4px 10px', borderRadius: 5,
              border: '1px solid #30363d', background: stepIdx === 0 ? '#161b22' : '#21262d',
              color: stepIdx === 0 ? '#484f58' : '#c9d1d9', fontSize: 10, fontWeight: 700, cursor: stepIdx === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {copy.prev}
          </button>
          {stepIdx < 2 ? (
            <button
              type="button"
              onClick={() => setStepIdx(s => Math.min(2, s + 1))}
              style={{
                padding: '4px 12px', borderRadius: 5,
                border: 'none', background: '#388bfd',
                color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {copy.next}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => dismiss(false)}
              style={{
                padding: '4px 14px', borderRadius: 5,
                border: 'none', background: '#388bfd',
                color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {copy.got}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => dismiss(true)}
            style={{
              padding: '4px 10px', borderRadius: 5,
              border: '1px solid #21262d', background: 'transparent',
              color: '#484f58', fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.borderColor = '#30363d'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#484f58'; e.currentTarget.style.borderColor = '#21262d'; }}
          >
            {copy.again}
          </button>
        </div>
      </div>
    </div>
  );
}
