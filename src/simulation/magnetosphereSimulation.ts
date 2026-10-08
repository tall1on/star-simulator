import { SECONDS_PER_DAY, SOLAR_RADIUS, clamp } from '@/physics/relations'
import { mulberry32 } from '@/physics/sunspots'
import {
  SPEED_OF_LIGHT,
  alfvenCrossingSeconds,
  alfvenSpeed,
  angularVelocity,
  footpointShearRate,
  lightCylinderRadiusMetres,
  plasmaDensityForRegime,
  supportsDifferentialRotation,
} from '@/physics/magnetosphere'
import type {
  FieldLineKind,
  MagnetosphereConfig,
  MagnetosphereDiagnostics,
} from '@/types/magnetosphere'

/**
 * Reduced-order magnetosphere simulation.
 *
 * Deliberately a plain class, not reactive state: the render loop must not push
 * per-frame geometry through Vue reactivity. The Pinia store owns the controls;
 * this object owns the evolving field-line state.
 *
 * ## Model
 * - **Closed & active loops** carry a one-dimensional *torsional* displacement
 *   ξ(s) along their arc length. Footpoints are anchored to the surface: the
 *   driven end follows the relative azimuth accumulated from the
 *   latitude-dependent rotation rate (asymmetric active-region footpoints shear;
 *   a symmetric dipole has exactly zero relative rate and therefore does not
 *   wind up). The interior relaxes toward the quasi-static linear profile on the
 *   Alfvén crossing time via a stable exponential blend; the driven boundary is
 *   integrated exactly, so the evolution is stable and dominated by that exact
 *   boundary (only the transient interior profile is mildly step-size sensitive).
 *   This is the low-frequency torsional limit of a flux tube, not a full wave PDE.
 * - **Open lines** are wound into a Parker spiral. The outflow speed is the wind
 *   speed but never below the corotation speed Ω·r (the field enforces corotation
 *   out to the light cylinder, which bounds the winding for fast rotators), and
 *   each node uses the rotation rate from `r/v` seconds earlier — so a change in
 *   wind or rotation only reaches the outer field after the travel time.
 * - **Compact objects** replace differential rotation with localised shear
 *   events (a documented phenomenological driver for crustal starquakes): the
 *   footpoint displacement is prescribed to build and release over the event,
 *   then the twist decays. Nothing is wound permanently by field strength alone.
 *
 * Geometry is authored in star-radius units, so the star radius never forces a
 * rebuild. All lengths are SI where named; angles are radians.
 */

/** Hard seed so every session and reset starts identically. */
const SIMULATION_SEED = 0x51e2f1e1

const CLOSED_SHELLS = [1.25, 1.55, 1.9, 2.4, 3.1] as const
const CLOSED_AZIMUTHS = 8
const CLOSED_NODES = 48

const ACTIVE_LONGITUDES = 3
const ACTIVE_NODES = 40
/** Active-region footpoint latitudes (fraction of a radian), leading vs. trailing. */
const ACTIVE_LAT_LEADING = 0.42
const ACTIVE_LAT_TRAILING = 0.16
const ACTIVE_LON_SPAN = 0.08
const ACTIVE_LOOP_BULGE = 0.7

const OPEN_AZIMUTHS = 8
const OPEN_NODES = 48
const OPEN_MAX_RADII = 6

/** Cap on the torsional displacement of a single tube, radians. */
const MAX_TORSION_RADIANS = Math.PI / 2
/** Cap on open-line winding so extreme rotation cannot alias the geometry. */
const MAX_OPEN_WINDING_RADIANS = 20
/** Footpoint shear decays (reconnects) on this timescale, days. */
const SHEAR_RELAX_DAYS = 20
/** Prescribed local active-region footpoint motion (supergranular/emerging flux), rad/s amplitude. */
const ACTIVE_FOOTPOINT_MOTION = 3e-7
/** Period of the prescribed active-region footpoint motion, days. */
const ACTIVE_MOTION_PERIOD_DAYS = 3
/** Mean interval between shear events for compact objects at activity 1, days. */
const COMPACT_EVENT_INTERVAL_DAYS = 8
/** Duration of a compact shear event, days. */
const COMPACT_EVENT_DURATION_DAYS = 4
/** Peak footpoint displacement injected by one compact shear event, radians. */
const COMPACT_EVENT_DISPLACEMENT = 0.7
/**
 * Lower bound on the twist-relaxation timescale for compact objects. Their
 * Alfvén crossing time is microseconds, which would erase any event within a
 * frame; real twisted magnetospheres relax by reconnection over days–months, so
 * a documented floor keeps the dynamics resolvable.
 */
