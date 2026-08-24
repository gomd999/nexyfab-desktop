import type { ModelVar } from '../ModelParametersPanel';
import type { NfabGlobalVariableV1 } from '../io/nfabFormat';

type PersistedModelVariable = Pick<ModelVar, 'name' | 'expression'>;

function dataRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return null;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function dataValue(record: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function arrayItems(value: unknown): unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) return null;
      items.push(descriptor.value);
    }
    return items;
  } catch {
    return null;
  }
}

function persistedVariable(value: unknown): PersistedModelVariable | null {
  const record = dataRecord(value);
  if (!record) return null;
  const name = dataValue(record, 'name');
  const expression = dataValue(record, 'expression');
  return typeof name === 'string' && typeof expression === 'string'
    ? { name, expression }
    : null;
}

/**
 * Removes UI-only ids and evaluated values from the NFAB persistence payload.
 * Inputs originate in React state, but the defensive data-only boundary keeps
 * this helper safe if it is later exposed to an agent or plugin adapter.
 */
export function createGlobalVariableSnapshot(input: unknown): NfabGlobalVariableV1[] {
  const items = arrayItems(input);
  if (!items) return [];
  const output: NfabGlobalVariableV1[] = [];
  for (const item of items) {
    const variable = persistedVariable(item);
    if (variable) output.push(variable);
  }
  return output;
}

/**
 * Creates deterministic ModelVar seeds. The caller deliberately runs the
 * existing expression resolver so there remains one evaluation implementation.
 */
export function createGlobalVariableRestoreSeeds(input: unknown): ModelVar[] {
  const items = arrayItems(input);
  if (!items) return [];
  const output: ModelVar[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const variable = persistedVariable(items[index]);
    if (!variable) continue;
    output.push({
      id: `mv-nfab-${index}-${variable.name}`,
      name: variable.name,
      expression: variable.expression,
      value: 0,
    });
  }
  return output;
}
