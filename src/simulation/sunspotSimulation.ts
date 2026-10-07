import {
  MAX_RENDERED_SUNSPOTS,
  type Sunspot,
  type SunspotConfig,
  type SunspotRenderData,
} from '@/types/sunspots'
import { SECONDS_PER_DAY, SOLAR_RADIUS, clamp } from '@/physics/relations'
import {
  angularRadiusFromArea,
  angularVelocityAtLatitude,
  mulberry32,
  planRegion,
  spotGrowthFraction,
  type SpotPlanOptions,
} from '@/physics/sunspots'

/** Hard cap on simultaneously tracked spots (keeps the per-frame work bounded). */
export const MAX_ACTIVE_SPOTS = 256
/** Fixed seed so every session and every reset starts identically. */
const SIMULATION_SEED = 0x5eed
/**
 * Simulated days the surface clock is wound forward on first use so the disc
 * starts with a realistic steady-state spot population (a few mean lifetimes).
 */
const SPIN_UP_DAYS = 30

const DEFAULT_CONFIG: SunspotConfig = {
  enabled: true,
  running: true,
  activity: 0.6,
  speedDaysPerSecond: 1,
  rotationPeriodDays: 25,
  radius: SOLAR_RADIUS,
  temperature: 5772,
  supported: false,
  regionsPerDayAtMax: 1,
  meanSpotsPerRegion: 6,
  maxSpotAreaFraction: 2.2e-4,
  beltCenterLatitude: (30 - 25 * 0.5) * (Math.PI / 180),
  beltHalfWidth: 7 * (Math.PI / 180),
}

/** Scratch entry for sorting spots by size before rendering. */
interface RenderedEntry {
  spot: Sunspot
  weight: number
  area: number
  angularRadius: number
}

/**
 * Independent sunspot surface clock.
 *
 * Deliberately a plain class, not reactive state: the animation loop must not
 * push per-frame arrays through Vue reactivity. The Pinia store owns the
 * controls; this object owns the evolving spots. Longitudes are integrated
 * incrementally, so changing the rotation speed never makes spots jump.
 *
 * On first use the surface is *pre-populated* by running the clock forward a
 * few mean lifetimes, so a supported star shows a realistic spot population
 * immediately rather than starting from an empty disc.
 */
export class SunspotSimulation {
  private elapsedSeconds = 0
  private spawnAccumulator = 0
  private nextId = 1
  private nextRegionId = 1
  private spots: Sunspot[] = []
  private random = mulberry32(SIMULATION_SEED)
  private config: SunspotConfig = { ...DEFAULT_CONFIG }
  private coverage = 0
  private populated = false

  /** Reused output buffer and scratch pools so the per-frame path allocates nothing. */
  private readonly renderBuffer: SunspotRenderData[] = []
  private readonly activeScratch: RenderedEntry[] = []
  private readonly entryPool: RenderedEntry[] = []

  /** Apply the current controls & stellar state. Clears spots if support is lost. */
  configure(next: SunspotConfig): void {
    if (!next.supported && this.config.supported) {
      this.clear()
      this.populated = false
    }
    this.config = { ...next }
  }

  /** Deterministic reset: same seed, empty sky, zero elapsed time. */
  reset(): void {
    this.clear()
    this.elapsedSeconds = 0
    this.spawnAccumulator = 0
    this.random = mulberry32(SIMULATION_SEED)
    this.nextId = 1
    this.nextRegionId = 1
    this.populated = false
  }

  private clear(): void {
    this.spots.length = 0
    this.renderBuffer.length = 0
    this.activeScratch.length = 0
    this.coverage = 0
    this.spawnAccumulator = 0
  }

  /** Elapsed simulated time, days. */
  get elapsedDays(): number {
    return this.elapsedSeconds / SECONDS_PER_DAY
  }

  /** Number of currently tracked spots. */
  get spotCount(): number {
    return this.spots.length
  }

  /** Spotted fraction of the photosphere (umbra + penumbra). */
  get surfaceCoverage(): number {
    return this.coverage
  }

  /** Read-only view of the tracked spots (used by tests and diagnostics). */
  activeSpots(): readonly Sunspot[] {
    return this.spots
  }

  /**
   * Populate the surface on first use by advancing the surface clock through a
   * few mean region lifetimes (the clock keeps ageing spots correctly, so this
   * is a genuine steady-state sample, not a special case).
   */
  private ensurePopulated(): void {
    if (this.populated) return
    const { enabled, running, supported, activity } = this.config
    if (!enabled || !running || !supported || activity <= 0) return
    this.populated = true
    this.advance(SPIN_UP_DAYS * SECONDS_PER_DAY)
  }

  /** Advance by a real-time delta. No-op while disabled, paused or unsupported. */
  step(realDeltaSeconds: number): void {
    const { enabled, running, supported, speedDaysPerSecond } = this.config
    if (!enabled || !running || !supported) return
    if (!(realDeltaSeconds > 0)) return
    this.ensurePopulated()
    this.advance(realDeltaSeconds * speedDaysPerSecond * SECONDS_PER_DAY)
  }

  /** Advance by an explicit simulated-time delta, seconds. */
  advance(simDeltaSeconds: number): void {
    if (!(simDeltaSeconds > 0)) return
    this.ensurePopulated()

    const startSeconds = this.elapsedSeconds
    const endSeconds = startSeconds + simDeltaSeconds

    // Advect and cull in place (no per-frame array allocation).
    let write = 0
    for (let read = 0; read < this.spots.length; read++) {
      const spot = this.spots[read]
      if (spot === undefined) continue
      if (endSeconds - spot.birthSeconds >= spot.lifetimeSeconds) continue
      const omega = angularVelocityAtLatitude(this.config.rotationPeriodDays, spot.latitude)
      spot.longitude += omega * simDeltaSeconds
      this.spots[write] = spot
      write += 1
    }
    this.spots.length = write
    this.elapsedSeconds = endSeconds

    this.scheduleEmergence(startSeconds, endSeconds)
    this.cullDead(endSeconds)
  }

