export type Vec3 = [number, number, number]

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const deg2rad = (d: number) => (d * Math.PI) / 180

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]

/**
 * Rotates a vector by Euler angles in degrees, XYZ order (same convention as three.js
 * `Euler` default), so core math and the renderer always agree.
 */
export function rotateXYZ(v: Vec3, rotDeg: Vec3): Vec3 {
  const [x, y, z] = v
  const a = deg2rad(rotDeg[0]), b = deg2rad(rotDeg[1]), c = deg2rad(rotDeg[2])
  const ca = Math.cos(a), sa = Math.sin(a)
  const cb = Math.cos(b), sb = Math.sin(b)
  const cc = Math.cos(c), sc = Math.sin(c)
  // Matrix for intrinsic XYZ = Rx * Ry * Rz (three.js makeRotationFromEuler, order 'XYZ')
  const m11 = cb * cc, m12 = -cb * sc, m13 = sb
  const m21 = ca * sc + sa * sb * cc, m22 = ca * cc - sa * sb * sc, m23 = -sa * cb
  const m31 = sa * sc - ca * sb * cc, m32 = sa * cc + ca * sb * sc, m33 = ca * cb
  return [m11 * x + m12 * y + m13 * z, m21 * x + m22 * y + m23 * z, m31 * x + m32 * y + m33 * z]
}

/** Local point → world point for a node with position / euler-deg rotation / uniform scale. */
export function applyTransform(p: Vec3, position: Vec3, rotationDeg: Vec3, scale: number): Vec3 {
  return add3(rotateXYZ(scale3(p, scale), rotationDeg), position)
}
