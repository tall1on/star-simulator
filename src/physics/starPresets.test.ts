import { describe, expect, it } from 'vitest'
import { STAR_PRESETS, presetStats } from '@/physics/starPresets'
import { STAR_TYPES } from '@/physics/starTypes'
import { densityFromMassRadius, luminosityFromRadiusTemperature } from '@/physics/relations'
import type { Range } from '@/types/star'

function within(value: number, range: Range): boolean {
  return value >= range[0] - 1e-12 * Math.max(1, Math.abs(range[0])) && value <= range[1] * (1 + 1e-12) + 1e-12
}

describe('star presets', () => {
  it('has unique ids', () => {
    const ids = STAR_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('derives density and luminosity consistently with the relations', () => {
    for (const preset of STAR_PRESETS) {
      const stats = presetStats(preset)
      expect(stats.density).toBeCloseTo(densityFromMassRadius(preset.mass, preset.radius), 6)
      expect(stats.luminosity).toBeCloseTo(luminosityFromRadiusTemperature(preset.radius, preset.temperature), 6)
    }
  })

  it('keeps every preset within its type ranges', () => {
    for (const preset of STAR_PRESETS) {
      const ranges = STAR_TYPES[preset.typeId].ranges
      const stats = presetStats(preset)
      expect(within(stats.mass, ranges.mass), `${preset.id} mass`).toBe(true)
      expect(within(stats.radius, ranges.radius), `${preset.id} radius`).toBe(true)
      expect(within(stats.density, ranges.density), `${preset.id} density`).toBe(true)
      expect(within(stats.luminosity, ranges.luminosity), `${preset.id} luminosity`).toBe(true)
      expect(within(stats.temperature, ranges.temperature), `${preset.id} temperature`).toBe(true)
      expect(within(stats.magneticField, ranges.magneticField), `${preset.id} B`).toBe(true)
    }
  })

  it('keeps wind parameters within their type ranges', () => {
    for (const preset of STAR_PRESETS) {
      const wind = STAR_TYPES[preset.typeId].windRanges
      expect(within(preset.wind.speed, wind.speed), `${preset.id} speed`).toBe(true)
      expect(within(preset.wind.massLossRate, wind.massLossRate), `${preset.id} mass loss`).toBe(true)
      expect(within(preset.wind.rotationPeriod, wind.rotationPeriod), `${preset.id} period`).toBe(true)
      expect(within(preset.wind.tilt, wind.tilt), `${preset.id} tilt`).toBe(true)
    }
  })
})
