#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const SHA256 = /^[a-f0-9]{64}$/;
const BUCKET = /^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const CONFIRMATION = 'NEXYFAB_ISOLATED_OBJECT_RESTORE_ONLY';
const ROLE_NAMES = Object.freeze(['SOURCE', 'BACKUP', 'TARGET']);
const EVIDENCE_CLASSES = new Set(['local-fixture', 'release-bound']);

const sha256 = value => createHash('sha256').update(value).digest('hex');

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function positiveLimit(env, name, fallback, maximum) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

function endpoint(value, name) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error(`${name}_invalid`); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error(`${name}_unsafe`);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error(`${name}_https_or_loopback_required`);
  }
  return parsed.origin;
}

function bucket(value, name) {
  if (!BUCKET.test(value) || value.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

function prefix(value, name) {
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('//')) {
    throw new Error(`${name}_invalid`);
  }
  const parts = value.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..')) {
    throw new Error(`${name}_invalid`);
  }
  return `${parts.join('/')}/`;
}

function roleConfig(env, role) {
  const base = `RESTORE_OBJECT_${role}`;
  const resolvedEndpoint = endpoint(required(env, `${base}_ENDPOINT`), `${base}_ENDPOINT`);
  const region = required(env, `${base}_REGION`);
  const resolvedBucket = bucket(required(env, `${base}_BUCKET`), `${base}_BUCKET`);
  const resolvedPrefix = prefix(required(env, `${base}_PREFIX`), `${base}_PREFIX`);
  const accessKeyId = required(env, `${base}_ACCESS_KEY_ID`);
  const secretAccessKey = required(env, `${base}_SECRET_ACCESS_KEY`);
  if (accessKeyId.length > 256 || secretAccessKey.length > 2048) throw new Error(`${base}_credentials_invalid`);
  return {
    role: role.toLowerCase(),
    endpoint: resolvedEndpoint,
    region,
    bucket: resolvedBucket,
    prefix: resolvedPrefix,
    forcePathStyle: env[`${base}_FORCE_PATH_STYLE`] === '1',
    credentials: { accessKeyId, secretAccessKey },
    identity: `${resolvedEndpoint}\0${region}\0${resolvedBucket}\0${resolvedPrefix}`,
  };
}

export function loadObjectStorageRestoreConfig(env = process.env, { evidenceClass = 'local-fixture' } = {}) {
  if (env.RESTORE_OBJECT_DRILL_CONFIRM !== CONFIRMATION) {
    throw new Error(`RESTORE_OBJECT_DRILL_CONFIRM_must_equal_${CONFIRMATION}`);
  }
  if (!EVIDENCE_CLASSES.has(evidenceClass)) throw new Error('RESTORE_EVIDENCE_CLASS_invalid');
  const roles = Object.fromEntries(ROLE_NAMES.map(role => [role.toLowerCase(), roleConfig(env, role)]));
  if (!roles.backup.bucket.includes('backup') || !roles.backup.prefix.includes('backup')) {
    throw new Error('restore_object_backup_identity_invalid');
  }
  if (!roles.target.bucket.includes('restore-drill') || !roles.target.prefix.includes('restore-drill')) {
    throw new Error('restore_object_target_identity_invalid');
  }
  if (roles.source.bucket.includes('restore-drill') || roles.source.bucket.includes('backup')) {
    throw new Error('restore_object_source_identity_invalid');
  }
  if (new Set(Object.values(roles).map(role => role.identity)).size !== ROLE_NAMES.length) {
    throw new Error('restore_object_role_identity_collision');
  }
  const backupFailureDomainDistinct = roles.source.endpoint !== roles.backup.endpoint
    || roles.source.region !== roles.backup.region;
  let backupKmsKeyId = null;
  if (evidenceClass === 'release-bound') {
    if (!backupFailureDomainDistinct) throw new Error('restore_object_backup_failure_domain_not_distinct');
    backupKmsKeyId = required(env, 'RESTORE_OBJECT_BACKUP_KMS_KEY_ID');
    if (backupKmsKeyId.length > 2048) throw new Error('RESTORE_OBJECT_BACKUP_KMS_KEY_ID_invalid');
  }
  return {
    ...roles,
    evidenceClass,
    backupFailureDomainDistinct,
    backupKmsKeyId,
    maxObjects: positiveLimit(env, 'RESTORE_OBJECT_MAX_OBJECTS', 10_000, 100_000),
    maxTotalBytes: positiveLimit(env, 'RESTORE_OBJECT_MAX_TOTAL_BYTES', 10 * 1024 ** 3, 100 * 1024 ** 3),
    maxObjectBytes: positiveLimit(env, 'RESTORE_OBJECT_MAX_OBJECT_BYTES', 128 * 1024 ** 2, 5 * 1024 ** 3),
  };
}

