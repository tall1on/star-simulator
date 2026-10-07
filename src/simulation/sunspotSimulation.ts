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
} from '@/physics/sunspots'

/** Active regions emerging per simulated day at full activity. */
export const BASE_REGIONS_PER_DAY = 0.35
/** Hard cap on simultaneously tracked spots (keeps the per-frame work bounded). */
export const MAX_ACTIVE_SPOTS = 48
/** Fixed seed so every session and every reset starts identically. */
const SIMULATION_SEED = 0x5eed

const DEFAULT_CONFIG: SunspotConfig = {
  enabled: true,
  running: true,
  activity: 0.6,
  speedDaysPerSecond: 1,
  rotationPeriodDays: 25,
  radius: SOLAR_RADIUS,
  temperature: 5772,
  supported: false,
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

  /** Reused output buffer and scratch pools so the per-frame path allocates nothing. */
  private readonly renderBuffer: SunspotRenderData[] = []
  private readonly activeScratch: RenderedEntry[] = []
  private readonly entryPool: RenderedEntry[] = []

  /** Apply the current controls & stellar state. Clears spots if support is lost. */
  configure(next: SunspotConfig): void {
    if (!next.supported && this.config.supported) {
      this.clear()
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

  /** Advance by a real-time delta. No-op while disabled, paused or unsupported. */
  step(realDeltaSeconds: number): void {
    const { enabled, running, supported, speedDaysPerSecond } = this.config
    if (!enabled || !running || !supported) return
    if (!(realDeltaSeconds > 0)) return
    this.advance(realDeltaSeconds * speedDaysPerSecond * SECONDS_PER_DAY)
  }

  /** Advance by an explicit simulated-time delta, seconds. */
  advance(simDeltaSeconds: number): void {
    if (!(simDeltaSeconds > 0)) return

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
    const regionsPerSecond = (BASE_REGIONS_PER_DAY * activity) / SECONDS_PER_DAY
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
    const planned = planRegion(this.random, activity, surfaceArea)
    const regionId = this.nextRegionId
    this.nextRegionId += 1
    for (const plan of planned) {
      if (this.spots.length >= MAX_ACTIVE_SPOTS) break
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
      buffer.push({
        direction: [cosLatitude * Math.cos(longitude), Math.sin(latitude), cosLatitude * Math.sin(longitude)],
        angularRadius: entry.angularRadius,
        umbraFraction,
        weight: entry.weight,
      })
    }
    return buffer
  }
}
