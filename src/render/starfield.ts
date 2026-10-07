import * as THREE from 'three/webgpu'

export interface Starfield {
  group: THREE.Group
  update(camera: THREE.Camera): void
  setVisible(visible: boolean): void
  dispose(): void
}

const STAR_COUNT = 3200
const BAND_FRACTION = 0.4
const SEED = 0x5eed1234

/** Axis the galactic plane is flattened against; slightly tilted so the band is not screen-horizontal. */
const GALACTIC_POLE = new THREE.Vector3(0.22, 1, 0.18).normalize()

/** Cool pale haze the diffuse Milky Way band is desaturated toward. */
const HAZE = new THREE.Color(0.75, 0.78, 0.9)

/** Clamp a value to a closed interval. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Deterministic mulberry32 PRNG so the backdrop is stable across reloads. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Linear sRGB tint for a blackbody of the given effective temperature, using the
 * Tanner Helland curve fit (approx: valid for ~1000-40000 K). Written locally so
 * the starfield stays independent of the simulation's physics layer.
 */
function blackbodyTint(temperature: number, out: THREE.Color): THREE.Color {
  const t = clamp(temperature, 1000, 40000) / 100
  let r: number
  let g: number
  let b: number
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592
    g = 288.1221695283 * (t - 60) ** -0.0755148492
  }
  if (t >= 66) {
    b = 255
  } else if (t <= 19) {
    b = 0
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307
  }
  return out.setRGB(clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255)
}

/**
 * Procedural background: a single additive `Points` cloud of distant stars plus a
 * faint Milky Way band. It is positioned/ scaled onto the camera each frame so it
 * reads as an infinitely distant backdrop, letting exposure changes be judged
 * against a fixed reference sky.
 */
export function createStarfield(): Starfield {
  const group = new THREE.Group()
  group.renderOrder = -1

  const random = makeRandom(SEED)
  const positions: number[] = []
  const colors: number[] = []
  const tint = new THREE.Color()

  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform direction on the unit sphere.
    const u = 2 * random() - 1
    const phi = 2 * Math.PI * random()
    const sinPolar = Math.sqrt(Math.max(0, 1 - u * u))
    let dx = sinPolar * Math.cos(phi)
    let dy = u
    let dz = sinPolar * Math.sin(phi)

    const inBand = random() < BAND_FRACTION
    if (inBand) {
      // Compress the pole component so density concentrates along the galactic
      // great circle; the squashed remainder is re-normalised below.
      const dot = dx * GALACTIC_POLE.x + dy * GALACTIC_POLE.y + dz * GALACTIC_POLE.z
      const keep = 0.08 + random() * 0.15
      dx -= (1 - keep) * dot * GALACTIC_POLE.x
      dy -= (1 - keep) * dot * GALACTIC_POLE.y
      dz -= (1 - keep) * dot * GALACTIC_POLE.z
    }

    const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
    positions.push(dx / length, dy / length, dz / length)

    // Heavy-tailed brightness: almost all stars are dim, a few stand out.
    const roll = random()
    let brightness = 0.05 + 1.1 * roll ** 5
    const temperature = 3500 + random() ** 1.6 * 26000
    blackbodyTint(temperature, tint)

    if (inBand) {
      // The band is diffuse and faint: desaturate toward a cool pale haze.
      brightness *= 0.45
      tint.lerp(HAZE, 0.4)
    }

    colors.push(tint.r * brightness, tint.g * brightness, tint.b * brightness)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  group.add(points)

  function update(camera: THREE.Camera): void {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    group.position.copy(camera.position)
    group.scale.setScalar(camera.far * 0.5)
    group.renderOrder = -1
  }

  function setVisible(visible: boolean): void {
    group.visible = visible
  }

  function dispose(): void {
    geometry.dispose()
    material.dispose()
  }

  return { group, update, setVisible, dispose }
}
