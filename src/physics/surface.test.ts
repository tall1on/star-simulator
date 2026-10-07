import { describe, expect, it } from 'vitest'
import { surfaceModel } from '@/physics/surface'
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

describe('surfaceModel', () => {
  it('gives the Sun a ~290 km scale height and fine solar-scale granulation', () => {
    const model = surfaceModel(stats(), 'main-sequence')
    expect(model.scaleHeight).toBeGreaterThan(2.2e5)
    expect(model.scaleHeight).toBeLessThan(3.6e5)
    expect(model.relativeCellSize).toBeCloseTo(1, 1)
    expect(model.regime).toBe('dwarf')
    expect(model.cellFrequency).toBeGreaterThan(40)
    expect(model.cellFrequency).toBeLessThan(200)
    expect(model.giantBlend).toBeLessThan(0.05)
    expect(model.laneDarkness).toBeGreaterThan(0.3)
    expect(model.brightnessVariation).toBeGreaterThan(0.2)
  })

  it('gives a cool giant large cells, broad dark regions and slow evolution', () => {
    const giant = surfaceModel(stats({ radius: 100 * SOLAR_RADIUS, temperature: 4000 }), 'main-sequence')
    expect(giant.regime).toBe('giant')
    expect(giant.giantBlend).toBeGreaterThan(0.9)
    expect(giant.cellFrequency).toBeLessThan(12)
    expect(giant.darkRegion).toBeGreaterThan(0.6)
    expect(giant.evolution).toBeLessThan(0.3)
    expect(giant.relativeCellSize).toBeGreaterThan(10)
  })

  it('reduces contrast for hot massive stars', () => {
    const hot = surfaceModel(
      stats({ mass: 20 * SOLAR_MASS, radius: 8 * SOLAR_RADIUS, temperature: 30_000 }),
      'main-sequence',
    )
    expect(hot.regime).toBe('hot')
    expect(hot.contrast).toBeLessThan(0.4)
  })

  it('treats neutron stars as smooth compact objects, not convective', () => {
    const compact = surfaceModel(
      stats({ mass: 1.4 * SOLAR_MASS, radius: 11_000, temperature: 6e5 }),
      'neutron-star',
    )
    expect(compact.regime).toBe('compact')
    expect(compact.contrast).toBeLessThan(0.1)
    expect(compact.spotStrength).toBe(0)
    expect(compact.darkRegion).toBe(0)
    expect(compact.laneDarkness).toBe(0)
  })

  it('makes cells larger as radius grows at fixed mass and temperature', () => {
    const small = surfaceModel(stats(), 'main-sequence')
    const large = surfaceModel(stats({ radius: 20 * SOLAR_RADIUS }), 'main-sequence')
    expect(large.cellFrequency).toBeLessThan(small.cellFrequency)
    expect(large.relativeCellSize).toBeGreaterThan(small.relativeCellSize)
  })

  it('gives giants real 3D relief and dwarfs almost none', () => {
    const sun = surfaceModel(stats(), 'main-sequence')
    const giant = surfaceModel(stats({ radius: 100 * SOLAR_RADIUS, temperature: 4000 }), 'main-sequence')
    expect(sun.displacement).toBeLessThan(0.002)
    expect(giant.displacement).toBeGreaterThan(0.02)
    expect(giant.displacement).toBeGreaterThan(sun.displacement * 20)
  })

  it('has no surface relief for compact objects', () => {
    const compact = surfaceModel(stats({ radius: 11_000, temperature: 6e5 }), 'neutron-star')
    expect(compact.displacement).toBe(0)
  })
})
