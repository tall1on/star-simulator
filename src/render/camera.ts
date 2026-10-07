import * as THREE from 'three/webgpu'

export interface OrbitCameraOptions {
  /** Initial orbit distance in scene units. */
  distance?: number
  /** Slow automatic yaw when the user is not dragging. */
  autoRotate?: boolean
  /** Called whenever the zoom distance changes. */
  onChange?: (distance: number) => void
}

/**
 * Orbit camera with logarithmic (multiplicative) wheel zoom and a depth range
 * that tracks the current distance and star radius, so the huge scale range
 * from a neutron star to a giant stays free of z-fighting and clipping.
 *
 * Changing the star radius never reframes the camera; only a safety clamp keeps
 * it outside the photosphere. Use {@link fitStar} for explicit framing.
 */
export class OrbitCameraController {
  readonly camera: THREE.PerspectiveCamera

  autoRotate: boolean

  private readonly element: HTMLElement
  private readonly target = new THREE.Vector3(0, 0, 0)
  private readonly onChange?: (distance: number) => void

  private distance: number
  private radius = 1
  private minDistance = 1.25
  private maxDistance = 80
  private azimuth = 0.6
  private elevation = 0.25

  private dragging = false
  private pointerId: number | null = null
  private lastX = 0
  private lastY = 0

  constructor(element: HTMLElement, options: OrbitCameraOptions = {}) {
    this.element = element
    this.distance = options.distance ?? 3
    this.autoRotate = options.autoRotate ?? true
    this.onChange = options.onChange

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000)

    this.element.addEventListener('wheel', this.onWheel, { passive: false })
    this.element.addEventListener('pointerdown', this.onPointerDown)
    this.element.addEventListener('pointermove', this.onPointerMove)
    this.element.addEventListener('pointerup', this.onPointerUp)
    this.element.addEventListener('pointercancel', this.onPointerUp)

    this.updateCamera()
  }

  getDistance(): number {
    return this.distance
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  /**
   * Update the star's scene-unit radius. The view distance is preserved so an
   * expanding star visibly grows and forces the user to zoom out; only if the
   * camera would end up inside the photosphere is it pushed to the surface.
   */
  setStarRadius(radius: number): void {
    this.radius = Math.max(radius, 1e-6)
    this.minDistance = this.radius * 1.12
    this.maxDistance = Math.max(this.radius * 600, 50)
    if (this.distance < this.minDistance) {
      this.distance = this.minDistance
      this.updateCamera()
      this.onChange?.(this.distance)
    }
  }

  /** Explicitly frame the star with a comfortable margin. */
  fitStar(radius: number): void {
    this.setDistance(radius * 3.2)
  }

  update(deltaSeconds: number): void {
    if (this.autoRotate && !this.dragging) {
      this.azimuth += deltaSeconds * 0.08
      this.updateCamera()
    }
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    this.setDistance(this.distance * Math.exp(event.deltaY * 0.001))
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return
    this.pointerId = event.pointerId
    this.dragging = true
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.element.setPointerCapture(event.pointerId)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.pointerId) return
    const dx = event.clientX - this.lastX
    const dy = event.clientY - this.lastY
    this.lastX = event.clientX
    this.lastY = event.clientY

    this.azimuth -= dx * 0.005
    this.elevation = THREE.MathUtils.clamp(this.elevation + dy * 0.005, -1.45, 1.45)
    this.updateCamera()
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return
    this.dragging = false
    this.pointerId = null
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId)
    }
  }

  private setDistance(distance: number): void {
    this.distance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance)
    this.updateCamera()
    this.onChange?.(this.distance)
  }

  private updateCamera(): void {
    const cosEl = Math.cos(this.elevation)
    const x = this.distance * cosEl * Math.sin(this.azimuth)
    const y = this.distance * Math.sin(this.elevation)
    const z = this.distance * cosEl * Math.cos(this.azimuth)
    this.camera.position.set(x, y, z)

    const near = Math.max((this.distance - this.radius) * 0.25, this.distance * 0.005, this.radius * 0.001, 1e-5)
    const far = this.distance * 50 + this.radius * 200
    this.camera.near = near
    this.camera.far = Math.max(far, near * 10)
    this.camera.updateProjectionMatrix()

    this.camera.lookAt(this.target)
  }

  dispose(): void {
    this.element.removeEventListener('wheel', this.onWheel)
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerup', this.onPointerUp)
    this.element.removeEventListener('pointercancel', this.onPointerUp)
  }
}