function clientFor(role) {
  return new S3Client({
    endpoint: role.endpoint,
    region: role.region,
    forcePathStyle: role.forcePathStyle,
    credentials: role.credentials,
  });
}

async function listObjects(client, role, maxObjects) {
  const objects = [];
  let continuationToken;
  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: role.bucket,
      Prefix: role.prefix,
      ContinuationToken: continuationToken,
    }));
    for (const item of result.Contents ?? []) {
      const key = String(item.Key ?? '');
      if (!key.startsWith(role.prefix) || key === role.prefix) continue;
      const relativeKey = key.slice(role.prefix.length);
      if (!relativeKey || relativeKey.startsWith('/') || relativeKey.includes('\\')
        || relativeKey.split('/').some(part => part === '.' || part === '..')) {
        throw new Error(`restore_object_key_invalid:${role.role}`);
      }
      objects.push({ key, relativeKey, listedBytes: Number(item.Size ?? -1) });
      if (objects.length > maxObjects) throw new Error(`restore_object_count_limit:${role.role}`);
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    if (result.IsTruncated && !continuationToken) throw new Error(`restore_object_pagination_invalid:${role.role}`);
  } while (continuationToken);
  return objects.sort((left, right) => left.relativeKey.localeCompare(right.relativeKey));
}

async function bodyBytes(result, role, key) {
  if (!result.Body || typeof result.Body.transformToByteArray !== 'function') {
    throw new Error(`restore_object_body_missing:${role.role}:${sha256(key)}`);
  }
  return Buffer.from(await result.Body.transformToByteArray());
}

function publicManifest(entries) {
  const objects = entries.map(item => ({
    keySha256: sha256(item.relativeKey),
    bytes: item.bytes,
    contentSha256: item.contentSha256,
  }));
  return {
    objectCount: objects.length,
    totalBytes: objects.reduce((sum, item) => sum + item.bytes, 0),
    manifestSha256: sha256(JSON.stringify(objects)),
    objects,
  };
}

async function scanRole(client, role, limits, requireNonEmpty) {
  await client.send(new HeadBucketCommand({ Bucket: role.bucket }));
  const listed = await listObjects(client, role, limits.maxObjects);
  if (requireNonEmpty && listed.length === 0) throw new Error(`restore_object_source_empty:${role.role}`);
  let totalBytes = 0;
  const entries = [];
  for (const item of listed) {
    if (!Number.isSafeInteger(item.listedBytes) || item.listedBytes < 0 || item.listedBytes > limits.maxObjectBytes) {
      throw new Error(`restore_object_size_limit:${role.role}:${sha256(item.relativeKey)}`);
    }
    totalBytes += item.listedBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new Error(`restore_object_total_size_limit:${role.role}`);
    }
    const result = await client.send(new GetObjectCommand({ Bucket: role.bucket, Key: item.key }));
    const bytes = await bodyBytes(result, role, item.key);
    if (bytes.byteLength !== item.listedBytes) {
      throw new Error(`restore_object_list_read_size_mismatch:${role.role}:${sha256(item.relativeKey)}`);
    }
    entries.push({
      ...item,
      bytes: bytes.byteLength,
      contentSha256: sha256(bytes),
      body: bytes,
      serverSideEncryption: result.ServerSideEncryption ?? null,
      sseKmsKeyId: result.SSEKMSKeyId ?? null,
    });
  }
  return { entries, manifest: publicManifest(entries) };
}

