#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LATEST_LEGACY_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSIONS,
  MAX_REQUEST_LINE_BYTES,
  MODERN_PROTOCOL_VERSION,
  createBoundedLineReader,
  decodeUtf8Frame,
} from '../mcp-stdio-transport.mjs';
import { buildAssembly } from './assembly.mjs';
import { analyzeDfm } from './dfm.mjs';
import { fabSpec, estimateCost, toDxf } from './fab.mjs';
import { listDomains } from './domain-verify.mjs';
import { bladeRingMesh } from './gen-macros.mjs';
import { assemblyFromSpec } from './loft.mjs';
import { renderPreview } from './render-preview.mjs';
import { resolveConstraints } from './assembly-constraints.mjs';
import { authorizeToolCall, filterTools } from './agent-policy.mjs';

export const installerCoreToolNames = Object.freeze(['list_domains', 'build_assembly', 'analyze_dfm', 'fab_estimate', 'resolve_constraints', 'render_preview', 'blade_ring', 'loft_part']);
export const INSTALLER_WRITE_APPROVAL_FLAG = 'confirmWrite';
export const INSTALLER_WRITE_APPROVAL_ERROR = 'MCP_WRITE_APPROVAL_REQUIRED';
const SERVER_INFO = Object.freeze({ name: 'nexyfab-agent-gateway', version: '0.1.0' });
const MODERN_PROTOCOL_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const MODERN_CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const MODERN_CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const MODERN_SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';
const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_ENVELOPE_DEPTH = 8;
const MAX_ENVELOPE_NODES = 1_000;
const MAX_ENVELOPE_PROPERTIES = 100;
const MAX_ENVELOPE_ARRAY_ITEMS = 100;
const MAX_ENVELOPE_STRING_BYTES = 256 * 1024;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
// The sidecar builder injects the reviewed source schemas. Direct ESM source
// execution loads them lazily; the CJS SEA bundle keeps mcp-server external so
// its unrelated top-level-await CLI paths are not pulled into the binary.
const injectedTools = typeof __NEXYFAB_INSTALLER_CORE_TOOLS__ === 'undefined'
  ? null
  : __NEXYFAB_INSTALLER_CORE_TOOLS__;

async function installerCoreTools() {
  if (injectedTools) return injectedTools;
  const { tools: sourceTools } = await import('./mcp-server.mjs');
  const names = new Set(installerCoreToolNames);
  return sourceTools.filter((tool) => names.has(tool.name));
}

function callTool(name, args = {}) {
  if (name === 'list_domains') return { domains: listDomains() };
  if (name === 'build_assembly') return buildAssembly(args.assembly);
  if (name === 'analyze_dfm') return analyzeDfm(args.intent, { process: args.process, thicknessMm: args.thicknessMm });
  if (name === 'fab_estimate') { const spec = fabSpec(args.intent, { thicknessMm: args.thicknessMm }); return { spec, estimate: estimateCost(spec, args.rates ?? {}), dxf: toDxf(args.intent) }; }
  if (name === 'resolve_constraints') return { ok: true, assembly: resolveConstraints(args.assembly) };
  if (name === 'render_preview') {
    const { pngs, triCount } = renderPreview(args.assembly, { views: Array.isArray(args.views) && args.views.length ? args.views : undefined });
    const result = { ok: true, triCount, parts: args.assembly?.parts?.length ?? 0 };
    if (args.outDir) {
      mkdirSync(args.outDir, { recursive: true });
      result.files = [];
      for (const [view, buffer] of Object.entries(pngs)) {
        const file = join(args.outDir, `preview_${view}.png`);
        writeFileSync(file, buffer);
        result.files.push({ name: `preview_${view}.png`, bytes: buffer.length });
      }
      result.outDir = args.outDir;
    } else {
      result.views = Object.fromEntries(Object.entries(pngs).map(([view, buffer]) => [view, buffer.toString('base64')]));
    }
    return result;
  }
  if (name === 'blade_ring') {
    const bad = [];
    if (!Number.isInteger(args.nB) || args.nB < 2 || args.nB > 60) bad.push(`nB=${args.nB}`);
    for (const key of ['rRoot', 'rTip', 'chord']) if (!(Number(args[key]) > 0)) bad.push(`${key}=${args[key]}`);
    if (Number(args.rTip) <= Number(args.rRoot)) bad.push('rTip<=rRoot');
    if (bad.length) return { ok: false, error: `invalid blade_ring input: ${bad.join(', ')}` };
    const params = { nB: args.nB, rRoot: args.rRoot, rTip: args.rTip, chord: args.chord, cx: args.cx, cy: args.cy ?? 0, cz: args.cz ?? 0, pitch: args.pitch, naca: args.naca ?? '4412' };
    return { params: bladeRingMesh(params), gen: { kind: 'blade_ring', params }, usage: "assembly part: {id, type:'mesh', params, gen, at:{tx:0,ty:0,tz:0}}" };
  }
  if (name === 'loft_part') {
    const assembly = assemblyFromSpec(args);
    const volumeMm3 = assembly.parts.reduce((sum, part) => sum + (part.params.volumeMm3 || 0), 0);
    const triCount = assembly.parts.reduce((sum, part) => sum + (part.params.triCount || 0), 0);
    return { ok: true, assembly, part: assembly.parts[0], parts: assembly.parts.length, volumeMm3, triCount };
  }
  throw new Error('unknown installer-core tool');
}

