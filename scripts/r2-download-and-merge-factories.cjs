#!/usr/bin/env node
/**
 * Run INSIDE the Railway container (`railway ssh` then node this).
 * 1) Downloads imports/factories-import.db from R2 to /tmp
 * 2) ATTACHes + INSERT OR IGNORE INTO nf_factories_directory on /app/data/nexyfab.db
 * 3) Prints before/after counts, deletes /tmp file, deletes R2 object
 */
const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const Database = require('better-sqlite3');

const KEY = 'imports/factories-import.db';
const TMP = '/tmp/factories-import.db';
const DB_PATH = process.env.NEXYFAB_DB_PATH || '/app/data/nexyfab.db';

const required = ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_BUCKET'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`missing env: ${k}`);
    process.exit(1);
  }
}

async function streamToFile(body, dst) {
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dst);
    body.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    body.pipe(ws);
  });
}

(async () => {
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  console.log(`fetching s3://${process.env.S3_BUCKET}/${KEY}`);
  const res = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: KEY }));
  await streamToFile(res.Body, TMP);
  const stat = fs.statSync(TMP);
  console.log(`downloaded ${(stat.size / 1024 / 1024).toFixed(1)} MB → ${TMP}`);

  console.log(`opening ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS nf_factories_directory (
      id INTEGER PRIMARY KEY,
      country TEXT NOT NULL,
      name TEXT NOT NULL,
      product TEXT,
      industry TEXT,
      address TEXT,
      search_text TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fdir_country ON nf_factories_directory(country);
    CREATE INDEX IF NOT EXISTS idx_fdir_industry ON nf_factories_directory(industry);
    CREATE INDEX IF NOT EXISTS idx_fdir_country_id ON nf_factories_directory(country, id);
  `);

  const before = db.prepare('SELECT COUNT(*) AS c FROM nf_factories_directory').get().c;
  console.log(`before: ${before.toLocaleString()} rows`);

  db.exec(`ATTACH DATABASE '${TMP}' AS src`);
  const info = db.prepare(`
    INSERT OR IGNORE INTO nf_factories_directory (id, country, name, product, industry, address, search_text, created_at)
    SELECT id, country, name, product, industry, address, search_text, created_at FROM src.nf_factories_directory
  `).run();
  db.exec('DETACH DATABASE src');

  const after = db.prepare('SELECT COUNT(*) AS c FROM nf_factories_directory').get().c;
  const byCountry = db.prepare('SELECT country, COUNT(*) AS c FROM nf_factories_directory GROUP BY country ORDER BY c DESC').all();

  console.log(`inserted: ${info.changes.toLocaleString()} (SQLite changes counter)`);
  console.log(`after: ${after.toLocaleString()} rows`);
  console.log('by country:', byCountry.map((r) => `${r.country}=${r.c}`).join(' '));

  db.close();
  fs.unlinkSync(TMP);
  console.log(`removed ${TMP}`);

  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: KEY }));
  console.log(`removed s3://${process.env.S3_BUCKET}/${KEY}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
