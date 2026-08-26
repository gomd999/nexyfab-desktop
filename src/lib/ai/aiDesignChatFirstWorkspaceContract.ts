/**
 * Renderer-neutral contract for the unified, chat-first AI Design workspace.
 *
 * This is a presentation and handoff contract only. It does not create exact
 * geometry and cannot authorize manufacturing. A renderer (web, native, or
 * headless) may choose its own controls while preserving these semantics.
 */
import { getAiDesignWorkspaceCopy, getAiDesignWorkspaceLocale } from './aiDesignWorkspaceI18n';

export const AI_DESIGN_CHAT_FIRST_WORKSPACE_SCHEMA =
  'nexyfab.ai-design-chat-first-workspace.v1' as const;

export type AiDesignWorkspaceInputKind =
  | 'text'
  | 'drawing_2d'
  | 'image_or_sketch'
  | 'existing_3d';

export type AiDesignWorkspaceStage =
  | 'intake'
  | 'understanding'
  | 'generation'
  | 'candidates'
  | 'edit'
  | 'precision'
  | 'recovery';

export type AiDesignWorkspaceLayout = 'desktop_split' | 'mobile_chat_first';

export type AiDesignWorkspaceAuthority =
  | 'concept_only'
  | 'precision_cad_exact_manufacturing';

export type AiDesignWorkspaceActionId =
  | 'add_input'
  | 'review_understanding'
  | 'generate_candidates'
  | 'choose_candidate'
  | 'edit_concept'
  | 'request_precision_cad'
  | 'recover_session';

export interface AiDesignWorkspaceStarterCard {
  id: string;
  locale: string;
  title: string;
  description: string;
  examplePrompt: string;
  inputKinds: readonly AiDesignWorkspaceInputKind[];
}

export interface AiDesignWorkspaceNextAction {
  id: AiDesignWorkspaceActionId;
  stage: AiDesignWorkspaceStage;
  label: string;
  explanation: string;
  enabled: boolean;
}

export interface AiDesignChatFirstWorkspaceContract {
  schema: typeof AI_DESIGN_CHAT_FIRST_WORKSPACE_SCHEMA;
  locale: string;
  stage: AiDesignWorkspaceStage;
  layout: AiDesignWorkspaceLayout;
  acceptedInputs: readonly AiDesignWorkspaceInputKind[];
  receivedInputs: readonly AiDesignWorkspaceInputKind[];
  starterCards: readonly AiDesignWorkspaceStarterCard[];
  nextRecommendedAction: AiDesignWorkspaceNextAction;
  authority: {
    current: AiDesignWorkspaceAuthority;
    conceptEditingAllowed: true;
    exactGeometryAuthority: 'precision-cad';
    manufacturingReleaseAllowed: false;
    boundaryCopy: string;
  };
  regions: {
    chat: 'primary' | 'supporting';
    visualWorkspace: 'primary' | 'supporting' | 'deferred';
    candidates: 'primary' | 'supporting' | 'deferred';
  };
}

export interface CreateAiDesignChatFirstWorkspaceOptions {
  locale?: string;
  stage?: AiDesignWorkspaceStage;
  layout?: AiDesignWorkspaceLayout;
  receivedInputs?: readonly AiDesignWorkspaceInputKind[];
  starterCards?: readonly AiDesignWorkspaceStarterCard[];
}

export const AI_DESIGN_WORKSPACE_ACCEPTED_INPUTS: readonly AiDesignWorkspaceInputKind[] = [
  'text',
  'drawing_2d',
  'image_or_sketch',
  'existing_3d',
];

function defaultStarterCards(locale: string): readonly AiDesignWorkspaceStarterCard[] {
  const resolvedLocale = getAiDesignWorkspaceLocale(locale);
  const [describe, reference] = getAiDesignWorkspaceCopy(resolvedLocale).starterCards;
  return [
    { id: `describe-idea-${resolvedLocale}`, locale: resolvedLocale, ...describe, inputKinds: ['text'] },
    { id: `bring-reference-${resolvedLocale}`, locale: resolvedLocale, ...reference, inputKinds: ['drawing_2d', 'image_or_sketch', 'existing_3d'] },
  ];
}

