import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ACTION_PINS = new Map([
  ['actions/checkout', { sha: '11d5960a326750d5838078e36cf38b85af677262', label: 'v4' }],
  ['actions/setup-node', { sha: '49933ea5288caeca8642d1e84afbd3f7d6820020', label: 'v4' }],
  ['actions/upload-artifact', { sha: 'ea165f8d65b6e75b540449e92b4886f43607fa02', label: 'v4' }],
  ['actions/download-artifact', { sha: 'd3f86a106a0bac45b974a628896c90dbdf5c8093', label: 'v4' }],
  ['docker/setup-buildx-action', { sha: '8d2750c68a42422c14e847fe6c8ac0403b4cbd6f', label: 'v3' }],
  ['docker/login-action', { sha: 'c94ce9fb468520275223c153574b00df6fe4bcc9', label: 'v3' }],
  ['docker/build-push-action', { sha: '10e90e3645eae34f1e60eeb005ba3a3d33f178e8', label: 'v6' }],
  ['dtolnay/rust-toolchain', { sha: '4360b52568e2003a75bf9bc1d59f33a8e3fc893c', label: 'stable' }],
  ['Swatinem/rust-cache', { sha: '6323deb102c322ba6fcbdcafc7e3dddab59af2b6', label: 'v2' }],
  ['tauri-apps/tauri-action', { sha: '84b9d35b5fc46c1e45415bdb6144030364f7ebc5', label: 'v0' }],
  ['trufflesecurity/trufflehog', { sha: '3ab759fef4bb5935d4fe9ac68b503d05346b8364', label: 'main' }],
]);

const NODE_VERSION = '22.23.2';

const REMOTE_ACTION_PATTERN = /^(\s*(?:-\s*)?uses:\s*)([^\s@#]+)@([^\s#]+)(?:\s+#.*)?$/gm;

export function rewriteActionPins(source, file = '<workflow>') {
  const issues = [];
  let output = source.replace(REMOTE_ACTION_PATTERN, (line, prefix, action, ref, offset) => {
    if (action.startsWith('./') || action.startsWith('docker://')) return line;

    const pin = ACTION_PINS.get(action);
    if (!pin) {
      issues.push(`${file}:${source.slice(0, offset).split('\n').length}: unregistered action ${action}@${ref}`);
      return line;
    }

    const canonical = `${prefix}${action}@${pin.sha} # ${pin.label}`;
    if (ref !== pin.sha) {
      issues.push(`${file}:${source.slice(0, offset).split('\n').length}: ${action}@${ref} is not pinned to ${pin.sha}`);
    }
    return canonical;
  });

  output = output.replace(/^(\s*node-version:\s*)(['"]?)([^'"\s#]+)\2(?:\s+#.*)?$/gm, (line, prefix, quote, version, offset) => {
    if (version !== NODE_VERSION) {
      issues.push(`${file}:${source.slice(0, offset).split('\n').length}: Node ${version} is not pinned to ${NODE_VERSION}`);
    }
    return `${prefix}'${NODE_VERSION}'`;
  });

  return { output, issues };
}

export async function auditActionPins({ root, write = false }) {
  const workflowDir = path.join(root, '.github', 'workflows');
  const files = (await readdir(workflowDir))
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();
  const issues = [];
  let changed = 0;

  for (const name of files) {
    const fullPath = path.join(workflowDir, name);
    const source = await readFile(fullPath, 'utf8');
    const result = rewriteActionPins(source, `.github/workflows/${name}`);
    issues.push(...result.issues);
    if (write && result.output !== source) {
      await writeFile(fullPath, result.output, 'utf8');
      changed += 1;
    }
  }

  return { files: files.length, issues, changed };
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const root = path.resolve(path.dirname(scriptPath), '..', '..');
  const write = process.argv.includes('--write');
  const result = await auditActionPins({ root, write });

  if (write) {
    console.log(`Pinned GitHub Actions in ${result.changed} workflow file(s).`);
    return;
  }
  if (result.issues.length > 0) {
    console.error(result.issues.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Verified immutable GitHub Actions pins in ${result.files} workflow file(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
