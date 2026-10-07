<script setup lang="ts">
import StarCanvas from '@/components/StarCanvas.vue'
import ControlPanel from '@/components/ControlPanel.vue'
import StarTypeSelector from '@/components/StarTypeSelector.vue'
import ViewModeToggle from '@/components/ViewModeToggle.vue'
import { useViewStore } from '@/stores/view'

const view = useViewStore()
</script>

<template>
  <div class="app">
    <main class="stage">
      <StarCanvas />
      <div class="hud">
        <StarTypeSelector />
        <ViewModeToggle />
        <span class="renderer">{{ view.backend ?? 'initializing…' }} · {{ view.fps }} fps</span>
      </div>
    </main>
    <aside class="panel">
      <ControlPanel />
    </aside>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  margin: 0;
  height: 100%;
  background: #05060c;
  color: #e7ecf5;
}

body {
  overflow: hidden;
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100%;
  width: 100%;
}

.stage {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.hud {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
  pointer-events: none;
}

.hud :deep(*) {
  pointer-events: auto;
}

.renderer {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7f8aa3;
}

.panel {
  flex: 0 0 340px;
  border-left: 1px solid #1a2036;
  background: #080b14;
  overflow-y: auto;
}

@media (max-width: 860px) {
  .app {
    flex-direction: column;
  }

  .panel {
    flex: 0 0 45%;
    border-left: none;
    border-top: 1px solid #1a2036;
  }
}
</style>
