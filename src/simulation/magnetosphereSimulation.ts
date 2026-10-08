import { SECONDS_PER_DAY, SOLAR_RADIUS, clamp } from '@/physics/relations'
import { angularVelocityAtLatitude, mulberry32 } from '@/physics/sunspots'
import {
  SPEED_OF_LIGHT,
  alfvenCrossingSeconds,
  alfvenSpeed,
  angularVelocity,
  confinementRadiusMetres,
  coronalPlasmaPressure,
  footpointShearRate,
  freeMagneticEnergy,
  lightCylinderRadiusMetres,
  magneticPressure,
  plasmaBeta,
  plasmaDensityForRegime,
  reconnectionRate,
  supportsDifferentialRotation,
  windRamPressure,
} from '@/physics/magnetosphere'
import type {
  FieldLineKind,
  MagnetosphereConfig,
  MagnetosphereDiagnostics,
} from '@/types/magnetosphere'

/**
 * Reduced-order magnetosphere simulation with evolving magnetic connectivity.
 *
 * Deliberately a plain class, not reactive state: the render loop must not push
 * per-frame geometry through Vue reactivity. A Pinia store owns the controls;
 * this object owns the evolving magnetic state.
 *
 * ## Model (documented approximations, not MHD)
 * - **Background dipole**: smooth closed loops with symmetric footpoints, so
 *   they carry no torsional winding by themselves.
 * - **Bipolar magnetic regions (BMRs)**: seeded, activity-scaled regions emerge,
 *   drift with latitude-dependent rotation and surface libration, then decay.
 *   Each hosts one to three flux-tube **bundles**; their unequal heights and
 *   clustered layout come from region flux, separation and confinement, not
 *   from per-vertex noise.
 * - **Bundles** store a signed footpoint shear driven by differential rotation
 *   plus a prescribed turbulent surface motion (integrated in closed form so a
 *   step cannot alias it), a damped magnetic-tension spring for the apex, and a
 *   free magnetic energy E ≈ p_B·V·(θ/θ_ref)².
 * - **Reconnection** happens when the shear crosses a seed-derived threshold:
 *   connectivity is swapped with a neighbouring bundle, shear and energy drop,
 *   and the loop contracts (confined flare) or, when weakly confined near the
 *   confinement radius, a bright **ejectum** escapes to larger radius.
 * - **Open lines** wind into a Parker spiral with a corotation-capped outflow and
 *   the rotation rate read ∫ds/v seconds earlier.
 *
 * Geometry is authored in star-radius units and updated in place in a fixed slot
 * pool, so topology changes never reallocate GPU buffers or reset particles.
 */

const SIMULATION_SEED = 0x5eedb00b

const MAX_NODES = 48
const OPEN_SLOTS = 16
const CLOSED_SHELLS = [1.3, 1.8, 2.6] as const
const CLOSED_AZIMUTHS = 6
const CLOSED_SLOTS = CLOSED_SHELLS.length * CLOSED_AZIMUTHS
const BUNDLE_SLOTS = 28
const EJECTA_SLOTS = 8
const OPEN_BASE = 0
const CLOSED_BASE = OPEN_BASE + OPEN_SLOTS
const BUNDLE_BASE = CLOSED_BASE + CLOSED_SLOTS
const EJECTA_BASE = BUNDLE_BASE + BUNDLE_SLOTS
const SLOT_COUNT = EJECTA_BASE + EJECTA_SLOTS
const OPEN_MAX_RADII = 6

const MAX_REGIONS = 6
/** Mean days between region emergences at activity 1. */
const REGION_INTERVAL_DAYS = 1.5
const REGION_LIFETIME_MIN_DAYS = 6
const REGION_LIFETIME_SPAN_DAYS = 16
const REGION_BELT_CENTER = 0.38
const REGION_BELT_HALF_WIDTH = 0.22
const REGION_SEPARATION_MIN = 0.18
const REGION_SEPARATION_SPAN = 0.34
const REGION_LIBRATION_AMPLITUDE = 0.08
const REGION_LIBRATION_PERIOD_DAYS = 7

/** Footpoint shear relaxes (reconnects) on this timescale, days. */
const STRESS_RELAX_DAYS = 60
/** Decay timescale after a region dies, days. */
const DECAY_RELAX_DAYS = 5
/** Prescribed turbulent surface motion, rad/s amplitude and period. */
const TURBULENT_SHEAR_AMPLITUDE = 4e-7
const TURBULENT_SHEAR_PERIOD_DAYS = 3.5
/** Damping ratio of the loop apex spring. */
const APEX_DAMPING = 0.15
/** Contraction speed imparted by a confined reconnection, star-radii/s. */
const RECOIL_SPEED = 2e-4
/** Compact (neutron-star) shear events: interval at activity 1, duration and peak displacement. */
const COMPACT_EVENT_INTERVAL_DAYS = 10
const COMPACT_EVENT_DURATION_DAYS = 4
const COMPACT_EVENT_DISPLACEMENT = 0.8
/** Base erupted fraction and the additional stress / weak-confinement contributions. */
const ERUPTION_BASE_PROBABILITY = 0.25
const EJECTA_DURATION_DAYS = 5
const EJECTA_START_RADIUS = 1.4
const EJECTA_EXPANSION = 5.5
const RECONNECT_PARTNER_DISTANCE = 0.9
const STRESS_RELEASE = 0.35
/** Minimum time between reconnection events for a bundle, days (rate limit). */
const RECONNECT_COOLDOWN_FLOOR_DAYS = 0.25
const MAX_TORSION_RADIANS = Math.PI / 2
const MAX_OPEN_WINDING_RADIANS = 20
const MAX_CONFINEMENT_RADII_GEOMETRY = 6
const COMPACT_RELAXATION_SECONDS = 2 * SECONDS_PER_DAY
const OMEGA_HISTORY_LIMIT = 64

/** Event-focus playback: slow simulated time while a fast event is in flight. */
const EVENT_FOCUS_SLOWDOWN = 0.2
const EVENT_FOCUS_WINDOW_DAYS = 2

/**
 * Internal chunking of a step. Regions are born and die on absolute times, so a
 * single huge step must be processed in bounded slices for the region population
 * to evolve as it would under many small steps (frame-rate independence).
 */
