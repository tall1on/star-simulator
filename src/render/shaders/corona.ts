import * as THREE from 'three/webgpu'
import {
  atan,
  float,
  length,
  mix,
  mx_fractal_noise_float,
  oneMinus,
  pow,
  saturate,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl'

export interface Corona {
  material: THREE.MeshBasicNodeMaterial
  setColor(color: readonly [number, number, number]): void
  setIntensity(intensity: number): void
  setFilterMode(enabled: boolean): void
  setChromosphere(intensity: number): void
}

/**
 * Soft corona / chromosphere on a camera-facing billboard.
 *
 * - A faint diffuse corona with fractal streamers and no hard boundary.
 * - A thin red **chromosphere** rim and **prominences** just outside the
 *   photosphere. These are only visible through a filter in reality, so they
 *   are gated behind Filter mode via `setFilterMode`.
 */
export function createCorona(): Corona {
  const uColor = uniform(new THREE.Vector3(1, 1, 1))
  const uIntensity = uniform(1)
  const uFilter = uniform(0)
  const uChromosphere = uniform(1)
  const chromoColor = uniform(new THREE.Vector3(1.0, 0.15, 0.09))

  const p = uv().sub(0.5).mul(2.0)
  const radius = length(p)
  const inner = float(0.1667)

  // Diffuse corona.
  const falloff = pow(oneMinus(saturate(radius)), 2.5)
  const mask = smoothstep(inner, inner.mul(1.5), radius)
  const ang = atan(p.y, p.x)
  const lobe = sin(ang.mul(5.0).add(radius.mul(2.5)).add(time.mul(0.25))).mul(0.5).add(0.5)
  const noise = mx_fractal_noise_float(vec3(p.x.mul(2.5), p.y.mul(2.5), time.mul(0.05)), 3, 2.0, 0.5)
    .mul(0.5)
    .add(0.5)
  const streamer = mix(float(0.65), float(1.35), lobe.mul(0.6).add(noise.mul(0.4)))
  const corona = falloff.mul(mask).mul(streamer)

  // Chromosphere rim.
  const ring = smoothstep(inner.mul(1.35), inner.mul(1.05), radius).mul(smoothstep(inner.mul(0.92), inner.mul(1.04), radius))

  // Prominences: noise tongues reaching above the rim.
  const promNoise = mx_fractal_noise_float(
    vec3(ang.mul(3.0).add(3.0), radius.mul(9.0).sub(time.mul(0.2)), time.mul(0.1)),
    3,
    2.0,
    0.5,
  )
    .mul(0.5)
    .add(0.5)
  const prom = smoothstep(0.62, 0.95, promNoise)
    .mul(smoothstep(inner.mul(2.0), inner.mul(1.05), radius))
    .mul(smoothstep(inner.mul(1.0), inner.mul(1.15), radius))
  const chromo = ring.add(prom.mul(0.9)).mul(uChromosphere)

  const filter = mix(float(0), float(1), uFilter)
  const colorNode = vec3(uColor)
    .mul(corona)
    .add(vec3(chromoColor).mul(chromo).mul(filter))
    .mul(uIntensity)

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  material.colorNode = colorNode
  material.opacityNode = saturate(corona.mul(0.9).add(chromo.mul(filter)))

  return {
    material,
    setColor(color) {
      uColor.value.set(color[0], color[1], color[2])
    },
    setIntensity(intensity) {
      uIntensity.value = intensity
    },
    setFilterMode(enabled) {
      uFilter.value = enabled ? 1 : 0
    },
    setChromosphere(intensity) {
      uChromosphere.value = intensity
    },
  }
}
