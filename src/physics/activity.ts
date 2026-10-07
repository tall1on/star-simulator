import type { StarStats, StarTypeId } from '@/types/star'
import { GRAVITATIONAL_CONSTANT, SOLAR_MASS, SOLAR_RADIUS, clamp } from '@/physics/relations'

/**
 * Stellar magnetic-activity / spot-population model.
 *
 * This is a *solar-calibrated approximation*, not a dynamo simulation. It uses
 * the canonical rotation–activity framework — the Rossby number
 * `Ro = P_rot / τ_conv` — to estimate how many active regions a star carries and
 * how much of its photosphere they cover. The Sun at solar maximum is the
 * reference (activity = 1): roughly ten groups and several tens of individual
 * spots, i.e. a Wolf sunspot number of order 150–200.
 *
 * References / assumptions:
 * - `τ_conv(Sun) ≈ 10.4 d` and the Rossby-number saturation picture follow
 *   Noyes et al. (1984), ApJ 279, 763. The mass/gravity scalings are rough fits
 *   to that data, not first-principles values.
 * - Sunspot emergence, group multiplicity and area distributions are
 *   solar-calibrated; they are not MHD predictions for other stars.
 */

/** Above this temperature the convective envelope is too shallow for spots. */
const MAX_SPOT_TEMPERATURE = 8000
/** Solar convective turnover time, days (Noyes et al. 1984). */
const SUN_TURNOVER_DAYS = 10.4
/** Solar rotation period used as the activity reference, days. */
const SUN_REFERENCE_ROTATION_DAYS = 25
/** Solar surface gravity, m/s². */
const SOLAR_GRAVITY = (GRAVITATIONAL_CONSTANT * SOLAR_MASS) / SOLAR_RADIUS ** 2
/** Gravity below this fraction of solar marks an evolved (giant) convective envelope. */
const GIANT_GRAVITY_FRACTION = 0.2
/** Rotation–activity power-law index (activity ∝ Ro^-β), roughly Noyes et al. */
const ACTIVITY_EXPONENT = 0.8

const DEG_TO_RAD = Math.PI / 180

export type ActivityRegime = 'solar-like' | 'active-dwarf' | 'giant' | 'radiative' | 'compact'

/** Active-latitude belt (centre and half-width, radians). */
export interface LatitudeBelt {
  center: number
  halfWidth: number
}

/**
 * Population statistics for a star's magnetic spots. `supported` is false for
 * objects that cannot host ordinary starspots (hot radiative envelopes and
 * compact objects).
 */
export interface SpotActivityModel {
  supported: boolean
  regime: ActivityRegime
  /** Convective turnover time, days. */
  turnoverDays: number
  /** Rossby number Ro = P_rot / τ_conv. */
  rossbyNumber: number
  /** Rotation–activity level relative to the Sun at solar maximum, in [0.03, 1]. */
  relativeActivity: number
  /** Active regions (groups) emerging per simulated day at full activity. */
  regionsPerDayAtMax: number
  /** Mean number of individual spots per active region. */
  meanSpotsPerRegion: number
  /** Mean active-region lifetime, days (used only for steady-state estimates). */
  meanRegionLifetimeDays: number
  /** Largest single penumbral area, as a fraction of the photospheric area. */
  maxSpotAreaFraction: number
  /** Time-averaged spotted area fraction at full activity. */
  maxCoverage: number
  /** Active-latitude belt for the current cycle phase, radians. */
  belt: LatitudeBelt
}

const UNSUPPORTED: SpotActivityModel = {
  supported: false,
  regime: 'radiative',
  turnoverDays: 0,
  rossbyNumber: 0,
  relativeActivity: 0,
  regionsPerDayAtMax: 0,
  meanSpotsPerRegion: 0,
  meanRegionLifetimeDays: 0,
  maxSpotAreaFraction: 0,
  maxCoverage: 0,
  belt: { center: 0, halfWidth: 0 },
}

/**
 * Convective turnover time, days. Dwarfs scale with mass (deeper envelopes at
 * lower mass); evolved giants use a surface-gravity scaling because their
 * envelopes are physically much larger than a main-sequence star's.
 */
export function convectiveTurnoverDays(stats: StarStats): number {
  const radius = Math.max(stats.radius, 1)
  const gravity = (GRAVITATIONAL_CONSTANT * stats.mass) / radius ** 2

  if (gravity < GIANT_GRAVITY_FRACTION * SOLAR_GRAVITY) {
    return clamp(SUN_TURNOVER_DAYS * Math.sqrt(SOLAR_GRAVITY / gravity), 30, 400)
  }

  return clamp(SUN_TURNOVER_DAYS * (stats.mass / SOLAR_MASS) ** -1.5, 4, 60)
}

