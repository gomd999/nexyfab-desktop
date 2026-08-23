import { describe, expect, it } from 'vitest';
import { buildPcbReadiness, parseComponentCSV, parseKicadPCB } from './ecadImport';

describe('ECAD PCB import readiness boundary', () => {
  it('does not propagate malformed CSV power as a thermal NaN', () => {
    const board = parseComponentCSV([
      'ref,value,x_mm,y_mm,power_w',
      'U1,controller,10,20,not-a-number',
    ].join('\n'));
    expect(board.components[0]?.powerWatts).toBe(0.5);
    expect(Number.isFinite(board.components[0]?.powerWatts)).toBe(true);
  });

  it('does not propagate non-finite CSV coordinates into board geometry', () => {
    const board = parseComponentCSV([
      'ref,value,x_mm,y_mm,power_w',
      'U1,controller,Infinity,not-a-number,0.5',
    ].join('\n'));
    expect(board.components[0]).toMatchObject({ x: 0, y: 0 });
    expect(Number.isFinite(board.width)).toBe(true);
    expect(Number.isFinite(board.height)).toBe(true);
  });

  it('emits a deterministic hashed artifact and explicit manufacturing HOLDs', async () => {
    const a = parseComponentCSV([
      'ref,value,x_mm,y_mm,power_w',
      'R1,10k,20,20,0.1',
      'U1,controller,10,10,0.5',
    ].join('\n'));
    const b = parseComponentCSV([
      'ref,value,x_mm,y_mm,power_w',
      'U1,controller,10,10,0.5',
      'R1,10k,20,20,0.1',
    ].join('\n'));
    const first = await buildPcbReadiness(a);
    const second = await buildPcbReadiness(b);
    expect(first).toEqual(second);
    expect(first.status).toBe('HOLD');
    expect(first.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.holds).toEqual(expect.arrayContaining([
      expect.stringContaining('connectivity/netlist'),
      expect.stringContaining('ERC/DRC'),
      expect.stringContaining('Gerber'),
    ]));
  });

  it('keeps the artifact hash stable when duplicate refs differ in later fields', async () => {
    const firstBoard = parseComponentCSV([
      'ref,value,x_mm,y_mm,power_w',
      'U1,controller,10,10,0.25',
      'U1,controller,10,10,0.75',
    ].join('\n'));
    const secondBoard = { ...firstBoard, components: [...firstBoard.components].reverse() };

    await expect(buildPcbReadiness(firstBoard)).resolves.toEqual(await buildPcbReadiness(secondBoard));
  });

  it('keeps KiCad placement import separate from manufacturing readiness', async () => {
    const board = parseKicadPCB('(kicad_pcb (footprint "R_0603" (layer "F.Cu") (at 10 20) (property "Reference" "R1") (property "Value" "10k")))');
    const readiness = await buildPcbReadiness(board);
    expect(board.components).toHaveLength(1);
    expect(readiness.supported).toContain('kicad_component_placement_import');
    expect(readiness.status).toBe('HOLD');
  });
});
