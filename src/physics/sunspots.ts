import type { StarStats, StarTypeId } from '@/types/star'
import { SECONDS_PER_DAY, clamp } from '@/physics/relations'

/**
 * Sunspot physics.
 *
 * Sunspots are cool, magnetically concentrated patches of photosphere. This
 * module provides a *solar-calibrated approximation* of their behaviour — not a
 * magnetohydrodynamic simulation: active-region emergence statistics, a
 * growth/decay lifecycle, latitude-dependent (differential) rotation, and
 * temperature-derived contrast. All lengths are SI; angles in radians.
 *
 * The emergence *rate*, region *multiplicity* and latitude belt are supplied by
 * {@link spotActivityModel} (the Rossby-number activity model), so a single
 * active region is planned from those statistics plus a seeded RNG.
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

/** Default penumbral area of the largest spots, as a fraction of the photospheric surface area. */
export const MAX_SPOT_AREA_FRACTION = 2.2e-4
/** Umbra ≈ 0.66·T_eff (Sun: ~3810 K) and penumbra ≈ 0.87·T_eff (Sun: ~5020 K). */
const UMBRA_TEMPERATURE_RATIO = 0.66
const PENUMBRA_TEMPERATURE_RATIO = 0.87

/**
 * Base active-region area scale. A region's penumbral area is
 * `BASE · 10^u · activity · surfaceArea` with u ∈ [0, 1), giving a geometric
 * spread of small groups to rare large ones (arithmetic mean ≈ 3.8× the base).
 * Calibrated so the Sun at solar maximum covers ~0.2–0.3 % of the photosphere.
 */
const BASE_REGION_AREA_FRACTION = 5.5e-5

/** Smallest spot lifetime, days. */
const MIN_SPOT_LIFETIME_DAYS = 0.5
/** Additional lifetime at maximum size, days. */
const SPOT_LIFETIME_SPAN_DAYS = 29.5

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

/** Statistics and geometry needed to plan one active region. */
export interface SpotPlanOptions {
  /** Emergence level in [0, 1]; scales region rate and area. */
  activity: number
  /** Photospheric surface area, m². */
  surfaceArea: number
  /** Largest single penumbral area as a fraction of the surface area. */
  maxSpotAreaFraction: number
  /** Mean number of individual spots per active region. */
  meanSpotsPerRegion: number
  /** Active-belt centre latitude, radians. */
  beltCenterLatitude: number
  /** Active-belt half-width, radians. */
  beltHalfWidth: number
}

/** Latitude beyond which we don't place ordinary solar-type spots. */
const MAX_SPOT_LATITUDE = 80 * DEG_TO_RAD

/**
 * Plan one active region from a seeded RNG. A region is a bipolar group: a
 * dominant leading spot plus a scatter of trailing spots and small pores, all
 * within a few degrees of the active-latitude belt. Larger spots live longer.
 */
export function planRegion(random: () => number, options: SpotPlanOptions): PlannedSpot[] {
  const activity = clamp(options.activity, 0, 1)
  const hemisphere = random() < 0.5 ? -1 : 1
  const centerLatitude = options.beltCenterLatitude + (random() * 2 - 1) * options.beltHalfWidth
  const baseLatitude = clamp(hemisphere * centerLatitude, -MAX_SPOT_LATITUDE, MAX_SPOT_LATITUDE)
  const baseLongitude = 2 * Math.PI * random()

  // Group multiplicity: roughly `meanSpotsPerRegion`, from a small region up to
  // a complex one. Always at least one spot.
  const count = Math.max(1, Math.round(options.meanSpotsPerRegion * (0.4 + 1.2 * random())))

  // Total penumbral area of the region, geometric in the region size.
  const maxAreaFraction = options.maxSpotAreaFraction
  const regionAreaFraction = clamp(
    BASE_REGION_AREA_FRACTION * 10 ** random() * activity,
    0,
    maxAreaFraction * count,
  )
  const regionArea = regionAreaFraction * options.surfaceArea

  // Distribute area with a top-heavy weight so each group has one or two large
  // spots and a scatter of pores.
  const weights: number[] = []
  let weightSum = 0
  for (let i = 0; i < count; i++) {
    const weight = 0.08 + random() * random() * 1.2
    weights.push(weight)
    weightSum += weight
  }

  const span = (3 + 1.2 * count) * DEG_TO_RAD
  const spots: PlannedSpot[] = []
  for (let i = 0; i < count; i++) {
    const weight = weights[i] ?? 0
    const area = weightSum > 0 ? regionArea * (weight / weightSum) : 0
    const maxArea = Math.min(area, maxAreaFraction * options.surfaceArea)
    const sizeRank = clamp(maxArea / (maxAreaFraction * options.surfaceArea), 0, 1)

    const latitude = clamp(
      baseLatitude + (random() * 2 - 1) * 2.5 * DEG_TO_RAD,
      -MAX_SPOT_LATITUDE,
      MAX_SPOT_LATITUDE,
    )
    const longitude = baseLongitude + (random() - 0.5) * span

    // Pores (small spots) are mostly umbra; large spots have a proper penumbra.
    const umbraFraction = clamp(0.34 + 0.14 * random() + (1 - sizeRank) * 0.28, 0.32, 1)
    const lifetimeScale = Math.sqrt(sizeRank)
    const lifetimeSeconds = (MIN_SPOT_LIFETIME_DAYS + SPOT_LIFETIME_SPAN_DAYS * lifetimeScale) * SECONDS_PER_DAY

    spots.push({ latitude, longitude, maxArea, lifetimeSeconds, umbraFraction })
  }

  return spots
}

/**
 * Multiplier that keeps the total photospheric flux roughly constant as spotted
 * area grows. `coverage` is the spotted fraction of the surface and
 * `meanSpotRadiance` the area-averaged spot radiance ratio.
 */
export function surfaceFluxCompensation(coverage: number, meanSpotRadiance: number): number {
  const deficit = clamp(coverage, 0, 0.5) * (1 - clamp(meanSpotRadiance, 0, 1))
  return 1 / Math.max(1 - deficit, 1e-3)
}