const MAX_CHUNK_SECONDS = 0.2 * SECONDS_PER_DAY
const MAX_CHUNKS = 512

const DEFAULT_CONFIG: MagnetosphereConfig = {
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
}

const EMPTY_POSITIONS = new Float32Array(0)

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

type Vec3 = readonly [number, number, number]

function dirFromLatLon(latitude: number, longitude: number): Vec3 {
  const cosLat = Math.cos(latitude)
  return [cosLat * Math.cos(longitude), Math.sin(latitude), cosLat * Math.sin(longitude)]
}

function latitudeOf(direction: Vec3): number {
  return Math.asin(clamp(direction[1], -1, 1))
}

function angularDistance(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1))
}

function slerpDirection(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)
  const omega = Math.acos(dot)
  const sinOmega = Math.sin(omega)
  if (sinOmega < 1e-6) {
    const x = a[0] + (b[0] - a[0]) * t
    const y = a[1] + (b[1] - a[1]) * t
    const z = a[2] + (b[2] - a[2]) * t
    const inv = 1 / Math.max(Math.hypot(x, y, z), Number.EPSILON)
    return [x * inv, y * inv, z * inv]
  }
  const w1 = Math.sin((1 - t) * omega) / sinOmega
  const w2 = Math.sin(t * omega) / sinOmega
  return [a[0] * w1 + b[0] * w2, a[1] * w1 + b[1] * w2, a[2] * w1 + b[2] * w2]
}

interface SimSlot {
  kind: FieldLineKind
  active: boolean
  nodes: number
  /** Baseline (untwisted) geometry, xyz interleaved, star radii. */
  base: Float32Array
  baseRadius: Float32Array
  arc: Float32Array
  positions: Float32Array
  xi: Float32Array
  totalLength: number
}

interface Bundle {
  id: number
  slot: number
  regionId: number
  dirA: Vec3
  dirB: Vec3
  separation: number
  /** Equilibrium apex height, star radii (from separation and confinement). */
  baseApex: number
  apex: number
  apexVelocity: number
  stress: number
  reconnectThreshold: number
  turbAmplitude: number
  turbPhase: number
  turbPeriodSeconds: number
  /** Deterministic per-bundle draw used to decide confined flare vs eruption. */
  eruptionSeed: number
  /** Fixed azimuth offset of this bundle within its region. */
  lonOffset: number
  state: 'stable' | 'decaying'
  /** Prescribed compact shear event (ramp→hold→decay) instead of rotation-driven shear. */
  prescribed: boolean
  eventStart: number
  eventEnd: number
  eventDisplacement: number
  /** No further reconnection before this simulated time (rate-limited). */
  cooldownUntil: number
}

interface Bmr {
  id: number
  latitude: number
  longitude0: number
  tilt: number
  separation: number
  flux: number
  birthSeconds: number
  lifetimeSeconds: number
  bundleIds: number[]
}

interface Ejecta {
  slot: number
  startSeconds: number
  durationSeconds: number
  dirA: Vec3
  dirB: Vec3
}

export class MagnetosphereSimulation {
  private config: MagnetosphereConfig = { ...DEFAULT_CONFIG }
  private readonly slots: SimSlot[] = []
  private readonly openIndices: number[] = []
  private bundles: Bundle[] = []
  private regions: Bmr[] = []
  private ejecta: Ejecta[] = []
  private nextBundleId = 1
  private nextRegionId = 1
  private elapsedSeconds = 0
  private spinAngleValue = 0
  private random = mulberry32(SIMULATION_SEED)
  private omegaHistory: { time: number; omega: number }[] = []
  private nextRegionSeconds = 0
  private nextCompactSeconds = 0
  private lastEventSeconds = -Infinity
  private reconnectionCount = 0
  private flareCount = 0
  private eruptionCount = 0
  private releasedEnergy = 0
  private vA = SPEED_OF_LIGHT

  constructor() {
    this.buildSlots()
    this.recordOmega()
  }

  // -- Configuration ---------------------------------------------------------

  configure(next: MagnetosphereConfig): void {
    this.config = {
      ...next,
      timeScaleDaysPerSecond: finite(next.timeScaleDaysPerSecond, DEFAULT_CONFIG.timeScaleDaysPerSecond),
      fieldStrength: finite(next.fieldStrength, DEFAULT_CONFIG.fieldStrength),
      windSpeed: finite(next.windSpeed, DEFAULT_CONFIG.windSpeed),
      massLossRate: finite(next.massLossRate, DEFAULT_CONFIG.massLossRate),
      rotationPeriod: finite(next.rotationPeriod, DEFAULT_CONFIG.rotationPeriod),
      tilt: finite(next.tilt, DEFAULT_CONFIG.tilt),
      radius: finite(next.radius, DEFAULT_CONFIG.radius),
      temperature: finite(next.temperature, DEFAULT_CONFIG.temperature),
      activity: finite(next.activity, DEFAULT_CONFIG.activity),
    }
    this.vA = alfvenSpeed(this.config.fieldStrength, plasmaDensityForRegime(this.config.regime))
    this.recordOmega()
  }

  reset(): void {
    this.bundles = []
    this.regions = []
    this.ejecta = []
    this.nextBundleId = 1
    this.nextRegionId = 1
    this.elapsedSeconds = 0
    this.spinAngleValue = 0
    this.random = mulberry32(SIMULATION_SEED)
    this.nextRegionSeconds = 0
    this.nextCompactSeconds = 0
    this.lastEventSeconds = -Infinity
    this.reconnectionCount = 0
    this.flareCount = 0
    this.eruptionCount = 0
    this.releasedEnergy = 0
    this.omegaHistory = []
    for (const slot of this.slots) slot.xi.fill(0)
    this.clearDynamicSlots()
    this.rebuildStaticSlots()
    this.recordOmega()
    this.recomputePositions()
  }

  private clearDynamicSlots(): void {
    for (let i = BUNDLE_BASE; i < SLOT_COUNT; i++) {
      const slot = this.slots[i]
      if (slot) slot.active = false
    }
  }

  // -- Advance ---------------------------------------------------------------

