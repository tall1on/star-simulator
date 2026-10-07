import { describe, expect, it } from 'vitest'
import { vec3 } from 'three/tsl'
import { createSurfaceDetail, DEFAULT_SURFACE_MODEL } from './surfaceDetail'
import { createStarSurface } from './starSurface'
import { createLensedSurface } from './lensedSurface'

describe('surfaceDetail', () => {
  it('builds its node graph, samples it and accepts a new model', () => {
    const detail = createSurfaceDetail(DEFAULT_SURFACE_MODEL)
    const sample = detail.evaluate(vec3(0, 1, 0))
    expect(sample.brightness).toBeDefined()
    expect(sample.tint).toBeDefined()
    expect(detail.heightField(vec3(0, 1, 0))).toBeDefined()
    detail.setModel({ ...DEFAULT_SURFACE_MODEL, cellFrequency: 4, giantBlend: 1, laneDarkness: 0.7 })
    detail.setDifferentialRotation(0.2)
    expect(detail.uniforms.cellFrequency.value).toBe(4)
    expect(detail.uniforms.rotation.value).toBe(0.2)
  })
})

describe('photosphere materials', () => {
  it('builds the spherical photosphere and updates every input', () => {
    const surface = createStarSurface()
    surface.setColor([1, 0.9, 0.8])
    surface.setIntensity(1.2)
    surface.setSurfaceModel(DEFAULT_SURFACE_MODEL)
    surface.setLimbDarkening(0.62)
    surface.setDifferentialRotation(0.12)
    surface.setSunspots([], 0)
    surface.setSunspotColors({ penumbra: [1, 1, 1], umbra: [0.6, 0.3, 0.2] }, { penumbra: 0.57, umbra: 0.19 })
    expect(surface.material).toBeDefined()
  })

  it('builds the relativistically lensed photosphere', () => {
    const lensed = createLensedSurface()
    lensed.setCompactness(0.3)
    lensed.setColor([1, 1, 1])
    lensed.setIntensity(1)
    lensed.setSurfaceModel(DEFAULT_SURFACE_MODEL)
    lensed.setLimbDarkening(0.5)
    lensed.setDifferentialRotation(0.05)
    lensed.setSunspots([], 0)
    lensed.setSunspotColors({ penumbra: [1, 1, 1], umbra: [0.6, 0.3, 0.2] }, { penumbra: 0.57, umbra: 0.19 })
    expect(lensed.material).toBeDefined()
  })
})
