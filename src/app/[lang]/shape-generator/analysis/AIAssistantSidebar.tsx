'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import ShapeChat from '../ShapeChat';
import type { DesignContext, OptimizeResult, ModifyResult, ChatMessage } from '../ShapeChat';
import type { ShapeResult } from '../shapes';
import type { DFMResult } from './dfmAnalysis';
import { useUIStore } from '../store/uiStore';
import { useSceneStore } from '../store/sceneStore';
import SidebarResizer from '../SidebarResizer';
import { RAIL_WIDTH } from '../hooks/useSidebarLayout';

const DimensionAdvisorPanelInner = dynamic(() => import('./DimensionAdvisorPanel'), { ssr: false });
const AIAdvisorInner = dynamic(() => import('./AIAdvisor'), { ssr: false });

const dict = {
  ko: {
    previewActive: '미리보기 활성',
    sketchMode: '스케치 모드',
    features: '피처',
    emptySubtitle: '형상을 선택하거나 설계를 요청하세요',
    emptySuggestions: '형상을 먼저 생성하면 제안을 볼 수 있습니다.',
    tabChat: '대화',
    tabAdvisor: '치수 조언',
    tabSuggestions: '제안',
    assistantTitle: 'NEXYFAB 어시스턴트',
    techPreview: '기술 미리보기',
    techPreviewBody: '부품 검색, 속성 업데이트, 반복 작업 자동화 등 AI 지원 기능이 제공됩니다.',
    askAssistant: '어시스턴트에 질문…',
  },
  en: {
    previewActive: 'Preview active',
    sketchMode: 'Sketch mode',
    features: 'features',
    emptySubtitle: 'Select a shape or describe what you need',
    emptySuggestions: 'Generate a shape first to see suggestions.',
    tabChat: 'Chat',
    tabAdvisor: 'Advisor',
    tabSuggestions: 'Suggestions',
    assistantTitle: 'NEXYFAB ASSISTANT',
    techPreview: 'Technology Preview',
    techPreviewBody: 'AI-assisted part search, property updates, and automation for repetitive design tasks.',
    askAssistant: 'Ask the assistant…',
  },
  ja: {
    previewActive: 'プレビュー表示中',
    sketchMode: 'スケッチモード',
    features: 'フィーチャ',
    emptySubtitle: '形状を選択するか、設計を指定してください',
    emptySuggestions: '形状を生成すると提案が表示されます。',
    tabChat: 'チャット',
    tabAdvisor: '寸法アドバイザー',
    tabSuggestions: '提案',
    assistantTitle: 'NEXYFAB アシスタント',
    techPreview: 'テクノロジープレビュー',
    techPreviewBody: '部品検索、プロパティ更新、反復作業の自動化などAI支援機能を提供します。',
    askAssistant: 'アシスタントに質問…',
  },
  zh: {
    previewActive: '预览启用',
    sketchMode: '草图模式',
    features: '特征',
    emptySubtitle: '请选择形状或描述所需设计',
    emptySuggestions: '请先生成形状后查看建议。',
    tabChat: '对话',
    tabAdvisor: '尺寸顾问',
    tabSuggestions: '建议',
    assistantTitle: 'NEXYFAB 助手',
    techPreview: '技术预览',
    techPreviewBody: '提供 AI 辅助的零件搜索、属性更新与重复任务自动化。',
    askAssistant: '向助手提问…',
  },
  es: {
    previewActive: 'Vista previa activa',
    sketchMode: 'Modo Boceto',
    features: 'características',
    emptySubtitle: 'Seleccione una forma o describa lo que necesita',
    emptySuggestions: 'Genera una forma primero para ver sugerencias.',
    tabChat: 'Chat',
    tabAdvisor: 'Asesor',
    tabSuggestions: 'Sugerencias',
    assistantTitle: 'ASISTENTE NEXYFAB',
    techPreview: 'Vista previa tecnológica',
    techPreviewBody: 'Funciones asistidas por IA: búsqueda de piezas, actualización de propiedades y automatización.',
    askAssistant: 'Preguntar al asistente…',
  },
  ar: {
    previewActive: 'المعاينة مفعّلة',
    sketchMode: 'وضع الرسم',
    features: 'ميزات',
    emptySubtitle: 'اختر شكلاً أو صف ما تحتاجه',
    emptySuggestions: 'أنشئ شكلاً أولاً لعرض الاقتراحات.',
    tabChat: 'محادثة',
    tabAdvisor: 'مستشار',
    tabSuggestions: 'اقتراحات',
    assistantTitle: 'مساعد NEXYFAB',
    techPreview: 'معاينة تقنية',
    techPreviewBody: 'ميزات مدعومة بالذكاء الاصطناعي: البحث عن الأجزاء وتحديث الخصائص وأتمتة المهام المتكررة.',
    askAssistant: 'اسأل المساعد…',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export type AIAssistantTab = 'chat' | 'advisor' | 'suggestions';

export interface AIAssistantSidebarProps {
  lang: string;
  /** Legacy CAD-translation dictionary (not the i18n t); re-exposed to ShapeChat. */
  t: Record<string, string>;
  theme: { border: string; panelBg: string; text: string };
  isTablet: boolean;

  // Chat tab
  designContext: DesignContext;
  activeTab: 'design' | 'optimize';
  pendingChatMsg: string | null;
  isPreviewMode: boolean;
  isSketchMode: boolean;
  effectiveResult: ShapeResult | null;
  selectedId: string | null;
  onChatApplySingle: Parameters<typeof ShapeChat>[0]['onApplySingle'];
  onChatApplyBom: Parameters<typeof ShapeChat>[0]['onApplyBom'];
  onBomPreview: Parameters<typeof ShapeChat>[0]['onBomPreview'];
  onChatApplySketch: Parameters<typeof ShapeChat>[0]['onApplySketch'];
  onChatApplyOptimize: (opt: OptimizeResult) => void;
  onChatApplyModify: (mod: ModifyResult) => void;
  onModifyAutoApplied?: (actionCount: number) => void;
  onAiPreview: Parameters<typeof ShapeChat>[0]['onPreview'];
  onCancelPreview: () => void;
  chatHistory?: ChatMessage[];
  onChatHistoryChange?: (msgs: ChatMessage[]) => void;

  // Advisor tab
  advisorShape: string;
  advisorParams: Record<string, number>;
  advisorMaterial: string;
  onApplyDimension: (param: string, value: number) => void;

  // Suggestions tab
  dfmResults?: DFMResult[] | null;
  materialId?: string;
  onTextToCAD: (shapeId: string, params: Record<string, number>) => void;

  // ── Layout (optional) ──
  layoutWidth?: number;
  collapsed?: boolean;
  overlay?: boolean;
  /** Which side this panel is on ('right' by default). */
  side?: 'left' | 'right';
  onToggleCollapse?: () => void;
  onResize?: (nextWidth: number) => void;
}

const TAB_ICONS: Record<AIAssistantTab, string> = {
  chat: '💬',
  advisor: '📐',
  suggestions: '✨',
};

const TAB_LABEL_KEYS: Record<AIAssistantTab, 'tabChat' | 'tabAdvisor' | 'tabSuggestions'> = {
  chat: 'tabChat',
  advisor: 'tabAdvisor',
  suggestions: 'tabSuggestions',
};

function AIAssistantSidebar(props: AIAssistantSidebarProps) {
  const {
    lang, t, theme, isTablet,
    designContext, activeTab, pendingChatMsg, isPreviewMode, isSketchMode,
    effectiveResult, selectedId,
    onChatApplySingle, onChatApplyBom, onBomPreview, onChatApplySketch,
    onChatApplyOptimize, onChatApplyModify, onModifyAutoApplied, onAiPreview, onCancelPreview,
    advisorShape, advisorParams, advisorMaterial, onApplyDimension,
    dfmResults, materialId, onTextToCAD,
    chatHistory, onChatHistoryChange,
    layoutWidth, collapsed = false, overlay = false, side = 'right',
    onToggleCollapse, onResize,
  } = props;

  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number | 'auto' }>({ w: layoutWidth ?? 380, h: 'auto' });
  const dragRef = React.useRef({ isDragging: false, startX: 0, startY: 0, initialPos: { x: 0, y: 0 } });
  const resizeRef = React.useRef({ isResizing: false, startX: 0, startY: 0, initialSize: { w: 0, h: 0 } });
  const containerRef = React.useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const tt = dict[langMap[seg] ?? 'en'];

  const aiAssistantTab = useUIStore(s => s.aiAssistantTab);
  const setAIAssistantTab = useUIStore(s => s.setAIAssistantTab);
  const setShowAIAssistant = useUIStore(s => s.setShowAIAssistant);
  const ribbonTheme = useSceneStore(s => s.ribbonTheme);
  const lightChrome = ribbonTheme === 'lightRibbon';

  const featuresEnabledCount = designContext.features.length;

  const subtitle = isPreviewMode ? (
    <span style={{ color: '#f59e0b' }}>{tt.previewActive}</span>
  ) : isSketchMode ? (
    <span style={{ color: '#a78bfa' }}>{tt.sketchMode}</span>
  ) : effectiveResult ? (
    <span>{(t as Record<string, string>)[`shapeName_${selectedId ?? ''}`] || selectedId} · {featuresEnabledCount} {tt.features}</span>
  ) : (
    <span>{tt.emptySubtitle}</span>
  );

  const isViewportMode = !layoutWidth;
  const effectiveWidth = isViewportMode ? '100%' : size.w;
  const borderKey = side === 'left' ? 'borderRight' : 'borderLeft';
  const chrome = {
    panel: 'rgba(13, 17, 23, 0.75)', // Glassmorphism base
    headerBg: 'transparent',
    border: 'rgba(255, 255, 255, 0.1)',
    text: '#ffffff',
    textMuted: '#8b949e',
    tabBar: 'rgba(0, 0, 0, 0.2)',
    tabActiveBg: 'rgba(255, 255, 255, 0.05)',
    tabInactive: '#8b949e',
    accent: '#58a6ff',
    previewBg: 'rgba(88, 166, 255, 0.05)',
  };

  const overlayStyle: React.CSSProperties = overlay && !isTablet
    ? {
        position: 'fixed' as const,
        top: pos ? pos.y : 56,
        left: pos ? pos.x : undefined,
        right: pos ? 'auto' : 16,
        bottom: pos && size.h !== 'auto' ? 'auto' : 56,
        height: size.h !== 'auto' ? size.h : undefined,
        zIndex: 55,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }
    : {};

  if (collapsed && !isViewportMode) {
    return (
      <div style={{
        width: RAIL_WIDTH, flexShrink: 0,
        [borderKey]: `1px solid ${chrome.border}`,
        background: chrome.panel,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px 0', gap: 6, position: 'relative',
        ...overlayStyle,
      }}>
        <button
          onClick={onToggleCollapse}
          aria-label="Expand"
          title="Expand (펼치기)"
          style={{
            width: 32, height: 32, borderRadius: 6, border: `1px solid ${theme.border}`,
            background: 'transparent', color: theme.text, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14,
          }}
        >{side === 'left' ? '▶' : '◀'}</button>
        <div style={{ fontSize: 14 }}>🤖</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-tour="ai-assistant"
      style={{
        width: effectiveWidth,
        flex: isViewportMode ? 1 : undefined,
        flexShrink: 0,
        ...(isViewportMode ? {} : { [borderKey]: `1px solid ${chrome.border}` }),
        background: isViewportMode ? 'transparent' : (overlay ? 'rgba(13, 17, 23, 0.75)' : 'rgba(13, 17, 23, 0.92)'),
        backdropFilter: isViewportMode ? 'none' : 'blur(16px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        borderRadius: overlay ? 16 : 0,
        ...(isTablet && !isViewportMode ? {
          position: 'absolute' as const,
          top: 44,
          right: 0,
          bottom: 0,
          zIndex: 50,
          boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
        } : overlayStyle),
      }}
    >
      {onResize && !isTablet && !isViewportMode && (
        <SidebarResizer
          edge={side === 'left' ? 'right' : 'left'}
          width={effectiveWidth as number}
          onResize={onResize}
        />
      )}
      {onToggleCollapse && !isTablet && !isViewportMode && (
        <button
          onClick={onToggleCollapse}
          aria-label="Collapse"
          title="Collapse (접기)"
          style={{
            position: 'absolute', top: 4,
            [side === 'left' ? 'right' : 'left']: 4,
            width: 22, height: 22, borderRadius: 4, border: 'none',
            background: 'transparent', color: '#8b949e', cursor: 'pointer',
            fontSize: 12, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >{side === 'left' ? '◀' : '▶'}</button>
      )}
      {/* Header — Premium Dark Glassmorphism */}
      <div 
        onPointerDown={e => {
          if (!overlay || isTablet) return;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const currentPos = pos || { x: rect.left, y: rect.top };
          if (!pos) setPos(currentPos);
          dragRef.current = { isDragging: true, startX: e.clientX, startY: e.clientY, initialPos: currentPos };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          if (!dragRef.current.isDragging) return;
          setPos({
            x: dragRef.current.initialPos.x + (e.clientX - dragRef.current.startX),
            y: dragRef.current.initialPos.y + (e.clientY - dragRef.current.startY)
          });
        }}
        onPointerUp={e => {
          dragRef.current.isDragging = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        style={{
        display: 'flex', alignItems: 'center', padding: '12px 16px',
        borderBottom: `1px solid ${chrome.border}`, gap: 10,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 100%)',
        cursor: overlay && !isTablet ? 'grab' : 'default',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #58a6ff 0%, #3182ce 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, boxShadow: '0 2px 8px rgba(88,166,255,0.4)',
        }}>✨</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 800,
            color: chrome.text,
            lineHeight: 1.2,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            textShadow: '0 2px 4px rgba(0,0,0,0.5)',
          }}>{tt.assistantTitle}</div>
          <div style={{ fontSize: 10, color: chrome.textMuted, fontWeight: 600, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </div>
        </div>
        <button
          onClick={() => setShowAIAssistant(false)}
          type="button"
          style={{
            border: `1px solid rgba(255,255,255,0.1)`,
            background: 'rgba(255,255,255,0.05)',
            cursor: 'pointer', fontSize: 14, color: '#8b949e',
            width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
            e.currentTarget.style.color = '#ffffff';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            e.currentTarget.style.color = '#8b949e';
          }}
        >✕</button>
      </div>

      <div style={{
        margin: '12px 16px 4px',
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(88, 166, 255, 0.08)',
        border: `1px solid rgba(88, 166, 255, 0.2)`,
        boxShadow: 'inset 0 0 20px rgba(88, 166, 255, 0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 12 }}>🚀</span>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#58a6ff', letterSpacing: '0.02em' }}>{tt.techPreview}</div>
        </div>
        <div style={{ fontSize: 11, color: '#c9d1d9', lineHeight: 1.5 }}>{tt.techPreviewBody}</div>
        <div style={{ fontSize: 10, color: '#8b949e', marginTop: 8, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>💡</span> {tt.askAssistant}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid rgba(255,255,255,0.1)`, background: 'rgba(0,0,0,0.2)', padding: '0 8px' }}>
        {(['chat', 'advisor', 'suggestions'] as AIAssistantTab[]).map(tab => {
          const isActive = aiAssistantTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setAIAssistantTab(tab)}
              style={{
                flex: 1,
                padding: '10px 8px',
                background: isActive ? 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)' : 'transparent',
                border: 'none',
                borderBottom: `2px solid ${isActive ? '#58a6ff' : 'transparent'}`,
                color: isActive ? '#ffffff' : '#8b949e',
                fontSize: 12,
                fontWeight: isActive ? 700 : 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.2s ease',
                borderTopLeftRadius: 6,
                borderTopRightRadius: 6,
                marginTop: 4,
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = '#c9d1d9'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = '#8b949e'; }}
            >
              <span>{TAB_ICONS[tab]}</span>
              <span>{tt[TAB_LABEL_KEYS[tab]]}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {aiAssistantTab === 'chat' && (
          <ShapeChat
            onApplySingle={onChatApplySingle}
            onApplyBom={onChatApplyBom}
            onBomPreview={onBomPreview}
            onApplySketch={onChatApplySketch}
            onApplyOptimize={onChatApplyOptimize}
            onApplyModify={onChatApplyModify}
            onModifyAutoApplied={onModifyAutoApplied}
            onPreview={onAiPreview}
            onCancelPreview={onCancelPreview}
            activeTab={activeTab}
            t={t}
            initialMessage={pendingChatMsg || undefined}
            designContext={designContext}
            initialMessages={chatHistory}
            onMessagesChange={onChatHistoryChange}
          />
        )}

        {aiAssistantTab === 'advisor' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <DimensionAdvisorPanelInner
              shape={advisorShape}
              params={advisorParams}
              material={advisorMaterial}
              lang={lang}
              onApplyDimension={onApplyDimension}
              onClose={() => setShowAIAssistant(false)}
            />
          </div>
        )}

        {aiAssistantTab === 'suggestions' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {effectiveResult ? (
              <AIAdvisorInner
                result={effectiveResult}
                dfmResults={dfmResults}
                materialId={materialId}
                lang={lang}
                onTextToCAD={onTextToCAD}
              />
            ) : (
              <div style={{
                background: lightChrome ? '#f6f8fa' : '#161b22',
                border: `1px solid ${chrome.border}`,
                borderRadius: 10,
                padding: '16px 20px', color: chrome.textMuted, fontSize: 12, textAlign: 'center',
              }}>
                {tt.emptySuggestions}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resize Handle for Overlay Mode */}
      {overlay && !isTablet && (
        <div
          onPointerDown={e => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            resizeRef.current = { isResizing: true, startX: e.clientX, startY: e.clientY, initialSize: { w: rect.width, h: rect.height } };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.stopPropagation();
          }}
          onPointerMove={e => {
            if (!resizeRef.current.isResizing) return;
            const dx = e.clientX - resizeRef.current.startX;
            const dy = e.clientY - resizeRef.current.startY;
            setSize({
              w: Math.max(300, resizeRef.current.initialSize.w + dx),
              h: Math.max(400, resizeRef.current.initialSize.h + dy)
            });
          }}
          onPointerUp={e => {
            resizeRef.current.isResizing = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          style={{
            position: 'absolute',
            bottom: 0, right: 0,
            width: 16, height: 16,
            cursor: 'se-resize',
            zIndex: 10,
            background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 100%)',
            borderBottomRightRadius: 16,
          }}
        />
      )}

      {/* Slide-in animation for docked mode */}
      <style>{`
        @keyframes aiPanelSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default React.memo(AIAssistantSidebar);
