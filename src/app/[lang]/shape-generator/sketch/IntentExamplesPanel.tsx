'use client';

/**
 * IntentExamplesPanel — Phase 3.AI.UI helper panel that surfaces the
 * `INTENT_EXAMPLES` constant from `llmPrompt.ts` as a click-to-insert
 * suggestion grid.
 *
 * Why a standalone panel (not folded into FeatureTreePlannerPanel)?
 *   - `INTENT_EXAMPLES` is the single source of truth for the LLM prompt;
 *     showing those exact strings to humans guarantees the planner regex
 *     OR LLM will succeed on them, which makes onboarding deterministic.
 *   - The planner panel is already 500+ lines, and tests pin every testid.
 *     Bolting a 12-kind suggestion grid inside it would force surgery on
 *     23 planner-panel tests. Keeping this panel separate means:
 *       - planner tests stay 100% green,
 *       - the wrapper picks the suggestion text + forwards it via a
 *         simple callback (`onSelectExample`),
 *       - this panel can later be reused inside other AI surfaces
 *         (e.g., the FeatureTree right-click "ask AI" menu).
 *
 * Architecture:
 *   - Pure render of `INTENT_EXAMPLES` from `@/lib/ai/llmPrompt`.
 *   - 12 intent kinds are grouped into 4 human-facing categories:
 *       Box      → create_box_with_*
 *       Cylinder → create_cylinder, create_cylinder_with_hole,
 *                  create_revolve_axis (revolve produces a body of
 *                  revolution, conceptually a cylinder family)
 *       Patterns → create_pattern_grid, create_assembly_stack,
 *                  add_pattern_to_last
 *       Modify   → add_fillet_to_last, add_chamfer_to_last
 *   - Each example string renders as a clickable chip; click invokes
 *     `onSelectExample(text)` with the literal example `in` string —
 *     the host (SolverSketchEditorWithExtrude) decides where it lands
 *     (Phase 1 simply funnels it into the planner-input textarea).
 *
 * Test surface (data-testids — all prefixed planner-intent-):
 *   planner-intent-examples-panel,
 *   planner-intent-category-{Box|Cylinder|Patterns|Modify},
 *   planner-intent-example-{kind}-{idx}.
 */

import React from 'react';
import { INTENT_EXAMPLES } from '@/lib/ai/llmPrompt';
import { INTENT_KINDS, type IntentKind } from '@/lib/ai/featureTreeIntentDetector';

export type IntentExamplesLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  panelTitle: string;
  intentCategoryBox: string;
  intentCategoryCylinder: string;
  intentCategoryPatterns: string;
  intentCategoryModify: string;
}

const dict: Record<IntentExamplesLang, Dict> = {
  ko: {
    panelTitle: '예시 프롬프트',
    intentCategoryBox: '박스',
    intentCategoryCylinder: '원기둥',
    intentCategoryPatterns: '패턴',
    intentCategoryModify: '수정',
  },
  en: {
    panelTitle: 'Example prompts',
    intentCategoryBox: 'Box',
    intentCategoryCylinder: 'Cylinder',
    intentCategoryPatterns: 'Patterns',
    intentCategoryModify: 'Modify',
  },
  ja: {
    panelTitle: 'プロンプト例',
    intentCategoryBox: 'ボックス',
    intentCategoryCylinder: 'シリンダー',
    intentCategoryPatterns: 'パターン',
    intentCategoryModify: '修正',
  },
  zh: {
    panelTitle: '示例提示',
    intentCategoryBox: '盒子',
    intentCategoryCylinder: '圆柱',
    intentCategoryPatterns: '阵列',
    intentCategoryModify: '修改',
  },
  es: {
    panelTitle: 'Indicaciones de ejemplo',
    intentCategoryBox: 'Caja',
    intentCategoryCylinder: 'Cilindro',
    intentCategoryPatterns: 'Patrones',
    intentCategoryModify: 'Modificar',
  },
  ar: {
    panelTitle: 'مطالبات نموذجية',
    intentCategoryBox: 'صندوق',
    intentCategoryCylinder: 'أسطوانة',
    intentCategoryPatterns: 'أنماط',
    intentCategoryModify: 'تعديل',
  },
};

