#!/usr/bin/env node
/**
 * Scope/profile-filtered stdio gateway for NexyFab's drawing-to-3d MCP tools.
 * stdout is reserved for newline-delimited JSON-RPC responses.
 */
import { pathToFileURL } from "node:url";
import { createBoundedLineReader, decodeUtf8Frame } from "../mcp-stdio-transport.mjs";
import { tools as sourceTools, callTool } from "./mcp-server.mjs";
import {
  DEFAULT_AGENT_SCOPE,
  authorizeToolCall,
  filterTools,
  normalizeAgentRuntimeProfile,
  normalizeAgentScope,
} from "./agent-policy.mjs";

const defaultScope = normalizeAgentScope(process.env.NEXYFAB_AGENT_SCOPE ?? DEFAULT_AGENT_SCOPE);
const defaultProfile = normalizeAgentRuntimeProfile(process.env.NEXYFAB_AGENT_RUNTIME_PROFILE);
const exposedTools = filterTools(sourceTools, defaultScope, { profile: defaultProfile });
const LEGACY_PROTOCOL_VERSIONS = new Set(["2025-03-26", "2025-11-25"]);
const LATEST_LEGACY_PROTOCOL = "2025-11-25";
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const MODERN_PROTOCOL_META_KEY = "io.modelcontextprotocol/protocolVersion";
const MODERN_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
const MODERN_CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";
const MODERN_SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";
const SERVER_INFO = { name: "nexyfab-agent-gateway", version: "0.1.0" };
const MAX_REQUEST_LINE_BYTES = 1_000_000;
const MAX_ENVELOPE_DEPTH = 8;
const MAX_ENVELOPE_NODES = 1_000;
const MAX_ENVELOPE_PROPERTIES = 100;
const MAX_ENVELOPE_ARRAY_ITEMS = 100;
const MAX_ENVELOPE_STRING_BYTES = 256 * 1024;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ALLOWED_NOTIFICATIONS = new Set(["notifications/initialized", "initialized", "notifications/cancelled", "notifications/progress"]);

const denialResult = (decision) => ({
  content: [{ type: "text", text: JSON.stringify({ ok: false, denied: true, ...decision.denial }) }],
  isError: true,
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function validateBoundValue(value, path = "$", depth = 0, state = { nodes: 0 }) {
  if (depth > MAX_ENVELOPE_DEPTH) return [`${path}:depth_limit`];
  state.nodes += 1;
  if (state.nodes > MAX_ENVELOPE_NODES) return [`${path}:node_limit`];
  if (typeof value === "string") return Buffer.byteLength(value, "utf8") > MAX_ENVELOPE_STRING_BYTES ? [`${path}:string_limit`] : [];
  if (Array.isArray(value)) {
    if (value.length > MAX_ENVELOPE_ARRAY_ITEMS) return [`${path}:array_limit`];
    return value.flatMap((item, index) => validateBoundValue(item, `${path}[${index}]`, depth + 1, state));
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_ENVELOPE_PROPERTIES || keys.some((key) => PROTOTYPE_KEYS.has(key) || Buffer.byteLength(key, "utf8") > 256)) return [`${path}:object_keys_invalid`];
    return keys.flatMap((key) => validateBoundValue(value[key], `${path}.${key}`, depth + 1, state));
  }
  return [];
}

function matchesSchemaType(type, value) {
  if (type === "object") return isObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return false;
}

function validateSchemaValue(schema, value, path, depth, state, root = false) {
  if (!isObject(schema) || depth > MAX_ENVELOPE_DEPTH) return [`${path}:schema_invalid`];
  state.nodes += 1;
  if (state.nodes > MAX_ENVELOPE_NODES) return [`${path}:node_limit`];
  const issues = [];
  const types = schema.type === undefined ? undefined : (Array.isArray(schema.type) ? schema.type : [schema.type]);
  if (types && (!types.length || types.some((type) => typeof type !== "string"))) issues.push(`${path}:schema_type_invalid`);
  if (types && !types.some((type) => matchesSchemaType(type, value))) issues.push(`${path}:type_invalid`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) issues.push(`${path}:enum_invalid`);
  if (hasOwn(schema, "const") && !Object.is(schema.const, value)) issues.push(`${path}:const_invalid`);
  if (typeof value === "string") {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) issues.push(`${path}:min_length`);
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) issues.push(`${path}:max_length`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(`${path}:number_invalid`);
    if (Number.isFinite(schema.minimum) && value < schema.minimum) issues.push(`${path}:minimum`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) issues.push(`${path}:maximum`);
    if (Number.isFinite(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) issues.push(`${path}:exclusive_minimum`);
    if (Number.isFinite(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) issues.push(`${path}:exclusive_maximum`);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ENVELOPE_ARRAY_ITEMS || (Number.isFinite(schema.maxItems) && value.length > schema.maxItems)) issues.push(`${path}:max_items`);
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) issues.push(`${path}:min_items`);
    if (schema.items !== undefined) value.forEach((item, index) => issues.push(...validateSchemaValue(schema.items, item, `${path}[${index}]`, depth + 1, state)));
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_ENVELOPE_PROPERTIES || keys.some((key) => PROTOTYPE_KEYS.has(key) || Buffer.byteLength(key, "utf8") > 256)) issues.push(`${path}:object_keys_invalid`);
    if (Number.isFinite(schema.minProperties) && keys.length < schema.minProperties) issues.push(`${path}:min_properties`);
    if (Number.isFinite(schema.maxProperties) && keys.length > schema.maxProperties) issues.push(`${path}:max_properties`);
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) if (typeof key !== "string" || !hasOwn(value, key)) issues.push(`${path}:required`);
    const properties = isObject(schema.properties) ? schema.properties : {};
    const additional = root ? (schema.additionalProperties ?? false) : schema.additionalProperties;
    for (const key of keys) {
      if (hasOwn(properties, key)) issues.push(...validateSchemaValue(properties[key], value[key], `${path}.${key}`, depth + 1, state));
      else if (additional === false) issues.push(`${path}:additional_property`);
      else if (isObject(additional)) issues.push(...validateSchemaValue(additional, value[key], `${path}.${key}`, depth + 1, state));
      else issues.push(...validateBoundValue(value[key], `${path}.${key}`, depth + 1, state));
    }
  }
  return issues;
}

