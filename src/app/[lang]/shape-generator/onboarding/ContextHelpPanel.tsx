'use client';

/**
 * ContextHelpPanel — context-aware help panel.
 *
 * Shows tips for the currently active mode (sketch / feature / render / general).
 * Opened automatically on first context entry, or by pressing ? at any time.
 * Has 4 tabs (one per context) so the user can browse other sections too.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { ContextKey } from './useContextHelp';

interface ContextHelpPanelProps {
  visible: boolean;
  context: ContextKey;
  lang: string;
  onClose: () => void;
  onDismissForever: (ctx: ContextKey) => void;
  onOpenShortcuts: () => void;
}

// ─── i18n ─────────────────────────────────────────────────────────────────────

type L = Record<string, string>;

const UI: Record<string, L> = {
  ko: {
    title: '도움말',
    tabGeneral: '🏠 일반',
    tabSketch: '✏️ 스케치',
    tabFeature: '⚙️ 피처',
    tabRender: '🎥 렌더링',
    shortcuts: '⌨️ 단축키',
    gotIt: '알겠어요',
    dontShow: '다시 보지 않기',
    close: '닫기',
    hint: '? 키로 언제든 다시 열 수 있어요',
  },
  en: {
    title: 'Help',
    tabGeneral: '🏠 General',
    tabSketch: '✏️ Sketch',
    tabFeature: '⚙️ Feature',
    tabRender: '🎥 Render',
    shortcuts: '⌨️ Shortcuts',
    gotIt: 'Got it',
    dontShow: "Don't show again",
    close: 'Close',
    hint: 'Press ? anytime to reopen',
  },
  ja: {
    title: 'ヘルプ',
    tabGeneral: '🏠 一般',
    tabSketch: '✏️ スケッチ',
    tabFeature: '⚙️ フィーチャー',
    tabRender: '🎥 レンダリング',
    shortcuts: '⌨️ ショートカット',
    gotIt: 'わかりました',
    dontShow: '再表示しない',
    close: '閉じる',
    hint: '?キーでいつでも再表示',
  },
  cn: {
    title: '帮助',
    tabGeneral: '🏠 常规',
    tabSketch: '✏️ 草图',
    tabFeature: '⚙️ 特征',
    tabRender: '🎥 渲染',
    shortcuts: '⌨️ 快捷键',
    gotIt: '明白了',
    dontShow: '不再显示',
    close: '关闭',
    hint: '随时按 ? 重新打开',
  },
  es: {
    title: 'Ayuda',
    tabGeneral: '🏠 General',
    tabSketch: '✏️ Boceto',
    tabFeature: '⚙️ Operación',
    tabRender: '🎥 Render',
    shortcuts: '⌨️ Atajos',
    gotIt: 'Entendido',
    dontShow: 'No mostrar más',
    close: 'Cerrar',
    hint: 'Pulsa ? para reabrir',
  },
  ar: {
    title: 'مساعدة',
    tabGeneral: '🏠 عام',
    tabSketch: '✏️ رسم',
    tabFeature: '⚙️ ميزة',
    tabRender: '🎥 تصيير',
    shortcuts: '⌨️ اختصارات',
    gotIt: 'فهمت',
    dontShow: 'لا تعرض مجدداً',
    close: 'إغلاق',
    hint: 'اضغط ? لإعادة الفتح',
  },
};

function t(lang: string, key: string): string {
  return (UI[lang] ?? UI.en)[key] ?? (UI.en[key] ?? key);
}

// ─── Tip card content ─────────────────────────────────────────────────────────

interface TipCard { icon: string; heading: string; lines: string[]; color: string; }
interface ContextContent { title: string; subtitle: string; cards: TipCard[]; }
type ContentMap = Record<ContextKey, ContextContent>;

function getContent(lang: string): ContentMap {
  const ko = lang === 'ko';
  const ja = lang === 'ja';
  const cn = lang === 'cn';
  const es = lang === 'es';

  const s = (koStr: string, enStr: string, jaStr?: string, cnStr?: string, esStr?: string) =>
    ko ? koStr : ja ? (jaStr ?? enStr) : cn ? (cnStr ?? enStr) : es ? (esStr ?? enStr) : enStr;

  return {
    general: {
      title: s('NexyFab 시작하기', 'Getting Started'),
      subtitle: s('기본 워크플로우', 'Basic workflow'),
      cards: [
        {
          icon: '🧊', color: '#58a6ff',
          heading: s('① 형상 선택', '① Pick a Shape'),
          lines: [
            s('왼쪽 패널에서 기본 형상 선택', 'Choose a base shape from the left panel'),
            s('스케치로 직접 그리거나 파일 불러오기', 'Or sketch from scratch / import a file'),
            s('S = 스케치 모드  T = 이동  R = 회전', 'S = Sketch  T = Translate  R = Rotate'),
          ],
        },
        {
          icon: '⚙️', color: '#3fb950',
          heading: s('② 피처 적용', '② Apply Features'),
          lines: [
            s('상단 Command Toolbar에서 피처 선택', 'Pick a feature from the Command Toolbar'),
            s('스케치 → 돌출, 절삭, 쉘, 필렛…', 'Sketch → Extrude, Cut, Shell, Fillet…'),
            s('피처 트리에서 순서 변경·수정 가능', 'Reorder or edit features in the Feature Tree'),
          ],
        },
        {
          icon: '📦', color: '#f0883e',
          heading: s('③ 견적 요청', '③ Get a Quote'),
          lines: [
            s('재료 선택 → Get Quote 버튼 클릭', 'Select material → click "Get Quote"'),
            s('DFM 분석으로 제조 가능성 확인', 'DFM analysis checks manufacturability'),
            s('? = 이 도움말  Ctrl+S = 저장', '? = help  Ctrl+S = save  Ctrl+Z = undo'),
          ],
        },
      ],
    },

    sketch: {
      title: s('스케치 모드', 'Sketch Mode'),
      subtitle: s('2D 프로파일 → 3D 솔리드', '2D Profile → 3D Solid'),
      cards: [
        {
          icon: '🖊', color: '#388bfd',
          heading: s('① 도구 선택', '① Pick a Tool'),
          lines: [
            'L=Line  A=Arc  C=Circle  R=Rect',
            'P=Poly  E=Ellipse  U=Slot  B=Spline',
            'F=Fillet  K=Mirror  X=Trim  V=Select',
          ],
        },
        {
          icon: '📐', color: '#3fb950',
          heading: s('② 그리고 닫기', '② Draw & Close'),
          lines: [
            s('캔버스 클릭 → 점 추가', 'Click canvas to add points'),
            s('시작점 재클릭 → 프로파일 닫힘', 'Click first point again to close profile'),
            s('그리드 5mm · Shift = 각도 고정', 'Grid 5mm · Shift = lock angle'),
          ],
        },
        {
          icon: '⬆️', color: '#f0883e',
          heading: s('③ 3D 돌출', '③ Extrude to 3D'),
          lines: [
            s('닫힌 프로파일 → 하단 돌출 버튼 출현', 'Closed profile → Extrude button appears'),
            s('깊이·방향·연산(추가/절삭) 설정', 'Set depth, direction, add/subtract'),
            s('Esc = 스케치 종료  Ctrl+Z = 실행 취소', 'Esc = exit sketch  Ctrl+Z = undo'),
          ],
        },
      ],
    },

    feature: {
      title: s('피처 도구', 'Feature Tools'),
      subtitle: s('형상에 3D 조작 적용', 'Apply 3D operations to geometry'),
      cards: [
        {
          icon: '✏️', color: '#388bfd',
          heading: s('① 스케치 먼저', '① Sketch First'),
          lines: [
            s('S 키 → 스케치 모드 진입', 'Press S to enter Sketch Mode'),
            s('닫힌 프로파일 그리기 → 피처 적용', 'Draw a closed profile → apply feature'),
            s('돌출, 절삭, 회전, 쉘 등 선택', 'Choose Extrude, Cut, Revolve, Shell…'),
          ],
        },
        {
          icon: '⚙️', color: '#3fb950',
          heading: s('② 파라미터 조정', '② Adjust Parameters'),
          lines: [
            s('왼쪽 패널에서 깊이·각도·두께 설정', 'Set depth, angle, thickness in left panel'),
            s('연산 방식: 추가 / 절삭 / 교집합', 'Operation: Add / Subtract / Intersect'),
            s('3D 뷰포트에서 실시간 프리뷰', 'Real-time preview in 3D viewport'),
          ],
        },
        {
          icon: '🌳', color: '#d2a8ff',
          heading: s('③ 피처 트리', '③ Feature Tree'),
          lines: [
            s('왼쪽 패널 → 피처 순서 드래그', 'Left panel → drag to reorder features'),
            s('아이콘 클릭 → 해당 피처 수정', 'Click icon to edit any past feature'),
            s('Ctrl+Z = 피처 실행 취소', 'Ctrl+Z = undo last feature'),
          ],
        },
      ],
    },

    render: {
      title: s('렌더링 / 미리보기', 'Rendering / Preview'),
      subtitle: s('실시간 3D 렌더링', 'Real-time 3D rendering'),
      cards: [
        {
          icon: '🎨', color: '#f0883e',
          heading: s('① 재료 & 조명', '① Material & Lighting'),
          lines: [
            s('왼쪽 패널에서 재료 선택', 'Select material from left panel'),
            s('Albedo / Roughness / Metalness 조정', 'Adjust Albedo / Roughness / Metalness'),
            s('환경맵이 조명에 영향', 'Environment map affects lighting'),
          ],
        },
        {
          icon: '📷', color: '#58a6ff',
          heading: s('② 뷰포트 조작', '② Viewport Controls'),
          lines: [
            s('마우스 드래그 = 궤도  휠 = 줌', 'Drag = orbit  Scroll = zoom'),
            s('F = 카메라 피트  0 = 등각뷰', 'F = fit camera  0 = isometric'),
            s('7 = 상단  5 = 정면  6 = 우측', '7 = top  5 = front  6 = right'),
          ],
        },
        {
          icon: '📤', color: '#3fb950',
          heading: s('③ 내보내기', '③ Export'),
          lines: [
            s('STL / STEP / OBJ / GLTF 지원', 'STL / STEP / OBJ / GLTF supported'),
            s('스크린샷 공유: 툴바 카메라 버튼', 'Screenshot: toolbar camera button'),
            s('Ctrl+S = 프로젝트 저장 (.nfab)', 'Ctrl+S = save project (.nfab)'),
          ],
        },
      ],
    },
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const TABS: ContextKey[] = ['general', 'sketch', 'feature', 'render'];

export default function ContextHelpPanel({
  visible, context, lang, onClose, onDismissForever, onOpenShortcuts,
}: ContextHelpPanelProps) {
  const [activeTab, setActiveTab] = useState<ContextKey>(context);
  const [exiting, setExiting] = useState(false);
  const content = getContent(lang);

  // When context changes externally, switch to that tab
  useEffect(() => {
    if (visible) setActiveTab(context);
  }, [context, visible]);

  // Keyboard: Esc closes
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    setExiting(true);
    setTimeout(() => { setExiting(false); onClose(); }, 200);
  }, [onClose]);

  if (!visible) return null;

  const tabLabel = (k: ContextKey) => t(lang, `tab${k.charAt(0).toUpperCase() + k.slice(1)}`);
  const current = content[activeTab];

  return (
    <div
      onClick={e => { if (e.currentTarget === e.target) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
        opacity: exiting ? 0 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#161b22', border: '1px solid #30363d',
          borderRadius: 16, width: 560, maxWidth: '95vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          transform: exiting ? 'scale(0.97) translateY(6px)' : 'scale(1) translateY(0)',
          transition: 'transform 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px 0',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#e6edf3', letterSpacing: -0.3 }}>
              {current.title}
            </div>
            <div style={{ fontSize: 11, color: '#6e7681', marginTop: 1 }}>
              {current.subtitle}
            </div>
          </div>
          <button onClick={close} style={{
            background: 'none', border: 'none', color: '#484f58', cursor: 'pointer',
            fontSize: 20, lineHeight: 1, padding: '2px 6px', borderRadius: 4,
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.background = '#21262d'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#484f58'; e.currentTarget.style.background = 'none'; }}
          >×</button>
        </div>

        {/* ── Context tabs ── */}
        <div style={{
          display: 'flex', gap: 2, padding: '10px 18px 0',
          borderBottom: '1px solid #21262d', marginBottom: 0,
        }}>
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '6px 12px', borderRadius: '6px 6px 0 0',
                border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: activeTab === tab ? '#21262d' : 'transparent',
                color: activeTab === tab ? '#c9d1d9' : '#484f58',
                borderBottom: activeTab === tab ? '2px solid #388bfd' : '2px solid transparent',
                transition: 'all 0.15s',
                position: 'relative', bottom: -1,
              }}
              onMouseEnter={e => { if (activeTab !== tab) e.currentTarget.style.color = '#8b949e'; }}
              onMouseLeave={e => { if (activeTab !== tab) e.currentTarget.style.color = '#484f58'; }}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>

        {/* ── Tip cards ── */}
        <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {current.cards.map((card, i) => (
            <div key={i} style={{
              background: '#0d1117', borderRadius: 10,
              border: `1px solid ${card.color}22`,
              borderTop: `2px solid ${card.color}`,
              padding: '11px 13px',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 800, color: card.color, marginBottom: 7,
              }}>
                <span>{card.icon}</span> {card.heading}
              </div>
              {card.lines.map((line, li) => (
                <div key={li} style={{
                  fontSize: 10.5, color: '#8b949e', lineHeight: 1.65,
                  fontFamily: 'ui-monospace, monospace',
                }}>
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 18px 14px',
        }}>
          <span style={{ fontSize: 10, color: '#484f58' }}>
            {t(lang, 'hint')}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={onOpenShortcuts} style={footerBtn('#8b949e')}>
              {t(lang, 'shortcuts')}
            </button>
            <button onClick={() => onDismissForever(activeTab)} style={footerBtn('#484f58')}>
              {t(lang, 'dontShow')}
            </button>
            <button onClick={close} style={primaryBtn}>
              {t(lang, 'gotIt')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function footerBtn(color: string): React.CSSProperties {
  return {
    padding: '5px 11px', borderRadius: 6,
    border: `1px solid ${color}40`, background: 'transparent',
    color, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  };
}

const primaryBtn: React.CSSProperties = {
  padding: '5px 16px', borderRadius: 6,
  border: 'none', background: '#388bfd',
  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
