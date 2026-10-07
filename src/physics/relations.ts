import type { StarStats } from '@/types/star'

export { blackbodyColor } from '@/physics/color'

/** Solar mass in kilograms. */
export const SOLAR_MASS = 1.98847e30
/** Solar radius in metres. */
export const SOLAR_RADIUS = 6.957e8
/** Solar bolometric luminosity in watts. */
export const SOLAR_LUMINOSITY = 3.828e26
/** Solar effective temperature in kelvin. */
export const SOLAR_TEMPERATURE = 5772
/** Stefan-Boltzmann constant, W·m^-2·K^-4. */
export const STEFAN_BOLTZMANN = 5.670374419e-8
/** Gravitational constant, m^3·kg^-1·s^-2. */
export const GRAVITATIONAL_CONSTANT = 6.6743e-11
/** Seconds in a Julian year. */
export const SECONDS_PER_YEAR = 3.15576e7
/** Seconds in a Julian day. */
export const SECONDS_PER_DAY = 86_400
/** Astronomical unit in metres. */
export const ASTRONOMICAL_UNIT = 1.495978707e11

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** ρ = 3M / (4πR³) — identical to M / (4/3 · π · R³). */
export function densityFromMassRadius(mass: number, radius: number): number {
  return mass / ((4 / 3) * Math.PI * radius ** 3)
}

export function massFromDensityRadius(density: number, radius: number): number {
  return density * (4 / 3) * Math.PI * radius ** 3
}

export function radiusFromMassDensity(mass: number, density: number): number {
  return Math.cbrt(mass / ((4 / 3) * Math.PI * density))
}

/** L = 4πR²σT⁴ */
export function luminosityFromRadiusTemperature(radius: number, temperature: number): number {
  return 4 * Math.PI * radius ** 2 * STEFAN_BOLTZMANN * temperature ** 4
}

export function temperatureFromLuminosityRadius(luminosity: number, radius: number): number {
  const denom = 4 * Math.PI * radius ** 2 * STEFAN_BOLTZMANN
  return (Math.max(luminosity, Number.EPSILON) / denom) ** 0.25
}

export function radiusFromLuminosityTemperature(luminosity: number, temperature: number): number {
  const denom = 4 * Math.PI * STEFAN_BOLTZMANN * temperature ** 4
  return Math.sqrt(Math.max(luminosity, Number.EPSILON) / denom)
}

/** Bolometric surface radiance of a blackbody: I = σT⁴ / π (W·m⁻²·sr⁻¹). */
export function surfaceRadiance(temperature: number): number {
  return (STEFAN_BOLTZMANN * temperature ** 4) / Math.PI
}

/** Observed flux from a point source: F = L / (4πd²) (W·m⁻²). */
export function apparentFlux(luminosity: number, distanceMetres: number): number {
  return luminosity / (4 * Math.PI * Math.max(distanceMetres, Number.EPSILON) ** 2)
}

/** Main-sequence mass-luminosity relation L ∝ M^3.5 (approximation). */
export function mainSequenceLuminosity(mass: number): number {
  return SOLAR_LUMINOSITY * (mass / SOLAR_MASS) ** 3.5
}

export function mainSequenceMassFromLuminosity(luminosity: number): number {
  return SOLAR_MASS * (Math.max(luminosity, Number.EPSILON) / SOLAR_LUMINOSITY) ** (1 / 3.5)
}

/**
 * Zero-age main-sequence mass–radius relation. R ∝ M^0.8 for M < M☉ and
 * R ∝ M^0.57 for M > M☉ (rough two-regime fit).
 */
export function mainSequenceRadius(mass: number): number {
  const m = mass / SOLAR_MASS
  const exponent = m < 1 ? 0.8 : 0.57
  return SOLAR_RADIUS * m ** exponent
}

/** Zero-age main-sequence effective temperature implied by L(M) and R(M). */
export function mainSequenceTemperature(mass: number): number {
  return temperatureFromLuminosityRadius(mainSequenceLuminosity(mass), mainSequenceRadius(mass))
}

/** Main-sequence lifetime t ≈ 10 Gyr · (M / M☉)^-2.5, returned in years. */
export function mainSequenceLifetimeYears(mass: number): number {
  return 1e10 * (mass / SOLAR_MASS) ** -2.5
}

export function surfaceGravity(mass: number, radius: number): number {
  return (GRAVITATIONAL_CONSTANT * mass) / radius ** 2
}

export function escapeVelocity(mass: number, radius: number): number {
  return Math.sqrt((2 * GRAVITATIONAL_CONSTANT * mass) / radius)
}

/** Schwarzschild radius r_s = 2GM/c², useful as a sanity bound for compact objects. */
export function schwarzschildRadius(mass: number): number {
  const C = 299_792_458
  return (2 * GRAVITATIONAL_CONSTANT * mass) / C ** 2
}

export function toSolarMass(kilograms: number): number {
  return kilograms / SOLAR_MASS
}

export function fromSolarMass(solarMasses: number): number {
  return solarMasses * SOLAR_MASS
}

export function toSolarRadius(metres: number): number {
  return metres / SOLAR_RADIUS
}

export function fromSolarRadius(solarRadii: number): number {
  return solarRadii * SOLAR_RADIUS
}

export function toSolarLuminosity(watts: number): number {
  return watts / SOLAR_LUMINOSITY
}

export function fromSolarLuminosity(solarLuminosities: number): number {
  return solarLuminosities * SOLAR_LUMINOSITY
}

/** Convert an exposure value expressed in photographic stops to a multiplier. */
export function stopsToExposure(stops: number): number {
  return 2 ** stops
}

/** Convert a multiplier to stops (log2). */
export function exposureToStops(exposure: number): number {
  return Math.log2(Math.max(exposure, Number.EPSILON))
}

/** Derive a stats object whose density is consistent with mass and radius. */
export function reconcile(stats: StarStats): StarStats {
  return { ...stats, density: densityFromMassRadius(stats.mass, stats.radius) }
}
