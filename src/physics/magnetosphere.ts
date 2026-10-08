import type { StarTypeId } from '@/types/star'
import { SECONDS_PER_DAY } from '@/physics/relations'
import { angularVelocityAtLatitude } from '@/physics/sunspots'
import type { MagnetosphereRegime } from '@/types/magnetosphere'

/**
 * Reduced-order magnetosphere physics.
 *
 * This module supplies the *formulas* used by the magnetosphere simulation: the
 * Alfvén speed, the light-cylinder scale, the Parker winding of an open field
 * line and the relative footpoint shear rate of a closed loop. It is not an MHD
 * solver. Where a quantity is not derivable from the star's defining properties
 * (e.g. the coronal plasma density), a documented, order-of-magnitude assumption
 * is used and called out explicitly.
 */

/** Vacuum permeability μ₀ = 4π×10⁻⁷ N·A⁻². */
export const VACUUM_PERMEABILITY = 4e-7 * Math.PI
/** Speed of light in vacuum, exact, m/s. */
export const SPEED_OF_LIGHT = 299_792_458
/** 1 gauss = 10⁻⁴ tesla. */
export const GAUSS_TO_TESLA = 1e-4

/**
 * Assumed density of the cool, closed coronal plasma for solar-type stars,
 * kg/m³. Order-of-magnitude value for closed loops (10⁹–10¹⁰ cm⁻³); used only
 * to set the Alfvén speed, and therefore the crossing time of a loop.
 */
export const CORONAL_PLASMA_DENSITY = 1e-12

/**
 * Assumed mass density of the plasma in a compact object's closed magnetosphere,
 * kg/m³. Order-of-magnitude placeholder for the (poorly known) charge-filled
 * closed zone; keeps the Alfvén speed below c.
 */
export const COMPACT_ZONE_DENSITY = 1e-6

/** Above this effective temperature spots/ordinary dynamo action stop. */
const MAX_CONVECTIVE_TEMPERATURE = 8000

/** Which reduced-order model applies to this star. */
export function magnetosphereRegime(typeId: StarTypeId, temperature: number): MagnetosphereRegime {
  if (typeId === 'neutron-star') return 'compact'
  return temperature <= MAX_CONVECTIVE_TEMPERATURE ? 'convective' : 'radiative'
}

/** Only convective envelopes support a solar-like differential rotation law. */
export function supportsDifferentialRotation(regime: MagnetosphereRegime): boolean {
  return regime === 'convective'
}

/** Plasma density assumed for a regime, kg/m³. */
export function plasmaDensityForRegime(regime: MagnetosphereRegime): number {
  return regime === 'compact' ? COMPACT_ZONE_DENSITY : CORONAL_PLASMA_DENSITY
}

/** Convert gauss to tesla. */
export function gaussToTesla(gauss: number): number {
  return gauss * GAUSS_TO_TESLA
}

/**
 * Alfvén speed v_A = B / √(μ₀ρ), m/s. Capped at c: the non-relativistic
 * expression is invalid once it would exceed the speed of light (strong-field
 * compact objects), and the cap keeps propagation causal.
 */
export function alfvenSpeed(fieldGauss: number, density: number): number {
  const field = gaussToTesla(Math.max(fieldGauss, 0))
  const rho = Math.max(density, Number.EPSILON)
  const speed = field / Math.sqrt(VACUUM_PERMEABILITY * rho)
  if (!Number.isFinite(speed)) return SPEED_OF_LIGHT
  return Math.min(speed, SPEED_OF_LIGHT)
}

/** Rigid angular velocity Ω = 2π/P, rad/s. */
export function angularVelocity(rotationPeriodDays: number): number {
  const period = Math.max(rotationPeriodDays, 1e-9) * SECONDS_PER_DAY
  return (2 * Math.PI) / period
}

/** Light-cylinder radius R_LC = c/Ω, metres. Beyond it the closed-dipole picture fails. */
export function lightCylinderRadiusMetres(rotationPeriodDays: number): number {
  return SPEED_OF_LIGHT / Math.max(angularVelocity(rotationPeriodDays), Number.EPSILON)
}

/**
 * Parker winding angle accumulated between the source radius and a field point:
 * Δφ = −(Ω/v)(r − r₀). Slower wind or faster rotation gives a tighter spiral.
 */
export function parkerWindingAngle(
  omega: number,
  windSpeedMs: number,
  radialDistanceMetres: number,
  sourceRadiusMetres: number,
): number {
  const speed = Math.max(windSpeedMs, 1)
  return -(omega / speed) * (radialDistanceMetres - sourceRadiusMetres)
}

/**
 * Relative azimuthal shear rate between two closed-loop footpoints, rad/s. With
 * differential rotation this is Ω(λ_B) − Ω(λ_A); equal-magnitude opposite
 * latitudes give exactly zero, so a symmetric dipole does not wind up by itself.
 */
export function footpointShearRate(
  rotationPeriodDays: number,
  latitudeA: number,
  latitudeB: number,
  differentialRotation: boolean,
): number {
  if (!differentialRotation) return 0
  return (
    angularVelocityAtLatitude(rotationPeriodDays, latitudeB) -
    angularVelocityAtLatitude(rotationPeriodDays, latitudeA)
  )
}

/** Alfvén crossing time of a field line of the given length, seconds. */
export function alfvenCrossingSeconds(lengthMetres: number, speed: number): number {
  return lengthMetres / Math.max(speed, Number.EPSILON)
}
