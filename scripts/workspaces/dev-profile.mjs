import fs from 'node:fs';
import path from 'node:path';
import { repositoryRoot } from './workspace-registry.mjs';

export const devProfilesPath = path.join(repositoryRoot, 'workspaces', 'dev-profiles.json');

export function validateDevProfiles(document) {
  if (document?.schema !== 'nexyfab.workspace-dev-profiles.v1') throw new Error('workspace_dev_profiles_schema_invalid');
  if (!Array.isArray(document.profiles) || document.profiles.length !== 3) throw new Error('workspace_dev_profiles_count_invalid');
  const scopes = new Set();
  const branches = new Set();
  const ports = new Set();
  const stateDirectories = new Set();
  const nextDirectories = new Set();
  for (const profile of document.profiles) {
    if (!profile.scope || !profile.branch || !Number.isInteger(profile.port) || profile.port < 1024 || profile.port > 65535) {
      throw new Error(`workspace_dev_profile_invalid:${profile.scope ?? 'unknown'}`);
    }
    if (profile.databaseMode !== 'isolated-sqlite') throw new Error(`workspace_dev_profile_database_mode_invalid:${profile.scope}`);
    if (!profile.stateDirectory?.startsWith('.runtime/scopes/') || path.isAbsolute(profile.stateDirectory)) {
      throw new Error(`workspace_dev_profile_state_directory_invalid:${profile.scope}`);
    }
    if (!profile.nextDistDirectory?.startsWith('.next-scope-') || path.isAbsolute(profile.nextDistDirectory)) {
      throw new Error(`workspace_dev_profile_next_directory_invalid:${profile.scope}`);
    }
    if (scopes.has(profile.scope)) throw new Error(`workspace_dev_profile_scope_duplicate:${profile.scope}`);
    if (branches.has(profile.branch)) throw new Error(`workspace_dev_profile_branch_duplicate:${profile.branch}`);
    if (ports.has(profile.port)) throw new Error(`workspace_dev_profile_port_duplicate:${profile.port}`);
    if (stateDirectories.has(profile.stateDirectory)) throw new Error(`workspace_dev_profile_state_duplicate:${profile.stateDirectory}`);
    if (nextDirectories.has(profile.nextDistDirectory)) throw new Error(`workspace_dev_profile_next_duplicate:${profile.nextDistDirectory}`);
    scopes.add(profile.scope);
    branches.add(profile.branch);
    ports.add(profile.port);
    stateDirectories.add(profile.stateDirectory);
    nextDirectories.add(profile.nextDistDirectory);
  }
  return document;
}

export function readDevProfiles() {
  return validateDevProfiles(JSON.parse(fs.readFileSync(devProfilesPath, 'utf8')));
}

export function getDevProfile(document, scopeId) {
  const profile = document.profiles.find(candidate => candidate.scope === scopeId);
  if (!profile) throw new Error(`workspace_dev_profile_unknown:${scopeId}`);
  return profile;
}

export function buildDevEnvironment(profile, options = {}) {
  const root = path.resolve(options.repositoryRoot ?? repositoryRoot);
  const stateDirectory = path.resolve(root, profile.stateDirectory);
  const databasePath = path.join(stateDirectory, 'nexyfab.db');
  const origin = `http://${options.host ?? '127.0.0.1'}:${profile.port}`;
  const environment = {
    ...(options.baseEnvironment ?? process.env),
    NEXYFAB_SCOPE_ID: profile.scope,
    PORT: String(profile.port),
    NEXT_DIST_DIR: profile.nextDistDirectory,
    NEXYFAB_SCOPE_STATE_DIR: stateDirectory,
    NEXYFAB_DB_PATH: databasePath,
    DATA_ROOT: stateDirectory,
    NEXT_PUBLIC_SITE_URL: origin,
    ALLOWED_ORIGINS: origin,
    CORS_ALLOWED_ORIGINS: origin,
  };
  if (!options.inheritDatabase) environment.DATABASE_URL = '';
  return { environment, origin, stateDirectory, databasePath };
}

export function publicDevProfile(profile, resolved, options = {}) {
  return {
    schema: 'nexyfab.workspace-dev-session.v1',
    scope: profile.scope,
    branch: profile.branch,
    host: options.host ?? '127.0.0.1',
    port: profile.port,
    origin: resolved.origin,
    databaseMode: options.inheritDatabase ? 'inherited-explicitly' : profile.databaseMode,
    databasePath: options.inheritDatabase ? null : resolved.databasePath,
    stateDirectory: resolved.stateDirectory,
    nextDistDirectory: profile.nextDistDirectory,
  };
}
