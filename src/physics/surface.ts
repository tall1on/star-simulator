import type { StarStats, StarTypeId } from '@/types/star'
import {
  GRAVITATIONAL_CONSTANT,
  SOLAR_MASS,
  SOLAR_RADIUS,
  SOLAR_TEMPERATURE,
  clamp,
} from '@/physics/relations'

/** Boltzmann constant, J/K. */
const BOLTZMANN = 1.380649e-23
/** Hydrogen mass, kg. */
const HYDROGEN_MASS = 1.67262192e-27
/** Mean molecular weight of a fully ionised solar-composition plasma. */
const MEAN_MOLECULAR_WEIGHT = 0.6
/** Solar photospheric granule size is ~4 pressure scale heights. */
const GRANULE_TO_SCALE_HEIGHT = 4

export type SurfaceRegime = 'dwarf' | 'giant' | 'hot' | 'compact'

export interface SurfaceModel {
  /** Photospheric pressure scale height H_p, metres. */
  scaleHeight: number
  /** Typical convection cell size ≈ 4·H_p, metres. */
  cellSize: number
  /** cellSize / radius. */
  cellSizeRatio: number
  /** Cell size ratio relative to the solar value (1 = solar granulation). */
  relativeCellSize: number
  /** Noise frequency handed to the shader (log-compressed for display). */
  cellFrequency: number
  /** Granulation contrast 0…~1.2. */
  contrast: number
  /** 0 dwarfs → 1 giants; blends fine granules into a few broad cells. */
  giantBlend: number
  /** Broad cooler convection regions (distinct from magnetic spots). */
  darkRegion: number
  /** Magnetic starspot strength. */
  spotStrength: number
  /** Relative cell-evolution speed (giant cells evolve slowly). */
  evolution: number
  /**
   * Relative radial amplitude of the convective surface relief, ≈1.2·H_p/R.
   * Giants get visible 3D bumps/indentations; dwarfs are essentially smooth.
   */
  displacement: number
  regime: SurfaceRegime
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Photospheric pressure scale height H_p ≈ k_B·T / (μ·m_H·g). */
function pressureScaleHeight(mass: number, radius: number, temperature: number): number {
  const gravity = Math.max(GRAVITATIONAL_CONSTANT * mass / radius ** 2, 1e-6)
  return (BOLTZMANN * temperature) / (MEAN_MOLECULAR_WEIGHT * HYDROGEN_MASS * gravity)
}

/** Solar cell-size-to-radius ratio, the reference for "1× solar granulation". */
const SOLAR_CELL_RATIO =
  (GRANULE_TO_SCALE_HEIGHT * pressureScaleHeight(SOLAR_MASS, SOLAR_RADIUS, SOLAR_TEMPERATURE)) / SOLAR_RADIUS

/**
 * Convection-cell size from the photospheric pressure scale height
 * `H_p ≈ k_B·T_eff / (μ·m_H·g)`. Because g = GM/R², an extended (low-density)
 * star has a large H_p and therefore huge cells, which is the physically correct
 * behaviour for cool giants — the driver is surface gravity, not mean density on
 * its own.
 *
 * This is a first-order recipe: real granulation also depends on opacity,
 * composition and the depth of the convective envelope, so hot and compact
 * objects are handled with separate regimes rather than the solar-law scaling.
 */
export function surfaceModel(stats: StarStats, typeId: StarTypeId): SurfaceModel {
  if (typeId === 'neutron-star') {
    // No ordinary convection: a smooth surface with (unmodeled) magnetic hot
    // spots rather than granulation.
    return {
      scaleHeight: 0,
      cellSize: 0,
      cellSizeRatio: 0,
      relativeCellSize: 0,
      cellFrequency: 1,
      contrast: 0.08,
      giantBlend: 0,
      darkRegion: 0,
      spotStrength: 0,
      evolution: 0.5,
      displacement: 0,
      regime: 'compact',
    }
  }

  const scaleHeight = pressureScaleHeight(stats.mass, stats.radius, stats.temperature)
  const cellSize = GRANULE_TO_SCALE_HEIGHT * scaleHeight
  const cellsAcross = stats.radius / Math.max(cellSize, Number.EPSILON)

  const cellSizeRatio = cellSize / stats.radius
  const relativeCellSize = cellSizeRatio / SOLAR_CELL_RATIO

  // Log-compress the raw cell count into a usable shader frequency.
  const cellFrequency = clamp(2 + 3 * Math.log10(Math.max(cellsAcross, 1) / 10), 1.6, 22)
  const giantBlend = smoothstep(30, 6, cellsAcross)

  const hot = stats.temperature > 12_000
  let contrast = 0.95 - 0.25 * giantBlend
  if (hot) contrast *= 0.35
  contrast = clamp(contrast, 0.05, 1.2)

  const darkRegion = giantBlend * 0.7
  const spotStrength = clamp((8000 - stats.temperature) / 6000, 0, 1) * (1 - 0.4 * giantBlend)
  const evolution = clamp(Math.sqrt(cellsAcross / 600), 0.12, 1.5)

  // Convective relief: cell height ~ H_p, so relief amplitude ~ 1.5·H_p/R.
  const displacement = clamp((scaleHeight / stats.radius) * 1.5, 0, 0.09)

  const regime: SurfaceRegime = hot ? 'hot' : giantBlend > 0.5 ? 'giant' : 'dwarf'

  return {
    scaleHeight,
    cellSize,
    cellSizeRatio,
    relativeCellSize,
    cellFrequency,
    contrast,
    giantBlend,
    darkRegion,
    spotStrength,
    evolution,
    displacement,
    regime,
  }
}
