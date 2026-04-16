// ─── Plan Limits & Feature Gates ─────────────────────────────────────────────

import type { UserPlan } from '@/hooks/useAuth';

export interface PlanLimits {
  projectCount: number;       // max saved projects (Infinity = unlimited)
  maxCartItems: number;       // max shapes addable to cart (Infinity = unlimited)
  dfmAnalysis: boolean;
  feaAnalysis: boolean;
  costEstimation: boolean;
  exportFormats: string[];    // allowed export formats
  cloudSave: boolean;
  collaboration: boolean;
  rfq: boolean;               // can request quotes from manufacturers
  ipShareLink: boolean;       // can create view-only IP-protected share links
  branchCompare: boolean;
  aiChat: boolean;
  pluginAccess: boolean;
}

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    projectCount: 3,
    maxCartItems: 1,
    dfmAnalysis: false,
    feaAnalysis: false,
    costEstimation: false,
    exportFormats: ['stl'],
    cloudSave: false,
    collaboration: false,
    rfq: false,
    ipShareLink: false,
    branchCompare: false,
    aiChat: true,       // limited AI chat
    pluginAccess: false,
  },
  pro: {
    projectCount: Infinity,
    maxCartItems: Infinity,
    dfmAnalysis: true,
    feaAnalysis: true,
    costEstimation: true,
    exportFormats: ['stl', 'step', 'obj', 'dxf', 'gltf', 'ply'],
    cloudSave: true,
    collaboration: false,
    rfq: true,
    ipShareLink: true,
    branchCompare: true,
    aiChat: true,
    pluginAccess: true,
  },
  team: {
    projectCount: Infinity,
    maxCartItems: Infinity,
    dfmAnalysis: true,
    feaAnalysis: true,
    costEstimation: true,
    exportFormats: ['stl', 'step', 'obj', 'dxf', 'gltf', 'ply', 'rhino', 'grasshopper'],
    cloudSave: true,
    collaboration: true,
    rfq: true,
    ipShareLink: true,
    branchCompare: true,
    aiChat: true,
    pluginAccess: true,
  },
  enterprise: {
    projectCount: Infinity,
    maxCartItems: Infinity,
    dfmAnalysis: true,
    feaAnalysis: true,
    costEstimation: true,
    exportFormats: ['stl', 'step', 'obj', 'dxf', 'gltf', 'ply', 'rhino', 'grasshopper'],
    cloudSave: true,
    collaboration: true,
    rfq: true,
    ipShareLink: true,
    branchCompare: true,
    aiChat: true,
    pluginAccess: true,
  },
};

export function getPlanLimits(plan: UserPlan | undefined): PlanLimits {
  return PLAN_LIMITS[plan ?? 'free'];
}

export function canUseFeature(plan: UserPlan | undefined, feature: keyof PlanLimits): boolean {
  const limits = getPlanLimits(plan);
  const val = limits[feature];
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val > 0;
  if (Array.isArray(val)) return val.length > 0;
  return false;
}
