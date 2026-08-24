/**
 * Public Agent/MCP/CLI surface inventory.
 *
 * This file records only product surfaces that really exist.  A CAD API route
 * is not automatically an MCP or CLI capability: routes listed in
 * CAD_V1_ROUTE_EXPOSURE_HOLD remain intentionally unadvertised until a bounded
 * schema, authorization policy, adapter, and parity tests are implemented.
 */

export const DOWNLOADABLE_REMOTE_MCP_TOOLS = Object.freeze([
  'design_assembly',
  'compose_part',
  'edit_part',
  'face_drag',
  'part_op',
  'domain_design',
  'analyze_fea',
  'reconstruct_verify',
  'reconstruct_fleet',
  'code_check',
  'verify_domain',
  'interior_check',
  'landscape_check',
  'bridge_check',
  'load_path',
]);

export const INSTALLER_SIDECAR_TOOLS = Object.freeze([
  'list_domains',
  'build_assembly',
  'analyze_dfm',
  'fab_estimate',
  'resolve_constraints',
  'render_preview',
  'blade_ring',
  'loft_part',
]);

export const CAD_V1_ROUTE_EXPOSURE_HOLD = Object.freeze([
  '/api/cad/v1/architecture/daylight/package',
  '/api/cad/v1/architecture/daylight/results',
  '/api/cad/v1/architecture/daylight/run',
  '/api/cad/v1/architecture/daylight/status',
  '/api/cad/v1/architecture/daylight/verify',
  '/api/cad/v1/architecture/interior/edit',
  '/api/cad/v1/architecture/service-openings/sync',
  '/api/cad/v1/architecture/verify',
  '/api/cad/v1/assembly/release/verify',
  '/api/cad/v1/generation/commercial-receipts',
  '/api/cad/v1/generation/commercial-receipts/requests',
  '/api/cad/v1/ifc/deep-roundtrip',
  '/api/cad/v1/interior/layout/edit',
  '/api/cad/v1/interior/verify',
  '/api/cad/v1/mep/route',
  '/api/cad/v1/product-qualification',
  '/api/cad/v1/robot/cable/life',
  '/api/cad/v1/robot/catalog/admit',
  '/api/cad/v1/robot/catalog/housing-fit',
  '/api/cad/v1/robot/catalog/select',
  '/api/cad/v1/robot/compliance/evaluate',
  '/api/cad/v1/robot/dynamics/evaluate',
  '/api/cad/v1/robot/engineering/analyze',
  '/api/cad/v1/robot/engineering/coverage',
  '/api/cad/v1/robot/integration/apply',
  '/api/cad/v1/robot/integration/post-verify',
  '/api/cad/v1/robot/integration/prepare',
  '/api/cad/v1/robot/integration/review',
  '/api/cad/v1/robot/life/evaluate',
  '/api/cad/v1/robot/motion/coverage',
  '/api/cad/v1/robot/physical/verify',
  '/api/cad/v1/robot/precision/evaluate',
  '/api/cad/v1/robot/release/audit',
  '/api/cad/v1/robot/release/final-review',
  '/api/cad/v1/robot/release/verified-audit',
  '/api/cad/v1/robot/release/work-packet',
  '/api/cad/v1/robot/requirements/verify',
  '/api/cad/v1/robot/reverify',
  '/api/cad/v1/robot/safety/electrical',
  '/api/cad/v1/robot/thermal/evaluate',
  '/api/cad/v1/spatial/command',
]);

export const CAD_V1_ROUTE_EXPOSURE_HOLD_REASONS = Object.freeze({
  '/api/cad/v1/architecture/daylight/package': 'HOLD: generated daylight package/export path requires write scope and bounded parity.',
  '/api/cad/v1/architecture/interior/edit': 'HOLD: project/interior mutation path requires bounded editor authorization and transaction parity.',
  '/api/cad/v1/architecture/service-openings/sync': 'HOLD: project service-opening mutation path requires bounded editor authorization and transaction parity.',
  '/api/cad/v1/interior/layout/edit': 'HOLD: project interior-layout mutation path requires bounded editor authorization and transaction parity.',
  '/api/cad/v1/product-qualification': 'HOLD: evaluation requires an explicit Agent/MCP/CLI schema and parity contract before advertisement.',
  '/api/cad/v1/robot/integration/apply': 'HOLD: integration apply/export path requires write scope and bounded approval/parity.',
  '/api/cad/v1/robot/release/work-packet': 'HOLD: generated release work-packet/export path requires write scope and bounded parity.',
  '/api/cad/v1/spatial/command': 'HOLD: CAD draft mutation path requires bounded authorization and durable-state parity.',
  '/api/cad/v1/architecture/daylight/status': 'HOLD: side_effect — GET probes Radiance executables via child-process spawn; it is not a safe read-only status surface.',
});

export const CAPABILITY_SURFACE_BASELINE = Object.freeze({
  cadV1RouteFiles: 84,
  advertisedCadV1Operations: 42,
  advertisedCadV1CliCommands: 34,
  localMcpTools: 90,
  downloadableRemoteMcpTools: DOWNLOADABLE_REMOTE_MCP_TOOLS.length,
  installerSidecarTools: INSTALLER_SIDECAR_TOOLS.length,
  heldCadV1Routes: CAD_V1_ROUTE_EXPOSURE_HOLD.length,
  robotRouteFiles: 25,
  advertisedRobotOperations: 1,
});
