'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import ShareButton from './ShareButton';
import UserMenu from '@/components/nexyfab/UserMenu';
import CollabAvatars from '@/components/nexyfab/CollabAvatars';
import StepUploaderButton from './io/StepUploaderButton';
import type { PlanLimits } from './freemium/planLimits';
import { dfmAnalysisAllowed } from './freemium/freeDfmAllowance';
import { useAuthStore } from '@/hooks/useAuth';
import { MATERIAL_PRESETS } from './materials';
import type { CollabSession } from '@/hooks/useCollabPolling';

type TabMode = 'design' | 'optimize';

/* ─── i18n ───────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    commandPaletteTitle: '명령 팔레트 (Ctrl+K)',
    toggleDimensionsTitle: '모델 치수 표시 전환',
    searchCommand: '명령 검색',
    moreTools: '고급 도구',
    collapse: '접기',
    versionHistory: '버전 히스토리',
    renderMode: '렌더링 모드',
    render: '렌더링',
    stepParsed: (v: string) => `STEP 파싱 완료: ${v}cm³`,
    standardPartsCatalog: '표준 부품 카탈로그',
    cots: '부품',
    aiAdvisorProLocked: '🔒 Pro 전용 — AI 설계 어드바이저 (무제한)',
    aiAdvisor: 'AI 설계 어드바이저',
    aiAdviceBtn: 'AI 조언',
    pinCommentsPanel: '핀 코멘트 패널',
    pin: '핀',
    switchToExpert: '전문가 모드로 전환',
    expert: '전문가 모드',
    simpleHint: '간편 모드: 불필요한 패널 숨김',
    simple: '간편 모드',
    quickQuoteHint: '빠른 견적 마법사',
    quickQuote: '빠른 견적',
    dfmProLocked: '🔒 Pro 전용 — DFM 제조 가능성 분석',
    dfmIssuesCount: (n: number) => `DFM 이슈 ${n}개`,
    dfmAnalysis: 'DFM 분석',
    dfm: 'DFM',
    needShapeFirst: '3D 모델을 먼저 생성하세요',
    addToCart: '장바구니에 추가',
    instantQuote: '즉시 견적',
    needShape: '형상 필요',
    analyzingDFM: 'DFM 분석 중',
    dfmIssuesTooltip: (n: number) => `DFM 이슈 ${n}건 있음 — 견적은 가능하나 제조비 증가 가능`,
    quoteWithIssues: (n: number) => `견적 요청 (이슈 ${n})`,
    dfmPassed: 'DFM 검증 완료 — 견적 요청 가능',
    requesting: '요청 중...',
    ipProLocked: '🔒 Pro 전용 — IP 보호 공유 링크',
    ipShareHint: 'IP 보호 공유 링크 생성 (다운로드 불가)',
    ipShare: 'IP 공유',
    exitFullscreen: '전체화면 해제 (Esc)',
    fullscreen: '전체화면 (F11)',
    shrink: '축소',
    full: '전체화면',
    collabDemo: '협업 데모',
    collabDemoOn: '협업 ON',
    collabDemoTitleOff: '데모: 원격 커서를 캔버스에 표시합니다',
    collabDemoTitleOn: '데모 켜짐 — 다시 누르면 끕니다',
  },
  en: {
    commandPaletteTitle: 'Command palette (Ctrl+K)',
    toggleDimensionsTitle: 'Toggle dimension display',
    searchCommand: 'Search',
    moreTools: 'More tools',
    collapse: '✕',
    versionHistory: 'Version History',
    renderMode: 'Render Mode',
    render: 'Render',
    stepParsed: (v: string) => `STEP parsed: ${v}cm³`,
    standardPartsCatalog: 'Standard Parts (COTS)',
    cots: 'COTS',
    aiAdvisorProLocked: '🔒 Pro only — AI Design Advisor',
    aiAdvisor: 'AI Design Advisor',
    aiAdviceBtn: 'AI Advisor',
    pinCommentsPanel: 'Pin comments',
    pin: 'Pin',
    switchToExpert: 'Switch to Expert mode',
    expert: 'Expert',
    simpleHint: 'Simple mode: hide unnecessary panels',
    simple: 'Simple',
    quickQuoteHint: 'Quick quote wizard',
    quickQuote: 'Quick Quote',
    dfmProLocked: '🔒 Pro only — DFM manufacturability analysis',
    dfmIssuesCount: (n: number) => `${n} DFM issue${n > 1 ? 's' : ''}`,
    dfmAnalysis: 'DFM Analysis',
    dfm: 'DFM',
    needShapeFirst: 'Generate a 3D model first',
    addToCart: 'Add to cart',
    instantQuote: 'Instant Quote',
    needShape: 'Need shape',
    analyzingDFM: 'Analyzing DFM',
    dfmIssuesTooltip: (n: number) => `${n} DFM issue(s) — quote possible but cost may rise`,
    quoteWithIssues: (n: number) => `Quote (${n} issue${n > 1 ? 's' : ''})`,
    dfmPassed: 'DFM passed — ready to quote',
    requesting: 'Requesting...',
    ipProLocked: '🔒 Pro only — IP-protected share links',
    ipShareHint: 'Create IP-protected view-only link',
    ipShare: 'IP Share',
    exitFullscreen: 'Exit Fullscreen (Esc)',
    fullscreen: 'Fullscreen (F11)',
    shrink: 'Exit',
    full: 'Full',
    collabDemo: 'Collab demo',
    collabDemoOn: 'Collab on',
    collabDemoTitleOff: 'Demo: show remote cursors on the canvas',
    collabDemoTitleOn: 'Demo on — click again to turn off',
  },
  ja: {
    commandPaletteTitle: 'コマンドパレット (Ctrl+K)',
    toggleDimensionsTitle: '寸法表示のオン/オフ',
    searchCommand: '検索',
    moreTools: 'その他のツール',
    collapse: '閉じる',
    versionHistory: 'バージョン履歴',
    renderMode: 'レンダリングモード',
    render: 'レンダリング',
    stepParsed: (v: string) => `STEP解析完了: ${v}cm³`,
    standardPartsCatalog: '標準部品カタログ',
    cots: '部品',
    aiAdvisorProLocked: '🔒 Pro専用 — AI設計アドバイザー',
    aiAdvisor: 'AI設計アドバイザー',
    aiAdviceBtn: 'AIアドバイザー',
    pinCommentsPanel: 'ピンコメント',
    pin: 'ピン',
    switchToExpert: 'エキスパートモードに切替',
    expert: 'エキスパート',
    simpleHint: 'シンプルモード: 不要なパネルを非表示',
    simple: 'シンプル',
    quickQuoteHint: 'クイック見積ウィザード',
    quickQuote: 'クイック見積',
    dfmProLocked: '🔒 Pro専用 — DFM製造可能性分析',
    dfmIssuesCount: (n: number) => `DFMの問題 ${n}件`,
    dfmAnalysis: 'DFM分析',
    dfm: 'DFM',
    needShapeFirst: '先に3Dモデルを生成してください',
    addToCart: 'カートに追加',
    instantQuote: '即時見積',
    needShape: '形状が必要',
    analyzingDFM: 'DFM分析中',
    dfmIssuesTooltip: (n: number) => `DFMの問題 ${n}件 — 見積は可能、ただしコスト増加の可能性`,
    quoteWithIssues: (n: number) => `見積依頼 (問題 ${n})`,
    dfmPassed: 'DFM検証完了 — 見積依頼可能',
    requesting: '依頼中...',
    ipProLocked: '🔒 Pro専用 — IP保護共有リンク',
    ipShareHint: 'IP保護共有リンクを作成 (ダウンロード不可)',
    ipShare: 'IP共有',
    exitFullscreen: '全画面解除 (Esc)',
    fullscreen: '全画面 (F11)',
    shrink: '縮小',
    full: '全画面',
    collabDemo: 'コラボデモ',
    collabDemoOn: 'コラボON',
    collabDemoTitleOff: 'デモ: リモートカーソルを表示',
    collabDemoTitleOn: 'デモ中 — クリックでオフ',
  },
  zh: {
    commandPaletteTitle: '命令面板 (Ctrl+K)',
    toggleDimensionsTitle: '切换尺寸显示',
    searchCommand: '搜索',
    moreTools: '更多工具',
    collapse: '收起',
    versionHistory: '版本历史',
    renderMode: '渲染模式',
    render: '渲染',
    stepParsed: (v: string) => `STEP解析完成: ${v}cm³`,
    standardPartsCatalog: '标准部件目录',
    cots: '部件',
    aiAdvisorProLocked: '🔒 仅Pro — AI设计顾问',
    aiAdvisor: 'AI设计顾问',
    aiAdviceBtn: 'AI顾问',
    pinCommentsPanel: '标记评论面板',
    pin: '标记',
    switchToExpert: '切换到专家模式',
    expert: '专家',
    simpleHint: '简易模式: 隐藏不必要的面板',
    simple: '简易',
    quickQuoteHint: '快速报价向导',
    quickQuote: '快速报价',
    dfmProLocked: '🔒 仅Pro — DFM可制造性分析',
    dfmIssuesCount: (n: number) => `${n}个DFM问题`,
    dfmAnalysis: 'DFM分析',
    dfm: 'DFM',
    needShapeFirst: '请先生成3D模型',
    addToCart: '加入购物车',
    instantQuote: '即时报价',
    needShape: '需要形状',
    analyzingDFM: 'DFM分析中',
    dfmIssuesTooltip: (n: number) => `${n}个DFM问题 — 可报价但成本可能上升`,
    quoteWithIssues: (n: number) => `报价 (${n}个问题)`,
    dfmPassed: 'DFM通过 — 可以报价',
    requesting: '请求中...',
    ipProLocked: '🔒 仅Pro — IP保护共享链接',
    ipShareHint: '创建IP保护的只读链接',
    ipShare: 'IP共享',
    exitFullscreen: '退出全屏 (Esc)',
    fullscreen: '全屏 (F11)',
    shrink: '退出',
    full: '全屏',
    collabDemo: '协作演示',
    collabDemoOn: '协作开',
    collabDemoTitleOff: '演示：在画布上显示远程光标',
    collabDemoTitleOn: '演示已开 — 再点关闭',
  },
  es: {
    commandPaletteTitle: 'Paleta de comandos (Ctrl+K)',
    toggleDimensionsTitle: 'Mostrar u ocultar cotas',
    searchCommand: 'Buscar',
    moreTools: 'Más herramientas',
    collapse: 'Cerrar',
    versionHistory: 'Historial de versiones',
    renderMode: 'Modo de renderizado',
    render: 'Render',
    stepParsed: (v: string) => `STEP analizado: ${v}cm³`,
    standardPartsCatalog: 'Piezas estándar (COTS)',
    cots: 'COTS',
    aiAdvisorProLocked: '🔒 Solo Pro — Asesor de diseño IA',
    aiAdvisor: 'Asesor de diseño IA',
    aiAdviceBtn: 'Asesor IA',
    pinCommentsPanel: 'Comentarios con pin',
    pin: 'Pin',
    switchToExpert: 'Cambiar a modo experto',
    expert: 'Experto',
    simpleHint: 'Modo simple: oculta paneles innecesarios',
    simple: 'Simple',
    quickQuoteHint: 'Asistente de cotización rápida',
    quickQuote: 'Cotización rápida',
    dfmProLocked: '🔒 Solo Pro — Análisis de manufacturabilidad DFM',
    dfmIssuesCount: (n: number) => `${n} problema${n > 1 ? 's' : ''} DFM`,
    dfmAnalysis: 'Análisis DFM',
    dfm: 'DFM',
    needShapeFirst: 'Genera primero un modelo 3D',
    addToCart: 'Añadir al carrito',
    instantQuote: 'Cotización Instantánea',
    needShape: 'Forma requerida',
    analyzingDFM: 'Analizando DFM',
    dfmIssuesTooltip: (n: number) => `${n} problema(s) DFM — cotización posible pero el coste puede aumentar`,
    quoteWithIssues: (n: number) => `Cotizar (${n} problema${n > 1 ? 's' : ''})`,
    dfmPassed: 'DFM aprobado — listo para cotizar',
    requesting: 'Solicitando...',
    ipProLocked: '🔒 Solo Pro — Enlaces con protección IP',
    ipShareHint: 'Crear enlace con protección IP (solo vista)',
    ipShare: 'Compartir IP',
    exitFullscreen: 'Salir pantalla completa (Esc)',
    fullscreen: 'Pantalla completa (F11)',
    shrink: 'Salir',
    full: 'Completa',
    collabDemo: 'Demo collab',
    collabDemoOn: 'Collab ON',
    collabDemoTitleOff: 'Demo: cursores remotos en el lienzo',
    collabDemoTitleOn: 'Demo activa — clic para apagar',
  },
  ar: {
    commandPaletteTitle: 'لوحة الأوامر (Ctrl+K)',
    toggleDimensionsTitle: 'تبديل عرض الأبعاد',
    searchCommand: 'بحث',
    moreTools: 'أدوات إضافية',
    collapse: 'إغلاق',
    versionHistory: 'سجل الإصدارات',
    renderMode: 'وضع العرض',
    render: 'عرض',
    stepParsed: (v: string) => `تم تحليل STEP: ${v}cm³`,
    standardPartsCatalog: 'كتالوج القطع القياسية',
    cots: 'قطع',
    aiAdvisorProLocked: '🔒 حصري للـ Pro — مستشار تصميم AI',
    aiAdvisor: 'مستشار تصميم AI',
    aiAdviceBtn: 'مستشار AI',
    pinCommentsPanel: 'لوحة التعليقات المثبتة',
    pin: 'تثبيت',
    switchToExpert: 'التبديل إلى وضع الخبير',
    expert: 'خبير',
    simpleHint: 'الوضع البسيط: إخفاء اللوحات غير الضرورية',
    simple: 'بسيط',
    quickQuoteHint: 'معالج عرض الأسعار السريع',
    quickQuote: 'عرض سريع',
    dfmProLocked: '🔒 حصري للـ Pro — تحليل قابلية التصنيع DFM',
    dfmIssuesCount: (n: number) => `${n} مشكلة DFM`,
    dfmAnalysis: 'تحليل DFM',
    dfm: 'DFM',
    needShapeFirst: 'أنشئ نموذج 3D أولاً',
    addToCart: 'أضف إلى السلة',
    instantQuote: 'عرض أسعار فوري',
    needShape: 'شكل مطلوب',
    analyzingDFM: 'جارٍ تحليل DFM',
    dfmIssuesTooltip: (n: number) => `${n} مشكلة DFM — يمكن طلب العرض لكن التكلفة قد ترتفع`,
    quoteWithIssues: (n: number) => `طلب عرض (${n} مشكلة)`,
    dfmPassed: 'اجتياز DFM — جاهز لطلب العرض',
    requesting: 'جارٍ الطلب...',
    ipProLocked: '🔒 حصري للـ Pro — روابط مشاركة محمية IP',
    ipShareHint: 'إنشاء رابط مشاركة محمي IP (للعرض فقط)',
    ipShare: 'مشاركة IP',
    exitFullscreen: 'الخروج من ملء الشاشة (Esc)',
    fullscreen: 'ملء الشاشة (F11)',
    shrink: 'خروج',
    full: 'ملء',
    collabDemo: 'تعاون تجريبي',
    collabDemoOn: 'تعاون مفعّل',
    collabDemoTitleOff: 'عرض تجريبي: مؤشرات بعيدة على اللوحة',
    collabDemoTitleOn: 'التجربة مفعّلة — انقر للإيقاف',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

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
  /** Active 2D sketch session — dims quote/cost CTAs slightly so design chrome dominates. */
  isSketchMode?: boolean;
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
  showCommentsPanel: boolean;
  setShowCommentsPanel: (v: boolean) => void;
  commentCount: number;
  // Dimensions
  showDimensions: boolean;
  setShowDimensions: (v: (prev: boolean) => boolean) => void;
  // Collab
  planLimits: PlanLimits;
  pollingSessions: CollabSession[];
  mySessionId: string | null;
  /** Optional: multi-cursor collaboration demo toggle (moved from floating canvas control). */
  designCollabDemo?: boolean;
  onToggleDesignCollabDemo?: () => void;
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
  onStepGeometry?: (file: File, filename: string) => void;
  onStepGeometryDirect?: (stats: import('./io/StepUploader').StepAnalysisResult & { geometry?: import('three').BufferGeometry; partsGeo?: { geometry: import('three').BufferGeometry; name: string }[] }) => void;
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

  // ── Sidebar layout controls (optional) ──
  layoutControls?: {
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    swapSides: boolean;
    overlayPref: 'auto' | 'always' | 'never';
    onToggleLeft: () => void;
    onToggleRight: () => void;
    onToggleSwap: () => void;
    onCycleOverlay: () => void;
  };
}

