/**
 * Capture the current live canvas view as a 4K PNG and trigger a download.
 *
 * Works by temporarily resizing the existing renderer's drawingBuffer
 * (without touching the CSS display size), rendering one frame, grabbing
 * the PNG, and restoring the original size. The animate loop picks back up
 * at normal resolution on the next frame — no offscreen renderer needed.
 *
 * What the designer sees is exactly what gets exported: same scene, same
 * camera, same lighting, same materials — just at a higher internal
 * resolution so the PNG holds up when zoomed or printed.
 */

import type * as THREE from 'three'

const TARGET_WIDTH_PX = 3840  // 4K wide; height preserves the current aspect

export async function exportCanvasView(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  filename: string,
): Promise<void> {
  const canvas = renderer.domElement
  const displayW = canvas.clientWidth
  const displayH = canvas.clientHeight
  if (displayW === 0 || displayH === 0) return

  const aspect = displayW / displayH
  const targetH = Math.round(TARGET_WIDTH_PX / aspect)

  const origPR = renderer.getPixelRatio()

  try {
    // Bump drawingBuffer to 4K without touching CSS. The browser keeps
    // scaling the canvas into its displayed size, so this flash is invisible.
    renderer.setPixelRatio(1)
    renderer.setSize(TARGET_WIDTH_PX, targetH, false)

    renderer.render(scene, camera)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    if (!blob) return

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  } finally {
    // Restore for the next animate-loop frame.
    renderer.setPixelRatio(origPR)
    renderer.setSize(displayW, displayH, false)
    renderer.render(scene, camera)
  }
}

/** `MyRoom_20260422_1430.png` — sortable + unique. */
export function buildExportFilename(projectName: string, roomName: string): string {
  const safe = (s: string) => s.trim().replace(/[^\w\-]+/g, '_').slice(0, 40) || 'room'
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${safe(projectName)}_${safe(roomName)}_${stamp}.png`
}
