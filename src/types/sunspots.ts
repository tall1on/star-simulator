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
  /** Activity level 0…1, scaling emergence rate and spot size. */
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
}

/** Flattened per-spot data handed to the render layer. */
export interface SunspotRenderData {
  /** Surface direction (unit vector, star space): x, y (pole), z. */
  direction: [number, number, number]
  /** Penumbral angular radius, radians. */
  angularRadius: number
  /** Umbra angular radius / penumbra angular radius, 0…1. */
  umbraFraction: number
  /** Lifecycle opacity 0…1 (spot fades in as it emerges and out as it decays). */
  weight: number
}

/**
 * Number of spots the render layer can evaluate per frame. The shader's uniform
 * arrays and the runtime's render cap both use this, so they cannot drift apart.
 */
export const MAX_RENDERED_SUNSPOTS = 16
