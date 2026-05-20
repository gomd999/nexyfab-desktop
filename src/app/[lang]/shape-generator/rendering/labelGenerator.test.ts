import { describe, it, expect } from 'vitest';
import {
  renderLabel,
  wrapToCylinder,
  summarize,
  LABEL_PRESETS,
  type LabelSpec,
} from './labelGenerator';

const simpleSpec: LabelSpec = {
  widthMm: 50,
  heightMm: 20,
  marginMm: 2,
  fields: [
    { id: 'text', kind: 'text', value: 'Hello {name}!', bbox: { x: 5, y: 8, width: 40, height: 6 } },
    { id: 'date', kind: 'date', value: 'YYYY-MM-DD', bbox: { x: 5, y: 2, width: 30, height: 4 } },
  ],
};

describe('renderLabel — variables', () => {
  it('substitutes template variables', () => {
    const r = renderLabel(simpleSpec, { vars: { name: 'World' } });
    const text = r.fields.find(f => f.id === 'text');
    expect(text?.value).toBe('Hello World!');
  });

  it('missing var warns', () => {
    const r = renderLabel(simpleSpec, { vars: {} });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('renderLabel — date', () => {
  it('formats current date in YYYY-MM-DD', () => {
    const fixedDate = new Date('2026-05-19');
    const r = renderLabel(simpleSpec, { vars: { name: 'X' }, date: fixedDate });
    const dateField = r.fields.find(f => f.id === 'date');
    expect(dateField?.value).toBe('2026-05-19');
  });

  it('supports custom format', () => {
    const spec: LabelSpec = {
      ...simpleSpec,
      fields: [{ id: 'd', kind: 'date', value: 'YY/MM/DD', bbox: { x: 5, y: 5, width: 30, height: 4 } }],
    };
    const r = renderLabel(spec, { vars: {}, date: new Date('2026-05-19') });
    expect(r.fields[0]!.value).toBe('26/05/19');
  });
});

describe('renderLabel — sequence', () => {
  it('pads to 5 zeros', () => {
    const spec: LabelSpec = {
      ...simpleSpec,
      fields: [{ id: 'sn', kind: 'sequence', value: '00000', bbox: { x: 5, y: 5, width: 30, height: 4 } }],
    };
    const r = renderLabel(spec, { vars: {}, sequence: 42 });
    expect(r.fields[0]!.value).toBe('00042');
  });
});

describe('renderLabel — overflow', () => {
  it('warns when field exceeds margin', () => {
    const spec: LabelSpec = {
      widthMm: 20, heightMm: 10, marginMm: 2,
      fields: [{ id: 'a', kind: 'text', value: 'x', bbox: { x: 0, y: 0, width: 25, height: 8 } }],
    };
    const r = renderLabel(spec, { vars: {} });
    expect(r.warnings.some(w => w.includes('overflow'))).toBe(true);
  });
});

describe('renderLabel — date:format token', () => {
  it('inline date format token', () => {
    const spec: LabelSpec = {
      ...simpleSpec,
      fields: [{ id: 't', kind: 'text', value: 'Made on {date:DD-MM-YYYY}', bbox: { x: 5, y: 5, width: 40, height: 4 } }],
    };
    const r = renderLabel(spec, { vars: {}, date: new Date('2026-05-19') });
    expect(r.fields[0]!.value).toBe('Made on 19-05-2026');
  });
});

describe('wrapToCylinder', () => {
  it('zero label width → on-axis', () => {
    const label: LabelSpec = { widthMm: 100, heightMm: 50, marginMm: 0, fields: [] };
    const wrapped = wrapToCylinder({ x: 0, y: 10 }, label, { radiusMm: 50, axis: 'z', baseAngleRad: 0 });
    expect(wrapped.x).toBeCloseTo(50, 3);
    expect(wrapped.y).toBeCloseTo(0, 3);
  });

  it('axis y preserves y coordinate', () => {
    const label: LabelSpec = { widthMm: 100, heightMm: 50, marginMm: 0, fields: [] };
    const wrapped = wrapToCylinder({ x: 0, y: 25 }, label, { radiusMm: 50, axis: 'y', baseAngleRad: 0 });
    expect(wrapped.y).toBeCloseTo(25, 3);
  });
});

describe('summarize', () => {
  it('counts by kind', () => {
    const r = renderLabel(simpleSpec, { vars: { name: 'X' } });
    const s = summarize(simpleSpec, r);
    expect(s.fieldCount).toBe(2);
    expect(s.fieldsByKind.text).toBe(1);
    expect(s.fieldsByKind.date).toBe(1);
  });

  it('totalAreaUsedMm2 > 0', () => {
    const r = renderLabel(simpleSpec, { vars: { name: 'X' } });
    const s = summarize(simpleSpec, r);
    expect(s.totalAreaUsedMm2).toBeGreaterThan(0);
  });
});

describe('LABEL_PRESETS', () => {
  it('serial plate renders without overflow', () => {
    const r = renderLabel(LABEL_PRESETS.serial_plate!, { vars: { partNumber: 'PN-001' } });
    expect(r.fields.length).toBeGreaterThan(0);
  });

  it('qr-only has one field', () => {
    expect(LABEL_PRESETS.qr_only!.fields).toHaveLength(1);
  });
});
