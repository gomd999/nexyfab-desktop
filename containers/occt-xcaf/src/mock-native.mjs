import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('occt-xcaf-inspect/1\n');
  process.exit(0);
}
const input = args[args.indexOf('--input') + 1];
const expected = args[args.indexOf('--expected-sha256') + 1];
const mode = process.env.MOCK_XCAF_MODE ?? 'pass';
if (mode === 'timeout') setInterval(() => {}, 1000);
if (mode === 'exit') { process.stderr.write('mock failure\n'); process.exit(9); }
if (mode === 'malformed') { process.stdout.write('{broken\n'); process.exit(0); }
const actual = createHash('sha256').update(readFileSync(input)).digest('hex');
const inputSha256 = mode === 'wrong-hash' ? '0'.repeat(64) : actual;
if (expected !== actual) process.exit(8);
process.stdout.write(JSON.stringify({
  schema: 'nexyfab.occt-xcaf.inspect.v1',
  status: 'PASS_NATIVE',
  inputSha256,
  unit: 'MM',
  productIdentitySource: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool',
  products: [{ entry: '0:1', role: 'product', name: 'mock-part', partNumber: 'MOCK-001', label: '0:1', transform: { matrix3x3: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 0] }, color: null, shape: { solidCount: 1, shellCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 1000, bboxMm: [0, 0, 0, 10, 10, 10] } }],
}) + '\n');