function requiresWriteApproval(name, args) {
  // The installer sidecar is a second local MCP entrypoint. Keep its
  // filesystem boundary aligned with the raw server: render_preview is
  // proposal-only until outDir is supplied, at which point it needs an
  // explicit per-call approval in addition to the process scope.
  return name === 'render_preview' && typeof args?.outDir === 'string' && args.outDir.length > 0;
}

function withoutWriteApproval(args) {
  if (!isObject(args)) return args;
  const safeArgs = { ...args };
  delete safeArgs[INSTALLER_WRITE_APPROVAL_FLAG];
  return safeArgs;
}

function boundedValue(value, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (depth > MAX_ENVELOPE_DEPTH || state.nodes > MAX_ENVELOPE_NODES) return false;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') <= MAX_ENVELOPE_STRING_BYTES;
  if (Array.isArray(value)) return value.length <= MAX_ENVELOPE_ARRAY_ITEMS && value.every((item) => boundedValue(item, depth + 1, state));
  if (!isObject(value)) return typeof value !== 'number' || Number.isFinite(value);
  const keys = Object.keys(value);
  return keys.length <= MAX_ENVELOPE_PROPERTIES && keys.every((key) => !PROTOTYPE_KEYS.has(key)
    && Buffer.byteLength(key, 'utf8') <= 256 && boundedValue(value[key], depth + 1, state));
}