type CategoryKey = 'Box' | 'Cylinder' | 'Patterns' | 'Modify';

/**
 * Maps each IntentKind to one of 4 user-facing categories. Kept as a
 * static object (rather than a switch) so the test suite can iterate it
 * to guarantee exhaustive coverage of all 12 INTENT_KINDS.
 */
export const INTENT_CATEGORY_MAP: Record<IntentKind, CategoryKey> = {
  // Box family — 4 kinds, all start with create_box_*
  create_box_with_holes: 'Box',
  create_box_with_fillet: 'Box',
  create_box_with_chamfer: 'Box',
  create_box_with_pocket: 'Box',
  // Cylinder family — 3 kinds (revolve is a body-of-revolution, grouped here)
  create_cylinder: 'Cylinder',
  create_cylinder_with_hole: 'Cylinder',
  create_revolve_axis: 'Cylinder',
  // Patterns — 3 kinds covering grid + assembly stack + last-feature pattern
  create_pattern_grid: 'Patterns',
  create_assembly_stack: 'Patterns',
  add_pattern_to_last: 'Patterns',
  // Modify — 2 kinds that operate on the last feature
  add_fillet_to_last: 'Modify',
  add_chamfer_to_last: 'Modify',
};

const CATEGORY_ORDER: ReadonlyArray<CategoryKey> = ['Box', 'Cylinder', 'Patterns', 'Modify'];

function categoryLabel(d: Dict, cat: CategoryKey): string {
  switch (cat) {
    case 'Box':
      return d.intentCategoryBox;
    case 'Cylinder':
      return d.intentCategoryCylinder;
    case 'Patterns':
      return d.intentCategoryPatterns;
    case 'Modify':
      return d.intentCategoryModify;
  }
}

/**
 * Group INTENT_KINDS by their assigned category, preserving the canonical
 * INTENT_KINDS declaration order inside each group.
 */
function kindsByCategory(): Record<CategoryKey, IntentKind[]> {
  const out: Record<CategoryKey, IntentKind[]> = {
    Box: [],
    Cylinder: [],
    Patterns: [],
    Modify: [],
  };
  for (const kind of INTENT_KINDS) {
    out[INTENT_CATEGORY_MAP[kind]].push(kind);
  }
  return out;
}

export interface IntentExamplesPanelProps {
  lang: IntentExamplesLang;
  onSelectExample: (text: string) => void;
}

export default function IntentExamplesPanel(
  props: IntentExamplesPanelProps,
): React.ReactElement {
  const { lang, onSelectExample } = props;
  const d = dict[lang];
  const grouped = kindsByCategory();

  return (
    <div
      data-testid="planner-intent-examples-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        minWidth: 280,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.panelTitle}</div>

      {CATEGORY_ORDER.map((cat) => {
        const kinds = grouped[cat];
        if (kinds.length === 0) return null;
        return (
          <div
            key={cat}
            data-testid={`planner-intent-category-${cat}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 8,
              background: '#f9fafb',
              borderRadius: 4,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#374151',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {categoryLabel(d, cat)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {kinds.flatMap((kind) => {
                const examples = INTENT_EXAMPLES[kind];
                return examples.map((ex, idx) => (
                  <button
                    type="button"
                    key={`${kind}-${idx}`}
                    data-testid={`planner-intent-example-${kind}-${idx}`}
                    onClick={() => onSelectExample(ex.in)}
                    title={kind}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      color: '#1f2937',
                      borderRadius: 999,
                      cursor: 'pointer',
                      fontSize: 11,
                      lineHeight: 1.4,
                      fontFamily: 'inherit',
                      textAlign: 'start',
                    }}
                  >
                    {ex.in}
                  </button>
                ));
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
