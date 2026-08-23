export const CAD_FAILURE_CODES = [
  'KERNEL_UNAVAILABLE', 'UNSUPPORTED_ENTITY', 'INVALID_BREP', 'ZERO_SOLID',
  'MISSING_TRANSFORM', 'INVALID_TRANSFORM', 'AMBIGUOUS_PARENT_CONTEXT', 'CYCLIC_ASSEMBLY',
  'AMBIGUOUS_UNIT', 'HEADER_INVALID', 'NO_TRANSFERABLE_ROOTS', 'HEALING_EXCEEDED_TOLERANCE',
  'PRECISE_INTERFERENCE_NOT_RUN', 'PMI_NOT_PRESENT', 'IFC_PLACEMENT_UNRESOLVED',
  'ROTATIONAL_CCD_UNRESOLVED', 'LINEAR_CCD_UNRESOLVED', 'COLLISION_GEOMETRY_MISSING', 'PRECISE_CCD_BUDGET_EXCEEDED', 'PRECISE_TOI_UNRESOLVED',
  'SPACE_BOUNDARY_OPEN', 'SEMANTIC_MAPPING_UNAVAILABLE', 'BYTE_BUDGET_EXCEEDED', 'GEOMETRY_INCOMPLETE', 'UNKNOWN_IMPORT_FAILURE',
  'DECLARED_JOINT_GEOMETRY_MISMATCH', 'CONTINUOUS_SEGMENT_GEOMETRY_MISMATCH',
  'GENERATION_PROGRAM_BINDING_MISMATCH', 'SEMANTIC_INVENTORY_MISMATCH', 'CLIENT_ASSERTED_MEASUREMENT_REJECTED',
  'GENERATION_EXACT_CAD_CHECKPOINT_MISSING', 'GENERATION_EXACT_CAD_CHECKPOINT_MISMATCH',
  'FALLBACK_NOT_RELEASE_ELIGIBLE', 'REPAIR_SCOPE_VIOLATION', 'RELEASE_EVIDENCE_SIGNATURE_INVALID',
  'ROUTE_GEOMETRY_MISSING', 'TYPED_PORT_INCOMPLETE', 'TYPED_RUN_INCOMPLETE', 'DUPLICATE_INTERNAL_FLOW_SOLID', 'PHYSICAL_NETWORK_EMPTY',
] as const;

export type CadFailureCode = typeof CAD_FAILURE_CODES[number];

export interface CadFailureDisposition {
  code: CadFailureCode;
  retryable: boolean;
  automaticRepair: 'header-normalize' | 'unit-resolve' | 'shape-heal' | 'placement-resolve' | 'collision-refine' | null;
  releaseBlocking: boolean;
}

