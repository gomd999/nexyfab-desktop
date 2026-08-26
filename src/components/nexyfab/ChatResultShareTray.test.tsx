import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeChatResultArtifacts, RESULT_SHARE_COPY } from './ChatResultShareTray';

const SITE_LANGS = ['kr', 'en', 'ja', 'cn', 'es', 'ar'] as const;
const HANGUL = /[가-힣]/;
const CHAT_HERO_SOURCE = readFileSync(join(process.cwd(), 'src', 'app', '[lang]', 'ChatHero.tsx'), 'utf8');

describe('ChatResultShareTray artifact contract', () => {
  it('keeps GA_3D.html as the first default result and exposes exactly three rows', () => {
    const rows = describeChatResultArtifacts(null, 'kr');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: 'ga', name: 'GA_3D.html', enabled: false });
    expect(rows.every((row) => row.enabled === false)).toBe(true);
  });

  it('offers browser GA, B-rep STEP, and editable source for a single-part result', () => {
    const rows = describeChatResultArtifacts({ composeIntent: { name: 'plate' }, scad: 'cube(10);' }, 'en');
    expect(rows.map(({ kind, name, enabled }) => ({ kind, name, enabled }))).toEqual([
      { kind: 'ga', name: 'GA_3D.html', enabled: true },
      { kind: 'step', name: 'model.step', enabled: true },
      { kind: 'source', name: 'model.scad', enabled: true },
    ]);
  });

  it('offers the full package as the third row for an assembly result', () => {
    const rows = describeChatResultArtifacts({ isAssembly: true, assembly: { parts: [{}] }, composeIntent: {}, scad: 'union();' }, 'ja');
    expect(rows[2]).toMatchObject({ kind: 'package', name: 'design_package_ja.zip', enabled: true });
  });

  it('provides complete six-language copy without Korean leakage', () => {
    const missing: string[] = [];
    const leaked: string[] = [];
    for (const lang of SITE_LANGS) {
      for (const [key, value] of Object.entries(RESULT_SHARE_COPY[lang])) {
        if (!value.trim()) missing.push(`${lang}.${key}`);
        if (lang !== 'kr' && HANGUL.test(value)) leaked.push(`${lang}.${key}`);
      }
    }
    expect(missing).toEqual([]);
    expect(leaked).toEqual([]);
  });

  it('is wired directly below the main chat composer', () => {
    const composerEnd = CHAT_HERO_SOURCE.indexOf('<ChatResultShareTray');
    expect(composerEnd).toBeGreaterThan(CHAT_HERO_SOURCE.indexOf('className="nf-chat-composer"'));
    expect(CHAT_HERO_SOURCE).toContain('<ChatResultShareTray cad={latestCad} langCode={lang} accent={accent} />');
  });
});
