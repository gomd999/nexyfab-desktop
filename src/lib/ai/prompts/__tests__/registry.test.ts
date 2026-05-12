import { describe, it, expect } from 'vitest';
import { getPrompt, listPromptIds, dumpRegistry } from '../index';

describe('AI prompt registry', () => {
  it('exposes all expected prompt ids', () => {
    const ids = listPromptIds();
    expect(ids).toContain('shape-chat');
    expect(ids).toContain('scad-intent-from-nl');
    expect(ids).toContain('openscad-gen');
    expect(ids).toContain('openscad-gen-generate');
    expect(ids).toContain('openscad-gen-refine');
    expect(ids).toContain('openscad-gen-fix');
    expect(ids).toContain('openscad-gen-face-op');
    expect(ids).toContain('compose');
    expect(ids).toContain('intake-from-text');
    expect(ids).toContain('shape-to-jscad');
  });

  it('throws on unknown id with helpful message', () => {
    expect(() => getPrompt('does-not-exist')).toThrow(/Unknown prompt id/);
    expect(() => getPrompt('does-not-exist')).toThrow(/Available:/);
  });

  it('every registered prompt has non-empty template', () => {
    for (const id of listPromptIds()) {
      const p = getPrompt(id);
      expect(p.id).toBe(id);
      expect(typeof p.template).toBe('string');
      expect(p.template.length).toBeGreaterThan(50);
      expect(typeof p.version).toBe('string');
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('shape-chat prompt mentions key engineering concepts', () => {
    const p = getPrompt('shape-chat');
    expect(p.template).toContain('DESIGN METHODOLOGY');
    expect(p.template).toContain('MODE: "single"');
    expect(p.template).toContain('MODE: "bom"');
    expect(p.template).toContain('MODE: "sketch"');
  });

  it('scad-intent-from-nl whitelist matches registry', () => {
    const p = getPrompt('scad-intent-from-nl');
    expect(p.template).toContain('NEVER write OpenSCAD');
    expect(p.template).toContain('threadedRod');
    expect(p.template).toContain('roundedBox');
    expect(p.template).toContain('fanBlade');
  });

  it('dumpRegistry returns id+version+description for each entry', () => {
    const dump = dumpRegistry();
    expect(dump.length).toBe(listPromptIds().length);
    for (const entry of dump) {
      expect(entry.id).toBeTruthy();
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.description).toBeTruthy();
    }
  });

  it('defaults include sane temperature/maxTokens', () => {
    for (const id of listPromptIds()) {
      const p = getPrompt(id);
      const t = p.defaults.temperature;
      expect(t === undefined || (t >= 0 && t <= 2)).toBe(true);
      const mt = p.defaults.maxTokens;
      expect(mt === undefined || mt > 0).toBe(true);
    }
  });
});
