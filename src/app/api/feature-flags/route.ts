/**
 * GET /api/feature-flags
 *
 * Public list of features currently shipped in beta state. Clients render
 * this on the relevant tool pages so users know what to expect (e.g.
 * "AI SCAD Agent is in beta — complex constraints may fail").
 *
 * Returns the BETA_FEATURES map verbatim. No auth required — these are
 * marketing-grade limitations, not anything sensitive.
 */
import { NextResponse } from 'next/server';
import { BETA_FEATURES, getEffectiveBetaFeature, isFeatureEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';
// Was force-static, but DB-driven overrides need fresh reads. Settings
// cache (30s) keeps this cheap.
export const dynamic = 'force-dynamic';

export async function GET() {
  // Merge code-defined beta features with operator overrides. Returns
  // both the beta descriptor (for the BetaBanner) and the enabled flag
  // (for client-side gating).
  const names = new Set<string>(Object.keys(BETA_FEATURES));
  const features: Record<string, {
    feature: string; reason: string; limitations: string[];
    workaround?: string; enabled: boolean;
  }> = {};
  for (const name of names) {
    const beta = await getEffectiveBetaFeature(name);
    const enabled = await isFeatureEnabled(name);
    if (beta) {
      features[name] = { ...beta, enabled };
    } else {
      // Even non-beta features still report enabled state so clients
      // can decide whether to render the entry point.
      features[name] = {
        feature: name, reason: '', limitations: [], enabled,
      };
    }
  }
  return NextResponse.json({ ok: true, features });
}
