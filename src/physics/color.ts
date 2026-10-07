/**
 * Physically-based blackbody colour from the Planckian locus.
 *
 * Pipeline: Planck spectral radiance B(λ, T) → CIE 1931 XYZ via the Wyman,
 * Sloan & Shirley (2013) multi-lobe colour-matching fits → linear sRGB →
 * hue-only normalisation (largest channel set to 1).
 */

/** CODATA Planck constant, J·s. */
const PLANCK_H = 6.62607015e-34
/** CODATA speed of light in vacuum, m·s⁻¹. */
const SPEED_OF_LIGHT = 2.99792458e8
/** CODATA Boltzmann constant, J·K⁻¹. */
const BOLTZMANN_K = 1.380649e-23

/** Visible integration range, nanometres. */
const LAMBDA_MIN_NM = 380
const LAMBDA_MAX_NM = 780
/** Integration step, nanometres. */
const LAMBDA_STEP_NM = 5

/** Supported blackbody temperature range, kelvin. */
const MIN_TEMPERATURE = 1000
const MAX_TEMPERATURE = 40_000

type LinearRGB = [number, number, number]
type XYZ = [number, number, number]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Piecewise-Gaussian lobe: σ = σ1 for λ < μ, else σ2. */
function gaussian(wavelength: number, mu: number, sigma1: number, sigma2: number): number {
  const sigma = wavelength < mu ? sigma1 : sigma2
  const t = (wavelength - mu) / sigma
  return Math.exp(-0.5 * t * t)
}

// CIE 1931 CMF: Wyman, Sloan & Shirley 2013 multi-lobe fit.
function cmfX(wavelength: number): number {
  return (
    1.056 * gaussian(wavelength, 599.8, 37.9, 31.0) +
    0.362 * gaussian(wavelength, 442.0, 16.0, 26.7) -
    0.065 * gaussian(wavelength, 501.1, 20.4, 26.2)
  )
}

function cmfY(wavelength: number): number {
  return (
    0.821 * gaussian(wavelength, 568.8, 46.9, 40.5) +
    0.286 * gaussian(wavelength, 530.9, 16.3, 31.1)
  )
}

function cmfZ(wavelength: number): number {
  return (
    1.217 * gaussian(wavelength, 437.0, 11.8, 36.0) +
    0.681 * gaussian(wavelength, 459.0, 26.0, 13.8)
  )
}

/** Planck spectral radiance B(λ, T) = (2hc²/λ⁵) / (exp(hc/(λkT)) − 1), W·m⁻³·sr⁻¹. */
function planckRadiance(wavelengthMetres: number, temperature: number): number {
  const numerator = (2 * PLANCK_H * SPEED_OF_LIGHT ** 2) / wavelengthMetres ** 5
  const exponent = (PLANCK_H * SPEED_OF_LIGHT) / (wavelengthMetres * BOLTZMANN_K * temperature)
  return numerator / (Math.exp(exponent) - 1)
}

/** Clamp to the physical range and round so the cache is deterministic. */
function temperatureKey(temperature: number): number {
  return Math.round(clamp(temperature, MIN_TEMPERATURE, MAX_TEMPERATURE))
}

const xyzCache = new Map<number, XYZ>()

/** Integrate the blackbody spectrum against the CMFs: X = Σ B·x̄, etc. */
function integratedXYZ(key: number): XYZ {
  const cached = xyzCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  let x = 0
  let y = 0
  let z = 0
  for (let nm = LAMBDA_MIN_NM; nm <= LAMBDA_MAX_NM; nm += LAMBDA_STEP_NM) {
    const radiance = planckRadiance(nm * 1e-9, key)
    x += radiance * cmfX(nm)
    y += radiance * cmfY(nm)
    z += radiance * cmfZ(nm)
  }

  const xyz: XYZ = [x, y, z]
  xyzCache.set(key, xyz)
  return xyz
}

/**
 * Linear-sRGB colour of a blackbody at `temperature`, hue-only: each channel is
 * clamped to ≥ 0 and the largest channel is scaled to 1. Temperature is clamped
 * to [1000, 40000] K.
 */
export function blackbodyLinearRGB(temperature: number): LinearRGB {
  const [x, y, z] = integratedXYZ(temperatureKey(temperature))

  // XYZ → linear sRGB (sRGB / D65 matrix).
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z
  const b = 0.0557 * x - 0.204 * y + 1.057 * z

  const max = Math.max(r, g, b, 0)
  if (max <= 0) {
    return [0, 0, 0]
  }

  return [Math.max(r, 0) / max, Math.max(g, 0) / max, Math.max(b, 0) / max]
}

/** Compatibility alias for {@link blackbodyLinearRGB}. */
export function blackbodyColor(temperature: number): LinearRGB {
  return blackbodyLinearRGB(temperature)
}

/** CIE 1931 xy chromaticity of the Planckian locus at `temperature`. */
export function blackbodyChromaticity(temperature: number): { x: number; y: number } {
  const [x, y, z] = integratedXYZ(temperatureKey(temperature))
  const sum = x + y + z
  if (sum <= 0) {
    return { x: 0, y: 0 }
  }
  return { x: x / sum, y: y / sum }
}

/** sRGB electro-optical transfer function (encoded → linear). */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** Inverse of {@link srgbToLinear} (linear → encoded sRGB). */
export function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
}
