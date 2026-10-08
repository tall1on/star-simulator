import type { StarStats, StarTypeId } from '@/types/star'
import { SECONDS_PER_DAY, SOLAR_RADIUS, clamp } from '@/physics/relations'

/**
 * Stellar ambience model — an *artistic sonification*, not an acoustic model of
 * sound in space (there is no sound in space). The star's physical state selects
 * a small, deliberately bounded set of synthesis parameters so the result stays
 * warm and comfortable: pitch follows size, brightness follows temperature,
 * pulse rate follows rotation, and magnetic field and activity add slow texture.
 *
 * The mapping is pure and side-effect free so it can be unit-tested and reused
 * by both the audio engine and the UI. All outputs are clamped to fixed ranges:
 * extreme stars get more *texture*, never more level.
 */

export type AmbienceRegime = 'cool-dwarf' | 'solar' | 'hot' | 'giant' | 'compact'
export type AmbienceCharacter = 'calm' | 'balanced' | 'vivid'

export interface AmbiencePartial {
  /** Frequency ratio to the fundamental. */
  ratio: number
  /** Relative gain, 0…1. */
  gain: number
  /** Detune used for slow beating/texture, in cents. */
  detuneCents: number
}

export interface AmbienceParameters {
  /** Fundamental drone frequency, Hz. */
  fundamental: number
  /** Tonal partials making up the drone. */
  partials: readonly AmbiencePartial[]
  /** Low-pass filter cutoff, Hz. */
  cutoff: number
  /** Low-pass filter resonance Q. */
  resonance: number
  /** Regular amplitude-pulse rate, Hz. */
  pulseRate: number
  /** Amplitude-pulse depth, 0…1 (never full gating). */
  pulseDepth: number
  /** Slow timbral-drift rate, Hz. */
  driftRate: number
  /** Drift depth, 0…1. */
  driftDepth: number
  /** Detune/beating shimmer, 0…1. */
  shimmer: number
  /** Filtered-noise (breath) level, 0…1. */
  noiseLevel: number
  regime: AmbienceRegime
  character: AmbienceCharacter
}

export interface AmbienceInputs {
  stats: StarStats
  typeId: StarTypeId
  /** Rotation period in days (as stored in the wind store). */
  rotationPeriodDays: number
  /** Activity level 0…1 (Rossby-number model, or the manual slider). */
  activity: number
  /** Character control: 0 = calm, 1 = dynamic. */
  dynamics: number
}

/** Fundamental used for a Sun-sized star, Hz. */
const REFERENCE_HZ = 55
const MIN_FUNDAMENTAL_HZ = 34
const MAX_FUNDAMENTAL_HZ = 108
const MIN_CUTOFF_HZ = 150
const MAX_CUTOFF_HZ = 3400
/** Compact objects get a darker ceiling so hot temperatures can't turn shrill. */
const COMPACT_CUTOFF_HZ = 1900
const MIN_PULSE_HZ = 0.3
const MAX_PULSE_HZ = 6
const MIN_TEMPERATURE_K = 2500
const MAX_TEMPERATURE_K = 50_000
const MIN_FIELD_G = 1e-2
const MAX_FIELD_G = 1e15
/** Rotation frequencies (Hz) that span the pulse mapping: ~3 h to ~2 ms. */
const ROTATION_FREQ_LOW_HZ = 1e-4
const ROTATION_FREQ_HIGH_HZ = 500

/** Base drone partials: fundamental, fifth, octave, twelfth, double octave. */
const PARTIAL_SEEDS: readonly { ratio: number; gain: number; spread: number }[] = [
  { ratio: 1, gain: 1, spread: 0 },
  { ratio: 1.5, gain: 0.34, spread: 1 },
  { ratio: 2, gain: 0.22, spread: -1 },
  { ratio: 3, gain: 0.1, spread: 1.3 },
  { ratio: 4, gain: 0.06, spread: -1.1 },
]

function temperatureBrightness(temperature: number): number {
  const lo = Math.log10(MIN_TEMPERATURE_K)
  const hi = Math.log10(MAX_TEMPERATURE_K)
  return clamp((Math.log10(Math.max(temperature, MIN_TEMPERATURE_K)) - lo) / (hi - lo), 0, 1)
}

function fieldLevel(magneticField: number): number {
  const lo = Math.log10(MIN_FIELD_G)
  const hi = Math.log10(MAX_FIELD_G)
  return clamp((Math.log10(Math.max(magneticField, MIN_FIELD_G)) - lo) / (hi - lo), 0, 1)
}