/**
 * Active-latitude belt for a cycle phase in [0, 1]. On the Sun, active regions
 * first appear near ~30° latitude and migrate equatorward through the cycle
 * (the "butterfly diagram"); evolved stars can carry higher-latitude spots.
 */
export function activeLatitudeBelt(cyclePhase: number, regime: ActivityRegime): LatitudeBelt {
  const phase = clamp(cyclePhase, 0, 1)

  if (regime === 'giant') {
    return { center: (25 + 30 * phase) * DEG_TO_RAD, halfWidth: 28 * DEG_TO_RAD }
  }

  return { center: (30 - 25 * phase) * DEG_TO_RAD, halfWidth: 7 * DEG_TO_RAD }
}

/**
 * Whether a star can host solar-type spots: a main-sequence object with a
 * convective envelope and a cool-enough photosphere.
 */
export function activitySupported(stats: StarStats, typeId: StarTypeId): boolean {
  return typeId === 'main-sequence' && stats.temperature <= MAX_SPOT_TEMPERATURE
}

/**
 * Build the spot-population model for a star. `cyclePhase` selects a point in
 * the (not yet evolved) activity cycle, 0 = cycle start (high latitude), 1 =
 * cycle end (equator).
 */
export function spotActivityModel(
  stats: StarStats,
  typeId: StarTypeId,
  rotationPeriodDays: number,
  cyclePhase: number,
): SpotActivityModel {
  if (typeId === 'neutron-star') {
    return { ...UNSUPPORTED, regime: 'compact' }
  }

  if (!activitySupported(stats, typeId)) {
    return { ...UNSUPPORTED, regime: 'radiative' }
  }

  const turnoverDays = convectiveTurnoverDays(stats)
  const period = Math.max(rotationPeriodDays, 1e-3)
  const rossbyNumber = period / turnoverDays
  const solarRossby = SUN_REFERENCE_ROTATION_DAYS / SUN_TURNOVER_DAYS
  const relativeActivity = clamp(
    (solarRossby / Math.max(rossbyNumber, 1e-3)) ** ACTIVITY_EXPONENT,
    0.03,
    1,
  )

  const radius = Math.max(stats.radius, 1)
  const gravity = (GRAVITATIONAL_CONSTANT * stats.mass) / radius ** 2
  const giant = gravity < GIANT_GRAVITY_FRACTION * SOLAR_GRAVITY

  const regime: ActivityRegime = giant
    ? 'giant'
    : stats.temperature < 5000 && relativeActivity > 0.7
      ? 'active-dwarf'
      : 'solar-like'

  const belt = activeLatitudeBelt(cyclePhase, regime)

  if (regime === 'giant') {
    // Evolved cool stars: fewer, much larger, longer-lived spots (RS CVn-like).
    return {
      supported: true,
      regime,
      turnoverDays,
      rossbyNumber,
      relativeActivity,
      regionsPerDayAtMax: 0.25,
      meanSpotsPerRegion: 4,
      meanRegionLifetimeDays: 20,
      maxSpotAreaFraction: 8e-4,
      maxCoverage: 0.02,
      belt,
    }
  }

  return {
    supported: true,
    regime,
    turnoverDays,
    rossbyNumber,
    relativeActivity,
    regionsPerDayAtMax: 1,
    meanSpotsPerRegion: 6,
    meanRegionLifetimeDays: 11,
    maxSpotAreaFraction: 2.2e-4,
    maxCoverage: 0.002,
    belt,
  }
}

/**
 * Steady-state estimate of the number of spots and groups currently visible,
 * from the emergence rate and the mean lifetime. `activity` is the effective
 * emergence level in [0, 1].
 */
export function expectedSpotCounts(
  model: SpotActivityModel,
  activity: number,
): { groups: number; spots: number } {
  const level = clamp(activity, 0, 1)
  const groups = model.regionsPerDayAtMax * level * model.meanRegionLifetimeDays
  const spots = groups * model.meanSpotsPerRegion
  return { groups, spots }
}

/**
 * Estimated Wolf sunspot number `R = Ns + 10·Ng` for the current activity. This
 * mirrors the SILSO counting convention (individual spots plus ten per group)
 * and is a display estimate, not a calibrated stellar index.
 */
export function estimateSunspotNumber(model: SpotActivityModel, activity: number): number {
  const { groups, spots } = expectedSpotCounts(model, activity)
  return spots + 10 * groups
}
