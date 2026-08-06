type V2 = [number, number];
type V3 = [number, number, number];
export interface IesLm63Profile { id: string; version: string; lampCount: number; lumensPerLamp: number; candelaMultiplier: number; verticalAnglesDeg: number[]; horizontalAnglesDeg: number[]; candela: number[][] }

export function parseIesLm63(id: string, source: string): IesLm63Profile {
  const lines = source.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean), version = lines[0] ?? '';
  if (!/^IES(?:NA)?:LM-63-/i.test(version)) throw new Error('Unsupported or missing LM-63 header.');
  const tiltIndex = lines.findIndex(line => /^TILT=/i.test(line)); if (tiltIndex < 0 || lines[tiltIndex]!.toUpperCase() !== 'TILT=NONE') throw new Error('Only explicit TILT=NONE LM-63 profiles are supported.');
  const numbers = lines.slice(tiltIndex + 1).join(' ').split(/[\s,]+/).filter(Boolean).map(Number);
  if (numbers.some(value => !Number.isFinite(value)) || numbers.length < 13) throw new Error('LM-63 numeric payload is invalid.');
  const [lampCount, lumensPerLamp, candelaMultiplier, verticalCount, horizontalCount] = numbers;
  if (![lampCount, verticalCount, horizontalCount].every(Number.isSafeInteger) || lampCount! < 1 || verticalCount! < 2 || horizontalCount! < 1 || lumensPerLamp! <= 0 || candelaMultiplier! <= 0) throw new Error('LM-63 lamp or angle counts are invalid.');
  const angleStart = 13, candelaStart = angleStart + verticalCount! + horizontalCount!, expected = candelaStart + verticalCount! * horizontalCount!;
  if (numbers.length < expected) throw new Error('LM-63 candela table is incomplete.');
  const verticalAnglesDeg = numbers.slice(angleStart, angleStart + verticalCount!), horizontalAnglesDeg = numbers.slice(angleStart + verticalCount!, candelaStart);
  if (verticalAnglesDeg.some((value, index) => index > 0 && value <= verticalAnglesDeg[index - 1]!) || horizontalAnglesDeg.some((value, index) => index > 0 && value <= horizontalAnglesDeg[index - 1]!)) throw new Error('LM-63 angles must be strictly increasing.');
  const flat = numbers.slice(candelaStart, expected).map(value => value * candelaMultiplier!); const candela = Array.from({ length: horizontalCount! }, (_, index) => flat.slice(index * verticalCount!, (index + 1) * verticalCount!));
  if (verticalAnglesDeg.some(value => value < 0 || value > 180) || horizontalAnglesDeg.some(value => value < 0 || value > 360) || flat.some(value => value < 0)) throw new Error('LM-63 angles or candela values are outside supported physical ranges.');
  return { id, version, lampCount: lampCount!, lumensPerLamp: lumensPerLamp!, candelaMultiplier: candelaMultiplier!, verticalAnglesDeg, horizontalAnglesDeg, candela };
}

function bracket(values: number[], target: number): [number, number, number] { if (values.length === 1) return [0, 0, 0]; if (target <= values[0]!) return [0, 0, 0]; if (target >= values.at(-1)!) return [values.length - 1, values.length - 1, 0]; const upper = values.findIndex(value => value >= target), lower = upper - 1; return [lower, upper, (target - values[lower]!) / (values[upper]! - values[lower]!)]; }
export function sampleIesCandela(profile: IesLm63Profile, verticalDeg: number, horizontalDeg: number): number {
  let normalizedHorizontal = ((horizontalDeg % 360) + 360) % 360;
  const maximumHorizontal = profile.horizontalAnglesDeg.at(-1)!;
  if (profile.horizontalAnglesDeg.length === 1) normalizedHorizontal = profile.horizontalAnglesDeg[0]!;
  else if (maximumHorizontal === 90) { normalizedHorizontal %= 180; if (normalizedHorizontal > 90) normalizedHorizontal = 180 - normalizedHorizontal; }
  else if (maximumHorizontal === 180 && normalizedHorizontal > 180) normalizedHorizontal = 360 - normalizedHorizontal;
  const [v0, v1, vt] = bracket(profile.verticalAnglesDeg, verticalDeg), [h0, h1, ht] = bracket(profile.horizontalAnglesDeg, normalizedHorizontal);
  const lower = profile.candela[h0]![v0]! * (1 - vt) + profile.candela[h0]![v1]! * vt, upper = profile.candela[h1]![v0]! * (1 - vt) + profile.candela[h1]![v1]! * vt; return lower * (1 - ht) + upper * ht;
}

