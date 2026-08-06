import type { BearingComponent, CatalogComponent, MotorComponent, ReducerComponent } from './componentCatalog';
import { validateCatalog } from './componentCatalog';

export type JointSelectionRequirement = { joint: number; requiredOutputTorqueNm: number; requiredOutputRpm: number; radialLoadN: number; minShaftDiameterMm: number; safetyFactor?: number };
export type JointSelection = { joint: number; motor: MotorComponent; reducer: ReducerComponent; bearing: BearingComponent; margins: { torque: number; speed: number; bearingLoad: number }; evidence: string[] };
export type SelectionResult = { ok: true; selections: JointSelection[] } | { ok: false; errors: string[] };

export function selectRobotDriveTrain(requirements: readonly JointSelectionRequirement[], catalog: readonly CatalogComponent[]): SelectionResult {
  const issues = validateCatalog(catalog); if (issues.length) return { ok: false, errors: issues.map(i => `${i.id}: ${i.message}`) };
  const motors = catalog.filter((c): c is MotorComponent => c.kind === 'motor');
  const reducers = catalog.filter((c): c is ReducerComponent => c.kind === 'reducer');
  const bearings = catalog.filter((c): c is BearingComponent => c.kind === 'bearing');
  const selections: JointSelection[] = []; const errors: string[] = [];
  for (const req of requirements) {
    const sf = req.safetyFactor ?? 1.5;
    const drivePairs = motors.flatMap(motor => reducers.map(reducer => ({ motor, reducer }))).filter(({ motor, reducer }) =>
      motor.ratedTorqueNm * reducer.ratio * reducer.efficiency >= req.requiredOutputTorqueNm * sf &&
      reducer.ratedOutputTorqueNm >= req.requiredOutputTorqueNm * sf &&
      motor.maxRpm >= req.requiredOutputRpm * reducer.ratio && reducer.maxInputRpm >= req.requiredOutputRpm * reducer.ratio,
    ).sort((a, b) => score(a.motor, a.reducer) - score(b.motor, b.reducer) || `${a.motor.id}:${a.reducer.id}`.localeCompare(`${b.motor.id}:${b.reducer.id}`));
    const bearing = bearings.filter(b => b.boreMm >= req.minShaftDiameterMm && b.dynamicLoadN >= req.radialLoadN * sf && b.limitingRpm >= req.requiredOutputRpm)
      .sort((a, b) => a.boreMm - b.boreMm || a.id.localeCompare(b.id))[0];
    if (!drivePairs[0]) errors.push(`J${req.joint}: no motor/reducer pair meets torque and speed with safety factor ${sf}.`);
    if (!bearing) errors.push(`J${req.joint}: no bearing meets bore, load and speed with safety factor ${sf}.`);
    if (drivePairs[0] && bearing) {
      const { motor, reducer } = drivePairs[0]; const output = motor.ratedTorqueNm * reducer.ratio * reducer.efficiency;
      selections.push({ joint: req.joint, motor, reducer, bearing, margins: { torque: output / req.requiredOutputTorqueNm, speed: motor.maxRpm / (req.requiredOutputRpm * reducer.ratio), bearingLoad: bearing.dynamicLoadN / req.radialLoadN }, evidence: [`rated output ${output.toFixed(3)} Nm`, `required × SF ${(req.requiredOutputTorqueNm * sf).toFixed(3)} Nm`, `catalog revisions ${motor.revision}, ${reducer.revision}, ${bearing.revision}`] });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, selections };
}
function score(m: MotorComponent, r: ReducerComponent) { return m.massKg + r.massKg + (m.envelopeMm.x * m.envelopeMm.y * m.envelopeMm.z + r.envelopeMm.x * r.envelopeMm.y * r.envelopeMm.z) / 1e6; }
