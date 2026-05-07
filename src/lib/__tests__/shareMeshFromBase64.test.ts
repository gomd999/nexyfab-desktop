import { describe, it, expect } from 'vitest';
import {
  bufferGeometryFromShareMeshBase64,
  parseShareMeshJsonString,
} from '@/lib/nexyfab/shareMeshFromBase64';

describe('shareMeshFromBase64', () => {
  it('parseShareMeshJsonString rejects empty positions', () => {
    expect(parseShareMeshJsonString('{}')).toBeNull();
    expect(parseShareMeshJsonString('{"positions":[]}')).toBeNull();
  });

  it('bufferGeometryFromShareMeshBase64 builds a triangle', () => {
    const payload = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const geo = bufferGeometryFromShareMeshBase64(b64);
    expect(geo).not.toBeNull();
    expect(geo!.getAttribute('position').count).toBe(3);
    geo!.dispose();
  });

  it('returns null for invalid base64 / json', () => {
    expect(bufferGeometryFromShareMeshBase64('not-valid-base64!!!')).toBeNull();
  });
});
