import { describe, expect, it } from 'vitest'
import { vec3 } from 'three/tsl'
import { createSunspots } from './sunspots'
import { MAX_RENDERED_SUNSPOTS, type SunspotRenderData } from '@/types/sunspots'

function spot(overrides: Partial<SunspotRenderData> = {}): SunspotRenderData {
  return {
    direction: [0, 1, 0],
    angularRadius: 0.05,
    umbraFraction: 0.4,
    weight: 0.8,
    ...overrides,
  }
}

describe('createSunspots', () => {
  it('builds its node graph and evaluates a direction', () => {
    const layer = createSunspots()
    layer.setColors(
      { penumbra: [0.9, 0.7, 0.5], umbra: [0.6, 0.35, 0.2] },
      { penumbra: 0.57, umbra: 0.19 },
    )
    layer.setSpots([spot({ direction: [0, 1, 0] }), spot({ direction: [1, 0, 0], weight: 0.3 })], 0.001)
    const sample = layer.evaluate(vec3(0, 1, 0))
    expect(sample.cover).toBeDefined()
    expect(sample.umbraMix).toBeDefined()
    expect(MAX_RENDERED_SUNSPOTS).toBe(16)
  })

  it('ignores more spots than the shader capacity', () => {
    const layer = createSunspots()
    const many = Array.from({ length: MAX_RENDERED_SUNSPOTS + 5 }, () => spot())
    expect(() => layer.setSpots(many, 0)).not.toThrow()
  })
})
