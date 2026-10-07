<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { STAR_TYPE_LIST } from '@/physics/starTypes'
import { useStarStore } from '@/stores/star'
import { useSimulationStore } from '@/stores/simulation'

const star = useStarStore()
const simulation = useSimulationStore()
const { typeId } = storeToRefs(star)

function select(id: (typeof STAR_TYPE_LIST)[number]['id']): void {
  star.setType(id)
  simulation.reset()
}
</script>

<template>
  <div class="selector">
    <button
      v-for="option in STAR_TYPE_LIST"
      :key="option.id"
      type="button"
      class="option"
      :class="{ active: option.id === typeId }"
      :title="option.description"
      @click="select(option.id)"
    >
      {{ option.name }}
    </button>
  </div>
</template>

<style scoped>
.selector {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(10, 14, 26, 0.75);
  border: 1px solid #1a2036;
  backdrop-filter: blur(8px);
}

.option {
  border: none;
  border-radius: 7px;
  padding: 7px 12px;
  font-size: 13px;
  color: #97a3bc;
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.option:hover {
  color: #dce4f2;
}

.option.active {
  background: #1d2b52;
  color: #ffffff;
}
</style>
