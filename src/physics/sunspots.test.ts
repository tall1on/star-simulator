import { describe, expect, it } from 'vitest'
import {
  angularRadiusFromArea,
  angularVelocityAtLatitude,
  differentialRotationFactor,
  MAX_SPOT_AREA_FRACTION,
  mulberry32,
  planRegion,
  radianceRatio,
  spotGrowthFraction,
  spotTemperatures,
  surfaceFluxCompensation,
  sunspotsSupported,
} from '@/physics/sunspots'
import type { StarStats } from '@/types/star'
import { SECONDS_PER_DAY, SOLAR_LUMINOSITY, SOLAR_MASS, SOLAR_RADIUS, SOLAR_TEMPERATURE } from '@/physics/relations'

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

describe('sunspotsSupported', () => {
  it('supports a Sun-like main-sequence star', () => {
    expect(sunspotsSupported(stats(), 'main-sequence')).toBe(true)
  })

  it('rejects hot massive stars', () => {
    expect(sunspotsSupported(stats({ temperature: 30_000 }), 'main-sequence')).toBe(false)
  })

  it('rejects neutron stars regardless of temperature', () => {
    expect(sunspotsSupported(stats({ temperature: 4500 }), 'neutron-star')).toBe(false)
  })
})

describe('differential rotation', () => {
  it('rotates the equator fastest', () => {
    expect(differentialRotationFactor(0)).toBeCloseTo(1, 6)
    expect(differentialRotationFactor(30 * DEG)).toBeLessThan(differentialRotationFactor(0))
    expect(differentialRotationFactor(60 * DEG)).toBeLessThan(differentialRotationFactor(30 * DEG))
    expect(differentialRotationFactor(60 * DEG)).toBeGreaterThan(0.5)
  })

  it('gives the equator the fiducial period and lags at high latitude', () => {
    const equatorial = angularVelocityAtLatitude(25, 0)
    expect(equatorial).toBeCloseTo((2 * Math.PI) / (25 * SECONDS_PER_DAY), 12)
    expect(angularVelocityAtLatitude(25, 60 * DEG)).toBeLessThan(equatorial)
  })

  it('is symmetric about the equator', () => {
    expect(angularVelocityAtLatitude(25, 40 * DEG)).toBeCloseTo(angularVelocityAtLatitude(25, -40 * DEG), 12)
  })
})

describe('spot temperatures and contrast', () => {
  it('gives solar umbra/penumbra temperatures below T_eff', () => {
    const { umbra, penumbra } = spotTemperatures(SOLAR_TEMPERATURE)
    expect(umbra).toBeCloseTo(SOLAR_TEMPERATURE * 0.66, 6)
    expect(penumbra).toBeGreaterThan(umbra)
    expect(penumbra).toBeLessThan(SOLAR_TEMPERATURE)
    expect(umbra).toBeGreaterThan(3500)
    expect(umbra).toBeLessThan(4200)
  })

  it('makes cooler regions emit less bolometric radiance', () => {
    const { umbra, penumbra } = spotTemperatures(SOLAR_TEMPERATURE)
    const umbraRatio = radianceRatio(umbra, SOLAR_TEMPERATURE)
    const penumbraRatio = radianceRatio(penumbra, SOLAR_TEMPERATURE)
    expect(umbraRatio).toBeLessThan(penumbraRatio)
    expect(umbraRatio).toBeLessThan(0.3)
    expect(radianceRatio(SOLAR_TEMPERATURE, SOLAR_TEMPERATURE)).toBeCloseTo(1, 12)
  })
})

describe('angularRadiusFromArea', () => {
  it('is zero for zero area and grows monotonically', () => {
    expect(angularRadiusFromArea(0, SOLAR_RADIUS)).toBe(0)
    const small = angularRadiusFromArea(1e15, SOLAR_RADIUS)
    const large = angularRadiusFromArea(4e15, SOLAR_RADIUS)
    expect(large).toBeGreaterThan(small)
  })

  it('inverts the circular-cap area formula', () => {
    const theta = 0.05
    const area = 2 * Math.PI * SOLAR_RADIUS * SOLAR_RADIUS * (1 - Math.cos(theta))
    expect(angularRadiusFromArea(area, SOLAR_RADIUS)).toBeCloseTo(theta, 9)
  })
})

describe('spotGrowthFraction', () => {
  it('starts and ends at zero and peaks in the middle', () => {
    expect(spotGrowthFraction(0)).toBe(0)
    expect(spotGrowthFraction(1)).toBe(0)
    expect(spotGrowthFraction(0.5)).toBeGreaterThan(0.9)
    expect(spotGrowthFraction(0.25)).toBeGreaterThan(spotGrowthFraction(0.02))
    expect(spotGrowthFraction(0.9)).toBeLessThan(0.5)
  })

  it('clamps out-of-range input', () => {
    expect(spotGrowthFraction(-1)).toBe(0)
    expect(spotGrowthFraction(2)).toBe(0)
  })
})

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const value = a()
      expect(value).toBe(b())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('planRegion', () => {
  it('produces one or two spots in a single active belt', () => {
    const random = mulberry32(7)
    const surfaceArea = 4 * Math.PI * SOLAR_RADIUS * SOLAR_RADIUS
    for (let i = 0; i < 50; i++) {
      const spots = planRegion(random, 0.8, surfaceArea)
      expect(spots.length).toBeGreaterThanOrEqual(1)
      expect(spots.length).toBeLessThanOrEqual(2)
      const primary = spots[0]
      expect(primary).toBeDefined()
      if (!primary) continue
      expect(Math.abs(primary.latitude)).toBeGreaterThan(5 * DEG)
      expect(Math.abs(primary.latitude)).toBeLessThan(30 * DEG)
      expect(primary.lifetimeSeconds).toBeGreaterThan(3 * SECONDS_PER_DAY)
      expect(primary.maxArea).toBeLessThanOrEqual(MAX_SPOT_AREA_FRACTION * surfaceArea + 1)
      for (const spot of spots) {
        expect(Math.sign(spot.latitude)).toBe(Math.sign(primary.latitude))
      }
    }
  })

  it('produces no area at zero activity', () => {
    const spots = planRegion(mulberry32(1), 0, 4 * Math.PI * SOLAR_RADIUS * SOLAR_RADIUS)
    for (const spot of spots) {
      expect(spot.maxArea).toBe(0)
    }
  })
})

describe('surfaceFluxCompensation', () => {
  it('is one with no coverage and grows with cooler coverage', () => {
    expect(surfaceFluxCompensation(0, 0.5)).toBeCloseTo(1, 12)
    expect(surfaceFluxCompensation(0.01, 0.5)).toBeGreaterThan(1)
    expect(surfaceFluxCompensation(0.01, 0.5)).toBeLessThan(1.02)
  })

  it('stays finite for pathological input', () => {
    expect(Number.isFinite(surfaceFluxCompensation(1, 0))).toBe(true)
  })
})
