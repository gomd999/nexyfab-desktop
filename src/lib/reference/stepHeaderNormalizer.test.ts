import { describe, expect, it } from 'vitest';
import { normalizeStepHeaderAuthorisation } from './stepHeaderNormalizer';

const step = (authorization: string, extra = '') => `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nFILE_NAME(\n/* name */ 'a',\n/* time */ '',\n(''),(''),'','',\n/* authorisation */ ${authorization});${extra}\nFILE_SCHEMA(('AP242'));\nENDSEC;\nDATA;\n#1=PRODUCT('$ must stay','',(),());\nENDSEC;\nEND-ISO-10303-21;\n`;

describe('normalizeStepHeaderAuthorisation', () => {
  it('repairs only the single FILE_NAME final unset token and preserves DATA exactly', () => {
    const source = step('$');
    const beforeData = source.slice(source.indexOf('DATA;'));
    const result = normalizeStepHeaderAuthorisation(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toContain("/* authorisation */ '');");
    expect(result.source.slice(result.source.indexOf('DATA;'))).toBe(beforeData);
    expect(result.repair.originalSha256).not.toBe(result.repair.repairedSha256);
  });

  it('does not rewrite an already valid empty authorisation', () => {
    expect(normalizeStepHeaderAuthorisation(step("''"))).toEqual({ ok: false, reason: 'not-applicable' });
  });

  it('rejects multiple FILE_NAME entities, extra unset tokens, and ambiguous DATA sections', () => {
    const duplicate = step('$').replace("FILE_SCHEMA", "FILE_NAME('b','',(''),(''),'','',$);\nFILE_SCHEMA");
    expect(normalizeStepHeaderAuthorisation(duplicate)).toEqual({ ok: false, reason: 'ambiguous-file-name' });
    expect(normalizeStepHeaderAuthorisation(step('$', ' $'))).toEqual({ ok: false, reason: 'unsafe-file-name' });
    expect(normalizeStepHeaderAuthorisation(`${step('$')}\nDATA;`)).toEqual({ ok: false, reason: 'ambiguous-sections' });
  });

  it('rejects a dollar token outside the final authorisation slot', () => {
    expect(normalizeStepHeaderAuthorisation(step("''").replace("(''),('')", "($),('')"))).toEqual({ ok: false, reason: 'unsafe-file-name' });
  });
});
