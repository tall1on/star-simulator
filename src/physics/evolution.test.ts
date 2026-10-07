import { describe, expect, it } from 'vitest'
import { ageFractionFor, evolveMainSequence } from '@/physics/evolution'
import type { StarStats } from '@/types/star'
import { SOLAR_LUMINOSITY, SOLAR_MASS, SOLAR_RADIUS } from '@/physics/relations'

function sun(): StarStats {
  return {
    mass: SOLAR_MASS,
    radius: SOLAR_RADIUS,
    density: 1408,
    luminosity: SOLAR_LUMINOSITY,
    temperature: 5772,
    magneticField: 1,
  }
}

describe('ageFractionFor', () => {
  it('is zero at zero age and one at the lifetime', () => {
    const base = sun()
    expect(ageFractionFor(base, 0)).toBe(0)
    expect(ageFractionFor(base, 1e10)).toBeCloseTo(1, 6)
  })

  it('clamps beyond the lifetime', () => {
    expect(ageFractionFor(sun(), 1e12)).toBe(1)
  })
})

describe('evolveMainSequence', () => {
  it('preserves mass', () => {
    const evolved = evolveMainSequence(sun(), 1)
    expect(evolved.mass).toBe(SOLAR_MASS)
  })

  it('increases luminosity monotonically with age', () => {
    const base = sun()
    const half = evolveMainSequence(base, 0.5).luminosity
    const full = evolveMainSequence(base, 1).luminosity
    expect(half).toBeGreaterThan(base.luminosity)
    expect(full).toBeGreaterThan(half)
  })

  it('increases radius and changes temperature', () => {
    const base = sun()
    const evolved = evolveMainSequence(base, 1)
    expect(evolved.radius).toBeGreaterThan(base.radius)
    expect(evolved.temperature).not.toBeCloseTo(base.temperature, 0)
    expect(evolved.temperature).toBeLessThan(base.temperature)
  })

  it('keeps density consistent with the evolved radius', () => {
    const evolved = evolveMainSequence(sun(), 1)
    const expected = evolved.mass / ((4 / 3) * Math.PI * evolved.radius ** 3)
    expect(evolved.density).toBeCloseTo(expected, 6)
  })

  it('grows more massive stars more than low-mass stars', () => {
    const high: StarStats = { ...sun(), mass: 10 * SOLAR_MASS }
    const low: StarStats = { ...sun(), mass: 0.2 * SOLAR_MASS }
    const highGrowth = evolveMainSequence(high, 1).radius / high.radius
    const lowGrowth = evolveMainSequence(low, 1).radius / low.radius
    expect(highGrowth).toBeGreaterThan(lowGrowth)
  })
})
