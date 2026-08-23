/**
 * Fail-closed policy for the local NexyFab MCP gateway.
 *
 * The source MCP server is intentionally left unchanged.  This module owns
 * the trust boundary: a client can only see tools in its configured scope and
 * path-like arguments are constrained to NEXYFAB_PROJECT_ROOT.
 */
import path from "node:path";
import fs from "node:fs";

export const AGENT_SCOPES = Object.freeze(["read", "propose", "apply", "export"]);
export const DEFAULT_AGENT_SCOPE = "read";
export const AGENT_RUNTIME_PROFILES = Object.freeze(["source", "installer-core"]);
export const DEFAULT_AGENT_RUNTIME_PROFILE = "source";

// Deliberately small local-core contract. Every entry below was reviewed in
// mcp-server.mjs: it uses deterministic local code only (no provider/API,
// TypeScript runner, WASM, or child-process execution).
export const INSTALLER_CORE_TOOLS = Object.freeze([
  "list_domains",
  "build_assembly",
  "analyze_dfm",
  "fab_estimate",
  "resolve_constraints",
  "render_preview",
  "blade_ring",
  "loft_part",
]);
const INSTALLER_CORE_TOOL_SET = new Set(INSTALLER_CORE_TOOLS);

// Keep this list explicit.  A newly added source tool is denied until it is
// deliberately reviewed here (rather than accidentally becoming available).
const TOOL_SCOPE = Object.freeze({
  cad_capabilities: "read",
  verify_complex_system_graph: "read",
  verify_gearbox_system_contract: "read",
  verify_machine_skid_system_contract: "read",
  verify_welded_enclosure_system_contract: "read",
  analyze_complex_system_change_impact: "read",
  verify_complex_assembly_scale: "read",
  product_decomposition: "propose",
  reconcile_topology_references: "propose",
  cad_feature_program: "propose",
  feature_tree_mesh: "apply",
  export_part_step: "export",
  verify_cad_assembly: "read",
  verify_cad_project: "read",
  verify_door_swing_clearance: "read",
  verify_space_boundary_closure: "read",
  verify_egress_routes: "read",
  verify_mep_interference: "read",
  verify_physical_network: "read",
  verify_manufacturing_evidence: "read",
  decide_cad_release: "read",
  evaluate_assembly_animation: "read",
  apply_assembly_animation_command: "apply",
  preview_assembly_selection_edit: "propose",
  push_pull_step_face: "apply",
  analyze_cad_reference: "read",
  verify_ifc_semantic_roundtrip: "read",
  build_ifc_domain_ir: "propose",
  build_ifc_spatial_ir: "propose",
  analyze_step_mechanical_relations: "read",
  plan_ifc_geometry_recovery: "propose",
  recover_ifc_geometry: "apply",
  verify_assembly_animation: "read",
  verify_ai_generation: "read",
  transition_ai_generation_state: "propose",
  refine_ai_generation: "propose",
  advance_ai_generation: "propose",
  finalize_ai_generation: "export",
  generate_robot_6axis: "apply",
  verify_sheet_metal: "read",
  verify_weldment: "read",
  analyze_tolerance_stack: "read",
  verify_cad_pmi: "read",
  design_brief: "propose",
  compose_3d: "apply",
  text_to_intent: "propose",
  text_to_assembly: "apply",
  build_assembly: "apply",
  export_step: "export",
  html_render: "export",
  verify_3d: "read",
  extract_drawing: "read",
  edit_drawing: "apply",
  reconstruct_3d: "apply",
  list_domains: "read",
  mech_preset: "propose",
  fab_estimate: "propose",
  analyze_dfm: "read",
  edit_part: "apply",
  face_drag: "apply",
  part_op: "apply",
  lod_assembly: "apply",
  blade_ring: "apply",
  generate_package: "export",
  build_corridor: "apply",
  sweep_template: "apply",
  list_templates: "read",
  generate_domain_package: "export",
  loft_part: "apply",
  resolve_constraints: "propose",
  render_preview: "propose",
  extract_gdt: "read",
  step_roundtrip: "export",
  refine_interferences: "apply",
  execution_gate: "read",
  std_audit: "read",
  dxf_reconcile: "apply",
  import_landxml: "apply",
  verify_domain: "read",
  analyze_fea: "export",
  reconstruct_verify: "export",
  reconstruct_fleet: "export",
  code_check: "read",
  interior_check: "read",
  landscape_check: "read",
  bridge_check: "read",
  load_path: "read",
  check_connection: "read",
  buckling_precheck: "read",
  solve_mobility: "read",
});

