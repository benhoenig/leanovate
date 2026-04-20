import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { rawStorageDownload, rawStorageUpload } from '@/lib/supabase'

/**
 * Renders a single isometric snapshot of a variant's .glb file and uploads
 * it to the `thumbnails` bucket at `variants/{variantId}.png`.
 *
 * A static snapshot (not an auto-rotating live canvas) is used on purpose:
 * CatalogPanel renders 20–50+ tiles at once, and spawning that many WebGL
 * contexts kills perf. Hover-to-rotate can be layered on top later if it's
 * missed — for now every tile is a PNG served by Supabase Storage.
 *
 * @returns The Supabase Storage path (e.g. "variants/abc-123.png") on
 *          success, or an error string on failure.
 */
export async function renderVariantThumbnail(
  variantId: string,
  glbPath: string,
): Promise<{ path: string | null; error: string | null }> {
  // ─── Download the .glb ─────────────────────────────────────────────────────
  const { blob, error: dlErr } = await rawStorageDownload('glb-models', glbPath)
  if (dlErr || !blob) {
    return { path: null, error: dlErr ?? 'glb download returned no blob' }
  }
  const buffer = await blob.arrayBuffer()

  // ─── Offscreen Three.js scene ──────────────────────────────────────────────
  const SIZE = 512
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setSize(SIZE, SIZE, false)
  renderer.setPixelRatio(1)
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 1.2))

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.4)
  keyLight.position.set(5, 8, 6)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.6)
  fillLight.position.set(-5, 3, -4)
  scene.add(fillLight)

  try {
    // ─── Parse + normalize the model ─────────────────────────────────────────
    const loader = new GLTFLoader()
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      loader.parse(buffer, '', resolve, (err) => reject(err))
    })

    const model = gltf.scene
    // Match ModelApprovalModal's PBR brightening — TRELLIS outputs are dark.
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material
        const arr = Array.isArray(mat) ? mat : [mat]
        for (const m of arr) {
          if (m instanceof THREE.MeshStandardMaterial) {
            m.metalness = Math.min(m.metalness, 0.3)
            m.roughness = Math.max(m.roughness, 0.4)
            m.needsUpdate = true
          }
        }
      }
    })

    // Frame so the tallest dimension fills the view, centered at origin.
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 0.0001)
    const scale = 2.0 / maxDim
    model.scale.setScalar(scale)
    model.position.sub(center.multiplyScalar(scale))
    scene.add(model)

    // ─── Isometric camera ────────────────────────────────────────────────────
    // Classic 35.264° elevation / 45° yaw — matches construction-drawing
    // isometrics and reads as a familiar buy-mode catalog thumbnail.
    const camera = new THREE.OrthographicCamera(-1.35, 1.35, 1.35, -1.35, 0.1, 100)
    const elev = Math.atan(Math.SQRT1_2) // ≈ 35.264°
    const yaw = Math.PI / 4 // 45°
    const r = 5
    camera.position.set(
      Math.cos(elev) * Math.sin(yaw) * r,
      Math.sin(elev) * r,
      Math.cos(elev) * Math.cos(yaw) * r,
    )
    camera.lookAt(0, 0, 0)

    renderer.render(scene, camera)

    // ─── Canvas → PNG blob → Supabase ────────────────────────────────────────
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    if (!pngBlob) {
      return { path: null, error: 'canvas.toBlob returned null' }
    }

    const path = `variants/${variantId}.png`
    const { error: upErr } = await rawStorageUpload('thumbnails', path, pngBlob, {
      contentType: 'image/png',
      upsert: true,
    })
    if (upErr) {
      return { path: null, error: upErr }
    }

    return { path, error: null }
  } catch (err) {
    return { path: null, error: String(err) }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
