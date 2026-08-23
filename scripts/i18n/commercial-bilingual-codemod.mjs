#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

export const COMMERCIAL_BILINGUAL_TARGETS = [
  'src/app/[lang]/nexyfab/NexyfabLandingClient.tsx',
  'src/app/[lang]/nexyfab/billing/page.tsx',
  'src/app/[lang]/nexyfab/dashboard/page.tsx',
  'src/app/[lang]/nexyfab/orders/page.tsx',
  'src/app/[lang]/nexyfab/rfq/page.tsx',
  'src/app/[lang]/nexyfab/team/page.tsx',
  'src/app/[lang]/nexyfab/manufacturer/dashboard/page.tsx',
  'src/app/[lang]/nexyfab/manufacturer/page.tsx',
  'src/app/[lang]/nexyfab/manufacturers/[id]/page.tsx',
  'src/app/[lang]/nexyfab/marketplace/MarketplaceClient.tsx',
  'src/app/[lang]/nexyfab/design/FabPanel.tsx',
];

function canonical(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let value = node.head.text;
  node.templateSpans.forEach((span, index) => { value += `{{${index}}}${span.literal.text}`; });
  return value;
}

export function extractPairs(file) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pairs = [];
  const visit = (node) => {
    if (ts.isConditionalExpression(node) && ['isKo', 'ko'].includes(node.condition.getText(ast))) {
      const ko = canonical(node.whenTrue);
      const en = canonical(node.whenFalse);
      if (ko !== null && en !== null) pairs.push({ ko, en, file });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return pairs;
}

export function rewriteFile(file) {
  let source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const replacements = [];
  const visit = (node) => {
    if (ts.isConditionalExpression(node) && ['isKo', 'ko'].includes(node.condition.getText(ast))) {
      const ko = canonical(node.whenTrue);
      const en = canonical(node.whenFalse);
      if (ko !== null && en !== null) {
        replacements.push({
          start: node.getStart(ast), end: node.getEnd(),
          text: `L(${node.whenTrue.getText(ast)}, ${node.whenFalse.getText(ast)})`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
  }
  if (replacements.length > 0 && !source.includes("from '@/lib/i18n/commercialLocalizer'")) {
    const imports = Array.from(source.matchAll(/^import .*;\r?$/gm));
    const last = imports.at(-1);
    if (!last) throw new Error(`${file}: cannot find import insertion point`);
    const end = last.index + last[0].length;
    source = source.slice(0, end) + "\nimport { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';" + source.slice(end);
  }
  if (replacements.length > 0 && !/const L = createCommercialLocalizer\(/.test(source)) {
    const match = /const isKo\s*=\s*[^;]+;/.exec(source);
    if (!match) throw new Error(`${file}: cannot find isKo declaration`);
    const end = match.index + match[0].length;
    const langArg = /isKorean\(([^)]+)\)/.exec(match[0])?.[1] ?? 'lang';
    source = source.slice(0, end) + `\n  const L = createCommercialLocalizer(${langArg});` + source.slice(end);
  }
  writeFileSync(file, source, 'utf8');
  return replacements.length;
}

const mode = process.argv[2] ?? '--extract';
if (mode === '--extract') {
  const byEnglish = new Map();
  for (const file of COMMERCIAL_BILINGUAL_TARGETS) {
    for (const pair of extractPairs(file)) if (!byEnglish.has(pair.en)) byEnglish.set(pair.en, pair);
  }
  process.stdout.write(`${JSON.stringify(Array.from(byEnglish.values()), null, 2)}\n`);
} else if (mode === '--rewrite') {
  let total = 0;
  for (const file of COMMERCIAL_BILINGUAL_TARGETS) {
    const count = rewriteFile(file);
    console.log(`${file}: ${count} bilingual literals rewritten`);
    total += count;
  }
  console.log(`total: ${total}`);
} else {
  throw new Error(`unknown mode ${mode}`);
}
