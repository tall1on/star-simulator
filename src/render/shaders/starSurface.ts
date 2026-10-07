import * as THREE from 'three/webgpu'
import {
  abs,
  cameraPosition,
  cross,
  dot,
  float,
  mix,
  normalWorld,
  normalize,
  oneMinus,
  positionLocal,
  positionWorld,
  saturate,
  step,
  uniform,
  vec3,
} from 'three/tsl'
import { createSurfaceDetail, DEFAULT_SURFACE_MODEL, type SurfaceModelParams } from './surfaceDetail'

export interface StarSurface {
  material: THREE.MeshBasicNodeMaterial
  setColor(color: readonly [number, number, number]): void
  setIntensity(intensity: number): void
  setSurfaceModel(params: SurfaceModelParams): void
  setLimbDarkening(coefficient: number): void
  setDifferentialRotation(rate: number): void
}

/**
 * Photosphere node material for the spherical (main-sequence / giant) star.
 *
 * - temperature-based blackbody colour and physics-driven convection detail,
 * - the linear limb-darkening law I(μ) = 1 − u(1 − μ) plus limb reddening,
 * - **real 3D surface relief**: giant convection cells displace the vertices
 *   along the normal and perturb the normal via a finite-difference gradient of
 *   the height field, so the photosphere has actual bumps and indentations.
 *
 * The displacement amplitude is H_p/R (see {@link surfaceModel}), so an extended
 * giant shows visible relief on the limb while a dwarf stays essentially smooth.
 */
export function createStarSurface(): StarSurface {
  const uColor = uniform(new THREE.Vector3(1, 1, 1))
  const uIntensity = uniform(1)
  const uLimb = uniform(0.62)
  const uDisplacement = uniform(0)
  const detail = createSurfaceDetail(DEFAULT_SURFACE_MODEL)

  const dir = normalize(positionLocal)
  const height = detail.heightField(dir)

  // --- 3D relief -----------------------------------------------------------------
  const displaced = positionLocal.mul(float(1).add(uDisplacement.mul(height)))

  // Finite-difference gradient of the height field for the perturbed normal.
  const eps = 0.02
  const pole = step(0.99, abs(dir.y))
  const helper = mix(vec3(0, 1, 0), vec3(1, 0, 0), pole)
  const tangent1 = normalize(cross(dir, helper))
  const tangent2 = normalize(cross(dir, tangent1))
  const h1 = detail.heightField(normalize(dir.add(tangent1.mul(eps))))
  const h2 = detail.heightField(normalize(dir.add(tangent2.mul(eps))))
  const g1 = h1.sub(height).div(eps)
  const g2 = h2.sub(height).div(eps)
  const bumpedNormal = normalize(
    dir.sub(tangent1.mul(g1.mul(uDisplacement))).sub(tangent2.mul(g2.mul(uDisplacement))),
  )

  const sample = detail.evaluate(dir)
  const viewDir = normalize(cameraPosition.sub(positionWorld))
  const mu = saturate(dot(normalWorld, viewDir))
  const limb = oneMinus(uLimb.mul(oneMinus(mu)))

  // Limb reddening: cooler, redder plasma toward the edge.
  const limbRedden = mix(vec3(1, 1, 1), vec3(1.0, 0.5, 0.24), oneMinus(mu).mul(0.55))
  const faculae = saturate(oneMinus(mu).mul(1.4)).mul(sample.brightness).mul(0.12)

  const brightness = limb.mul(sample.brightness).add(faculae)
  const colorNode = vec3(uColor).mul(sample.tint).mul(limbRedden).mul(brightness).mul(uIntensity)

  const material = new THREE.MeshBasicNodeMaterial()
  material.positionNode = displaced
  material.normalNode = bumpedNormal
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
      uDisplacement.value = params.displacement
    },
    setLimbDarkening(coefficient) {
      uLimb.value = coefficient
    },
    setDifferentialRotation(rate) {
      detail.setDifferentialRotation(rate)
    },
  }
}
