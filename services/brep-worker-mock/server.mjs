/**
 * Dev/mock BREP tessellation worker for `BREP_WORKER_URL`.
 * POST /tessellate { filename, base64, jobId } → { previewMeshBase64 } (ASCII STL of a single triangle).
 * Replace with an OCCT-backed service in production.
 */
import http from 'node:http';
import { Buffer } from 'node:buffer';

const PORT = Number(process.env.PORT || 8787);

function validStepHeader(buf) {
  const head = buf.subarray(0, Math.min(4096, buf.length)).toString('latin1');
  return /ISO-10303|HEADER|STEP/i.test(head);
}

/** Minimal ASCII STL (valid for parseSTL in browser). */
function mockStlBase64() {
  const asciiStl =
    'solid mock\n' +
    'facet normal 0 0 1\n' +
    '  outer loop\n' +
    '    vertex 0 0 0\n' +
    '    vertex 10 0 0\n' +
    '    vertex 0 10 0\n' +
    '  endloop\n' +
    'endfacet\n' +
    'endsolid mock\n';
  return Buffer.from(asciiStl, 'utf8').toString('base64');
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/tessellate') {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const raw = typeof j.base64 === 'string' ? j.base64 : '';
        const buf = Buffer.from(raw, 'base64');
        if (buf.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Empty payload' }));
          return;
        }
        if (!validStepHeader(buf)) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid STEP header' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            previewMeshBase64: mockStlBase64(),
            brepSessionToken: `mock-${j.jobId ?? 'job'}`,
          }),
        );
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'brep-worker-mock' }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`[brep-worker-mock] listening on :${PORT} (POST /tessellate, GET /health)`);
});
