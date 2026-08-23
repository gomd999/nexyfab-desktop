import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { designPair } from './designI18n';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/[lang]/nexyfab/design/DesignInner.tsx'), 'utf8');

describe('DesignInner localization wiring', () => {
  it('does not keep executable ko/en ternary UI branches', () => {
    expect(source).not.toMatch(/\bko\s+\?/);
  });

  it('normalizes kr/cn route aliases through the shared copy helper', () => {
    expect(designPair('kr', '한국어', 'English')).toBe('한국어');
    expect(designPair('cn', '한국어', 'English')).toBe('English');
  });
});