// These tools can cross the local process boundary through NexyFab APIs or an
// LLM provider. Keep this explicit so MCP clients can make an informed
// approval decision instead of treating a read-only verifier as offline.
const OPEN_WORLD_TOOLS = new Set([
  "cad_capabilities",
  "verify_complex_system_graph",
  "verify_gearbox_system_contract",
  "verify_machine_skid_system_contract",
  "verify_welded_enclosure_system_contract",
  "analyze_complex_system_change_impact",
  "verify_complex_assembly_scale",
  "product_decomposition",
  "reconcile_topology_references",
  "cad_feature_program",
  "feature_tree_mesh",
  "export_part_step",
  "verify_cad_assembly",
  "verify_cad_project",
  "verify_door_swing_clearance",
  "verify_space_boundary_closure",
  "verify_egress_routes",
  "verify_mep_interference",
  "verify_physical_network",
  "verify_manufacturing_evidence",
  "decide_cad_release",
  "evaluate_assembly_animation",
  "apply_assembly_animation_command",
  "preview_assembly_selection_edit",
  "push_pull_step_face",
  "analyze_cad_reference",
  "verify_ifc_semantic_roundtrip",
  "build_ifc_domain_ir",
  "build_ifc_spatial_ir",
  "analyze_step_mechanical_relations",
  "plan_ifc_geometry_recovery",
  "recover_ifc_geometry",
  "verify_assembly_animation",
  "verify_ai_generation",
  "transition_ai_generation_state",
  "refine_ai_generation",
  "advance_ai_generation",
  "finalize_ai_generation",
  "generate_robot_6axis",
  "verify_sheet_metal",
  "verify_weldment",
  "analyze_tolerance_stack",
  "verify_cad_pmi",
  "compose_3d",
  "text_to_intent",
  "text_to_assembly",
  "extract_drawing",
  "edit_drawing",
  "analyze_fea",
  "reconstruct_verify",
  "reconstruct_fleet",
]);
// Tool schemas use both `graphFile` and `outDir` camel-case spellings.  The
// deliberately broad names are limited to argument keys (never arbitrary
// strings), so a text prompt containing `/tmp` is not mistaken for a path.
const PATH_KEY = /(file|files|path|paths|dir|directory|output|outdir|destination|source|target)/i;

export function normalizeAgentScope(value) {
  return AGENT_SCOPES.includes(value) ? value : DEFAULT_AGENT_SCOPE;
}

export function normalizeAgentRuntimeProfile(value) {
  return AGENT_RUNTIME_PROFILES.includes(value) ? value : DEFAULT_AGENT_RUNTIME_PROFILE;
}

export function toolAllowedForProfile(name, profile = DEFAULT_AGENT_RUNTIME_PROFILE) {
  const normalized = normalizeAgentRuntimeProfile(profile);
  return normalized !== "installer-core" || INSTALLER_CORE_TOOL_SET.has(name);
}

export function toolScope(name) {
  // TOOL_SCOPE is a plain object for readable source, but tool names are
  // untrusted JSON. Never let inherited properties (constructor, __proto__,
  // toString, ...) become implicit policy entries.
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(TOOL_SCOPE, name)
    ? TOOL_SCOPE[name]
    : null;
}

export function classifyTool(name) {
  const scope = toolScope(name);
  return scope ? { name, scope, known: true } : { name, scope: null, known: false };
}

export function allToolScopes() {
  return { ...TOOL_SCOPE };
}

function pathArguments(value, key = "", found = []) {
  if (typeof value === "string" && PATH_KEY.test(key)) {
    found.push({ key, value });
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => pathArguments(item, key, found));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, childValue]) => pathArguments(childValue, childKey, found));
  }
  return found;
}

