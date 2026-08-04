import type { ThermalDirection } from './thermalClockExperiment'
import { thermalZoneClass } from './thermalPendulumModel'

export const THERMAL_CLOCK_ANGLE_STEP = 12
export const THERMAL_CLOCK_SWING_ANGLE = 84

export type ThermalClockSlot = {
  temperature: number
  angle: number
  zoneClass: string
}

export type ThermalClockDriftProjection = {
  direction: ThermalDirection
  magnitude: number
  startAngle: number
  endAngle: number
  displayedAngle: number
  clipped: boolean
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function thermalClockAngleFor(
  temperature: number,
  setPoint: number,
  temperatureMin = -4,
  temperatureMax = 4,
): number {
  const safeTemperature = clamp(Number.isFinite(temperature) ? temperature : setPoint, temperatureMin, temperatureMax)
  const safeSetPoint = Number.isFinite(setPoint) ? setPoint : 0
  return clamp(
    (safeTemperature - safeSetPoint) * THERMAL_CLOCK_ANGLE_STEP,
    -THERMAL_CLOCK_SWING_ANGLE,
    THERMAL_CLOCK_SWING_ANGLE,
  )
}

export function thermalClockDialAngleFor(
  temperatureEdge: number,
  setPoint: number,
): number {
  const safeEdge = Number.isFinite(temperatureEdge) ? temperatureEdge : setPoint
  const safeSetPoint = Number.isFinite(setPoint) ? setPoint : 0
  // Zone boundaries may extend half a slot beyond the extreme bob centres so
  // every absolute temperature segment keeps the same angular width.
  return (safeEdge - safeSetPoint) * THERMAL_CLOCK_ANGLE_STEP
}

export function thermalClockSlotFor(
  temperature: number,
  setPoint: number,
  temperatureMin = -4,
  temperatureMax = 4,
): ThermalClockSlot {
  const safeTemperature = clamp(Number.isFinite(temperature) ? temperature : setPoint, temperatureMin, temperatureMax)
  return {
    temperature: safeTemperature,
    angle: thermalClockAngleFor(safeTemperature, setPoint, temperatureMin, temperatureMax),
    zoneClass: thermalZoneClass(safeTemperature),
  }
}

export function thermalClockDriftProjectionFor(
  temperature: number,
  setPoint: number,
  drift: number,
  driftVisualMax: number,
  temperatureMin = -4,
  temperatureMax = 4,
): ThermalClockDriftProjection {
  const startAngle = thermalClockAngleFor(temperature, setPoint, temperatureMin, temperatureMax)
  const safeDrift = Number.isFinite(drift) ? drift : 0
  const visualMax = Math.max(0.001, Number.isFinite(driftVisualMax) ? driftVisualMax : 3)
  const direction: ThermalDirection = safeDrift > 0.001 ? 'hot' : safeDrift < -0.001 ? 'cold' : 'still'
  const magnitude = direction === 'still' ? 0 : Math.min(1, Math.abs(safeDrift) / visualMax)
  const desiredAngle = direction === 'still'
    ? startAngle
    : startAngle + Math.sign(safeDrift) * (10 + magnitude * 28)
  const minimumAngle = thermalClockAngleFor(temperatureMin, setPoint, temperatureMin, temperatureMax)
  const maximumAngle = thermalClockAngleFor(temperatureMax, setPoint, temperatureMin, temperatureMax)
  const endAngle = clamp(desiredAngle, minimumAngle, maximumAngle)
  return {
    direction,
    magnitude,
    startAngle,
    endAngle,
    displayedAngle: endAngle - startAngle,
    clipped: Math.abs(endAngle - desiredAngle) > 0.001,
  }
}
