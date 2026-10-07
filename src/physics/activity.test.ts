import { describe, expect, it } from 'vitest'
import {
  activeLatitudeBelt,
  convectiveTurnoverDays,
  estimateSunspotNumber,
  expectedSpotCounts,
  spotActivityModel,
} from '@/physics/activity'
import type { StarStats } from '@/types/star'
import { SOLAR_LUMINOSITY, SOLAR_MASS, SOLAR_RADIUS, SOLAR_TEMPERATURE } from '@/physics/relations'

function stats(overrides: Partial<StarStats> = {}): StarStats {
  return {
    mass: SOLAR_MASS,
    radius: SOLAR_RADIUS,
    density: 1408,
    luminosity: SOLAR_LUMINOSITY,
    temperature: SOLAR_TEMPERATURE,
    magneticField: 1,
    ...overrides,
  }
}

const DEG = Math.PI / 180

describe('convectiveTurnoverDays', () => {
  it('gives the Sun ~10 days', () => {
    expect(convectiveTurnoverDays(stats())).toBeCloseTo(10.4, 1)
  })

  it('gives low-mass dwarfs longer turnover times', () => {
    expect(convectiveTurnoverDays(stats({ mass: 0.2 * SOLAR_MASS }))).toBeGreaterThan(
      convectiveTurnoverDays(stats()),
    )
  })

  it('gives evolved giants long turnover times', () => {
    expect(convectiveTurnoverDays(stats({ radius: 100 * SOLAR_RADIUS, temperature: 4000 }))).toBeGreaterThan(30)
  })
})

describe('activeLatitudeBelt', () => {
  it('migrates equatorward through the solar cycle', () => {
    const start = activeLatitudeBelt(0, 'solar-like')
    const end = activeLatitudeBelt(1, 'solar-like')
    expect(start.center).toBeGreaterThan(end.center)
    expect(start.center).toBeCloseTo(30 * DEG, 6)
    expect(end.center).toBeCloseTo(5 * DEG, 6)
  })

  it('allows high-latitude spots on giants', () => {
    expect(activeLatitudeBelt(0.5, 'giant').center).toBeGreaterThan(activeLatitudeBelt(0.5, 'solar-like').center)
  })
})

describe('spotActivityModel', () => {
  it('treats the Sun at its reference rotation period as the calibration maximum', () => {
    const model = spotActivityModel(stats(), 'main-sequence', 25, 0.5)
    expect(model.supported).toBe(true)
    expect(model.regime).toBe('solar-like')
    expect(model.relativeActivity).toBeCloseTo(1, 6)
    expect(model.rossbyNumber).toBeCloseTo(25 / 10.4, 6)
    expect(model.regionsPerDayAtMax).toBeGreaterThan(0)
  })

  it('gives solar maximum more than a dozen individual spots', () => {
    const model = spotActivityModel(stats(), 'main-sequence', 25, 0.5)
    const counts = expectedSpotCounts(model, model.relativeActivity)
    expect(counts.spots).toBeGreaterThan(11)
    expect(estimateSunspotNumber(model, model.relativeActivity)).toBeGreaterThan(11)
  })

  it('lowers activity for slowly rotating stars', () => {
    const fast = spotActivityModel(stats(), 'main-sequence', 25, 0.5)
    const slow = spotActivityModel(stats(), 'main-sequence', 200, 0.5)
    expect(slow.relativeActivity).toBeLessThan(fast.relativeActivity)
  })

  it('saturates activity for rapidly rotating stars', () => {
    const rapid = spotActivityModel(stats(), 'main-sequence', 2, 0.5)
    expect(rapid.relativeActivity).toBe(1)
  })

  it('rejects hot radiative stars and compact objects', () => {
    const hot = spotActivityModel(stats({ temperature: 30_000 }), 'main-sequence', 5, 0.5)
    expect(hot.supported).toBe(false)
    expect(hot.regime).toBe('radiative')

    const neutron = spotActivityModel(stats({ temperature: 6e5 }), 'neutron-star', 1e-8, 0.5)
    expect(neutron.supported).toBe(false)
    expect(neutron.regime).toBe('compact')
  })

  it('gives evolved giants large spots at high latitudes', () => {
    const giant = spotActivityModel(
      stats({ mass: 2 * SOLAR_MASS, radius: 100 * SOLAR_RADIUS, temperature: 3800 }),
      'main-sequence',
      100,
      0.5,
    )
    expect(giant.regime).toBe('giant')
    expect(giant.maxSpotAreaFraction).toBeGreaterThan(2.2e-4)
    expect(giant.belt.center).toBeGreaterThan(30 * DEG)
  })
})