const COMPACT_RELAXATION_SECONDS = 2 * SECONDS_PER_DAY
/** Maximum rotation-lag samples kept for the open-line wind travel-time delay. */
const OMEGA_HISTORY_LIMIT = 64

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
}

const EMPTY_POSITIONS = new Float32Array(0)

/** Coerce a possibly non-finite config value back to a safe default. */
function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

interface SimLine {
  kind: FieldLineKind
  nodes: number
  /** Baseline (untwisted) positions, xyz interleaved, star radii. */
  base: Float32Array
  /** Spherical radius of each node, star radii. */
  baseRadius: Float32Array
  /** Cumulative arc length per node, star radii. */
  arc: Float32Array
  /** Current positions, xyz interleaved, star radii. */
  positions: Float32Array
  /** Torsional displacement about the rotation axis per node, radians. */
  xi: Float32Array
  /** Total length, star radii. */
  totalLength: number
  /** Footpoint latitudes, radians (used for the differential-rotation driver). */
  latA: number
  latB: number
  /** Accumulated, relaxing driven-footpoint displacement, radians. */
  shearTarget: number
  /** Prescribed active-region footpoint motion amplitude (rad/s) and phase. */
  localAmplitude: number
  localPhase: number
  /** Compact shear-event window (simulated seconds) and peak displacement. */
  eventStart: number
  eventEnd: number
  eventDisplacement: number
}

type Vec3 = readonly [number, number, number]

function dirFromLatLon(latitude: number, longitude: number): Vec3 {
  const cosLat = Math.cos(latitude)
  return [cosLat * Math.cos(longitude), Math.sin(latitude), cosLat * Math.sin(longitude)]
}

/** Spherical interpolation between two unit directions. */
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

export class MagnetosphereSimulation {
  private config: MagnetosphereConfig = { ...DEFAULT_CONFIG }
  private lines: SimLine[] = []
  private readonly openIndices: number[] = []
  private elapsedSeconds = 0
  private spinAngleValue = 0
  private random = mulberry32(SIMULATION_SEED)
  private omegaHistory: { time: number; omega: number }[] = []
  private nextCompactEventSeconds = 0
  private vA = SPEED_OF_LIGHT

  constructor() {
    this.build()
    this.recordOmega()
  }

  // -- Configuration ---------------------------------------------------------

  /** Apply the current controls & stellar state. Does not reset field-line state. */
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

  /** Deterministic reset: zero twist, empty history, zero elapsed time. */
  reset(): void {
    for (const line of this.lines) {
      line.xi.fill(0)
      line.shearTarget = 0
      line.eventStart = 0
      line.eventEnd = 0
      line.eventDisplacement = 0
    }
    this.elapsedSeconds = 0
    this.spinAngleValue = 0
    this.random = mulberry32(SIMULATION_SEED)
    this.nextCompactEventSeconds = 0
    this.omegaHistory = []
    this.recordOmega()
    this.recomputePositions()
  }

  /** Advance by a real-time delta, honouring enabled/running/timeScale. */
  step(realDeltaSeconds: number): void {
    const { enabled, running, timeScaleDaysPerSecond } = this.config
    if (!enabled || !running) return
    if (!(realDeltaSeconds > 0)) return
    const simDelta = realDeltaSeconds * timeScaleDaysPerSecond * SECONDS_PER_DAY
    if (!(simDelta > 0)) return
    this.advance(simDelta)
    this.spinAngleValue += this.spinRateFor() * realDeltaSeconds
  }

  /** Advance by an explicit simulated-time delta, seconds (used by tests). */
  advance(simDeltaSeconds: number): void {
    if (!(simDeltaSeconds > 0)) return
    // Schedule compact shear events across the whole interval so a large step
    // spawns the same events (at the same absolute times) as many small steps.
    if (this.config.regime === 'compact') {
      this.scheduleCompactEvents(this.elapsedSeconds + simDeltaSeconds)
    }
    this.elapsedSeconds += simDeltaSeconds
    for (const line of this.lines) {
      if (line.kind === 'open') this.updateOpenLine(line)
      else this.updateTube(line, simDeltaSeconds)
    }
    this.recomputePositions()
  }

