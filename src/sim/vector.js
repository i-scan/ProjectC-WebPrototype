export const vec = (x = 0, z = 0) => ({ x, z })
export const add = (a, b) => ({ x: a.x + b.x, z: a.z + b.z })
export const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z })
export const scale = (a, factor) => ({ x: a.x * factor, z: a.z * factor })
export const dot = (a, b) => a.x * b.x + a.z * b.z
export const length = (a) => Math.hypot(a.x, a.z)
export const normalize = (a) => {
  const value = length(a)
  return value > 1e-8 ? scale(a, 1 / value) : { x: 0, z: 0 }
}
export const clampLength = (a, max) => {
  const value = length(a)
  return value > max && value > 0 ? scale(a, max / value) : { ...a }
}
export const reflect = (velocity, normal, restitution = 1) => {
  const n = normalize(normal)
  const incoming = dot(velocity, n)
  if (incoming >= 0) return { ...velocity }
  return sub(velocity, scale(n, (1 + restitution) * incoming))
}
export const angleDeg = (a, b) => {
  const aLength = length(a)
  const bLength = length(b)
  if (aLength < 1e-8 || bLength < 1e-8) return 0
  const cosine = Math.max(-1, Math.min(1, dot(a, b) / (aLength * bLength)))
  return Math.acos(cosine) * 180 / Math.PI
}
