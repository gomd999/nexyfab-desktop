import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  buildDevEnvironment,
  getDevProfile,
  publicDevProfile,
  validateDevProfiles,
} from './dev-profile.mjs';

const profiles = {
  schema: 'nexyfab.workspace-dev-profiles.v1',
  host: '127.0.0.1',
  profiles: [
    { scope: 'platform', branch: 'scope/platform', port: 3100, stateDirectory: '.runtime/scopes/platform', nextDistDirectory: '.next-scope-platform', databaseMode: 'isolated-sqlite' },
    { scope: 'precision-cad', branch: 'scope/precision-cad', port: 3200, stateDirectory: '.runtime/scopes/precision-cad', nextDistDirectory: '.next-scope-precision-cad', databaseMode: 'isolated-sqlite' },
    { scope: 'ai-design', branch: 'scope/ai-design', port: 3300, stateDirectory: '.runtime/scopes/ai-design', nextDistDirectory: '.next-scope-ai-design', databaseMode: 'isolated-sqlite' },
  ],
};

test('dev profiles require unique ports and state paths', () => {
  assert.equal(validateDevProfiles(structuredClone(profiles)).profiles.length, 3);
  const duplicatePort = structuredClone(profiles);
  duplicatePort.profiles[2].port = 3200;
  assert.throws(() => validateDevProfiles(duplicatePort), /port_duplicate/);
  const unsafeState = structuredClone(profiles);
  unsafeState.profiles[0].stateDirectory = '../shared';
  assert.throws(() => validateDevProfiles(unsafeState), /state_directory_invalid/);
});

test('default scope environment isolates database, cache, origin, and state', () => {
  const profile = getDevProfile(profiles, 'precision-cad');
  const root = path.resolve('C:/repo/precision');
  const resolved = buildDevEnvironment(profile, {
    repositoryRoot: root,
    baseEnvironment: { DATABASE_URL: 'postgres://shared.example/db', KEEP_ME: 'yes' },
  });
  assert.equal(resolved.environment.DATABASE_URL, '');
  assert.equal(resolved.environment.NEXYFAB_DB_PATH, path.join(root, '.runtime/scopes/precision-cad/nexyfab.db'));
  assert.equal(resolved.environment.NEXT_DIST_DIR, '.next-scope-precision-cad');
  assert.equal(resolved.environment.NEXT_PUBLIC_SITE_URL, 'http://127.0.0.1:3200');
  assert.equal(resolved.environment.KEEP_ME, 'yes');
  assert.equal(publicDevProfile(profile, resolved).databaseMode, 'isolated-sqlite');
});

test('shared database use requires an explicit opt-in', () => {
  const profile = getDevProfile(profiles, 'ai-design');
  const resolved = buildDevEnvironment(profile, {
    repositoryRoot: 'C:/repo/ai',
    baseEnvironment: { DATABASE_URL: 'postgres://shared.example/db' },
    inheritDatabase: true,
  });
  assert.equal(resolved.environment.DATABASE_URL, 'postgres://shared.example/db');
  assert.equal(publicDevProfile(profile, resolved, { inheritDatabase: true }).databaseMode, 'inherited-explicitly');
});
