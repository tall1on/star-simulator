import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ConsistencyReport, ConstraintMode, StarInputs, StarStats, StarTypeId } from '@/types/star'
import { getStarType, STAR_TYPES } from '@/physics/starTypes'
import { checkConsistency, solveStar } from '@/physics/solver'
import { presetStats, type StarPreset } from '@/physics/starPresets'
import { blackbodyColor, SOLAR_LUMINOSITY, SOLAR_MASS, SOLAR_RADIUS } from '@/physics/relations'
import { useWindStore } from '@/stores/wind'

function copyStats(target: StarInputs, source: StarStats): void {
  target.mass = source.mass
  target.radius = source.radius
  target.density = source.density
  target.luminosity = source.luminosity
  target.temperature = source.temperature
  target.magneticField = source.magneticField
}

export const useStarStore = defineStore('star', () => {
  const typeId = ref<StarTypeId>('main-sequence')
  const mode = ref<ConstraintMode>('model')
  const ageFraction = ref(0)

  const inputs = reactive<StarInputs>({ ...STAR_TYPES['main-sequence'].defaults })

  const type = computed(() => getStarType(typeId.value))
  const ranges = computed(() => type.value.ranges)
  const windRanges = computed(() => type.value.windRanges)
  const canAge = computed(() => type.value.canAge)
  const radiusUnit = computed(() => type.value.radiusUnit)
  const metresPerSceneUnit = computed(() => type.value.metresPerSceneUnit)
  const isLinked = computed(() => mode.value !== 'free')

  /** The single authoritative, physically consistent state. */
  const stats = computed<StarStats>(() =>
    solveStar({ type: type.value, mode: mode.value, inputs, ageFraction: ageFraction.value }),
  )

  const consistency = computed<ConsistencyReport>(() => checkConsistency(stats.value))

  const solarMass = computed(() => stats.value.mass / SOLAR_MASS)
  const solarRadius = computed(() => stats.value.radius / SOLAR_RADIUS)
  const solarLuminosity = computed(() => stats.value.luminosity / SOLAR_LUMINOSITY)

  const color = computed(() => blackbodyColor(stats.value.temperature))
  const colorHex = computed(() => {
    const [r, g, b] = color.value
    const toByte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) ** (1 / 2.2) * 255)
    return `rgb(${toByte(r)}, ${toByte(g)}, ${toByte(b)})`
  })

  function applyDefaults(): void {
    copyStats(inputs, type.value.defaults)
    ageFraction.value = 0
  }

  function setType(id: StarTypeId): void {
    typeId.value = id
    applyDefaults()
    useWindStore().setFromType(getStarType(id))
  }

  /** Apply a known real-star preset: exact values, self-consistent Sandbox state. */
  function applyPreset(preset: StarPreset): void {
    typeId.value = preset.typeId
    mode.value = 'sandbox'
    const next = presetStats(preset)
    copyStats(inputs, next)
    ageFraction.value = 0
    useWindStore().setParams(preset.wind)
  }

  function syncInputsFromStats(): void {
    copyStats(inputs, stats.value)
  }

  function setMode(value: ConstraintMode): void {
    if (value === 'free') {
      // Enter the sandbox with currently consistent values, then let the user
      // break them explicitly.
      syncInputsFromStats()
    }
    mode.value = value
  }

  function setMass(mass: number): void {
    inputs.mass = mass
  }

  function setRadius(radius: number): void {
    if (mode.value === 'model') return
    inputs.radius = radius
  }

  function setTemperature(temperature: number): void {
    if (mode.value === 'model') return
    inputs.temperature = temperature
  }

  function setDensity(density: number): void {
    if (mode.value !== 'free') return
    inputs.density = density
  }

  function setLuminosity(luminosity: number): void {
    if (mode.value !== 'free') return
    inputs.luminosity = luminosity
  }

  function setMagneticField(magneticField: number): void {
    inputs.magneticField = magneticField
  }

  function setAgeFraction(fraction: number): void {
    ageFraction.value = Math.min(1, Math.max(0, fraction))
  }

  function reset(): void {
    applyDefaults()
  }

  return {
    typeId,
    mode,
    ageFraction,
    inputs,
    type,
    ranges,
    windRanges,
    canAge,
    radiusUnit,
    metresPerSceneUnit,
    isLinked,
    stats,
    consistency,
    solarMass,
    solarRadius,
    solarLuminosity,
    color,
    colorHex,
    setType,
    applyPreset,
    setMode,
    setMass,
    setRadius,
    setTemperature,
    setDensity,
    setLuminosity,
    setMagneticField,
    setAgeFraction,
    reset,
  }
})
