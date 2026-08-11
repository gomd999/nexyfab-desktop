import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const productionLayouts = [
  'src/app/(auth)/layout.tsx',
  'src/app/[lang]/layout.tsx',
  'src/app/partner/layout.tsx',
];

describe('production font build boundary', () => {
  it('does not require a remote Google font download during compilation', () => {
    for (const relativePath of productionLayouts) {
      const source = readFileSync(path.join(root, relativePath), 'utf8');
      expect(source, relativePath).not.toContain('next/font/google');
    }
  });
});
