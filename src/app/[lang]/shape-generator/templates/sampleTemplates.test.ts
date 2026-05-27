import { describe, it, expect } from 'vitest';
import { SAMPLE_TEMPLATES, getSampleTemplate, EVERYDAY_PRESETS } from './sampleTemplates';

describe('SAMPLE_TEMPLATES', () => {
  it('ships exactly 5 templates', () => {
    expect(SAMPLE_TEMPLATES).toHaveLength(5);
  });

  it('every template has unique id', () => {
    const ids = SAMPLE_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template has all 6-lang name + description fields', () => {
    for (const t of SAMPLE_TEMPLATES) {
      expect(t.nameKo).toBeTruthy();
      expect(t.nameEn).toBeTruthy();
      expect(t.nameJa).toBeTruthy();
      expect(t.descKo).toBeTruthy();
      expect(t.descEn).toBeTruthy();
      expect(t.descJa).toBeTruthy();
    }
  });

  it('every template builds a non-empty feature list', () => {
    for (const t of SAMPLE_TEMPLATES) {
      const features = t.build();
      expect(features.length).toBeGreaterThanOrEqual(1);
      expect(features[0]!.type).toBeDefined();
      expect(features[0]!.enabled).toBe(true);
    }
  });

  it('every template starts with sketchExtrude', () => {
    // First feature must produce geometry (not modify nothing).
    for (const t of SAMPLE_TEMPLATES) {
      const features = t.build();
      expect(features[0]!.type).toBe('sketchExtrude');
      expect(features[0]!.sketchData).toBeDefined();
    }
  });

  it('every sketchExtrude has a closed profile + non-zero depth', () => {
    for (const t of SAMPLE_TEMPLATES) {
      const features = t.build();
      const sk = features[0]!.sketchData!;
      expect(sk.profile.closed).toBe(true);
      expect(sk.profile.segments.length).toBeGreaterThan(0);
      expect(sk.config.depth).toBeGreaterThan(0);
    }
  });

  it('feature ids are unique within a template', () => {
    for (const t of SAMPLE_TEMPLATES) {
      const features = t.build();
      const ids = features.map(f => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('time-to-export estimates are bounded (1-5 min)', () => {
    for (const t of SAMPLE_TEMPLATES) {
      expect(t.timeToExportMin).toBeGreaterThanOrEqual(1);
      expect(t.timeToExportMin).toBeLessThanOrEqual(5);
    }
  });

  it('bracket template includes 4 holes (4-corner mounting)', () => {
    const t = getSampleTemplate('bracket')!;
    const sk = t.build()[0]!.sketchData!;
    // outer rect + 4 holes
    expect(sk.profile.segments).toHaveLength(5);
  });

  it('enclosure template includes a shell feature', () => {
    const features = getSampleTemplate('enclosure')!.build();
    expect(features.some(f => f.type === 'shell')).toBe(true);
  });

  it('disk template has center bore', () => {
    const sk = getSampleTemplate('disk')!.build()[0]!.sketchData!;
    // outer circle + bore circle
    expect(sk.profile.segments.length).toBe(2);
  });
});

describe('getSampleTemplate', () => {
  it('returns the template by id', () => {
    expect(getSampleTemplate('bracket')?.id).toBe('bracket');
  });

  it('returns null for unknown id', () => {
    expect(getSampleTemplate('phantom' as never)).toBeNull();
  });
});

describe('EVERYDAY_PRESETS (lay-user AI front door)', () => {
  it('ships the 6 everyday consumer products', () => {
    expect(EVERYDAY_PRESETS).toHaveLength(6);
    expect(new Set(EVERYDAY_PRESETS.map(p => p.id)).size).toBe(6);
  });

  it('every preset id matches a deterministic intentToScad consumer shape', () => {
    // These ids must resolve in intentToScad so the seeded prompt is reliable.
    const SUPPORTED = ['nameplate', 'phoneStand', 'coaster', 'wallHook', 'drawerKnob', 'planterPot'];
    for (const p of EVERYDAY_PRESETS) {
      expect(SUPPORTED).toContain(p.id);
    }
  });

  it('every preset has icon, names, descriptions and KO/EN prompts', () => {
    for (const p of EVERYDAY_PRESETS) {
      expect(p.icon).toBeTruthy();
      expect(p.nameKo && p.nameEn && p.nameJa).toBeTruthy();
      expect(p.descKo && p.descEn && p.descJa).toBeTruthy();
      expect(p.promptKo.trim().length).toBeGreaterThan(0);
      expect(p.promptEn.trim().length).toBeGreaterThan(0);
    }
  });
});
