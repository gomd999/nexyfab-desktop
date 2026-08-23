/** @vitest-environment jsdom */
/**
 * AssemblyAiPanel — Phase 3.AI.Assembly chat-panel tests.
 *
 * Coverage matrix:
 *   - Send button disabled on empty / whitespace input.
 *   - Send button enabled once non-whitespace input is present.
 *   - Regex hit ("3 stacked") → preview shows summary + part list + mates +
 *     "regex" source badge. No fetcher call.
 *   - Apply → onBuildAssembly called with the regex plan, input + preview cleared.
 *   - "ring of 6 radius 25" regex path with radius preserved in summary.
 *   - "2 x 3 grid spacing 50" regex path.
 *   - "pair concentric" regex path with single mate row.
 *   - LLM fallback path: regex miss → injected fetcher returns a plan → preview + "LLM" badge.
 *   - LLM fallback null → "Could not understand" status, Apply hidden.
 *   - LLM fallback throws → error status.
 *   - LLM fallback returns kind:'unparsed' → "Could not understand".
 *   - 6-lang label rendering.
 *   - Stacked preview caps at 12 part rows for runaway counts (e.g., 100 stacked).
 *   - Detection in flight disables Send.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import AssemblyAiPanel, {
  type AssemblyAiLang,
} from '@/app/[lang]/shape-generator/assembly/AssemblyAiPanel';
import type { AssemblyPlan } from '@/lib/ai/assemblyNlParser';

function typeInto(testId: string, value: string): void {
  const el = screen.getByTestId(testId) as HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

describe('AssemblyAiPanel', () => {
  it('shows the next fail-closed stage for a decomposed multi-part product', async () => {
    const fetcher = vi.fn().mockResolvedValue(null);
    const program = {
      version: 1, units: 'mm', classification: 'review_required', name: 'Robot', unresolved: [],
      assembly: { parts: [{ id: 'base', name: 'Base', partTemplateId: 'base', position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: true }], mates: [] },
      parts: [{ instanceId: 'base', featureTree: { nodes: [] }, metadata: { partNumber: 'R-001', revision: 'A', quantity: 1, source: 'confirmed' } }],
    };
    let generationRevision = 0;
    const stages = ['intent', 'decomposition', 'interfaces', 'part_programs'];
    const generationState = () => ({ schema: 'nexyfab.generation-run.v1', runId: 'ui', revision: generationRevision,
      stages: Object.fromEntries(stages.map((stage, index) => [stage, { status: generationRevision > index ? 'passed' : 'pending', ...(generationRevision > index ? { checkpointHash: 'a'.repeat(64) } : {}) }])), verifiedPartArtifacts: {} });
    const remote = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.includes('/generation/state')) return new Response(JSON.stringify({ ok: true, state: generationState() }), { status: 200 });
      if (url.includes('/generation/refine')) {
        const stage = stages[generationRevision]!; generationRevision++;
        return new Response(JSON.stringify({ ok: true, state: generationState(), draft: { output: { stage }, evidenceRefs: [`e:${stage}`] }, decision: { disposition: 'advance', reasons: [] }, ...(stage === 'part_programs' ? { program } : {}) }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, releaseReady: false, decision: { stage: 'part_geometry', status: 'blocked', errors: ['base: Manufacturing verification is pending.'], warnings: [] } }), { status: 200 });
    });
    render(<AssemblyAiPanel lang="en" intentFetcher={fetcher} onBuildAssembly={vi.fn()} onBuildProduct={vi.fn()} />);
    fireEvent.change(screen.getByTestId('assembly-ai-input'), { target: { value: 'build an articulated industrial robot with reducers' } });
    fireEvent.click(screen.getByTestId('assembly-ai-send'));
    expect(await screen.findByTestId('assembly-ai-release-status')).toHaveTextContent('Concept only · next: part_geometry');
    expect(remote.mock.calls.map(call => String(call[0]))).toEqual(['/api/cad/v1/generation/state', '/api/cad/v1/generation/refine', '/api/cad/v1/generation/refine', '/api/cad/v1/generation/refine', '/api/cad/v1/generation/refine', '/api/cad/v1/generation/verify']);
    remote.mockRestore();
  });
  it('renders the panel with input, send button, and no preview by default', () => {
    render(<AssemblyAiPanel lang="en" onBuildAssembly={vi.fn()} />);
    expect(screen.getByTestId('assembly-ai-panel')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-ai-input')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-ai-send')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-preview-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-apply')).not.toBeInTheDocument();
  });

  it('Send is disabled when input is empty', () => {
    render(<AssemblyAiPanel lang="en" onBuildAssembly={vi.fn()} />);
    expect(screen.getByTestId('assembly-ai-send')).toBeDisabled();
  });

  it('Send is disabled when input is only whitespace', () => {
    render(<AssemblyAiPanel lang="en" onBuildAssembly={vi.fn()} />);
    typeInto('assembly-ai-input', '   \n\t  ');
    expect(screen.getByTestId('assembly-ai-send')).toBeDisabled();
  });

  it('Send is enabled once non-whitespace input is present', () => {
    render(<AssemblyAiPanel lang="en" onBuildAssembly={vi.fn()} />);
    typeInto('assembly-ai-input', '3 stacked');
    expect(screen.getByTestId('assembly-ai-send')).not.toBeDisabled();
  });

  it('regex hit "3 stacked" → preview shows stacked summary + 3 parts + 2 mates + regex badge', async () => {
    const fetcher = vi.fn();
    render(
      <AssemblyAiPanel lang="en" intentFetcher={fetcher} onBuildAssembly={vi.fn()} />,
    );
    typeInto('assembly-ai-input', '3 stacked');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-preview-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('assembly-ai-preview-summary')).toHaveTextContent(
      /stacked 3 parts/i,
    );
    expect(screen.getByTestId('assembly-ai-source-badge')).toHaveAttribute('data-source', 'regex');
    expect(screen.getByTestId('assembly-ai-preview-part-0')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-ai-preview-part-1')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-ai-preview-part-2')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-preview-part-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('assembly-ai-preview-mate-0')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-ai-preview-mate-1')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-preview-mate-2')).not.toBeInTheDocument();
    // regex short-circuits — fetcher must NOT be invoked.
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('Apply invokes onBuildAssembly with the resolved plan and clears input + preview', async () => {
    const onBuild = vi.fn();
    render(<AssemblyAiPanel lang="en" onBuildAssembly={onBuild} />);
    typeInto('assembly-ai-input', '3 stacked');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-apply')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('assembly-ai-apply'));

    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onBuild).toHaveBeenCalledWith({ kind: 'stacked', count: 3 });
    // Input cleared.
    expect((screen.getByTestId('assembly-ai-input') as HTMLTextAreaElement).value).toBe('');
    // Preview cleared.
    expect(screen.queryByTestId('assembly-ai-preview-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-apply')).not.toBeInTheDocument();
  });

  it('regex "ring of 6 radius 25" → summary includes radius, source=regex', async () => {
    render(<AssemblyAiPanel lang="en" onBuildAssembly={vi.fn()} />);
    typeInto('assembly-ai-input', 'ring of 6 radius 25');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-preview-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('assembly-ai-preview-summary')).toHaveTextContent(
      /ring of 6 parts.*radius 25mm/i,
    );
    expect(screen.getByTestId('assembly-ai-preview-part-5')).toBeInTheDocument();
    // ring has no mates in the Phase 1 IR.
    expect(screen.queryByTestId('assembly-ai-preview-mate-0')).not.toBeInTheDocument();
  });

  it('regex "2 x 3 grid spacing 50" → summary includes spacing, 6 parts, no mates', async () => {
    render(<AssemblyAiPanel lang="en" onBuildAssembly={vi.fn()} />);
    typeInto('assembly-ai-input', '2 x 3 grid spacing 50');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-preview-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('assembly-ai-preview-summary')).toHaveTextContent(
      /2 x 3 grid.*spacing 50mm/i,
    );
    expect(screen.getByTestId('assembly-ai-preview-part-5')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-preview-part-6')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-preview-mate-0')).not.toBeInTheDocument();
  });

  it('regex "pair concentric" → 2 parts + 1 concentric mate', async () => {
    render(<AssemblyAiPanel lang="en" onBuildAssembly={vi.fn()} />);
    typeInto('assembly-ai-input', 'pair concentric');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-preview-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('assembly-ai-preview-summary')).toHaveTextContent(/pair/i);
    expect(screen.getByTestId('assembly-ai-preview-summary')).toHaveTextContent(/concentric/i);
    expect(screen.getByTestId('assembly-ai-preview-part-0')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-ai-preview-part-1')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-preview-part-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('assembly-ai-preview-mate-0')).toHaveTextContent(/concentric/i);
  });

  it('LLM fallback: regex miss → fetcher invoked → "LLM" source badge', async () => {
    const llmPlan: AssemblyPlan = { kind: 'stacked', count: 4 };
    const fetcher = vi.fn().mockResolvedValue(llmPlan);
    render(
      <AssemblyAiPanel
        lang="en"
        intentFetcher={fetcher}
        onBuildAssembly={vi.fn()}
      />,
    );
    typeInto('assembly-ai-input', 'four widgets stuck on top of each other');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-preview-summary')).toBeInTheDocument();
    });
    expect(fetcher).toHaveBeenCalledWith('four widgets stuck on top of each other');
    expect(screen.getByTestId('assembly-ai-source-badge')).toHaveAttribute('data-source', 'llm');
    expect(screen.getByTestId('assembly-ai-preview-summary')).toHaveTextContent(
      /stacked 4 parts/i,
    );
  });

  it('LLM fallback returns null → "Could not understand" + no Apply', async () => {
    const fetcher = vi.fn().mockResolvedValue(null);
    render(
      <AssemblyAiPanel
        lang="en"
        intentFetcher={fetcher}
        onBuildAssembly={vi.fn()}
      />,
    );
    typeInto('assembly-ai-input', 'gibberish input the LLM cannot parse');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-status')).toHaveTextContent(
        /Could not understand/i,
      );
    });
    expect(screen.queryByTestId('assembly-ai-apply')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-preview-summary')).not.toBeInTheDocument();
  });

  it('LLM fallback returns {kind:"unparsed"} → "Could not understand"', async () => {
    const fetcher = vi.fn().mockResolvedValue({ kind: 'unparsed' });
    render(
      <AssemblyAiPanel
        lang="en"
        intentFetcher={fetcher}
        onBuildAssembly={vi.fn()}
      />,
    );
    typeInto('assembly-ai-input', 'something the LLM also gives up on');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-status')).toHaveTextContent(
        /Could not understand/i,
      );
    });
    expect(screen.queryByTestId('assembly-ai-apply')).not.toBeInTheDocument();
  });

  it('LLM fallback throws → error status (no crash)', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <AssemblyAiPanel
        lang="en"
        intentFetcher={fetcher}
        onBuildAssembly={vi.fn()}
      />,
    );
    typeInto('assembly-ai-input', 'phrase not matched by regex');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-status')).toHaveTextContent(/network down/);
    });
    expect(screen.queryByTestId('assembly-ai-apply')).not.toBeInTheDocument();
  });

  it.each<[AssemblyAiLang, RegExp]>([
    ['ko', /AI 어셈블리 빌더/],
    ['en', /AI Assembly Builder/i],
    ['ja', /AI アセンブリビルダー/],
    ['zh', /AI 装配生成器/],
    ['es', /Constructor de ensamblaje IA/i],
    ['ar', /منشئ التجميع/],
  ])('renders %s panel title', (lang, titleRe) => {
    render(<AssemblyAiPanel lang={lang} onBuildAssembly={vi.fn()} />);
    const panel = screen.getByTestId('assembly-ai-panel');
    expect(panel).toHaveTextContent(titleRe);
    // RTL flag for Arabic.
    if (lang === 'ar') {
      expect(panel.getAttribute('dir')).toBe('rtl');
    } else {
      expect(panel.getAttribute('dir')).toBe('ltr');
    }
  });

  it('preview caps at 12 part rows even when plan.count is huge', async () => {
    render(<AssemblyAiPanel lang="en" onBuildAssembly={vi.fn()} />);
    typeInto('assembly-ai-input', '100 stacked');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-preview-summary')).toBeInTheDocument();
    });
    // Cap is 12 — index 11 exists, index 12 doesn't.
    expect(screen.getByTestId('assembly-ai-preview-part-11')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-ai-preview-part-12')).not.toBeInTheDocument();
    // The full count is still preserved in the summary text.
    expect(screen.getByTestId('assembly-ai-preview-summary')).toHaveTextContent(
      /stacked 100 parts/i,
    );
  });

  it('Send is disabled while detection is in flight', async () => {
    let resolveFn: (p: AssemblyPlan | null) => void = () => {};
    const pending = new Promise<AssemblyPlan | null>((res) => {
      resolveFn = res;
    });
    const fetcher = vi.fn().mockReturnValue(pending);
    render(
      <AssemblyAiPanel
        lang="en"
        intentFetcher={fetcher}
        onBuildAssembly={vi.fn()}
      />,
    );
    typeInto('assembly-ai-input', 'phrase the regex skips');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    // Send goes disabled while the LLM call is pending, status shows "Detecting".
    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-status')).toHaveTextContent(/Detecting/i);
    });
    expect(screen.getByTestId('assembly-ai-send')).toBeDisabled();

    resolveFn({ kind: 'pair', mate: 'hinge' });
    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-preview-summary')).toBeInTheDocument();
    });
    // Once the plan is resolved, Send is enabled again (input still has text).
    expect(screen.getByTestId('assembly-ai-send')).not.toBeDisabled();
  });

  it('regex hit short-circuits — fetcher is never called even when both inputs would parse', async () => {
    const fetcher = vi.fn().mockResolvedValue({ kind: 'unparsed' });
    render(
      <AssemblyAiPanel
        lang="en"
        intentFetcher={fetcher}
        onBuildAssembly={vi.fn()}
      />,
    );
    typeInto('assembly-ai-input', '5 stacked');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-preview-summary')).toBeInTheDocument();
    });
    expect(fetcher).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('assembly-ai-source-badge')).toHaveAttribute('data-source', 'regex');
  });

  it('Apply on a pair plan forwards the mate kind to onBuildAssembly', async () => {
    const onBuild = vi.fn();
    render(<AssemblyAiPanel lang="en" onBuildAssembly={onBuild} />);
    typeInto('assembly-ai-input', 'pair hinge');
    fireEvent.click(screen.getByTestId('assembly-ai-send'));

    await waitFor(() => {
      expect(screen.getByTestId('assembly-ai-apply')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('assembly-ai-apply'));
    expect(onBuild).toHaveBeenCalledWith({ kind: 'pair', mate: 'hinge' });
  });
});