function validateToolArguments(tool, args) {
  if (!isObject(args)) return ["arguments:not_object"];
  return validateSchemaValue(tool.inputSchema, args, "$", 0, { nodes: 0 }, true);
}

function modernServerMeta() {
  return { [MODERN_SERVER_INFO_META_KEY]: SERVER_INFO };
}

function modernProtocolMeta(value) {
  return isObject(value)
    && value[MODERN_PROTOCOL_META_KEY] === MODERN_PROTOCOL_VERSION
    && validateBoundValue(value).length === 0;
}

function modernDiscoveryMeta(value) {
  const clientInfo = isObject(value) ? value[MODERN_CLIENT_INFO_META_KEY] : undefined;
  return modernProtocolMeta(value)
    && isObject(clientInfo)
    && typeof clientInfo.name === "string" && clientInfo.name.length > 0 && clientInfo.name.length <= 256
    && typeof clientInfo.version === "string" && clientInfo.version.length > 0 && clientInfo.version.length <= 128
    && isObject(value[MODERN_CLIENT_CAPABILITIES_META_KEY]);
}

function sanitizeToolResult(result) {
  if (!isObject(result) || result.ok !== false) return result;
  const safe = { ...result };
  // Upstream proxies sometimes put the complete response body under `body`;
  // never relay that body (or diagnostics containing endpoint/credential
  // material) through the local agent protocol.
  delete safe.body;
  if (typeof safe.error === "string" && /(https?:\/\/|Bearer\s|nf_live_|file:\/\/|[A-Za-z]:\\|\\\\|(?:^|\s)\/(?:Users|home|var|tmp|etc|opt|srv|app|workspace)\/)/i.test(safe.error)) {
    safe.error = "remote tool failed";
  }
  return safe;
}

