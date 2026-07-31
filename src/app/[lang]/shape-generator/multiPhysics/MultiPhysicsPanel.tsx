'use client';

/**
 * MultiPhysicsPanel.tsx — Coupled-physics workflow runner UI.
 *
 * Selects a workflow (Thermal→Structural / Fluid→Structural), runs
 * it against a stub solver pair, and plots the residual history.
 * Real solvers integrate via the runCoupled API.
 */

import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { runCoupled, thermalStructuralWorkflow, fluidStructuralWorkflow, type PhysicsBus, type CouplingResult } from './coupledSolver';

interface MultiPhysicsPanelProps {
  lang: string;
  onClose?: () => void;
  /** Caller supplies actual solver implementations. */
  thermalSolver?: (bus: PhysicsBus) => Promise<void>;
  structuralSolver?: (bus: PhysicsBus) => Promise<void>;
  fluidSolver?: (bus: PhysicsBus) => Promise<void>;
}

const COPY = {
  ko: {
    title: '다중물리 분석',
    workflow: '워크플로우',
    thermalStructural: '열-구조 결합',
    fluidStructural: '유체-구조 결합',
    run: '실행',
    iter: '반복',
    residual: '잔차',
    converged: '수렴',
    notConverged: '미수렴',
    history: '잔차 이력',
  },
  en: {
    title: 'Multi-Physics',
    workflow: 'Workflow',
    thermalStructural: 'Thermal → Structural',
    fluidStructural: 'Fluid → Structural',
    run: 'Run',
    iter: 'Iter',
    residual: 'Residual',
    converged: 'Converged',
    notConverged: 'Not converged',
    history: 'Residual history',
  },
  ja: {
    title: 'マルチフィジックス解析',
    workflow: 'ワークフロー',
    thermalStructural: '熱-構造連成',
    fluidStructural: '流体-構造連成',
    run: '実行',
    iter: '反復',
    residual: '残差',
    converged: '収束',
    notConverged: '未収束',
    history: '残差履歴',
  },
  zh: {
    title: '多物理场分析',
    workflow: '工作流',
    thermalStructural: '热-结构耦合',
    fluidStructural: '流-固耦合',
    run: '运行',
    iter: '迭代',
    residual: '残差',
    converged: '已收敛',
    notConverged: '未收敛',
    history: '残差历史',
  },
  es: {
    title: 'Análisis multifísico',
    workflow: 'Flujo de trabajo',
    thermalStructural: 'Acoplamiento termoestructural',
    fluidStructural: 'Interacción fluido-estructura',
    run: 'Ejecutar',
    iter: 'Iteración',
    residual: 'Residuo',
    converged: 'Convergido',
    notConverged: 'No convergido',
    history: 'Histórico de residuos',
  },
  ar: {
    title: 'تحليل متعدد الفيزياء',
    workflow: 'سير العمل',
    thermalStructural: 'اقتران حراري-إنشائي',
    fluidStructural: 'اقتران مائع-إنشائي',
    run: 'تشغيل',
    iter: 'التكرار',
    residual: 'المتبقي',
    converged: 'تقارب',
    notConverged: 'لم يتقارب',
    history: 'سجل المتبقيات',
  },
} as const;

type WorkflowKind = 'thermal-structural' | 'fluid-structural';

export default function MultiPhysicsPanel({
  lang, onClose, thermalSolver, structuralSolver, fluidSolver,
}: MultiPhysicsPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [workflow, setWorkflow] = useState<WorkflowKind>('thermal-structural');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CouplingResult | null>(null);

  // Default no-op solvers (zero residual to test UI flow).
  const noOp = async (_bus: PhysicsBus) => { void _bus; };

  const handleRun = async () => {
    const bus: PhysicsBus = {
      scalars: new Map(),
      vectors: new Map(),
    };
    setRunning(true);
    try {
      const wf = workflow === 'thermal-structural'
        ? thermalStructuralWorkflow(thermalSolver ?? noOp, structuralSolver ?? noOp)
        : fluidStructuralWorkflow(fluidSolver ?? noOp, structuralSolver ?? noOp);
      const r = await runCoupled(wf, bus);
      setResult(r);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>

      <div style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{t.workflow}: </span>
        <select value={workflow} onChange={e => setWorkflow(e.target.value as WorkflowKind)} style={fieldStyle()}>
          <option value="thermal-structural">{t.thermalStructural}</option>
          <option value="fluid-structural">{t.fluidStructural}</option>
        </select>
      </div>

      <button onClick={handleRun} disabled={running} style={{ ...primaryBtn(), opacity: running ? 0.5 : 1 }}>
        {running ? '...' : t.run}
      </button>

      {result && (
        <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.7 }}>
          <div><strong>{t.iter}:</strong> {result.iterations}</div>
          <div><strong>{t.residual}:</strong> {result.finalResidual.toExponential(2)}</div>
          <div style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 4, marginTop: 4,
            background: result.converged ? '#16a34a22' : '#dc262622',
            color: result.converged ? '#22c55e' : '#f87171',
            border: `1px solid ${result.converged ? '#16a34a' : '#dc2626'}`,
          }}>
            {result.converged ? `✓ ${t.converged}` : `⚠ ${t.notConverged}`}
          </div>

          {result.history.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>{t.history}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
                {result.history.map((h, i) => {
                  const max = Math.max(...result.history.map(x => x.residual)) || 1;
                  const heightPct = Math.max(2, (h.residual / max) * 100);
                  return (
                    <div key={i} style={{
                      width: 8, height: `${heightPct}%`,
                      background: '#3b82f6', borderRadius: 2,
                    }} title={`#${h.iter} ${h.residual.toExponential(2)}`} />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// right: 336 clears the 320px right property pane (2026-06-12)
function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 340, zIndex: 700, width: 300, background: 'var(--nx-panel)', color: 'var(--nx-text)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 16 }; }
function fieldStyle(): React.CSSProperties { return { background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '3px 6px', fontSize: 11 }; }
function primaryBtn(): React.CSSProperties { return { width: '100%', background: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
