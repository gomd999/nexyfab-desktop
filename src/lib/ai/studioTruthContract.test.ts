import { describe, expect, it } from 'vitest';
import { DESIGN_DOMAIN_IDS } from './domainProfile';
import { getWorkspaceTruthSnapshot, STUDIO_AUTHORING_CAPABILITIES } from './studioTruthContract';

describe('studio truth contract', () => {
  it('separates exact authoring support from current-session verification', () => {
    expect(getWorkspaceTruthSnapshot({ domain: 'mechanical', workMode: 'precision_cad' }))
      .toMatchObject({ authoring: 'EXACT', verification: 'NOT_RUN', release: 'BLOCKED', releaseReady: false });
  });

  it('keeps AI-assisted authoring in preview even when an exact kernel exists', () => {
    expect(getWorkspaceTruthSnapshot({ domain: 'mechanical', workMode: 'ai_assisted', dfmWarningCount: 0 }))
      .toMatchObject({ authoring: 'PREVIEW', verification: 'VERIFIED', release: 'BLOCKED' });
  });

  it('does not interpret an AEC DFM count as domain verification', () => {
    expect(getWorkspaceTruthSnapshot({ domain: 'interior', workMode: 'precision_cad', dfmWarningCount: 0 }))
      .toMatchObject({ authoring: 'PREVIEW', verification: 'NOT_RUN', release: 'BLOCKED' });
  });

  it('surfaces a spatial calculation as PREVIEW without granting release', () => {
    expect(getWorkspaceTruthSnapshot({ domain: 'interior', workMode: 'precision_cad', sessionVerification: 'PREVIEW' }))
      .toMatchObject({ authoring: 'PREVIEW', verification: 'PREVIEW', release: 'BLOCKED', releaseReady: false });
  });

  it('surfaces authorization and blocking states without granting release', () => {
    expect(getWorkspaceTruthSnapshot({ domain: 'mechanical', workMode: 'precision_cad', exactWorkerAuthorization: 'required' }))
      .toMatchObject({ verification: 'AUTH_REQUIRED', releaseReady: false });
    expect(getWorkspaceTruthSnapshot({ domain: 'mechanical', workMode: 'precision_cad', dfmWarningCount: 2 }))
      .toMatchObject({ verification: 'BLOCKED', releaseReady: false });
  });

  it('covers every workspace domain and forbids static release claims', () => {
    expect(Object.keys(STUDIO_AUTHORING_CAPABILITIES).sort()).toEqual([...DESIGN_DOMAIN_IDS].sort());
    for (const domain of DESIGN_DOMAIN_IDS) expect(STUDIO_AUTHORING_CAPABILITIES[domain].releaseClaimAllowed).toBe(false);
  });
});