function sameEntries(expected, actual) {
  if (expected.length !== actual.length) return false;
  return expected.every((item, index) => item.relativeKey === actual[index]?.relativeKey
    && item.bytes === actual[index]?.bytes
    && item.contentSha256 === actual[index]?.contentSha256);
}

async function writeSnapshot(client, role, entries, { kmsKeyId = null } = {}) {
  for (const item of entries) {
    await client.send(new PutObjectCommand({
      Bucket: role.bucket,
      Key: `${role.prefix}${item.relativeKey}`,
      Body: item.body,
      ContentLength: item.bytes,
      ContentType: 'application/octet-stream',
      IfNoneMatch: '*',
      Metadata: { 'nexyfab-content-sha256': item.contentSha256 },
      ...(kmsKeyId ? {
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: kmsKeyId,
        ChecksumSHA256: Buffer.from(item.contentSha256, 'hex').toString('base64'),
      } : {}),
    }));
  }
}

async function backupProtection(client, config) {
  if (config.evidenceClass !== 'release-bound') {
    return {
      releaseBoundRequired: false,
      failureDomainDistinct: config.backupFailureDomainDistinct,
      versioningEnabled: false,
      objectLockEnabled: false,
      defaultRetentionMode: null,
      defaultRetentionDays: null,
      defaultRetentionYears: null,
      kmsEncryptionVerified: false,
      kmsKeyIdSha256: null,
    };
  }
  const [versioning, objectLock] = await Promise.all([
    client.send(new GetBucketVersioningCommand({ Bucket: config.backup.bucket })),
    client.send(new GetObjectLockConfigurationCommand({ Bucket: config.backup.bucket })),
  ]);
  const lock = objectLock.ObjectLockConfiguration;
  const retention = lock?.Rule?.DefaultRetention;
  const retentionValue = Number(retention?.Days ?? retention?.Years ?? 0);
  if (versioning.Status !== 'Enabled') throw new Error('restore_object_backup_versioning_required');
  if (lock?.ObjectLockEnabled !== 'Enabled') throw new Error('restore_object_backup_object_lock_required');
  if (!['COMPLIANCE', 'GOVERNANCE'].includes(retention?.Mode) || !Number.isSafeInteger(retentionValue) || retentionValue < 1) {
    throw new Error('restore_object_backup_default_retention_required');
  }
  return {
    releaseBoundRequired: true,
    failureDomainDistinct: true,
    versioningEnabled: true,
    objectLockEnabled: true,
    defaultRetentionMode: retention.Mode,
    defaultRetentionDays: retention.Days ?? null,
    defaultRetentionYears: retention.Years ?? null,
    kmsEncryptionVerified: true,
    kmsKeyIdSha256: sha256(config.backupKmsKeyId),
  };
}

function bindingSummary(bindings) {
  const normalized = bindings.map(binding => ({
    kind: binding.kind,
    keySha256: sha256(binding.objectKey),
    bytes: binding.byteLength,
    contentSha256: binding.contentSha256,
  })).sort((left, right) => left.keySha256.localeCompare(right.keySha256));
  const byKind = Object.fromEntries([...new Set(normalized.map(item => item.kind))].sort()
    .map(kind => [kind, normalized.filter(item => item.kind === kind).length]));
  return {
    count: normalized.length,
    byKind,
    manifestSha256: sha256(JSON.stringify(normalized)),
    allMatched: true,
  };
}

