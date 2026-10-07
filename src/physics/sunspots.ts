import type { StarStats, StarTypeId } from '@/types/star'
import { SECONDS_PER_DAY, clamp } from '@/physics/relations'

/**
 * Sunspot physics.
 *
 * Sunspots are cool, magnetically concentrated patches of photosphere. This
 * module provides a *solar-calibrated approximation* of their behaviour — not a
 * magnetohydrodynamic simulation: emergence statistics, a growth/decay
 * lifecycle, latitude-dependent (differential) rotation, and temperature-derived
 * contrast. All lengths are SI; angles in radians.
 */

/**
 * Solar sidereal equatorial angular velocity, degrees per day.
 * Snodgrass & Ulrich (1990), ApJ 351, 309.
 */
const SOLAR_EQUATOR_DEG_PER_DAY = 14.713
/** Differential-rotation coefficients, degrees per day (Snodgrass & Ulrich 1990, sidereal). */
const SOLAR_ROTATION_B = -2.396
const SOLAR_ROTATION_C = -1.787

/** Above this effective temperature the convective envelope is too shallow for spots. */
const MAX_SPOT_TEMPERATURE = 8000

/** Penumbral area of the largest spots, as a fraction of the photospheric surface area. */
export const MAX_SPOT_AREA_FRACTION = 2e-4
/** Smallest spots are this fraction of the largest, so sizes span ~20×. */
const MIN_SPOT_AREA_RATIO = 0.05
/** Umbra ≈ 0.66·T_eff (Sun: ~3810 K) and penumbra ≈ 0.87·T_eff (Sun: ~5020 K). */
const UMBRA_TEMPERATURE_RATIO = 0.66
const PENUMBRA_TEMPERATURE_RATIO = 0.87

const DEG_TO_RAD = Math.PI / 180

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Whether a star can host solar-type spots. Requires a convective envelope
 * beneath a cool-enough photosphere; neutron stars and hot massive stars are
 * excluded.
 */
export function sunspotsSupported(stats: StarStats, typeId: StarTypeId): boolean {
  return typeId === 'main-sequence' && stats.temperature <= MAX_SPOT_TEMPERATURE
}

/**
 * Ω(λ)/Ω_eq for the solar differential-rotation law
 * Ω(λ) = A + B·sin²λ + C·sin⁴λ. The equator rotates fastest; higher latitudes
 * lag. Valid for solar-type stars; used as a plausibility scaling elsewhere.
 */
export function differentialRotationFactor(latitude: number): number {
  const s = Math.sin(latitude)
  const s2 = s * s
  const normalizedB = SOLAR_ROTATION_B / SOLAR_EQUATOR_DEG_PER_DAY
  const normalizedC = SOLAR_ROTATION_C / SOLAR_EQUATOR_DEG_PER_DAY
  return clamp(1 + normalizedB * s2 + normalizedC * s2 * s2, 0.1, 2)
}

/**
 * Angular velocity at a latitude, rad/s. The wind store's rotation period is
 * taken as the equatorial (fiducial) period, and the solar shear law sets the
 * rate elsewhere.
 */
export function angularVelocityAtLatitude(equatorialPeriodDays: number, latitude: number): number {
  const periodSeconds = Math.max(equatorialPeriodDays * SECONDS_PER_DAY, 1e-6)
  const equatorial = (2 * Math.PI) / periodSeconds
  return equatorial * differentialRotationFactor(latitude)
}

/** Umbra and penumbra temperatures for a photosphere of the given T_eff. */
export function spotTemperatures(photosphereTemperature: number): { umbra: number; penumbra: number } {
  return {
    umbra: photosphereTemperature * UMBRA_TEMPERATURE_RATIO,
    penumbra: photosphereTemperature * PENUMBRA_TEMPERATURE_RATIO,
  }
}

/** Bolometric radiance ratio (T_spot / T_photosphere)⁴ = (T_spot/T_eff)⁴. */
export function radianceRatio(spotTemperature: number, photosphereTemperature: number): number {
  const t = spotTemperature / Math.max(photosphereTemperature, Number.EPSILON)
  const t2 = t * t
  return t2 * t2
}

/**
 * Angular radius (radians) of a circular cap of the given area on a sphere of
 * the given radius: A = 2πR²(1 − cos θ).
 */
export function angularRadiusFromArea(area: number, radius: number): number {
  const ratio = clamp(area / (2 * Math.PI * radius * radius), 0, 2)
  return Math.acos(clamp(1 - ratio, -1, 1))
}

/**
 * Spot area relative to its maximum over the lifecycle: fast emergence
 * (~10% of the life) then a slower decay from the second half onward.
 */
export function spotGrowthFraction(ageFraction: number): number {
  const f = clamp(ageFraction, 0, 1)
  const growth = smoothstep(0, 0.12, f)
  const decay = 1 - smoothstep(0.45, 1, f)
  return Math.min(growth, decay)
}

/** Deterministic 32-bit PRNG (mulberry32); returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A spot's defining properties before it is given an id and birth time. */
export interface PlannedSpot {
  latitude: number
  longitude: number
  maxArea: number
  lifetimeSeconds: number
  umbraFraction: number
}

/**
 * Plan one active region from a seeded RNG. Spots emerge in two active belts
 * (butterfly migration is intentionally not modelled yet) and larger spots live
 * longer. A trailing companion spot is often present (bipolar region).
 */
export function planRegion(random: () => number, activity: number, surfaceArea: number): PlannedSpot[] {
  const hemisphere = random() < 0.5 ? -1 : 1
  const latitude = hemisphere * (8 + 20 * random()) * DEG_TO_RAD
  const longitude = 2 * Math.PI * random()

  const sizeRoll = random()
  const areaFraction =
    MAX_SPOT_AREA_FRACTION *
    clamp(activity, 0, 1) *
    (MIN_SPOT_AREA_RATIO + (1 - MIN_SPOT_AREA_RATIO) * sizeRoll * sizeRoll)
  const maxArea = areaFraction * surfaceArea
  const lifetimeScale = Math.sqrt(areaFraction / MAX_SPOT_AREA_FRACTION)
  const lifetimeSeconds = (3 + 27 * lifetimeScale) * SECONDS_PER_DAY
  const umbraFraction = 0.35 + 0.15 * random()

  const primary: PlannedSpot = { latitude, longitude, maxArea, lifetimeSeconds, umbraFraction }
  const spots: PlannedSpot[] = [primary]

  if (random() < 0.6) {
    const companionScale = 0.25 + 0.4 * random()
    spots.push({
      latitude: latitude - hemisphere * (1 + 3 * random()) * DEG_TO_RAD,
      longitude: longitude + (2 + 6 * random()) * DEG_TO_RAD,
      maxArea: maxArea * companionScale,
      lifetimeSeconds: lifetimeSeconds * 0.8,
      umbraFraction: 0.32 + 0.15 * random(),
    })
  }

  return spots
}

/**
 * Multiplier that keeps the total photospheric flux roughly constant as spotted
 * area grows. `coverage` is the spotted fraction of the surface and
 * `meanSpotRadiance` the area-averaged spot radiance ratio. Tiny in practice
 * (spots cover well under 1% of the disc).
 */
export function surfaceFluxCompensation(coverage: number, meanSpotRadiance: number): number {
  const deficit = clamp(coverage, 0, 0.5) * (1 - clamp(meanSpotRadiance, 0, 1))
  return 1 / Math.max(1 - deficit, 1e-3)
}
