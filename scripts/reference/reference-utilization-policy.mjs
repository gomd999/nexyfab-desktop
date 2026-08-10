import path from 'node:path';

const EXACT_EXCHANGE = new Set(['step', 'stp']);
const GOVERNED_AUTOMATED = new Set(['stl', 'dxf', 'ifc', 'x_t', 'xt', 'xmt_txt']);
const BOUNDED_GEOMETRY = new Set(['iges', 'igs', 'sat', 'obj', '3mf', 'dae', 'wrl', 'vrml', 'scad']);
const NATIVE_CAD = new Set([
  'sldprt', 'sldasm', 'slddrw', 'ipt', 'iam', 'catpart', 'catproduct',
  'prt', 'asm', 'par', 'psm', 'dwg', 'rvt', 'rfa', 'skp', 'c4d', 'f3d',
  'x_b', 'xmt_bin', '3dm', 'fcstd', 'catdrawing', 'dft', 'dgn', 'dwf',
  'dwfx', 'ipn', 'p2m', 'p2s', 'pla', 'pln', 'icd',
]);
const SCENE_MESH = new Set(['fbx', '3ds']);
const VISUAL = new Set(['jpg', 'jpeg', 'jfif', 'png', 'bmp', 'gif', 'webp', 'tif', 'tiff', 'svg', 'dds', 'hdr', 'psd']);
const MOTION_MEDIA = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv']);
const DOCUMENT = new Set(['pdf', 'md', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx']);
const METADATA = new Set(['json', 'xml', 'yaml', 'yml', 'html', 'htm', 'ini']);
const ARCHIVE = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'bz2']);
const UNSAFE = new Set(['exe', 'dll', 'msi', 'bat', 'cmd', 'ps1', 'com', 'scr', 'jar']);