/** @param {{ output?: import('node:stream').Writable, scope?: string, profile?: string }} [options] */
function makeHandler({ output = process.stdout, scope = defaultScope, profile = defaultProfile } = {}) {
  const tools = filterTools(sourceTools, scope, { profile });
  const names = new Set(tools.map((tool) => tool.name));
  const send = (message) => output.write(`${JSON.stringify(message)}\n`);
  let protocolEra = null;

  const stampResult = (result) => {
    if (protocolEra !== "modern" || !isObject(result)) return result;
    return { resultType: "complete", ...result, _meta: { ...(isObject(result._meta) ? result._meta : {}), ...modernServerMeta() } };
  };

  return async function handle(request) {
    const hasId = request && typeof request === "object" && !Array.isArray(request)
      ? Object.prototype.hasOwnProperty.call(request, "id")
      : false;
    const validId = !hasId || typeof request.id === "string" ||
      (typeof request.id === "number" && Number.isFinite(request.id));
    const validParams = !request || typeof request.params === "undefined" ||
      (request.params !== null && typeof request.params === "object");
    if (!request || typeof request !== "object" || Array.isArray(request) ||
        request.jsonrpc !== "2.0" || typeof request.method !== "string" ||
        !validId || !validParams) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
      return;
    }
    if (validateBoundValue(request).length) {
      send({ jsonrpc: "2.0", id: hasId && validId ? request.id : null, error: { code: -32600, message: "invalid request" } });
      return;
    }
    const { id, method, params } = request;
    // Only notification methods defined by MCP may be dispatched without an
    // id. This prevents id-less initialize/tools/call from changing the era or
    // invoking a tool whose result the client can never observe.
    if (!hasId && !ALLOWED_NOTIFICATIONS.has(method)) return;
    const reply = (result) => hasId && send({ jsonrpc: "2.0", id, result: stampResult(result) });
    const fail = (code, message, data) => hasId && send({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
    try {
      const paramsMeta = isObject(params) ? params._meta : undefined;
      const claimedVersion = isObject(paramsMeta) ? paramsMeta[MODERN_PROTOCOL_META_KEY] : undefined;
      if (claimedVersion !== undefined && claimedVersion !== MODERN_PROTOCOL_VERSION) {
        fail(-32022, "Unsupported protocol version", { supported: [MODERN_PROTOCOL_VERSION], requested: claimedVersion });
        return;
      }
      const modernRequest = modernProtocolMeta(paramsMeta);
      if (protocolEra === "modern" && method !== "initialize" && !modernRequest) { fail(-32602, "invalid params"); return; }
      if (protocolEra === "legacy" && modernRequest) { fail(-32602, "invalid params"); return; }
      if (protocolEra === null && modernRequest) protocolEra = "modern";
      // Do not let a modern discovery/per-request exchange switch this
      // stdio handler back into the retired initialize handshake.
      if (method === "initialize" && protocolEra === "modern") { fail(-32602, "invalid params"); return; }
      if (method === "server/discover") {
        if (!isObject(params) || !modernDiscoveryMeta(params._meta) ||
            Object.keys(params).some((key) => key !== "_meta" || PROTOTYPE_KEYS.has(key))) {
          fail(-32602, "invalid params");
          return;
        }
        protocolEra = "modern";
        reply({
          resultType: "complete",
          supportedVersions: [MODERN_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          _meta: modernServerMeta(),
          instructions: "Treat design and engineering outputs as review drafts; never claim release, compliance, manufacture, or field approval without explicit evidence.",
          ttlMs: 60_000,
          cacheScope: "private",
        });
        return;
      }
      if (method === "initialize") {
        if (params !== undefined && (params === null || Array.isArray(params))) {
          fail(-32602, "invalid params");
          return;
        }
        const requestedProtocol = typeof params?.protocolVersion === "string" ? params.protocolVersion : undefined;
        const protocolVersion = requestedProtocol && LEGACY_PROTOCOL_VERSIONS.has(requestedProtocol) ? requestedProtocol : LATEST_LEGACY_PROTOCOL;
        protocolEra = "legacy";
        reply({ protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO, runtimeProfile: profile });
        return;
      }
      if (method === "notifications/initialized" || method === "initialized") return;
      if (method === "ping") {
        if (params !== undefined && (!isObject(params) || Object.keys(params).some((key) => key !== "_meta"))) { fail(-32602, "invalid params"); return; }
        reply({});
        return;
      }
      if (method === "tools/list") {
        if (params !== undefined && (!isObject(params) || (protocolEra === "modern" && Object.keys(params).some((key) => key !== "_meta")))) { fail(-32602, "invalid params"); return; }
        reply({
          tools: tools.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: tool.inputSchema.additionalProperties ?? false } })),
          ...(protocolEra === "modern" ? { ttlMs: 60_000, cacheScope: "private" } : {}),
        });
        return;
      }
      if (method === "tools/call") {
        const callParams = protocolEra === "modern" && isObject(params) ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== "_meta")) : params;
        if (!isObject(callParams) || typeof callParams.name !== "string" ||
            (callParams.arguments !== undefined && !isObject(callParams.arguments)) ||
            Object.keys(callParams).some((key) => !["name", "arguments"].includes(key) || PROTOTYPE_KEYS.has(key))) {
          fail(-32602, "invalid params");
          return;
        }
        const name = callParams.name;
        const sourceTool = sourceTools.find((tool) => tool.name === name);
        if (!sourceTool) {
          fail(-32602, "invalid params");
          return;
        }
        const decision = authorizeToolCall(name, callParams.arguments ?? {}, { scope, profile });
        if (!decision.allowed || !names.has(name)) {
          reply(denialResult(decision.allowed
            ? { ...decision, denial: { code: "PROFILE_TOOL_UNAVAILABLE", message: `Tool '${name}' is not exposed at the '${profile}' profile.` } }
            : decision));
          return;
        }
        const argumentIssues = validateToolArguments(sourceTool, callParams.arguments ?? {});
        if (argumentIssues.length) {
          reply({ content: [{ type: "text", text: "ERROR: invalid tool arguments" }], isError: true });
          return;
        }
        try {
          const result = sanitizeToolResult(await callTool(name, callParams.arguments ?? {}));
          reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], ...(result && result.ok === false ? { isError: true } : {}) });
        } catch {
          // Do not leak provider paths, credentials, or internal stack details.
          reply({ content: [{ type: "text", text: "ERROR: tool execution failed" }], isError: true });
        }
        return;
      }
      if (hasId) fail(-32601, `method not found: ${method.slice(0, 128)}`);
    } catch {
      fail(-32603, "internal gateway error");
    }
  };
}

