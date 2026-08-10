import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function writeImmutableArtifactAtomic(directory: string, basename: string, bytes: Buffer, collisionCode: string) {
  if (path.basename(basename) !== basename || !basename.trim()) throw new Error('immutable_artifact_basename_invalid');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, basename);
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isFile() || !fs.readFileSync(target).equals(bytes)) throw new Error(`${collisionCode}:${basename}`);
    return;
  }
  const temporary = path.join(directory, `.${basename}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  try {
    try { fs.linkSync(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!fs.statSync(target).isFile() || !fs.readFileSync(target).equals(bytes)) throw new Error(`${collisionCode}:${basename}`);
    }
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function writeLatestArtifactAtomic(filename: string, bytes: Buffer) {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true });
  const basename = path.basename(filename);
  const temporary = path.join(directory, `.${basename}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  try { fs.renameSync(temporary, filename); }
  finally { fs.rmSync(temporary, { force: true }); }
}
