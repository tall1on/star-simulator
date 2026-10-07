import * as THREE from 'three/webgpu'
import {
  asin,
  clamp,
  cos,
  float,
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
  /** Magnetic starspot strength. */
  spotStrength: number
  /** Relative cell-evolution speed (giant cells evolve slowly). */
  evolution: number
  /** Relative radial relief amplitude (H_p/R) for vertex displacement. */
  displacement: number
}

/** Fallback used before the physics-driven model is supplied. */
export const DEFAULT_SURFACE_MODEL: SurfaceModelParams = {
  cellFrequency: 5,
  contrast: 1,
  giantBlend: 0,
  darkRegion: 0.5,
  spotStrength: 0.7,
  evolution: 1,
  displacement: 0,
}

export interface SurfaceDetailUniforms {
  cellFrequency: { value: number }
  contrast: { value: number }
  giantBlend: { value: number }
  darkRegion: { value: number }
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
 * The convection cell size is set by `cellFrequency` (from the physical
 * pressure scale height), contrast and giant-cell blending by `giantBlend`, and
 * `evolution` slows the pattern for extended stars. Broad cool convection
 * regions are produced here; evolving magnetic spots are a separate layer
 * (see `sunspots.ts`).
 */
export function createSurfaceDetail(initial: SurfaceModelParams): SurfaceDetail {
  const uCellFrequency = uniform(initial.cellFrequency)
  const uContrast = uniform(initial.contrast)
  const uGiantBlend = uniform(initial.giantBlend)
  const uDarkRegion = uniform(initial.darkRegion)
  const uEvolution = uniform(initial.evolution)
  const uRotation = uniform(0.12)

  // Differential rotation: equatorial regions shear faster than the poles.
  function rotatedDir(dir: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
    const t = time.mul(uEvolution)
    const lat = asin(clamp(dir.y, -1, 1))
    const shear = oneMinus(sin(lat).mul(sin(lat)).mul(0.35))
    const angle = t.mul(uRotation).mul(shear)
    const c = cos(angle)
    const s = sin(angle)
    return vec3(dir.x.mul(c).add(dir.z.mul(s)), dir.y, dir.z.mul(c).sub(dir.x.mul(s)))
  }

  function heightField(dir: THREE.Node<'vec3'>): THREE.Node<'float'> {
    const r = rotatedDir(dir)
    const f = uCellFrequency
    const broad = oneMinus(clamp(mx_worley_noise_float_3d(r.mul(f.mul(0.3)), 1.0, 0.0).mul(1.6), 0, 1))
    const turbulence = mx_fractal_noise_float(r.mul(f.mul(0.5)), 3, 2.0, 0.5).mul(0.5).add(0.5)
    return broad.mul(0.7).add(turbulence.mul(0.3)).sub(0.5) as THREE.Node<'float'>
  }

  function evaluate(dir: THREE.Node<'vec3'>): SurfaceSample {
    const rotated = rotatedDir(dir)
    const f = uCellFrequency

    const fine = oneMinus(clamp(mx_worley_noise_float_3d(rotated.mul(f), 1.0, 0.0).mul(1.7), 0, 1))
    const fine2 = oneMinus(clamp(mx_worley_noise_float_3d(rotated.mul(f.mul(2.3)), 1.0, 0.0).mul(1.7), 0, 1))
    const broad = oneMinus(clamp(mx_worley_noise_float_3d(rotated.mul(f.mul(0.3)), 1.0, 0.0).mul(1.6), 0, 1))
    const turbulence = mx_fractal_noise_float(rotated.mul(f.mul(1.4)), 4, 2.0, 0.5).mul(0.5).add(0.5)

    const fineCells = fine.mul(0.5).add(fine2.mul(0.2)).add(turbulence.mul(0.15)).add(0.15)
    const giantCells = broad.mul(0.7).add(turbulence.mul(0.3))
    const cells = mix(fineCells, giantCells, uGiantBlend)
    const granulation = mix(float(1), cells, uContrast)

    // Broad cool convection regions (magnetic spots are a separate, evolving layer).
    const darkNoise = mx_fractal_noise_float(rotated.mul(f.mul(0.18)).add(vec3(5, 11, 3)), 3, 2.0, 0.5)
      .mul(0.5)
      .add(0.5)
    const darkRegion = smoothstep(0.62, 0.88, darkNoise).mul(uDarkRegion)

    const brightness = granulation.mul(oneMinus(darkRegion.mul(0.35)))
    const tint = mix(vec3(1, 1, 1), vec3(0.9, 0.78, 0.66), darkRegion)

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
      evolution: uEvolution,
      rotation: uRotation,
    },
    setModel(params) {
      uCellFrequency.value = params.cellFrequency
      uContrast.value = params.contrast
      uGiantBlend.value = params.giantBlend
      uDarkRegion.value = params.darkRegion
      uEvolution.value = params.evolution
    },
    setDifferentialRotation(rate) {
      uRotation.value = rate
    },
    evaluate,
    heightField,
  }
}
