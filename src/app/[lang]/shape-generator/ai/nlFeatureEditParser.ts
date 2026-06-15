/**
 * nlFeatureEditParser — deterministic natural-language → FeatureEditIntent.
 *
 * Wires the AiAssistantShell's `promptToIntents` to a real, offline, testable
 * parser for the common in-context feature-edit commands ("add a 5mm fillet",
 * "remove the last feature", "make it 8mm", "clear all"). No model call, no API
 * cost — it covers the high-frequency commands instantly. An LLM fallback can
 * layer on top later for the long tail; until then the AI prompt actually does
 * something instead of returning "wiring in progress".
 *
 * Bilingual (English + common Korean keywords) since the modeler is i18n.
 */

import type { FeatureEditIntent } from './featureEditDispatcher';
import type { FeatureInstance, FeatureType } from '../features/types';

export interface ParsedFeatureEdit {
  intents: FeatureEditIntent[];
  explanation: string;
}

/** Feature keyword → (FeatureType, primary numeric param). */
const ADD_PATTERNS: Array<{ re: RegExp; type: FeatureType; paramKey: string; label: string }> = [
  { re: /fillet|round|필렛|모깎기|라운드/i, type: 'fillet', paramKey: 'radius', label: 'fillet' },
  { re: /chamfer|bevel|챔퍼|모따기/i, type: 'chamfer', paramKey: 'distance', label: 'chamfer' },
  { re: /hole|bore|drill|구멍|홀/i, type: 'hole', paramKey: 'diameter', label: 'hole' },
  { re: /shell|hollow|쉘|속.?비우/i, type: 'shell', paramKey: 'wallThickness', label: 'shell' },
];

const UPDATE_VERB = /\b(make|set|change|resize|update|adjust)\b|변경|바꿔|설정|로\s*해|크기/i;

/** First number (optionally with mm) in the text. */
function firstNumber(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:mm)?/i);
  return m ? Number(m[1]) : null;
}

function primaryParamKey(type: FeatureType): string | null {
  switch (type) {
    case 'fillet':
    case 'variableFillet':
      return 'radius';
    case 'chamfer':
      return 'distance';
    case 'hole':
      return 'diameter';
    case 'shell':
      return 'wallThickness';
    default:
      return null;
  }
}

/**
 * Map a prompt to feature-edit intents against the current feature list. Pure +
 * deterministic. Returns an empty intent list with a helpful explanation when
 * nothing matches, so the caller surfaces guidance rather than failing.
 */
export function parseFeatureEditPrompt(
  prompt: string,
  features: ReadonlyArray<FeatureInstance>,
): ParsedFeatureEdit {
  const text = prompt.trim();
  if (!text) {
    return { intents: [], explanation: 'Type a command like "add a 5mm fillet" or "remove the last feature".' };
  }
  const lower = text.toLowerCase();
  const last = features.length > 0 ? features[features.length - 1] : undefined;

  // 1. Clear everything.
  if (/\b(clear all|delete all|remove all|reset|start over)\b|전체\s*삭제|모두\s*삭제|초기화/i.test(lower)) {
    return { intents: [{ kind: 'clear_all' }], explanation: 'Cleared all features.' };
  }

  // 2. Remove / undo the last feature.
  if (/\b(remove|delete|undo)\b.*\b(last|previous|that|it)\b|\b(undo)\b|마지막.*(삭제|제거)|되돌리|취소/i.test(lower)) {
    if (!last) return { intents: [], explanation: 'There are no features to remove.' };
    return { intents: [{ kind: 'remove_feature', featureId: last.id }], explanation: `Removed the ${last.type} feature.` };
  }

  // 3. Suppress / enable the last feature.
  if (/\b(disable|suppress|hide|turn off)\b|비활성|억제|끄|숨기/i.test(lower)) {
    if (!last) return { intents: [], explanation: 'There are no features to suppress.' };
    return { intents: [{ kind: 'toggle_feature', featureId: last.id, enabled: false }], explanation: `Suppressed the ${last.type} feature.` };
  }
  if (/\b(enable|unsuppress|show|turn on)\b|활성|켜/i.test(lower)) {
    if (!last) return { intents: [], explanation: 'There are no features to enable.' };
    return { intents: [{ kind: 'toggle_feature', featureId: last.id, enabled: true }], explanation: `Enabled the ${last.type} feature.` };
  }

  const num = firstNumber(text);

  // 4. Update the last feature's primary parameter (takes precedence over "add"
  //    so "make the fillet 8mm" edits rather than adding a second fillet).
  if (last && num !== null && UPDATE_VERB.test(lower)) {
    const key = primaryParamKey(last.type);
    if (key) {
      return {
        intents: [{ kind: 'update_param', featureId: last.id, paramKey: key, value: num }],
        explanation: `Set the ${last.type}'s ${key} to ${num}mm.`,
      };
    }
  }

  // 5. Add a feature (keyword match; number → its primary param, else default).
  for (const pat of ADD_PATTERNS) {
    if (pat.re.test(text)) {
      const params: Record<string, number> = num !== null ? { [pat.paramKey]: num } : {};
      const size = num !== null ? ` (${pat.paramKey} ${num}mm)` : ' (default size)';
      return {
        intents: [{ kind: 'add_feature', featureType: pat.type, params }],
        explanation: `Added a ${pat.label}${size}.`,
      };
    }
  }

  return {
    intents: [],
    explanation: `Couldn't map "${text}" to an action. Try: "add a 5mm fillet", "add a 10mm hole", "make it 8mm", "remove the last feature", or "clear all".`,
  };
}
