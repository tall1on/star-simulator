import * as THREE from 'three/webgpu'
import { cameraPosition, dot, normalWorld, normalize, positionWorld, pow, saturate, vec3 } from 'three/tsl'
import { clamp } from '@/physics/relations'

const DEG = Math.PI / 180
const PARTICLE_COUNT = 3200
const MAX_RADIUS = 45 // star radii — long enough for a developed, collimated jet
const UP = new THREE.Vector3(0, 1, 0)

export interface PulsarEmission {
  /** Dipole tilt in degrees relative to the rotation axis. */
  tiltDeg: number
  /** Rotation period in days. */
  rotationPeriodDays: number
  /** Normalised field strength 0…1 (drives speed, collimation and brightness). */
  strength: number
}

export interface Pulsar {
  group: THREE.Group
  setEmission(emission: PulsarEmission): void
  update(deltaSeconds: number, camera: THREE.Camera): void
  setVisible(visible: boolean): void
  dispose(): void
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Relativistic pulsar jet — a long-lived particle outflow.
 *
 * Real jets are collimated along the spin axis, so packets are launched into a
 * narrow cone about that axis (nudged by the magnetic tilt) and travel
 * ballistically for a long time, letting a developed jet form. Rotation is
 * expressed by phase-locked **helical flutes**: the lateral launch direction is
 * tied to the rotation phase, so the jet has a twisted, rope-like structure that
 * rotates with the star.
 *
 * Packets are instanced emissive blobs (view-independent, so no billboarding
 * needed) elongated along their velocity into short streaks. Per-packet colour
 * encodes relativistic Doppler beaming: approaching plasma is brighter and
 * bluer, receding plasma is dimmer and redder. Everything feeds the HDR bloom.
 *
 * Approximation note: packets represent emitting plasma blobs, not individual
 * particles.
 */
export function createPulsar(): Pulsar {
  const group = new THREE.Group()

  const geometry = new THREE.SphereGeometry(1, 8, 6)
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  // Soft round falloff: brightest facing the camera, fading to nothing at the
  // silhouette. Per-instance colour (set on the CPU) multiplies this.
  const viewDir = normalize(cameraPosition.sub(positionWorld))
  const soft = pow(saturate(dot(normalWorld, viewDir)), 2.0)
  material.colorNode = vec3(soft)

  const mesh = new THREE.InstancedMesh(geometry, material, PARTICLE_COUNT)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  group.add(mesh)

  // Per-packet state.
  const dirX = new Float32Array(PARTICLE_COUNT)
  const dirY = new Float32Array(PARTICLE_COUNT)
  const dirZ = new Float32Array(PARTICLE_COUNT)
  const quat = new Float32Array(PARTICLE_COUNT * 4)
  const age = new Float32Array(PARTICLE_COUNT)
  const life = new Float32Array(PARTICLE_COUNT)
  const speed = new Float32Array(PARTICLE_COUNT)
  const sizeArr = new Float32Array(PARTICLE_COUNT)
  const stretchArr = new Float32Array(PARTICLE_COUNT)
  const betaArr = new Float32Array(PARTICLE_COUNT)
  const brightArr = new Float32Array(PARTICLE_COUNT)
  const jitterX = new Float32Array(PARTICLE_COUNT)
  const jitterY = new Float32Array(PARTICLE_COUNT)
  const jitterZ = new Float32Array(PARTICLE_COUNT)
  const pole = new Int8Array(PARTICLE_COUNT)

  const emission: PulsarEmission = { tiltDeg: 20, rotationPeriodDays: 0.05, strength: 0.6 }
  let phase = 0
  let initialized = false

  const position = new THREE.Vector3()
  const scaleVec = new THREE.Vector3()
  const scratchMatrix = new THREE.Matrix4()
  const scratchQuat = new THREE.Quaternion()
  const scratchDir = new THREE.Vector3()
  const scratchColor = new THREE.Color()
  const basisA = new THREE.Vector3()
  const basisB = new THREE.Vector3()
  const lateral = new THREE.Vector3()

  function spinRate(): number {
    return clamp(1.5 / Math.max(emission.rotationPeriodDays, 1e-5), 0.01, 3)
  }

  /**
   * Jet axis in the star frame. Real outflows are collimated along the spin
   * axis; the magnetic tilt only nudges the jet off-axis. Rotation is expressed
   * through the phase-locked helical flutes in {@link respawn}, not by sweeping
   * the whole jet — so a coherent, long-lived jet can actually form.
   */
  function axisAt(target: THREE.Vector3): THREE.Vector3 {
    const tilt = emission.tiltDeg * DEG * 0.5
    return target.set(Math.sin(tilt), Math.cos(tilt), 0)
  }

  function respawn(index: number, initial: boolean): void {
    const strength = emission.strength
    // Tight collimation, tightening further with field strength.
    const spread = (4 + 9 * (1 - strength) + 3 * Math.random()) * DEG

    axisAt(scratchDir)
    if ((pole[index] ?? 1) < 0) scratchDir.multiplyScalar(-1)

    // Orthonormal basis perpendicular to the axis.
    basisA.crossVectors(scratchDir, UP)
    if (basisA.lengthSq() < 1e-6) basisA.set(1, 0, 0)
    basisA.normalize()
    basisB.crossVectors(scratchDir, basisA).normalize()

    // Helical divergence: the lateral direction is locked to the rotation
    // phase, so successive packets corkscrew — a rotating, magnetized jet.
    const twist = phase + (Math.random() - 0.5) * 1.2
    lateral
      .copy(basisA)
      .multiplyScalar(Math.cos(twist))
      .addScaledVector(basisB, Math.sin(twist))
    scratchDir.multiplyScalar(1 - spread).addScaledVector(lateral, spread).normalize()

    dirX[index] = scratchDir.x
    dirY[index] = scratchDir.y
    dirZ[index] = scratchDir.z

    scratchQuat.setFromUnitVectors(UP, scratchDir)
    quat[index * 4] = scratchQuat.x
    quat[index * 4 + 1] = scratchQuat.y
    quat[index * 4 + 2] = scratchQuat.z
    quat[index * 4 + 3] = scratchQuat.w

    // Slower launch → long-lived packets → a developed jet rather than a puff.
    const baseSpeed = (1.2 + 1.4 * strength) * (0.85 + 0.4 * Math.random())
    const lifeValue = MAX_RADIUS / baseSpeed
    speed[index] = baseSpeed
    life[index] = lifeValue
    betaArr[index] = clamp(0.35 + 0.4 * strength + 0.15 * Math.random(), 0.2, 0.9)
    sizeArr[index] = 0.06 + 0.06 * Math.random()
    stretchArr[index] = 1 + 2.8 * (betaArr[index] ?? 0)
    brightArr[index] = 0.5 + 1.4 * Math.random()

    const jitterScale = 0.06 * baseSpeed
    jitterX[index] = (Math.random() - 0.5) * jitterScale
    jitterY[index] = (Math.random() - 0.5) * jitterScale
    jitterZ[index] = (Math.random() - 0.5) * jitterScale

    age[index] = initial ? Math.random() * lifeValue : Math.random() * 0.12 * lifeValue
  }

  function ensureInit(): void {
    if (initialized) return
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pole[i] = i % 2 === 0 ? 1 : -1
      respawn(i, true)
    }
    initialized = true
  }