const DISPOSITIONS: Record<CadFailureCode, Omit<CadFailureDisposition, 'code'>> = {
  KERNEL_UNAVAILABLE: { retryable: true, automaticRepair: null, releaseBlocking: true },
  UNSUPPORTED_ENTITY: { retryable: false, automaticRepair: null, releaseBlocking: true },
  INVALID_BREP: { retryable: true, automaticRepair: 'shape-heal', releaseBlocking: true },
  ZERO_SOLID: { retryable: true, automaticRepair: 'shape-heal', releaseBlocking: true },
  MISSING_TRANSFORM: { retryable: true, automaticRepair: 'placement-resolve', releaseBlocking: true },
  INVALID_TRANSFORM: { retryable: false, automaticRepair: null, releaseBlocking: true },
  AMBIGUOUS_PARENT_CONTEXT: { retryable: true, automaticRepair: 'placement-resolve', releaseBlocking: true },
  CYCLIC_ASSEMBLY: { retryable: false, automaticRepair: null, releaseBlocking: true },
  AMBIGUOUS_UNIT: { retryable: true, automaticRepair: 'unit-resolve', releaseBlocking: true },
  HEADER_INVALID: { retryable: true, automaticRepair: 'header-normalize', releaseBlocking: true },
  NO_TRANSFERABLE_ROOTS: { retryable: false, automaticRepair: null, releaseBlocking: true },
  HEALING_EXCEEDED_TOLERANCE: { retryable: false, automaticRepair: null, releaseBlocking: true },
  PRECISE_INTERFERENCE_NOT_RUN: { retryable: true, automaticRepair: null, releaseBlocking: true },
  PMI_NOT_PRESENT: { retryable: false, automaticRepair: null, releaseBlocking: false },
  IFC_PLACEMENT_UNRESOLVED: { retryable: true, automaticRepair: 'placement-resolve', releaseBlocking: true },
  ROTATIONAL_CCD_UNRESOLVED: { retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true },
  LINEAR_CCD_UNRESOLVED: { retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true },
  COLLISION_GEOMETRY_MISSING: { retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true },
  PRECISE_CCD_BUDGET_EXCEEDED: { retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true },
  PRECISE_TOI_UNRESOLVED: { retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true },
  SPACE_BOUNDARY_OPEN: { retryable: true, automaticRepair: 'shape-heal', releaseBlocking: true },
  SEMANTIC_MAPPING_UNAVAILABLE: { retryable: false, automaticRepair: null, releaseBlocking: true },
  BYTE_BUDGET_EXCEEDED: { retryable: true, automaticRepair: null, releaseBlocking: true },
  GEOMETRY_INCOMPLETE: { retryable: true, automaticRepair: null, releaseBlocking: true },
  UNKNOWN_IMPORT_FAILURE: { retryable: false, automaticRepair: null, releaseBlocking: true },
  DECLARED_JOINT_GEOMETRY_MISMATCH: { retryable: false, automaticRepair: null, releaseBlocking: true },
  CONTINUOUS_SEGMENT_GEOMETRY_MISMATCH: { retryable: false, automaticRepair: null, releaseBlocking: true },
  GENERATION_PROGRAM_BINDING_MISMATCH: { retryable: false, automaticRepair: null, releaseBlocking: true },
  GENERATION_EXACT_CAD_CHECKPOINT_MISSING: { retryable: true, automaticRepair: null, releaseBlocking: true },
  GENERATION_EXACT_CAD_CHECKPOINT_MISMATCH: { retryable: false, automaticRepair: null, releaseBlocking: true },
  SEMANTIC_INVENTORY_MISMATCH: { retryable: false, automaticRepair: null, releaseBlocking: true },
  CLIENT_ASSERTED_MEASUREMENT_REJECTED: { retryable: false, automaticRepair: null, releaseBlocking: true },
  FALLBACK_NOT_RELEASE_ELIGIBLE: { retryable: false, automaticRepair: null, releaseBlocking: true },
  REPAIR_SCOPE_VIOLATION: { retryable: false, automaticRepair: null, releaseBlocking: true },
  RELEASE_EVIDENCE_SIGNATURE_INVALID: { retryable: false, automaticRepair: null, releaseBlocking: true },
  ROUTE_GEOMETRY_MISSING: { retryable: true, automaticRepair: null, releaseBlocking: true },
  TYPED_PORT_INCOMPLETE: { retryable: false, automaticRepair: null, releaseBlocking: true },
  TYPED_RUN_INCOMPLETE: { retryable: false, automaticRepair: null, releaseBlocking: true },
  DUPLICATE_INTERNAL_FLOW_SOLID: { retryable: false, automaticRepair: null, releaseBlocking: true },
  PHYSICAL_NETWORK_EMPTY: { retryable: false, automaticRepair: null, releaseBlocking: true },
};

export function cadFailureDisposition(code: CadFailureCode): CadFailureDisposition {
  return { code, ...DISPOSITIONS[code] };
}

/** Maps unstable adapter text to a stable, non-sensitive machine code. */
export function classifyCadImportFailure(error: string | undefined): CadFailureDisposition {
  const text = (error ?? '').toLowerCase();
  let code: CadFailureCode = 'UNKNOWN_IMPORT_FAILURE';
  if (/kernel.*unavailable|not initialized|wasm.*unavailable/.test(text)) code = 'KERNEL_UNAVAILABLE';
  else if (/header|file_name|authorisation|schema header/.test(text)) code = 'HEADER_INVALID';
  else if (/no transferable roots|no roots/.test(text)) code = 'NO_TRANSFERABLE_ROOTS';
  else if (/no solids|zero solid/.test(text)) code = 'ZERO_SOLID';
  else if (/unsupported|not handle|unknown entity/.test(text)) code = 'UNSUPPORTED_ENTITY';
  else if (/brep|shape.*invalid|could not be parsed/.test(text)) code = 'INVALID_BREP';
  return cadFailureDisposition(code);
}
