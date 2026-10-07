import { describe, expect, it } from 'vitest'
import {
  blackbodyChromaticity,
  blackbodyColor,
  blackbodyLinearRGB,
  linearToSrgb,
  srgbToLinear,
} from '@/physics/color'

const TEMPERATURES = [1000, 3000, 5772, 10000, 30000, 40000] as const

describe('blackbodyLinearRGB', () => {
  it('returns finite channels within [0, 1]', () => {
    for (const temperature of TEMPERATURES) {
      const [r, g, b] = blackbodyLinearRGB(temperature)
      for (const channel of [r, g, b]) {
        expect(Number.isFinite(channel)).toBe(true)
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
  })

  it('normalises so the largest channel is 1', () => {
    for (const temperature of TEMPERATURES) {
      const [r, g, b] = blackbodyLinearRGB(temperature)
      expect(Math.max(r, g, b)).toBeCloseTo(1, 12)
    }
  })

  it('is redder at 3000 K than at 15000 K', () => {
    const cool = blackbodyLinearRGB(3000)
    const hot = blackbodyLinearRGB(15000)
    expect(cool[2]).toBeLessThan(hot[2])
    expect(cool[0]).toBeGreaterThan(hot[0])
  })

  it('is close to white for the Sun at 5772 K', () => {
    const [r, g, b] = blackbodyLinearRGB(5772)
    expect(r).toBeGreaterThan(0.6)
    expect(g).toBeGreaterThan(0.6)
    expect(b).toBeGreaterThan(0.6)
  })

  it('exposes blackbodyColor as an equivalent alias', () => {
    expect(blackbodyColor(5772)).toEqual(blackbodyLinearRGB(5772))
  })

  it('caches results for the same temperature', () => {
    expect(blackbodyLinearRGB(5772)).toEqual(blackbodyLinearRGB(5772))
  })
})

describe('blackbodyChromaticity', () => {
  it('places the Sun near the white point', () => {
    const { x, y } = blackbodyChromaticity(5772)
    expect(x).toBeGreaterThanOrEqual(0.3)
    expect(x).toBeLessThanOrEqual(0.4)
    expect(y).toBeGreaterThanOrEqual(0.3)
    expect(y).toBeLessThanOrEqual(0.42)
  })
})

describe('sRGB transfer functions', () => {
  it('fixes the endpoints', () => {
    expect(srgbToLinear(1)).toBe(1)
    expect(srgbToLinear(0)).toBe(0)
  })

  it('round-trips within 1e-6', () => {
    for (const value of [0, 0.02, 0.1, 0.5, 0.9, 1]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 6)
      expect(srgbToLinear(linearToSrgb(value))).toBeCloseTo(value, 6)
    }
  })
})
