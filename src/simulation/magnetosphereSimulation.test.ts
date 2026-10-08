import { describe, expect, it } from 'vitest'
import { MagnetosphereSimulation } from '@/simulation/magnetosphereSimulation'
import type { FieldLineKind, MagnetosphereConfig } from '@/types/magnetosphere'
import { SECONDS_PER_DAY, SOLAR_RADIUS } from '@/physics/relations'
import { angularVelocity, parkerWindingAngle } from '@/physics/magnetosphere'

function config(overrides: Partial<MagnetosphereConfig> = {}): MagnetosphereConfig {
  return {
    enabled: true,
    running: true,
    timeScaleDaysPerSecond: 1,
    fieldStrength: 1,
    windSpeed: 400,
    massLossRate: 2e-14,
    rotationPeriod: 25,
    tilt: 7,
    radius: SOLAR_RADIUS,
    temperature: 5772,
    typeId: 'main-sequence',
    activity: 0.6,
    regime: 'convective',
    eventFocus: false,
    ...overrides,
  }
}

function compact(overrides: Partial<MagnetosphereConfig> = {}): MagnetosphereConfig {
  return config({
    typeId: 'neutron-star',
    regime: 'compact',
    temperature: 1e6,
    fieldStrength: 1e12,
    windSpeed: 1500,
    rotationPeriod: 2e-8,
    radius: 11_000,
    ...overrides,
  })
}

function seeded(next: MagnetosphereConfig): MagnetosphereSimulation {
  const simulation = new MagnetosphereSimulation()
  simulation.configure(next)
  return simulation
}

function maxTwistOfGroup(simulation: MagnetosphereSimulation, group: FieldLineKind): number {
  let max = 0
  for (let i = 0; i < simulation.slotCount; i++) {
    if (simulation.slotActive(i) && simulation.slotGroup(i) === group) {
      max = Math.max(max, simulation.lineMaxTwist(i))
    }
  }
  return max
}

function maxBundleApex(simulation: MagnetosphereSimulation): number {
  let max = 0
  for (let i = 0; i < simulation.slotCount; i++) {
    if (simulation.slotActive(i) && simulation.slotGroup(i) === 'bundle') {
      max = Math.max(max, simulation.slotApex(i))
    }
  }
  return max
}

function maxOpenWinding(simulation: MagnetosphereSimulation): number {
  let max = 0
  for (let k = 0; k < simulation.openLineCount; k++) {
    max = Math.max(max, simulation.openLineMaxTwist(k))
  }
  return max
}

function allPositionsFinite(simulation: MagnetosphereSimulation): boolean {
  for (let i = 0; i < simulation.slotCount; i++) {
    if (!simulation.slotActive(i)) continue
    const positions = simulation.slotPositions(i)
    for (let j = 0; j < positions.length; j++) {
      if (!Number.isFinite(positions[j] ?? Number.NaN)) return false
    }
  }
  return true
}

describe('MagnetosphereSimulation gating', () => {
  it('does nothing when disabled or paused', () => {
    const disabled = seeded(config({ enabled: false }))
    disabled.step(1000)
    expect(disabled.diagnostics().elapsedDays).toBe(0)

    const paused = seeded(config({ running: false }))
    paused.step(1000)
    expect(paused.diagnostics().elapsedDays).toBe(0)
  })

  it('advances when enabled and running', () => {
    const simulation = seeded(config())
    simulation.step(10)
    expect(simulation.diagnostics().elapsedDays).toBeGreaterThan(0)
  })
})

describe('MagnetosphereSimulation background dipole', () => {
  it('leaves symmetric closed loops untwisted', () => {
    const simulation = seeded(config())
    simulation.advance(5_000_000)
    expect(maxTwistOfGroup(simulation, 'closed')).toBeLessThan(1e-6)
  })
})

describe('MagnetosphereSimulation evolving regions and bundles', () => {
  it('emerges bipolar regions with bundles over time', () => {
    const simulation = seeded(config({ activity: 1 }))
    simulation.advance(30 * SECONDS_PER_DAY)
    expect(simulation.regionCount).toBeGreaterThan(0)
    expect(simulation.bundleCount).toBeGreaterThan(0)
    expect(maxTwistOfGroup(simulation, 'bundle')).toBeGreaterThan(0)
  })

  it('produces no regions at zero activity', () => {
    const simulation = seeded(config({ activity: 0 }))
    simulation.advance(60 * SECONDS_PER_DAY)
    expect(simulation.regionCount).toBe(0)
    expect(simulation.bundleCount).toBe(0)
  })

  it('is irregular: bundles have different apex heights', () => {
    const simulation = seeded(config({ activity: 1 }))
    simulation.advance(30 * SECONDS_PER_DAY)
    const apexes: number[] = []
    for (let i = 0; i < simulation.slotCount; i++) {
      if (simulation.slotActive(i) && simulation.slotGroup(i) === 'bundle') {
        apexes.push(simulation.slotApex(i))
      }
    }
    expect(apexes.length).toBeGreaterThan(1)
    expect(Math.max(...apexes) - Math.min(...apexes)).toBeGreaterThan(1e-3)
  })
})

