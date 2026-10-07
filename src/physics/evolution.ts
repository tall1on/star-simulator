import type { StarStats } from '@/types/star'
import {
  clamp,
  densityFromMassRadius,
  mainSequenceLifetimeYears,
  SOLAR_MASS,
  temperatureFromLuminosityRadius,
} from '@/physics/relations'

/**
 * Simplified, mass-dependent main-sequence evolution track.
 *
 * Everything is expressed as a fraction of the star's main-sequence lifetime.
 * More massive stars swell more and redden more than low-mass stars, and the
 * star brightens monotonically. Temperature is then derived from the evolved
 * luminosity and radius through the Stefan-Boltzmann relation, so it changes
 * consistently instead of being interpolated independently.
 *
 * This is a plausibility model for visualisation, not a stellar-structure
 * calculation. It is intentionally monotonic and bounded.
 */

/** How much brighter the star becomes by the end of the main sequence. */
function brightnessGain(massSolar: number): number {
  return clamp(0.6 + 0.9 * Math.log10(massSolar + 0.3), 0.25, 4)
}

/** How much the radius swells by the end of the main sequence. */
function radiusGrowth(massSolar: number): number {
  return clamp(0.6 + 0.7 * Math.log10(massSolar + 0.3), 0.2, 3)
}

export function ageFractionFor(base: StarStats, ageYears: number): number {
  const lifetime = mainSequenceLifetimeYears(base.mass)
  return clamp(ageYears / lifetime, 0, 1)
}

export function evolveMainSequence(base: StarStats, ageFraction: number): StarStats {
  const f = clamp(ageFraction, 0, 1)
  const massSolar = base.mass / SOLAR_MASS

  const radius = base.radius * (1 + f * radiusGrowth(massSolar))
  const luminosity = base.luminosity * (1 + f * brightnessGain(massSolar))
  const temperature = temperatureFromLuminosityRadius(luminosity, radius)
  const density = densityFromMassRadius(base.mass, radius)

  return {
    mass: base.mass,
    radius,
    density,
    luminosity,
    temperature,
    magneticField: base.magneticField,
  }
}
