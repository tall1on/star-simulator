import * as THREE from 'three/webgpu'
import {
  dot,
  float,
  max,
  oneMinus,
  smoothstep,
  uniform,
  uniformArray,
  vec3,
} from 'three/tsl'
import { surfaceFluxCompensation } from '@/physics/sunspots'
import { MAX_RENDERED_SUNSPOTS, type SunspotRenderData } from '@/types/sunspots'

/** Representative umbra/penumbra area split used for the flux-balance estimate. */
const MEAN_UMBRA_FRACTION = 0.4

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
 * penumbra and umbra angular radii, so the shader needs only a dot product and a
 * couple of smoothsteps per spot. Overlaps combine with `max`, never by
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
    Array.from({ length: MAX_RENDERED_SUNSPOTS }, () => new THREE.Vector4(0, 1, 0, 0)),
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

    for (let i = 0; i < MAX_RENDERED_SUNSPOTS; i++) {
      const c = dot(dir, dirs.element(i))
      const p = params.element(i)
      const cosPenumbra = p.x
      const cosUmbra = p.y
      const weight = p.z

      // Mask is faded by `weight` so emergence/decay don't pop; the physical
      // size change comes from the angular radius (which follows the area).
      const penumbraSoftness = oneMinus(cosPenumbra).mul(0.5)
      const penumbraMask = smoothstep(cosPenumbra.sub(penumbraSoftness), cosPenumbra, c).mul(weight)
      const umbraSoftness = oneMinus(cosUmbra).mul(0.5)
      const umbraMask = smoothstep(cosUmbra.sub(umbraSoftness), cosUmbra, c).mul(weight)

      cover.assign(max(cover, penumbraMask))
      umbraMix.assign(max(umbraMix, umbraMask))
    }

    return { cover, umbraMix }
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
      const angularRadius = Math.min(spot.angularRadius, Math.PI / 2)
      p.set(Math.cos(angularRadius), Math.cos(angularRadius * spot.umbraFraction), spot.weight, 0)
    }
    for (let i = count; i < MAX_RENDERED_SUNSPOTS; i++) {
      const p = paramArray[i]
      if (p !== undefined) p.z = 0
    }

    const meanSpotRadiance = penumbraRadianceValue * (1 - MEAN_UMBRA_FRACTION) + umbraRadianceValue * MEAN_UMBRA_FRACTION
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
