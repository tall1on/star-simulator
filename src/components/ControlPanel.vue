<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AudioControls from '@/components/AudioControls.vue'
import { useStarStore } from '@/stores/star'
import { useSimulationStore } from '@/stores/simulation'
import { useSunspotStore } from '@/stores/sunspots'
import { useViewStore } from '@/stores/view'
import { useWindStore } from '@/stores/wind'
import { useMagnetosphereStore } from '@/stores/magnetosphere'
import type { ConstraintMode } from '@/types/star'
import type { ToneMappingKind } from '@/render/postprocessing'
import { rotationShape } from '@/physics/rotation'
import { surfaceModel } from '@/physics/surface'
import { estimateSunspotNumber, expectedSpotCounts, spotActivityModel } from '@/physics/activity'
import { getPreset, presetGroups, presetStats } from '@/physics/starPresets'
import {
  ASTRONOMICAL_UNIT,
  densityFromMassRadius,
  SOLAR_LUMINOSITY,
  SOLAR_MASS,
  SOLAR_RADIUS,
  toSolarLuminosity,
} from '@/physics/relations'

const star = useStarStore()
const simulation = useSimulationStore()
const view = useViewStore()
const wind = useWindStore()
const sunspots = useSunspotStore()
const magnetosphere = useMagnetosphereStore()

const { stats, ranges, canAge, consistency, metresPerSceneUnit } = storeToRefs(star)
const { running, timeScale } = storeToRefs(simulation)
const { params: windParams } = storeToRefs(wind)

const presetGroupList = presetGroups()
const selectedPresetId = ref('')
const currentPreset = computed(() => (selectedPresetId.value ? getPreset(selectedPresetId.value) : undefined))

function selectPreset(id: string): void {
  const preset = getPreset(id)
  if (!preset) {
    selectedPresetId.value = ''
    return
  }
  star.applyPreset(preset)
  simulation.reset()
  selectedPresetId.value = preset.id
}

function onPresetChange(event: Event): void {
  const target = event.target
  if (target instanceof HTMLSelectElement) selectPreset(target.value)
}

// Drop back to "Custom" as soon as the values no longer match the preset.
watch(
  stats,
  (value) => {
    const preset = selectedPresetId.value ? getPreset(selectedPresetId.value) : undefined
    if (!preset) return
    const expected = presetStats(preset)
    const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a))
    const matches =
      same(expected.mass, value.mass) &&
      same(expected.radius, value.radius) &&
      same(expected.temperature, value.temperature) &&
      same(expected.magneticField, value.magneticField) &&
      same(expected.luminosity, value.luminosity) &&
      same(expected.density, value.density)
    if (!matches) selectedPresetId.value = ''
  },
  { deep: true },
)

function log10(value: number): number {
  return Math.log10(Math.max(value, Number.MIN_VALUE))
}

const modeOptions: { id: ConstraintMode; label: string; hint: string }[] = [
  { id: 'model', label: 'Model', hint: 'Radius, temperature and luminosity follow from mass & age' },
  { id: 'sandbox', label: 'Sandbox', hint: 'Set mass, radius and temperature; density & luminosity are derived' },
  { id: 'free', label: 'Free', hint: 'Every property is independently editable; inconsistencies are flagged' },
]

const toneOptions: { id: ToneMappingKind; label: string; hint: string }[] = [
  { id: 'agx', label: 'AgX', hint: 'Film-like; preserves hue in very bright saturated colours' },
  { id: 'neutral', label: 'Neutral', hint: 'Khronos PBR Neutral; accurate hues for bright sources' },
]

const canEditRadius = computed(() => star.mode !== 'model')
const canEditTemperature = computed(() => star.mode !== 'model')
const canEditLuminosity = computed(() => star.mode === 'free')
const canEditDensity = computed(() => star.mode === 'free')

// --- Mass / radius (unit aware) -------------------------------------------
const massSolar = computed({
  get: () => stats.value.mass / SOLAR_MASS,
  set: (value) => star.setMass(value * SOLAR_MASS),
})
const massRange = computed(() => [ranges.value.mass[0] / SOLAR_MASS, ranges.value.mass[1] / SOLAR_MASS])

