import { onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ambienceParameters } from '@/audio/ambienceModel'
import { createStarAmbience, type StarAmbience } from '@/audio/createStarAmbience'
import { spotActivityModel } from '@/physics/activity'
import { useAudioStore } from '@/stores/audio'
import { useStarStore } from '@/stores/star'
import { useSunspotStore } from '@/stores/sunspots'
import { useWindStore } from '@/stores/wind'

/**
 * App-level integration for the optional star ambience. The audio graph is
 * created lazily on the first enable (a user gesture), kept out of Vue
 * reactivity, and updated from store state rather than the render loop. It is
 * suspended while the tab is hidden and disposed on unmount.
 */
export function useStarAmbience(): void {
  const audio = useAudioStore()
  const star = useStarStore()
  const wind = useWindStore()
  const sunspots = useSunspotStore()

  const { enabled, volume, muted, dynamics } = storeToRefs(audio)
  const { stats, typeId } = storeToRefs(star)
  const { params: windParams } = storeToRefs(wind)

  let engine: StarAmbience | null = null

  function buildParameters(): ReturnType<typeof ambienceParameters> {
    const rotationPeriodDays = Math.max(windParams.value.rotationPeriod, 1e-9)
    const model = spotActivityModel(stats.value, typeId.value, rotationPeriodDays, sunspots.cyclePhase)
    const activity = model.supported
      ? sunspots.autoActivity
        ? model.relativeActivity
        : sunspots.activity
      : 0
    return ambienceParameters({
      stats: stats.value,
      typeId: typeId.value,
      rotationPeriodDays,
      activity,
      dynamics: dynamics.value,
    })
  }

  function syncParameters(): void {
    engine?.update(buildParameters())
  }

  async function start(): Promise<void> {
    if (!engine) {
      try {
        engine = createStarAmbience()
      } catch {
        audio.setStatus('unavailable')
        audio.setEnabled(false)
        return
      }
    }
    engine.setVolume(volume.value)
    engine.setMuted(muted.value)
    engine.update(buildParameters())
    try {
      await engine.resume()
      audio.setStatus(engine.state === 'running' ? 'running' : 'suspended')
    } catch {
      audio.setStatus('unavailable')
    }
  }

  function stop(): void {
    if (!engine) return
    audio.setStatus('suspended')
    void engine.suspend().catch(() => undefined)
  }

  function onVisibilityChange(): void {
    if (!engine || !enabled.value) return
    if (document.hidden) {
      void engine.suspend().catch(() => undefined)
    } else {
      void engine
        .resume()
        .then(() => audio.setStatus('running'))
        .catch(() => audio.setStatus('suspended'))
    }
  }

  watch(enabled, (value) => {
    if (value) void start()
    else stop()
  })

  watch(
    [
      stats,
      typeId,
      () => windParams.value.rotationPeriod,
      () => sunspots.cyclePhase,
      () => sunspots.autoActivity,
      () => sunspots.activity,
      dynamics,
    ],
    syncParameters,
  )

  watch([volume, muted], () => {
    if (!engine) return
    engine.setVolume(volume.value)
    engine.setMuted(muted.value)
  })

  document.addEventListener('visibilitychange', onVisibilityChange)

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    engine?.dispose()
    engine = null
  })
}
