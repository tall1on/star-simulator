import { describe, expect, it } from 'vitest'
import { oblatenessFactors, rotationShape } from '@/physics/rotation'

const SECONDS_PER_DAY = 86_400

describe('rotationShape', () => {
  it('keeps the Sun essentially spherical', () => {
    const shape = rotationShape(25, 1408)
    expect(shape.rotationParameter).toBeLessThan(1e-4)
    expect(shape.flattening).toBeLessThan(1e-4)
    expect(shape.atBreakup).toBe(false)
  })

  it('gives a millisecond pulsar realistic oblateness', () => {
    const periodDays = 0.0014 / SECONDS_PER_DAY
    const shape = rotationShape(periodDays, 5e17)
    expect(shape.rotationParameter).toBeGreaterThan(0.12)
    expect(shape.rotationParameter).toBeLessThan(0.17)
    expect(shape.flattening).toBeGreaterThan(0.14)
    expect(shape.flattening).toBeLessThan(0.22)
  })

  it('doubles the rotation parameter when density is halved', () => {
    const dense = rotationShape(0.001, 1e17)
    const sparse = rotationShape(0.001, 0.5e17)
    expect(sparse.rotationParameter / dense.rotationParameter).toBeCloseTo(2, 6)
    expect(sparse.flattening).toBeGreaterThan(dense.flattening)
  })

  it('flattens more as rotation speeds up', () => {
    const slow = rotationShape(10, 1e17)
    const fast = rotationShape(0.001, 1e17)
    expect(fast.flattening).toBeGreaterThan(slow.flattening)
  })

  it('flags mass-shedding for an extreme rotator', () => {
    expect(rotationShape(0.0005 / SECONDS_PER_DAY, 1e17).atBreakup).toBe(true)
  })
})

describe('oblatenessFactors', () => {
  it('is identity for a sphere', () => {
    expect(oblatenessFactors(0)).toEqual({ equatorial: 1, polar: 1 })
  })

  it('conserves volume (R_eq^2 · R_pole = R^3)', () => {
    const { equatorial, polar } = oblatenessFactors(0.2)
    expect(equatorial * equatorial * polar).toBeCloseTo(1, 10)
    expect(equatorial).toBeGreaterThan(1)
    expect(polar).toBeLessThan(1)
  })
})