const isKilometre = computed(() => star.radiusUnit === 'kilometre')
const radiusValue = computed({
  get: () => (isKilometre.value ? stats.value.radius / 1000 : stats.value.radius / SOLAR_RADIUS),
  set: (value) => star.setRadius(isKilometre.value ? value * 1000 : value * SOLAR_RADIUS),
})
const radiusRange = computed(() =>
  isKilometre.value
    ? [ranges.value.radius[0] / 1000, ranges.value.radius[1] / 1000]
    : [ranges.value.radius[0] / SOLAR_RADIUS, ranges.value.radius[1] / SOLAR_RADIUS],
)
const radiusStep = computed(() => (isKilometre.value ? 0.1 : 0.01))
const radiusUnitLabel = computed(() => (isKilometre.value ? 'km' : 'R☉'))

// --- Other physical sliders -------------------------------------------------
const temperatureLog = computed({
  get: () => log10(stats.value.temperature),
  set: (value) => star.setTemperature(10 ** value),
})
const temperatureRange = computed(() => [log10(ranges.value.temperature[0]), log10(ranges.value.temperature[1])])

const luminosityLog = computed({
  get: () => log10(toSolarLuminosity(stats.value.luminosity)),
  set: (value) => star.setLuminosity(10 ** value * SOLAR_LUMINOSITY),
})
const luminosityRange = computed(() => [
  log10(ranges.value.luminosity[0] / SOLAR_LUMINOSITY),
  log10(ranges.value.luminosity[1] / SOLAR_LUMINOSITY),
])

const densityLog = computed({
  get: () => log10(stats.value.density),
  set: (value) => star.setDensity(10 ** value),
})
const densityRange = computed(() => [log10(ranges.value.density[0]), log10(ranges.value.density[1])])

const magneticLog = computed({
  get: () => log10(stats.value.magneticField),
  set: (value) => star.setMagneticField(10 ** value),
})
const magneticRange = computed(() => [
  log10(ranges.value.magneticField[0]),
  log10(ranges.value.magneticField[1]),
])

// --- Wind sliders -----------------------------------------------------------
const windSpeed = computed({
  get: () => windParams.value.speed,
  set: (value) => wind.setSpeed(value),
})
const windSpeedRange = computed(() => star.windRanges.speed)

const windMassLossLog = computed({
  get: () => log10(windParams.value.massLossRate),
  set: (value) => wind.setMassLossRate(10 ** value),
})
const windMassLossRange = computed(() => [
  log10(star.windRanges.massLossRate[0]),
  log10(star.windRanges.massLossRate[1]),
])

const windRotationLog = computed({
  get: () => log10(windParams.value.rotationPeriod),
  set: (value) => wind.setRotationPeriod(10 ** value),
})
const windRotationRange = computed(() => [
  log10(star.windRanges.rotationPeriod[0]),
  log10(star.windRanges.rotationPeriod[1]),
])

const windTilt = computed({
  get: () => windParams.value.tilt,
  set: (value) => wind.setTilt(value),
})
const windTiltRange = computed(() => star.windRanges.tilt)

// --- Aging ------------------------------------------------------------------
const timeScaleLog = computed({
  get: () => log10(timeScale.value),
  set: (value) => simulation.setTimeScale(10 ** value),
})

// --- Sunspots ---------------------------------------------------------------
const activityModel = computed(() =>
  spotActivityModel(stats.value, star.typeId, windParams.value.rotationPeriod, sunspots.cyclePhase),
)
const sunspotsAvailable = computed(() => activityModel.value.supported)
const effectiveActivity = computed(() =>
  sunspots.autoActivity ? activityModel.value.relativeActivity : sunspots.activity,
)

const autoActivity = computed({
  get: () => sunspots.autoActivity,
  set: (value) => sunspots.setAutoActivity(value),
})

const cyclePhaseFraction = computed({
  get: () => sunspots.cyclePhase,
  set: (value) => sunspots.setCyclePhase(value),
})

const spotEstimate = computed(() => expectedSpotCounts(activityModel.value, effectiveActivity.value))
const spotNumberEstimate = computed(() => estimateSunspotNumber(activityModel.value, effectiveActivity.value))
const coverageDisplay = computed(() => `${(sunspots.coverage * 100).toFixed(2)}%`)

