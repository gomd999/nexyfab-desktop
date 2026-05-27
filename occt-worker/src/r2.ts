/**
 * Cloudflare R2 client wrapper — get/put objects by key.
 *
 * Wave 1 W10 D1-3 (ADR-007 § Payload). Geometry blobs (STL / STEP)
 * go through R2 instead of the HTTP request body so the worker can
 * handle inputs > 256 KB without bumping express's body limit. The
 * client uploads to R2, the worker fetches by key, processes, writes
 * results back as new R2 keys, and returns those keys to the client.
 *
 * Uses AWS SDK in S3-compatible mode against R2's endpoint — same
 * pattern as the main app's R2 access (see project_r2_architecture
 * memory entry).
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    );
  }

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // R2 is S3-API-compatible; this keeps the SDK from issuing the
    // GetBucketLocation roundtrip that would 501 against R2.
    forcePathStyle: true,
  });
  return cachedClient;
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2 not configured — set R2_BUCKET');
  return bucket;
}

/** Stream-to-Buffer helper. R2 responses are Node Readable streams. */
async function streamToBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Download an R2 object by key. Throws if absent. */
export async function r2Get(key: string): Promise<Buffer> {
  const client = getClient();
  const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  const resp = await client.send(cmd);
  if (!resp.Body) {
    throw new Error(`R2 object empty: ${key}`);
  }
  // AWS SDK v3 returns a Readable in Node; cast through unknown for
  // the typed interface.
  return streamToBuffer(resp.Body as unknown as AsyncIterable<Uint8Array>);
}

/** Upload bytes to R2 under the given key. ContentType defaults to
 *  application/octet-stream; pass 'application/step' or similar for
 *  CAD-aware tooling. */
export async function r2Put(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType = 'application/octet-stream',
): Promise<void> {
  const client = getClient();
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await client.send(cmd);
}

/** Generate a fresh per-op key under a stable prefix. The prefix lets
 *  us set a 24-h R2 lifecycle policy on intermediate op outputs
 *  without affecting long-lived project blobs. */
export function r2OpKey(userId: string, operation: string, ext: 'stl' | 'step'): string {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 8);
  return `occt-ops/${userId}/${operation}/${ts}-${rnd}.${ext}`;
}
