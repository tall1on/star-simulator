import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { MagnetosphereDiagnostics, MagnetosphereRegime } from '@/types/magnetosphere'

/**
 * Controls and summaries for the magnetosphere simulation.
 *
 * The evolving field-line state lives in the plain `MagnetosphereSimulation`
 * owned by the canvas, so per-frame geometry never passes through Vue
 * reactivity. Only the controls and a few throttled diagnostics live here.
 * The magnetic clock is independent of stellar aging.
 */
export const useMagnetosphereStore = defineStore('magnetosphere', () => {
  const enabled = ref(true)
  const running = ref(true)
  /** Playback acceleration: simulated days advanced per real second. */
  const timeScaleDaysPerSecond = ref(1)
  /** Activity 0…1 driving active-region shear and compact shear events. */
  const activity = ref(0.6)

  const resetRequestId = ref(0)

  const maxTwist = ref(0)
  const maxOpenWinding = ref(0)
  const alfvenCrossingSeconds = ref(0)
  const lineCount = ref(0)
  const openLineCount = ref(0)
  const shearEvents = ref(0)
  const elapsedDays = ref(0)
  const regime = ref<MagnetosphereRegime>('convective')
  const differentialRotation = ref(true)
  const exceedsLightCylinder = ref(false)

  function setEnabled(value: boolean): void {
    enabled.value = value
  }

  function toggleRunning(): void {
    running.value = !running.value
  }

  function setTimeScale(daysPerSecond: number): void {
    timeScaleDaysPerSecond.value = daysPerSecond
  }

  function setActivity(value: number): void {
    activity.value = Math.min(1, Math.max(0, value))
  }

  /** Request a deterministic reset of the field-line state. Consumed by the canvas. */
  function requestReset(): void {
    resetRequestId.value += 1
  }

  function report(diagnostics: MagnetosphereDiagnostics): void {
    maxTwist.value = diagnostics.maxTwist
    maxOpenWinding.value = diagnostics.maxOpenWinding
    alfvenCrossingSeconds.value = diagnostics.alfvenCrossingSeconds
    lineCount.value = diagnostics.lineCount
    openLineCount.value = diagnostics.openLineCount
    shearEvents.value = diagnostics.shearEvents
    elapsedDays.value = diagnostics.elapsedDays
    regime.value = diagnostics.regime
    differentialRotation.value = diagnostics.differentialRotation
    exceedsLightCylinder.value = diagnostics.exceedsLightCylinder
  }

  return {
    enabled,
    running,
    timeScaleDaysPerSecond,
    activity,
    resetRequestId,
    maxTwist,
    maxOpenWinding,
    alfvenCrossingSeconds,
    lineCount,
    openLineCount,
    shearEvents,
    elapsedDays,
    regime,
    differentialRotation,
    exceedsLightCylinder,
    setEnabled,
    toggleRunning,
    setTimeScale,
    setActivity,
    requestReset,
    report,
  }
})
