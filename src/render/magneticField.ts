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
 * The simulation owns a *fixed slot pool*: every slot has a permanent
 * `BufferGeometry` whose position attribute aliases the simulation's array, so
 * reconnection, region emergence and ejecta never allocate GPU resources or
 * reset the plasma particles. Slots are shown/hidden per frame by `slotActive`,
 * and ejecta draw with a brighter material.
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
  const ejectaMaterial = new THREE.LineBasicNodeMaterial({
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
  const ejectaColor = new THREE.Color()

  let lines: THREE.Line[] = []
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
    lines = []
    tiltGroup.clear()
    for (let i = 0; i < simulation.slotCount; i++) {
      const positions = simulation.slotPositions(i)
      const geometry = new THREE.BufferGeometry()
      const attribute = new THREE.BufferAttribute(positions, 3)
      attribute.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute('position', attribute)
      const isEjecta = simulation.slotGroup(i) === 'ejecta'
      const line = new THREE.Line(geometry, isEjecta ? ejectaMaterial : lineMaterial)
      line.frustumCulled = false
      line.visible = false
      geometries.push(geometry)
      lines.push(line)
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
    const openLines = simulation.openLineCount
    if (openLines === 0) return
    particlePositions = new Float32Array(openLines * PARTICLES_PER_OPEN_LINE * 3)
    particleProgress = new Float32Array(openLines * PARTICLES_PER_OPEN_LINE)
    for (let k = 0; k < openLines; k++) {
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
    lineMaterial.opacity = 0.1 + 0.7 * t
    color.setHSL(0.58 - 0.45 * t, 0.9, 0.55)
    lineMaterial.color.copy(color)
    ejectaMaterial.opacity = 0.35 + 0.6 * t
    ejectaColor.setHSL(0.08 + 0.12 * t, 1.0, 0.62)
    ejectaMaterial.color.copy(ejectaColor)
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
    const openLines = simulation.openLineCount
    for (let k = 0; k < openLines; k++) {
      for (let j = 0; j < PARTICLES_PER_OPEN_LINE; j++) {
        particleProgress[k * PARTICLES_PER_OPEN_LINE + j] = j / PARTICLES_PER_OPEN_LINE
      }
    }
    refreshBuffers()
  }

  function refreshBuffers(): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const active = simulation.slotActive(i)
      line.visible = active && group.visible
      if (!active) continue
      const attribute = geometries[i]?.getAttribute('position')
      if (attribute) attribute.needsUpdate = true
    }
  }

  function update(realDeltaSeconds: number): void {
    simulation.step(realDeltaSeconds)
    spinGroup.rotation.y = simulation.spinAngle
    refreshBuffers()

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
    refreshBuffers()
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
    lines = []
    if (particles) particles.geometry.dispose()
    particles = null
    particleAttribute = null
    lineMaterial.dispose()
    ejectaMaterial.dispose()
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
