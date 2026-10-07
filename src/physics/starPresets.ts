import type { StarStats, StarTypeId, WindParameters } from '@/types/star'
import {
  SOLAR_MASS,
  SOLAR_RADIUS,
  densityFromMassRadius,
  luminosityFromRadiusTemperature,
} from '@/physics/relations'

export type PresetCategory = 'main-sequence' | 'giant' | 'supergiant' | 'compact'

export interface StarPreset {
  id: string
  name: string
  category: PresetCategory
  typeId: StarTypeId
  /** Short factual note shown when the preset is selected. */
  note: string
  /** Mass in kg. */
  mass: number
  /** Radius in metres. */
  radius: number
  /** Effective temperature in kelvin. */
  temperature: number
  /** Surface magnetic field in gauss. */
  magneticField: number
  wind: WindParameters
}

const M = SOLAR_MASS
const R = SOLAR_RADIUS

/**
 * Well-known real stars. Mass, radius and effective temperature are the defining
 * observational inputs; density and luminosity are derived consistently
 * (ρ = 3M/4πR³, L = 4πR²σT⁴), so a preset always lands in a self-consistent
 * Sandbox state.
 */
export const STAR_PRESETS: StarPreset[] = [
  // --- Main sequence ---------------------------------------------------------
  {
    id: 'sun',
    name: 'Sun (Sol)',
    category: 'main-sequence',
    typeId: 'main-sequence',
    note: 'G2V. The reference star: 1 M☉, 1 R☉, 5772 K, ~1 G dipole field.',
    mass: 1 * M,
    radius: 1 * R,
    temperature: 5772,
    magneticField: 1,
    wind: { speed: 400, massLossRate: 2e-14, rotationPeriod: 25, tilt: 7 },
  },
  {
    id: 'proxima',
    name: 'Proxima Centauri',
    category: 'main-sequence',
    typeId: 'main-sequence',
    note: 'M5.5Ve red dwarf, the nearest star. 0.12 M☉, 0.15 R☉, 3042 K, very active.',
    mass: 0.122 * M,
    radius: 0.154 * R,
    temperature: 3042,
    magneticField: 600,
    wind: { speed: 1000, massLossRate: 1e-15, rotationPeriod: 83, tilt: 20 },
  },
  {
    id: 'barnard',
    name: "Barnard's Star",
    category: 'main-sequence',
    typeId: 'main-sequence',
    note: 'M4V red dwarf, one of the fastest-moving stars. 0.14 M☉, 0.20 R☉.',
    mass: 0.144 * M,
    radius: 0.196 * R,
    temperature: 3134,
    magneticField: 100,
    wind: { speed: 800, massLossRate: 5e-16, rotationPeriod: 130, tilt: 15 },
  },
  {
    id: 'alpha-cen-a',
    name: 'Alpha Centauri A',
    category: 'main-sequence',
    typeId: 'main-sequence',
    note: 'G2V, the Sun’s near-twin. 1.1 M☉, 1.22 R☉, 5790 K.',
    mass: 1.1 * M,
    radius: 1.22 * R,
    temperature: 5790,
    magneticField: 5,
    wind: { speed: 450, massLossRate: 3e-14, rotationPeriod: 22, tilt: 10 },
  },
  {
    id: 'sirius-a',
    name: 'Sirius A',
    category: 'main-sequence',
    typeId: 'main-sequence',
    note: 'A1V, the brightest night-sky star. 2.06 M☉, 1.71 R☉, 9940 K.',
    mass: 2.06 * M,
    radius: 1.71 * R,
    temperature: 9940,
    magneticField: 100,
    wind: { speed: 1000, massLossRate: 1e-13, rotationPeriod: 5, tilt: 10 },
  },
  {
    id: 'altair',
    name: 'Altair',
    category: 'main-sequence',
    typeId: 'main-sequence',
    note: 'A7V, famous for its rapid ~9 h rotation — a strongly oblate star.',
    mass: 1.86 * M,
    radius: 1.79 * R,
    temperature: 7550,
    magneticField: 100,
    wind: { speed: 800, massLossRate: 1e-14, rotationPeriod: 0.37, tilt: 10 },
  },
  {
    id: 'vega',
    name: 'Vega',
    category: 'main-sequence',
    typeId: 'main-sequence',
    note: 'A0V, the photometric standard. 2.14 M☉, 2.36 R☉, 9602 K.',
    mass: 2.135 * M,
    radius: 2.362 * R,
    temperature: 9602,
    magneticField: 100,
    wind: { speed: 900, massLossRate: 3e-14, rotationPeriod: 0.5, tilt: 5 },
  },
  {
    id: 'r136a1',
    name: 'R136a1',
    category: 'main-sequence',
    typeId: 'main-sequence',
    note: 'The most massive known star (~215 M☉). Wolf–Rayet, 46 000 K, intense wind.',
    mass: 215 * M,
    radius: 30.9 * R,
    temperature: 46_000,
    magneticField: 1000,
    wind: { speed: 2500, massLossRate: 1e-4, rotationPeriod: 3, tilt: 20 },
  },

  // --- Giants -----------------------------------------------------------------
  {
    id: 'arcturus',
    name: 'Arcturus',
    category: 'giant',
    typeId: 'main-sequence',
    note: 'K1.5III red giant. 1.08 M☉, 25 R☉, 4286 K — large convection cells.',
    mass: 1.08 * M,
    radius: 25.4 * R,
    temperature: 4286,
    magneticField: 1,
    wind: { speed: 40, massLossRate: 1e-9, rotationPeriod: 700, tilt: 20 },
  },
  {
    id: 'aldebaran',
    name: 'Aldebaran',
    category: 'giant',
    typeId: 'main-sequence',
    note: 'K5III red giant, the eye of Taurus. 1.16 M☉, 45 R☉, 3900 K.',
    mass: 1.16 * M,
    radius: 45.1 * R,
    temperature: 3900,
    magneticField: 1,
    wind: { speed: 30, massLossRate: 1e-8, rotationPeriod: 520, tilt: 20 },
  },

  // --- Supergiants ------------------------------------------------------------
  {
    id: 'polaris',
    name: 'Polaris',
    category: 'supergiant',
    typeId: 'main-sequence',
    note: 'F7Ib Cepheid, the North Star. 5.4 M☉, 46 R☉, 6015 K.',
    mass: 5.4 * M,
    radius: 46 * R,
    temperature: 6015,
    magneticField: 10,
    wind: { speed: 600, massLossRate: 1e-7, rotationPeriod: 400, tilt: 15 },
  },
  {
    id: 'rigel',
    name: 'Rigel',
    category: 'supergiant',
    typeId: 'main-sequence',
    note: 'B8Ia blue supergiant. 21 M☉, 79 R☉, 12 100 K.',
    mass: 21 * M,
    radius: 78.9 * R,
    temperature: 12_100,
    magneticField: 50,
    wind: { speed: 1500, massLossRate: 1e-7, rotationPeriod: 15, tilt: 15 },
  },
  {
    id: 'deneb',
    name: 'Deneb',
    category: 'supergiant',
    typeId: 'main-sequence',
    note: 'A2Ia, one of the most luminous visible stars. 19 M☉, 203 R☉, 8525 K.',
    mass: 19 * M,
    radius: 203 * R,
    temperature: 8525,
    magneticField: 30,
    wind: { speed: 2000, massLossRate: 1e-6, rotationPeriod: 60, tilt: 20 },
  },
  {
    id: 'antares',
    name: 'Antares',
    category: 'supergiant',
    typeId: 'main-sequence',
    note: 'M1.5Iab red supergiant, the heart of Scorpius. 12 M☉, 680 R☉, 3660 K.',
    mass: 12 * M,
    radius: 680 * R,
    temperature: 3660,
    magneticField: 3,
    wind: { speed: 20, massLossRate: 3e-7, rotationPeriod: 2000, tilt: 25 },
  },
  {
    id: 'betelgeuse',
    name: 'Betelgeuse',
    category: 'supergiant',
    typeId: 'main-sequence',
    note: 'M1-2Ia red supergiant. 16.5 M☉, 764 R☉, 3600 K — huge convection cells.',
    mass: 16.5 * M,
    radius: 764 * R,
    temperature: 3600,
    magneticField: 5,
    wind: { speed: 20, massLossRate: 1e-6, rotationPeriod: 3200, tilt: 25 },
  },
  {
    id: 'vy-cma',
    name: 'VY Canis Majoris',
    category: 'supergiant',
    typeId: 'main-sequence',
    note: 'M3-4.5 red hypergiant, one of the largest known stars. ~17 M☉, ~1420 R☉.',
    mass: 17 * M,
    radius: 1420 * R,
    temperature: 3490,
    magneticField: 2,
    wind: { speed: 25, massLossRate: 1e-4, rotationPeriod: 2000, tilt: 30 },
  },

  // --- Compact objects --------------------------------------------------------
  {
    id: 'crab-pulsar',
    name: 'Crab Pulsar',
    category: 'compact',
    typeId: 'neutron-star',
    note: 'PSR B0531+21, the Crab Nebula pulsar. 33 ms period, B ≈ 3.8×10¹² G.',
    mass: 1.4 * M,
    radius: 10_000,
    temperature: 1.6e6,
    magneticField: 3.8e12,
    wind: { speed: 1500, massLossRate: 1e-15, rotationPeriod: 3.83e-7, tilt: 20 },
  },
  {
    id: 'fastest-pulsar',
    name: 'PSR J1748−2446ad',
    category: 'compact',
    typeId: 'neutron-star',
    note: 'The fastest known pulsar, spinning 716 times a second (1.4 ms period).',
    mass: 1.4 * M,
    radius: 11_400,
    temperature: 1e6,
    magneticField: 1e8,
    wind: { speed: 2000, massLossRate: 1e-16, rotationPeriod: 1.616e-8, tilt: 15 },
  },
  {
    id: 'magnetar',
    name: 'SGR 1806−20',
    category: 'compact',
    typeId: 'neutron-star',
    note: 'Magnetar with an extreme ~2×10¹⁵ G field; its twisted magnetosphere flares.',
    mass: 1.4 * M,
    radius: 10_000,
    temperature: 1e6,
    magneticField: 2e15,
    wind: { speed: 1500, massLossRate: 1e-15, rotationPeriod: 8.75e-5, tilt: 30 },
  },
]

/** Derive a self-consistent stats object for a preset. */
export function presetStats(preset: StarPreset): StarStats {
  return {
    mass: preset.mass,
    radius: preset.radius,
    density: densityFromMassRadius(preset.mass, preset.radius),
    luminosity: luminosityFromRadiusTemperature(preset.radius, preset.temperature),
    temperature: preset.temperature,
    magneticField: preset.magneticField,
  }
}

const CATEGORY_LABELS: Record<PresetCategory, string> = {
  'main-sequence': 'Main sequence',
  giant: 'Giants',
  supergiant: 'Supergiants',
  compact: 'Compact objects',
}

export interface PresetGroup {
  category: PresetCategory
  label: string
  presets: StarPreset[]
}

export function presetGroups(): PresetGroup[] {
  const order: PresetCategory[] = ['main-sequence', 'giant', 'supergiant', 'compact']
  return order
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      presets: STAR_PRESETS.filter((preset) => preset.category === category),
    }))
    .filter((group) => group.presets.length > 0)
}

export function getPreset(id: string): StarPreset | undefined {
  return STAR_PRESETS.find((preset) => preset.id === id)
}