const normalize = value => value.replaceAll('\\', '/');
export const extensionOf = relativePath => {
  const name = normalize(relativePath).split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export function referenceLineage(relativePath) {
  const normalized = normalize(relativePath);
  const segments = normalized.split('/');
  const snapshot = segments.find(segment => /\.snapshot\.\d+(?:\s*\(\d+\))?(?:\.zip)?$/i.test(segment));
  const source = (snapshot ?? segments.at(-2) ?? segments.at(-1) ?? 'root').replace(/\.zip$/i, '');
  return source.toLowerCase().replace(/\.snapshot\.\d+(?:\s*\(\d+\))?$/i, '').replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || 'root';
}

function result(lane, fidelity, automatedCheck, roles, extra = {}) {
  return {
    lane,
    fidelity,
    automatedCheck,
    roles,
    sourceBytesCopied: false,
    trainingEligible: false,
    commercialScoreEligible: false,
    licenseReviewRequired: true,
    ...extra,
  };
}

/** Every non-secret file gets one explicit utilization lane. Classification never grants accuracy or license approval. */
export function classifyReferenceArtifact(relativePath) {
  const normalized = normalize(relativePath);
  const lower = `/${normalized.toLowerCase()}/`;
  const extension = extensionOf(normalized);

  if (lower.includes('/result/ir/')) return result(
    'derived_ir_reuse', 'derived_not_independent_ground_truth', 'schema_and_lineage_validation',
    ['importer_regression_seed', 'cross_format_comparison', 'failure_triage'],
    { licenseReviewRequired: false, derivedEvidence: true },
  );
  if (lower.includes('/result/')) return result(
    'derived_result_reuse', 'derived_not_independent_ground_truth', 'artifact_schema_validation',
    ['failure_triage', 'regression_history'],
    { licenseReviewRequired: false, derivedEvidence: true },
  );
  if (EXACT_EXCHANGE.has(extension)) return result(
    'exact_exchange_regression', 'exact_brep_subject_to_import_gate', 'cad_corpus_evidence',
    ['ai_generation_reference', 'manual_hybrid_regression', 'expert_handoff_roundtrip', 'assembly_bom_geometry'],
  );
  if (GOVERNED_AUTOMATED.has(extension)) {
    const check = extension === 'stl' ? 'mesh_import'
      : extension === 'dxf' ? 'drawing_roundtrip'
        : extension === 'ifc' ? 'ifc_geometry_and_semantics'
          : 'parasolid_structure_only';
    const fidelity = extension === 'stl' ? 'mesh_only_no_analytic_brep'
      : extension === 'dxf' ? 'exact_2d_entities_when_supported'
        : extension === 'ifc' ? 'governed_geometry_and_spatial_semantics'
          : 'body_structure_not_native_mates';
    return result('governed_automated_regression', fidelity, check,
      ['ai_generation_reference', 'manual_hybrid_regression', 'importer_regression']);
  }
  if (BOUNDED_GEOMETRY.has(extension)) {
    const check = extension === 'scad' ? 'openscad_compile_and_parameter_probe'
      : ['iges', 'igs'].includes(extension) ? 'iges_bounded_geometry_probe'
        : extension === 'sat' ? 'acis_planar_or_bounded_probe'
          : 'mesh_or_scene_probe';
    return result('bounded_geometry_regression', 'bounded_adapter_never_exact_without_gate', check,
      ['ai_shape_reference', 'manual_hybrid_regression', 'importer_boundary_regression']);
  }
  if (SCENE_MESH.has(extension)) return result(
    'bounded_geometry_regression', 'scene_mesh_only_not_analytic_brep', 'mesh_or_scene_probe',
    ['ai_shape_reference', 'manual_hybrid_regression', 'appearance_comparison'],
  );
  if (NATIVE_CAD.has(extension)) return result(
    'native_semantics_review_queue', 'native_definition_requires_authoritative_extraction', 'native_worker_or_expert_review',
    ['feature_tree_reference', 'assembly_mate_review', 'drawing_dimension_review', 'manual_edit_impact_review'],
    { nativeSemanticsMustNotBeGuessed: true, endUserExternalCadRequired: false },
  );
  if (VISUAL.has(extension)) return result(
    'visual_reference', 'appearance_only_not_dimensional_ground_truth', 'image_decode_and_pairing',
    ['ai_visual_intent', 'appearance_comparison', 'human_review_context'],
  );
  if (MOTION_MEDIA.has(extension)) return result(
    'motion_reference', 'motion_visual_only_not_joint_ground_truth', 'media_metadata_and_pairing',
    ['motion_intent', 'human_clearance_review_context'],
  );
  if (DOCUMENT.has(extension)) return result(
    'document_reference', 'document_claim_requires_traceable_citation', 'document_index_and_trace',
    ['requirements_reference', 'drawing_review', 'manual_workflow_reference'],
  );
  if (METADATA.has(extension)) return result(
    'metadata_reference', 'metadata_requires_schema_and_lineage_validation', 'schema_or_text_index',
    ['lineage_pairing', 'expected_result_candidate', 'failure_triage'],
  );
  if (ARCHIVE.has(extension)) return result(
    'archive_lineage_container', 'container_not_independent_case', 'archive_preflight_without_extraction_to_source',
    ['lineage_grouping', 'native_worker_queue'],
  );
  if (UNSAFE.has(extension)) return result(
    'security_quarantine', 'never_executed', 'hash_and_inventory_only',
    ['security_inventory'],
    { licenseReviewRequired: false, executableNeverRun: true },
  );
  return result(
    'catalog_only', 'unknown_or_unregistered_format', 'inventory_only',
    ['future_adapter_backlog', 'lineage_context'],
  );
}

export function isSecretLikePath(relativePath) {
  const normalized = `/${normalize(relativePath).toLowerCase()}`;
  const base = path.posix.basename(normalized);
  return normalized.includes('/.git/') || normalized.includes('/node_modules/') || normalized.includes('/.gate_work/')
    || base === '.env' || base.startsWith('.env.') || /\.(pem|key|p12|pfx)$/i.test(base);
}
