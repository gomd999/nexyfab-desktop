import { describe, it, expect } from 'vitest';
import { applyUnifiedDiff, DiffApplyError } from '../diff';

describe('applyUnifiedDiff', () => {
  it('adds a line', () => {
    const src = 'cube([10,10,10]);\n';
    const diff = `--- a/model.scad
+++ b/model.scad
@@ -1,1 +1,2 @@
 cube([10,10,10]);
+sphere(5);`;
    const out = applyUnifiedDiff(src, diff);
    expect(out).toBe('cube([10,10,10]);\nsphere(5);\n');
  });

  it('removes a line', () => {
    const src = 'a\nb\nc\n';
    const diff = `@@ -1,3 +1,2 @@
 a
-b
 c`;
    const out = applyUnifiedDiff(src, diff);
    expect(out).toBe('a\nc\n');
  });

  it('replaces a line', () => {
    const src = 'cube(10);\nsphere(5);\n';
    const diff = `@@ -1,2 +1,2 @@
-cube(10);
+cube([10,10,10], center=true);
 sphere(5);`;
    const out = applyUnifiedDiff(src, diff);
    expect(out).toBe('cube([10,10,10], center=true);\nsphere(5);\n');
  });

  it('throws DiffApplyError on context mismatch', () => {
    const src = 'cube(10);\n';
    const diff = `@@ -1,1 +1,1 @@
-WRONG_LINE
+cube(20);`;
    expect(() => applyUnifiedDiff(src, diff)).toThrow(DiffApplyError);
  });

  it('throws when no hunks present', () => {
    expect(() => applyUnifiedDiff('foo', 'just text, no hunks')).toThrow(DiffApplyError);
  });

  it('handles multiple hunks', () => {
    const src = 'a\nb\nc\nd\ne\nf\n';
    const diff = `@@ -1,2 +1,2 @@
-a
+A
 b
@@ -5,2 +5,2 @@
-e
+E
 f`;
    const out = applyUnifiedDiff(src, diff);
    expect(out).toBe('A\nb\nc\nd\nE\nf\n');
  });

  it('ignores "\\ No newline at end of file" markers', () => {
    const src = 'foo';
    const diff = `@@ -1,1 +1,1 @@
-foo
\\ No newline at end of file
+bar
\\ No newline at end of file`;
    const out = applyUnifiedDiff(src, diff);
    expect(out).toBe('bar');
  });
});
