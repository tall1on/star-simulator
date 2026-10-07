import { ref } from 'vue'
import { defineStore } from 'pinia'
import { clamp } from '@/physics/relations'

/**
 * Controls and summaries for the evolving sunspot simulation.
 *
 * The evolving spot data itself lives in the plain `SunspotSimulation` runtime
 * owned by the canvas, so per-frame arrays never pass through Vue reactivity.
 * Only the controls and a few throttled summary values live here.
 *
 * `activity` is the manual emergence level, used when `autoActivity` is off.
 * When `autoActivity` is on the canvas derives the level from the star's
 * rotation via the Rossby-number activity model, so a faster rotator is more
 * spotted without the user touching the slider.
 */
export const useSunspotStore = defineStore('sunspots', () => {
  const enabled = ref(true)
  const running = ref(true)
  /** Derive activity from the star's rotation (Rossby number) instead of the slider. */
  const autoActivity = ref(true)
  /** Manual activity level 0…1, used when `autoActivity` is off. */
  const activity = ref(0.6)
  /** Position within the activity cycle 0…1 (0 = cycle start, 1 = cycle end). */
  const cyclePhase = ref(0.5)
  /** Simulated days advanced per real second. */
  const speedDaysPerSecond = ref(1)

  /** Summary values, updated a few times a second by the canvas. */
  const spotCount = ref(0)
  const elapsedDays = ref(0)
  /** Spotted fraction of the photosphere (umbra + penumbra). */
  const coverage = ref(0)
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

  function setAutoActivity(value: boolean): void {
    autoActivity.value = value
  }

  function setActivity(value: number): void {
    activity.value = clamp(value, 0, 1)
  }

  function setCyclePhase(value: number): void {
    cyclePhase.value = clamp(value, 0, 1)
  }

  function setSpeed(value: number): void {
    speedDaysPerSecond.value = Math.max(value, 1e-3)
  }

  function reset(): void {
    resetRequestId.value += 1
    spotCount.value = 0
    elapsedDays.value = 0
    coverage.value = 0
  }

  function report(count: number, days: number, covered: number): void {
    spotCount.value = count
    elapsedDays.value = days
    coverage.value = covered
  }

  return {
    enabled,
    running,
    autoActivity,
    activity,
    cyclePhase,
    speedDaysPerSecond,
    spotCount,
    elapsedDays,
    coverage,
    resetRequestId,
    setEnabled,
    setRunning,
    toggleRunning,
    setAutoActivity,
    setActivity,
    setCyclePhase,
    setSpeed,
    reset,
    report,
  }
})
