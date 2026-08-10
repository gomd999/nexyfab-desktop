import fs from 'node:fs';
import path from 'node:path';
import { writeImmutableArtifactAtomic } from '../../src/lib/reference/immutableArtifactStore';
import { buildNativeCadExpertReviewPacket } from '../../src/lib/reference/nativeCadExpertReviewPacket';

const claimPath = process.argv[2] ? path.resolve(process.argv[2]) : '';
const verificationInputPath = process.argv[3] ? path.resolve(process.argv[3]) : '';
const outputDir = path.resolve(process.argv[4] ?? 'validation-reports/native-cad-expert-review-packets');
if (!claimPath || !verificationInputPath) throw new Error('usage: <joint-evidence.json> <verification-input.json> [output-dir]');
const claim = JSON.parse(fs.readFileSync(claimPath, 'utf8')) as Record<string, unknown>;
const verificationInput = JSON.parse(fs.readFileSync(verificationInputPath, 'utf8')) as unknown;
if (claim.provenance !== 'native-cad' || claim.semanticsComplete !== true) throw new Error('native_complete_joint_evidence_required');
if (typeof claim.sourceHash !== 'string' || !Array.isArray(claim.artifactHashes) || typeof claim.jointDefinitionHash !== 'string' || typeof claim.revision !== 'number') throw new Error('joint_evidence_identity_invalid');
const packet = buildNativeCadExpertReviewPacket({ sourceHash: claim.sourceHash, artifactHashes: claim.artifactHashes as string[], jointDefinitionHash: claim.jointDefinitionHash, revision: claim.revision }, verificationInput);
const basename = `native-cad-review-${packet.targetHash}.packet.json`;
writeImmutableArtifactAtomic(outputDir, basename, Buffer.from(`${JSON.stringify(packet, null, 2)}\n`), 'native_cad_review_packet_collision');
console.log(JSON.stringify({ ok: true, packet: basename, targetHash: packet.targetHash, approvalGranted: false }));
