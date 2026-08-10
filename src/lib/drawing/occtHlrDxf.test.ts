import { describe, expect, it } from 'vitest';
import { occtHlrCurveRecords, occtHlrSerializedToDxf } from './occtHlrDxf';

const drawing = (curves: string[]) => JSON.stringify({ type: 'Blueprint', curves });

describe('occtHlrSerializedToDxf', () => {
  it('preserves OCCT lines, analytic circles, and B-splines as CAD entities', () => {
    const visible = drawing([
      '8 0 25\n1 2 3 1 0\n',
      `8 0 ${Math.PI * 2}\n2 10 20 1 0 0 1 5\n`,
      '7 0 0 1 2 2  0 0  10 5  0 2  1 2\n',
    ]);
    const hidden = drawing(['8 0 4\n1 -2 7 0 1\n']);
    const result = occtHlrSerializedToDxf(visible, hidden);
    expect(result).toMatchObject({
      curveCount: 4,
      entityCounts: { LINE: 2, CIRCLE: 1, ARC: 0, SPLINE: 1 },
      curveTypes: [1, 2, 7],
    });
    expect(result.dxf).toContain('AC1027');
    expect(result.dxf.match(/\nLINE\n/g)).toHaveLength(2);
    expect(result.dxf).toContain('\nCIRCLE\n');
    expect(result.dxf).toContain('\nSPLINE\n');
    expect(result.dxf).toContain('\nVISIBLE\n');
    expect(result.dxf).toContain('\nHIDDEN\n');
    expect(result.dxf).toContain('\n11\n27\n21\n3\n');
  });

  it('emits a trimmed analytic circle as an ARC with the preserved parameter interval', () => {
    const result = occtHlrSerializedToDxf(drawing([
      `8 0 ${Math.PI / 2}\n2 0 0 1 0 0 1 10\n`,
    ]), drawing([]));
    expect(result.entityCounts).toMatchObject({ CIRCLE: 0, ARC: 1 });
    expect(result.dxf).toContain('\nARC\n');
    expect(result.dxf).toContain('\n50\n0\n51\n90\n');
  });

  it('walks nested Blueprints deterministically', () => {
    const serialized = JSON.stringify({
      type: 'Blueprints',
      blueprints: [
        { type: 'Blueprint', curves: ['8 0 1\n1 0 0 1 0\n'] },
        { type: 'Blueprint', curves: ['8 0 1\n1 0 1 1 0\n'] },
      ],
    });
    expect(occtHlrCurveRecords(serialized)).toHaveLength(2);
  });

  it('fails closed instead of dropping unsupported or malformed curves', () => {
    expect(() => occtHlrSerializedToDxf(drawing(['8 0 1\n5 0 0 1 0 2 1\n']), drawing([])))
      .toThrow(/unsupported.*type 5/i);
    expect(() => occtHlrSerializedToDxf(drawing(['7 0 0 3 2 2 0 0\n']), drawing([])))
      .toThrow(/B-spline/i);
    expect(() => occtHlrSerializedToDxf('{bad json', drawing([])))
      .toThrow(/not valid JSON/i);
  });
});
