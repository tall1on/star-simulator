import { describe, expect, it } from 'vitest'
import { MAX_ACTIVE_SPOTS, SunspotSimulation } from '@/simulation/sunspotSimulation'
import { MAX_RENDERED_SUNSPOTS, type SunspotConfig } from '@/types/sunspots'
import { angularVelocityAtLatitude } from '@/physics/sunspots'
import { SOLAR_RADIUS } from '@/physics/relations'

function config(overrides: Partial<SunspotConfig> = {}): SunspotConfig {
  return {
    enabled: true,
    running: true,
    activity: 1,
    speedDaysPerSecond: 1,
    rotationPeriodDays: 25,
    radius: SOLAR_RADIUS,
    temperature: 5772,
    supported: true,
    regionsPerDayAtMax: 1,
    meanSpotsPerRegion: 6,
    maxSpotAreaFraction: 2.2e-4,
    beltCenterLatitude: (17.5 * Math.PI) / 180,
    beltHalfWidth: (7 * Math.PI) / 180,
    ...overrides,
  }
}

function seeded(): SunspotSimulation {
  const simulation = new SunspotSimulation()
  simulation.configure(config())
  return simulation
}

describe('SunspotSimulation gating', () => {
  it('does nothing when unsupported', () => {
    const simulation = new SunspotSimulation()
    simulation.configure(config({ supported: false }))
    simulation.step(1000)
    expect(simulation.spotCount).toBe(0)
    expect(simulation.elapsedDays).toBe(0)
  })

  it('does nothing when disabled or paused', () => {
    const disabled = new SunspotSimulation()
    disabled.configure(config({ enabled: false }))
    disabled.step(1000)
    expect(disabled.elapsedDays).toBe(0)

    const paused = seeded()
    paused.configure(config({ running: false }))
    paused.step(1e6)
    expect(paused.elapsedDays).toBe(0)
    expect(paused.spotCount).toBe(0)
  })

  it('produces no spots at zero activity but still advects none', () => {
    const simulation = new SunspotSimulation()
    simulation.configure(config({ activity: 0 }))
    simulation.step(1000)
    expect(simulation.spotCount).toBe(0)
  })
})

describe('SunspotSimulation lifecycle', () => {
  it('emerges spots over time and stays bounded', () => {
    const simulation = seeded()
    simulation.advance(2_000_000)
    expect(simulation.spotCount).toBeGreaterThan(0)
    expect(simulation.spotCount).toBeLessThanOrEqual(MAX_ACTIVE_SPOTS)
  })

  it('decays every spot away once activity stops', () => {
    const simulation = seeded()
    simulation.advance(2_000_000)
    expect(simulation.spotCount).toBeGreaterThan(0)
    simulation.configure(config({ activity: 0 }))
    simulation.advance(1e9)
    expect(simulation.spotCount).toBe(0)
  })

  it('clears spots when the star becomes unsupported', () => {
    const simulation = seeded()
    simulation.advance(2_000_000)
    expect(simulation.spotCount).toBeGreaterThan(0)
    simulation.configure(config({ supported: false }))
    expect(simulation.spotCount).toBe(0)
  })

  it('renders at most the shader capacity, all finite and normalised', () => {
    const simulation = seeded()
    simulation.advance(4_000_000)
    const data = simulation.render()
    expect(data.length).toBeLessThanOrEqual(MAX_RENDERED_SUNSPOTS)
    for (const spot of data) {
      const [x, y, z] = spot.direction
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
      expect(Number.isFinite(z)).toBe(true)
      expect(x * x + y * y + z * z).toBeCloseTo(1, 6)
      expect(spot.weight).toBeGreaterThan(0)
      expect(spot.weight).toBeLessThanOrEqual(1)
      expect(spot.angularRadius).toBeGreaterThanOrEqual(0)
      expect(spot.angularRadius).toBeLessThan(Math.PI / 2)
    }
  })

  it('reports a finite, non-negative surface coverage', () => {
    const simulation = seeded()
    simulation.advance(2_000_000)
    simulation.render()
    expect(simulation.surfaceCoverage).toBeGreaterThan(0)
    expect(simulation.surfaceCoverage).toBeLessThan(0.5)
  })
})