function normalizeRoot(root) {
  if (typeof root !== "string" || !root.trim()) return null;
  if (root.includes("\0") || isForeignAbsolutePath(root)) return null;
  const resolved = path.resolve(normalizePathSeparators(root));
  // A filesystem root is not a project boundary. Rejecting it prevents an
  // accidentally inherited env var ("/" or "C:\\") from authorizing access
  // to the whole host filesystem.
  if (resolved === path.parse(resolved).root) return null;
  try {
    const listed = fs.lstatSync(resolved);
    const canonical = fs.realpathSync.native(resolved);
    const comparable = (value) => process.platform === "win32"
      ? path.normalize(value).toLowerCase()
      : path.normalize(value);
    // A project trust boundary must itself be a real directory, not a link or
    // junction that can silently widen the authorized filesystem subtree.
    if (!listed.isDirectory() || listed.isSymbolicLink() || comparable(canonical) !== comparable(resolved)
      || canonical === path.parse(canonical).root) return null;
    return canonical;
  } catch {
    return null;
  }
}

// Windows accepts both slash styles. Normalize both forms before resolving so
// a request cannot pass a Windows-style `..\\` escape when the policy is
// running on a platform whose native separator is `/` (and vice versa).
function normalizePathSeparators(value) {
  return value.replace(/[\\/]+/g, path.sep);
}

function isForeignAbsolutePath(value) {
  // A drive/UNC path is absolute on Windows even when this policy is tested
  // on POSIX. Treating it as a relative filename would be unsafe if the value
  // is later consumed by a Windows worker.
  const isUnc = /^[\\/]{2}/.test(value);
  const isDrive = /^[A-Za-z]:[\\/]/.test(value);
  return isUnc || (path.sep !== "\\" && isDrive);
}

