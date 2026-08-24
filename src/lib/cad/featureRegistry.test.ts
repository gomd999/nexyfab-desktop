import { describe, expect, it } from 'vitest';
import {
  CAD_FEATURE_KINDS,
  FEATURE_REGISTRY,
  FEATURE_REGISTRY_DOCUMENT,
  FEATURE_REGISTRY_HASH,
  MECHANICAL_30_CANDIDATE_IDS,
  NATIVE_FEATURE_TYPES,
  hashFeatureRegistry,
  lookupFeature,
  validateFeatureRegistry,
} from './featureRegistry';

describe('GP-05 feature registry', () => {
  it('has deterministic versioned document and strict key parity', () => {
    expect(validateFeatureRegistry(FEATURE_REGISTRY_DOCUMENT)).toEqual({ ok: true, issues: [] });
    expect(FEATURE_REGISTRY_DOCUMENT.registryHash).toBe(FEATURE_REGISTRY_HASH);
    expect(hashFeatureRegistry(FEATURE_REGISTRY)).toBe(FEATURE_REGISTRY_HASH);
    expect(FEATURE_REGISTRY_DOCUMENT.schema).toBe('nexyfab.precision-cad.feature-registry.v1');
    expect(FEATURE_REGISTRY_DOCUMENT.version).toBe(1);
    expect(FEATURE_REGISTRY_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(FEATURE_REGISTRY.length).toBeGreaterThanOrEqual(NATIVE_FEATURE_TYPES.length);
  });

  it('covers every native FeatureType and CAD FeatureKind exactly once', () => {
    const aliases = FEATURE_REGISTRY.flatMap(entry => entry.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const type of NATIVE_FEATURE_TYPES) {
      const matches = FEATURE_REGISTRY.filter(entry => entry.aliases.includes(`native:${type}`));
      expect(matches, `native:${type}`).toHaveLength(1);
    }
    for (const kind of CAD_FEATURE_KINDS) {
      const matches = FEATURE_REGISTRY.filter(entry => entry.aliases.includes(`tree:${kind}`));
      expect(matches, `tree:${kind}`).toHaveLength(1);
    }
  });

  it('contains all mechanical 30 candidate IDs without inferring exactness', () => {
    for (const id of MECHANICAL_30_CANDIDATE_IDS) {
      expect(lookupFeature(id), id).toMatchObject({ ok: true });
    }
    const exact = FEATURE_REGISTRY.filter(entry => entry.fidelity === 'EXACT');
    const exactCandidateCount = MECHANICAL_30_CANDIDATE_IDS.filter(id => {
      const result = lookupFeature(id);
      return result.ok && result.feature.fidelity === 'EXACT';
    }).length;
    expect(exactCandidateCount).toBe(30);
    expect(exact.every(entry => entry.handlerId && entry.verificationIds.length > 0 && entry.evidenceTestIds.length > 0)).toBe(true);
    expect(exact.every(entry => entry.executor === 'OCCT_EXACT' || entry.executor === 'DOMAIN_HANDLER')).toBe(true);
    expect(lookupFeature('cad.mechanical.variable-fillet')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.variableFillet' } });
    expect(lookupFeature('cad.mechanical.sketch')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.sketch.convex-line-loop-planar-face' } });
    expect(lookupFeature('cad.mechanical.draft')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.draft' } });
    expect(lookupFeature('cad.mechanical.thread')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.thread.cylindrical' } });
    expect(lookupFeature('cad.mechanical.scale')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.scale.uniform' } });
    expect(lookupFeature('cad.mechanical.move-copy')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.move-copy.translation' } });
    expect(lookupFeature('cad.mechanical.mirror')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.mirror.plane' } });
    expect(lookupFeature('cad.mechanical.rib')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.rib.single' } });
    expect(lookupFeature('cad.mechanical.offset-face')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.offset-face.top' } });
    expect(lookupFeature('cad.mechanical.cut')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.cut.through-rect' } });
    expect(lookupFeature('cad.mechanical.linear-pattern')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.linear-pattern.connected-fused' } });
    expect(lookupFeature('cad.mechanical.circular-pattern')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.circular-pattern.connected-fused' } });
    expect(lookupFeature('cad.mechanical.loft')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.loft.ruled-convex' } });
    expect(lookupFeature('cad.mechanical.sweep')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.sweep.orthogonal-polyline-rect' } });
    expect(lookupFeature('cad.mechanical.sweep-path')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.sweep-path.orthogonal-polyline-rect.v1' } });
    expect(lookupFeature('tree:sweep_path')).toMatchObject({ ok: true, feature: { fidelity: 'UNSUPPORTED', handlerId: null } });
    expect(lookupFeature('cad.mechanical.split-body')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.split-body.keep-side-axis-plane' } });
    expect(lookupFeature('cad.mechanical.delete-face')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.delete-face.blind-hole-cap' } });
    expect(lookupFeature('cad.mechanical.bend')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.bend.single-rectangular-sheet' } });
    expect(lookupFeature('cad.mechanical.flange')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.flange.single-positive-end' } });
    expect(lookupFeature('cad.mechanical.flat-pattern')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.flat-pattern.single-bend-step-dxf' } });
    expect(lookupFeature('cad.mechanical.weldment')).toMatchObject({ ok: true, feature: { fidelity: 'EXACT', handlerId: 'occt.weldment.two-member-corner-cut-list' } });
    expect(lookupFeature('tree:sweep')).toMatchObject({ ok: true, feature: { fidelity: 'UNSUPPORTED', handlerId: null } });
  });

  it('rejects hash tampering and invalid exact/unsupported metadata', () => {
    const tampered = structuredClone(FEATURE_REGISTRY_DOCUMENT) as typeof FEATURE_REGISTRY_DOCUMENT;
    (tampered.entries[0]!.aliases as string[]).push('tampered:alias');
    expect(validateFeatureRegistry(tampered).ok).toBe(false);
    expect(validateFeatureRegistry(tampered).issues).toContain('document:hash_mismatch');

    const invalidExact = structuredClone(FEATURE_REGISTRY_DOCUMENT) as any;
    const exact = invalidExact.entries.find((entry: any) => entry.fidelity === 'EXACT');
    exact.handlerId = null;
    exact.verificationIds = [];
    exact.evidenceTestIds = [];
    exact.fallbackPolicy = 'PREVIEW_ONLY';
    invalidExact.registryHash = hashFeatureRegistry(invalidExact.entries);
    const exactReport = validateFeatureRegistry(invalidExact);
    expect(exactReport.ok).toBe(false);
    expect(exactReport.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('exact_handler_required'),
      expect.stringContaining('exact_verification_required'),
      expect.stringContaining('exact_evidence_required'),
      expect.stringContaining('exact_must_block_downgrade'),
    ]));

    const invalidUnsupported = structuredClone(FEATURE_REGISTRY_DOCUMENT) as any;
    const unsupported = invalidUnsupported.entries.find((entry: any) => entry.fidelity === 'UNSUPPORTED');
    unsupported.handlerId = 'wrong.handler';
    unsupported.executor = 'MESH_PREVIEW';
    unsupported.fallbackPolicy = 'PREVIEW_ONLY';
    unsupported.status = 'PREVIEW_ONLY';
    invalidUnsupported.registryHash = hashFeatureRegistry(invalidUnsupported.entries);
    const unsupportedReport = validateFeatureRegistry(invalidUnsupported);
    expect(unsupportedReport.ok).toBe(false);
    expect(unsupportedReport.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('unsupported_handler_forbidden'),
      expect.stringContaining('unsupported_executor_required'),
      expect.stringContaining('unsupported_must_block'),
      expect.stringContaining('unsupported_status_required'),
    ]));
  });

  it('returns immutable clone-safe records and structured unknown failures', () => {
    const first = lookupFeature('native:fillet');
    const second = lookupFeature('native:fillet');
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (first.ok && second.ok) {
      expect(first.feature).not.toBe(second.feature);
      expect(first.feature.aliases).not.toBe(second.feature.aliases);
      expect(Object.isFrozen(first.feature)).toBe(true);
      expect(Object.isFrozen(first.feature.aliases)).toBe(true);
      expect(Object.isFrozen(first.feature.parameterContract.fields)).toBe(true);
    }
    expect(lookupFeature('unknown:feature')).toEqual({
      ok: false,
      code: 'FEATURE_UNSUPPORTED',
      featureId: 'unknown:feature',
      messageKey: 'CAD_FEATURE_UNSUPPORTED',
      reason: 'unknown_feature_id',
    });
    expect(lookupFeature('x'.repeat(257))).toEqual({
      ok: false,
      code: 'FEATURE_UNSUPPORTED',
      featureId: null,
      messageKey: 'CAD_FEATURE_UNSUPPORTED',
      reason: 'invalid_feature_id',
    });
  });

  it('rejects missing coverage and unknown keys', () => {
    const missing = structuredClone(FEATURE_REGISTRY_DOCUMENT) as any;
    missing.entries = missing.entries.filter((entry: any) => !entry.aliases.includes('native:fillet'));
    missing.registryHash = hashFeatureRegistry(missing.entries);
    expect(validateFeatureRegistry(missing).issues).toContain('native_missing:fillet');

    const extra = structuredClone(FEATURE_REGISTRY_DOCUMENT) as any;
    extra.entries[0].unexpected = true;
    expect(validateFeatureRegistry(extra).issues).toContain('entries[0]:keys');
  });

  it('does not promote ambiguous closed shell and rejects hostile inspection surfaces', () => {
    expect(lookupFeature('tree:shell')).toMatchObject({ ok: true, feature: { fidelity: 'PREVIEW' } });
    expect(lookupFeature('cad.mechanical.shell-open')).toMatchObject({
      ok: true,
      feature: { fidelity: 'EXACT', handlerId: 'occt.shell.open' },
    });
    expect(lookupFeature('tree:boolean')).toMatchObject({ ok: true, feature: { fidelity: 'PREVIEW' } });
    expect(lookupFeature('cad.mechanical.boolean-subtract')).toMatchObject({
      ok: true,
      feature: { fidelity: 'EXACT', handlerId: 'occt.boolean.subtract' },
    });

    const duplicateField = structuredClone(FEATURE_REGISTRY_DOCUMENT) as any;
    const exact = duplicateField.entries.find((entry: any) => entry.fidelity === 'EXACT');
    exact.parameterContract.fields.push({ ...exact.parameterContract.fields[0] });
    duplicateField.registryHash = hashFeatureRegistry(duplicateField.entries);
    expect(validateFeatureRegistry(duplicateField).issues).toContain(
      `entries[${duplicateField.entries.indexOf(exact)}]:parameterContract:duplicate_field_key`,
    );

    const throwing = new Proxy({}, { ownKeys: () => { throw new Error('hostile'); } });
    expect(validateFeatureRegistry(throwing)).toEqual({ ok: false, issues: ['inspection_unreadable'] });
  });
});
