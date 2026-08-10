import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeLatestArtifactAtomic } from './immutableArtifactStore';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('latest artifact atomic replacement', () => {
  it('publishes a complete file and replaces the previous version without temp residue', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-latest-artifact-')); roots.push(root);
    const filename = path.join(root, 'latest.json');
    writeLatestArtifactAtomic(filename, Buffer.from('{"version":1}\n'));
    writeLatestArtifactAtomic(filename, Buffer.from('{"version":2}\n'));
    expect(fs.readFileSync(filename, 'utf8')).toBe('{"version":2}\n');
    expect(fs.readdirSync(root)).toEqual(['latest.json']);
  });
});
