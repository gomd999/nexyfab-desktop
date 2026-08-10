import type { BepRequirementDefinition, BimSourceReference } from './informationRegistry';

export const LH_SITE_BEP_SOURCE_ID = 'lh-site-bep-appendix-03-2025.12';

export const LH_SITE_BEP_SOURCE: BimSourceReference = {
  id: LH_SITE_BEP_SOURCE_ID,
  path: 'BIM guideline/appendix-03/site-BIM-BEP-example.hwp',
  revision: '2025.12',
  access: 'read_only',
};

/**
 * Section-level executable contract derived from the appendix-03 HWP headings.
 * It does not claim that free-form tables inside the example have been approved
 * as project values; projects must supply and review their own values.
 */
export const LH_SITE_BEP_REQUIREMENTS: readonly BepRequirementDefinition[] = [
  { key: 'projectOverview', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'bimGoals', type: 'array', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'workScope', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'milestones', type: 'array', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'authoringScope', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'lodPlan', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'modelStandards', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'organization', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'responsibilityMatrix', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'technologyEnvironment', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'workflow', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'cdePlan', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'exchangeRequirements', type: 'array', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'qualityPlan', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'deliverablePlan', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
  { key: 'securityPlan', type: 'object', requiredAt: ['design', 'construction'], sourceRef: LH_SITE_BEP_SOURCE_ID },
] as const;
