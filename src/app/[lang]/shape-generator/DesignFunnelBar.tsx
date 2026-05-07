'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';

const dict = {
  ko: {
    design: '형상 설계',
    shapeCreated: '기본 형상 생성 완료',
    dfmCheck: 'DFM 검토',
    autoAnalyzed: '형상 생성 후 자동 분석',
    dfmPassed: '제조 가능성 검증 완료',
    dfmIssues: (n: number) => `이슈 ${n}건 — 견적은 가능하나 비용 증가 가능`,
    viewDfm: 'DFM 보기',
    getQuote: '견적 요청',
    quoteRequested: '견적 요청 완료',
    finalizeShape: '형상·재질 확정 후 요청',
    requestQuote: '견적 요청',
    ideaDesignTitle: '아이디어로 설계',
    ideaDesignTip: '아이디어만으로 제조 가능한 설계를 자동 생성합니다 (Q&A → 부품+제조법+재료+JSCAD)',
    processRouter: 'AI 공정 라우터',
    processRouterTip: 'AI가 형상·재질·수량에 최적 제조 공정을 추천합니다',
    supplierTop3: 'AI 공급사 Top 3',
    supplierTop3Tip: 'AI가 재질·공정·수량에 최적 공급사 Top 3을 추천합니다',
    costCopilot: '비용 코파일럿',
    costCopilotTip: '"비용 20% 줄여줘" 같은 자연어로 설계·재료·공정 변경 제안을 받습니다',
    aiHistory: 'AI 이력',
    aiHistoryTip: '최근 AI 실행 결과를 다시 보기',
    aiShapeGen: 'AI·JSCAD',
    aiShapeGenTip: '자연어 → JSCAD(@jscad/modeling) 코드 → 브라우저에서 3D 솔리드 (OpenSCAD .scad 아님)',
    selectFaceTip: '면/엣지 클릭 선택 모드 (클릭 후 AI 채팅 참조 가능)',
    selectOn: '면 선택 ON',
    selectFace: '면 선택',
  },
  en: {
    design: 'Design',
    shapeCreated: 'Shape created',
    dfmCheck: 'DFM Check',
    autoAnalyzed: 'Auto-analyzed after shape',
    dfmPassed: 'DFM passed',
    dfmIssues: (n: number) => `${n} issue(s) — quote possible but cost may rise`,
    viewDfm: 'View DFM',
    getQuote: 'Get Quote',
    quoteRequested: 'Quote requested',
    finalizeShape: 'Finalize shape & material',
    requestQuote: 'Request Quote',
    ideaDesignTitle: 'Design from Idea',
    ideaDesignTip: 'Design from idea — Q&A wizard → full manufacturing spec',
    processRouter: 'AI Process Router',
    processRouterTip: 'AI recommends optimal manufacturing process',
    supplierTop3: 'AI Supplier Top-3',
    supplierTop3Tip: 'AI recommends Top-3 suppliers',
    costCopilot: 'Cost Copilot',
    costCopilotTip: 'Ask "cut cost by 20%" in plain language',
    aiHistory: 'AI History',
    aiHistoryTip: 'Revisit recent AI runs',
    aiShapeGen: 'AI + JSCAD',
    aiShapeGenTip: 'Natural language → JSCAD (@jscad/modeling) → 3D in browser (not OpenSCAD .scad)',
    selectFaceTip: 'Click face/edge to select and reference in AI chat',
    selectOn: 'Select ON',
    selectFace: 'Select Face',
  },
  ja: {
    design: '形状設計',
    shapeCreated: '基本形状作成完了',
    dfmCheck: 'DFMチェック',
    autoAnalyzed: '形状作成後に自動分析',
    dfmPassed: '製造可能性検証完了',
    dfmIssues: (n: number) => `問題 ${n}件 — 見積は可能ですがコスト増の可能性`,
    viewDfm: 'DFMを見る',
    getQuote: '見積依頼',
    quoteRequested: '見積依頼完了',
    finalizeShape: '形状・材質確定後に依頼',
    requestQuote: '見積依頼',
    ideaDesignTitle: 'アイデアから設計',
    ideaDesignTip: 'アイデアだけで製造可能な設計を自動生成します (Q&A → 部品+製法+材料+JSCAD)',
    processRouter: 'AI工程ルーター',
    processRouterTip: 'AIが形状・材質・数量に最適な製造工程を推薦します',
    supplierTop3: 'AIサプライヤー Top 3',
    supplierTop3Tip: 'AIが材質・工程・数量に最適なサプライヤー Top 3 を推薦します',
    costCopilot: 'コストコパイロット',
    costCopilotTip: '「コストを20%削減して」のような自然言語で設計・材料・工程の変更提案を受けます',
    aiHistory: 'AI履歴',
    aiHistoryTip: '最近のAI実行結果を再確認',
    aiShapeGen: 'AI·JSCAD',
    aiShapeGenTip: '自然言語→JSCAD(@jscad/modeling)→ブラウザで3D（OpenSCAD .scad ではありません）',
    selectFaceTip: '面/エッジクリック選択モード (クリック後AIチャット参照可能)',
    selectOn: '面選択 ON',
    selectFace: '面選択',
  },
  zh: {
    design: '形状设计',
    shapeCreated: '基本形状创建完成',
    dfmCheck: 'DFM 检查',
    autoAnalyzed: '形状创建后自动分析',
    dfmPassed: 'DFM 通过',
    dfmIssues: (n: number) => `${n} 个问题 — 可以报价,但成本可能上升`,
    viewDfm: '查看 DFM',
    getQuote: '获取报价',
    quoteRequested: '报价已请求',
    finalizeShape: '确定形状与材料',
    requestQuote: '请求报价',
    ideaDesignTitle: '从创意设计',
    ideaDesignTip: '仅凭创意自动生成可制造设计 (Q&A → 零件+工艺+材料+JSCAD)',
    processRouter: 'AI 工艺路由',
    processRouterTip: 'AI 根据形状、材料、数量推荐最佳制造工艺',
    supplierTop3: 'AI 供应商 Top 3',
    supplierTop3Tip: 'AI 推荐最适合材料、工艺、数量的 Top 3 供应商',
    costCopilot: '成本副驾驶',
    costCopilotTip: '用"降低20%成本"等自然语言获取设计、材料、工艺的变更建议',
    aiHistory: 'AI 历史',
    aiHistoryTip: '查看最近的 AI 执行结果',
    aiShapeGen: 'AI·JSCAD',
    aiShapeGenTip: '自然语言 → JSCAD（@jscad/modeling）→ 浏览器内 3D（非 OpenSCAD .scad）',
    selectFaceTip: '面/边缘单击选择模式 (单击后可在 AI 聊天中引用)',
    selectOn: '面选择 开',
    selectFace: '面选择',
  },
  es: {
    design: 'Diseño',
    shapeCreated: 'Forma creada',
    dfmCheck: 'Verificación DFM',
    autoAnalyzed: 'Analizado tras la forma',
    dfmPassed: 'DFM aprobado',
    dfmIssues: (n: number) => `${n} problema(s) — cotización posible pero el costo puede aumentar`,
    viewDfm: 'Ver DFM',
    getQuote: 'Obtener Cotización',
    quoteRequested: 'Cotización solicitada',
    finalizeShape: 'Finalizar forma y material',
    requestQuote: 'Solicitar Cotización',
    ideaDesignTitle: 'Diseñar desde Idea',
    ideaDesignTip: 'Diseñar desde una idea — asistente Q&A → especificación completa',
    processRouter: 'Enrutador de Proceso IA',
    processRouterTip: 'La IA recomienda el proceso óptimo',
    supplierTop3: 'Top-3 Proveedores IA',
    supplierTop3Tip: 'La IA recomienda los 3 mejores proveedores',
    costCopilot: 'Copiloto de Costes',
    costCopilotTip: 'Diga "reducir costo 20%" en lenguaje natural',
    aiHistory: 'Historial IA',
    aiHistoryTip: 'Revisar ejecuciones IA recientes',
    aiShapeGen: 'IA + JSCAD',
    aiShapeGenTip: 'Lenguaje natural → JSCAD (@jscad/modeling) → 3D en el navegador (no es OpenSCAD .scad)',
    selectFaceTip: 'Hacer clic en cara/arista para seleccionar y referenciar en chat IA',
    selectOn: 'Selección ON',
    selectFace: 'Seleccionar Cara',
  },
  ar: {
    design: 'تصميم',
    shapeCreated: 'تم إنشاء الشكل',
    dfmCheck: 'فحص DFM',
    autoAnalyzed: 'تحليل تلقائي بعد الشكل',
    dfmPassed: 'اجتاز DFM',
    dfmIssues: (n: number) => `${n} مشكلة — العرض ممكن لكن قد ترتفع التكلفة`,
    viewDfm: 'عرض DFM',
    getQuote: 'احصل على عرض',
    quoteRequested: 'تم طلب العرض',
    finalizeShape: 'إنهاء الشكل والمواد',
    requestQuote: 'طلب عرض سعر',
    ideaDesignTitle: 'تصميم من فكرة',
    ideaDesignTip: 'تصميم من فكرة — معالج Q&A → مواصفات تصنيع كاملة',
    processRouter: 'موجه العمليات AI',
    processRouterTip: 'يوصي الذكاء الاصطناعي بعملية التصنيع المثلى',
    supplierTop3: 'أفضل 3 موردين AI',
    supplierTop3Tip: 'يوصي الذكاء الاصطناعي بأفضل 3 موردين',
    costCopilot: 'مساعد التكلفة',
    costCopilotTip: 'اسأل "خفض التكلفة 20%" بلغة طبيعية',
    aiHistory: 'سجل AI',
    aiHistoryTip: 'مراجعة عمليات AI الأخيرة',
    aiShapeGen: 'AI + JSCAD',
    aiShapeGenTip: 'لغة طبيعية → JSCAD (@jscad/modeling) → ثلاثي الأبعاد في المتصفح (ليس OpenSCAD .scad)',
    selectFaceTip: 'وضع النقر على الوجه/الحافة (للإشارة في دردشة AI)',
    selectOn: 'تحديد تشغيل',
    selectFace: 'تحديد الوجه',
  },
};

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface FunnelStep {
  label: string;
  done: boolean;
  active: boolean;
  action?: () => void;
  actionLabel?: string;
}

