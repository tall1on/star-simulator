import type { StarStats, StarType, StarTypeId } from '@/types/star'
import { SOLAR_LUMINOSITY, SOLAR_MASS, SOLAR_RADIUS } from '@/physics/relations'

const SUN: StarStats = {
  mass: SOLAR_MASS,
  radius: SOLAR_RADIUS,
  density: 1.408e3,
  luminosity: SOLAR_LUMINOSITY,
  temperature: 5772,
  magneticField: 1,
}

const NEUTRON_STAR: StarStats = {
  mass: 1.4 * SOLAR_MASS,
  radius: 11_000,
  density: 4.99e17,
  luminosity: 1.1e25,
  temperature: 6e5,
  magneticField: 1e12,
}

export const STAR_TYPES: Record<StarTypeId, StarType> = {
  'main-sequence': {
    id: 'main-sequence',
    name: 'Main-sequence star',
    description:
      'A hydrogen-fusing star like the Sun. In Model mode, radius, temperature and luminosity all follow from the mass. Ages over its main-sequence lifetime, swelling and reddening as it exhausts its core hydrogen.',
    canAge: true,
    radiusUnit: 'solarRadius',
    surface: 'sphere',
    metresPerSceneUnit: SOLAR_RADIUS,
    defaults: SUN,
    defaultWind: {
      speed: 400,
      massLossRate: 2e-14,
      rotationPeriod: 25,
      tilt: 7,
    },
    windRanges: {
      speed: [1, 3000],
      massLossRate: [1e-16, 1e-4],
      rotationPeriod: [0.05, 5000],
      tilt: [0, 90],
    },
    ranges: {
      mass: [0.08 * SOLAR_MASS, 300 * SOLAR_MASS],
      radius: [0.05 * SOLAR_RADIUS, 2000 * SOLAR_RADIUS],
      density: [1e-8, 1e8],
      luminosity: [1e-6 * SOLAR_LUMINOSITY, 1e7 * SOLAR_LUMINOSITY],
      temperature: [2000, 55_000],
      magneticField: [1e-2, 1e4],
    },
  },
  'neutron-star': {
    id: 'neutron-star',
    name: 'Neutron star',
    description:
      'The collapsed core of a massive star: roughly 1.4 solar masses packed into a ~11 km radius. Extremely dense, hot and strongly magnetised (magnetar territory at the high end). Radius and temperature are observational inputs; luminosity follows from the blackbody relation. Does not age in this model.',
    canAge: false,
    radiusUnit: 'kilometre',
    surface: 'lensed',
    metresPerSceneUnit: 10_000,
    defaults: NEUTRON_STAR,
    defaultWind: {
      speed: 1500,
      massLossRate: 1e-15,
      rotationPeriod: 2e-8,
      tilt: 20,
    },
    windRanges: {
      speed: [500, 20000],
      massLossRate: [1e-20, 1e-12],
      rotationPeriod: [1e-8, 10],
      tilt: [0, 90],
    },
    ranges: {
      mass: [1.1 * SOLAR_MASS, 2.5 * SOLAR_MASS],
      radius: [8_000, 15_000],
      density: [1e17, 1e19],
      luminosity: [1e18, 1e28],
      temperature: [1e5, 3e6],
      magneticField: [1e8, 5e15],
    },
  },
}

export const STAR_TYPE_LIST: StarType[] = [STAR_TYPES['main-sequence'], STAR_TYPES['neutron-star']]

export function getStarType(id: StarTypeId): StarType {
  return STAR_TYPES[id]
}
