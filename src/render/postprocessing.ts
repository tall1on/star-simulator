import * as THREE from 'three/webgpu'
import {
  agxToneMapping,
  interleavedGradientNoise,
  neutralToneMapping,
  pass,
  sRGBTransferOETF,
  screenCoordinate,
  uniform,
  vec4,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js'

export type ToneMappingKind = 'agx' | 'neutral'

export interface Postprocessing {
  pipeline: THREE.RenderPipeline
  setBloomEnabled(enabled: boolean): void
  setBloomStrength(strength: number): void
  setLensFlareEnabled(enabled: boolean): void
  /** Exposure multiplier applied before tone mapping (scene-referred). */
  setExposure(exposure: number): void
  setToneMapping(kind: ToneMappingKind): void
  dispose(): void
}

/**
 * Scene post-processing.
 *
 * The scene renders into a linear **float16** (HDR) target, bloom and the
 * lens flare are built from that HDR signal, then the output node applies:
 * exposure → tone mapping (AgX or Khronos PBR Neutral, both of which preserve
 * hue in very bright saturated colours far better than ACES) → sRGB encode →
 * a tiny dither to hide banding in the smooth glow gradients.
 *
 * `outputColorTransform` is disabled so the transform happens exactly once,
 * in the order above, inside this node graph.
 */
export function createPostprocessing(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Postprocessing {
  const scenePass = pass(scene, camera, { type: THREE.HalfFloatType })
  const sceneColor = scenePass.getTextureNode() as unknown as THREE.Node<'vec4'>
  const bloomPass = bloom(sceneColor, 0.6, 0.5, 0.5)
  // NOTE: the shipped @types/three declares `getTexture()`, but three r186's
  // BloomNode exposes `getTextureNode()` at runtime. Prefer the runtime method.
  const bloomTexture = (bloomPass as unknown as { getTextureNode(): THREE.Node }).getTextureNode()
  const flarePass = lensflare(bloomTexture, {
    threshold: uniform(0.7),
    ghostSamples: uniform(4),
    ghostSpacing: uniform(0.35),
    ghostAttenuationFactor: uniform(18),
  })

  const exposure = uniform(1)
  const dither = interleavedGradientNoise(screenCoordinate).sub(0.5).mul(1 / 255)

  const pipeline = new THREE.RenderPipeline(renderer)
  pipeline.outputColorTransform = false

  let bloomEnabled = true
  let lensFlareEnabled = true
  let toneMapping: ToneMappingKind = 'agx'

  const rebuild = (): void => {
    const withBloom = sceneColor.add(bloomPass) as unknown as THREE.Node<'vec4'>
    const withFlare = withBloom.add(flarePass as unknown as THREE.Node<'vec4'>)
    const lit = bloomEnabled && lensFlareEnabled ? withFlare : bloomEnabled ? withBloom : sceneColor

    const mapped = toneMapping === 'agx' ? agxToneMapping(lit.rgb, exposure) : neutralToneMapping(lit.rgb, exposure)
    const encoded = sRGBTransferOETF(mapped) as unknown as THREE.Node<'vec3'>
    pipeline.outputNode = vec4(encoded.add(dither), 1)
  }
  rebuild()

  return {
    pipeline,
    setBloomEnabled(enabled) {
      bloomEnabled = enabled
      rebuild()
    },
    setBloomStrength(strength) {
      bloomPass.strength.value = strength
    },
    setLensFlareEnabled(enabled) {
      lensFlareEnabled = enabled
      rebuild()
    },
    setExposure(value) {
      exposure.value = value
    },
    setToneMapping(kind) {
      toneMapping = kind
      rebuild()
    },
    dispose() {
      pipeline.dispose()
    },
  }
}