function isInsideRoot(candidate, root) {
  if (typeof candidate !== "string" || candidate.includes("\0") || isForeignAbsolutePath(candidate)) return false;
  const normalizedCandidate = normalizePathSeparators(candidate);
  const resolvedRoot = path.resolve(normalizePathSeparators(root));
  const resolvedCandidate = path.isAbsolute(normalizedCandidate)
    ? path.resolve(normalizedCandidate)
    : path.resolve(resolvedRoot, normalizedCandidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function nearestExistingPath(candidate) {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

/**
 * Lexical containment alone is insufficient when an in-project symlink points
 * outside the project. Resolve the candidate itself, or its nearest existing
 * parent for a not-yet-created export path, before authorizing the call.
 */
function isInsideRootAfterSymlinks(candidate, root) {
  if (typeof candidate !== "string" || candidate.includes("\0") || isForeignAbsolutePath(candidate)) return false;
  const normalizedCandidate = normalizePathSeparators(candidate);
  const resolvedRoot = path.resolve(normalizePathSeparators(root));
  const resolvedCandidate = path.isAbsolute(normalizedCandidate)
    ? path.resolve(normalizedCandidate)
    : path.resolve(resolvedRoot, normalizedCandidate);
  if (!isInsideRoot(resolvedCandidate, resolvedRoot)) return false;
  const existing = nearestExistingPath(resolvedCandidate);
  if (!existing) return false;
  try {
    const canonicalRoot = fs.realpathSync.native(resolvedRoot);
    const canonicalExisting = fs.realpathSync.native(existing);
    if (!isInsideRoot(canonicalExisting, canonicalRoot)) return false;
    const relativeExisting = path.relative(resolvedRoot, existing);
    let cursor = resolvedRoot;
    for (const segment of relativeExisting ? relativeExisting.split(path.sep) : []) {
      cursor = path.join(cursor, segment);
      const listed = fs.lstatSync(cursor);
      if (listed.isSymbolicLink()) return false;
      const realCursor = fs.realpathSync.native(cursor);
      const comparableCursor = process.platform === "win32" ? path.normalize(cursor).toLowerCase() : path.normalize(cursor);
      const comparableReal = process.platform === "win32" ? path.normalize(realCursor).toLowerCase() : path.normalize(realCursor);
      if (comparableCursor !== comparableReal) return false;
    }
    return true;
  } catch {
    // A missing or unreadable project root cannot be a trustworthy boundary.
    return false;
  }
}

function requiredScopeForCall(name, args) {
  // Rendering in memory is a proposal. Supplying outDir changes the host
  // filesystem and therefore requires the explicit export grant.
  if (name === "render_preview" && typeof args?.outDir === "string" && args.outDir.length > 0) {
    return "export";
  }
  return toolScope(name);
}

/**
 * Return a JSON-safe decision.  Denials intentionally include a stable code
 * so clients can explain the failure without parsing human text.
 */
export function authorizeToolCall(name, args = {}, options = {}) {
  const classified = classifyTool(name);
  const scope = normalizeAgentScope(options.scope ?? process.env.NEXYFAB_AGENT_SCOPE);
  if (!classified.known) {
    return {
      allowed: false,
      denial: { code: "UNKNOWN_TOOL", message: `Tool '${name}' is not allowlisted.` },
      name,
      scope,
    };
  }
  const profile = normalizeAgentRuntimeProfile(options.profile ?? process.env.NEXYFAB_AGENT_RUNTIME_PROFILE);
  if (!toolAllowedForProfile(name, profile)) {
    return {
      allowed: false,
      denial: { code: "PROFILE_TOOL_UNAVAILABLE", message: `Tool '${name}' is not available in the '${profile}' runtime profile.` },
      name,
      scope,
      profile,
    };
  }
  const requestedLevel = AGENT_SCOPES.indexOf(scope);
  const requiredScope = requiredScopeForCall(name, args);
  const requiredLevel = AGENT_SCOPES.indexOf(requiredScope);
  if (requestedLevel < requiredLevel) {
    return {
      allowed: false,
      denial: { code: "SCOPE_REQUIRED", message: `Tool '${name}' requires the '${requiredScope}' scope.` },
      name,
      scope,
      requiredScope,
    };
  }

  const paths = pathArguments(args);
  if (paths.length) {
    const root = normalizeRoot(options.projectRoot ?? process.env.NEXYFAB_PROJECT_ROOT);
    if (!root) {
      return {
        allowed: false,
        denial: { code: "PROJECT_ROOT_REQUIRED", message: "NEXYFAB_PROJECT_ROOT is required for filesystem path arguments." },
        name,
        scope,
        pathArguments: paths.map(({ key }) => key),
      };
    }
    for (const item of paths) {
      if (!isInsideRootAfterSymlinks(item.value, root)) {
        return {
          allowed: false,
          denial: { code: "PATH_OUTSIDE_PROJECT_ROOT", message: `Path argument '${item.key}' must stay inside NEXYFAB_PROJECT_ROOT.` },
          name,
          scope,
          pathArguments: paths.map(({ key }) => key),
        };
      }
    }
  }
  return { allowed: true, name, scope, requiredScope };
}

export function annotationsForTool(name) {
  const scope = toolScope(name);
  if (!scope) return null;
  return {
    readOnlyHint: scope === "read" || scope === "propose",
    destructiveHint: scope === "export",
    openWorldHint: OPEN_WORLD_TOOLS.has(name),
  };
}

export function filterTools(sourceTools, scope = DEFAULT_AGENT_SCOPE, options = {}) {
  const normalized = normalizeAgentScope(scope);
  const profile = normalizeAgentRuntimeProfile(options.profile ?? process.env.NEXYFAB_AGENT_RUNTIME_PROFILE);
  const level = AGENT_SCOPES.indexOf(normalized);
  return sourceTools.filter((tool) => {
    const required = toolScope(tool?.name);
    return required && level >= AGENT_SCOPES.indexOf(required) && toolAllowedForProfile(tool.name, profile);
  }).map((tool) => ({
    ...tool,
    annotations: { ...(tool.annotations ?? {}), ...annotationsForTool(tool.name) },
  }));
}

export const inspectPathArguments = pathArguments;
export const isPathInsideProjectRoot = isInsideRootAfterSymlinks;
export const getToolScope = toolScope;
export const authorizeTool = authorizeToolCall;
export const getToolAnnotations = annotationsForTool;
export const toolsForScope = filterTools;
export const getAgentRuntimeProfile = normalizeAgentRuntimeProfile;