  function setEmission(next: PulsarEmission): void {
    emission.tiltDeg = next.tiltDeg
    emission.rotationPeriodDays = next.rotationPeriodDays
    emission.strength = clamp(next.strength, 0, 1)
    ensureInit()
  }

  function update(deltaSeconds: number, camera: THREE.Camera): void {
    ensureInit()
    phase += deltaSeconds * spinRate()

    const radius = group.scale.x
    const camX = camera.position.x
    const camY = camera.position.y
    const camZ = camera.position.z

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let packetAge = (age[i] ?? 0) + deltaSeconds
      if (packetAge >= (life[i] ?? 0)) {
        respawn(i, false)
        packetAge = age[i] ?? 0
      } else {
        age[i] = packetAge
      }

      const r = (speed[i] ?? 0) * packetAge
      const px = (dirX[i] ?? 0) * r + (jitterX[i] ?? 0) * packetAge
      const py = (dirY[i] ?? 0) * r + (jitterY[i] ?? 0) * packetAge
      const pz = (dirZ[i] ?? 0) * r + (jitterZ[i] ?? 0) * packetAge
      position.set(px, py, pz)

      scratchQuat.set(quat[i * 4] ?? 0, quat[i * 4 + 1] ?? 0, quat[i * 4 + 2] ?? 0, quat[i * 4 + 3] ?? 1)
      const size = sizeArr[i] ?? 0
      scaleVec.set(size, size * (stretchArr[i] ?? 1), size)
      scratchMatrix.compose(position, scratchQuat, scaleVec)
      mesh.setMatrixAt(i, scratchMatrix)

      // Doppler: velocity direction vs. direction to the camera (world space).
      let tx = camX - px * radius
      let ty = camY - py * radius
      let tz = camZ - pz * radius
      const tlen = Math.hypot(tx, ty, tz) || 1
      tx /= tlen
      ty /= tlen
      tz /= tlen
      const cosT = (dirX[i] ?? 0) * tx + (dirY[i] ?? 0) * ty + (dirZ[i] ?? 0) * tz

      const beta = betaArr[i] ?? 0
      const gamma = 1 / Math.sqrt(Math.max(1 - beta * beta, 1e-4))
      const doppler = 1 / (gamma * Math.max(1 - beta * cosT, 1e-3))
      const beam = clamp(doppler * doppler * doppler, 0.05, 8)

      const fade = smoothstep(0.7, 1.7, r) * (1 - smoothstep(0.8 * MAX_RADIUS, MAX_RADIUS, r))
      const brightness = (brightArr[i] ?? 0) * beam * fade

      const shift = clamp(cosT * beta, -1, 1)
      const cr = clamp(1 - 0.5 * shift, 0.15, 1.8)
      const cg = clamp(1 - 0.12 * Math.abs(shift), 0.15, 1.2)
      const cb = clamp(1 + 0.7 * shift, 0.15, 1.8)

      scratchColor.setRGB(cr * brightness, cg * brightness, cb * brightness)
      mesh.setColorAt(i, scratchColor)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  function setVisible(visible: boolean): void {
    group.visible = visible
  }

  function dispose(): void {
    geometry.dispose()
    material.dispose()
    mesh.dispose()
  }

  return { group, setEmission, update, setVisible, dispose }
}
