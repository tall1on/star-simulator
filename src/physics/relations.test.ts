import { describe, expect, it } from 'vitest'
import {
  apparentFlux,
  blackbodyColor,
  densityFromMassRadius,
  luminosityFromRadiusTemperature,
  mainSequenceLifetimeYears,
  mainSequenceLuminosity,
  mainSequenceRadius,
  mainSequenceTemperature,
  SOLAR_LUMINOSITY,
  SOLAR_MASS,
  SOLAR_RADIUS,
  SOLAR_TEMPERATURE,
  surfaceRadiance,
  temperatureFromLuminosityRadius,
} from '@/physics/relations'

describe('density', () => {
  it('recovers the mean density of the Sun', () => {
    const rho = densityFromMassRadius(SOLAR_MASS, SOLAR_RADIUS)
    expect(rho).toBeCloseTo(1408, -2)
  })

  it('scales as inverse radius cubed', () => {
    const base = densityFromMassRadius(SOLAR_MASS, SOLAR_RADIUS)
    const doubled = densityFromMassRadius(SOLAR_MASS, 2 * SOLAR_RADIUS)
    expect(doubled).toBeCloseTo(base / 8, 6)
  })
})

describe('Stefan-Boltzmann luminosity', () => {
  it('gives the solar luminosity for the Sun', () => {
    const l = luminosityFromRadiusTemperature(SOLAR_RADIUS, SOLAR_TEMPERATURE)
    expect(l / SOLAR_LUMINOSITY).toBeCloseTo(1, 2)
  })

  it('quadruples when radius doubles at fixed temperature', () => {
    const l1 = luminosityFromRadiusTemperature(SOLAR_RADIUS, SOLAR_TEMPERATURE)
    const l2 = luminosityFromRadiusTemperature(2 * SOLAR_RADIUS, SOLAR_TEMPERATURE)
    expect(l2 / l1).toBeCloseTo(4, 6)
  })

  it('is the exact inverse of temperatureFromLuminosityRadius', () => {
    const l = 3.2e28
    const r = 1.4e9
    const t = temperatureFromLuminosityRadius(l, r)
    expect(luminosityFromRadiusTemperature(r, t)).toBeCloseTo(l, 6)
  })

  it('computes blackbody surface radiance sigma*T^4/pi', () => {
    expect(surfaceRadiance(SOLAR_TEMPERATURE)).toBeCloseTo((5.670374419e-8 * SOLAR_TEMPERATURE ** 4) / Math.PI, 9)
  })
})

describe('main-sequence relations', () => {
  it('reduces to the Sun at one solar mass', () => {
    expect(mainSequenceLuminosity(SOLAR_MASS) / SOLAR_LUMINOSITY).toBeCloseTo(1, 6)
    expect(mainSequenceRadius(SOLAR_MASS)).toBeCloseTo(SOLAR_RADIUS, 3)
    expect(mainSequenceTemperature(SOLAR_MASS)).toBeCloseTo(SOLAR_TEMPERATURE, 0)
  })

  it('follows L ~ M^3.5', () => {
    const l = mainSequenceLuminosity(10 * SOLAR_MASS) / SOLAR_LUMINOSITY
    expect(l).toBeCloseTo(10 ** 3.5, 3)
  })

  it('scales lifetime as M^-2.5', () => {
    const t = mainSequenceLifetimeYears(10 * SOLAR_MASS)
    expect(t / 1e10).toBeCloseTo(10 ** -2.5, 3)
  })
})

describe('apparent flux', () => {
  it('falls off with the inverse square of distance', () => {
    const near = apparentFlux(SOLAR_LUMINOSITY, 1e11)
    const far = apparentFlux(SOLAR_LUMINOSITY, 2e11)
    expect(far / near).toBeCloseTo(0.25, 6)
  })
})

describe('blackbody colour', () => {
  it('is close to white for the Sun', () => {
    const [r, g, b] = blackbodyColor(SOLAR_TEMPERATURE)
    expect(r).toBeGreaterThan(0.9)
    expect(g).toBeGreaterThan(0.7)
    expect(b).toBeGreaterThan(0.7)
  })

  it('is redder at low temperature than at high temperature', () => {
    const cool = blackbodyColor(3000)
    const hot = blackbodyColor(15000)
    expect(cool[2]).toBeLessThan(hot[2])
  })
})
