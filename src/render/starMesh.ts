import * as THREE from 'three/webgpu'
import type { StarStats, SurfaceKind, ViewMode } from '@/types/star'
import { blackbodyColor, clamp, schwarzschildRadius, SOLAR_TEMPERATURE, toSolarLuminosity } from '@/physics/relations'
import { oblatenessFactors } from '@/physics/rotation'
import { createStarSurface } from './shaders/starSurface'
import { createLensedSurface } from './shaders/lensedSurface'
import { createCorona } from './shaders/corona'
import { DEFAULT_SURFACE_MODEL, type SurfaceModelParams } from './shaders/surfaceDetail'

export interface StarObject {
  group: THREE.Group
  setKind(kind: SurfaceKind): void
  setSceneRadius(radius: number): void
  /** Rotational flattening f = (R_eq − R_pole)/R_eq. */
  setOblateness(flattening: number): void
  /** Physics-driven convection/spot parameters from {@link surfaceModel}. */
  setSurfaceModel(params: SurfaceModelParams): void
  applyStats(stats: StarStats, mode: ViewMode): void
  setCoronaVisible(visible: boolean): void
  update(camera: THREE.Camera): void
  dispose(): void
}

/**
 * Photosphere brightness. Surface brightness of a resolved star is set by its
 * effective temperature (blackbody radiance ∝ T⁴), not its total luminosity,
 * and is essentially independent of distance. In *Filter* mode it is normalised
 * so the surface stays readable; in *Real* mode it is scaled to blow out.
 */
export function surfaceIntensityFor(stats: StarStats, mode: ViewMode): number {
  const radiance = (stats.temperature / SOLAR_TEMPERATURE) ** 4
  if (mode === 'real') return clamp(radiance * 4, 0.05, 1e5)
  return clamp(radiance * 0.7, 0.2, 3)
}

/** Corona brightness tracks total luminosity on a log scale. */
export function coronaIntensityFor(stats: StarStats, mode: ViewMode): number {
  const solar = Math.max(toSolarLuminosity(stats.luminosity), 1e-6)
  const norm = clamp((Math.log10(solar) + 4) / 10, 0, 1)
  return mode === 'real' ? 0.4 + norm * 2.5 : 0.25 + norm * 0.9
}

/** Beloborodov maximum impact parameter b_max / R = 1 / √(1 − u). */
function maxImpactRatio(compactness: number): number {
  return 1 / Math.sqrt(Math.max(1 - compactness, 1e-3))
}

export function createStar(): StarObject {
  const group = new THREE.Group()

  const sphere = createStarSurface()
  const lensed = createLensedSurface()
  const corona = createCorona()

  const sphereGeometry = new THREE.SphereGeometry(1, 160, 80)
  const discGeometry = new THREE.CircleGeometry(1, 96)
  const coronaGeometry = new THREE.PlaneGeometry(1, 1)

  const sphereMesh = new THREE.Mesh(sphereGeometry, sphere.material)
  const discMesh = new THREE.Mesh(discGeometry, lensed.material)
  const coronaMesh = new THREE.Mesh(coronaGeometry, corona.material)
  coronaMesh.renderOrder = 1

  group.add(sphereMesh, discMesh, coronaMesh)

  let kind: SurfaceKind = 'sphere'
  let sceneRadius = 1
  let compactness = 0.25
  let flattening = 0
  let surfaceModel: SurfaceModelParams = DEFAULT_SURFACE_MODEL

  // Scratch objects for billboard orientation (avoid per-frame allocations).
  const viewAxis = new THREE.Vector3()
  const upAxis = new THREE.Vector3()
  const rightAxis = new THREE.Vector3()
  const basis = new THREE.Matrix4()
  const worldUp = new THREE.Vector3(0, 1, 0)

  function applyScale(): void {
    const { equatorial, polar } = oblatenessFactors(flattening)

    sphereMesh.scale.set(sceneRadius * equatorial, sceneRadius * polar, sceneRadius * equatorial)

    const discBase = sceneRadius * maxImpactRatio(compactness)
    discMesh.scale.set(discBase * equatorial, discBase * polar, discBase)

    const coronaBase = sceneRadius * 12
    coronaMesh.scale.set(coronaBase * equatorial, coronaBase * polar, coronaBase)
  }

  function setKind(next: SurfaceKind): void {
    kind = next
    sphereMesh.visible = kind === 'sphere'
    discMesh.visible = kind === 'lensed'
  }

  function setSceneRadius(radius: number): void {
    sceneRadius = radius
    applyScale()
  }

  function setOblateness(f: number): void {
    flattening = clamp(f, 0, 0.9)
    applyScale()
  }

  function setSurfaceModel(params: SurfaceModelParams): void {
    surfaceModel = params
    sphere.setSurfaceModel(params)
    lensed.setSurfaceModel(params)
  }

  function applyStats(stats: StarStats, mode: ViewMode): void {
    const color = blackbodyColor(stats.temperature)
    const intensity = surfaceIntensityFor(stats, mode)
    const lensedNeutronStar = kind === 'lensed'

    sphere.setColor(color)
    sphere.setIntensity(intensity)
    sphere.setLimbDarkening(lensedNeutronStar ? 0.35 : 0.62)
    sphere.setDifferentialRotation(lensedNeutronStar ? 0.03 : 0.12)
    sphere.setSurfaceModel(surfaceModel)

    compactness = clamp(schwarzschildRadius(stats.mass) / stats.radius, 0.001, 0.6)
    lensed.setCompactness(compactness)
    lensed.setColor(color)
    lensed.setIntensity(intensity)
    lensed.setLimbDarkening(0.5)
    lensed.setDifferentialRotation(0.05)
    lensed.setSurfaceModel(surfaceModel)

    corona.setColor(color)
    corona.setIntensity(coronaIntensityFor(stats, mode))
    corona.setFilterMode(mode === 'filter')

    applyScale()
  }

  /** Face the camera, but roll so local +Y follows the projected spin axis. */
  function orientBillboard(mesh: THREE.Mesh, camera: THREE.Camera): void {
    viewAxis.copy(camera.position)
    if (viewAxis.lengthSq() < 1e-12) viewAxis.set(0, 0, 1)
    viewAxis.normalize()

    upAxis.copy(worldUp).addScaledVector(viewAxis, -worldUp.dot(viewAxis))
    if (upAxis.lengthSq() < 1e-6) {
      upAxis.copy(camera.up).addScaledVector(viewAxis, -camera.up.dot(viewAxis))
    }
    upAxis.normalize()

    rightAxis.crossVectors(upAxis, viewAxis).normalize()
    basis.makeBasis(rightAxis, upAxis, viewAxis)
    mesh.quaternion.setFromRotationMatrix(basis)
  }

  function update(camera: THREE.Camera): void {
    orientBillboard(discMesh, camera)
    orientBillboard(coronaMesh, camera)
  }

  function setCoronaVisible(visible: boolean): void {
    coronaMesh.visible = visible
  }

  function dispose(): void {
    sphereGeometry.dispose()
    discGeometry.dispose()
    coronaGeometry.dispose()
    sphere.material.dispose()
    lensed.material.dispose()
    corona.material.dispose()
  }

  setKind('sphere')

  return { group, setKind, setSceneRadius, setOblateness, setSurfaceModel, applyStats, setCoronaVisible, update, dispose }
}
