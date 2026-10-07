import { describe, expect, it } from 'vitest'
import { checkConsistency, solveStar } from '@/physics/solver'
import { STAR_TYPES } from '@/physics/starTypes'
import {
  densityFromMassRadius,
  luminosityFromRadiusTemperature,
  SOLAR_LUMINOSITY,
  SOLAR_MASS,
  SOLAR_RADIUS,
} from '@/physics/relations'
import type { StarInputs } from '@/types/star'

const MS = STAR_TYPES['main-sequence']
const NS = STAR_TYPES['neutron-star']

function inputs(overrides: Partial<StarInputs> = {}): StarInputs {
  return {
    mass: SOLAR_MASS,
    radius: SOLAR_RADIUS,
    density: 1408,
    temperature: 5772,
    luminosity: SOLAR_LUMINOSITY,
    magneticField: 1,
    ...overrides,
  }
}

describe('solveStar — model mode', () => {
  it('reproduces the Sun from its mass alone', () => {
    const stats = solveStar({ type: MS, mode: 'model', inputs: inputs(), ageFraction: 0 })
    expect(stats.radius / SOLAR_RADIUS).toBeCloseTo(1, 2)
    expect(stats.luminosity / SOLAR_LUMINOSITY).toBeCloseTo(1, 2)
    expect(stats.temperature).toBeCloseTo(5772, 0)
    expect(stats.density).toBeCloseTo(1408, -2)
  })

  it('ignores unrelated radius/temperature inputs', () => {
    const a = solveStar({ type: MS, mode: 'model', inputs: inputs(), ageFraction: 0 })
    const b = solveStar({
      type: MS,
      mode: 'model',
      inputs: inputs({ radius: 5 * SOLAR_RADIUS, temperature: 30000 }),
      ageFraction: 0,
    })
    expect(b.radius).toBeCloseTo(a.radius, 6)
    expect(b.temperature).toBeCloseTo(a.temperature, 6)
  })

  it('scales luminosity as M^3.5', () => {
    const stats = solveStar({ type: MS, mode: 'model', inputs: inputs({ mass: 2 * SOLAR_MASS }), ageFraction: 0 })
    expect(stats.luminosity / SOLAR_LUMINOSITY).toBeCloseTo(2 ** 3.5, 3)
  })

  it('brightens and reddens with age', () => {
    const young = solveStar({ type: MS, mode: 'model', inputs: inputs(), ageFraction: 0 })
    const old = solveStar({ type: MS, mode: 'model', inputs: inputs(), ageFraction: 1 })
    expect(old.luminosity).toBeGreaterThan(young.luminosity)
    expect(old.temperature).toBeLessThan(young.temperature)
    expect(old.radius).toBeGreaterThan(young.radius)
  })

  it('derives neutron-star luminosity from the blackbody relation, not M^3.5', () => {
    const input = inputs({ mass: 1.4 * SOLAR_MASS, radius: 11_000, temperature: 6e5 })
    const stats = solveStar({ type: NS, mode: 'model', inputs: input, ageFraction: 0 })
    expect(stats.luminosity).toBeCloseTo(luminosityFromRadiusTemperature(11_000, 6e5), 6)
    expect(stats.density).toBeCloseTo(densityFromMassRadius(1.4 * SOLAR_MASS, 11_000), 6)
    // A main-sequence relation would give a wildly different value.
    expect(stats.luminosity).toBeLessThan(1e26)
  })
})

describe('solveStar — sandbox mode', () => {
  it('quadruples luminosity when radius doubles at fixed temperature', () => {
    const l1 = solveStar({ type: MS, mode: 'sandbox', inputs: inputs(), ageFraction: 0 }).luminosity
    const l2 = solveStar({
      type: MS,
      mode: 'sandbox',
      inputs: inputs({ radius: 2 * SOLAR_RADIUS }),
      ageFraction: 0,
    }).luminosity
    expect(l2 / l1).toBeCloseTo(4, 6)
  })

  it('derives density and luminosity from mass, radius and temperature', () => {
    const stats = solveStar({
      type: MS,
      mode: 'sandbox',
      inputs: inputs({ radius: 2 * SOLAR_RADIUS, temperature: 4000 }),
      ageFraction: 0,
    })
    expect(stats.density).toBeCloseTo(densityFromMassRadius(SOLAR_MASS, 2 * SOLAR_RADIUS), 6)
    expect(stats.luminosity).toBeCloseTo(luminosityFromRadiusTemperature(2 * SOLAR_RADIUS, 4000), 6)
  })

  it('produces a consistent state', () => {
    const stats = solveStar({ type: MS, mode: 'sandbox', inputs: inputs(), ageFraction: 0 })
    const report = checkConsistency(stats)
    expect(report.densityConsistent).toBe(true)
    expect(report.luminosityConsistent).toBe(true)
  })
})

describe('solveStar — free mode', () => {
  it('passes inputs through unchanged', () => {
    const input = inputs({ radius: 3 * SOLAR_RADIUS, density: 999, luminosity: 123, temperature: 8000 })
    const stats = solveStar({ type: MS, mode: 'free', inputs: input, ageFraction: 0 })
    expect(stats.radius).toBe(input.radius)
    expect(stats.density).toBe(input.density)
    expect(stats.luminosity).toBe(input.luminosity)
    expect(stats.temperature).toBe(input.temperature)
  })

  it('reports inconsistent density and luminosity', () => {
    const stats = solveStar({
      type: MS,
      mode: 'free',
      inputs: inputs({ radius: 3 * SOLAR_RADIUS, density: 1, luminosity: 1, temperature: 8000 }),
      ageFraction: 0,
    })
    const report = checkConsistency(stats)
    expect(report.densityConsistent).toBe(false)
    expect(report.luminosityConsistent).toBe(false)
  })
})
