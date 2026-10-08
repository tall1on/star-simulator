import type { StarTypeId } from '@/types/star'

/**
 * Field-line topology class. Closed loops are the smooth background dipole;
 * bundles are localised loops anchored at evolving bipolar regions; open lines
 * are dragged into a Parker spiral; ejecta are transient escaping structures.
 */
export type FieldLineKind = 'closed' | 'open' | 'bundle' | 'ejecta'

/**
 * Which reduced-order magnetosphere model applies to a star. This selects the
 * *drivers* (differential rotation + turbulent surface motion vs. localised
 * shear events); the rendering pool is shared so switching regime never snaps
 * the geometry.
 */
export type MagnetosphereRegime = 'convective' | 'radiative' | 'compact'

/**
 * Full input state for the magnetosphere simulation. All values are SI or in
 * the physical units named below; the simulation converts to SI internally.
 */
export interface MagnetosphereConfig {
  /** Master switch; when false the field holds its current shape. */
  enabled: boolean
  /** When false the simulation is paused (the rigid spin is also frozen). */
  running: boolean
  /** Playback acceleration: simulated days advanced per real second. */
  timeScaleDaysPerSecond: number
  /** Surface field strength in gauss (characteristic amplitude). */
  fieldStrength: number
  /** Stellar wind speed in km/s. */
  windSpeed: number
  /** Mass-loss rate in solar masses per year. */
  massLossRate: number
  /** Equatorial rotation period in days. */
  rotationPeriod: number
  /** Dipole tilt in degrees relative to the rotation axis. */
  tilt: number
  /** Star radius in metres. */
  radius: number
  /** Effective surface temperature in kelvin (selects the regime). */
  temperature: number
  typeId: StarTypeId
  /** Activity level 0…1 driving region emergence, forcing and compact events. */
  activity: number
  regime: MagnetosphereRegime
  /**
   * When true, simulated time is temporarily slowed while a reconnection or
   * eruption is in flight so the fast event stays visible. Clearly a playback
   * control (no hidden amplification of displacement or energy).
   */
  eventFocus: boolean
}

/** Live, throttled diagnostics surfaced to the UI. */
export interface MagnetosphereDiagnostics {
  /** Largest absolute torsional displacement of a closed/bundle loop, radians. */
  maxTwist: number
  /** Largest absolute Parker winding of an open line, radians. */
  maxOpenWinding: number
  /** Alfvén crossing time of the longest closed loop, seconds. */
  alfvenCrossingSeconds: number
  /** Active lines currently rendered (closed + bundles + ejecta + open). */
  lineCount: number
  /** Open lines currently represented. */
  openLineCount: number
  /** Evolving bipolar magnetic regions currently alive. */
  regions: number
  /** Dynamic flux-tube bundles currently alive. */
  bundles: number
  /** Cumulative reconnectivity events since reset. */
  reconnections: number
  /** Cumulative confined flares (no ejecta) since reset. */
  flares: number
  /** Cumulative eruptive events (with ejecta) since reset. */
  eruptions: number
  /** Ejecta structures currently in flight. */
  activeEjecta: number
  /** Free magnetic energy currently stored in stressed bundles, J. */
  freeEnergy: number
  /** Cumulative magnetic energy released by reconnection, J. */
  releasedEnergy: number
  /** Magnetic pressure at the surface field strength, Pa. */
  magneticPressure: number
  /** Wind ram pressure at one stellar radius, Pa. */
  windRamPressure: number
  /** Plasma beta at the surface field strength. */
  plasmaBeta: number
  /** Modelled confinement radius, metres. */
  confinementRadiusMetres: number
  /** Simulated time elapsed since reset, days. */
  elapsedDays: number
  regime: MagnetosphereRegime
  /** Whether differential rotation drives the closed footpoints. */
  differentialRotation: boolean
  /** True when the open field extends beyond the light cylinder (flagged). */
  exceedsLightCylinder: boolean
}
