import { describe, expect, it } from 'vitest'
import {
  SPEED_OF_LIGHT,
  alfvenCrossingSeconds,
  alfvenSpeed,
  angularVelocity,
  footpointShearRate,
  gaussToTesla,
  lightCylinderRadiusMetres,
  magnetosphereRegime,
  parkerWindingAngle,
  plasmaDensityForRegime,
  supportsDifferentialRotation,
} from '@/physics/magnetosphere'
import { SECONDS_PER_DAY, SOLAR_RADIUS } from '@/physics/relations'

describe('gaussToTesla', () => {
  it('converts 1 G to 10⁻⁴ T', () => {
    expect(gaussToTesla(1)).toBe(1e-4)
    expect(gaussToTesla(1e4)).toBeCloseTo(1, 12)
  })
})

describe('alfvenSpeed', () => {
  it('gives an order-of-magnitude coronal speed for the Sun', () => {
    const speed = alfvenSpeed(1, plasmaDensityForRegime('convective'))
    expect(speed).toBeGreaterThan(1e4)
    expect(speed).toBeLessThan(1e6)
  })

  it('is capped at the speed of light for extreme fields', () => {
    expect(alfvenSpeed(1e15, plasmaDensityForRegime('compact'))).toBe(SPEED_OF_LIGHT)
  })

  it('increases with field strength', () => {
    expect(alfvenSpeed(100, 1e-12)).toBeGreaterThan(alfvenSpeed(1, 1e-12))
  })
})

describe('angularVelocity / light cylinder', () => {
  it('matches 2π/P', () => {
    expect(angularVelocity(1)).toBeCloseTo((2 * Math.PI) / SECONDS_PER_DAY, 12)
  })

  it('places the solar light cylinder far outside the star', () => {
    expect(lightCylinderRadiusMetres(25)).toBeGreaterThan(1e13)
    expect(lightCylinderRadiusMetres(25) / SOLAR_RADIUS).toBeGreaterThan(1e4)
  })

  it('shrinks the light cylinder for fast rotation', () => {
    expect(lightCylinderRadiusMetres(0.01)).toBeLessThan(lightCylinderRadiusMetres(25))
  })
})

describe('parkerWindingAngle', () => {
  const omega = angularVelocity(25)
  const wind = 400_000
  const outer = 6 * SOLAR_RADIUS

  it('is negative (trailing) and grows outward', () => {
    const inner = parkerWindingAngle(omega, wind, 2 * SOLAR_RADIUS, SOLAR_RADIUS)
    const outerAngle = parkerWindingAngle(omega, wind, outer, SOLAR_RADIUS)
    expect(inner).toBeLessThan(0)
    expect(outerAngle).toBeLessThan(inner)
  })

  it('is reduced by a faster wind', () => {
    const slow = Math.abs(parkerWindingAngle(omega, 300_000, outer, SOLAR_RADIUS))
    const fast = Math.abs(parkerWindingAngle(omega, 1200_000, outer, SOLAR_RADIUS))
    expect(fast).toBeLessThan(slow)
  })

  it('is increased by faster rotation', () => {
    const slowSpin = Math.abs(parkerWindingAngle(angularVelocity(25), wind, outer, SOLAR_RADIUS))
    const fastSpin = Math.abs(parkerWindingAngle(angularVelocity(5), wind, outer, SOLAR_RADIUS))
    expect(fastSpin).toBeGreaterThan(slowSpin)
  })
})

describe('footpointShearRate', () => {
  it('is zero for equal-magnitude opposite footpoint latitudes', () => {
    expect(footpointShearRate(25, 0.5, -0.5, true)).toBeCloseTo(0, 12)
  })

  it('is non-zero for asymmetric footpoints under differential rotation', () => {
    expect(Math.abs(footpointShearRate(25, 0.42, 0.16, true))).toBeGreaterThan(0)
  })

  it('is zero when differential rotation is not supported', () => {
    expect(footpointShearRate(25, 0.42, 0.16, false)).toBe(0)
  })
})

describe('magnetosphereRegime', () => {
  it('classifies neutron stars as compact', () => {
    expect(magnetosphereRegime('neutron-star', 1e6)).toBe('compact')
    expect(supportsDifferentialRotation('compact')).toBe(false)
  })

  it('separates convective and radiative main-sequence photospheres', () => {
    expect(magnetosphereRegime('main-sequence', 5772)).toBe('convective')
    expect(magnetosphereRegime('main-sequence', 20_000)).toBe('radiative')
    expect(supportsDifferentialRotation('convective')).toBe(true)
    expect(supportsDifferentialRotation('radiative')).toBe(false)
  })
})

describe('alfvenCrossingSeconds', () => {
  it('is length over speed', () => {
    expect(alfvenCrossingSeconds(1e8, 1e6)).toBeCloseTo(100, 6)
  })
})
