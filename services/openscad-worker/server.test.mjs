import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateGmshGeo, validateOpenScadRenderArgs, validateRadianceRequest, validateScadSource, workerBuildId } from './server.mjs';

test('worker build identity fails closed when no commit is supplied', () => {
  assert.equal(workerBuildId({}), 'unknown');
  assert.equal(workerBuildId({ NEXYFAB_WORKER_BUILD_ID: ' abc123 ' }), 'abc123');
});

test('accepts deterministic geometry and trusted BOSL2 includes', () => {
  assert.equal(validateScadSource('include <BOSL2/std.scad>\ncube([1,2,3]);').ok, true);
});

test('blocks external file and untrusted include access', () => {
  assert.equal(validateScadSource('import("/etc/passwd");').ok, false);
  assert.equal(validateScadSource('include </tmp/secret.scad>').ok, false);
  assert.equal(validateScadSource('surface(file="secret.dat");').ok, false);
});

test('allows only the explicitly attached model.stl import', () => {
  assert.equal(validateScadSource('import("model.stl");', true).ok, true);
  assert.equal(validateScadSource('import("model.stl");', false).ok, false);
  assert.equal(validateScadSource('import("other.stl");', true).ok, false);
});

test('allows bounded internal camera flags and blocks arbitrary CLI flags', () => {
  assert.equal(validateOpenScadRenderArgs(['--imgsize=800,600', '--camera=0,0,0,55,0,25,140', '--colorscheme=Tomorrow'], 'png').ok, true);
  assert.equal(validateOpenScadRenderArgs(['--export-format=binstl'], 'stl').ok, true);
  assert.equal(validateOpenScadRenderArgs(['--enable=python'], 'png').ok, false);
});

test('gmsh recipes cannot open arbitrary files or execute commands', () => {
  assert.equal(validateGmshGeo('Merge "surf.stl";\nCoherence Mesh;').ok, true);
  assert.equal(validateGmshGeo('Merge "/etc/passwd";').ok, false);
  assert.equal(validateGmshGeo('Merge "surf.stl"; SystemCall "id";').ok, false);
});

test('radiance jobs accept only the canonical command plan', () => {
  const plan = {
    kind: 'point_in_time',
    commands: [
      { executable: 'oconv', args: ['scene.rad', 'sky.rad'], stdoutArtifact: 'scene.oct' },
      { executable: 'rtrace', args: ['-I+', '-h', '-ab', '5', '-ad', '2048', '-as', '512', '-aa', '0.1', 'scene.oct'], stdinArtifact: 'sensors.pts', stdoutArtifact: 'illuminance.rgb' },
    ],
    requiredExecutables: ['oconv', 'rtrace'],
  };
  assert.equal(validateRadianceRequest({ plan, artifacts: { 'scene.rad': { encoding: 'utf8', data: '' } } }).ok, true);
  assert.equal(validateRadianceRequest({ plan: { ...plan, commands: [{ executable: 'rtrace', args: ['../../secret'], stdoutArtifact: 'scene.oct' }] }, artifacts: {} }).ok, false);
});

test('direct execution invokes main on the current platform', () => {
  const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [serverPath], {
    encoding: 'utf8',
    env: { ...process.env, REDIS_URL: '', OPENSCAD_WORKER_ISOLATED: '1' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REDIS_URL is required/);
});