describe('MagnetosphereSimulation reconnection', () => {
  it('reconnects stressed loops and releases energy', () => {
    const simulation = seeded(config({ activity: 1 }))
    simulation.advance(120 * SECONDS_PER_DAY)
    const diagnostics = simulation.diagnostics()
    expect(diagnostics.reconnections).toBeGreaterThan(0)
    expect(diagnostics.releasedEnergy).toBeGreaterThan(0)
    expect(diagnostics.flares + diagnostics.eruptions).toBe(diagnostics.reconnections)
  })

  it('launches ejecta from eruptive events', () => {
    const simulation = seeded(config({ activity: 1 }))
    let sawEjecta = false
    for (let i = 0; i < 400 && !sawEjecta; i++) {
      simulation.advance(0.25 * SECONDS_PER_DAY)
      if (simulation.ejectaCount > 0) sawEjecta = true
    }
    expect(simulation.diagnostics().eruptions).toBeGreaterThan(0)
    expect(sawEjecta).toBe(true)
  })

  it('none at zero activity', () => {
    const simulation = seeded(config({ activity: 0 }))
    simulation.advance(120 * SECONDS_PER_DAY)
    expect(simulation.diagnostics().reconnections).toBe(0)
  })
})

describe('MagnetosphereSimulation field-strength coupling', () => {
  it('a stronger field raises loop apex and free energy', () => {
    const weak = seeded(config({ fieldStrength: 1, activity: 1 }))
    const strong = seeded(config({ fieldStrength: 100, activity: 1 }))
    weak.advance(20 * SECONDS_PER_DAY)
    strong.advance(20 * SECONDS_PER_DAY)
    expect(maxBundleApex(strong)).toBeGreaterThan(maxBundleApex(weak))
    expect(strong.diagnostics().freeEnergy).toBeGreaterThan(weak.diagnostics().freeEnergy)
    expect(strong.diagnostics().confinementRadiusMetres).toBeGreaterThan(
      weak.diagnostics().confinementRadiusMetres,
    )
  })

  it('does not change the shape of an isolated vacuum dipole by amplitude alone', () => {
    // The background closed slots are geometry-only and identical regardless of
    // field strength; only the response time (Alfvén speed) differs.
    const weak = seeded(config({ fieldStrength: 0.01 }))
    const strong = seeded(config({ fieldStrength: 1e4 }))
    weak.advance(1000)
    strong.advance(1000)
    for (let i = 0; i < weak.slotCount; i++) {
      if (weak.slotGroup(i) !== 'closed' || !weak.slotActive(i)) continue
      const a = weak.slotPositions(i)
      const b = strong.slotPositions(i)
      expect(a.length).toBe(b.length)
      for (let j = 0; j < a.length; j++) {
        expect(a[j] ?? 0).toBeCloseTo(b[j] ?? 0, 6)
      }
    }
  })
})

describe('MagnetosphereSimulation compact regime', () => {
  it('evolves localised shear events into bundles and reconnections', () => {
    const simulation = seeded(compact({ activity: 1 }))
    simulation.advance(120 * SECONDS_PER_DAY)
    const diagnostics = simulation.diagnostics()
    expect(diagnostics.bundles).toBeGreaterThan(0)
    expect(diagnostics.reconnections).toBeGreaterThan(0)
    expect(diagnostics.regions).toBe(0)
  })
})

describe('MagnetosphereSimulation reconnection rate limiting', () => {
  it('keeps the event rate bounded (no cascade)', () => {
    const simulation = seeded(config({ activity: 1 }))
    simulation.advance(100 * SECONDS_PER_DAY)
    expect(simulation.diagnostics().reconnections).toBeLessThan(400)
    expect(simulation.diagnostics().releasedEnergy).toBeGreaterThan(0)
  })
})

