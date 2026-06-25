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
import type {
  ElementSelectionInfo,
  FaceSelectionInfo,
  EdgeSelectionInfo,
} from '../editing/selectionInfo';

export interface ParsedFeatureEdit {
  intents: FeatureEditIntent[];
  explanation: string;
}

/**
 * Feature keyword → (FeatureType, primary numeric param).
 * `mapNumber: false` adds the feature with default params even when the prompt
 * carries a number — for features (e.g. thread) where a bare "50mm" does not
 * correspond to the primary param and would set a nonsensical value.
 */
const ADD_PATTERNS: Array<{ re: RegExp; type: FeatureType; paramKey: string; label: string; mapNumber?: boolean }> = [
  { re: /fillet|round|필렛|모깎기|라운드/i, type: 'fillet', paramKey: 'radius', label: 'fillet' },
  { re: /chamfer|bevel|챔퍼|모따기/i, type: 'chamfer', paramKey: 'distance', label: 'chamfer' },
  { re: /hole|bore|drill|구멍|홀/i, type: 'hole', paramKey: 'diameter', label: 'hole' },
  { re: /shell|hollow|쉘|속.?비우/i, type: 'shell', paramKey: 'wallThickness', label: 'shell' },
  { re: /thread|screw|나사산|나사/i, type: 'thread', paramKey: 'pitch', label: 'thread', mapNumber: false },
  // Selection-based (face) edits — see FACE_FEATURES / REQUIRE_SELECTION below.
  // Order matters: "delete/면 삭제" must be checked here, not by the remove-last
  // rule (that needs an explicit last/마지막 reference, which these lack).
  { re: /delete\s*face|면\s*(삭제|제거|지우)/i, type: 'deleteFace', paramKey: '', label: 'delete face', mapNumber: false },
  { re: /off\s?set|오프\s?셋|옵셋|면\s*이동/i, type: 'offsetFace', paramKey: 'distance', label: 'face offset' },
  { re: /draft|구배|빼기.?구배/i, type: 'draft', paramKey: 'angle', label: 'draft' },
];

/** Features that consume a selected FACE (offset/delete operate on it; draft refines with it). */
const FACE_FEATURES = new Set<FeatureType>(['offsetFace', 'deleteFace', 'draft']);
/** Features that can consume a selected EDGE (else fall back to "all edges"). */
const EDGE_FEATURES = new Set<FeatureType>(['fillet', 'chamfer']);
/** Features that are meaningless without a face selection — guide the user instead of adding a no-op. */
const REQUIRE_FACE = new Set<FeatureType>(['offsetFace', 'deleteFace']);

/** Split the current selection into face/edge arrays the feature pipeline understands. */
export function selectionToArrays(selection: ElementSelectionInfo | null | undefined): {
  faces: FaceSelectionInfo[];
  edges: EdgeSelectionInfo[];
} {
  if (!selection) return { faces: [], edges: [] };
  if (selection.type === 'face') return { faces: [selection], edges: [] };
  if (selection.type === 'multi') return { faces: selection.faces, edges: [] };
  if (selection.type === 'edge') return { faces: [], edges: [selection] };
  return { faces: [], edges: [] };
}

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
  selection?: ElementSelectionInfo | null,
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
  //    Face/edge-aware: when the matched feature consumes a selection and one
  //    of the right kind is active, attach it (add_feature_on_selection) so the
  //    edit targets the clicked face/edge instead of the default. Features that
  //    REQUIRE a face (offset/delete) surface guidance when none is selected.
  const { faces, edges } = selectionToArrays(selection);
  for (const pat of ADD_PATTERNS) {
    if (pat.re.test(text)) {
      const useNumber = num !== null && pat.mapNumber !== false && pat.paramKey !== '';
      const params: Record<string, number> = useNumber ? { [pat.paramKey]: num } : {};
      const size = useNumber ? ` (${pat.paramKey} ${num}mm)` : '';

      if (REQUIRE_FACE.has(pat.type) && faces.length === 0) {
        return {
          intents: [],
          explanation: `Select a face first, then say "${pat.label}". (먼저 면을 선택한 뒤 "${pat.label}" 라고 하세요.)`,
        };
      }
      if (FACE_FEATURES.has(pat.type) && faces.length > 0) {
        return {
          intents: [{ kind: 'add_feature_on_selection', featureType: pat.type, params, faceSelections: faces }],
          explanation: `Applied ${pat.label}${size} to the selected ${faces.length > 1 ? `${faces.length} faces` : 'face'}.`,
        };
      }
      if (EDGE_FEATURES.has(pat.type) && edges.length > 0) {
        return {
          intents: [{ kind: 'add_feature_on_selection', featureType: pat.type, params, edgeSelections: edges }],
          explanation: `Added a ${pat.label}${size} on the selected edge.`,
        };
      }
      return {
        intents: [{ kind: 'add_feature', featureType: pat.type, params }],
        explanation: `Added a ${pat.label}${size || ' (default size)'}.`,
      };
    }
  }

  return {
    intents: [],
    explanation: `Couldn't map "${text}" to an action. Try: "add a 5mm fillet", "add a 10mm hole", "make it 8mm", "remove the last feature", or "clear all".`,
  };
}
