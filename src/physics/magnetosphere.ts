import type { StarTypeId } from '@/types/star'
import { SECONDS_PER_DAY, SECONDS_PER_YEAR, SOLAR_MASS } from '@/physics/relations'
import { angularVelocityAtLatitude } from '@/physics/sunspots'
import type { MagnetosphereRegime } from '@/types/magnetosphere'

/**
 * Reduced-order magnetosphere physics.
 *
 * This module supplies the *formulas* used by the magnetosphere simulation:
 * the Alfvén speed, light-cylinder and confinement scales, magnetic pressure
 * and tension, magnetic/plasma energy, and the Parker winding of an open field
 * line. It is not an MHD solver. Where a quantity is not derivable from the
 * star's defining properties (coronal density, plasma temperature) a documented,
 * order-of-magnitude assumption is used and called out explicitly.
 */

/** Vacuum permeability μ₀ = 4π×10⁻⁷ N·A⁻². */
export const VACUUM_PERMEABILITY = 4e-7 * Math.PI
/** Speed of light in vacuum, exact, m/s. */
export const SPEED_OF_LIGHT = 299_792_458
/** 1 gauss = 10⁻⁴ tesla. */
export const GAUSS_TO_TESLA = 1e-4
/** Boltzmann constant, J/K. */
export const BOLTZMANN_CONSTANT = 1.380649e-23
/** Proton mass, kg. */
export const PROTON_MASS = 1.67262192369e-27
/** Mean molecular weight of a fully ionised hydrogen–helium plasma. */
export const MEAN_MOLECULAR_WEIGHT = 0.6

/**
 * Assumed density of the cool, closed coronal plasma for solar-type stars,
 * kg/m³. Order-of-magnitude value (10⁹–10¹⁰ cm⁻³).
 */
export const CORONAL_PLASMA_DENSITY = 1e-12
/**
 * Assumed mass density of the plasma in a compact object's closed magnetosphere,
 * kg/m³. Order-of-magnitude placeholder that keeps the Alfvén speed below c.
 */
export const COMPACT_ZONE_DENSITY = 1e-6
/** Assumed coronal temperature, K, used for the plasma-pressure/beta estimate. */
export const ASSUMED_CORONAL_TEMPERATURE = 1.5e6

/** Above this effective temperature spots/ordinary dynamo action stop. */
const MAX_CONVECTIVE_TEMPERATURE = 8000

/**
 * Fraction of the local Alfvén speed at which reconnection proceeds. This is a
 * documented closure (fast Petschek-like rates are ~0.01–0.1); the released
 * energy is debited from the modelled magnetic-energy budget.
 */
export const RECONNECTION_RATE_FRACTION = 0.08

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

/** Magnetic pressure p_B = B²/(2μ₀), Pa. */
export function magneticPressure(fieldGauss: number): number {
  const field = gaussToTesla(Math.max(fieldGauss, 0))
  return (field * field) / (2 * VACUUM_PERMEABILITY)
}

/**
 * Magnetic tension force density B²/(μ₀R_c), N/m³, acting to straighten field
 * lines of curvature radius R_c.
 */
export function magneticTensionForceDensity(fieldGauss: number, curvatureRadiusMetres: number): number {
  const radius = Math.max(curvatureRadiusMetres, Number.EPSILON)
  return (magneticPressure(fieldGauss) * 2) / radius
}

/** Star mass-loss rate converted from M☉/yr to kg/s. */
export function massLossRateKgPerSecond(massLossSolarPerYear: number): number {
  return (Math.max(massLossSolarPerYear, 0) * SOLAR_MASS) / SECONDS_PER_YEAR
}

/** Steady spherical wind density ρ_w(r) = Ṁ / (4π r² v_w), kg/m³. */
export function windDensity(
  massLossSolarPerYear: number,
  windSpeedMs: number,
  radiusMetres: number,
): number {
  const mdot = massLossRateKgPerSecond(massLossSolarPerYear)
  const radius = Math.max(radiusMetres, Number.EPSILON)
  const speed = Math.max(windSpeedMs, 1)
  return mdot / (4 * Math.PI * radius * radius * speed)
}

/** Wind ram pressure ρ_w v_w² = Ṁ v_w / (4π r²), Pa. */
export function windRamPressure(
  massLossSolarPerYear: number,
  windSpeedMs: number,
  radiusMetres: number,
): number {
  const speed = Math.max(windSpeedMs, 1)
  return windDensity(massLossSolarPerYear, speed, radiusMetres) * speed * speed
}

/**
 * Coronal plasma pressure from the ideal-gas law p = ρ k_B T / (μ m_p), Pa,
 * using the documented coronal density and temperature assumptions.
 */
export function coronalPlasmaPressure(
  density: number = CORONAL_PLASMA_DENSITY,
  temperature: number = ASSUMED_CORONAL_TEMPERATURE,
): number {
  return (density * BOLTZMANN_CONSTANT * temperature) / (MEAN_MOLECULAR_WEIGHT * PROTON_MASS)
}

/** Plasma beta β = 2μ₀ p / B² = p / p_B. */
export function plasmaBeta(thermalPressure: number, fieldGauss: number): number {
  const pressure = magneticPressure(fieldGauss)
  if (pressure <= 0) return Number.POSITIVE_INFINITY
  return thermalPressure / pressure
}

/**
 * Radius where the radial dipole's magnetic pressure balances the wind ram
 * pressure: solving Ṁ v/(4π r²) = B₀²R⁶/(2μ₀ r⁶) gives
 * r⁴ = 2π B₀²R⁶ / (μ₀ Ṁ v). This is the modelled confinement radius; a stronger
 * field or weaker wind pushes it outward and lets closed fields extend further.
 * Clamped to a plausible range in star radii.
 */
export function confinementRadiusMetres(
  radiusMetres: number,
  fieldGauss: number,
  massLossSolarPerYear: number,
  windSpeedMs: number,
): number {
  const radius = Math.max(radiusMetres, Number.EPSILON)
  const field = gaussToTesla(Math.max(fieldGauss, 1e-9))
  const mdot = Math.max(massLossRateKgPerSecond(massLossSolarPerYear), 1e-30)
  const speed = Math.max(windSpeedMs, 1)
  const r4 =
    (2 * Math.PI * field * field * radius ** 6) / (VACUUM_PERMEABILITY * mdot * speed)
  const confinement = Number.isFinite(r4) && r4 > 0 ? r4 ** 0.25 : radius * 30
  return clampNumber(confinement, radius * 1.05, radius * 60)
}

/**
 * Free magnetic energy stored above the potential state for a sheared/twisted
 * tube, E ≈ p_B · V · (θ/θ_ref)², with θ the footpoint shear angle. This is the
 * reservoir debited by reconnection, not an absolute magnetohydrostatic energy.
 */
export function freeMagneticEnergy(
  fieldGauss: number,
  volumeMetres3: number,
  shearAngle: number,
  referenceShear = 1,
): number {
  const ratio = shearAngle / Math.max(referenceShear, Number.EPSILON)
  return magneticPressure(fieldGauss) * Math.max(volumeMetres3, 0) * ratio * ratio
}

/** Reconnection inflow/outflow rate as a fraction of the local Alfvén speed. */
export function reconnectionRate(alfven: number): number {
  return RECONNECTION_RATE_FRACTION * Math.max(alfven, 0)
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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