  // -- State for the render layer / diagnostics ------------------------------

  get spinAngle(): number {
    return this.spinAngleValue
  }

  get lineCount(): number {
    return this.lines.length
  }

  get openLineCount(): number {
    return this.openIndices.length
  }

  lineKind(index: number): FieldLineKind {
    return this.lines[index]?.kind ?? 'closed'
  }

  /** Live positions of a line (xyz interleaved); valid until the next step. */
  linePositions(index: number): Float32Array {
    return this.lines[index]?.positions ?? EMPTY_POSITIONS
  }

  /** Maximum absolute torsional displacement of a line, radians (tests/diagnostics). */
  lineMaxTwist(index: number): number {
    const line = this.lines[index]
    if (!line) return 0
    let max = 0
    for (let i = 0; i < line.nodes; i++) max = Math.max(max, Math.abs(line.xi[i] ?? 0))
    return max
  }

  /** Torsional displacement at one node, radians (tests). */
  lineNodeTwist(index: number, node: number): number {
    return this.lines[index]?.xi[node] ?? 0
  }

  openLinePositions(openIndex: number): Float32Array {
    const index = this.openIndices[openIndex]
    return index === undefined ? EMPTY_POSITIONS : this.linePositions(index)
  }

  openLineArc(openIndex: number): Float32Array {
    const index = this.openIndices[openIndex]
    return index === undefined ? EMPTY_POSITIONS : (this.lines[index]?.arc ?? EMPTY_POSITIONS)
  }

  /** Maximum absolute winding of an open line, radians (tests). */
  openLineMaxTwist(openIndex: number): number {
    const index = this.openIndices[openIndex]
    if (index === undefined) return 0
    return this.lineMaxTwist(index)
  }

  openLineNodeTwist(openIndex: number, node: number): number {
    const index = this.openIndices[openIndex]
    return index === undefined ? 0 : this.lineNodeTwist(index, node)
  }

  /** Sample an open line by normalised arc length (0…1) into `out`. */
  sampleOpenLine(openIndex: number, p: number, out: Float32Array, offset: number): void {
    const index = this.openIndices[openIndex]
    const line = index === undefined ? undefined : this.lines[index]
    if (!line) return
    const total = line.arc[line.nodes - 1] ?? 0
    if (!(total > 0)) return
    const target = clamp(p, 0, 1) * total
    let i = 1
    while (i < line.nodes - 1 && (line.arc[i] ?? 0) < target) i += 1
    const s0 = line.arc[i - 1] ?? 0
    const s1 = line.arc[i] ?? 0
    const t = s1 > s0 ? (target - s0) / (s1 - s0) : 0
    const a = (i - 1) * 3
    const b = i * 3
    const ax = line.positions[a] ?? 0
    const ay = line.positions[a + 1] ?? 0
    const az = line.positions[a + 2] ?? 0
    out[offset] = ax + ((line.positions[b] ?? 0) - ax) * t
    out[offset + 1] = ay + ((line.positions[b + 1] ?? 0) - ay) * t
    out[offset + 2] = az + ((line.positions[b + 2] ?? 0) - az) * t
  }

  diagnostics(): MagnetosphereDiagnostics {
    let maxTwist = 0
    let maxOpenWinding = 0
    let crossing = 0
    let shearEvents = 0
    for (const line of this.lines) {
      let lineMax = 0
      for (let i = 0; i < line.nodes; i++) {
        const value = Math.abs(line.xi[i] ?? 0)
        if (value > lineMax) lineMax = value
      }
      if (line.kind === 'open') {
        if (lineMax > maxOpenWinding) maxOpenWinding = lineMax
      } else {
        if (lineMax > maxTwist) maxTwist = lineMax
        crossing = Math.max(crossing, alfvenCrossingSeconds(line.totalLength * this.config.radius, this.vA))
      }
      if (this.eventActive(line)) shearEvents += 1
    }
    const radius = Math.max(this.config.radius, Number.EPSILON)
    const exceedsLightCylinder =
      OPEN_MAX_RADII * radius > lightCylinderRadiusMetres(this.config.rotationPeriod)
    return {
      maxTwist,
      maxOpenWinding,
      alfvenCrossingSeconds: crossing,
      lineCount: this.lines.length,
      openLineCount: this.openIndices.length,
      shearEvents,
      elapsedDays: this.elapsedSeconds / SECONDS_PER_DAY,
      regime: this.config.regime,
      differentialRotation: supportsDifferentialRotation(this.config.regime),
      exceedsLightCylinder,
    }
  }

