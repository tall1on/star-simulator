<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three/webgpu'
import { createRenderer, type RendererHandle } from '@/render/createRenderer'
import { createStar } from '@/render/starMesh'
import { createMagneticField } from '@/render/magneticField'
import { createPulsar } from '@/render/pulsar'
import { createStarfield } from '@/render/starfield'
import { createPostprocessing, type Postprocessing } from '@/render/postprocessing'
import { AutoExposure, targetExposure } from '@/render/exposure'
import { OrbitCameraController } from '@/render/camera'
import { clamp, densityFromMassRadius } from '@/physics/relations'
import { rotationShape } from '@/physics/rotation'
import { surfaceModel } from '@/physics/surface'
import { spotActivityModel } from '@/physics/activity'
import { SunspotSimulation } from '@/simulation/sunspotSimulation'
import { useStarStore } from '@/stores/star'
import { useSimulationStore } from '@/stores/simulation'
import { useSunspotStore } from '@/stores/sunspots'
import { useViewStore } from '@/stores/view'
import { useWindStore } from '@/stores/wind'
import { useMagnetosphereStore } from '@/stores/magnetosphere'
import { magnetosphereRegime } from '@/physics/magnetosphere'
import type { SunspotRenderData } from '@/types/sunspots'

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const star = useStarStore()
const simulation = useSimulationStore()
const view = useViewStore()
const wind = useWindStore()
const sunspots = useSunspotStore()
const magnetosphere = useMagnetosphereStore()

const { stats, metresPerSceneUnit, typeId, canAge } = storeToRefs(star)
const {
  mode,
  showFieldLines,
  showCorona,
  showParticleFlow,
  showStarfield,
  showPulsar,
  bloomEnabled,
  bloomStrength,
  lensFlareEnabled,
} = storeToRefs(view)
const { params: windParams } = storeToRefs(wind)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x04050a)

let handle: RendererHandle | null = null
let controls: OrbitCameraController | null = null
let starObject: ReturnType<typeof createStar> | null = null
let field: ReturnType<typeof createMagneticField> | null = null
let pulsar: ReturnType<typeof createPulsar> | null = null
let starfield: ReturnType<typeof createStarfield> | null = null
let post: Postprocessing | null = null
let disconnectResize: (() => void) | null = null

const autoExposure = new AutoExposure(0.7)

const sunspotSimulation = new SunspotSimulation()
const EMPTY_SUNSPOTS: readonly SunspotRenderData[] = []

let rafId = 0
let lastTime = 0
let fpsAccumulator = 0
let fpsFrames = 0
let sunspotReportAccumulator = 0
let fieldReportAccumulator = 0
let sunspotsCleared = false
let contextMenuHandler: ((event: Event) => void) | null = null

function currentSceneRadius(): number {
  return stats.value.radius / metresPerSceneUnit.value
}

function applyStats(): void {
  if (!starObject) return
  starObject.applyStats(stats.value, mode.value)
}

function syncScene(): void {
  const radius = currentSceneRadius()
  starObject?.setSceneRadius(radius)
  field?.setSceneRadius(radius)
  pulsar?.group.scale.setScalar(radius)
  controls?.setStarRadius(radius)
  view.setSceneRadius(radius)
}

function syncField(): void {
  if (!field) return
  field.configure({
    enabled: magnetosphere.enabled,
    running: magnetosphere.running,
    timeScaleDaysPerSecond: magnetosphere.timeScaleDaysPerSecond,
    fieldStrength: stats.value.magneticField,
    windSpeed: windParams.value.speed,
    massLossRate: windParams.value.massLossRate,
    rotationPeriod: windParams.value.rotationPeriod,
    tilt: windParams.value.tilt,
    radius: stats.value.radius,
    temperature: stats.value.temperature,
    typeId: typeId.value,
    activity: magnetosphere.activity,
    regime: magnetosphereRegime(typeId.value, stats.value.temperature),
    eventFocus: magnetosphere.eventFocus,
  })
}

function syncPulsar(): void {
  if (!pulsar) return
  const strength = clamp((Math.log10(Math.max(stats.value.magneticField, 1)) - 6) / 9, 0, 1)
  pulsar.setEmission({
    tiltDeg: windParams.value.tilt,
    rotationPeriodDays: windParams.value.rotationPeriod,
    strength,
  })
  pulsar.setVisible(star.type.surface === 'lensed' && showPulsar.value)
}

function applyKind(): void {
  starObject?.setKind(star.type.surface)
  syncPulsar()
}

