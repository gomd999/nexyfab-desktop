import test from 'node:test';
import assert from 'node:assert/strict';
import { loadObjectStorageRestoreConfig } from './verify-object-storage-restore.mjs';

function validEnvironment() {
  return {
    RESTORE_OBJECT_DRILL_CONFIRM: 'NEXYFAB_ISOLATED_OBJECT_RESTORE_ONLY',
    RESTORE_OBJECT_SOURCE_ENDPOINT: 'https://source.example.com',
    RESTORE_OBJECT_SOURCE_REGION: 'ap-northeast-2',
    RESTORE_OBJECT_SOURCE_BUCKET: 'nexyfab-source',
    RESTORE_OBJECT_SOURCE_PREFIX: 'private',
    RESTORE_OBJECT_SOURCE_ACCESS_KEY_ID: 'source-key',
    RESTORE_OBJECT_SOURCE_SECRET_ACCESS_KEY: 'source-secret',
    RESTORE_OBJECT_BACKUP_ENDPOINT: 'https://backup.example.com',
    RESTORE_OBJECT_BACKUP_REGION: 'ap-northeast-2',
    RESTORE_OBJECT_BACKUP_BUCKET: 'nexyfab-backup',
    RESTORE_OBJECT_BACKUP_PREFIX: 'backup/release-1',
    RESTORE_OBJECT_BACKUP_ACCESS_KEY_ID: 'backup-key',
    RESTORE_OBJECT_BACKUP_SECRET_ACCESS_KEY: 'backup-secret',
    RESTORE_OBJECT_TARGET_ENDPOINT: 'https://restore.example.com',
    RESTORE_OBJECT_TARGET_REGION: 'ap-northeast-2',
    RESTORE_OBJECT_TARGET_BUCKET: 'nexyfab-restore-drill',
    RESTORE_OBJECT_TARGET_PREFIX: 'restore-drill/release-1',
    RESTORE_OBJECT_TARGET_ACCESS_KEY_ID: 'target-key',
    RESTORE_OBJECT_TARGET_SECRET_ACCESS_KEY: 'target-secret',
  };
}

test('requires three distinct safe object-store roles and normalizes prefixes', () => {
  const config = loadObjectStorageRestoreConfig(validEnvironment());
  assert.equal(config.source.prefix, 'private/');
  assert.equal(config.backup.prefix, 'backup/release-1/');
  assert.equal(config.target.prefix, 'restore-drill/release-1/');
  assert.equal(new Set([config.source.identity, config.backup.identity, config.target.identity]).size, 3);
});

test('allows HTTP only for a loopback disposable object store', () => {
  const local = validEnvironment();
  for (const role of ['SOURCE', 'BACKUP', 'TARGET']) {
    local[`RESTORE_OBJECT_${role}_ENDPOINT`] = 'http://127.0.0.1:9000';
    local[`RESTORE_OBJECT_${role}_FORCE_PATH_STYLE`] = '1';
  }
  assert.equal(loadObjectStorageRestoreConfig(local).source.forcePathStyle, true);
  const remoteHttp = { ...local, RESTORE_OBJECT_SOURCE_ENDPOINT: 'http://source.example.com' };
  assert.throws(() => loadObjectStorageRestoreConfig(remoteHttp), /https_or_loopback/);
});

test('rejects missing confirmation, role collision, and unsafe drill identities', () => {
  const missingConfirmation = validEnvironment();
  delete missingConfirmation.RESTORE_OBJECT_DRILL_CONFIRM;
  assert.throws(() => loadObjectStorageRestoreConfig(missingConfirmation), /CONFIRM/);

  const collision = validEnvironment();
  for (const field of ['ENDPOINT', 'REGION', 'BUCKET', 'PREFIX']) {
    collision[`RESTORE_OBJECT_TARGET_${field}`] = collision[`RESTORE_OBJECT_BACKUP_${field}`];
  }
  assert.throws(() => loadObjectStorageRestoreConfig(collision), /target_identity|collision/);

  const unsafeTarget = { ...validEnvironment(), RESTORE_OBJECT_TARGET_BUCKET: 'nexyfab-target' };
  assert.throws(() => loadObjectStorageRestoreConfig(unsafeTarget), /target_identity/);
});

test('rejects traversal-like prefixes and unbounded campaigns', () => {
  assert.throws(() => loadObjectStorageRestoreConfig({
    ...validEnvironment(),
    RESTORE_OBJECT_SOURCE_PREFIX: 'private/../outside',
  }), /PREFIX_invalid/);
  assert.throws(() => loadObjectStorageRestoreConfig({
    ...validEnvironment(),
    RESTORE_OBJECT_MAX_OBJECTS: '100001',
  }), /MAX_OBJECTS_invalid/);
});