export interface Quaternion { x: number; y: number; z: number; w: number }
export interface PhotometricLightInput { id: string; positionMm: V3; iesProfileId: string; yawDeg?: number; worldToPhotometricQuaternion?: Quaternion }
export interface IlluminanceCalculation { ran: true; averageLux: number; minimumLux: number; maximumLux: number; uniformityMinToAverage: number; pointLux: Array<{ pointMm: V2; lux: number }>; iesProfileIds: string[]; method: 'lm63_point_by_point_horizontal_plane' }
function rotateByQuaternion(vector: V3, quaternion: Quaternion): V3 { const { x, y, z, w } = quaternion, [vx, vy, vz] = vector, tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx); return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)]; }
export function calculateIesIlluminance(lights: PhotometricLightInput[], pointsMm: V2[], workplaneHeightMm: number, profiles: ReadonlyMap<string, IesLm63Profile>): IlluminanceCalculation {
  if (!lights.length || !pointsMm.length || !Number.isFinite(workplaneHeightMm)) throw new Error('Lights, calculation points, and workplane height are required.');
  const used = new Set<string>();
  const pointLux = pointsMm.map(pointMm => ({ pointMm, lux: lights.reduce((sum, light) => { const profile = profiles.get(light.iesProfileId); if (!profile) throw new Error(`Missing IES profile ${light.iesProfileId}.`); if (!Number.isFinite(light.yawDeg ?? 0)) throw new Error(`${light.id}: yaw must be finite.`); used.add(profile.id); const dx = (pointMm[0] - light.positionMm[0]) / 1000, dy = (pointMm[1] - light.positionMm[1]) / 1000, dz = (light.positionMm[2] - workplaneHeightMm) / 1000; if (!(dz > 0)) throw new Error(`${light.id}: light must be above the workplane.`); const worldDown: V3 = [dx, dy, dz], orientation = light.worldToPhotometricQuaternion; let local = worldDown; if (orientation) { const norm = Math.hypot(orientation.x, orientation.y, orientation.z, orientation.w); if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-3) throw new Error(`${light.id}: photometric orientation quaternion must be normalized.`); local = rotateByQuaternion(worldDown, orientation); } const distance = Math.hypot(...local), verticalDeg = Math.acos(Math.max(-1, Math.min(1, local[2] / distance))) * 180 / Math.PI, horizontalDeg = Math.atan2(local[1], local[0]) * 180 / Math.PI - (orientation ? 0 : light.yawDeg ?? 0), candela = sampleIesCandela(profile, verticalDeg, horizontalDeg); return sum + candela * (dz / Math.hypot(dx, dy, dz)) / (distance * distance); }, 0) }));
  const values = pointLux.map(item => item.lux), averageLux = values.reduce((sum, value) => sum + value, 0) / values.length, minimumLux = Math.min(...values), maximumLux = Math.max(...values);
  return { ran: true, averageLux, minimumLux, maximumLux, uniformityMinToAverage: minimumLux / averageLux, pointLux, iesProfileIds: [...used], method: 'lm63_point_by_point_horizontal_plane' };
}

export interface IlluminancePlaneInput { id: string; pointsMm: V2[]; heightMm: number }
export function calculateIesIlluminancePlanes(lights: PhotometricLightInput[], planes: IlluminancePlaneInput[], profiles: ReadonlyMap<string, IesLm63Profile>): Record<string, IlluminanceCalculation> {
  if (!planes.length || new Set(planes.map(plane => plane.id)).size !== planes.length) throw new Error('At least one uniquely identified calculation plane is required.');
  return Object.fromEntries(planes.map(plane => [plane.id, calculateIesIlluminance(lights, plane.pointsMm, plane.heightMm, profiles)]));
}