  // -- Dynamics --------------------------------------------------------------

  private updateOpenLine(line: SimLine): void {
    const windMs = Math.max(this.config.windSpeed * 1000, 1)
    const radius = Math.max(this.config.radius, Number.EPSILON)
    // Omega from the current rotation period, used for the corotation floor.
    const omegaNow = angularVelocity(this.config.rotationPeriod)
    const xi = line.xi
    xi[0] = 0
    let winding = 0
    let previousRadius = line.baseRadius[0] ?? 1
    for (let i = 1; i < line.nodes; i++) {
      const r = line.baseRadius[i] ?? 1
      const rMetres = r * radius
      // Outflow speed: the wind speed, but never below the corotation speed
      // Ω·r — the magnetic field enforces corotation out to the light cylinder,
      // which keeps the winding physically bounded for fast compact rotators.
      // Capped at c so the corotation floor cannot exceed causality.
      const outflow = Math.min(Math.max(windMs, omegaNow * rMetres), SPEED_OF_LIGHT)
      const delay = ((r - 1) * radius) / outflow
      const omegaDelayed = this.omegaAt(this.elapsedSeconds - delay)
      winding -= (omegaDelayed * ((r - previousRadius) * radius)) / outflow
      xi[i] = clamp(winding, -MAX_OPEN_WINDING_RADIANS, MAX_OPEN_WINDING_RADIANS)
      previousRadius = r
    }
  }

  private updateTube(line: SimLine, simDeltaSeconds: number): void {
    if (this.config.regime === 'compact') {
      // Compact twist is a prescribed, absolute-time function of the last shear
      // event (ramp → hold → reconnection decay). Being time-parameterised rather
      // than step-parameterised makes it frame-rate independent and deterministic.
      line.shearTarget = clamp(
        this.compactShearAt(line, this.elapsedSeconds),
        -MAX_TORSION_RADIANS,
        MAX_TORSION_RADIANS,
      )
    } else {
      const differential = supportsDifferentialRotation(this.config.regime)
      let rate = footpointShearRate(this.config.rotationPeriod, line.latA, line.latB, differential)
      if (line.kind === 'active' && differential) {
        const activity = clamp(this.config.activity, 0, 1)
        const period = Math.max(ACTIVE_MOTION_PERIOD_DAYS, Number.EPSILON) * SECONDS_PER_DAY
        // Use the average of the prescribed footpoint motion over the step
        // (closed-form integral) rather than a midpoint sample, so a step longer
        // than the oscillation period cannot alias the driver.
        const start = this.elapsedSeconds - simDeltaSeconds
        const end = this.elapsedSeconds
        const integral =
          line.localAmplitude *
          period *
          (Math.sin(end / period + line.localPhase) - Math.sin(start / period + line.localPhase))
        rate += (integral / Math.max(simDeltaSeconds, Number.EPSILON)) * activity
      }
      // Exact integration of dS/dt = rate − S/τ keeps the driven shear independent
      // of the step size (frame-rate independent).
      const tau = SHEAR_RELAX_DAYS * SECONDS_PER_DAY
      const equilibrium = rate * tau
      line.shearTarget =
        equilibrium + (line.shearTarget - equilibrium) * Math.exp(-simDeltaSeconds / tau)
      line.shearTarget = clamp(line.shearTarget, -MAX_TORSION_RADIANS, MAX_TORSION_RADIANS)
    }

    // Relax the interior toward the quasi-static linear profile on the Alfvén
    // crossing time. The stable exponential blend drives the transient interior
    // while the driven end stays anchored to the prescribed displacement.
    const relaxation = this.relaxationSecondsFor(line)
    const factor = 1 - Math.exp(-simDeltaSeconds / relaxation)
    const last = line.nodes - 1
    const xi = line.xi
    xi[0] = 0
    xi[last] = line.shearTarget
    for (let i = 1; i < last; i++) {
      const target = (line.shearTarget * i) / last
      const current = xi[i] ?? 0
      xi[i] = target + (current - target) * factor
    }
  }

