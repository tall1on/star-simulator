import { ref } from 'vue'
import { defineStore } from 'pinia'
import { clamp } from '@/physics/relations'

/**
 * Controls and summaries for the evolving sunspot simulation.
 *
 * The evolving spot data itself lives in the plain `SunspotSimulation` runtime
 * owned by the canvas, so per-frame arrays never pass through Vue reactivity.
 * Only the controls and two throttled summary values live here.
 */
export const useSunspotStore = defineStore('sunspots', () => {
  const enabled = ref(true)
  const running = ref(true)
  /** Activity level 0…1, scaling emergence rate and spot size. */
  const activity = ref(0.6)
  /** Simulated days advanced per real second. */
  const speedDaysPerSecond = ref(1)

  /** Summary values, updated a few times a second by the canvas. */
  const spotCount = ref(0)
  const elapsedDays = ref(0)
  /** Bumped to ask the canvas runtime to reset. */
  const resetRequestId = ref(0)

  function setEnabled(value: boolean): void {
    enabled.value = value
  }

  function setRunning(value: boolean): void {
    running.value = value
  }

  function toggleRunning(): void {
    running.value = !running.value
  }

  function setActivity(value: number): void {
    activity.value = clamp(value, 0, 1)
  }

  function setSpeed(value: number): void {
    speedDaysPerSecond.value = Math.max(value, 1e-3)
  }

  function reset(): void {
    resetRequestId.value += 1
    spotCount.value = 0
    elapsedDays.value = 0
  }

  function report(count: number, days: number): void {
    spotCount.value = count
    elapsedDays.value = days
  }

  return {
    enabled,
    running,
    activity,
    speedDaysPerSecond,
    spotCount,
    elapsedDays,
    resetRequestId,
    setEnabled,
    setRunning,
    toggleRunning,
    setActivity,
    setSpeed,
    reset,
    report,
  }
})
