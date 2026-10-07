/** A single, lifecycle-resolved sunspot. */
export interface Sunspot {
  /** Unique spot id. */
  id: number
  /** Bipolar active region this spot belongs to (spots in one region share it). */
  regionId: number
  /** Heliographic latitude, radians (signed; positive = northern hemisphere). */
  latitude: number
  /**
   * Heliographic longitude, radians. Mutated in place as the spot is carried
   * around by latitude-dependent (differential) rotation.
   */
  longitude: number
  /** Simulated time of emergence, seconds since the surface epoch. */
  birthSeconds: number
  /** Total lifetime, seconds. */
  lifetimeSeconds: number
  /** Penumbral (incl. umbral) area at maximum, m². */
  maxArea: number
  /** Umbra angular radius / penumbra angular radius, 0…1. */
  umbraFraction: number
}

/** Controls for the independent sunspot surface clock. */
export interface SunspotConfig {
  /** Master switch; when false nothing is simulated or drawn. */
  enabled: boolean
  /** When false the clock is paused and nothing evolves. */
  running: boolean
  /**
   * Effective emergence level 0…1 (fraction of this star's activity maximum).
   * Already includes any auto/rotation scaling applied by the caller.
   */
  activity: number
  /** Simulated days advanced per real second. */
  speedDaysPerSecond: number
  /** Equatorial rotation period, days (from the wind store). */
  rotationPeriodDays: number
  /** Star radius, metres. */
  radius: number
  /** Star effective temperature, kelvin. */
  temperature: number
  /** Whether the current star supports solar-type spots. */
  supported: boolean
  /** Active regions emerging per day at full activity (from the activity model). */
  regionsPerDayAtMax: number
  /** Mean number of individual spots per active region. */
  meanSpotsPerRegion: number
  /** Largest single penumbral area, as a fraction of the photospheric area. */
  maxSpotAreaFraction: number
  /** Active-belt centre latitude, radians. */
  beltCenterLatitude: number
  /** Active-belt half-width, radians. */
  beltHalfWidth: number
}

/** Flattened per-spot data handed to the render layer. */
export interface SunspotRenderData {
  /** Surface direction (unit vector, star space): x, y (pole), z. */
  direction: [number, number, number]
  /** Penumbral angular radius, radians. */
  angularRadius: number
  /** Umbra angular radius / penumbra angular radius, 0…1. */
  umbraFraction: number
  /** Facular (plage) angular radius, radians — a little larger than the penumbra. */
  plageAngularRadius: number
  /** Lifecycle opacity 0…1 (spot fades in as it emerges and out as it decays). */
  weight: number
}

/**
 * Number of spots the render layer can evaluate per frame. The shader's uniform
 * arrays and the runtime's render cap both use this, so they cannot drift apart.
 * Sized so a solar-maximum star (dozens of spots) renders most of its population
 * at once without an unbounded per-fragment loop.
 */
export const MAX_RENDERED_SUNSPOTS = 48
