import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateRobot6Axis } from './robot/robotGenerator';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from './robot/robotDemonstrator';
import { buildEditedAiAssemblyProgram, packageAiAssemblyRevision, serializeAiAssemblyProgram } from './aiAssemblyRevision';

const base = generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC).program;
const trees = Object.fromEntries(base.parts.map(part => [part.instanceId, part.featureTree]));

describe('edited AI assembly revision package', () => {
  it('exports only governed AI parts while preserving a valid expert edit', async () => {
    const editedParts = base.assembly.parts.map((part, index) => index === 1 ? { ...part, position: { ...part.position, x: part.position.x + 5 } } : part);
    const unrelated = { ...editedParts[0]!, id: 'user-existing-work', name: 'User work', partTemplateId: 'user-work' };
    const edited = buildEditedAiAssemblyProgram(base, { parts: [...editedParts, unrelated], mates: [...base.assembly.mates] }, trees);
    expect(edited.assembly.parts).toHaveLength(25);
    expect(edited.assembly.parts.some(part => part.id === 'user-existing-work')).toBe(false);
    expect(edited.assembly.parts[1]!.position.x).toBe(base.assembly.parts[1]!.position.x + 5);
    const baseHash = createHash('sha256').update(serializeAiAssemblyProgram(base)).digest('hex');
    const packaged = await packageAiAssemblyRevision(edited, { lineageId: 'robot-lineage', revision: 2, baseProgramHash: baseHash, createdAt: '2026-08-09T00:00:00.000Z' });
    expect(packaged.manifest).toMatchObject({ revision: 2, baseProgramHash: baseHash, sideEffects: { sourceModified: false, quoteCreated: false, rfqSent: false } });
    expect(packaged.manifest.programArtifact).toBe(`editable-program-${packaged.manifest.programHash}.json`);
  });

  it('fails if a governed part or FeatureTree was removed', () => {
    expect(() => buildEditedAiAssemblyProgram(base, { ...base.assembly, parts: base.assembly.parts.slice(1) }, trees)).toThrow('required AI part was removed');
    const missingTrees = { ...trees }; delete missingTrees[base.parts[0]!.instanceId];
    expect(() => buildEditedAiAssemblyProgram(base, base.assembly, missingTrees)).toThrow('FeatureTree is missing');
  });

  it('refuses to create a fake revision from unchanged bytes', async () => {
    const baseHash = createHash('sha256').update(serializeAiAssemblyProgram(base)).digest('hex');
    await expect(packageAiAssemblyRevision(base, { lineageId: 'robot-lineage', revision: 2, baseProgramHash: baseHash })).rejects.toThrow('unchanged');
  });
});