  /** Prescribed compact-object footpoint displacement as a function of time. */
  private compactShearAt(line: SimLine, timeSeconds: number): number {
    const duration = line.eventEnd - line.eventStart
    if (!(duration > 0)) return 0
    const displacement = line.eventDisplacement
    if (timeSeconds < line.eventStart) return 0
    const half = line.eventStart + duration * 0.5
    if (timeSeconds <= half) {
      return (displacement * (timeSeconds - line.eventStart)) / (duration * 0.5)
    }
    if (timeSeconds <= line.eventEnd) return displacement
    return displacement * Math.exp(-(timeSeconds - line.eventEnd) / (SHEAR_RELAX_DAYS * SECONDS_PER_DAY))
  }

  private relaxationSecondsFor(line: SimLine): number {
    const crossing = alfvenCrossingSeconds(line.totalLength * this.config.radius, this.vA)
    if (this.config.regime === 'compact') {
      return Math.max(crossing, COMPACT_RELAXATION_SECONDS)
    }
    return Math.max(crossing, Number.EPSILON)
  }

  private eventActive(line: SimLine): boolean {
    return (
      line.eventEnd > line.eventStart &&
      this.elapsedSeconds >= line.eventStart &&
      this.elapsedSeconds <= line.eventEnd
    )
  }

  private scheduleCompactEvents(endTimeSeconds: number): void {
    const activity = clamp(this.config.activity, 0, 1)
    const interval = (COMPACT_EVENT_INTERVAL_DAYS / Math.max(activity, 0.15)) * SECONDS_PER_DAY
    if (activity <= 0) {
      this.nextCompactEventSeconds = endTimeSeconds + interval
      return
    }
    let guard = 0
    while (endTimeSeconds >= this.nextCompactEventSeconds && guard < 64) {
      // Spawn against the scheduled absolute time, not the step boundary, so the
      // event windows and RNG draws are independent of the frame rate.
      const startTime = this.nextCompactEventSeconds
      this.spawnCompactEvent(activity, startTime)
      this.nextCompactEventSeconds = startTime + interval
      guard += 1
    }
  }

  private spawnCompactEvent(activity: number, startTime: number): void {
    const dynamic = this.lines.filter((line) => line.kind !== 'open')
    if (dynamic.length === 0) return
    const pick = Math.floor(this.random() * dynamic.length)
    const line = dynamic[Math.min(pick, dynamic.length - 1)]
    if (!line) return
    const sign = this.random() < 0.5 ? -1 : 1
    line.eventStart = startTime
    line.eventEnd = startTime + COMPACT_EVENT_DURATION_DAYS * SECONDS_PER_DAY
    line.eventDisplacement = COMPACT_EVENT_DISPLACEMENT * activity * sign * (0.5 + this.random())
  }

