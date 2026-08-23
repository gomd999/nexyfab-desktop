/** Shared, bounded JSON-RPC/MCP stdio transport for the local MCP servers. */
export const LATEST_LEGACY_PROTOCOL_VERSION = '2025-11-25';
export const LEGACY_PROTOCOL_VERSIONS = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  LATEST_LEGACY_PROTOCOL_VERSION,
]);
export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const MAX_REQUEST_LINE_BYTES = 1_048_576;
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** Decode one complete JSON-RPC frame without accepting replacement characters. */
export function decodeUtf8Frame(lineBytes) {
  return fatalUtf8Decoder.decode(lineBytes);
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MODERN_PROTOCOL_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const MODERN_CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const MODERN_CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * Incremental newline framing for JSON-RPC over stdio.
 *
 * The line buffer is capped in bytes (rather than decoded characters), and
 * oversized frames are discarded until their newline. A CR immediately
 * before LF is treated as the CRLF terminator and is not part of the frame.
 * @param {{
 *   input?: import('node:stream').Readable,
 *   maxBytes: number,
 *   onLine: (line: Buffer) => void,
 *   onOversizedLine?: () => void,
 * }} options
 */
export function createBoundedLineReader({ input = process.stdin, maxBytes, onLine, onOversizedLine }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a non-negative integer');
  if (typeof onLine !== 'function') throw new TypeError('onLine must be a function');
  const lineBuffer = Buffer.allocUnsafe(maxBytes);
  let lineLength = 0;
  let oversized = false;
  let pendingCarriageReturn = false;
  let closed = false;

  const reset = () => {
    lineLength = 0;
    oversized = false;
    pendingCarriageReturn = false;
  };
  const finish = () => {
    if (oversized) onOversizedLine?.();
    else if (lineLength > 0) onLine(lineBuffer.subarray(0, lineLength));
    reset();
  };
  const append = (byte) => {
    if (lineLength >= maxBytes) {
      oversized = true;
      return;
    }
    lineBuffer[lineLength++] = byte;
  };
  const consume = (byte) => {
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;
      if (byte === 0x0a) {
        finish();
        return;
      }
      append(0x0d);
    }
    if (byte === 0x0a) {
      finish();
    } else if (byte === 0x0d) {
      pendingCarriageReturn = true;
    } else {
      append(byte);
    }
  };
  const onData = (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (const byte of bytes) consume(byte);
  };
  const onEnd = () => {
    if (closed) return;
    closed = true;
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;
      append(0x0d);
    }
    if (lineLength > 0 || oversized) finish();
  };
  input.on('data', onData);
  input.once('end', onEnd);
  return {
    close() {
      if (closed) return;
      closed = true;
      input.off('data', onData);
      input.off('end', onEnd);
    },
  };
}

function boundedValue(value, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (depth > 24 || state.nodes > 8192) return false;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') <= 262_144;
  if (Array.isArray(value)) return value.length <= 1024 && value.every((item) => boundedValue(item, depth + 1, state));
  if (!isObject(value)) return true;
  const keys = Object.keys(value);
  return keys.length <= 1024 && keys.every((key) => !PROTOTYPE_KEYS.has(key) && boundedValue(value[key], depth + 1, state));
}

