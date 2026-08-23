export type JsonSchema = Readonly<Record<string, unknown>>;

export type ToolArgumentValidationCode = 'INVALID_TOOL_ARGUMENTS' | 'INVALID_TOOL_SCHEMA';
export type ToolArgumentValidationResult =
  | { ok: true }
  | { ok: false; error: { code: ToolArgumentValidationCode } };

const META_KEYS = new Set([
  'type',
  'required',
  'properties',
  'additionalProperties',
  'enum',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'items',
  'minItems',
  'maxItems',
  'description',
  'title',
]);

function invalidArguments(): ToolArgumentValidationResult {
  return { ok: false, error: { code: 'INVALID_TOOL_ARGUMENTS' } };
}

function invalidSchema(): ToolArgumentValidationResult {
  return { ok: false, error: { code: 'INVALID_TOOL_SCHEMA' } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameJson(left[key], right[key]));
  }
  return false;
}

function schemaShape(schema: unknown): ToolArgumentValidationResult {
  if (!isRecord(schema)) return invalidSchema();
  for (const key of Object.keys(schema)) {
    if (!META_KEYS.has(key)) return invalidSchema();
  }
  if (schema.type !== 'object' && schema.type !== 'array' && schema.type !== 'string' && schema.type !== 'number' && schema.type !== 'integer' && schema.type !== 'boolean' && schema.type !== 'null') return invalidSchema();
  if ('enum' in schema && (!Array.isArray(schema.enum) || schema.enum.length === 0)) return invalidSchema();
  if ('minimum' in schema && (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum))) return invalidSchema();
  if ('maximum' in schema && (typeof schema.maximum !== 'number' || !Number.isFinite(schema.maximum))) return invalidSchema();
  if (typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && schema.minimum > schema.maximum) return invalidSchema();
  if ('minLength' in schema && (!Number.isInteger(schema.minLength) || (schema.minLength as number) < 0)) return invalidSchema();
  if ('maxLength' in schema && (!Number.isInteger(schema.maxLength) || (schema.maxLength as number) < 0)) return invalidSchema();
  if (typeof schema.minLength === 'number' && typeof schema.maxLength === 'number' && schema.minLength > schema.maxLength) return invalidSchema();
  if ('minItems' in schema && (!Number.isInteger(schema.minItems) || (schema.minItems as number) < 0)) return invalidSchema();
  if ('maxItems' in schema && (!Number.isInteger(schema.maxItems) || (schema.maxItems as number) < 0)) return invalidSchema();
  if (typeof schema.minItems === 'number' && typeof schema.maxItems === 'number' && schema.minItems > schema.maxItems) return invalidSchema();
  if ('required' in schema && (!Array.isArray(schema.required) || !schema.required.every((item) => typeof item === 'string'))) return invalidSchema();
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean') return invalidSchema();
  if (schema.type === 'object') {
    if (schema.properties !== undefined && !isRecord(schema.properties)) return invalidSchema();
    if (schema.required && schema.properties) {
      const keys = new Set(Object.keys(schema.properties));
      if (!(schema.required as string[]).every((key) => keys.has(key))) return invalidSchema();
    }
    for (const child of Object.values((schema.properties as Record<string, unknown> | undefined) ?? {})) {
      const result = schemaShape(child);
      if (!result.ok) return result;
    }
  }
  if (schema.type === 'array' && schema.items !== undefined) {
    const result = schemaShape(schema.items);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function validateValue(schema: JsonSchema, value: unknown): boolean {
  if (!validateEnum(schema, value)) return false;
  switch (schema.type) {
    case 'object': {
      if (!isRecord(value)) return false;
      const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
      const required = (schema.required as string[] | undefined) ?? [];
      if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return false;
      if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.prototype.hasOwnProperty.call(properties, key))) return false;
      return Object.entries(properties).every(([key, child]) => !(key in value) || validateValue(child, value[key]));
    }
    case 'array':
      return Array.isArray(value)
        && (schema.minItems === undefined || value.length >= (schema.minItems as number))
        && (schema.maxItems === undefined || value.length <= (schema.maxItems as number))
        && (schema.items === undefined || value.every((item) => validateValue(schema.items as JsonSchema, item)));
    case 'string':
      return typeof value === 'string' && (schema.minLength === undefined || value.length >= (schema.minLength as number)) && (schema.maxLength === undefined || value.length <= (schema.maxLength as number));
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && (schema.minimum === undefined || value >= (schema.minimum as number)) && (schema.maximum === undefined || value <= (schema.maximum as number));
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) && (schema.minimum === undefined || value >= (schema.minimum as number)) && (schema.maximum === undefined || value <= (schema.maximum as number));
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function validateEnum(schema: JsonSchema, value: unknown): boolean {
  return !Array.isArray(schema.enum) || schema.enum.some((candidate) => sameJson(candidate, value));
}

export function validateToolArguments(schema: JsonSchema, argumentsValue: unknown): ToolArgumentValidationResult {
  const shape = schemaShape(schema);
  if (!shape.ok) return shape;
  if (!validateEnum(schema, argumentsValue) || !validateValue(schema, argumentsValue)) return invalidArguments();
  return { ok: true };
}