interface DesignFunnelBarProps {
  lang: string;
  hasGeometry: boolean;
  dfmChecked: boolean;   // dfmResults !== null
  dfmClean: boolean;     // dfmIssueCount === 0
  dfmIssueCount: number;
  rfqDone: boolean;
  onGoToDFM: () => void;
  onGoToQuote: () => void;
  onProcessRouter?: () => void;
  onAISupplierMatch?: () => void;
  onCostCopilot?: () => void;
  onAIHistory?: () => void;
  onOpenScad?: () => void;
  onIdeaDesign?: () => void;
  selectionActive?: boolean;
  onToggleSelection?: () => void;
  theme: { panelBg: string; border: string; text: string; textMuted: string };
  /** When user is actively sketching, hide AI shortcut chips to reduce visual competition with the canvas. */
  sketchMode?: boolean;
  statusGuide?: { icon: string; text: string; color: string };
}

export default function DesignFunnelBar({
  lang, hasGeometry, dfmChecked, dfmClean, dfmIssueCount,
  rfqDone,
  onGoToDFM, onGoToQuote, onProcessRouter, onAISupplierMatch, onCostCopilot, onAIHistory, onOpenScad, onIdeaDesign,
  selectionActive = false, onToggleSelection,
  theme,
  sketchMode = false,
  statusGuide,
}: DesignFunnelBarProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const tt = dict[langMap[seg] ?? 'en'];

  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const aiMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (aiMenuRef.current && !aiMenuRef.current.contains(event.target as Node)) {
        setAiMenuOpen(false);
      }
    }
    if (aiMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    else document.removeEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [aiMenuOpen]);

  // 현재 활성 단계 계산
  const step = rfqDone ? 3 : (dfmChecked && dfmClean) ? 2 : hasGeometry ? 1 : 0;

  const steps = [
    {
      n: 1,
      label: tt.design,
      icon: '📐',
      done: hasGeometry,
      hint: tt.shapeCreated,
    },
    {
      n: 2,
      label: tt.dfmCheck,
      icon: dfmChecked && !dfmClean ? '⚠️' : '🔍',
      done: dfmChecked && dfmClean,
      warn: dfmChecked && !dfmClean,
      hint: !dfmChecked
        ? tt.autoAnalyzed
        : dfmClean
          ? tt.dfmPassed
          : tt.dfmIssues(dfmIssueCount),
      action: hasGeometry && !dfmClean ? onGoToDFM : undefined,
      actionLabel: tt.viewDfm,
    },
    {
      n: 3,
      label: tt.getQuote,
      icon: '📋',
      done: rfqDone,
      hint: rfqDone ? tt.quoteRequested : tt.finalizeShape,
      action: hasGeometry && !rfqDone ? onGoToQuote : undefined,
      actionLabel: tt.requestQuote,
    },
  ];

  return (
    <div className="sg-autohide" style={{
      background: theme.panelBg,
      borderBottom: `1px solid ${theme.border}`,
      padding: '0 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      height: 22,
      flexShrink: 0,
      overflowX: 'auto',
      opacity: sketchMode ? 0.72 : 1,
      transition: 'opacity 0.2s ease',
    }}>
      {steps.map((s, i) => {
        const isCurrent = s.n === step + 1 && !s.done;
        const isWarn = s.warn;
        const color = s.done
          ? '#3fb950'
          : isWarn
            ? '#f0883e'
            : isCurrent
              ? '#58a6ff'
              : '#484f58';

        return (
          <React.Fragment key={s.n}>
            {/* 단계 */}
            <div
              title={s.hint}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '0 6px',
                height: '100%',
                cursor: s.action ? 'pointer' : 'default',
                borderBottom: isCurrent ? '2px solid #58a6ff' : isWarn ? '2px solid #f0883e' : s.done ? '2px solid #3fb950' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
              onClick={s.action}
            >
              <span style={{ fontSize: 11 }}>{s.icon}</span>
              <span style={{
                fontSize: 10,
                fontWeight: isCurrent || s.done ? 700 : 400,
                color,
                whiteSpace: 'nowrap',
              }}>
                {s.done && <span style={{ marginRight: 2 }}>✓</span>}
                {s.label}
              </span>
              {/* 다음 단계 유도 버튼 */}
              {s.action && isCurrent && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#161b22',
                  background: '#58a6ff',
                  borderRadius: 4,
                  padding: '1px 6px',
                  marginLeft: 2,
                  animation: 'funnel-pulse 1.8s ease-in-out infinite',
                }}>
                  {s.actionLabel}
                </span>
              )}
              {s.action && isWarn && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: '#161b22', background: '#f0883e',
                  borderRadius: 4, padding: '1px 6px', marginLeft: 2,
                }}>
                  {s.actionLabel}
                </span>
              )}
            </div>

            {/* 구분자 화살표 */}
            {i < steps.length - 1 && (
              <span style={{ color: '#30363d', fontSize: 10, flexShrink: 0 }}>›</span>
            )}
          </React.Fragment>
        );
      })}



      {statusGuide && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginLeft: 16, paddingLeft: 16,
          borderLeft: `1px solid ${theme.border}`,
          flexShrink: 0,
        }}>
          <span style={{ color: statusGuide.color, fontSize: 11 }}>{statusGuide.icon}</span>
          <span style={{ color: theme.textMuted, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>{statusGuide.text}</span>
        </div>
      )}

      {!sketchMode && (onProcessRouter || onAISupplierMatch || onCostCopilot || onAIHistory || onOpenScad || onIdeaDesign) && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0, position: 'relative' }} ref={aiMenuRef}>
          <button
            onClick={() => setAiMenuOpen(!aiMenuOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '2px 8px', height: 20,
              borderRadius: 4, border: '1px solid #388bfd',
              background: aiMenuOpen ? 'rgba(56, 139, 253, 0.15)' : 'transparent',
              color: '#58a6ff',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap', transition: 'all 0.15s'
            }}
          >
            ✨ AI Assistant {aiMenuOpen ? '▴' : '▾'}
          </button>
          
          {aiMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 100,
              display: 'flex', flexDirection: 'column', padding: 4, minWidth: 160
            }}>
              {onIdeaDesign && (
                <button
                  onClick={() => { onIdeaDesign(); setAiMenuOpen(false); }}
                  title={tt.ideaDesignTip}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 4, border: 'none',
                    background: 'transparent', color: '#e6edf3',
                    fontSize: 11, fontWeight: 500, cursor: 'pointer',
                    textAlign: 'left', transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#fbbf24', width: 14 }}>💡</span> {tt.ideaDesignTitle}
                </button>
              )}
              {onProcessRouter && (
                <button
                  onClick={() => { onProcessRouter(); setAiMenuOpen(false); }}
                  title={tt.processRouterTip}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 4, border: 'none',
                    background: 'transparent', color: '#e6edf3',
                    fontSize: 11, fontWeight: 500, cursor: 'pointer',
                    textAlign: 'left', transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(163, 113, 247, 0.15)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#a371f7', width: 14 }}>🧭</span> {tt.processRouter}
                </button>
              )}
              {onAISupplierMatch && (
                <button
                  onClick={() => { onAISupplierMatch(); setAiMenuOpen(false); }}
                  title={tt.supplierTop3Tip}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 4, border: 'none',
                    background: 'transparent', color: '#e6edf3',
                    fontSize: 11, fontWeight: 500, cursor: 'pointer',
                    textAlign: 'left', transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(57, 197, 187, 0.15)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#39c5bb', width: 14 }}>🎯</span> {tt.supplierTop3}
                </button>
              )}
              {onCostCopilot && (
                <button
                  onClick={() => { onCostCopilot(); setAiMenuOpen(false); }}
                  title={tt.costCopilotTip}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 4, border: 'none',
                    background: 'transparent', color: '#e6edf3',
                    fontSize: 11, fontWeight: 500, cursor: 'pointer',
                    textAlign: 'left', transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(210, 153, 34, 0.15)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#d29922', width: 14 }}>💰</span> {tt.costCopilot}
                </button>
              )}
              {onOpenScad && (
                <button
                  onClick={() => { onOpenScad(); setAiMenuOpen(false); }}
                  title={tt.aiShapeGenTip}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 4, border: 'none',
                    background: 'transparent', color: '#e6edf3',
                    fontSize: 11, fontWeight: 500, cursor: 'pointer',
                    textAlign: 'left', transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(129, 140, 248, 0.15)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#818cf8', width: 14 }}>⚙️</span> {tt.aiShapeGen}
                </button>
              )}
              {onAIHistory && (
                <>
                  <div style={{ height: 1, background: '#30363d', margin: '4px 0' }} />
                  <button
                    onClick={() => { onAIHistory(); setAiMenuOpen(false); }}
                    title={tt.aiHistoryTip}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 8px', borderRadius: 4, border: 'none',
                      background: 'transparent', color: theme.textMuted,
                      fontSize: 11, fontWeight: 500, cursor: 'pointer',
                      textAlign: 'left', transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ color: theme.textMuted, width: 14 }}>📜</span> {tt.aiHistory}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