describe('MagnetosphereSimulation open lines', () => {
  it('winds less with a faster wind', () => {
    const slow = seeded(config({ windSpeed: 300 }))
    const fast = seeded(config({ windSpeed: 1200 }))
    slow.advance(3 * SECONDS_PER_DAY)
    fast.advance(3 * SECONDS_PER_DAY)
    expect(maxOpenWinding(fast)).toBeLessThan(maxOpenWinding(slow))
  })

  it('winds more with faster rotation', () => {
    const slow = seeded(config({ rotationPeriod: 25 }))
    const fast = seeded(config({ rotationPeriod: 5 }))
    slow.advance(3 * SECONDS_PER_DAY)
    fast.advance(3 * SECONDS_PER_DAY)
    expect(maxOpenWinding(fast)).toBeGreaterThan(maxOpenWinding(slow))
  })

  it('reaches the outer field only after the wind travel time', () => {
    const simulation = seeded(config({ rotationPeriod: 25, windSpeed: 400 }))
    simulation.advance(SECONDS_PER_DAY)
    const before = simulation.openLineNodeTwist(0, 20)
    simulation.configure(config({ rotationPeriod: 5, windSpeed: 400 }))
    simulation.advance(1)
    expect(simulation.openLineNodeTwist(0, 20)).toBeCloseTo(before, 12)
    simulation.advance(3 * SECONDS_PER_DAY)
    expect(Math.abs(simulation.openLineNodeTwist(0, 20))).toBeGreaterThan(Math.abs(before))
  })

  it('matches the analytic Parker winding in the wind-dominated regime', () => {
    const simulation = seeded(config({ windSpeed: 400, rotationPeriod: 25 }))
    simulation.advance(SECONDS_PER_DAY)
    const expected = parkerWindingAngle(angularVelocity(25), 400_000, 6 * SOLAR_RADIUS, SOLAR_RADIUS)
    expect(simulation.openLineNodeTwist(0, 48)).toBeCloseTo(expected, 6)
  })

  it('samples open lines by arc length without NaN', () => {
    const simulation = seeded(config())
    simulation.advance(3 * SECONDS_PER_DAY)
    const out = new Float32Array(3)
    for (let k = 0; k < simulation.openLineCount; k++) {
      for (const p of [0, 0.25, 0.5, 1]) {
        simulation.sampleOpenLine(k, p, out, 0)
        expect(Number.isFinite(out[0] ?? Number.NaN)).toBe(true)
        expect(Number.isFinite(out[1] ?? Number.NaN)).toBe(true)
        expect(Number.isFinite(out[2] ?? Number.NaN)).toBe(true)
      }
    }
  })
})

describe('MagnetosphereSimulation determinism', () => {
  it('is reproducible for the same seed and steps', () => {
    const a = seeded(config({ activity: 1 }))
    const b = seeded(config({ activity: 1 }))
    a.advance(40 * SECONDS_PER_DAY)
    b.advance(40 * SECONDS_PER_DAY)
    expect(a.diagnostics().maxTwist).toBeCloseTo(b.diagnostics().maxTwist, 12)
    expect(a.diagnostics().reconnections).toBe(b.diagnostics().reconnections)
  })

  it('is frame-rate independent for equal simulated time', () => {
    const sim30 = seeded(config({ activity: 1 }))
    const sim144 = seeded(config({ activity: 1 }))
    const days = 40
    for (let i = 0; i < days * 30; i++) sim30.advance(SECONDS_PER_DAY / 30)
    for (let i = 0; i < days * 144; i++) sim144.advance(SECONDS_PER_DAY / 144)
    expect(sim30.diagnostics().reconnections).toBe(sim144.diagnostics().reconnections)
    expect(sim30.diagnostics().regions).toBe(sim144.diagnostics().regions)
    expect(sim30.bundleCount).toBe(sim144.bundleCount)
    expect(sim30.diagnostics().maxTwist).toBeCloseTo(sim144.diagnostics().maxTwist, 2)
  })

  it('reset returns to a deterministic empty state', () => {
    const a = seeded(config({ activity: 1 }))
    a.advance(40 * SECONDS_PER_DAY)
    expect(a.regionCount).toBeGreaterThan(0)
    a.reset()
    expect(a.diagnostics().elapsedDays).toBe(0)
    expect(a.regionCount).toBe(0)
    expect(a.bundleCount).toBe(0)
    expect(a.diagnostics().maxTwist).toBe(0)
    expect(a.reconnectionCounts.reconnections).toBe(0)
  })
})

describe('MagnetosphereSimulation robustness', () => {
  it('stays finite for extreme main-sequence parameters', () => {
    const simulation = seeded(
      config({
        fieldStrength: 1e4,
        windSpeed: 1,
        rotationPeriod: 0.05,
        radius: 2000 * SOLAR_RADIUS,
        temperature: 45_000,
        activity: 1,
        regime: 'radiative',
      }),
    )
    simulation.advance(1e8)
    expect(Number.isFinite(simulation.diagnostics().maxTwist)).toBe(true)
    expect(allPositionsFinite(simulation)).toBe(true)
  })

  it('stays finite for an extreme magnetar', () => {
    const simulation = seeded(compact({ fieldStrength: 5e15, rotationPeriod: 1e-8, activity: 1 }))
    simulation.advance(1e8)
    expect(Number.isFinite(simulation.diagnostics().maxTwist)).toBe(true)
    expect(allPositionsFinite(simulation)).toBe(true)
  })
})
