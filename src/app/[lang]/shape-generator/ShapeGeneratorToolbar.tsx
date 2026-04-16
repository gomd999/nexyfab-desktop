'use client';

import React from 'react';
import ShareButton from './ShareButton';
import UserMenu from '@/components/nexyfab/UserMenu';
import CollabAvatars from '@/components/nexyfab/CollabAvatars';
import StepUploaderButton from './io/StepUploaderButton';
import type { PlanLimits } from './freemium/planLimits';
import { MATERIAL_PRESETS } from './materials';
import type { CollabSession } from '@/hooks/useCollabPolling';

type TabMode = 'design' | 'optimize';

export interface ShapeGeneratorToolbarProps {
  // Theme
  theme: {
    panelBg: string;
    border: string;
    text: string;
    textMuted: string;
    cardBg: string;
    accent: string;
    accentBright: string;
  };
  mode: string;
  toggleTheme: () => void;
  // Responsive
  isMobile: boolean;
  isTablet: boolean;
  tabletLeftOpen: boolean;
  setTabletLeftOpen: (v: boolean) => void;
  // Tab
  activeTab: string;
  setActiveTab: (tab: 'design' | 'optimize') => void;
  tabLabels: { design: string; optimize: string };
  lang: string;
  langSeg: string;
  // History
  canUndo: boolean;
  canRedo: boolean;
  onHistoryUndo: () => void;
  onHistoryRedo: () => void;
  showVersionPanel: boolean;
  setShowVersionPanel: (v: boolean) => void;
  // Render mode
  renderMode: string;
  setRenderMode: (mode: 'standard' | 'photorealistic') => void;
  // COTS
  showCOTSPanel: boolean;
  setShowCOTSPanel: (v: boolean) => void;
  // AI Advisor
  effectiveResult: boolean; // has a result
  showAIAdvisor: boolean;
  setShowAIAdvisor: () => void;
  // Pin comments
  isPlacingComment: boolean;
  setIsPlacingComment: (v: (prev: boolean) => boolean) => void;
  // Dimensions
  showDimensions: boolean;
  setShowDimensions: (v: (prev: boolean) => boolean) => void;
  // Collab
  planLimits: PlanLimits;
  pollingSessions: CollabSession[];
  mySessionId: string | null;
  // Auth
  onOpenAuth: (mode?: 'login' | 'signup') => void;
  authModalMode: 'login' | 'signup';
  // Cart
  cartAdded: boolean;
  cartItemsLength: number;
  onAddToCart: () => void;
  disableCart: boolean;
  // Cost panel
  showCostPanel: boolean;
  setShowCostPanel: (v: boolean) => void;
  // RFQ
  onGetQuote: () => void;
  rfqPending: boolean;
  tGetQuote: string;
  // Share
  selectedId: string;
  params: Record<string, number>;
  materialId: string;
  shareOpenKey: number;
  // IP Share
  isCreatingShare: boolean;
  shareUrl: string | null;
  onIPShare: () => void;
  // STEP upload
  addToast: (type: 'error' | 'success' | 'warning' | 'info', msg: string) => void;
  // Simple mode
  simpleMode: boolean;
  onEnableSimpleMode: () => void;
  onDisableSimpleMode: () => void;
  // Wizard
  onOpenWizard: () => void;
  // Fullscreen
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  // DFM badge
  dfmIssueCount: number;
  dfmRunning: boolean;
  showDFM: boolean;
  onToggleDFM: () => void;
}

