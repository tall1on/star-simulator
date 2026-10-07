import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ViewMode } from '@/types/star'
import type { RendererBackend } from '@/render/createRenderer'
import type { ToneMappingKind } from '@/render/postprocessing'

export const useViewStore = defineStore('view', () => {
  const mode = ref<ViewMode>('filter')

  const showFieldLines = ref(true)
  const showCorona = ref(true)
  const showParticleFlow = ref(true)
  const showStarfield = ref(true)
  const showPulsar = ref(true)

  const bloomEnabled = ref(true)
  const bloomStrength = ref(0.6)
  const lensFlareEnabled = ref(true)

  const autoExposure = ref(true)
  const exposureCompensation = ref(0)
  const toneMapping = ref<ToneMappingKind>('agx')

  const backend = ref<RendererBackend | null>(null)
  const zoom = ref(3)
  const sceneRadius = ref(1)
  const fps = ref(0)
  const fitRequestId = ref(0)

  const isReal = computed(() => mode.value === 'real')

  function setMode(value: ViewMode): void {
    mode.value = value
  }

  function toggleMode(): void {
    mode.value = mode.value === 'real' ? 'filter' : 'real'
  }

  function setShowFieldLines(value: boolean): void {
    showFieldLines.value = value
  }

  function toggleFieldLines(): void {
    showFieldLines.value = !showFieldLines.value
  }

  function setShowCorona(value: boolean): void {
    showCorona.value = value
  }

  function setShowParticleFlow(value: boolean): void {
    showParticleFlow.value = value
  }

  function setShowStarfield(value: boolean): void {
    showStarfield.value = value
  }

  function setShowPulsar(value: boolean): void {
    showPulsar.value = value
  }

  function setAutoExposure(value: boolean): void {
    autoExposure.value = value
  }

  function setExposureCompensation(value: number): void {
    exposureCompensation.value = value
  }

  function setToneMapping(value: ToneMappingKind): void {
    toneMapping.value = value
  }

  function setBloomEnabled(value: boolean): void {
    bloomEnabled.value = value
  }

  function setBloomStrength(value: number): void {
    bloomStrength.value = value
  }

  function setLensFlareEnabled(value: boolean): void {
    lensFlareEnabled.value = value
  }

  function setBackend(value: RendererBackend): void {
    backend.value = value
  }

  function setZoom(distance: number): void {
    zoom.value = distance
  }

  function setSceneRadius(radius: number): void {
    sceneRadius.value = radius
  }

  function setFps(value: number): void {
    fps.value = value
  }

  /** Request that the camera frame the star. Consumed by the canvas. */
  function requestFit(): void {
    fitRequestId.value += 1
  }

  return {
    mode,
    showFieldLines,
    showCorona,
    showParticleFlow,
    showStarfield,
    showPulsar,
    bloomEnabled,
    bloomStrength,
    lensFlareEnabled,
    autoExposure,
    exposureCompensation,
    toneMapping,
    backend,
    zoom,
    sceneRadius,
    fps,
    fitRequestId,
    isReal,
    setMode,
    toggleMode,
    setShowFieldLines,
    toggleFieldLines,
    setShowCorona,
    setShowParticleFlow,
    setShowStarfield,
    setShowPulsar,
    setBloomEnabled,
    setBloomStrength,
    setLensFlareEnabled,
    setAutoExposure,
    setExposureCompensation,
    setToneMapping,
    setBackend,
    setZoom,
    setSceneRadius,
    setFps,
    requestFit,
  }
})
