import { ref } from 'vue'
import { defineStore } from 'pinia'
import { clamp } from '@/physics/relations'

export type AudioStatus = 'idle' | 'running' | 'suspended' | 'unavailable'

const STORAGE_KEY = 'star-simulator.audio'

interface PersistedAudio {
  volume?: number
  dynamics?: number
}

function loadPersisted(): PersistedAudio {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const record = parsed as Record<string, unknown>
    const volume = typeof record['volume'] === 'number' ? record['volume'] : undefined
    const dynamics = typeof record['dynamics'] === 'number' ? record['dynamics'] : undefined
    return { volume, dynamics }
  } catch {
    return {}
  }
}

/**
 * Controls for the optional star ambience. The audio graph itself lives outside
 * Vue reactivity (owned by the app-level composable), so only user controls and
 * a small status flag pass through the store. Off by default and startable only
 * through an explicit user gesture, so it never fights browser autoplay policy.
 */
export const useAudioStore = defineStore('audio', () => {
  const saved = loadPersisted()

  const enabled = ref(false)
  const muted = ref(false)
  const volume = ref(clamp(saved.volume ?? 0.35, 0, 1))
  /** Character: 0 = calm, 1 = dynamic. */
  const dynamics = ref(clamp(saved.dynamics ?? 0.35, 0, 1))
  const status = ref<AudioStatus>('idle')

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: volume.value, dynamics: dynamics.value }))
    } catch {
      // Storage unavailable (private mode); preferences simply don't persist.
    }
  }

  function setEnabled(value: boolean): void {
    enabled.value = value
  }

  function toggleEnabled(): void {
    enabled.value = !enabled.value
  }

  function setMuted(value: boolean): void {
    muted.value = value
  }

  function toggleMuted(): void {
    muted.value = !muted.value
  }

  function setVolume(value: number): void {
    volume.value = clamp(value, 0, 1)
    persist()
  }

  function setDynamics(value: number): void {
    dynamics.value = clamp(value, 0, 1)
    persist()
  }

  function setStatus(value: AudioStatus): void {
    status.value = value
  }

  return {
    enabled,
    muted,
    volume,
    dynamics,
    status,
    setEnabled,
    toggleEnabled,
    setMuted,
    toggleMuted,
    setVolume,
    setDynamics,
    setStatus,
  }
})
