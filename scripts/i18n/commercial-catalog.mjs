import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export const COMMERCIAL_ROOT = 'src/app/[lang]/nexyfab';
export const COMMERCIAL_ROOTS = [
  COMMERCIAL_ROOT,
  'src/app/[lang]/studio',
  'src/app/admin',
  'src/app/adminlink',
  'src/app/(auth)',
  'src/app/portal',
  'src/app/quote-respond',
  'src/app/unsubscribe',
  'src/app/components',
  'src/app/legal',
];
const PAIR_KEYS = [
  ['ko', 'en'],
  ['labelKo', 'labelEn'],
  ['titleKo', 'titleEn'],
  ['descKo', 'descEn'],
  ['nameKo', 'nameEn'],
  ['priceKo', 'priceEn'],
  ['labelKo', 'label'],
  ['pKo', 'pEn'],
];

function filesBelow(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...filesBelow(path));
    else if (/\.(?:ts|tsx)$/.test(entry) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) files.push(path);
  }
  return files;
}

function canonical(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let value = node.head.text;
  node.templateSpans.forEach((span, index) => { value += `{{${index}}}${span.literal.text}`; });
  return value;
}

function propertyMap(node) {
  const map = new Map();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? property.name.text
      : null;
    if (name) map.set(name, property.initializer);
  }
  return map;
}

function expressionOf(node) {
  if (ts.isArrowFunction(node)) return ts.isBlock(node.body) ? null : node.body;
  if (ts.isFunctionExpression(node)) {
    const statement = node.body.statements.find(ts.isReturnStatement);
    return statement?.expression ?? null;
  }
  return node;
}

function sourceFiles(roots) {
  return (Array.isArray(roots) ? roots : [roots]).flatMap(filesBelow);
}

export function extractCommercialPairs(roots = COMMERCIAL_ROOTS) {
  const pairs = new Map();
  for (const file of sourceFiles(roots)) {
    const source = readFileSync(file, 'utf8');
    if (!/create(?:Commercial|Studio)Localizer/.test(source)) continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const add = (koNode, enNode) => {
      const ko = canonical(expressionOf(koNode));
      const en = canonical(expressionOf(enNode));
      if (ko !== null && en !== null && en.length > 0 && !pairs.has(en)) {
        pairs.set(en, { ko, en, file: relative(process.cwd(), file).replaceAll('\\', '/') });
      }
    };
    const addDictionary = (koNode, enNode) => {
      if (ts.isObjectLiteralExpression(koNode) && ts.isObjectLiteralExpression(enNode)) {
        const koProps = propertyMap(koNode);
        const enProps = propertyMap(enNode);
        for (const [key, enValue] of enProps) {
          const koValue = koProps.get(key);
          if (koValue) addDictionary(koValue, enValue);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(koNode) && ts.isArrayLiteralExpression(enNode)) {
        enNode.elements.forEach((enValue, index) => {
          const koValue = koNode.elements[index];
          if (koValue) addDictionary(koValue, enValue);
        });
        return;
      }
      add(koNode, enNode);
    };
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['L', 'T'].includes(node.expression.text) && node.arguments.length >= 2) {
        add(node.arguments[0], node.arguments[1]);
      }
      if (ts.isObjectLiteralExpression(node)) {
        const props = propertyMap(node);
        if (props.has('ko') && props.has('en')) addDictionary(props.get('ko'), props.get('en'));
        for (const [koKey, enKey] of PAIR_KEYS) {
          if (props.has(koKey) && props.has(enKey)) add(props.get(koKey), props.get(enKey));
        }
      }
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'AdminText') {
        const attrs = new Map(node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => [attribute.name.getText(ast), attribute.initializer]));
        const valueNode = (initializer) => ts.isJsxExpression(initializer) ? initializer.expression : initializer;
        const ko = valueNode(attrs.get('ko'));
        const en = valueNode(attrs.get('en'));
        if (ko && en) add(ko, en);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return [...pairs.values()];
}

export function qualifyCommercialCatalog(catalog, roots = COMMERCIAL_ROOTS) {
  const pairs = extractCommercialPairs(roots);
  const missing = [];
  const invalid = [];
  const legacyBilingualLiterals = [];
  for (const pair of pairs) {
    const translation = catalog[pair.en];
    if (!translation) {
      missing.push(pair);
      continue;
    }
    const placeholders = pair.en.match(/\{\{\d+\}\}/g) ?? [];
    for (const locale of ['ja', 'zh', 'es', 'ar']) {
      if (typeof translation[locale] !== 'string' || translation[locale].trim() === '') {
        invalid.push({ ...pair, locale, reason: 'empty' });
      } else if (placeholders.some((placeholder) => !translation[locale].includes(placeholder))) {
        invalid.push({ ...pair, locale, reason: 'placeholder' });
      }
    }
  }
  for (const file of sourceFiles(roots)) {
    const source = readFileSync(file, 'utf8');
    if (!/create(?:Commercial|Studio)Localizer/.test(source)) continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isConditionalExpression(node) && ['isKo', 'ko'].includes(node.condition.getText(ast))) {
        if (canonical(node.whenTrue) !== null && canonical(node.whenFalse) !== null) {
          legacyBilingualLiterals.push({
            file: relative(process.cwd(), file).replaceAll('\\', '/'),
            line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return {
    ok: missing.length === 0 && invalid.length === 0 && legacyBilingualLiterals.length === 0,
    pairs, missing, invalid, legacyBilingualLiterals,
  };
}