function syncSurface(): void {
  // Oblateness uses the density implied by mass & radius, so the unrestricted
  // density slider can never override the gravity the geometry actually has.
  const impliedDensity = densityFromMassRadius(stats.value.mass, stats.value.radius)
  starObject?.setOblateness(rotationShape(windParams.value.rotationPeriod, impliedDensity).flattening)
  starObject?.setSurfaceModel(surfaceModel(stats.value, typeId.value))
  starObject?.setConvectionRate(currentConvectionRate())
}

/**
 * Scene-time angular rate of the convective pattern: the star's equatorial
 * rotation, sped up by the sunspot surface-time multiplier, so granulation
 * drifts in step with the evolving spots.
 */
function currentConvectionRate(): number {
  const periodDays = Math.max(windParams.value.rotationPeriod, 1e-3)
  return (2 * Math.PI * sunspots.speedDaysPerSecond) / periodDays
}

function currentActivityModel(): ReturnType<typeof spotActivityModel> {
  return spotActivityModel(stats.value, typeId.value, windParams.value.rotationPeriod, sunspots.cyclePhase)
}

function syncSunspotConfig(): void {
  const model = currentActivityModel()
  const activity = sunspots.autoActivity ? model.relativeActivity : sunspots.activity
  sunspotSimulation.configure({
    enabled: sunspots.enabled,
    running: sunspots.running,
    activity,
    speedDaysPerSecond: sunspots.speedDaysPerSecond,
    rotationPeriodDays: windParams.value.rotationPeriod,
    radius: stats.value.radius,
    temperature: stats.value.temperature,
    supported: model.supported,
    regionsPerDayAtMax: model.regionsPerDayAtMax,
    meanSpotsPerRegion: model.meanSpotsPerRegion,
    maxSpotAreaFraction: model.maxSpotAreaFraction,
    beltCenterLatitude: model.belt.center,
    beltHalfWidth: model.belt.halfWidth,
  })
}

function updateSunspots(delta: number): void {
  sunspotSimulation.step(delta)

  if (sunspots.enabled) {
    sunspotsCleared = false
    const renderData = sunspotSimulation.render()
    starObject?.setSunspots(renderData, sunspotSimulation.surfaceCoverage)
  } else if (!sunspotsCleared) {
    sunspotsCleared = true
    starObject?.setSunspots(EMPTY_SUNSPOTS, 0)
  }

  sunspotReportAccumulator += delta
  if (sunspotReportAccumulator >= 0.25) {
    sunspotReportAccumulator = 0
    sunspots.report(
      sunspotSimulation.spotCount,
      sunspotSimulation.elapsedDays,
      sunspotSimulation.surfaceCoverage,
    )
  }
}

function updateExposure(delta: number): void {
  if (!post) return
  if (view.autoExposure) {
    const radius = currentSceneRadius()
    const distance = controls?.getDistance() ?? radius * 3
    const fill = distance > 0 ? radius / distance : 0
    post.setExposure(autoExposure.update(targetExposure(stats.value, mode.value, fill, view.exposureCompensation), delta))
  } else {
    const manual = 2 ** view.exposureCompensation
    autoExposure.reset(manual)
    post.setExposure(manual)
  }
}

function frame(time: number): void {
  rafId = requestAnimationFrame(frame)

  const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0
  lastTime = time

  if (simulation.running && canAge.value) {
    simulation.advance(delta)
    applyStats()
  }

  controls?.update(delta)
  if (starObject && controls) starObject.update(controls.camera)
  if (starfield && controls) starfield.update(controls.camera)
  field?.update(delta)
  if (controls) pulsar?.update(delta, controls.camera)

  updateSunspots(delta)

  fieldReportAccumulator += delta
  if (fieldReportAccumulator >= 0.25) {
    fieldReportAccumulator = 0
    if (field) magnetosphere.report(field.diagnostics())
  }

  updateExposure(delta)

  post?.pipeline.render()

  fpsAccumulator += delta
  fpsFrames += 1
  if (fpsAccumulator >= 0.5) {
    view.setFps(Math.round(fpsFrames / fpsAccumulator))
    fpsAccumulator = 0
    fpsFrames = 0
  }
}

