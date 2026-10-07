import type { ConsistencyReport, ConstraintMode, StarInputs, StarStats, StarType } from '@/types/star'
import {
  clamp,
  densityFromMassRadius,
  luminosityFromRadiusTemperature,
  mainSequenceLuminosity,
  mainSequenceRadius,
  mainSequenceTemperature,
  temperatureFromLuminosityRadius,
} from '@/physics/relations'
import { evolveMainSequence } from '@/physics/evolution'

export interface SolveInput {
  type: StarType
  mode: ConstraintMode
  inputs: StarInputs
  ageFraction: number
}

/**
 * Single authoritative place where the editable inputs are turned into a
 * physically consistent {@link StarStats}. Every store setter funnels through
 * this, which removes the earlier class of bugs where derived values drifted
 * out of sync with `baseStats` and then got overwritten by the aging pass.
 */
export function solveStar({ type, mode, inputs, ageFraction }: SolveInput): StarStats {
  const mass = inputs.mass
  const magneticField = inputs.magneticField

  if (mode === 'free') {
    return {
      mass,
      radius: inputs.radius,
      density: inputs.density,
      luminosity: inputs.luminosity,
      temperature: inputs.temperature,
      magneticField,
    }
  }

  if (mode === 'sandbox') {
    return {
      mass,
      radius: inputs.radius,
      density: densityFromMassRadius(mass, inputs.radius),
      luminosity: luminosityFromRadiusTemperature(inputs.radius, inputs.temperature),
      temperature: inputs.temperature,
      magneticField,
    }
  }

  // model mode
  const base = zeroAgeBase(type, inputs)
  const evolved = type.canAge ? evolveMainSequence(base, ageFraction) : base
  return { ...evolved, magneticField }
}

/**
 * Zero-age configuration for the stellar-model view. For hydrogen-fusing
 * stars radius, temperature and luminosity all follow from the mass through the
 * mass–luminosity, mass–radius and Stefan-Boltzmann relations. For compact
 * objects, radius and temperature are observational inputs and luminosity
 * follows from the blackbody relation.
 */
function zeroAgeBase(type: StarType, inputs: StarInputs): StarStats {
  if (type.canAge) {
    const radius = mainSequenceRadius(inputs.mass)
    const luminosity = mainSequenceLuminosity(inputs.mass)
    return {
      mass: inputs.mass,
      radius,
      density: densityFromMassRadius(inputs.mass, radius),
      luminosity,
      temperature: mainSequenceTemperature(inputs.mass),
      magneticField: inputs.magneticField,
    }
  }

  const radius = inputs.radius
  const temperature = inputs.temperature
  return {
    mass: inputs.mass,
    radius,
    density: densityFromMassRadius(inputs.mass, radius),
    luminosity: luminosityFromRadiusTemperature(radius, temperature),
    temperature,
    magneticField: inputs.magneticField,
  }
}

/**
 * Reports how far a stats object deviates from the two hard constraints
 * ρ = 3M/4πR³ and L = 4πR²σT⁴. Used to surface warnings in `free` mode.
 */
export function checkConsistency(stats: StarStats): ConsistencyReport {
  const expectedDensity = densityFromMassRadius(stats.mass, stats.radius)
  const expectedLuminosity = luminosityFromRadiusTemperature(stats.radius, stats.temperature)

  const densityRatio = stats.density / expectedDensity
  const luminosityRatio = stats.luminosity / expectedLuminosity

  return {
    densityConsistent: Math.abs(Math.log10(clamp(densityRatio, 1e-30, 1e30))) < 0.05,
    luminosityConsistent: Math.abs(Math.log10(clamp(luminosityRatio, 1e-30, 1e30))) < 0.05,
    expectedDensity,
    expectedLuminosity,
  }
}

/** Convenience for the sandbox: temperature implied by a luminosity and radius. */
export function temperatureForLuminosity(luminosity: number, radius: number): number {
  return temperatureFromLuminosityRadius(luminosity, radius)
}
