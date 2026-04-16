'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import ShapeChat from '../ShapeChat';
import type { DesignContext, OptimizeResult, ModifyResult, ChatMessage } from '../ShapeChat';
import type { ShapeResult } from '../shapes';
import type { DFMResult } from './dfmAnalysis';
import { useUIStore } from '../store/uiStore';

const DimensionAdvisorPanelInner = dynamic(() => import('./DimensionAdvisorPanel'), { ssr: false });
const AIAdvisorInner = dynamic(() => import('./AIAdvisor'), { ssr: false });

export type AIAssistantTab = 'chat' | 'advisor' | 'suggestions';

export interface AIAssistantSidebarProps {
  lang: string;
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
}

const TAB_LABELS: Record<AIAssistantTab, { ko: string; en: string; icon: string }> = {
  chat: { ko: '대화', en: 'Chat', icon: '💬' },
  advisor: { ko: '치수 조언', en: 'Advisor', icon: '📐' },
  suggestions: { ko: '제안', en: 'Suggestions', icon: '✨' },
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
  } = props;

  const aiAssistantTab = useUIStore(s => s.aiAssistantTab);
  const setAIAssistantTab = useUIStore(s => s.setAIAssistantTab);
  const setShowAIAssistant = useUIStore(s => s.setShowAIAssistant);
  const isKo = lang === 'ko';

  const featuresEnabledCount = designContext.features.length;

  const subtitle = isPreviewMode ? (
    <span style={{ color: '#f59e0b' }}>Preview active</span>
  ) : isSketchMode ? (
    <span style={{ color: '#a78bfa' }}>Sketch mode</span>
  ) : effectiveResult ? (
    <span>{(t as Record<string, string>)[`shapeName_${selectedId ?? ''}`] || selectedId} · {featuresEnabledCount} {isKo ? '피처' : 'features'}</span>
  ) : (
    <span>{isKo ? '형상을 선택하거나 설계를 요청하세요' : 'Select a shape or describe what you need'}</span>
  );

  return (
    <div
      data-tour="ai-assistant"
      style={{
        width: isTablet ? 320 : 380,
        flexShrink: 0,
        borderLeft: `1px solid ${theme.border}`,
        background: theme.panelBg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...(isTablet ? {
          position: 'absolute' as const,
          top: 44,
          right: 0,
          bottom: 0,
          zIndex: 50,
          boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
        } : {}),
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${theme.border}`, gap: 8 }}>
        <span style={{ fontSize: 14 }}>🤖</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: theme.text, lineHeight: 1.2 }}>AI Design Assistant</div>
          <div style={{ fontSize: 9, color: '#484f58', fontWeight: 600, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </div>
        </div>
        <button
          onClick={() => setShowAIAssistant(false)}
          style={{
            border: 'none', background: '#21262d', cursor: 'pointer', fontSize: 12, color: '#8b949e',
            width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = '#c9d1d9'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = '#8b949e'; }}
        >✕</button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, background: '#0d1117' }}>
        {(['chat', 'advisor', 'suggestions'] as AIAssistantTab[]).map(tab => {
          const isActive = aiAssistantTab === tab;
          const label = TAB_LABELS[tab];
          return (
            <button
              key={tab}
              onClick={() => setAIAssistantTab(tab)}
              style={{
                flex: 1,
                padding: '8px 6px',
                background: isActive ? '#161b22' : 'transparent',
                border: 'none',
                borderBottom: `2px solid ${isActive ? '#58a6ff' : 'transparent'}`,
                color: isActive ? '#e6edf3' : '#8b949e',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                transition: 'all 0.12s',
              }}
            >
              <span>{label.icon}</span>
              <span>{isKo ? label.ko : label.en}</span>
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
                background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
                padding: '16px 20px', color: '#8b949e', fontSize: 12, textAlign: 'center',
              }}>
                {isKo ? '형상을 먼저 생성하면 제안을 볼 수 있습니다.' : 'Generate a shape first to see suggestions.'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(AIAssistantSidebar);
