'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { AiDesignChatActionCardV1, AiDesignChatActionId } from '@/lib/ai/aiDesignChatActionCards';
import type { AiDesignUnifiedWorkspaceControllerV1 } from '@/lib/ai/aiDesignUnifiedWorkspaceControllerV1';
import type { AiDesignUnifiedWorkspaceV9 } from '@/lib/ai/aiDesignUnifiedWorkspaceV9';
import type { AiDesignConceptNodeV10 } from '@/lib/ai/aiDesignWorkspaceIntegrationV10';
import { getComplexProductCommercialScopeCopy } from '@/lib/ai/complexProductCommercialScope';
import { getAiDesignWorkspaceCopy } from '@/lib/ai/aiDesignWorkspaceI18n';
import { langDir } from '@/lib/i18n/normalize';
import styles from './AiDesignWorkspace.module.css';

const ConceptCanvas3d = dynamic(() => import('./AiDesignConceptCanvas3d'), {
  ssr: false,
  loading: () => <div className={styles.canvasLoading}>3D · …</div>,
});

export interface AiDesignSurfaceGaugeV10 {
  gaugeId: string;
  label: string;
  targetValue: number;
  unit: string;
  fineStep: number;
  coarseStep: number;
}

export function AiDesignWorkspaceSurface({
  lang,
  workspace,
  controller,
  nodes,
  gauges,
  decisionCard,
  busy,
  notice,
  gaugeMode,
  gaugeDirection,
  renderThree = true,
  onAction,
  onSelect,
  onCanvasMode,
  onGaugeMode,
  onGaugeDirection,
  onRefresh,
}: {
  lang: string;
  workspace: AiDesignUnifiedWorkspaceV9;
  controller: AiDesignUnifiedWorkspaceControllerV1;
  nodes: readonly AiDesignConceptNodeV10[];
  gauges: readonly AiDesignSurfaceGaugeV10[];
  decisionCard?: AiDesignChatActionCardV1 | null;
  busy?: boolean;
  notice?: string | null;
  gaugeMode: 'fine' | 'coarse';
  gaugeDirection: 1 | -1;
  renderThree?: boolean;
  onAction(card: AiDesignChatActionCardV1, actionId: AiDesignChatActionId): void;
  onSelect(id: string, kind: AiDesignConceptNodeV10['kind']): void;
  onCanvasMode(mode: '2d' | '3d' | 'split'): void;
  onGaugeMode(mode: 'fine' | 'coarse'): void;
  onGaugeDirection(direction: 1 | -1): void;
  onRefresh(): void;
}) {
  const text = getAiDesignWorkspaceCopy(lang).surface;
  const complexScope = getComplexProductCommercialScopeCopy(lang);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const cards = decisionCard ? [...workspace.cards, decisionCard] : workspace.cards;
  const selection = controller.client.localView.selection;
  const mode = controller.client.localView.canvasMode;
  const preview = controller.preview.preview;
  const precision = controller.client.server.source.precision;
  const selectedNode = nodes.find(node => node.id === selection?.id) ?? null;
  const mappingNeedsInput = workspace.canvas.mappingStatus === 'awaiting_precision_binding';

  return (
    <main className={styles.workspace} data-testid="ai-design-v10-workspace" dir={langDir(lang)}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NEXYFAB AI DESIGN · V10</p>
          <h1>{text.title}</h1>
        </div>
        <div className={styles.revision} aria-label="Server revision">
          R{workspace.revisions.runtime} · C{workspace.revisions.complex}
          <span className={workspace.recovery.mutationEnabled ? styles.online : styles.blocked}>{workspace.recovery.state}</span>
        </div>
      </header>

      <section className={styles.chatRail} aria-label={text.conversationAria}>
        <div className={styles.sectionHeading}>
          <div><span>01</span><h2>{text.chat}</h2></div>
          <button type="button" onClick={onRefresh} disabled={busy}>{text.refresh}</button>
        </div>
        <p className={styles.stage}>{workspace.chat.stage}</p>
        {cards.map(card => (
          <article className={styles.card} key={card.cardId} data-card-kind={card.kind}>
            <div className={styles.cardMeta}><span>{card.kind}</span><span>{card.status}</span></div>
            <h3>{card.title}</h3>
            <p>{card.summary}</p>
            <div className={styles.actions}>
              {card.actions.map(action => (
                <button
                  key={action.id}
                  type="button"
                  className={action.primary ? styles.primary : styles.secondary}
                  disabled={busy || !action.enabled || (action.id === 'APPLY_CONCEPT_CHANGE' && !controller.capabilities.conceptApplyEnabled)}
                  title={action.reason ?? undefined}
                  onClick={() => onAction(card, action.id)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </article>
        ))}
        {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
        <div className={styles.authority}>
          <strong>{text.authorityBoundary}</strong>
          <span>{text.conceptOnly}</span>
          <span>Exact CAD: Precision CAD · Release: false</span>
        </div>
        <section className={styles.complexScope} data-testid="complex-product-commercial-scope">
          <strong>{complexScope.badge}</strong>
          <span>{complexScope.families}</span>
          <span>{complexScope.boundary}</span>
          <ol>{complexScope.gates.map((gate, index) => <li key={gate}><b>{index + 1}</b>{gate}</li>)}</ol>
        </section>
      </section>

      <section className={styles.canvasArea} aria-label={text.linkedCanvas}>
        <div className={styles.canvasToolbar}>
          <div role="group" aria-label="Canvas mode">
            {(['2d', '3d', 'split'] as const).map(item => (
              <button type="button" key={item} aria-pressed={mode === item} onClick={() => onCanvasMode(item)}>{item.toUpperCase()}</button>
            ))}
          </div>
          <button type="button" onClick={() => document.querySelector<HTMLElement>(`.${styles.canvasStage}`)?.requestFullscreen?.()}>
            {text.fullScreen}
          </button>
        </div>
        <div className={`${styles.canvasStage} ${mode === 'split' ? styles.split : ''}`}>
          {(mode === '2d' || mode === 'split') && (
            <div className={styles.viewPane} data-testid="concept-2d-view">
              <span className={styles.viewLabel}>2D · CONCEPT</span>
              <svg viewBox="0 0 720 420" role="img" aria-label="Linked 2D concept structure">
                <defs><pattern id="ai-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#20324a" strokeWidth="1" /></pattern></defs>
                <rect width="720" height="420" fill="url(#ai-grid)" />
                {nodes.map((node, index) => {
                  const x = 42 + (index % 5) * 132;
                  const y = 56 + Math.floor(index / 5) * 92 + node.depth * 8;
                  const selected = node.id === selection?.id;
                  return <g key={node.id} role="button" tabIndex={0} aria-label={node.label} onClick={() => onSelect(node.id, node.kind)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onSelect(node.id, node.kind); }}>
                    <rect x={x} y={y} width="108" height="54" rx="7" className={selected ? styles.svgSelected : styles.svgNode} />
                    <text x={x + 9} y={y + 23} className={styles.svgText}>{node.label.slice(0, 15)}</text>
                    <text x={x + 9} y={y + 41} className={styles.svgSub}>{node.kind} · {node.heat}</text>
                  </g>;
                })}
              </svg>
            </div>
          )}
          {(mode === '3d' || mode === 'split') && (
            <div className={styles.viewPane} data-testid="concept-3d-view">
              <span className={styles.viewLabel}>3D · CONCEPT</span>
              {renderThree
                ? <ConceptCanvas3d nodes={nodes} selectedId={selection?.id ?? null} onSelect={onSelect} />
                : <div className={styles.canvasLoading}>3D renderer test boundary</div>}
            </div>
          )}
          {!nodes.length && <div className={styles.emptyCanvas}>{text.emptyCanvas}</div>}
        </div>
        <div className={styles.syncBar}>
          <span>Linked selection: {selectedNode?.label ?? '—'}</span>
          <span>{mappingNeedsInput ? 'NEEDS_INPUT · Precision mapping required' : 'Stable ID mapping ready'}</span>
          <span>Preview: {preview ? 'NOT_RUN / nonpersistent' : controller.preview.status}</span>
        </div>
      </section>

      <button type="button" className={styles.inspectorToggle} aria-expanded={inspectorOpen} aria-controls="ai-design-inspector" onClick={() => setInspectorOpen(open => !open)}>
        {text.inspector}
      </button>
      <aside id="ai-design-inspector" className={`${styles.inspector} ${inspectorOpen ? styles.inspectorOpen : ''}`} aria-label={text.inspector}>
        <div className={styles.sectionHeading}><div><span>03</span><h2>{text.inspector}</h2></div><button type="button" className={styles.inspectorClose} onClick={() => setInspectorOpen(false)}>{text.close}</button></div>
        <section>
          <h3>{text.model}</h3>
          <dl><dt>ID</dt><dd>{workspace.model.publicModelId ?? 'not selected'}</dd><dt>Status</dt><dd>{workspace.model.selectionStatus}</dd></dl>
          {workspace.model.explanation.map(item => <code key={item}>{item}</code>)}
        </section>
        <section>
          <h3>{text.gaugePreview}</h3>
          {gauges.length ? gauges.slice(0, 8).map(gauge => <div className={styles.gauge} key={gauge.gaugeId}>
            <span>{gauge.label}</span><strong>{gauge.targetValue} {gauge.unit}</strong>
          </div>) : <p>—</p>}
          <div className={styles.segmented} role="group" aria-label="Gauge step">
            <button type="button" aria-pressed={gaugeMode === 'fine'} onClick={() => onGaugeMode('fine')}>Fine</button>
            <button type="button" aria-pressed={gaugeMode === 'coarse'} onClick={() => onGaugeMode('coarse')}>Coarse</button>
            <button type="button" aria-pressed={gaugeDirection === -1} onClick={() => onGaugeDirection(-1)}>−</button>
            <button type="button" aria-pressed={gaugeDirection === 1} onClick={() => onGaugeDirection(1)}>+</button>
          </div>
        </section>
        <section>
          <h3>{text.validationPrecision}</h3>
          <dl><dt>Geometry</dt><dd>{preview ? 'NOT_RUN' : 'NOT_RUN'}</dd><dt>Precision</dt><dd>{precision.status}</dd><dt>Requests</dt><dd>{precision.requestIds.length}</dd><dt>Release</dt><dd>false</dd></dl>
        </section>
      </aside>
    </main>
  );
}
