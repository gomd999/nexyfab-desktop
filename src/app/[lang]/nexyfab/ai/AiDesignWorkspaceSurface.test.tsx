/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiDesignUnifiedWorkspaceControllerV1 } from '@/lib/ai/aiDesignUnifiedWorkspaceControllerV1';
import { createIntegrationFixtureSourceV1, createIntegrationFixtureV1, INTEGRATION_FIXTURE_KINDS_V1 } from '@/lib/ai/integrationFixtureV1';
import { getAiDesignWorkspaceCopy } from '@/lib/ai/aiDesignWorkspaceI18n';
import { AiDesignWorkspaceSurface } from './AiDesignWorkspaceSurface';

afterEach(cleanup);

describe('AI Design V10 workspace surface', () => {
  it.each(INTEGRATION_FIXTURE_KINDS_V1)('renders the %s fixture through the chat-first 2D/3D shell', kind => {
    const fixture = createIntegrationFixtureV1(kind);
    const source = createIntegrationFixtureSourceV1(kind);
    const controller = createAiDesignUnifiedWorkspaceControllerV1({
      projectId: source.projectId, sessionId: source.sessionId,
      runtimeRevision: source.runtimeRevision, complexRevision: source.complexRevision,
      source, workspace: fixture.workspace,
    });
    render(<AiDesignWorkspaceSurface
      lang="en" workspace={fixture.workspace} controller={controller}
      nodes={[{ id: 'candidate-1', kind: 'candidate', label: 'Candidate 1', depth: 0, heat: 'none' }]}
      gauges={[{ gaugeId: 'gauge-parameter-v1', label: 'Parameter', targetValue: 40, unit: 'unit', fineStep: 1, coarseStep: 5 }]}
      gaugeMode="fine" gaugeDirection={1} renderThree={false}
      onAction={vi.fn()} onSelect={vi.fn()} onCanvasMode={vi.fn()}
      onGaugeMode={vi.fn()} onGaugeDirection={vi.fn()} onRefresh={vi.fn()}
    />);
    expect(screen.getByTestId('ai-design-v10-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('complex-product-commercial-scope')).toHaveTextContent('Complex product · Closed beta');
    expect(screen.getByTestId('complex-product-commercial-scope')).toHaveTextContent('manufacturing release are not guaranteed');
    expect(screen.getByText(getAiDesignWorkspaceCopy('en').surface.exactCadBoundary)).toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(4);
    expect(document.body.textContent).toContain(fixture.workspace.chat.stage);
  });

  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const)('renders native %s shell copy and direction', lang => {
    const fixture = createIntegrationFixtureV1('empty');
    const source = createIntegrationFixtureSourceV1('empty');
    const controller = createAiDesignUnifiedWorkspaceControllerV1({
      projectId: source.projectId, sessionId: source.sessionId, runtimeRevision: source.runtimeRevision,
      complexRevision: source.complexRevision, source, workspace: fixture.workspace,
    });
    render(<AiDesignWorkspaceSurface
      lang={lang} workspace={fixture.workspace} controller={controller} nodes={[]} gauges={[]}
      gaugeMode="fine" gaugeDirection={1} renderThree={false}
      onAction={vi.fn()} onSelect={vi.fn()} onCanvasMode={vi.fn()}
      onGaugeMode={vi.fn()} onGaugeDirection={vi.fn()} onRefresh={vi.fn()}
    />);
    expect(screen.getByRole('heading', { name: getAiDesignWorkspaceCopy(lang).surface.title })).toBeInTheDocument();
    expect(screen.getByText(getAiDesignWorkspaceCopy(lang).surface.exactCadBoundary)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: getAiDesignWorkspaceCopy(lang).surface.canvasModeAria })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: getAiDesignWorkspaceCopy(lang).surface.gaugeStepAria })).toBeInTheDocument();
    expect(screen.getByTestId('ai-design-v10-workspace')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    cleanup();
  });
});
