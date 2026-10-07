import { reactive } from 'vue'
import { defineStore } from 'pinia'
import type { StarType, WindParameters } from '@/types/star'
import { STAR_TYPES } from '@/physics/starTypes'

/**
 * Parameters of the star's own stellar wind. These drive the magnetic-field
 * topology (closed loops vs. open, wind-stretched field lines) and the plasma
 * outflow visualisation.
 */
export const useWindStore = defineStore('wind', () => {
  const params = reactive<WindParameters>({ ...STAR_TYPES['main-sequence'].defaultWind })

  function setFromType(type: StarType): void {
    const wind = type.defaultWind
    params.speed = wind.speed
    params.massLossRate = wind.massLossRate
    params.rotationPeriod = wind.rotationPeriod
    params.tilt = wind.tilt
  }

  function setSpeed(value: number): void {
    params.speed = value
  }

  function setMassLossRate(value: number): void {
    params.massLossRate = value
  }

  function setRotationPeriod(value: number): void {
    params.rotationPeriod = value
  }

  function setTilt(value: number): void {
    params.tilt = value
  }

  return { params, setFromType, setSpeed, setMassLossRate, setRotationPeriod, setTilt }
})
