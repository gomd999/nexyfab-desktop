/**
 * Renderer-neutral contract for the unified, chat-first AI Design workspace.
 *
 * This is a presentation and handoff contract only. It does not create exact
 * geometry and cannot authorize manufacturing. A renderer (web, native, or
 * headless) may choose its own controls while preserving these semantics.
 */
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

const DEFAULT_STARTER_CARDS: readonly AiDesignWorkspaceStarterCard[] = [
  {
    id: 'describe-idea-ko', locale: 'ko', title: '아이디어 설명하기',
    description: '일상적인 말로 만들 제품이나 형상을 설명하세요.',
    examplePrompt: '벽에 고정하는 소형 공구걸이를 후크 3개로 설계해 줘.',
    inputKinds: ['text'],
  },
  {
    id: 'bring-reference-ko', locale: 'ko', title: '참고 자료로 시작하기',
    description: '2D 도면, 이미지·스케치 또는 기존 3D 모델을 올리세요.',
    examplePrompt: '이 자료의 핵심 기능은 유지하고 더 단순하고 가볍게 바꿔 줘.',
    inputKinds: ['drawing_2d', 'image_or_sketch', 'existing_3d'],
  },
  {
    id: 'describe-idea', locale: 'en', title: 'Describe an idea',
    description: 'Start with a plain-language product or shape idea.',
    examplePrompt: 'Design a compact wall-mounted tool holder with three hooks.',
    inputKinds: ['text'],
  },
  {
    id: 'bring-reference', locale: 'en', title: 'Bring a reference',
    description: 'Upload a 2D drawing, image, sketch, or existing 3D model.',
    examplePrompt: 'Use this reference and make a simpler, lighter concept.',
    inputKinds: ['drawing_2d', 'image_or_sketch', 'existing_3d'],
  },
];

function actionFor(stage: AiDesignWorkspaceStage, hasInput: boolean, locale: string): AiDesignWorkspaceNextAction {
  const ko = locale === 'ko';
  switch (stage) {
    case 'intake': return { id: 'add_input', stage, label: ko ? '아이디어 또는 자료 추가' : 'Add an idea or reference', explanation: ko ? '설계할 내용을 말하거나 참고 자료를 첨부하세요.' : 'Tell the assistant what to design or attach a reference.', enabled: true };
    case 'understanding': return { id: 'review_understanding', stage, label: ko ? '이해한 내용 확인' : 'Review the understanding', explanation: ko ? '후보를 만들기 전에 AI가 이해한 내용을 확인하세요.' : 'Check what the assistant inferred before candidates are made.', enabled: true };
    case 'generation': return { id: 'generate_candidates', stage, label: ko ? '설계 후보 생성 계속' : 'Continue generating candidates', explanation: ko ? '현재 생성 단계를 진행하고 결과 근거를 확인하세요.' : 'Continue the current generation stage and review its evidence.', enabled: hasInput };
    case 'candidates': return { id: 'choose_candidate', stage, label: ko ? '설계 후보 선택' : 'Choose a concept', explanation: ko ? '후보를 비교하고 다듬을 하나를 선택하세요.' : 'Compare the generated concepts and choose one to refine.', enabled: hasInput };
    case 'edit': return { id: 'edit_concept', stage, label: ko ? '변경 미리보기' : 'Refine the concept', explanation: ko ? '변경을 설명하고 2D·3D 결과를 적용 전에 확인하세요.' : 'Describe a change and review the updated concept.', enabled: hasInput };
    case 'precision': return { id: 'request_precision_cad', stage, label: ko ? 'Precision CAD 요청' : 'Open Precision CAD', explanation: ko ? '승인한 개념을 정확한 형상과 제조 검증을 위해 Precision CAD로 보내세요.' : 'Send the approved concept to Precision CAD for exact geometry and manufacturing checks.', enabled: hasInput };
    case 'recovery': return { id: 'recover_session', stage, label: ko ? '서버 상태에서 복구' : 'Recover from server state', explanation: ko ? '최신 서버 버전을 확인한 뒤 안전하게 이어가세요.' : 'Refresh the authoritative server revision before continuing.', enabled: true };
  }
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
  const cards = localizedCards(locale, options.starterCards ?? DEFAULT_STARTER_CARDS);
  const conceptStage = stage !== 'precision';
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
      boundaryCopy: conceptStage
        ? 'AI Design creates and edits concepts only. Exact geometry and manufacturing decisions belong to Precision CAD.'
        : 'Precision CAD owns exact geometry and manufacturing checks. AI Design remains a concept assistant.',
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
