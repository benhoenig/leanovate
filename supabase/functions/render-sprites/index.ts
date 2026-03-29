/**
 * render-sprites — Supabase Edge Function
 *
 * Renders 4 isometric sprite images (front_left, front_right, back_left, back_right)
 * from a .glb 3D model file using Three.js.
 *
 * NOTE: Three.js rendering requires WebGL or an OffscreenCanvas-compatible environment.
 * Supabase Edge Functions run on Deno. This function uses Three.js with a software
 * WebGL implementation (gl npm package) for headless rendering.
 *
 * If the rendering environment doesn't support canvas/WebGL (some Supabase regions),
 * deploy this as a standalone Node.js service instead and call it from generate-3d-model.
 *
 * Request body: { variant_id: string, glb_path: string }
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Isometric camera angles (azimuth in degrees from North, elevation 35.26°)
// Standard isometric: camera above at ~35° elevation, rotated 45° per view
const SPRITE_DIRECTIONS = [
  { name: 'front_left',  azimuthDeg: 225 },
  { name: 'front_right', azimuthDeg: 315 },
  { name: 'back_left',   azimuthDeg: 135 },
  { name: 'back_right',  azimuthDeg: 45  },
] as const

const SPRITE_SIZE = 512   // Output PNG size in pixels
const ISO_ELEVATION = 35.264  // True isometric elevation angle in degrees

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    const { variant_id, glb_path } = await req.json()
    if (!variant_id || !glb_path) {
      return jsonError('variant_id and glb_path are required', 400)
    }

    // 1. Download .glb from Supabase Storage
    const { data: glbData, error: downloadError } = await supabase.storage
      .from('glb-models')
      .download(glb_path)

    if (downloadError || !glbData) {
      await markFailed(supabase, variant_id)
      return jsonError('Failed to download .glb: ' + (downloadError?.message ?? 'not found'), 500)
    }

    const glbArrayBuffer = await glbData.arrayBuffer()

    // 2. Render 4 isometric sprites
    let sprites: Array<{ direction: string; pngBuffer: Uint8Array }>

    try {
      sprites = await renderIsometricSprites(glbArrayBuffer)
    } catch (renderErr) {
      console.error('Render error:', renderErr)
      await markFailed(supabase, variant_id)
      return jsonError('Sprite rendering failed: ' + String(renderErr), 500)
    }

    // 3. Upload each sprite to Supabase Storage (sprites bucket — public)
    const spriteRows: Array<{ variant_id: string; direction: string; image_path: string }> = []

    for (const sprite of sprites) {
      const spritePath = `${variant_id}/${sprite.direction}.png`
      const { error: uploadError } = await supabase.storage
        .from('sprites')
        .upload(spritePath, sprite.pngBuffer, {
          contentType: 'image/png',
          upsert: true,
        })

      if (uploadError) {
        console.error(`Upload sprite ${sprite.direction} error:`, uploadError)
        continue
      }

      spriteRows.push({
        variant_id,
        direction: sprite.direction,
        image_path: spritePath,
      })
    }

    if (spriteRows.length === 0) {
      await markFailed(supabase, variant_id)
      return jsonError('No sprites were uploaded successfully', 500)
    }

    // 4. Upsert furniture_sprites rows
    const { error: insertError } = await supabase
      .from('furniture_sprites')
      .upsert(spriteRows, { onConflict: 'variant_id,direction' })

    if (insertError) {
      console.error('Insert sprites error:', insertError)
      await markFailed(supabase, variant_id)
      return jsonError('Failed to save sprite records: ' + insertError.message, 500)
    }

    // 5. Mark render_status as completed
    await supabase
      .from('furniture_variants')
      .update({ render_status: 'completed' })
      .eq('id', variant_id)

    return new Response(
      JSON.stringify({ success: true, sprites_count: spriteRows.length }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('render-sprites error:', err)
    return jsonError('Unexpected error: ' + String(err), 500)
  }
})

// ── Three.js rendering ────────────────────────────────────────────────────────

/**
 * Renders 4 isometric angle PNGs from a .glb ArrayBuffer.
 *
 * Uses Three.js with a canvas implementation compatible with Deno.
 * The `gl` npm package provides software WebGL for headless rendering.
 *
 * If this fails in the Edge Function environment, the render-sprites
 * function should be run as a standalone Node.js service.
 */
async function renderIsometricSprites(
  glbBuffer: ArrayBuffer
): Promise<Array<{ direction: string; pngBuffer: Uint8Array }>> {
  // Dynamic imports — Three.js and headless canvas support
  // These work in Deno with npm: specifier (Supabase Edge Functions v2)
  const THREE = await import('npm:three@0.164.1')
  const { GLTFLoader } = await import('npm:three@0.164.1/examples/jsm/loaders/GLTFLoader.js')
  const { createCanvas } = await import('npm:canvas@2.11.2')

  // Set up headless canvas and WebGL renderer
  const canvas = createCanvas(SPRITE_SIZE, SPRITE_SIZE)

  // @ts-ignore — node-canvas is compatible with Three.js WebGLRenderer
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

  // Ambient + directional lighting (warm, natural)
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
    // Convert ArrayBuffer to base64 data URL for GLTFLoader
    const uint8 = new Uint8Array(glbBuffer)
    let binary = ''
    for (let i = 0; i < uint8.byteLength; i++) {
      binary += String.fromCharCode(uint8[i])
    }
    const base64 = btoa(binary)
    const dataUrl = `data:model/gltf-binary;base64,${base64}`
    loader.load(
      dataUrl,
      (gltf) => resolve(gltf),
      undefined,
      (err) => reject(err)
    )
  })

  // Center and normalize model scale
  const model = gltf.scene
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = 2.0 / maxDim // Normalize to fit in a 2-unit cube
  model.scale.setScalar(scale)
  model.position.sub(center.multiplyScalar(scale))
  scene.add(model)

  // Orthographic camera for true isometric projection
  const aspect = 1
  const camSize = 1.8
  const camera = new THREE.OrthographicCamera(
    -camSize * aspect, camSize * aspect,
    camSize, -camSize,
    0.1, 100
  )

  const elevRad = (ISO_ELEVATION * Math.PI) / 180
  const camDistance = 10

  const results: Array<{ direction: string; pngBuffer: Uint8Array }> = []

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
    const buffer = canvas.toBuffer('image/png')
    results.push({ direction: name, pngBuffer: new Uint8Array(buffer) })
  }

  renderer.dispose()

  return results
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function markFailed(supabase: ReturnType<typeof createClient>, variantId: string) {
  await supabase
    .from('furniture_variants')
    .update({ render_status: 'failed' })
    .eq('id', variantId)
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