function actionFor(stage: AiDesignWorkspaceStage, hasInput: boolean, locale: string): AiDesignWorkspaceNextAction {
  const text = getAiDesignWorkspaceCopy(locale).stages[stage];
  const id: Record<AiDesignWorkspaceStage, AiDesignWorkspaceActionId> = {
    intake: 'add_input', understanding: 'review_understanding', generation: 'generate_candidates',
    candidates: 'choose_candidate', edit: 'edit_concept', precision: 'request_precision_cad', recovery: 'recover_session',
  };
  return { id: id[stage], stage, ...text, enabled: stage === 'intake' || stage === 'understanding' || stage === 'recovery' || hasInput };
}

function localizedCards(locale: string, cards: readonly AiDesignWorkspaceStarterCard[]): readonly AiDesignWorkspaceStarterCard[] {
  const exact = cards.filter(card => card.locale === locale);
  return exact.length > 0 ? exact : cards.filter(card => card.locale === 'en');
}

export function createAiDesignChatFirstWorkspaceContract(
  options: CreateAiDesignChatFirstWorkspaceOptions = {},
): AiDesignChatFirstWorkspaceContract {
  const locale = options.locale ?? 'en';
  const stage = options.stage ?? 'intake';
  const receivedInputs = [...new Set(options.receivedInputs ?? [])];
  const cards = options.starterCards ? localizedCards(locale, options.starterCards) : defaultStarterCards(locale);
  const conceptStage = stage !== 'precision';
  const boundary = getAiDesignWorkspaceCopy(locale).boundary;
  return {
    schema: AI_DESIGN_CHAT_FIRST_WORKSPACE_SCHEMA,
    locale,
    stage,
    layout: options.layout ?? 'desktop_split',
    acceptedInputs: AI_DESIGN_WORKSPACE_ACCEPTED_INPUTS,
    receivedInputs,
    starterCards: cards,
    nextRecommendedAction: actionFor(stage, receivedInputs.length > 0, locale),
    authority: {
      current: conceptStage ? 'concept_only' : 'precision_cad_exact_manufacturing',
      conceptEditingAllowed: true,
      exactGeometryAuthority: 'precision-cad',
      manufacturingReleaseAllowed: false,
      boundaryCopy: conceptStage ? boundary.concept : boundary.precision,
    },
    regions: options.layout === 'mobile_chat_first'
      ? { chat: 'primary', visualWorkspace: 'supporting', candidates: 'supporting' }
      : { chat: 'supporting', visualWorkspace: 'primary', candidates: 'primary' },
  };
}

export function validateAiDesignChatFirstWorkspaceContract(
  contract: AiDesignChatFirstWorkspaceContract,
): string[] {
  const issues: string[] = [];
  if (contract.schema !== AI_DESIGN_CHAT_FIRST_WORKSPACE_SCHEMA) issues.push('invalid_schema');
  if (!contract.locale.trim()) issues.push('locale_required');
  if (contract.acceptedInputs.length !== AI_DESIGN_WORKSPACE_ACCEPTED_INPUTS.length) issues.push('incomplete_input_kinds');
  if (contract.starterCards.length === 0) issues.push('starter_cards_required');
  if (contract.nextRecommendedAction.stage !== contract.stage) issues.push('recommendation_stage_mismatch');
  if (contract.authority.exactGeometryAuthority !== 'precision-cad') issues.push('exact_geometry_authority_violation');
  if (contract.authority.manufacturingReleaseAllowed !== false) issues.push('manufacturing_release_violation');
  if (contract.layout === 'mobile_chat_first' && contract.regions.chat !== 'primary') issues.push('mobile_chat_must_be_primary');
  if (contract.layout === 'desktop_split' && contract.regions.visualWorkspace !== 'primary') issues.push('desktop_visual_workspace_must_be_primary');
  return issues;
}
