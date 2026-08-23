import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMechanicalSinglePartCandidates,
  type MechanicalSinglePartCandidatePaths,
  type MechanicalSinglePartExactInspector,
} from './build-mechanical-single-part-candidates';

const roots: string[] = [];
const sha256 = (bytes: Uint8Array | string) => crypto.createHash('sha256').update(bytes).digest('hex');
const render = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const generatedAt = '2026-08-13T00:00:00.000Z';
const designRevisionSha256 = 'a'.repeat(64);
const views = {
  front: { visible: ['M 0 0 L 1 1'], hidden: [], viewBox: '0 0 1 1' },
  top: { visible: ['M 0 0 L 1 0'], hidden: [], viewBox: '0 0 1 1' },
  right: { visible: ['M 0 0 L 0 1'], hidden: [], viewBox: '0 0 1 1' },
};
const svg = '<svg>fixture-three-axis-hlr</svg>\n';
const boundsMm: [[number, number, number], [number, number, number]] = [[-2, -3, -4], [3, 5, 7]];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-single-part-'));
  roots.push(root);
  const paths: MechanicalSinglePartCandidatePaths = {
    sourceReceipt: 'source.json',
    outputRoot: 'output',
    outputReceipt: 'output/receipt.json',
    outputReceiptSha256: 'output/receipt.sha256',
    verifierSources: [],
    verifierTests: [],
  };
  const bindings = new Map<string, { path: string; sha256: string; bytes: number; assertionId: string }>();
  const artifact = (name: string, content: string, assertionId: string) => {
    const relative = `artifacts/${name}`;
    const bytes = Buffer.from(content);
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), bytes);
    const item = { path: relative, sha256: sha256(bytes), bytes: bytes.byteLength, assertionId };
    bindings.set(assertionId, item);
    return item;
  };
  const nfab = artifact('saved-project.nfab', render({
    magic: 'nfab', version: 3, createdAt: 1, updatedAt: 2, name: 'Hole fixture',
    tree: {
      rootId: 'root', activeNodeId: 'feature',
      nodes: [
        { id: 'root', type: 'baseShape' },
        { id: 'feature', type: 'feature', featureType: 'hole' },
      ],
    },
    scene: { selectedId: 'box' },
  }), 'hole.save_reopen.saved-bytes');
  const step = artifact(
    'hole.step',
    'ISO-10303-21;\nDATA;\n#1=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));\nENDSEC;\nEND-ISO-10303-21;\n',
    'hole.export.native-step',
  );
  const exportReport = artifact('export.json', render({
    schema: 'nexyfab.mechanical-core-feature-local-runtime.v1',
    feature: 'hole', axis: 'export', status: 'PASS',
    stepBytes: step.bytes, stepSha256: step.sha256,
    after: { solidCount: 1, singleSolid: true, volumeMm3: 440, boundsMm },
  }), 'hole.export.step-reimport');
  const sourceSvg = artifact('hole.svg', svg, 'hole.drawing.exact-hlr-svg');
  const drawingReport = artifact('drawing.json', render({
    schema: 'nexyfab.mechanical-core-feature-local-runtime.v1',
    feature: 'hole', axis: 'drawing', status: 'PASS',
    views: Object.fromEntries(Object.entries(views).map(([name, view]) => [name, {
      visible: view.visible.length, hidden: view.hidden.length, viewBox: view.viewBox,
    }])),
    svgBytes: sourceSvg.bytes,
    svgSha256: sourceSvg.sha256,
  }), 'hole.drawing.three-view-hlr');
  const generic = (axis: string) => artifact(`${axis}.json`, '{}\n', `hole.${axis}.fixture`);
  const runs = [
    { feature: 'hole', axis: 'create', status: 'PASS', evidence: [generic('create')] },
    { feature: 'hole', axis: 'edit', status: 'PASS', evidence: [generic('edit')] },
    { feature: 'hole', axis: 'regenerate', status: 'PASS', evidence: [generic('regenerate')] },
    { feature: 'hole', axis: 'save_reopen', status: 'PASS', evidence: [nfab] },
    { feature: 'hole', axis: 'undo', status: 'PASS', evidence: [generic('undo')] },
    { feature: 'hole', axis: 'export', status: 'PASS', evidence: [step, exportReport] },
    { feature: 'hole', axis: 'drawing', status: 'PASS', evidence: [sourceSvg, drawingReport] },
    { feature: 'thread', axis: 'create', status: 'NOT_RUN', evidence: [generic('thread-create')] },
  ];
  const source = render({
    schema: 'nexyfab.mechanical-core-feature-local-axis-evidence.v1',
    generatedAt,
    designRevisionSha256,
    runs,
  });
  fs.writeFileSync(path.join(root, paths.sourceReceipt), source);
  const inspector: MechanicalSinglePartExactInspector = {
    async inspect() {
      return {
        unit: 'mm', unitConfidence: 'high', solidCount: 1, singleSolid: true,
        volumeMm3: 440, boundsMm, views, svg,
      };
    },
  };
  return { root, paths, inspector, bindings, source };
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop()!;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('mechanical single-part candidate runner', () => {
  it('writes a revision-bound one-part candidate and leaves unsupported features NOT_RUN', async () => {
    const f = fixture();
    const result = await buildMechanicalSinglePartCandidates(f.root, f.paths, { write: true }, f.inspector);
    expect(result.receipt.summary).toEqual({
      featuresAssessed: 2, candidatePass: 1, notRun: 1, manufacturingReleaseEligible: 0,
    });
    expect(result.receipt.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ feature: 'hole', candidateStatus: 'PASS' }),
      expect.objectContaining({ feature: 'thread', candidateStatus: 'NOT_RUN' }),
    ]));
    const bom = JSON.parse(fs.readFileSync(path.join(f.root, 'output/hole/bom.json'), 'utf8'));
    expect(bom.items).toEqual([expect.objectContaining({ quantity: 1, dimensionsMm: { x: 5, y: 8, z: 11 } })]);
    const candidate = JSON.parse(fs.readFileSync(path.join(f.root, 'output/hole/candidate.json'), 'utf8'));
    expect(candidate.capabilityStatus).toMatchObject({
      drawingDimensions: 'NOT_RUN', gdt: 'NOT_RUN', pmi: 'NOT_RUN',
      humanApproval: 'NOT_RUN', manufacturingRelease: 'BLOCKED',
    });
  });

  it('does not promote a PASS-axis feature when an artifact hash is tampered', async () => {
    const f = fixture();
    const step = f.bindings.get('hole.export.native-step')!;
    fs.appendFileSync(path.join(f.root, step.path), 'TAMPER');
    const result = await buildMechanicalSinglePartCandidates(f.root, f.paths, {}, f.inspector);
    expect(result.receipt.records[0]).toMatchObject({
      feature: 'hole', candidateStatus: 'NOT_RUN',
    });
    expect(result.receipt.records[0]!.reasons[0]).toContain('source_binding_hash_mismatch');
  });

  it('check-only recomputes and rejects stale generated candidate bytes', async () => {
    const f = fixture();
    await buildMechanicalSinglePartCandidates(f.root, f.paths, { write: true }, f.inspector);
    await expect(buildMechanicalSinglePartCandidates(
      f.root, f.paths, { checkExisting: true }, f.inspector,
    )).resolves.toBeDefined();
    fs.appendFileSync(path.join(f.root, 'output/hole/bom.json'), 'TAMPER');
    await expect(buildMechanicalSinglePartCandidates(
      f.root, f.paths, { checkExisting: true }, f.inspector,
    )).rejects.toThrow('SINGLE_PART_OUTPUT_STALE:output/hole/bom.json');
  });

  it('does not promote a PASS-axis feature when required evidence is missing', async () => {
    const f = fixture();
    const drawing = f.bindings.get('hole.drawing.exact-hlr-svg')!;
    fs.rmSync(path.join(f.root, drawing.path));
    const result = await buildMechanicalSinglePartCandidates(f.root, f.paths, {}, f.inspector);
    expect(result.receipt.records[0]).toMatchObject({
      feature: 'hole', candidateStatus: 'NOT_RUN',
    });
    expect(result.receipt.records[0]!.reasons[0]).toContain('SINGLE_PART_FILE_MISSING');
  });

  it('rejects stale expected source hash and design revision', async () => {
    const f = fixture();
    await expect(buildMechanicalSinglePartCandidates(f.root, f.paths, {
      expectedSourceReceiptSha256: 'b'.repeat(64),
    }, f.inspector)).rejects.toThrow('SINGLE_PART_SOURCE_RECEIPT_STALE');
    await expect(buildMechanicalSinglePartCandidates(f.root, f.paths, {
      expectedDesignRevisionSha256: 'c'.repeat(64),
    }, f.inspector)).rejects.toThrow('SINGLE_PART_DESIGN_REVISION_STALE');
  });

  it('rejects a source receipt changed during exact inspection', async () => {
    const f = fixture();
    const mutatingInspector: MechanicalSinglePartExactInspector = {
      async inspect(feature, stepText) {
        fs.appendFileSync(path.join(f.root, f.paths.sourceReceipt), ' ');
        return f.inspector.inspect(feature, stepText);
      },
    };
    await expect(buildMechanicalSinglePartCandidates(f.root, f.paths, {}, mutatingInspector))
      .rejects.toThrow('SINGLE_PART_SOURCE_CHANGED_DURING_RUN');
  });
});