/** 0 for slow rotators, 1 at the fastest compact-star spins. */
function spinProgress(rotationPeriodDays: number): number {
  const periodSeconds = Math.max(rotationPeriodDays * SECONDS_PER_DAY, 1e-6)
  const frequency = 1 / periodSeconds
  const lo = Math.log10(ROTATION_FREQ_LOW_HZ)
  const hi = Math.log10(ROTATION_FREQ_HIGH_HZ)
  return clamp((Math.log10(Math.max(frequency, Number.MIN_VALUE)) - lo) / (hi - lo), 0, 1)
}

/** Bigger stars sound deeper; the range is deliberately narrow and bounded. */
function fundamentalFrequency(radius: number): number {
  const rSolar = Math.max(radius / SOLAR_RADIUS, 1e-6)
  const semitones = clamp(-Math.log2(rSolar), -8, 6)
  return clamp(REFERENCE_HZ * 2 ** (semitones / 12), MIN_FUNDAMENTAL_HZ, MAX_FUNDAMENTAL_HZ)
}

export function ambienceRegime(stats: StarStats, typeId: StarTypeId): AmbienceRegime {
  if (typeId === 'neutron-star') return 'compact'
  if (stats.temperature > 12_000) return 'hot'
  if (stats.radius / SOLAR_RADIUS > 3) return 'giant'
  if (stats.temperature < 4500) return 'cool-dwarf'
  return 'solar'
}

function characterFrom(dynamics: number): AmbienceCharacter {
  if (dynamics < 0.34) return 'calm'
  if (dynamics < 0.67) return 'balanced'
  return 'vivid'
}

export function ambienceParameters(input: AmbienceInputs): AmbienceParameters {
  const { stats } = input
  const brightness = temperatureBrightness(stats.temperature)
  const field = fieldLevel(stats.magneticField)
  const spin = spinProgress(input.rotationPeriodDays)
  const activity = clamp(input.activity, 0, 1)
  const dynamics = clamp(input.dynamics, 0, 1)
  const regime = ambienceRegime(stats, input.typeId)

  const fundamental = fundamentalFrequency(stats.radius)

  // Temperature sets brightness (filter + harmonic balance), not pitch.
  let cutoff = MIN_CUTOFF_HZ + (MAX_CUTOFF_HZ - MIN_CUTOFF_HZ) * (0.12 + 0.88 * brightness)
  if (regime === 'giant') cutoff *= 0.7
  if (regime === 'compact') cutoff = Math.min(cutoff, COMPACT_CUTOFF_HZ)
  cutoff = clamp(cutoff, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ)

  const resonance = clamp(0.7 + 0.5 * brightness, 0.7, 1.4)

  // Strong fields and fast spins add moving texture, never level.
  const shimmer = clamp(field * (0.4 + 0.6 * dynamics) + 0.35 * spin * dynamics, 0, 1)

  const partials = PARTIAL_SEEDS.map((seed, index) => {
    const brightnessWeight = index === 0 ? 1 : 0.5 + 0.5 * brightness
    const regimeWeight =
      regime === 'giant' && index > 0 ? 0.72 : regime === 'cool-dwarf' && index > 0 ? 0.85 : 1
    return {
      ratio: seed.ratio,
      gain: clamp(seed.gain * brightnessWeight * regimeWeight, 0, 1),
      detuneCents: clamp(seed.spread * shimmer * 16, -20, 20),
    }
  })

  // Rotation maps logarithmically into a comfortable pulse band. Slow stars get
  // an almost-flat breathing swell; fast compact stars get a regular heartbeat.
  const pulseRate = clamp(
    MIN_PULSE_HZ + (MAX_PULSE_HZ - MIN_PULSE_HZ) * spin ** 1.4,
    MIN_PULSE_HZ,
    MAX_PULSE_HZ,
  )
  const pulseDepth = clamp((0.1 + 0.45 * dynamics) * (0.25 + 0.75 * spin), 0, 0.5)

  const driftRate = clamp(0.03 + 0.22 * activity + 0.15 * field, 0.02, 0.5)
  const driftDepth = clamp(0.12 + 0.35 * field + 0.2 * activity, 0, 0.7)

  let noiseLevel = clamp(0.04 + 0.12 * activity + 0.05 * dynamics, 0, 0.25)
  if (regime === 'compact') noiseLevel *= 0.6

  return {
    fundamental,
    partials,
    cutoff,
    resonance,
    pulseRate,
    pulseDepth,
    driftRate,
    driftDepth,
    shimmer,
    noiseLevel,
    regime,
    character: characterFrom(dynamics),
  }
}
