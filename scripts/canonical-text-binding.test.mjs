import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
  canonicalTextEqual,
  canonicalTextSha256,
  canonicalizeText,
} from './canonical-text-binding.mjs';

test('canonical text bindings treat CRLF and LF worktrees identically', () => {
  const lf = 'first\nsecond\n';
  const crlf = Buffer.from('first\r\nsecond\r\n', 'utf8');
  assert.equal(TEXT_BINDING_CANONICALIZATION, 'utf8-crlf-to-lf');
  assert.equal(canonicalizeText(crlf), lf);
  assert.equal(canonicalTextEqual(lf, crlf), true);
  assert.equal(canonicalTextSha256(lf), canonicalTextSha256(crlf));
  assert.deepEqual(canonicalTextBinding(lf), canonicalTextBinding(crlf));
  assert.equal(canonicalTextBinding(crlf).bytes, Buffer.byteLength(lf));
});

test('canonical text bindings still detect semantic byte changes', () => {
  assert.equal(canonicalTextEqual('first\n', 'second\n'), false);
  assert.notEqual(canonicalTextSha256('first\n'), canonicalTextSha256('second\n'));
});
