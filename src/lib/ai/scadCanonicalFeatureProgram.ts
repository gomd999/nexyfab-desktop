export type ScadCanonicalStatus = 'pass' | 'not_run';

export type ScadCanonicalNode =
  | { id: string; op: 'box'; size: [number, number, number]; center: boolean }
  | { id: string; op: 'cylinder'; height: number; diameter: number; center: boolean; facets: number | null }
  | { id: string; op: 'spur_gear'; module: number; teeth: number; thickness: number; pressureAngle: number; facets: number | null }
  | { id: string; op: 'translate' | 'rotate'; vector: [number, number, number]; children: ScadCanonicalNode[] }
  | { id: string; op: 'union' | 'subtract' | 'intersect'; children: ScadCanonicalNode[] };

export interface ScadCanonicalFeatureProgram {
  schema: 'nexyfab.scad-canonical-feature-program.v1';
  definitionId: string;
  partNumber: string;
  sourceRef: string;
  status: ScadCanonicalStatus;
  bodyPolicy: 'single_body';
  material: null;
  process: null;
  root: ScadCanonicalNode | null;
  governingDimensions: Array<{ path: string; value: number; unit: 'mm' | 'deg' | 'count'; provenance: 'generated_scad' }>;
  unsupportedCodes: string[];
  unresolvedMetadata: string[];
  manufacturingReady: false;
}

type Token = { kind: 'id' | 'number' | 'punct'; value: string; offset: number };
class Unsupported extends Error { constructor(readonly code: string) { super(code); } }

function tokens(source: string): Token[] {
  const clean = source.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const result: Token[] = [];
  const re = /\s+|([A-Za-z_$][A-Za-z0-9_$]*)|(-?(?:\d+(?:\.\d*)?|\.\d+))|([{}()[\],;=])/gy;
  let cursor = 0;
  while (cursor < clean.length) {
    re.lastIndex = cursor;
    const match = re.exec(clean);
    if (!match) throw new Unsupported(`SCAD_FEATURE_TOKEN_UNSUPPORTED:${clean.slice(cursor, cursor + 16)}`);
    cursor = re.lastIndex;
    if (/^\s+$/.test(match[0])) continue;
    result.push({ kind: match[1] ? 'id' : match[2] ? 'number' : 'punct', value: match[1] ?? match[2] ?? match[3]!, offset: match.index });
  }
  return result;
}

class Parser {
  private at = 0;
  private serial = 0;
  constructor(private readonly input: Token[]) {}
  private peek(value?: string) { const token = this.input[this.at]; return value === undefined ? token : token?.value === value; }
  private take(value?: string) { const token = this.input[this.at]; if (!token || (value && token.value !== value)) throw new Unsupported(`SCAD_FEATURE_EXPECTED:${value ?? 'token'}`); this.at++; return token; }
  private id(prefix: string) { this.serial++; return `${prefix}:${this.serial}`; }
  private number() { const token = this.take(); if (token.kind !== 'number') throw new Unsupported('SCAD_FEATURE_LITERAL_NUMBER_REQUIRED'); return Number(token.value); }
  private vector(): [number, number, number] { this.take('['); const value: [number, number, number] = [this.number(), 0, 0]; this.take(','); value[1] = this.number(); this.take(','); value[2] = this.number(); this.take(']'); return value; }
  private args(): { positional: Array<number | boolean | [number, number, number]>; named: Record<string, number | boolean> } {
    const positional: Array<number | boolean | [number, number, number]> = []; const named: Record<string, number | boolean> = {};
    this.take('(');
    while (!this.peek(')')) {
      const current = this.input[this.at];
      if (!current) throw new Unsupported('SCAD_FEATURE_ARGUMENTS_UNCLOSED');
      if (current.kind === 'id' && this.input[this.at + 1]?.value === '=') {
        const key = this.take().value; this.take('='); const value = this.take();
        if (value.kind === 'number') named[key] = Number(value.value);
        else if (value.value === 'true' || value.value === 'false') named[key] = value.value === 'true';
        else throw new Unsupported(`SCAD_FEATURE_NAMED_LITERAL_REQUIRED:${key}`);
      } else if (this.peek('[')) positional.push(this.vector());
      else { const value = this.take(); if (value.kind === 'number') positional.push(Number(value.value)); else if (value.value === 'true' || value.value === 'false') positional.push(value.value === 'true'); else throw new Unsupported('SCAD_FEATURE_POSITIONAL_LITERAL_REQUIRED'); }
      if (this.peek(',')) this.take(','); else if (!this.peek(')')) throw new Unsupported('SCAD_FEATURE_ARGUMENT_SEPARATOR_REQUIRED');
    }
    this.take(')'); return { positional, named };
  }
  private children(): ScadCanonicalNode[] { this.take('{'); const out: ScadCanonicalNode[] = []; while (!this.peek('}')) out.push(this.statement()); this.take('}'); return out; }
  private statement(): ScadCanonicalNode {
    const name = this.take(); if (name.kind !== 'id') throw new Unsupported('SCAD_FEATURE_OPERATION_REQUIRED');
    const args = this.args();
    if (name.value === 'translate' || name.value === 'rotate') {
      const vector = args.positional[0]; if (!Array.isArray(vector)) throw new Unsupported(`SCAD_FEATURE_VECTOR_REQUIRED:${name.value}`);
      const children = this.peek('{') ? this.children() : [this.statement()];
      if (vector.every(value => Math.abs(value) < 1e-12)) return children.length === 1 ? children[0]! : { id: this.id('union'), op: 'union', children };
      return { id: this.id(name.value), op: name.value, vector, children };
    }
    if (name.value === 'union' || name.value === 'difference' || name.value === 'intersection') {
      const children = this.children(); if (!children.length) throw new Unsupported(`SCAD_FEATURE_BOOLEAN_EMPTY:${name.value}`);
      if (children.length === 1) return children[0]!;
      return { id: this.id(name.value), op: name.value === 'difference' ? 'subtract' : name.value === 'intersection' ? 'intersect' : 'union', children };
    }
    this.take(';');
    if (name.value === 'cube') {
      const size = args.positional[0]; if (!Array.isArray(size)) throw new Unsupported('SCAD_FEATURE_CUBE_VECTOR_REQUIRED');
      return { id: this.id('box'), op: 'box', size, center: Boolean(args.named.center ?? args.positional[1] ?? false) };
    }
    if (name.value === 'cylinder') {
      const height = Number(args.named.h ?? args.positional[0]); const diameter = Number(args.named.d);
      if (!(height > 0) || !(diameter > 0)) throw new Unsupported('SCAD_FEATURE_CYLINDER_DIMENSIONS_REQUIRED');
      return { id: this.id('cylinder'), op: 'cylinder', height, diameter, center: Boolean(args.named.center ?? false), facets: typeof args.named.$fn === 'number' ? args.named.$fn : null };
    }
    if (name.value === 'spur_gear') {
      const mod = Number(args.named.mod), teeth = Number(args.named.teeth), thickness = Number(args.named.thickness), pressureAngle = Number(args.named.pressure_angle);
      if (!(mod > 0) || !Number.isInteger(teeth) || teeth < 3 || !(thickness > 0) || !(pressureAngle > 0)) throw new Unsupported('SCAD_FEATURE_GEAR_DIMENSIONS_REQUIRED');
      return { id: this.id('spur_gear'), op: 'spur_gear', module: mod, teeth, thickness, pressureAngle, facets: typeof args.named.$fn === 'number' ? args.named.$fn : null };
    }
    throw new Unsupported(`SCAD_FEATURE_OPERATION_UNSUPPORTED:${name.value}`);
  }
  parseModule(): ScadCanonicalNode {
    if (this.peek('module')) { this.take('module'); this.take(); this.take('('); this.take(')'); this.take('{'); const children: ScadCanonicalNode[] = []; while (!this.peek('}')) children.push(this.statement()); this.take('}'); if (this.peek()) throw new Unsupported('SCAD_FEATURE_TRAILING_TOKENS'); if (children.length !== 1) return { id: this.id('union'), op: 'union', children }; return children[0]!; }
    const value = this.statement(); if (this.peek()) throw new Unsupported('SCAD_FEATURE_TRAILING_TOKENS'); return value;
  }
}

