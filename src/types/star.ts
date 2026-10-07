export type StarTypeId = 'main-sequence' | 'neutron-star'

export type ViewMode = 'real' | 'filter'

/** How the photosphere is rendered. */
export type SurfaceKind = 'sphere' | 'lensed'

/**
 * How strictly the physical relations constrain the editable properties.
 *
 * - `model`   – stellar-model view: only mass and age (plus magnetic field)
 *               are inputs; radius, temperature and luminosity follow from the
 *               mass–luminosity, mass–radius and Stefan–Boltzmann relations.
 * - `sandbox` – mass, radius and temperature are inputs; density and
 *               luminosity are derived from ρ = 3M/4πR³ and L = 4πR²σT⁴.
 * - `free`    – every property is independently editable ("what if?" mode).
 *               Consistency violations are reported rather than enforced.
 */
export type ConstraintMode = 'model' | 'sandbox' | 'free'

/** Unit used to present and edit the radius for a given star type. */
export type RadiusUnit = 'solarRadius' | 'kilometre'

/**
 * Physical state of a star. All values are SI (metres, kilograms, watts,
 * kelvin, kg/m³) unless noted.
 */
export interface StarStats {
  /** Mass in kilograms. */
  mass: number
  /** Radius in metres. */
  radius: number
  /** Mean density in kg/m^3. */
  density: number
  /** Bolometric luminosity in watts. */
  luminosity: number
  /** Effective surface temperature in kelvin. */
  temperature: number
  /** Surface magnetic field strength in gauss. */
  magneticField: number
}

/** User-editable physical inputs before the solver applies constraints. */
export interface StarInputs {
  mass: number
  radius: number
  density: number
  temperature: number
  luminosity: number
  magneticField: number
}

/** Parameters of the star's own stellar wind. */
export interface WindParameters {
  /** Wind speed in km/s. */
  speed: number
  /** Mass-loss rate in solar masses per year. */
  massLossRate: number
  /** Rotation period in days. */
  rotationPeriod: number
  /** Dipole tilt in degrees (0 = aligned with the rotation axis). */
  tilt: number
}

/** Reported when `free` mode allows physically inconsistent combinations. */
export interface ConsistencyReport {
  densityConsistent: boolean
  luminosityConsistent: boolean
  expectedDensity: number
  expectedLuminosity: number
}

/** Inclusive [min, max] range used to drive UI sliders. */
export type Range = readonly [number, number]

export interface StarRanges {
  mass: Range
  radius: Range
  density: Range
  luminosity: Range
  temperature: Range
  magneticField: Range
}

export interface WindRanges {
  speed: Range
  massLossRate: Range
  rotationPeriod: Range
  tilt: Range
}

export interface StarType {
  id: StarTypeId
  name: string
  description: string
  /** Neutron stars are treated as stable end states and do not age. */
  canAge: boolean
  /** Photosphere rendering mode (spherical vs. relativistically lensed disc). */
  surface: SurfaceKind
  /** Unit used for the radius slider. */
  radiusUnit: RadiusUnit
  /**
   * Metres represented by one scene unit when rendering this star type. Chosen
   * per type so that each star's default radius maps to ~1 scene unit, keeping
   * the camera and depth range well-conditioned across the huge scale gap.
   */
  metresPerSceneUnit: number
  defaults: StarStats
  defaultWind: WindParameters
  windRanges: WindRanges
  ranges: StarRanges
}
