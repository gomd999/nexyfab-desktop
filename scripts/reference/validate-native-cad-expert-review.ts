import fs from 'node:fs';
import path from 'node:path';
import { writeLatestArtifactAtomic } from '../../src/lib/reference/immutableArtifactStore';
import { parseTrustedReviewerKeys, type NativeCadExpertReview } from '../../src/lib/reference/nativeCadExpertReview';
import { validateNativeCadExpertReviewPacket, type NativeCadExpertReviewPacket } from '../../src/lib/reference/nativeCadExpertReviewPacket';

const packetPath = process.argv[2] ? path.resolve(process.argv[2]) : '';
const reviewPath = process.argv[3] ? path.resolve(process.argv[3]) : '';
const output = path.resolve(process.argv[4] ?? 'validation-reports/native-cad-expert-review-validation.json');
if (!packetPath || !reviewPath) throw new Error('usage: <packet.json> <signed-review.json> [output.json]');
const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8')) as NativeCadExpertReviewPacket;
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')) as NativeCadExpertReview;
const trustedKeys = parseTrustedReviewerKeys();
const result = validateNativeCadExpertReviewPacket(packet, review, trustedKeys);
const artifact = { schema: 'nexyfab.native-cad-expert-review-validation.v1', generatedAt: new Date().toISOString(), targetHash: result.targetHash || null, trustedReviewerKeyCount: Object.keys(trustedKeys).length, approved: result.approved, errors: result.errors };
writeLatestArtifactAtomic(output, Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`));
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact }));
if (!result.approved) process.exitCode = 4;
