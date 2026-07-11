#!/usr/bin/env node
/**
 * Retrieval smoke test — embeds a query with bge-m3, cosine-similarity
 * top-K over the local JSONL index (data/index/*.jsonl).
 *
 * Usage:  node query.mjs "retaining wall overturning safety factor" [-k 5]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedTexts, cosine } from './embed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, 'data', 'index');

const args = process.argv.slice(2);
const kIdx = args.indexOf('-k');
const K = kIdx >= 0 ? parseInt(args[kIdx + 1], 10) : 5;
const query = args.filter((a, i) => kIdx < 0 || (i !== kIdx && i !== kIdx + 1)).join(' ').trim();
if (!query) {
  console.error('usage: node query.mjs "your query" [-k 5]');
  process.exit(1);
}

if (!existsSync(INDEX_DIR)) {
  console.error('no index — run `node index.mjs` first');
  process.exit(1);
}

const files = readdirSync(INDEX_DIR).filter((f) => f.endsWith('.jsonl'));
const chunks = [];
for (const f of files) {
  for (const line of readFileSync(join(INDEX_DIR, f), 'utf8').split('\n')) {
    if (line.trim()) chunks.push(JSON.parse(line));
  }
}
console.log(`query: "${query}"  (index: ${files.length} docs, ${chunks.length} chunks)\n`);

const [qVec] = await embedTexts([query]);
const scored = chunks
  .map((c) => ({ c, score: cosine(qVec, c.embedding) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, K);

scored.forEach(({ c, score }, i) => {
  console.log(`#${i + 1}  score=${score.toFixed(4)}  ${c.docId}  p.${c.page}`);
  console.log(`    ${c.title}`);
  console.log(`    "${c.text.slice(0, 220).replace(/\s+/g, ' ')}…"\n`);
});