  /** Drop spots whose life has ended (e.g. newborn spots that already decayed). */
  private cullDead(endSeconds: number): void {
    let write = 0
    for (let read = 0; read < this.spots.length; read++) {
      const spot = this.spots[read]
      if (spot === undefined) continue
      if (endSeconds - spot.birthSeconds >= spot.lifetimeSeconds) continue
      this.spots[write] = spot
      write += 1
    }
    this.spots.length = write
  }

  /**
   * Emergence over an interval. Events are spread evenly across it and each new
   * spot is born at its own event time, so a single large step looks like many
   * small ones (spot ages and longitudes stay consistent).
   */
  private scheduleEmergence(startSeconds: number, endSeconds: number): void {
    const activity = clamp(this.config.activity, 0, 1)
    if (activity <= 0) return

    const dt = endSeconds - startSeconds
    const regionsPerSecond = (this.config.regionsPerDayAtMax * activity) / SECONDS_PER_DAY
    this.spawnAccumulator += regionsPerSecond * dt

    const events = Math.floor(this.spawnAccumulator)
    if (events <= 0) return

    // Only consume the events actually spawned; at the cap the rest are deferred
    // (clamped so the accumulator can't grow without bound).
    let spawned = 0
    for (let k = 0; k < events; k++) {
      if (this.spots.length >= MAX_ACTIVE_SPOTS) break
      const birthSeconds = startSeconds + dt * ((k + 1) / (events + 1))
      this.spawnRegionAt(birthSeconds, endSeconds, activity)
      spawned += 1
    }
    this.spawnAccumulator -= spawned
    if (this.spots.length >= MAX_ACTIVE_SPOTS) {
      this.spawnAccumulator = Math.min(this.spawnAccumulator, 1)
    }
  }

  private spawnRegionAt(birthSeconds: number, endSeconds: number, activity: number): void {
    const surfaceArea = 4 * Math.PI * this.config.radius * this.config.radius
    const options: SpotPlanOptions = {
      activity,
      surfaceArea,
      maxSpotAreaFraction: this.config.maxSpotAreaFraction,
      meanSpotsPerRegion: this.config.meanSpotsPerRegion,
      beltCenterLatitude: this.config.beltCenterLatitude,
      beltHalfWidth: this.config.beltHalfWidth,
    }
    const planned = planRegion(this.random, options)
    const regionId = this.nextRegionId
    this.nextRegionId += 1
    for (const plan of planned) {
      if (this.spots.length >= MAX_ACTIVE_SPOTS) break
      // Skip spots that will already have decayed by the end of the interval.
      // A single big step then yields the same surviving population as many
      // small steps, instead of filling the cap with dead spots.
      if (endSeconds - birthSeconds >= plan.lifetimeSeconds) continue
      const omega = angularVelocityAtLatitude(this.config.rotationPeriodDays, plan.latitude)
      this.spots.push({
        id: this.nextId,
        regionId,
        latitude: plan.latitude,
        longitude: plan.longitude + omega * (endSeconds - birthSeconds),
        birthSeconds,
        lifetimeSeconds: plan.lifetimeSeconds,
        maxArea: plan.maxArea,
        umbraFraction: plan.umbraFraction,
      })
      this.nextId += 1
    }
  }

  /**
   * Flatten the current spots into shader-ready data, keeping the largest ones
   * up to {@link MAX_RENDERED_SUNSPOTS}. Also recomputes {@link surfaceCoverage}.
   * Reuses the output buffer and entry pool, so the steady-state frame path
   * allocates nothing.
   */
  render(): readonly SunspotRenderData[] {
    this.ensurePopulated()

    const radius = Math.max(this.config.radius, Number.EPSILON)
    const surfaceArea = 4 * Math.PI * radius * radius

    const active = this.activeScratch
    let coveredArea = 0
    let count = 0
    for (const spot of this.spots) {
      const ageFraction = (this.elapsedSeconds - spot.birthSeconds) / spot.lifetimeSeconds
      const weight = spotGrowthFraction(ageFraction)
      if (weight <= 0) continue
      const area = spot.maxArea * weight
      coveredArea += area

      let entry = this.entryPool[count]
      if (entry === undefined) {
        entry = { spot, weight: 0, area: 0, angularRadius: 0 }
        this.entryPool[count] = entry
      }
      entry.spot = spot
      entry.weight = weight
      entry.area = area
      entry.angularRadius = angularRadiusFromArea(area, radius)
      active[count] = entry
      count += 1
    }
    active.length = count
    this.coverage = clamp(coveredArea / surfaceArea, 0, 1)

    active.sort((a, b) => b.area - a.area)

    const buffer = this.renderBuffer
    buffer.length = 0
    for (const entry of active) {
      if (buffer.length >= MAX_RENDERED_SUNSPOTS) break
      const { latitude, longitude, umbraFraction } = entry.spot
      const cosLatitude = Math.cos(latitude)
      const plageAngularRadius = Math.min(entry.angularRadius * 1.6, Math.PI / 2)
      buffer.push({
        direction: [cosLatitude * Math.cos(longitude), Math.sin(latitude), cosLatitude * Math.sin(longitude)],
        angularRadius: entry.angularRadius,
        umbraFraction,
        plageAngularRadius,
        weight: entry.weight,
      })
    }
    return buffer
  }
}
