/**
 * Calculator registry — 공통 코어 C(계산층).
 * 각 계산기 = { id, domain, title, description, refs[], status, inputSchema, run(input, std) }
 * intent 게이트 패턴: validateInput()이 스키마+범위를 검사하고 위반 시 throw — LLM은 계획만, 계산은 결정론.
 * 표준 파라미터(standards/*.json)는 전부 튜닝 가능 — 코드 수정 없이 계수/안전율 조정.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import retainingWall from './calculators/retaining-wall-stability.mjs';
import columnBuckling from './calculators/column-buckling.mjs';
import simpleBeam from './calculators/simple-beam.mjs';
import boltConnection from './calculators/bolt-connection.mjs';

export const calculators = [retainingWall, columnBuckling, simpleBeam, boltConnection];

export function loadStandards() {
  const dir = join(__dirname, 'standards');
  const out = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    out[s.id] = s;
  }
  return out;
}

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

/** Run a calculator by id with the intent-gate flow. */
export function runCalculator(id, input, standardId = 'KDS') {
  const calc = calculators.find((c) => c.id === id);
  if (!calc) throw new Error(`unknown calculator: ${id} (available: ${calculators.map((c) => c.id).join(', ')})`);
  const standards = loadStandards();
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
    ...result,
  };
}
