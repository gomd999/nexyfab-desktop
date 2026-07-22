/**
 * brief-expander — the clarify→structure PRE-PASS that fronts the existing
 * design pipeline. See ./expandBrief.ts for the honesty/grounding contract.
 */
export * from './types';
export {
  expandBrief,
  groundBrief,
  toPlannerBrief,
  textHasValue,
  BriefExpanderError,
  type ExpandBriefOptions,
} from './expandBrief';