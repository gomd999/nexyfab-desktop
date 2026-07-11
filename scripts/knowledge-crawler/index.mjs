#!/usr/bin/env node
/**
 * Wave 1 RAG indexer — extracts text per page from crawled PDFs, chunks
 * (~1000 chars, 150 overlap, page-number preserving), embeds with
 * Cloudflare Workers AI @cf/baai/bge-m3 and writes a local JSONL index.
 *
 * Provenance gate (plan §2): a PDF is only indexed if its sidecar
 * <id>.meta.json exists and carries a concrete license — no provenance, no ingest.
 *
 * Usage:  node index.mjs [--only id1,id2] [--force]
 * Output: data/index/<docId>.jsonl  — one line per chunk:
 *         {docId,title,page,chunkId,text,embedding,license,tags}
 *         data/index/_manifest.json — per-doc stats
 *
 * TODO (Wave 2): upload vectors to Cloudflare Vectorize + originals to
 * R2 /knowledge/{usgov|kds|papers|examples}/ with license metadata in D1,
 * then serve retrieval from a Worker. Wave 1 is deliberately local-only.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { embedTexts } from './embed.mjs';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const INDEX_DIR = join(DATA_DIR, 'index');

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const onlyArg = args.find((a) => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.split('=')[1] ?? args[args.indexOf(onlyArg) + 1] ?? '').split(',').filter(Boolean) : null;

/** Extract text page-by-page. Returns [{page, text}]. */
async function extractPages(buf) {
  const pages = [];
  await pdfParse(buf, {
    pagerender(pageData) {
      return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }).then((tc) => {
        const text = tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
        pages.push(text);
        return text;
      });
    },
  });
  return pages.map((text, i) => ({ page: i + 1, text }));
}

/** Chunk concatenated page text, keeping the page number where each chunk starts. */
function chunkPages(pages) {
  // Build one string with per-page start offsets.
  let full = '';
  const offsets = []; // {start, page}
  for (const p of pages) {
    offsets.push({ start: full.length, page: p.page });
    full += p.text + '\n';
  }
  const pageAt = (pos) => {
    let pg = offsets[0]?.page ?? 1;
    for (const o of offsets) {
      if (o.start <= pos) pg = o.page;
      else break;
    }
    return pg;
  };
  const chunks = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let start = 0; start < full.length; start += step) {
    let end = Math.min(start + CHUNK_SIZE, full.length);
    // try to break on whitespace to avoid cutting words
    if (end < full.length) {
      const ws = full.lastIndexOf(' ', end);
      if (ws > start + CHUNK_SIZE * 0.6) end = ws;
    }
    const text = full.slice(start, end).trim();
    if (text.length >= 80) chunks.push({ page: pageAt(start), text }); // skip near-empty slivers
    if (end >= full.length) break;
  }
  return chunks;
}

async function main() {
  mkdirSync(INDEX_DIR, { recursive: true });
  const pdfs = readdirSync(DATA_DIR).filter((f) => f.endsWith('.pdf'));
  if (pdfs.length === 0) {
    console.error('no PDFs in data/ — run `node crawl.mjs` first');
    process.exit(1);
  }
  const manifest = existsSync(join(INDEX_DIR, '_manifest.json'))
    ? JSON.parse(readFileSync(join(INDEX_DIR, '_manifest.json'), 'utf8'))
    : { model: '@cf/baai/bge-m3', dims: 1024, chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP, docs: {} };

  for (const pdfFile of pdfs) {
    const docId = basename(pdfFile, '.pdf');
    if (ONLY && !ONLY.includes(docId)) continue;
    const outPath = join(INDEX_DIR, `${docId}.jsonl`);
    if (existsSync(outPath) && !FORCE) {
      console.log(`[${docId}] SKIP — already indexed (use --force to re-index)`);
      continue;
    }
    const metaPath = join(DATA_DIR, `${docId}.meta.json`);
    if (!existsSync(metaPath)) {
      console.error(`[${docId}] REFUSED — no sidecar meta.json (plan §2: provenance 없는 문서는 반입 금지)`);
      process.exitCode = 1;
      continue;
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (!meta.license || meta.license === 'MANUAL-VERIFY-REQUIRED') {
      console.error(`[${docId}] REFUSED — license not cleared (${meta.license})`);
      process.exitCode = 1;
      continue;
    }

    console.log(`[${docId}] extracting…`);
    const buf = readFileSync(join(DATA_DIR, pdfFile));
    let pages;
    try {
      pages = await extractPages(buf);
    } catch (e) {
      console.error(`[${docId}] PDF parse failed: ${e.message}`);
      process.exitCode = 1;
      continue;
    }
    const nonEmpty = pages.filter((p) => p.text.length > 0).length;
    const chunks = chunkPages(pages);
    console.log(`[${docId}] ${pages.length} pages (${nonEmpty} with text) -> ${chunks.length} chunks; embedding…`);
    if (chunks.length === 0) {
      console.warn(`[${docId}] no extractable text (scanned PDF?) — skipping, flag for OCR in Wave 2`);
      manifest.docs[docId] = { title: meta.title, pages: pages.length, chunks: 0, note: 'no-text-ocr-needed' };
      continue;
    }
    const embeddings = await embedTexts(chunks.map((c) => c.text));
    const lines = chunks.map((c, i) =>
      JSON.stringify({
        docId,
        title: meta.title,
        page: c.page,
        chunkId: `${docId}#${i}`,
        text: c.text,
        embedding: embeddings[i],
        license: meta.license,
        sourceUrl: meta.sourceUrl,
        tags: meta.tags ?? [],
      }),
    );
    writeFileSync(outPath, lines.join('\n') + '\n');
    manifest.docs[docId] = {
      title: meta.title,
      license: meta.license,
      pages: pages.length,
      chunks: chunks.length,
      indexedAt: new Date().toISOString(),
    };
    writeFileSync(join(INDEX_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`[${docId}] indexed -> ${outPath}`);
  }

  const totals = Object.values(manifest.docs).reduce(
    (a, d) => ({ docs: a.docs + 1, pages: a.pages + (d.pages || 0), chunks: a.chunks + (d.chunks || 0) }),
    { docs: 0, pages: 0, chunks: 0 },
  );
  console.log(`\nindex totals: ${totals.docs} docs, ${totals.pages} pages, ${totals.chunks} chunks`);
}

main();