  step(realDeltaSeconds: number): void {
    const { enabled, running, timeScaleDaysPerSecond } = this.config
    if (!enabled || !running) return
    if (!(realDeltaSeconds > 0)) return
    let simDelta = realDeltaSeconds * timeScaleDaysPerSecond * SECONDS_PER_DAY
    if (!(simDelta > 0)) return
    // Event-focus playback: temporarily slow time while a fast event is visible.
    if (this.config.eventFocus && this.eventInFlight()) simDelta *= EVENT_FOCUS_SLOWDOWN
    this.advance(simDelta)
    this.spinAngleValue += this.spinRateFor() * realDeltaSeconds
  }

  /** Advance by an explicit simulated-time delta, seconds (used by tests). */
  advance(simDeltaSeconds: number): void {
    if (!(simDeltaSeconds > 0)) return
    const chunks = clamp(Math.ceil(simDeltaSeconds / MAX_CHUNK_SECONDS), 1, MAX_CHUNKS)
    const chunk = simDeltaSeconds / chunks
    for (let c = 0; c < chunks; c++) this.advanceChunk(chunk)
    this.recomputePositions()
  }

  private advanceChunk(simDeltaSeconds: number): void {
    const endSeconds = this.elapsedSeconds + simDeltaSeconds
    if (this.config.regime === 'compact') this.scheduleCompactShear(endSeconds)
    else this.scheduleRegions(endSeconds)
    this.elapsedSeconds = endSeconds
    this.updateRegions()
    this.updateBundles(simDeltaSeconds)
    this.resolveReconnections()
    this.updateEjecta()
    for (const index of this.openIndices) {
      const slot = this.slots[index]
      if (slot) this.updateOpenLine(slot)
    }
  }

  // -- Accessors for the render layer / tests --------------------------------

  get spinAngle(): number {
    return this.spinAngleValue
  }

  get slotCount(): number {
    return this.slots.length
  }

  get openLineCount(): number {
    return this.openIndices.length
  }

  get regionCount(): number {
    return this.regions.length
  }

  get bundleCount(): number {
    return this.bundles.length
  }

  get ejectaCount(): number {
    return this.ejecta.length
  }

  get reconnectionCounts(): { reconnections: number; flares: number; eruptions: number } {
    return { reconnections: this.reconnectionCount, flares: this.flareCount, eruptions: this.eruptionCount }
  }

  slotActive(index: number): boolean {
    return this.slots[index]?.active ?? false
  }

  slotKind(index: number): FieldLineKind {
    return this.slots[index]?.kind ?? 'closed'
  }

  /** Static pool grouping by index range, independent of active state. */
  slotGroup(index: number): FieldLineKind {
    if (index < CLOSED_BASE) return 'open'
    if (index < BUNDLE_BASE) return 'closed'
    if (index < EJECTA_BASE) return 'bundle'
    return 'ejecta'
  }

  slotPositions(index: number): Float32Array {
    return this.slots[index]?.positions ?? EMPTY_POSITIONS
  }

  /** Maximum absolute torsional displacement of a slot, radians. */
  lineMaxTwist(index: number): number {
    const slot = this.slots[index]
    if (!slot) return 0
    let max = 0
    for (let i = 0; i < slot.nodes; i++) max = Math.max(max, Math.abs(slot.xi[i] ?? 0))
    return max
  }

  /** Apex height of a bundle/ejecta slot, star radii (tests). */
  slotApex(index: number): number {
    return this.slots[index]?.baseRadius[Math.floor((this.slots[index]?.nodes ?? 1) / 2)] ?? 0
  }

  /** Footpoint directions of a bundle slot (tests). */
  slotFootpoints(index: number): { a: Vec3; b: Vec3 } | undefined {
    const bundle = this.bundles.find((candidate) => candidate.slot === index)
    if (!bundle) return undefined
    return { a: bundle.dirA, b: bundle.dirB }
  }

  openLinePositions(openIndex: number): Float32Array {
    const slot = this.slots[this.openIndices[openIndex] ?? -1]
    return slot?.positions ?? EMPTY_POSITIONS
  }

  openLineNodeTwist(openIndex: number, node: number): number {
    const slot = this.slots[this.openIndices[openIndex] ?? -1]
    return slot?.xi[node] ?? 0
  }

  /** Max absolute winding of an open line, radians (tests). */
  openLineMaxTwist(openIndex: number): number {
    return this.lineMaxTwist(this.openIndices[openIndex] ?? -1)
  }

  sampleOpenLine(openIndex: number, p: number, out: Float32Array, offset: number): void {
    const slot = this.slots[this.openIndices[openIndex] ?? -1]
    if (!slot) return
    this.sampleSlotArc(slot, p, out, offset)
  }

