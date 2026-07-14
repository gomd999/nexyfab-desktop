/**
 * 플랫폼-중립 코어 (node/Worker 공용): 계산기 목록 + intent 게이트 + 실행.
 * node 전용 로더(fs)는 registry.mjs에, Cloudflare Worker는 worker/src에서 이 코어를 직접 사용.
 */
import retainingWall from './calculators/retaining-wall-stability.mjs';
import columnBuckling from './calculators/column-buckling.mjs';
import simpleBeam from './calculators/simple-beam.mjs';
import boltConnection from './calculators/bolt-connection.mjs';
import rackFrame from './calculators/rack-frame.mjs';
import rcBeam from './calculators/rc-beam.mjs';
import landscapeDrainage from './calculators/landscape-drainage.mjs';
import rcColumn from './calculators/rc-column.mjs';
import isolatedFooting from './calculators/isolated-footing.mjs';
import occupancyEgress from './calculators/occupancy-egress.mjs';
import timberBeam from './calculators/timber-beam.mjs';
import boxCulvertFrame from './calculators/box-culvert-frame.mjs';
import seismicStatic from './calculators/seismic-static.mjs';

export const calculators = [retainingWall, columnBuckling, simpleBeam, boltConnection, rackFrame, rcBeam, landscapeDrainage, rcColumn, isolatedFooting, occupancyEgress, timberBeam, boxCulvertFrame, seismicStatic];

/** Minimal JSON-Schema-subset validator (type/required/properties/minimum/maximum/enum). */
export function validateInput(schema, input) {
  const errors = [];
  if (typeof input !== 'object' || input === null) errors.push('input must be an object');
  else {
    for (const key of schema.required ?? []) {
      if (input[key] === undefined || input[key] === null) errors.push(`missing required: ${key}`);
    }
    for (const [key, val] of Object.entries(input)) {
      const prop = schema.properties?.[key];
      if (!prop) { errors.push(`unknown field: ${key}`); continue; }
      if (prop.type === 'number' && typeof val !== 'number') errors.push(`${key}: must be number`);
      if (prop.type === 'string' && typeof val !== 'string') errors.push(`${key}: must be string`);
      if (prop.type === 'integer' && !Number.isInteger(val)) errors.push(`${key}: must be integer`);
      if (typeof val === 'number') {
        if (Number.isNaN(val) || !Number.isFinite(val)) errors.push(`${key}: must be finite`);
        if (prop.minimum !== undefined && val < prop.minimum) errors.push(`${key}: >= ${prop.minimum} required`);
        if (prop.exclusiveMinimum !== undefined && val <= prop.exclusiveMinimum) errors.push(`${key}: > ${prop.exclusiveMinimum} required`);
        if (prop.maximum !== undefined && val > prop.maximum) errors.push(`${key}: <= ${prop.maximum} required`);
      }
      if (prop.enum && !prop.enum.includes(val)) errors.push(`${key}: must be one of ${prop.enum.join(', ')}`);
    }
  }
  if (errors.length) {
    const e = new Error(`input gate failed: ${errors.join('; ')}`);
    e.code = 'INPUT_GATE';
    throw e;
  }
}

/** Run a calculator with an explicit standards map (platform-neutral). */
export function runCalculatorCore(standards, id, input, standardId = 'KDS') {
  const calc = calculators.find((c) => c.id === id);
  if (!calc) throw new Error(`unknown calculator: ${id} (available: ${calculators.map((c) => c.id).join(', ')})`);
  const std = standards[standardId];
  if (!std) throw new Error(`unknown standard: ${standardId} (available: ${Object.keys(standards).join(', ')})`);
  validateInput(calc.inputSchema, input);
  const result = calc.run(input, std);
  return {
    calculator: calc.id,
    domain: calc.domain,
    standard: std.id,
    standardDraft: std.draft === true,
    status: calc.status,
    refs: calc.refs,
    disclaimer: '구조 검토 참고자료(비법정) — 법정 계산서는 기술사 날인 영역',
    ...(std.attribution ? { attribution: std.attribution } : {}),
    ...result,
  };
}