function schemaIssues(schema, value, path = 'arguments', issues = []) {
  if (issues.length >= 32 || !isObject(schema)) return issues;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matchesType = (type) => type === 'object' ? isObject(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'string' ? typeof value === 'string'
        : type === 'integer' ? Number.isSafeInteger(value)
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
      try { if (!new RegExp(schema.pattern, 'u').test(value)) issues.push(`invalid ${path}`); }
      catch { issues.push(`invalid ${path}`); }
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
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof key === 'string' && (!hasOwn(value, key) || value[key] === null || value[key] === undefined)) issues.push(`missing ${path}.${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (PROTOTYPE_KEYS.has(key)) { issues.push(`invalid ${path}.${key}`); continue; }
      if (hasOwn(properties, key)) schemaIssues(properties[key], item, `${path}.${key}`, issues);
      else if (schema.additionalProperties === false) issues.push(`invalid ${path}.${key}`);
      else if (isObject(schema.additionalProperties)) schemaIssues(schema.additionalProperties, item, `${path}.${key}`, issues);
      if (issues.length >= 32) break;
    }
  }
  return issues;
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

function modernServerMeta() {
  return { [MODERN_SERVER_INFO_META_KEY]: SERVER_INFO };
}

/**
 * @param {{
 *   input?: import('node:stream').Readable,
 *   output?: import('node:stream').Writable,
 *   scope?: string,
 *   projectRoot?: string,
 *   toolsLoader?: () => Promise<Array<Record<string, any>>> | Array<Record<string, any>>,
 *   toolCaller?: (name: string, args: Record<string, any>) => Promise<any> | any,
 * }} [options]
 */
export async function startInstallerCoreServer({
  input = process.stdin,
  output = process.stdout,
  scope = process.env.NEXYFAB_AGENT_SCOPE ?? 'read',
  projectRoot = process.env.NEXYFAB_PROJECT_ROOT,
  toolsLoader = installerCoreTools,
  toolCaller = callTool,
} = {}) {
  const tools = await toolsLoader();
  const toolNames = tools.map((tool) => tool?.name);
  if (tools.length !== installerCoreToolNames.length || new Set(toolNames).size !== installerCoreToolNames.length
    || installerCoreToolNames.some((name) => !toolNames.includes(name))
    || tools.some((tool) => !tool.inputSchema || (tool.name !== 'list_domains' && Object.keys(tool.inputSchema.properties ?? {}).length === 0))) {
    throw new Error('installer-core tool schema contract is incomplete');
  }
  const exposed = filterTools(tools, scope, { profile: 'installer-core' });
  const exposedNames = new Set(exposed.map((tool) => tool.name));
  const send = (message) => output.write(`${JSON.stringify(message)}\n`);
  let protocolEra = null;
  let pending = Promise.resolve();
  const stamp = (result) => protocolEra === 'modern' && isObject(result)
    ? { resultType: 'complete', ...result, _meta: { ...(isObject(result._meta) ? result._meta : {}), ...modernServerMeta() } }
    : result;
  const handle = async (request) => {
    const objectRequest = isObject(request);
    const hasId = objectRequest && hasOwn(request, 'id');
    const notification = objectRequest && !hasId && request.jsonrpc === '2.0' && typeof request.method === 'string';
    const reply = (result) => hasId && send({ jsonrpc: '2.0', id: request.id, result: stamp(result) });
    const fail = (code, message, data) => hasId && send({ jsonrpc: '2.0', id: request.id, error: { code, message, ...(data === undefined ? {} : { data }) } });
    if (!objectRequest || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
      || (hasId && !validId(request.id)) || (hasOwn(request, 'params') && request.params !== undefined && !isObject(request.params))) {
      if (!notification) send({ jsonrpc: '2.0', id: hasId && validId(request?.id) ? request.id : null, error: { code: -32600, message: 'invalid request' } });
      return;
    }
    if (!boundedValue(request)) { if (!notification) fail(-32600, 'invalid request'); return; }
    // MCP request methods require an id. In particular, id-less tool calls
    // must neither execute nor change the protocol era.
    if (!hasId) return;
    const { method, params } = request;
    const claimedVersion = isObject(params?._meta) ? params._meta[MODERN_PROTOCOL_META_KEY] : undefined;
    if (claimedVersion !== undefined && claimedVersion !== MODERN_PROTOCOL_VERSION) {
      fail(-32022, 'Unsupported protocol version', { supported: [MODERN_PROTOCOL_VERSION], requested: claimedVersion });
      return;
    }
    const hasModernParams = isObject(params) && hasOwn(params, '_meta');
    if (hasModernParams && !modernMeta(params._meta)) { fail(-32602, 'invalid params'); return; }
    if (protocolEra === 'modern' && !modernMeta(params?._meta)) { fail(-32602, 'invalid params'); return; }
    if (protocolEra === 'legacy' && modernMeta(params?._meta)) { fail(-32602, 'invalid params'); return; }
    if (protocolEra === null && modernMeta(params?._meta)) protocolEra = 'modern';
    if (method === 'initialize' && protocolEra === 'modern') { fail(-32602, 'invalid params'); return; }
    if (method === 'server/discover') {
      if (!isObject(params) || !discoveryMeta(params._meta) || Object.keys(params).some((key) => key !== '_meta' || PROTOTYPE_KEYS.has(key))) {
        fail(-32602, 'invalid params'); return;
      }
      protocolEra = 'modern';
      reply({
        supportedVersions: [MODERN_PROTOCOL_VERSION],
        capabilities: { tools: {} },
        instructions: 'Treat design and engineering outputs as review drafts; never claim release, compliance, manufacture, or field approval without explicit evidence.',
        ttlMs: 60_000,
        cacheScope: 'private',
      });
      return;
    }
    if (method === 'initialize') {
      const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : undefined;
      protocolEra = 'legacy';
      reply({ protocolVersion: requested && LEGACY_PROTOCOL_VERSIONS.has(requested) ? requested : LATEST_LEGACY_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO, runtimeProfile: 'installer-core' });
      return;
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'ping') {
      if (params !== undefined && (!isObject(params) || (protocolEra === 'modern' && Object.keys(params).some((key) => key !== '_meta')))) { fail(-32602, 'invalid params'); return; }
      reply({}); return;
    }
    if (method === 'tools/list') {
      if (params !== undefined && (!isObject(params) || (protocolEra === 'modern' && Object.keys(params).some((key) => key !== '_meta')))) { fail(-32602, 'invalid params'); return; }
      reply({ tools: exposed.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: tool.inputSchema.additionalProperties ?? false } })), ...(protocolEra === 'modern' ? { ttlMs: 60_000, cacheScope: 'private' } : {}) });
      return;
    }
    if (method !== 'tools/call') { fail(-32601, 'method not found'); return; }
    const callParams = protocolEra === 'modern' && isObject(params)
      ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== '_meta'))
      : params;
    if (!isObject(callParams) || typeof callParams.name !== 'string'
      || (callParams.arguments !== undefined && !isObject(callParams.arguments))
      || Object.keys(callParams).some((key) => !['name', 'arguments'].includes(key) || PROTOTYPE_KEYS.has(key))) {
      fail(-32602, 'invalid params'); return;
    }
    const name = callParams.name;
    let args = callParams.arguments ?? {};
    const sourceTool = tools.find((tool) => tool.name === name);
    if (!sourceTool) { fail(-32602, 'invalid params'); return; }
    const decision = authorizeToolCall(name, args, { scope, profile: 'installer-core', projectRoot });
    if (!decision.allowed || !exposedNames.has(name)) { reply({ content: [{ type: 'text', text: JSON.stringify({ ok: false, denied: true, ...(decision.denial ?? { code: 'PROFILE_TOOL_UNAVAILABLE' }) }) }], isError: true }); return; }
    if (requiresWriteApproval(name, args) && args[INSTALLER_WRITE_APPROVAL_FLAG] !== true) {
      reply({ content: [{ type: 'text', text: JSON.stringify({ ok: false, code: INSTALLER_WRITE_APPROVAL_ERROR, error: `Per-call approval required: set ${INSTALLER_WRITE_APPROVAL_FLAG}=true before invoking ${name}.`, tool: name }) }], isError: true });
      return;
    }
    args = withoutWriteApproval(args);
    if (schemaIssues({ ...sourceTool.inputSchema, additionalProperties: sourceTool.inputSchema.additionalProperties ?? false }, args).length) {
      reply({ content: [{ type: 'text', text: 'ERROR: INVALID_TOOL_ARGUMENTS' }], isError: true });
      return;
    }
    try { const result = await toolCaller(name, args); reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], ...(result?.ok === false ? { isError: true } : {}) }); }
    catch { reply({ content: [{ type: 'text', text: 'ERROR: tool execution failed' }], isError: true }); }
  };
  const enqueueLine = (lineBytes) => {
    let line = null;
    let invalidUtf8 = false;
    if (lineBytes !== null) {
      try { line = decodeUtf8Frame(lineBytes); }
      catch { invalidUtf8 = true; }
    }
    pending = pending.then(async () => {
      if (lineBytes === null) { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } }); return; }
      if (invalidUtf8 || line === null) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
      const trimmed = line.trim();
      if (!trimmed) return;
      let request;
      try { request = JSON.parse(trimmed); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
      await handle(request);
    }).catch(() => {
      try { send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'internal error' } }); }
      catch { /* output is already closed */ }
    });
  };
  const readline = createBoundedLineReader({
    input,
    maxBytes: MAX_REQUEST_LINE_BYTES,
    onLine: enqueueLine,
    onOversizedLine: () => enqueueLine(null),
  });
  return { readline, handle, tools: exposed };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) void startInstallerCoreServer().catch(() => { process.exitCode = 1; });
