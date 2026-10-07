<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useViewStore } from '@/stores/view'
import type { ViewMode } from '@/types/star'

const view = useViewStore()
const { mode } = storeToRefs(view)

const options: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'real', label: 'Real', hint: 'Physically based luminosity — bright stars blow out' },
  { id: 'filter', label: 'Filter', hint: 'Neutral-density filter so surface detail stays visible' },
]

function select(id: ViewMode): void {
  view.setMode(id)
}
</script>

<template>
  <div class="toggle">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="option"
      :class="{ active: option.id === mode }"
      :title="option.hint"
      @click="select(option.id)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.toggle {
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
  padding: 7px 14px;
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
  background: #4a3a12;
  color: #ffd98a;
}
</style>
