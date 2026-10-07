import * as THREE from 'three/webgpu'
import { clamp, SECONDS_PER_DAY } from '@/physics/relations'

const DEG = Math.PI / 180

export interface FieldParams {
  /** Surface field strength in gauss. */
  fieldStrength: number
  /** Dipole tilt in degrees relative to the rotation axis. */
  tilt: number
  /** Stellar wind speed in km/s. */
  windSpeed: number
  /** Rotation period in days. */
  rotationPeriod: number
}

export interface MagneticField {
  group: THREE.Group
  /** Set the star radius in scene units; field geometry is authored in star radii. */
  setSceneRadius(radius: number): void
  rebuild(params: FieldParams): void
  setStrength(fieldStrength: number): void
  update(elapsed: number, deltaSeconds: number): void
  setVisible(visible: boolean): void
  setParticlesVisible(visible: boolean): void
  dispose(): void
}

interface OpenLine {
  points: THREE.Vector3[]
}

/**
 * Parker spiral winding of an open field line: azimuth advances by (Ω / v) · r,
 * so a slower wind or faster rotation winds the field lines up while a fast wind
 * leaves them nearly radial. The constant is a display scaling factor chosen so
 * a Sun-like wind gives a clearly visible spiral.
 */
function parkerFactor(windSpeedKms: number, rotationPeriodDays: number): number {
  const omega = (2 * Math.PI) / Math.max(rotationPeriodDays * SECONDS_PER_DAY, 1)
  const v = Math.max(windSpeedKms * 1000, 1)
  return clamp((omega / v) * 1e11, 0.02, 3)
}

/** Visual spin rate of the magnetosphere from the rotation period. */
function spinRateFor(rotationPeriodDays: number): number {
  return clamp(1.5 / Math.max(rotationPeriodDays, 1e-5), 0.01, 3)
}

/**
 * Magnetar-style twist strength (0…~1.4). Non-potential, twisted
 * magnetospheres arise from a strong field being wound by rotation: this grows
 * with the rotation rate **and** the field strength, so an ordinary star stays
 * untwisted while a fast, strongly magnetised compact star winds its field into
 * a helix.
 */
function magnetarTwist(rotationPeriodDays: number, fieldStrength: number): number {
  const periodSeconds = Math.max(rotationPeriodDays * SECONDS_PER_DAY, 1e-6)
  const omega = (2 * Math.PI) / periodSeconds
  const spinNorm = clamp(Math.log10(1 + omega) / 4, 0, 1)
  const fieldNorm = clamp((Math.log10(Math.max(fieldStrength, 1)) - 7) / 8, 0, 1)
  return clamp(0.5 * spinNorm + 0.7 * fieldNorm, 0, 1.4)
}

/** Radians of azimuthal twist per star-radius of cylindrical radius. */
const TWIST_PER_RADIUS = 1.6

function sampleLine(points: THREE.Vector3[], p: number, out: Float32Array, offset: number): void {
  const n = points.length
  if (n === 0) return
  const f = p * (n - 1)
  const i0 = Math.floor(f)
  const i1 = Math.min(i0 + 1, n - 1)
  const frac = f - i0
  const a = points[i0]
  const b = points[i1]
  if (!a || !b) return
  out[offset] = a.x + (b.x - a.x) * frac
  out[offset + 1] = a.y + (b.y - a.y) * frac
  out[offset + 2] = a.z + (b.z - a.z) * frac
}

/**
 * Magnetic-field visualisation. Geometry is authored in star-radius units and
 * scaled by the group, so changing the star radius never forces a rebuild. The
 * topology is rebuilt only when physical parameters change: a tilted dipole
 * with closed coronal loops, active-region loops, open polar field lines
 * stretched into a Parker spiral by the stellar wind, and particles tracing the
 * open-field plasma outflow.
 *
 * Under heavy rotation and/or a strong field, every line is additionally wound
 * about the dipole axis (see {@link magnetarTwist}) into a twisted, force-free
 * magnetar-style helix.
 */
