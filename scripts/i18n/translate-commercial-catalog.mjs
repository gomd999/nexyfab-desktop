#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractCommercialPairs } from './commercial-catalog.mjs';

function readEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

const env = { ...readEnv(resolve(process.cwd(), '..', '..', '.env')), ...process.env };
const apiKey = env.NEXYFAB_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('DeepSeek key is not configured');
const outputPath = 'src/lib/i18n/commercialTranslations.generated.json';
const catalog = JSON.parse(readFileSync(outputPath, 'utf8'));
const pairs = extractCommercialPairs().filter((pair) => !catalog[pair.en]);
const chunkSize = 20;

for (let offset = 0; offset < pairs.length; offset += chunkSize) {
  const batch = pairs.slice(offset, offset + chunkSize).map((pair, index) => ({ id: offset + index, ko: pair.ko, en: pair.en }));
  const response = await fetch(`${(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat', temperature: 0.1, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a professional CAD/manufacturing software localizer. Translate UI strings accurately into Japanese, Simplified Chinese, Spanish, and Arabic. Preserve NexyFab, CAD, DFM, FEA, STEP, STL, DXF, BOM, RFQ, API, GD&T, file extensions, symbols, HTML-like tokens, and every {{number}} placeholder exactly. Return strict valid JSON: {"items":[{"id":number,"ja":string,"zh":string,"es":string,"ar":string}]}. Never place ASCII double-quote characters inside a translated string; use language-appropriate typographic quotation marks instead. No commentary.' },
        { role: 'user', content: JSON.stringify({ items: batch }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek translation failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);
  for (const item of parsed.items ?? []) {
    const source = pairs[item.id];
    if (!source || !item.ja || !item.zh || !item.es || !item.ar) throw new Error(`invalid translation item ${item.id}`);
    const placeholders = source.en.match(/\{\{\d+\}\}/g) ?? [];
    for (const locale of ['ja', 'zh', 'es', 'ar']) {
      for (const placeholder of placeholders) if (!String(item[locale]).includes(placeholder)) throw new Error(`${locale} lost ${placeholder}: ${source.en}`);
    }
    catalog[source.en] = { ja: item.ja, zh: item.zh, es: item.es, ar: item.ar };
  }
  // Checkpoint every batch so a transient API failure does not discard completed work.
  writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`translated ${Math.min(offset + chunkSize, pairs.length)}/${pairs.length}`);
}

writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`wrote ${Object.keys(catalog).length} translations (${pairs.length} added)`);