function assertDatabaseBindings(source, sourceRole, bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) throw new Error('restore_object_database_bindings_empty');
  const byRelativeKey = new Map(source.entries.map(item => [item.relativeKey, item]));
  const seen = new Set();
  for (const binding of bindings) {
    if (!binding || typeof binding.kind !== 'string' || typeof binding.objectKey !== 'string'
      || !SHA256.test(String(binding.contentSha256 ?? ''))
      || !Number.isSafeInteger(binding.byteLength) || binding.byteLength < 1
      || !binding.objectKey.startsWith(sourceRole.prefix)) {
      throw new Error('restore_object_database_binding_invalid');
    }
    if (seen.has(binding.objectKey)) throw new Error('restore_object_database_binding_duplicate');
    seen.add(binding.objectKey);
    const object = byRelativeKey.get(binding.objectKey.slice(sourceRole.prefix.length));
    if (!object || object.bytes !== binding.byteLength || object.contentSha256 !== binding.contentSha256) {
      throw new Error(`restore_object_database_binding_mismatch:${binding.kind}:${sha256(binding.objectKey)}`);
    }
  }
}

function receiptRole(role, manifest, extra = {}) {
  return {
    endpointSha256: sha256(role.endpoint),
    region: role.region,
    bucket: role.bucket,
    prefix: role.prefix,
    ...manifest,
    ...extra,
  };
}

export async function verifyObjectStorageRestoreDrill({ config, requiredBindings }) {
  const sourceClient = clientFor(config.source);
  const backupClient = clientFor(config.backup);
  const targetClient = clientFor(config.target);
  const limits = {
    maxObjects: config.maxObjects,
    maxTotalBytes: config.maxTotalBytes,
    maxObjectBytes: config.maxObjectBytes,
  };
  try {
    const protection = await backupProtection(backupClient, config);
    const sourceBefore = await scanRole(sourceClient, config.source, limits, true);
    assertDatabaseBindings(sourceBefore, config.source, requiredBindings);
    const backupBefore = await scanRole(backupClient, config.backup, limits, false);
    const targetBefore = await scanRole(targetClient, config.target, limits, false);
    if (backupBefore.entries.length !== 0) throw new Error('restore_object_backup_prefix_not_empty');
    if (targetBefore.entries.length !== 0) throw new Error('restore_object_target_prefix_not_empty');

    await writeSnapshot(backupClient, config.backup, sourceBefore.entries, { kmsKeyId: config.backupKmsKeyId });
    const backupAfter = await scanRole(backupClient, config.backup, limits, true);
    if (!sameEntries(sourceBefore.entries, backupAfter.entries)) throw new Error('restore_object_backup_mismatch');
    if (config.evidenceClass === 'release-bound' && backupAfter.entries.some(item =>
      item.serverSideEncryption !== 'aws:kms' || item.sseKmsKeyId !== config.backupKmsKeyId)) {
      throw new Error('restore_object_backup_kms_encryption_mismatch');
    }

    await writeSnapshot(targetClient, config.target, backupAfter.entries);
    const targetAfter = await scanRole(targetClient, config.target, limits, true);
    if (!sameEntries(sourceBefore.entries, targetAfter.entries)) throw new Error('restore_object_target_mismatch');

    const sourceAfter = await scanRole(sourceClient, config.source, limits, true);
    if (!sameEntries(sourceBefore.entries, sourceAfter.entries)) throw new Error('restore_object_source_changed');

    return {
      schema: 'nexyfab.object-storage-isolated-restore-drill.v1',
      status: 'PASS',
      safety: {
        sourceWasReadOnly: true,
        sourceUnchanged: true,
        backupPrefixInitiallyEmpty: true,
        restorePrefixInitiallyEmpty: true,
        roleIdentitiesDistinct: true,
        noOverwriteWrites: true,
      },
      databaseBindings: bindingSummary(requiredBindings),
      protection,
      source: receiptRole(config.source, sourceBefore.manifest),
      backup: receiptRole(config.backup, backupAfter.manifest, { exactSourceMatch: true }),
      restored: receiptRole(config.target, targetAfter.manifest, { exactSourceMatch: true }),
      limits,
    };
  } finally {
    sourceClient.destroy();
    backupClient.destroy();
    targetClient.destroy();
  }
}
