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

function lineIndicesByKind(simulation: MagnetosphereSimulation, kind: FieldLineKind): number[] {
  const indices: number[] = []
  for (let i = 0; i < simulation.lineCount; i++) {
    if (simulation.lineKind(i) === kind) indices.push(i)
  }
  return indices
}

function maxTwistOfKind(simulation: MagnetosphereSimulation, kind: FieldLineKind): number {
  let max = 0
  for (const index of lineIndicesByKind(simulation, kind)) {
    max = Math.max(max, simulation.lineMaxTwist(index))
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
  for (let i = 0; i < simulation.lineCount; i++) {
    const positions = simulation.linePositions(i)
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

describe('MagnetosphereSimulation closed-loop dynamics', () => {
  it('leaves symmetric dipole loops untwisted', () => {
    const simulation = seeded(config())
    simulation.advance(3_000_000)
    expect(maxTwistOfKind(simulation, 'closed')).toBeLessThan(1e-6)
  })

  it('shears asymmetric active-region loops', () => {
    const simulation = seeded(config())
    simulation.advance(3_000_000)
    expect(maxTwistOfKind(simulation, 'active')).toBeGreaterThan(1e-4)
  })

  it('does not wind a symmetric dipole even without differential rotation', () => {
    const simulation = seeded(config({ regime: 'radiative', temperature: 20_000 }))
    simulation.advance(3_000_000)
    expect(maxTwistOfKind(simulation, 'closed')).toBeLessThan(1e-6)
    expect(maxTwistOfKind(simulation, 'active')).toBeLessThan(1e-6)
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
    const outerIndex = 20
    const before = simulation.openLineNodeTwist(0, outerIndex)
    simulation.configure(config({ rotationPeriod: 5, windSpeed: 400 }))
    // A tiny step: the outer node has not yet seen the new rotation rate.
    simulation.advance(1)
    expect(simulation.openLineNodeTwist(0, outerIndex)).toBeCloseTo(before, 12)
    // After more than the travel time it has.
    simulation.advance(3 * SECONDS_PER_DAY)
    expect(Math.abs(simulation.openLineNodeTwist(0, outerIndex))).toBeGreaterThan(Math.abs(before))
  })

  it('matches the analytic Parker winding in the wind-dominated regime', () => {
    const simulation = seeded(config({ windSpeed: 400, rotationPeriod: 25 }))
    simulation.advance(SECONDS_PER_DAY)
    const expected = parkerWindingAngle(
      angularVelocity(25),
      400_000,
      6 * SOLAR_RADIUS,
      SOLAR_RADIUS,
    )
    expect(simulation.openLineNodeTwist(0, 48)).toBeCloseTo(expected, 6)
  })
})

describe('MagnetosphereSimulation compact shear events', () => {
  it('injects twist that decays once the driver stops', () => {
    const simulation = seeded(compact({ activity: 1 }))
    simulation.advance(4 * SECONDS_PER_DAY)
    const peaked = simulation.diagnostics().maxTwist
    expect(peaked).toBeGreaterThan(0)
    expect(simulation.diagnostics().shearEvents).toBeGreaterThan(0)

    simulation.configure(compact({ activity: 0 }))
    simulation.advance(200 * SECONDS_PER_DAY)
    expect(simulation.diagnostics().maxTwist).toBeLessThan(peaked * 0.5)
  })

  it('produces no events at zero activity', () => {
    const simulation = seeded(compact({ activity: 0 }))
    simulation.advance(50 * SECONDS_PER_DAY)
    expect(simulation.diagnostics().maxTwist).toBeLessThan(1e-6)
  })

  it('is frame-rate independent across step sizes', () => {
    const one = seeded(compact({ activity: 1 }))
    const many = seeded(compact({ activity: 1 }))
    one.advance(20 * SECONDS_PER_DAY)
    for (let i = 0; i < 200; i++) many.advance(0.1 * SECONDS_PER_DAY)
    const a = one.diagnostics().maxTwist
    expect(a).toBeGreaterThan(0)
    expect(a).toBeCloseTo(many.diagnostics().maxTwist, 8)
  })
})

describe('MagnetosphereSimulation determinism', () => {
  it('is reproducible for the same seed and steps', () => {
    const a = seeded(config())
    const b = seeded(config())
    a.advance(1_000_000)
    b.advance(1_000_000)
    expect(a.diagnostics().maxTwist).toBeCloseTo(b.diagnostics().maxTwist, 12)
    expect(a.diagnostics().elapsedDays).toBe(b.diagnostics().elapsedDays)
  })

  it('reset returns to a deterministic empty state', () => {
    const a = seeded(config())
    a.advance(1_000_000)
    expect(a.diagnostics().maxTwist).toBeGreaterThan(0)
    a.reset()
    expect(a.diagnostics().elapsedDays).toBe(0)
    expect(a.diagnostics().maxTwist).toBe(0)
    expect(a.spinAngle).toBe(0)
  })

  it('is approximately frame-rate independent for equal simulated time', () => {
    const oneShot = seeded(config({ activity: 0 }))
    const manySteps = seeded(config({ activity: 0 }))
    oneShot.advance(3000)
    for (let i = 0; i < 30; i++) manySteps.advance(100)
    const a = oneShot.diagnostics().maxTwist
    const b = manySteps.diagnostics().maxTwist
    expect(a).toBeGreaterThan(0)
    expect(Math.abs(a - b)).toBeLessThan(0.2 * Math.max(a, b) + 1e-12)
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
