const SHA256 = /^[a-f0-9]{64}$/;

export type EvidenceGateName = 'partStepRoundtrip' | 'xcafAssemblyRoundtrip' | 'exactDrawingProjection';
export interface EvidenceReference {
  schema: string;
  sha256: string;
  status: 'pass' | 'fail';
  generator: string;
  verifier: string;
}

export interface NexyFabKernelEvidenceV1 {
  schema: 'nexyfab.kernel-evidence.v1';
  status: 'pass' | 'fail';
  revisionManifestSha256: string;
  kernelStackIdentitySha256: string;
  gates: Record<EvidenceGateName, EvidenceReference>;
  blockers: string[];
}

export function buildNexyFabKernelEvidence(input: Omit<NexyFabKernelEvidenceV1, 'schema' | 'status' | 'blockers'>): NexyFabKernelEvidenceV1 {
  const blockers: string[] = [];
  if (!SHA256.test(input.revisionManifestSha256)) blockers.push('revision-manifest-sha256-invalid');
  if (!SHA256.test(input.kernelStackIdentitySha256)) blockers.push('kernel-stack-identity-sha256-invalid');
  for (const [name, gate] of Object.entries(input.gates)) {
    if (!gate.schema.trim()) blockers.push(`${name}:schema-missing`);
    if (!SHA256.test(gate.sha256)) blockers.push(`${name}:sha256-invalid`);
    if (gate.status !== 'pass') blockers.push(`${name}:failed`);
    if (!gate.generator.trim() || !gate.verifier.trim()) blockers.push(`${name}:engine-identity-missing`);
    if (gate.generator === gate.verifier) blockers.push(`${name}:verifier-not-isolated`);
  }
  return {
    schema: 'nexyfab.kernel-evidence.v1',
    status: blockers.length === 0 ? 'pass' : 'fail',
    ...input,
    blockers,
  };
}