export function createMagneticField(): MagneticField {
  const group = new THREE.Group()
  const spinGroup = new THREE.Group()
  const tiltGroup = new THREE.Group()
  spinGroup.add(tiltGroup)
  group.add(spinGroup)

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
  let openLines: OpenLine[] = []
  let particles: THREE.Points | null = null
  let particleAttribute: THREE.BufferAttribute | null = null
  let particleData: { line: number; p: number }[] = []
  let particlePositions = new Float32Array(0)
  let particleRate = 0.5
  let spinRate = 0.06
  let twistGain = 0

  function addLine(points: THREE.Vector3[]): void {
    // Magnetar-style twist: shear every line about the dipole axis by an angle
    // that grows with cylindrical radius, turning planar loops into helices.
    // Mutating in place means open-line particle paths twist along too.
    if (twistGain !== 0) {
      for (const p of points) {
        const rxy = Math.hypot(p.x, p.z)
        const angle = twistGain * rxy
        const c = Math.cos(angle)
        const s = Math.sin(angle)
        const nx = p.x * c + p.z * s
        const nz = -p.x * s + p.z * c
        p.x = nx
        p.z = nz
      }
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    geometries.push(geometry)
    tiltGroup.add(new THREE.Line(geometry, lineMaterial))
  }

  function clear(): void {
    for (const geometry of geometries) geometry.dispose()
    geometries = []
    tiltGroup.clear()
    if (particles) {
      particles.geometry.dispose()
      particles = null
    }
    particleAttribute = null
    openLines = []
    particleData = []
  }

  function rebuild(params: FieldParams): void {
    clear()

    tiltGroup.rotation.z = params.tilt * DEG
    spinRate = spinRateFor(params.rotationPeriod)
    particleRate = clamp(params.windSpeed / 400, 0.2, 6) * 0.5
    twistGain = magnetarTwist(params.rotationPeriod, params.fieldStrength) * TWIST_PER_RADIUS
    const spiral = parkerFactor(params.windSpeed, params.rotationPeriod)

    // Closed dipole field lines.
    const shells = [1.25, 1.55, 1.9, 2.4, 3.1]
    const azimuths = 8
    for (const shell of shells) {
      const thetaStart = Math.asin(Math.sqrt(1 / shell))
      for (let a = 0; a < azimuths; a++) {
        const phi = (a / azimuths) * Math.PI * 2
        const points: THREE.Vector3[] = []
        const steps = 96
        for (let i = 0; i <= steps; i++) {
          const theta = thetaStart + (Math.PI - 2 * thetaStart) * (i / steps)
          const sinTheta = Math.sin(theta)
          const r = shell * sinTheta * sinTheta
          points.push(new THREE.Vector3(r * sinTheta * Math.cos(phi), r * Math.cos(theta), r * sinTheta * Math.sin(phi)))
        }
        addLine(points)
      }
    }

    // Active-region loops in two hemispheres.
    const activeLat = 0.45
    const activeSpan = 0.28
    for (let a = 0; a < 3; a++) {
      const lon = (a / 3) * Math.PI * 2
      for (const sign of [1, -1]) {
        const points: THREE.Vector3[] = []
        const steps = 72
        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const lat = sign * activeLat - activeSpan + 2 * activeSpan * t
          const radial = 1.35 + 0.6 * Math.sin(Math.PI * t)
          const cosLat = Math.cos(lat)
          points.push(new THREE.Vector3(radial * cosLat * Math.cos(lon), radial * Math.sin(lat), radial * cosLat * Math.sin(lon)))
        }
        addLine(points)
      }
    }

    // Open polar field lines, stretched into a Parker spiral.
    const openAzimuths = 8
    const steps = 64
    for (const sign of [1, -1]) {
      for (let a = 0; a < openAzimuths; a++) {
        const phi0 = (a / openAzimuths) * Math.PI * 2
        const points: THREE.Vector3[] = []
        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const r = 6 ** t
          const theta = 0.5 * (1 - t)
          const phi = phi0 + spiral * (r - 1)
          const sinTheta = Math.sin(theta)
          points.push(new THREE.Vector3(r * sinTheta * Math.cos(phi), sign * r * Math.cos(theta), r * sinTheta * Math.sin(phi)))
        }
        openLines.push({ points })
        addLine(points)
      }
    }

    // Plasma particles that flow outward along the open field lines.
    const perLine = 48
    particleData = []
    for (let li = 0; li < openLines.length; li++) {
      for (let k = 0; k < perLine; k++) {
        particleData.push({ line: li, p: k / perLine })
      }
    }
    particlePositions = new Float32Array(particleData.length * 3)
    const geometry = new THREE.BufferGeometry()
    particleAttribute = new THREE.BufferAttribute(particlePositions, 3)
    particleAttribute.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', particleAttribute)
    particles = new THREE.Points(geometry, particleMaterial)
    particles.frustumCulled = false
    tiltGroup.add(particles)

    setStrength(params.fieldStrength)
  }

  function setSceneRadius(radius: number): void {
    const r = Math.max(radius, 1e-6)
    group.scale.setScalar(r)
    particleMaterial.size = r * 0.05
  }

  function setStrength(fieldStrength: number): void {
    const t = clamp((Math.log10(Math.max(fieldStrength, 1)) - 3) / 12, 0, 1)
    lineMaterial.opacity = 0.12 + 0.8 * t
    color.setHSL(0.58 - 0.5 * t, 0.9, 0.55)
    lineMaterial.color.copy(color)
    particleMaterial.color.copy(color)
    particleMaterial.opacity = 0.2 + 0.7 * t
  }

  function update(elapsed: number, deltaSeconds: number): void {
    spinGroup.rotation.y = elapsed * spinRate

    if (particles && particleAttribute) {
      const lines = openLines
      for (let i = 0; i < particleData.length; i++) {
        const datum = particleData[i]
        if (!datum) continue
        datum.p += deltaSeconds * particleRate
        if (datum.p >= 1) datum.p -= Math.floor(datum.p)
        const line = lines[datum.line]
        if (line) sampleLine(line.points, datum.p, particlePositions, i * 3)
      }
      particleAttribute.needsUpdate = true
    }
  }

  function setVisible(visible: boolean): void {
    group.visible = visible
  }

  function setParticlesVisible(visible: boolean): void {
    if (particles) particles.visible = visible
  }

  function dispose(): void {
    clear()
    lineMaterial.dispose()
    particleMaterial.dispose()
  }

  return { group, setSceneRadius, rebuild, setStrength, update, setVisible, setParticlesVisible, dispose }
}