const sunspotActivity = computed({
  get: () => sunspots.activity,
  set: (value) => sunspots.setActivity(value),
})

const sunspotSpeedLog = computed({
  get: () => log10(sunspots.speedDaysPerSecond),
  set: (value) => sunspots.setSpeed(10 ** value),
})

const sunspotSpeedDisplay = computed(() => {
  const days = sunspots.speedDaysPerSecond
  return days >= 1 ? `${days.toFixed(1)} d/s` : `${(days * 24).toFixed(1)} h/s`
})

const sunspotElapsedDisplay = computed(() => {
  const days = sunspots.elapsedDays
  return days >= 365 ? `${(days / 365).toFixed(1)} yr` : `${days.toFixed(1)} d`
})

// --- Magnetic dynamics ------------------------------------------------------
const fieldEnabled = computed({
  get: () => magnetosphere.enabled,
  set: (value) => magnetosphere.setEnabled(value),
})

const fieldActivity = computed({
  get: () => magnetosphere.activity,
  set: (value) => magnetosphere.setActivity(value),
})

const fieldTimeScaleLog = computed({
  get: () => log10(magnetosphere.timeScaleDaysPerSecond),
  set: (value) => magnetosphere.setTimeScale(10 ** value),
})

const fieldTimeScaleDisplay = computed(() => {
  const days = magnetosphere.timeScaleDaysPerSecond
  return days >= 1 ? `${days.toFixed(1)} d/s` : `${(days * 24).toFixed(1)} h/s`
})

const maxTwistDegrees = computed(() => (magnetosphere.maxTwist * 180) / Math.PI)

const maxOpenWindingDegrees = computed(() => (magnetosphere.maxOpenWinding * 180) / Math.PI)

