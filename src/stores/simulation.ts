import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useStarStore } from '@/stores/star'
import { ageFractionFor } from '@/physics/evolution'
import { mainSequenceLifetimeYears } from '@/physics/relations'

/** Real seconds it takes to traverse a full main-sequence lifetime at 1x speed. */
const SECONDS_PER_LIFETIME = 30

export const useSimulationStore = defineStore('simulation', () => {
  const star = useStarStore()

  const ageYears = ref(0)
  const timeScale = ref(1)
  const running = ref(false)

  const lifetimeYears = computed(() => mainSequenceLifetimeYears(star.inputs.mass))
  const ageFraction = computed(() => ageFractionFor({ ...star.stats, mass: star.inputs.mass }, ageYears.value))
  const canAge = computed(() => star.canAge)

  function advance(deltaSeconds: number): void {
    if (!running.value || !star.canAge) return

    const yearsPerSecond = lifetimeYears.value / SECONDS_PER_LIFETIME
    ageYears.value += deltaSeconds * yearsPerSecond * timeScale.value

    if (ageYears.value >= lifetimeYears.value) {
      ageYears.value = lifetimeYears.value
      running.value = false
    }

    star.setAgeFraction(ageFraction.value)
  }

  function start(): void {
    if (star.canAge) running.value = true
  }

  function stop(): void {
    running.value = false
  }

  function toggle(): void {
    if (!star.canAge) return
    running.value = !running.value
  }

  function reset(): void {
    ageYears.value = 0
    running.value = false
    star.setAgeFraction(0)
  }

  function setTimeScale(value: number): void {
    timeScale.value = value
  }

  return {
    ageYears,
    timeScale,
    running,
    lifetimeYears,
    ageFraction,
    canAge,
    advance,
    start,
    stop,
    toggle,
    reset,
    setTimeScale,
  }
})
