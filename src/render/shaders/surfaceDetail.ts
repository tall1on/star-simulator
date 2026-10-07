import * as THREE from 'three/webgpu'
import {
  asin,
  clamp,
  cos,
  float,
  fwidth,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_float_3d,
  oneMinus,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl'

/** Physics-driven control values for the photosphere texture. */
export interface SurfaceModelParams {
  /** Noise frequency (cells across the disc), from {@link surfaceModel}. */
  cellFrequency: number
  /** Granulation contrast. */
  contrast: number
  /** 0 = fine granules, 1 = a few broad giant cells. */
  giantBlend: number
  /** Broad cooler convection regions (distinct from magnetic spots). */
  darkRegion: number
  /** Depth of the dark intergranular lanes, 0…1. */
  laneDarkness: number
  /** Granule-to-granule brightness variation, 0…1. */
  brightnessVariation: number
  /** Magnetic starspot strength. */
  spotStrength: number
  /** Relative cell-evolution speed (giant cells evolve slowly). */
  evolution: number
  /** Relative radial relief amplitude (H_p/R) for vertex displacement. */
  displacement: number
}

/** Fallback used before the physics-driven model is supplied. */
export const DEFAULT_SURFACE_MODEL: SurfaceModelParams = {
  cellFrequency: 96,
  contrast: 0.95,
  giantBlend: 0,
  darkRegion: 0.5,
  laneDarkness: 0.5,
  brightnessVariation: 0.4,
  spotStrength: 0.7,
  evolution: 1,
  displacement: 0,
}

export interface SurfaceDetailUniforms {
  cellFrequency: { value: number }
  contrast: { value: number }
  giantBlend: { value: number }
  darkRegion: { value: number }
  laneDarkness: { value: number }
  brightnessVariation: { value: number }
  evolution: { value: number }
  rotation: { value: number }
}

export interface SurfaceSample {
  brightness: THREE.Node<'float'>
  tint: THREE.Node<'vec3'>
}

export interface SurfaceDetail {
  uniforms: SurfaceDetailUniforms
  setModel(params: SurfaceModelParams): void
  setDifferentialRotation(rate: number): void
  /**
   * Convection granulation, giant cells and broad cool regions for a surface
   * direction (unit vector in star space).
   */
  evaluate(dir: THREE.Node<'vec3'>): SurfaceSample
  /**
   * Broad (giant-cell) height field in roughly −0.5…0.5, used for the actual 3D
   * displacement of the photosphere. Centred on zero so cells both rise and sink.
   */
  heightField(dir: THREE.Node<'vec3'>): THREE.Node<'float'>
}

/**
 * Photosphere detail shared by the sphere and the relativistic disc.
 *
 * Granulation is built from two octaves of Worley (cellular) noise so cells have
 * bright interiors and narrow dark intergranular lanes, with a third, much
 * coarser octave and a fractal term supplying granule-to-granule brightness
 * variation (and the broad cool regions of giants). `cellFrequency` comes from
 * the physical granule count (see {@link surfaceModel}), so a Sun-like star gets
 * fine granulation while an extended giant keeps only a handful of large cells.
 * The pattern boils slowly with a time-shifted noise offset, and differential
 * rotation shears it by latitude. Evolving magnetic spots are a separate layer
 * (see `sunspots.ts`).
 */
export function createSurfaceDetail(initial: SurfaceModelParams): SurfaceDetail {
  const uCellFrequency = uniform(initial.cellFrequency)
  const uContrast = uniform(initial.contrast)
  const uGiantBlend = uniform(initial.giantBlend)
  const uDarkRegion = uniform(initial.darkRegion)
  const uLaneDarkness = uniform(initial.laneDarkness)
  const uBrightnessVariation = uniform(initial.brightnessVariation)
  const uEvolution = uniform(initial.evolution)
  const uRotation = uniform(0.12)

  // Differential rotation: equatorial regions shear faster than the poles. The
  // rate is the star's own (scene-time) rate, so granulation drifts with the
  // spots; `evolution` only affects how fast the pattern boils.
  function rotatedDir(dir: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
    const lat = asin(clamp(dir.y, -1, 1))
    const shear = oneMinus(sin(lat).mul(sin(lat)).mul(0.35))
    const angle = time.mul(uRotation).mul(shear)
    const c = cos(angle)
    const s = sin(angle)
    return vec3(dir.x.mul(c).add(dir.z.mul(s)), dir.y, dir.z.mul(c).sub(dir.x.mul(s)))
  }

  function heightField(dir: THREE.Node<'vec3'>): THREE.Node<'float'> {
    const r = rotatedDir(dir)
    const coarse = max(uCellFrequency.mul(0.25), float(1))
    const broad = oneMinus(clamp(mx_worley_noise_float_3d(r.mul(coarse), 1.0, 0.0).mul(1.5), 0, 1))
    const turbulence = mx_fractal_noise_float(r.mul(max(uCellFrequency.mul(0.5), float(1))), 3, 2.0, 0.5)
      .mul(0.5)
      .add(0.5)
    return broad.mul(0.7).add(turbulence.mul(0.3)).sub(0.5) as THREE.Node<'float'>
  }

  function evaluate(dir: THREE.Node<'vec3'>): SurfaceSample {
    const r = rotatedDir(dir)
    const f = uCellFrequency

    // Two cell octaves: bright polygonal granules with narrow dark lanes.
    const fine = oneMinus(clamp(mx_worley_noise_float_3d(r.mul(f), 1.0, 0.0).mul(1.8), 0, 1))
    const fine2 = oneMinus(
      clamp(mx_worley_noise_float_3d(r.mul(f.mul(2.3)).add(vec3(19, 7, 3)), 1.0, 0.0).mul(1.8), 0, 1),
    )

    // Slow "boiling": shift the brightness-variation lookup through time so
    // individual granules brighten and fade instead of a rigid pattern.
    const boil = time.mul(uEvolution).mul(0.05)
    const variation = mx_fractal_noise_float(
      r.mul(f.mul(0.4)).add(vec3(boil, boil.mul(0.7), boil.mul(1.3))),
      3,
      2.0,
      0.5,
    )
      .mul(0.5)
      .add(0.5)

    // The base octave already supplies large cells at low frequency, so giants
    // simply blend toward it; no extra cellular octave is needed.
    const fineCells = fine.mul(0.62).add(fine2.mul(0.38))
    const giantCells = fine.mul(0.85).add(variation.mul(0.15))
    const cells = mix(fineCells, giantCells, uGiantBlend)

    // Granule-to-granule brightness variation, then deepen the dark lanes.
    const varied = cells.mul(oneMinus(uBrightnessVariation.mul(0.5))).add(variation.mul(uBrightnessVariation).mul(0.5))
    const laned = clamp(varied.sub(oneMinus(varied).mul(uLaneDarkness).mul(0.3)), 0, 1)

    // Level of detail: fade granulation toward the mean once cells fall below a
    // pixel, so a distant disc is smooth instead of shimmering.
    const footprint = length(fwidth(dir))
    const lod = clamp(oneMinus(footprint.mul(f).mul(2.0)), 0, 1)
    const granulation = mix(float(1), laned, uContrast.mul(lod))

    // Broad cool convection regions (magnetic spots are a separate, evolving layer).
    const darkNoise = mx_fractal_noise_float(r.mul(f.mul(0.18)).add(vec3(5, 11, 3)), 3, 2.0, 0.5)
      .mul(0.5)
      .add(0.5)
    const darkRegion = smoothstep(0.62, 0.88, darkNoise).mul(uDarkRegion)

    const brightness = granulation.mul(oneMinus(darkRegion.mul(0.4)))

    // Cooler lanes and dark regions shift slightly toward the red; the shift is
    // deliberately small (the star's colour comes from its blackbody T_eff).
    const cool = clamp(oneMinus(laned).mul(0.25).add(darkRegion.mul(0.6)), 0, 1)
    const tint = mix(vec3(1, 1, 1), vec3(0.94, 0.82, 0.68), cool)

    return {
      brightness: brightness as THREE.Node<'float'>,
      tint: tint as THREE.Node<'vec3'>,
    }
  }

  return {
    uniforms: {
      cellFrequency: uCellFrequency,
      contrast: uContrast,
      giantBlend: uGiantBlend,
      darkRegion: uDarkRegion,
      laneDarkness: uLaneDarkness,
      brightnessVariation: uBrightnessVariation,
      evolution: uEvolution,
      rotation: uRotation,
    },
    setModel(params) {
      uCellFrequency.value = params.cellFrequency
      uContrast.value = params.contrast
      uGiantBlend.value = params.giantBlend
      uDarkRegion.value = params.darkRegion
      uLaneDarkness.value = params.laneDarkness
      uBrightnessVariation.value = params.brightnessVariation
      uEvolution.value = params.evolution
    },
    setDifferentialRotation(rate) {
      uRotation.value = rate
    },
    evaluate,
    heightField,
  }
}
