import * as THREE from 'three/webgpu'

export type RendererBackend = 'webgpu' | 'webgl2'

export interface RendererHandle {
  renderer: THREE.WebGPURenderer
  backend: RendererBackend
}

async function supportsWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
  if (!gpu) return false
  try {
    const adapter = await gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}

/**
 * Creates the rendering backend. Prefers WebGPU and transparently falls back to
 * the WebGL2 backend provided by three.js's WebGPURenderer.
 */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererHandle> {
  const webgpu = await supportsWebGPU()

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
    forceWebGL: !webgpu,
  })

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // Tone mapping is performed explicitly in the post-processing node graph so
  // exposure ordering, AgX/Neutral selection and dithering are all controlled.
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1

  await renderer.init()

  return { renderer, backend: webgpu ? 'webgpu' : 'webgl2' }
}
