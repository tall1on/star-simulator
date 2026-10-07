import * as THREE from 'three/webgpu'
import {
  dot,
  float,
  max,
  oneMinus,
  sin,
  smoothstep,
  uniform,
  uniformArray,
  vec3,
} from 'three/tsl'
import { surfaceFluxCompensation } from '@/physics/sunspots'
import { MAX_RENDERED_SUNSPOTS, type SunspotRenderData } from '@/types/sunspots'

/** Representative umbra/penumbra area split used for the flux-balance estimate. */
const MEAN_UMBRA_FRACTION = 0.4
/** Relative c-space softness of a cap edge (keeps edges antialiased, not blurry). */
const EDGE_SOFTNESS = 0.35
/** Amplitude of the per-spot irregular-edge wobble. */
const EDGE_WOBBLE = 0.06

export interface SunspotColors {
  penumbra: readonly [number, number, number]
  umbra: readonly [number, number, number]
}

export interface SunspotRadiance {
  penumbra: number
  umbra: number
}

export interface SunspotSample {
  /** Fraction of the surface direction covered by a spot (penumbra incl. umbra), 0…1. */
  cover: THREE.Node<'float'>
  /** How deep into the umbra the direction is, 0…1. */
  umbraMix: THREE.Node<'float'>
  /** Facular/plage proximity, 0…1 (bright magnetic regions around spots). */
  plage: THREE.Node<'float'>
}

export interface SunspotLayer {
  /** Absolute blackbody tint of the penumbra. */
  penumbraColor: THREE.Node<'vec3'>
  /** Absolute blackbody tint of the umbra. */
  umbraColor: THREE.Node<'vec3'>
  /** Bolometric radiance ratio (T_penumbra / T_eff)⁴. */
  penumbraRadiance: THREE.Node<'float'>
  /** Bolometric radiance ratio (T_umbra / T_eff)⁴. */
  umbraRadiance: THREE.Node<'float'>
  /** Multiplier that conserves total flux as spotted area grows. */
  fluxScale: THREE.Node<'float'>
  setSpots(spots: readonly SunspotRenderData[], coverage: number): void
  setColors(colors: SunspotColors, radiance: SunspotRadiance): void
  evaluate(dir: THREE.Node<'vec3'>): SunspotSample
}

/**
 * Evolving sunspot layer shared by the spherical and lensed photospheres.
 *
 * Each spot is a circular cap stored as a unit direction plus the cosines of its
 * facular, penumbral and umbral angular radii, so the shader needs only a dot
 * product and a few smoothsteps per spot. A cheap trigonometric wobble, seeded
 * from the spot direction, makes the boundaries irregular (real spots are not
 * perfect circles) without a noise lookup. Overlaps combine with `max`, never by
 * summing, so overlapping spots never double-darken. Colours and radiances come
 * from the blackbody of the spot temperature (set by the caller), not a
 * hand-picked tint.
 */
