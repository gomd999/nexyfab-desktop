#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = process.cwd();
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dbPath = path.resolve(root, valueAfter('--db', 'nexyfab.db'));
const outputPath = path.resolve(
  root,
  valueAfter('--out', `validation-reports/closed-beta-integrity-${Date.now()}.json`),
);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const tableNames = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).all().map((row) => String(row.name));

const protectedTablePatterns = [
  /^nf_users$/,
  /^nf_(projects|files|documents|document_permissions|document_versions|document_locks|shares|comments)$/,
  /^nf_(workspaces|workspace_members)$/,
  /^nf_(rfqs|quotes|contracts|orders)$/,
  /^nf_(factories|partner_tokens|partner_sessions|partner_invites)$/,
  /^nf_(orgs|org_members|teams|team_members)$/,
  /^nf_(audit_log|thread_messages)$/,
  /^partner_applications$/,
];
const protectedTables = tableNames.filter((name) => protectedTablePatterns.some((re) => re.test(name)));

function tableSnapshot(table) {
  const safeTable = `"${table.replaceAll('"', '""')}"`;
  const columns = db.prepare(`PRAGMA table_info(${safeTable})`).all().map((row) => String(row.name));
  const hasId = columns.includes('id');
  const orderBy = hasId ? ' ORDER BY id' : '';
  const digest = crypto.createHash('sha256');
  let rowCount = 0;
  for (const row of db.prepare(`SELECT * FROM ${safeTable}${orderBy}`).iterate()) {
    const canonical = columns.map((column) => [column, row[column] ?? null]);
    digest.update(JSON.stringify(canonical));
    digest.update('\n');
    rowCount += 1;
  }
  return { rowCount, columns, contentSha256: digest.digest('hex') };
}

function walkFiles(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  const result = [];
  const pending = [baseDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) result.push(fullPath);
    }
  }
  return result.sort((a, b) => a.localeCompare(b));
}

// Public legacy uploads and the newer authenticated local-storage namespace
// are both user content.  The latter used to be absent from the integrity
// snapshot, which meant a local Closed Beta CAD file could change without the
// pre/post gate noticing it.
const fileRoots = ['public/uploads', 'data/uploads', 'data/private-storage'];
const files = [];
for (const relativeRoot of fileRoots) {
  const absoluteRoot = path.join(root, relativeRoot);
  for (const fullPath of walkFiles(absoluteRoot)) {
    const relativePath = path.relative(root, fullPath).replaceAll('\\', '/');
    const content = fs.readFileSync(fullPath);
    files.push({
      relativePath,
      pathSha256: sha256(relativePath),
      size: content.length,
      contentSha256: sha256(content),
    });
  }
}

const tables = Object.fromEntries(protectedTables.map((table) => [table, tableSnapshot(table)]));
const snapshot = {
  schemaVersion: 2,
  createdAt: new Date().toISOString(),
  source: {
    databasePathSha256: sha256(path.relative(root, dbPath).replaceAll('\\', '/')),
    databaseBytes: fs.statSync(dbPath).size,
    readonly: true,
    protectedFileRoots: fileRoots,
  },
  tables,
  files,
  summary: {
    protectedTableCount: protectedTables.length,
    protectedRowCount: Object.values(tables).reduce((sum, table) => sum + table.rowCount, 0),
    fileCount: files.length,
    fileBytes: files.reduce((sum, file) => sum + file.size, 0),
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
db.close();

console.log(JSON.stringify({
  ok: true,
  output: path.relative(root, outputPath).replaceAll('\\', '/'),
  ...snapshot.summary,
}));