function validId(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function modernMeta(meta) {
  return isObject(meta) && meta[MODERN_PROTOCOL_META_KEY] === MODERN_PROTOCOL_VERSION
    && Object.keys(meta).every((key) => !PROTOTYPE_KEYS.has(key));
}

function discoveryMeta(meta) {
  const clientInfo = isObject(meta) ? meta[MODERN_CLIENT_INFO_META_KEY] : undefined;
  return modernMeta(meta)
    && isObject(clientInfo)
    && typeof clientInfo.name === 'string' && clientInfo.name.length > 0 && clientInfo.name.length <= 256
    && typeof clientInfo.version === 'string' && clientInfo.version.length > 0 && clientInfo.version.length <= 128
    && isObject(meta[MODERN_CLIENT_CAPABILITIES_META_KEY]);
}

function modernStamp(serverInfo) {
  return { 'io.modelcontextprotocol/serverInfo': serverInfo };
}

function schemaIssues(schema, value, path = 'arguments', issues = []) {
  if (issues.length >= 32 || !isObject(schema)) return issues;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matchesType = (type) => type === 'object' ? isObject(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'string' ? typeof value === 'string'
        : type === 'integer' ? Number.isInteger(value)
          : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : type === 'boolean' ? typeof value === 'boolean'
              : type === 'null' ? value === null : true;
  if (types.length && !types.some(matchesType)) { issues.push(`invalid ${path}`); return issues; }
  if (hasOwn(schema, 'const') && !Object.is(value, schema.const)) issues.push(`invalid ${path}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) issues.push(`invalid ${path}`);
  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) issues.push(`invalid ${path}`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) issues.push(`invalid ${path}`);
    if (typeof schema.pattern === 'string') {
      try { if (!new RegExp(schema.pattern, 'u').test(value)) issues.push(`invalid ${path}`); } catch { issues.push(`invalid ${path}`); }
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push(`invalid ${path}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push(`invalid ${path}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) issues.push(`invalid ${path}`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) issues.push(`invalid ${path}`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) issues.push(`invalid ${path}`);
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) issues.push(`invalid ${path}`);
    if (isObject(schema.items)) value.forEach((item, index) => schemaIssues(schema.items, item, `${path}[${index}]`, issues));
  }
  if (isObject(value)) {
    const props = isObject(schema.properties) ? schema.properties : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof key === 'string' && (!hasOwn(value, key) || value[key] === null || value[key] === undefined)) issues.push(`missing ${path}.${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (PROTOTYPE_KEYS.has(key)) { issues.push(`invalid ${path}.${key}`); continue; }
      if (hasOwn(props, key)) schemaIssues(props[key], item, `${path}.${key}`, issues);
      else if (schema.additionalProperties === false) issues.push(`invalid ${path}.${key}`);
      else if (isObject(schema.additionalProperties)) schemaIssues(schema.additionalProperties, item, `${path}.${key}`, issues);
      if (issues.length >= 32) break;
    }
  }
  return issues;
}

function basicSchemaIssues(schema, args) {
  if (!isObject(args)) return ['arguments must be an object'];
  return schemaIssues({ ...schema, additionalProperties: schema?.additionalProperties ?? false }, args);
}

/**
 * Start a server over an injected or process stdio stream. Tool functions are
 * intentionally supplied by the caller so this module cannot alter tool logic.
 */
export function createStdioMcpServer({ input = process.stdin, output = process.stdout, serverInfo, tools, callTool, validateToolInput } = {}) {
  const toolNames = new Set((tools ?? []).map((tool) => tool.name));
  let protocolEra = null;
  let pending = Promise.resolve();

  const stampResult = (result) => {
    if (protocolEra !== 'modern' || !isObject(result)) return result;
    return { resultType: 'complete', ...result, _meta: { ...result._meta, ...modernStamp(serverInfo) } };
  };

  const start = (message) => {
    try { output.write(`${JSON.stringify(message)}\n`); } catch { /* closed stream */ }
  };

  const handle = async (request) => {
    const objectRequest = isObject(request);
    const hasId = objectRequest && hasOwn(request, 'id');
    const notification = objectRequest && !hasId && request.jsonrpc === '2.0' && typeof request.method === 'string';
    const reply = (result) => hasId && start({ jsonrpc: '2.0', id: request.id, result: stampResult(result) });
    const fail = (code, message, data) => hasId && start({ jsonrpc: '2.0', id: request.id, error: { code, message, ...(data === undefined ? {} : { data }) } });
    if (!objectRequest || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (hasId && !validId(request.id)) || (hasOwn(request, 'params') && request.params !== undefined && !isObject(request.params))) {
      if (!notification) start({ jsonrpc: '2.0', id: hasId && validId(request?.id) ? request.id : null, error: { code: -32600, message: 'invalid request' } });
      return;
    }
    if (!boundedValue(request)) { if (!notification) fail(-32600, 'invalid request'); return; }
    // MCP request methods require an id. Treat every id-less message as a
    // notification and never execute tool calls or change protocol state.
    if (!hasId) return;
    const params = request.params;
    const hasModernParams = isObject(params) && hasOwn(params, '_meta');
    const claimedModernVersion = isObject(params?._meta) ? params._meta[MODERN_PROTOCOL_META_KEY] : undefined;
    if (typeof claimedModernVersion === 'string' && claimedModernVersion !== MODERN_PROTOCOL_VERSION) {
      if (!notification) fail(-32022, 'Unsupported protocol version', { supported: [MODERN_PROTOCOL_VERSION], requested: claimedModernVersion });
      return;
    }
    if (hasModernParams && !modernMeta(params._meta)) { if (!notification) fail(-32602, 'invalid params'); return; }
    if (protocolEra === 'modern' && !modernMeta(params?._meta)) { if (!notification) fail(-32602, 'invalid params'); return; }
    if (protocolEra === 'legacy' && modernMeta(params?._meta)) { if (!notification) fail(-32602, 'invalid params'); return; }
    if (protocolEra === null && modernMeta(params?._meta)) protocolEra = 'modern';

    try {
      if (request.method === 'server/discover') {
        if (!isObject(params) || !discoveryMeta(params._meta) || Object.keys(params).some((key) => key !== '_meta')) { if (!notification) fail(-32602, 'invalid params'); return; }
        protocolEra = 'modern';
        reply({
          supportedVersions: [MODERN_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          instructions: 'Use tools/list before tools/call. Tool failures are returned with isError=true.',
          ttlMs: 60_000,
          cacheScope: 'private',
        });
        return;
      }
      if (request.method === 'initialize') {
        if (params !== undefined && !isObject(params)) { if (!notification) fail(-32602, 'invalid params'); return; }
        const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : undefined;
        protocolEra = 'legacy';
        reply({ protocolVersion: requested && LEGACY_PROTOCOL_VERSIONS.has(requested) ? requested : LATEST_LEGACY_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo });
        return;
      }
      if (request.method === 'notifications/initialized' || request.method === 'initialized') return;
      if (request.method === 'ping') {
        if (params !== undefined && (!isObject(params) || (protocolEra === 'modern' && Object.keys(params).some((key) => key !== '_meta')))) { if (!notification) fail(-32602, 'invalid params'); return; }
        reply({}); return;
      }
      if (request.method === 'tools/list') {
        if (params !== undefined && (!isObject(params) || (protocolEra === 'modern' && Object.keys(params).some((key) => key !== '_meta')))) { if (!notification) fail(-32602, 'invalid params'); return; }
        reply({ tools: (tools ?? []).map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: tool.inputSchema?.additionalProperties ?? false } })) }); return;
      }
      if (request.method === 'tools/call') {
        const callParams = isObject(params) ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== '_meta')) : null;
        if (!isObject(callParams) || typeof callParams.name !== 'string' || (callParams.arguments !== undefined && !isObject(callParams.arguments)) || Object.keys(callParams).some((key) => !['name', 'arguments'].includes(key) || PROTOTYPE_KEYS.has(key))) { if (!notification) fail(-32602, 'invalid params'); return; }
        if (!toolNames.has(callParams.name)) { if (!notification) fail(-32602, 'invalid params'); return; }
        const args = callParams.arguments ?? {};
        const tool = tools.find((item) => item.name === callParams.name);
        const schemaIssues = validateToolInput ? validateToolInput(callParams.name, args) : basicSchemaIssues(tool?.inputSchema, args);
        if (schemaIssues?.length) { reply({ content: [{ type: 'text', text: 'ERROR: INVALID_TOOL_ARGUMENTS' }], isError: true }); return; }
        try {
          const result = await callTool(callParams.name, args);
          reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], ...(isObject(result) && result.ok === false ? { isError: true } : {}) });
        } catch {
          reply({ content: [{ type: 'text', text: 'ERROR: TOOL_CALL_FAILED' }], isError: true });
        }
        return;
      }
      if (!notification) fail(-32601, 'method not found');
    } catch {
      if (!notification) fail(-32603, 'internal error');
    }
  };

  const enqueueLine = (lineBytes) => {
    let line = null;
    let invalidUtf8 = false;
    if (lineBytes !== null) {
      try { line = decodeUtf8Frame(lineBytes); }
      catch { invalidUtf8 = true; }
    }
    pending = pending.then(async () => {
      if (lineBytes === null) { start({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } }); return; }
      if (invalidUtf8 || line === null) { start({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
      const trimmed = line.trim();
      if (!trimmed) return;
      let request;
      try { request = JSON.parse(trimmed); } catch { start({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
      await handle(request);
    }).catch(() => start({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'internal error' } }));
  };
  const readline = createBoundedLineReader({
    input,
    maxBytes: MAX_REQUEST_LINE_BYTES,
    onLine: enqueueLine,
    onOversizedLine: () => enqueueLine(null),
  });
  return { handle, readline };
}