export default function ShapeGeneratorToolbar(props: ShapeGeneratorToolbarProps) {
  const pathname = usePathname();
  const userPlan = useAuthStore(s => s.user?.plan);
  const seg = pathname?.split('/').filter(Boolean)[0] ?? props.lang;
  const tt = dict[langMap[seg ?? ''] ?? langMap[props.lang] ?? 'en'];
  const dfmUnlocked = dfmAnalysisAllowed(userPlan);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const {
    theme, mode, toggleTheme,
    isMobile, isTablet, tabletLeftOpen, setTabletLeftOpen,
    activeTab, setActiveTab, tabLabels, lang, langSeg,
    isSketchMode = false,
    canUndo, canRedo, onHistoryUndo, onHistoryRedo,
    showVersionPanel, setShowVersionPanel,
    renderMode, setRenderMode,
    showCOTSPanel, setShowCOTSPanel,
    effectiveResult, showAIAdvisor, setShowAIAdvisor,
    isPlacingComment, setIsPlacingComment, showCommentsPanel, setShowCommentsPanel, commentCount,
    showDimensions, setShowDimensions,
    planLimits, pollingSessions, mySessionId,
    designCollabDemo, onToggleDesignCollabDemo,
    onOpenAuth,
    cartAdded, cartItemsLength, onAddToCart, disableCart,
    showCostPanel, setShowCostPanel,
    onGetQuote, rfqPending, tGetQuote,
    selectedId, params, materialId, shareOpenKey,
    isCreatingShare, shareUrl, onIPShare,
    addToast, onStepGeometry, onStepGeometryDirect,
    simpleMode, onEnableSimpleMode, onDisableSimpleMode,
    onOpenWizard,
    isFullscreen, onToggleFullscreen,
    dfmIssueCount, dfmRunning, showDFM, onToggleDFM,
    layoutControls,
  } = props;

  return (
    <div className="sg-topbar sg-autohide" style={{
      background: 'rgba(13, 17, 23, 0.85)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      padding: isMobile ? '0 8px' : '0 10px',
      display: 'flex', alignItems: 'center',
      gap: isMobile ? 4 : 5,
      height: 48, flexShrink: 0,
      zIndex: 40,
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
      <a href={`/${langSeg}/`} style={{ color: '#c9d1d9', fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', textDecoration: 'none', marginLeft: 4 }}>
        <span style={{ color: '#58a6ff' }}>Nexy</span>Fab
      </a>
      {!isMobile && <div style={{ width: 1, height: 24, background: 'rgba(255, 255, 255, 0.1)', marginLeft: 8, marginRight: 4 }} />}

      {/* ⌘K command palette hint — opens via Ctrl+K */}
      {!isMobile && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('nexyfab:open-command-palette'))}
          title={tt.commandPaletteTitle}
          aria-label={tt.commandPaletteTitle}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, padding: 0, borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(255, 255, 255, 0.03)',
            color: '#c9d1d9', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
          >
          🔍
        </button>
      )}

      {/* Tab buttons — hidden on mobile */}
      {!isMobile && (['design', 'optimize'] as TabMode[]).map(tab => {
        const active = activeTab === tab;
        return (
          <button key={tab} onClick={() => setActiveTab(tab)}
            data-tour={tab === 'optimize' ? 'optimize-tab' : undefined}
            style={{
              padding: '12px 16px', border: 'none', cursor: 'pointer',
              background: 'transparent', color: active ? '#ffffff' : '#8b949e',
              fontWeight: 600, fontSize: 13, transition: 'all 0.2s',
              borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
              marginBottom: -1,
              letterSpacing: '0.02em',
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
          title={tt.moreTools}
        >
          {showAdvanced ? tt.collapse : '···'}
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
          }} title={tt.versionHistory}>🕐</button>
        </div>
      )}

      {!isMobile && <div style={{ width: 1, height: 20, background: theme.border }} />}

      {/* Render mode toggle — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <button onClick={() => setRenderMode(renderMode === 'standard' ? 'photorealistic' : 'standard')} style={{
          width: 30, height: 28, padding: 0, borderRadius: 4, border: 'none',
          background: renderMode === 'photorealistic' ? '#8b5cf6' : theme.cardBg,
          color: renderMode === 'photorealistic' ? '#fff' : theme.textMuted,
          fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }} title={`${tt.renderMode}: ${tt.render}`}>
          🎬
        </button>
      )}

      {/* STEP file import — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <StepUploaderButton
          lang={lang}
          onResult={(stats) => {
            if (stats.geometry) {
              onStepGeometryDirect?.(stats);
            }
            addToast('success', tt.stepParsed(stats.volume_cm3?.toFixed(1) ?? '?'));
          }}
        />
      )}

      {/* COTS catalog button — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <button onClick={() => setShowCOTSPanel(!showCOTSPanel)} style={{
          width: 30, height: 28, padding: 0, borderRadius: 4, border: 'none',
          background: showCOTSPanel ? '#d29922' : theme.cardBg,
          color: showCOTSPanel ? '#fff' : theme.textMuted,
          fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }} title={`${tt.standardPartsCatalog}: ${tt.cots}`}>
          🔩
        </button>
      )}

      {/* AI Advisor button — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && effectiveResult && (
        <button onClick={() => setShowAIAdvisor()} style={{
          width: 30, height: 28, padding: 0, borderRadius: 4, border: 'none',
          background: showAIAdvisor ? '#a371f7' : theme.cardBg,
          color: showAIAdvisor ? '#fff' : theme.textMuted,
          fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: !planLimits.aiChat ? 0.75 : 1,
        }} title={!planLimits.aiChat ? tt.aiAdvisorProLocked : `${tt.aiAdvisor}: ${tt.aiAdviceBtn}`}>
          🤖
        </button>
      )}

      {/* Pin comment panel toggle */}
      {(!isMobile || showAdvanced) && effectiveResult && (
        <button
          onClick={() => setShowCommentsPanel(!showCommentsPanel)}
          style={{
            width: 30, height: 28, padding: 0, borderRadius: 4, border: 'none',
            background: showCommentsPanel ? '#388bfd' : (isPlacingComment ? '#8b5cf6' : theme.cardBg),
            color: showCommentsPanel || isPlacingComment ? '#fff' : theme.textMuted,
            fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
            position: 'relative',
          }}
          title={`${tt.pinCommentsPanel}: ${tt.pin}`}
        >
          📌
          {commentCount > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              background: '#f0883e', color: '#fff', borderRadius: '50%',
              width: 14, height: 14, fontSize: 9, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {commentCount > 9 ? '9+' : commentCount}
            </span>
          )}
        </button>
      )}

      {/* Dimension toggle — hidden on mobile unless advanced expanded */}
      {(!isMobile || showAdvanced) && (
        <button
          type="button"
          onClick={() => setShowDimensions(d => !d)}
          style={{
            padding: '4px 10px', borderRadius: 4, border: 'none',
            background: showDimensions ? theme.accent : theme.cardBg,
            color: showDimensions ? '#fff' : theme.textMuted,
            fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
          }}
          title={tt.toggleDimensionsTitle}
          aria-label={tt.toggleDimensionsTitle}
          aria-pressed={showDimensions}
        >📏</button>
      )}

      {/* 간편 모드 / 전문가 모드 토글 + 빠른 견적 — 살짝 흐리게 (스케치 집중) */}
      {!isMobile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          opacity: isSketchMode && activeTab === 'design' ? 0.78 : 1,
          transition: 'opacity 0.2s ease',
        }}>
          {simpleMode ? (
            <button
              type="button"
              onClick={onDisableSimpleMode}
              style={{
                padding: '4px 12px', borderRadius: 4,
                border: '1px solid #388bfd',
                background: '#0d1f3c', color: '#58a6ff',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              title={tt.switchToExpert}
              aria-label={tt.switchToExpert}
            >
              🔬 {tt.expert}
            </button>
          ) : (
            <button
              type="button"
              onClick={onEnableSimpleMode}
              style={{
                padding: '4px 12px', borderRadius: 4,
                border: '1px solid #3fb950',
                background: '#0f2d17', color: '#3fb950',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              title={tt.simpleHint}
              aria-label={tt.simpleHint}
            >
              ⚡ {tt.simple}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenWizard}
            style={{
              padding: '4px 12px', borderRadius: 4, border: 'none',
              background: 'linear-gradient(135deg, #388bfd, #a371f7)',
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
            title={tt.quickQuoteHint}
            aria-label={tt.quickQuoteHint}
          >
            🚀 {tt.quickQuote}
          </button>
        </div>
      )}

      {/* DFM issue badge — always visible when geometry exists */}
      {effectiveResult && (
        <button
          onClick={onToggleDFM}
          title={!dfmUnlocked
            ? tt.dfmProLocked
            : (dfmIssueCount > 0 ? tt.dfmIssuesCount(dfmIssueCount) : tt.dfmAnalysis)}
          style={{
            position: 'relative',
            padding: '4px 10px', borderRadius: 4,
            border: `1px solid ${showDFM ? '#f0883e' : dfmIssueCount > 0 ? '#f0883e55' : theme.border}`,
            background: showDFM ? 'rgba(240,136,62,0.18)' : dfmIssueCount > 0 ? 'rgba(240,136,62,0.08)' : theme.cardBg,
            color: dfmIssueCount > 0 ? '#f0883e' : theme.textMuted,
            fontSize: 11, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
            opacity: !dfmUnlocked ? 0.75 : 1,
          }}
        >
          {!dfmUnlocked
            ? <span style={{ fontSize: 11 }}>🔒</span>
            : dfmRunning
            ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: '2px solid #f0883e', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            : '⚠'}
          {tt.dfm}
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

      <button onClick={toggleTheme} style={{
        width: 32, height: 32, padding: 0, borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.08)',
        background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,241,200,0.15)',
        color: mode === 'dark' ? '#c9d1d9' : '#fbbf24',
        fontSize: 15, cursor: 'pointer', transition: 'all 0.2s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1) rotate(15deg)'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1) rotate(0deg)'; e.currentTarget.style.background = mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,241,200,0.15)'; }}
      title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        {mode === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
      </button>

      {/* Collab avatars (polling-based, Team+ plan) */}
      {planLimits.collaboration && pollingSessions.length > 0 && (
        <CollabAvatars sessions={pollingSessions} mySessionId={mySessionId ?? ''} />
      )}

      {activeTab === 'design' && onToggleDesignCollabDemo && (!isMobile || showAdvanced) && (
        <button
          type="button"
          onClick={onToggleDesignCollabDemo}
          title={designCollabDemo ? tt.collabDemoTitleOn : tt.collabDemoTitleOff}
          style={{
            padding: '4px 10px', borderRadius: 6, border: `1px solid ${theme.border}`,
            background: designCollabDemo ? '#388bfd' : theme.cardBg,
            color: designCollabDemo ? '#fff' : theme.textMuted,
            fontSize: 11, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif', flexShrink: 0, transition: 'all 0.15s',
          }}
        >
          🤝 {designCollabDemo ? tt.collabDemoOn : tt.collabDemo}
        </button>
      )}

      {/* User menu */}
      <UserMenu
        onOpenAuth={(m) => onOpenAuth(m ?? 'login')}
        lang={langSeg}
      />

      {/* Quick actions — slightly de-emphasized while sketching */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
        opacity: isSketchMode && activeTab === 'design' ? 0.76 : 1,
        transition: 'opacity 0.2s ease',
      }}>
      <button
        onClick={onAddToCart}
        disabled={disableCart}
        title={disableCart ? tt.needShapeFirst : tt.addToCart}
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
        title={!effectiveResult ? tt.needShapeFirst : tt.instantQuote}
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
        💰 {tt.instantQuote}
      </button>
      {/* ── DFM-based contextual CTA ── */}
      {(() => {
        const noGeo = !effectiveResult;
        const analyzing = dfmRunning;
        const hasIssues = !dfmRunning && dfmIssueCount > 0;
        const clean = !dfmRunning && dfmIssueCount === 0 && effectiveResult;

        if (noGeo) {
          return (
            <button data-tour="get-quote" disabled title={tt.needShapeFirst} style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
              background: theme.cardBg, color: theme.textMuted,
              cursor: 'default', opacity: 0.4, transition: 'all 0.15s',
            }}>
              {tt.needShape}
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
              {tt.analyzingDFM}
            </button>
          );
        }
        if (hasIssues) {
          return (
            <button
              data-tour="get-quote"
              onClick={() => void onGetQuote()}
              disabled={rfqPending}
              title={tt.dfmIssuesTooltip(dfmIssueCount)}
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                border: '1px solid #f0883e',
                background: 'rgba(240,136,62,0.15)', color: '#f0883e',
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              ⚠ {tt.quoteWithIssues(dfmIssueCount)}
            </button>
          );
        }
        // clean or no dfm results yet but geometry exists
        return (
          <button
            data-tour="get-quote"
            onClick={() => void onGetQuote()}
            disabled={rfqPending}
            title={clean ? tt.dfmPassed : undefined}
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
            {rfqPending ? tt.requesting : tGetQuote}
          </button>
        );
      })()}
      </div>
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
          width: 30, height: 28, padding: 0, borderRadius: 6,
          border: '1px solid #30363d',
          background: shareUrl ? '#1a2e1a' : 'transparent',
          color: shareUrl ? '#3fb950' : '#8b949e',
          fontSize: 13, fontWeight: 700,
          cursor: effectiveResult ? 'pointer' : 'default',
          opacity: !planLimits.ipShareLink ? 0.6 : (effectiveResult ? 1 : 0.4), transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
        title={!planLimits.ipShareLink ? tt.ipProLocked : `${tt.ipShareHint}: ${tt.ipShare}`}
      >
        {isCreatingShare ? '...' : '🔒'}
        {!planLimits.ipShareLink && <span style={{ position: 'absolute', top: -6, right: -6, fontSize: 8, background: '#8b5cf6', color: '#fff', padding: '1px 3px', borderRadius: 3, fontWeight: 800 }}>PRO</span>}
      </button>

      {/* ── Layout controls ── */}
      {layoutControls && !isMobile && (
        <>
          <div style={{ width: 1, height: 20, background: '#30363d', flexShrink: 0 }} />
          <button
            onClick={layoutControls.onToggleLeft}
            title={layoutControls.leftCollapsed ? 'Expand left panel' : 'Collapse left panel'}
            style={{
              width: 28, height: 28, padding: 0, borderRadius: 4, border: 'none',
              background: layoutControls.leftCollapsed ? theme.accent : theme.cardBg,
              color: layoutControls.leftCollapsed ? '#fff' : theme.textMuted,
              fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >⬅</button>
          <button
            onClick={layoutControls.onToggleRight}
            title={layoutControls.rightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
            style={{
              width: 28, height: 28, padding: 0, borderRadius: 4, border: 'none',
              background: layoutControls.rightCollapsed ? theme.accent : theme.cardBg,
              color: layoutControls.rightCollapsed ? '#fff' : theme.textMuted,
              fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >➡</button>
          <button
            onClick={layoutControls.onToggleSwap}
            title="Swap left/right panels"
            style={{
              width: 28, height: 28, padding: 0, borderRadius: 4, border: 'none',
              background: layoutControls.swapSides ? theme.accent : theme.cardBg,
              color: layoutControls.swapSides ? '#fff' : theme.textMuted,
              fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >⇄</button>
          <button
            onClick={layoutControls.onCycleOverlay}
            title={`Overlay: ${layoutControls.overlayPref} (click to cycle)`}
            style={{
              height: 28, padding: '0 8px', borderRadius: 4, border: 'none',
              background: layoutControls.overlayPref !== 'auto' ? theme.accent : theme.cardBg,
              color: layoutControls.overlayPref !== 'auto' ? '#fff' : theme.textMuted,
              fontSize: 10, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >{layoutControls.overlayPref === 'always' ? 'OVR' : layoutControls.overlayPref === 'never' ? 'FIX' : 'AUT'}</button>
        </>
      )}

      {/* ── Fullscreen toggle ── */}
      <div style={{ width: 1, height: 20, background: '#30363d', flexShrink: 0 }} />
      <button
        onClick={onToggleFullscreen}
        title={isFullscreen ? tt.exitFullscreen : tt.fullscreen}
        style={{
          width: 30, height: 28, padding: 0, borderRadius: 6, border: `1px solid ${isFullscreen ? '#388bfd' : '#30363d'}`,
          background: isFullscreen ? 'rgba(56,139,253,0.15)' : 'transparent',
          color: isFullscreen ? '#58a6ff' : '#8b949e',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s', flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#58a6ff'; }}
        onMouseLeave={e => {
          e.currentTarget.style.color = isFullscreen ? '#58a6ff' : '#8b949e';
          e.currentTarget.style.borderColor = isFullscreen ? '#388bfd' : '#30363d';
        }}
      >
        {isFullscreen ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
            <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        )}
      </button>
    </div>
  );
}
