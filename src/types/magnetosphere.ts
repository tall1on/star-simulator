import type { StarTypeId } from '@/types/star'

/**
 * Field-line topology class. Closed loops are anchored to the stellar surface
 * at both ends; open lines are dragged into a Parker spiral by the wind.
 */
export type FieldLineKind = 'closed' | 'active' | 'open'

/**
 * Which reduced-order magnetosphere model applies to a star. This only selects
 * the *drivers* (differential footpoint rotation vs. localised shear events);
 * the line topology is shared so switching regime never snaps the geometry.
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
  /** Surface field strength in gauss. */
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
  /** Activity level 0…1 driving active-region shear and compact shear events. */
  activity: number
  regime: MagnetosphereRegime
}

/** Live, throttled diagnostics surfaced to the UI. */
export interface MagnetosphereDiagnostics {
  /** Largest absolute torsional displacement of a closed/active loop, radians. */
  maxTwist: number
  /** Largest absolute Parker winding of an open line, radians. */
  maxOpenWinding: number
  /** Alfvén crossing time of the longest closed tube, seconds. */
  alfvenCrossingSeconds: number
  /** Number of simulated field lines (closed + active + open). */
  lineCount: number
  /** Open lines currently represented. */
  openLineCount: number
  /** Localised shear events still in flight (compact regime only). */
  shearEvents: number
  /** Simulated time elapsed since reset, days. */
  elapsedDays: number
  regime: MagnetosphereRegime
  /** Whether differential rotation drives the closed footpoints. */
  differentialRotation: boolean
  /** True when the open field extends beyond the light cylinder (flagged). */
  exceedsLightCylinder: boolean
}
