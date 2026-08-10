import fs from 'node:fs';
import path from 'node:path';

const CLIENT_MANIFEST = 'page_client-reference-manifest.js';

export function parseClientReferenceManifest(source) {
  const assignment = source.indexOf(']={');
  if (assignment < 0) throw new Error('client reference manifest assignment not found');
  const routeMatches = [...source.matchAll(/__RSC_MANIFEST\[(?:"([^"]+)"|'([^']+)')\]/g)];
  const routeMatch = routeMatches.at(-1);
  if (!routeMatch) throw new Error('client reference manifest route not found');
  return {
    route: routeMatch[1] ?? routeMatch[2],
    manifest: JSON.parse(source.slice(assignment + 2).replace(/;\s*$/, '')),
  };
}

function walk(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, result);
    else if (entry.isFile() && entry.name === CLIENT_MANIFEST) result.push(full);
  }
  return result;
}

function assetPath(nextDir, relativePath) {
  const decoded = decodeURIComponent(relativePath);
  const direct = path.join(nextDir, relativePath);
  if (fs.existsSync(direct)) return direct;
  return path.join(nextDir, decoded);
}

function assetBytes(nextDir, relativePath) {
  const resolved = assetPath(nextDir, relativePath);
  return fs.existsSync(resolved) ? fs.statSync(resolved).size : 0;
}

function encodedRoutePrefix(route) {
  const withoutPage = route.replace(/\/page$/, '').replace(/^\//, '');
  return withoutPage.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function routeSourcePrefix(entryKey) {
  const normalized = entryKey.replaceAll('\\', '/');
  const marker = '/src/app/';
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return null;
  const relative = normalized.slice(index + marker.length).replace(/(^|\/)(layout|page)$/, '');
  return `/${relative}`.replace(/\/$/, '');
}

export function extractAppRouteBundle(nextDir, source) {
  const { route, manifest } = parseClientReferenceManifest(source);
  const routePrefix = encodedRoutePrefix(route);
  const pageChunkPrefix = `static/chunks/app/${routePrefix ? `${routePrefix}/` : ''}page-`;
  const initialJsFiles = new Set();

  for (const moduleEntry of Object.values(manifest.clientModules ?? {})) {
    const chunks = Array.isArray(moduleEntry?.chunks) ? moduleEntry.chunks : [];
    if (!chunks.some(chunk => typeof chunk === 'string' && chunk.startsWith(pageChunkPrefix))) continue;
    for (const chunk of chunks) if (typeof chunk === 'string' && chunk.endsWith('.js')) initialJsFiles.add(chunk);
  }

  const cssFiles = new Set();
  const routeWithoutPage = route.replace(/\/page$/, '');
  for (const [entryKey, entries] of Object.entries(manifest.entryCSSFiles ?? {})) {
    const sourcePrefix = routeSourcePrefix(entryKey);
    if (sourcePrefix === null) continue;
    const belongs = sourcePrefix === '' || routeWithoutPage === sourcePrefix || routeWithoutPage.startsWith(`${sourcePrefix}/`);
    if (!belongs) continue;
    for (const entry of entries ?? []) if (typeof entry?.path === 'string') cssFiles.add(entry.path);
  }

  const js = [...initialJsFiles].sort();
  const css = [...cssFiles].sort();
  return {
    route: routeWithoutPage || '/',
    initialJsFiles: js,
    initialJsBytes: js.reduce((sum, file) => sum + assetBytes(nextDir, file), 0),
    cssFiles: css,
    cssBytes: css.reduce((sum, file) => sum + assetBytes(nextDir, file), 0),
    measured: js.some(file => file.startsWith(pageChunkPrefix)),
  };
}

export function collectAppRouteBundles(nextDir) {
  const serverApp = path.join(nextDir, 'server', 'app');
  return walk(serverApp)
    .map(file => extractAppRouteBundle(nextDir, fs.readFileSync(file, 'utf8')))
    .sort((left, right) => left.route.localeCompare(right.route));
}
