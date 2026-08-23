import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('public landing accessibility regressions', () => {
  it('keeps visible text in the language selector accessible name', () => {
    const content = source('src/components/LanguageSelector.tsx');
    expect(content).toContain('aria-label={`${currentLabel} — ${SELECT_LANGUAGE_LABEL[currentLang]}`}');
  });

  it('does not override article semantics with listitem roles', () => {
    const content = source('src/app/[lang]/HomeClient.tsx');
    expect(content).not.toContain('role="listitem"');
    expect(content).not.toContain('className="hat-grid" role="list"');
  });

  it('uses the audited high-contrast landing colors', () => {
    const home = source('src/app/[lang]/HomeClient.tsx');
    const developer = source('src/app/[lang]/EngVertical.tsx');
    const footer = source('src/components/Footer.tsx');
    const css = source('src/app/custom.css');

    expect(home).toContain("color: '#1d4ed8'");
    expect(home).toContain("color: '#6d28d9'");
    expect(home).toContain("color: '#047857'");
    expect(developer).toContain("color: '#475569'");
    expect(footer).toContain("color: '#4b5563'");
    expect(css).not.toMatch(/#Nexyfab-footer \.hat-footer-note \{[^}]*color: rgba\(0, 0, 0, \.50\)/);
  });

  it('reserves the full hero viewport while the client-only assistant loads', () => {
    const content = source('src/app/[lang]/HomeClient.tsx');
    expect(content).toContain("minHeight: '100dvh'");
    expect(content).not.toContain('style={{ minHeight: 560');
  });
});
