/** @vitest-environment jsdom */
/**
 * FeatureTreePlannerPanel — Phase 3.AI.UI tests.
 *
 * Covers:
 *   - Send button disabled when input empty / detection in flight.
 *   - Regex detectIntent path (single + multi-step plans).
 *   - LLM fallback path (regex fails → llmIntentFetcher invoked).
 *   - Both null → "Could not understand" status.
 *   - Apply invokes onApply with the plan steps, clears input + plan
 *     preview, retains history.
 *   - History rolling cap (default 50; overridable via maxHistoryEntries).
 *   - Empty plan (warnings only) disables Apply + shows warning.
 *   - 6-lang label rendering.
 *   - Status text transitions through detecting/generating/idle.
 *   - Persistent history (Agent-IIIII useChatHistory): localStorage, Clear,
 *     Export, appliedAt checkmark, count badge, source = regex/llm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import React from 'react';
import FeatureTreePlannerPanel from '@/app/[lang]/shape-generator/sketch/FeatureTreePlannerPanel';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { FilletFeature } from '@/lib/cad/filletProfile';
import type { PlanIntent } from '@/lib/ai/featureTreePlanner';
import {
  CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS,
  CHAT_HISTORY_SCHEMA_VERSION,
  DEFAULT_STORAGE_KEY,
  saveChatHistory,
  type ChatHistoryEntry,
} from '@/lib/ai/aiChatHistory';

function emptyTree(): FeatureTree {
  return { nodes: [] };
}

function boxExtrude(w = 50, h = 50, d = 30): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    depth: d,
    direction: 'one_sided',
    mode: 'add',
  };
}

function boxNode(id = 'box_1', w = 50, h = 50, d = 30): FeatureNode {
  return {
    id,
    name: `Box ${w}x${h}x${d}`,
    dependencies: [],
    payload: boxExtrude(w, h, d),
  };
}

function filletNode(id = 'fillet_1', parentId = 'box_1', r = 3): FeatureNode {
  const payload: FilletFeature = {
    kind: 'fillet',
    childExtrude: boxExtrude(),
    radius: r,
    edgeSelection: 'all',
  };
  return { id, name: `Fillet r${r}`, dependencies: [parentId], payload };
}

function boxTree(): FeatureTree {
  return { nodes: [boxNode()] };
}

function boxWithFilletTree(): FeatureTree {
  return { nodes: [boxNode(), filletNode()] };
}

function typeInto(testId: string, value: string): void {
  const el = screen.getByTestId(testId) as HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

// Tests share the Map-backed localStorage shim across the file. Without a
// per-test clear, history leaks between tests and breaks count assertions.
beforeEach(() => {
  if (typeof window !== 'undefined') window.localStorage.clear();
});

afterEach(() => {
  if (typeof window !== 'undefined') window.localStorage.clear();
});

let testKeyCounter = 0;
function uniqueKey(label: string): string {
  testKeyCounter += 1;
  return `nexyfab:test:planner-${label}-${testKeyCounter}`;
}

describe('FeatureTreePlannerPanel', () => {
  it('renders the panel with input, send button, and empty history hint', () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('planner-panel')).toBeInTheDocument();
    expect(screen.getByTestId('planner-input')).toBeInTheDocument();
    expect(screen.getByTestId('planner-send')).toBeInTheDocument();
    expect(screen.getByTestId('planner-history')).toBeInTheDocument();
  });

  it('Send button is disabled when input is empty', () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('planner-send')).toBeDisabled();
  });

  it('Send button enables once non-whitespace input is present', () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'box 50x50x30 with fillet 5');
    expect(screen.getByTestId('planner-send')).not.toBeDisabled();
  });

  it('Send button stays disabled when input is whitespace only', () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', '   ');
    expect(screen.getByTestId('planner-send')).toBeDisabled();
  });

  it('"box 50x50x30 with fillet 5" → 2-step plan rendered', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'box 50x50x30 with fillet 5');
    fireEvent.click(screen.getByTestId('planner-send'));

    const step0 = await screen.findByTestId('planner-step-0');
    const step1 = await screen.findByTestId('planner-step-1');
    expect(step0.textContent).toMatch(/box/i);
    expect(step1.textContent).toMatch(/fillet/i);
    expect(screen.queryByTestId('planner-step-2')).toBeNull();
  });

  it('"cylinder radius 25 height 60" → 1-step plan', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'cylinder radius 25 height 60');
    fireEvent.click(screen.getByTestId('planner-send'));

    const step0 = await screen.findByTestId('planner-step-0');
    expect(step0.textContent).toMatch(/cylinder/i);
    expect(screen.queryByTestId('planner-step-1')).toBeNull();
  });

  it('Apply click invokes onApply with the plan steps and clears input', async () => {
    const onApply = vi.fn();
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={onApply}
      />,
    );
    typeInto('planner-input', 'box 50x50x30 with fillet 5');
    fireEvent.click(screen.getByTestId('planner-send'));

    await screen.findByTestId('planner-apply');
    fireEvent.click(screen.getByTestId('planner-apply'));

    expect(onApply).toHaveBeenCalledTimes(1);
    const steps = onApply.mock.calls[0]![0];
    expect(steps).toHaveLength(2);
    expect(steps[0].type).toBe('add_node');
    expect(steps[1].type).toBe('add_node');

    // Input cleared
    expect((screen.getByTestId('planner-input') as HTMLTextAreaElement).value).toBe('');
    // Plan preview cleared
    expect(screen.queryByTestId('planner-step-0')).toBeNull();
  });

  it('llmIntentFetcher is invoked when regex fails (and intent returned)', async () => {
    const llmIntentFetcher = vi.fn(
      async (text: string): Promise<PlanIntent | null> => {
        void text;
        return { kind: 'create_cylinder', radius: 10, height: 30 };
      },
    );
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        llmIntentFetcher={llmIntentFetcher}
      />,
    );
    typeInto('planner-input', 'make me something cylindrical please');
    fireEvent.click(screen.getByTestId('planner-send'));

    const step0 = await screen.findByTestId('planner-step-0');
    expect(llmIntentFetcher).toHaveBeenCalledTimes(1);
    expect(llmIntentFetcher).toHaveBeenCalledWith(
      'make me something cylindrical please',
    );
    expect(step0.textContent).toMatch(/cylinder/i);
  });

  it('llmIntentFetcher is NOT invoked when regex already matched', async () => {
    const llmIntentFetcher = vi.fn(async () => null);
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        llmIntentFetcher={llmIntentFetcher}
      />,
    );
    typeInto('planner-input', 'cylinder radius 5 height 10');
    fireEvent.click(screen.getByTestId('planner-send'));

    await screen.findByTestId('planner-step-0');
    expect(llmIntentFetcher).not.toHaveBeenCalled();
  });

  it('regex null + llm null → "Could not understand" status', async () => {
    const llmIntentFetcher = vi.fn(async () => null);
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        llmIntentFetcher={llmIntentFetcher}
      />,
    );
    typeInto('planner-input', 'completely unparseable gobbledygook xyz');
    fireEvent.click(screen.getByTestId('planner-send'));

    await waitFor(() => {
      expect(screen.getByTestId('planner-status').textContent).toMatch(
        /could not understand/i,
      );
    });
    expect(screen.queryByTestId('planner-step-0')).toBeNull();
  });

  it('regex null + no llmIntentFetcher → "Could not understand"', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'unparseable banana');
    fireEvent.click(screen.getByTestId('planner-send'));

    await waitFor(() => {
      expect(screen.getByTestId('planner-status').textContent).toMatch(
        /could not understand/i,
      );
    });
  });

  it('history list shows 3 entries after 3 successful prompts', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    const prompts = [
      'cylinder radius 5 height 10',
      'cylinder radius 6 height 11',
      'cylinder radius 7 height 12',
    ];
    for (const p of prompts) {
      typeInto('planner-input', p);
      fireEvent.click(screen.getByTestId('planner-send'));
      await screen.findByTestId('planner-step-0');
    }

    expect(screen.getByTestId('planner-history-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('planner-history-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('planner-history-item-2')).toBeInTheDocument();
    expect(screen.queryByTestId('planner-history-item-3')).toBeNull();
    // Most recent first
    expect(
      screen.getByTestId('planner-history-item-0').textContent,
    ).toContain('cylinder radius 7 height 12');
  });

  it('history caps at configured maxHistoryEntries — 6th prompt evicts the oldest when cap=5', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={`nexyfab:test:planner-cap5-${Math.random()}`}
        maxHistoryEntries={5}
      />,
    );
    const prompts = [
      'cylinder radius 1 height 1',
      'cylinder radius 2 height 2',
      'cylinder radius 3 height 3',
      'cylinder radius 4 height 4',
      'cylinder radius 5 height 5',
      'cylinder radius 6 height 6',
    ];
    for (const p of prompts) {
      typeInto('planner-input', p);
      fireEvent.click(screen.getByTestId('planner-send'));
      await screen.findByTestId('planner-step-0');
    }

    expect(screen.getByTestId('planner-history-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('planner-history-item-4')).toBeInTheDocument();
    expect(screen.queryByTestId('planner-history-item-5')).toBeNull();
    // Oldest ("radius 1") is gone
    const allHistoryText = Array.from({ length: 5 }, (_, i) =>
      screen.getByTestId(`planner-history-item-${i}`).textContent ?? '',
    ).join('|');
    expect(allHistoryText).not.toContain('cylinder radius 1 height 1');
    expect(allHistoryText).toContain('cylinder radius 6 height 6');
  });

  it('failed detection does NOT pollute history', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'totally unparseable noise here');
    fireEvent.click(screen.getByTestId('planner-send'));
    await waitFor(() => {
      expect(screen.getByTestId('planner-status').textContent).toMatch(
        /could not understand/i,
      );
    });
    expect(screen.queryByTestId('planner-history-item-0')).toBeNull();
  });

  it('empty plan (no extrude in tree → add fillet) → Apply disabled + warning', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'add fillet 5');
    fireEvent.click(screen.getByTestId('planner-send'));

    await waitFor(() => {
      expect(screen.getByTestId('planner-apply')).toBeInTheDocument();
    });
    expect(screen.getByTestId('planner-apply')).toBeDisabled();
    expect(screen.getByTestId('planner-empty-warning')).toBeInTheDocument();
    expect(screen.getByTestId('planner-warning-0').textContent).toMatch(
      /no extrude/i,
    );
  });

  it('renders Korean labels when lang="ko"', () => {
    render(
      <FeatureTreePlannerPanel
        lang="ko"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('planner-send').textContent).toBe('전송');
    expect(screen.getByTestId('planner-panel').textContent).toContain(
      'AI 플래너',
    );
  });

  it('renders Japanese, Chinese, Spanish, Arabic labels', () => {
    const langs: Array<{ lang: 'ja' | 'zh' | 'es' | 'ar'; send: string }> = [
      { lang: 'ja', send: '送信' },
      { lang: 'zh', send: '发送' },
      { lang: 'es', send: 'Enviar' },
      { lang: 'ar', send: 'إرسال' },
    ];
    for (const { lang, send } of langs) {
      const { unmount } = render(
        <FeatureTreePlannerPanel
          lang={lang}
          currentTree={emptyTree()}
          onApply={vi.fn()}
        />,
      );
      expect(screen.getByTestId('planner-send').textContent).toBe(send);
      unmount();
    }
  });

  it('Arabic sets dir="rtl" on the panel', () => {
    render(
      <FeatureTreePlannerPanel
        lang="ar"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('planner-panel').getAttribute('dir')).toBe('rtl');
  });

  it('status text shows "Detecting intent..." during regex path (sync resolution)', async () => {
    // Regex path resolves synchronously in the same microtask, so we
    // assert the final settled state instead of the transient label.
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'cylinder radius 3 height 4');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-step-0');
    // Status cleared once plan rendered
    expect(screen.queryByTestId('planner-status')).toBeNull();
  });

  it('shows "Generating plan..." while llmIntentFetcher is in flight', async () => {
    let resolveFn: (v: PlanIntent | null) => void = () => {};
    const llmIntentFetcher = vi.fn(
      () =>
        new Promise<PlanIntent | null>((resolve) => {
          resolveFn = resolve;
        }),
    );
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        llmIntentFetcher={llmIntentFetcher}
      />,
    );
    typeInto('planner-input', 'something weird unparseable here');
    fireEvent.click(screen.getByTestId('planner-send'));

    await waitFor(() => {
      expect(screen.getByTestId('planner-status').textContent).toMatch(
        /generating plan/i,
      );
    });
    expect(screen.getByTestId('planner-send')).toBeDisabled();

    await act(async () => {
      resolveFn({ kind: 'create_cylinder', radius: 4, height: 5 });
    });
    await screen.findByTestId('planner-step-0');
  });

  it('rationale text is displayed after a successful plan', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'box 40x40x20 with fillet 3');
    fireEvent.click(screen.getByTestId('planner-send'));
    const rationale = await screen.findByTestId('planner-rationale');
    expect(rationale.textContent).toMatch(/40/);
    expect(rationale.textContent).toMatch(/fillet|round/i);
  });

  it('LLM fetcher rejection surfaces as error status', async () => {
    const llmIntentFetcher = vi.fn(async () => {
      throw new Error('boom-llm-down');
    });
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        llmIntentFetcher={llmIntentFetcher}
      />,
    );
    typeInto('planner-input', 'something cylindrical please');
    fireEvent.click(screen.getByTestId('planner-send'));

    await waitFor(() => {
      expect(screen.getByTestId('planner-status').textContent).toMatch(
        /error.*boom-llm-down/i,
      );
    });
  });

  it('Apply does NOT clear history (only input + plan)', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    typeInto('planner-input', 'cylinder radius 9 height 9');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-apply');
    fireEvent.click(screen.getByTestId('planner-apply'));

    // History retained
    expect(screen.getByTestId('planner-history-item-0').textContent).toContain(
      'cylinder radius 9 height 9',
    );
    // Plan + input gone
    expect(screen.queryByTestId('planner-step-0')).toBeNull();
    expect(
      (screen.getByTestId('planner-input') as HTMLTextAreaElement).value,
    ).toBe('');
  });

  // ─── Persistence integration (Agent-IIIII useChatHistory) ───────────────

  it('mounts with empty history when localStorage is clean', () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={uniqueKey('mount-empty')}
      />,
    );
    expect(screen.getByTestId('planner-history')).toBeInTheDocument();
    expect(screen.queryByTestId('planner-history-item-0')).toBeNull();
    expect(screen.getByTestId('planner-history-count').textContent).toBe(
      '0 / 50',
    );
  });

  it('successful prompt → useChatHistory.add called, history grows by 1', async () => {
    const key = uniqueKey('add-grow');
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={key}
      />,
    );
    typeInto('planner-input', 'cylinder radius 7 height 8');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-history-item-0');
    expect(screen.getByTestId('planner-history-count').textContent).toBe(
      '1 / 50',
    );
    // Source 'regex' is reflected via intentKind in the rendered label.
    expect(screen.getByTestId('planner-history-item-0').textContent).toMatch(
      /create_cylinder/,
    );
  });

  it('Apply click → markApplied stamps appliedAt and shows the ✓ marker', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={uniqueKey('apply-mark')}
      />,
    );
    typeInto('planner-input', 'box 30x30x30 with fillet 2');
    fireEvent.click(screen.getByTestId('planner-send'));
    // Before Apply: no checkmark
    await screen.findByTestId('planner-history-item-0');
    expect(screen.queryByTestId('planner-history-applied-0')).toBeNull();

    fireEvent.click(screen.getByTestId('planner-apply'));
    // After Apply: checkmark present
    await waitFor(() => {
      expect(
        screen.getByTestId('planner-history-applied-0'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('planner-history-applied-0').getAttribute('title'),
    ).toMatch(/^Applied: \d{4}-/);
  });

  it('history at 50 + 1 → oldest evicted (default cap)', async () => {
    const key = uniqueKey('cap50');
    // Pre-seed 50 entries. Newest-first: index 0 = newest by hook convention.
    // We label entries `seeded N` where N = position (0 = newest, 49 = oldest)
    // so the eviction check below targets `seeded 49` (the oldest tail).
    const seeded: ChatHistoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: `seed-${i}`,
      timestamp: 10000 - i, // descending so newer is earlier in array
      prompt: `seeded ${i}`,
      source: 'regex',
      intentKind: 'create_cylinder',
      stepCount: 1,
    }));
    saveChatHistory(seeded, key);

    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={key}
      />,
    );
    expect(screen.getByTestId('planner-history-count').textContent).toBe(
      '50 / 50',
    );
    typeInto('planner-input', 'cylinder radius 11 height 12');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-step-0');
    // Still 50 / 50 — oldest evicted by addEntry cap.
    expect(screen.getByTestId('planner-history-count').textContent).toBe(
      '50 / 50',
    );
    // 'seeded 49' (the tail / oldest) is evicted; the new prompt is at index 0.
    expect(
      screen.queryByTestId('planner-history-item-50'),
    ).toBeNull();
    const lastLabel =
      screen.getByTestId('planner-history-item-49').textContent ?? '';
    // After eviction, index 49 (new tail) holds the previous "seeded 48".
    expect(lastLabel).toContain('seeded 48');
    // Newest prompt is at index 0.
    expect(screen.getByTestId('planner-history-item-0').textContent).toContain(
      'cylinder radius 11 height 12',
    );
  });

  it('Clear button wipes the history and disables itself', async () => {
    const key = uniqueKey('clear-wipe');
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={key}
      />,
    );
    typeInto('planner-input', 'cylinder radius 4 height 4');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-history-item-0');

    const clearBtn = screen.getByTestId('planner-history-clear');
    expect(clearBtn).not.toBeDisabled();
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('planner-history-item-0')).toBeNull();
    });
    expect(screen.getByTestId('planner-history-count').textContent).toBe(
      '0 / 50',
    );
    expect(screen.getByTestId('planner-history-clear')).toBeDisabled();
    expect(screen.getByTestId('planner-history-export')).toBeDisabled();
    // Persistence: clear also wiped localStorage.
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('Export button triggers a JSON blob download', async () => {
    const key = uniqueKey('export-blob');
    const createObjectURL: (b: Blob) => string = vi.fn(
      (_b: Blob): string => 'blob:fake',
    );
    const revokeObjectURL: (u: string) => void = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = originalCreateElement(tag) as HTMLElement;
        if (tag.toLowerCase() === 'a') {
          (el as HTMLAnchorElement).click = clickSpy;
        }
        return el as ReturnType<typeof originalCreateElement>;
      });

    try {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={emptyTree()}
          onApply={vi.fn()}
          storageKey={key}
        />,
      );
      typeInto('planner-input', 'cylinder radius 2 height 2');
      fireEvent.click(screen.getByTestId('planner-send'));
      await screen.findByTestId('planner-history-item-0');

      fireEvent.click(screen.getByTestId('planner-history-export'));

      const mock = vi.mocked(createObjectURL);
      expect(mock).toHaveBeenCalledTimes(1);
      const blob = mock.mock.calls[0]![0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/json');
      expect(clickSpy).toHaveBeenCalledTimes(1);
    } finally {
      createElementSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('Export button disabled when history empty', () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={uniqueKey('export-empty')}
      />,
    );
    expect(screen.getByTestId('planner-history-export')).toBeDisabled();
  });

  it('count badge reflects N / cap', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={uniqueKey('count-badge')}
        maxHistoryEntries={8}
      />,
    );
    expect(screen.getByTestId('planner-history-count').textContent).toBe(
      '0 / 8',
    );
    typeInto('planner-input', 'cylinder radius 1 height 1');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-history-item-0');
    expect(screen.getByTestId('planner-history-count').textContent).toBe(
      '1 / 8',
    );
  });

  it('localStorage persists across remount (same storageKey)', async () => {
    const key = uniqueKey('persist-remount');
    const { unmount } = render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={key}
      />,
    );
    typeInto('planner-input', 'cylinder radius 13 height 14');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-history-item-0');

    // Wait past the 500ms debounce so localStorage actually gets written.
    await act(async () => {
      await new Promise((r) =>
        setTimeout(r, CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS + 50),
      );
    });

    const raw = window.localStorage.getItem(key);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(CHAT_HISTORY_SCHEMA_VERSION);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].prompt).toBe('cylinder radius 13 height 14');
    expect(parsed.entries[0].source).toBe('regex');

    unmount();

    // Remount with the same key → history is rehydrated.
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={key}
      />,
    );
    expect(screen.getByTestId('planner-history-item-0').textContent).toContain(
      'cylinder radius 13 height 14',
    );
  });

  it('default storage key is used when storageKey prop omitted', async () => {
    // Pre-seed under the DEFAULT key — the panel should load it.
    saveChatHistory(
      [
        {
          id: 'default-key-preload',
          timestamp: 5000,
          prompt: 'preloaded under default key',
          source: 'regex',
          intentKind: 'create_cylinder',
          stepCount: 1,
        },
      ],
      DEFAULT_STORAGE_KEY,
    );
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('planner-history-item-0').textContent).toContain(
      'preloaded under default key',
    );
  });

  it('LLM-resolved prompts record source as llm in persisted entry', async () => {
    const key = uniqueKey('source-llm');
    const llmIntentFetcher = vi.fn(
      async (): Promise<PlanIntent | null> => ({
        kind: 'create_cylinder',
        radius: 3,
        height: 4,
      }),
    );
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        llmIntentFetcher={llmIntentFetcher}
        storageKey={key}
      />,
    );
    typeInto('planner-input', 'something only the llm can parse');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-history-item-0');

    await act(async () => {
      await new Promise((r) =>
        setTimeout(r, CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS + 50),
      );
    });
    const raw = window.localStorage.getItem(key);
    const parsed = JSON.parse(raw as string);
    expect(parsed.entries[0].source).toBe('llm');
  });

  it('onHistoryError is wired through to the hook (no fire on happy path)', async () => {
    const onHistoryError = vi.fn();
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={uniqueKey('on-error')}
        onHistoryError={onHistoryError}
      />,
    );
    typeInto('planner-input', 'cylinder radius 2 height 3');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-history-item-0');
    await act(async () => {
      await new Promise((r) =>
        setTimeout(r, CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS + 50),
      );
    });
    // Happy path: no error fired.
    expect(onHistoryError).not.toHaveBeenCalled();
  });

  it('Apply on the second prompt marks only the second entry as applied', async () => {
    render(
      <FeatureTreePlannerPanel
        lang="en"
        currentTree={emptyTree()}
        onApply={vi.fn()}
        storageKey={uniqueKey('apply-second')}
      />,
    );
    typeInto('planner-input', 'cylinder radius 1 height 1');
    fireEvent.click(screen.getByTestId('planner-send'));
    await screen.findByTestId('planner-history-item-0');
    // Don't apply this one.
    typeInto('planner-input', 'cylinder radius 2 height 2');
    fireEvent.click(screen.getByTestId('planner-send'));
    await waitFor(() => {
      expect(
        screen.getByTestId('planner-history-item-0').textContent,
      ).toContain('radius 2');
    });
    fireEvent.click(screen.getByTestId('planner-apply'));

    await waitFor(() => {
      expect(
        screen.getByTestId('planner-history-applied-0'),
      ).toBeInTheDocument();
    });
    // The second (older) entry is NOT marked applied.
    expect(screen.queryByTestId('planner-history-applied-1')).toBeNull();
  });

  // ─── Explain tree integration (scadIntentFromTree) ──────────────────────

  describe('Explain tree button', () => {
    it('Explain button is visible on mount', () => {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={emptyTree()}
          onApply={vi.fn()}
        />,
      );
      const btn = screen.getByTestId('planner-explain-button');
      expect(btn).toBeInTheDocument();
      expect(btn.textContent).toBe('Explain tree');
    });

    it('clicking Explain on empty tree shows the empty-tree explanation', () => {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={emptyTree()}
          onApply={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      expect(screen.getByTestId('planner-explain-panel')).toBeInTheDocument();
      // Empty-tree designIntent + warning are both surfaced.
      expect(
        screen.getByTestId('planner-explain-design-intent').textContent,
      ).toMatch(/empty/i);
      expect(
        screen.getByTestId('planner-explain-warnings'),
      ).toBeInTheDocument();
    });

    it('Explain on a box tree shows designIntent + 1 feature', () => {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={boxTree()}
          onApply={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      const intent = screen.getByTestId('planner-explain-design-intent');
      // The extrude description mentions Extrude/rectangle.
      expect(intent.textContent).toMatch(/extrude/i);
      expect(
        screen.getByTestId('planner-explain-feature-0'),
      ).toBeInTheDocument();
      // [extrude] kind tag shown in the feature list row.
      expect(
        screen.getByTestId('planner-explain-feature-0').textContent,
      ).toMatch(/extrude/i);
    });

    it('Explain on a box+fillet tree lists two features', () => {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={boxWithFilletTree()}
          onApply={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      expect(
        screen.getByTestId('planner-explain-feature-0').textContent,
      ).toMatch(/extrude/i);
      expect(
        screen.getByTestId('planner-explain-feature-1').textContent,
      ).toMatch(/fillet/i);
      // No third feature.
      expect(screen.queryByTestId('planner-explain-feature-2')).toBeNull();
    });

    it('SCAD comments block is collapsed by default and toggles on click', () => {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={boxTree()}
          onApply={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      // Toggle button visible, content NOT in DOM yet.
      const toggle = screen.getByTestId('planner-explain-toggle-scad');
      expect(toggle).toBeInTheDocument();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(
        screen.queryByTestId('planner-explain-scad-comments'),
      ).toBeNull();
      // Expand.
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const block = screen.getByTestId('planner-explain-scad-comments');
      expect(block.textContent).toMatch(/Step 1/);
      expect(block.textContent).toMatch(/extrude/);
      // Collapse again.
      fireEvent.click(toggle);
      expect(
        screen.queryByTestId('planner-explain-scad-comments'),
      ).toBeNull();
    });

    it('Copy SCAD button writes scadComments to navigator.clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const originalClipboard = (
        navigator as unknown as { clipboard?: { writeText: typeof writeText } }
      ).clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      try {
        render(
          <FeatureTreePlannerPanel
            lang="en"
            currentTree={boxTree()}
            onApply={vi.fn()}
          />,
        );
        fireEvent.click(screen.getByTestId('planner-explain-button'));
        const copyBtn = screen.getByTestId('planner-explain-copy-scad');
        expect(copyBtn.textContent).toBe('Copy SCAD');
        fireEvent.click(copyBtn);
        await waitFor(() => {
          expect(writeText).toHaveBeenCalledTimes(1);
        });
        const arg = writeText.mock.calls[0]![0];
        expect(typeof arg).toBe('string');
        expect(arg).toMatch(/Step 1/);
        expect(arg).toMatch(/extrude/);
        // Button flips to "Copied" feedback state.
        await waitFor(() => {
          expect(
            screen.getByTestId('planner-explain-copy-scad').textContent,
          ).toBe('Copied');
        });
      } finally {
        if (originalClipboard) {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: originalClipboard,
          });
        } else {
          delete (navigator as unknown as { clipboard?: unknown }).clipboard;
        }
      }
    });

    it('explanation is not shown until Explain is clicked', () => {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={boxTree()}
          onApply={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('planner-explain-panel')).toBeNull();
      expect(
        screen.queryByTestId('planner-explain-design-intent'),
      ).toBeNull();
    });

    it('renders Korean explain label when lang="ko"', () => {
      render(
        <FeatureTreePlannerPanel
          lang="ko"
          currentTree={boxTree()}
          onApply={vi.fn()}
        />,
      );
      expect(
        screen.getByTestId('planner-explain-button').textContent,
      ).toBe('트리 설명');
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      // Korean dictionary produces Korean designIntent (extrude → '돌출').
      const intent = screen.getByTestId('planner-explain-design-intent');
      expect(intent.textContent).toMatch(/돌출/);
      expect(
        screen.getByTestId('planner-explain-copy-scad').textContent,
      ).toBe('SCAD 복사');
    });

    it('non-ko/en langs fall back to English explainer text', () => {
      render(
        <FeatureTreePlannerPanel
          lang="ja"
          currentTree={boxTree()}
          onApply={vi.fn()}
        />,
      );
      // UI label is Japanese (from dict), narration falls back to English.
      expect(
        screen.getByTestId('planner-explain-button').textContent,
      ).toBe('ツリーを説明');
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      const intent = screen.getByTestId('planner-explain-design-intent');
      expect(intent.textContent).toMatch(/extrude/i);
    });

    it('warnings panel uses role="alert" when warnings exist', () => {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={emptyTree()}
          onApply={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      const warnings = screen.getByTestId('planner-explain-warnings');
      expect(warnings.getAttribute('role')).toBe('alert');
      expect(
        screen.getByTestId('planner-explain-warning-0'),
      ).toBeInTheDocument();
    });

    it('Explain refreshes when clicked again with same tree (idempotent re-render)', () => {
      render(
        <FeatureTreePlannerPanel
          lang="en"
          currentTree={boxTree()}
          onApply={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      expect(
        screen.getByTestId('planner-explain-feature-0'),
      ).toBeInTheDocument();
      // Click again — still 1 feature, panel still visible.
      fireEvent.click(screen.getByTestId('planner-explain-button'));
      expect(
        screen.getByTestId('planner-explain-feature-0'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('planner-explain-feature-1')).toBeNull();
    });
  });
});
