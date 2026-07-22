/**
 * brief-expander — the clarify→structure PRE-PASS that fronts the existing
 * design pipeline. See ./expandBrief.ts for the honesty/grounding contract.
 */
export * from './types';
export {
  expandBrief,
  expandBriefSelfConsistent,
  groundBrief,
  deriveParamQuestionsAssumptions,
  projectBriefFields,
  toPlannerBrief,
  textHasValue,
  BriefExpanderError,
  type ExpandBriefOptions,
  type ExpandBriefSelfConsistentOptions,
  type SelfConsistentBriefResult,
} from './expandBrief';