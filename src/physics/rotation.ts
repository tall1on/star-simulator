import { GRAVITATIONAL_CONSTANT, SECONDS_PER_DAY, clamp } from '@/physics/relations'

/** Rotation parameter at which material at the equator becomes unbound (breakup). */
const MASS_SHEDDING_Q = 0.8

export interface RotationShape {
  /** Angular velocity in rad/s. */
  angularVelocity: number
  /**
   * Rotation parameter q = Ω²R³ / (GM). Equivalently, using ρ = 3M/4πR³,
   *   q = 3Ω² / (4πGρ)
   * so the flattening depends on rotation **and** density: a low-density star
   * deforms far more for the same spin.
   */
  rotationParameter: number
  /** Flattening f = (R_eq − R_pole) / R_eq, in 0…0.6. */
  flattening: number
  /** True when q exceeds the mass-shedding limit (the star would shed material). */
  atBreakup: boolean
}

/**
 * Rotational oblateness from real physics.
 *
 * The centrifugal-to-gravitational balance is captured by the rotation
 * parameter q = Ω²R³/(GM). For a rotating fluid body the flattening is
 * approximately f ≈ (5/4)·q to first order; we use that and clamp it, since the
 * first-order form over-predicts near breakup. This is a plausibility model, not
 * a numerical Roche/Maclaurin solution.
 */
export function rotationShape(rotationPeriodDays: number, density: number): RotationShape {
  const periodSeconds = Math.max(rotationPeriodDays * SECONDS_PER_DAY, 1e-6)
  const angularVelocity = (2 * Math.PI) / periodSeconds
  const rotationParameter =
    (3 * angularVelocity * angularVelocity) /
    (4 * Math.PI * GRAVITATIONAL_CONSTANT * Math.max(density, Number.EPSILON))

  return {
    angularVelocity,
    rotationParameter,
    flattening: clamp(1.25 * rotationParameter, 0, 0.6),
    atBreakup: rotationParameter >= MASS_SHEDDING_Q,
  }
}

/**
 * Equatorial and polar radius factors for a volumetrically-normalised oblate
 * spheroid of flattening `flattening`, i.e. R_eq/R and R_pole/R with the volume
 * held equal to that of a sphere of radius R.
 */
export function oblatenessFactors(flattening: number): { equatorial: number; polar: number } {
  const f = clamp(flattening, 0, 0.9)
  return {
    equatorial: (1 - f) ** (-1 / 3),
    polar: (1 - f) ** (2 / 3),
  }
}