  /** Rotation-lag lookup used by the open-line travel-time delay. */
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
    // Keep the earliest recorded rate as a permanent floor entry, so a very
    // long travel-time delay can always fall back to a meaningful value.
    while (this.omegaHistory.length > OMEGA_HISTORY_LIMIT) {
      this.omegaHistory.splice(1, 1)
    }
  }

  private spinRateFor(): number {
    const periodDays = Math.max(this.config.rotationPeriod, 1e-9)
    const rate = (2 * Math.PI * this.config.timeScaleDaysPerSecond) / periodDays
    return clamp(rate, 0.0005, 12)
  }

  // -- Geometry --------------------------------------------------------------

  private build(): void {
    this.lines = []
    this.openIndices.length = 0
    this.buildClosedLines()
    this.buildActiveLines()
    this.buildOpenLines()
    this.recomputePositions()
  }

  private makeLine(kind: FieldLineKind, points: readonly Vec3[], latA: number, latB: number): SimLine {
    const nodes = points.length
    const base = new Float32Array(nodes * 3)
    const baseRadius = new Float32Array(nodes)
    const arc = new Float32Array(nodes)
    for (let i = 0; i < nodes; i++) {
      const point = points[i]
      if (!point) continue
      base[i * 3] = point[0]
      base[i * 3 + 1] = point[1]
      base[i * 3 + 2] = point[2]
      baseRadius[i] = Math.hypot(point[0], point[1], point[2])
    }
    for (let i = 1; i < nodes; i++) {
      const dx = (base[i * 3] ?? 0) - (base[(i - 1) * 3] ?? 0)
      const dy = (base[i * 3 + 1] ?? 0) - (base[(i - 1) * 3 + 1] ?? 0)
      const dz = (base[i * 3 + 2] ?? 0) - (base[(i - 1) * 3 + 2] ?? 0)
      arc[i] = (arc[i - 1] ?? 0) + Math.hypot(dx, dy, dz)
    }
    return {
      kind,
      nodes,
      base,
      baseRadius,
      arc,
      positions: new Float32Array(nodes * 3),
      xi: new Float32Array(nodes),
      totalLength: arc[nodes - 1] ?? 1,
      latA,
      latB,
      shearTarget: 0,
      localAmplitude: 0,
      localPhase: 0,
      eventStart: 0,
      eventEnd: 0,
      eventDisplacement: 0,
    }
  }

  private buildClosedLines(): void {
    for (const shell of CLOSED_SHELLS) {
      const thetaStart = Math.asin(Math.sqrt(1 / shell))
      const latitude = Math.PI / 2 - thetaStart
      for (let a = 0; a < CLOSED_AZIMUTHS; a++) {
        const phi = (a / CLOSED_AZIMUTHS) * Math.PI * 2
        const points: Vec3[] = []
        for (let i = 0; i <= CLOSED_NODES; i++) {
          const theta = thetaStart + (Math.PI - 2 * thetaStart) * (i / CLOSED_NODES)
          const sinTheta = Math.sin(theta)
          const r = shell * sinTheta * sinTheta
          points.push([
            r * sinTheta * Math.cos(phi),
            r * Math.cos(theta),
            r * sinTheta * Math.sin(phi),
          ])
        }
        // Opposite, equal-magnitude footpoint latitudes -> zero relative shear.
        this.lines.push(this.makeLine('closed', points, latitude, -latitude))
      }
    }
  }

  private buildActiveLines(): void {
    for (let a = 0; a < ACTIVE_LONGITUDES; a++) {
      const longitude = (a / ACTIVE_LONGITUDES) * Math.PI * 2
      for (const sign of [1, -1]) {
        const latLeading = sign * ACTIVE_LAT_LEADING
        const latTrailing = sign * ACTIVE_LAT_TRAILING
        const dirA = dirFromLatLon(latLeading, longitude - ACTIVE_LON_SPAN)
        const dirB = dirFromLatLon(latTrailing, longitude + ACTIVE_LON_SPAN)
        const points: Vec3[] = []
        for (let i = 0; i <= ACTIVE_NODES; i++) {
          const t = i / ACTIVE_NODES
          const dir = slerpDirection(dirA, dirB, t)
          const radius = 1 + ACTIVE_LOOP_BULGE * Math.sin(Math.PI * t)
          points.push([dir[0] * radius, dir[1] * radius, dir[2] * radius])
        }
        const line = this.makeLine('active', points, latLeading, latTrailing)
        line.localAmplitude = ACTIVE_FOOTPOINT_MOTION * (0.6 + this.random() * 0.8)
        line.localPhase = this.random() * Math.PI * 2
        this.lines.push(line)
      }
    }
  }

  private buildOpenLines(): void {
    for (const sign of [1, -1]) {
      for (let a = 0; a < OPEN_AZIMUTHS; a++) {
        const phi0 = (a / OPEN_AZIMUTHS) * Math.PI * 2
        const points: Vec3[] = []
        for (let i = 0; i <= OPEN_NODES; i++) {
          const t = i / OPEN_NODES
          const r = OPEN_MAX_RADII ** t
          const theta = 0.5 * (1 - t)
          const sinTheta = Math.sin(theta)
          points.push([
            r * sinTheta * Math.cos(phi0),
            sign * r * Math.cos(theta),
            r * sinTheta * Math.sin(phi0),
          ])
        }
        const index = this.lines.length
        this.lines.push(this.makeLine('open', points, 0, 0))
        this.openIndices.push(index)
      }
    }
  }

  private recomputePositions(): void {
    for (const line of this.lines) {
      const { base, positions, xi, nodes } = line
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
