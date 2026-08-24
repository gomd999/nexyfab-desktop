import { BufferGeometry, Float32BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { geometryToStlBase64 } from './geometryToStlBase64';

describe('geometryToStlBase64', () => {
  it('serializes one triangle with a valid binary STL header and coordinates', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    const encoded = geometryToStlBase64(geometry);
    expect(encoded).not.toBeNull();
    const bytes = Buffer.from(encoded!, 'base64');
    expect(bytes.length).toBe(134);
    expect(bytes.readUInt32LE(80)).toBe(1);
    expect(bytes.readFloatLE(108)).toBe(1);
    expect(bytes.readFloatLE(124)).toBe(1);
  });

  it('returns null when geometry has no complete triangle', () => {
    expect(geometryToStlBase64(new BufferGeometry())).toBeNull();
  });
});