onMounted(async () => {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return

  handle = await createRenderer(canvas)
  view.setBackend(handle.backend)

  starObject = createStar()
  scene.add(starObject.group)

  field = createMagneticField()
  field.setVisible(showFieldLines.value)
  scene.add(field.group)

  pulsar = createPulsar()
  scene.add(pulsar.group)

  starfield = createStarfield()
  starfield.setVisible(showStarfield.value)
  scene.add(starfield.group)

  controls = new OrbitCameraController(canvas, {
    distance: view.zoom,
    autoRotate: true,
    onChange: (distance) => view.setZoom(distance),
  })
  contextMenuHandler = (event: Event) => event.preventDefault()
  canvas.addEventListener('contextmenu', contextMenuHandler)

  post = createPostprocessing(handle.renderer, scene, controls.camera)
  post.setBloomEnabled(bloomEnabled.value)
  post.setBloomStrength(bloomStrength.value)
  post.setLensFlareEnabled(lensFlareEnabled.value)
  post.setToneMapping(view.toneMapping)

  const resize = (): void => {
    const width = container.clientWidth
    const height = container.clientHeight
    if (!handle || !controls || width === 0 || height === 0) return
    handle.renderer.setSize(width, height, false)
    controls.resize(width, height)
    // The bloom/lens-flare nodes size themselves from the renderer each frame.
  }

  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  disconnectResize = () => observer.disconnect()

  applyKind()
  syncScene()
  applyStats()
  syncSurface()
  syncField()
  syncPulsar()
  syncSunspotConfig()
  starObject.setSunspots(EMPTY_SUNSPOTS, 0)
  controls.fitStar(currentSceneRadius())

  rafId = requestAnimationFrame(frame)
})

watch(stats, () => {
  applyStats()
  syncSurface()
  syncPulsar()
}, { deep: true })
watch(
  () => [stats.value.radius, stats.value.temperature],
  () => syncField(),
)
watch(
  () => stats.value.magneticField,
  () => syncField(),
)
watch(currentSceneRadius, () => syncScene())
watch(mode, () => applyStats())
watch(showFieldLines, (value) => field?.setVisible(value))
watch(showCorona, (value) => starObject?.setCoronaVisible(value))
watch(showParticleFlow, (value) => field?.setParticlesVisible(value))
watch(showStarfield, (value) => starfield?.setVisible(value))
watch(showPulsar, () => syncPulsar())
watch(bloomEnabled, (value) => post?.setBloomEnabled(value))
watch(bloomStrength, (value) => post?.setBloomStrength(value))
watch(lensFlareEnabled, (value) => post?.setLensFlareEnabled(value))
watch(() => view.toneMapping, (value) => post?.setToneMapping(value))
watch(() => view.fitRequestId, () => controls?.fitStar(currentSceneRadius()))
watch(
  () => [
    windParams.value.tilt,
    windParams.value.speed,
    windParams.value.rotationPeriod,
    windParams.value.massLossRate,
  ],
  () => {
    syncField()
    syncPulsar()
    syncSurface()
  },
)
watch(
  () => [
    sunspots.enabled,
    sunspots.running,
    sunspots.autoActivity,
    sunspots.activity,
    sunspots.cyclePhase,
    sunspots.speedDaysPerSecond,
    windParams.value.rotationPeriod,
    stats.value.radius,
    stats.value.temperature,
    typeId.value,
  ],
  () => {
    syncSunspotConfig()
    syncSurface()
  },
)
watch(
  () => sunspots.resetRequestId,
  () => {
    sunspotSimulation.reset()
    starObject?.setSunspots(EMPTY_SUNSPOTS, 0)
    sunspots.report(0, 0, 0)
  },
)
watch(typeId, () => {
  applyKind()
  syncScene()
  applyStats()
  syncSurface()
  syncField()
  syncPulsar()
  controls?.fitStar(currentSceneRadius())
})
watch(
  () => [
    magnetosphere.enabled,
    magnetosphere.running,
    magnetosphere.timeScaleDaysPerSecond,
    magnetosphere.activity,
    magnetosphere.eventFocus,
  ],
  () => syncField(),
)
watch(
  () => magnetosphere.resetRequestId,
  () => field?.reset(),
)

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  disconnectResize?.()
  if (contextMenuHandler) canvasRef.value?.removeEventListener('contextmenu', contextMenuHandler)
  controls?.dispose()
  post?.dispose()
  starfield?.dispose()
  pulsar?.dispose()
  field?.dispose()
  starObject?.dispose()
  if (handle) void handle.renderer.dispose()
})
</script>

<template>
  <div ref="containerRef" class="star-canvas">
    <canvas ref="canvasRef" />
  </div>
</template>

<style scoped>
.star-canvas {
  position: absolute;
  inset: 0;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}

canvas:active {
  cursor: grabbing;
}
</style>
