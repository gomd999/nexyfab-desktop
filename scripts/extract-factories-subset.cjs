#!/usr/bin/env node
/**
 * Extract nf_factories_directory table to a standalone SQLite file
 * for Railway upload.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SRC = path.join(__dirname, '..', 'nexyfab.db');
const DST = path.join(__dirname, '..', 'data', 'factories-import.db');

if (!fs.existsSync(SRC)) {
  console.error(`source not found: ${SRC}`);
  process.exit(1);
}
if (fs.existsSync(DST)) fs.unlinkSync(DST);

const src = new Database(SRC, { readonly: true });
const dst = new Database(DST);

dst.pragma('journal_mode = OFF');
dst.pragma('synchronous = OFF');

dst.exec(`
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

const rows = src.prepare(
  'SELECT id, country, name, product, industry, address, search_text, created_at FROM nf_factories_directory'
).all();
console.log(`read ${rows.length.toLocaleString()} rows`);

const ins = dst.prepare(
  `INSERT INTO nf_factories_directory (id, country, name, product, industry, address, search_text, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const tx = dst.transaction((chunk) => {
  for (const r of chunk) {
    ins.run(r.id, r.country, r.name, r.product, r.industry, r.address, r.search_text, r.created_at);
  }
});
tx(rows);

dst.exec('VACUUM');
dst.close();
src.close();

const stat = fs.statSync(DST);
console.log(`wrote ${DST} — ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
