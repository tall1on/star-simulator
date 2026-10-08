<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { ambienceParameters } from '@/audio/ambienceModel'
import { spotActivityModel } from '@/physics/activity'
import { useAudioStore } from '@/stores/audio'
import { useStarStore } from '@/stores/star'
import { useSunspotStore } from '@/stores/sunspots'
import { useWindStore } from '@/stores/wind'

const props = defineProps<{ compact?: boolean }>()

const audio = useAudioStore()
const star = useStarStore()
const wind = useWindStore()
const sunspots = useSunspotStore()

const { enabled, volume, dynamics, status } = storeToRefs(audio)
const { stats, typeId } = storeToRefs(star)
const { params: windParams } = storeToRefs(wind)

const params = computed(() => {
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
})

const volumePercent = computed(() => Math.round(volume.value * 100))

const statusLabel = computed(() => {
  switch (status.value) {
    case 'running':
      return 'playing'
    case 'suspended':
      return 'paused'
    case 'unavailable':
      return 'unavailable'
    default:
      return 'off'
  }
})

function toggle(): void {
  if (!enabled.value) audio.setMuted(false)
  audio.toggleEnabled()
}

function onVolume(event: Event): void {
  audio.setVolume(Number((event.target as HTMLInputElement).value))
}

function onCharacter(event: Event): void {
  audio.setDynamics(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <button
    v-if="props.compact"
    type="button"
    class="speaker"
    :class="{ on: enabled }"
    :title="enabled ? 'Disable star ambience' : 'Enable star ambience'"
    @click="toggle"
  >
    {{ enabled ? 'Sound on' : 'Sound off' }}
  </button>

  <section v-else class="audio">
    <div class="section-head">
      <h2>Star ambience</h2>
      <span class="pill">{{ statusLabel }}</span>
    </div>

    <label class="check">
      <input type="checkbox" :checked="enabled" @change="toggle" />
      Enable ambience
    </label>

    <div class="field" :class="{ disabled: !enabled }">
      <label for="audio-volume">Volume</label>
      <output>{{ volumePercent }}%</output>
      <input
        id="audio-volume"
        :value="volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :disabled="!enabled"
        @input="onVolume"
      />
    </div>

    <div class="field" :class="{ disabled: !enabled }">
      <label for="audio-character">Character</label>
      <output>{{ params.character }}</output>
      <input
        id="audio-character"
        :value="dynamics"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :disabled="!enabled"
        @input="onCharacter"
      />
    </div>

    <p class="derived">
      Profile: <strong>{{ params.regime }}</strong> · <strong>{{ params.character }}</strong>. Artistic sonification — pitch
      follows size, brightness follows temperature, pulse follows rotation. Faster spins and stronger fields add texture, not
      volume. (There is no real sound in space.)
    </p>
    <p v-if="status === 'unavailable'" class="derived warn">
      Audio could not start in this browser or was blocked by autoplay policy.
    </p>
  </section>
</template>

<style scoped>
.speaker {
  border: 1px solid #1a2036;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 13px;
  color: #97a3bc;
  background: rgba(10, 14, 26, 0.75);
  backdrop-filter: blur(8px);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.speaker:hover {
  color: #dce4f2;
  border-color: #3a4568;
}

.speaker.on {
  background: #1d2b52;
  border-color: #2f56b8;
  color: #ffffff;
}

.audio {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

h2 {
  margin: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6d7893;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #c3ccdd;
  cursor: pointer;
  user-select: none;
}

.field {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 8px;
}

.field.disabled {
  opacity: 0.45;
}

.field label {
  font-size: 13px;
  color: #c3ccdd;
}

.field output {
  font-size: 12.5px;
  color: #7f8aa3;
  font-variant-numeric: tabular-nums;
  text-transform: capitalize;
}

.field input[type='range'] {
  grid-column: 1 / -1;
  width: 100%;
  accent-color: #5b8cff;
}

.field input[type='range']:disabled {
  accent-color: #3a4568;
}

.pill {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  background: #101627;
  color: #9aa5bd;
}

.derived {
  margin: 0;
  font-size: 12.5px;
  color: #7f8aa3;
  line-height: 1.5;
}

.derived strong {
  color: #dce4f2;
  text-transform: capitalize;
}

.derived.warn {
  color: #f0c98a;
}
</style>
