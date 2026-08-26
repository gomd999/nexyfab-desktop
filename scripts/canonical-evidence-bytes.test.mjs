import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalTextBytes } from './canonical-evidence-bytes.mjs';

test('canonical evidence bytes are identical across LF and CRLF checkouts', () => {
  const lf = canonicalTextBytes('alpha\nbeta\n');
  const crlf = canonicalTextBytes(Buffer.from('alpha\r\nbeta\r\n', 'utf8'));
  const legacyCr = canonicalTextBytes('alpha\rbeta\r');

  assert.deepEqual(crlf, lf);
  assert.deepEqual(legacyCr, lf);
  assert.equal(lf.toString('utf8'), 'alpha\nbeta\n');
});
