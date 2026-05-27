import { describe, it, expect } from 'vitest';
import { EquationManager } from './equationManager';

describe('EquationManager', () => {
  it('sets + reads a constant', () => {
    const m = new EquationManager();
    m.set('thickness', '2');
    expect(m.get('thickness')).toBe(2);
  });

  it('evaluates derived variable', () => {
    const m = new EquationManager();
    m.set('a', '10');
    m.set('b', 'a * 2');
    expect(m.get('b')).toBe(20);
  });

  it('cascade updates downstream', () => {
    const m = new EquationManager();
    m.set('a', '10');
    m.set('b', 'a * 2');
    m.set('c', 'b + 5');
    m.set('a', '20');
    expect(m.get('b')).toBe(40);
    expect(m.get('c')).toBe(45);
  });

  it('rejects cycles', () => {
    const m = new EquationManager();
    m.set('a', '1');
    m.set('b', 'a + 1');
    // a referencing b would cycle.
    expect(() => m.set('a', 'b + 1')).toThrow(/cycle/);
  });

  it('rejects invalid names', () => {
    const m = new EquationManager();
    expect(() => m.set('123', '5')).toThrow();
    expect(() => m.set('a-b', '5')).toThrow();
  });

  it('removes a leaf variable', () => {
    const m = new EquationManager();
    m.set('temp', '42');
    m.remove('temp');
    expect(m.get('temp')).toBeNull();
  });

  it('refuses to remove a variable with dependents', () => {
    const m = new EquationManager();
    m.set('a', '5');
    m.set('b', 'a * 2');
    expect(() => m.remove('a')).toThrow(/referenced by/);
  });

  it('evaluateExpression uses current table', () => {
    const m = new EquationManager();
    m.set('thickness', '2');
    expect(m.evaluateExpression('thickness * 5')).toBe(10);
  });

  it('list returns all variables', () => {
    const m = new EquationManager();
    m.set('a', '1');
    m.set('b', '2');
    expect(m.list()).toHaveLength(2);
  });

  it('supports math functions', () => {
    const m = new EquationManager();
    m.set('angle', 'sin(0)');
    expect(m.get('angle')).toBe(0);
  });

  it('toVarTable returns flat object', () => {
    const m = new EquationManager();
    m.set('x', '5');
    m.set('y', 'x * 2');
    const tbl = m.toVarTable();
    expect(tbl.x).toBe(5);
    expect(tbl.y).toBe(10);
  });
});
