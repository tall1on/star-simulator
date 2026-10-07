import * as THREE from 'three/webgpu'
import {
  clamp,
  float,
  length,
  max,
  oneMinus,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec3,
} from 'three/tsl'
import { createSurfaceDetail, DEFAULT_SURFACE_MODEL, type SurfaceModelParams } from './surfaceDetail'

export interface LensedSurface {
  material: THREE.MeshBasicNodeMaterial
  setColor(color: readonly [number, number, number]): void
  setIntensity(intensity: number): void
  setSurfaceModel(params: SurfaceModelParams): void
  setLimbDarkening(coefficient: number): void
  setDifferentialRotation(rate: number): void
  /** Schwarzschild compactness u = r_s / R (0 … ~0.5). */
  setCompactness(u: number): void
}

/**
 * Neutron-star photosphere rendered as a camera-facing disc with gravitational
 * light bending.
 *
 * Beloborodov's approximation (ApJ 566, L85, 2002) relates the local emission
 * angle α to the surface colatitude ψ measured from the observer direction:
 *
 *     1 − cos α = (1 − u)(1 − cos ψ)      with u = r_s / R
 *
 * combined with the photon invariant `sin α = (b/R)·√(1 − u)` for impact
 * parameter b. Inverting these gives, for every screen pixel, the surface point
 * that is actually seen — including points on the far side (ψ > 90°), so more
 * than half the surface is visible at once, as for a real neutron star.
 */
export function createLensedSurface(): LensedSurface {
  const uColor = uniform(new THREE.Vector3(1, 1, 1))
  const uIntensity = uniform(1)
  const uLimb = uniform(0.5)
  const uCompactness = uniform(0.25)
  const detail = createSurfaceDetail(DEFAULT_SURFACE_MODEL)

  const q = uv().sub(0.5).mul(2.0)
  const qLen = length(q)

  const oneMinusU = clamp(oneMinus(uCompactness), 1e-3, 1)
  const sqrtOneMinusU = sqrt(oneMinusU)
  const bMax = float(1).div(sqrtOneMinusU)

  const bOverR = qLen.mul(bMax)
  const sinAlpha = clamp(bOverR.mul(sqrtOneMinusU), 0, 1)
  const cosAlpha = sqrt(clamp(oneMinus(sinAlpha.mul(sinAlpha)), 0, 1))
  const cosPsi = clamp(cosAlpha.sub(uCompactness).div(oneMinusU), -1, 1)
  const sinPsi = sqrt(clamp(oneMinus(cosPsi.mul(cosPsi)), 0, 1))

  const safeLen = max(qLen, 1e-4)
  const normal = vec3(q.x.div(safeLen).mul(sinPsi), q.y.div(safeLen).mul(sinPsi), cosPsi)

  const sample = detail.evaluate(normal)

  // Linear limb-darkening law, using the *emission* angle α.
  const limb = oneMinus(uLimb.mul(oneMinus(cosAlpha)))
  // Gravitational redshift dims the whole surface by (1 − u)².
  const redshift = oneMinusU.mul(oneMinusU)

  const edgeFade = smoothstep(bMax.mul(1.0), bMax.mul(0.97), bOverR)
  const brightness = limb.mul(sample.brightness).mul(redshift).mul(edgeFade)
  const colorNode = vec3(uColor).mul(sample.tint).mul(brightness).mul(uIntensity)

  const material = new THREE.MeshBasicNodeMaterial()
  material.colorNode = colorNode

  return {
    material,
    setColor(color) {
      uColor.value.set(color[0], color[1], color[2])
    },
    setIntensity(intensity) {
      uIntensity.value = intensity
    },
    setSurfaceModel(params) {
      detail.setModel(params)
    },
    setLimbDarkening(coefficient) {
      uLimb.value = coefficient
    },
    setDifferentialRotation(rate) {
      detail.setDifferentialRotation(rate)
    },
    setCompactness(u) {
      uCompactness.value = Math.min(0.6, Math.max(0.001, u))
    },
  }
}