describe('SunspotSimulation determinism', () => {
  it('is reproducible for the same seed and steps', () => {
    const a = seeded()
    const b = seeded()
    for (let i = 0; i < 50; i++) {
      a.advance(20_000)
      b.advance(20_000)
    }
    expect(a.elapsedDays).toBe(b.elapsedDays)
    expect(a.spotCount).toBe(b.spotCount)
    const spotsA = a.activeSpots()
    const spotsB = b.activeSpots()
    for (let i = 0; i < spotsA.length; i++) {
      const sa = spotsA[i]
      const sb = spotsB[i]
      expect(sa).toBeDefined()
      expect(sb).toBeDefined()
      if (!sa || !sb) continue
      expect(sa.latitude).toBe(sb.latitude)
      expect(sa.longitude).toBe(sb.longitude)
    }
  })

  it('is frame-rate independent for equal total simulated time', () => {
    const oneShot = seeded()
    const manySteps = seeded()
    oneShot.advance(1_000_000)
    for (let i = 0; i < 1000; i++) manySteps.advance(1000)
    expect(oneShot.elapsedDays).toBe(manySteps.elapsedDays)
    expect(oneShot.spotCount).toBe(manySteps.spotCount)
    expect(oneShot.spotCount).toBeGreaterThan(0)
  })
})

describe('SunspotSimulation rotation', () => {
  it('preserves longitude when the rotation period changes (no jump)', () => {
    const simulation = seeded()
    simulation.advance(2_000_000)
    const spots = simulation.activeSpots()
    const spot = spots[spots.length - 1]
    expect(spot).toBeDefined()
    if (!spot) return
    const before = spot.longitude
    simulation.configure(config({ rotationPeriodDays: 5 }))
    simulation.advance(0)
    expect(spot.longitude).toBe(before)
  })

  it('advects by the new latitude-dependent rate after a period change', () => {
    const simulation = seeded()
    simulation.advance(2_000_000)
    const spots = simulation.activeSpots()
    const spot = spots[spots.length - 1]
    expect(spot).toBeDefined()
    if (!spot) return
    const before = spot.longitude
    const latitude = spot.latitude
    simulation.configure(config({ rotationPeriodDays: 5 }))
    simulation.advance(10)
    const expectedDelta = angularVelocityAtLatitude(5, latitude) * 10
    expect(spot.longitude - before).toBeCloseTo(expectedDelta, 9)
  })

  it('moves the equator faster than high latitudes', () => {
    expect(angularVelocityAtLatitude(25, 0)).toBeGreaterThan(angularVelocityAtLatitude(25, (60 * Math.PI) / 180))
  })

  it('freezes spot positions while paused', () => {
    const simulation = seeded()
    simulation.advance(2_000_000)
    const spots = simulation.activeSpots()
    const spot = spots[spots.length - 1]
    expect(spot).toBeDefined()
    if (!spot) return
    const before = spot.longitude
    simulation.configure(config({ running: false }))
    simulation.step(1_000_000)
    expect(spot.longitude).toBe(before)
  })
})

describe('SunspotSimulation reset', () => {
  it('returns to a deterministic empty state', () => {
    const a = seeded()
    a.advance(3_000_000)
    a.reset()
    expect(a.elapsedDays).toBe(0)
    expect(a.spotCount).toBe(0)

    const b = seeded()
    b.advance(3_000_000)
    a.advance(3_000_000)
    expect(a.spotCount).toBe(b.spotCount)
    expect(a.elapsedDays).toBe(b.elapsedDays)
  })
})

describe('SunspotSimulation solar-maximum population', () => {
  it('produces many individual spots at solar maximum', () => {
    const simulation = seeded()
    simulation.advance(5_000_000)
    expect(simulation.spotCount).toBeGreaterThan(11)
  })

  it('keeps the spotted area physically plausible', () => {
    const simulation = seeded()
    simulation.advance(5_000_000)
    simulation.render()
    expect(simulation.surfaceCoverage).toBeGreaterThan(0.0003)
    expect(simulation.surfaceCoverage).toBeLessThan(0.02)
  })
})
