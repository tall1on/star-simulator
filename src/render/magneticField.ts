import * as THREE from 'three/webgpu'
import { clamp } from '@/physics/relations'
import { MagnetosphereSimulation } from '@/simulation/magnetosphereSimulation'
import type { MagnetosphereConfig, MagnetosphereDiagnostics } from '@/types/magnetosphere'

const DEG = Math.PI / 180
/** Particles traced along each open field line. */
const PARTICLES_PER_OPEN_LINE = 40

export interface MagneticField {
  group: THREE.Group
  /** Set the star radius in scene units; field geometry is authored in star radii. */
  setSceneRadius(radius: number): void
  /** Apply the current physical state. Preserves the evolving field-line state. */
  configure(config: MagnetosphereConfig): void
  /** Deterministic reset of the simulation state. */
  reset(): void
  /** Advance the simulation by a real-time delta and refresh the buffers. */
  update(realDeltaSeconds: number): void
  setVisible(visible: boolean): void
  setParticlesVisible(visible: boolean): void
  diagnostics(): MagnetosphereDiagnostics
  dispose(): void
}

/**
 * Magnetic-field visualisation driven by {@link MagnetosphereSimulation}.
 *
 * Geometry is authored in star-radius units and scaled by the group, so changing
 * the star radius never rebuilds. Line buffers are allocated once and updated in
 * place each frame; the topology is fixed, so parameter edits never snap the
 * shape or reset the plasma particles. The whole magnetosphere rigidly co-rotates
 * with the star while the torsional shear and Parker winding evolve within it.
 */
export function createMagneticField(): MagneticField {
  const group = new THREE.Group()
  const spinGroup = new THREE.Group()
  const tiltGroup = new THREE.Group()
  spinGroup.add(tiltGroup)
  group.add(spinGroup)

  const simulation = new MagnetosphereSimulation()

  const lineMaterial = new THREE.LineBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const particleMaterial = new THREE.PointsNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    size: 0.05,
    sizeAttenuation: true,
  })
  const color = new THREE.Color()

  let geometries: THREE.BufferGeometry[] = []
  let particles: THREE.Points | null = null
  let particleAttribute: THREE.BufferAttribute | null = null
  let particlePositions = new Float32Array(0)
  let particleProgress = new Float32Array(0)
  let particlesVisible = true
  let windSpeedKms = 400
  let simActive = true

  function buildLines(): void {
    for (const geometry of geometries) geometry.dispose()
    geometries = []
    tiltGroup.clear()

    const count = simulation.lineCount
    for (let i = 0; i < count; i++) {
      const positions = simulation.linePositions(i)
      const geometry = new THREE.BufferGeometry()
      const attribute = new THREE.BufferAttribute(positions, 3)
      attribute.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute('position', attribute)
      const line = new THREE.Line(geometry, lineMaterial)
      // Moving geometry: always draw, never cull against a stale bounding sphere.
      line.frustumCulled = false
      geometries.push(geometry)
      tiltGroup.add(line)
    }
    buildParticles()
  }

  function buildParticles(): void {
    if (particles) {
      particles.geometry.dispose()
      particles = null
    }
    particleAttribute = null

    const lines = simulation.openLineCount
    if (lines === 0) return
    particlePositions = new Float32Array(lines * PARTICLES_PER_OPEN_LINE * 3)
    particleProgress = new Float32Array(lines * PARTICLES_PER_OPEN_LINE)
    for (let k = 0; k < lines; k++) {
      for (let j = 0; j < PARTICLES_PER_OPEN_LINE; j++) {
        particleProgress[k * PARTICLES_PER_OPEN_LINE + j] = j / PARTICLES_PER_OPEN_LINE
      }
    }
    const geometry = new THREE.BufferGeometry()
    particleAttribute = new THREE.BufferAttribute(particlePositions, 3)
    particleAttribute.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', particleAttribute)
    particles = new THREE.Points(geometry, particleMaterial)
    particles.frustumCulled = false
    particles.visible = particlesVisible
    tiltGroup.add(particles)
  }

  function setStrength(fieldStrength: number): void {
    const t = clamp((Math.log10(Math.max(fieldStrength, 1)) - 3) / 12, 0, 1)
    lineMaterial.opacity = 0.12 + 0.8 * t
    color.setHSL(0.58 - 0.5 * t, 0.9, 0.55)
    lineMaterial.color.copy(color)
    particleMaterial.color.copy(color)
    particleMaterial.opacity = 0.2 + 0.7 * t
  }

  function configure(config: MagnetosphereConfig): void {
    windSpeedKms = config.windSpeed
    simActive = config.enabled && config.running
    tiltGroup.rotation.z = config.tilt * DEG
    simulation.configure(config)
    setStrength(config.fieldStrength)
  }

  function reset(): void {
    simulation.reset()
    spinGroup.rotation.y = simulation.spinAngle
    const lines = simulation.openLineCount
    for (let k = 0; k < lines; k++) {
      for (let j = 0; j < PARTICLES_PER_OPEN_LINE; j++) {
        particleProgress[k * PARTICLES_PER_OPEN_LINE + j] = j / PARTICLES_PER_OPEN_LINE
      }
    }
    refreshLineBuffers()
  }

  function refreshLineBuffers(): void {
    for (const geometry of geometries) {
      const attribute = geometry.getAttribute('position')
      if (attribute) attribute.needsUpdate = true
    }
  }

  function update(realDeltaSeconds: number): void {
    simulation.step(realDeltaSeconds)
    spinGroup.rotation.y = simulation.spinAngle
    refreshLineBuffers()

    if (particles && particleAttribute && particleProgress.length > 0 && simActive && group.visible) {
      const rate = clamp(windSpeedKms / 400, 0.2, 6) * 0.5
      for (let i = 0; i < particleProgress.length; i++) {
        let p = (particleProgress[i] ?? 0) + realDeltaSeconds * rate
        p -= Math.floor(p)
        if (p < 0) p = 0
        particleProgress[i] = p
        const lineIndex = Math.floor(i / PARTICLES_PER_OPEN_LINE)
        simulation.sampleOpenLine(lineIndex, p, particlePositions, i * 3)
      }
      particleAttribute.needsUpdate = true
    }
  }

  function setSceneRadius(radius: number): void {
    const r = Math.max(radius, 1e-6)
    group.scale.setScalar(r)
    particleMaterial.size = r * 0.05
  }

  function setVisible(visible: boolean): void {
    group.visible = visible
  }

  function setParticlesVisible(visible: boolean): void {
    particlesVisible = visible
    if (particles) particles.visible = visible
  }

  function diagnostics(): MagnetosphereDiagnostics {
    return simulation.diagnostics()
  }

  function dispose(): void {
    for (const geometry of geometries) geometry.dispose()
    geometries = []
    if (particles) particles.geometry.dispose()
    particles = null
    particleAttribute = null
    lineMaterial.dispose()
    particleMaterial.dispose()
  }

  buildLines()

  return {
    group,
    setSceneRadius,
    configure,
    reset,
    update,
    setVisible,
    setParticlesVisible,
    diagnostics,
    dispose,
  }
}
