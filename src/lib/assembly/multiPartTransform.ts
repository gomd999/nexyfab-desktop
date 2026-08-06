import type { AssemblyState, Quat } from './assemblyState';
export type TransformSpace = 'world' | 'local';
export type TranslationDelta = { x: number; y: number; z: number };
export type MateMovePolicy = 'constrained' | 'suppress' | 'remove' | 'cancel';

export function translateAssemblyParts(state: AssemblyState, partIds: readonly string[], delta: TranslationDelta, options: { allowFixed?: boolean; space?: TransformSpace; referencePartId?: string } = {}): AssemblyState {
  const ids = validateSelection(state, partIds, options.allowFixed); finite(delta);
  const reference = state.parts.find(part => part.id === (options.referencePartId ?? partIds[0]));
  const applied = options.space === 'local' && reference ? rotate(delta, reference.orientation) : delta;
  return { ...state, parts: state.parts.map(part => ids.has(part.id) ? { ...part, position: add(part.position, applied) } : part) };
}

export function rotateAssemblyParts(state: AssemblyState, partIds: readonly string[], eulerDeltaDeg: TranslationDelta, options: { allowFixed?: boolean; space?: TransformSpace; pivot?: TranslationDelta } = {}): AssemblyState {
  const ids = validateSelection(state, partIds, options.allowFixed); finite(eulerDeltaDeg); const selected = state.parts.filter(part => ids.has(part.id));
  const sum = selected.reduce((value, part) => add(value, part.position), { x: 0, y: 0, z: 0 }); const center = options.pivot ?? { x: sum.x/selected.length, y: sum.y/selected.length, z: sum.z/selected.length }; const delta = fromEuler(eulerDeltaDeg);
  return { ...state, parts: state.parts.map(part => { if (!ids.has(part.id)) return part; const orientation = normalize(options.space === 'local' ? multiply(part.orientation, delta) : multiply(delta, part.orientation)); return { ...part, position: add(center, rotate(subtract(part.position, center), delta)), orientation }; }) };
}

export function prepareMateAwareMove(state: AssemblyState, partIds: readonly string[], policy: MateMovePolicy) {
  const ids = new Set(partIds); const affected = state.mates.filter(mate => ids.has(mate.a.partId) !== ids.has(mate.b.partId)); const affectedMateIds = affected.map(mate => mate.id);
  if (!affected.length) return { state, affectedMateIds, requiresSolve: false, cancelled: false };
  if (policy === 'cancel') return { state, affectedMateIds, requiresSolve: false, cancelled: true };
  if (policy === 'constrained') return { state, affectedMateIds, requiresSolve: true, cancelled: false };
  if (policy === 'remove') return { state: { ...state, mates: state.mates.filter(mate => !affectedMateIds.includes(mate.id)) }, affectedMateIds, requiresSolve: false, cancelled: false };
  return { state: { ...state, mates: state.mates.map(mate => affectedMateIds.includes(mate.id) ? { ...mate, suppressed: true } : mate) }, affectedMateIds, requiresSolve: false, cancelled: false };
}

function validateSelection(state: AssemblyState, partIds: readonly string[], allowFixed = false) { const ids=new Set(partIds);if(!ids.size)throw new Error('At least one part must be selected.');const unknown=[...ids].filter(id=>!state.parts.some(part=>part.id===id));if(unknown.length)throw new Error(`Unknown part(s): ${unknown.join(', ')}.`);const fixed=state.parts.filter(part=>ids.has(part.id)&&part.fixed);if(fixed.length&&!allowFixed)throw new Error(`Fixed part(s) cannot move: ${fixed.map(part=>part.id).join(', ')}.`);return ids; }
function finite(v:TranslationDelta){if(Object.values(v).some(value=>!Number.isFinite(value)))throw new Error('Transform delta must be finite.');} function add(a:TranslationDelta,b:TranslationDelta){return{x:a.x+b.x,y:a.y+b.y,z:a.z+b.z};} function subtract(a:TranslationDelta,b:TranslationDelta){return{x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};}
function multiply(a:Quat,b:Quat):Quat{return{x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z};} function normalize(q:Quat):Quat{const n=Math.hypot(q.x,q.y,q.z,q.w)||1;return{x:q.x/n,y:q.y/n,z:q.z/n,w:q.w/n};}
function fromEuler(v:TranslationDelta):Quat{const x=v.x*Math.PI/360,y=v.y*Math.PI/360,z=v.z*Math.PI/360,cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);return normalize({x:sx*cy*cz-cx*sy*sz,y:cx*sy*cz+sx*cy*sz,z:cx*cy*sz-sx*sy*cz,w:cx*cy*cz+sx*sy*sz});} function rotate(v:TranslationDelta,q:Quat){const p={x:v.x,y:v.y,z:v.z,w:0},r=multiply(multiply(q,p),{x:-q.x,y:-q.y,z:-q.z,w:q.w});return{x:r.x,y:r.y,z:r.z};}
