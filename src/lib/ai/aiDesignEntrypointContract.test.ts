import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_DESIGN_ENTRYPOINTS,
  aiDesignEntrypointSourcePaths,
  getAiDesignEntrypoint,
  validateAiDesignEntrypointContract,
} from './aiDesignEntrypointContract';

describe('AI design user entrypoint contract', () => {
  it('contains complete chains and no release or inherited-verification claims', () => {
    expect(validateAiDesignEntrypointContract()).toEqual([]);
    expect(AI_DESIGN_ENTRYPOINTS).toHaveLength(6);
    expect(AI_DESIGN_ENTRYPOINTS.every(entry => entry.manufacturingReleaseReady === false)).toBe(true);
    expect(AI_DESIGN_ENTRYPOINTS.every(entry => entry.inheritedVerificationAllowed === false)).toBe(true);
  });

  it('binds every advertised dispatcher and handoff to an existing source file', () => {
    for (const path of aiDesignEntrypointSourcePaths()) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
  });

  it('binds every public page route to its actual Next page source', () => {
    for (const entry of AI_DESIGN_ENTRYPOINTS) {
      const derivedRoute = entry.pageSource
        .replace(/^src\/app/, '')
        .replace(/\/page\.tsx$/, '');
      expect(derivedRoute, entry.id).toBe(entry.pageRoute);
      expect(existsSync(resolve(process.cwd(), entry.pageSource)), entry.pageSource).toBe(true);
    }
  });

  it('binds each browser endpoint to the matching route source and removes the dead planner endpoint', () => {
    for (const entry of AI_DESIGN_ENTRYPOINTS) {
      const transport = readFileSync(resolve(process.cwd(), entry.transportSource), 'utf8');
      for (const segment of entry.apiEndpoint.split('[id]').filter(part => part.length > 1)) {
        expect(transport, `${entry.id}: ${segment}`).toContain(segment);
      }
    }
    const plannerSurface = readFileSync(resolve(process.cwd(), 'src/app/[lang]/shape-generator/sketch/SolverSketchEditorWithExtrude.tsx'), 'utf8');
    expect(plannerSurface).toContain("fetch('/api/featureTree-intent'");
    expect(plannerSurface).not.toContain('/api/featureTree-planner');
  });

  it('keeps exact artifacts evidence-bound and concept design explicitly non-release', () => {
    expect(getAiDesignEntrypoint('studio-precise-mechanical')).toMatchObject({
      fidelity: 'analytic_brep_per_artifact_evidence',
      perArtifactEvidenceRequired: true,
      manufacturingReleaseReady: false,
    });
    expect(getAiDesignEntrypoint('architecture-interior-concept-ai')).toMatchObject({
      auth: 'authenticated_project_editor_origin',
      fidelity: 'concept_preview',
      persistence: 'approved_project_concept_revision',
      manufacturingReleaseReady: false,
    });
    expect(getAiDesignEntrypoint('expert-in-context-feature-edit')).toMatchObject({
      auth: 'public_bounded_request',
      manufacturingReleaseReady: false,
    });
    expect(getAiDesignEntrypoint('expert-cad-agent')).toMatchObject({
      persistence: 'browser_carried_signed_session',
      cadArtifactDurability: 'request_or_process_local',
      manufacturingReleaseReady: false,
    });
  });

  it('rejects a false release claim in a modified contract', () => {
    const forged = AI_DESIGN_ENTRYPOINTS.map(entry => entry.id === 'studio-precise-mechanical'
      ? { ...entry, manufacturingReleaseReady: true as never }
      : entry);
    expect(validateAiDesignEntrypointContract(forged)).toContain('false_release_claim:studio-precise-mechanical');
  });
});