function dimensions(root: ScadCanonicalNode): ScadCanonicalFeatureProgram['governingDimensions'] {
  const out: ScadCanonicalFeatureProgram['governingDimensions'] = [];
  const add = (path: string, value: number, unit: 'mm' | 'deg' | 'count') => out.push({ path, value, unit, provenance: 'generated_scad' });
  const walk = (node: ScadCanonicalNode, path: string) => {
    if (node.op === 'box') node.size.forEach((value, index) => add(`${path}.size[${index}]`, value, 'mm'));
    else if (node.op === 'cylinder') { add(`${path}.height`, node.height, 'mm'); add(`${path}.diameter`, node.diameter, 'mm'); }
    else if (node.op === 'spur_gear') { add(`${path}.module`, node.module, 'mm'); add(`${path}.teeth`, node.teeth, 'count'); add(`${path}.thickness`, node.thickness, 'mm'); add(`${path}.pressureAngle`, node.pressureAngle, 'deg'); }
    else { if (node.op === 'translate') node.vector.forEach((value, index) => add(`${path}.translate[${index}]`, value, 'mm')); if (node.op === 'rotate') node.vector.forEach((value, index) => add(`${path}.rotate[${index}]`, value, 'deg')); node.children.forEach((child, index) => walk(child, `${path}.children[${index}]`)); }
  };
  walk(root, 'root'); return out;
}

export function convertScadDefinitionToCanonical(input: { definitionId: string; moduleSource: string; sourceRef: string; partNumber?: string }): ScadCanonicalFeatureProgram {
  const base = { schema: 'nexyfab.scad-canonical-feature-program.v1' as const, definitionId: input.definitionId, partNumber: input.partNumber?.trim() || input.definitionId.replace(/[^A-Za-z0-9_-]/g, '_'), sourceRef: input.sourceRef, bodyPolicy: 'single_body' as const, material: null, process: null, unresolvedMetadata: ['material', 'process'], manufacturingReady: false as const };
  try {
    const root = new Parser(tokens(input.moduleSource)).parseModule();
    const governingDimensions = dimensions(root);
    // A cutter longer than its host is construction clearance, not a product
    // dimension recoverable from the final B-rep.
    const filtered = root.op === 'subtract' && root.children[0]?.op === 'spur_gear' && root.children[1]?.op === 'cylinder'
      ? governingDimensions.filter(item => item.path !== 'root.children[1].height') : governingDimensions;
    return { ...base, status: 'pass', root, governingDimensions: filtered, unsupportedCodes: [] };
  }
  catch (error) { const code = error instanceof Unsupported ? error.code : 'SCAD_FEATURE_PARSE_FAILED'; return { ...base, status: 'not_run', root: null, governingDimensions: [], unsupportedCodes: [code] }; }
}
