/**
 * /api/step-import — request validation + import round-trip tests.
 *
 * Covers:
 *   - JSON body validation (empty / non-string / too large)
 *   - multipart/form-data branch (single file → text → importStep)
 *   - successful import surfaces { tree, warnings, unsupported }
 *   - corrupt source → 400 PARSE_ERROR with carry-through message
 *   - 5 MB cap returns 413 PAYLOAD_TOO_LARGE
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';
import {
  writeExtrudeAsStep,
  writeExtrudePolygonAsStep,
  writeStepEntities,
  writeStepHeader,
} from '@/lib/brep-bridge/stepWrite';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/step-import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function formReq(file: { name: string; content: string; type?: string }): Request {
  const fd = new FormData();
  const blob = new Blob([file.content], { type: file.type ?? 'application/octet-stream' });
  fd.append('file', blob, file.name);
  return new Request('http://localhost/api/step-import', {
    method: 'POST',
    body: fd,
  });
}

function rectExtrude(w: number, h: number, d: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    depth: d,
    direction: 'one_sided',
    mode: 'add',
  };
}

function triangleExtrude(d: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ],
    depth: d,
    direction: 'one_sided',
    mode: 'add',
  };
}

describe('POST /api/step-import — validation', () => {
  it('rejects malformed JSON body with 400 BAD_REQUEST', async () => {
    const res = await POST(jsonReq('{not json') as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('BAD_REQUEST');
  });

  it('rejects empty source with 400 BAD_REQUEST', async () => {
    const res = await POST(jsonReq({ source: '' }) as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('BAD_REQUEST');
  });

  it('rejects non-string source with 400 BAD_REQUEST', async () => {
    const res = await POST(jsonReq({ source: 12345 }) as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('BAD_REQUEST');
  });

  it('rejects source exceeding 5 MB with 413 PAYLOAD_TOO_LARGE', async () => {
    // 5 MB + 1 char. Use ascii so byte count == char count.
    const oversized = 'A'.repeat(5 * 1024 * 1024 + 1);
    const res = await POST(jsonReq({ source: oversized }) as never);
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects corrupt source with 400 PARSE_ERROR + message', async () => {
    // STEP file without a DATA; section → importStep throws no_data_section.
    const broken = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
END-ISO-10303-21;`;
    const res = await POST(jsonReq({ source: broken }) as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('PARSE_ERROR');
    expect(data.message).toMatch(/no_data_section/);
  });
});

describe('POST /api/step-import — JSON success cases', () => {
  it('imports a valid box STEP → ok=true, tree with 1 node', async () => {
    const source = writeExtrudeAsStep(rectExtrude(10, 20, 30));
    const res = await POST(jsonReq({ source }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tree.nodes).toHaveLength(1);
    expect(data.tree.nodes[0].id).toBe('imported_0');
    expect(data.unsupported).toEqual([]);
  });

  it('imports a valid polygon STEP → ok=true, 3-vertex node', async () => {
    const source = writeExtrudePolygonAsStep(triangleExtrude(7));
    const res = await POST(jsonReq({ source }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tree.nodes).toHaveLength(1);
    expect(data.tree.nodes[0].payload.loop).toHaveLength(3);
  });

  it('imports a 2-solid file → tree with 2 nodes', async () => {
    const source = [
      writeStepHeader(),
      writeStepEntities({
        boxes: [
          { name: 'a', x0: 0, y0: 0, z0: 0, x1: 5, y1: 5, z1: 5 },
          { name: 'b', x0: 10, y0: 10, z0: 0, x1: 20, y1: 20, z1: 10 },
        ],
      }),
      'END-ISO-10303-21;\n',
    ].join('');
    const res = await POST(jsonReq({ source }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tree.nodes).toHaveLength(2);
  });

  it('warnings populated when CRLF line endings are healed', async () => {
    const source = writeExtrudeAsStep(rectExtrude(1, 1, 1)).replace(/\n/g, '\r\n');
    const res = await POST(jsonReq({ source }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(data.warnings.some((w: string) => w.includes('normalize_line_endings_lf'))).toBe(true);
  });

  it('unsupported populated when file contains a curved-surface solid', async () => {
    const cylinderFile = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=VERTEX_POINT('',#10);
#12=DIRECTION('',(0.,0.,1.));
#13=DIRECTION('',(1.,0.,0.));
#14=AXIS2_PLACEMENT_3D('',#10,#12,#13);
#15=CYLINDRICAL_SURFACE('',#14,5.);
#16=DIRECTION('',(1.,0.,0.));
#17=VECTOR('',#16,1.);
#18=LINE('',#10,#17);
#19=EDGE_CURVE('',#11,#11,#18,.T.);
#20=ORIENTED_EDGE('',*,*,#19,.T.);
#21=EDGE_LOOP('',(#20));
#22=FACE_OUTER_BOUND('',#21,.T.);
#23=ADVANCED_FACE('',(#22),#15,.T.);
#24=CLOSED_SHELL('',(#23));
#25=MANIFOLD_SOLID_BREP('',#24);
ENDSEC;
END-ISO-10303-21;`;
    const res = await POST(jsonReq({ source: cylinderFile }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tree.nodes).toEqual([]);
    expect(data.unsupported.length).toBeGreaterThan(0);
    expect(data.unsupported[0]).toMatch(/CYLINDRICAL_SURFACE/);
  });
});

describe('POST /api/step-import — multipart/form-data', () => {
  it('imports a STEP file uploaded via multipart form', async () => {
    const source = writeExtrudeAsStep(rectExtrude(4, 4, 4));
    const res = await POST(formReq({ name: 'part.step', content: source }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tree.nodes).toHaveLength(1);
  });

  it('returns 400 BAD_REQUEST when multipart body lacks `file` field', async () => {
    const fd = new FormData();
    fd.append('other', 'unrelated');
    const req = new Request('http://localhost/api/step-import', { method: 'POST', body: fd });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('BAD_REQUEST');
  });
});