/**
 * Start the gateway against stdio (or injected streams for smoke tests).
 * @param {{ input?: import('node:stream').Readable, output?: import('node:stream').Writable, scope?: string, profile?: string }} [options]
 */
export function startAgentServer({ input = process.stdin, output = process.stdout, scope = defaultScope, profile = defaultProfile } = {}) {
  const handle = makeHandler({ output, scope: normalizeAgentScope(scope), profile: normalizeAgentRuntimeProfile(profile) });
  // Keep responses in request order. Tool calls can be asynchronous and the
  // JSON-RPC id is not a substitute for ordered stdio framing for clients
  // which issue requests serially.
  let pending = Promise.resolve();
  const enqueueLine = (lineBytes) => {
    let line = null;
    let invalidUtf8 = false;
    if (lineBytes !== null) {
      try { line = decodeUtf8Frame(lineBytes); }
      catch { invalidUtf8 = true; }
    }
    pending = pending.then(async () => {
      if (lineBytes === null) {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "request too large" } })}\n`);
        return;
      }
      if (invalidUtf8 || line === null) { output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`); return; }
      const trimmed = line.trim();
      if (!trimmed) return;
      let request;
      try { request = JSON.parse(trimmed); }
      catch { output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`); return; }
      await handle(request);
    }).catch(() => {
      // The handler intentionally sanitizes tool failures. This is only a
      // last-resort framing failure (for example, a closed output stream).
      try { output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "internal gateway error" } })}\n`); } catch { /* stream already closed */ }
    });
  };
  const readline = createBoundedLineReader({
    input,
    maxBytes: MAX_REQUEST_LINE_BYTES,
    onLine: enqueueLine,
    onOversizedLine: () => enqueueLine(null),
  });
  return { readline, handle, tools: filterTools(sourceTools, normalizeAgentScope(scope), { profile: normalizeAgentRuntimeProfile(profile) }) };
}

// Backwards-compatible imports used by source tests/consumers.
export { exposedTools };
export const handle = makeHandler();

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) startAgentServer();
