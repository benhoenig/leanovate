/**
 * Client-side sprite rendering using Three.js.
 *
 * Renders 4 isometric sprite PNGs from a .glb 3D model file in the browser,
 * uploads them to Supabase Storage, and updates the database.
 *
 * Replaces the server-side render-sprites Edge Function which failed
 * because npm:canvas requires native binaries unavailable in Deno.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { supabase } from './supabase'

const SPRITE_DIRECTIONS = [
  { name: 'front_left', azimuthDeg: 225 },
  { name: 'front_right', azimuthDeg: 315 },
  { name: 'back_left', azimuthDeg: 135 },
  { name: 'back_right', azimuthDeg: 45 },
] as const

const SPRITE_SIZE = 512
const ISO_ELEVATION = 35.264 // True isometric elevation angle in degrees

/**
 * Renders 4 isometric sprite PNGs from a .glb file and uploads them.
 *
 * @param variantId - The furniture variant ID
 * @param glbPath - Path to the .glb file in the glb-models bucket
 */
export async function renderSprites(
  variantId: string,
  glbPath: string
): Promise<{ error: string | null }> {
  console.log('[renderSprites] Starting client-side rendering for variant:', variantId)

  try {
    // 1. Download .glb from Supabase Storage
    console.log('[renderSprites] Downloading .glb from:', glbPath)
    const { data: glbBlob, error: downloadError } = await supabase.storage
      .from('glb-models')
      .download(glbPath)

    if (downloadError || !glbBlob) {
      const msg = 'Failed to download .glb: ' + (downloadError?.message ?? 'not found')
      console.error('[renderSprites]', msg)
      await markFailed(variantId)
      return { error: msg }
    }

    const glbArrayBuffer = await glbBlob.arrayBuffer()
    console.log('[renderSprites] .glb downloaded, size:', glbArrayBuffer.byteLength)

    // 2. Render 4 isometric sprites
    const sprites = await renderIsometricSprites(glbArrayBuffer)
    console.log('[renderSprites] Rendered', sprites.length, 'sprites')

    // 3. Upload each sprite to Supabase Storage
    let uploadedCount = 0
    for (const sprite of sprites) {
      const spritePath = `${variantId}/${sprite.direction}.png`
      const { error: uploadError } = await supabase.storage
        .from('sprites')
        .upload(spritePath, sprite.blob, {
          contentType: 'image/png',
          upsert: true,
        })

      if (uploadError) {
        console.error(`[renderSprites] Upload ${sprite.direction} error:`, uploadError)
        continue
      }

      // 4. Upsert furniture_sprites row
      const { error: upsertError } = await supabase
        .from('furniture_sprites')
        .upsert(
          {
            variant_id: variantId,
            direction: sprite.direction,
            image_path: spritePath,
          },
          { onConflict: 'variant_id,direction' }
        )

      if (upsertError) {
        console.error(`[renderSprites] Upsert sprite row ${sprite.direction} error:`, upsertError)
        continue
      }

      uploadedCount++
    }

    if (uploadedCount === 0) {
      console.error('[renderSprites] No sprites uploaded successfully')
      await markFailed(variantId)
      return { error: 'No sprites were uploaded successfully' }
    }

    // 5. Mark render_status as completed
    const { error: updateError } = await supabase
      .from('furniture_variants')
      .update({ render_status: 'completed' })
      .eq('id', variantId)

    if (updateError) {
      console.error('[renderSprites] Failed to update render_status:', updateError)
      return { error: updateError.message }
    }

    console.log('[renderSprites] Complete! Uploaded', uploadedCount, 'sprites for variant:', variantId)
    return { error: null }
  } catch (err) {
    console.error('[renderSprites] Unexpected error:', err)
    await markFailed(variantId)
    return { error: String(err) }
  }
}

/**
 * Renders 4 isometric angle PNGs from a .glb ArrayBuffer using Three.js.
 */
async function renderIsometricSprites(
  glbBuffer: ArrayBuffer
): Promise<Array<{ direction: string; blob: Blob }>> {
  // Create offscreen canvas (not attached to DOM)
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_SIZE
  canvas.height = SPRITE_SIZE

  // Set up WebGL renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setSize(SPRITE_SIZE, SPRITE_SIZE)
  renderer.setPixelRatio(1)
  renderer.setClearColor(0x000000, 0) // Transparent background

  // Set up scene
  const scene = new THREE.Scene()

  // Lighting (same as Edge Function)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0xfff5e0, 1.2)
  dirLight.position.set(5, 10, 7)
  scene.add(dirLight)

  const fillLight = new THREE.DirectionalLight(0xe0f0ff, 0.4)
  fillLight.position.set(-5, 3, -5)
  scene.add(fillLight)

  // Load GLB from buffer
  const loader = new GLTFLoader()
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    loader.parse(
      glbBuffer,
      '',
      (result) => resolve(result),
      (err) => reject(err)
    )
  })

  // Center and normalize model scale
  const model = gltf.scene
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = 2.0 / maxDim
  model.scale.setScalar(scale)
  model.position.sub(center.multiplyScalar(scale))
  scene.add(model)

  // Orthographic camera for true isometric projection
  const camSize = 1.8
  const camera = new THREE.OrthographicCamera(
    -camSize, camSize,
    camSize, -camSize,
    0.1, 100
  )

  const elevRad = (ISO_ELEVATION * Math.PI) / 180
  const camDistance = 10

  const results: Array<{ direction: string; blob: Blob }> = []

  for (const { name, azimuthDeg } of SPRITE_DIRECTIONS) {
    const azRad = (azimuthDeg * Math.PI) / 180

    camera.position.set(
      camDistance * Math.sin(azRad) * Math.cos(elevRad),
      camDistance * Math.sin(elevRad),
      camDistance * Math.cos(azRad) * Math.cos(elevRad)
    )
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()

    renderer.render(scene, camera)

    // Export PNG from canvas
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
        'image/png'
      )
    })
    results.push({ direction: name, blob })
  }

  // Clean up WebGL context
  renderer.dispose()
  renderer.forceContextLoss()

  return results
}

async function markFailed(variantId: string) {
  await supabase
    .from('furniture_variants')
    .update({ render_status: 'failed' })
    .eq('id', variantId)
}