  diagnostics(): MagnetosphereDiagnostics {
    let maxTwist = 0
    let maxOpenWinding = 0
    let crossing = 0
    let freeEnergy = 0
    let lineCount = 0
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]
      if (!slot?.active) continue
      lineCount += 1
      let lineMax = 0
      for (let n = 0; n < slot.nodes; n++) lineMax = Math.max(lineMax, Math.abs(slot.xi[n] ?? 0))
      if (slot.kind === 'open') {
        maxOpenWinding = Math.max(maxOpenWinding, lineMax)
      } else {
        maxTwist = Math.max(maxTwist, lineMax)
        crossing = Math.max(crossing, alfvenCrossingSeconds(slot.totalLength * this.config.radius, this.vA))
      }
    }
    for (const bundle of this.bundles) {
      if (bundle.state !== 'stable') continue
      const lengthMetres = (this.slots[bundle.slot]?.totalLength ?? 1) * this.config.radius
      const volume = lengthMetres * this.config.radius * this.config.radius
      freeEnergy += freeMagneticEnergy(this.config.fieldStrength, volume, Math.abs(bundle.stress))
    }
    const radius = Math.max(this.config.radius, Number.EPSILON)
    const windSpeedMs = this.config.windSpeed * 1000
    const exceedsLightCylinder =
      OPEN_MAX_RADII * radius > lightCylinderRadiusMetres(this.config.rotationPeriod)
    return {
      maxTwist,
      maxOpenWinding,
      alfvenCrossingSeconds: crossing,
      lineCount,
      openLineCount: this.openIndices.length,
      regions: this.regions.length,
      bundles: this.bundles.length,
      reconnections: this.reconnectionCount,
      flares: this.flareCount,
      eruptions: this.eruptionCount,
      activeEjecta: this.ejecta.length,
      freeEnergy,
      releasedEnergy: this.releasedEnergy,
      magneticPressure: magneticPressure(this.config.fieldStrength),
      windRamPressure: windRamPressure(this.config.massLossRate, windSpeedMs, radius),
      plasmaBeta: plasmaBeta(
        coronalPlasmaPressure(plasmaDensityForRegime(this.config.regime)),
        this.config.fieldStrength,
      ),
      confinementRadiusMetres: confinementRadiusMetres(
        radius,
        this.config.fieldStrength,
        this.config.massLossRate,
        windSpeedMs,
      ),
      elapsedDays: this.elapsedSeconds / SECONDS_PER_DAY,
      regime: this.config.regime,
      differentialRotation: supportsDifferentialRotation(this.config.regime),
      exceedsLightCylinder,
    }
  }

  // -- Regions ---------------------------------------------------------------

  private scheduleRegions(endTimeSeconds: number): void {
    const activity = clamp(this.config.activity, 0, 1)
    if (activity <= 0) {
      this.nextRegionSeconds = endTimeSeconds + REGION_INTERVAL_DAYS * SECONDS_PER_DAY
      return
    }
    const interval = (REGION_INTERVAL_DAYS / activity) * SECONDS_PER_DAY
    let guard = 0
    while (endTimeSeconds >= this.nextRegionSeconds && guard < 32) {
      const startTime = this.nextRegionSeconds
      // Expire by absolute time so the accepted/rejected sequence (and its RNG
      // draws) does not depend on the step boundaries.
      this.expireRegions(startTime)
      if (this.regions.length < MAX_REGIONS) this.spawnRegion(activity, startTime)
      this.nextRegionSeconds = startTime + interval
      guard += 1
    }
  }

  /** Drop regions whose lifetime ended at or before `timeSeconds`; their bundles decay. */
  private expireRegions(timeSeconds: number): void {
    let write = 0
    for (const region of this.regions) {
      if (region.birthSeconds + region.lifetimeSeconds <= timeSeconds) {
        for (const id of region.bundleIds) {
          const bundle = this.bundles.find((candidate) => candidate.id === id)
          if (bundle) bundle.state = 'decaying'
        }
        continue
      }
      this.regions[write] = region
      write += 1
    }
    this.regions.length = write
  }

  private spawnRegion(activity: number, startTime: number): void {
    const hemisphere = this.random() < 0.5 ? -1 : 1
    const latitude = clamp(hemisphere * (REGION_BELT_CENTER + (this.random() * 2 - 1) * REGION_BELT_HALF_WIDTH), -1.2, 1.2)
    const longitude0 = this.random() * Math.PI * 2
    const tilt = (this.random() * 2 - 1) * 0.5
    const separation = REGION_SEPARATION_MIN + this.random() * REGION_SEPARATION_SPAN
    const flux = 0.2 + this.random() * 0.8
    const lifetimeSeconds =
      (REGION_LIFETIME_MIN_DAYS + this.random() * REGION_LIFETIME_SPAN_DAYS) * SECONDS_PER_DAY
    const bundleCount = Math.max(1, Math.round(1 + this.random() * 2 * activity))
    const region: Bmr = {
      id: this.nextRegionId,
      latitude,
      longitude0,
      tilt,
      separation,
      flux,
      birthSeconds: startTime,
      lifetimeSeconds,
      bundleIds: [],
    }
    this.nextRegionId += 1
    this.regions.push(region)
    for (let k = 0; k < bundleCount; k++) {
      const slot = this.allocateSlot(BUNDLE_BASE, EJECTA_BASE, 'bundle')
      if (slot < 0) break
      const factor = bundleCount === 1 ? 1 : 0.75 + (0.5 * k) / (bundleCount - 1)
      const sep = separation * factor
      const lonOffset = (k - (bundleCount - 1) / 2) * 0.05
      const { dirA, dirB } = this.regionFootpoints(latitude, longitude0, tilt, sep, lonOffset)
      const bundle: Bundle = {
        id: this.nextBundleId,
        slot,
        regionId: region.id,
        dirA,
        dirB,
        separation: sep,
        baseApex: 1.2,
        apex: 1.2,
        apexVelocity: 0,
        stress: 0,
        reconnectThreshold: 0.18 + this.random() * 0.35,
        turbAmplitude: TURBULENT_SHEAR_AMPLITUDE * (0.5 + this.random()),
        turbPhase: this.random() * Math.PI * 2,
        turbPeriodSeconds: TURBULENT_SHEAR_PERIOD_DAYS * SECONDS_PER_DAY * (0.7 + this.random() * 0.6),
        eruptionSeed: this.random(),
        lonOffset,
        state: 'stable',
        prescribed: false,
        eventStart: 0,
        eventEnd: 0,
        eventDisplacement: 0,
        cooldownUntil: -Infinity,
      }
      this.nextBundleId += 1
      this.bundles.push(bundle)
      region.bundleIds.push(bundle.id)
      this.fillLoop(this.slots[slot], dirA, dirB, bundle.apex)
    }
  }

  private regionFootpoints(
    latitude: number,
    longitude: number,
    tilt: number,
    separation: number,
    longitudeOffset: number,
  ): { dirA: Vec3; dirB: Vec3 } {
    const half = separation * 0.5
    const dLat = half * Math.cos(tilt)
    const dLon = half * Math.sin(tilt)
    const dirA = dirFromLatLon(latitude + dLat, longitude + dLon + longitudeOffset)
    const dirB = dirFromLatLon(latitude - dLat, longitude - dLon + longitudeOffset)
    return { dirA, dirB }
  }

  // -- Compact shear events --------------------------------------------------

  private scheduleCompactShear(endTimeSeconds: number): void {
    const activity = clamp(this.config.activity, 0, 1)
    const interval = (COMPACT_EVENT_INTERVAL_DAYS / Math.max(activity, 0.15)) * SECONDS_PER_DAY
    if (activity <= 0) {
      this.nextCompactSeconds = endTimeSeconds + interval
      return
    }
    let guard = 0
    while (endTimeSeconds >= this.nextCompactSeconds && guard < 32) {
      this.spawnCompactBundle(activity, this.nextCompactSeconds)
      this.nextCompactSeconds += interval
      guard += 1
    }
  }

  private spawnCompactBundle(activity: number, startTime: number): void {
    const slot = this.allocateSlot(BUNDLE_BASE, EJECTA_BASE, 'bundle')
    if (slot < 0) return
    const hemisphere = this.random() < 0.5 ? -1 : 1
    const latitude = hemisphere * (0.2 + this.random() * 0.4)
    const longitude = this.random() * Math.PI * 2
    const tilt = (this.random() * 2 - 1) * 0.5
    const separation = 0.25 + this.random() * 0.25
    const { dirA, dirB } = this.regionFootpoints(latitude, longitude, tilt, separation, 0)
    const sign = this.random() < 0.5 ? -1 : 1
    const bundle: Bundle = {
      id: this.nextBundleId,
      slot,
      regionId: -1,
      dirA,
      dirB,
      separation,
      baseApex: 1.3,
      apex: 1.3,
      apexVelocity: 0,
      stress: 0,
      reconnectThreshold: 0.25 + this.random() * 0.3,
      turbAmplitude: 0,
      turbPhase: this.random() * Math.PI * 2,
      turbPeriodSeconds: COMPACT_EVENT_DURATION_DAYS * SECONDS_PER_DAY,
      eruptionSeed: this.random(),
      lonOffset: 0,
      state: 'stable',
      prescribed: true,
      eventStart: startTime,
      eventEnd: startTime + COMPACT_EVENT_DURATION_DAYS * SECONDS_PER_DAY,
      eventDisplacement: COMPACT_EVENT_DISPLACEMENT * activity * sign,
      cooldownUntil: -Infinity,
    }
    this.nextBundleId += 1
    bundle.baseApex = this.equilibriumApex(bundle, 1)
    bundle.apex = bundle.baseApex
    this.bundles.push(bundle)
    this.fillLoop(this.slots[slot], dirA, dirB, bundle.apex)
  }

  private updateRegions(): void {
    this.expireRegions(this.elapsedSeconds)

    // Drift each living region's bundles to the current (time-parameterised)
    // footpoint positions; the region's flux also fades through its lifetime.
    for (const region of this.regions) {
      const ageFraction = (this.elapsedSeconds - region.birthSeconds) / region.lifetimeSeconds
      const enveloped = Math.max(0.05, Math.sin(Math.PI * clamp(ageFraction, 0, 1)) ** 0.5)
      const omega = angularVelocityAtLatitude(this.config.rotationPeriod, region.latitude)
      const libration =
        REGION_LIBRATION_AMPLITUDE *
        Math.sin((this.elapsedSeconds / (REGION_LIBRATION_PERIOD_DAYS * SECONDS_PER_DAY)) + region.id)
      const longitude = region.longitude0 + omega * (this.elapsedSeconds - region.birthSeconds) + libration
      for (const id of region.bundleIds) {
        const bundle = this.bundles.find((candidate) => candidate.id === id)
        if (!bundle || bundle.state !== 'stable') continue
        const foot = this.regionFootpoints(
          region.latitude,
          longitude,
          region.tilt,
          bundle.separation,
          bundle.lonOffset,
        )
        bundle.dirA = foot.dirA
        bundle.dirB = foot.dirB
        bundle.baseApex = this.equilibriumApex(bundle, enveloped)
      }
    }
  }

  private equilibriumApex(bundle: Bundle, fluxEnvelope: number): number {
    const radius = Math.max(this.config.radius, Number.EPSILON)
    const confinementRadii = clamp(
      confinementRadiusMetres(radius, this.config.fieldStrength, this.config.massLossRate, this.config.windSpeed * 1000) /
        radius,
      1.05,
      MAX_CONFINEMENT_RADII_GEOMETRY,
    )
    // A potential loop's apex rises with separation; a stronger region (flux)
    // and a larger confinement radius allow a taller, more inflated loop, up to
    // the radius where the wind can no longer confine it.
    const potential = 1 + bundle.separation * 0.4 * (0.6 + 0.8 * fluxEnvelope) * confinementRadii
    return clamp(potential, 1.12, Math.max(1.12, confinementRadii))
  }

  // -- Bundles ---------------------------------------------------------------

  private updateBundles(simDeltaSeconds: number): void {
    const differential = supportsDifferentialRotation(this.config.regime)
    for (const bundle of this.bundles) {
      const slot = this.slots[bundle.slot]
      if (!slot) continue
      if (bundle.state === 'decaying') {
        const decayTau = DECAY_RELAX_DAYS * SECONDS_PER_DAY
        bundle.stress *= Math.exp(-simDeltaSeconds / decayTau)
        bundle.baseApex = 1.08
        this.integrateApex(bundle, simDeltaSeconds)
        this.fillLoop(slot, bundle.dirA, bundle.dirB, bundle.apex)
        this.relaxTubeXI(bundle, slot, simDeltaSeconds)
        if (bundle.apex < 1.1 && Math.abs(bundle.stress) < 0.05) {
          slot.active = false
          bundle.slot = -1
        }
        continue
      }

      if (bundle.prescribed) {
        if (this.elapsedSeconds <= bundle.eventEnd) {
          const duration = Math.max(bundle.eventEnd - bundle.eventStart, Number.EPSILON)
          const progress = clamp((this.elapsedSeconds - bundle.eventStart) / duration, 0, 1)
          bundle.stress = bundle.eventDisplacement * Math.sin(Math.PI * progress)
        } else {
          bundle.stress *= Math.exp(-simDeltaSeconds / (DECAY_RELAX_DAYS * SECONDS_PER_DAY))
        }
        this.integrateApex(bundle, simDeltaSeconds)
        this.fillLoop(slot, bundle.dirA, bundle.dirB, bundle.apex)
        this.relaxTubeXI(bundle, slot, simDeltaSeconds)
        if (this.elapsedSeconds > bundle.eventEnd && bundle.apex < 1.12 && Math.abs(bundle.stress) < 0.05) {
          slot.active = false
          bundle.slot = -1
        }
        continue
      }

      const differentialRate = footpointShearRate(
        this.config.rotationPeriod,
        latitudeOf(bundle.dirA),
        latitudeOf(bundle.dirB),
        differential,
      )
      bundle.stress = clamp(
        this.integrateStress(bundle, differentialRate, simDeltaSeconds),
        -MAX_TORSION_RADIANS,
        MAX_TORSION_RADIANS,
      )

      this.integrateApex(bundle, simDeltaSeconds)
      this.fillLoop(slot, bundle.dirA, bundle.dirB, bundle.apex)
      this.relaxTubeXI(bundle, slot, simDeltaSeconds)
    }
    this.bundles = this.bundles.filter((bundle) => bundle.slot >= 0)
  }

  /**
   * Exact solution of dS/dt = r0 + A·cos(ωt+φ) − S/τ over one step, so the
   * driven shear is a pure function of time and independent of the step size.
   */
  private integrateStress(bundle: Bundle, differentialRate: number, simDeltaSeconds: number): number {
    const mu = 1 / (STRESS_RELAX_DAYS * SECONDS_PER_DAY)
    const omega = 1 / Math.max(bundle.turbPeriodSeconds, Number.EPSILON)
    const denom = mu * mu + omega * omega
    const particular = denom > 0 ? bundle.turbAmplitude / denom : 0
    const decay = Math.exp(-mu * simDeltaSeconds)
    const t1 = this.elapsedSeconds
    const t0 = t1 - simDeltaSeconds
    const shape = (t: number): number => mu * Math.cos(omega * t + bundle.turbPhase) + omega * Math.sin(omega * t + bundle.turbPhase)
    const equilibrium = differentialRate / mu
    return bundle.stress * decay + equilibrium * (1 - decay) + particular * (shape(t1) - decay * shape(t0))
  }

  private integrateApex(bundle: Bundle, simDeltaSeconds: number): void {
    const lengthMetres = Math.max((this.slots[bundle.slot]?.totalLength ?? 1) * this.config.radius, 1)
    const omega = this.vA / lengthMetres
    const target = clamp(bundle.baseApex, 1.05, MAX_CONFINEMENT_RADII_GEOMETRY * 1.4)
    if (!(omega > 0) || !Number.isFinite(omega) || omega * simDeltaSeconds > 50) {
      bundle.apex = target
      bundle.apexVelocity = 0
      return
    }
    // Exact underdamped solution of the magnetic-tension spring — independent of
    // the step size for a constant target, so apex motion never depends on FPS.
    const zeta = APEX_DAMPING
    const a = zeta * omega
    const wd = omega * Math.sqrt(Math.max(1 - zeta * zeta, 1e-6))
    const y0 = bundle.apex - target
    const v0 = bundle.apexVelocity
    const decay = Math.exp(-a * simDeltaSeconds)
    const cos = Math.cos(wd * simDeltaSeconds)
    const sin = Math.sin(wd * simDeltaSeconds)
    const y = decay * (y0 * cos + ((v0 + a * y0) / wd) * sin)
    const v = decay * (v0 * cos - ((omega * omega * y0 + a * v0) / wd) * sin)
    bundle.apex = target + y
    bundle.apexVelocity = v
    const clamped = clamp(bundle.apex, 1.05, MAX_CONFINEMENT_RADII_GEOMETRY * 1.5)
    if (clamped !== bundle.apex) bundle.apexVelocity = 0
    bundle.apex = clamped
    if (!Number.isFinite(bundle.apex)) {
      bundle.apex = target
      bundle.apexVelocity = 0
    }
  }

  private relaxTubeXI(bundle: Bundle, slot: SimSlot, simDeltaSeconds: number): void {
    const crossing = alfvenCrossingSeconds(slot.totalLength * this.config.radius, this.vA)
    const relaxation =
      this.config.regime === 'compact' ? Math.max(crossing, COMPACT_RELAXATION_SECONDS) : Math.max(crossing, Number.EPSILON)
    const factor = 1 - Math.exp(-simDeltaSeconds / relaxation)
    const last = slot.nodes - 1
    const xi = slot.xi
    xi[0] = 0
    xi[last] = clamp(bundle.stress, -MAX_TORSION_RADIANS, MAX_TORSION_RADIANS)
    for (let i = 1; i < last; i++) {
      const target = (bundle.stress * i) / last
      const current = xi[i] ?? 0
      xi[i] = target + (current - target) * factor
    }
  }

  // -- Reconnection ----------------------------------------------------------

  private resolveReconnections(): void {
    const radius = Math.max(this.config.radius, Number.EPSILON)
    const confinementRadii = clamp(
      confinementRadiusMetres(radius, this.config.fieldStrength, this.config.massLossRate, this.config.windSpeed * 1000) /
        radius,
      1.05,
      MAX_CONFINEMENT_RADII_GEOMETRY,
    )
    for (const bundle of this.bundles) {
      if (bundle.state !== 'stable') continue
      if (this.elapsedSeconds < bundle.cooldownUntil) continue
      const stressMagnitude = Math.abs(bundle.stress)
      if (stressMagnitude < bundle.reconnectThreshold) continue
      const slot = this.slots[bundle.slot]
      if (!slot) continue
      const lengthMetres = Math.max(slot.totalLength * radius, 1)
      const volume = lengthMetres * radius * radius
      const before = freeMagneticEnergy(this.config.fieldStrength, volume, stressMagnitude)
      const partner = this.findPartner(bundle)
      let beforePartner = 0
      if (partner) {
        const partnerSlot = this.slots[partner.slot]
        if (partnerSlot) {
          const partnerLength = Math.max(partnerSlot.totalLength * radius, 1)
          beforePartner = freeMagneticEnergy(
            this.config.fieldStrength,
            partnerLength * radius * radius,
            Math.abs(partner.stress),
          )
        }
      }
      const releasedBundle = this.applyRelease(bundle)
      let releasedPartner = 0
      if (partner) {
        releasedPartner = this.applyRelease(partner)
        const swap = bundle.dirB
        bundle.dirB = partner.dirB
        partner.dirB = swap
        bundle.baseApex = this.equilibriumApex(bundle, 1)
        partner.baseApex = this.equilibriumApex(partner, 1)
      }
      const released = clamp(releasedBundle + releasedPartner, 0, before + beforePartner)
      this.releasedEnergy += released
      this.reconnectionCount += 1
      this.lastEventSeconds = this.elapsedSeconds

      // Rate-limit: an event releases over a time set by the inflow speed, so a
      // bundle cannot re-trigger until it has had time to reconnect again.
      const cooldown = Math.max(
        lengthMetres / Math.max(reconnectionRate(this.vA), Number.EPSILON),
        RECONNECT_COOLDOWN_FLOOR_DAYS * SECONDS_PER_DAY,
      )
      bundle.cooldownUntil = this.elapsedSeconds + cooldown
      if (partner) partner.cooldownUntil = this.elapsedSeconds + cooldown

      const stressOver = clamp(
        (stressMagnitude - bundle.reconnectThreshold) / Math.max(bundle.reconnectThreshold, Number.EPSILON),
        0,
        1,
      )
      const confinementWeak = clamp(1 - confinementRadii / MAX_CONFINEMENT_RADII_GEOMETRY, 0, 1)
      const probability = clamp(
        ERUPTION_BASE_PROBABILITY + 0.5 * stressOver + 0.4 * confinementWeak,
        0,
        0.95,
      )
      const eruptive = bundle.eruptionSeed < probability
      if (eruptive) {
        if (this.spawnEjecta(bundle)) this.eruptionCount += 1
      } else {
        bundle.apexVelocity -= RECOIL_SPEED
        if (partner) partner.apexVelocity -= RECOIL_SPEED * 0.5
        this.flareCount += 1
      }
    }
  }

  private applyRelease(bundle: Bundle): number {
    const slot = this.slots[bundle.slot]
    if (!slot) return 0
    const lengthMetres = slot.totalLength * this.config.radius
    const volume = lengthMetres * this.config.radius * this.config.radius
    const before = freeMagneticEnergy(this.config.fieldStrength, volume, Math.abs(bundle.stress))
    // Guarantee the post-release shear sits below the trigger threshold so a
    // saturated bundle cannot cascade.
    const magnitude = Math.min(Math.abs(bundle.stress) * STRESS_RELEASE, bundle.reconnectThreshold * 0.5)
    bundle.stress = (bundle.stress < 0 ? -1 : 1) * magnitude
    const after = freeMagneticEnergy(this.config.fieldStrength, volume, Math.abs(bundle.stress))
    return Math.max(0, before - after)
  }

  private findPartner(bundle: Bundle): Bundle | undefined {
    let best: Bundle | undefined
    let bestDistance = RECONNECT_PARTNER_DISTANCE
    for (const candidate of this.bundles) {
      if (candidate === bundle || candidate.state !== 'stable') continue
      const distance = Math.min(
        angularDistance(bundle.dirA, candidate.dirA),
        angularDistance(bundle.dirA, candidate.dirB),
      )
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }
    return best
  }

  // -- Ejecta ----------------------------------------------------------------

  private spawnEjecta(bundle: Bundle): boolean {
    const slot = this.allocateSlot(EJECTA_BASE, SLOT_COUNT, 'ejecta')
    if (slot < 0) return false
    this.ejecta.push({
      slot,
      startSeconds: this.elapsedSeconds,
      durationSeconds: EJECTA_DURATION_DAYS * SECONDS_PER_DAY,
      dirA: bundle.dirA,
      dirB: bundle.dirB,
    })
    return true
  }

  private updateEjecta(): void {
    const remaining: Ejecta[] = []
    for (const event of this.ejecta) {
      const progress = (this.elapsedSeconds - event.startSeconds) / event.durationSeconds
      const slot = this.slots[event.slot]
      if (progress >= 1 || !slot) {
        if (slot) slot.active = false
        continue
      }
      const radius = EJECTA_START_RADIUS + EJECTA_EXPANSION * progress
      this.fillLoop(slot, event.dirA, event.dirB, radius)
      remaining.push(event)
    }
    this.ejecta = remaining
  }

  private eventInFlight(): boolean {
    if (this.ejecta.length > 0) return true
    return this.elapsedSeconds - this.lastEventSeconds <= EVENT_FOCUS_WINDOW_DAYS * SECONDS_PER_DAY
  }

  // -- Open lines ------------------------------------------------------------

  private updateOpenLine(slot: SimSlot): void {
    const windMs = Math.max(this.config.windSpeed * 1000, 1)
    const radius = Math.max(this.config.radius, Number.EPSILON)
    const omegaNow = angularVelocity(this.config.rotationPeriod)
    const xi = slot.xi
    xi[0] = 0
    let winding = 0
    let previousRadius = slot.baseRadius[0] ?? 1
    for (let i = 1; i < slot.nodes; i++) {
      const r = slot.baseRadius[i] ?? 1
      const rMetres = r * radius
      const outflow = Math.min(Math.max(windMs, omegaNow * rMetres), SPEED_OF_LIGHT)
      const delay = ((r - 1) * radius) / outflow
      const omegaDelayed = this.omegaAt(this.elapsedSeconds - delay)
      winding -= (omegaDelayed * ((r - previousRadius) * radius)) / outflow
      xi[i] = clamp(winding, -MAX_OPEN_WINDING_RADIANS, MAX_OPEN_WINDING_RADIANS)
      previousRadius = r
    }
  }

  private omegaAt(timeSeconds: number): number {
    const history = this.omegaHistory
    const first = history[0]
    if (!first) return 0
    let best = first
    for (const entry of history) {
      if (entry.time <= timeSeconds) best = entry
      else break
    }
    return best.omega
  }

  private recordOmega(): void {
    const omega = angularVelocity(this.config.rotationPeriod)
    const last = this.omegaHistory[this.omegaHistory.length - 1]
    if (last && last.omega === omega) return
    this.omegaHistory.push({ time: this.elapsedSeconds, omega })
    while (this.omegaHistory.length > OMEGA_HISTORY_LIMIT) this.omegaHistory.splice(1, 1)
  }

  private spinRateFor(): number {
    const periodDays = Math.max(this.config.rotationPeriod, 1e-9)
    const rate = (2 * Math.PI * this.config.timeScaleDaysPerSecond) / periodDays
    return clamp(rate, 0.0005, 12)
  }

  // -- Geometry --------------------------------------------------------------

  private buildSlots(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.slots.push({
        kind: 'closed',
        active: false,
        nodes: MAX_NODES + 1,
        base: new Float32Array((MAX_NODES + 1) * 3),
        baseRadius: new Float32Array(MAX_NODES + 1),
        arc: new Float32Array(MAX_NODES + 1),
        positions: new Float32Array((MAX_NODES + 1) * 3),
        xi: new Float32Array(MAX_NODES + 1),
        totalLength: 1,
      })
    }
    for (let i = OPEN_BASE; i < CLOSED_BASE; i++) {
      const slot = this.slots[i]
      if (slot) {
        slot.kind = 'open'
        this.openIndices.push(i)
      }
    }
    this.rebuildStaticSlots()
    this.recomputePositions()
  }

  private rebuildStaticSlots(): void {
    // Open polar field lines.
    let openSlot = OPEN_BASE
    for (const sign of [1, -1]) {
      for (let a = 0; a < OPEN_SLOTS / 2; a++) {
        const slot = this.slots[openSlot]
        openSlot += 1
        if (!slot) continue
        const phi0 = (a / (OPEN_SLOTS / 2)) * Math.PI * 2
        slot.active = true
        slot.kind = 'open'
        const nodes = slot.nodes
        for (let i = 0; i < nodes; i++) {
          const t = i / (nodes - 1)
          const r = OPEN_MAX_RADII ** t
          const theta = 0.5 * (1 - t)
          const sinTheta = Math.sin(theta)
          slot.base[i * 3] = r * sinTheta * Math.cos(phi0)
          slot.base[i * 3 + 1] = sign * r * Math.cos(theta)
          slot.base[i * 3 + 2] = r * sinTheta * Math.sin(phi0)
        }
        this.finalizeSlot(slot)
      }
    }
    // Background closed dipole loops.
    let closedSlot = CLOSED_BASE
    for (const shell of CLOSED_SHELLS) {
      const thetaStart = Math.asin(Math.sqrt(1 / shell))
      for (let a = 0; a < CLOSED_AZIMUTHS; a++) {
        const slot = this.slots[closedSlot]
        closedSlot += 1
        if (!slot) continue
        slot.active = true
        slot.kind = 'closed'
        const phi = (a / CLOSED_AZIMUTHS) * Math.PI * 2
        const nodes = slot.nodes
        for (let i = 0; i < nodes; i++) {
          const theta = thetaStart + (Math.PI - 2 * thetaStart) * (i / (nodes - 1))
          const sinTheta = Math.sin(theta)
          const r = shell * sinTheta * sinTheta
          slot.base[i * 3] = r * sinTheta * Math.cos(phi)
          slot.base[i * 3 + 1] = r * Math.cos(theta)
          slot.base[i * 3 + 2] = r * sinTheta * Math.sin(phi)
        }
        this.finalizeSlot(slot)
      }
    }
  }

  private allocateSlot(from: number, to: number, kind: FieldLineKind): number {
    for (let i = from; i < to; i++) {
      const slot = this.slots[i]
      if (slot && !slot.active) {
        slot.active = true
        slot.kind = kind
        slot.xi.fill(0)
        return i
      }
    }
    return -1
  }

  private fillLoop(slot: SimSlot | undefined, dirA: Vec3, dirB: Vec3, apex: number): void {
    if (!slot) return
    const nodes = slot.nodes
    const height = clamp(apex, 1.02, MAX_CONFINEMENT_RADII_GEOMETRY * 1.6)
    for (let i = 0; i < nodes; i++) {
      const t = i / (nodes - 1)
      const direction = slerpDirection(dirA, dirB, t)
      const shape = Math.sin(Math.PI * t) ** 0.8
      const radius = 1 + (height - 1) * shape
      slot.base[i * 3] = direction[0] * radius
      slot.base[i * 3 + 1] = direction[1] * radius
      slot.base[i * 3 + 2] = direction[2] * radius
    }
    this.finalizeSlot(slot)
  }

  private finalizeSlot(slot: SimSlot): void {
    const nodes = slot.nodes
    for (let i = 0; i < nodes; i++) {
      slot.baseRadius[i] = Math.hypot(slot.base[i * 3] ?? 0, slot.base[i * 3 + 1] ?? 0, slot.base[i * 3 + 2] ?? 0)
    }
    let arc = 0
    for (let i = 0; i < nodes; i++) {
      if (i > 0) {
        const dx = (slot.base[i * 3] ?? 0) - (slot.base[(i - 1) * 3] ?? 0)
        const dy = (slot.base[i * 3 + 1] ?? 0) - (slot.base[(i - 1) * 3 + 1] ?? 0)
        const dz = (slot.base[i * 3 + 2] ?? 0) - (slot.base[(i - 1) * 3 + 2] ?? 0)
        arc += Math.hypot(dx, dy, dz)
      }
      slot.arc[i] = arc
    }
    slot.totalLength = Math.max(arc, 1e-3)
  }

  private sampleSlotArc(slot: SimSlot, p: number, out: Float32Array, offset: number): void {
    const total = slot.arc[slot.nodes - 1] ?? 0
    if (!(total > 0)) return
    const target = clamp(p, 0, 1) * total
    let i = 1
    while (i < slot.nodes - 1 && (slot.arc[i] ?? 0) < target) i += 1
    const s0 = slot.arc[i - 1] ?? 0
    const s1 = slot.arc[i] ?? 0
    const t = s1 > s0 ? (target - s0) / (s1 - s0) : 0
    const a = (i - 1) * 3
    const b = i * 3
    const ax = slot.positions[a] ?? 0
    const ay = slot.positions[a + 1] ?? 0
    const az = slot.positions[a + 2] ?? 0
    out[offset] = ax + ((slot.positions[b] ?? 0) - ax) * t
    out[offset + 1] = ay + ((slot.positions[b + 1] ?? 0) - ay) * t
    out[offset + 2] = az + ((slot.positions[b + 2] ?? 0) - az) * t
  }

  private recomputePositions(): void {
    for (const slot of this.slots) {
      if (!slot.active) continue
      const { base, positions, xi, nodes } = slot
      for (let i = 0; i < nodes; i++) {
        const angle = xi[i] ?? 0
        const c = Math.cos(angle)
        const s = Math.sin(angle)
        const x = base[i * 3] ?? 0
        const y = base[i * 3 + 1] ?? 0
        const z = base[i * 3 + 2] ?? 0
        positions[i * 3] = x * c + z * s
        positions[i * 3 + 1] = y
        positions[i * 3 + 2] = -x * s + z * c
      }
    }
  }
}
