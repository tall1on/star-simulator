import type { StarStats, ViewMode } from '@/types/star'
import { clamp } from '@/physics/relations'
import { surfaceIntensityFor } from '@/render/starMesh'

/**
 * Target exposure for a metering-like auto-exposure. `fill` is the fraction of
 * the frame the star occupies (scene radius / camera distance), so zooming in
 * makes the camera reduce exposure, mirroring how a real camera meters a bright
 * subject that fills more of the frame.
 */
export function targetExposure(
  stats: StarStats,
  mode: ViewMode,
  fill: number,
  compensationStops: number,
): number {
  const brightness = surfaceIntensityFor(stats, mode)
  const compensation = 2 ** compensationStops
  const zoomTerm = clamp(1 / (0.5 + 1.1 * clamp(fill, 0, 2)), 0.5, 1.8)

  if (mode === 'real') {
    return clamp((1 / (1 + 0.15 * brightness)) * zoomTerm * compensation, 0.0005, 2)
  }
  return clamp((0.9 / (1 + 0.5 * brightness)) * zoomTerm * compensation, 0.02, 3)
}

/** Exponentially-smoothed exposure so changes look like eye adaptation. */
export class AutoExposure {
  private current = 1

  /** Time constant in seconds. */
  private readonly tau: number

  constructor(tau = 0.7) {
    this.tau = tau
  }

  get value(): number {
    return this.current
  }

  reset(value: number): void {
    this.current = value
  }

  update(target: number, deltaSeconds: number): number {
    const k = 1 - Math.exp(-Math.max(deltaSeconds, 0) / this.tau)
    this.current += (target - this.current) * k
    return this.current
  }
}