export default function ShapeGeneratorToolbar(props: ShapeGeneratorToolbarProps) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const {
    theme, mode, toggleTheme,
    isMobile, isTablet, tabletLeftOpen, setTabletLeftOpen,
    activeTab, setActiveTab, tabLabels, lang, langSeg,
    canUndo, canRedo, onHistoryUndo, onHistoryRedo,
    showVersionPanel, setShowVersionPanel,
    renderMode, setRenderMode,
    showCOTSPanel, setShowCOTSPanel,
    effectiveResult, showAIAdvisor, setShowAIAdvisor,
    isPlacingComment, setIsPlacingComment,
    showDimensions, setShowDimensions,
    planLimits, pollingSessions, mySessionId,
    onOpenAuth,
    cartAdded, cartItemsLength, onAddToCart, disableCart,
    showCostPanel, setShowCostPanel,
    onGetQuote, rfqPending, tGetQuote,
    selectedId, params, materialId, shareOpenKey,
    isCreatingShare, shareUrl, onIPShare,
    addToast,
    simpleMode, onEnableSimpleMode, onDisableSimpleMode,
    onOpenWizard,
    isFullscreen, onToggleFullscreen,
    dfmIssueCount, dfmRunning, showDFM, onToggleDFM,
  } = props;

  return (
    <div style={{
      background: theme.panelBg,
      borderBottom: `1px solid ${theme.border}`,
      padding: isMobile ? '0 8px' : '0 20px',
      display: 'flex', alignItems: 'center',
      gap: isMobile ? 6 : 12,
      height: 44, flexShrink: 0,
    }}>
      {/* Hamburger toggle for tablet left panel */}
      {isTablet && (
        <button onClick={() => setTabletLeftOpen(!tabletLeftOpen)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 6, border: `1px solid ${theme.border}`,
          background: tabletLeftOpen ? theme.accent : theme.cardBg,
          color: tabletLeftOpen ? '#fff' : theme.textMuted,
          fontSize: 16, cursor: 'pointer', flexShrink: 0,
        }}>☰</button>
      )}
      {/* Logo */}
      <a href={`/${langSeg}/`} style={{ color: theme.text, fontSize: 14, fontWeight: 800, letterSpacing: '-0.02em', textDecoration: 'none' }}>
        <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
      </a>
      {!isMobile && <div style={{ width: 1, height: 20, background: theme.border }} />}

      {/* Tab buttons — hidden on mobile */}
      {!isMobile && (['design', 'optimize'] as TabMode[]).map(tab => {
        const active = activeTab === tab;
        return (
          <button key={tab} onClick={() => setActiveTab(tab)}
            data-tour={tab === 'optimize' ? 'optimize-tab' : undefined}
            style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer',
              background: 'transparent', color: active ? '#fff' : '#6e7681',
              fontWeight: 700, fontSize: 13, transition: 'all 0.15s',
              borderBottom: active ? '2px solid #8b9cf4' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {tab === 'design' ? '🧊' : '🔬'} {tabLabels[tab]}
          </button>
        );
      })}

      <div style={{ flex: 1 }} />

      {/* Mobile "···" progressive-disclosure toggle */}
      {isMobile && (
        <button
          onClick={() => setShowAdvanced(v => !v)}
          style={{
            padding: '4px 10px', borderRadius: 4, border: `1px solid ${theme.border}`,
            background: showAdvanced ? theme.accent : theme.cardBg,
            color: showAdvanced ? '#fff' : theme.textMuted,
            fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
          }}
          title={lang === 'ko' ? '고급 도구' : 'More tools'}
        >
          {showAdvanced ? (lang === 'ko' ? '접기' : '✕') : '···'}
        </button>
      )}

      {/* Undo/Redo — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={onHistoryUndo} disabled={!canUndo} style={{
            padding: '4px 8px', borderRadius: 4, border: 'none',
            background: canUndo ? theme.cardBg : 'transparent',
            color: canUndo ? theme.text : theme.textMuted,
            fontSize: 14, cursor: canUndo ? 'pointer' : 'default', transition: 'all 0.15s',
          }} title="Undo (Ctrl+Z)">↩</button>
          <button onClick={onHistoryRedo} disabled={!canRedo} style={{
            padding: '4px 8px', borderRadius: 4, border: 'none',
            background: canRedo ? theme.cardBg : 'transparent',
            color: canRedo ? theme.text : theme.textMuted,
            fontSize: 14, cursor: canRedo ? 'pointer' : 'default', transition: 'all 0.15s',
          }} title="Redo (Ctrl+Shift+Z)">↪</button>
          <button onClick={() => setShowVersionPanel(!showVersionPanel)} style={{
            padding: '4px 8px', borderRadius: 4, border: 'none',
            background: showVersionPanel ? theme.accent : theme.cardBg,
            color: showVersionPanel ? '#fff' : theme.textMuted,
            fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
          }} title={lang === 'ko' ? '버전 히스토리' : 'Version History'}>🕐</button>
        </div>
      )}

      {!isMobile && <div style={{ width: 1, height: 20, background: theme.border }} />}

      {/* Render mode toggle — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <button onClick={() => setRenderMode(renderMode === 'standard' ? 'photorealistic' : 'standard')} style={{
          padding: '4px 10px', borderRadius: 4, border: 'none',
          background: renderMode === 'photorealistic' ? '#8b5cf6' : theme.cardBg,
          color: renderMode === 'photorealistic' ? '#fff' : theme.textMuted,
          fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }} title={lang === 'ko' ? '렌더링 모드' : 'Render Mode'}>
          🎬 {lang === 'ko' ? '렌더링' : 'Render'}
        </button>
      )}

      {/* STEP file import — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <StepUploaderButton
          lang={lang}
          onResult={(stats) => {
            addToast('success', lang === 'ko'
              ? `STEP 파싱 완료: ${stats.volume_cm3?.toFixed(1)}cm³`
              : `STEP parsed: ${stats.volume_cm3?.toFixed(1)}cm³`);
          }}
        />
      )}

      {/* COTS catalog button — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <button onClick={() => setShowCOTSPanel(!showCOTSPanel)} style={{
          padding: '4px 10px', borderRadius: 4, border: 'none',
          background: showCOTSPanel ? '#d29922' : theme.cardBg,
          color: showCOTSPanel ? '#fff' : theme.textMuted,
          fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }} title={lang === 'ko' ? '표준 부품 카탈로그' : 'Standard Parts (COTS)'}>
          🔩 {lang === 'ko' ? '부품' : 'COTS'}
        </button>
      )}

      {/* AI Advisor button — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && effectiveResult && (
        <button onClick={() => setShowAIAdvisor()} style={{
          padding: '4px 10px', borderRadius: 4, border: 'none',
          background: showAIAdvisor ? '#a371f7' : theme.cardBg,
          color: showAIAdvisor ? '#fff' : theme.textMuted,
          fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }} title={lang === 'ko' ? 'AI 설계 어드바이저' : 'AI Design Advisor'}>
          🤖 {lang === 'ko' ? 'AI 조언' : 'AI Advisor'}
        </button>
      )}

      {/* Pin comment toggle — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && effectiveResult && (
        <button onClick={() => setIsPlacingComment(v => !v)} style={{
          padding: '4px 10px', borderRadius: 4, border: 'none',
          background: isPlacingComment ? '#388bfd' : theme.cardBg,
          color: isPlacingComment ? '#fff' : theme.textMuted,
          fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }} title={lang === 'ko' ? '핀 코멘트 추가' : 'Add pin comment'}>
          📌 {lang === 'ko' ? '핀' : 'Pin'}
        </button>
      )}

      {/* Dimension toggle — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <button onClick={() => setShowDimensions(d => !d)} style={{
          padding: '4px 10px', borderRadius: 4, border: 'none',
          background: showDimensions ? theme.accent : theme.cardBg,
          color: showDimensions ? '#fff' : theme.textMuted,
          fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }} title="Toggle dimensions">📏</button>
      )}

      {/* 간편 모드 / 전문가 모드 토글 */}
      {!isMobile && (
        <>
          {simpleMode ? (
            <button onClick={onDisableSimpleMode} style={{
              padding: '4px 12px', borderRadius: 4,
              border: '1px solid #388bfd',
              background: '#0d1f3c', color: '#58a6ff',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 4,
            }} title="전문가 모드로 전환">
              🔬 {lang === 'ko' ? '전문가 모드' : 'Expert'}
            </button>
          ) : (
            <button onClick={onEnableSimpleMode} style={{
              padding: '4px 12px', borderRadius: 4,
              border: '1px solid #3fb950',
              background: '#0f2d17', color: '#3fb950',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 4,
            }} title="간편 모드: 불필요한 패널 숨김">
              ⚡ {lang === 'ko' ? '간편 모드' : 'Simple'}
            </button>
          )}
          <button onClick={onOpenWizard} style={{
            padding: '4px 12px', borderRadius: 4, border: 'none',
            background: 'linear-gradient(135deg, #388bfd, #a371f7)',
            color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', gap: 4,
          }} title="빠른 견적 마법사">
            🚀 {lang === 'ko' ? '빠른 견적' : 'Quick Quote'}
          </button>
        </>
      )}

      {/* DFM issue badge — always visible when geometry exists */}
      {effectiveResult && (
        <button
          onClick={onToggleDFM}
          title={lang === 'ko'
            ? (dfmIssueCount > 0 ? `DFM 이슈 ${dfmIssueCount}개` : 'DFM 분석')
            : (dfmIssueCount > 0 ? `${dfmIssueCount} DFM issue${dfmIssueCount > 1 ? 's' : ''}` : 'DFM Analysis')}
          style={{
            position: 'relative',
            padding: '4px 10px', borderRadius: 4,
            border: `1px solid ${showDFM ? '#f0883e' : dfmIssueCount > 0 ? '#f0883e55' : theme.border}`,
            background: showDFM ? 'rgba(240,136,62,0.18)' : dfmIssueCount > 0 ? 'rgba(240,136,62,0.08)' : theme.cardBg,
            color: dfmIssueCount > 0 ? '#f0883e' : theme.textMuted,
            fontSize: 11, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
          }}
        >
          {dfmRunning
            ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: '2px solid #f0883e', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            : '⚠'}
          {lang === 'ko' ? 'DFM' : 'DFM'}
          {dfmIssueCount > 0 && (
            <span style={{
              position: 'absolute', top: -5, right: -6,
              minWidth: 16, height: 16,
              background: dfmIssueCount >= 5 ? '#f85149' : '#f0883e',
              color: '#fff', borderRadius: 8,
              fontSize: 10, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 3px', lineHeight: 1,
            }}>
              {dfmIssueCount > 99 ? '99+' : dfmIssueCount}
            </span>
          )}
        </button>
      )}

      {/* Theme toggle */}
      <button onClick={toggleTheme} style={{
        padding: '4px 10px', borderRadius: 4, border: 'none',
        background: theme.cardBg, color: theme.textMuted,
        fontSize: 14, cursor: 'pointer', transition: 'all 0.15s',
      }} title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        {mode === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
      </button>

      {/* Collab avatars (polling-based, Team+ plan) */}
      {planLimits.collaboration && pollingSessions.length > 0 && (
        <CollabAvatars sessions={pollingSessions} mySessionId={mySessionId ?? ''} />
      )}

      {/* User menu */}
      <UserMenu
        onOpenAuth={(m) => onOpenAuth(m ?? 'login')}
        lang={langSeg}
      />

      {/* Quick actions */}
      <button
        onClick={onAddToCart}
        disabled={disableCart}
        title={disableCart
          ? (lang === 'ko' ? '3D 모델을 먼저 생성하세요' : 'Generate a 3D model first')
          : (lang === 'ko' ? '장바구니에 추가' : 'Add to cart')}
        style={{
          padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
          background: cartAdded ? '#16a34a' : theme.cardBg,
          color: cartAdded ? '#fff' : theme.textMuted,
          cursor: !disableCart ? 'pointer' : 'default', transition: 'all 0.15s',
          opacity: activeTab === 'design' ? 1 : 0.3,
        }}
      >
        {cartAdded ? '✓' : '🛒'} {cartItemsLength > 0 ? `(${cartItemsLength})` : ''}
      </button>
      <button
        onClick={() => setShowCostPanel(!showCostPanel)}
        disabled={!effectiveResult}
        style={{
          padding: '5px 14px', borderRadius: 6,
          border: `1px solid ${showCostPanel ? theme.accent : 'transparent'}`,
          fontSize: 12, fontWeight: 700,
          background: showCostPanel ? `${theme.accent}22` : theme.cardBg,
          color: showCostPanel ? theme.accentBright : theme.textMuted,
          cursor: effectiveResult ? 'pointer' : 'default',
          opacity: effectiveResult ? 1 : 0.4, transition: 'all 0.15s',
        }}
      >
        💰 {lang === 'ko' ? '즉시 견적' : 'Instant Quote'}
      </button>
      {/* ── DFM-based contextual CTA ── */}
      {(() => {
        const noGeo = !effectiveResult;
        const analyzing = dfmRunning;
        const hasIssues = !dfmRunning && dfmIssueCount > 0;
        const clean = !dfmRunning && dfmIssueCount === 0 && effectiveResult;

        if (noGeo) {
          return (
            <button data-tour="get-quote" disabled style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
              background: theme.cardBg, color: theme.textMuted,
              cursor: 'default', opacity: 0.4, transition: 'all 0.15s',
            }}>
              {lang === 'ko' ? '형상 필요' : 'Need shape'}
            </button>
          );
        }
        if (analyzing) {
          return (
            <button data-tour="get-quote" disabled style={{
              padding: '5px 14px', borderRadius: 6, border: '1px solid #388bfd44', fontSize: 12, fontWeight: 700,
              background: 'rgba(56,139,253,0.1)', color: '#58a6ff',
              cursor: 'default', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: '2px solid #58a6ff', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
              {lang === 'ko' ? 'DFM 분석 중' : 'Analyzing DFM'}
            </button>
          );
        }
        if (hasIssues) {
          return (
            <button
              data-tour="get-quote"
              onClick={() => void onGetQuote()}
              disabled={rfqPending}
              title={lang === 'ko'
                ? `DFM 이슈 ${dfmIssueCount}건 있음 — 견적은 가능하나 제조비 증가 가능`
                : `${dfmIssueCount} DFM issue(s) — quote possible but cost may rise`}
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                border: '1px solid #f0883e',
                background: 'rgba(240,136,62,0.15)', color: '#f0883e',
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              ⚠ {lang === 'ko' ? `견적 요청 (이슈 ${dfmIssueCount})` : `Quote (${dfmIssueCount} issue${dfmIssueCount > 1 ? 's' : ''})`}
            </button>
          );
        }
        // clean or no dfm results yet but geometry exists
        return (
          <button
            data-tour="get-quote"
            onClick={() => void onGetQuote()}
            disabled={rfqPending}
            title={clean ? (lang === 'ko' ? 'DFM 검증 완료 — 견적 요청 가능' : 'DFM passed — ready to quote') : undefined}
            style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
              background: clean ? 'linear-gradient(135deg, #238636, #2ea043)' : theme.accent,
              color: '#fff', cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 5,
              boxShadow: clean ? '0 0 8px rgba(46,160,67,0.4)' : undefined,
              animation: clean ? 'dfm-glow 2s ease-in-out infinite' : undefined,
            }}
          >
            {clean && <span>✓</span>}
            {rfqPending
              ? (lang === 'ko' ? '요청 중...' : 'Requesting...')
              : tGetQuote}
          </button>
        );
      })()}
      <style>{`
        @keyframes dfm-glow {
          0%, 100% { box-shadow: 0 0 6px rgba(46,160,67,0.3); }
          50% { box-shadow: 0 0 14px rgba(46,160,67,0.7); }
        }
      `}</style>
      <ShareButton
        shape={selectedId}
        params={params}
        material={materialId}
        color={MATERIAL_PRESETS.find(m => m.id === materialId)?.color ?? '#b0b8c8'}
        lang={langSeg}
        label={'Share'}
        autoOpenKey={shareOpenKey}
      />
      {/* IP-protected share link */}
      <button
        onClick={onIPShare}
        disabled={!effectiveResult || isCreatingShare}
        style={{
          padding: '5px 12px', borderRadius: 6,
          border: '1px solid #30363d',
          background: shareUrl ? '#1a2e1a' : 'transparent',
          color: shareUrl ? '#3fb950' : '#8b949e',
          fontSize: 11, fontWeight: 700,
          cursor: effectiveResult ? 'pointer' : 'default',
          opacity: effectiveResult ? 1 : 0.4, transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', gap: 5,
        }}
        title={lang === 'ko' ? 'IP 보호 공유 링크 생성 (다운로드 불가)' : 'Create IP-protected view-only link'}
      >
        🔒 {isCreatingShare ? '...' : (lang === 'ko' ? 'IP 공유' : 'IP Share')}
      </button>

      {/* ── Fullscreen toggle ── */}
      <div style={{ width: 1, height: 20, background: '#30363d', flexShrink: 0 }} />
      <button
        onClick={onToggleFullscreen}
        title={isFullscreen
          ? (lang === 'ko' ? '전체화면 해제 (Esc)' : 'Exit Fullscreen (Esc)')
          : (lang === 'ko' ? '전체화면 (F11)' : 'Fullscreen (F11)')}
        style={{
          padding: '5px 8px', borderRadius: 6, border: `1px solid ${isFullscreen ? '#388bfd' : '#30363d'}`,
          background: isFullscreen ? 'rgba(56,139,253,0.15)' : 'transparent',
          color: isFullscreen ? '#58a6ff' : '#8b949e',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
          transition: 'all 0.15s', flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#58a6ff'; }}
        onMouseLeave={e => {
          e.currentTarget.style.color = isFullscreen ? '#58a6ff' : '#8b949e';
          e.currentTarget.style.borderColor = isFullscreen ? '#388bfd' : '#30363d';
        }}
      >
        {isFullscreen ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
            <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        )}
        {isFullscreen ? (lang === 'ko' ? '축소' : 'Exit') : (lang === 'ko' ? '전체화면' : 'Full')}
      </button>
    </div>
  );
}
