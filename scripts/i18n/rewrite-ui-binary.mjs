import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const files = process.argv.slice(2);
const canonical = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let value = node.head.text;
  node.templateSpans.forEach((span, index) => { value += `{{${index}}}${span.literal.text}`; });
  return value;
};
for (const file of files) {
  let source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const replacements = [];
  const visit = (node) => {
    if (ts.isConditionalExpression(node)) {
      const condition = node.condition.getText(ast).replace(/\s/g, '');
      const isBinary = condition === 'ko' || condition === 'isKo' || condition === "lang==='ko'" || condition === 'lang==="ko"';
      const ko = canonical(node.whenTrue);
      const en = canonical(node.whenFalse);
      if (isBinary && ko !== null && en !== null && ko !== 'kr' && ko !== 'ko') {
        replacements.push({ start: node.getStart(ast), end: node.getEnd(), text: `L(${node.whenTrue.getText(ast)}, ${node.whenFalse.getText(ast)})` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
  writeFileSync(file, source, 'utf8');
  console.log(`${file}: ${replacements.length}`);
}
