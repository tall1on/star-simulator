import { describe, expect, it } from 'vitest'
import { ambienceParameters, ambienceRegime, type AmbienceInputs } from '@/audio/ambienceModel'
import type { StarStats, StarTypeId } from '@/types/star'
import { SOLAR_LUMINOSITY, SOLAR_MASS, SOLAR_RADIUS } from '@/physics/relations'

function stats(overrides: Partial<StarStats> = {}): StarStats {
  return {
    mass: SOLAR_MASS,
    radius: SOLAR_RADIUS,
    density: 1408,
    luminosity: SOLAR_LUMINOSITY,
    temperature: 5772,
    magneticField: 1,
    ...overrides,
  }
}

function inputs(overrides: Partial<AmbienceInputs> = {}): AmbienceInputs {
  return {
    stats: stats(),
    typeId: 'main-sequence',
    rotationPeriodDays: 25,
    activity: 0.6,
    dynamics: 0.35,
    ...overrides,
  }
}

describe('ambienceRegime', () => {
  it('classifies the Sun as solar and sort-of stars by regime', () => {
    expect(ambienceRegime(stats(), 'main-sequence')).toBe('solar')
    expect(ambienceRegime(stats({ temperature: 3000 }), 'main-sequence')).toBe('cool-dwarf')
    expect(ambienceRegime(stats({ temperature: 30000 }), 'main-sequence')).toBe('hot')
    expect(ambienceRegime(stats({ radius: 50 * SOLAR_RADIUS }), 'main-sequence')).toBe('giant')
    expect(ambienceRegime(stats({ temperature: 6e5, radius: 11_000 }), 'neutron-star')).toBe('compact')
  })
})

describe('ambienceParameters', () => {
  it('produces finite, bounded values across the full slider ranges', () => {
    const cases: AmbienceInputs[] = []
    for (const typeId of ['main-sequence', 'neutron-star'] as StarTypeId[]) {
      for (const temperature of [2000, 5772, 55_000, 6e5]) {
        for (const radius of [8_000, SOLAR_RADIUS, 2000 * SOLAR_RADIUS]) {
          for (const magneticField of [1e-2, 1, 1e4, 1e15]) {
            for (const rotationPeriodDays of [1e-8, 2e-8, 0.05, 25, 5000]) {
              cases.push(
                inputs({
                  stats: stats({ temperature, radius, magneticField }),
                  typeId,
                  rotationPeriodDays,
                  activity: 1,
                  dynamics: 1,
                }),
              )
            }
          }
        }
      }
    }

    for (const input of cases) {
      const p = ambienceParameters(input)
      expect(Number.isFinite(p.fundamental)).toBe(true)
      expect(p.fundamental).toBeGreaterThanOrEqual(34)
      expect(p.fundamental).toBeLessThanOrEqual(108)
      expect(p.cutoff).toBeGreaterThanOrEqual(150)
      expect(p.cutoff).toBeLessThanOrEqual(3400)
      expect(p.resonance).toBeGreaterThanOrEqual(0.7)
      expect(p.resonance).toBeLessThanOrEqual(1.4)
      expect(p.pulseRate).toBeGreaterThanOrEqual(0.3)
      expect(p.pulseRate).toBeLessThanOrEqual(6)
      expect(p.pulseDepth).toBeGreaterThanOrEqual(0)
      expect(p.pulseDepth).toBeLessThanOrEqual(0.5)
      expect(p.driftRate).toBeGreaterThanOrEqual(0.02)
      expect(p.driftRate).toBeLessThanOrEqual(0.5)
      expect(p.driftDepth).toBeLessThanOrEqual(0.7)
      expect(p.shimmer).toBeLessThanOrEqual(1)
      expect(p.noiseLevel).toBeLessThanOrEqual(0.25)
      for (const partial of p.partials) {
        expect(Number.isFinite(partial.ratio)).toBe(true)
        expect(partial.gain).toBeGreaterThanOrEqual(0)
        expect(partial.gain).toBeLessThanOrEqual(1)
        expect(Math.abs(partial.detuneCents)).toBeLessThanOrEqual(20)
      }
    }
  })

  it('raises the pulse rate monotonically with spin until the cap', () => {
    const slow = ambienceParameters(inputs({ rotationPeriodDays: 25 }))
    const crab = ambienceParameters(inputs({ typeId: 'neutron-star', rotationPeriodDays: 0.033 }))
    const milli = ambienceParameters(inputs({ typeId: 'neutron-star', rotationPeriodDays: 2e-8 }))
    expect(slow.pulseRate).toBeLessThan(crab.pulseRate)
    expect(crab.pulseRate).toBeLessThan(milli.pulseRate)
    expect(milli.pulseRate).toBeLessThanOrEqual(6)
  })

  it('never lets zero or negative rotation periods produce non-finite values', () => {
    for (const period of [0, -1, -1e12]) {
      const p = ambienceParameters(inputs({ rotationPeriodDays: period }))
      expect(Number.isFinite(p.pulseRate)).toBe(true)
      expect(Number.isFinite(p.fundamental)).toBe(true)
      expect(p.pulseRate).toBeGreaterThanOrEqual(0.3)
    }
  })

  it('does not increase drone partial gains with magnetic field', () => {
    const quiet = ambienceParameters(inputs({ stats: stats({ magneticField: 1e-2 }) }))
    const loud = ambienceParameters(inputs({ stats: stats({ magneticField: 1e15 }) }))
    quiet.partials.forEach((partial, index) => {
      const other = loud.partials[index]
      expect(other).toBeDefined()
      expect(other?.gain).toBeLessThanOrEqual(partial.gain + 1e-9)
    })
  })

  it('keeps the fundamental in a comfortable band for the Sun and a giant', () => {
    const sun = ambienceParameters(inputs())
    const giant = ambienceParameters(inputs({ stats: stats({ radius: 800 * SOLAR_RADIUS, temperature: 3500 }) }))
    expect(sun.fundamental).toBeGreaterThan(45)
    expect(sun.fundamental).toBeLessThan(70)
    expect(giant.fundamental).toBeLessThan(sun.fundamental)
    expect(giant.fundamental).toBeGreaterThanOrEqual(34)
  })

  it('maps the dynamic control to a character label', () => {
    expect(ambienceParameters(inputs({ dynamics: 0 })).character).toBe('calm')
    expect(ambienceParameters(inputs({ dynamics: 0.5 })).character).toBe('balanced')
    expect(ambienceParameters(inputs({ dynamics: 1 })).character).toBe('vivid')
  })
})