export function createSunspots(): SunspotLayer {
  const dirs = uniformArray<'vec3'>(
    Array.from({ length: MAX_RENDERED_SUNSPOTS }, () => new THREE.Vector3(0, 1, 0)),
    'vec3',
  )
  const params = uniformArray<'vec4'>(
    Array.from({ length: MAX_RENDERED_SUNSPOTS }, () => new THREE.Vector4(1, 1, 0, 1)),
    'vec4',
  )

  const uFluxScale = uniform(1)
  const uPenumbraColor = uniform(new THREE.Vector3(1, 1, 1))
  const uUmbraColor = uniform(new THREE.Vector3(0.6, 0.35, 0.2))
  const uPenumbraRadiance = uniform(1)
  const uUmbraRadiance = uniform(1)

  const penumbraColor = vec3(uPenumbraColor)
  const umbraColor = vec3(uUmbraColor)
  const penumbraRadiance = float(uPenumbraRadiance)
  const umbraRadiance = float(uUmbraRadiance)

  // Flux balance is computed on the CPU (unit-tested) and uploaded as a scalar.
  const fluxScale = float(uFluxScale)
  let penumbraRadianceValue = 1
  let umbraRadianceValue = 1

  function evaluate(dir: THREE.Node<'vec3'>): SunspotSample {
    const cover = float(0).toVar()
    const umbraMix = float(0).toVar()
    const plage = float(0).toVar()

    for (let i = 0; i < MAX_RENDERED_SUNSPOTS; i++) {
      const d = dirs.element(i)
      const c = dot(dir, d)
      const p = params.element(i)
      const cosPenumbra = p.x
      const cosUmbra = p.y
      const weight = p.z
      const cosPlage = p.w

      // Irregular boundary: a cheap deterministic wobble seeded from the spot
      // direction, applied in cosine space so it scales with the cap size.
      const seed = d.x.mul(31.7).add(d.y.mul(17.3)).add(d.z.mul(53.1))
      const wobble = sin(dir.x.mul(13.0).add(seed))
        .mul(sin(dir.y.mul(11.0).add(seed.mul(1.7))))
        .mul(sin(dir.z.mul(9.0).sub(seed.mul(0.9))))
      const edge = oneMinus(c).mul(EDGE_WOBBLE)
      const cw = c.add(wobble.mul(edge))

      const penumbraSoftness = oneMinus(cosPenumbra).mul(EDGE_SOFTNESS)
      const penumbraMask = smoothstep(cosPenumbra.sub(penumbraSoftness), cosPenumbra, cw).mul(weight)
      const umbraSoftness = oneMinus(cosUmbra).mul(EDGE_SOFTNESS)
      const umbraMask = smoothstep(cosUmbra.sub(umbraSoftness), cosUmbra, cw).mul(weight)
      const plageSoftness = oneMinus(cosPlage).mul(EDGE_SOFTNESS)
      const plageMask = smoothstep(cosPlage.sub(plageSoftness), cosPlage, cw).mul(weight)

      cover.assign(max(cover, penumbraMask))
      umbraMix.assign(max(umbraMix, umbraMask))
      plage.assign(max(plage, plageMask))
    }

    return { cover, umbraMix, plage }
  }

  function setSpots(spots: readonly SunspotRenderData[], coverage: number): void {
    const dirArray = dirs.array as THREE.Vector3[]
    const paramArray = params.array as THREE.Vector4[]
    const count = Math.min(spots.length, MAX_RENDERED_SUNSPOTS)

    for (let i = 0; i < count; i++) {
      const spot = spots[i]
      const dir = dirArray[i]
      const p = paramArray[i]
      if (spot === undefined || dir === undefined || p === undefined) continue
      const [x, y, z] = spot.direction
      dir.set(x, y, z).normalize()
      const penumbraRadius = Math.min(spot.angularRadius, Math.PI / 2)
      const plageRadius = Math.min(spot.plageAngularRadius, Math.PI / 2)
      p.set(
        Math.cos(penumbraRadius),
        Math.cos(penumbraRadius * spot.umbraFraction),
        spot.weight,
        Math.cos(plageRadius),
      )
    }
    for (let i = count; i < MAX_RENDERED_SUNSPOTS; i++) {
      const p = paramArray[i]
      if (p !== undefined) p.z = 0
    }

    const meanSpotRadiance =
      penumbraRadianceValue * (1 - MEAN_UMBRA_FRACTION) + umbraRadianceValue * MEAN_UMBRA_FRACTION
    uFluxScale.value = surfaceFluxCompensation(coverage, meanSpotRadiance)
  }

  function setColors(colors: SunspotColors, radiance: SunspotRadiance): void {
    uPenumbraColor.value.set(colors.penumbra[0], colors.penumbra[1], colors.penumbra[2])
    uUmbraColor.value.set(colors.umbra[0], colors.umbra[1], colors.umbra[2])
    uPenumbraRadiance.value = radiance.penumbra
    uUmbraRadiance.value = radiance.umbra
    penumbraRadianceValue = radiance.penumbra
    umbraRadianceValue = radiance.umbra
  }

  return {
    penumbraColor,
    umbraColor,
    penumbraRadiance,
    umbraRadiance,
    fluxScale,
    setSpots,
    setColors,
    evaluate,
  }
}
