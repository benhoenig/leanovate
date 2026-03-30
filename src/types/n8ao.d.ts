declare module 'n8ao' {
  import type { Scene, Camera, Color } from 'three'
  import { Pass } from 'postprocessing'

  interface N8AOConfiguration {
    aoSamples: number
    aoRadius: number
    distanceFalloff: number
    intensity: number
    denoiseSamples: number
    denoiseRadius: number
    halfRes: boolean
    color: Color
    screenSpaceRadius: boolean
    autoRenderBeauty: boolean
    colorMultiply: boolean
    [key: string]: unknown
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: N8AOConfiguration
  }

  export class N8AOPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: N8AOConfiguration
    dispose(): void
    setSize(width: number, height: number): void
  }
}