const fieldCrossingDisplay = computed(() => {
  const seconds = magnetosphere.alfvenCrossingSeconds
  if (!(seconds > 0)) return '—'
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`
  return `${(seconds / 86_400).toFixed(1)} d`
})

const fieldElapsedDisplay = computed(() => {
  const days = magnetosphere.elapsedDays
  return days >= 365 ? `${(days / 365).toFixed(1)} yr` : `${days.toFixed(1)} d`
})

const eventFocus = computed({
  get: () => magnetosphere.eventFocus,
  set: (value) => magnetosphere.setEventFocus(value),
})

const fieldConfinementDisplay = computed(() => {
  const metres = magnetosphere.confinementRadiusMetres
  const radius = stats.value.radius
  if (!(metres > 0) || !(radius > 0)) return '—'
  return `${(metres / radius).toFixed(1)} R★`
})

const fieldBetaDisplay = computed(() => magnetosphere.plasmaBeta.toExponential(1))

const fieldFreeEnergyDisplay = computed(() => `${magnetosphere.freeEnergy.toExponential(1)} J`)

const fieldReleasedEnergyDisplay = computed(() => `${magnetosphere.releasedEnergy.toExponential(1)} J`)

// --- Display helpers --------------------------------------------------------
const temperatureDisplay = computed(() => `${Math.round(stats.value.temperature).toLocaleString()} K`)
const densityDisplay = computed(() => `${stats.value.density.toExponential(2)} kg/m³`)
const luminosityDisplay = computed(() => `${toSolarLuminosity(stats.value.luminosity).toExponential(2)} L☉`)
const magneticDisplay = computed(() => `${stats.value.magneticField.toExponential(2)} G`)
const massLossDisplay = computed(() => `${windParams.value.massLossRate.toExponential(1)} M☉/yr`)
const rotationDisplay = computed(() => {
  const days = windParams.value.rotationPeriod
  const seconds = days * 86_400
  if (seconds < 0.001) return `${(seconds * 1e6).toFixed(0)} µs`
  if (seconds < 1) return `${(seconds * 1000).toFixed(2)} ms`
  if (days < 1) return `${(days * 24).toFixed(2)} h`
  return `${days.toFixed(2)} d`
})

const rotationInfo = computed(() =>
  rotationShape(windParams.value.rotationPeriod, densityFromMassRadius(stats.value.mass, stats.value.radius)),
)

const surfaceInfo = computed(() => surfaceModel(stats.value, star.typeId))

function formatYears(years: number): string {
  if (years >= 1e9) return `${(years / 1e9).toFixed(2)} Gyr`
  if (years >= 1e6) return `${(years / 1e6).toFixed(2)} Myr`
  return `${Math.round(years).toLocaleString()} yr`
}
const ageDisplay = computed(() => formatYears(simulation.ageYears))
const lifetimeDisplay = computed(() => formatYears(simulation.lifetimeYears))

function formatDistance(metres: number): string {
  if (metres >= 0.05 * ASTRONOMICAL_UNIT) return `${(metres / ASTRONOMICAL_UNIT).toFixed(3)} AU`
  return `${(metres / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`
}

const distanceRadii = computed(() => (view.sceneRadius > 0 ? view.zoom / view.sceneRadius : 0))
const altitudeDisplay = computed(() =>
  formatDistance(Math.max(view.zoom - view.sceneRadius, 0) * metresPerSceneUnit.value),
)

const showWarnings = computed(
  () => star.mode === 'free' && (!consistency.value.densityConsistent || !consistency.value.luminosityConsistent),
)

const exposureCompensation = computed({
  get: () => view.exposureCompensation,
  set: (value) => view.setExposureCompensation(value),
})

const isLensed = computed(() => star.type.surface === 'lensed')
</script>

<template>
  <div class="controls">
    <header>
      <h1>✦ Star Simulator</h1>
      <p>{{ star.type.description }}</p>
    </header>

    <section>
      <div class="section-head">
        <h2>Real star preset</h2>
      </div>
      <select class="preset-select" :value="selectedPresetId" @change="onPresetChange">
        <option value="">Custom</option>
        <optgroup v-for="group in presetGroupList" :key="group.category" :label="group.label">
          <option v-for="preset in group.presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
        </optgroup>
      </select>
      <p v-if="currentPreset" class="derived">{{ currentPreset.note }}</p>
    </section>

    <section>
      <div class="section-head">
        <h2>Constraint mode</h2>
      </div>
      <div class="segmented">
        <button
          v-for="option in modeOptions"
          :key="option.id"
          type="button"
          :class="{ active: option.id === star.mode }"
          :title="option.hint"
          @click="star.setMode(option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>Physical properties</h2>
        <span class="swatch" :style="{ background: star.colorHex }" />
      </div>

      <div class="field">
        <label for="mass">Mass</label>
        <output>{{ massSolar.toFixed(2) }} M☉</output>
        <input id="mass" v-model.number="massSolar" type="range" :min="massRange[0]" :max="massRange[1]" step="0.01" />
      </div>

      <div class="field" :class="{ disabled: !canEditRadius }">
        <label for="radius">Radius</label>
        <output>{{ radiusValue.toFixed(isKilometre ? 1 : 2) }} {{ radiusUnitLabel }}</output>
        <input
          id="radius"
          v-model.number="radiusValue"
          type="range"
          :min="radiusRange[0]"
          :max="radiusRange[1]"
          :step="radiusStep"
          :disabled="!canEditRadius"
        />
      </div>

      <div class="field" :class="{ disabled: !canEditTemperature }">
        <label for="temperature">Temperature</label>
        <output>{{ temperatureDisplay }}</output>
        <input
          id="temperature"
          v-model.number="temperatureLog"
          type="range"
          :min="temperatureRange[0]"
          :max="temperatureRange[1]"
          step="0.005"
          :disabled="!canEditTemperature"
        />
      </div>

      <div class="field" :class="{ disabled: !canEditLuminosity }">
        <label for="luminosity">Luminosity</label>
        <output>{{ luminosityDisplay }}</output>
        <input
          id="luminosity"
          v-model.number="luminosityLog"
          type="range"
          :min="luminosityRange[0]"
          :max="luminosityRange[1]"
          step="0.01"
          :disabled="!canEditLuminosity"
        />
      </div>

      <div class="field" :class="{ disabled: !canEditDensity }">
        <label for="density">Density</label>
        <output>{{ densityDisplay }}</output>
        <input
          id="density"
          v-model.number="densityLog"
          type="range"
          :min="densityRange[0]"
          :max="densityRange[1]"
          step="0.01"
          :disabled="!canEditDensity"
        />
      </div>

      <div class="field">
        <label for="magnetic">Magnetic field</label>
        <output>{{ magneticDisplay }}</output>
        <input
          id="magnetic"
          v-model.number="magneticLog"
          type="range"
          :min="magneticRange[0]"
          :max="magneticRange[1]"
          step="0.01"
        />
      </div>

      <p v-if="star.mode === 'model'" class="derived">
        Radius, temperature and luminosity are derived from mass
        <template v-if="canAge"> and age</template>.
      </p>
      <p v-else-if="star.mode === 'sandbox'" class="derived">
        Density ρ = 3M/4πR³ and luminosity L = 4πR²σT⁴ are derived.
      </p>

      <p class="derived">
        Photosphere: <strong>{{ surfaceInfo.regime }}</strong> convection · cell size ×{{
          surfaceInfo.relativeCellSize.toFixed(1)
        }} solar<template v-if="surfaceInfo.giantBlend > 0.5"> · broad cool regions</template>
      </p>

      <div v-if="showWarnings" class="warnings">
        <p v-if="!consistency.densityConsistent">
          ⚠ Density is inconsistent with mass and radius (expected
          {{ consistency.expectedDensity.toExponential(2) }} kg/m³).
        </p>
        <p v-if="!consistency.luminosityConsistent">
          ⚠ Luminosity is inconsistent with radius and temperature (expected
          {{ consistency.expectedLuminosity.toExponential(2) }} W).
        </p>
      </div>

      <p v-if="star.mode === 'free'" class="derived">
        Free mode can produce combinations outside this model's valid regime; surface structure and oblateness still use
        the gravity implied by mass and radius.
      </p>
    </section>

    <section>
      <div class="section-head">
        <h2>Stellar aging</h2>
        <span class="pill">{{ ageDisplay }}</span>
      </div>

      <template v-if="canAge">
        <div class="row">
          <button type="button" class="primary" @click="simulation.toggle()">
            {{ running ? 'Pause' : 'Age star' }}
          </button>
          <button type="button" @click="simulation.reset()">Reset age</button>
        </div>

        <div class="field">
          <label for="time">Time acceleration</label>
          <output>{{ timeScale.toFixed(2) }}×</output>
          <input id="time" v-model.number="timeScaleLog" type="range" min="-1" max="2" step="0.01" />
        </div>

        <div class="progress">
          <div class="bar" :style="{ width: `${(simulation.ageFraction * 100).toFixed(1)}%` }" />
        </div>
        <p class="derived">Main-sequence lifetime: <strong>{{ lifetimeDisplay }}</strong></p>
      </template>

      <p v-else class="derived">Neutron stars are stable end states and do not age in this model.</p>
    </section>

    <section>
      <div class="section-head">
        <h2>Stellar wind</h2>
        <button type="button" class="mini" @click="wind.setFromType(star.type)">Reset</button>
      </div>

      <div class="field">
        <label for="wind-speed">Wind speed</label>
        <output>{{ windSpeed.toFixed(0) }} km/s</output>
        <input
          id="wind-speed"
          v-model.number="windSpeed"
          type="range"
          :min="windSpeedRange[0]"
          :max="windSpeedRange[1]"
          step="10"
        />
      </div>

      <div class="field">
        <label for="wind-mass">Mass-loss rate</label>
        <output>{{ massLossDisplay }}</output>
        <input
          id="wind-mass"
          v-model.number="windMassLossLog"
          type="range"
          :min="windMassLossRange[0]"
          :max="windMassLossRange[1]"
          step="0.05"
        />
      </div>

      <div class="field">
        <label for="wind-rotation">Rotation period</label>
        <output>{{ rotationDisplay }}</output>
        <input
          id="wind-rotation"
          v-model.number="windRotationLog"
          type="range"
          :min="windRotationRange[0]"
          :max="windRotationRange[1]"
          step="0.02"
        />
      </div>

      <div class="field">
        <label for="wind-tilt">Magnetic tilt</label>
        <output>{{ windTilt.toFixed(0) }}°</output>
        <input
          id="wind-tilt"
          v-model.number="windTilt"
          type="range"
          :min="windTiltRange[0]"
          :max="windTiltRange[1]"
          step="1"
        />
      </div>

      <p class="derived">
        A faster wind straightens the open field lines; faster rotation winds them into a tighter Parker spiral.
      </p>
      <p class="derived">
        Oblateness f = <strong>{{ rotationInfo.flattening.toFixed(3) }}</strong> · rotation parameter q =
        <strong>{{ rotationInfo.rotationParameter.toFixed(3) }}</strong>. Low density and fast rotation flatten the star.
      </p>
      <p v-if="rotationInfo.atBreakup" class="derived warn">
        ⚠ At/above the mass-shedding limit — a real star would break up and shed material.
      </p>
    </section>

    <section>
      <div class="section-head">
        <h2>Magnetic dynamics</h2>
        <button type="button" class="mini" @click="magnetosphere.requestReset()">Reset</button>
      </div>

      <label class="check">
        <input type="checkbox" :checked="fieldEnabled" @change="fieldEnabled = !fieldEnabled" />
        Simulate field dynamics
      </label>

      <div class="row">
        <button type="button" :disabled="!fieldEnabled" @click="magnetosphere.toggleRunning()">
          {{ magnetosphere.running ? 'Pause field' : 'Resume field' }}
        </button>
      </div>

      <div class="field" :class="{ disabled: !fieldEnabled }">
        <label for="field-speed">Magnetic time</label>
        <output>{{ fieldTimeScaleDisplay }}</output>
        <input
          id="field-speed"
          v-model.number="fieldTimeScaleLog"
          type="range"
          min="-1"
          max="2"
          step="0.01"
          :disabled="!fieldEnabled"
        />
      </div>

      <div class="field" :class="{ disabled: !fieldEnabled }">
        <label for="field-activity">Activity</label>
        <output>{{ (fieldActivity * 100).toFixed(0) }}%</output>
        <input
          id="field-activity"
          v-model.number="fieldActivity"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :disabled="!fieldEnabled"
        />
      </div>

      <label class="check" :class="{ disabled: !fieldEnabled }">
        <input type="checkbox" :disabled="!fieldEnabled" :checked="eventFocus" @change="eventFocus = !eventFocus" />
        Slow time during events (event focus)
      </label>

      <p class="derived">
        Regime <strong>{{ magnetosphere.regime }}</strong> · {{ magnetosphere.regions }} regions /
        <strong>{{ magnetosphere.bundles }}</strong> bundles · max loop twist
        <strong>{{ maxTwistDegrees.toFixed(0) }}°</strong> · open winding
        <strong>{{ maxOpenWindingDegrees.toFixed(0) }}°</strong>
      </p>
      <p class="derived">
        Reconnections <strong>{{ magnetosphere.reconnections }}</strong> · flares
        <strong>{{ magnetosphere.flares }}</strong> · eruptions
        <strong>{{ magnetosphere.eruptions }}</strong> · ejecta in flight
        <strong>{{ magnetosphere.activeEjecta }}</strong>
      </p>
      <p class="derived">
        p<sub>B</sub> <strong>{{ magnetosphere.magneticPressure.toExponential(1) }} Pa</strong> · wind ram
        <strong>{{ magnetosphere.windRamPressure.toExponential(1) }} Pa</strong> · β
        <strong>{{ fieldBetaDisplay }}</strong> · confinement <strong>{{ fieldConfinementDisplay }}</strong> · Alfvén crossing
        <strong>{{ fieldCrossingDisplay }}</strong>
      </p>
      <p class="derived">
        Free magnetic energy <strong>{{ fieldFreeEnergyDisplay }}</strong> · released
        <strong>{{ fieldReleasedEnergyDisplay }}</strong>
      </p>
      <p v-if="magnetosphere.exceedsLightCylinder" class="derived warn">
        ⚠ Open field extends beyond the light cylinder; the closed-dipole picture is not valid there.
      </p>
      <p class="derived">
        Field time elapsed <strong>{{ fieldElapsedDisplay }}</strong>. Bipolar regions emerge, drift and decay; their loops
        shear, then reconnect — swapping connectivity, contracting in confined flares or flinging material out in
        eruptions. A stronger field raises the confinement radius, tension, energy and response speed.
      </p>
    </section>

    <section>
      <div class="section-head">
        <h2>Sunspots</h2>
        <button type="button" class="mini" :disabled="!sunspotsAvailable" @click="sunspots.reset()">Reset</button>
      </div>

      <template v-if="sunspotsAvailable">
        <label class="check">
          <input type="checkbox" :checked="sunspots.enabled" @change="sunspots.setEnabled(!sunspots.enabled)" />
          Simulate sunspots
        </label>

        <label class="check">
          <input
            type="checkbox"
            :checked="autoActivity"
            :disabled="!sunspots.enabled"
            @change="autoActivity = !autoActivity"
          />
          Auto activity (from rotation)
        </label>

        <div class="field" :class="{ disabled: !sunspots.enabled || autoActivity }">
          <label for="spot-activity">Activity</label>
          <output>{{ (effectiveActivity * 100).toFixed(0) }}%</output>
          <input
            id="spot-activity"
            v-model.number="sunspotActivity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :disabled="!sunspots.enabled || autoActivity"
          />
        </div>

        <div class="field" :class="{ disabled: !sunspots.enabled }">
          <label for="spot-cycle">Cycle phase</label>
          <output>{{ (sunspots.cyclePhase * 100).toFixed(0) }}%</output>
          <input
            id="spot-cycle"
            v-model.number="cyclePhaseFraction"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :disabled="!sunspots.enabled"
          />
        </div>

        <div class="field" :class="{ disabled: !sunspots.enabled }">
          <label for="spot-speed">Surface time</label>
          <output>{{ sunspotSpeedDisplay }}</output>
          <input
            id="spot-speed"
            v-model.number="sunspotSpeedLog"
            type="range"
            min="-1"
            max="2"
            step="0.01"
            :disabled="!sunspots.enabled"
          />
        </div>

        <div class="row">
          <button type="button" :disabled="!sunspots.enabled" @click="sunspots.toggleRunning()">
            {{ sunspots.running ? 'Pause drift' : 'Resume drift' }}
          </button>
        </div>

        <p class="derived">
          Regime <strong>{{ activityModel.regime }}</strong> · Rossby number Ro
          <strong>{{ activityModel.rossbyNumber.toFixed(2) }}</strong> · turnover
          <strong>{{ activityModel.turnoverDays.toFixed(1) }} d</strong>
        </p>
        <p class="derived">
          Active spots: <strong>{{ sunspots.spotCount }}</strong> · coverage
          <strong>{{ coverageDisplay }}</strong> · est. sunspot number R ≈
          <strong>{{ Math.round(spotNumberEstimate) }}</strong> ({{
            Math.round(spotEstimate.groups)
          }}
          groups / {{ Math.round(spotEstimate.spots) }} spots)
        </p>
        <p class="derived">
          Surface time elapsed <strong>{{ sunspotElapsedDisplay }}</strong>. Spots emerge in the active-latitude belt,
          drift with latitude-dependent rotation and decay. Umbra/penumbra temperature follows the photosphere — a
          solar-calibrated approximation, separate from stellar aging.
        </p>
      </template>

      <p v-else class="derived">
        No solar-type spots: this photosphere is too hot (or too compact) for the granulation and spot model.
      </p>
    </section>

    <section>
      <div class="section-head">
        <h2>View</h2>
        <button type="button" class="mini" @click="view.requestFit()">Fit star</button>
      </div>

      <label class="check">
        <input type="checkbox" :checked="view.showFieldLines" @change="view.toggleFieldLines()" />
        Magnetic field lines
      </label>
      <label class="check">
        <input
          type="checkbox"
          :checked="view.showParticleFlow"
          @change="view.setShowParticleFlow(!view.showParticleFlow)"
        />
        Plasma flow particles
      </label>
      <label class="check">
        <input type="checkbox" :checked="view.showCorona" @change="view.setShowCorona(!view.showCorona)" />
        Corona glow
      </label>
      <label class="check">
        <input type="checkbox" :checked="view.bloomEnabled" @change="view.setBloomEnabled(!view.bloomEnabled)" />
        HDR bloom
      </label>
      <label class="check">
        <input
          type="checkbox"
          :checked="view.lensFlareEnabled"
          @change="view.setLensFlareEnabled(!view.lensFlareEnabled)"
        />
        Lens flare
      </label>
      <label class="check">
        <input type="checkbox" :checked="view.showStarfield" @change="view.setShowStarfield(!view.showStarfield)" />
        Starfield / Milky Way
      </label>
      <label class="check" :class="{ disabled: !isLensed }">
        <input
          type="checkbox"
          :checked="view.showPulsar"
          :disabled="!isLensed"
          @change="view.setShowPulsar(!view.showPulsar)"
        />
        Pulsar particle jet
      </label>

      <div class="field" :class="{ disabled: !view.autoExposure }">
        <label>Auto-exposure</label>
        <label class="link inline">
          <input
            type="checkbox"
            :checked="view.autoExposure"
            @change="view.setAutoExposure(!view.autoExposure)"
          />
          eye adaptation
        </label>
        <input
          v-model.number="exposureCompensation"
          type="range"
          min="-4"
          max="4"
          step="0.1"
        />
      </div>

      <div class="field">
        <label>Tone mapping</label>
        <output>{{ view.toneMapping }}</output>
        <div class="segmented slim">
          <button
            v-for="option in toneOptions"
            :key="option.id"
            type="button"
            :class="{ active: option.id === view.toneMapping }"
            :title="option.hint"
            @click="view.setToneMapping(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="field">
        <label for="bloom">Bloom strength</label>
        <output>{{ view.bloomStrength.toFixed(2) }}</output>
        <input
          id="bloom"
          :value="view.bloomStrength"
          type="range"
          min="0"
          max="2"
          step="0.01"
          @input="view.setBloomStrength(Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <p class="derived">
        Orbit: <strong>{{ distanceRadii.toFixed(2) }} R★</strong> · altitude
        <strong>{{ altitudeDisplay }}</strong>. Scroll to zoom, drag to orbit.
      </p>
    </section>

    <AudioControls />
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 20px;
}

header h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.02em;
}

header p {
  margin: 8px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: #7f8aa3;
}

section {
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

.swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid #2a3350;
}

.segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: #101627;
  border: 1px solid #1a2036;
}

.segmented button {
  flex: 1;
  border: none;
  border-radius: 7px;
  padding: 7px 6px;
  font-size: 12.5px;
  color: #97a3bc;
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.segmented button.active {
  background: #1d2b52;
  color: #ffffff;
}

.preset-select {
  width: 100%;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid #232b45;
  background: #101627;
  color: #dce4f2;
  font-size: 13px;
}

.preset-select optgroup {
  color: #7f8aa3;
}

.preset-select option {
  color: #dce4f2;
  background: #101627;
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
}

.field input[type='range'] {
  grid-column: 1 / -1;
  width: 100%;
  accent-color: #5b8cff;
}

.field input[type='range']:disabled {
  accent-color: #3a4568;
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

.check.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.segmented.slim {
  grid-column: 1 / -1;
}

.segmented.slim button {
  padding: 6px 4px;
  font-size: 12px;
}

.link.inline {
  justify-self: end;
  font-size: 12px;
}

.row {
  display: flex;
  gap: 8px;
}

button {
  border: 1px solid #232b45;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13px;
  color: #cdd6e8;
  background: #101627;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.row button {
  flex: 1;
}

button:hover {
  border-color: #3a4568;
  background: #16203a;
}

button.primary {
  border-color: #2f56b8;
  background: #1d2b52;
  color: #ffffff;
}

button.mini {
  padding: 4px 10px;
  font-size: 11.5px;
  border-radius: 6px;
}

.pill {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  background: #101627;
  color: #9aa5bd;
  font-variant-numeric: tabular-nums;
}

.progress {
  height: 6px;
  border-radius: 999px;
  background: #101627;
  overflow: hidden;
}

.bar {
  height: 100%;
  background: linear-gradient(90deg, #5b8cff, #ffd98a);
  transition: width 120ms linear;
}

.derived {
  margin: 0;
  font-size: 12.5px;
  color: #7f8aa3;
  line-height: 1.5;
}

.derived strong {
  color: #dce4f2;
  font-variant-numeric: tabular-nums;
}

.derived.warn {
  color: #f0c98a;
}

.warnings {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border-radius: 8px;
  background: #2a1e12;
  border: 1px solid #6b4a1f;
}

.warnings p {
  margin: 0;
  font-size: 12px;
  color: #f0c98a;
  line-height: 1.45;
}
</style>
